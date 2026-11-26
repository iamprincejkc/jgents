// Who gets a request. In order:
// 1. @mentions ("@studio make a teaser") or the agent picked in the composer: those agents, no guessing;
// 1b. with a company (an agent of kind 'ceo'), everything else goes to the CEO, which briefs the departments;
// 2. a quick Claude call (haiku by default, no tools) that reads the roster and the last exchanges and answers JSON,
//    so "add a pentest for the Jet API" goes to Sentinel and "now also add tests" stays with whoever you were talking to;
// 3. if that fails or times out: keyword scoring over names, keywords, descriptions and folder names.
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { parseMentions, type CrewAgent } from '../../shared/crew';

export interface Assignment {
  agentId: string;
  task: string;
  reason: string;
}

export interface RouteResult {
  assignments: Assignment[];
  via: 'mention' | 'picked' | 'llm' | 'keywords' | 'default' | 'ceo';
}

export interface RecentExchange {
  agentId: string;
  user: string;
}

/** Asks a model and returns its raw text answer (undefined on failure). */
export type Classifier = (prompt: string) => Promise<string | undefined>;

const MAX_SPLIT = 3;
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'api', 'app', 'ui', 'src', 'projects', 'project', 'revamp', 'users']);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Folder name tokens ("C:\Projects\REVAMP\JetLogistics-API-v2" → jetlogistics, v2, jet, logistics). */
function folderWords(folder: string): string[] {
  const base = basename(folder.replace(/[\\/]+$/, ''));
  const split = base.replace(/([a-z])([A-Z])/g, '$1 $2');
  return [...new Set([...words(base), ...words(split)])].filter((w) => w.length > 2 && !/^v\d+$/.test(w));
}

/** Keyword scoring (the fallback). Exported for tests. */
export function scoreAgents(text: string, agents: readonly CrewAgent[]): { id: string; score: number }[] {
  const t = ` ${text.toLowerCase()} `;
  const tw = new Set(words(text));
  const has = (w: string) => (w.includes(' ') ? t.includes(` ${w.toLowerCase()} `) || t.includes(w.toLowerCase()) : tw.has(w.toLowerCase()));
  return agents
    .map((a) => {
      let score = 0;
      if (has(a.id) || has(a.name)) score += 5;
      for (const k of a.keywords) if (has(k)) score += 3;
      for (const w of new Set([a.folder, ...(a.extraFolders ?? [])].flatMap(folderWords))) if (tw.has(w)) score += 3;
      for (const w of new Set(words(`${a.role} ${a.description}`))) if (w.length > 3 && tw.has(w)) score += 1;
      return { id: a.id, score };
    })
    .sort((x, y) => y.score - x.score);
}

export function defaultAgentId(agents: readonly CrewAgent[]): string | undefined {
  return (agents.find((a) => a.kind === 'general') ?? agents[0])?.id;
}

export function routerPrompt(text: string, agents: readonly CrewAgent[], recent: readonly RecentExchange[]): string {
  const roster = agents
    .map((a) => {
      const extra = [a.role, a.description, a.keywords.length ? `keywords: ${a.keywords.join(', ')}` : '', a.kind === 'project' ? `repository folders: ${[a.folder, ...(a.extraFolders ?? [])].map((f) => basename(f)).join(', ')}` : '']
        .filter(Boolean)
        .join(' | ');
      return `- id "${a.id}" (${a.name}, ${a.kind}): ${extra}`;
    })
    .join('\n');
  const history = recent.length
    ? recent.map((r) => `- to "${r.agentId}": ${r.user.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')
    : '- (none yet)';
  return [
    'You are the dispatcher of a team of AI agents. Each agent is a separate long-running session with its own',
    'folder and memory. Decide which agent(s) should get the user\'s new request.',
    '',
    'Agents:',
    roster,
    '',
    'Most recent requests (oldest first):',
    history,
    '',
    'Rules:',
    '- Usually exactly ONE assignment. Split only when the request clearly contains independent jobs for different',
    `  agents (max ${MAX_SPLIT}); then write each task so it stands alone.`,
    '- A follow-up that continues the last conversation ("also add tests", "make it shorter", "yes, go ahead") goes',
    '  to the agent of the most recent request.',
    '- Project agents own their repository: requests about that product/codebase go to them, unless the job is a',
    '  video (video agent) or a security test (security agent).',
    '- When nothing fits, use the general agent.',
    '- For a single assignment, "task" must be the user\'s request VERBATIM.',
    '',
    'Answer with JSON only, no prose, no code fences:',
    '{"assignments":[{"agent":"<id>","task":"<task>","reason":"<max 12 words>"}]}',
    '',
    'User request:',
    '<<<',
    text,
    '>>>',
  ].join('\n');
}

/** Pulls the JSON object out of a model answer and keeps only valid assignments. */
export function parseRouterAnswer(raw: string, agents: readonly CrewAgent[], text: string): Assignment[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (data as { assignments?: unknown })?.assignments;
  if (!Array.isArray(list)) return [];
  const ids = new Set(agents.map((a) => a.id));
  const out: Assignment[] = [];
  for (const item of list) {
    const r = item as Record<string, unknown>;
    const agentId = typeof r.agent === 'string' ? r.agent.trim().toLowerCase() : '';
    if (!ids.has(agentId) || out.some((a) => a.agentId === agentId)) continue;
    const task = typeof r.task === 'string' && r.task.trim() ? r.task.trim() : text;
    const reason = typeof r.reason === 'string' ? r.reason.trim().slice(0, 120) : '';
    out.push({ agentId, task, reason });
    if (out.length >= MAX_SPLIT) break;
  }
  if (out.length === 1) out[0].task = text;
  return out;
}

export async function route(
  text: string,
  agents: readonly CrewAgent[],
  opts: { picked?: string; recent?: readonly RecentExchange[]; classify?: Classifier },
): Promise<RouteResult> {
  if (opts.picked && agents.some((a) => a.id === opts.picked)) {
    return { assignments: [{ agentId: opts.picked, task: text, reason: 'picked by you' }], via: 'picked' };
  }
  const m = parseMentions(text, agents);
  if (m.ids.length) {
    return { assignments: m.ids.slice(0, MAX_SPLIT).map((id) => ({ agentId: id, task: m.rest, reason: 'mentioned' })), via: 'mention' };
  }
  if (agents.length === 1) return { assignments: [{ agentId: agents[0].id, task: text, reason: 'only agent' }], via: 'default' };
  const ceo = agents.find((a) => a.kind === 'ceo');
  if (ceo) return { assignments: [{ agentId: ceo.id, task: text, reason: 'the CEO takes every request' }], via: 'ceo' };
  if (opts.classify) {
    const raw = await opts.classify(routerPrompt(text, agents, opts.recent ?? [])).catch(() => undefined);
    const a = raw ? parseRouterAnswer(raw, agents, text) : [];
    if (a.length) return { assignments: a, via: 'llm' };
  }
  const scored = scoreAgents(text, agents);
  if (scored[0]?.score > 0 && scored[0].score > (scored[1]?.score ?? 0)) {
    return { assignments: [{ agentId: scored[0].id, task: text, reason: 'matched keywords' }], via: 'keywords' };
  }
  const last = opts.recent?.at(-1)?.agentId;
  const fallback = last && agents.some((a) => a.id === last) ? last : defaultAgentId(agents);
  if (!fallback) return { assignments: [], via: 'default' };
  return { assignments: [{ agentId: fallback, task: text, reason: last === fallback ? 'continuing the conversation' : 'general request' }], via: 'default' };
}

/** The classifier: `claude -p --model <model> --output-format json`, no MCP servers, nothing that would prompt. */
export function createClaudeClassifier(bin: string, opts: { model: string; cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number }): Classifier {
  return (prompt) =>
    new Promise((resolve) => {
      const args = ['-p', '--model', opts.model, '--output-format', 'json', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-prompts', 'none'];
      const child = execFile(bin, args, { cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs ?? 45_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, out) => {
        if (err && !out) return resolve(undefined);
        try {
          const res = JSON.parse(out) as { result?: unknown; is_error?: unknown };
          resolve(res.is_error === true || typeof res.result !== 'string' ? undefined : res.result);
        } catch {
          resolve(undefined);
        }
      });
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(prompt);
    });
}

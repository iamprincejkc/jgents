// The crew's roster: who the agents are (<dataDir>/crew/agents.json). On first start it holds three built-in agents
// (Arceus the concierge, Ho-Oh for video with HyperFrames, Giratina for pentests with Strix), each with its own workspace
// under <dataDir>/crew/workspaces; project agents (one per repository: "IBC", "Jet"...) are added from the page.
// Agents are named after legendary Pokémon, each matched to its job (CREW_LEGENDS in shared/crew.ts), so the handle
// tells you who does what: @arceus oversees and answers anything, @ho-oh makes videos, @giratina finds the cracks.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { CREW_ID_RE, CREW_KINDS, CREW_PERMISSION_MODES, crewSlug, type CrewAgent, type CrewKind, type CrewPermissionMode } from '../../shared/crew';

const MAX_AGENTS = 40;
const TEXT_MAX = { name: 40, role: 80, description: 1_200, instructions: 12_000, model: 80, emoji: 8, keyword: 40, tool: 200, folder: 1_024 };

export const KIND_EMOJI: Record<CrewKind, string> = { project: '🧑‍💻', video: '🎬', security: '🛡️', general: '🧭', custom: '🤖' };

/** Instructions every agent of a kind gets on top of its own (kept here so improvements reach existing agents). */
export const KIND_PLAYBOOK: Record<CrewKind, string> = {
  project: [
    'You own this repository. Work like a careful senior engineer on it: read before you change, keep changes small',
    'and focused, run the project\'s own tests/linters when they exist, and never commit, push or deploy unless the',
    'request says so. Finish with a short report: what changed (files), how you verified it, and anything left open.',
  ].join(' '),
  video: [
    'You make videos with HyperFrames (https://github.com/heygen-com/hyperframes): HTML + CSS + seekable animations',
    'rendered to deterministic MP4. Workflow, in your working folder:',
    '1) If the HyperFrames skills are not available yet, run `npx -y hyperframes skills update` once (needs Node 22+',
    'and FFmpeg; if FFmpeg is missing, ask the user to install it, e.g. `winget install Gyan.FFmpeg`).',
    '2) One folder per video: `npx -y hyperframes init <short-slug>`; plan the beats, then write the composition',
    'following the /hyperframes skill (read it first) and reuse registry blocks (`npx hyperframes catalog`, `add`).',
    '3) Check it (`npx hyperframes lint` when available, look at frames), then `npx hyperframes render` to MP4.',
    'Ask the user (ask_user) about format (16:9 / 9:16 / 1:1), length, tone and brand assets when the request leaves',
    'them open. End with the absolute path of every rendered file.',
  ].join(' '),
  security: [
    'You are the crew\'s security tester. You run authorised penetration tests with Strix',
    '(https://github.com/usestrix/strix): autonomous agents that run the code, find vulnerabilities and validate them',
    'with proofs of concept. Rules you never break:',
    '- Only test targets the user owns or is explicitly authorised to test. Before any scan of a URL, domain or IP,',
    'confirm the exact target and scope with ask_user unless the request already states both. Local folders and',
    'localhost apps of the user\'s own projects are fine to test once named.',
    '- Never run destructive or denial-of-service tests, never test third-party services, never exfiltrate data.',
    '- Never ask the user to paste API keys or passwords into the chat; ask them to set environment variables instead.',
    'Setup: Strix needs Docker running, `strix` on the PATH (Windows: `uv tool install strix-agent` or',
    '`pipx install strix-agent`; macOS/Linux: `curl -sSL https://strix.ai/install | bash`) and the STRIX_LLM (any',
    'LiteLLM model id) and LLM_API_KEY environment variables. Check them first; if something is missing, say exactly',
    'what to install or set and stop. The Strix agent skills (`npx -y skills add usestrix/strix`) hold the detailed',
    'workflows; install them in your folder the first time. Headless scan, always with -n:',
    '`strix -n -t <folder|url> --scan-mode quick --max-budget 10` (`deep` takes hours: start it detached so it',
    'outlives your turn, say so, and read the results when asked). Exit codes: 0 clean (check run.json: status and',
    'llm_usage.cost), 1 error, 2 vulnerabilities found. Read strix_runs/<run>/penetration_test_report.md and',
    'vulnerabilities.json. Report findings by severity (critical → low) with the affected file/endpoint, the proof',
    'and the fix, and offer to hand the fixes to the project\'s agent (handoff).',
  ].join(' '),
  general: [
    'You are the concierge of the crew: answer general questions, research, plan and write. When a request clearly',
    'belongs to another agent (a project, video or security work), hand it off with the handoff tool instead of doing',
    'it yourself.',
  ].join(' '),
  custom: '',
};

export function workspacesDir(dataDir: string): string {
  return join(dataDir, 'crew', 'workspaces');
}

/** The three agents a new crew starts with. */
export function defaultAgents(dataDir: string): CrewAgent[] {
  const ws = workspacesDir(dataDir);
  const base = { instructions: '', model: '', allowedTools: [] as string[], extraFolders: [] as string[], builtin: true };
  return [
    {
      ...base,
      id: 'arceus',
      name: 'Arceus',
      role: 'Concierge: general questions, research and planning',
      description: 'Anything that is not tied to one project: questions, research, writing, planning, comparing options, explaining things.',
      keywords: ['question', 'research', 'plan', 'explain', 'write', 'email', 'summary'],
      emoji: '✨',
      color: '#b8892b',
      kind: 'general',
      folder: join(ws, 'arceus'),
      permissionMode: 'ask',
    },
    {
      ...base,
      id: 'ho-oh',
      name: 'Ho-Oh',
      role: 'Video studio: videos and motion graphics with HyperFrames',
      description:
        'Makes videos: promos, launch clips, explainers, social videos, motion graphics, captions, slideshows and demos, written as HTML and rendered to MP4 with HyperFrames.',
      keywords: ['video', 'motion', 'animation', 'promo', 'teaser', 'explainer', 'render', 'mp4', 'captions', 'hyperframes', 'reel', 'tiktok', 'youtube'],
      emoji: '🌈',
      color: '#d9534f',
      kind: 'video',
      folder: join(ws, 'ho-oh'),
      permissionMode: 'acceptEdits',
      allowedTools: ['Bash(npx hyperframes:*)', 'Bash(npx -y hyperframes:*)', 'Bash(ffmpeg:*)', 'Bash(ffprobe:*)'],
    },
    {
      ...base,
      id: 'giratina',
      name: 'Giratina',
      role: 'Security tracker: penetration tests with Strix',
      description:
        'Penetration tests and security reviews of the user\'s own apps, APIs and repositories with Strix: vulnerabilities, OWASP Top 10, auth, injection, XSS, secrets, proofs of concept and fixes.',
      keywords: ['pentest', 'pen test', 'security', 'vulnerability', 'vulnerabilities', 'strix', 'owasp', 'xss', 'injection', 'exploit', 'audit', 'cve'],
      emoji: '👁️',
      color: '#6d4c9f',
      kind: 'security',
      folder: join(ws, 'giratina'),
      permissionMode: 'ask',
    },
  ];
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\0/g, '').trim().slice(0, max) : '';
}

const isAbs = (p: string): boolean => isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p);

function list(v: unknown, max: number, itemMax: number): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : [];
  const out: string[] = [];
  for (const item of raw) {
    const s = str(item, itemMax);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#0891b2', '#ca8a04', '#4f46e5', '#059669', '#dc2626'];

/**
 * Checks a roster entry sent by the page (create: `existing` undefined; update: merged over it). Returns the agent or
 * the reason it was refused.
 */
export function parseAgent(raw: unknown, existing: CrewAgent | undefined, taken: ReadonlySet<string>): CrewAgent | { error: string } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const has = (k: string) => k in r;
  const name = has('name') ? str(r.name, TEXT_MAX.name) : (existing?.name ?? '');
  if (!name) return { error: 'give the agent a name' };
  let id = existing?.id ?? (str(r.id, 24).toLowerCase() || crewSlug(name));
  if (!existing) {
    if (!CREW_ID_RE.test(id)) return { error: 'the handle must be lowercase letters, digits and dashes (max 24)' };
    if (taken.has(id)) {
      if (str(r.id, 24)) return { error: `@${id} is already taken` };
      let n = 2;
      while (taken.has(`${id.slice(0, 21)}-${n}`)) n++;
      id = `${id.slice(0, 21)}-${n}`;
    }
  }
  const kindRaw = has('kind') ? r.kind : (existing?.kind ?? 'project');
  const kind: CrewKind = CREW_KINDS.includes(kindRaw as CrewKind) ? (kindRaw as CrewKind) : 'custom';
  const folder = has('folder') ? str(r.folder, TEXT_MAX.folder) : (existing?.folder ?? '');
  if (!folder || !isAbs(folder)) return { error: 'pick the agent\'s working folder (absolute path)' };
  const extraFolders = has('extraFolders') ? list(r.extraFolders, 8, TEXT_MAX.folder).filter((f) => f !== folder) : (existing?.extraFolders ?? []);
  const badExtra = extraFolders.find((f) => !isAbs(f));
  if (badExtra) return { error: `"${badExtra}" is not an absolute path` };
  const modeRaw = has('permissionMode') ? r.permissionMode : (existing?.permissionMode ?? 'acceptEdits');
  const permissionMode: CrewPermissionMode = CREW_PERMISSION_MODES.includes(modeRaw as CrewPermissionMode) ? (modeRaw as CrewPermissionMode) : 'ask';
  const colorRaw = has('color') ? str(r.color, 7) : (existing?.color ?? '');
  const color = COLOR_RE.test(colorRaw) ? colorRaw.toLowerCase() : PALETTE[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length];
  return {
    id,
    name,
    role: has('role') ? str(r.role, TEXT_MAX.role) : (existing?.role ?? ''),
    description: has('description') ? str(r.description, TEXT_MAX.description) : (existing?.description ?? ''),
    keywords: has('keywords') ? list(r.keywords, 30, TEXT_MAX.keyword) : (existing?.keywords ?? []),
    emoji: (has('emoji') ? str(r.emoji, TEXT_MAX.emoji) : existing?.emoji) || KIND_EMOJI[kind],
    color,
    kind,
    folder,
    extraFolders,
    instructions: has('instructions') ? str(r.instructions, TEXT_MAX.instructions) : (existing?.instructions ?? ''),
    model: has('model') ? str(r.model, TEXT_MAX.model) : (existing?.model ?? ''),
    permissionMode,
    allowedTools: has('allowedTools') ? list(r.allowedTools, 50, TEXT_MAX.tool) : (existing?.allowedTools ?? []),
    ...(existing?.builtin ? { builtin: true } : {}),
  };
}

export class Roster {
  private agents: CrewAgent[] = [];
  private readonly file: string;

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, 'crew', 'agents.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) {
      this.agents = defaultAgents(this.dataDir);
      this.save();
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { agents?: unknown[] };
      const out: CrewAgent[] = [];
      const taken = new Set<string>();
      for (const item of Array.isArray(raw.agents) ? raw.agents : []) {
        const id = (item as { id?: unknown })?.id;
        if (typeof id !== 'string' || !CREW_ID_RE.test(id) || taken.has(id)) continue;
        const a = parseAgent(item, { ...(item as CrewAgent), id }, taken);
        if ('error' in a) continue;
        out.push(a);
        taken.add(a.id);
      }
      this.agents = out;
    } catch {
      // Unreadable file: keep it aside and start over with the defaults.
      try {
        renameSync(this.file, `${this.file}.broken-${Date.now()}`);
      } catch {
        // ignore
      }
      this.agents = defaultAgents(this.dataDir);
      this.save();
    }
  }

  private save(): void {
    mkdirSync(join(this.dataDir, 'crew'), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, agents: this.agents }, null, 2)}\n`);
    renameSync(tmp, this.file);
  }

  list(): CrewAgent[] {
    return this.agents.map((a) => ({ ...a, keywords: [...a.keywords], allowedTools: [...a.allowedTools] }));
  }

  get(id: string): CrewAgent | undefined {
    return this.agents.find((a) => a.id === id);
  }

  create(raw: unknown): CrewAgent | { error: string } {
    if (this.agents.length >= MAX_AGENTS) return { error: `a crew holds up to ${MAX_AGENTS} agents` };
    const a = parseAgent(raw, undefined, new Set(this.agents.map((x) => x.id)));
    if ('error' in a) return a;
    this.agents.push(a);
    this.save();
    return a;
  }

  update(id: string, raw: unknown): CrewAgent | { error: string } | undefined {
    const i = this.agents.findIndex((a) => a.id === id);
    if (i < 0) return undefined;
    const a = parseAgent(raw, this.agents[i], new Set());
    if ('error' in a) return a;
    this.agents[i] = a;
    this.save();
    return a;
  }

  /** Adds a tool rule to the agent's "approved without asking" list. */
  allowTool(id: string, rule: string): void {
    const a = this.get(id);
    if (!a || a.allowedTools.includes(rule)) return;
    a.allowedTools = [...a.allowedTools, rule].slice(-50);
    this.save();
  }

  remove(id: string): boolean {
    const before = this.agents.length;
    this.agents = this.agents.filter((a) => a.id !== id);
    if (this.agents.length === before) return false;
    this.save();
    return true;
  }
}

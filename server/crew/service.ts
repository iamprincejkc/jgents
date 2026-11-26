// The crew: one chat, many agents. Each request is routed (router.ts) to one or more agents; each agent runs its
// turns one at a time in its own Claude Code session (runner.ts), different agents in parallel. Questions and
// approvals go to the board (board.ts) through the bridge (mod/jgents-crew/mcp.mjs). Everything the page shows is
// pushed to listeners (the SSE in http.ts) as CrewEvents.
//
// The company (company.ts): with a CEO in the roster every request goes to it. The CEO briefs departments with
// `delegate`; the briefs of one turn form a ticket, and each department's final reply is its report. When the last
// report is in, the CEO gets them all in one message, combines the work and answers the user. A department may brief
// another the same way: its own report then waits until that colleague has reported back to it.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CompanyFile, CompanyFileText, CrewAgent, CrewAgentState, CrewCompany, CrewEvents, CrewMessage, CrewQuestion, CrewSession, CrewSessionMode, CrewSnapshot, CrewStep, CrewToolCheck } from '../../shared/crew';
import { findExecutable } from '../claude-bin';
import { allowRule, Board, publicItem, type BoardItem } from './board';
import { COMPANY_CEO_ID, COMPANY_ROOM_ID, type Activity, type ActivityKind, type AgentInfo, type AgentStatus } from '../../shared/types';
import { hash32 } from '../../shared/hash';
import { tr } from '../../shared/i18n';
import { companyAgents, companyDir, CompanyLog, ensureCompanyFolder, insideFolder, memberLook, readOutboxFile, uniform, type CompanyEvent } from './company';
import { KIND_PLAYBOOK, Roster, workspacesDir } from './roster';
import { createClaudeClassifier, route, type Classifier } from './router';
import { cleanEnv, runTurn, type RunningTurn, type Spawner } from './runner';
import { listSessions, SESSION_ID_RE } from './sessions';
import { Thread } from './thread';

export interface CrewOptions {
  dataDir: string;
  port: number;
  /** The `claude` executable; undefined = crew off (`disabledReason`). */
  claudeBin?: string;
  /** Claude Code config dirs (accounts): where the sessions an agent can start from live. */
  claudeDirs?: string[];
  disabledReason?: string;
  /** mod/jgents-crew/mcp.mjs */
  bridgeScript: string;
  nodeBin: string;
  env: NodeJS.ProcessEnv;
  routerModel?: string;
  maxParallel?: number;
  spawner?: Spawner;
  classify?: Classifier;
  /** Tests: keep everything in memory. */
  memory?: boolean;
}

/** Where a job's final reply goes: the ticket it reports to, and its slot there. */
interface TicketRef {
  id: string;
  key: string;
}

interface Job {
  runId: string;
  agentId: string;
  prompt: string;
  msgId: string;
  /** A fresh session was already tried for this job (after --resume failed). */
  retried?: boolean;
  handoffs: number;
  /** The user message this work serves (briefs and reports keep pointing at it). */
  replyTo?: string;
  /** A brief: its final reply is a report to this ticket. */
  ticket?: TicketRef;
}

interface Report {
  agentId: string;
  status: 'done' | 'error' | 'stopped';
  text: string;
  costUsd?: number;
}

/** The briefs one turn sent with `delegate`: their reports go back to the agent that sent them, all together. */
interface Ticket {
  id: string;
  /** Who briefed (gets the reports). */
  owner: string;
  /** The turn that briefed. */
  ownerRun: string;
  /** When the owner was itself briefed: its final reply (after these reports) is its own report there. */
  parent?: TicketRef;
  /** The user message it all serves. */
  request?: string;
  /** Briefs still out: slot key -> agent. */
  pending: Map<string, string>;
  reports: Report[];
  briefs: number;
}

interface Running {
  job: Job;
  turn: RunningTurn;
}

interface SavedState {
  sessionId?: string;
  forkNext?: boolean;
  costUsd: number;
  turns: number;
  lastAt?: number;
}

export type CrewListener = <K extends keyof CrewEvents>(event: K, data: CrewEvents[K]) => void;

export interface AnswerInput {
  action: 'answer' | 'dismiss' | 'allow' | 'deny';
  answer?: string;
  always?: boolean;
}

const TEXT_MAX = 20_000;
const MAX_HANDOFFS = 4;
/** Briefs one turn may send (the whole company at once is 16). */
const MAX_BRIEFS = 20;
/** Room for each report in the message that hands the reports back. */
const REPORT_MAX = 8_000;
const SNAPSHOT_MESSAGES = 200;

const TOOL_LABEL: Record<string, (i: Record<string, unknown>) => string> = {
  Bash: (i) => `Ran ${code(i.command)}`,
  PowerShell: (i) => `Ran ${code(i.command)}`,
  Read: (i) => `Read ${file(i.file_path)}`,
  Edit: (i) => `Edited ${file(i.file_path)}`,
  MultiEdit: (i) => `Edited ${file(i.file_path)}`,
  Write: (i) => `Wrote ${file(i.file_path)}`,
  Glob: (i) => `Searched files ${code(i.pattern)}`,
  Grep: (i) => `Searched for ${code(i.pattern)}`,
  WebFetch: (i) => `Opened ${String(i.url ?? '')}`,
  WebSearch: (i) => `Searched the web for “${String(i.query ?? '')}”`,
  Task: (i) => `Started a subagent: ${String(i.description ?? '')}`,
  Agent: (i) => `Started a subagent: ${String(i.description ?? '')}`,
  TodoWrite: () => 'Updated its task list',
  Skill: (i) => `Loaded the ${String(i.skill ?? i.name ?? '')} skill`,
  mcp__jgents__ask_user: () => 'Asked you a question',
  mcp__jgents__handoff: (i) => `Handed off to @${String(i.agent ?? '')}`,
  mcp__jgents__delegate: (i) => `Briefed @${String(i.agent ?? '').replace(/^@/, '')}`,
};

/** What a tool call looks like in the office (the desk screen and the bubble follow the kind). */
const TOOL_KIND: Record<string, ActivityKind> = {
  Bash: 'run',
  PowerShell: 'run',
  Read: 'read',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'write',
  Glob: 'search',
  Grep: 'search',
  WebFetch: 'web',
  WebSearch: 'web',
  Task: 'communicate',
  Agent: 'communicate',
  TodoWrite: 'plan',
  Skill: 'skill',
  mcp__jgents__ask_user: 'ask',
  mcp__jgents__handoff: 'communicate',
  mcp__jgents__delegate: 'communicate',
};

const KIND_ICON: Partial<Record<ActivityKind, string>> = {
  run: '💻',
  read: '📖',
  edit: '✏️',
  write: '📝',
  search: '🔎',
  web: '🌐',
  plan: '📋',
  skill: '🧩',
  ask: '❓',
  communicate: '📨',
  think: '💭',
  respond: '💬',
  done: '✅',
  error: '⚠️',
};

function code(v: unknown): string {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return `\`${s.length > 90 ? `${s.slice(0, 89)}…` : s}\``;
}

function file(v: unknown): string {
  const s = String(v ?? '');
  return s.split(/[\\/]/).slice(-2).join('/') || s;
}

export function toolLabel(name: string, input: Record<string, unknown>): string {
  const f = TOOL_LABEL[name];
  if (f) return f(input);
  if (name.startsWith('mcp__')) return `Used ${name.split('__').slice(1).join(' → ')}`;
  return `Used ${name}`;
}

/** The agent's standing system prompt (appended to Claude Code's own). `companyFolder`: the CEO's and departments'. */
export function systemPrompt(agent: CrewAgent, crew: readonly CrewAgent[], companyFolder?: string): string {
  const line = (a: CrewAgent) => `- @${a.id} (${a.name}): ${a.role || a.description.slice(0, 100)}`;
  const isCompany = (a: CrewAgent) => a.kind === 'ceo' || a.kind === 'department';
  const others = crew.filter((a) => a.id !== agent.id);
  const company = others.filter(isCompany);
  const rest = others.filter((a) => !isCompany(a));
  // The company is told apart from the rest of the crew: the CEO counts, reports on and briefs its departments only
  // (it once counted the user's other agents as departments); the other agents only need to know where it is.
  let roster: string[];
  if (isCompany(agent)) {
    const departments = company.filter((a) => a.kind === 'department');
    roster = [
      agent.kind === 'ceo' ? `Your departments (${departments.length}):` : 'The company (its CEO and your fellow departments):',
      (agent.kind === 'ceo' ? departments : company).map(line).join('\n') || '- (none yet)',
      ...(rest.length ? ['', 'Other agents on the crew, outside the company (not departments: never count or report on them as part of the company; work with them only when the user asks):', rest.map(line).join('\n')] : []),
    ];
  } else {
    roster = ['The crew:', rest.map(line).join('\n') || '- (you are alone for now)'];
    const ceo = company.find((a) => a.kind === 'ceo');
    if (ceo) roster.push('', `The company: @${ceo.id} (${ceo.name}) and ${company.length - 1} departments. Anything for the company goes to @${ceo.id}.`);
  }
  const mates = roster.join('\n');
  return [
    `You are ${agent.name} (@${agent.id})${agent.role ? `, ${agent.role}` : ''}. You are one agent of the user's JGENTS crew: a team of`,
    'separate Claude Code sessions, each with its own folder and memory. The user talks to the whole crew from one chat',
    'and a dispatcher sends you the requests that are yours.',
    '',
    `Your working folder: ${agent.folder}`,
    companyFolder
      ? `The company folder: ${companyFolder} (profile.md: who the company is; outbox/: finished work for the user; log.jsonl: what the company did).`
      : agent.extraFolders.length
        ? `You also work in: ${agent.extraFolders.join(', ')} (same product: keep them consistent).`
        : '',
    KIND_PLAYBOOK[agent.kind],
    agent.instructions,
    '',
    'How you work with the user:',
    '- Your replies appear in the crew chat as Markdown. Be concise and lead with the result.',
    '- The user is not watching a terminal. When you need a decision, a missing detail or a go-ahead, call the',
    '  mcp__jgents__ask_user tool (it waits for the answer). Do not end a turn with an unanswered question in the',
    '  text when you are blocked, and never use AskUserQuestion.',
    '- Tool calls that need permission are approved by the user on their board. If one is denied, adapt instead of',
    '  retrying the same call.',
    '- When part of a request belongs to a teammate, give it to them with mcp__jgents__handoff instead of doing it.',
    '',
    mates,
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');
}

/** Does an "always allow" rule cover this call? ("Edit", "Bash(npm test:*)", "Bash(git status)") */
export function ruleAllows(rules: readonly string[], tool: string, input: Record<string, unknown>): boolean {
  const cmd = typeof input.command === 'string' ? input.command.trim() : '';
  for (const r of rules) {
    if (r === tool) return true;
    const m = /^([\w-]+)\((.*)\)$/.exec(r);
    if (!m || m[1] !== tool || !cmd) continue;
    const pat = m[2];
    if (pat.endsWith(':*') ? cmd === pat.slice(0, -2) || cmd.startsWith(`${pat.slice(0, -2)} `) : cmd === pat) {
      // a prefix rule never covers chained commands
      if (!/[;&|`]|\$\(/.test(cmd)) return true;
    }
  }
  return false;
}

export class CrewService {
  readonly token = randomBytes(24).toString('hex');
  readonly enabled: boolean;
  readonly reason?: string;
  readonly routerModel: string;
  private readonly roster: Roster;
  private readonly board: Board;
  private readonly thread: Thread;
  private readonly saved = new Map<string, SavedState>();
  private readonly lastError = new Map<string, string>();
  private readonly activity = new Map<string, string>();
  private readonly queues = new Map<string, Job[]>();
  private readonly running = new Map<string, Running>();
  private readonly listeners = new Set<CrewListener>();
  private readonly tickets = new Map<string, Ticket>();
  /** The ticket each turn opened with `delegate` (until that turn ends). */
  private readonly runTickets = new Map<string, string>();
  private readonly companyLog: CompanyLog;
  /** What each agent is doing, as an office activity (company characters show it): kind, text and a change counter. */
  private readonly acts = new Map<string, Activity>();
  private actSeq = 0;
  /** When each company member's office status last changed. */
  private readonly statusSince = new Map<string, { status: AgentStatus; since: number }>();
  private readonly bornAt = Date.now();
  private readonly classify?: Classifier;
  private readonly maxParallel: number;
  private readonly crewDir: string;

  constructor(private readonly opts: CrewOptions) {
    this.crewDir = join(opts.dataDir, 'crew');
    this.enabled = !!opts.claudeBin;
    this.reason = opts.claudeBin ? undefined : (opts.disabledReason ?? 'Claude Code (claude) was not found');
    this.routerModel = opts.routerModel || 'haiku';
    this.maxParallel = Math.max(1, opts.maxParallel ?? 4);
    this.roster = new Roster(opts.dataDir);
    this.board = new Board(opts.memory ? undefined : join(this.crewDir, 'questions.json'), (q) => {
      this.emit('question', publicItem(q));
      this.emitState(q.agentId);
    });
    this.thread = new Thread(opts.memory ? undefined : join(this.crewDir, 'thread.jsonl'));
    this.companyLog = new CompanyLog(opts.memory ? undefined : join(companyDir(opts.dataDir), 'log.jsonl'));
    this.loadState();
    this.classify =
      opts.classify ??
      (opts.claudeBin
        ? createClaudeClassifier(opts.claudeBin, { model: this.routerModel, cwd: this.ensureDir(join(this.crewDir, 'router')), env: cleanEnv(opts.env) })
        : undefined);
  }

  // ---------- state ----------

  private ensureDir(dir: string): string {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // reported when used
    }
    return dir;
  }

  private loadState(): void {
    if (this.opts.memory) return;
    try {
      const raw = JSON.parse(readFileSync(join(this.crewDir, 'state.json'), 'utf8')) as { agents?: Record<string, SavedState> };
      for (const [id, s] of Object.entries(raw.agents ?? {})) {
        this.saved.set(id, {
          sessionId: typeof s.sessionId === 'string' ? s.sessionId : undefined,
          forkNext: s.forkNext === true || undefined,
          costUsd: Number(s.costUsd) || 0,
          turns: Number(s.turns) || 0,
          lastAt: s.lastAt,
        });
      }
    } catch {
      // first start
    }
  }

  private saveState(): void {
    if (this.opts.memory) return;
    try {
      this.ensureDir(this.crewDir);
      const file = join(this.crewDir, 'state.json');
      writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, agents: Object.fromEntries(this.saved) }, null, 2));
      renameSync(`${file}.tmp`, file);
    } catch {
      // in memory still
    }
  }

  private savedOf(id: string): SavedState {
    let s = this.saved.get(id);
    if (!s) {
      s = { costUsd: 0, turns: 0 };
      this.saved.set(id, s);
    }
    return s;
  }

  stateOf(id: string): CrewAgentState {
    const s = this.saved.get(id) ?? { costUsd: 0, turns: 0 };
    const running = this.running.has(id);
    const open = this.board.openFor(id);
    const err = this.lastError.get(id);
    return {
      id,
      status: open ? 'waiting' : running ? 'working' : err ? 'error' : 'idle',
      sessionId: s.sessionId,
      forkNext: s.forkNext || undefined,
      queued: this.queues.get(id)?.length ?? 0,
      activity: running ? (this.activity.get(id) ?? 'Thinking…') : undefined,
      lastAt: s.lastAt,
      costUsd: s.costUsd,
      turns: s.turns,
      lastError: err,
    };
  }

  // ---------- the company in the office ----------

  private officeActivity(id: string, kind: ActivityKind, text: string, tool?: string): Activity {
    return { id: `crew:${id}:${++this.actSeq}`, kind, icon: KIND_ICON[kind] ?? '•', text: text.slice(0, 46), ...(tool ? { tool } : {}), at: Date.now() };
  }

  /** What an agent is doing now: the line on the crew page (`crewText`) and the office activity of a company member. */
  private setActivity(id: string, crewText: string, kind: ActivityKind, officeText: string, tool?: string): void {
    this.activity.set(id, crewText);
    this.acts.set(id, this.officeActivity(id, kind, officeText, tool));
  }

  /**
   * The company as office characters (OfficeSnapshot.company): the CEO and each department, in uniform, in the Main
   * Office. Working = a turn running or queued; waiting = a question or approval of theirs open on the board; idle
   * otherwise (they play or take a break until the next brief).
   */
  companyMembers(): AgentInfo[] {
    const now = Date.now();
    const open = this.board.list().filter((q) => q.status === 'open');
    const out: AgentInfo[] = [];
    for (const a of this.roster.list()) {
      if (a.kind !== 'ceo' && a.kind !== 'department') continue;
      const face = memberLook(a.id);
      const ask = open.find((q) => q.agentId === a.id);
      const busy = this.running.has(a.id) || (this.queues.get(a.id)?.length ?? 0) > 0;
      const status: AgentStatus = ask ? 'waiting' : busy ? 'working' : 'idle';
      const prev = this.statusSince.get(a.id);
      const since = !prev ? this.bornAt : prev.status === status ? prev.since : now;
      if (!prev || prev.status !== status) this.statusSince.set(a.id, { status, since });
      const s = this.saved.get(a.id);
      const act = this.acts.get(a.id);
      const seed = face?.seed ?? hash32(`company:${a.id}`);
      // the first CEO is the one the router uses (and the one at the head of the table); ids stay unique
      const ceo = a.kind === 'ceo' && !out.some((m) => m.id === COMPANY_CEO_ID);
      const own = `company:${a.id}`;
      const info: AgentInfo = {
        id: ceo ? COMPANY_CEO_ID : own === COMPANY_CEO_ID ? `${own}:2` : own,
        kind: 'main',
        roomId: COMPANY_ROOM_ID,
        name: face?.short ?? a.name,
        look: face?.look ?? (seed & 1 ? 'f' : 'm'),
        role: a.name,
        title: a.role,
        sessionId: s?.sessionId ?? '',
        account: '',
        status,
        recent: act ? [act] : [],
        tasks: [],
        startedAt: this.bornAt,
        lastEventAt: s?.lastAt ?? this.bornAt,
        statusSince: since,
        stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0, costUSD: s?.costUsd ?? 0 },
        seed,
        parts: uniform(a.color),
      };
      if (ask) info.waitingFor = ask.kind === 'approval' ? tr('aprovar uma permissão') : tr('responder uma pergunta');
      if (act) info.activity = act;
      if (a.model) info.model = a.model;
      out.push(info);
    }
    return out;
  }

  /**
   * Is `path` one of the company's own folders (a member's workspace or the company folder)? Their Claude Code
   * sessions are the members' turns, already drawn as the company: the office skips them instead of opening a room.
   */
  isCompanyPath(path: string): boolean {
    if (!path) return false;
    const company = this.roster.list().filter((a) => a.kind === 'ceo' || a.kind === 'department');
    if (!company.length) return false;
    if (insideFolder(path, companyDir(this.opts.dataDir))) return true;
    return company.some((a) => insideFolder(path, a.folder));
  }

  // ---------- events ----------

  subscribe(fn: CrewListener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit<K extends keyof CrewEvents>(event: K, data: CrewEvents[K]): void {
    for (const fn of this.listeners) {
      try {
        fn(event, data);
      } catch {
        // a broken listener never stops the crew
      }
    }
  }

  private emitState(id: string): void {
    if (this.roster.get(id)) this.emit('state', this.stateOf(id));
  }

  private emitMessage(m: CrewMessage, final = true): void {
    this.thread.put(m, final);
    this.emit('message', m);
  }

  snapshot(): CrewSnapshot {
    const agents = this.roster.list();
    const questions = this.board.list();
    const open = questions.filter((q) => q.status === 'open');
    const closed = questions.filter((q) => q.status !== 'open').slice(-60);
    return {
      enabled: this.enabled,
      reason: this.reason,
      agents,
      states: agents.map((a) => this.stateOf(a.id)),
      messages: this.thread.list(SNAPSHOT_MESSAGES),
      questions: [...closed, ...open].sort((a, b) => a.at - b.at),
      routerModel: this.routerModel,
    };
  }

  /** The office's Crew and HQ buttons: on or off, questions waiting, who works, and whether a company is set up. */
  summary(): { enabled: boolean; open: number; working: number; agents: number; company: boolean } {
    const agents = this.roster.list();
    return {
      enabled: this.enabled,
      open: this.board.list().filter((q) => q.status === 'open').length,
      working: agents.filter((a) => this.running.has(a.id)).length,
      agents: agents.length,
      company: agents.some((a) => a.kind === 'ceo'),
    };
  }

  // ---------- roster ----------

  agents(): CrewAgent[] {
    return this.roster.list();
  }

  createAgent(raw: unknown): CrewAgent | { error: string } {
    const a = this.roster.create(raw);
    if (!('error' in a)) {
      this.emit('agents', this.roster.list());
      this.emitState(a.id);
    }
    return a;
  }

  updateAgent(id: string, raw: unknown): CrewAgent | { error: string } | undefined {
    const a = this.roster.update(id, raw);
    if (a && !('error' in a)) this.emit('agents', this.roster.list());
    return a;
  }

  removeAgent(id: string): boolean {
    if (!this.roster.get(id)) return false;
    this.stop(id);
    this.roster.remove(id);
    this.saved.delete(id);
    this.saveState();
    this.emit('agents', this.roster.list());
    return true;
  }

  /** Clears the agent's context: the next request starts a new Claude Code conversation. */
  reset(id: string): boolean {
    const a = this.roster.get(id);
    if (!a) return false;
    this.stop(id);
    const s = this.savedOf(id);
    s.sessionId = undefined;
    this.lastError.delete(id);
    this.saveState();
    this.system(`🧹 Fresh start for **${a.name}**: the next request opens a new conversation (its files stay as they are).`, id);
    this.emitState(id);
    return true;
  }

  /** Stops the running turn and drops the agent's queue. */
  stop(id: string): boolean {
    const r = this.running.get(id);
    const queue = this.queues.get(id) ?? [];
    this.queues.delete(id);
    for (const job of queue) {
      const m = this.thread.get(job.msgId);
      if (m) this.emitMessage({ ...m, status: 'stopped', text: m.text || '_Cancelled before it started._' });
      this.settle(job, 'stopped', 'Cancelled before it started.');
    }
    if (r) r.turn.stop();
    this.emitState(id);
    return !!r || queue.length > 0;
  }

  clearChat(): void {
    this.thread.clear();
    this.board.clearResolved();
    this.emit('cleared', { at: Date.now() });
    this.emit('snapshot', this.snapshot());
  }

  // ---------- chat ----------

  private system(text: string, agentId?: string): CrewMessage {
    const m: CrewMessage = { id: randomUUID(), at: Date.now(), kind: 'system', agentId, text, status: 'done' };
    this.emitMessage(m);
    return m;
  }

  /** A request from the page. Returns the user's message at once; routing and the turns follow. */
  chat(text: string, picked?: string): CrewMessage | { error: string } {
    const t = text.replace(/\0/g, '').trim();
    if (!t) return { error: 'write something first' };
    if (t.length > TEXT_MAX) return { error: `messages are limited to ${TEXT_MAX} characters` };
    if (!this.enabled) return { error: this.reason ?? 'the crew is off' };
    const agents = this.roster.list();
    if (!agents.length) return { error: 'add an agent first' };
    const target = picked && this.roster.get(picked) ? picked : undefined;
    const user: CrewMessage = { id: randomUUID(), at: Date.now(), kind: 'user', text: t, agentId: target, status: 'done' };
    const recent = this.thread.recent();
    this.emitMessage(user);
    void this.dispatch(user, agents, target, recent);
    return user;
  }

  private async dispatch(user: CrewMessage, agents: CrewAgent[], picked: string | undefined, recent: { agentId: string; user: string }[]): Promise<void> {
    const note: CrewMessage = { id: randomUUID(), at: Date.now(), kind: 'router', text: 'Finding the right agent…', status: 'streaming', replyTo: user.id };
    const quick = !!picked || /(^|\s)@[\p{L}\p{N}_-]/u.test(user.text) || agents.length === 1 || agents.some((a) => a.kind === 'ceo');
    if (!quick) this.emitMessage(note, false);
    let result;
    try {
      result = await route(user.text, agents, { picked, recent, classify: this.classify });
    } catch {
      result = { assignments: [], via: 'default' as const };
    }
    if (!result.assignments.length) {
      this.emitMessage({ ...note, text: 'No agent could take this request.', status: 'error' });
      return;
    }
    const names = result.assignments.map((a) => this.roster.get(a.agentId)).filter((a): a is CrewAgent => !!a);
    const how = result.via === 'llm' ? 'dispatcher' : result.via === 'keywords' ? 'keywords' : result.via === 'mention' ? 'mention' : result.via === 'picked' ? 'your pick' : result.via === 'ceo' ? 'the company' : 'default';
    for (const a of result.assignments) if (this.roster.get(a.agentId)?.kind === 'ceo') this.companyLog.append({ type: 'request', agent: a.agentId, text: user.text });
    const lines = result.assignments.map((a) => {
      const ag = this.roster.get(a.agentId);
      return `${ag?.emoji ?? '🤖'} **${ag?.name ?? a.agentId}**${a.reason ? ` · ${a.reason}` : ''}`;
    });
    this.emitMessage({ ...note, at: note.at, text: `→ ${lines.join('  ·  ')}`, targets: names.map((a) => a.id), status: 'done', origin: how });
    for (const a of result.assignments) this.enqueue(a.agentId, a.task, { replyTo: user.id });
  }

  // ---------- company ----------

  /** Adds the CEO and every department not in the roster yet (and the company folder). */
  createCompany(): { created: string[]; folder: string } | { error: string } {
    let folder: string;
    try {
      folder = ensureCompanyFolder(this.opts.dataDir);
    } catch (err) {
      return { error: `could not create the company folder: ${String((err as Error)?.message ?? err)}` };
    }
    const created: string[] = [];
    for (const spec of companyAgents(this.opts.dataDir)) {
      if (this.roster.get(spec.id)) continue;
      const a = this.roster.create(spec);
      if ('error' in a) return created.length ? { created, folder } : a;
      created.push(a.id);
    }
    if (created.length) {
      this.emit('agents', this.roster.list());
      for (const id of created) this.emitState(id);
      this.system(`🏢 The company is set up: the CEO and ${created.length - (created.includes('ceo') ? 1 : 0)} departments. Every request without an @mention now goes to the CEO. Tell them who you are in ${join(folder, 'profile.md')}.`);
    }
    return { created, folder };
  }

  /** The company for the console and the office: who is in it, what they are doing and what happened lately. */
  company(): CrewCompany {
    const folder = companyDir(this.opts.dataDir);
    const agents = this.roster.list();
    const ceo = agents.find((a) => a.kind === 'ceo');
    const departments = agents.filter((a) => a.kind === 'department');
    let outbox: CompanyFile[] = [];
    try {
      const dir = join(folder, 'outbox');
      outbox = readdirSync(dir)
        .map((name) => {
          const st = statSync(join(dir, name));
          return st.isFile() ? { name, at: st.mtimeMs, bytes: st.size } : undefined;
        })
        .filter((f): f is CompanyFile => !!f && !f.name.startsWith('.'))
        .sort((a, b) => b.at - a.at)
        .slice(0, 50);
    } catch {
      // no outbox yet
    }
    return {
      folder,
      ...(ceo ? { ceo } : {}),
      departments,
      states: [...(ceo ? [ceo] : []), ...departments].map((a) => this.stateOf(a.id)),
      log: this.companyLog.recent(300),
      outbox,
      members: this.companyMembers(),
    };
  }

  /** One finished file in the company outbox (the HQ console's viewer). */
  outboxFile(name: string): CompanyFileText | undefined {
    return readOutboxFile(this.opts.dataDir, name);
  }

  /**
   * A job is over: when it was a brief, its final reply is its report. A turn that briefed others itself does not report
   * yet: the reports it waits for come back as a new job, and that one reports for it.
   */
  private settle(job: Job, status: Report['status'], text: string, costUsd?: number): void {
    if (this.runTickets.has(job.runId)) {
      this.runTickets.delete(job.runId);
      return;
    }
    if (!job.ticket) return;
    const t = this.tickets.get(job.ticket.id);
    if (!t || !t.pending.has(job.ticket.key)) return;
    t.pending.delete(job.ticket.key);
    t.reports.push({ agentId: job.agentId, status, text, costUsd });
    this.companyLog.append({ type: 'report', agent: job.agentId, to: t.owner, ticket: t.id, status, text, costUsd });
    if (!t.pending.size) this.closeTicket(t);
  }

  /** Every brief has reported: the reports go back to the agent that sent them, in one message. */
  private closeTicket(t: Ticket): void {
    this.tickets.delete(t.id);
    const owner = this.roster.get(t.owner);
    const request = t.request ? this.thread.get(t.request)?.text : undefined;
    const parts = t.reports.map((r) => {
      const a = this.roster.get(r.agentId);
      const body = r.text.length > REPORT_MAX ? `${r.text.slice(0, REPORT_MAX)}\n[report cut here]` : r.text;
      return `## ${a?.name ?? r.agentId} (@${r.agentId}) · ${r.status === 'done' ? 'done' : r.status === 'error' ? 'failed' : 'stopped'}\n\n${body || '(no report)'}`;
    });
    const n = t.reports.length;
    const next =
      owner?.kind === 'ceo'
        ? 'Now check the work, fill any gap, combine it into one deliverable in the company outbox, and answer the user: a short summary, the file path(s), and what needs their decision.'
        : 'Now finish your own brief with these results; your final reply is your report.';
    const prompt = [`The ${n === 1 ? 'agent' : `${n} agents`} you briefed ${n === 1 ? 'has' : 'have'} reported${request ? ` (the request: "${request.replace(/\s+/g, ' ').slice(0, 300)}")` : ''}.`, '', ...parts, '', next].join('\n');
    this.enqueue(t.owner, prompt, { origin: `reports from ${n} ${n === 1 ? 'department' : 'departments'}`, replyTo: t.request, ticket: t.parent });
  }

  /** Queues a turn. `ticket` without a key opens a new slot on that ticket (a brief); with a key it reports in that slot. */
  private enqueue(agentId: string, prompt: string, opts: { replyTo?: string; origin?: string; handoffs?: number; ticket?: { id: string; key?: string } } = {}): string {
    const msg: CrewMessage = { id: randomUUID(), at: Date.now(), kind: 'agent', agentId, text: '', status: 'queued', steps: [], replyTo: opts.replyTo, origin: opts.origin };
    this.emitMessage(msg, false);
    let ticket: TicketRef | undefined;
    if (opts.ticket) {
      ticket = { id: opts.ticket.id, key: opts.ticket.key ?? msg.id };
      if (!opts.ticket.key) this.tickets.get(opts.ticket.id)?.pending.set(msg.id, agentId);
    }
    const job: Job = { runId: randomUUID(), agentId, prompt, msgId: msg.id, handoffs: opts.handoffs ?? 0, replyTo: opts.replyTo, ticket };
    const q = this.queues.get(agentId) ?? [];
    q.push(job);
    this.queues.set(agentId, q);
    this.emitState(agentId);
    this.pump();
    return msg.id;
  }

  private pump(): void {
    for (const [agentId, q] of this.queues) {
      if (this.running.size >= this.maxParallel) return;
      if (this.running.has(agentId) || !q.length) continue;
      const job = q.shift()!;
      if (!q.length) this.queues.delete(agentId);
      this.start(job);
    }
  }

  private bridgeConfig(agent: CrewAgent, runId: string): string {
    const dir = this.ensureDir(join(this.crewDir, 'bridge'));
    const file = join(dir, `${agent.id}.json`);
    const cfg = {
      mcpServers: {
        jgents: {
          type: 'stdio',
          command: this.opts.nodeBin,
          args: [this.opts.bridgeScript],
          env: { JGENTS_PORT: String(this.opts.port), JGENTS_CREW_TOKEN: this.token, JGENTS_CREW_AGENT: agent.id, JGENTS_CREW_RUN: runId },
        },
      },
    };
    writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    return file;
  }

  private start(job: Job): void {
    const agent = this.roster.get(job.agentId);
    const base = this.thread.get(job.msgId);
    const msg: CrewMessage = base ?? { id: job.msgId, at: Date.now(), kind: 'agent', agentId: job.agentId, text: '', steps: [] };
    const fail = (error: string) => {
      this.lastError.set(job.agentId, error);
      this.emitMessage({ ...msg, status: 'error', text: `⚠️ ${error}` });
      this.settle(job, 'error', error);
      this.emitState(job.agentId);
      this.pump();
    };
    if (!agent) return fail('this agent was removed');
    if (!this.opts.claudeBin) return fail(this.reason ?? 'Claude Code was not found');
    // Built-in workspaces are created on demand; a project folder must exist.
    if (agent.folder.startsWith(workspacesDir(this.opts.dataDir))) this.ensureDir(agent.folder);
    const company = agent.kind === 'ceo' || agent.kind === 'department';
    if (company) {
      try {
        ensureCompanyFolder(this.opts.dataDir);
      } catch {
        // the turn still runs; the agent reports what it cannot reach
      }
    }
    try {
      if (!statSync(agent.folder).isDirectory()) return fail(`${agent.folder} is not a folder`);
    } catch {
      return fail(`the folder ${agent.folder} does not exist — fix it in ${agent.name}'s settings`);
    }
    let mcpFile: string;
    try {
      mcpFile = this.bridgeConfig(agent, job.runId);
    } catch (err) {
      return fail(`could not write the bridge config: ${String((err as Error)?.message ?? err)}`);
    }
    this.lastError.delete(agent.id);
    this.setActivity(agent.id, 'Thinking…', 'think', tr('Pensando…'));
    const saved = this.savedOf(agent.id);
    const sessionId = job.retried ? undefined : saved.sessionId;
    const forkSession = !!sessionId && !!saved.forkNext;
    const addDirs = agent.extraFolders.filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
    const steps: CrewStep[] = [...(msg.steps ?? [])];
    let text = msg.text;
    const live = (): CrewMessage => ({ ...msg, at: msg.at, status: 'streaming', text, steps: [...steps] });
    this.emitMessage(live(), false);
    const env = {
      ...cleanEnv(this.opts.env),
      JGENTS_PORT: String(this.opts.port),
      // MCP tool calls (ask_user, approvals) may wait a long time for the user.
      MCP_TOOL_TIMEOUT: String(24 * 3600 * 1000),
    };
    const allowed = [...new Set([...agent.allowedTools, 'mcp__jgents__ask_user', 'mcp__jgents__handoff', 'mcp__jgents__delegate'])];
    const turn = runTurn(
      {
        bin: this.opts.claudeBin,
        cwd: agent.folder,
        prompt: job.prompt,
        systemPrompt: systemPrompt(agent, this.roster.list(), company ? companyDir(this.opts.dataDir) : undefined),
        mcpConfigFile: mcpFile,
        sessionId,
        forkSession,
        addDirs,
        model: agent.model || undefined,
        permissionMode: agent.permissionMode,
        allowedTools: allowed,
        env,
      },
      {
        onSession: (id) => {
          saved.sessionId = id;
          saved.forkNext = false;
          this.saveState();
        },
        onTextStart: () => {
          if (text && !text.endsWith('\n\n')) {
            text += '\n\n';
            this.emit('delta', { id: msg.id, text: '\n\n' });
          }
          this.setActivity(agent.id, 'Writing…', 'respond', tr('Escrevendo a resposta'));
          this.emitState(agent.id);
        },
        onText: (d) => {
          text += d;
          this.thread.put(live(), false);
          this.emit('delta', { id: msg.id, text: d });
        },
        onToolStart: (id, name, input) => {
          const label = toolLabel(name, input);
          steps.push({ id, tool: name, label, status: 'running' });
          const plain = label.replace(/`/g, '');
          this.setActivity(agent.id, plain, TOOL_KIND[name] ?? (name.startsWith('mcp__') ? 'mcp' : 'other'), plain, name);
          this.emitMessage(live(), false);
          this.emitState(agent.id);
        },
        onToolEnd: (id, isError) => {
          const s = steps.find((x) => x.id === id);
          if (s) s.status = isError ? 'error' : 'done';
          this.setActivity(agent.id, 'Thinking…', 'think', tr('Pensando…'));
          this.emitMessage(live(), false);
        },
      },
      this.opts.spawner,
    );
    this.running.set(agent.id, { job, turn });
    this.emitState(agent.id);
    void turn.done.then((r) => {
      this.running.delete(agent.id);
      this.activity.delete(agent.id);
      const failed = !r.ok && !r.stopped;
      this.acts.set(agent.id, this.officeActivity(agent.id, failed ? 'error' : 'done', failed ? tr('Algo deu errado') : tr('Concluído')));
      if (r.sessionMissing && sessionId && !job.retried) {
        // The saved session is gone (deleted, or another machine): start a new one with the same request.
        saved.sessionId = undefined;
        this.saveState();
        job.retried = true;
        this.emitMessage({ ...live(), status: 'queued', text: '', steps: [], origin: 'started a fresh session (the old one was not found)' }, false);
        this.start(job);
        return;
      }
      if (r.sessionId) saved.sessionId = r.sessionId;
      saved.turns += 1;
      saved.costUsd += r.costUsd ?? 0;
      saved.lastAt = Date.now();
      this.saveState();
      let finalText = r.text || text;
      if (!r.ok && !r.stopped) {
        const err = r.error ?? 'the turn failed';
        this.lastError.set(agent.id, err);
        // Claude Code often repeats the error as the reply text: say it once.
        const same = !!finalText && (finalText.includes(err) || err.includes(finalText.trim()));
        finalText = `${finalText && !same ? `${finalText}\n\n` : ''}⚠️ ${hintFor(err)}`;
      }
      this.emitMessage({
        ...msg,
        text: finalText || (r.stopped ? '_Stopped._' : '_(no reply)_'),
        steps: steps.map((s) => (s.status === 'running' ? { ...s, status: r.ok ? 'done' : 'error' } : s)),
        status: r.ok ? 'done' : r.stopped ? 'stopped' : 'error',
        costUsd: r.costUsd,
        durationMs: r.durationMs,
        sessionId: r.sessionId ?? saved.sessionId,
      });
      if (agent.kind === 'ceo' && r.ok) this.companyLog.append({ type: 'answer', agent: agent.id, text: finalText, costUsd: r.costUsd });
      this.settle(job, r.ok ? 'done' : r.stopped ? 'stopped' : 'error', finalText, r.costUsd);
      for (const q of this.board.runEnded(job.runId)) this.followUp(q);
      this.emitState(agent.id);
      this.pump();
    });
  }

  private followUp(q: BoardItem): void {
    const prompt = `The user answered your earlier question.\nQuestion: ${q.text}\nAnswer: ${q.answer ?? ''}\n\nContinue from there.`;
    this.enqueue(q.agentId, prompt, { origin: 'answer to its question' });
  }

  // ---------- board (page) ----------

  answer(id: string, input: AnswerInput): CrewQuestion | { error: string; status: number } {
    const q = this.board.get(id);
    if (!q) return { error: 'unknown question', status: 404 };
    if (q.status !== 'open') return { error: 'already answered', status: 409 };
    // Nobody will collect the answer when the turn that asked is over (or JGENTS restarted): it goes as a new message.
    const runActive = [...this.running.values()].some((r) => r.job.runId === q.runId);
    const orphan = !!q.delivered || (!runActive && !this.board.hasWaiter(id));
    const answer = typeof input.answer === 'string' ? input.answer.trim() : '';
    let r: BoardItem | undefined;
    if (q.kind === 'question') {
      if (input.action === 'dismiss') r = this.board.resolve(id, 'dismissed');
      else if (input.action === 'answer' && answer) r = this.board.resolve(id, 'answered', answer);
      else return { error: 'write an answer', status: 400 };
      if (r && orphan && r.status === 'answered') this.followUp(r);
    } else {
      if (input.action === 'allow') {
        if (input.always && q.tool) {
          this.roster.allowTool(q.agentId, allowRule(q.tool, q.input));
          this.emit('agents', this.roster.list());
        }
        r = this.board.resolve(id, 'allowed');
      } else if (input.action === 'deny' || input.action === 'dismiss') r = this.board.resolve(id, 'denied', answer || undefined);
      else return { error: 'allow or deny', status: 400 };
    }
    return r ? publicItem(r) : { error: 'already answered', status: 409 };
  }

  // ---------- bridge (agents) ----------

  bridgeAsk(raw: Record<string, unknown>): { id: string } | { error: string } {
    const agentId = String(raw.agent ?? '');
    if (!this.roster.get(agentId)) return { error: 'unknown agent' };
    const question = String(raw.question ?? '').trim();
    if (!question) return { error: 'empty question' };
    const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o).trim().slice(0, 200)).filter(Boolean).slice(0, 6) : [];
    const q = this.board.ask(agentId, typeof raw.run === 'string' ? raw.run : undefined, question, options, typeof raw.context === 'string' ? raw.context : undefined);
    return { id: q.id };
  }

  bridgeApprove(raw: Record<string, unknown>): { id?: string; status: 'pending' | 'allowed' } | { error: string } {
    const agent = this.roster.get(String(raw.agent ?? ''));
    if (!agent) return { error: 'unknown agent' };
    const tool = String(raw.tool ?? '');
    const input = raw.input && typeof raw.input === 'object' ? (raw.input as Record<string, unknown>) : {};
    if (!tool) return { error: 'missing tool' };
    if (agent.permissionMode === 'bypassPermissions' || ruleAllows(agent.allowedTools, tool, input)) return { status: 'allowed' };
    const q = this.board.approval(agent.id, typeof raw.run === 'string' ? raw.run : undefined, tool, input);
    return { id: q.id, status: 'pending' };
  }

  async bridgeWait(id: string, timeoutMs: number, signal?: AbortSignal): Promise<{ status: string; answer?: string; message?: string } | undefined> {
    const q = await this.board.wait(id, timeoutMs, signal);
    if (!q) return undefined;
    switch (q.status) {
      case 'answered':
        return { status: 'answered', answer: q.answer };
      case 'allowed':
        return { status: 'allowed' };
      case 'denied':
        return { status: 'denied', message: q.answer ? `The user denied this: ${q.answer}` : 'The user denied this.' };
      case 'expired':
        return { status: 'denied', message: 'This request expired.' };
      case 'dismissed':
        return { status: 'dismissed' };
      default:
        return { status: 'pending' };
    }
  }

  bridgeHandoff(raw: Record<string, unknown>): { name: string } | { error: string } {
    const from = this.roster.get(String(raw.from ?? ''));
    const wanted = String(raw.agent ?? '').trim().replace(/^@/, '').toLowerCase();
    const to = this.roster.list().find((a) => a.id === wanted || a.name.toLowerCase() === wanted);
    const task = String(raw.task ?? '').trim().slice(0, TEXT_MAX);
    if (!from) return { error: 'unknown agent' };
    if (!to) return { error: `no agent "${wanted}" in the crew (ids: ${this.roster.list().map((a) => a.id).join(', ')})` };
    if (to.id === from.id) return { error: 'you cannot hand off to yourself' };
    if (!task) return { error: 'empty task' };
    const run = typeof raw.run === 'string' ? raw.run : '';
    const parent = this.running.get(from.id)?.job;
    const depth = (parent && parent.runId === run ? parent.handoffs : 0) + 1;
    if (depth > MAX_HANDOFFS) return { error: 'too many handoffs in a row; do it yourself or ask the user' };
    this.emitMessage({
      id: randomUUID(),
      at: Date.now(),
      kind: 'router',
      text: `${from.emoji} **${from.name}** handed off to ${to.emoji} **${to.name}**`,
      targets: [to.id],
      agentId: from.id,
      status: 'done',
      origin: 'handoff',
    });
    this.enqueue(to.id, `Handoff from ${from.name} (@${from.id}), on behalf of the user:\n\n${task}`, { origin: `handoff from ${from.name}`, handoffs: depth });
    return { name: to.name };
  }

  /**
   * `delegate` from an agent's turn: briefs another agent; its report comes back to the caller with the others of the
   * same turn (see settle and closeTicket).
   */
  bridgeDelegate(raw: Record<string, unknown>): { name: string } | { error: string } {
    const from = this.roster.get(String(raw.from ?? ''));
    const wanted = String(raw.agent ?? '').trim().replace(/^@/, '').toLowerCase();
    const to = this.roster.list().find((a) => a.id === wanted || a.name.toLowerCase() === wanted);
    const task = String(raw.task ?? '').trim().slice(0, TEXT_MAX);
    if (!from) return { error: 'unknown agent' };
    if (!to) return { error: `no agent "${wanted}" in the crew (ids: ${this.roster.list().map((a) => a.id).join(', ')})` };
    if (to.id === from.id) return { error: 'you cannot brief yourself' };
    if (!task) return { error: 'empty brief' };
    const run = typeof raw.run === 'string' ? raw.run : '';
    const parent = this.running.get(from.id)?.job;
    if (!parent || parent.runId !== run) return { error: 'delegate only works during your own turn' };
    const depth = parent.handoffs + 1;
    if (depth > MAX_HANDOFFS) return { error: 'too many briefs in a chain; do it yourself or ask the user' };
    let t = this.tickets.get(this.runTickets.get(run) ?? '');
    if (!t) {
      t = { id: randomUUID(), owner: from.id, ownerRun: run, parent: parent.ticket, request: parent.replyTo, pending: new Map(), reports: [], briefs: 0 };
      this.tickets.set(t.id, t);
      this.runTickets.set(run, t.id);
    }
    if (t.briefs >= MAX_BRIEFS) return { error: `at most ${MAX_BRIEFS} briefs per turn` };
    t.briefs++;
    this.emitMessage({
      id: randomUUID(),
      at: Date.now(),
      kind: 'router',
      text: `${from.emoji} **${from.name}** briefed ${to.emoji} **${to.name}**`,
      targets: [to.id],
      agentId: from.id,
      status: 'done',
      origin: 'brief',
      replyTo: parent.replyTo,
    });
    this.companyLog.append({ type: 'brief', agent: from.id, to: to.id, ticket: t.id, text: task });
    this.enqueue(to.id, `Brief from ${from.name} (@${from.id}), on behalf of the user:\n\n${task}\n\nWhen you finish, your final reply goes back to ${from.name} as your report.`, {
      origin: `brief from ${from.name}`,
      handoffs: depth,
      replyTo: parent.replyTo,
      ticket: { id: t.id },
    });
    return { name: to.name };
  }

  // ---------- sessions ----------

  /** Claude Code sessions in a folder (yours and the crew's), newest first; the agent's current one is marked. */
  sessions(folders: string | readonly string[], agentId?: string): CrewSession[] {
    const current = agentId ? this.saved.get(agentId)?.sessionId : undefined;
    const list = [...new Set(typeof folders === 'string' ? [folders] : folders)].filter(Boolean);
    return list
      .flatMap((f) => listSessions(this.opts.claudeDirs ?? [], f))
      .sort((x, y) => y.at - x.at)
      .slice(0, 30)
      .map((s) => (s.id === current ? { ...s, current: true } : s));
  }

  /**
   * Points an agent at one of your sessions in its folder: `resume` continues it (only while it is not open
   * elsewhere: two writers on one conversation tangle it), `fork` starts the next turn from a copy of it.
   */
  adoptSession(agentId: string, sessionId: string, mode: CrewSessionMode): { ok: true } | { error: string; status: number } {
    const a = this.roster.get(agentId);
    if (!a) return { error: 'unknown agent', status: 404 };
    if (!SESSION_ID_RE.test(sessionId)) return { error: 'not a session id', status: 400 };
    if (this.running.has(agentId)) return { error: `${a.name} is working: stop it or wait for the turn to end`, status: 409 };
    const s = this.sessions([a.folder, ...a.extraFolders]).find((x) => x.id === sessionId);
    if (!s) return { error: `no session ${sessionId} in ${a.name}'s folders`, status: 404 };
    if (mode === 'resume' && s.open) return { error: 'that session is open in Claude Code right now: close it there first, or fork it', status: 409 };
    // A session is continued from its own folder: a session of the UI folder makes the UI the agent's main folder.
    if (s.folder !== a.folder) {
      this.roster.update(agentId, { folder: s.folder, extraFolders: [a.folder, ...a.extraFolders.filter((f) => f !== s.folder)] });
      this.emit('agents', this.roster.list());
    }
    const saved = this.savedOf(agentId);
    saved.sessionId = sessionId;
    saved.forkNext = mode === 'fork';
    this.lastError.delete(agentId);
    this.saveState();
    this.system(
      mode === 'fork'
        ? `🍴 **${a.name}** will start its next turn from a copy of your session “${s.title}” (the original stays as it is).`
        : `🔗 **${a.name}** now continues your session “${s.title}”. Don't open it in Claude Code while ${a.name} is working.`,
      agentId,
    );
    this.emitState(agentId);
    return { ok: true };
  }

  // ---------- toolbox ----------

  tools(id: string): CrewToolCheck[] | undefined {
    const a = this.roster.get(id);
    if (!a) return undefined;
    const env = this.opts.env;
    const check = (name: string, hint: string, bin = name): CrewToolCheck => {
      const path = name === 'claude' ? this.opts.claudeBin : findExecutable(bin, env);
      return { name, found: !!path, path, hint };
    };
    const out = [check('claude', 'Install Claude Code and log in once in a terminal (claude, then /login).'), check('node', 'Node.js 22+ from nodejs.org.')];
    if (a.kind === 'project') out.push(check('git', 'Git from git-scm.com.'));
    if (a.kind === 'video') {
      out.push(check('npx', 'Comes with Node.js.'), check('ffmpeg', 'winget install Gyan.FFmpeg (Windows) · brew install ffmpeg (macOS).'));
    }
    if (a.kind === 'security') {
      out.push(
        check('docker', 'Docker Desktop, running.'),
        check('strix', 'uv tool install strix-agent · pipx install strix-agent'),
        { name: 'STRIX_LLM', found: !!env.STRIX_LLM, hint: 'Set STRIX_LLM (a LiteLLM model id) where JGENTS runs (e.g. its .env), then restart JGENTS.' },
        { name: 'LLM_API_KEY', found: !!env.LLM_API_KEY, hint: 'Set LLM_API_KEY where JGENTS runs (e.g. its .env), then restart JGENTS.' },
      );
    }
    out.push({ name: 'folder', found: existsSync(a.folder) || a.folder.startsWith(workspacesDir(this.opts.dataDir)), path: a.folder, hint: 'Pick an existing folder in the agent settings.' });
    for (const f of a.extraFolders) out.push({ name: 'also in', found: existsSync(f), path: f, hint: `${f} does not exist` });
    return out;
  }

  /** Stops every turn (server shutting down). */
  shutdown(): void {
    for (const id of [...this.running.keys()]) this.stop(id);
  }
}

/** Turns a raw Claude Code error into something actionable. */
export function hintFor(error: string): string {
  if (/OAuth|authenticat|log ?in|401|credentials/i.test(error)) {
    return `${error}\n\nClaude Code is not logged in for JGENTS. Open a terminal, run \`claude\`, type \`/login\`, then try again.`;
  }
  if (/ENOENT|not recognized|could not start/i.test(error)) return `${error}\n\nCheck that Claude Code is installed (\`claude --version\`).`;
  return error;
}

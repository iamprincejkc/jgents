// Crew: one chat for a team of long-lived agents. Each agent is its own Claude Code session (its own folder,
// instructions and memory); the user writes in one place and the router hands each request to the right agent.
// Agents put their questions and approval requests on the user's Q&A board. Protocol shared by server/crew and
// client/src/crew (HTTP JSON + SSE on /api/crew/stream).
import type { AgentInfo } from './types';

/**
 * How an agent's tool calls are approved:
 * - `ask`: Claude Code's normal rules (your settings), and every call that would prompt becomes a card on the board;
 * - `acceptEdits`: file edits are approved automatically, the rest asks on the board;
 * - `auto`: Claude Code's auto mode decides, and asks on the board only when it would ask you;
 * - `bypassPermissions`: nothing asks. Only for agents in folders you fully trust.
 */
export type CrewPermissionMode = 'ask' | 'acceptEdits' | 'auto' | 'bypassPermissions';
export const CREW_PERMISSION_MODES: readonly CrewPermissionMode[] = ['ask', 'acceptEdits', 'auto', 'bypassPermissions'];

/**
 * What kind of work the agent does (decides the default icon, instructions and toolbox check). `ceo` and `department`
 * (additive) make up the company: the user talks to the CEO, which briefs departments and gets their reports back.
 */
export type CrewKind = 'project' | 'video' | 'security' | 'general' | 'custom' | 'ceo' | 'department';
export const CREW_KINDS: readonly CrewKind[] = ['project', 'video', 'security', 'general', 'custom', 'ceo', 'department'];

export interface CrewAgent {
  /** Short handle used in @mentions and URLs: lowercase letters, digits and dashes. */
  id: string;
  name: string;
  /** One line: what this agent is ("IBC Gen5 backend", "Video studio"). */
  role: string;
  /** What it handles, in plain words. The router reads this to decide who gets a request. */
  description: string;
  /** Extra words that point to this agent (project names, products, tools). */
  keywords: string[];
  emoji: string;
  /** Accent colour (#rrggbb). */
  color: string;
  kind: CrewKind;
  /** Main working folder (absolute). The agent's session lives here and reads its CLAUDE.md. */
  folder: string;
  /** More folders the agent works in (e.g. the UI next to the API), passed as --add-dir. */
  extraFolders: string[];
  /** Standing instructions added to the agent's system prompt. */
  instructions: string;
  /** Model alias or id ("opus", "sonnet", "haiku"); empty = Claude Code's default. */
  model: string;
  permissionMode: CrewPermissionMode;
  /** Tool rules approved without asking (Claude Code syntax: "Bash(npm test:*)", "Edit", "WebFetch"). */
  allowedTools: string[];
  /** Created by JGENTS on first start (can still be edited or removed). */
  builtin?: boolean;
}

/** A Claude Code session found in an agent's folder (yours from Claude Code, or one the crew made). */
export interface CrewSession {
  id: string;
  /** Last change (ms). */
  at: number;
  /** Its title, or the first request in it. */
  title: string;
  /** Open right now in Claude Code (desktop app, terminal or IDE). */
  open: boolean;
  /** The session the agent continues on its next turn. */
  current?: boolean;
  /** Config dir (account) it belongs to. */
  account: string;
  /** Folder it lives in (a session can only be continued from its own folder). */
  folder: string;
}

/** How an agent starts from an existing session: continue it, or start from a copy of it (the original stays as is). */
export type CrewSessionMode = 'resume' | 'fork';

export type CrewAgentStatus = 'idle' | 'working' | 'waiting' | 'error';

export interface CrewAgentState {
  id: string;
  status: CrewAgentStatus;
  /** Claude Code session the next turn resumes; absent = the next turn starts a fresh conversation. */
  sessionId?: string;
  /** The next turn starts from a copy of sessionId (--fork-session) instead of continuing it. */
  forkNext?: boolean;
  /** Requests waiting for the current turn to finish. */
  queued: number;
  /** What it is doing right now ("Running npm test"). */
  activity?: string;
  lastAt?: number;
  /** Total spent by this agent (as reported by Claude Code), in USD. */
  costUsd: number;
  turns: number;
  lastError?: string;
}

export type CrewMessageKind = 'user' | 'agent' | 'router' | 'system';
export type CrewMessageStatus = 'queued' | 'streaming' | 'done' | 'error' | 'stopped';

/** A tool call inside an agent's reply (shown as a collapsible step). */
export interface CrewStep {
  id: string;
  tool: string;
  label: string;
  status: 'running' | 'done' | 'error';
}

export interface CrewMessage {
  id: string;
  at: number;
  kind: CrewMessageKind;
  /** Agent that wrote it (agent) or that it was sent to (user, router). */
  agentId?: string;
  /** Agents a router note sent the request to. */
  targets?: string[];
  text: string;
  status?: CrewMessageStatus;
  steps?: CrewStep[];
  /** The user message this reply answers. */
  replyTo?: string;
  /** Who started this turn when it was not the user directly ("handoff from IBC", "answer to a question"). */
  origin?: string;
  costUsd?: number;
  durationMs?: number;
  /** Turn finished: the agent's session id (for "open in terminal": `claude --resume <id>`). */
  sessionId?: string;
}

export type CrewQuestionKind = 'question' | 'approval';
export type CrewQuestionStatus = 'open' | 'answered' | 'dismissed' | 'allowed' | 'denied' | 'expired';

export interface CrewQuestion {
  id: string;
  at: number;
  agentId: string;
  kind: CrewQuestionKind;
  /** The question, or for approvals a one-line summary of the tool call. */
  text: string;
  options?: string[];
  context?: string;
  /** Approvals: the tool and a readable preview of its input. */
  tool?: string;
  preview?: string;
  status: CrewQuestionStatus;
  answer?: string;
  answeredAt?: number;
}

export interface CrewToolCheck {
  name: string;
  found: boolean;
  path?: string;
  hint: string;
}

/** What happened in the company (server/crew/company.ts, CompanyLog): one line of <company>/log.jsonl. */
export type CompanyEventType = 'request' | 'brief' | 'report' | 'answer';

export interface CompanyEvent {
  at: number;
  type: CompanyEventType;
  /** Who acted: the CEO (request, answer), the department (report) or the one who briefed (brief). */
  agent: string;
  /** brief: who got it. */
  to?: string;
  /** The ticket (one CEO request with its briefs) it belongs to. */
  ticket?: string;
  status?: 'done' | 'error' | 'stopped';
  /** A short summary (the full text is in the chat). */
  text: string;
  costUsd?: number;
}

/** A finished piece of work in <company>/outbox. */
export interface CompanyFile {
  name: string;
  /** Last change (epoch ms). */
  at: number;
  bytes: number;
}

/** GET /api/crew/company: the company for the HQ console. */
export interface CrewCompany {
  folder: string;
  ceo?: CrewAgent;
  departments: CrewAgent[];
  states: CrewAgentState[];
  /** The latest events (oldest first), from before a restart too. */
  log: CompanyEvent[];
  /** Newest first. */
  outbox: CompanyFile[];
  /** The members as the office draws them (face, uniform, status, activity): CrewService.companyMembers. */
  members: AgentInfo[];
}

/** GET /api/crew/company/outbox/:name */
export interface CompanyFileText extends CompanyFile {
  text: string;
  /** Only the first 512 KB came back. */
  truncated: boolean;
}

export interface CrewSnapshot {
  enabled: boolean;
  /** Why the crew is off (enabled false). */
  reason?: string;
  agents: CrewAgent[];
  states: CrewAgentState[];
  messages: CrewMessage[];
  questions: CrewQuestion[];
  /** Model used by the router ("haiku" by default). */
  routerModel: string;
}

/** SSE events on /api/crew/stream (event name → data). */
export interface CrewEvents {
  snapshot: CrewSnapshot;
  message: CrewMessage;
  /** Streaming text appended to a message. */
  delta: { id: string; text: string };
  state: CrewAgentState;
  question: CrewQuestion;
  agents: CrewAgent[];
  cleared: { at: number };
}

/**
 * Agent names: legendary Pokémon, each matched to the work it fits, so the handle is easy to remember (@dialga keeps
 * the time-and-money side of IBC, @palkia moves Jet's shipments through space, @giratina finds the cracks). The page
 * suggests the first free one for the kind of agent being added; any other name still works.
 */
export interface CrewLegend {
  name: string;
  emoji: string;
  color: string;
  /** Kinds it fits, best first. */
  fits: readonly CrewKind[];
  /** Why the name fits the job. */
  why: string;
}

export const CREW_LEGENDS: readonly CrewLegend[] = [
  { name: 'Arceus', emoji: '✨', color: '#b8892b', fits: ['general'], why: 'The Original One: oversees the whole crew and answers anything' },
  { name: 'Ho-Oh', emoji: '🌈', color: '#d9534f', fits: ['video'], why: 'Rainbow wings: colour, light and visuals' },
  { name: 'Giratina', emoji: '👁️', color: '#6d4c9f', fits: ['security'], why: 'Renegade of the Distortion World: sees the other side and finds the cracks' },
  { name: 'Dialga', emoji: '⏳', color: '#3b5ba5', fits: ['project'], why: 'Master of time: schedules, billing cycles, history' },
  { name: 'Palkia', emoji: '🌀', color: '#b05aa0', fits: ['project'], why: 'Master of space: logistics, routes and distances' },
  { name: 'Mewtwo', emoji: '🧬', color: '#8e6fb3', fits: ['project', 'custom'], why: 'Engineered genius: architecture and hard refactors' },
  { name: 'Rayquaza', emoji: '🐉', color: '#2e8b57', fits: ['custom', 'project'], why: 'Keeps the peace from the sky: DevOps, CI/CD and deployments' },
  { name: 'Lugia', emoji: '🌊', color: '#4f74b3', fits: ['project', 'custom'], why: 'Guardian of the deep sea: databases, data and migrations' },
  { name: 'Groudon', emoji: '🌋', color: '#b5432f', fits: ['project'], why: 'Shapes the land: backends and infrastructure' },
  { name: 'Kyogre', emoji: '💧', color: '#2563eb', fits: ['project'], why: 'Shapes the seas: frontends and UI' },
  { name: 'Zygarde', emoji: '🧩', color: '#3f8f3f', fits: ['custom', 'project'], why: 'Keeps the ecosystem in order: tests, QA and health checks' },
];

/** The first legendary not yet used that fits `kind` (then any free one). */
export function suggestLegend(kind: CrewKind, taken: readonly string[]): CrewLegend | undefined {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const free = CREW_LEGENDS.filter((l) => !used.has(l.name.toLowerCase()));
  return free.find((l) => l.fits[0] === kind) ?? free.find((l) => l.fits.includes(kind)) ?? free[0];
}

export const CREW_ID_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

/** "IBC Gen5" → "ibc-gen5". */
export function crewSlug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return s || 'agent';
}

/**
 * The @mentions at the start or anywhere in a message that name agents (by id or by name without spaces), in order
 * of appearance, plus the text without the leading mentions. "@studio @sec make a promo" → [studio, sec], "make a promo".
 */
export function parseMentions(text: string, agents: readonly Pick<CrewAgent, 'id' | 'name'>[]): { ids: string[]; rest: string } {
  const byHandle = new Map<string, string>();
  for (const a of agents) {
    byHandle.set(a.id.toLowerCase(), a.id);
    byHandle.set(a.name.toLowerCase().replace(/\s+/g, ''), a.id);
  }
  const ids: string[] = [];
  for (const m of text.matchAll(/(^|[\s(])@([\p{L}\p{N}_-]+)/gu)) {
    const id = byHandle.get(m[2].toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
  }
  let rest = text;
  for (;;) {
    const m = /^\s*@([\p{L}\p{N}_-]+)[,:]?\s*/u.exec(rest);
    if (!m || !byHandle.has(m[1].toLowerCase())) break;
    rest = rest.slice(m[0].length);
  }
  return { ids, rest: rest.trim() || text.trim() };
}

// The HQ console's numbers and lines, from the crew and the company log. Pure: no DOM, no fetch (model.test.ts).
import type { CompanyEvent, CompanyFile, CrewAgent, CrewAgentState, CrewQuestion } from '../../../shared/crew';
import type { AgentInfo } from '../../../shared/types';

export type DeptStatus = 'working' | 'waiting' | 'done' | 'idle' | 'error';

/** Local midnight of the day `now` is in. */
export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface Pulse {
  working: number;
  waiting: number;
  idle: number;
  total: number;
  requestsToday: number;
  deliveredToday: number;
  spentToday: number;
  /** The department briefed most today (its id), if any was. */
  busiest?: string;
}

/** The company at a glance: who works, who needs you, what today cost. */
export function pulse(members: readonly Pick<AgentInfo, 'status'>[], log: readonly CompanyEvent[], outbox: readonly CompanyFile[], now: number): Pulse {
  const day = startOfDay(now);
  let working = 0;
  let waiting = 0;
  for (const m of members) {
    if (m.status === 'waiting') waiting++;
    else if (m.status === 'working') working++;
  }
  const today = log.filter((e) => e.at >= day);
  const briefs = new Map<string, number>();
  for (const e of today) if (e.type === 'brief' && e.to) briefs.set(e.to, (briefs.get(e.to) ?? 0) + 1);
  let busiest: string | undefined;
  for (const [id, n] of briefs) if (!busiest || n > (briefs.get(busiest) ?? 0)) busiest = id;
  return {
    working,
    waiting,
    idle: members.length - working - waiting,
    total: members.length,
    requestsToday: today.filter((e) => e.type === 'request').length,
    deliveredToday: outbox.filter((f) => f.at >= day).length,
    spentToday: today.reduce((s, e) => s + (e.costUsd ?? 0), 0),
    ...(busiest ? { busiest } : {}),
  };
}

/** Requests per hour today, from 8 am (or the first request, if earlier) to the current hour. */
export function hourly(log: readonly CompanyEvent[], now: number): { fromHour: number; counts: number[] } {
  const day = startOfDay(now);
  const hourNow = new Date(now).getHours();
  const hours = log.filter((e) => e.type === 'request' && e.at >= day && e.at <= now).map((e) => new Date(e.at).getHours());
  const fromHour = Math.min(8, hourNow, ...hours);
  const counts = new Array<number>(hourNow - fromHour + 1).fill(0);
  for (const h of hours) counts[h - fromHour]++;
  return { fromHour, counts };
}

/** Polyline points (0..w, 0..h, y down) for a sparkline of `counts`; one point is drawn flat across. */
export function sparkPoints(counts: readonly number[], w: number, h: number, pad = 3): string {
  const max = Math.max(1, ...counts);
  const n = counts.length;
  const xs = n <= 1 ? [0, w] : counts.map((_, i) => (i / (n - 1)) * w);
  const ys = (n <= 1 ? [counts[0] ?? 0, counts[0] ?? 0] : counts).map((c) => h - pad - (c / max) * (h - pad * 2));
  return xs.map((x, i) => `${round1(x)},${round1(ys[i])}`).join(' ');
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export interface TicketChip {
  /** The department (crew id). */
  id: string;
  status: DeptStatus | 'briefed';
}

export interface Ticket {
  at: number;
  /** What you asked. */
  text: string;
  chips: TicketChip[];
  reported: number;
  /** The CEO has answered after the last report: the request is closed. */
  closed: boolean;
}

/**
 * The latest request and how far it got: each department the CEO (or a department) briefed, with its report, an open
 * question of its own, or its turn. Undefined when nothing was ever asked.
 */
export function currentTicket(log: readonly CompanyEvent[], states: ReadonlyMap<string, CrewAgentState>, questions: readonly CrewQuestion[]): Ticket | undefined {
  let start = -1;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].type === 'request') {
      start = i;
      break;
    }
  }
  if (start < 0) return undefined;
  const events = log.slice(start);
  const order: string[] = [];
  const reports = new Map<string, CompanyEvent>();
  for (const e of events) {
    if (e.type === 'brief' && e.to && !order.includes(e.to)) order.push(e.to);
    if (e.type === 'report') reports.set(e.agent, e);
  }
  const open = new Set(questions.filter((q) => q.status === 'open').map((q) => q.agentId));
  const chips: TicketChip[] = order.map((id) => {
    const r = reports.get(id);
    if (r) return { id, status: r.status === 'done' || !r.status ? 'done' : 'error' };
    if (open.has(id)) return { id, status: 'waiting' };
    return { id, status: states.get(id)?.status === 'working' ? 'working' : 'briefed' };
  });
  const last = events[events.length - 1];
  const reported = chips.filter((c) => c.status === 'done' || c.status === 'error').length;
  return { at: events[0].at, text: events[0].text, chips, reported, closed: last.type === 'answer' && reported === chips.length };
}

export interface DeptLine {
  status: DeptStatus;
  /** What it is up to, in a few words. */
  what: string;
}

/** A department's (or the CEO's) status and line for the lists and the ring. */
export function deptLine(agent: CrewAgent, state: CrewAgentState | undefined, questions: readonly CrewQuestion[], ticket: Ticket | undefined, now: number): DeptLine {
  const q = questions.find((x) => x.status === 'open' && x.agentId === agent.id);
  if (q) return { status: 'waiting', what: `Needs you: ${q.text}` };
  if (state?.status === 'working') return { status: 'working', what: state.activity || 'Working' };
  if (state?.status === 'error') return { status: 'error', what: state.lastError ? `Stopped: ${state.lastError}` : 'Stopped with an error' };
  const chip = ticket && !ticket.closed ? ticket.chips.find((c) => c.id === agent.id) : undefined;
  if (chip?.status === 'done') return { status: 'done', what: 'Reported' };
  if (chip?.status === 'briefed') return { status: 'working', what: 'Briefed, in the queue' };
  if ((state?.queued ?? 0) > 0) return { status: 'working', what: 'In the queue' };
  return { status: 'idle', what: state?.lastAt ? `Standby · last turn ${ago(state.lastAt, now)}` : 'Standby' };
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

/** "$0.00", "$1.84", "$12.40". */
export function usd(v: number): string {
  return `$${(Math.round(v * 100) / 100).toFixed(2)}`;
}

/** "342 B", "12 KB", "1.4 MB". */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Longest reply read aloud; the rest stays on screen. */
export const SPEAK_MAX = 700;

/**
 * A reply as it should sound: no markdown marks, code and tables left out, links read by their text, and long
 * replies cut at a sentence with a pointer to the screen.
 */
export function speakable(markdown: string, max = SPEAK_MAX): string {
  let t = markdown
    .replace(/```[\s\S]*?```/g, ' (code on screen) ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/\s+\./g, '.')
    .replace(/(\.\s*){2,}/g, '. ')
    // a line that ended in ":" needs no full stop of its own (nor does a closing bracket at the very end)
    .replace(/([:;,])\.(?=\s|$)/g, '$1')
    .replace(/^[.\s]+/, '')
    .trim()
    .replace(/\)\.$/, ')');
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  t = (end > max * 0.4 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`).trim();
  return `${t} The rest is on screen.`;
}

/** The short label of a member on the ring and in chips: the office name tag when known, else the first word. */
export function shortName(agent: CrewAgent | undefined, member: AgentInfo | undefined, id: string): string {
  if (member?.name) return member.name;
  if (agent?.name) return agent.name.split(/[\s&]+/)[0];
  return id;
}

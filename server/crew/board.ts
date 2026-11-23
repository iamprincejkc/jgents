// The user's Q&A board: questions agents ask (ask_user) and approvals of tool calls (the permission prompt tool).
// The bridge long-polls each item (wait); the page answers it. Persisted in <dataDir>/crew/questions.json.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CrewQuestion, CrewQuestionStatus } from '../../shared/crew';

const KEEP = 200;
const PREVIEW_MAX = 1_500;

export interface BoardItem extends CrewQuestion {
  /** Run (turn) that asked. */
  runId?: string;
  /** The bridge already got the result (or gave up and the answer must go as a new message). */
  delivered?: boolean;
  /** Approvals: the tool input, to build the "always allow" rule. */
  input?: Record<string, unknown>;
}

type Waiter = (item: BoardItem) => void;

/** A readable one-liner and preview for a tool call. */
export function describeTool(tool: string, input: Record<string, unknown>): { text: string; preview: string } {
  const s = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));
  const cut = (v: string, n = PREVIEW_MAX) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return { text: `Run a command${input.description ? `: ${s(input.description)}` : ''}`, preview: cut(s(input.command)) };
    case 'Edit':
    case 'MultiEdit':
      return { text: `Edit ${s(input.file_path)}`, preview: cut(`${s(input.old_string)}\n→\n${s(input.new_string)}`) };
    case 'Write':
      return { text: `Write ${s(input.file_path)}`, preview: cut(s(input.content)) };
    case 'WebFetch':
      return { text: `Open ${s(input.url)}`, preview: cut(s(input.prompt)) };
    case 'WebSearch':
      return { text: `Search the web`, preview: cut(s(input.query)) };
    default:
      return { text: `Use ${tool}`, preview: cut(JSON.stringify(input, null, 2)) };
  }
}

/** The rule "always allow" adds: the command's first word for shells, the tool name otherwise. */
export function allowRule(tool: string, input: Record<string, unknown> | undefined): string {
  if ((tool === 'Bash' || tool === 'PowerShell') && typeof input?.command === 'string') {
    const first = input.command.trim().split(/\s+/).slice(0, input.command.trim().startsWith('npx') ? 2 : 1).join(' ');
    if (first && !/[;&|`$<>]/.test(first)) return `${tool}(${first}:*)`;
  }
  return tool;
}

export class Board {
  private items: BoardItem[] = [];
  private waiters = new Map<string, Set<Waiter>>();

  constructor(
    private readonly file: string | undefined,
    private readonly onChange: (item: BoardItem) => void,
  ) {
    this.load();
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { items?: BoardItem[] };
      // After a restart no bridge is waiting: open approvals are gone, open questions become follow-ups.
      this.items = (raw.items ?? []).map((q) => (q.status === 'open' && q.kind === 'approval' ? { ...q, status: 'expired' as const } : { ...q, delivered: q.status === 'open' ? true : q.delivered }));
    } catch {
      this.items = [];
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, items: this.items.slice(-KEEP) }));
      renameSync(tmp, this.file);
    } catch {
      // the board still works in memory
    }
  }

  list(): CrewQuestion[] {
    return this.items.map(publicItem);
  }

  get(id: string): BoardItem | undefined {
    return this.items.find((q) => q.id === id);
  }

  private add(item: BoardItem): BoardItem {
    this.items.push(item);
    if (this.items.length > KEEP * 1.5) this.items = this.items.filter((q) => q.status === 'open').concat(this.items.filter((q) => q.status !== 'open').slice(-KEEP));
    this.save();
    this.onChange(item);
    return item;
  }

  ask(agentId: string, runId: string | undefined, text: string, options: string[], context?: string): BoardItem {
    return this.add({ id: randomUUID(), at: Date.now(), agentId, runId, kind: 'question', text: text.slice(0, 4_000), options, context: context?.slice(0, 2_000), status: 'open' });
  }

  approval(agentId: string, runId: string | undefined, tool: string, input: Record<string, unknown>): BoardItem {
    const d = describeTool(tool, input);
    return this.add({ id: randomUUID(), at: Date.now(), agentId, runId, kind: 'approval', text: d.text, tool, preview: d.preview, input, status: 'open' });
  }

  /** Resolves an item; false if it is unknown or already resolved. */
  resolve(id: string, status: Exclude<CrewQuestionStatus, 'open'>, answer?: string): BoardItem | undefined {
    const q = this.get(id);
    if (!q || q.status !== 'open') return undefined;
    q.status = status;
    q.answer = answer?.slice(0, 8_000);
    q.answeredAt = Date.now();
    const ws = this.waiters.get(id);
    if (ws?.size) {
      q.delivered = true;
      for (const w of ws) w(q);
      this.waiters.delete(id);
    }
    this.save();
    this.onChange(q);
    return q;
  }

  /** Long-poll for the bridge: resolves with the item once it is answered, or as it is after `timeoutMs`. */
  wait(id: string, timeoutMs: number, signal?: AbortSignal): Promise<BoardItem | undefined> {
    const q = this.get(id);
    if (!q) return Promise.resolve(undefined);
    if (q.status !== 'open') {
      q.delivered = true;
      return Promise.resolve(q);
    }
    return new Promise((ok) => {
      const set = this.waiters.get(id) ?? new Set<Waiter>();
      this.waiters.set(id, set);
      const done = (item: BoardItem) => {
        clearTimeout(timer);
        set.delete(waiter);
        ok(item);
      };
      const waiter: Waiter = done;
      const timer = setTimeout(() => done(q), timeoutMs);
      set.add(waiter);
      signal?.addEventListener('abort', () => done(q), { once: true });
    });
  }

  /**
   * The turn that asked ended. Open approvals expire (the call is gone); open questions stay open and their answer
   * goes as a new message; answered-but-not-delivered questions are returned so the caller sends them now.
   */
  runEnded(runId: string): BoardItem[] {
    const out: BoardItem[] = [];
    for (const q of this.items) {
      if (q.runId !== runId) continue;
      if (q.status === 'open' && q.kind === 'approval') {
        q.status = 'expired';
        q.answeredAt = Date.now();
        this.onChange(q);
      } else if (q.status === 'open') {
        q.delivered = true;
      } else if (q.kind === 'question' && q.status === 'answered' && !q.delivered) {
        q.delivered = true;
        out.push(q);
      }
      this.waiters.delete(q.id);
    }
    this.save();
    return out;
  }

  /** Open items of an agent (for its "waiting" status). */
  openFor(agentId: string): number {
    return this.items.filter((q) => q.agentId === agentId && q.status === 'open').length;
  }

  /** A bridge is long-polling this item right now. */
  hasWaiter(id: string): boolean {
    return !!this.waiters.get(id)?.size;
  }

  clearResolved(): void {
    this.items = this.items.filter((q) => q.status === 'open');
    this.save();
  }
}

export function publicItem(q: BoardItem): CrewQuestion {
  const { runId: _r, delivered: _d, input: _i, ...pub } = q;
  return pub;
}

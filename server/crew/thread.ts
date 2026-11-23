// The crew chat's history: <dataDir>/crew/thread.jsonl, one finished message per line (a later line with the same id
// replaces the earlier one). Messages still streaming live only in memory until they finish.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CrewMessage } from '../../shared/crew';

const KEEP = 400;
const COMPACT_BYTES = 4 * 1024 * 1024;

export class Thread {
  private messages: CrewMessage[] = [];

  constructor(private readonly file: string | undefined) {
    this.load();
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const byId = new Map<string, CrewMessage>();
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line) as CrewMessage;
          if (m && typeof m.id === 'string') {
            if (m.id === '__cleared__') byId.clear();
            else byId.set(m.id, m);
          }
        } catch {
          // skip a torn line
        }
      }
      this.messages = [...byId.values()]
        .map((m) => (m.status === 'streaming' || m.status === 'queued' ? { ...m, status: 'stopped' as const } : m))
        .sort((a, b) => a.at - b.at)
        .slice(-KEEP);
      if (statSync(this.file).size > COMPACT_BYTES) this.compact();
    } catch {
      this.messages = [];
    }
  }

  private compact(): void {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
    renameSync(tmp, this.file);
  }

  private persist(m: CrewMessage): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(m)}\n`);
    } catch {
      // the chat still works in memory
    }
  }

  list(limit = KEEP): CrewMessage[] {
    return this.messages.slice(-limit);
  }

  get(id: string): CrewMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) if (this.messages[i].id === id) return this.messages[i];
    return undefined;
  }

  /** Adds or replaces a message; `final` writes it to disk. */
  put(m: CrewMessage, final = true): CrewMessage {
    const i = this.messages.findIndex((x) => x.id === m.id);
    if (i >= 0) this.messages[i] = m;
    else {
      this.messages.push(m);
      if (this.messages.length > KEEP * 1.25) this.messages = this.messages.slice(-KEEP);
    }
    if (final) this.persist(m);
    return m;
  }

  clear(): void {
    this.messages = this.messages.filter((m) => m.status === 'streaming' || m.status === 'queued');
    this.persist({ id: '__cleared__', at: Date.now(), kind: 'system', text: '' });
    for (const m of this.messages) this.persist(m);
  }

  /** The last user requests and who got them (for the router). */
  recent(n = 6): { agentId: string; user: string }[] {
    const out: { agentId: string; user: string }[] = [];
    for (const m of this.messages) {
      if (m.kind === 'user' && m.agentId) out.push({ agentId: m.agentId, user: m.text });
      if (m.kind === 'router' && m.targets?.length && m.replyTo) {
        const u = this.get(m.replyTo);
        if (u) out.push({ agentId: m.targets[0], user: u.text });
      }
    }
    return out.slice(-n);
  }
}

// Your Claude Code sessions in an agent's folder, so an agent can start from one (continue it, or fork a copy).
// Claude Code keeps each session at <config>/projects/<folder with every non-alphanumeric char as "-">/<id>.jsonl and
// registers the open ones in <config>/sessions/<pid>.json. Read-only.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { CrewSession } from '../../shared/crew';
import { encodeCwd } from '../sources/watcher';

const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 256 * 1024;
const TITLE_MAX = 90;
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readSlice(file: string, from: number, len: number): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const n = readSync(fd, buf, 0, len, from);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function cut(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > TITLE_MAX ? `${one.slice(0, TITLE_MAX - 1)}…` : one;
}

/** The session's title: the last /rename or AI title, else its first real request. Exported for tests. */
export function sessionTitle(head: string, tail: string): string {
  let title = '';
  for (const line of tail.split('\n')) {
    const m = /"type":"(?:custom-title|ai-title|summary)"/.test(line) ? line : '';
    if (!m) continue;
    try {
      const o = JSON.parse(line) as { customTitle?: string; aiTitle?: string; title?: string; summary?: string };
      title = o.customTitle || o.aiTitle || o.title || o.summary || title;
    } catch {
      // torn line at the edge of the slice
    }
  }
  if (title) return cut(title);
  for (const line of head.split('\n')) {
    if (!line.includes('"type":"user"')) continue;
    try {
      const o = JSON.parse(line) as { isMeta?: boolean; message?: { content?: unknown } };
      if (o.isMeta) continue;
      const c = o.message?.content;
      const text =
        typeof c === 'string'
          ? c
          : Array.isArray(c)
            ? ((c as { type?: string; text?: string }[]).find((b) => b.type === 'text')?.text ?? '')
            : '';
      if (text && !text.trimStart().startsWith('<')) return cut(text);
    } catch {
      // ignore
    }
  }
  return '(untitled session)';
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Ids of the sessions open right now (registered by a live Claude Code process). */
export function openSessionIds(claudeDirs: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const dir of claudeDirs) {
    const reg = join(dir, 'sessions');
    let names: string[] = [];
    try {
      names = readdirSync(reg).filter((n) => n.endsWith('.json'));
    } catch {
      continue;
    }
    for (const n of names) {
      try {
        const s = JSON.parse(readFileSync(join(reg, n), 'utf8')) as { pid?: number; sessionId?: string };
        const pid = Number(s.pid ?? basename(n, '.json'));
        if (s.sessionId && Number.isInteger(pid) && alive(pid)) out.add(s.sessionId);
      } catch {
        // half-written file
      }
    }
  }
  return out;
}

/** The sessions of `folder`, newest first. */
export function listSessions(claudeDirs: readonly string[], folder: string, limit = 20): CrewSession[] {
  const encoded = encodeCwd(folder.replace(/[\\/]+$/, ''));
  const open = openSessionIds(claudeDirs);
  const found: { id: string; at: number; file: string; size: number; account: string }[] = [];
  for (const dir of claudeDirs) {
    const pdir = join(dir, 'projects', encoded);
    if (!existsSync(pdir)) continue;
    for (const n of readdirSync(pdir)) {
      if (!n.endsWith('.jsonl') || !SESSION_ID_RE.test(n.slice(0, -6))) continue;
      try {
        const st = statSync(join(pdir, n));
        if (st.size > 0) found.push({ id: n.slice(0, -6), at: st.mtimeMs, file: join(pdir, n), size: st.size, account: basename(dir) });
      } catch {
        // vanished
      }
    }
  }
  found.sort((a, b) => b.at - a.at);
  return found.slice(0, limit).map((f) => {
    let title = '(untitled session)';
    try {
      const head = readSlice(f.file, 0, Math.min(HEAD_BYTES, f.size));
      const tail = f.size > HEAD_BYTES ? readSlice(f.file, Math.max(0, f.size - TAIL_BYTES), Math.min(TAIL_BYTES, f.size)) : head;
      title = sessionTitle(head, tail);
    } catch {
      // unreadable: keep the placeholder
    }
    return { id: f.id, at: Math.round(f.at), title, open: open.has(f.id), account: f.account, folder };
  });
}

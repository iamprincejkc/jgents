// One turn of a Crew agent: `claude -p` (headless Claude Code) in the agent's folder, resuming its session, with the
// JGENTS bridge (mod/jgents-crew/mcp.mjs) as MCP server and permission prompt tool. The prompt goes on stdin (never
// on the command line); the reply comes back as stream-json, parsed here into callbacks.
import { spawn as nodeSpawn, execFile, type ChildProcess } from 'node:child_process';

export interface TurnSpec {
  bin: string;
  cwd: string;
  prompt: string;
  systemPrompt: string;
  mcpConfigFile: string;
  sessionId?: string;
  /** Start from a copy of sessionId (the original session stays as it is). */
  forkSession?: boolean;
  /** More folders the agent may work in (--add-dir). */
  addDirs?: string[];
  model?: string;
  permissionMode?: string;
  allowedTools: string[];
  env: NodeJS.ProcessEnv;
}

export interface TurnResult {
  ok: boolean;
  sessionId?: string;
  text: string;
  costUsd?: number;
  durationMs?: number;
  error?: string;
  /** --resume pointed to a session Claude Code no longer has. */
  sessionMissing?: boolean;
  stopped?: boolean;
}

export interface TurnCallbacks {
  onSession?(sessionId: string): void;
  /** A new text block starts (separates text around tool calls). */
  onTextStart?(): void;
  onText?(delta: string): void;
  onToolStart?(id: string, name: string, input: Record<string, unknown>): void;
  onToolEnd?(id: string, isError: boolean): void;
}

export type Spawner = (bin: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;

export const defaultSpawner: Spawner = (bin, args, opts) =>
  nodeSpawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });

/** Kills the turn and everything it started (tools, MCP servers). */
export function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

export function turnArgs(spec: TurnSpec): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--append-system-prompt',
    spec.systemPrompt,
    '--mcp-config',
    spec.mcpConfigFile,
    '--permission-prompt-tool',
    'mcp__jgents__approve',
    '--disallowedTools',
    'AskUserQuestion',
  ];
  if (spec.permissionMode && spec.permissionMode !== 'ask') args.push('--permission-mode', spec.permissionMode);
  if (spec.model) args.push('--model', spec.model);
  if (spec.sessionId) args.push('--resume', spec.sessionId);
  if (spec.sessionId && spec.forkSession) args.push('--fork-session');
  for (const dir of spec.addDirs ?? []) args.push('--add-dir', dir);
  args.push('--allowedTools', ...spec.allowedTools);
  return args;
}

/**
 * Variables a parent Claude Code session leaves in the environment (when JGENTS itself was started from one): a
 * child that inherits them tries to use the parent's auth and messaging socket and fails. ANTHROPIC_BASE_URL goes
 * too when it is the parent's proxy (set together with the SDK host markers).
 */
export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  const hostProxy = !!(env.CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH || env.CLAUDE_CODE_MESSAGING_SOCKET);
  for (const [k, v] of Object.entries(env)) {
    if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT') continue;
    if (/^CLAUDE_CODE_(?!USE_BEDROCK|USE_VERTEX|USE_FOUNDRY|GIT_BASH_PATH|MAX_OUTPUT_TOKENS|DISABLE_NONESSENTIAL)/.test(k)) continue;
    if (/^CLAUDE_AGENT_SDK_|^CLAUDE_PREVIEW_/.test(k)) continue;
    if (k === 'ANTHROPIC_BASE_URL' && hostProxy) continue;
    out[k] = v;
  }
  return out;
}

interface StreamState {
  sessionId?: string;
  /** Message ids whose text already came as partial deltas (the full message repeats it). */
  streamed: Set<string>;
  current?: string;
  textParts: string[];
  result?: TurnResult;
  openTools: Set<string>;
}

/** Handles one stream-json line. Exported for tests. */
export function handleLine(line: string, st: StreamState, cb: TurnCallbacks): void {
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  const type = ev.type;
  if (typeof ev.session_id === 'string' && ev.session_id !== st.sessionId) {
    st.sessionId = ev.session_id;
    cb.onSession?.(ev.session_id);
  }
  if (type === 'stream_event') {
    const e = ev.event as Record<string, unknown> | undefined;
    if (!e) return;
    if (e.type === 'message_start') {
      st.current = ((e.message as Record<string, unknown> | undefined)?.id as string | undefined) ?? undefined;
    } else if (e.type === 'content_block_start') {
      const block = e.content_block as Record<string, unknown> | undefined;
      if (block?.type === 'text') {
        if (st.current) st.streamed.add(st.current);
        st.textParts.push('');
        cb.onTextStart?.();
      }
    } else if (e.type === 'content_block_delta') {
      const d = e.delta as Record<string, unknown> | undefined;
      if (d?.type === 'text_delta' && typeof d.text === 'string') {
        if (!st.textParts.length) {
          st.textParts.push('');
          cb.onTextStart?.();
        }
        st.textParts[st.textParts.length - 1] += d.text;
        cb.onText?.(d.text);
      }
    }
    return;
  }
  if (type === 'assistant') {
    const msg = ev.message as Record<string, unknown> | undefined;
    const id = typeof msg?.id === 'string' ? msg.id : undefined;
    const content = Array.isArray(msg?.content) ? (msg.content as Record<string, unknown>[]) : [];
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string' && !(id && st.streamed.has(id))) {
        st.textParts.push(block.text);
        cb.onTextStart?.();
        cb.onText?.(block.text);
      } else if (block.type === 'tool_use' && typeof block.id === 'string' && !st.openTools.has(block.id)) {
        st.openTools.add(block.id);
        cb.onToolStart?.(block.id, String(block.name ?? 'tool'), (block.input as Record<string, unknown>) ?? {});
      }
    }
    return;
  }
  if (type === 'user') {
    const msg = ev.message as Record<string, unknown> | undefined;
    const content = Array.isArray(msg?.content) ? (msg.content as Record<string, unknown>[]) : [];
    for (const block of content) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        st.openTools.delete(block.tool_use_id);
        cb.onToolEnd?.(block.tool_use_id, block.is_error === true);
      }
    }
    return;
  }
  if (type === 'result') {
    const text = st.textParts.join('\n\n').trim() || (typeof ev.result === 'string' ? ev.result : '');
    const isError = ev.is_error === true || (typeof ev.subtype === 'string' && ev.subtype.startsWith('error'));
    const errors = Array.isArray(ev.errors) ? (ev.errors as unknown[]).map(String).join('; ') : '';
    st.result = {
      ok: !isError,
      sessionId: st.sessionId,
      text,
      costUsd: typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : undefined,
      durationMs: typeof ev.duration_ms === 'number' ? ev.duration_ms : undefined,
      error: isError ? errors || (typeof ev.result === 'string' ? ev.result : String(ev.subtype ?? 'error')) : undefined,
    };
  }
}

export interface RunningTurn {
  done: Promise<TurnResult>;
  stop(): void;
}

const STDERR_MAX = 4_000;

export function runTurn(spec: TurnSpec, cb: TurnCallbacks, spawner: Spawner = defaultSpawner): RunningTurn {
  const st: StreamState = { streamed: new Set(), textParts: [], openTools: new Set() };
  let stopped = false;
  let child: ChildProcess;
  try {
    child = spawner(spec.bin, turnArgs(spec), { cwd: spec.cwd, env: spec.env });
  } catch (err) {
    return { done: Promise.resolve({ ok: false, text: '', error: `could not start Claude Code: ${String((err as Error)?.message ?? err)}` }), stop: () => undefined };
  }
  const done = new Promise<TurnResult>((resolve) => {
    let buf = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) handleLine(line, st, cb);
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < STDERR_MAX) stderr += chunk;
    });
    child.on('error', (err) => {
      resolve({ ok: false, text: st.textParts.join('\n\n').trim(), error: `could not start Claude Code: ${err.message}` });
    });
    child.on('close', (code) => {
      if (buf.trim()) handleLine(buf.trim(), st, cb);
      for (const id of st.openTools) cb.onToolEnd?.(id, true);
      st.openTools.clear();
      const missing = /No conversation found|session .* not found|--resume.*not found/i.test(stderr + (st.result?.error ?? ''));
      if (stopped) return resolve({ ok: false, stopped: true, sessionId: st.sessionId, text: st.textParts.join('\n\n').trim(), error: 'stopped' });
      if (st.result) return resolve({ ...st.result, sessionMissing: missing && !st.result.ok });
      const line = stderr.split('\n').map((l) => l.trim()).find(Boolean);
      resolve({
        ok: false,
        sessionId: st.sessionId,
        text: st.textParts.join('\n\n').trim(),
        sessionMissing: missing,
        error: line ? line.slice(0, 400) : `Claude Code exited with code ${code}`,
      });
    });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(spec.prompt);
  });
  return {
    done,
    stop: () => {
      stopped = true;
      killTree(child);
    },
  };
}

// /api/crew/* — the crew chat page and the agents' bridge.
//
// Page (only from this computer: loopback Host, never through the remote port):
//   GET    /api/crew                     CrewSnapshot
//   GET    /api/crew/summary             {enabled, open, working, agents} (the office's Crew button)
//   GET    /api/crew/stream              SSE: snapshot, message, delta, state, question, agents, cleared
//   POST   /api/crew/chat                {text, agent?} → 201 CrewMessage (the user's message; routing follows)
//   DELETE /api/crew/messages            clears the chat history
//   POST   /api/crew/agents              create an agent → 201 CrewAgent
//   PUT    /api/crew/agents/:id          update it;  DELETE removes it
//   POST   /api/crew/agents/:id/stop     stops its turn and queue
//   POST   /api/crew/agents/:id/reset    next request starts a fresh conversation
//   GET    /api/crew/agents/:id/tools    CrewToolCheck[]
//   GET    /api/crew/folders             folder suggestions (recent projects)
//   GET    /api/crew/sessions?folder=&agent=   CrewSession[]: your Claude Code sessions in that folder
//   POST   /api/crew/agents/:id/session  {sessionId, mode: resume|fork}: start the agent from one of them
//   POST   /api/crew/questions/:id       {action: answer|dismiss|allow|deny, answer?, always?}
// Bridge (mod/jgents-crew/mcp.mjs; loopback + X-JGENTS-Crew-Token):
//   POST   /api/crew/bridge/ask | /approve | /handoff,  GET /api/crew/bridge/item/:id/wait?timeout=<s>
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { CrewEvents } from '../../shared/crew';
import { isLoopbackHost } from '../http/guard';
import { HttpError, readJson, sendJson } from '../http/app';
import type { CrewService } from './service';

const MAX_CLIENTS = 16;
const PING_MS = 15_000;
const MAX_BUFFERED = 8 * 1024 * 1024;

export interface CrewRouteDeps {
  crew?: CrewService;
  /** Why the crew is off when `crew` is undefined. */
  offReason: string;
  isRemote: (req: IncomingMessage) => boolean;
  folders: () => Promise<{ path: string }[]>;
}

function tokenOk(got: unknown, want: string): boolean {
  if (typeof got !== 'string' || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export function createCrewHandler(deps: CrewRouteDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => boolean {
  const clients = new Set<ServerResponse>();
  const crew = deps.crew;
  if (crew) {
    crew.subscribe(<K extends keyof CrewEvents>(event: K, data: CrewEvents[K]) => {
      const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const c of clients) {
        if (c.writableLength > MAX_BUFFERED) c.destroy();
        else c.write(frame);
      }
    });
    setInterval(() => {
      for (const c of clients) c.write(': ping\n\n');
    }, PING_MS).unref?.();
  }

  const fail = (res: ServerResponse, err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: 'internal error' });
  };

  const body = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const b = await readJson(req, 512 * 1024);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'expected a JSON object');
    return b as Record<string, unknown>;
  };

  const bridge = async (req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string, c: CrewService) => {
    if (!tokenOk(req.headers['x-jgents-crew-token'], c.token)) {
      req.resume();
      return sendJson(res, 403, { error: 'bad crew token' });
    }
    const rest = path.slice('/api/crew/bridge'.length);
    if (method === 'POST' && (rest === '/ask' || rest === '/approve' || rest === '/handoff')) {
      const b = await body(req);
      const r = rest === '/ask' ? c.bridgeAsk(b) : rest === '/approve' ? c.bridgeApprove(b) : c.bridgeHandoff(b);
      return sendJson(res, 'error' in r ? 400 : 201, r);
    }
    const m = /^\/item\/([\w-]{1,64})\/wait$/.exec(rest);
    if (m && method === 'GET') {
      const s = Math.min(60, Math.max(1, Number(url.searchParams.get('timeout')) || 25));
      const ac = new AbortController();
      const abort = () => ac.abort();
      res.once('close', abort);
      try {
        const r = await c.bridgeWait(m[1], s * 1000, ac.signal);
        if (ac.signal.aborted) return;
        return r ? sendJson(res, 200, r) : sendJson(res, 404, { error: 'unknown item' });
      } finally {
        res.off('close', abort);
      }
    }
    req.resume();
    sendJson(res, 404, { error: 'unknown bridge route' });
  };

  const page = async (req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string, c: CrewService) => {
    const isRead = method === 'GET' || method === 'HEAD';
    if (path === '/api/crew' && isRead) return sendJson(res, 200, c.snapshot());
    if (path === '/api/crew/summary' && isRead) return sendJson(res, 200, c.summary());
    if (path === '/api/crew/stream' && method === 'GET') {
      if (clients.size >= MAX_CLIENTS) return sendJson(res, 429, { error: 'too many crew tabs open' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`retry: 2000\nevent: snapshot\ndata: ${JSON.stringify(c.snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (path === '/api/crew/chat' && method === 'POST') {
      const b = await body(req);
      const r = c.chat(typeof b.text === 'string' ? b.text : '', typeof b.agent === 'string' && b.agent ? b.agent : undefined);
      return sendJson(res, 'error' in r ? 400 : 201, r);
    }
    if (path === '/api/crew/messages' && method === 'DELETE') {
      req.resume();
      c.clearChat();
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/crew/folders' && isRead) {
      const folders = await deps.folders().catch(() => []);
      return sendJson(res, 200, { folders: folders.map((f) => f.path) });
    }
    if (path === '/api/crew/sessions' && isRead) {
      const folders = url.searchParams.getAll('folder').map((f) => f.trim()).filter(Boolean).slice(0, 9);
      if (!folders.length) throw new HttpError(400, 'folder is required');
      return sendJson(res, 200, { sessions: c.sessions(folders, url.searchParams.get('agent') ?? undefined) });
    }
    if (path === '/api/crew/agents' && method === 'POST') {
      const r = c.createAgent(await body(req));
      return sendJson(res, 'error' in r ? 400 : 201, r);
    }
    const am = /^\/api\/crew\/agents\/([a-z0-9-]{1,24})(\/(stop|reset|tools|session))?$/.exec(path);
    if (am) {
      const [, id, , action] = am;
      if (!action && method === 'PUT') {
        const r = c.updateAgent(id, await body(req));
        if (!r) return sendJson(res, 404, { error: 'unknown agent' });
        return sendJson(res, 'error' in r ? 400 : 200, r);
      }
      if (!action && method === 'DELETE') {
        req.resume();
        return c.removeAgent(id) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'unknown agent' });
      }
      if (action === 'tools' && isRead) {
        const t = c.tools(id);
        return t ? sendJson(res, 200, { tools: t }) : sendJson(res, 404, { error: 'unknown agent' });
      }
      if (action === 'session' && method === 'POST') {
        const b = await body(req);
        const mode = b.mode === 'fork' ? 'fork' : b.mode === 'resume' ? 'resume' : undefined;
        if (!mode || typeof b.sessionId !== 'string') throw new HttpError(400, 'expected {sessionId, mode: resume|fork}');
        const r = c.adoptSession(id, b.sessionId, mode);
        return 'error' in r ? sendJson(res, r.status, { error: r.error }) : sendJson(res, 200, r);
      }
      if ((action === 'stop' || action === 'reset') && method === 'POST') {
        await body(req).catch(() => ({}));
        const ok = action === 'stop' ? (c.stop(id), true) : c.reset(id);
        return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'unknown agent' });
      }
    }
    const qm = /^\/api\/crew\/questions\/([\w-]{1,64})$/.exec(path);
    if (qm && method === 'POST') {
      const b = await body(req);
      const action = b.action;
      if (action !== 'answer' && action !== 'dismiss' && action !== 'allow' && action !== 'deny') throw new HttpError(400, 'action must be answer, dismiss, allow or deny');
      const r = c.answer(qm[1], { action, answer: typeof b.answer === 'string' ? b.answer : undefined, always: b.always === true });
      return 'error' in r ? sendJson(res, r.status, { error: r.error }) : sendJson(res, 200, r);
    }
    req.resume();
    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    sendJson(res, 405, { error: 'method not allowed' });
  };

  return (req, res, url) => {
    const path = url.pathname;
    if (path === '/crew' || path === '/crew/') {
      res.writeHead(302, { Location: '/crew.html' });
      res.end();
      return true;
    }
    if (path !== '/api/crew' && !path.startsWith('/api/crew/')) return false;
    const method = req.method ?? 'GET';
    if (deps.isRemote(req) || !isLoopbackHost(req.headers.host)) {
      req.resume();
      sendJson(res, 403, { error: 'the crew only opens on this computer (http://localhost)' });
      return true;
    }
    if (!crew) {
      req.resume();
      if (path === '/api/crew' || path === '/api/crew/summary') sendJson(res, 200, { enabled: false, reason: deps.offReason, agents: [], states: [], messages: [], questions: [], routerModel: '' });
      else sendJson(res, 403, { error: `the crew is off: ${deps.offReason}` });
      return true;
    }
    const run = path.startsWith('/api/crew/bridge/') ? bridge(req, res, url, path, method, crew) : page(req, res, url, path, method, crew);
    run.catch((err) => fail(res, err));
    return true;
  };
}

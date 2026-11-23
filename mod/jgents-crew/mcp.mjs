#!/usr/bin/env node
// JGENTS Crew bridge: a tiny MCP server (stdio, JSON-RPC, one message per line) that every Crew agent session
// loads through --mcp-config. It gives the agent three tools that talk to the local JGENTS:
//
// - ask_user   puts a question on the user's Q&A board and waits for the answer (up to JGENTS_CREW_ASK_WAIT_S,
//              default 30 min). No answer in time: the tool says so, the agent ends its turn, and the answer reaches
//              it later as a new message.
// - approve    the --permission-prompt-tool: each tool call that needs permission becomes an approval card on the
//              board; returns {"behavior":"allow","updatedInput":...} or {"behavior":"deny","message":...}.
// - handoff    gives a task to another Crew agent (it runs in that agent's own session, in parallel).
//
// Pure Node 22+, no dependencies. Talks only to 127.0.0.1:<JGENTS_PORT>, authenticated with JGENTS_CREW_TOKEN (a
// random secret JGENTS creates at boot). Any error is returned to the agent as tool text; the server never crashes
// the session.
import { createInterface } from 'node:readline';

const PORT = Number.parseInt(process.env.JGENTS_PORT ?? '', 10) || 4747;
const TOKEN = process.env.JGENTS_CREW_TOKEN ?? '';
const AGENT = process.env.JGENTS_CREW_AGENT ?? '';
const RUN = process.env.JGENTS_CREW_RUN ?? '';
const ASK_WAIT_S = clamp(Number(process.env.JGENTS_CREW_ASK_WAIT_S ?? ''), 10, 86_400, 1_800);
const APPROVE_WAIT_S = clamp(Number(process.env.JGENTS_CREW_APPROVE_WAIT_S ?? ''), 10, 86_400, 3_600);
const POLL_S = 25;
const BASE = `http://127.0.0.1:${PORT}/api/crew/bridge`;

function clamp(n, min, max, fallback) {
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : fallback;
}

const TOOLS = [
  {
    name: 'ask_user',
    description:
      'Ask the user (your human lead) a question on their JGENTS Q&A board and wait for the answer. Use it whenever ' +
      'you need a decision, a missing detail, credentials they must enter themselves, or a go-ahead for something ' +
      'risky. Give 2-4 short options when the answer is a choice. Never guess instead of asking.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question, self-contained (the user may read it hours later).' },
        options: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'Optional short answers to pick from.' },
        context: { type: 'string', description: 'Optional: one or two sentences of background.' },
      },
      required: ['question'],
    },
  },
  {
    name: 'approve',
    description: 'Permission prompt handler used by JGENTS. Do not call this tool yourself.',
    inputSchema: {
      type: 'object',
      properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
      required: ['tool_name', 'input'],
    },
  },
  {
    name: 'handoff',
    description:
      'Hand a task to another agent of the crew (see the crew list in your instructions). It runs in that agent\'s ' +
      'own session and folder, in parallel; you do not get the result back automatically, the user sees it in the ' +
      'crew chat. Write the task so it stands on its own.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'The id of the agent to hand off to.' },
        task: { type: 'string', description: 'What that agent should do, with all needed context.' },
      },
      required: ['agent', 'task'],
    },
  },
];

async function call(path, body, timeoutMs = 30_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-jgents-crew-token': TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `JGENTS answered ${res.status}`);
    return data;
  } finally {
    clearTimeout(t);
  }
}

/** Long-polls /item/:id/wait until it is resolved or the deadline passes. */
async function waitFor(id, totalS) {
  const deadline = Date.now() + totalS * 1000;
  for (;;) {
    const left = Math.ceil((deadline - Date.now()) / 1000);
    if (left <= 0) return { status: 'pending' };
    const wait = Math.min(POLL_S, left);
    const r = await call(`/item/${encodeURIComponent(id)}/wait?timeout=${wait}`, undefined, (wait + 10) * 1000).catch((err) => ({
      status: 'error',
      error: String(err?.message ?? err),
    }));
    if (r.status === 'error') {
      await new Promise((ok) => setTimeout(ok, 2_000));
      continue;
    }
    if (r.status !== 'pending') return r;
  }
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });

async function askUser(args) {
  const question = String(args?.question ?? '').trim();
  if (!question) return { ...text('ask_user needs a question.'), isError: true };
  const options = Array.isArray(args?.options) ? args.options.map(String).filter(Boolean).slice(0, 6) : [];
  const created = await call('/ask', { agent: AGENT, run: RUN, question, options, context: args?.context ? String(args.context) : undefined });
  const r = await waitFor(created.id, ASK_WAIT_S);
  if (r.status === 'answered') return text(`The user answered: ${r.answer}`);
  if (r.status === 'dismissed') return text('The user dismissed this question without answering. Decide sensibly or stop and report.');
  return text(
    'The user has not answered yet. The question stays on their Q&A board. End your turn now with a short status ' +
      '(what you did, what is blocked); their answer will arrive as your next message.',
  );
}

async function approve(args) {
  const tool = String(args?.tool_name ?? '');
  const input = args?.input && typeof args.input === 'object' ? args.input : {};
  try {
    const created = await call('/approve', { agent: AGENT, run: RUN, tool, input });
    const r = created.status && created.status !== 'pending' ? created : await waitFor(created.id, APPROVE_WAIT_S);
    if (r.status === 'allowed') return text(JSON.stringify({ behavior: 'allow', updatedInput: input }));
    const why = r.status === 'denied' ? r.message || 'The user denied this.' : 'No answer from the user in time.';
    return text(JSON.stringify({ behavior: 'deny', message: why }));
  } catch (err) {
    return text(JSON.stringify({ behavior: 'deny', message: `JGENTS could not ask the user: ${err?.message ?? err}` }));
  }
}

async function handoff(args) {
  const agent = String(args?.agent ?? '').trim();
  const task = String(args?.task ?? '').trim();
  if (!agent || !task) return { ...text('handoff needs agent and task.'), isError: true };
  const r = await call('/handoff', { from: AGENT, run: RUN, agent, task });
  return text(`Handed off to ${r.name ?? agent}. It is working on it in its own session.`);
}

const HANDLERS = { ask_user: askUser, approve, handoff };

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'jgents', version: '1.0.0' },
      },
    });
  }
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/call') {
    const fn = HANDLERS[params?.name];
    if (!fn) return send({ jsonrpc: '2.0', id, result: { ...text(`Unknown tool ${params?.name}`), isError: true } });
    try {
      return send({ jsonrpc: '2.0', id, result: await fn(params?.arguments ?? {}) });
    } catch (err) {
      return send({ jsonrpc: '2.0', id, result: { ...text(`JGENTS error: ${err?.message ?? err}`), isError: true } });
    }
  }
  if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  void handle(msg);
});
rl.on('close', () => process.exit(0));

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crewSlug, parseMentions, suggestLegend, type CrewAgent, type CrewEvents } from '../../shared/crew';
import { allowRule, describeTool } from './board';
import { createCrewHandler } from './http';
import { defaultAgents, parseAgent } from './roster';
import { parseRouterAnswer, route, scoreAgents } from './router';
import { cleanEnv, handleLine, turnArgs } from './runner';
import { CrewService, ruleAllows, systemPrompt, toolLabel } from './service';

const BRIDGE = resolve(__dirname, '../../mod/jgents-crew/mcp.mjs');

/** A `claude -p` stand-in: answers in stream-json, resumes the session it is given, and fails on "boom". */
const FAKE = `
const args = process.argv.slice(2);
const i = args.indexOf('--resume');
const session = i >= 0 ? args[i + 1] : 'sess-' + Math.random().toString(36).slice(2, 8);
let prompt = '';
process.stdin.on('data', (c) => (prompt += c));
process.stdin.on('end', () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  if (prompt.includes('missing-session') && i >= 0) { process.stderr.write('No conversation found with session ID: ' + session + '\\n'); process.exit(1); }
  out({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd() });
  out({ type: 'stream_event', session_id: session, event: { type: 'message_start', message: { id: 'm1' } } });
  out({ type: 'stream_event', session_id: session, event: { type: 'content_block_start', content_block: { type: 'text' } } });
  out({ type: 'stream_event', session_id: session, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Working on: ' } } });
  out({ type: 'stream_event', session_id: session, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: prompt.slice(0, 40) } } });
  out({ type: 'assistant', session_id: session, message: { id: 'm1', content: [{ type: 'text', text: 'Working on: ' + prompt.slice(0, 40) }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } });
  out({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false }] } });
  if (prompt.includes('boom')) { out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: session, errors: ['it broke'] }); process.exit(1); }
  const wait = prompt.includes('slow') ? 400 : 0;
  setTimeout(() => {
    out({ type: 'result', subtype: 'success', is_error: false, session_id: session, result: 'done', total_cost_usd: 0.01, duration_ms: 1200 });
    process.exit(0);
  }, wait);
});
`;

let dir: string;
let fake: string;
const spawned: string[][] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jgents-crew-'));
  fake = join(dir, 'fake-claude.mjs');
  writeFileSync(fake, FAKE);
  spawned.length = 0;
});
// Windows keeps a folder locked for a moment after a child process that ran in it exits.
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch {
    // left in the temp folder
  }
});

function service(over: Partial<ConstructorParameters<typeof CrewService>[0]> = {}): CrewService {
  return new CrewService({
    dataDir: dir,
    port: 1,
    claudeBin: 'claude',
    bridgeScript: BRIDGE,
    nodeBin: process.execPath,
    env: { PATH: process.env.PATH },
    classify: async () => undefined,
    spawner: (_bin, args, opts) => {
      spawned.push(args);
      return spawn(process.execPath, [fake, ...args], { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    },
    ...over,
  });
}

function until<T>(fn: () => T | undefined, ms = 8_000): Promise<T> {
  const t0 = Date.now();
  return new Promise((ok, fail) => {
    const tick = () => {
      const v = fn();
      if (v) return ok(v);
      if (Date.now() - t0 > ms) return fail(new Error('timed out'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

const agent = (p: Partial<CrewAgent>): CrewAgent => ({
  id: 'x',
  name: 'X',
  role: '',
  description: '',
  keywords: [],
  emoji: '🤖',
  color: '#000000',
  kind: 'project',
  folder: '/tmp/x',
  instructions: '',
  model: '',
  permissionMode: 'ask',
  allowedTools: [],
  extraFolders: [],
  ...p,
});

describe('shared crew helpers', () => {
  it('slugs names and reads @mentions', () => {
    expect(crewSlug('IBC Gen5!')).toBe('ibc-gen5');
    const agents = [agent({ id: 'ho-oh', name: 'Ho-Oh' }), agent({ id: 'giratina', name: 'Giratina' })];
    expect(parseMentions('@ho-oh @Giratina make a promo', agents)).toEqual({ ids: ['ho-oh', 'giratina'], rest: 'make a promo' });
    expect(parseMentions('ask @ho-oh later', agents).ids).toEqual(['ho-oh']);
    expect(parseMentions('email me@example.com', agents).ids).toEqual([]);
  });

  it('suggests a free legendary Pokémon that fits the job', () => {
    expect(suggestLegend('general', [])?.name).toBe('Arceus');
    expect(suggestLegend('video', [])?.name).toBe('Ho-Oh');
    expect(suggestLegend('security', [])?.name).toBe('Giratina');
    expect(suggestLegend('project', [])?.name).toBe('Dialga');
    expect(suggestLegend('project', ['Dialga'])?.name).toBe('Palkia');
    expect(crewSlug('Ho-Oh')).toBe('ho-oh');
  });

  it('starts with Arceus, Ho-Oh and Giratina', () => {
    expect(defaultAgents('/data').map((a) => a.id)).toEqual(['arceus', 'ho-oh', 'giratina']);
  });
});

describe('roster', () => {
  it('validates new agents', () => {
    expect(parseAgent({ name: '' }, undefined, new Set())).toEqual({ error: 'give the agent a name' });
    expect(parseAgent({ name: 'Palkia', folder: 'relative/path' }, undefined, new Set())).toHaveProperty('error');
    const a = parseAgent(
      { name: 'Palkia', folder: 'C:\\Projects\\Jet\\API', extraFolders: 'C:\\Projects\\Jet\\UI\nC:\\Projects\\Jet\\API', keywords: 'jet, logistics', kind: 'project' },
      undefined,
      new Set(['palkia']),
    );
    expect(a).toMatchObject({ id: 'palkia-2', keywords: ['jet', 'logistics'], extraFolders: ['C:\\Projects\\Jet\\UI'], emoji: '🧑‍💻', permissionMode: 'acceptEdits' });
    expect(parseAgent({ name: 'Palkia', folder: '/x', extraFolders: ['ui'] }, undefined, new Set())).toEqual({ error: '"ui" is not an absolute path' });
    expect(parseAgent({ id: 'palkia', name: 'Palkia', folder: '/x' }, undefined, new Set(['palkia']))).toEqual({ error: '@palkia is already taken' });
  });
});

describe('router', () => {
  const crew = [
    agent({ id: 'arceus', name: 'Arceus', kind: 'general' }),
    agent({ id: 'ho-oh', name: 'Ho-Oh', kind: 'video', keywords: ['video', 'promo'] }),
    agent({ id: 'dialga', name: 'Dialga', folder: 'C:\\Projects\\REVAMP\\IBCAuto.Api', extraFolders: ['C:\\Projects\\IBC\\Project.Monalisa'], keywords: ['ibc'] }),
    agent({ id: 'palkia', name: 'Palkia', folder: 'C:\\Projects\\REVAMP\\JetLogistics.API.v2', extraFolders: ['C:\\Projects\\REVAMP\\JetLogistics.UI.v2'] }),
  ];

  it('honours picks and mentions without asking a model', async () => {
    let asked = 0;
    const classify = async () => (asked++, undefined);
    expect(await route('fix it', crew, { picked: 'palkia', classify })).toMatchObject({ via: 'picked', assignments: [{ agentId: 'palkia' }] });
    expect(await route('@ho-oh teaser please', crew, { classify })).toMatchObject({ via: 'mention', assignments: [{ agentId: 'ho-oh', task: 'teaser please' }] });
    expect(asked).toBe(0);
  });

  it('uses the model answer, keeping the request verbatim for one agent', async () => {
    const r = await route('the jet api is slow', crew, { classify: async () => 'Sure: {"assignments":[{"agent":"palkia","task":"x","reason":"Jet backend"}]}' });
    expect(r).toEqual({ via: 'llm', assignments: [{ agentId: 'palkia', task: 'the jet api is slow', reason: 'Jet backend' }] });
    expect(parseRouterAnswer('{"assignments":[{"agent":"nobody"}]}', crew, 't')).toEqual([]);
  });

  it('falls back to keywords, then to the last agent or the general one', async () => {
    expect(scoreAgents('add a filter to JetLogistics', crew)[0].id).toBe('palkia');
    expect(scoreAgents('the monalisa screen is broken', crew)[0].id).toBe('dialga');
    expect(await route('make a promo video', crew, {})).toMatchObject({ via: 'keywords', assignments: [{ agentId: 'ho-oh' }] });
    expect(await route('yes go ahead', crew, { recent: [{ agentId: 'dialga', user: 'fix ibc' }] })).toMatchObject({ assignments: [{ agentId: 'dialga' }] });
    expect(await route('hello there', crew, {})).toMatchObject({ assignments: [{ agentId: 'arceus' }] });
  });
});

describe('runner', () => {
  it('builds a headless command with the bridge and the session', () => {
    const args = turnArgs({ bin: 'claude', cwd: '/x', prompt: 'p', systemPrompt: 'sys', mcpConfigFile: '/m.json', sessionId: 's1', model: 'opus', permissionMode: 'acceptEdits', allowedTools: ['Edit'], env: {} });
    expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--permission-prompt-tool', 'mcp__jgents__approve', '--resume', 's1', '--model', 'opus', '--permission-mode', 'acceptEdits']));
    expect(args.slice(-2)).toEqual(['--allowedTools', 'Edit']);
    expect(args).not.toContain('p');
  });

  it('drops the variables of a parent Claude Code session', () => {
    const env = cleanEnv({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CONFIG_DIR: '/c', CLAUDE_CODE_MESSAGING_SOCKET: 's', ANTHROPIC_BASE_URL: 'http://proxy' });
    expect(env).toEqual({ PATH: '/bin', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CONFIG_DIR: '/c' });
    expect(cleanEnv({ ANTHROPIC_BASE_URL: 'http://mine' })).toEqual({ ANTHROPIC_BASE_URL: 'http://mine' });
  });

  it('parses stream-json without repeating streamed text', () => {
    const st = { streamed: new Set<string>(), textParts: [] as string[], openTools: new Set<string>() } as Parameters<typeof handleLine>[1];
    const got: string[] = [];
    const cb = { onText: (t: string) => got.push(t), onToolStart: (_id: string, n: string) => got.push(`tool:${n}`), onToolEnd: (id: string) => got.push(`end:${id}`) };
    for (const l of [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'a' } } },
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } },
      { type: 'assistant', message: { id: 'a', content: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', id: 't', name: 'Read', input: {} }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't' }] } },
      { type: 'assistant', message: { id: 'b', content: [{ type: 'text', text: 'Done.' }] } },
      { type: 'result', subtype: 'success', session_id: 's', total_cost_usd: 0.5 },
    ]) {
      handleLine(JSON.stringify(l), st, cb);
    }
    expect(got).toEqual(['Hi', 'tool:Read', 'end:t', 'Done.']);
    expect(st.result).toMatchObject({ ok: true, text: 'Hi\n\nDone.', costUsd: 0.5, sessionId: 's' });
  });
});

describe('permissions', () => {
  it('matches "always allow" rules and builds them', () => {
    expect(ruleAllows(['Bash(npm test:*)'], 'Bash', { command: 'npm test -- --watch' })).toBe(true);
    expect(ruleAllows(['Bash(npm test:*)'], 'Bash', { command: 'npm test && rm -rf /' })).toBe(false);
    expect(ruleAllows(['Bash(npm test:*)'], 'Bash', { command: 'npm testing' })).toBe(false);
    expect(ruleAllows(['Edit'], 'Edit', { file_path: '/a' })).toBe(true);
    expect(allowRule('Bash', { command: 'npx hyperframes render --out a.mp4' })).toBe('Bash(npx hyperframes:*)');
    expect(allowRule('Bash', { command: 'git status' })).toBe('Bash(git:*)');
    expect(allowRule('WebFetch', { url: 'x' })).toBe('WebFetch');
    expect(describeTool('Bash', { command: 'ls', description: 'List' })).toEqual({ text: 'Run a command: List', preview: 'ls' });
    expect(toolLabel('mcp__jgents__handoff', { agent: 'palkia' })).toBe('Handed off to @palkia');
  });

  it('tells each agent who its teammates are', () => {
    const crew = defaultAgents('/d');
    const p = systemPrompt(crew[1], crew);
    expect(p).toContain('You are Ho-Oh (@ho-oh)');
    expect(p).toContain('HyperFrames');
    expect(p).toContain('- @giratina (Giratina)');
    expect(p).not.toContain('- @ho-oh');
  });
});

describe('crew service', () => {
  it('routes a request, streams the reply and resumes the same session next time', async () => {
    const crew = service();
    const events: string[] = [];
    crew.subscribe((e) => events.push(e));
    const user = crew.chat('@ho-oh make a teaser');
    expect(user).toMatchObject({ kind: 'user', text: '@ho-oh make a teaser' });
    const reply = await until(() => crew.snapshot().messages.find((m) => m.kind === 'agent' && m.status === 'done'));
    expect(reply).toMatchObject({ agentId: 'ho-oh', text: 'Working on: make a teaser', costUsd: 0.01, steps: [{ tool: 'Bash', label: 'Ran `npm test`', status: 'done' }] });
    expect(events).toContain('delta');
    const first = crew.stateOf('ho-oh');
    expect(first).toMatchObject({ status: 'idle', turns: 1, costUsd: 0.01 });
    expect(first.sessionId).toMatch(/^sess-/);
    // The prompt goes on stdin, never on the command line; the bridge config is per agent.
    expect(spawned[0]).not.toContain('make a teaser');
    const cfg = JSON.parse(readFileSync(spawned[0][spawned[0].indexOf('--mcp-config') + 1], 'utf8'));
    expect(cfg.mcpServers.jgents.env).toMatchObject({ JGENTS_CREW_AGENT: 'ho-oh', JGENTS_CREW_TOKEN: crew.token });

    crew.chat('again', 'ho-oh');
    await until(() => crew.stateOf('ho-oh').turns === 2);
    expect(spawned[1]).toEqual(expect.arrayContaining(['--resume', first.sessionId!]));
    // Persisted: a new service on the same folder remembers the session and the chat.
    const again = service();
    expect(again.stateOf('ho-oh').sessionId).toBe(first.sessionId);
    expect(again.snapshot().messages.filter((m) => m.kind === 'agent')).toHaveLength(2);
  });

  it('starts a fresh session when the saved one is gone, and reports failures', async () => {
    const crew = service();
    crew.chat('hello', 'ho-oh');
    await until(() => crew.stateOf('ho-oh').turns === 1);
    crew.chat('missing-session please', 'ho-oh');
    await until(() => crew.stateOf('ho-oh').turns === 2);
    expect(spawned).toHaveLength(3);
    expect(spawned[2]).not.toContain('--resume');
    crew.chat('boom', 'ho-oh');
    const failed = await until(() => crew.snapshot().messages.find((m) => m.status === 'error'));
    expect(failed.text).toContain('it broke');
    expect(crew.stateOf('ho-oh').status).toBe('error');
  });

  it('queues requests per agent and runs different agents in parallel', async () => {
    const crew = service();
    crew.chat('slow one', 'ho-oh');
    crew.chat('slow two', 'ho-oh');
    crew.chat('slow three', 'giratina');
    await until(() => spawned.length === 2);
    expect(crew.stateOf('ho-oh')).toMatchObject({ status: 'working', queued: 1 });
    expect(crew.stateOf('giratina').status).toBe('working');
    await until(() => crew.stateOf('ho-oh').turns === 2 && crew.stateOf('giratina').turns === 1);
  });

  it('puts questions and approvals on the board and hands the answers back', async () => {
    const crew = service();
    const ask = crew.bridgeAsk({ agent: 'ho-oh', run: 'r1', question: 'Which format?', options: ['16:9', '9:16'] });
    expect(ask).toHaveProperty('id');
    const id = (ask as { id: string }).id;
    expect(crew.stateOf('ho-oh').status).toBe('waiting');
    const waiting = crew.bridgeWait(id, 5_000);
    expect(crew.answer(id, { action: 'answer', answer: '9:16' })).toMatchObject({ status: 'answered', answer: '9:16' });
    expect(await waiting).toEqual({ status: 'answered', answer: '9:16' });
    expect(crew.answer(id, { action: 'answer', answer: 'again' })).toMatchObject({ status: 409 });

    const ap = crew.bridgeApprove({ agent: 'giratina', run: 'r2', tool: 'Bash', input: { command: 'strix -n -t ./ --scan-mode quick' } }) as { id: string; status: string };
    expect(ap.status).toBe('pending');
    crew.answer(ap.id, { action: 'allow', always: true });
    expect(await crew.bridgeWait(ap.id, 100)).toEqual({ status: 'allowed' });
    expect(crew.agents().find((a) => a.id === 'giratina')?.allowedTools).toContain('Bash(strix:*)');
    expect(crew.bridgeApprove({ agent: 'giratina', tool: 'Bash', input: { command: 'strix -n -t ./api' } })).toEqual({ status: 'allowed' });
    const denied = crew.bridgeApprove({ agent: 'ho-oh', tool: 'Write', input: { file_path: '/etc/x' } }) as { id: string };
    crew.answer(denied.id, { action: 'deny', answer: 'not there' });
    expect(await crew.bridgeWait(denied.id, 100)).toEqual({ status: 'denied', message: 'The user denied this: not there' });
  });

  it('sends a late answer as a new message once the asking turn ended', async () => {
    const crew = service();
    const { id } = crew.bridgeAsk({ agent: 'ho-oh', run: 'gone', question: 'Brand colour?' }) as { id: string };
    // the turn that asked is over: its open question is now an orphan
    (crew as unknown as { board: { runEnded(r: string): unknown } }).board.runEnded('gone');
    crew.answer(id, { action: 'answer', answer: 'orange' });
    await until(() => spawned.length === 1);
    const follow = await until(() => crew.snapshot().messages.find((m) => m.kind === 'agent' && m.status === 'done'));
    expect(follow.origin).toBe('answer to its question');
    expect(follow.text).toContain('The user answered your earl');
  });

  it('hands work from one agent to another', async () => {
    const crew = service();
    expect(crew.bridgeHandoff({ from: 'giratina', agent: 'nobody', task: 'x' })).toHaveProperty('error');
    expect(crew.bridgeHandoff({ from: 'giratina', agent: 'giratina', task: 'x' })).toHaveProperty('error');
    expect(crew.bridgeHandoff({ from: 'giratina', agent: '@Ho-Oh', task: 'make a video of the findings' })).toEqual({ name: 'Ho-Oh' });
    const reply = await until(() => crew.snapshot().messages.find((m) => m.kind === 'agent' && m.status === 'done'));
    expect(reply).toMatchObject({ agentId: 'ho-oh', origin: 'handoff from Giratina' });
    expect(crew.snapshot().messages.some((m) => m.kind === 'router' && m.text.includes('handed off'))).toBe(true);
  });

  it('stops, resets and removes agents', async () => {
    const crew = service();
    crew.chat('slow job', 'ho-oh');
    crew.chat('slow queued', 'ho-oh');
    await until(() => spawned.length === 1);
    expect(crew.stop('ho-oh')).toBe(true);
    await until(() => crew.snapshot().messages.filter((m) => m.status === 'stopped').length === 2);
    expect(crew.reset('ho-oh')).toBe(true);
    expect(crew.stateOf('ho-oh').sessionId).toBeUndefined();
    expect(crew.removeAgent('ho-oh')).toBe(true);
    expect(crew.agents().map((a) => a.id)).toEqual(['arceus', 'giratina']);
  });

  it('starts an agent from one of your Claude Code sessions: take over or fork', async () => {
    // A Claude config dir with two sessions in the agent's folder, one of them open right now.
    const cfg = join(dir, 'claude-cfg');
    const work = join(dir, 'jet-api');
    const ui = join(dir, 'jet-ui');
    mkdirSync(work, { recursive: true });
    mkdirSync(ui, { recursive: true });
    const proj = join(cfg, 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(proj, { recursive: true });
    mkdirSync(join(cfg, 'sessions'), { recursive: true });
    const old = '11111111-1111-4111-8111-111111111111';
    const live = '22222222-2222-4222-8222-222222222222';
    writeFileSync(
      join(proj, `${old}.jsonl`),
      [
        JSON.stringify({ type: 'user', isMeta: true, message: { content: '<command-name>/clear</command-name>' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'why is the consignee search empty?' } }),
        JSON.stringify({ type: 'custom-title', customTitle: 'Consignee search not working' }),
      ].join('\n'),
    );
    writeFileSync(join(proj, `${live}.jsonl`), JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'add the export button' }] } }));
    writeFileSync(join(cfg, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: live, cwd: work }));
    const crew = service({ claudeDirs: [cfg] });
    const palkia = crew.createAgent({ name: 'Palkia', folder: work, extraFolders: [ui], kind: 'project' }) as CrewAgent;
    const list = crew.sessions(work, 'palkia');
    expect(list.map((s) => [s.id, s.title, s.open])).toEqual(
      expect.arrayContaining([
        [old, 'Consignee search not working', false],
        [live, 'add the export button', true],
      ]),
    );
    expect(crew.adoptSession('palkia', live, 'resume')).toMatchObject({ status: 409 });
    expect(crew.adoptSession('palkia', '33333333-3333-4333-8333-333333333333', 'resume')).toMatchObject({ status: 404 });
    expect(crew.adoptSession('palkia', old, 'resume')).toEqual({ ok: true });
    expect(crew.sessions(work, 'palkia').find((s) => s.id === old)?.current).toBe(true);
    crew.chat('fix it', palkia.id);
    await until(() => crew.stateOf('palkia').turns === 1);
    expect(spawned[0]).toEqual(expect.arrayContaining(['--resume', old, '--add-dir', ui]));
    expect(spawned[0]).not.toContain('--fork-session');
    expect(crew.stateOf('palkia').sessionId).toBe(old);
    // Fork the open one: the next turn copies it, then continues its own copy.
    expect(crew.adoptSession('palkia', live, 'fork')).toEqual({ ok: true });
    expect(crew.stateOf('palkia').forkNext).toBe(true);
    crew.chat('and the UI', palkia.id);
    await until(() => crew.stateOf('palkia').turns === 2);
    expect(spawned[1]).toEqual(expect.arrayContaining(['--resume', live, '--fork-session']));
    expect(crew.stateOf('palkia').forkNext).toBeUndefined();
    expect(crew.snapshot().messages.some((m) => m.kind === 'system' && m.text.includes('Consignee search not working'))).toBe(true);

    // A session of the UI folder: the UI becomes Palkia's working folder, the API an extra one.
    const uiSession = '44444444-4444-4444-8444-444444444444';
    const uiProj = join(cfg, 'projects', ui.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(uiProj, { recursive: true });
    writeFileSync(join(uiProj, `${uiSession}.jsonl`), JSON.stringify({ type: 'custom-title', customTitle: 'SEO audit' }));
    expect(crew.sessions([work, ui], 'palkia').find((s) => s.id === uiSession)).toMatchObject({ folder: ui, title: 'SEO audit' });
    expect(crew.adoptSession('palkia', uiSession, 'resume')).toEqual({ ok: true });
    expect(crew.agents().find((x) => x.id === 'palkia')).toMatchObject({ folder: ui, extraFolders: [work] });
    crew.chat('check the meta tags', palkia.id);
    await until(() => crew.stateOf('palkia').turns === 3);
    expect(spawned[2]).toEqual(expect.arrayContaining(['--resume', uiSession, '--add-dir', work]));
  });

  it('is off without claude', () => {
    const crew = service({ claudeBin: undefined, disabledReason: 'no claude' });
    expect(crew.snapshot()).toMatchObject({ enabled: false, reason: 'no claude' });
    expect(crew.chat('hi')).toEqual({ error: 'no claude' });
  });
});

describe('http + MCP bridge', () => {
  let server: http.Server;
  let port: number;
  let crew: CrewService;

  beforeEach(async () => {
    server = http.createServer();
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    port = (server.address() as { port: number }).port;
    crew = service({ port });
    const handler = createCrewHandler({ crew, offReason: '', isRemote: () => false, folders: async () => [{ path: 'C:\\Projects\\IBC' }] });
    server.on('request', (req, res) => {
      if (!handler(req, res, new URL(req.url ?? '/', 'http://localhost'))) (res.statusCode = 404), res.end();
    });
  });
  afterEach(() => new Promise<void>((ok) => server.close(() => ok())));

  const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };

  it('serves the page routes from this computer only', async () => {
    expect((await req('GET', '/api/crew')).body).toMatchObject({ enabled: true, routerModel: 'haiku' });
    expect((await req('GET', '/api/crew/folders')).body).toEqual({ folders: ['C:\\Projects\\IBC'] });
    const created = await req('POST', '/api/crew/agents', { name: 'Dialga', folder: dir, kind: 'project', keywords: 'ibc' });
    expect(created).toMatchObject({ status: 201, body: { id: 'dialga' } });
    expect((await req('PUT', '/api/crew/agents/dialga', { role: 'IBC Auto' })).body).toMatchObject({ role: 'IBC Auto' });
    expect((await req('GET', '/api/crew/agents/dialga/tools')).body.tools).toBeInstanceOf(Array);
    expect((await req('POST', '/api/crew/chat', { text: '' })).status).toBe(400);
    expect((await req('POST', '/api/crew/bridge/ask', { agent: 'ho-oh', question: 'q' })).status).toBe(403);
    const remote = await new Promise<number>((ok) => http.get({ host: '127.0.0.1', port, path: '/api/crew', headers: { host: '192.168.0.5:4747' } }, (r) => (r.resume(), ok(r.statusCode ?? 0))));
    expect(remote).toBe(403);
  });

  it('lets the MCP bridge ask the user and get the answer', async () => {
    const child = spawn(process.execPath, [BRIDGE], {
      env: { ...process.env, JGENTS_PORT: String(port), JGENTS_CREW_TOKEN: crew.token, JGENTS_CREW_AGENT: 'ho-oh', JGENTS_CREW_RUN: 'r1' },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const replies = new Map<number, Record<string, unknown>>();
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c: string) => {
      buf += c;
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const msg = JSON.parse(buf.slice(0, nl)) as { id: number };
        buf = buf.slice(nl + 1);
        replies.set(msg.id, msg as unknown as Record<string, unknown>);
      }
    });
    const send = (id: number, method: string, params: unknown = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    try {
      send(1, 'initialize', { protocolVersion: '2025-06-18' });
      send(2, 'tools/list');
      const list = await until(() => replies.get(2));
      expect((list.result as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(['ask_user', 'approve', 'handoff']);
      send(3, 'tools/call', { name: 'ask_user', arguments: { question: 'Vertical or wide?', options: ['9:16', '16:9'] } });
      const q = await until(() => crew.snapshot().questions.find((x) => x.status === 'open'));
      expect(q).toMatchObject({ agentId: 'ho-oh', text: 'Vertical or wide?', options: ['9:16', '16:9'] });
      const r = await req('POST', `/api/crew/questions/${q.id}`, { action: 'answer', answer: '9:16' });
      expect(r.status).toBe(200);
      const answer = await until(() => replies.get(3));
      expect(answer.result).toEqual({ content: [{ type: 'text', text: 'The user answered: 9:16' }] });

      // Ho-Oh's own rules already allow HyperFrames: no card, allowed at once.
      send(4, 'tools/call', { name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'npx hyperframes render' } } });
      const auto = await until(() => replies.get(4));
      expect(JSON.parse((auto.result as { content: { text: string }[] }).content[0].text)).toEqual({ behavior: 'allow', updatedInput: { command: 'npx hyperframes render' } });
      send(5, 'tools/call', { name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'npm run build' } } });
      const ap = await until(() => crew.snapshot().questions.find((x) => x.status === 'open' && x.kind === 'approval'));
      expect(ap).toMatchObject({ text: 'Run a command', preview: 'npm run build' });
      await req('POST', `/api/crew/questions/${ap.id}`, { action: 'deny', answer: 'use the dev build' });
      const denied = await until(() => replies.get(5));
      expect(JSON.parse((denied.result as { content: { text: string }[] }).content[0].text)).toEqual({ behavior: 'deny', message: 'The user denied this: use the dev build' });
    } finally {
      child.kill();
      await new Promise((ok) => (child.exitCode !== null ? ok(undefined) : child.once('exit', ok)));
      crew.shutdown();
    }
  }, 20_000);

  it('streams events over SSE', async () => {
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/crew/stream`, { signal: ac.signal });
    const reader = res.body!.getReader();
    const seen: string[] = [];
    const read = (async () => {
      let text = '';
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        text += new TextDecoder().decode(value);
        for (const m of text.matchAll(/event: (\w+)/g)) if (!seen.includes(m[1])) seen.push(m[1]);
      }
    })();
    crew.chat('@arceus hi');
    await until(() => (seen.includes('delta') && seen.includes('state') ? true : undefined));
    expect(seen[0]).toBe('snapshot' satisfies keyof CrewEvents);
    expect(seen).toEqual(expect.arrayContaining(['message', 'delta', 'state']));
    ac.abort();
    await read;
  });
});

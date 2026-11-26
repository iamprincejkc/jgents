import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMPANY_CEO_ID, COMPANY_ROOM_ID } from '../../shared/types';
import { CEO_SPEC, companyDir, DEPARTMENTS } from './company';
import { route } from './router';
import { CrewService, systemPrompt } from './service';

const BRIDGE = resolve(__dirname, '../../mod/jgents-crew/mcp.mjs');

/** A `claude -p` stand-in (as in crew.test.ts): echoes the start of its prompt; "slow" prompts take 400 ms. */
const FAKE = `
const args = process.argv.slice(2);
const i = args.indexOf('--resume');
const session = i >= 0 ? args[i + 1] : 'sess-' + Math.random().toString(36).slice(2, 8);
let prompt = '';
process.stdin.on('data', (c) => (prompt += c));
process.stdin.on('end', () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd() });
  out({ type: 'assistant', session_id: session, message: { id: 'm1', content: [{ type: 'text', text: 'Working on: ' + prompt.slice(0, 60) }] } });
  setTimeout(() => {
    out({ type: 'result', subtype: 'success', is_error: false, session_id: session, result: 'Working on: ' + prompt.slice(0, 60), total_cost_usd: 0.01, duration_ms: 900 });
    process.exit(0);
  }, prompt.includes('slow') ? 400 : 0);
});
`;

let dir: string;
let fake: string;
const prompts: string[] = [];
const spawnedArgs: string[][] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jgents-company-'));
  fake = join(dir, 'fake-claude.mjs');
  writeFileSync(fake, FAKE);
  prompts.length = 0;
  spawnedArgs.length = 0;
});
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
      spawnedArgs.push(args);
      const child = spawn(process.execPath, [fake, ...args], { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['pipe', 'pipe', 'pipe'] });
      // the prompt goes on stdin: keep a copy for the assertions
      const write = child.stdin.end.bind(child.stdin) as (chunk?: unknown) => void;
      (child.stdin as unknown as { end: (chunk?: unknown) => void }).end = (chunk?: unknown) => {
        if (typeof chunk === 'string') prompts.push(chunk);
        write(chunk);
      };
      return child;
    },
    ...over,
  });
}

function until<T>(fn: () => T | undefined | false, ms = 10_000): Promise<T> {
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

/** The run id of an agent's current turn (what the bridge sends as JGENTS_CREW_RUN). */
function runOf(crew: CrewService, id: string): string | undefined {
  return (crew as unknown as { running: Map<string, { job: { runId: string } }> }).running.get(id)?.job.runId;
}

describe('the company', () => {
  it('is set up in one go: the CEO, every department, the company folder; again changes nothing', () => {
    const crew = service();
    const r = crew.createCompany();
    expect(r).toMatchObject({ folder: companyDir(dir) });
    const created = (r as { created: string[] }).created;
    expect(created).toEqual([CEO_SPEC.id, ...DEPARTMENTS.map((d) => d.id)]);
    expect(DEPARTMENTS).toHaveLength(16);
    expect(existsSync(join(companyDir(dir), 'profile.md'))).toBe(true);
    expect(existsSync(join(companyDir(dir), 'outbox'))).toBe(true);
    const agents = crew.agents();
    const ceo = agents.find((a) => a.id === 'ceo')!;
    expect(ceo).toMatchObject({ kind: 'ceo', model: 'opus', permissionMode: 'acceptEdits', extraFolders: [companyDir(dir)] });
    const hr = agents.find((a) => a.id === 'hr')!;
    expect(hr).toMatchObject({ kind: 'department', model: 'sonnet', color: '#e0568f' });
    // every department has its own colour (the uniform) and its own workspace
    expect(new Set(DEPARTMENTS.map((d) => d.color)).size).toBe(16);
    expect(new Set(agents.filter((a) => a.kind === 'department').map((a) => a.folder)).size).toBe(16);
    // the crew it joined is still there
    expect(agents.map((a) => a.id)).toEqual(expect.arrayContaining(['arceus', 'ho-oh', 'giratina']));
    expect(crew.createCompany()).toEqual({ created: [], folder: companyDir(dir) });
    // the company folder is in their instructions, with the company playbook
    const prompt = systemPrompt(ceo, agents, companyDir(dir));
    expect(prompt).toContain(`The company folder: ${companyDir(dir)}`);
    expect(prompt).toContain('mcp__jgents__delegate');
    // its departments, counted apart from the rest of the crew, and the playbook points at that list (it once said
    // "listed under The crew", and the CEO counted the user's other agents as departments)
    expect(prompt).toContain('listed under "Your departments"');
    expect(prompt).not.toMatch(/^The crew:/m);
    const own = prompt.slice(prompt.indexOf('Your departments (16):'), prompt.indexOf('Other agents on the crew'));
    expect(own).toContain('- @hr (HR & People)');
    expect(own.match(/^- @/gm)).toHaveLength(16);
    expect(prompt.slice(prompt.indexOf('Other agents on the crew')).match(/^- @/gm)).toHaveLength(agents.length - 17);
    // a department sees the company (the CEO among it); an agent outside it, one line pointing to the CEO
    expect(systemPrompt(hr, agents, companyDir(dir))).toContain('The company (its CEO and your fellow departments):\n- @ceo (CEO)');
    const outsider = agents.find((a) => a.kind !== 'ceo' && a.kind !== 'department')!;
    const theirs = systemPrompt(outsider, agents);
    expect(theirs).toContain('The company: @ceo (CEO) and 16 departments. Anything for the company goes to @ceo.');
    expect(theirs).not.toContain('- @hr');
  });

  it('sends every request without an @mention to the CEO', async () => {
    const crew = service();
    crew.createCompany();
    const agents = crew.agents();
    expect(await route('plan the hiring of a junior developer', agents, {})).toMatchObject({ via: 'ceo', assignments: [{ agentId: 'ceo' }] });
    expect(await route('@hr write a job post', agents, {})).toMatchObject({ via: 'mention', assignments: [{ agentId: 'hr' }] });
    crew.chat('how are we doing?');
    const reply = await until(() => crew.snapshot().messages.find((m) => m.kind === 'agent' && m.status === 'done'));
    expect(reply.agentId).toBe('ceo');
    expect(crew.company().log.map((e) => e.type)).toEqual(['request', 'answer']);
  });

  it('briefs departments and hands their reports back to the CEO in one message', async () => {
    const crew = service();
    crew.createCompany();
    crew.chat('slow: plan the hiring of a junior developer');
    const run = await until(() => runOf(crew, 'ceo'));
    expect(crew.bridgeDelegate({ from: 'ceo', run, agent: 'hr', task: 'Write the job description.' })).toEqual({ name: 'HR & People' });
    expect(crew.bridgeDelegate({ from: 'ceo', run, agent: '@accounting', task: 'Salary range and first-year cost.' })).toEqual({ name: 'Finance & Accounting' });
    const final = await until(() => crew.snapshot().messages.find((m) => m.agentId === 'ceo' && m.origin === 'reports from 2 departments' && m.status === 'done'));
    expect(final.text).toContain('Working on: The 2 agents you briefed have reported');
    // the reports went in the CEO's prompt, with each department's reply
    const back = prompts.find((p) => p.startsWith('The 2 agents you briefed'))!;
    expect(back).toContain('## HR & People (@hr) · done');
    expect(back).toContain('## Finance & Accounting (@accounting) · done');
    expect(back).toContain('plan the hiring of a junior developer');
    expect(back).toContain('answer the user');
    // the departments got a brief that says where their reply goes
    expect(prompts.some((p) => p.startsWith('Brief from CEO (@ceo)') && p.includes('goes back to CEO as your report'))).toBe(true);
    // briefing never waits for an approval on the board: delegate is pre-approved on every turn's command line
    for (const args of spawnedArgs) expect(args.slice(args.indexOf('--allowedTools'))).toContain('mcp__jgents__delegate');
    // everyone answered the same request in the chat
    const user = crew.snapshot().messages.find((m) => m.kind === 'user')!;
    expect(crew.snapshot().messages.filter((m) => m.kind === 'agent').every((m) => m.replyTo === user.id)).toBe(true);
    // the departments may finish before the CEO's own briefing turn does: count, and the combined answer comes last
    const log = crew.company().log;
    const count = (t: string) => log.filter((e) => e.type === t).length;
    expect([count('request'), count('brief'), count('report'), count('answer')]).toEqual([1, 2, 2, 2]);
    expect(log.map((e) => e.type).slice(0, 3)).toEqual(['request', 'brief', 'brief']);
    expect(log.at(-1)).toMatchObject({ type: 'answer', agent: 'ceo' });
    expect(log.filter((e) => e.type === 'report').map((e) => e.agent).sort()).toEqual(['accounting', 'hr']);
  });

  it('a department can brief a colleague: its own report waits for theirs', async () => {
    const crew = service();
    crew.createCompany();
    crew.chat('slow launch campaign');
    const ceoRun = await until(() => runOf(crew, 'ceo'));
    crew.bridgeDelegate({ from: 'ceo', run: ceoRun, agent: 'marketing', task: 'slow: the launch campaign' });
    const mkRun = await until(() => runOf(crew, 'marketing'));
    expect(crew.bridgeDelegate({ from: 'marketing', run: mkRun, agent: 'design', task: 'A banner for the launch.' })).toEqual({ name: 'Design & Creative' });
    const final = await until(() => crew.snapshot().messages.find((m) => m.agentId === 'ceo' && m.origin === 'reports from 1 department' && m.status === 'done'));
    const msgs = crew.snapshot().messages;
    const mkFollow = msgs.find((m) => m.agentId === 'marketing' && m.origin === 'reports from 1 department')!;
    expect(mkFollow.status).toBe('done');
    // the CEO heard back only after Marketing had Design's report
    expect(mkFollow.at).toBeLessThan(final.at);
    // the CEO's prompt carries Marketing's report, which Marketing wrote after it had Design's
    const back = prompts.find((p) => p.startsWith('The agent you briefed has reported') && p.includes('## Marketing (@marketing)'))!;
    expect(back).toContain('Working on: The agent you briefed has reported');
    expect(prompts.some((p) => p.startsWith('The agent you briefed has reported') && p.includes('@design') && p.includes('finish your own brief'))).toBe(true);
  });

  it('a brief stopped before it ran still reports, so the CEO is never left waiting', async () => {
    const crew = service({ maxParallel: 1 });
    crew.createCompany();
    crew.chat('slow: two briefs');
    const run = await until(() => runOf(crew, 'ceo'));
    crew.bridgeDelegate({ from: 'ceo', run, agent: 'hr', task: 'slow: one' });
    crew.bridgeDelegate({ from: 'ceo', run, agent: 'legal', task: 'two' });
    await until(() => runOf(crew, 'hr'));
    expect(crew.stop('legal')).toBe(true);
    await until(() => crew.snapshot().messages.find((m) => m.agentId === 'ceo' && m.origin === 'reports from 2 departments' && m.status === 'done'));
    expect(prompts.find((p) => p.startsWith('The 2 agents'))).toContain('## Legal & Compliance (@legal) · stopped');
  });

  it('refuses briefs outside a turn, to oneself or to nobody', async () => {
    const crew = service();
    crew.createCompany();
    expect(crew.bridgeDelegate({ from: 'ceo', run: 'nope', agent: 'hr', task: 'x' })).toEqual({ error: 'delegate only works during your own turn' });
    crew.chat('slow: hello');
    const run = await until(() => runOf(crew, 'ceo'));
    expect(crew.bridgeDelegate({ from: 'ceo', run, agent: 'ceo', task: 'x' })).toHaveProperty('error');
    expect(crew.bridgeDelegate({ from: 'ceo', run, agent: 'janitor', task: 'x' })).toHaveProperty('error');
    expect(crew.bridgeDelegate({ from: 'ceo', run, agent: 'hr', task: '   ' })).toHaveProperty('error');
  });

  it('shows the company, its log and the outbox', () => {
    const crew = service();
    // the office's HQ button shows once the company is set up
    expect(crew.summary().company).toBe(false);
    crew.createCompany();
    expect(crew.summary().company).toBe(true);
    writeFileSync(join(companyDir(dir), 'outbox', '2026-11-25-hiring-plan.md'), '# plan');
    const c = crew.company();
    expect(c.ceo?.id).toBe('ceo');
    expect(c.departments).toHaveLength(16);
    expect(c.states).toHaveLength(17);
    expect(c.outbox.map((f) => f.name)).toEqual(['2026-11-25-hiring-plan.md']);
    // the log is a JSON line per event in the company folder
    crew.chat('@hr hello');
    expect(readFileSync(join(companyDir(dir), 'profile.md'), 'utf8')).toContain('# Company profile');
  });

  it('keeps its log across a restart (a torn line is skipped) and reads finished files from the outbox only', async () => {
    const crew = service();
    crew.createCompany();
    crew.chat('how are we doing?');
    await until(() => crew.company().log.some((e) => e.type === 'answer'));
    // the process died mid-write: half a line at the end
    const log = join(companyDir(dir), 'log.jsonl');
    writeFileSync(log, `${readFileSync(log, 'utf8')}{"type":"req`);
    const again = service().company();
    expect(again.log.map((e) => e.type)).toEqual(['request', 'answer']);
    expect(again.members).toHaveLength(17);
    writeFileSync(join(companyDir(dir), 'outbox', 'plan.md'), '# The plan');
    writeFileSync(join(companyDir(dir), 'secret.md'), 'not in the outbox');
    expect(crew.outboxFile('plan.md')).toMatchObject({ name: 'plan.md', text: '# The plan', bytes: 10, truncated: false });
    for (const bad of ['../secret.md', '..\\secret.md', 'sub/plan.md', '.hidden', '', 'C:\\x.md', 'missing.md']) expect(crew.outboxFile(bad)).toBeUndefined();
  });

  it('is drawn in the office: one character per member, in uniform, following its turns', async () => {
    const crew = service();
    expect(crew.companyMembers()).toEqual([]);
    expect(crew.isCompanyPath(join(dir, 'crew', 'workspaces', 'hr'))).toBe(false);
    crew.createCompany();
    const idle = crew.companyMembers();
    expect(idle).toHaveLength(17);
    expect(idle.every((m) => m.roomId === COMPANY_ROOM_ID && m.status === 'idle' && m.parts?.topStyle === 'jacket')).toBe(true);
    const ceo = idle.find((m) => m.id === COMPANY_CEO_ID)!;
    expect(ceo).toMatchObject({ name: 'CEO', look: 'm', seed: CEO_SPEC.seed, parts: { topAccent: CEO_SPEC.color } });
    expect(idle.find((m) => m.id === 'company:hr')).toMatchObject({ name: 'HR', role: 'HR & People', parts: { topAccent: '#e0568f' } });
    // the crew agents that are not the company stay out of it
    expect(idle.some((m) => m.id === 'company:arceus')).toBe(false);
    // a turn: working, with what it does as the activity; done: idle again, the activity says so
    crew.chat('slow: plan the offsite');
    await until(() => runOf(crew, 'ceo'));
    const busy = crew.companyMembers().find((m) => m.id === COMPANY_CEO_ID)!;
    expect(busy.status).toBe('working');
    expect(busy.activity?.kind).toBeDefined();
    expect(busy.statusSince).toBeGreaterThan(ceo.statusSince);
    await until(() => crew.companyMembers().find((m) => m.id === COMPANY_CEO_ID)?.status === 'idle');
    expect(crew.companyMembers().find((m) => m.id === COMPANY_CEO_ID)?.activity?.kind).toBe('done');
    // its sessions are the members' turns: the office skips them
    expect(crew.isCompanyPath(join(dir, 'crew', 'workspaces', 'hr'))).toBe(true);
    expect(crew.isCompanyPath(join(dir, 'crew', 'workspaces', 'hr', 'notes'))).toBe(true);
    expect(crew.isCompanyPath(companyDir(dir))).toBe(true);
    expect(crew.isCompanyPath(join(dir, 'crew', 'workspaces', 'hr-old'))).toBe(false);
    expect(crew.isCompanyPath(dir)).toBe(false);
  });
});

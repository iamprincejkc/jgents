import { describe, expect, it } from 'vitest';
import type { CompanyEvent, CrewAgent, CrewAgentState, CrewQuestion } from '../../../shared/crew';
import type { AgentInfo } from '../../../shared/types';
import { ago, bytes, currentTicket, deptLine, hourly, pulse, sparkPoints, speakable, startOfDay, usd } from './model';

const NOW = new Date(2026, 10, 25, 14, 30).getTime();
const at = (h: number, m = 0) => new Date(2026, 10, 25, h, m).getTime();
const ev = (type: CompanyEvent['type'], t: number, extra: Partial<CompanyEvent> = {}): CompanyEvent => ({ type, at: t, agent: 'ceo', text: type, ...extra });
const member = (status: AgentInfo['status']) => ({ status }) as AgentInfo;
const agent = (id: string): CrewAgent => ({ id, name: id.toUpperCase(), role: '', description: '', keywords: [], emoji: '', color: '#fff', kind: 'department', folder: '', extraFolders: [], instructions: '', model: '', permissionMode: 'ask', allowedTools: [] });
const state = (id: string, extra: Partial<CrewAgentState> = {}): CrewAgentState => ({ id, status: 'idle', queued: 0, costUsd: 0, turns: 0, ...extra });
const question = (agentId: string, extra: Partial<CrewQuestion> = {}): CrewQuestion => ({ id: `q-${agentId}`, at: NOW, agentId, kind: 'question', text: 'Include the 13th-month pay?', status: 'open', ...extra });

describe('the pulse', () => {
  it('counts who works and who needs you, and what today asked, delivered and cost', () => {
    const log = [
      ev('request', at(9), {}),
      ev('brief', at(9, 1), { to: 'hr' }),
      ev('brief', at(9, 2), { to: 'marketing' }),
      ev('brief', at(11), { to: 'marketing' }),
      ev('report', at(9, 5), { agent: 'hr', costUsd: 0.15 }),
      ev('answer', at(9, 6), { costUsd: 0.36 }),
      ev('request', at(14)),
      // yesterday: not today
      ev('request', NOW - 86_400_000, { costUsd: 9 }),
    ];
    const outbox = [
      { name: 'a.md', at: at(10), bytes: 10 },
      { name: 'old.md', at: NOW - 3 * 86_400_000, bytes: 10 },
    ];
    const p = pulse([member('working'), member('waiting'), member('idle'), member('idle')], log, outbox, NOW);
    expect(p).toMatchObject({ working: 1, waiting: 1, idle: 2, total: 4, requestsToday: 2, deliveredToday: 1, busiest: 'marketing' });
    expect(p.spentToday).toBeCloseTo(0.51);
    expect(pulse([], [], [], NOW).busiest).toBeUndefined();
  });

  it('requests per hour: from 8 am (or earlier) to now, and a sparkline that never divides by zero', () => {
    expect(hourly([ev('request', at(9)), ev('request', at(9, 30)), ev('request', at(13))], NOW)).toEqual({ fromHour: 8, counts: [0, 2, 0, 0, 0, 1, 0] });
    expect(hourly([ev('request', at(6))], NOW).fromHour).toBe(6);
    expect(sparkPoints([0, 0], 100, 20)).toBe('0,17 100,17');
    expect(sparkPoints([2], 100, 20)).toBe('0,3 100,3');
    expect(sparkPoints([0, 1, 2], 100, 20)).toBe('0,17 50,10 100,3');
    expect(startOfDay(NOW)).toBe(at(0));
  });
});

describe('the open request', () => {
  it('follows each briefed department: reported, needs you, working or still in the queue', () => {
    const log = [
      ev('request', at(10), { text: 'Old request' }),
      ev('answer', at(10, 1)),
      ev('request', at(14), { text: 'Plan the hiring of a junior developer' }),
      ev('brief', at(14, 1), { to: 'hr', ticket: 't' }),
      ev('brief', at(14, 1), { to: 'accounting', ticket: 't' }),
      ev('brief', at(14, 1), { to: 'marketing', ticket: 't' }),
      ev('brief', at(14, 1), { to: 'legal', ticket: 't' }),
      ev('answer', at(14, 2), { text: 'Briefed four departments' }),
      ev('report', at(14, 9), { agent: 'hr', to: 'ceo', status: 'done', ticket: 't' }),
    ];
    const states = new Map([
      ['marketing', state('marketing', { status: 'working' })],
      ['legal', state('legal')],
    ]);
    const t = currentTicket(log, states, [question('accounting')])!;
    expect(t.text).toBe('Plan the hiring of a junior developer');
    expect(t.chips).toEqual([
      { id: 'hr', status: 'done' },
      { id: 'accounting', status: 'waiting' },
      { id: 'marketing', status: 'working' },
      { id: 'legal', status: 'briefed' },
    ]);
    expect(t).toMatchObject({ reported: 1, closed: false });
    // the last reports and the CEO's answer close it
    const done = [...log, ev('report', at(14, 20), { agent: 'accounting', status: 'error' }), ev('report', at(14, 21), { agent: 'marketing', status: 'done' }), ev('report', at(14, 22), { agent: 'legal', status: 'stopped' }), ev('answer', at(14, 25))];
    expect(currentTicket(done, states, [])).toMatchObject({ reported: 4, closed: true });
    // a question the CEO answers itself: no chips, closed at once
    expect(currentTicket([ev('request', at(9)), ev('answer', at(9, 1))], new Map(), [])).toMatchObject({ chips: [], closed: true });
    expect(currentTicket([], new Map(), [])).toBeUndefined();
  });

  it("a department's line: needs you, working, reported, queued or standby", () => {
    const ticket = { at: at(14), text: 'x', chips: [{ id: 'hr', status: 'done' as const }, { id: 'legal', status: 'briefed' as const }], reported: 1, closed: false };
    expect(deptLine(agent('acc'), state('acc'), [question('acc')], undefined, NOW)).toEqual({ status: 'waiting', what: 'Needs you: Include the 13th-month pay?' });
    expect(deptLine(agent('mk'), state('mk', { status: 'working', activity: 'Writing post.md' }), [], undefined, NOW)).toEqual({ status: 'working', what: 'Writing post.md' });
    expect(deptLine(agent('hr'), state('hr'), [], ticket, NOW)).toEqual({ status: 'done', what: 'Reported' });
    expect(deptLine(agent('legal'), state('legal'), [], ticket, NOW)).toEqual({ status: 'working', what: 'Briefed, in the queue' });
    expect(deptLine(agent('hr'), state('hr', { lastAt: NOW - 3 * 3_600_000 }), [], { ...ticket, closed: true }, NOW)).toEqual({ status: 'idle', what: 'Standby · last turn 3 h ago' });
    expect(deptLine(agent('ops'), state('ops', { status: 'error', lastError: 'no folder' }), [], undefined, NOW)).toEqual({ status: 'error', what: 'Stopped: no folder' });
    expect(deptLine(agent('ops'), undefined, [question('ops', { status: 'answered' })], undefined, NOW)).toEqual({ status: 'idle', what: 'Standby' });
  });
});

describe('words', () => {
  it('reads a reply aloud without the markdown, the code or the links, and cuts a long one at a sentence', () => {
    const reply = [
      '## Hiring plan',
      '',
      "Here's the **plan**, saved as `outbox/2026-11-25-hiring.md`:",
      '',
      '- HR wrote the [job post](https://example.com/post).',
      '- Finance set the _budget_.',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '| a | b |',
      '|---|---|',
    ].join('\n');
    expect(speakable(reply)).toBe("Hiring plan. Here's the plan, saved as outbox/2026-11-25-hiring.md: HR wrote the job post. Finance set the budget. (code on screen)");
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const cut = speakable(long, 200);
    expect(cut.endsWith('is here. The rest is on screen.')).toBe(true);
    expect(cut.length).toBeLessThan(240);
  });

  it('formats money, sizes and times', () => {
    expect(usd(0)).toBe('$0.00');
    expect(usd(1.8449)).toBe('$1.84');
    expect(bytes(342)).toBe('342 B');
    expect(bytes(12_400)).toBe('12 KB');
    expect(bytes(1_468_006)).toBe('1.4 MB');
    expect(ago(NOW - 20_000, NOW)).toBe('just now');
    expect(ago(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
    expect(ago(NOW - 2 * 86_400_000, NOW)).toBe('2 d ago');
  });
});

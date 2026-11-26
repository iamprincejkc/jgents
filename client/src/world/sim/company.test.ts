// The company in the office (OfficeSnapshot.company): no project room; hot desks in the Main Office while working, a
// lounge seat while idle (and outings like anyone idle), the CEO at the head of the meeting table.
import { describe, expect, it } from 'vitest';
import { COMPANY_CEO_ID, COMPANY_ROOM_ID, type AgentInfo, type OfficeSnapshot, type RoomInfo } from '../../../../shared/types';
import type { Appearance, ArtModule, RoomTheme } from '../../art/api';
import { DEFAULT_WORLD_OPTIONS } from '../api';
import { HUB_CEO_GROUP, HUB_ID } from '../layout/hub';
import type { Character } from './character';
import { Sim } from './sim';

const theme: RoomTheme = {
  carpet: '#4f6d8f',
  carpet2: '#486685',
  wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' },
  accent: '#3f7fd8',
  deskVariant: 'wood',
  chairVariant: 'black',
};

const appearance: Appearance = {
  skin: '#f0c8a0',
  hair: '#3a2a20',
  hairStyle: 'short',
  eyes: '#222',
  top: '#2c3a57',
  topAccent: '#fff',
  topStyle: 'jacket',
  bottom: '#272c38',
  shoes: '#1b1d24',
  accessory: 'none',
  accessoryColor: '#000',
  lanyard: null,
  look: 'm',
};

const art = { appearanceFromSeed: () => appearance, roomTheme: () => theme } as unknown as ArtModule;

const T0 = 1_700_000_000_000;

function member(id: string, status: AgentInfo['status'], extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    kind: 'main',
    roomId: COMPANY_ROOM_ID,
    name: id,
    look: 'f',
    role: id,
    sessionId: '',
    account: '',
    status,
    recent: [],
    tasks: [],
    startedAt: T0,
    lastEventAt: T0,
    statusSince: T0,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7),
    ...extra,
  };
}

function snap(company: AgentInfo[], rev = 1, rooms: RoomInfo[] = [], agents: AgentInfo[] = []): OfficeSnapshot {
  return {
    rev,
    serverTime: T0,
    rooms,
    agents,
    company,
    accounts: [{ id: '.claude', short: 'C', name: 'Conta C', color: '#f08a3c', configDir: '~/.claude', sessions: 1, usageStatus: 'ok' }],
    meta: { demo: true, sources: [], startedAt: T0, version: 't' },
  };
}

function run(sim: Sim, clock: { now: number }, seconds: number, until?: () => boolean): void {
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i++) {
    clock.now += 1000 / 30;
    sim.update(1 / 30, clock.now);
    if (until?.()) return;
  }
}

const newSim = () => new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'calm' }), null);
const home = (sim: Sim, ch: Character) => sim.spots.get(ch.homeSpot);
const settled = (ch: Character) => !!ch.homeSpot && ch.atSpot === ch.homeSpot && !ch.step && !ch.queue.length;

describe('the company in the office', () => {
  it('first load: the CEO at the head of the table, whoever works at a hot desk, the idle ones on a lounge seat', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap([member(COMPANY_CEO_ID, 'idle'), member('company:hr', 'working'), member('company:legal', 'idle')]), clock.now);
    run(sim, clock, 0.5);
    const ceo = sim.chars.get(COMPANY_CEO_ID)!;
    const hr = sim.chars.get('company:hr')!;
    const legal = sim.chars.get('company:legal')!;
    expect(home(sim, ceo)?.group).toBe(HUB_CEO_GROUP);
    expect(ceo.atSpot).toBe(ceo.homeSpot);
    expect(home(sim, hr)).toMatchObject({ kind: 'desk', areaId: HUB_ID });
    expect(hr.atSpot).toBe(hr.homeSpot);
    expect(hr.pose).toBe('type');
    const rest = home(sim, legal)!;
    expect(rest.kind).not.toBe('desk');
    expect(rest.seated).toBe(true);
    expect(rest.group).not.toBe(HUB_CEO_GROUP);
    // no project room for the company
    expect(sim.rooms.size).toBe(0);
  });

  it('a brief: from the lounge to a free hot desk; done: the desk is freed and it goes back to rest', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap([member('company:sales', 'idle')]), clock.now);
    run(sim, clock, 0.5);
    const sales = sim.chars.get('company:sales')!;
    const lounge = sales.homeSpot;
    sim.applySnapshot(snap([member('company:sales', 'working', { statusSince: clock.now })], 2), clock.now);
    run(sim, clock, 60, () => settled(sales) && home(sim, sales)?.kind === 'desk');
    const desk = home(sim, sales)!;
    expect(desk).toMatchObject({ kind: 'desk', areaId: HUB_ID });
    expect(sim.spots.isFree(lounge!)).toBe(true);
    run(sim, clock, 0.2);
    expect(sales.pose).toBe('type');
    sim.applySnapshot(snap([member('company:sales', 'idle', { statusSince: clock.now })], 3), clock.now);
    run(sim, clock, 60, () => settled(sales) && home(sim, sales)?.kind !== 'desk');
    expect(home(sim, sales)?.kind).not.toBe('desk');
    expect(sim.spots.isFree(desk.id)).toBe(true);
  });

  it('more briefs than desks: the six hot desks fill, the next works on a laptop at the meeting table', () => {
    const sim = newSim();
    const clock = { now: T0 };
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => `company:${x}`);
    sim.applySnapshot(snap(ids.map((id) => member(id, 'working'))), clock.now);
    run(sim, clock, 0.5);
    const kinds = ids.map((id) => home(sim, sim.chars.get(id)!)?.kind);
    expect(kinds.filter((k) => k === 'desk')).toHaveLength(6);
    const extra = ids.map((id) => sim.chars.get(id)!).find((ch) => home(sim, ch)?.kind !== 'desk')!;
    expect(home(sim, extra)).toMatchObject({ kind: 'cafe_seat', areaId: HUB_ID });
    expect(extra.pose).toBe('type');
    expect(extra.held).toBe('laptop');
  });

  it('the CEO works from its chair, on the laptop', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap([member(COMPANY_CEO_ID, 'working')]), clock.now);
    run(sim, clock, 0.5);
    const ceo = sim.chars.get(COMPANY_CEO_ID)!;
    expect(home(sim, ceo)?.group).toBe(HUB_CEO_GROUP);
    expect(ceo.pose).toBe('type');
    expect(ceo.held).toBe('laptop');
  });

  it('idle for hours: the company never naps for good, it keeps going out', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap([member('company:design', 'idle', { statusSince: T0 - 3_600_000 })]), clock.now);
    run(sim, clock, 0.5);
    const design = sim.chars.get('company:design')!;
    design.nextOutingAt = 1;
    let left = false;
    run(sim, clock, 60, () => {
      if (design.atSpot !== design.homeSpot) left = true;
      return left;
    });
    expect(left).toBe(true);
    expect(design.icon).not.toBe('zzz');
  });

  it('idle, the company spreads over the house instead of crowding the Main Office', () => {
    const sim = newSim();
    const clock = { now: T0 };
    const ids = Array.from({ length: 16 }, (_, i) => `company:d${i}`);
    sim.applySnapshot(snap([member(COMPANY_CEO_ID, 'idle'), ...ids.map((id) => member(id, 'idle'))]), clock.now);
    run(sim, clock, 0.5);
    const perArea = new Map<string, number>();
    for (const id of ids) {
      const area = home(sim, sim.chars.get(id)!)!.areaId;
      perArea.set(area, (perArea.get(area) ?? 0) + 1);
    }
    const lounges = new Set([...sim.spots.all()].filter((s) => s.seated && ['sofa', 'armchair', 'beanbag', 'cafe_seat'].includes(s.kind) && !sim.rooms.has(s.areaId)).map((s) => s.areaId));
    expect(lounges.size).toBeGreaterThan(3);
    // every lounge area gets its share, none more than one above an even split
    const even = Math.ceil(ids.length / lounges.size);
    expect(perArea.size).toBe(Math.min(lounges.size, ids.length));
    expect(Math.max(...perArea.values())).toBeLessThanOrEqual(even + 1);
    expect(perArea.get(HUB_ID) ?? 0).toBeLessThanOrEqual(even + 1);
  });

  it('a project room and the company side by side: the company never takes the room desks', () => {
    const sim = newSim();
    const clock = { now: T0 };
    const proj: RoomInfo = { id: '/p', name: 'p', path: '/p', slot: 0, seed: 7, createdAt: T0 };
    const dev = member('dev', 'working', { roomId: '/p', account: '.claude', sessionId: 's-dev' });
    sim.applySnapshot(snap([member('company:it', 'working'), member('company:ops', 'idle')], 1, [proj], [dev]), clock.now);
    run(sim, clock, 0.5);
    for (const id of ['company:it', 'company:ops']) expect(home(sim, sim.chars.get(id)!)?.areaId).not.toBe('/p');
    expect(home(sim, sim.chars.get('dev')!)?.areaId).toBe('/p');
  });
});

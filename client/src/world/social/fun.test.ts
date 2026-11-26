// The entertainment wing's group games in the simulation (no DOM): billiards, pickleball, karaoke
// and the coffee-bar chat form, play out and end the way the room is laid out.
import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../../shared/types';
import type { Appearance, ArtModule, RoomTheme } from '../../art/api';
import { DEFAULT_WORLD_OPTIONS } from '../api';
import { BILLIARDS_ID, COFFEEBAR_ID, COURT_ID, KARAOKE_ID } from '../layout/fun';
import { LOUNGE_ID } from '../layout/core';
import { Sim } from '../sim/sim';
import { active, players, TARGET, type Gathering } from './gathering';

const theme: RoomTheme = { carpet: '#4f6d8f', carpet2: '#486685', wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' }, accent: '#3f7fd8', deskVariant: 'wood', chairVariant: 'black' };
const appearance: Appearance = { skin: '#f0c8a0', hair: '#3a2a20', hairStyle: 'short', eyes: '#222', top: '#3f7fd8', topAccent: '#fff', topStyle: 'tshirt', bottom: '#333', shoes: '#111', accessory: 'none', accessoryColor: '#000', lanyard: null, look: 'm' };
const art = { appearanceFromSeed: () => appearance, roomTheme: () => theme } as unknown as ArtModule;
const T0 = 1_700_000_000_000;

const room = (id: string, slot: number): RoomInfo => ({ id, name: id.replace('/', ''), path: id, slot, seed: slot * 99 + 7, createdAt: T0 });

function agent(id: string, roomId: string): AgentInfo {
  let seed = 0;
  for (const c of id) seed = (Math.imul(seed, 31) + c.charCodeAt(0)) >>> 0;
  return {
    id,
    kind: 'main',
    roomId,
    name: id[0].toUpperCase() + id.slice(1),
    look: 'f',
    role: 'Agente principal',
    sessionId: `s-${id}`,
    account: '.claude',
    status: 'idle',
    recent: [],
    tasks: [],
    startedAt: T0,
    lastEventAt: T0,
    statusSince: T0,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: seed * 2654435761,
  };
}

const snap = (rooms: RoomInfo[], agents: AgentInfo[]): OfficeSnapshot => ({
  rev: 1,
  serverTime: T0,
  rooms,
  agents,
  accounts: [{ id: '.claude', short: 'C', name: 'Conta C', color: '#f08a3c', configDir: '~/.claude', sessions: 1, usageStatus: 'ok' }],
  meta: { demo: true, sources: [], startedAt: T0, version: 't' },
});

function run(sim: Sim, clock: { now: number }, seconds: number, until?: () => boolean): void {
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    clock.now += 1000 / 30;
    sim.update(1 / 30, clock.now);
    if (until?.()) return;
  }
}

const IDS = ['ana', 'bia', 'caio', 'davi'];

/** Four idle agents (two rooms), settled at their desks, and one forced game. */
function stage(kind: Parameters<Sim['social']['force']>[0], n: number): { sim: Sim; clock: { now: number }; g: Gathering } {
  const sim = new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'calm' }));
  const clock = { now: T0 };
  sim.applySnapshot(snap([room('/a', 0), room('/b', 1)], IDS.map((id, i) => agent(id, i % 2 ? '/b' : '/a'))), clock.now);
  run(sim, clock, 0.3);
  expect(sim.social.force(kind, clock.now, IDS.slice(0, n))).toHaveLength(n);
  const g = [...sim.social.gatherings].find((x) => x.kind === kind)!;
  return { sim, clock, g };
}

const areaOf = (sim: Sim, spotId: string | null) => (spotId ? sim.spots.get(spotId)?.areaId : undefined);

describe('ala de lazer: rodas', () => {
  it('sinuca: dois jogadores nas pontas da mesa revezam tacadas até um encaçapar a bola oito', () => {
    const { sim, clock, g } = stage('billiards', 2);
    expect(players(g)).toHaveLength(2);
    for (const m of players(g)) expect(sim.spots.get(m.spot)?.kind).toBe('pool');
    // the crowd's places are around the pool table
    run(sim, clock, 90, () => g.phase === 'run');
    expect(g.phase).toBe('run');
    // both hold a cue; whoever has the table bends over it
    let sawShot = false;
    run(sim, clock, 240, () => {
      if (g.phase === 'run') for (const m of players(g)) expect(m.held).toBe('cue');
      if (g.shot) sawShot = true;
      return g.phase !== 'run';
    });
    expect(sawShot).toBe(true);
    expect(g.winner).not.toBeNull();
    expect(Math.max(...g.score)).toBe(TARGET.billiards);
    expect(g.shot!.n).toBeGreaterThanOrEqual(TARGET.billiards!);
    const ev = sim.social.events.find((e) => e.icon === '🎱');
    expect(ev?.place).toBe('Salão de sinuca');
  });

  it('pickleball: um jogador de cada lado da rede, raquete na mão, até sete pontos', () => {
    const { sim, clock, g } = stage('pickleball', 2);
    const [a, b] = players(g).map((m) => sim.spots.get(m.spot)!);
    expect(a.kind).toBe('pickleball');
    expect(b.kind).toBe('pickleball');
    expect(a.areaId).toBe(COURT_ID);
    expect(Math.sign(a.x - b.x)).not.toBe(0);
    run(sim, clock, 90, () => g.phase === 'run');
    for (const m of players(g)) expect([m.pose, m.held]).toEqual(['play', 'paddle']);
    expect(sim.social.courtScore()).toEqual([0, 0]);
    run(sim, clock, 240, () => g.phase !== 'run');
    expect(Math.max(...g.score)).toBe(TARGET.pickleball);
    expect(g.winner).not.toBeNull();
  });

  it('karaokê: quem chamou canta no palco com o microfone, a plateia assiste, e no fim sai a nota', () => {
    const { sim, clock, g } = stage('karaoke', 4);
    const singers = players(g);
    expect(singers.length).toBeGreaterThanOrEqual(1);
    for (const s of singers) expect(sim.spots.get(s.spot)?.kind).toBe('stage');
    for (const m of active(g).filter((x) => x.role === 'watcher')) expect(areaOf(sim, m.spot)).toBe(KARAOKE_ID);
    // nobody stands on the unused half of the stage
    expect(active(g).filter((m) => sim.spots.get(m.spot)?.kind === 'stage')).toHaveLength(singers.length);
    run(sim, clock, 90, () => g.phase === 'run');
    expect(g.phase).toBe('run');
    expect(sim.social.karaokeLive()).toBe(true);
    for (const s of singers) expect([s.pose, s.held]).toEqual(['sing', 'mic']);
    run(sim, clock, 90, () => g.phase !== 'run');
    const ev = sim.social.events.find((e) => e.icon === '🎤');
    expect(ev?.text).toMatch(/^cantou no karaokê e tirou nota \d+$/);
    expect(sim.social.floaters.some((f) => f.text.startsWith('🎤 '))).toBe(true);
  });

  it('cafeteria: o papo é nas mesinhas da cafeteria, frente a frente', () => {
    const { sim, clock, g } = stage('coffeebar', 2);
    const [s1, s2] = active(g).map((m) => sim.spots.get(m.spot)!);
    expect(s1.areaId).toBe(COFFEEBAR_ID);
    expect(s2.areaId).toBe(COFFEEBAR_ID);
    expect(s1.ty).toBe(s2.ty);
    expect(Math.abs(s1.tx - s2.tx)).toBe(2);
    expect(new Set([s1.dir, s2.dir])).toEqual(new Set(['left', 'right']));
    run(sim, clock, 120, () => g.phase === 'run');
    expect(g.phase).toBe('run');
    for (const m of active(g)) expect(m.pose).toBe('sit');
  });

  it('a torcida de cada jogo fica na sala dele (pingue-pongue: o lounge ou uma sala de pingue-pongue)', () => {
    const { sim } = stage('talk', 2);
    const ch = sim.chars.get('caio')!;
    for (const [kind, areas] of [
      ['pingpong', [LOUNGE_ID, 'amenity:']],
      ['billiards', [BILLIARDS_ID]],
      ['pickleball', [COURT_ID]],
      ['karaoke', [KARAOKE_ID]],
    ] as const) {
      const plan = sim.social.plan(kind, 4, ch)!;
      expect(plan, kind).not.toBeNull();
      // players and crowd in one room, and the right kind of room
      const area = plan.pool[0].areaId;
      expect(areas.some((a) => area.startsWith(a)), `${kind}: ${area}`).toBe(true);
      for (const s of plan.pool) expect(s.areaId, `${kind}: ${s.id}`).toBe(area);
    }
  });

  it('sem ninguém forçar, sinuca e pickleball acontecem sozinhos com gente ociosa', () => {
    const seen: Record<string, number> = {};
    for (let trial = 0; trial < 6; trial++) {
      const sim = new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'normal' }));
      let now = T0;
      sim.applySnapshot(snap([room('/a', 0), room('/b', 1)], ['ana', 'bia', 'caio'].map((id, i) => agent(`${id}${trial}`, i % 2 ? '/b' : '/a'))), now);
      const ids = new Set<number>();
      for (let i = 0; i < 30 * 60 * 10; i++) {
        now += 100;
        sim.update(0.1, now);
        for (const g of sim.social.gatherings) {
          if (g.phase !== 'run' || ids.has(g.id)) continue;
          ids.add(g.id);
          seen[g.kind] = (seen[g.kind] ?? 0) + 1;
        }
      }
    }
    expect(seen.billiards ?? 0).toBeGreaterThan(0);
    expect(seen.pickleball ?? 0).toBeGreaterThan(0);
  }, 60_000);
});

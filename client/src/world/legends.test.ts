import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../shared/hash';
import { CREATURE_SPECIES } from '../art/creatures';
import { HOUSE_W, houseH, TILE } from './constants';
import { FLY_ALT, LEGEND_CAP, LEGEND_INFO, legendSky, legendZones, Legends, pickVariant, VIEW_MARGIN } from './legends';

const FLOORS = 3;
const inside = (r: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= r.x - 0.01 && y >= r.y - 0.01 && x <= r.x + r.w + 0.01 && y <= r.y + r.h + 0.01;

/** Steps the herd for `seconds` (100 ms ticks), calling `each` after every tick. */
function simulate(l: Legends, start: number, seconds: number, each?: (now: number) => void): number {
  let now = start;
  for (let i = 0; i < seconds * 10; i++) {
    now += 100;
    l.update(now, 0.1);
    each?.(now);
  }
  return now;
}

describe('criaturas lendárias', () => {
  it('os habitats ficam onde a câmera alcança e fora do prédio', () => {
    const W = HOUSE_W * TILE;
    const H = houseH(FLOORS) * TILE;
    const view = { x: -VIEW_MARGIN.side * TILE, y: -VIEW_MARGIN.top * TILE, w: W + 2 * VIEW_MARGIN.side * TILE, h: H + (VIEW_MARGIN.top + VIEW_MARGIN.bottom) * TILE };
    for (const z of legendZones(FLOORS)) {
      expect(z.w).toBeGreaterThan(TILE);
      for (const [x, y] of [
        [z.x, z.y],
        [z.x + z.w, z.y + z.h],
      ])
        expect(inside(view, x, y)).toBe(true);
      // no overlap with the building
      expect(z.x + z.w <= 0 || z.x >= W || z.y + z.h <= 0 || z.y >= H).toBe(true);
    }
    expect(inside(view, legendSky(FLOORS).x, legendSky(FLOORS).y - FLY_ALT)).toBe(true);
  });

  it('dois aparecem logo; nunca passam do limite nem repetem espécie; quem anda fica no seu habitat', () => {
    const l = new Legends(mulberry32(7));
    l.layout(FLOORS);
    l.update(1_000, 0.1);
    expect(l.list).toHaveLength(2);
    const zones = legendZones(FLOORS);
    simulate(l, 1_000, 40 * 60, () => {
      const out = l.list.filter((c) => !c.leaving);
      expect(out.length).toBeLessThanOrEqual(LEGEND_CAP);
      expect(new Set(l.list.map((c) => c.species)).size).toBe(l.list.length);
      for (const c of l.list) if (!c.flies) expect(inside(zones[c.zone], c.x, c.y), `${c.species} out of its habitat`).toBe(true);
    });
  });

  it('cada um vai embora depois de alguns minutos e outros aparecem', () => {
    const l = new Legends(mulberry32(11));
    l.layout(FLOORS);
    const seen = new Set<number>();
    simulate(l, 0, 60 * 60, () => l.list.forEach((c) => seen.add(c.uid)));
    expect(seen.size).toBeGreaterThan(LEGEND_CAP * 2);
    expect(new Set([...l.list.map((c) => c.species)]).size).toBe(l.list.length);
  });

  it('voadores cruzam o céu e saem pela borda do mapa', () => {
    const l = new Legends(mulberry32(3));
    l.layout(FLOORS);
    const bird = l.spawn(0, 'pyrewing')!;
    expect(bird.flies).toBe(true);
    let moved = 0;
    let lastX = bird.x;
    simulate(l, 0, 60, () => {
      moved += Math.abs(bird.x - lastX);
      lastX = bird.x;
    });
    expect(moved).toBeGreaterThan(LEGEND_INFO.pyrewing.speed * 30);
    bird.leaveAt = 0;
    simulate(l, 60_000, 120);
    expect(l.get(bird.uid)).toBeUndefined();
  });

  it('o Umbralynx às vezes some e reaparece mais adiante, em vez de andar', () => {
    const l = new Legends(mulberry32(5));
    l.layout(FLOORS);
    const lynx = l.spawn(0, 'umbralynx')!;
    let blinked = false;
    simulate(l, 0, 300, () => {
      if (lynx.blink) blinked = true;
    });
    expect(blinked).toBe(true);
  });

  it('o clique acha a criatura pelo corpo e ignora o vazio', () => {
    const l = new Legends(mulberry32(9));
    l.layout(FLOORS);
    const c = l.spawn(0, 'voltfang')!;
    c.alpha = 1;
    expect(l.hit(c.x, c.y - 12)?.uid).toBe(c.uid);
    expect(l.hit(c.x + 60, c.y - 12)).toBeNull();
    c.alpha = 0;
    expect(l.hit(c.x, c.y - 12)).toBeNull();
  });

  it('variações raras: brilhante, sombra e metálico aparecem pouco', () => {
    expect(pickVariant(() => 0.01)).toBe('shiny');
    expect(pickVariant(() => 0.1)).toBe('shadow');
    expect(pickVariant(() => 0.15)).toBe('metallic');
    expect(pickVariant(() => 0.5)).toBe('normal');
    const rng = mulberry32(1);
    const n = Array.from({ length: 4000 }, () => pickVariant(rng)).filter((v) => v !== 'normal').length;
    expect(n / 4000).toBeGreaterThan(0.12);
    expect(n / 4000).toBeLessThan(0.24);
  });

  it('toda espécie tem ficha completa', () => {
    for (const s of CREATURE_SPECIES) {
      const info = LEGEND_INFO[s];
      expect(info.name).toMatch(/^[A-Z][a-z]+$/);
      expect(info.types.length).toBeGreaterThan(0);
      expect(info.level[0]).toBeLessThan(info.level[1]);
      expect(info.blurb.length).toBeGreaterThan(20);
    }
  });
});

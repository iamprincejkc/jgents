// Legendary creatures roaming the grounds around the office. Decoration only (like the cars on the
// street): they never enter the building or touch the simulation. A few are out at a time, each
// ground creature in its own habitat (the meadow along the north wall, the lawns west and east of the
// building, all inside the part of the grounds the camera can show); flyers cross the sky over the
// whole building. After a few minutes a creature leaves (fades out, or flies off the map) and another
// may turn up later. Rare colour variants (shiny, shadow, metallic) show up now and then. Which
// creatures there are comes from the catalog (world/creature-catalog.ts): the built-in ones, the owner's
// creature pack, or both; when that changes, the grounds clear and fill again. Pure: no DOM, testable in node.
import type { CreatureVariant } from '../art/creatures';
import { BUILTIN_CREATURES, CreatureCatalog, type CreatureDef } from './creature-catalog';
import { EXT_EAST, EXT_NORTH, EXT_SOUTH, EXT_WEST, HOUSE_W, houseH, TILE } from './constants';

export { LEGEND_INFO, TYPE_COLOR, TYPE_LABEL, VARIANT_LABEL, type LegendInfo, type LegendType } from './creature-catalog';

/** How far past the building the camera can pan (tiles; see updateBounds in index.ts). */
export const VIEW_MARGIN = { side: 7, top: 6, bottom: 12 } as const;

/** Odds of each colour variant when a creature turns up. */
export const VARIANT_ODDS: readonly (readonly [CreatureVariant, number])[] = [
  ['shiny', 0.07],
  ['shadow', 0.06],
  ['metallic', 0.05],
];

/** How many roam at once, how often a new one may turn up and how long each stays (ms). */
export const LEGEND_CAP = 3;
const SPAWN_GAP: readonly [number, number] = [25_000, 55_000];
const STAY: readonly [number, number] = [150_000, 330_000];
const FADE_MS = 1_200;
/** Flyers cruise this high above their shadow (px), bobbing a little. */
export const FLY_ALT = 38;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Legend {
  uid: number;
  /** Creature id in the catalog (a built-in species or `pack:<file>`). */
  species: string;
  variant: CreatureVariant;
  level: number;
  flies: boolean;
  /** Ground point (px of world): the feet of a walker, the shadow of a flyer. */
  x: number;
  y: number;
  /** Height above the ground (px; 0 for walkers). */
  alt: number;
  /** -1 = facing left (the sprite's own direction), 1 = right. */
  dir: -1 | 1;
  moving: boolean;
  zone: number;
  tx: number;
  ty: number;
  restUntil: number;
  bornAt: number;
  leaveAt: number;
  leaving: boolean;
  /** 0..1: fades in when it turns up and out when it leaves (or blinks away, for a creature that blinks). */
  alpha: number;
  /** A creature that blinks (Umbralynx): mid-teleport (fading out, then in at the target). */
  blink: 'out' | 'in' | null;
  /** Animation clock offset, so two of a kind do not move in lockstep. */
  phase: number;
}

const rand = (rng: () => number, a: number, b: number) => a + rng() * (b - a);

function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
}

/**
 * Habitats (px of world) around a house `floors` floors tall, all where the camera can reach: the
 * meadow along the north wall, the lawn west of the entrance path, the lawn east of the building.
 */
export function legendZones(floors: number): Rect[] {
  const T = TILE;
  const w = HOUSE_W;
  const BUILDING_H = houseH(floors);
  const side = VIEW_MARGIN.side - 1;
  return [
    { x: -side * T, y: -5 * T, w: (w + 2 * side) * T, h: 3.6 * T },
    // west of the entrance path (x -3..0) and its bench
    { x: -(side + 0.5) * T, y: 1 * T, w: 2.9 * T, h: (BUILDING_H - 1) * T },
    { x: (w + 1.5) * T, y: 1 * T, w: (side - 2) * T, h: (BUILDING_H - 1) * T },
  ];
}

/** Share of ground creatures that turn up in each habitat (the north meadow is the most visible). */
const ZONE_ODDS = [0.5, 0.25, 0.25] as const;

/** The whole drawn map (px of world): a flyer enters and leaves past its edges. */
export function legendBounds(floors: number): Rect {
  const T = TILE;
  return { x: -EXT_WEST * T, y: -EXT_NORTH * T, w: (HOUSE_W + EXT_WEST + EXT_EAST) * T, h: (houseH(floors) + EXT_NORTH + EXT_SOUTH) * T };
}

/** The sky flyers cruise in: the part of the map the camera can show (over the building too). */
export function legendSky(floors: number): Rect {
  const T = TILE;
  return { x: -VIEW_MARGIN.side * T, y: -VIEW_MARGIN.top * T + FLY_ALT, w: (HOUSE_W + 2 * VIEW_MARGIN.side) * T, h: (houseH(floors) + VIEW_MARGIN.top + VIEW_MARGIN.bottom) * T - FLY_ALT };
}

export function pickVariant(rng: () => number): CreatureVariant {
  let r = rng();
  for (const [v, p] of VARIANT_ODDS) {
    if (r < p) return v;
    r -= p;
  }
  return 'normal';
}

export class Legends {
  readonly list: Legend[] = [];
  private zones: Rect[] = [];
  private bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private sky: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private nextSpawnAt = 0;
  private seq = 0;
  private started = false;
  private catalogVersion: number;

  constructor(
    private readonly rng: () => number = Math.random,
    readonly catalog: CreatureCatalog = new CreatureCatalog(),
  ) {
    this.catalogVersion = catalog.version;
  }

  /** What a creature on the grounds is (a creature whose kind left the catalog reads as the first built-in). */
  def(l: Pick<Legend, 'species'>): CreatureDef {
    return this.catalog.get(l.species) ?? BUILTIN_CREATURES[0];
  }

  /** (Re)computes the habitats for the current building width; keeps every walker inside its own. */
  layout(floors: number): void {
    this.zones = legendZones(floors);
    this.bounds = legendBounds(floors);
    this.sky = legendSky(floors);
    for (const l of this.list) {
      if (l.flies) continue;
      const z = this.zones[l.zone];
      if (z && !inside(z, l.x, l.y)) {
        [l.x, l.y] = this.pointIn(z);
        [l.tx, l.ty] = [l.x, l.y];
      }
    }
  }

  /** Removes everyone (the option was switched off). */
  clear(): void {
    this.list.length = 0;
    this.started = false;
  }

  update(now: number, dt: number): void {
    if (!this.zones.length) return;
    if (this.catalogVersion !== this.catalog.version) {
      // other creatures now: the grounds clear and the new ones turn up
      this.catalogVersion = this.catalog.version;
      this.clear();
    }
    const step = Math.min(dt, 0.1);
    if (!this.started) {
      // the first two turn up right away, the third a little later
      this.started = true;
      this.spawn(now);
      this.spawn(now);
      this.nextSpawnAt = now + rand(this.rng, ...SPAWN_GAP);
    } else if (now >= this.nextSpawnAt) {
      this.nextSpawnAt = now + rand(this.rng, ...SPAWN_GAP);
      if (this.list.filter((l) => !l.leaving).length < LEGEND_CAP) this.spawn(now);
    }
    for (const l of this.list) this.tick(l, now, step);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const l = this.list[i];
      if (l.leaving && l.alpha <= 0) this.list.splice(i, 1);
      else if (l.leaving && l.flies && !inside(this.grow(this.bounds, 80), l.x, l.y - l.alt)) this.list.splice(i, 1);
    }
  }

  /** The creature drawn at a point of the world (px), if any: the frontmost one wins. */
  hit(x: number, y: number): Legend | null {
    let best: Legend | null = null;
    for (const l of this.list) {
      if (l.alpha < 0.3) continue;
      const box = this.def(l).box;
      const cy = l.y - l.alt - box.cy;
      if (Math.abs(x - l.x) > box.w / 2 || Math.abs(y - cy) > box.h / 2) continue;
      if (!best || l.y > best.y) best = l;
    }
    return best;
  }

  get(uid: number): Legend | undefined {
    return this.list.find((l) => l.uid === uid);
  }

  /** Spawns one (a kind not already out); returns it, or null when every kind is out (or `species` is unknown). */
  spawn(now: number, species?: string, variant?: CreatureVariant): Legend | null {
    const out = new Set(this.list.map((l) => l.species));
    const free = this.catalog.active().filter((d) => !out.has(d.id));
    const info = species !== undefined ? this.catalog.get(species) : free[Math.floor(this.rng() * free.length)];
    if (!info) return null;
    const sp = info.id;
    const flies = info.flies;
    const zone = this.pickZone();
    let x: number;
    let y: number;
    if (flies) {
      // flies in from one side of the map
      const west = this.rng() < 0.5;
      x = west ? this.bounds.x - 30 : this.bounds.x + this.bounds.w + 30;
      y = this.sky.y + rand(this.rng, 0.1, 0.9) * this.sky.h;
    } else [x, y] = this.pointIn(this.zones[zone]);
    const l: Legend = {
      uid: ++this.seq,
      species: sp,
      variant: variant ?? pickVariant(this.rng),
      level: Math.round(rand(this.rng, info.level[0], info.level[1])),
      flies,
      x,
      y,
      alt: flies ? FLY_ALT : 0,
      dir: this.rng() < 0.5 ? -1 : 1,
      moving: flies,
      zone,
      tx: x,
      ty: y,
      restUntil: now + rand(this.rng, 1_500, 4_000),
      bornAt: now,
      leaveAt: now + rand(this.rng, ...STAY),
      leaving: false,
      alpha: flies ? 1 : 0,
      blink: null,
      phase: Math.floor(this.rng() * 10_000),
    };
    if (flies) this.retarget(l);
    this.list.push(l);
    return l;
  }

  private tick(l: Legend, now: number, dt: number): void {
    // fade in after turning up; fade out (walkers) when leaving or blinking away
    const fade = dt / (FADE_MS / 1000);
    if (l.leaving && !l.flies) l.alpha = Math.max(0, l.alpha - fade);
    else if (l.blink === 'out') {
      l.alpha = Math.max(0, l.alpha - fade * 2.5);
      if (l.alpha <= 0) {
        [l.x, l.y] = [l.tx, l.ty];
        l.blink = 'in';
      }
      return;
    } else if (l.alpha < 1) {
      l.alpha = Math.min(1, l.alpha + fade * (l.blink === 'in' ? 2.5 : 1));
      if (l.alpha >= 1 && l.blink === 'in') {
        l.blink = null;
        l.restUntil = now + rand(this.rng, 2_000, 5_000);
      }
    }
    if (!l.leaving && now >= l.leaveAt) {
      l.leaving = true;
      if (l.flies) {
        // heads off the nearest side of the map
        const west = l.x < this.bounds.x + this.bounds.w / 2;
        l.tx = west ? this.bounds.x - 120 : this.bounds.x + this.bounds.w + 120;
        l.ty = l.y;
      } else l.moving = false;
    }
    if (l.flies) {
      l.alt = FLY_ALT + Math.sin((now + l.phase) / 900) * 4;
      if (this.moveToward(l, this.def(l).speed, dt) && !l.leaving) this.retarget(l);
      return;
    }
    if (l.leaving) return;
    if (!l.moving) {
      if (now < l.restUntil || l.alpha < 1) return;
      this.retarget(l);
      // Umbralynx does not always walk: it blinks out and reappears where it was heading
      if (this.def(l).blinks && this.rng() < 0.4) {
        l.blink = 'out';
        l.dir = l.tx < l.x ? -1 : 1;
        return;
      }
      l.moving = true;
    }
    if (this.moveToward(l, this.def(l).speed, dt)) {
      l.moving = false;
      l.restUntil = now + rand(this.rng, 2_500, 7_000);
    }
  }

  /** Moves toward the target; true on arrival. */
  private moveToward(l: Legend, speed: number, dt: number): boolean {
    const dx = l.tx - l.x;
    const dy = l.ty - l.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return true;
    const s = Math.min(d, speed * dt);
    l.x += (dx / d) * s;
    l.y += (dy / d) * s;
    if (Math.abs(dx) > 0.5) l.dir = dx < 0 ? -1 : 1;
    return d - s < 1;
  }

  private retarget(l: Legend): void {
    if (l.flies) {
      const s = this.sky;
      l.tx = s.x + rand(this.rng, 0.05, 0.95) * s.w;
      l.ty = s.y + rand(this.rng, 0.05, 0.95) * s.h;
      return;
    }
    const z = this.zones[l.zone];
    // somewhere 2-9 tiles away, inside the habitat
    for (let i = 0; i < 8; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = rand(this.rng, 2, 9) * TILE;
      const x = l.x + Math.cos(a) * r;
      const y = l.y + Math.sin(a) * r * 0.6;
      if (inside(z, x, y)) {
        [l.tx, l.ty] = [x, y];
        return;
      }
    }
    [l.tx, l.ty] = this.pointIn(z);
  }

  private pickZone(): number {
    let r = this.rng();
    for (let i = 0; i < this.zones.length; i++) {
      r -= ZONE_ODDS[i] ?? 0;
      if (r < 0) return i;
    }
    return 0;
  }

  private pointIn(z: Rect): [number, number] {
    return [z.x + this.rng() * z.w, z.y + this.rng() * z.h];
  }

  private grow(r: Rect, m: number): Rect {
    return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
  }
}

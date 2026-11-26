// Legendary creatures that roam the grounds (pure: drawn into a PixelBuf, like the rest of the art).
// Six original designs, each with an idle and a moving animation, in profile facing LEFT (the world
// mirrors them to face right). Colour variants follow the collectible-monster tradition: the normal
// colours, a rare "shiny" recolour, a dark "shadow" form and a "metallic" form.
//
// Anchor: ground creatures stand with their feet on (ax, ay); flyers are anchored at the centre of
// the body (the world draws them in the air and their shadow on the ground).
import { luminance, mix, ramp, tone } from './core/color';
import { PixelBuf } from './core/pixbuf';
import type { BufSprite } from './core/sprite';

export type CreatureSpecies = 'voltfang' | 'pyrewing' | 'frostantler' | 'tidalray' | 'umbralynx' | 'verdrake';
export type CreatureVariant = 'normal' | 'shiny' | 'shadow' | 'metallic';
export type CreatureMotion = 'idle' | 'move';

export const CREATURE_SPECIES: readonly CreatureSpecies[] = ['voltfang', 'pyrewing', 'frostantler', 'tidalray', 'umbralynx', 'verdrake'];
export const CREATURE_VARIANTS: readonly CreatureVariant[] = ['normal', 'shiny', 'shadow', 'metallic'];

/** Flyers never touch the ground: drawn in the air, with a shadow below. */
export const CREATURE_FLIES: Readonly<Record<CreatureSpecies, boolean>> = {
  voltfang: false,
  pyrewing: true,
  frostantler: false,
  tidalray: true,
  umbralynx: false,
  verdrake: false,
};

/** Frames per motion (flyers flap the same way whether gliding or turning). */
export function creatureFrames(species: CreatureSpecies, motion: CreatureMotion): number {
  if (CREATURE_FLIES[species]) return 4;
  return motion === 'move' ? 4 : 2;
}

/** Frame length (ms). */
export function creatureFrameMs(species: CreatureSpecies, motion: CreatureMotion): number {
  if (CREATURE_FLIES[species]) return species === 'tidalray' ? 210 : 120;
  return motion === 'move' ? 130 : 620;
}

/** Signature glow colour (aura, sparkles, the encounter card). */
export const CREATURE_GLOW: Readonly<Record<CreatureSpecies, string>> = {
  voltfang: '#9ef9ff',
  pyrewing: '#ffcf6a',
  frostantler: '#bff4ff',
  tidalray: '#7ff0ff',
  umbralynx: '#d68cff',
  verdrake: '#b8f58a',
};

const W = 42;
const H = 34;
/** Ground line and body centre of the canvas. */
const FEET = 31;
const MID_Y = 17;

type Pal = Record<string, string>;

const PALETTES: Readonly<Record<CreatureSpecies, Pal>> = {
  voltfang: { fur: '#f4cf3c', furDk: '#d39a1f', furLt: '#fff0a0', mark: '#2c3e72', markLt: '#4a63a8', eye: '#7ff6ff', glow: '#c8fbff', claw: '#f4f1ea' },
  pyrewing: { body: '#e8552a', bodyDk: '#b83a1c', bodyLt: '#ff8a4c', gold: '#ffd25a', flame: '#ffe08a', hot: '#fff6d0', beak: '#ffcf4a', eye: '#2a1206', tail: '#ff6a2a' },
  frostantler: { coat: '#dff3ff', coatDk: '#9fcbea', coatLt: '#ffffff', crystal: '#6fd8ff', crystalLt: '#d6fbff', hoof: '#5b7fa6', eye: '#1d3d6e', glow: '#e8fdff' },
  tidalray: { top: '#2a6fb8', topDk: '#1d4f8a', edge: '#5fb0f0', belly: '#bfe6ff', rune: '#7ff0ff', eye: '#d6fbff' },
  umbralynx: { fur: '#2e2444', furDk: '#1a1428', furLt: '#4f3d74', moon: '#f5d76e', eye: '#ff4fd8', tuft: '#0e0a18', wisp: '#9a63e8' },
  verdrake: { scale: '#4cae6a', scaleDk: '#2f7a46', scaleLt: '#8fd78f', leaf: '#79c84a', leafDk: '#4f9a2e', flower: '#ff8ac0', flowerC: '#ffe066', eye: '#1d2a14', belly: '#d8f0b0' },
};

/** Keys that keep their colour (or get their own) in every variant: eyes and magic glows. */
const KEEP = new Set(['eye', 'glow', 'rune', 'hot', 'flowerC']);

function variantPalette(base: Pal, v: CreatureVariant): Pal {
  if (v === 'normal') return base;
  const out: Pal = {};
  for (const [k, c] of Object.entries(base)) {
    if (KEEP.has(k)) {
      out[k] = v === 'shadow' && k === 'eye' ? '#ff3b4a' : c;
      continue;
    }
    if (v === 'shiny') out[k] = tone(c, { h: 150, s: 0.05 });
    else if (v === 'shadow') out[k] = tone(mix(c, '#22163a', 0.62), { s: -0.15 });
    else out[k] = mix('#4f5866', '#f1f5fa', Math.min(1, luminance(c) * 1.25 + 0.08));
  }
  return out;
}

/** Filled triangle (scanline). */
function tri(b: PixelBuf, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: string): void {
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const edges: [number, number, number, number][] = [
    [ax, ay, bx, by],
    [bx, by, cx, cy],
    [cx, cy, ax, ay],
  ];
  for (let y = minY; y <= maxY; y++) {
    const yy = y + 0.5;
    const xs: number[] = [];
    for (const [x0, y0, x1, y1] of edges) {
      if ((yy < y0 && yy < y1) || (yy >= y0 && yy >= y1)) continue;
      xs.push(x0 + ((yy - y0) / (y1 - y0)) * (x1 - x0));
    }
    if (xs.length < 2) continue;
    const a = Math.min(...xs);
    const z = Math.max(...xs);
    for (let x = Math.round(a); x < Math.round(z); x++) b.set(x, y, c);
  }
}

function leg(b: PixelBuf, x: number, top: number, dx: number, c: string, foot: string): void {
  b.line(x, top, x + dx, FEET - 1, c, 2);
  b.rect(x + dx, FEET - 1, 2, 1, foot);
}

// ------------------------------------------------------------------ species

function voltfang(b: PixelBuf, p: Pal, f: number, move: boolean): void {
  const bob = move ? (f % 2) : f;
  const swing = move ? [2, 0, -2, 0][f] : 0;
  const y = -bob;
  // Lightning-bolt tail.
  b.line(29, 18 + y, 33, 13 + y, p.furLt, 2);
  b.line(33, 13 + y, 31, 12 + y, p.furLt, 2);
  b.line(31, 12 + y, 36, 5 + y, p.furLt, 2);
  b.set(37, 4 + y, p.glow);
  // Far legs (darker), then the body.
  leg(b, 13, 23 + y, -swing, p.furDk, p.mark);
  leg(b, 25, 23 + y, swing, p.furDk, p.mark);
  b.ellipse(20, 20 + y, 9.5, 5.5, p.fur);
  b.ellipse(19, 23 + y, 7, 2.4, p.furLt);
  for (const x of [18, 21, 24]) {
    b.line(x, 15 + y, x + 1, 17 + y, p.mark);
    b.set(x + 1, 15 + y, p.markLt);
  }
  // Near legs.
  leg(b, 16, 23 + y, swing, p.fur, p.mark);
  leg(b, 27, 23 + y, -swing, p.fur, p.mark);
  // Neck, mane spikes and head.
  b.ellipse(12, 16 + y, 4.5, 5, p.fur);
  tri(b, 13, 13 + y, 16, 13 + y, 16, 8 + y, p.mark);
  tri(b, 11, 12 + y, 14, 12 + y, 12, 7 + y, p.mark);
  b.ellipse(8, 13 + y, 5, 4.4, p.fur);
  b.ellipse(4, 15 + y, 3, 1.8, p.furLt);
  b.set(1, 14 + y, p.mark);
  tri(b, 6, 10 + y, 9, 10 + y, 7, 4 + y, p.fur);
  b.set(7, 7 + y, p.mark);
  tri(b, 9, 10 + y, 12, 10 + y, 11, 5 + y, p.fur);
  b.rect(5, 12 + y, 2, 1, p.eye);
  b.set(5, 11 + y, '#ffffff');
  b.line(8, 15 + y, 10, 17 + y, p.mark);
  // Crackle: a spark that blinks between frames.
  if (f % 2 === 0) {
    b.set(15, 6 + y, p.glow);
    b.set(14, 5 + y, p.glow);
  } else b.set(34, 10 + y, p.glow);
}

function pyrewing(b: PixelBuf, p: Pal, f: number): void {
  const wing = [0, 1, 2, 1][f];
  const y = [0, 1, 2, 1][f] - 1;
  // Long tail feathers with burning tips.
  for (const [ty, c] of [[13, p.tail], [18, p.gold], [23, p.tail]] as const) {
    b.line(25, 18 + y, 37, ty + y, c, 2);
    b.set(38, ty + y, p.flame);
    b.set(39, ty + y + (ty === 18 ? 0 : ty < 18 ? -1 : 1), p.hot);
  }
  // Far wing (behind the body).
  if (wing === 0) tri(b, 18, 15 + y, 27, 14 + y, 25, 1 + y, p.bodyDk);
  else if (wing === 1) tri(b, 18, 15 + y, 28, 15 + y, 32, 8 + y, p.bodyDk);
  else tri(b, 18, 17 + y, 28, 17 + y, 26, 29 + y, p.bodyDk);
  // Body and head.
  b.ellipse(20, 17 + y, 6.5, 3.8, p.body);
  b.ellipse(19, 18.6 + y, 4.8, 1.8, p.bodyLt);
  b.ellipse(13, 14 + y, 3.4, 3, p.body);
  tri(b, 10, 13 + y, 10, 16 + y, 6, 15 + y, p.beak);
  b.set(12, 13 + y, p.eye);
  b.set(12, 12 + y, p.hot);
  // Flame crest.
  b.line(14, 11 + y, 16, 5 + y, p.gold);
  b.line(13, 11 + y, 12, 6 + y, p.flame);
  b.line(15, 12 + y, 19, 8 + y, p.gold);
  b.set(16, 4 + y, p.hot);
  // Near wing, with flame tips along the edge.
  if (wing === 0) {
    tri(b, 17, 16 + y, 25, 16 + y, 20, 0 + y, p.bodyLt);
    for (const [x, yy] of [[20, 1], [21, 4], [22, 8]] as const) b.set(x, yy + y, p.flame);
  } else if (wing === 1) {
    tri(b, 17, 16 + y, 29, 16 + y, 32, 10 + y, p.bodyLt);
    for (const x of [26, 29, 31]) b.set(x, 11 + y + (31 - x) / 3, p.flame);
  } else {
    tri(b, 17, 17 + y, 27, 18 + y, 22, 31 + y, p.bodyLt);
    for (const [x, yy] of [[22, 30], [23, 27], [24, 24]] as const) b.set(x, yy + y, p.flame);
  }
}

function frostantler(b: PixelBuf, p: Pal, f: number, move: boolean): void {
  const swing = move ? [2, 0, -2, 0][f] : 0;
  const y = move ? -(f % 2) : 0;
  const nod = !move && f === 1 ? 1 : 0;
  // Far legs.
  leg(b, 12, 21 + y, -swing, p.coatDk, p.hoof);
  leg(b, 25, 21 + y, swing, p.coatDk, p.hoof);
  // Body with frost on the back.
  b.ellipse(20, 18 + y, 9.5, 4.6, p.coat);
  b.ellipse(21, 20.5 + y, 8, 2.2, p.coatDk);
  for (const x of [17, 21, 25]) b.set(x, 14 + y, p.crystal);
  b.set(29, 16 + y, p.coatLt);
  b.set(30, 15 + y, p.coatLt);
  // Near legs.
  leg(b, 15, 21 + y, swing, p.coat, p.hoof);
  leg(b, 27, 21 + y, -swing, p.coat, p.hoof);
  // Neck and head.
  b.line(13, 17 + y, 9, 11 + y + nod, p.coat, 3);
  b.ellipse(8, 10 + y + nod, 3.6, 2.8, p.coat);
  b.ellipse(5, 11.5 + y + nod, 2.2, 1.5, p.coatLt);
  b.set(3, 11 + y + nod, p.hoof);
  b.set(8, 9 + y + nod, p.eye);
  tri(b, 10, 8 + y + nod, 13, 8 + y + nod, 13, 5 + y + nod, p.coat);
  // Crystal antlers.
  const ay = y + nod;
  b.line(8, 7 + ay, 6, 1 + ay, p.crystal);
  b.line(7, 4 + ay, 4, 2 + ay, p.crystal);
  b.line(6, 2 + ay, 8, 0 + ay, p.crystalLt);
  b.line(10, 7 + ay, 12, 1 + ay, p.crystal);
  b.line(11, 4 + ay, 14, 2 + ay, p.crystalLt);
  b.set(12, 0 + ay, p.glow);
  // Drifting snowflakes.
  const s = f % 2 === 0 ? [[33, 6], [2, 20]] : [[35, 9], [4, 23]];
  for (const [sx, sy] of s) {
    b.set(sx, sy, p.glow);
    b.set(sx - 1, sy, 'rgba(232,253,255,0.6)');
    b.set(sx + 1, sy, 'rgba(232,253,255,0.6)');
  }
}

function tidalray(b: PixelBuf, p: Pal, f: number): void {
  const flap = [0, 2, 4, 2][f];
  const cy = 12;
  // Tail, waving.
  b.line(30, cy, 34, cy + (f % 2 ? 1 : -1), p.topDk);
  b.line(34, cy + (f % 2 ? 1 : -1), 40, cy, p.topDk);
  // Wings (seen from above): the tips fold in and out as it flaps.
  tri(b, 6, cy, 31, cy, 21, 1 + flap, p.top);
  tri(b, 6, cy + 1, 31, cy + 1, 21, 24 - flap, p.top);
  b.line(6, cy, 21, 1 + flap, p.edge);
  b.line(6, cy + 1, 21, 24 - flap, p.edge);
  b.line(21, 1 + flap, 31, cy, p.topDk);
  b.line(21, 24 - flap, 31, cy + 1, p.topDk);
  // Ridge, cephalic lobes and glowing eyes.
  b.ellipse(16, cy + 0.5, 7, 2.4, p.topDk);
  b.line(6, cy - 1, 3, cy - 2, p.topDk);
  b.line(6, cy + 2, 3, cy + 3, p.topDk);
  b.set(8, cy - 1, p.eye);
  b.set(8, cy + 2, p.eye);
  // Glowing runes along the wings.
  for (const [x, dy] of [[14, -5], [18, -7], [23, -4], [14, 6], [18, 8], [23, 5]] as const) {
    const yy = cy + dy + (dy < 0 ? Math.round(flap / 2) : -Math.round(flap / 2));
    b.set(x, yy, p.rune);
  }
}

function umbralynx(b: PixelBuf, p: Pal, f: number, move: boolean): void {
  const swing = move ? [2, 0, -2, 0][f] : 0;
  const y = move ? -(f % 2) : 0;
  // Short tail with a violet glow.
  b.line(27, 18 + y, 31, 14 + y, p.furLt, 2);
  b.set(32, 13 + y, p.wisp);
  // Far legs and body.
  leg(b, 12, 23 + y, -swing, p.furDk, p.tuft);
  leg(b, 23, 23 + y, swing, p.furDk, p.tuft);
  b.ellipse(19, 21 + y, 8.5, 5, p.fur);
  b.line(13, 17 + y, 25, 17 + y, p.furLt);
  leg(b, 15, 23 + y, swing, p.fur, p.tuft);
  leg(b, 25, 23 + y, -swing, p.fur, p.tuft);
  // Head with cheek ruff and tufted ears.
  b.ellipse(9, 14 + y, 4.6, 4, p.fur);
  tri(b, 6, 16 + y, 3, 19 + y, 9, 18 + y, p.furLt);
  tri(b, 6, 11 + y, 9, 11 + y, 7, 4 + y, p.fur);
  b.line(7, 4 + y, 7, 2 + y, p.tuft);
  tri(b, 10, 11 + y, 13, 11 + y, 12, 5 + y, p.fur);
  b.line(12, 5 + y, 13, 3 + y, p.tuft);
  b.rect(5, 13 + y, 2, 1, p.eye);
  b.set(5, 12 + y, '#ffffff');
  b.set(4, 15 + y, p.tuft);
  // Crescent moon on the forehead.
  b.set(9, 11 + y, p.moon);
  b.set(10, 10 + y, p.moon);
  b.set(11, 11 + y, p.moon);
  // Shadow wisps curling at its feet.
  const wy = FEET - 2 - (f % 2);
  for (const x of f % 2 ? [10, 21, 29] : [8, 18, 27]) b.set(x, wy, p.wisp);
}

function verdrake(b: PixelBuf, p: Pal, f: number, move: boolean): void {
  const swing = move ? [2, 0, -2, 0][f] : 0;
  const y = move ? -(f % 2) : 0;
  const flutter = !move && f === 1 ? -1 : 0;
  // Curling tail with a flower at the tip.
  b.line(26, 22 + y, 32, 21 + y, p.scale, 2);
  b.line(32, 21 + y, 35, 16 + y, p.scale, 2);
  for (const [dx, dy] of [[0, -2], [2, 0], [0, 2], [-2, 0]] as const) b.set(36 + dx, 14 + y + dy, p.flower);
  b.set(36, 14 + y, p.flowerC);
  // Far legs, body and belly scutes.
  leg(b, 13, 22 + y, -swing, p.scaleDk, p.scaleDk);
  leg(b, 24, 22 + y, swing, p.scaleDk, p.scaleDk);
  b.ellipse(19, 20 + y, 8, 5, p.scale);
  b.ellipse(18, 22.5 + y, 6, 2.2, p.belly);
  for (const x of [15, 18, 21]) b.set(x, 22 + y, p.scaleLt);
  // Folded leaf wings on the back.
  tri(b, 16, 16 + y, 28, 15 + y, 24, 7 + y + flutter, p.leaf);
  b.line(17, 16 + y, 24, 8 + y + flutter, p.leafDk);
  tri(b, 18, 16 + y, 27, 16 + y, 28, 10 + y + flutter, p.leafDk);
  // Near legs.
  leg(b, 16, 22 + y, swing, p.scale, p.scaleDk);
  leg(b, 26, 22 + y, -swing, p.scale, p.scaleDk);
  // Neck, head, snout, leaf horns and a vine whisker.
  b.ellipse(11, 16 + y, 3.6, 3.6, p.scale);
  b.ellipse(7, 12 + y, 4, 3.2, p.scale);
  b.ellipse(3.5, 13.5 + y, 2.5, 1.6, p.scaleLt);
  b.set(2, 13 + y, p.scaleDk);
  b.set(6, 11 + y, p.eye);
  b.set(6, 10 + y, '#ffffff');
  b.line(8, 9 + y, 10, 5 + y, p.leaf);
  b.line(6, 9 + y, 5, 5 + y, p.leaf);
  b.line(3, 15 + y, 1, 18 + y, p.leafDk);
}

// ------------------------------------------------------------------ render

/**
 * One frame of a creature, facing left. Ground creatures: anchor at the feet; flyers: anchor at the
 * body centre (no shadow in the sprite).
 */
export function renderCreature(species: CreatureSpecies, variant: CreatureVariant, motion: CreatureMotion, frame: number): BufSprite {
  const n = creatureFrames(species, motion);
  const f = ((Math.floor(frame) % n) + n) % n;
  const p = variantPalette(PALETTES[species], variant);
  const b = new PixelBuf(W, H);
  const move = motion === 'move';
  switch (species) {
    case 'voltfang':
      voltfang(b, p, f, move);
      break;
    case 'pyrewing':
      pyrewing(b, p, f);
      break;
    case 'frostantler':
      frostantler(b, p, f, move);
      break;
    case 'tidalray':
      tidalray(b, p, f);
      break;
    case 'umbralynx':
      umbralynx(b, p, f, move);
      break;
    case 'verdrake':
      verdrake(b, p, f, move);
      break;
  }
  b.outline();
  const flies = CREATURE_FLIES[species];
  if (!flies) b.shadow(W / 2 - 1, FEET + 0.5, 11, 2, '#1c2034', 0.24);
  return { buf: b, ax: W / 2, ay: flies ? MID_Y : FEET };
}

/** Ramp of the creature's main colour in a variant (for UI accents). */
export function creatureAccent(species: CreatureSpecies, variant: CreatureVariant): string {
  const p = variantPalette(PALETTES[species], variant);
  const main = Object.values(p)[0];
  return ramp(main, 0.08).base;
}

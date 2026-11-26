// Entertainment wing: billiards club, coffee bar, pickleball court and karaoke stage.
// Floor pieces use footprint coordinates (base at y = h*TILE); wall pieces use wall coordinates
// (x = 0 at the left edge of the wall span, y = 0 at the baseboard, face from y = -32 to 0).
// Same 3/4 conventions as the rest of the art: light from the top/left, 1px blue-grey outline.
import { mix, ramp, type Ramp } from '../core/color';
import { NEON_COLORS } from '../api';
import type { PixelBuf } from '../core/pixbuf';
import { floorSheet, rectAt, wallSheet, type BufFurniture } from '../core/sprite';
import { glyphBits } from '../pixelfont';
import { M, contact, frontFace, glass, mug, rngOf, topFace, woodGrain } from './kit';

/** Soft shadow cast on the wall below/right of a wall item. */
function wallShadow(b: PixelBuf, x: number, y: number, w: number, h: number): void {
  for (let yy = y + 1; yy <= y + h; yy++) b.under(x + w, yy, 'rgba(30,34,52,0.16)');
  for (let xx = x + 1; xx <= x + w; xx++) b.under(xx, y + h, 'rgba(30,34,52,0.16)');
}

/** Clears the side outline (x = -1 and x = w) so counter modules join seamlessly. */
function seamless(b: PixelBuf, w = 16): void {
  for (let y = -b.oy; y < b.h - b.oy; y++) {
    b.clear(-1, y);
    b.clear(w, y);
  }
}

const WALNUT = ramp('#6e4530', 0.07);
const MARBLE = ramp('#ece8e1', 0.04);
const CHROME = ramp('#c9d0d9', 0.07);

/** Coffee-bar counter: dark walnut front with panels and a pale marble top. */
function barBase(b: PixelBuf): void {
  frontFace(b, 0, 5, 16, 11, WALNUT);
  b.vline(0, 5, 15, WALNUT.lt);
  b.vline(7, 7, 13, WALNUT.dk);
  b.vline(8, 7, 13, WALNUT.lt);
  b.hline(1, 14, 7, WALNUT.dd);
  b.rect(1, 14, 14, 2, '#3e2a20');
  b.hline(1, 14, 13, '#b8894e');
  topFace(b, 0, -3, 16, 7, MARBLE);
  b.hline(0, 15, 4, MARBLE.dk);
  b.hline(0, 15, 3, MARBLE.hi);
  for (const [x, y] of [[2, -1], [12, 0], [6, 1]] as const) b.set(x, y, 'rgba(160,150,140,0.35)');
}

// ------------------------------------------------------------------ billiards

export function poolTable(): BufFurniture {
  const s = floorSheet(4, 2, 10);
  const b = s.buf;
  const rail = ramp('#7a4a2e', 0.07);
  const felt = ramp('#2f8f5b', 0.06);
  // Turned legs.
  for (const x of [3, 57]) {
    b.rect(x, 24, 4, 7, '#4a2c1c');
    b.vline(x, 24, 30, '#6b4430');
    b.hline(x - 1, x + 4, 30, '#3a2216');
  }
  // Apron (front face) with a carved line.
  frontFace(b, 0, 19, 64, 6, rail);
  b.hline(2, 61, 21, rail.dk);
  b.hline(2, 61, 22, rail.lt);
  // Rails.
  topFace(b, 0, -8, 64, 27, rail);
  woodGrain(b, 0, -8, 64, 4, rail, 3);
  woodGrain(b, 0, 15, 64, 4, rail, 5);
  // Felt with cushions and a soft pool of lamp light in the middle.
  b.rect(4, -4, 56, 19, felt.base);
  b.ellipse(32, 5.5, 22, 7, felt.lt);
  b.ellipse(32, 5.5, 12, 4, mix(felt.lt, '#ffffff', 0.08));
  b.hline(4, 59, -4, felt.dd);
  b.vline(4, -4, 14, felt.dk);
  b.vline(59, -4, 14, felt.dk);
  b.hline(4, 59, 14, felt.dk);
  // Head string and spot.
  b.vline(17, -3, 13, 'rgba(240,248,240,0.18)');
  b.set(46, 5, 'rgba(240,248,240,0.45)');
  // Six pockets with leather rims.
  for (const [x, y] of [[3, -5], [58, -5], [3, 13], [58, 13], [30, -6], [30, 14]] as const) {
    b.rect(x, y, x === 30 ? 4 : 3, 3, '#14110e');
    b.hline(x, x + (x === 30 ? 3 : 2), y + 2, '#3a2a1e');
  }
  // Diamond sights on the rails.
  for (const x of [11, 19, 44, 52]) {
    b.set(x, -6, '#efe2c0');
    b.set(x, 17, '#efe2c0');
  }
  for (const y of [1, 8]) {
    b.set(1, y, '#efe2c0');
    b.set(62, y, '#efe2c0');
  }
  b.outline();
  contact(b, 0, 27, 64, 5, 0.26);
  s.rects = { felt: rectAt(s, 5, -3, 54, 17) };
  return { base: s };
}

export function cueRack(): BufFurniture {
  const s = wallSheet(1);
  const b = s.buf;
  const wood = ramp('#7a4a2e', 0.07);
  b.rect(2, -26, 12, 3, wood.base);
  b.hline(2, 13, -26, wood.lt);
  b.rect(2, -9, 12, 3, wood.base);
  b.hline(2, 13, -9, wood.lt);
  // Four cues: blue chalk tip, maple shaft, dark wrapped butt.
  for (const [i, x] of [3, 6, 9, 12].entries()) {
    const top = -29 + (i % 2);
    b.set(x, top, '#7fb3e8');
    b.set(x, top + 1, '#f4f1ea');
    b.vline(x, top + 2, -14, '#ead1a0');
    b.set(x, -15, '#b23a3a');
    b.vline(x, -14, -4, '#3b2a20');
    b.set(x, -4, '#1f1612');
  }
  b.outline();
  wallShadow(b, 1, -27, 14, 24);
  return { base: s };
}

export function dartboard(): BufFurniture {
  const s = wallSheet(1);
  const b = s.buf;
  const cx = 8;
  const cy = -17;
  b.ellipse(cx, cy, 7, 7, '#2a2522');
  for (let y = cy - 6; y <= cy + 6; y++) {
    for (let x = cx - 6; x <= cx + 6; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      if (r > 5.6) continue;
      const seg = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 8) % 2;
      let c = seg ? '#efe3c4' : '#1d1a18';
      if (r > 4.6) c = seg ? '#2f9a55' : '#d0392f';
      else if (r > 2.4 && r < 3.3) c = seg ? '#2f9a55' : '#d0392f';
      if (r < 1.6) c = '#2f9a55';
      if (r < 0.9) c = '#d0392f';
      b.set(x, y, c);
    }
  }
  // Two darts with coloured flights.
  for (const [x, y, c] of [[10, -19, '#3f7fd8'], [6, -15, '#f2c14e']] as const) {
    b.line(x, y, x + 3, y - 3, '#c9d0d9');
    b.set(x + 3, y - 3, c);
    b.set(x + 4, y - 3, c);
    b.set(x + 3, y - 4, c);
  }
  b.outline();
  wallShadow(b, 0, -25, 16, 16);
  return { base: s };
}

const NEON: Readonly<Record<string, { text: string; color: string; under: string }>> = {
  billiards: { text: 'billiards', color: NEON_COLORS.billiards, under: '#ff5c8a' },
  coffee: { text: 'coffee', color: NEON_COLORS.coffee, under: '#fff1c2' },
  karaoke: { text: 'karaoke', color: NEON_COLORS.karaoke, under: '#7c8bff' },
  pickleball: { text: 'pickleball', color: NEON_COLORS.pickleball, under: '#5ef0ff' },
};

/** Neon lettering at 2x scale on a slim dark backing box (readable on any wall colour). */
export function neonSign(variant: string | undefined): BufFurniture {
  const n = NEON[variant ?? 'coffee'] ?? NEON.coffee;
  const s = wallSheet(5);
  const b = s.buf;
  const W = 80;
  const tw = n.text.length * 8 - 2;
  const tx = Math.floor((W - tw) / 2);
  const ty = -24;
  // Backing box with mounting screws.
  b.rect(tx - 5, -28, tw + 10, 19, '#1b1f2b');
  b.hline(tx - 5, tx + tw + 4, -28, '#2e3446');
  b.hline(tx - 5, tx + tw + 4, -10, '#12151e');
  for (const x of [tx - 3, tx + tw + 2]) {
    b.set(x, -26, '#6d7583');
    b.set(x, -12, '#6d7583');
  }
  b.outline();
  wallShadow(b, tx - 6, -29, tw + 12, 20);
  // Each glyph pixel becomes a 2x2 block of tube.
  const blocks = new Set<string>();
  const list: [number, number][] = [];
  [...n.text].forEach((ch, i) => {
    const g = glyphBits(ch);
    for (let k = 0; k < 15; k++) {
      if (g[k] !== '1') continue;
      const gx = tx + i * 8 + (k % 3) * 2;
      const gy = ty + Math.floor(k / 3) * 2;
      blocks.add(`${gx},${gy}`);
      list.push([gx, gy]);
    }
  });
  const halo = `${n.color}55`;
  for (const [x, y] of list) for (const [dx, dy] of [[-1, 0], [2, 0], [0, -1], [1, -1], [0, 2], [1, 2], [-1, 1], [2, 1]] as const) b.set(x + dx, y + dy, halo);
  const hot = mix(n.color, '#ffffff', 0.55);
  for (const [x, y] of list) {
    // Top edge of a stroke burns almost white (the tube's glint).
    const top = !blocks.has(`${x},${y - 2}`);
    b.set(x, y, top ? hot : n.color);
    b.set(x + 1, y, top ? hot : n.color);
    b.set(x, y + 1, n.color);
    b.set(x + 1, y + 1, n.color);
  }
  // Underline tube.
  b.hline(tx + 1, tx + tw - 2, ty + 12, n.under);
  b.hline(tx + 1, tx + tw - 2, ty + 13, `${n.under}66`);
  s.rects = { glow: rectAt(s, tx, ty, tw, 14) };
  return { base: s };
}

export function jukebox(): BufFurniture {
  const s = floorSheet(1, 1, 24);
  const b = s.buf;
  const wood = ramp('#8a3f28', 0.07);
  frontFace(b, 1, -14, 14, 30, wood);
  b.ellipse(8, -14, 7, 6, wood.base);
  b.vline(1, -14, 15, wood.lt);
  // Rainbow bubble tubes along the arch and the sides.
  const tubes = ['#ff5c5c', '#ffb35c', '#ffe066', '#7be08a', '#5ec8ff'];
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i / 4) * Math.PI;
    b.set(Math.round(8 + Math.cos(a) * 5.5), Math.round(-14 + Math.sin(a) * 4.5), tubes[i]);
    b.set(Math.round(8 + Math.cos(a) * 4.5), Math.round(-14 + Math.sin(a) * 3.5), tubes[(i + 2) % 5]);
  }
  for (let y = -12; y <= 12; y += 2) {
    const k = (y + 12) / 2;
    b.set(2, y, tubes[k % 5]);
    b.set(13, y, tubes[(k + 3) % 5]);
  }
  // Record window and selector buttons.
  b.rect(4, -12, 8, 7, '#2a1d2e');
  b.ellipse(8, -8.5, 3, 2.5, '#16121a');
  b.set(8, -9, '#f2c14e');
  b.hline(4, 11, -12, 'rgba(255,240,200,0.4)');
  b.rect(4, -4, 8, 2, CHROME.base);
  for (const x of [5, 7, 9, 11]) b.set(x, -4, '#fff2b0');
  // Speaker grille.
  b.rect(4, 0, 8, 10, '#3a2420');
  for (const x of [5, 7, 9, 11]) b.vline(x, 1, 9, CHROME.dk);
  b.rect(3, 12, 10, 2, CHROME.base);
  b.hline(3, 12, 12, CHROME.hi);
  b.outline();
  contact(b, 0, 13, 16, 4, 0.26);
  s.rects = { glow: rectAt(s, 3, -20, 10, 14) };
  return { base: s };
}

// ------------------------------------------------------------------ coffee bar

export function espressoMachine(state: number): BufFurniture {
  const s = floorSheet(1, 1, 20);
  const b = s.buf;
  barBase(b);
  const on = state >= 1;
  const red = ramp('#c8372d', 0.08);
  // Cup-warmer tray with two cups on top.
  topFace(b, 2, -18, 11, 3, CHROME);
  for (const x of [4, 9]) {
    b.rect(x, -20, 2, 2, '#f4f2ee');
    b.set(x + 1, -19, '#d6d2c8');
  }
  // Red lacquered body with a chrome trim and a round pressure gauge.
  b.rect(2, -15, 11, 9, red.base);
  b.hline(2, 12, -15, red.hi);
  b.vline(2, -15, -7, red.lt);
  b.vline(12, -15, -7, red.dk);
  b.hline(2, 12, -7, red.dd);
  b.rect(6, -13, 3, 3, '#f4f1ea');
  b.set(7, -12, '#1d1a18');
  b.set(8, -13, '#1d1a18');
  b.set(4, -12, on ? '#5fd07a' : '#3b4a3f');
  // Chrome group bar with two group heads and black portafilter handles.
  b.rect(2, -6, 11, 2, CHROME.base);
  b.hline(2, 12, -6, CHROME.hi);
  for (const x of [4, 9]) {
    b.rect(x, -4, 2, 1, CHROME.dk);
    b.rect(x === 4 ? 2 : 11, -4, 2, 1, '#22252e');
  }
  // Drip tray and two demitasse cups (coffee running while a shot is pulled).
  b.rect(2, -1, 11, 1, CHROME.dk);
  for (const x of [4, 9]) {
    b.rect(x, -2, 2, 1, '#f4f2ee');
    if (on) b.set(x, -3, '#7a4a2a');
  }
  // Steam wand on the right.
  b.vline(14, -11, -3, CHROME.dk);
  b.set(14, -2, CHROME.lt);
  b.outline();
  seamless(b);
  contact(b, 0, 14, 16, 3, 0.2);
  if (on) for (const [x, y, a] of [[4, -21, 0.5], [11, -22, 0.45], [5, -23, 0.3]] as const) b.set(x, y, `rgba(255,255,255,${a})`);
  return { base: s };
}

export function pastryCase(): BufFurniture {
  const s = floorSheet(1, 1, 14);
  const b = s.buf;
  barBase(b);
  // Glass case on the counter.
  b.rect(1, -12, 14, 11, '#3a2a22');
  b.rect(2, -11, 12, 9, '#f7efe0');
  b.hline(2, 13, -7, '#c9bba4');
  // Top shelf: croissants. Bottom shelf: a donut and two cupcakes.
  for (const x of [3, 8]) {
    b.hline(x, x + 3, -9, '#e0a64c');
    b.hline(x + 1, x + 2, -10, '#f0c070');
    b.set(x, -8, '#b9782e');
    b.set(x + 3, -8, '#b9782e');
  }
  b.rect(3, -5, 3, 2, '#f29bb2');
  b.set(4, -5, '#c0627a');
  b.set(4, -4, '#7a4a2a');
  for (const x of [8, 11]) {
    b.rect(x, -4, 2, 2, '#c99a5e');
    b.rect(x, -6, 2, 2, x === 8 ? '#fff4e6' : '#8a5a3a');
    b.set(x + 1, -6, '#e05a5a');
  }
  glass(b, 2, -11, 12, 9, { alpha: 0.18, period: 7 });
  b.hline(1, 14, -12, '#5a4436');
  b.outline();
  seamless(b);
  contact(b, 0, 14, 16, 3, 0.2);
  return { base: s };
}

export function barCounter(variant: string | undefined, seed: number): BufFurniture {
  const s = floorSheet(1, 1, 8);
  const b = s.buf;
  const v = variant ?? 'mid';
  frontFace(b, 0, 3, 16, 13, WALNUT);
  b.vline(0, 3, 15, WALNUT.lt);
  for (const x of [4, 11]) {
    b.vline(x, 5, 12, WALNUT.dk);
    b.vline(x + 1, 5, 12, WALNUT.lt);
  }
  b.rect(0, 13, 16, 3, '#3e2a20');
  b.hline(0, 15, 13, '#b8894e');
  // Thick oak top with a brass foot rail below.
  const top = M.oak;
  topFace(b, 0, -5, 16, 8, top);
  b.hline(0, 15, 3, top.dk);
  b.hline(0, 15, 11, '#d9b45a');
  if (v === 'left') {
    for (const [x, y] of [[0, -5], [0, -4], [1, -5], [0, 15], [0, 14]] as const) b.clear(x, y);
  } else if (v === 'right') {
    for (const [x, y] of [[15, -5], [15, -4], [14, -5], [15, 15], [15, 14]] as const) b.clear(x, y);
  }
  // Something on the counter (varies by seed).
  const r = rngOf(seed, 41);
  const k = Math.floor(r() * 4);
  if (k === 0) mug(b, 5, -3, '#f4f2ee');
  else if (k === 1) {
    b.rect(6, -4, 4, 2, '#f4f2ee');
    b.set(7, -4, '#6b4226');
    b.hline(5, 10, -2, '#d6d2c8');
  } else if (k === 2) {
    b.rect(9, -6, 2, 3, '#2b2f3a');
    b.set(9, -6, '#f2c14e');
  }
  b.outline();
  if (v === 'mid') seamless(b);
  else if (v === 'left') for (let y = -b.oy; y < b.h - b.oy; y++) b.clear(16, y);
  else for (let y = -b.oy; y < b.h - b.oy; y++) b.clear(-1, y);
  contact(b, 0, 14, 16, 3, 0.2);
  return { base: s };
}

export function barStool(): BufFurniture {
  const s = floorSheet(1, 1, 4);
  const b = s.buf;
  b.ellipse(8, 14.5, 4, 1.4, '#3a3f4b');
  b.rect(7, 6, 2, 8, CHROME.base);
  b.vline(7, 6, 13, CHROME.hi);
  b.ellipse(8, 10.5, 4, 1.2, CHROME.dk);
  b.hline(6, 9, 10, CHROME.hi);
  const seat = ramp('#c8463a', 0.07);
  b.ellipse(8, 5, 5.5, 2.8, seat.dk);
  b.ellipse(8, 4.4, 5.5, 2.4, seat.lt);
  b.set(5, 3, seat.hi);
  b.set(6, 3, seat.hi);
  b.outline();
  contact(b, 3, 13, 10, 3, 0.22);
  return { base: s };
}

export function menuBoard(): BufFurniture {
  const s = wallSheet(2);
  const b = s.buf;
  const frame = ramp('#7a4a2e', 0.07);
  const x = 2;
  const y = -27;
  const w = 28;
  const h = 21;
  b.rect(x, y, w, h, frame.base);
  b.hline(x, x + w - 1, y, frame.hi);
  b.hline(x, x + w - 1, y + h - 1, frame.dk);
  b.rect(x + 1, y + 1, w - 2, h - 2, '#2c3a34');
  // "menu" in chalk, then lines of items with dot leaders and prices.
  const chalk = '#e8ecef';
  [...'menu'].forEach((ch, i) => {
    const g = glyphBits(ch);
    for (let k = 0; k < 15; k++) if (g[k] === '1') b.set(x + 8 + i * 4 + (k % 3), y + 2 + Math.floor(k / 3), chalk);
  });
  const accents = ['#f29bb2', '#f6d76b', '#9be0f0'];
  for (let row = 0; row < 3; row++) {
    const ly = y + 9 + row * 3;
    const len = 6 + ((row * 5) % 4);
    b.hline(x + 3, x + 3 + len, ly, row === 1 ? accents[row] : chalk);
    for (let dx = x + 5 + len; dx < x + w - 7; dx += 2) b.set(dx, ly, 'rgba(232,236,239,0.45)');
    b.rect(x + w - 6, ly - 1, 3, 2, accents[row]);
  }
  // Little cup doodle.
  b.rect(x + 3, y + h - 5, 3, 2, chalk);
  b.set(x + 6, y + h - 5, chalk);
  b.set(x + 4, y + h - 7, 'rgba(232,236,239,0.6)');
  b.outline();
  wallShadow(b, x - 1, y - 1, w + 2, h + 2);
  return { base: s };
}

export function beanSacks(): BufFurniture {
  const s = floorSheet(1, 1, 8);
  const b = s.buf;
  const sack = ramp('#b98d5a', 0.07);
  const one = (cx: number, cy: number, rx: number, ry: number) => {
    b.ellipse(cx, cy + 1, rx, ry, sack.dk);
    b.ellipse(cx - 0.5, cy, rx - 0.5, ry - 0.5, sack.base);
    b.ellipse(cx, cy - ry + 1.5, rx - 1.5, 1.6, '#5a3420');
    for (const [dx, dy] of [[-1, 0], [1, -1], [0, 1]] as const) b.set(Math.round(cx + dx), Math.round(cy - ry + 1.5 + dy), '#7a4a2a');
    b.hline(Math.round(cx - rx + 2), Math.round(cx + rx - 2), Math.round(cy + 1), sack.dd);
    b.set(Math.round(cx - rx + 2), Math.round(cy - 1), sack.lt);
  };
  one(5, 4, 5, 6);
  one(10.5, 8, 5, 6);
  b.outline();
  contact(b, 0, 12, 16, 4, 0.24);
  return { base: s };
}

// ------------------------------------------------------------------ pickleball

/** Net running north-south through the centre of a 1x6 footprint, with a post at each end. */
export function pickleballNet(): BufFurniture {
  const s = floorSheet(1, 6, 12);
  const b = s.buf;
  const H = 96;
  // Shadow on the court, to the lower right of the net.
  for (let y = 2; y < H; y++) {
    b.under(10, y, 'rgba(18,30,60,0.22)');
    b.under(11, y, 'rgba(18,30,60,0.12)');
  }
  // Mesh: alternating light/dark knots, white tape along the top edge.
  for (let y = -6; y < H - 4; y++) {
    b.set(7, y, y % 2 ? 'rgba(235,240,248,0.55)' : 'rgba(30,36,52,0.55)');
    b.set(9, y, 'rgba(30,36,52,0.3)');
  }
  b.vline(8, -7, H - 5, '#f4f6f8');
  // Posts (north end is further away: drawn first, rises from y = 0).
  const post = (y0: number) => {
    b.rect(7, y0 - 9, 3, 10, '#3a3f4b');
    b.vline(7, y0 - 9, y0, '#5a6070');
    b.rect(6, y0 - 10, 5, 1, '#5a6070');
    b.rect(6, y0, 5, 2, '#2b2f3a');
  };
  post(0);
  post(H - 4);
  b.outline({ x: 0, y: 0, w: b.w, h: b.oy + 4 });
  b.outline({ x: 0, y: b.oy + H - 16, w: b.w, h: 20 });
  contact(b, 4, 1, 9, 3, 0.25);
  contact(b, 4, H - 3, 9, 3, 0.25);
  return { base: s };
}

export function scoreboard(): BufFurniture {
  const s = wallSheet(2);
  const b = s.buf;
  const x = 1;
  const y = -27;
  const w = 30;
  const h = 18;
  b.rect(x, y, w, h, '#1d222c');
  b.hline(x, x + w - 1, y, '#3a3f4b');
  b.hline(x, x + w - 1, y + h - 1, '#12151c');
  // Team colour tabs above the two digit windows.
  b.hline(x + 4, x + 11, y + 2, '#e05a5a');
  b.hline(x + 18, x + 25, y + 2, '#3f7fd8');
  for (const wx of [x + 3, x + 17]) b.rect(wx, y + 4, 10, 11, '#0d1016');
  b.set(x + 15, y + 8, '#f2a03d');
  b.set(x + 15, y + 11, '#f2a03d');
  b.outline();
  wallShadow(b, x - 1, y - 1, w + 2, h + 2);
  s.rects = { screen: rectAt(s, x + 3, y + 4, 24, 11) };
  return { base: s };
}

export function ballCart(): BufFurniture {
  const s = floorSheet(1, 1, 10);
  const b = s.buf;
  const wire = '#9aa3ad';
  // Handle.
  b.vline(13, -8, 6, wire);
  b.hline(11, 14, -8, '#3a3f4b');
  // Basket of balls.
  b.rect(2, -2, 11, 10, 'rgba(120,130,140,0.25)');
  const ball: Ramp = ramp('#d8e85a', 0.08);
  for (const [cx, cy] of [[4, 0], [7, -1], [10, 0], [5, 3], [8, 2.5], [11, 3], [4, 6], [7, 5.5], [10, 6]] as const) {
    b.ellipse(cx + 0.5, cy + 0.5, 1.9, 1.9, ball.base);
    b.set(cx, cy, ball.hi);
    b.set(cx + 1, cy + 1, ball.dk);
  }
  for (let x = 2; x <= 12; x += 3) b.vline(x, -2, 8, wire);
  for (const yy of [-2, 3, 8]) b.hline(2, 12, yy, wire);
  // Wheels.
  for (const x of [3, 11]) b.rect(x, 10, 2, 3, '#2b2f3a');
  b.outline();
  contact(b, 1, 12, 14, 4, 0.22);
  return { base: s };
}

// ------------------------------------------------------------------ karaoke

export function speaker(): BufFurniture {
  const s = floorSheet(1, 1, 18);
  const b = s.buf;
  const box = ramp('#2a2d36', 0.07);
  frontFace(b, 2, -16, 12, 31, box);
  b.vline(2, -16, 14, box.lt);
  b.hline(2, 13, -16, box.hi);
  // Tweeter and two woofers.
  b.ellipse(8, -12, 1.6, 1.4, '#14161c');
  b.set(8, -13, '#6d7583');
  for (const [cy, r] of [[-4, 3.6], [7, 4.4]] as const) {
    b.ellipse(8, cy, r, r, '#14161c');
    b.ellipse(8, cy, r - 1.2, r - 1.2, '#3a3f4b');
    b.ellipse(8, cy, 1.2, 1.2, '#1d2028');
    b.set(7, cy - Math.round(r) + 1, '#6d7583');
  }
  b.set(12, -14, '#5fd07a');
  b.outline();
  contact(b, 1, 13, 14, 4, 0.26);
  return { base: s };
}

export function karaokeScreen(): BufFurniture {
  const s = wallSheet(3);
  const b = s.buf;
  const x = 2;
  const y = -27;
  const w = 44;
  const h = 20;
  b.rect(x, y, w, h, '#1b1d24');
  b.hline(x, x + w - 1, y, '#3a3f4b');
  b.hline(x, x + w - 1, y + h - 1, '#111318');
  b.rect(x + 1, y + 1, w - 2, h - 3, '#151b26');
  b.set(x + w - 3, y + h - 2, '#5fd07a');
  b.outline();
  wallShadow(b, x - 1, y - 1, w + 2, h + 2);
  s.rects = { tv: rectAt(s, x + 1, y + 1, w - 2, h - 3) };
  return { base: s };
}

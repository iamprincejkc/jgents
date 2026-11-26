// Floor markings painted over an area's floor (pure): the pickleball court, the karaoke stage and
// its dance floor. Each decal is one buffer of the requested size (px of world), drawn once into the
// area's floor layer, so it costs nothing per frame.
import { TILE, type DecalKind } from '../api';
import { mix, ramp } from '../core/color';
import { PixelBuf } from '../core/pixbuf';
import { h3 } from './floor';

/** Margin (px) between the decal's edge and the pickleball court's outer lines. */
export const COURT_MARGIN_X = 8;
export const COURT_MARGIN_Y = 6;
/** Non-volley zone ("kitchen") depth as a share of one half of the court (7 ft of 22 ft). */
export const KITCHEN_SHARE = 7 / 22;

export function renderDecal(kind: DecalKind, w: number, h: number, seed: number): PixelBuf {
  const b = new PixelBuf(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  switch (kind) {
    case 'pickleball_court':
      court(b, seed);
      break;
    case 'stage':
      stage(b, seed);
      break;
    case 'dance_floor':
      dance(b, seed);
      break;
  }
  return b;
}

/** Faint per-pixel grain so flat acrylic does not look like a hole in the floor. */
function grain(c: string, x: number, y: number, seed: number, amount = 0.05): string {
  const n = (h3(x, y, 0, seed) & 255) / 255;
  return n < 0.33 ? mix(c, '#000000', amount) : n > 0.8 ? mix(c, '#ffffff', amount) : c;
}

function court(b: PixelBuf, seed: number): void {
  const { w, h } = b;
  const surround = '#3f8f6b';
  const blue = '#2f6fb5';
  const kitchen = '#2a8f86';
  const line = '#f4f6f8';
  const x0 = COURT_MARGIN_X;
  const y0 = COURT_MARGIN_Y;
  const x1 = w - COURT_MARGIN_X - 1;
  const y1 = h - COURT_MARGIN_Y - 1;
  const net = Math.round((x0 + x1) / 2);
  const k = Math.round(((x1 - x0) / 2) * KITCHEN_SHARE);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const inKitchen = inside && Math.abs(x - net) <= k;
      b.set(x, y, grain(inside ? (inKitchen ? kitchen : blue) : surround, x, y, seed));
    }
  }
  // Soft border where the surround meets the floor around it.
  for (let x = 0; x < w; x++) {
    b.set(x, 0, 'rgba(20,40,30,0.25)');
    b.set(x, h - 1, 'rgba(20,40,30,0.3)');
  }
  for (let y = 0; y < h; y++) {
    b.set(0, y, 'rgba(20,40,30,0.25)');
    b.set(w - 1, y, 'rgba(20,40,30,0.3)');
  }
  // Lines: outer boundary, the two kitchen lines and the centre service lines.
  b.hline(x0, x1, y0, line);
  b.hline(x0, x1, y1, line);
  b.vline(x0, y0, y1, line);
  b.vline(x1, y0, y1, line);
  b.vline(net - k, y0, y1, line);
  b.vline(net + k, y0, y1, line);
  const mid = Math.round((y0 + y1) / 2);
  b.hline(x0, net - k, mid, line);
  b.hline(net + k, x1, mid, line);
  // Where the net stands (the net itself is a piece of furniture).
  b.vline(net, y0 + 1, y1 - 1, 'rgba(15,30,60,0.35)');
}

function stage(b: PixelBuf, seed: number): void {
  const { w, h } = b;
  const lip = 5;
  const wood = ramp('#6a4430', 0.06);
  const top = h - lip;
  // Planks: 4 px rows, a darker seam between rows and staggered butt joints.
  for (let y = 0; y < top; y++) {
    const row = Math.floor(y / 4);
    const tone = row % 2 ? wood.base : wood.lt;
    for (let x = 0; x < w; x++) b.set(x, y, grain(tone, x, y, seed + 3, 0.06));
    if (y % 4 === 3) b.hline(0, w - 1, y, wood.dk);
  }
  for (let row = 0; row * 4 < top; row++) {
    const off = h3(row, 0, 1, seed) % 24;
    for (let x = off; x < w; x += 22 + (h3(row, x, 2, seed) % 14)) b.vline(x, row * 4, Math.min(top - 1, row * 4 + 2), wood.dk);
  }
  // Back edge in shadow, side edges, front nosing and the face with warm bulbs.
  b.hline(0, w - 1, 0, wood.dd);
  b.vline(0, 0, top - 1, wood.dk);
  b.vline(w - 1, 0, top - 1, wood.dd);
  b.hline(0, w - 1, top, '#9a6a48');
  b.rect(0, top + 1, w, lip - 1, '#3a2418');
  b.hline(0, w - 1, h - 1, '#2a1a12');
  for (let x = 3; x < w - 2; x += 6) {
    b.set(x, top + 2, '#ffd98a');
    b.set(x, top + 3, 'rgba(255,217,138,0.45)');
  }
}

const DANCE = ['#ff6fb5', '#7c8bff', '#5ef0d0', '#ffd36b', '#b07cff'] as const;

function dance(b: PixelBuf, seed: number): void {
  const { w, h } = b;
  b.rect(0, 0, w, h, '#1b1530');
  for (let ty = 0; ty * TILE < h; ty++) {
    for (let tx = 0; tx * TILE < w; tx++) {
      const c = mix(DANCE[(tx + ty * 2 + (h3(tx, ty, 0, seed) % 2)) % DANCE.length], '#2a2140', 0.42);
      const r = ramp(c, 0.06);
      const x = tx * TILE + 1;
      const y = ty * TILE + 1;
      const tw = Math.min(TILE - 2, w - x - 1);
      const th = Math.min(TILE - 2, h - y - 1);
      if (tw <= 0 || th <= 0) continue;
      b.rect(x, y, tw, th, r.base);
      b.hline(x, x + tw - 1, y, r.lt);
      b.vline(x, y, y + th - 1, r.lt);
      b.hline(x, x + tw - 1, y + th - 1, r.dk);
      // Glossy glint.
      b.set(x + 2, y + 2, r.hi);
      b.set(x + 3, y + 2, r.hi);
      b.set(x + 2, y + 3, r.hi);
    }
  }
}

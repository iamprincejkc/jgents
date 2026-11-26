// Moving parts of the entertainment wing, drawn per frame: the balls on the pool table (racked,
// broken, struck and sunk in step with the billiards match), the pickleball over the net, the
// court scoreboard, the karaoke lights and the disco ball. Only fillRect/ellipse fills, no canvases.
import { mulberry32 } from '../../../../shared/hash';
import type { Rect } from '../../art/api';
import { glyphBits } from '../../art/pixelfont';
import type { Gathering } from '../social/gathering';
import { TARGET } from '../social/gathering';

// ------------------------------------------------------------------ billiards

interface Ball {
  /** Felt-relative px (top-left of the 2x2 ball). */
  x: number;
  y: number;
  color: string;
  stripe: boolean;
  eight: boolean;
  cue: boolean;
  gone: boolean;
}

interface Motion {
  ball: Ball;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  /** Start and duration (ms, relative to the shot). */
  t0: number;
  dt: number;
  sink: boolean;
}

const OBJECT_COLORS = ['#f2c14e', '#3f7fd8', '#e05a5a', '#8d66cf', '#ec8a3c', '#4cae6a', '#9b3b3b', '#36b0b0', '#e47aa8'] as const;
/** Each shot: the cue ball rolls for this long, then the struck ball runs (ms). */
const CUE_MS = 300;
const RUN_MS = 650;
const BREAK_MS = 800;
/** With no match for this long the balls are racked again (ms). */
const RERACK_MS = 9_000;

/** A fresh rack: ten balls in a triangle on the foot spot (8 ball in the middle), cue ball on the head spot. */
export function rackBalls(w: number, h: number): Ball[] {
  const balls: Ball[] = [];
  const ax = Math.round(w * 0.66);
  const cy = (h - 2) / 2;
  let k = 0;
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) {
      const eight = row === 2 && i === 1;
      const color = eight ? '#1d1a18' : OBJECT_COLORS[k++ % OBJECT_COLORS.length];
      balls.push({ x: Math.round(ax + row * 2.6), y: Math.round(cy + (i - row / 2) * 3), color, stripe: !eight && k > 5, eight, cue: false, gone: false });
    }
  }
  balls.push({ x: Math.round(w * 0.24), y: Math.round(cy), color: '#f8f6f0', stripe: false, eight: false, cue: true, gone: false });
  return balls;
}

export class PoolTableFx {
  private balls: Ball[] = [];
  private gameId = -1;
  private shotN = 0;
  private shotAt = 0;
  private motions: Motion[] = [];
  private w = 0;
  private h = 0;
  private idleSince = 0;

  draw(ctx: CanvasRenderingContext2D, felt: Rect, g: Gathering | null, now: number): void {
    const w = Math.round(felt.w);
    const h = Math.round(felt.h);
    if (w !== this.w || h !== this.h || !this.balls.length) this.rerack(w, h);
    if (g && g.id !== this.gameId) {
      // a new match: fresh rack; a page opened mid-match drops the balls already sunk
      this.rerack(w, h);
      this.gameId = g.id;
      this.shotN = g.shot?.n ?? 0;
      const sunk = g.score[0] + g.score[1];
      if (this.shotN > 0) this.scatter(mulberry32(g.seed), 0, 0);
      this.commit();
      for (let i = 0; i < sunk; i++) {
        const b = this.pickTarget(mulberry32(g.seed + i), false);
        if (b) b.gone = true;
      }
    }
    if (g) this.idleSince = now;
    else if (this.gameId !== -1 && now - this.idleSince > RERACK_MS) {
      this.rerack(w, h);
      this.gameId = -1;
    }
    if (g?.shot && g.shot.n !== this.shotN) {
      this.commit();
      this.shotN = g.shot.n;
      this.shotAt = g.shot.at;
      this.plan(g, mulberry32((g.seed ^ Math.imul(g.shot.n, 0x9e3779b1)) >>> 0));
    }
    const t = now - this.shotAt;
    if (this.motions.length && t > Math.max(...this.motions.map((m) => m.t0 + m.dt))) this.commit();
    const x0 = Math.round(felt.x);
    const y0 = Math.round(felt.y);
    for (const b of this.balls) {
      if (b.gone) continue;
      const m = this.motions.find((mm) => mm.ball === b);
      let x = b.x;
      let y = b.y;
      if (m) {
        const u = Math.max(0, Math.min(1, (t - m.t0) / m.dt));
        const e = 1 - (1 - u) * (1 - u);
        x = m.fx + (m.tx - m.fx) * e;
        y = m.fy + (m.ty - m.fy) * e;
        if (m.sink && u >= 1) continue;
      }
      drawBall(ctx, x0 + Math.round(x), y0 + Math.round(y), b);
    }
  }

  private rerack(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.balls = rackBalls(w, h);
    this.motions = [];
  }

  /** Lands every motion where it was heading. */
  private commit(): void {
    for (const m of this.motions) {
      m.ball.x = m.tx;
      m.ball.y = m.ty;
      if (m.sink) m.ball.gone = true;
    }
    this.motions = [];
  }

  private live(): Ball[] {
    return this.balls.filter((b) => !b.gone && !b.cue);
  }

  private pickTarget(rng: () => number, eight: boolean): Ball | undefined {
    const pool = this.live().filter((b) => b.eight === eight);
    const any = pool.length ? pool : this.live();
    return any[Math.floor(rng() * any.length) % Math.max(1, any.length)];
  }

  private clampX(x: number): number {
    return Math.max(0, Math.min(this.w - 2, x));
  }

  private clampY(y: number): number {
    return Math.max(0, Math.min(this.h - 2, y));
  }

  /** The break: every racked ball runs off to somewhere on the felt. */
  private scatter(rng: () => number, t0: number, dt: number): void {
    for (const b of this.live()) {
      this.motions.push({ ball: b, fx: b.x, fy: b.y, tx: this.clampX(2 + rng() * (this.w - 6)), ty: this.clampY(1 + rng() * (this.h - 4)), t0, dt, sink: false });
    }
  }

  private plan(g: Gathering, rng: () => number): void {
    const shot = g.shot!;
    const cue = this.balls.find((b) => b.cue)!;
    const winning = shot.pot && g.score[shot.by] >= (TARGET.billiards ?? 4);
    if (shot.n === 1) this.scatter(rng, CUE_MS, BREAK_MS);
    const target = this.pickTarget(rng, winning);
    if (!target) return;
    // where the target goes: the nearest pocket, or a spot on the felt
    const pockets: [number, number][] = [
      [-1, -1],
      [this.w / 2 - 1, -2],
      [this.w - 1, -1],
      [-1, this.h - 1],
      [this.w / 2 - 1, this.h],
      [this.w - 1, this.h - 1],
    ];
    // on the break the target was already given a spot by scatter(): it heads there or into a pocket instead
    const rest = this.motions.find((m) => m.ball === target);
    if (rest) this.motions.splice(this.motions.indexOf(rest), 1);
    const sx = target.x;
    const sy = target.y;
    const ex = rest ? rest.tx : sx;
    const ey = rest ? rest.ty : sy;
    let tx: number;
    let ty: number;
    if (shot.pot) {
      [tx, ty] = pockets.reduce((best, p) => (Math.hypot(p[0] - ex, p[1] - ey) < Math.hypot(best[0] - ex, best[1] - ey) ? p : best));
    } else if (rest) {
      [tx, ty] = [rest.tx, rest.ty];
    } else {
      tx = this.clampX(sx + (rng() - 0.5) * this.w * 0.6);
      ty = this.clampY(sy + (rng() - 0.5) * this.h * 0.8);
    }
    // the cue ball rolls up to the target, then drifts a little after the hit
    const dx = sx - cue.x;
    const dy = sy - cue.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const hitX = sx - (dx / len) * 2;
    const hitY = sy - (dy / len) * 2;
    this.motions.push({ ball: cue, fx: cue.x, fy: cue.y, tx: this.clampX(hitX + (rng() - 0.5) * 8), ty: this.clampY(hitY + (rng() - 0.5) * 6), t0: 0, dt: CUE_MS + 220, sink: false });
    this.motions.push({ ball: target, fx: sx, fy: sy, tx, ty, t0: CUE_MS, dt: rest ? BREAK_MS : RUN_MS, sink: shot.pot });
  }
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, b: Ball): void {
  ctx.fillStyle = 'rgba(10,30,20,0.35)';
  ctx.fillRect(x + 1, y + 2, 2, 1);
  ctx.fillStyle = b.color;
  ctx.fillRect(x, y, 2, 2);
  ctx.fillStyle = b.stripe ? '#f8f6f0' : b.eight ? '#5a5a62' : 'rgba(255,255,255,0.55)';
  ctx.fillRect(x, y, 1, 1);
}

// ------------------------------------------------------------------ pickleball

/** One crossing of the court (ms): the ball goes over the net, bounces once, and is hit back. */
export const PICKLEBALL_PERIOD_MS = 1_450;
/** Share of a crossing at which the ball bounces on the far side. */
const BOUNCE_AT = 0.74;

/** Ball height (px above the floor) along one crossing `u` (0 = leaving the paddle, 1 = next paddle). */
export function pickleballHeight(u: number): number {
  if (u < BOUNCE_AT) {
    const v = u / BOUNCE_AT;
    return 13 * (1 - v) + Math.sin(Math.PI * v) * 15;
  }
  const v = (u - BOUNCE_AT) / (1 - BOUNCE_AT);
  return 12 * v + Math.sin(Math.PI * v) * 4;
}

export function drawPickleball(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, startAt: number, now: number): void {
  const left = a.x < b.x ? a : b;
  const right = a.x < b.x ? b : a;
  const ph = (((now - startAt) % (PICKLEBALL_PERIOD_MS * 2)) + PICKLEBALL_PERIOD_MS * 2) % (PICKLEBALL_PERIOD_MS * 2) / PICKLEBALL_PERIOD_MS;
  const east = ph < 1;
  const u = east ? ph : ph - 1;
  const from = east ? left : right;
  const to = east ? right : left;
  const x0 = from.x + (east ? 7 : -7);
  const x1 = to.x + (east ? -7 : 7);
  const x = Math.round(x0 + (x1 - x0) * u);
  const ground = Math.round(from.y + (to.y - from.y) * u - 2);
  const y = Math.round(ground - pickleballHeight(u));
  ctx.fillStyle = 'rgba(20,30,60,0.35)';
  ctx.fillRect(x - 1, ground, 3, 1);
  ctx.fillStyle = '#e8f060';
  ctx.fillRect(x - 1, y - 1, 2, 2);
  ctx.fillStyle = '#a8b03a';
  ctx.fillRect(x, y, 1, 1);
}

// ------------------------------------------------------------------ scoreboard

/** Two amber digits (west player left, east player right) in the scoreboard's windows; dim zeros when idle. */
export function drawScoreboard(ctx: CanvasRenderingContext2D, r: Rect, score: readonly [number, number] | null): void {
  const color = score ? '#ffb347' : 'rgba(255,179,71,0.22)';
  const vals = score ?? [0, 0];
  [0, 1].forEach((i) => {
    const text = String(Math.min(99, vals[i]));
    const wx = Math.round(r.x) + i * 14;
    const scale = text.length > 1 ? 1 : 2;
    const tw = text.length * 4 * scale - scale;
    const ox = wx + Math.floor((10 - tw) / 2);
    const oy = Math.round(r.y) + Math.floor((11 - 5 * scale) / 2);
    ctx.fillStyle = color;
    [...text].forEach((ch, k) => {
      const g = glyphBits(ch);
      for (let p = 0; p < 15; p++) if (g[p] === '1') ctx.fillRect(ox + k * 4 * scale + (p % 3) * scale, oy + Math.floor(p / 3) * scale, scale, scale);
    });
  });
}

// ------------------------------------------------------------------ karaoke

const SPOTS = ['rgba(255,92,214,0.24)', 'rgba(94,240,255,0.22)', 'rgba(255,224,102,0.2)'] as const;

/** Coloured spotlights sweeping the stage and the dance floor while someone sings. */
export function drawKaraokeLights(ctx: CanvasRenderingContext2D, r: Rect, now: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  SPOTS.forEach((c, i) => {
    const cx = r.x + r.w * (0.55 + 0.3 * Math.sin(now / 1700 + i * 2.1));
    const cy = r.y + r.h * (0.42 + 0.16 * Math.sin(now / 1250 + i * 1.7));
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(Math.round(cx), Math.round(cy), 20, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

const FACETS = ['#e8edf2', '#b9c2cc', '#8d97a3', '#ffffff'] as const;

/** Mirror ball hanging from the ceiling: still when the room is quiet, spinning and sparkling during a song. */
export function drawDiscoBall(ctx: CanvasRenderingContext2D, x: number, top: number, y: number, now: number, live: boolean): void {
  ctx.fillStyle = '#7d8794';
  ctx.fillRect(x, top, 1, Math.max(0, y - top - 3));
  const spin = live ? Math.floor(now / 130) : 0;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy > 10) continue;
      ctx.fillStyle = dx * dx + dy * dy > 7 ? '#6d7583' : FACETS[(((dx + dy * 3 + spin) % 4) + 4) % 4];
      ctx.fillRect(x + dx, y + dy, 1, 1);
    }
  }
  if (!live) return;
  const rng = mulberry32(Math.floor(now / 220));
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 3; i++) {
    const sx = Math.round(x + (rng() - 0.5) * 16);
    const sy = Math.round(y + (rng() - 0.5) * 10);
    ctx.fillRect(sx, sy - 1, 1, 3);
    ctx.fillRect(sx - 1, sy, 3, 1);
  }
}

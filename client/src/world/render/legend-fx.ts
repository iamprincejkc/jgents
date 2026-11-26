// Drawing the legendary creatures (world/legends.ts): the sprite, a flyer's shadow on the ground,
// a soft aura in the creature's colour (it reads at night too), the sparkle ring when one turns up
// or leaves, and the twinkle of the rare colour variants. A built-in creature is drawn by the art
// module, frame by frame; a pack creature is one image that hops as it walks and breathes at rest.
import type { ArtModule } from '../../art/api';
import { creatureFrameMs, creatureFrames } from '../../art/creatures';
import type { CreatureDef } from '../creature-catalog';
import type { Legend } from '../legends';
import { glowSprite } from './props';

/** Vertical offset (px, negative = up) of a pack creature: small hops while walking, a breath now and then at rest. */
export function packBob(l: Pick<Legend, 'flies' | 'moving' | 'phase'>, now: number): number {
  if (l.flies) return 0;
  const t = now + l.phase;
  if (l.moving) return -Math.round(Math.abs(Math.sin(t / 130)) * 2);
  return t % 2_400 < 320 ? -1 : 0;
}

export function drawLegend(ctx: CanvasRenderingContext2D, art: ArtModule, l: Legend, def: CreatureDef, now: number): void {
  if (l.alpha <= 0.01) return;
  const pack = def.sprites;
  if (pack) {
    const s = pack.variants[l.variant] ?? pack.variants.normal;
    // the image is mirrored when the creature walks the other way from where it looks
    const mirror = (l.dir === 1) === (pack.faces === 'left');
    if (!l.flies) {
      ctx.fillStyle = `rgba(20,28,40,${0.22 * l.alpha})`;
      ctx.beginPath();
      ctx.ellipse(Math.round(l.x), Math.round(l.y), Math.max(4, Math.round(pack.w * 0.32)), 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = l.alpha;
    ctx.drawImage(mirror ? s.flipped : s.canvas, Math.round(l.x - s.ax), Math.round(l.y - l.alt - s.ay + packBob(l, now)));
    ctx.globalAlpha = 1;
    return;
  }
  const species = def.builtin;
  if (!art.creatureSprite || !species) return;
  const motion = l.flies || l.moving ? 'move' : 'idle';
  const n = creatureFrames(species, motion);
  const frame = Math.floor((now + l.phase) / creatureFrameMs(species, motion)) % n;
  const s = art.creatureSprite(species, l.variant, motion, frame, l.dir === 1);
  ctx.globalAlpha = l.alpha;
  ctx.drawImage(s.canvas, Math.round(l.x - s.ax), Math.round(l.y - l.alt - s.ay));
  ctx.globalAlpha = 1;
}

/** A flyer's shadow on the ground, under everything standing there. */
export function drawFlyerShadow(ctx: CanvasRenderingContext2D, l: Legend): void {
  if (!l.flies || l.alpha <= 0.01) return;
  ctx.fillStyle = `rgba(20,28,40,${0.2 * l.alpha})`;
  ctx.beginPath();
  ctx.ellipse(Math.round(l.x), Math.round(l.y), 10, 3, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Aura, appear/leave sparkles and the twinkle of rare variants (additive, over the lighting). */
export function drawLegendFx(ctx: CanvasRenderingContext2D, l: Legend, def: CreatureDef, now: number, night: number): void {
  if (l.alpha <= 0.01 && !l.blink) return;
  const color = def.glow;
  const cx = Math.round(l.x);
  const cy = Math.round(l.y - l.alt - def.box.cy);
  // the aura grows with the creature (the built-in ones keep 52 x 44)
  const aw = Math.max(52, Math.round(def.box.w * 1.7));
  const ah = Math.max(44, Math.round(def.box.h * 1.6));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = (0.1 + 0.32 * night) * l.alpha;
  ctx.drawImage(glowSprite(color, 64), cx - Math.round(aw / 2), cy - Math.round(ah / 2), aw, ah);
  // turning up, leaving or blinking: a ring of sparkles that closes in (or opens out)
  if (l.alpha < 1) {
    const k = 1 - l.alpha;
    const r = Math.max(6, def.box.w / 5) + k * 14;
    ctx.globalAlpha = 0.9 * Math.min(1, k * 1.6);
    ctx.fillStyle = color;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + now / 300;
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r * 0.7);
      ctx.fillRect(x, y - 1, 1, 3);
      ctx.fillRect(x - 1, y, 3, 1);
    }
  }
  // rare colours sparkle now and then
  if (l.variant !== 'normal' && l.alpha >= 1) {
    const t = ((now + l.phase) % 1_600) / 1_600;
    if (t < 0.35) {
      const k = Math.sin((t / 0.35) * Math.PI);
      const h = Math.floor((now + l.phase) / 1_600);
      const x = cx + Math.round(((((h * 7) % 17) - 8) * Math.max(30, def.box.w)) / 30);
      const y = cy + Math.round(((((h * 5) % 11) - 7) * Math.max(28, def.box.h)) / 28);
      ctx.globalAlpha = k;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y - 2, 1, 5);
      ctx.fillRect(x - 2, y, 5, 1);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.restore();
}

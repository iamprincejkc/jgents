// Pixel work on the images of a creature pack (world/creature-pack.ts loads them): the visible part of an
// image, crisp edges after scaling, the rare colour variants recoloured from the normal image, and a
// signature colour for the aura. Pure: plain RGBA arrays, no DOM (testable in node).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The smallest box holding every pixel at least `minAlpha` opaque, or null for an empty image. */
export function opaqueBox(data: Uint8ClampedArray, w: number, h: number, minAlpha = 24): Box | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < minAlpha) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Size (px) of a `w` x `h` image scaled so its longest side is `size`. */
export function fitSize(w: number, h: number, size: number): { w: number; h: number } {
  const k = size / Math.max(1, w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Pixel-art edges: every pixel either fully opaque or fully clear (smooth scaling leaves soft halos). */
export function hardenAlpha(data: Uint8ClampedArray, cut = 110): Uint8ClampedArray {
  for (let i = 3; i < data.length; i += 4) data[i] = data[i] >= cut ? 255 : 0;
  return data;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue: number;
  if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return [hue / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [Math.round(f(p, q, h + 1 / 3) * 255), Math.round(f(p, q, h) * 255), Math.round(f(p, q, h - 1 / 3) * 255)];
}

const lum = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/**
 * A rare colour, made from the normal image (a copy; the input is left alone): shiny turns the hues
 * about half way round the wheel, shadow darkens everything into deep violet, metallic maps the
 * brightness onto a steel ramp. Clear pixels stay clear.
 */
export function recolor(src: Uint8ClampedArray, variant: 'shiny' | 'shadow' | 'metallic'): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(src);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    let c: [number, number, number];
    if (variant === 'shiny') {
      const [h, s, l] = rgbToHsl(r, g, b);
      c = hslToRgb((h + 0.42) % 1, Math.min(1, s * 1.08), l);
    } else if (variant === 'shadow') {
      const v = lum(r, g, b);
      // deep violet, keeping a little of the shading and of the original hue
      c = [lerp(36, 150, v * 0.85) * 0.8 + r * 0.12, lerp(22, 96, v * 0.85) * 0.8 + g * 0.08, lerp(58, 190, v * 0.85) * 0.8 + b * 0.12].map((n) => Math.round(Math.min(255, n))) as [number, number, number];
    } else {
      const v = Math.min(1, Math.max(0, (lum(r, g, b) - 0.5) * 1.25 + 0.5));
      c = [lerp(70, 236, v), lerp(80, 242, v), lerp(96, 250, v)];
    }
    out[i] = c[0];
    out[i + 1] = c[1];
    out[i + 2] = c[2];
  }
  return out;
}

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/**
 * A creature's signature colour (#rrggbb): the average of its visible pixels, weighted toward the
 * colourful ones, then lifted so an aura of it reads on the grass and at night.
 */
export function signatureColor(data: Uint8ClampedArray): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let wsum = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    // colourful mid-tones count most; outlines (very dark) and highlights (very light) count little
    const w = 0.15 + s * (1 - Math.abs(l - 0.5) * 2);
    r += data[i] * w;
    g += data[i + 1] * w;
    b += data[i + 2] * w;
    wsum += w;
  }
  if (!wsum) return '#9a8cf0';
  const [h, s] = rgbToHsl(r / wsum, g / wsum, b / wsum);
  const [cr, cg, cb] = hslToRgb(h, Math.max(0.5, Math.min(0.85, s)), 0.6);
  return `#${hex(cr)}${hex(cg)}${hex(cb)}`;
}

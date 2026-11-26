// The owner's creature pack in the browser: reads GET /api/creatures (server/creatures/pack.ts), loads each
// image, crops it to what is visible, scales it to the creature's size with crisp pixel edges, makes the
// rare colour variants (from the pack's own images when it has them) and hands the catalog ready-to-draw
// creatures. It checks the folder again every half minute, so a dropped or edited image shows up by itself.
import { tr } from '../../../shared/i18n';
import { PACK_SIZE, type CreaturePackInfo, type PackCreature } from '../../../shared/creatures';
import type { CreatureVariant } from '../art/creatures';
import { packType, type CreatureDef, type PackSprite, type PackSprites } from './creature-catalog';
import { fitSize, hardenAlpha, opaqueBox, recolor, signatureColor } from './creature-image';

/** How often the folder is checked for changes (ms). */
export const PACK_POLL_MS = 30_000;

const imageUrl = (file: string, version: string) => `/api/creatures/file/${encodeURIComponent(file)}?v=${encodeURIComponent(version)}`;

/** The list from the server, or null when there is none (no server behind the page, an old server, offline). */
export async function fetchPackInfo(signal?: AbortSignal): Promise<CreaturePackInfo | null> {
  try {
    const res = await fetch('/api/creatures', { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as CreaturePackInfo;
    return body && Array.isArray(body.creatures) ? body : null;
  } catch {
    return null;
  }
}

/** What changes the pack: files, versions and settings (not the folder path or the warnings). */
export function packSignature(info: CreaturePackInfo | null): string {
  return info ? JSON.stringify(info.creatures) : '';
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

/** The visible part of an image, scaled so its longest side is `size`, with crisp edges. */
function cutOut(img: HTMLImageElement, size: number): ImageData | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  const src = canvasOf(w, h).getContext('2d', { willReadFrequently: true })!;
  src.drawImage(img, 0, 0);
  const box = opaqueBox(src.getImageData(0, 0, w, h).data, w, h);
  if (!box) return null;
  const out = fitSize(box.w, box.h, size);
  const dst = canvasOf(out.w, out.h).getContext('2d', { willReadFrequently: true })!;
  // shrinking: smooth, then hard edges (keeps detail); growing: whole pixels, like the rest of the art
  dst.imageSmoothingEnabled = out.w < box.w;
  dst.imageSmoothingQuality = 'high';
  dst.drawImage(src.canvas, box.x, box.y, box.w, box.h, 0, 0, out.w, out.h);
  const data = dst.getImageData(0, 0, out.w, out.h);
  hardenAlpha(data.data);
  return data;
}

function spriteOf(data: ImageData, flies: boolean): PackSprite {
  const canvas = canvasOf(data.width, data.height);
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  const flipped = canvasOf(data.width, data.height);
  const fctx = flipped.getContext('2d')!;
  fctx.translate(data.width, 0);
  fctx.scale(-1, 1);
  fctx.drawImage(canvas, 0, 0);
  return { canvas, flipped, ax: data.width / 2, ay: flies ? data.height / 2 : data.height };
}

/** The normal image framed like a built-in sprite (42:34, standing on the bottom edge), for the encounter card. */
function cardOf(s: PackSprite, flies: boolean): HTMLCanvasElement {
  const w = s.canvas.width;
  const h = s.canvas.height;
  const W = Math.max(w + 4, Math.ceil(((h + 4) * 42) / 34));
  const H = Math.round((W * 34) / 42);
  const c = canvasOf(W, H);
  c.getContext('2d')!.drawImage(s.canvas, Math.round((W - w) / 2), flies ? Math.round((H - h) / 2) : H - h - 2);
  return c;
}

/** Loads one creature of the pack; null when its image cannot be read. */
async function loadCreature(c: PackCreature): Promise<CreatureDef | null> {
  try {
    const size = Math.min(PACK_SIZE.max, Math.max(PACK_SIZE.min, c.size || PACK_SIZE.default));
    const normal = cutOut(await loadImage(imageUrl(c.file, c.version)), size);
    if (!normal) return null;
    const variants: Partial<Record<CreatureVariant, PackSprite>> = { normal: spriteOf(normal, c.flies) };
    for (const v of ['shiny', 'shadow', 'metallic'] as const) {
      const own = c.variants[v];
      let data: ImageData | null = null;
      if (own) {
        // a hand-made variant that fails to load falls back to the recoloured one
        const img = await loadImage(imageUrl(own, c.version)).catch(() => null);
        if (img) data = cutOut(img, size);
      }
      variants[v] = spriteOf(data ?? new ImageData(recolor(normal.data, v), normal.width, normal.height), c.flies);
    }
    const all = variants as Record<CreatureVariant, PackSprite>;
    const cards = { normal: cardOf(all.normal, c.flies), shiny: cardOf(all.shiny, c.flies), shadow: cardOf(all.shadow, c.flies), metallic: cardOf(all.metallic, c.flies) };
    const sprites: PackSprites = { w: normal.width, h: normal.height, faces: c.faces, variants: all, cards };
    const level = c.level ?? [50, 70];
    return {
      id: c.id,
      name: c.name,
      flies: c.flies,
      speed: c.speed ?? (c.flies ? 34 : 24),
      level,
      types: c.types.map(packType),
      blurb: c.blurb ?? tr('Veio do seu pacote de criaturas.'),
      glow: c.glow ?? signatureColor(normal.data),
      blinks: false,
      box: { w: normal.width, h: normal.height, cy: c.flies ? 0 : normal.height / 2 },
      sprites,
    };
  } catch {
    return null;
  }
}

/** Loads every creature of a pack (the ones whose image fails are left out). */
export async function loadPack(info: CreaturePackInfo): Promise<CreatureDef[]> {
  const defs = await Promise.all(info.creatures.map(loadCreature));
  return defs.filter((d): d is CreatureDef => !!d);
}

/**
 * Keeps a pack in sync with its folder: loads it now and again whenever the server's list changes
 * (checked every PACK_POLL_MS, and when the tab comes back). Returns a stop function.
 */
export function watchCreaturePack(onChange: (defs: CreatureDef[], info: CreaturePackInfo | null) => void): () => void {
  const abort = new AbortController();
  let last: string | null = null;
  let busy = false;
  const check = async () => {
    if (busy || abort.signal.aborted) return;
    busy = true;
    try {
      const info = await fetchPackInfo(abort.signal);
      const sig = packSignature(info);
      if (sig === last || abort.signal.aborted) return;
      last = sig;
      const defs = info ? await loadPack(info) : [];
      if (!abort.signal.aborted) onChange(defs, info);
    } finally {
      busy = false;
    }
  };
  void check();
  const timer = setInterval(() => void check(), PACK_POLL_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') void check();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    abort.abort();
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

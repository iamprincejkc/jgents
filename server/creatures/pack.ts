// The owner's creature pack (shared/creatures.ts): every image in the pack folder becomes a creature named
// after its file, and an optional creatures.json tunes each one. The folder is re-read on every request, so
// adding, removing or editing a file shows up without a restart. Only plain image files directly inside the
// folder are ever served: no sub-folders, no links out of it, nothing over the size limit.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync, type Stats } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  nameFromFile,
  PACK_IMAGE_EXT,
  PACK_MANIFEST,
  PACK_MAX_CREATURES,
  PACK_MAX_IMAGE_BYTES,
  PACK_MAX_MANIFEST_BYTES,
  PACK_SIZE,
  PACK_VARIANTS,
  packId,
  type CreaturePackInfo,
  type PackCreature,
  type PackVariant,
} from '../../shared/creatures';
import { tr } from '../../shared/i18n';

function fileStat(p: string): Stats | undefined {
  try {
    const st = statSync(p);
    return st.isFile() ? st : undefined;
  } catch {
    return undefined;
  }
}

/** A file name that may be served from the pack: one image file, directly in the folder. */
export function isPackFileName(name: string): boolean {
  return !!name && name.length <= 160 && !/[\\/\0:<>"|?*]/.test(name) && !name.startsWith('.') && PACK_IMAGE_EXT.test(name);
}

/**
 * Absolute path of an image of the pack, or null when it is not one: a bad name, missing, a folder, too big, or a
 * link that leads out of the folder.
 */
export function packFilePath(dir: string, name: string): string | null {
  if (!isPackFileName(name)) return null;
  const root = resolve(dir);
  const full = resolve(root, name);
  if (dirname(full) !== root) return null;
  try {
    const real = realpathSync(full);
    if (dirname(real) !== realpathSync(root)) return null;
    const st = fileStat(real);
    if (!st || st.size > PACK_MAX_IMAGE_BYTES) return null;
    return real;
  } catch {
    return null;
  }
}

interface Image {
  file: string;
  version: string;
}

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

/** Settings per image (lower-case file name -> its entry in creatures.json). */
function readManifest(dir: string, warnings: string[]): Map<string, Raw> {
  const out = new Map<string, Raw>();
  const path = join(dir, PACK_MANIFEST);
  const st = fileStat(path);
  if (!st) return out;
  if (st.size > PACK_MAX_MANIFEST_BYTES) {
    warnings.push(tr('{0} é grande demais (máximo de 256 KB) e foi ignorado', [PACK_MANIFEST]));
    return out;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    warnings.push(tr('{0} não pôde ser lido: {1}', [PACK_MANIFEST, err instanceof Error ? err.message : String(err)]));
    return out;
  }
  const creatures = isObj(raw) ? raw.creatures : undefined;
  if (!isObj(creatures)) {
    warnings.push(tr('{0} precisa de um objeto "creatures" com uma entrada por imagem', [PACK_MANIFEST]));
    return out;
  }
  for (const [file, entry] of Object.entries(creatures)) {
    if (!isObj(entry)) {
      warnings.push(tr('{0}: a entrada de "{1}" precisa ser um objeto', [PACK_MANIFEST, file]));
      continue;
    }
    out.set(file.toLowerCase(), entry);
  }
  return out;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Builds one creature from its image and its (optional) settings; a bad field is skipped with a warning. */
function creatureOf(img: Image, entry: Raw | undefined, images: Map<string, Image>, warnings: string[]): PackCreature {
  const c: PackCreature = {
    id: packId(img.file),
    file: img.file,
    name: nameFromFile(img.file),
    flies: false,
    size: PACK_SIZE.default,
    faces: 'left',
    types: [],
    variants: {},
    version: img.version,
  };
  if (!entry) return c;
  const bad = (field: string) => warnings.push(tr('{0}: "{1}" de {2} foi ignorado (valor inválido)', [PACK_MANIFEST, field, img.file]));
  const versions = [img.version];
  for (const [field, v] of Object.entries(entry)) {
    switch (field) {
      case 'enabled':
        if (typeof v !== 'boolean') bad(field);
        break;
      case 'name':
        if (typeof v === 'string' && v.trim()) c.name = v.trim().slice(0, 40);
        else bad(field);
        break;
      case 'flies':
        if (typeof v === 'boolean') c.flies = v;
        else bad(field);
        break;
      case 'size':
        if (typeof v === 'number' && Number.isFinite(v)) c.size = Math.round(Math.min(PACK_SIZE.max, Math.max(PACK_SIZE.min, v)));
        else bad(field);
        break;
      case 'faces':
        if (v === 'left' || v === 'right') c.faces = v;
        else bad(field);
        break;
      case 'speed':
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) c.speed = Math.min(80, Math.max(5, v));
        else bad(field);
        break;
      case 'level':
        if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
          const [a, b] = (v as number[]).map((n) => Math.round(Math.min(100, Math.max(1, n))));
          c.level = [Math.min(a, b), Math.max(a, b)];
        } else bad(field);
        break;
      case 'types':
        if (Array.isArray(v) && v.every((t) => typeof t === 'string')) c.types = (v as string[]).map((t) => t.trim().slice(0, 16)).filter(Boolean).slice(0, 3);
        else bad(field);
        break;
      case 'blurb':
        if (typeof v === 'string' && v.trim()) c.blurb = v.trim().slice(0, 200);
        else bad(field);
        break;
      case 'glow':
        if (typeof v === 'string' && HEX.test(v)) c.glow = v.toLowerCase();
        else bad(field);
        break;
      case 'variants':
        if (!isObj(v)) {
          bad(field);
          break;
        }
        for (const [k, f] of Object.entries(v)) {
          const variant = images.get(typeof f === 'string' ? f.toLowerCase() : '');
          if (!PACK_VARIANTS.includes(k as PackVariant) || !variant) {
            bad(`variants.${k}`);
            continue;
          }
          c.variants[k as PackVariant] = variant.file;
          versions.push(variant.version);
        }
        break;
      default:
        warnings.push(tr('{0}: campo desconhecido "{1}" em {2}', [PACK_MANIFEST, field, img.file]));
    }
  }
  c.version = versions.join('.');
  return c;
}

/** Reads the pack folder. A missing folder is an empty pack. */
export function readPack(dir: string): CreaturePackInfo {
  const warnings: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { creatures: [], warnings };
  }
  const images = new Map<string, Image>();
  for (const name of names.sort((a, b) => a.localeCompare(b, 'en'))) {
    if (!isPackFileName(name)) continue;
    const st = fileStat(join(dir, name));
    if (!st) continue;
    if (st.size > PACK_MAX_IMAGE_BYTES) {
      warnings.push(tr('{0} tem mais de 2 MB e foi ignorada', [name]));
      continue;
    }
    images.set(name.toLowerCase(), { file: name, version: `${Math.floor(st.mtimeMs).toString(36)}${st.size.toString(36)}` });
  }
  const manifest = readManifest(dir, warnings);
  for (const file of manifest.keys()) if (!images.has(file)) warnings.push(tr('{0}: "{1}" não é uma imagem desta pasta', [PACK_MANIFEST, file]));
  // an image used as another creature's colour variant is not a creature of its own
  const asVariant = new Set<string>();
  for (const entry of manifest.values()) {
    if (!isObj(entry.variants)) continue;
    for (const f of Object.values(entry.variants)) if (typeof f === 'string') asVariant.add(f.toLowerCase());
  }
  const creatures: PackCreature[] = [];
  for (const [key, img] of images) {
    const entry = manifest.get(key);
    if (asVariant.has(key) && !entry) continue;
    if (entry?.enabled === false) continue;
    if (creatures.length >= PACK_MAX_CREATURES) {
      warnings.push(tr('Só as primeiras {0} criaturas foram carregadas', [PACK_MAX_CREATURES]));
      break;
    }
    creatures.push(creatureOf(img, entry, images, warnings));
  }
  return { creatures, warnings };
}

/** Creates the pack folder and its README on start (a failure only leaves the pack empty). Returns the folder. */
export function ensureCreaturePack(dir: string): string {
  try {
    mkdirSync(dir, { recursive: true });
    const readme = join(dir, 'README.txt');
    if (!existsSync(readme)) writeFileSync(readme, PACK_README);
  } catch {
    // a read-only data folder: no pack, the built-in creatures roam as before
  }
  return dir;
}

/** What a new pack folder holds, so it explains itself. */
export const PACK_README = `JGENTS creature pack
====================

Every image in this folder (PNG, WebP or GIF, up to 2 MB) roams the grounds around the office.
Its name comes from the file name: "fire_cat.png" shows up as "Fire Cat" (underscores become spaces).
Pick which creatures roam in JGENTS: Settings > Office > Which creatures roam (Built-in, Your pack or Both).
Changes show up within half a minute, no restart needed.

Optional: a creatures.json file in this folder tunes each creature, keyed by its file name.
Every field is optional:

{
  "creatures": {
    "fire_cat.png": {
      "name": "Fire Cat",
      "flies": false,
      "size": 40,
      "faces": "left",
      "speed": 24,
      "level": [40, 55],
      "types": ["fire"],
      "blurb": "One line for its card.",
      "glow": "#ff8a3d",
      "variants": { "shiny": "fire_cat_shiny.png" }
    },
    "old-one.png": { "enabled": false }
  }
}

- size: the longest side on the grounds, 12 to 96 (default 36).
- faces: which way the creature in the image looks, "left" or "right".
- types: up to 3 words; electric, fire, flying, ice, water, dark, psychic, grass and dragon get their colour.
- variants: hand-made images for the rare colours (shiny, shadow, metallic); without one, JGENTS recolours the image.
- enabled: false hides a creature without deleting its image.
`;

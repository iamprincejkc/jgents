// The owner's creature pack: images dropped in a folder (server: JGENTS_CREATURES_DIR, by default
// <dataDir>/creatures) that roam the grounds instead of, or beside, the built-in creatures. An optional
// creatures.json in the same folder tunes each one (name, flying, size, lore...). This file holds what the
// server sends (GET /api/creatures) and the rules both sides share. Pure: no I/O.

/** Image files a pack may hold. */
export const PACK_IMAGE_EXT = /\.(png|webp|gif)$/i;
/** The optional settings file in the pack folder. */
export const PACK_MANIFEST = 'creatures.json';
export const PACK_MAX_CREATURES = 64;
export const PACK_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const PACK_MAX_MANIFEST_BYTES = 256 * 1024;
/** Longest side of a creature on the grounds (px of world): the default and the limits. */
export const PACK_SIZE = { default: 36, min: 12, max: 96 } as const;

export type PackVariant = 'shiny' | 'shadow' | 'metallic';
export const PACK_VARIANTS: readonly PackVariant[] = ['shiny', 'shadow', 'metallic'];

/** One creature of the pack, as the server sends it. Optional fields fall back to the client's defaults. */
export interface PackCreature {
  /** `pack:<file name, lower case>`. */
  id: string;
  /** Image file in the pack folder (served at /api/creatures/file/<file>). */
  file: string;
  name: string;
  flies: boolean;
  /** Longest side on the grounds (px of world). */
  size: number;
  /** Which way the creature in the image looks; the world mirrors it to walk the other way. */
  faces: 'left' | 'right';
  speed?: number;
  level?: [number, number];
  /** Type names (the built-in ones get their colour; any other word is shown as is). */
  types: string[];
  blurb?: string;
  /** Aura and accent colour (#rrggbb); default: the image's own average colour. */
  glow?: string;
  /** Hand-made images for the rare colours; a missing one is recoloured from the normal image. */
  variants: Partial<Record<PackVariant, string>>;
  /** Changes when any of its files changes (cache key for the images). */
  version: string;
}

export interface CreaturePackInfo {
  creatures: PackCreature[];
  /** Problems found reading the folder or creatures.json (shown in the settings). */
  warnings: string[];
  /** Where the folder is (only told to a browser on this computer). */
  folder?: string;
}

/** A display name from a file name: "ho-oh.png" -> "Ho-Oh", "fire_cat.webp" -> "Fire Cat". */
export function nameFromFile(file: string): string {
  const base = file.replace(/\.[^.]+$/, '').replace(/[_\s]+/g, ' ').trim();
  return base.replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase()).slice(0, 40) || 'Creature';
}

/** The pack id of an image file. */
export function packId(file: string): string {
  return `pack:${file.toLowerCase()}`;
}

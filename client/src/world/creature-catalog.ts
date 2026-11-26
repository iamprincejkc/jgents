// Which creatures roam the grounds: the six built-in ones (drawn by the art module) and the owner's
// creature pack (images from a folder; world/creature-pack.ts loads them). The catalog answers both
// the herd (world/legends.ts) and the drawing and the encounter card, so neither cares where a creature
// came from. Pure apart from the canvases a pack creature carries.
import { tr } from '../../../shared/i18n';
import { CREATURE_FLIES, CREATURE_GLOW, CREATURE_SPECIES, type CreatureSpecies, type CreatureVariant } from '../art/creatures';

export type LegendType = 'electric' | 'fire' | 'flying' | 'ice' | 'water' | 'dark' | 'psychic' | 'grass' | 'dragon';

export interface LegendInfo {
  /** Proper name: the same in every language. */
  name: string;
  types: readonly LegendType[];
  /** Walking/flying speed (px of world per second). */
  speed: number;
  level: readonly [number, number];
  /** One line of lore for the encounter card. */
  blurb: string;
}

export const LEGEND_INFO: Readonly<Record<CreatureSpecies, LegendInfo>> = {
  voltfang: { name: 'Voltfang', types: ['electric'], speed: 30, level: [60, 72], blurb: tr('Dizem que corre mais rápido que o trovão. Por onde passa, as luzes do escritório piscam.') },
  pyrewing: { name: 'Pyrewing', types: ['fire', 'flying'], speed: 44, level: [66, 78], blurb: tr('Renasce das próprias cinzas a cada amanhecer. Seu canto aquece o jardim inteiro.') },
  frostantler: { name: 'Frostantler', types: ['ice'], speed: 18, level: [58, 70], blurb: tr('Seus chifres de cristal nunca derretem. Deixa um rastro de geada por onde caminha.') },
  tidalray: { name: 'Tidalray', types: ['water', 'flying'], speed: 30, level: [62, 74], blurb: tr('Nada pelo céu como se fosse o mar. As runas das asas brilham antes da chuva.') },
  umbralynx: { name: 'Umbralynx', types: ['dark', 'psychic'], speed: 24, level: [64, 76], blurb: tr('Só aparece entre uma sombra e outra. Quem cruza seu olhar esquece o que ia dizer.') },
  verdrake: { name: 'Verdrake', types: ['grass', 'dragon'], speed: 20, level: [55, 68], blurb: tr('Onde dorme, nasce um jardim. Rega escondido as plantas do escritório.') },
};

export const TYPE_LABEL: Readonly<Record<LegendType, string>> = {
  electric: tr('Elétrico'),
  fire: tr('Fogo'),
  flying: tr('Voador'),
  ice: tr('Gelo'),
  water: tr('Água'),
  dark: tr('Sombrio'),
  psychic: tr('Psíquico'),
  grass: tr('Planta'),
  dragon: tr('Dragão'),
};

export const TYPE_COLOR: Readonly<Record<LegendType, string>> = {
  electric: '#e8b923',
  fire: '#e8692c',
  flying: '#7f93e0',
  ice: '#55c2d8',
  water: '#3f82d8',
  dark: '#5a4a6e',
  psychic: '#e0568f',
  grass: '#4fae55',
  dragon: '#6650d8',
};

export const VARIANT_LABEL: Readonly<Record<CreatureVariant, string>> = {
  normal: tr('Normal'),
  shiny: tr('Brilhante'),
  shadow: tr('Sombra'),
  metallic: tr('Metálico'),
};

/** One image of a pack creature, ready to draw: anchored at the feet (walkers) or the middle (flyers). */
export interface PackSprite {
  canvas: HTMLCanvasElement;
  /** The same, mirrored. */
  flipped: HTMLCanvasElement;
  ax: number;
  ay: number;
}

export interface PackSprites {
  w: number;
  h: number;
  /** Which way the creature in the image looks. */
  faces: 'left' | 'right';
  variants: Readonly<Record<CreatureVariant, PackSprite>>;
  /** Each colour framed like a built-in sprite (42:34), for the encounter card. */
  cards: Readonly<Record<CreatureVariant, HTMLCanvasElement>>;
}

export interface CreatureDef {
  /** A built-in species, or `pack:<file>`. */
  id: string;
  name: string;
  flies: boolean;
  /** px of world per second. */
  speed: number;
  level: readonly [number, number];
  types: readonly { label: string; color: string }[];
  blurb: string;
  /** Aura and accent colour. */
  glow: string;
  /** Blinks from spot to spot instead of walking (Umbralynx). */
  blinks: boolean;
  /** Visible size (px) and how high its middle sits above the ground: hit-testing, aura, name tag. */
  box: { w: number; h: number; cy: number };
  /** Drawn by the art module. */
  builtin?: CreatureSpecies;
  /** A pack creature's images. */
  sprites?: PackSprites;
}

export const BUILTIN_CREATURES: readonly CreatureDef[] = CREATURE_SPECIES.map((s): CreatureDef => {
  const info = LEGEND_INFO[s];
  const flies = CREATURE_FLIES[s];
  return {
    id: s,
    name: info.name,
    flies,
    speed: info.speed,
    level: info.level,
    types: info.types.map((t) => ({ label: TYPE_LABEL[t], color: TYPE_COLOR[t] })),
    blurb: info.blurb,
    glow: CREATURE_GLOW[s],
    blinks: s === 'umbralynx',
    box: flies ? { w: 36, h: 24, cy: 0 } : { w: 30, h: 28, cy: 12 },
    builtin: s,
  };
});

/** A type word from a pack: the built-in types keep their label and colour, any other word is shown as is. */
export function packType(word: string): { label: string; color: string } {
  const k = word.trim().toLowerCase() as LegendType;
  return k in TYPE_LABEL ? { label: TYPE_LABEL[k], color: TYPE_COLOR[k] } : { label: word.trim(), color: '#7d7f9a' };
}

/** Which creatures roam: the built-in ones, the owner's pack (built-in while it is empty) or both. */
export type CreatureChoice = 'builtin' | 'pack' | 'both';

export class CreatureCatalog {
  private pack: readonly CreatureDef[] = [];
  private choice: CreatureChoice = 'pack';
  private list: readonly CreatureDef[] = BUILTIN_CREATURES;
  private byId = new Map<string, CreatureDef>(BUILTIN_CREATURES.map((d) => [d.id, d]));
  /** Bumps whenever the creatures that roam change (the grounds clear and fill again). */
  version = 0;

  /** The creatures that roam now, in a fixed order. */
  active(): readonly CreatureDef[] {
    return this.list;
  }

  get(id: string): CreatureDef | undefined {
    return this.byId.get(id);
  }

  packSize(): number {
    return this.pack.length;
  }

  getChoice(): CreatureChoice {
    return this.choice;
  }

  setPack(defs: readonly CreatureDef[]): void {
    this.pack = defs;
    this.recompute();
  }

  setChoice(choice: CreatureChoice): void {
    if (choice === this.choice) return;
    this.choice = choice;
    this.recompute();
  }

  private recompute(): void {
    const list = this.choice === 'builtin' || !this.pack.length ? BUILTIN_CREATURES : this.choice === 'pack' ? this.pack : [...BUILTIN_CREATURES, ...this.pack];
    this.byId = new Map([...BUILTIN_CREATURES, ...this.pack].map((d) => [d.id, d]));
    const same = list.length === this.list.length && list.every((d, i) => d === this.list[i]);
    this.list = list;
    if (!same) this.version++;
  }
}

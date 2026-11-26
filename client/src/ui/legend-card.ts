// Encounter card for a legendary creature clicked on the grounds, in the spirit of the classic
// "a wild ... appeared!" screens: the sprite up close on its platform, name and level, its types,
// the colour variant, a line of lore and the little collection of species this browser has met.
// The collection lives in localStorage (a per-viewer keepsake, never needed for anything else).
import type { LegendEncounter } from '../world/api';
import { h, iconButton } from './dom';
import { ICONS } from './icons';
import { tr } from '../../../shared/i18n';

export const DEX_KEY = 'jgents:legends';

/** Species met (how many times) and the colour variants seen of each. */
export interface Dex {
  seen: Record<string, number>;
  variants: Record<string, string[]>;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadDex(storage: StorageLike | null): Dex {
  const empty: Dex = { seen: {}, variants: {} };
  if (!storage) return empty;
  try {
    const raw = JSON.parse(storage.getItem(DEX_KEY) ?? 'null') as Partial<Dex> | null;
    if (!raw || typeof raw !== 'object') return empty;
    const seen: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.seen ?? {})) if (typeof v === 'number' && v > 0) seen[k] = Math.floor(v);
    const variants: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw.variants ?? {})) if (Array.isArray(v)) variants[k] = v.filter((x): x is string => typeof x === 'string').slice(0, 8);
    return { seen, variants };
  } catch {
    return empty;
  }
}

/** Counts one more encounter; tells whether the species or the variant is new to this viewer. */
export function recordEncounter(dex: Dex, species: string, variant: string): { dex: Dex; newSpecies: boolean; newVariant: boolean } {
  const newSpecies = !dex.seen[species];
  const had = dex.variants[species] ?? [];
  const newVariant = !had.includes(variant);
  return {
    dex: {
      seen: { ...dex.seen, [species]: (dex.seen[species] ?? 0) + 1 },
      variants: { ...dex.variants, [species]: newVariant ? [...had, variant] : had },
    },
    newSpecies,
    newVariant,
  };
}

function saveDex(storage: StorageLike | null, dex: Dex): void {
  try {
    storage?.setItem(DEX_KEY, JSON.stringify(dex));
  } catch {
    // storage blocked (private window): the collection lasts for this visit only
  }
}

/** Copies a cached sprite into a fresh canvas (the cached one is shared and must never be moved into the page). */
function copyCanvas(src: HTMLCanvasElement, cls: string, silhouette = false): HTMLCanvasElement {
  const c = h('canvas', { class: cls });
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
    if (silhouette) {
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = 'rgba(160,170,200,0.35)';
      ctx.fillRect(0, 0, c.width, c.height);
    }
  }
  return c;
}

const VARIANT_ICON: Readonly<Record<string, string>> = { shiny: '✨', shadow: '🌑', metallic: '⚙️' };

export class LegendCard {
  readonly el: HTMLDialogElement;
  private readonly stage: HTMLElement;
  private readonly body: HTMLElement;
  private dex: Dex;

  constructor(private readonly storage: StorageLike | null) {
    this.dex = loadDex(storage);
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.el.close(), 'ui-icon-btn--sm');
    this.stage = h('div', { class: 'ui-wild__stage' });
    this.body = h('div', { class: 'ui-wild__body' });
    this.el = h(
      'dialog',
      { class: 'ui-dialog ui-wild', attrs: { 'aria-labelledby': 'ui-wild-name' } },
      h('div', { class: 'ui-wild__banner' }, h('span', { class: 'ui-wild__kicker', text: tr('Um lendário selvagem apareceu!') }), close),
      this.stage,
      this.body,
    );
    // a click on the backdrop (outside the card) closes it
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
  }

  show(e: LegendEncounter): void {
    const rec = recordEncounter(this.dex, e.species, e.variant);
    this.dex = rec.dex;
    saveDex(this.storage, this.dex);
    this.el.style.setProperty('--wild', e.glow);
    this.el.dataset.variant = e.variant;

    this.stage.replaceChildren(h('div', { class: 'ui-wild__platform', attrs: { 'aria-hidden': 'true' } }), copyCanvas(e.sprite, 'ui-wild__sprite'));

    const chips = h(
      'div',
      { class: 'ui-wild__tags' },
      ...e.types.map((t) => h('span', { class: 'ui-wild__chip', text: t.label, style: `--chip: ${t.color}` })),
      e.variant !== 'normal' ? h('span', { class: 'ui-wild__chip ui-wild__chip--variant', text: `${VARIANT_ICON[e.variant] ?? ''} ${e.variantLabel}`.trim() }) : null,
      rec.newSpecies || (rec.newVariant && e.variant !== 'normal') ? h('span', { class: 'ui-wild__chip ui-wild__chip--new', text: tr('Novo!') }) : null,
    );
    const met = e.roster.filter((r) => this.dex.seen[r.species]).length;
    const roster = h(
      'div',
      { class: 'ui-wild__roster' },
      ...e.roster.map((r) => {
        const known = !!this.dex.seen[r.species];
        const c = copyCanvas(r.sprite, `ui-wild__mini${r.species === e.species ? ' is-current' : ''}`, !known);
        c.title = known ? r.name : '???';
        c.setAttribute('role', 'img');
        c.setAttribute('aria-label', known ? r.name : tr('Ainda não encontrado'));
        return c;
      }),
    );
    this.body.replaceChildren(
      h('div', { class: 'ui-wild__title' }, h('h2', { text: e.name, attrs: { id: 'ui-wild-name' } }), h('span', { class: 'ui-wild__lv', text: tr('Nv. {0}', [e.level]) })),
      chips,
      h('p', { class: 'ui-wild__blurb', text: e.blurb }),
      h(
        'div',
        { class: 'ui-wild__dex' },
        h('div', { class: 'ui-wild__count' }, h('span', { text: tr('Lendários encontrados: {0}/{1}', [met, e.roster.length]) }), h('span', { text: tr('Visto {0}×', [this.dex.seen[e.species] ?? 1]) })),
        roster,
      ),
    );
    if (!this.el.open) this.el.showModal();
  }
}

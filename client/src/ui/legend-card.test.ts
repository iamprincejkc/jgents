import { describe, expect, it } from 'vitest';
import { DEX_KEY, loadDex, recordEncounter } from './legend-card';

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('coleção de lendários', () => {
  it('começa vazia e sobrevive a armazenamento ausente ou corrompido', () => {
    expect(loadDex(null)).toEqual({ seen: {}, variants: {} });
    expect(loadDex(memory({ [DEX_KEY]: '{oops' }))).toEqual({ seen: {}, variants: {} });
    expect(loadDex(memory({ [DEX_KEY]: JSON.stringify({ seen: { voltfang: 2, x: 'a' }, variants: { voltfang: ['normal', 3] } }) }))).toEqual({
      seen: { voltfang: 2 },
      variants: { voltfang: ['normal'] },
    });
  });

  it('conta os encontros e diz quando a espécie ou a variação é nova', () => {
    let r = recordEncounter({ seen: {}, variants: {} }, 'pyrewing', 'normal');
    expect([r.newSpecies, r.newVariant]).toEqual([true, true]);
    r = recordEncounter(r.dex, 'pyrewing', 'normal');
    expect([r.newSpecies, r.newVariant]).toEqual([false, false]);
    r = recordEncounter(r.dex, 'pyrewing', 'shiny');
    expect([r.newSpecies, r.newVariant]).toEqual([false, true]);
    expect(r.dex.seen.pyrewing).toBe(3);
    expect(r.dex.variants.pyrewing).toEqual(['normal', 'shiny']);
  });
});

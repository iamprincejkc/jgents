import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../shared/hash';
import { BUILTIN_CREATURES, CreatureCatalog, packType, type CreatureDef } from './creature-catalog';
import { fitSize, hardenAlpha, opaqueBox, recolor, signatureColor } from './creature-image';
import { packSignature } from './creature-pack';
import { Legends, legendZones } from './legends';

/** A w x h RGBA image filled by `px(x, y)`. */
function image(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(px(x, y), (y * w + x) * 4);
  return d;
}

describe('imagens do pacote de criaturas', () => {
  it('recorta só a parte visível', () => {
    const d = image(10, 8, (x, y) => (x >= 3 && x <= 6 && y >= 2 && y <= 6 ? [200, 40, 40, 255] : [0, 0, 0, 0]));
    expect(opaqueBox(d, 10, 8)).toEqual({ x: 3, y: 2, w: 4, h: 5 });
    expect(opaqueBox(new Uint8ClampedArray(4 * 4 * 4), 4, 4)).toBeNull();
    // faint specks (a soft shadow, compression noise) are not part of the creature
    const faint = image(4, 4, (x) => (x === 0 ? [0, 0, 0, 10] : [0, 0, 0, 0]));
    expect(opaqueBox(faint, 4, 4)).toBeNull();
  });

  it('escala pelo lado maior', () => {
    expect(fitSize(96, 48, 36)).toEqual({ w: 36, h: 18 });
    expect(fitSize(20, 40, 36)).toEqual({ w: 18, h: 36 });
    expect(fitSize(1, 200, 36)).toEqual({ w: 1, h: 36 });
  });

  it('bordas nítidas: cada pixel ou é opaco ou some', () => {
    const d = hardenAlpha(new Uint8ClampedArray([9, 9, 9, 30, 9, 9, 9, 200, 9, 9, 9, 110]));
    expect([d[3], d[7], d[11]]).toEqual([0, 255, 255]);
  });

  it('as cores raras mudam a imagem, mas não o contorno', () => {
    const d = image(6, 6, (x, y) => (x > 0 && y > 0 ? [220, 120 + x * 10, 40, 255] : [0, 0, 0, 0]));
    const differs = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i + 3] && Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++;
      return n;
    };
    const opaque = 25;
    for (const v of ['shiny', 'shadow', 'metallic'] as const) {
      const out = recolor(d, v);
      expect(out, v).not.toBe(d);
      expect(differs(d, out), v).toBeGreaterThan(opaque * 0.8);
      for (let i = 3; i < d.length; i += 4) expect(out[i]).toBe(d[i]);
    }
    // the three are different from one another too
    expect(differs(recolor(d, 'shiny'), recolor(d, 'shadow'))).toBeGreaterThan(opaque / 2);
    expect(differs(recolor(d, 'shadow'), recolor(d, 'metallic'))).toBeGreaterThan(opaque / 2);
  });

  it('a cor da aura vem da própria imagem', () => {
    const red = image(4, 4, () => [210, 30, 30, 255]);
    const c = signatureColor(red);
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g + 60);
    expect(r).toBeGreaterThan(b + 60);
    expect(signatureColor(new Uint8ClampedArray(16))).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('a assinatura do pacote muda com arquivos e ajustes, não com a pasta nem os avisos', () => {
    const base = { creatures: [{ id: 'pack:a.png', file: 'a.png', name: 'A', flies: false, size: 36, faces: 'left' as const, types: [], variants: {}, version: '1' }], warnings: [] };
    expect(packSignature({ ...base, folder: '/x', warnings: ['w'] })).toBe(packSignature(base));
    expect(packSignature({ ...base, creatures: [{ ...base.creatures[0], version: '2' }] })).not.toBe(packSignature(base));
    expect(packSignature(null)).toBe('');
  });
});

/** A pack creature without images (the herd only needs what it is, not how it looks). */
function packDef(id: string, flies = false, size = 40): CreatureDef {
  return { id, name: id, flies, speed: 24, level: [10, 20], types: [packType('fire'), packType('Cosmic')], blurb: '', glow: '#ff0000', blinks: false, box: { w: size, h: size, cy: flies ? 0 : size / 2 } };
}

describe('catálogo de criaturas', () => {
  it('tipos do pacote: os conhecidos ganham rótulo e cor, os outros aparecem como vieram', () => {
    expect(packType('FIRE').color).toBe('#e8692c');
    expect(packType(' Cosmic ')).toEqual({ label: 'Cosmic', color: '#7d7f9a' });
  });

  it('escolha: originais, o pacote (originais enquanto ele está vazio) ou ambos', () => {
    const cat = new CreatureCatalog();
    expect(cat.getChoice()).toBe('pack');
    expect(cat.active()).toBe(BUILTIN_CREATURES);
    const v0 = cat.version;
    const pack = [packDef('pack:a.png'), packDef('pack:b.png', true)];
    cat.setPack(pack);
    expect(cat.active().map((d) => d.id)).toEqual(['pack:a.png', 'pack:b.png']);
    expect(cat.version).toBe(v0 + 1);
    cat.setChoice('both');
    expect(cat.active()).toHaveLength(BUILTIN_CREATURES.length + 2);
    cat.setChoice('builtin');
    expect(cat.active()).toBe(BUILTIN_CREATURES);
    // a creature still on the grounds can always be looked up
    expect(cat.get('pack:b.png')?.flies).toBe(true);
    cat.setChoice('pack');
    cat.setPack([]);
    expect(cat.active()).toBe(BUILTIN_CREATURES);
    // the same list again changes nothing
    const v = cat.version;
    cat.setChoice('pack');
    cat.setPack([]);
    expect(cat.version).toBe(v);
  });
});

describe('criaturas do pacote no jardim', () => {
  const FLOORS = 2;

  it('só as criaturas escolhidas aparecem; trocar a escolha esvazia o jardim e traz as novas', () => {
    const cat = new CreatureCatalog();
    const l = new Legends(mulberry32(5), cat);
    l.layout(FLOORS);
    l.update(1_000, 0.1);
    expect(l.list.every((c) => BUILTIN_CREATURES.some((d) => d.id === c.species))).toBe(true);
    cat.setPack([packDef('pack:a.png'), packDef('pack:b.png'), packDef('pack:c.png', true), packDef('pack:d.png')]);
    let now = 1_000;
    for (let i = 0; i < 600; i++) l.update((now += 100), 0.1);
    expect(l.list.length).toBeGreaterThan(0);
    expect(l.list.every((c) => c.species.startsWith('pack:'))).toBe(true);
    // the flyer flies, the walkers stay in their habitats
    const zones = legendZones(FLOORS);
    for (const c of l.list) {
      expect(c.flies).toBe(c.species === 'pack:c.png');
      if (!c.flies) {
        const z = zones[c.zone];
        expect(c.x >= z.x - 0.01 && c.x <= z.x + z.w + 0.01 && c.y >= z.y - 0.01 && c.y <= z.y + z.h + 0.01).toBe(true);
      }
    }
  });

  it('clique pega a criatura pelo tamanho dela', () => {
    const cat = new CreatureCatalog();
    cat.setPack([packDef('pack:big.png', false, 80)]);
    const l = new Legends(mulberry32(3), cat);
    l.layout(FLOORS);
    const c = l.spawn(0, 'pack:big.png')!;
    c.alpha = 1;
    expect(l.hit(c.x + 35, c.y - 70)).toBe(c);
    expect(l.hit(c.x + 45, c.y - 40)).toBeNull();
    expect(l.spawn(0, 'pack:unknown.png')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { CREATURE_FLIES, CREATURE_SPECIES, CREATURE_VARIANTS, creatureFrames, renderCreature } from './creatures';

describe('criaturas lendárias (arte)', () => {
  it('todo quadro de toda espécie e variação tem desenho, dentro da folha', () => {
    for (const s of CREATURE_SPECIES) {
      for (const v of CREATURE_VARIANTS) {
        for (const motion of ['idle', 'move'] as const) {
          for (let f = 0; f < creatureFrames(s, motion); f++) {
            const sp = renderCreature(s, v, motion, f);
            expect(sp.buf.countOpaque(), `${s}/${v}/${motion}/${f}`).toBeGreaterThan(120);
            expect(sp.ax).toBeGreaterThan(0);
            expect(sp.ax).toBeLessThan(sp.buf.w);
            expect(sp.ay).toBeLessThan(sp.buf.h);
          }
        }
      }
    }
  });

  it('quem anda pisa na linha da âncora; quem voa fica centrado nela', () => {
    for (const s of CREATURE_SPECIES) {
      const sp = renderCreature(s, 'normal', 'idle', 0);
      const b = sp.buf;
      const row = (y: number) => Array.from({ length: b.w }, (_, x) => b.data[(y * b.w + x) * 4 + 3]).filter((a) => a >= 160).length;
      if (CREATURE_FLIES[s]) {
        expect(row(sp.ay), s).toBeGreaterThan(4);
      } else {
        // feet (opaque) just above the anchor, nothing solid below it but the soft shadow
        expect(row(sp.ay - 1) + row(sp.ay - 2), s).toBeGreaterThan(2);
        expect(row(sp.ay + 2), s).toBe(0);
      }
    }
  });

  it('andando, as pernas mexem (os quadros diferem)', () => {
    for (const s of CREATURE_SPECIES) {
      if (CREATURE_FLIES[s]) continue;
      const a = renderCreature(s, 'normal', 'move', 0).buf.data;
      const b = renderCreature(s, 'normal', 'move', 2).buf.data;
      expect(a.some((v, i) => v !== b[i]), s).toBe(true);
    }
  });

  it('as variações mudam as cores', () => {
    for (const s of CREATURE_SPECIES) {
      const n = renderCreature(s, 'normal', 'idle', 0).buf.data;
      for (const v of ['shiny', 'shadow', 'metallic'] as const) {
        const d = renderCreature(s, v, 'idle', 0).buf.data;
        let diff = 0;
        for (let i = 0; i < n.length; i += 4) if (n[i] !== d[i] || n[i + 1] !== d[i + 1] || n[i + 2] !== d[i + 2]) diff++;
        expect(diff, `${s}/${v}`).toBeGreaterThan(80);
      }
    }
  });
});

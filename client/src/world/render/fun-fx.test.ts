import { describe, expect, it } from 'vitest';
import { pickleballHeight, rackBalls } from './fun-fx';

describe('ala de lazer: animações', () => {
  it('o triângulo da sinuca: dez bolas (a oito no meio) e a branca no lado de saída, tudo dentro do pano', () => {
    const balls = rackBalls(54, 17);
    expect(balls).toHaveLength(11);
    expect(balls.filter((b) => b.eight)).toHaveLength(1);
    const cue = balls.find((b) => b.cue)!;
    expect(cue.x).toBeLessThan(54 / 2);
    for (const b of balls) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThanOrEqual(54 - 2);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeLessThanOrEqual(17 - 2);
    }
    // no two balls on the same spot
    expect(new Set(balls.map((b) => `${b.x},${b.y}`)).size).toBe(balls.length);
  });

  it('a bola do pickleball sai da raquete, passa alto sobre a rede, quica e chega na outra raquete', () => {
    expect(pickleballHeight(0)).toBeCloseTo(13, 5);
    expect(pickleballHeight(0.37)).toBeGreaterThan(15);
    expect(pickleballHeight(0.74)).toBeCloseTo(0, 5);
    expect(pickleballHeight(1)).toBeCloseTo(12, 5);
    for (let u = 0; u <= 1; u += 0.01) expect(pickleballHeight(u)).toBeGreaterThanOrEqual(-1e-9);
  });
});

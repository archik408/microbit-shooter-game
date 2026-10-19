import { describe, expect, it } from 'vitest';
import { clamp, lerp, randomBetween } from '../js/math.js';

describe('math', () => {
  it('clamp ограничивает диапазон с обеих сторон', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('lerp интерполирует по краям и в середине', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(10, 0, 0.25)).toBe(7.5);
  });

  it('randomBetween не выходит за границы', () => {
    for (let i = 0; i < 500; i++) {
      const value = randomBetween(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(7);
    }
  });
});

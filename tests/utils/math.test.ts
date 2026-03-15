import { describe, it, expect } from 'vitest';
import { clamp, lerp, distance, distanceSquaredXY, distanceXY, SeededRandom } from '@/utils/math';

describe('math utilities', () => {
  it('clamps values within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-2, 0, 10)).toBe(0);
    expect(clamp(20, 0, 10)).toBe(10);
  });

  it('interpolates linearly', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('computes distances consistently', () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
    expect(distanceXY({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distanceSquaredXY({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
  });

  it('generates deterministic sequences with SeededRandom', () => {
    const rngA = new SeededRandom(42);
    const rngB = new SeededRandom(42);

    expect(rngA.next()).toBe(rngB.next());
    expect(rngA.nextRange(0, 10)).toBe(rngB.nextRange(0, 10));
    expect(rngA.nextInt(1, 5)).toBe(rngB.nextInt(1, 5));

    rngA.reseed(99);
    rngB.reseed(99);
    expect(rngA.next()).toBe(rngB.next());
  });
});

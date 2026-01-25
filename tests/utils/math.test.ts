import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clamp,
  lerp,
  distance,
  distanceSquared,
  distanceSquaredXY,
  distanceXY,
  normalize,
  angle,
  randomRange,
  randomInt,
  SeededRandom,
} from '@/utils/math';

describe('math utilities', () => {
  it('clamps values within bounds', () => {
    assert.strictEqual(clamp(5, 0, 10), 5);
    assert.strictEqual(clamp(-2, 0, 10), 0);
    assert.strictEqual(clamp(20, 0, 10), 10);
  });

  it('interpolates linearly', () => {
    assert.strictEqual(lerp(0, 10, 0), 0);
    assert.strictEqual(lerp(0, 10, 1), 10);
    assert.strictEqual(lerp(0, 10, 0.5), 5);
  });

  it('computes distances consistently', () => {
    assert.strictEqual(distance(0, 0, 3, 4), 5);
    assert.strictEqual(distanceSquared(0, 0, 3, 4), 25);
    assert.strictEqual(distanceXY({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
    assert.strictEqual(distanceSquaredXY({ x: 0, y: 0 }, { x: 3, y: 4 }), 25);
  });

  it('normalizes vectors', () => {
    const normalized = normalize(3, 4);
    assert.ok(Math.abs(normalized.x - 0.6) < 0.0001);
    assert.ok(Math.abs(normalized.y - 0.8) < 0.0001);

    const zero = normalize(0, 0);
    assert.deepStrictEqual(zero, { x: 0, y: 0 });
  });

  it('computes angles', () => {
    assert.strictEqual(angle(0, 0, 1, 0), 0);
    assert.strictEqual(angle(0, 0, 0, 1), Math.PI / 2);
  });

  it('uses Math.random for non-deterministic helpers', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.5;

    assert.strictEqual(randomRange(0, 10), 5);
    assert.strictEqual(randomInt(0, 9), 5);

    Math.random = originalRandom;
  });

  it('generates deterministic sequences with SeededRandom', () => {
    const rngA = new SeededRandom(42);
    const rngB = new SeededRandom(42);

    assert.strictEqual(rngA.next(), rngB.next());
    assert.strictEqual(rngA.nextRange(0, 10), rngB.nextRange(0, 10));
    assert.strictEqual(rngA.nextInt(1, 5), rngB.nextInt(1, 5));

    rngA.reseed(99);
    rngB.reseed(99);
    assert.strictEqual(rngA.next(), rngB.next());
  });
});

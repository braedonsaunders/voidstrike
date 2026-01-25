import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VectorPool, clampMagnitude, normalize } from '@/utils/VectorPool';

describe('VectorPool', () => {
  it('acquires vectors, initializes values, and releases back to pool', () => {
    const vector = VectorPool.acquire();
    vector.x = 3;
    vector.y = 4;

    VectorPool.release(vector);

    const reused = VectorPool.acquire();
    assert.strictEqual(reused.x, 0);
    assert.strictEqual(reused.y, 0);
    VectorPool.release(reused);
  });

  it('supports acquireWith initialization', () => {
    const vector = VectorPool.acquireWith(5, -2);

    assert.strictEqual(vector.x, 5);
    assert.strictEqual(vector.y, -2);
    VectorPool.release(vector);
  });

  it('normalizes vectors and returns magnitude', () => {
    const vector = VectorPool.acquireWith(3, 4);
    const magnitude = normalize(vector);

    assert.strictEqual(magnitude, 5);
    assert.ok(Math.abs(vector.x - 0.6) < 1e-6);
    assert.ok(Math.abs(vector.y - 0.8) < 1e-6);
    VectorPool.release(vector);
  });

  it('clamps vector magnitude in place', () => {
    const vector = VectorPool.acquireWith(6, 8);

    clampMagnitude(vector, 5);

    const finalMagnitude = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
    assert.ok(finalMagnitude <= 5 + 1e-6);
    VectorPool.release(vector);
  });

  it('releases vectors even when callback throws', () => {
    let reusedAfterError: { x: number; y: number } | null = null;

    assert.throws(() => {
      VectorPool.withVector((vec) => {
        vec.x = 9;
        vec.y = -3;
        throw new Error('boom');
      });
    }, /boom/);

    reusedAfterError = VectorPool.acquire();
    assert.strictEqual(reusedAfterError.x, 0);
    assert.strictEqual(reusedAfterError.y, 0);
    VectorPool.release(reusedAfterError);
  });
});

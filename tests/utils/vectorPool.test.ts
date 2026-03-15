import { describe, expect, it } from 'vitest';
import { PooledVector2, VectorPool } from '@/utils/VectorPool';

describe('VectorPool', () => {
  it('acquires zeroed vectors', () => {
    const vec = VectorPool.acquire();

    expect(vec).toHaveProperty('x');
    expect(vec).toHaveProperty('y');
    expect(vec.x).toBe(0);
    expect(vec.y).toBe(0);

    VectorPool.release(vec);
  });

  it('initializes vectors with acquireWith', () => {
    const vec = VectorPool.acquireWith(10, -5);

    expect(vec.x).toBe(10);
    expect(vec.y).toBe(-5);

    VectorPool.release(vec);
  });

  it('resets vectors when they are reused from the pool', () => {
    const first = VectorPool.acquire();
    first.x = 100;
    first.y = 200;
    VectorPool.release(first);

    const reused = VectorPool.acquire();
    expect(reused.x).toBe(0);
    expect(reused.y).toBe(0);
    VectorPool.release(reused);
  });

  it('releases vectors after withVector completes', () => {
    const result = VectorPool.withVector((vec) => {
      vec.x = 3;
      vec.y = 4;
      return vec.x + vec.y;
    });

    expect(result).toBe(7);

    const vec = VectorPool.acquire();
    expect(vec.x).toBe(0);
    expect(vec.y).toBe(0);
    VectorPool.release(vec);
  });

  it('releases vectors even when withVector throws', () => {
    expect(() => {
      VectorPool.withVector(() => {
        throw new Error('boom');
      });
    }).toThrow('boom');

    const vec = VectorPool.acquire();
    expect(vec.x).toBe(0);
    expect(vec.y).toBe(0);
    VectorPool.release(vec);
  });

  it('handles batch acquire and release cycles', () => {
    const vectors: PooledVector2[] = [];

    for (let i = 0; i < 100; i++) {
      vectors.push(VectorPool.acquireWith(i, i * 2));
    }

    for (let i = 0; i < vectors.length; i++) {
      expect(vectors[i].x).toBe(i);
      expect(vectors[i].y).toBe(i * 2);
      VectorPool.release(vectors[i]);
    }
  });
});

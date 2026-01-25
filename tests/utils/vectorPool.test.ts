import { describe, it, expect, beforeEach } from 'vitest';
import { VectorPool, normalize, clampMagnitude, PooledVector2 } from '@/utils/VectorPool';

describe('VectorPool', () => {
  describe('acquire', () => {
    it('returns a vector with x and y properties', () => {
      const vec = VectorPool.acquire();

      expect(vec).toHaveProperty('x');
      expect(vec).toHaveProperty('y');

      VectorPool.release(vec);
    });

    it('returns vector initialized to (0, 0)', () => {
      const vec = VectorPool.acquire();

      expect(vec.x).toBe(0);
      expect(vec.y).toBe(0);

      VectorPool.release(vec);
    });

    it('can acquire multiple vectors', () => {
      const vec1 = VectorPool.acquire();
      const vec2 = VectorPool.acquire();

      expect(vec1).not.toBe(vec2);

      VectorPool.release(vec1);
      VectorPool.release(vec2);
    });

    it('resets values when reacquired from pool', () => {
      const vec1 = VectorPool.acquire();
      vec1.x = 100;
      vec1.y = 200;
      VectorPool.release(vec1);

      const vec2 = VectorPool.acquire();
      expect(vec2.x).toBe(0);
      expect(vec2.y).toBe(0);

      VectorPool.release(vec2);
    });
  });

  describe('acquireWith', () => {
    it('returns vector initialized with values', () => {
      const vec = VectorPool.acquireWith(10, 20);

      expect(vec.x).toBe(10);
      expect(vec.y).toBe(20);

      VectorPool.release(vec);
    });

    it('works with negative values', () => {
      const vec = VectorPool.acquireWith(-5, -10);

      expect(vec.x).toBe(-5);
      expect(vec.y).toBe(-10);

      VectorPool.release(vec);
    });

    it('works with floating point values', () => {
      const vec = VectorPool.acquireWith(1.5, 2.7);

      expect(vec.x).toBe(1.5);
      expect(vec.y).toBe(2.7);

      VectorPool.release(vec);
    });
  });

  describe('release', () => {
    it('returns vector to pool for reuse', () => {
      // Acquire several vectors and release them
      const vecs: PooledVector2[] = [];
      for (let i = 0; i < 10; i++) {
        vecs.push(VectorPool.acquire());
      }

      for (const vec of vecs) {
        VectorPool.release(vec);
      }

      // Acquiring again should reuse pooled vectors
      const newVec = VectorPool.acquire();
      expect(newVec).toBeDefined();
      VectorPool.release(newVec);
    });
  });

  describe('withVector', () => {
    it('provides vector to callback', () => {
      let called = false;
      VectorPool.withVector((vec) => {
        expect(vec.x).toBe(0);
        expect(vec.y).toBe(0);
        called = true;
      });
      expect(called).toBe(true);
    });

    it('returns value from callback', () => {
      const result = VectorPool.withVector((vec) => {
        vec.x = 3;
        vec.y = 4;
        return vec.x + vec.y;
      });

      expect(result).toBe(7);
    });

    it('releases vector after callback', () => {
      // Use withVector, then check pool has vector back
      VectorPool.withVector((vec) => {
        vec.x = 99;
        vec.y = 88;
      });

      // The vector should be back in the pool
      // Next acquire should give us a reset vector
      const vec = VectorPool.acquire();
      expect(vec.x).toBe(0);
      expect(vec.y).toBe(0);
      VectorPool.release(vec);
    });

    it('releases vector even if callback throws', () => {
      expect(() => {
        VectorPool.withVector((_vec) => {
          throw new Error('Test error');
        });
      }).toThrow('Test error');

      // Pool should still work after exception
      const vec = VectorPool.acquire();
      expect(vec.x).toBe(0);
      VectorPool.release(vec);
    });

    it('supports complex calculations', () => {
      const result = VectorPool.withVector((vec) => {
        vec.x = 3;
        vec.y = 4;
        return Math.sqrt(vec.x * vec.x + vec.y * vec.y);
      });

      expect(result).toBe(5);
    });
  });
});

describe('normalize', () => {
  it('normalizes non-zero vector', () => {
    const vec = VectorPool.acquireWith(3, 4);

    const magnitude = normalize(vec);

    expect(magnitude).toBe(5);
    expect(vec.x).toBeCloseTo(0.6);
    expect(vec.y).toBeCloseTo(0.8);

    VectorPool.release(vec);
  });

  it('returns correct magnitude for unit vector', () => {
    const vec = VectorPool.acquireWith(1, 0);

    const magnitude = normalize(vec);

    expect(magnitude).toBe(1);
    expect(vec.x).toBe(1);
    expect(vec.y).toBe(0);

    VectorPool.release(vec);
  });

  it('handles zero vector', () => {
    const vec = VectorPool.acquireWith(0, 0);

    const magnitude = normalize(vec);

    expect(magnitude).toBe(0);
    // Vector should remain unchanged (avoid division by zero)
    expect(vec.x).toBe(0);
    expect(vec.y).toBe(0);

    VectorPool.release(vec);
  });

  it('handles very small vectors', () => {
    const vec = VectorPool.acquireWith(0.00001, 0.00001);

    const magnitude = normalize(vec);

    // Small but non-zero - should normalize
    expect(magnitude).toBeGreaterThan(0);

    VectorPool.release(vec);
  });

  it('creates unit length result', () => {
    const vec = VectorPool.acquireWith(10, 20);

    normalize(vec);

    const resultMagnitude = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
    expect(resultMagnitude).toBeCloseTo(1);

    VectorPool.release(vec);
  });

  it('handles negative values', () => {
    const vec = VectorPool.acquireWith(-3, -4);

    const magnitude = normalize(vec);

    expect(magnitude).toBe(5);
    expect(vec.x).toBeCloseTo(-0.6);
    expect(vec.y).toBeCloseTo(-0.8);

    VectorPool.release(vec);
  });
});

describe('clampMagnitude', () => {
  it('clamps vector exceeding max magnitude', () => {
    const vec = VectorPool.acquireWith(6, 8); // magnitude = 10

    clampMagnitude(vec, 5);

    const resultMagnitude = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
    expect(resultMagnitude).toBeCloseTo(5);

    VectorPool.release(vec);
  });

  it('preserves direction when clamping', () => {
    const vec = VectorPool.acquireWith(6, 8); // magnitude = 10, direction = atan2(8, 6)
    const originalAngle = Math.atan2(vec.y, vec.x);

    clampMagnitude(vec, 5);

    const newAngle = Math.atan2(vec.y, vec.x);
    expect(newAngle).toBeCloseTo(originalAngle);

    VectorPool.release(vec);
  });

  it('does not modify vector under max magnitude', () => {
    const vec = VectorPool.acquireWith(3, 4); // magnitude = 5

    clampMagnitude(vec, 10);

    expect(vec.x).toBe(3);
    expect(vec.y).toBe(4);

    VectorPool.release(vec);
  });

  it('handles zero vector', () => {
    const vec = VectorPool.acquireWith(0, 0);

    clampMagnitude(vec, 5);

    expect(vec.x).toBe(0);
    expect(vec.y).toBe(0);

    VectorPool.release(vec);
  });

  it('handles vector at exactly max magnitude', () => {
    const vec = VectorPool.acquireWith(3, 4); // magnitude = 5

    clampMagnitude(vec, 5);

    expect(vec.x).toBe(3);
    expect(vec.y).toBe(4);

    VectorPool.release(vec);
  });

  it('handles negative components', () => {
    const vec = VectorPool.acquireWith(-6, -8); // magnitude = 10

    clampMagnitude(vec, 5);

    const resultMagnitude = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
    expect(resultMagnitude).toBeCloseTo(5);
    expect(vec.x).toBeLessThan(0);
    expect(vec.y).toBeLessThan(0);

    VectorPool.release(vec);
  });

  it('works with very small max magnitude', () => {
    const vec = VectorPool.acquireWith(3, 4);

    clampMagnitude(vec, 0.1);

    const resultMagnitude = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
    expect(resultMagnitude).toBeCloseTo(0.1);

    VectorPool.release(vec);
  });
});

describe('pool performance', () => {
  it('handles high volume acquire/release cycles', () => {
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const vec = VectorPool.acquire();
      vec.x = i;
      vec.y = i * 2;
      VectorPool.release(vec);
    }

    // Pool should still function correctly
    const finalVec = VectorPool.acquire();
    expect(finalVec.x).toBe(0);
    expect(finalVec.y).toBe(0);
    VectorPool.release(finalVec);
  });

  it('handles batch acquire before batch release', () => {
    const count = 100;
    const vecs: PooledVector2[] = [];

    // Acquire many
    for (let i = 0; i < count; i++) {
      vecs.push(VectorPool.acquireWith(i, i * 2));
    }

    // Verify all are independent
    for (let i = 0; i < count; i++) {
      expect(vecs[i].x).toBe(i);
      expect(vecs[i].y).toBe(i * 2);
    }

    // Release all
    for (const vec of vecs) {
      VectorPool.release(vec);
    }
  });
});

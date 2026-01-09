/**
 * VectorPool - Object pooling for temporary 2D vectors
 *
 * Eliminates garbage collection pressure from frequent vector allocations
 * in tight loops (movement, combat, pathfinding).
 *
 * Usage:
 *   const vec = VectorPool.acquire();
 *   vec.x = 10; vec.y = 20;
 *   // use vec...
 *   VectorPool.release(vec);
 *
 * Or use scoped pattern:
 *   VectorPool.withVector((vec) => {
 *     vec.x = 10; vec.y = 20;
 *     return vec.x + vec.y;
 *   });
 */

export interface PooledVector2 {
  x: number;
  y: number;
}

const INITIAL_POOL_SIZE = 64;
const MAX_POOL_SIZE = 256;

class Vector2Pool {
  private pool: PooledVector2[] = [];
  private inUse = 0;

  constructor() {
    // Pre-allocate vectors
    for (let i = 0; i < INITIAL_POOL_SIZE; i++) {
      this.pool.push({ x: 0, y: 0 });
    }
  }

  /**
   * Acquire a vector from the pool.
   * Remember to release it when done!
   */
  acquire(): PooledVector2 {
    if (this.pool.length > 0) {
      this.inUse++;
      const vec = this.pool.pop()!;
      vec.x = 0;
      vec.y = 0;
      return vec;
    }
    // Pool exhausted - create new (will be pooled on release)
    this.inUse++;
    return { x: 0, y: 0 };
  }

  /**
   * Acquire a vector and initialize it with values.
   */
  acquireWith(x: number, y: number): PooledVector2 {
    const vec = this.acquire();
    vec.x = x;
    vec.y = y;
    return vec;
  }

  /**
   * Release a vector back to the pool.
   */
  release(vec: PooledVector2): void {
    if (this.pool.length < MAX_POOL_SIZE) {
      this.pool.push(vec);
    }
    this.inUse--;
  }

  /**
   * Release multiple vectors back to the pool.
   */
  releaseAll(...vecs: PooledVector2[]): void {
    for (const vec of vecs) {
      this.release(vec);
    }
  }

  /**
   * Scoped vector usage - automatically releases after callback.
   * Use when you need a temporary vector for a quick calculation.
   */
  withVector<T>(callback: (vec: PooledVector2) => T): T {
    const vec = this.acquire();
    try {
      return callback(vec);
    } finally {
      this.release(vec);
    }
  }

  /**
   * Scoped usage with two vectors.
   */
  withVectors2<T>(callback: (v1: PooledVector2, v2: PooledVector2) => T): T {
    const v1 = this.acquire();
    const v2 = this.acquire();
    try {
      return callback(v1, v2);
    } finally {
      this.release(v1);
      this.release(v2);
    }
  }

  /**
   * Get pool statistics for debugging.
   */
  getStats(): { pooled: number; inUse: number } {
    return {
      pooled: this.pool.length,
      inUse: this.inUse,
    };
  }

  /**
   * Clear the pool (useful for cleanup).
   */
  clear(): void {
    this.pool = [];
    this.inUse = 0;
  }
}

// Singleton instance for global use
export const VectorPool = new Vector2Pool();

// Static temp vectors for simple calculations that don't need pooling
// Use these for single-frame temporary calculations within a single function
export const tempVec1: PooledVector2 = { x: 0, y: 0 };
export const tempVec2: PooledVector2 = { x: 0, y: 0 };
export const tempVec3: PooledVector2 = { x: 0, y: 0 };
export const tempVec4: PooledVector2 = { x: 0, y: 0 };

/**
 * Helper to set and return a temp vector (for chaining).
 */
export function setTemp(vec: PooledVector2, x: number, y: number): PooledVector2 {
  vec.x = x;
  vec.y = y;
  return vec;
}

/**
 * Calculate distance squared between two points (avoids sqrt).
 */
export function distanceSquared(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/**
 * Calculate distance between two points.
 */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(distanceSquared(x1, y1, x2, y2));
}

/**
 * Normalize a vector in place. Returns magnitude.
 */
export function normalize(vec: PooledVector2): number {
  const mag = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
  if (mag > 0.0001) {
    vec.x /= mag;
    vec.y /= mag;
  }
  return mag;
}

/**
 * Clamp vector magnitude. Modifies in place.
 */
export function clampMagnitude(vec: PooledVector2, maxMag: number): void {
  const magSq = vec.x * vec.x + vec.y * vec.y;
  if (magSq > maxMag * maxMag) {
    const scale = maxMag / Math.sqrt(magSq);
    vec.x *= scale;
    vec.y *= scale;
  }
}

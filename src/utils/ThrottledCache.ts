/**
 * ThrottledCache - A generic cache with time-based throttling
 *
 * Provides a reusable pattern for:
 * - Rate-limiting operations by key (e.g., alerts, searches, path requests)
 * - Caching results with automatic expiration
 * - Tick-based or timestamp-based throttling
 *
 * Replaces scattered Map<K, number> patterns across the codebase.
 */

/**
 * Configuration for ThrottledCache
 */
export interface ThrottledCacheConfig {
  /** Cooldown period in the unit specified (ticks or ms) */
  cooldown: number;
  /** Maximum entries before cleanup (0 = unlimited) */
  maxEntries?: number;
  /** Interval for automatic cleanup (entries older than this are removed) */
  cleanupAge?: number;
}

/**
 * A cache entry with timestamp and optional value
 */
interface CacheEntry<V> {
  timestamp: number;
  value: V;
}

/**
 * Generic throttled cache for rate-limiting operations by key.
 *
 * @example
 * // Tick-based throttling (for game systems)
 * const alertThrottle = new ThrottledCache<string>({ cooldown: 100 }); // 100 ticks
 * if (alertThrottle.canExecute('player1_underAttack', currentTick)) {
 *   alertThrottle.markExecuted('player1_underAttack', currentTick);
 *   emitAlert();
 * }
 *
 * @example
 * // With cached results
 * const searchCache = new ThrottledCache<number, boolean>({ cooldown: 10 });
 * const cached = searchCache.getIfValid(entityId, currentTick);
 * if (cached !== undefined) return cached;
 * const result = expensiveSearch();
 * searchCache.set(entityId, result, currentTick);
 */
export class ThrottledCache<K, V = void> {
  private cache: Map<K, CacheEntry<V>> = new Map();
  private readonly cooldown: number;
  private readonly maxEntries: number;
  private readonly cleanupAge: number;
  private lastCleanupTime = 0;

  constructor(config: ThrottledCacheConfig) {
    this.cooldown = config.cooldown;
    this.maxEntries = config.maxEntries ?? 0;
    this.cleanupAge = config.cleanupAge ?? config.cooldown * 10;
  }

  /**
   * Check if an operation can be executed (cooldown has elapsed)
   */
  canExecute(key: K, currentTime: number): boolean {
    const entry = this.cache.get(key);
    if (!entry) return true;
    return currentTime - entry.timestamp >= this.cooldown;
  }

  /**
   * Mark an operation as executed (update timestamp)
   * For void caches (rate-limiting only)
   */
  markExecuted(key: K, currentTime: number): void {
    this.cache.set(key, { timestamp: currentTime, value: undefined as V });
    this.maybeCleanup(currentTime);
  }

  /**
   * Set a cached value with timestamp
   */
  set(key: K, value: V, currentTime: number): void {
    this.cache.set(key, { timestamp: currentTime, value });
    this.maybeCleanup(currentTime);
  }

  /**
   * Get a cached value if it's still valid (within cooldown period)
   * Returns undefined if expired or not found
   */
  getIfValid(key: K, currentTime: number): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (currentTime - entry.timestamp >= this.cooldown) {
      return undefined;
    }
    return entry.value;
  }

  /**
   * Get the timestamp of the last execution for a key
   * Returns undefined if not found
   */
  getTimestamp(key: K): number | undefined {
    return this.cache.get(key)?.timestamp;
  }

  /**
   * Check if a key exists in the cache (regardless of expiration)
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a specific key from the cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the number of entries in the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Remove stale entries and enforce max entries limit
   */
  private maybeCleanup(currentTime: number): void {
    // Only run cleanup periodically
    if (currentTime - this.lastCleanupTime < this.cleanupAge / 2) {
      return;
    }
    this.lastCleanupTime = currentTime;

    // Remove stale entries
    const staleThreshold = currentTime - this.cleanupAge;
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < staleThreshold) {
        this.cache.delete(key);
      }
    }

    // Enforce max entries by removing oldest
    if (this.maxEntries > 0 && this.cache.size > this.maxEntries) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);

      const toRemove = entries.slice(0, this.cache.size - this.maxEntries);
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Convenience function to create a simple rate-limiter (no cached values)
 */
export function createRateLimiter<K>(cooldown: number): ThrottledCache<K, void> {
  return new ThrottledCache<K, void>({ cooldown });
}

/**
 * Convenience function to create a result cache with expiration
 */
export function createResultCache<K, V>(cooldown: number, maxEntries?: number): ThrottledCache<K, V> {
  return new ThrottledCache<K, V>({ cooldown, maxEntries });
}

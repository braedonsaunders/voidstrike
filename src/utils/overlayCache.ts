/**
 * Overlay Cache - IndexedDB-based caching for computed overlay data
 *
 * Caches expensive overlay computations (terrain, elevation, buildable grid)
 * to avoid recomputation on each session.
 *
 * Static overlays are cached per-map using a hash of the map data.
 */

const DB_NAME = 'voidstrike_overlay_cache';
const DB_VERSION = 1;
const STORE_NAME = 'overlays';

// Cache entry structure
interface OverlayCacheEntry {
  id: string; // mapHash_overlayType
  mapHash: string;
  overlayType: string;
  data: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
  version: number;
}

// Current cache version - increment when overlay computation changes
const CACHE_VERSION = 10;

// Max age for cached entries (7 days)
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let db: IDBDatabase | null = null;
let dbInitPromise: Promise<IDBDatabase> | null = null;

/**
 * Initialize the IndexedDB database
 */
async function initDB(): Promise<IDBDatabase> {
  if (db) return db;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.warn('[OverlayCache] Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create object store if it doesn't exist
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('mapHash', 'mapHash', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });

  return dbInitPromise;
}

/**
 * Generate a hash for map data to use as cache key
 */
export function computeMapHash(mapData: {
  width: number;
  height: number;
  terrain: Array<Array<{ terrain: string; elevation: number; feature?: string }>>;
}): string {
  // Simple hash based on map dimensions and terrain data
  const { width, height, terrain } = mapData;
  let hash = `${width}x${height}_`;

  // Sample terrain at intervals to create fingerprint
  const sampleInterval = Math.max(1, Math.floor(Math.min(width, height) / 16));
  for (let y = 0; y < height; y += sampleInterval) {
    for (let x = 0; x < width; x += sampleInterval) {
      const cell = terrain[y]?.[x];
      if (cell) {
        hash += `${cell.terrain[0]}${cell.elevation}${cell.feature?.[0] || 'n'}`;
      }
    }
  }

  // Convert to numeric hash
  let numericHash = 0;
  for (let i = 0; i < hash.length; i++) {
    numericHash = ((numericHash << 5) - numericHash + hash.charCodeAt(i)) | 0;
  }

  return `map_${Math.abs(numericHash).toString(36)}`;
}

/**
 * Get cached overlay data
 */
export async function getOverlayCache(
  mapHash: string,
  overlayType: string
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const database = await initDB();
    const id = `${mapHash}_${overlayType}`;

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entry = request.result as OverlayCacheEntry | undefined;

        if (!entry) {
          resolve(null);
          return;
        }

        // Check version
        if (entry.version !== CACHE_VERSION) {
          resolve(null);
          return;
        }

        // Check age
        const age = Date.now() - entry.timestamp;
        if (age > MAX_CACHE_AGE_MS) {
          resolve(null);
          return;
        }

        resolve({
          data: entry.data,
          width: entry.width,
          height: entry.height,
        });
      };
    });
  } catch (error) {
    console.warn('[OverlayCache] Error getting cache:', error);
    return null;
  }
}

/**
 * Store overlay data in cache
 */
export async function setOverlayCache(
  mapHash: string,
  overlayType: string,
  data: Uint8Array,
  width: number,
  height: number
): Promise<void> {
  try {
    const database = await initDB();
    const id = `${mapHash}_${overlayType}`;

    const entry: OverlayCacheEntry = {
      id,
      mapHash,
      overlayType,
      data,
      width,
      height,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(entry);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.warn('[OverlayCache] Error setting cache:', error);
  }
}

/**
 * Invalidate all cached overlays for a specific map
 */
export async function invalidateMapCache(mapHash: string): Promise<void> {
  try {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('mapHash');
      const request = index.openCursor(IDBKeyRange.only(mapHash));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  } catch (error) {
    console.warn('[OverlayCache] Error invalidating cache:', error);
  }
}

/**
 * Clear all cached overlays
 */
export async function clearAllOverlayCache(): Promise<void> {
  try {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.warn('[OverlayCache] Error clearing cache:', error);
  }
}

/**
 * Clean up old cache entries
 */
export async function cleanupOldCacheEntries(): Promise<void> {
  try {
    const database = await initDB();
    const cutoff = Date.now() - MAX_CACHE_AGE_MS;

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const request = index.openCursor(IDBKeyRange.upperBound(cutoff));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  } catch (error) {
    console.warn('[OverlayCache] Error cleaning up cache:', error);
  }
}

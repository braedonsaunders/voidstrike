/**
 * Storage Utilities
 *
 * Provides safe storage operations with:
 * - IndexedDB for large data (100s of MB limit vs ~5MB for sessionStorage)
 * - Optional compression for large data
 * - Graceful fallbacks when storage is unavailable
 */

import pako from 'pako';
import { debugInitialization } from '@/utils/debugLogger';

// IndexedDB configuration
const IDB_NAME = 'voidstrike_storage';
const IDB_VERSION = 1;
const IDB_STORE = 'keyvalue';

// Prefix for compressed data to identify it
const COMPRESSED_PREFIX = '__PAKO__';

// Storage error types
export type StorageErrorType = 'quota_exceeded' | 'storage_unavailable' | 'parse_error' | 'unknown';

export interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: StorageErrorType;
  message?: string;
}

// IndexedDB singleton
let idb: IDBDatabase | null = null;
let idbInitPromise: Promise<IDBDatabase> | null = null;

/**
 * Initialize IndexedDB
 */
async function initIndexedDB(): Promise<IDBDatabase> {
  if (idb) return idb;
  if (idbInitPromise) return idbInitPromise;

  idbInitPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onerror = () => {
      debugInitialization.warn('[Storage] Failed to open IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      idb = request.result;
      resolve(idb);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains(IDB_STORE)) {
        database.createObjectStore(IDB_STORE, { keyPath: 'key' });
      }
    };
  });

  return idbInitPromise;
}

/**
 * Check if an error is a QuotaExceededError
 */
function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return (
      error.name === 'QuotaExceededError' ||
      error.code === 22 ||
      error.code === 1014
    );
  }
  return false;
}

/**
 * Compress data using pako
 */
function compressData(data: string): Uint8Array {
  return pako.deflate(data, { level: 6 });
}

/**
 * Decompress data using pako
 */
function decompressData(data: Uint8Array): string {
  return pako.inflate(data, { to: 'string' });
}

/**
 * Compress a string for sessionStorage (returns base64)
 */
function compressString(str: string): string {
  try {
    const compressed = pako.deflate(str, { level: 6 });
    const base64 = btoa(String.fromCharCode(...compressed));
    return COMPRESSED_PREFIX + base64;
  } catch {
    return str;
  }
}

/**
 * Decompress a string from sessionStorage
 */
function decompressString(str: string): string {
  if (!str.startsWith(COMPRESSED_PREFIX)) {
    return str;
  }

  try {
    const base64 = str.slice(COMPRESSED_PREFIX.length);
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return pako.inflate(bytes, { to: 'string' });
  } catch {
    return str;
  }
}

// Threshold for compression (100KB)
const COMPRESSION_THRESHOLD = 100 * 1024;

// ============================================================================
// IndexedDB Storage (for large data like editor maps)
// ============================================================================

interface IDBEntry {
  key: string;
  value: Uint8Array;
  timestamp: number;
}

/**
 * Store large data in IndexedDB with compression
 * Use this for data that may exceed sessionStorage limits (~5MB)
 */
export async function setLargeData<T>(key: string, value: T): Promise<StorageResult<void>> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'storage_unavailable', message: 'Window not available (SSR)' };
  }

  try {
    const database = await initIndexedDB();
    const jsonString = JSON.stringify(value);
    const compressed = compressData(jsonString);

    const entry: IDBEntry = {
      key,
      value: compressed,
      timestamp: Date.now(),
    };

    return new Promise((resolve) => {
      const transaction = database.transaction(IDB_STORE, 'readwrite');
      const store = transaction.objectStore(IDB_STORE);
      const request = store.put(entry);

      request.onerror = () => {
        const error = request.error;
        if (isQuotaExceededError(error)) {
          resolve({
            success: false,
            error: 'quota_exceeded',
            message: 'IndexedDB quota exceeded. Try clearing browser data.',
          });
        } else {
          resolve({
            success: false,
            error: 'unknown',
            message: error?.message || 'Failed to store data',
          });
        }
      };

      request.onsuccess = () => {
        resolve({ success: true });
      };
    });
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return {
        success: false,
        error: 'quota_exceeded',
        message: 'IndexedDB quota exceeded.',
      };
    }
    return {
      success: false,
      error: 'unknown',
      message: error instanceof Error ? error.message : 'Failed to store data',
    };
  }
}

/**
 * Get large data from IndexedDB
 */
export async function getLargeData<T>(key: string): Promise<StorageResult<T>> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'storage_unavailable', message: 'Window not available (SSR)' };
  }

  try {
    const database = await initIndexedDB();

    return new Promise((resolve) => {
      const transaction = database.transaction(IDB_STORE, 'readonly');
      const store = transaction.objectStore(IDB_STORE);
      const request = store.get(key);

      request.onerror = () => {
        resolve({
          success: false,
          error: 'unknown',
          message: request.error?.message || 'Failed to retrieve data',
        });
      };

      request.onsuccess = () => {
        const entry = request.result as IDBEntry | undefined;
        if (!entry) {
          resolve({ success: true, data: undefined });
          return;
        }

        try {
          const jsonString = decompressData(entry.value);
          const parsed = JSON.parse(jsonString) as T;
          resolve({ success: true, data: parsed });
        } catch (parseError) {
          resolve({
            success: false,
            error: 'parse_error',
            message: 'Failed to parse stored data',
          });
        }
      };
    });
  } catch (error) {
    return {
      success: false,
      error: 'unknown',
      message: error instanceof Error ? error.message : 'Failed to retrieve data',
    };
  }
}

/**
 * Remove large data from IndexedDB
 */
export async function removeLargeData(key: string): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const database = await initIndexedDB();

    return new Promise((resolve) => {
      const transaction = database.transaction(IDB_STORE, 'readwrite');
      const store = transaction.objectStore(IDB_STORE);
      const request = store.delete(key);

      request.onerror = () => resolve();
      request.onsuccess = () => resolve();
    });
  } catch {
    // Ignore errors when removing
  }
}

// ============================================================================
// SessionStorage (for smaller, session-scoped data)
// ============================================================================

/**
 * Safely set an item in sessionStorage with quota error handling
 */
export function safeSessionStorageSet<T>(key: string, value: T, useCompression = true): StorageResult<void> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'storage_unavailable', message: 'Window not available (SSR)' };
  }

  try {
    let stringValue = JSON.stringify(value);

    if (useCompression && stringValue.length > COMPRESSION_THRESHOLD) {
      const compressed = compressString(stringValue);
      if (compressed.length < stringValue.length) {
        stringValue = compressed;
      }
    }

    sessionStorage.setItem(key, stringValue);
    return { success: true };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      const cleared = clearOldSessionStorageItems(key);

      if (cleared) {
        try {
          let stringValue = JSON.stringify(value);
          if (useCompression && stringValue.length > COMPRESSION_THRESHOLD) {
            const compressed = compressString(stringValue);
            if (compressed.length < stringValue.length) {
              stringValue = compressed;
            }
          }
          sessionStorage.setItem(key, stringValue);
          return { success: true };
        } catch (retryError) {
          if (isQuotaExceededError(retryError)) {
            return {
              success: false,
              error: 'quota_exceeded',
              message: 'Storage quota exceeded. The map data is too large to store.',
            };
          }
        }
      }

      return {
        success: false,
        error: 'quota_exceeded',
        message: 'Storage quota exceeded. The map data is too large to store.',
      };
    }

    return {
      success: false,
      error: 'unknown',
      message: error instanceof Error ? error.message : 'Unknown storage error',
    };
  }
}

/**
 * Safely get an item from sessionStorage
 */
export function safeSessionStorageGet<T>(key: string): StorageResult<T> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'storage_unavailable', message: 'Window not available (SSR)' };
  }

  try {
    const stored = sessionStorage.getItem(key);
    if (stored === null) {
      return { success: true, data: undefined };
    }

    const decompressed = decompressString(stored);
    const parsed = JSON.parse(decompressed) as T;
    return { success: true, data: parsed };
  } catch (error) {
    return {
      success: false,
      error: 'parse_error',
      message: error instanceof Error ? error.message : 'Failed to parse stored data',
    };
  }
}

/**
 * Safely remove an item from sessionStorage
 */
export function safeSessionStorageRemove(key: string): void {
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore errors when removing
  }
}

// ============================================================================
// LocalStorage (for persistent settings)
// ============================================================================

/**
 * Safely set an item in localStorage with quota error handling
 */
export function safeLocalStorageSet<T>(key: string, value: T, useCompression = true): StorageResult<void> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'storage_unavailable', message: 'Window not available (SSR)' };
  }

  try {
    let stringValue = JSON.stringify(value);

    if (useCompression && stringValue.length > COMPRESSION_THRESHOLD) {
      const compressed = compressString(stringValue);
      if (compressed.length < stringValue.length) {
        stringValue = compressed;
      }
    }

    localStorage.setItem(key, stringValue);
    return { success: true };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return {
        success: false,
        error: 'quota_exceeded',
        message: 'Storage quota exceeded. Consider clearing saved maps to free up space.',
      };
    }

    return {
      success: false,
      error: 'unknown',
      message: error instanceof Error ? error.message : 'Unknown storage error',
    };
  }
}

/**
 * Safely get an item from localStorage
 */
export function safeLocalStorageGet<T>(key: string): StorageResult<T> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'storage_unavailable', message: 'Window not available (SSR)' };
  }

  try {
    const stored = localStorage.getItem(key);
    if (stored === null) {
      return { success: true, data: undefined };
    }

    const decompressed = decompressString(stored);
    const parsed = JSON.parse(decompressed) as T;
    return { success: true, data: parsed };
  } catch (error) {
    return {
      success: false,
      error: 'parse_error',
      message: error instanceof Error ? error.message : 'Failed to parse stored data',
    };
  }
}

/**
 * Clear old sessionStorage items related to VOIDSTRIKE (except the specified key)
 */
function clearOldSessionStorageItems(exceptKey: string): boolean {
  if (typeof window === 'undefined') return false;

  const voidstrikeKeys: string[] = [];

  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && key.startsWith('voidstrike_') && key !== exceptKey) {
      voidstrikeKeys.push(key);
    }
  }

  let cleared = false;
  for (const key of voidstrikeKeys) {
    try {
      sessionStorage.removeItem(key);
      cleared = true;
    } catch {
      // Ignore
    }
  }

  return cleared;
}

/**
 * Get estimated storage usage for debugging
 */
export function getStorageUsage(): { session: number; local: number } {
  if (typeof window === 'undefined') {
    return { session: 0, local: 0 };
  }

  let sessionSize = 0;
  let localSize = 0;

  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key) {
        const value = sessionStorage.getItem(key);
        sessionSize += (key.length + (value?.length || 0)) * 2;
      }
    }
  } catch {
    // Ignore
  }

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        localSize += (key.length + (value?.length || 0)) * 2;
      }
    }
  } catch {
    // Ignore
  }

  return { session: sessionSize, local: localSize };
}

/**
 * GLTF Worker Manager - Manages Web Worker for GLB file fetching
 *
 * Provides a simple API to fetch GLB files off the main thread.
 * Uses ArrayBuffer transfer for zero-copy data passing.
 *
 * NOTE: Worker is disabled by default due to Next.js compatibility issues.
 * The main thread fallback provides the same functionality with slightly
 * less responsiveness during loading.
 */

import type { FetchResponse, BatchFetchResponse, WorkerRequest, WorkerResponse } from './gltf.worker';

// Enable worker - file is named *.worker.ts to match webpack worker-loader config
const ENABLE_WORKER = true;

// Timeout for worker requests (ms) - falls back to main thread if exceeded
const WORKER_TIMEOUT = 10000;

class GLTFWorkerManager {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: ArrayBuffer | null) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>();
  private pendingBatchRequests = new Map<number, {
    resolve: (results: Map<string, ArrayBuffer | null>) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>();
  private isSupported = false;
  private workerFailed = false;

  constructor() {
    // Check if Web Workers are supported and enabled
    this.isSupported = ENABLE_WORKER && typeof Worker !== 'undefined';
  }

  /**
   * Initialize the worker (lazy initialization)
   */
  private initWorker(): void {
    if (this.worker || !this.isSupported || this.workerFailed) return;

    try {
      // Create worker - named *.worker.ts to match webpack worker-loader pattern
      this.worker = new Worker(
        new URL('./gltf.worker.ts', import.meta.url)
      );

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleMessage(event.data);
      };

      this.worker.onerror = (error) => {
        console.warn('[GLTFWorkerManager] Worker error, falling back to main thread:', error);
        this.workerFailed = true;
        this.worker?.terminate();
        this.worker = null;
        // Reject all pending requests - they'll be retried on main thread
        for (const [id, { reject, timeoutId }] of this.pendingRequests) {
          clearTimeout(timeoutId);
          reject(new Error('Worker error'));
          this.pendingRequests.delete(id);
        }
        for (const [id, { reject, timeoutId }] of this.pendingBatchRequests) {
          clearTimeout(timeoutId);
          reject(new Error('Worker error'));
          this.pendingBatchRequests.delete(id);
        }
      };
    } catch (error) {
      console.warn('[GLTFWorkerManager] Failed to create worker, using main thread:', error);
      this.workerFailed = true;
      this.isSupported = false;
    }
  }

  /**
   * Handle messages from worker
   */
  private handleMessage(response: WorkerResponse): void {
    if (response.type === 'fetchResult') {
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(response.id);
        if (response.success && response.data) {
          pending.resolve(response.data);
        } else {
          pending.resolve(null);
        }
      }
    } else if (response.type === 'batchFetchResult') {
      const pending = this.pendingBatchRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        this.pendingBatchRequests.delete(response.id);
        const results = new Map<string, ArrayBuffer | null>();
        for (const result of response.results) {
          results.set(result.url, result.success && result.data ? result.data : null);
        }
        pending.resolve(results);
      }
    }
  }

  /**
   * Check if worker is available
   */
  isAvailable(): boolean {
    return this.isSupported && !this.workerFailed;
  }

  /**
   * Fetch a single GLB file via worker (or main thread fallback)
   * Returns null if file doesn't exist or fetch failed
   */
  async fetch(url: string): Promise<ArrayBuffer | null> {
    // Use main thread if worker not supported or failed
    if (!this.isSupported || this.workerFailed) {
      return this.fetchMainThread(url);
    }

    this.initWorker();
    if (!this.worker) {
      return this.fetchMainThread(url);
    }

    const id = ++this.requestId;

    return new Promise<ArrayBuffer | null>((resolve) => {
      // Set timeout to fall back to main thread
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        console.warn(`[GLTFWorkerManager] Worker timeout for ${url}, using main thread`);
        this.fetchMainThread(url).then(resolve);
      }, WORKER_TIMEOUT);

      this.pendingRequests.set(id, {
        resolve,
        reject: () => {
          // On reject, fall back to main thread
          this.fetchMainThread(url).then(resolve);
        },
        timeoutId
      });

      const request: WorkerRequest = {
        type: 'fetch',
        id,
        url,
      };

      this.worker!.postMessage(request);
    });
  }

  /**
   * Fetch multiple GLB files in parallel via worker
   * Returns a Map of URL -> ArrayBuffer (or null if fetch failed)
   */
  async batchFetch(urls: string[]): Promise<Map<string, ArrayBuffer | null>> {
    if (urls.length === 0) {
      return new Map();
    }

    // Use main thread if worker not supported or failed
    if (!this.isSupported || this.workerFailed) {
      return this.batchFetchMainThread(urls);
    }

    this.initWorker();
    if (!this.worker) {
      return this.batchFetchMainThread(urls);
    }

    const id = ++this.requestId;

    return new Promise<Map<string, ArrayBuffer | null>>((resolve) => {
      // Set timeout to fall back to main thread
      const timeoutId = setTimeout(() => {
        this.pendingBatchRequests.delete(id);
        console.warn(`[GLTFWorkerManager] Worker timeout for batch fetch, using main thread`);
        this.batchFetchMainThread(urls).then(resolve);
      }, WORKER_TIMEOUT);

      this.pendingBatchRequests.set(id, {
        resolve,
        reject: () => {
          // On reject, fall back to main thread
          this.batchFetchMainThread(urls).then(resolve);
        },
        timeoutId
      });

      const request: WorkerRequest = {
        type: 'batchFetch',
        id,
        urls,
      };

      this.worker!.postMessage(request);
    });
  }

  /**
   * Fallback: Fetch on main thread
   */
  private async fetchMainThread(url: string): Promise<ArrayBuffer | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.arrayBuffer();
    } catch {
      return null;
    }
  }

  /**
   * Fallback: Batch fetch on main thread
   */
  private async batchFetchMainThread(urls: string[]): Promise<Map<string, ArrayBuffer | null>> {
    const results = new Map<string, ArrayBuffer | null>();
    await Promise.all(
      urls.map(async (url) => {
        results.set(url, await this.fetchMainThread(url));
      })
    );
    return results;
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const { timeoutId } of this.pendingRequests.values()) {
      clearTimeout(timeoutId);
    }
    for (const { timeoutId } of this.pendingBatchRequests.values()) {
      clearTimeout(timeoutId);
    }
    this.pendingRequests.clear();
    this.pendingBatchRequests.clear();
  }
}

// Singleton instance
export const gltfWorkerManager = new GLTFWorkerManager();

export default gltfWorkerManager;

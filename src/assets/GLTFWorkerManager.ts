/**
 * GLTF Worker Manager - Manages Web Worker for GLB file fetching
 *
 * Provides a simple API to fetch GLB files off the main thread.
 * Uses ArrayBuffer transfer for zero-copy data passing.
 */

import type { FetchResponse, BatchFetchResponse, WorkerRequest, WorkerResponse } from './gltfWorker';

class GLTFWorkerManager {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: ArrayBuffer | null) => void;
    reject: (error: Error) => void;
  }>();
  private pendingBatchRequests = new Map<number, {
    resolve: (results: Map<string, ArrayBuffer | null>) => void;
    reject: (error: Error) => void;
  }>();
  private isSupported = false;

  constructor() {
    // Check if Web Workers are supported
    this.isSupported = typeof Worker !== 'undefined';
  }

  /**
   * Initialize the worker (lazy initialization)
   */
  private initWorker(): void {
    if (this.worker || !this.isSupported) return;

    try {
      // Create worker from module
      this.worker = new Worker(
        new URL('./gltfWorker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleMessage(event.data);
      };

      this.worker.onerror = (error) => {
        console.error('[GLTFWorkerManager] Worker error:', error);
        // Reject all pending requests
        for (const [id, { reject }] of this.pendingRequests) {
          reject(new Error('Worker error'));
          this.pendingRequests.delete(id);
        }
        for (const [id, { reject }] of this.pendingBatchRequests) {
          reject(new Error('Worker error'));
          this.pendingBatchRequests.delete(id);
        }
      };
    } catch (error) {
      console.warn('[GLTFWorkerManager] Failed to create worker, falling back to main thread:', error);
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
    return this.isSupported;
  }

  /**
   * Fetch a single GLB file via worker
   * Returns null if file doesn't exist or fetch failed
   */
  async fetch(url: string): Promise<ArrayBuffer | null> {
    // Fallback to main thread if worker not supported
    if (!this.isSupported) {
      return this.fetchMainThread(url);
    }

    this.initWorker();
    if (!this.worker) {
      return this.fetchMainThread(url);
    }

    const id = ++this.requestId;

    return new Promise<ArrayBuffer | null>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

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

    // Fallback to main thread if worker not supported
    if (!this.isSupported) {
      return this.batchFetchMainThread(urls);
    }

    this.initWorker();
    if (!this.worker) {
      return this.batchFetchMainThread(urls);
    }

    const id = ++this.requestId;

    return new Promise<Map<string, ArrayBuffer | null>>((resolve, reject) => {
      this.pendingBatchRequests.set(id, { resolve, reject });

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
    this.pendingRequests.clear();
    this.pendingBatchRequests.clear();
  }
}

// Singleton instance
export const gltfWorkerManager = new GLTFWorkerManager();

export default gltfWorkerManager;

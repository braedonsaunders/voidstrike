/// <reference lib="webworker" />
/**
 * GLTF Worker - Offloads network I/O for GLB file fetching
 *
 * This worker fetches GLB files in parallel and returns ArrayBuffers to the main thread.
 * The main thread then parses the data with GLTFLoader.parse() without blocking the UI.
 *
 * Benefits:
 * - Network I/O happens off main thread
 * - Multiple files fetched concurrently
 * - Main thread stays responsive during loading
 * - ArrayBuffer transfer is zero-copy
 */

// Declare self as DedicatedWorkerGlobalScope for proper TypeScript support
declare const self: DedicatedWorkerGlobalScope;

// Log immediately when worker script loads
console.log('[gltf.worker] Worker script loaded and executing');

export interface FetchRequest {
  type: 'fetch';
  id: number;
  url: string;
}

export interface FetchResponse {
  type: 'fetchResult';
  id: number;
  url: string;
  success: boolean;
  data?: ArrayBuffer;
  error?: string;
}

export interface BatchFetchRequest {
  type: 'batchFetch';
  id: number;
  urls: string[];
}

export interface BatchFetchResponse {
  type: 'batchFetchResult';
  id: number;
  results: Array<{
    url: string;
    success: boolean;
    data?: ArrayBuffer;
    error?: string;
  }>;
}

export type WorkerRequest = FetchRequest | BatchFetchRequest;
export type WorkerResponse = FetchResponse | BatchFetchResponse;

/**
 * Fetch a single GLB file
 */
async function fetchGLB(url: string): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }
    const data = await response.arrayBuffer();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle incoming messages from main thread
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  console.log('[gltf.worker] Received message:', event.data);
  const request = event.data;

  if (request.type === 'fetch') {
    console.log('[gltf.worker] Fetching:', request.url);
    const result = await fetchGLB(request.url);
    const response: FetchResponse = {
      type: 'fetchResult',
      id: request.id,
      url: request.url,
      ...result,
    };

    // Transfer ArrayBuffer ownership (zero-copy)
    if (result.data) {
      self.postMessage(response, [result.data]);
    } else {
      self.postMessage(response);
    }
  } else if (request.type === 'batchFetch') {
    // Fetch all URLs in parallel
    const results = await Promise.all(
      request.urls.map(async (url) => {
        const result = await fetchGLB(url);
        return { url, ...result };
      })
    );

    const response: BatchFetchResponse = {
      type: 'batchFetchResult',
      id: request.id,
      results,
    };

    // Transfer all ArrayBuffers
    const transfers = results
      .filter((r) => r.data)
      .map((r) => r.data as ArrayBuffer);

    self.postMessage(response, transfers);
  }
};

// Export empty object to satisfy module requirements
export {};

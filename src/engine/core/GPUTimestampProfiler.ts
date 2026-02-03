/**
 * GPUTimestampProfiler - Measures actual GPU execution time using WebGPU timestamp queries
 *
 * Uses the optional 'timestamp-query' WebGPU feature to measure how long the GPU
 * spends executing render passes. This provides accurate GPU timing rather than
 * CPU-side estimates of render call duration.
 *
 * Key design decisions:
 * - Double-buffered result buffers to avoid GPU stalls (read frame N-2 while N renders)
 * - Async readback that doesn't block the render loop
 * - Graceful fallback when timestamp-query is not supported
 * - Handles Chrome's 100µs quantization (values are still useful for relative comparisons)
 *
 * Usage:
 *   const profiler = new GPUTimestampProfiler(device);
 *   // In render loop:
 *   profiler.beginFrame();
 *   // ... render ...
 *   profiler.endFrame(commandEncoder);
 *   const timing = profiler.getLastFrameTime();
 */

/**
 * Result of GPU timing measurement
 */
export interface GPUTimingResult {
  /** GPU frame time in milliseconds */
  frameTimeMs: number;
  /** Whether timing data is available (may be false for first few frames) */
  available: boolean;
  /** Whether values are quantized (Chrome defaults to 100µs precision) */
  quantized: boolean;
  /** Raw nanosecond values for debugging */
  rawNanoseconds?: {
    begin: bigint;
    end: bigint;
  };
}

/**
 * Internal buffer set for timestamp queries
 * We use multiple sets to avoid GPU stalls during readback
 */
interface TimestampBufferSet {
  querySet: GPUQuerySet;
  resolveBuffer: GPUBuffer;
  resultBuffer: GPUBuffer;
  state: 'available' | 'pending' | 'ready';
  frameNumber: number;
}

/**
 * Number of buffer sets for double/triple buffering
 * Using 3 allows reading frame N-2 while N is rendering
 */
const BUFFER_COUNT = 3;

/**
 * Singleton class for GPU timestamp profiling
 */
export class GPUTimestampProfiler {
  private static instance: GPUTimestampProfiler | null = null;

  private device: GPUDevice | null = null;
  private supported: boolean = false;
  private bufferSets: TimestampBufferSet[] = [];
  private currentBufferIndex: number = 0;
  private frameNumber: number = 0;
  private lastResult: GPUTimingResult = {
    frameTimeMs: 0,
    available: false,
    quantized: true,
  };

  /** Rolling average for smoothing (last 60 frames) */
  private timingHistory: number[] = [];
  private readonly HISTORY_SIZE = 60;

  /** Timestamps for the current frame */
  private currentFrameBeginTime: number = 0;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): GPUTimestampProfiler {
    if (!GPUTimestampProfiler.instance) {
      GPUTimestampProfiler.instance = new GPUTimestampProfiler();
    }
    return GPUTimestampProfiler.instance;
  }

  /**
   * Get the singleton instance (sync access)
   */
  public static getInstanceSync(): GPUTimestampProfiler | null {
    return GPUTimestampProfiler.instance;
  }

  /**
   * Reset the singleton instance (for game restart)
   */
  public static resetInstance(): void {
    if (GPUTimestampProfiler.instance) {
      GPUTimestampProfiler.instance.dispose();
    }
    GPUTimestampProfiler.instance = null;
  }

  /**
   * Initialize the profiler with a WebGPU device
   * Must be called before any profiling can occur
   *
   * @param device - WebGPU device with timestamp-query feature enabled
   * @returns true if initialization succeeded
   */
  public initialize(device: GPUDevice): boolean {
    if (this.device) {
      console.warn('[GPUTimestampProfiler] Already initialized');
      return this.supported;
    }

    this.device = device;
    this.supported = device.features.has('timestamp-query');

    if (!this.supported) {
      console.log('[GPUTimestampProfiler] timestamp-query feature not available');
      return false;
    }

    try {
      this.createBufferSets();
      console.log('[GPUTimestampProfiler] Initialized with timestamp-query support');
      return true;
    } catch (error) {
      console.error('[GPUTimestampProfiler] Failed to create query buffers:', error);
      this.supported = false;
      return false;
    }
  }

  /**
   * Check if GPU timing is supported
   */
  public isSupported(): boolean {
    return this.supported;
  }

  /**
   * Create the query sets and buffers for timestamp collection
   */
  private createBufferSets(): void {
    if (!this.device) return;

    for (let i = 0; i < BUFFER_COUNT; i++) {
      // Query set holds 2 timestamps: begin and end of frame
      const querySet = this.device.createQuerySet({
        type: 'timestamp',
        count: 2,
        label: `timestamp-query-set-${i}`,
      });

      // Resolve buffer receives query results (8 bytes per timestamp = 16 bytes total)
      const resolveBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        label: `timestamp-resolve-buffer-${i}`,
      });

      // Result buffer is mappable for CPU readback
      const resultBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        label: `timestamp-result-buffer-${i}`,
      });

      this.bufferSets.push({
        querySet,
        resolveBuffer,
        resultBuffer,
        state: 'available',
        frameNumber: -1,
      });
    }
  }

  /**
   * Mark the beginning of a frame for timing
   * Call this before starting render passes
   */
  public beginFrame(): void {
    if (!this.supported || !this.device) return;

    this.currentFrameBeginTime = performance.now();
    this.frameNumber++;

    // Try to read back completed results from previous frames
    this.processCompletedBuffers();
  }

  /**
   * Get timestamp writes configuration for a render pass
   * Attach this to your render pass descriptor
   *
   * @returns Timestamp writes config or undefined if not supported
   */
  public getTimestampWrites(): GPURenderPassTimestampWrites | undefined {
    if (!this.supported) return undefined;

    const bufferSet = this.bufferSets[this.currentBufferIndex];
    if (bufferSet.state !== 'available') {
      // All buffers are in use, skip timing this frame
      return undefined;
    }

    return {
      querySet: bufferSet.querySet,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1,
    };
  }

  /**
   * Mark the end of a frame and resolve timestamp queries
   * Call this after all render passes are complete, before submitting the command buffer
   *
   * @param commandEncoder - The command encoder to add resolve commands to
   */
  public endFrame(commandEncoder: GPUCommandEncoder): void {
    if (!this.supported || !this.device) return;

    const bufferSet = this.bufferSets[this.currentBufferIndex];
    if (bufferSet.state !== 'available') {
      // Buffer was skipped this frame
      return;
    }

    // Resolve queries to the resolve buffer
    commandEncoder.resolveQuerySet(
      bufferSet.querySet,
      0, // First query
      2, // Query count
      bufferSet.resolveBuffer,
      0 // Destination offset
    );

    // Copy to mappable result buffer
    commandEncoder.copyBufferToBuffer(
      bufferSet.resolveBuffer,
      0,
      bufferSet.resultBuffer,
      0,
      16
    );

    // Mark buffer as pending readback
    bufferSet.state = 'pending';
    bufferSet.frameNumber = this.frameNumber;

    // Start async map for readback
    this.startBufferReadback(bufferSet);

    // Move to next buffer
    this.currentBufferIndex = (this.currentBufferIndex + 1) % BUFFER_COUNT;
  }

  /**
   * Start async readback of a buffer set
   */
  private startBufferReadback(bufferSet: TimestampBufferSet): void {
    bufferSet.resultBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        bufferSet.state = 'ready';
      })
      .catch((error) => {
        // Map failed (device lost, etc.) - reset buffer state
        console.warn('[GPUTimestampProfiler] Buffer map failed:', error);
        bufferSet.state = 'available';
      });
  }

  /**
   * Process any completed buffer readbacks
   */
  private processCompletedBuffers(): void {
    for (const bufferSet of this.bufferSets) {
      if (bufferSet.state === 'ready') {
        this.readTimestampResult(bufferSet);
        bufferSet.resultBuffer.unmap();
        bufferSet.state = 'available';
      }
    }
  }

  /**
   * Read timestamp result from a mapped buffer
   */
  private readTimestampResult(bufferSet: TimestampBufferSet): void {
    try {
      const data = new BigUint64Array(bufferSet.resultBuffer.getMappedRange());
      const beginNs = data[0];
      const endNs = data[1];

      // Calculate duration in milliseconds
      // Timestamps are in nanoseconds
      const durationNs = Number(endNs - beginNs);
      const durationMs = durationNs / 1_000_000;

      // Sanity check - reject obviously wrong values
      // (GPU time shouldn't be negative or > 1 second per frame)
      if (durationMs >= 0 && durationMs < 1000) {
        this.lastResult = {
          frameTimeMs: durationMs,
          available: true,
          quantized: true, // Chrome quantizes to 100µs
          rawNanoseconds: {
            begin: beginNs,
            end: endNs,
          },
        };

        // Update rolling history
        this.timingHistory.push(durationMs);
        if (this.timingHistory.length > this.HISTORY_SIZE) {
          this.timingHistory.shift();
        }
      }
    } catch (error) {
      console.warn('[GPUTimestampProfiler] Failed to read timestamp result:', error);
    }
  }

  /**
   * Get the last available GPU frame time
   *
   * @returns GPU timing result (may be from a few frames ago due to async readback)
   */
  public getLastFrameTime(): GPUTimingResult {
    return this.lastResult;
  }

  /**
   * Get the average GPU frame time over recent frames
   *
   * @returns Average frame time in milliseconds, or 0 if no data
   */
  public getAverageFrameTime(): number {
    if (this.timingHistory.length === 0) return 0;
    const sum = this.timingHistory.reduce((a, b) => a + b, 0);
    return sum / this.timingHistory.length;
  }

  /**
   * Get the maximum GPU frame time over recent frames
   *
   * @returns Max frame time in milliseconds, or 0 if no data
   */
  public getMaxFrameTime(): number {
    if (this.timingHistory.length === 0) return 0;
    return Math.max(...this.timingHistory);
  }

  /**
   * Get the minimum GPU frame time over recent frames
   *
   * @returns Min frame time in milliseconds, or 0 if no data
   */
  public getMinFrameTime(): number {
    if (this.timingHistory.length === 0) return 0;
    return Math.min(...this.timingHistory);
  }

  /**
   * Get timing statistics
   */
  public getStats(): {
    current: number;
    average: number;
    min: number;
    max: number;
    sampleCount: number;
  } {
    return {
      current: this.lastResult.frameTimeMs,
      average: this.getAverageFrameTime(),
      min: this.getMinFrameTime(),
      max: this.getMaxFrameTime(),
      sampleCount: this.timingHistory.length,
    };
  }

  /**
   * Clear timing history
   */
  public clearHistory(): void {
    this.timingHistory = [];
    this.lastResult = {
      frameTimeMs: 0,
      available: false,
      quantized: true,
    };
  }

  /**
   * Clean up GPU resources
   */
  public dispose(): void {
    for (const bufferSet of this.bufferSets) {
      bufferSet.querySet.destroy();
      bufferSet.resolveBuffer.destroy();
      bufferSet.resultBuffer.destroy();
    }
    this.bufferSets = [];
    this.device = null;
    this.supported = false;
    this.timingHistory = [];
  }
}

// Convenience functions for backward compatibility
export function getGPUTimestampProfiler(): GPUTimestampProfiler {
  return GPUTimestampProfiler.getInstance();
}

export function getGPUTimestampProfilerSync(): GPUTimestampProfiler | null {
  return GPUTimestampProfiler.getInstanceSync();
}

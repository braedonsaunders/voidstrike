/**
 * PerformanceMonitor - Real-time performance metrics collection and analysis
 *
 * Tracks:
 * - Frame times and FPS
 * - Per-system tick durations
 * - Entity counts by type
 * - Memory usage (Chrome only)
 * - Network latency (multiplayer)
 */

export interface SystemTiming {
  name: string;
  duration: number; // ms
  percentage: number; // % of total tick time
}

export interface FrameMetrics {
  timestamp: number;
  frameTime: number; // ms
  fps: number;
  tickTime: number; // ms for game tick
  systemTimings: SystemTiming[];
}

export interface EntityCounts {
  total: number;
  units: number;
  buildings: number;
  projectiles: number;
  resources: number;
  effects: number;
}

export interface MemoryMetrics {
  usedJSHeapSize: number; // bytes
  totalJSHeapSize: number; // bytes
  jsHeapSizeLimit: number; // bytes
  available: boolean;
}

export interface NetworkMetrics {
  rtt: number; // round trip time in ms
  packetLoss: number; // percentage
  connected: boolean;
}

export interface RenderMetrics {
  drawCalls: number;       // Draw calls this frame (from Three.js renderer.info)
  triangles: number;       // Triangles rendered this frame
  drawCallsPerSecond: number; // Estimated draw calls per second (drawCalls * fps)
  trianglesPerSecond: number; // Estimated triangles per second (triangles * fps)
}

export interface PerformanceSnapshot {
  timestamp: number;
  fps: number;
  frameTime: number;
  tickTime: number;
  systemTimings: SystemTiming[];
  entityCounts: EntityCounts;
  memory: MemoryMetrics;
  network: NetworkMetrics;
  render: RenderMetrics;
}

// History buffer size (at 60fps, 300 = 5 seconds of history)
const HISTORY_SIZE = 300;
const SYSTEM_TIMING_HISTORY_SIZE = 60; // 1 second at 60fps for system breakdown

/**
 * PERF: Ring buffer for O(1) push/evict instead of O(n) shift()
 * At 300 entries, shift() moves 299 elements every frame - ring buffer avoids this
 */
class RingBuffer {
  private buffer: number[];
  private writeIndex: number = 0;
  private count: number = 0;
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(0);
  }

  push(value: number): void {
    this.buffer[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  // Get values in chronological order (oldest first)
  toArray(): number[] {
    if (this.count < this.capacity) {
      return this.buffer.slice(0, this.count);
    }
    // Ring wrapped - need to reorder
    const result = new Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      result[i] = this.buffer[(this.writeIndex + i) % this.capacity];
    }
    return result;
  }

  get length(): number {
    return this.count;
  }

  // Get the most recent value
  latest(): number {
    if (this.count === 0) return 0;
    const index = (this.writeIndex - 1 + this.capacity) % this.capacity;
    return this.buffer[index];
  }
}

class PerformanceMonitorClass {
  private static instance: PerformanceMonitorClass | null = null;

  // Collection toggle - when false, recording methods become no-ops
  private collectingEnabled: boolean = false;

  // Frame timing - use RingBuffer for O(1) insertion
  private lastFrameTime: number = 0;
  private frameTimeHistory: RingBuffer = new RingBuffer(HISTORY_SIZE);
  private fpsHistory: RingBuffer = new RingBuffer(HISTORY_SIZE);

  // Tick timing from World
  private lastTickTime: number = 0;
  private tickTimeHistory: RingBuffer = new RingBuffer(HISTORY_SIZE);

  // Per-system timings (updated by World)
  private currentSystemTimings: Map<string, number> = new Map();
  private systemTimingHistory: Map<string, RingBuffer> = new Map();

  // Entity counts
  private entityCounts: EntityCounts = {
    total: 0,
    units: 0,
    buildings: 0,
    projectiles: 0,
    resources: 0,
    effects: 0,
  };

  // Memory (Chrome only)
  private memoryMetrics: MemoryMetrics = {
    usedJSHeapSize: 0,
    totalJSHeapSize: 0,
    jsHeapSizeLimit: 0,
    available: false,
  };

  // Network
  private networkMetrics: NetworkMetrics = {
    rtt: 0,
    packetLoss: 0,
    connected: false,
  };

  // Render metrics (GPU)
  private renderMetrics: RenderMetrics = {
    drawCalls: 0,
    triangles: 0,
    drawCallsPerSecond: 0,
    trianglesPerSecond: 0,
  };

  // Animation frame for continuous monitoring
  private animationFrameId: number | null = null;
  private isMonitoring: boolean = false;

  // Listeners for real-time updates
  private listeners: Set<(snapshot: PerformanceSnapshot) => void> = new Set();

  private constructor() {
    this.checkMemoryAvailability();
  }

  public static getInstance(): PerformanceMonitorClass {
    if (!PerformanceMonitorClass.instance) {
      PerformanceMonitorClass.instance = new PerformanceMonitorClass();
    }
    return PerformanceMonitorClass.instance;
  }

  private checkMemoryAvailability(): void {
    // Chrome-specific memory API
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      this.memoryMetrics.available = true;
    }
  }

  /**
   * Start monitoring performance metrics
   */
  public start(): void {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    this.collectingEnabled = true;
    this.lastFrameTime = performance.now();
    this.tick();
  }

  /**
   * Stop monitoring
   */
  public stop(): void {
    this.isMonitoring = false;
    this.collectingEnabled = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Check if collection is currently enabled
   */
  public isCollecting(): boolean {
    return this.collectingEnabled;
  }

  /**
   * Enable or disable data collection without affecting the monitoring loop
   * Use this to pause collection when the dashboard is hidden
   */
  public setCollecting(enabled: boolean): void {
    this.collectingEnabled = enabled;
  }

  private tick = (): void => {
    if (!this.isMonitoring) return;

    const now = performance.now();
    const frameTime = now - this.lastFrameTime;
    this.lastFrameTime = now;

    // Record frame time - RingBuffer handles capacity automatically
    this.frameTimeHistory.push(frameTime);

    // Calculate FPS
    const fps = frameTime > 0 ? 1000 / frameTime : 0;
    this.fpsHistory.push(fps);

    // Update memory metrics (throttled - every 30 frames)
    if (this.memoryMetrics.available && this.frameTimeHistory.length % 30 === 0) {
      this.updateMemoryMetrics();
    }

    // Notify listeners
    if (this.listeners.size > 0) {
      const snapshot = this.getSnapshot();
      for (const listener of this.listeners) {
        listener(snapshot);
      }
    }

    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  private updateMemoryMetrics(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perfMemory = (performance as any).memory;
    if (perfMemory) {
      this.memoryMetrics.usedJSHeapSize = perfMemory.usedJSHeapSize;
      this.memoryMetrics.totalJSHeapSize = perfMemory.totalJSHeapSize;
      this.memoryMetrics.jsHeapSizeLimit = perfMemory.jsHeapSizeLimit;
    }
  }

  /**
   * Record a game tick's total duration (called by Game.ts)
   * No-op when collection is disabled for zero overhead
   */
  public recordTickTime(duration: number): void {
    if (!this.collectingEnabled) return;
    this.lastTickTime = duration;
    this.tickTimeHistory.push(duration);
  }

  /**
   * Record a system's update duration (called by World.ts)
   * No-op when collection is disabled for zero overhead
   */
  public recordSystemTiming(systemName: string, duration: number): void {
    if (!this.collectingEnabled) return;
    this.currentSystemTimings.set(systemName, duration);

    // Update history - use RingBuffer for O(1) insertion
    if (!this.systemTimingHistory.has(systemName)) {
      this.systemTimingHistory.set(systemName, new RingBuffer(SYSTEM_TIMING_HISTORY_SIZE));
    }
    this.systemTimingHistory.get(systemName)!.push(duration);
  }

  /**
   * Clear system timings at the start of each tick
   * No-op when collection is disabled
   */
  public clearSystemTimings(): void {
    if (!this.collectingEnabled) return;
    this.currentSystemTimings.clear();
  }

  /**
   * Update entity counts (called periodically by the game)
   * No-op when collection is disabled
   */
  public updateEntityCounts(counts: EntityCounts): void {
    if (!this.collectingEnabled) return;
    this.entityCounts = { ...counts };
  }

  /**
   * Update network metrics (called by networking system)
   */
  public updateNetworkMetrics(metrics: Partial<NetworkMetrics>): void {
    this.networkMetrics = { ...this.networkMetrics, ...metrics };
  }

  /**
   * Apply performance metrics received from the game worker.
   * This bridges the worker's performance data to the main thread's PerformanceMonitor.
   * Called by WorkerBridge when receiving 'performanceMetrics' messages.
   */
  public applyWorkerMetrics(
    tickTime: number,
    systemTimings: Array<[string, number]>,
    entityCounts: [number, number, number, number]
  ): void {
    // Record tick time
    this.lastTickTime = tickTime;
    this.tickTimeHistory.push(tickTime);

    // Apply system timings - clear first, then record each
    this.currentSystemTimings.clear();
    for (const [name, duration] of systemTimings) {
      this.currentSystemTimings.set(name, duration);

      // Update history ring buffer
      if (!this.systemTimingHistory.has(name)) {
        this.systemTimingHistory.set(name, new RingBuffer(SYSTEM_TIMING_HISTORY_SIZE));
      }
      this.systemTimingHistory.get(name)!.push(duration);
    }

    // Apply entity counts
    const [units, buildings, resources, projectiles] = entityCounts;
    this.entityCounts = {
      total: units + buildings + resources + projectiles,
      units,
      buildings,
      projectiles,
      resources,
      effects: 0,
    };
  }

  /**
   * Update render metrics (called by WebGPUGameCanvas each frame)
   * @param drawCalls - Draw calls for this frame (reset after each frame)
   * @param triangles - Triangles rendered this frame (reset after each frame)
   * @param fps - Current FPS to calculate per-second values
   */
  public updateRenderMetrics(drawCalls: number, triangles: number, fps: number): void {
    if (!this.collectingEnabled) return;
    // Store per-frame values directly (input is already per-frame)
    this.renderMetrics.drawCalls = drawCalls;
    this.renderMetrics.triangles = triangles;
    // Calculate per-second by multiplying per-frame by FPS
    this.renderMetrics.drawCallsPerSecond = fps > 0 ? Math.round(drawCalls * fps) : drawCalls;
    this.renderMetrics.trianglesPerSecond = fps > 0 ? Math.round(triangles * fps) : triangles;
  }

  /**
   * Get current FPS (averaged over recent frames)
   */
  public getFPS(): number {
    if (this.fpsHistory.length === 0) return 0;
    const all = this.fpsHistory.toArray();
    const recent = all.slice(-30);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  /**
   * Get current frame time (averaged)
   */
  public getFrameTime(): number {
    if (this.frameTimeHistory.length === 0) return 0;
    const all = this.frameTimeHistory.toArray();
    const recent = all.slice(-30);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  /**
   * Get frame time history for graphing
   */
  public getFrameTimeHistory(): number[] {
    return this.frameTimeHistory.toArray();
  }

  /**
   * Get FPS history for graphing
   */
  public getFPSHistory(): number[] {
    return this.fpsHistory.toArray();
  }

  /**
   * Get tick time history for graphing
   */
  public getTickTimeHistory(): number[] {
    return this.tickTimeHistory.toArray();
  }

  /**
   * Get current system timings with percentages
   */
  public getSystemTimings(): SystemTiming[] {
    const totalTickTime = Array.from(this.currentSystemTimings.values())
      .reduce((a, b) => a + b, 0);

    const timings: SystemTiming[] = [];
    for (const [name, duration] of this.currentSystemTimings) {
      timings.push({
        name,
        duration,
        percentage: totalTickTime > 0 ? (duration / totalTickTime) * 100 : 0,
      });
    }

    // Sort by duration descending
    timings.sort((a, b) => b.duration - a.duration);
    return timings;
  }

  /**
   * Get average system timings over history
   */
  public getAverageSystemTimings(): SystemTiming[] {
    const averages: Map<string, number> = new Map();
    let totalAvg = 0;

    for (const [name, history] of this.systemTimingHistory) {
      if (history.length > 0) {
        const arr = history.toArray();
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        averages.set(name, avg);
        totalAvg += avg;
      }
    }

    const timings: SystemTiming[] = [];
    for (const [name, duration] of averages) {
      timings.push({
        name,
        duration,
        percentage: totalAvg > 0 ? (duration / totalAvg) * 100 : 0,
      });
    }

    timings.sort((a, b) => b.duration - a.duration);
    return timings;
  }

  /**
   * Get a complete performance snapshot
   */
  public getSnapshot(): PerformanceSnapshot {
    return {
      timestamp: performance.now(),
      fps: this.getFPS(),
      frameTime: this.getFrameTime(),
      tickTime: this.lastTickTime,
      systemTimings: this.getSystemTimings(),
      entityCounts: { ...this.entityCounts },
      memory: { ...this.memoryMetrics },
      network: { ...this.networkMetrics },
      render: { ...this.renderMetrics },
    };
  }

  /**
   * Subscribe to real-time performance updates
   */
  public subscribe(listener: (snapshot: PerformanceSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Format bytes to human readable string
   */
  public formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Get performance grade based on FPS
   */
  public getPerformanceGrade(): { grade: string; color: string } {
    const fps = this.getFPS();
    if (fps >= 55) return { grade: 'Excellent', color: '#22c55e' }; // green-500
    if (fps >= 45) return { grade: 'Good', color: '#84cc16' }; // lime-500
    if (fps >= 30) return { grade: 'Fair', color: '#eab308' }; // yellow-500
    if (fps >= 20) return { grade: 'Poor', color: '#f97316' }; // orange-500
    return { grade: 'Critical', color: '#ef4444' }; // red-500
  }
}

// Export singleton instance
export const PerformanceMonitor = PerformanceMonitorClass.getInstance();

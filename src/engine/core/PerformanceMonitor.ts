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

export interface PerformanceSnapshot {
  timestamp: number;
  fps: number;
  frameTime: number;
  tickTime: number;
  systemTimings: SystemTiming[];
  entityCounts: EntityCounts;
  memory: MemoryMetrics;
  network: NetworkMetrics;
}

// History buffer size (at 60fps, 300 = 5 seconds of history)
const HISTORY_SIZE = 300;
const SYSTEM_TIMING_HISTORY_SIZE = 60; // 1 second at 60fps for system breakdown

class PerformanceMonitorClass {
  private static instance: PerformanceMonitorClass | null = null;

  // Collection toggle - when false, recording methods become no-ops
  private collectingEnabled: boolean = false;

  // Frame timing
  private lastFrameTime: number = 0;
  private frameTimeHistory: number[] = [];
  private fpsHistory: number[] = [];

  // Tick timing from World
  private lastTickTime: number = 0;
  private tickTimeHistory: number[] = [];

  // Per-system timings (updated by World)
  private currentSystemTimings: Map<string, number> = new Map();
  private systemTimingHistory: Map<string, number[]> = new Map();

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

    // Record frame time
    this.frameTimeHistory.push(frameTime);
    if (this.frameTimeHistory.length > HISTORY_SIZE) {
      this.frameTimeHistory.shift();
    }

    // Calculate FPS
    const fps = frameTime > 0 ? 1000 / frameTime : 0;
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > HISTORY_SIZE) {
      this.fpsHistory.shift();
    }

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
    if (this.tickTimeHistory.length > HISTORY_SIZE) {
      this.tickTimeHistory.shift();
    }
  }

  /**
   * Record a system's update duration (called by World.ts)
   * No-op when collection is disabled for zero overhead
   */
  public recordSystemTiming(systemName: string, duration: number): void {
    if (!this.collectingEnabled) return;
    this.currentSystemTimings.set(systemName, duration);

    // Update history
    if (!this.systemTimingHistory.has(systemName)) {
      this.systemTimingHistory.set(systemName, []);
    }
    const history = this.systemTimingHistory.get(systemName)!;
    history.push(duration);
    if (history.length > SYSTEM_TIMING_HISTORY_SIZE) {
      history.shift();
    }
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
   * Get current FPS (averaged over recent frames)
   */
  public getFPS(): number {
    if (this.fpsHistory.length === 0) return 0;
    const recent = this.fpsHistory.slice(-30);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  /**
   * Get current frame time (averaged)
   */
  public getFrameTime(): number {
    if (this.frameTimeHistory.length === 0) return 0;
    const recent = this.frameTimeHistory.slice(-30);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  /**
   * Get frame time history for graphing
   */
  public getFrameTimeHistory(): number[] {
    return [...this.frameTimeHistory];
  }

  /**
   * Get FPS history for graphing
   */
  public getFPSHistory(): number[] {
    return [...this.fpsHistory];
  }

  /**
   * Get tick time history for graphing
   */
  public getTickTimeHistory(): number[] {
    return [...this.tickTimeHistory];
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
        const avg = history.reduce((a, b) => a + b, 0) / history.length;
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

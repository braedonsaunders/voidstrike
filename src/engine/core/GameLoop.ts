export type UpdateCallback = (deltaTime: number) => void;

/**
 * Game loop that continues running even when tab is inactive.
 * Uses setInterval for consistent game logic updates regardless of tab visibility.
 * Handles browser throttling/suspension by tracking real time when hidden.
 */
export class GameLoop {
  private tickRate: number;
  private tickMs: number;
  private isRunning = false;
  private lastTime = 0;
  private accumulator = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  // Track when tab was hidden to calculate catch-up time
  private hiddenAtTime: number | null = null;

  private updateCallback: UpdateCallback;

  constructor(tickRate: number, updateCallback: UpdateCallback) {
    this.tickRate = tickRate;
    this.tickMs = 1000 / tickRate;
    this.updateCallback = updateCallback;

    // Listen for visibility changes to handle tab switching
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    }
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      // Record when we went hidden
      this.hiddenAtTime = performance.now();
    } else if (this.hiddenAtTime !== null) {
      // Tab became visible - calculate time spent hidden and add to accumulator
      const hiddenDuration = performance.now() - this.hiddenAtTime;
      // Cap at 30 seconds of catch-up to prevent extreme lag
      const catchUpTime = Math.min(hiddenDuration, 30000);
      this.accumulator += catchUpTime;
      this.hiddenAtTime = null;
      this.lastTime = performance.now();

      // Immediately trigger a tick to start processing catch-up
      if (this.isRunning) {
        this.tick();
      }
    }
  }

  public start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.lastTime = performance.now();
    this.accumulator = 0;

    // Use setInterval instead of requestAnimationFrame so game runs when tab is hidden
    // Run at slightly higher frequency than tick rate for smooth accumulation
    this.intervalId = setInterval(() => this.tick(), Math.floor(this.tickMs / 2));
  }

  public stop(): void {
    this.isRunning = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick(): void {
    if (!this.isRunning) return;

    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Normal operation - cap delta to prevent spiral of death
    // The visibility change handler handles background catch-up separately
    const cappedDelta = Math.min(deltaTime, 250);
    this.accumulator += cappedDelta;

    // Fixed timestep updates - limit iterations per frame to prevent UI freeze
    // Process up to 200 ticks per call (10 seconds at 20 tick/sec)
    let iterations = 0;
    const maxIterations = 200;

    while (this.accumulator >= this.tickMs && iterations < maxIterations) {
      this.updateCallback(this.tickMs);
      this.accumulator -= this.tickMs;
      iterations++;
    }

    // If we still have excess after max iterations, schedule another tick
    // This spreads catch-up over multiple frames to prevent UI freeze
    if (this.accumulator >= this.tickMs) {
      setTimeout(() => this.tick(), 0);
    }
  }

  public getInterpolation(): number {
    return this.accumulator / this.tickMs;
  }

  public setTickRate(tickRate: number): void {
    this.tickRate = tickRate;
    this.tickMs = 1000 / tickRate;

    // Restart interval with new rate if running
    if (this.isRunning && this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(() => this.tick(), Math.floor(this.tickMs / 2));
    }
  }

  public getTickRate(): number {
    return this.tickRate;
  }
}

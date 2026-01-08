export type UpdateCallback = (deltaTime: number) => void;

/**
 * Game loop that continues running even when tab is inactive.
 * Uses setInterval for consistent game logic updates regardless of tab visibility.
 * Handles browser throttling in background tabs by catching up on lost time.
 */
export class GameLoop {
  private tickRate: number;
  private tickMs: number;
  private isRunning = false;
  private lastTime = 0;
  private accumulator = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private wasHidden = false;

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
      this.wasHidden = true;
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

    // Check if we're currently hidden or were recently hidden
    const isHidden = typeof document !== 'undefined' && document.hidden;
    const needsCatchup = this.wasHidden || isHidden;

    // When tab is hidden or returning from hidden, allow larger deltas
    // This ensures game time progresses properly in background
    // Cap at 5 seconds to prevent extreme catchup after long absence
    const maxDelta = needsCatchup ? 5000 : 250;
    const cappedDelta = Math.min(deltaTime, maxDelta);
    this.accumulator += cappedDelta;

    // Reset hidden flag only after we've returned and processed
    if (this.wasHidden && !isHidden) {
      this.wasHidden = false;
    }

    // Fixed timestep updates - limit iterations to prevent spiral of death
    // Process up to 100 ticks per call (5 seconds at 20 tick/sec)
    let iterations = 0;
    const maxIterations = 100;

    while (this.accumulator >= this.tickMs && iterations < maxIterations) {
      this.updateCallback(this.tickMs);
      this.accumulator -= this.tickMs;
      iterations++;
    }

    // If we hit max iterations, discard excess to prevent permanent lag
    if (iterations >= maxIterations && this.accumulator > this.tickMs) {
      this.accumulator = 0;
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

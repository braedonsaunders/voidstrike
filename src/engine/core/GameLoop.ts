export type UpdateCallback = (deltaTime: number) => void;

/**
 * Game loop that continues running even when tab is inactive.
 * Uses setInterval for consistent game logic updates regardless of tab visibility.
 * requestAnimationFrame is only used for rendering optimization.
 */
export class GameLoop {
  private tickRate: number;
  private tickMs: number;
  private isRunning = false;
  private lastTime = 0;
  private accumulator = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private updateCallback: UpdateCallback;

  constructor(tickRate: number, updateCallback: UpdateCallback) {
    this.tickRate = tickRate;
    this.tickMs = 1000 / tickRate;
    this.updateCallback = updateCallback;
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

    // Cap delta time to prevent spiral of death (e.g., if tab was suspended briefly)
    const cappedDelta = Math.min(deltaTime, 250);
    this.accumulator += cappedDelta;

    // Fixed timestep updates
    while (this.accumulator >= this.tickMs) {
      this.updateCallback(this.tickMs);
      this.accumulator -= this.tickMs;
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

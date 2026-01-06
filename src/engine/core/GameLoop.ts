export type UpdateCallback = (deltaTime: number) => void;

export class GameLoop {
  private tickRate: number;
  private tickMs: number;
  private isRunning = false;
  private lastTime = 0;
  private accumulator = 0;
  private frameId: number | null = null;

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
    this.tick(this.lastTime);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private tick(currentTime: number): void {
    if (!this.isRunning) return;

    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Cap delta time to prevent spiral of death
    const cappedDelta = Math.min(deltaTime, 250);
    this.accumulator += cappedDelta;

    // Fixed timestep updates
    while (this.accumulator >= this.tickMs) {
      this.updateCallback(this.tickMs);
      this.accumulator -= this.tickMs;
    }

    this.frameId = requestAnimationFrame(this.tick.bind(this));
  }

  public getInterpolation(): number {
    return this.accumulator / this.tickMs;
  }

  public setTickRate(tickRate: number): void {
    this.tickRate = tickRate;
    this.tickMs = 1000 / tickRate;
  }

  public getTickRate(): number {
    return this.tickRate;
  }
}

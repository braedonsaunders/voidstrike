export type UpdateCallback = (deltaTime: number) => void;

/**
 * Game loop that continues running at full speed even when tab is inactive.
 * Uses a Web Worker for timing since Workers are NOT throttled by browsers.
 */
export class GameLoop {
  private tickRate: number;
  private tickMs: number;
  private isRunning = false;
  private lastTime = 0;
  private accumulator = 0;
  private worker: Worker | null = null;

  private updateCallback: UpdateCallback;

  constructor(tickRate: number, updateCallback: UpdateCallback) {
    this.tickRate = tickRate;
    this.tickMs = 1000 / tickRate;
    this.updateCallback = updateCallback;

    // Create inline worker for timing (avoids separate file loading issues)
    this.createWorker();
  }

  private createWorker(): void {
    if (typeof Worker === 'undefined') return;

    // Create worker from inline code using Blob
    const workerCode = `
      let intervalId = null;
      self.onmessage = (e) => {
        const { type, intervalMs } = e.data;
        if (type === 'start') {
          if (intervalId !== null) clearInterval(intervalId);
          intervalId = setInterval(() => {
            self.postMessage({ type: 'tick', time: performance.now() });
          }, intervalMs);
        } else if (type === 'stop') {
          if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
          }
        } else if (type === 'setInterval') {
          if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = setInterval(() => {
              self.postMessage({ type: 'tick', time: performance.now() });
            }, intervalMs);
          }
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    this.worker = new Worker(workerUrl);

    this.worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'tick') {
        this.tick();
      }
    };

    // Clean up blob URL
    URL.revokeObjectURL(workerUrl);
  }

  public start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.lastTime = performance.now();
    this.accumulator = 0;

    if (this.worker) {
      // Use worker for timing - runs at full speed even in background
      this.worker.postMessage({
        type: 'start',
        intervalMs: Math.floor(this.tickMs / 2),
      });
    } else {
      // Fallback to setInterval if workers unavailable
      this.startFallback();
    }
  }

  private fallbackIntervalId: ReturnType<typeof setInterval> | null = null;

  private startFallback(): void {
    this.fallbackIntervalId = setInterval(() => this.tick(), Math.floor(this.tickMs / 2));
  }

  public stop(): void {
    this.isRunning = false;

    if (this.worker) {
      this.worker.postMessage({ type: 'stop' });
    }

    if (this.fallbackIntervalId !== null) {
      clearInterval(this.fallbackIntervalId);
      this.fallbackIntervalId = null;
    }
  }

  private tick(): void {
    if (!this.isRunning) return;

    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Cap delta to prevent spiral of death (e.g., if main thread was blocked)
    const cappedDelta = Math.min(deltaTime, 250);
    this.accumulator += cappedDelta;

    // Fixed timestep updates - limit iterations per frame to prevent UI freeze
    // Process up to 200 ticks per call (10 seconds at 20 tick/sec)
    let iterations = 0;
    const maxIterations = 200;
    const tickStart = performance.now();

    while (this.accumulator >= this.tickMs && iterations < maxIterations) {
      this.updateCallback(this.tickMs);
      this.accumulator -= this.tickMs;
      iterations++;
    }

    // Log if we're processing multiple ticks or if tick processing is slow
    const tickElapsed = performance.now() - tickStart;
    if (iterations > 1 || tickElapsed > 20) {
      console.warn(`[GameLoop] tick: ${iterations} iterations in ${tickElapsed.toFixed(1)}ms, accumulator=${this.accumulator.toFixed(1)}ms`);
    }

    // If we still have excess after max iterations, it will be processed next tick
    // The accumulator preserves any remaining time
  }

  public getInterpolation(): number {
    return this.accumulator / this.tickMs;
  }

  public setTickRate(tickRate: number): void {
    this.tickRate = tickRate;
    this.tickMs = 1000 / tickRate;

    // Update worker interval if running
    if (this.isRunning && this.worker) {
      this.worker.postMessage({
        type: 'setInterval',
        intervalMs: Math.floor(this.tickMs / 2),
      });
    }

    // Update fallback interval if running
    if (this.isRunning && this.fallbackIntervalId !== null) {
      clearInterval(this.fallbackIntervalId);
      this.fallbackIntervalId = setInterval(() => this.tick(), Math.floor(this.tickMs / 2));
    }
  }

  public getTickRate(): number {
    return this.tickRate;
  }

  public dispose(): void {
    this.stop();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

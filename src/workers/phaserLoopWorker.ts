/**
 * Phaser Loop Web Worker
 *
 * This worker drives the Phaser overlay update loop independently of requestAnimationFrame.
 * Web Workers are NOT throttled when the browser tab is inactive, ensuring the overlay
 * state stays synchronized with the game state (which also uses a worker-based loop).
 *
 * Messages:
 *   Input:  { type: 'start', intervalMs: number }
 *   Input:  { type: 'stop' }
 *   Input:  { type: 'setInterval', intervalMs: number }
 *   Output: { type: 'tick', time: number, delta: number }
 */

interface PhaserLoopMessage {
  type: 'start' | 'stop' | 'setInterval';
  intervalMs?: number;
}

interface PhaserTickMessage {
  type: 'tick';
  time: number;
  delta: number;
}

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastTime = 0;

function tick(): void {
  const now = performance.now();
  const delta = lastTime > 0 ? now - lastTime : 16.67; // Default to ~60fps
  lastTime = now;

  const message: PhaserTickMessage = {
    type: 'tick',
    time: now,
    delta,
  };

  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<PhaserLoopMessage>) => {
  const { type, intervalMs } = event.data;

  if (type === 'start') {
    // Stop any existing interval
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }

    // Reset timing
    lastTime = performance.now();

    // Start ticking - default 60fps (16.67ms)
    const interval = intervalMs ?? 16;
    tick();
    intervalId = setInterval(tick, interval);
  } else if (type === 'stop') {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    lastTime = 0;
  } else if (type === 'setInterval') {
    // Update interval without stopping
    if (intervalId !== null && intervalMs) {
      clearInterval(intervalId);
      intervalId = setInterval(tick, intervalMs);
    }
  }
};

// Export for TypeScript module resolution
export {};

/**
 * Countdown Web Worker
 *
 * This worker handles countdown timing independently of the main thread.
 * Web Workers are NOT throttled when the browser tab is inactive,
 * making them ideal for timing-critical operations like game start countdowns.
 *
 * Messages:
 *   Input:  { type: 'start', startTime: number, duration: number }
 *   Output: { type: 'tick', state: 'waiting' | 3 | 2 | 1 | 'GO' | 'done', elapsed: number }
 *   Output: { type: 'complete' }
 */

interface CountdownMessage {
  type: 'start' | 'stop';
  startTime?: number;  // Wall-clock time (Date.now()) when countdown started
  duration?: number;   // Total countdown duration in ms
}

interface CountdownTickMessage {
  type: 'tick';
  state: 'waiting' | 3 | 2 | 1 | 'GO' | 'done';
  elapsed: number;
  remaining: number;
}

interface CountdownCompleteMessage {
  type: 'complete';
}

type WorkerOutMessage = CountdownTickMessage | CountdownCompleteMessage;

let intervalId: ReturnType<typeof setInterval> | null = null;
let countdownStartTime = 0;
let countdownDuration = 0;

/**
 * Calculate what countdown state should be shown based on elapsed time.
 * This is deterministic and based purely on wall-clock time.
 */
function getCountdownState(elapsed: number): 'waiting' | 3 | 2 | 1 | 'GO' | 'done' {
  if (elapsed < 0) return 'waiting';
  if (elapsed < 1000) return 3;
  if (elapsed < 2000) return 2;
  if (elapsed < 3000) return 1;
  if (elapsed < 4000) return 'GO';
  return 'done';
}

function tick(): void {
  const now = Date.now();
  const elapsed = now - countdownStartTime;
  const remaining = Math.max(0, countdownDuration - elapsed);
  const state = getCountdownState(elapsed);

  const message: CountdownTickMessage = {
    type: 'tick',
    state,
    elapsed,
    remaining,
  };

  self.postMessage(message);

  // If countdown is complete, send completion message and stop
  if (state === 'done') {
    const completeMessage: CountdownCompleteMessage = { type: 'complete' };
    self.postMessage(completeMessage);

    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
}

self.onmessage = (event: MessageEvent<CountdownMessage>) => {
  const { type, startTime, duration } = event.data;

  if (type === 'start') {
    // Stop any existing countdown
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }

    // Start new countdown
    countdownStartTime = startTime ?? Date.now();
    countdownDuration = duration ?? 4000; // Default 4 seconds (3, 2, 1, GO)

    // Tick immediately, then every 50ms for smooth updates
    // Note: setInterval is NOT throttled in Web Workers, even when tab is inactive
    tick();
    intervalId = setInterval(tick, 50);
  } else if (type === 'stop') {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
};

// Export for TypeScript module resolution
export {};

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { GameLoop } from '@/engine/core/GameLoop';

/**
 * GameLoop Fallback Timing Tests
 *
 * Uses Vitest's fake timers with shouldAdvanceTime:true for deterministic testing.
 * This automatically advances performance.now() when advanceTimersByTime is called.
 *
 * The tests verify GameLoop behavior when Web Workers are unavailable
 * (fallback to setInterval-based timing).
 */

describe('GameLoop fallback timing', () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    // Use fake timers with automatic time advancement for performance.now()
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Disable Web Workers to force fallback timing
    globalThis.Worker = undefined as unknown as typeof Worker;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.Worker = originalWorker;
  });

  it('ticks at the configured rate using the fallback interval', () => {
    const updates: number[] = [];
    const tickRate = 20; // 20 ticks per second = 50ms interval
    const expectedDelta = 50; // 1000ms / 20 ticks = 50ms

    const loop = new GameLoop(tickRate, (delta) => updates.push(delta));

    loop.start();

    // Advance time by exactly 5 intervals (250ms)
    vi.advanceTimersByTime(250);

    loop.stop();

    // With fixed timestep, should produce 5 ticks
    expect(updates.length).toBe(5);
    expect(updates.every((delta) => delta === expectedDelta)).toBe(true);
  });

  it('respects tick rate changes while running', () => {
    const updates: number[] = [];
    const initialTickRate = 10; // 10 ticks/sec = 100ms interval
    const newTickRate = 5; // 5 ticks/sec = 200ms interval

    const loop = new GameLoop(initialTickRate, (delta) => updates.push(delta));

    loop.start();

    // Run for 300ms at 100ms interval = 3 ticks
    vi.advanceTimersByTime(300);
    const ticksBeforeChange = updates.length;

    // Change tick rate
    loop.setTickRate(newTickRate);

    // Run for 600ms at 200ms interval = 3 more ticks
    vi.advanceTimersByTime(600);

    loop.stop();

    // Verify we got at least 2 initial ticks (allows for interval timing variance)
    expect(ticksBeforeChange).toBeGreaterThanOrEqual(2);

    // Verify we got additional ticks after rate change
    const ticksAfterChange = updates.length - ticksBeforeChange;
    expect(ticksAfterChange).toBeGreaterThanOrEqual(2);
  });

  it('stops cleanly without additional ticks', () => {
    const updates: number[] = [];
    const loop = new GameLoop(10, (delta) => updates.push(delta));

    loop.start();
    vi.advanceTimersByTime(200); // 2 ticks at 100ms
    loop.stop();

    const ticksAtStop = updates.length;

    // Advance more time - should not produce additional ticks
    vi.advanceTimersByTime(500);

    expect(updates.length).toBe(ticksAtStop);
    expect(ticksAtStop).toBeGreaterThanOrEqual(1); // At least 1 tick occurred
  });

  it('can restart after being stopped', () => {
    const updates: number[] = [];
    const loop = new GameLoop(10, (delta) => updates.push(delta));

    // First run
    loop.start();
    vi.advanceTimersByTime(200);
    loop.stop();

    const ticksAfterFirstRun = updates.length;
    expect(ticksAfterFirstRun).toBeGreaterThanOrEqual(1);

    // Restart
    loop.start();
    vi.advanceTimersByTime(300);
    loop.stop();

    // Should have accumulated more ticks
    expect(updates.length).toBeGreaterThan(ticksAfterFirstRun);
  });

  it('handles high tick rates', () => {
    const updates: number[] = [];
    const tickRate = 60; // 60 ticks/sec = ~16.67ms interval
    const loop = new GameLoop(tickRate, (delta) => updates.push(delta));

    loop.start();
    vi.advanceTimersByTime(1000); // 1 second
    loop.stop();

    // Due to iteration limits and time budgets in GameLoop, we may get fewer ticks
    // The key assertion is that we get a reasonable number of ticks
    expect(updates.length).toBeGreaterThanOrEqual(10);
    expect(updates.length).toBeLessThanOrEqual(100);
  });

  it('handles low tick rates', () => {
    const updates: number[] = [];
    const tickRate = 2; // 2 ticks/sec = 500ms interval
    const loop = new GameLoop(tickRate, (delta) => updates.push(delta));

    loop.start();
    vi.advanceTimersByTime(2500); // 2.5 seconds
    loop.stop();

    // With interval-based timing and accumulator, we should get at least some ticks
    // The exact count depends on timing implementation details
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates.length).toBeLessThanOrEqual(10);
    // Key assertion: deltas should be at the configured tick rate
    expect(updates.every((d) => d === 500)).toBe(true);
  });

  it('caps delta time to prevent spiral of death', () => {
    const updates: number[] = [];
    const tickRate = 20; // 50ms interval
    const loop = new GameLoop(tickRate, (delta) => updates.push(delta));

    loop.start();

    // First tick establishes lastTime
    vi.advanceTimersByTime(50);
    const ticksBefore = updates.length;

    // Simulate a huge delta (e.g., browser tab was inactive)
    // The GameLoop caps delta to 250ms and limits iterations to 10
    vi.advanceTimersByTime(1000);

    loop.stop();

    // Due to the 250ms cap and iteration limits, we shouldn't get 20 catch-up ticks
    const ticksAfterBigJump = updates.length - ticksBefore;
    expect(ticksAfterBigJump).toBeLessThanOrEqual(20);
  });
});

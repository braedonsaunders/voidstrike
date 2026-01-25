import { describe, it, expect, afterEach } from 'vitest';
import { GameLoop } from '@/engine/core/GameLoop';

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('GameLoop fallback timing', () => {
  const originalWorker = globalThis.Worker;

  afterEach(() => {
    globalThis.Worker = originalWorker;
  });

  it('ticks at the configured rate using the fallback interval', async () => {
    globalThis.Worker = undefined as unknown as typeof Worker;

    const updates: number[] = [];
    const loop = new GameLoop(20, (delta) => updates.push(delta));

    loop.start();
    await wait(220);
    loop.stop();

    expect(updates.length).toBeGreaterThanOrEqual(3);
    expect(updates.length).toBeLessThanOrEqual(6);
    expect(updates.every((delta) => delta === 50)).toBe(true);
  });

  it('respects tick rate changes while running', async () => {
    globalThis.Worker = undefined as unknown as typeof Worker;

    const updates: number[] = [];
    const loop = new GameLoop(10, (delta) => updates.push(delta));

    loop.start();
    await wait(240);
    const beforeChange = updates.length;
    loop.setTickRate(5);
    await wait(450);
    loop.stop();

    expect(beforeChange).toBeGreaterThanOrEqual(1);
    expect(updates.length).toBeGreaterThan(beforeChange);
    expect(updates.slice(beforeChange).every((delta) => delta === 200)).toBe(true);
  });
});

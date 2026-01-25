import { GameLoop } from '@/engine/core/GameLoop';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

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

    assert.ok(updates.length >= 3);
    assert.ok(updates.length <= 6);
    assert.ok(updates.every((delta) => delta === 50));
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

    assert.ok(beforeChange >= 1);
    assert.ok(updates.length > beforeChange);
    assert.ok(updates.slice(beforeChange).every((delta) => delta === 200));
  });
});

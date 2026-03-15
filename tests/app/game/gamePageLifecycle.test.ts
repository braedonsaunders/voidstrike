import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerGamePageUnmount,
  resetGamePageLifecycleForTests,
} from '@/app/game/gamePageLifecycle';

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe('registerGamePageUnmount', () => {
  afterEach(() => {
    resetGamePageLifecycleForTests();
  });

  it('skips teardown during an immediate remount probe', async () => {
    const teardown = vi.fn();

    const firstCleanup = registerGamePageUnmount(teardown);
    firstCleanup();

    registerGamePageUnmount(teardown);
    await flushMicrotasks();

    expect(teardown).not.toHaveBeenCalled();
  });

  it('runs teardown once when the page stays unmounted', async () => {
    const teardown = vi.fn();

    const cleanup = registerGamePageUnmount(teardown);
    cleanup();
    await flushMicrotasks();

    expect(teardown).toHaveBeenCalledTimes(1);
  });
});

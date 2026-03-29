import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMultiplayerStore } from '@/store/multiplayerStore';

describe('multiplayerStore.reset', () => {
  afterEach(() => {
    useMultiplayerStore.getState().reset();
  });

  it('runs the preserved session cleanup callback on reset', () => {
    const cleanup = vi.fn();

    useMultiplayerStore.getState().setSessionCleanupCallback(cleanup);
    useMultiplayerStore.getState().reset();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(useMultiplayerStore.getState().sessionCleanupCallback).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { shouldHandleMultiplayerMessagesOnMainThread } from '@/engine/core/multiplayerMessageHandling';

describe('shouldHandleMultiplayerMessagesOnMainThread', () => {
  it('returns false when multiplayer is disabled', () => {
    expect(
      shouldHandleMultiplayerMessagesOnMainThread({
        isMultiplayer: false,
        multiplayerMessageHandling: 'main-thread',
      })
    ).toBe(false);
  });

  it('returns true for direct main-thread multiplayer handling', () => {
    expect(
      shouldHandleMultiplayerMessagesOnMainThread({
        isMultiplayer: true,
        multiplayerMessageHandling: 'main-thread',
      })
    ).toBe(true);
  });

  it('returns false when the worker owns multiplayer command handling', () => {
    expect(
      shouldHandleMultiplayerMessagesOnMainThread({
        isMultiplayer: true,
        multiplayerMessageHandling: 'worker',
      })
    ).toBe(false);
  });
});

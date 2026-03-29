import { describe, expect, it } from 'vitest';
import {
  shouldEnableLobbyNetworking,
  shouldPreserveLobbySessionOnUnmount,
} from '@/app/game/setup/lobbySessionPolicy';
import type { PlayerSlot } from '@/store/gameSetupStore';

function createSlot(overrides: Partial<PlayerSlot>): PlayerSlot {
  return {
    id: 'player1',
    type: 'human',
    faction: 'dominion',
    colorId: 'blue',
    aiDifficulty: 'medium',
    name: 'Player 1',
    team: 0,
    ...overrides,
  };
}

describe('lobbySessionPolicy', () => {
  it('enables lobby networking when the host exposes an open slot', () => {
    expect(
      shouldEnableLobbyNetworking(
        [createSlot({ id: 'player1' }), createSlot({ id: 'player2', type: 'open' })],
        false
      )
    ).toBe(true);
  });

  it('keeps lobby networking enabled after an open slot is filled by a guest', () => {
    expect(
      shouldEnableLobbyNetworking(
        [createSlot({ id: 'player1' }), createSlot({ id: 'player2', isGuest: true })],
        false
      )
    ).toBe(true);
  });

  it('disables lobby networking for a local-only setup', () => {
    expect(
      shouldEnableLobbyNetworking(
        [createSlot({ id: 'player1' }), createSlot({ id: 'player2', type: 'ai' })],
        false
      )
    ).toBe(false);
  });

  it('always enables lobby networking for public lobbies', () => {
    expect(
      shouldEnableLobbyNetworking(
        [createSlot({ id: 'player1' }), createSlot({ id: 'player2', type: 'ai' })],
        true
      )
    ).toBe(true);
  });

  it('preserves the session only during a real game transition', () => {
    expect(shouldPreserveLobbySessionOnUnmount(true)).toBe(true);
    expect(shouldPreserveLobbySessionOnUnmount(false)).toBe(false);
  });
});

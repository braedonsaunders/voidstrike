import { describe, expect, it } from 'vitest';
import { getStartGameButtonState } from '@/app/game/setup/getStartGameButtonState';

describe('getStartGameButtonState', () => {
  it('disables the start button until the lobby page is hydrated', () => {
    expect(
      getStartGameButtonState({
        activePlayerCount: 2,
        connectedGuestCount: 0,
        guestSlotCount: 0,
        isHydrated: false,
      })
    ).toEqual({
      disabled: true,
      reason: 'hydrating',
    });
  });

  it('requires at least two active players after hydration', () => {
    expect(
      getStartGameButtonState({
        activePlayerCount: 1,
        connectedGuestCount: 0,
        guestSlotCount: 0,
        isHydrated: true,
      })
    ).toEqual({
      disabled: true,
      reason: 'not-enough-players',
    });
  });

  it('waits for all guest slots to connect before enabling start', () => {
    expect(
      getStartGameButtonState({
        activePlayerCount: 3,
        connectedGuestCount: 1,
        guestSlotCount: 2,
        isHydrated: true,
      })
    ).toEqual({
      disabled: true,
      reason: 'waiting-for-guests',
    });
  });

  it('enables the start button once the lobby is interactive and ready', () => {
    expect(
      getStartGameButtonState({
        activePlayerCount: 2,
        connectedGuestCount: 0,
        guestSlotCount: 0,
        isHydrated: true,
      })
    ).toEqual({
      disabled: false,
      reason: null,
    });
  });
});

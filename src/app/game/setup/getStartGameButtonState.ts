export type StartGameDisabledReason =
  | 'hydrating'
  | 'not-enough-players'
  | 'waiting-for-guests'
  | null;

export interface StartGameButtonStateParams {
  activePlayerCount: number;
  connectedGuestCount: number;
  guestSlotCount: number;
  isHydrated: boolean;
}

export interface StartGameButtonState {
  disabled: boolean;
  reason: StartGameDisabledReason;
}

export function getStartGameButtonState({
  activePlayerCount,
  connectedGuestCount,
  guestSlotCount,
  isHydrated,
}: StartGameButtonStateParams): StartGameButtonState {
  if (!isHydrated) {
    return { disabled: true, reason: 'hydrating' };
  }

  if (activePlayerCount < 2) {
    return { disabled: true, reason: 'not-enough-players' };
  }

  if (guestSlotCount > 0 && connectedGuestCount < guestSlotCount) {
    return { disabled: true, reason: 'waiting-for-guests' };
  }

  return { disabled: false, reason: null };
}

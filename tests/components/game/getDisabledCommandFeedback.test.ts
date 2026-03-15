import { describe, expect, it } from 'vitest';
import { getDisabledCommandFeedback } from '@/components/game/CommandCard/getDisabledCommandFeedback';
import type { CommandButtonData } from '@/components/game/CommandCard/types';

function createCommand(overrides: Partial<CommandButtonData> = {}): CommandButtonData {
  return {
    id: 'build_supply_cache',
    label: 'Supply Cache',
    shortcut: 'S',
    action: () => {},
    ...overrides,
  };
}

describe('getDisabledCommandFeedback', () => {
  it('surfaces missing requirements before resource shortages', () => {
    const feedback = getDisabledCommandFeedback(
      createCommand({
        isDisabled: true,
        tooltip: 'Researches infantry upgrades. (Requires: Supply Cache)',
        cost: { minerals: 125, plasma: 0 },
      }),
      {
        minerals: 50,
        plasma: 0,
        supply: 6,
        maxSupply: 11,
      }
    );

    expect(feedback).toEqual({
      audioEvent: null,
      uiError: 'Requires Supply Cache',
    });
  });

  it('returns mineral feedback when the player cannot afford the command', () => {
    const feedback = getDisabledCommandFeedback(
      createCommand({
        isDisabled: true,
        cost: { minerals: 100, plasma: 0 },
      }),
      {
        minerals: 50,
        plasma: 0,
        supply: 6,
        maxSupply: 11,
      }
    );

    expect(feedback).toEqual({
      audioEvent: 'alert:notEnoughMinerals',
      uiError: 'Not enough minerals',
    });
  });

  it('returns plasma feedback when plasma is the blocking cost', () => {
    const feedback = getDisabledCommandFeedback(
      createCommand({
        isDisabled: true,
        cost: { minerals: 25, plasma: 50 },
      }),
      {
        minerals: 100,
        plasma: 10,
        supply: 6,
        maxSupply: 11,
      }
    );

    expect(feedback).toEqual({
      audioEvent: 'alert:notEnoughPlasma',
      uiError: 'Not enough plasma',
    });
  });

  it('returns supply feedback when the command would exceed max supply', () => {
    const feedback = getDisabledCommandFeedback(
      createCommand({
        isDisabled: true,
        cost: { minerals: 50, plasma: 0, supply: 2 },
      }),
      {
        minerals: 100,
        plasma: 50,
        supply: 11,
        maxSupply: 11,
      }
    );

    expect(feedback).toEqual({
      audioEvent: 'alert:supplyBlocked',
      uiError: 'Supply blocked',
    });
  });

  it('returns no feedback when the disabled reason is unknown', () => {
    const feedback = getDisabledCommandFeedback(createCommand({ isDisabled: true }), {
      minerals: 100,
      plasma: 50,
      supply: 6,
      maxSupply: 11,
    });

    expect(feedback).toEqual({
      audioEvent: null,
      uiError: null,
    });
  });
});

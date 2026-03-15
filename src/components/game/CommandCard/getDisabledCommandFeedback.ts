import type { CommandButtonData } from './types';

interface DisabledCommandFeedbackResources {
  minerals: number;
  plasma: number;
  supply: number;
  maxSupply: number;
}

export interface DisabledCommandFeedback {
  audioEvent: 'alert:notEnoughMinerals' | 'alert:notEnoughPlasma' | 'alert:supplyBlocked' | null;
  uiError: string | null;
}

const REQUIREMENTS_PATTERN = /\(Requires:\s*([^)]+)\)/i;

export function getDisabledCommandFeedback(
  command: CommandButtonData,
  resources: DisabledCommandFeedbackResources
): DisabledCommandFeedback {
  const requirementMatch = command.tooltip?.match(REQUIREMENTS_PATTERN);
  if (requirementMatch) {
    return {
      audioEvent: null,
      uiError: `Requires ${requirementMatch[1].trim()}`,
    };
  }

  if (command.cost) {
    if (command.cost.minerals > 0 && resources.minerals < command.cost.minerals) {
      return {
        audioEvent: 'alert:notEnoughMinerals',
        uiError: 'Not enough minerals',
      };
    }

    if (command.cost.plasma > 0 && resources.plasma < command.cost.plasma) {
      return {
        audioEvent: 'alert:notEnoughPlasma',
        uiError: 'Not enough plasma',
      };
    }

    if (
      command.cost.supply &&
      command.cost.supply > 0 &&
      resources.supply + command.cost.supply > resources.maxSupply
    ) {
      return {
        audioEvent: 'alert:supplyBlocked',
        uiError: 'Supply blocked',
      };
    }
  }

  return {
    audioEvent: null,
    uiError: null,
  };
}

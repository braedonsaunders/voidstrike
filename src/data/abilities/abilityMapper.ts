/**
 * Ability Mapper
 *
 * Maps between data layer ability definitions (AbilityDataDefinition) and
 * engine layer ability definitions (AbilityDefinition from ECS components).
 *
 * The data layer uses AbilityActivationMode to describe HOW abilities are activated:
 *   - 'instant': Immediate effect, no targeting
 *   - 'targeted': Requires unit target selection
 *   - 'ground': Targets a ground location
 *   - 'passive': Always active, no activation
 *   - 'toggle': Can be turned on/off
 *   - 'autocast': Can be set to auto-use
 *
 * The engine layer uses AbilityTargetType to describe WHAT can be targeted:
 *   - 'none': No targeting required (passives)
 *   - 'point': Ground/location targeting
 *   - 'unit': Any unit targeting
 *   - 'ally': Allied unit targeting only
 *   - 'self': Self-targeting only
 */

import type {
  AbilityDefinition as EngineAbilityDefinition,
  AbilityTargetType,
} from '@/engine/components/Ability';
import type { AbilityDataDefinition, AbilityActivationMode } from './abilities';

/**
 * Maps an activation mode to the appropriate target type for the engine.
 * This determines what kind of target selection UI/behavior to use.
 */
export function mapActivationModeToTargetType(mode: AbilityActivationMode): AbilityTargetType {
  switch (mode) {
    case 'instant':
      return 'self';
    case 'passive':
      return 'none';
    case 'targeted':
      return 'unit';
    case 'ground':
      return 'point';
    case 'toggle':
      return 'self';
    case 'autocast':
      return 'unit';
  }
}

/**
 * Converts a data layer ability definition to an engine layer ability definition.
 * This is used when loading abilities from data files into the ECS runtime.
 */
export function toEngineAbilityDefinition(data: AbilityDataDefinition): EngineAbilityDefinition {
  // Find effect values
  const damageEffect = data.effects?.find(e => e.type === 'damage');
  const healEffect = data.effects?.find(e => e.type === 'heal');

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    cooldown: data.cooldown ?? 0,
    energyCost: data.energyCost ?? 0,
    range: data.range ?? 0,
    targetType: mapActivationModeToTargetType(data.targetType),
    hotkey: '', // Data layer doesn't specify hotkeys - assigned by UI
    iconId: data.icon,
    damage: damageEffect?.value,
    healing: healEffect?.value,
    duration: data.duration,
    aoeRadius: data.radius,
  };
}

/**
 * Converts multiple data definitions to engine definitions.
 */
export function toEngineAbilityDefinitions(
  data: Record<string, AbilityDataDefinition>
): Record<string, EngineAbilityDefinition> {
  const result: Record<string, EngineAbilityDefinition> = {};
  for (const [id, def] of Object.entries(data)) {
    result[id] = toEngineAbilityDefinition(def);
  }
  return result;
}

/**
 * Checks if an activation mode requires a target to be selected.
 */
export function requiresTargetSelection(mode: AbilityActivationMode): boolean {
  return mode === 'targeted' || mode === 'ground';
}

/**
 * Checks if an activation mode is a toggle-style ability.
 */
export function isToggleAbility(mode: AbilityActivationMode): boolean {
  return mode === 'toggle';
}

/**
 * Checks if an activation mode is passive (no activation needed).
 */
export function isPassiveAbility(mode: AbilityActivationMode): boolean {
  return mode === 'passive';
}

/**
 * Checks if an activation mode can be set to autocast.
 */
export function canAutocast(mode: AbilityActivationMode): boolean {
  return mode === 'autocast';
}

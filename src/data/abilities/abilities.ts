/**
 * Ability System - Type Definitions
 *
 * This file defines types for the ability system.
 * Actual ability data is loaded from JSON files at runtime:
 *   public/data/factions/{faction}/abilities.json
 */

// ==================== ABILITY TYPES ====================

// AbilityActivationMode describes how an ability is activated (instant, targeted, etc.)
// This is distinct from AbilityTargetType in engine/components/Ability.ts which describes
// the targeting behavior (none, point, unit, ally, self)
export type AbilityActivationMode = 'instant' | 'targeted' | 'ground' | 'passive' | 'toggle' | 'autocast';
export type AbilityEffectType =
  | 'damage'
  | 'heal'
  | 'buff'
  | 'debuff'
  | 'spawn'
  | 'transform'
  | 'teleport'
  | 'cloak'
  | 'detect'
  | 'resource'
  | 'custom';

export interface AbilityEffect {
  type: AbilityEffectType;
  value?: number;
  duration?: number; // Seconds
  radius?: number; // AoE radius
  targetFilter?: AbilityTargetFilter;
  customHandler?: string; // Name of custom handler function
}

export interface AbilityTargetFilter {
  includeSelf?: boolean;
  includeAllies?: boolean;
  includeEnemies?: boolean;
  includeNeutral?: boolean;
  unitCategories?: string[]; // Filter by unit category
  requiresBiological?: boolean;
  requiresMechanical?: boolean;
  requiresGround?: boolean;
  requiresAir?: boolean;
}

// ==================== ABILITY DEFINITION ====================

// AbilityDataDefinition is for data layer definitions (game content)
// This is distinct from AbilityDefinition in engine/components/Ability.ts which is for ECS runtime
export interface AbilityDataDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;

  // Targeting
  targetType: AbilityActivationMode;
  range?: number; // Range for targeted abilities
  radius?: number; // Effect radius for AoE

  // Costs
  energyCost?: number;
  healthCost?: number;
  resourceCost?: { [resourceId: string]: number };

  // Timing
  cooldown?: number; // Seconds
  castTime?: number; // Seconds (0 = instant)
  duration?: number; // Seconds for buffs/toggles

  // Effects
  effects: AbilityEffect[];

  // Requirements
  requiresResearch?: string[]; // Research IDs required
  requiresBuilding?: string[]; // Building IDs required

  // Flags
  canAutocast?: boolean;
  interruptsMovement?: boolean;
  channeled?: boolean; // Ability is interrupted if unit moves/attacked

  // Audio/Visual
  soundEffect?: string;
  visualEffect?: string;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if a unit has a specific ability.
 */
export function unitHasAbility(unitAbilities: string[] | undefined, abilityId: string): boolean {
  return unitAbilities?.includes(abilityId) ?? false;
}

/**
 * Check if an ability can be used (energy, cooldown, etc.).
 */
export function canUseAbility(
  ability: AbilityDataDefinition,
  currentEnergy: number,
  currentHealth: number,
  cooldownRemaining: number,
  researchCompleted: Set<string>
): { canUse: boolean; reason?: string } {
  // Check cooldown
  if (cooldownRemaining > 0) {
    return { canUse: false, reason: 'On cooldown' };
  }

  // Check energy
  if (ability.energyCost && currentEnergy < ability.energyCost) {
    return { canUse: false, reason: 'Not enough energy' };
  }

  // Check health cost
  if (ability.healthCost && currentHealth <= ability.healthCost) {
    return { canUse: false, reason: 'Not enough health' };
  }

  // Check research requirements
  if (ability.requiresResearch) {
    for (const researchId of ability.requiresResearch) {
      if (!researchCompleted.has(researchId)) {
        return { canUse: false, reason: 'Research required' };
      }
    }
  }

  return { canUse: true };
}

/**
 * Calculate ability damage with modifiers.
 */
export function calculateAbilityDamage(
  ability: AbilityDataDefinition,
  bonusDamage: number = 0
): number {
  const damageEffect = ability.effects.find(e => e.type === 'damage');
  if (!damageEffect || damageEffect.value === undefined) return 0;

  return damageEffect.value + bonusDamage;
}

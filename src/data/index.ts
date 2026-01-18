/**
 * VOIDSTRIKE Data System - Central Export Point
 *
 * This file exports all data-driven configuration modules for the game.
 * Import from '@/data' to access any game configuration.
 *
 * Architecture:
 * - All game-specific values are defined in data files, not hardcoded in systems
 * - Systems import configuration from these data modules
 * - To create a different game, modify these data files without touching engine code
 *
 * Modules:
 * - combat: Damage types, armor types, damage multipliers
 * - resources: Resource types and gathering configuration
 * - units: Unit definitions and categories
 * - buildings: Building definitions
 * - abilities: Ability definitions and registry
 * - formations: Unit formation patterns
 * - ai: AI build orders and difficulty configuration
 *
 * @example
 * import { getDamageMultiplier, RESOURCE_TYPES, getFormation } from '@/data';
 */

// ==================== COMBAT ====================
export {
  DAMAGE_TYPES,
  ARMOR_TYPES,
  DAMAGE_MULTIPLIERS,
  COMBAT_CONFIG,
  DEFAULT_TARGET_PRIORITIES,
  getDamageMultiplier,
  getDamageTypeIds,
  getArmorTypeIds,
  validateCombatConfig,
  type DamageTypeDefinition,
  type ArmorTypeDefinition,
  type CombatConfig,
} from './combat/combat';

// ==================== RESOURCES ====================
export {
  RESOURCE_TYPES,
  RESOURCE_SYSTEM_CONFIG,
  STARTING_RESOURCES,
  getResourceTypeIds,
  getResourceType,
  getPrimaryResourceType,
  getSecondaryResourceTypes,
  getEffectiveGatherRate,
  requiresBuilding,
  getRequiredBuilding,
  createEmptyResourceBag,
  createStartingResourceBag,
  type ResourceTypeDefinition,
  type ResourceSystemConfig,
  type StartingResources,
} from './resources/resources';

// ==================== UNIT CATEGORIES ====================
export {
  UNIT_CATEGORIES,
  UNIT_CATEGORY_ASSIGNMENTS,
  UNIT_SUBCATEGORIES,
  UNIT_SUBCATEGORY_ASSIGNMENTS,
  getCategoryIds,
  getCategory,
  getUnitCategory,
  getUnitSubcategory,
  getUnitsInCategory,
  getDefaultTargetPriority,
  isCombatUnit,
  getCategoriesSorted,
  type UnitCategoryDefinition,
  type SubcategoryDefinition,
} from './units/categories';

// ==================== ABILITIES ====================
export {
  ABILITY_DEFINITIONS,
  AbilityRegistry,
  getAbility,
  unitHasAbility,
  getUnitAbilities,
  canUseAbility,
  calculateAbilityDamage,
  type AbilityDefinition,
  type AbilityEffect,
  type AbilityTargetType,
  type AbilityEffectType,
  type AbilityTargetFilter,
} from './abilities/abilities';

// ==================== FORMATIONS ====================
export {
  FORMATION_DEFINITIONS,
  FORMATION_CONFIG,
  getFormationIds,
  getFormation,
  getDefaultFormation,
  generateFormationPositions,
  sortUnitsForFormation,
  type FormationDefinition,
  type FormationSlot,
  type FormationShape,
  type FormationConfig,
} from './formations/formations';

// ==================== AI BUILD ORDERS ====================
export {
  AI_DIFFICULTY_CONFIG,
  FACTION_BUILD_ORDERS,
  FACTION_UNIT_COMPOSITIONS,
  getBuildOrders,
  getRandomBuildOrder,
  getAIConfig,
  getUnitComposition,
  selectUnitToBuild,
  getFactionsWithBuildOrders,
  validateBuildOrder,
  type AIDifficulty,
  type BuildOrderStep,
  type BuildOrderCondition,
  type BuildOrder,
  type AIBehaviorConfig,
  type UnitCompositionWeights,
  type BuildOrderStyle,
  type BuildOrderStepType,
} from './ai/buildOrders';

// ==================== UNIT DEFINITIONS ====================
// Re-export from faction-specific files for convenience
export { UNIT_DEFINITIONS, DOMINION_UNITS } from './units/dominion';

// ==================== BUILDING DEFINITIONS ====================
export {
  BUILDING_DEFINITIONS,
  DOMINION_BUILDINGS,
  RESEARCH_MODULE_UNITS,
  PRODUCTION_MODULE_UNITS,
} from './buildings/dominion';

// ==================== RESEARCH DEFINITIONS ====================
export { RESEARCH_DEFINITIONS } from './research/dominion';

/**
 * AI System - Public API
 *
 * This module exports all AI-related functionality.
 * Import from here to access AI configuration and utilities.
 */

// Core configuration types and utilities
export {
  type AIDifficulty,
  type AIPersonality,
  type AIState,
  type FactionAIConfig,
  type MacroRule,
  type RuleCondition,
  type MacroAction,
  type TacticalConfig,
  type MicroConfig,
  type UnitMicroBehavior,
  type EconomyConfig,
  type ProductionConfig,
  type DifficultySettings,
  type AIStateSnapshot,
  type UtilityScore,
  type UtilityCondition,
  registerFactionAIConfig,
  getFactionAIConfig,
  getRegisteredFactions,
  evaluateCondition,
  evaluateRule,
  findBestMacroRule,
  calculateUtilityScore,
} from './aiConfig';

// Build orders (existing system, integrated)
export {
  type BuildOrderStep,
  type BuildOrder,
  type UnitCompositionWeights,
  FACTION_BUILD_ORDERS,
  FACTION_UNIT_COMPOSITIONS,
  getBuildOrders,
  getRandomBuildOrder,
  getUnitComposition,
  selectUnitToBuild,
  getFactionsWithBuildOrders,
  validateBuildOrder,
} from './buildOrders';

// Faction configurations - import to register
import './factions/dominion';

// Re-export faction config for direct access
export { DOMINION_AI_CONFIG } from './factions/dominion';

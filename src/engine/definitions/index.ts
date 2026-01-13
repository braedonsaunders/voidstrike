/**
 * Definition System - Main Export
 *
 * This module provides a data-driven entity definition system that allows
 * game content to be defined in JSON files rather than TypeScript code.
 *
 * Usage:
 *
 * 1. JSON Loading (recommended for new games):
 *    await initializeDefinitions('/data/game.json');
 *
 * 2. TypeScript Bootstrapping (backwards compatibility):
 *    bootstrapDefinitions();
 *
 * 3. Accessing Definitions:
 *    const unit = DefinitionRegistry.getUnit('trooper');
 *    const building = DefinitionRegistry.getBuilding('headquarters');
 */

// Main registry
export { DefinitionRegistry, DefinitionRegistryClass } from './DefinitionRegistry';

// Bootstrap functions
export {
  bootstrapDefinitions,
  initializeDefinitions,
  definitionsReady,
  waitForDefinitions,
} from './bootstrap';

// Loader (for advanced usage)
export { DefinitionLoader } from './DefinitionLoader';
export type { LoadResult } from './DefinitionLoader';

// Validator (for tooling)
export { DefinitionValidator } from './DefinitionValidator';

// Types
export type {
  // Core definitions
  UnitDefinition,
  BuildingDefinition,
  ResearchDefinition,
  AbilityDefinition,
  TransformMode,
  DamageType,
  AbilityTargetType,
  // Research
  UpgradeEffect,
  UpgradeEffectType,
  UnitCategory,
  // Walls
  WallDefinition,
  WallUpgradeDefinition,
  WallConnectionType,
  WallUpgradeType,
  GateState,
  // Manifests
  GameManifest,
  FactionManifest,
  FactionData,
  // Validation
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './types';

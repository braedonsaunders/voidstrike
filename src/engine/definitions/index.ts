/**
 * Definition System - Main Export
 *
 * This module provides a data-driven entity definition system that allows
 * game content to be defined in JSON files rather than TypeScript code.
 *
 * Usage:
 *
 * 1. Initialize from JSON (call once at app startup):
 *    await initializeDefinitions('/data/game.json');
 *
 * 2. Wait if initialization is in progress:
 *    await waitForDefinitions();
 *
 * 3. Accessing Definitions:
 *    const unit = DefinitionRegistry.getUnit('trooper');
 *    const building = DefinitionRegistry.getBuilding('headquarters');
 */

// Main registry
export { DefinitionRegistry, DefinitionRegistryClass } from './DefinitionRegistry';

// Bootstrap functions
export {
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

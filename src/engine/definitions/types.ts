/**
 * Definition Types for Data-Driven Entity System
 *
 * These types are used by the Definition Registry to load and validate
 * game data from JSON files at runtime. They match the existing component
 * interfaces exactly to ensure backwards compatibility.
 */

import type { UnitDefinition, TransformMode, DamageType } from '../components/Unit';
import type { BuildingDefinition } from '../components/Building';
import type { AbilityDefinition, AbilityTargetType } from '../components/Ability';

// Re-export for convenience
export type { UnitDefinition, TransformMode, DamageType };
export type { BuildingDefinition };
export type { AbilityDefinition, AbilityTargetType };

/**
 * Research/Upgrade effect type
 */
export type UpgradeEffectType =
  | 'damage_bonus'
  | 'armor_bonus'
  | 'attack_speed'
  | 'ability_unlock'
  | 'range_bonus'
  | 'health_bonus'
  | 'speed_bonus';

export type UnitCategory = 'infantry' | 'vehicle' | 'ship' | 'naval';

export interface UpgradeEffect {
  type: UpgradeEffectType;
  value: number;
  targets?: string[]; // unit IDs this affects, empty = all
  unitTypes?: UnitCategory[]; // unit type categories
}

export interface ResearchDefinition {
  id: string;
  name: string;
  description: string;
  faction: string;
  mineralCost: number;
  plasmaCost: number;
  researchTime: number; // seconds
  effects: UpgradeEffect[];
  requirements?: string[]; // building IDs or upgrade IDs required
  level?: number; // 1, 2, 3 for tiered upgrades
  nextLevel?: string; // upgrade ID for next level
  icon?: string;
}

/**
 * Wall-specific building definition
 */
export type WallConnectionType =
  | 'none'
  | 'horizontal'
  | 'vertical'
  | 'corner_ne'
  | 'corner_nw'
  | 'corner_se'
  | 'corner_sw'
  | 't_north'
  | 't_south'
  | 't_east'
  | 't_west'
  | 'cross';

export type GateState = 'closed' | 'open' | 'auto' | 'locked';
export type WallUpgradeType = 'reinforced' | 'shielded' | 'weapon' | 'repair_drone';

export interface WallDefinition extends BuildingDefinition {
  isWall: true;
  isGate?: boolean;
  canMountTurret?: boolean;
  wallUpgrades?: WallUpgradeType[];
}

export interface WallUpgradeDefinition {
  id: WallUpgradeType;
  name: string;
  description: string;
  researchCost: { minerals: number; plasma: number };
  researchTime: number;
  applyCost: { minerals: number; plasma: number };
  applyTime: number;
  researchBuilding: string;
}

/**
 * Faction manifest - describes a faction's content
 */
export interface FactionManifest {
  id: string;
  name: string;
  description: string;
  color: string; // hex color for faction UI
  icon?: string;
  // Paths relative to faction directory
  unitsFile: string;
  buildingsFile: string;
  researchFile: string;
  abilitiesFile: string;
  // Optional additional files
  wallsFile?: string;
  wallUpgradesFile?: string;
  // Unit type categorization
  unitTypes?: Record<string, UnitCategory>;
  // Building-to-unit production mappings for addons
  addonUnits?: {
    researchModule?: Record<string, string[]>;
    productionModule?: Record<string, string[]>;
  };
}

/**
 * Game manifest - root configuration for all game data
 */
export interface GameManifest {
  name: string;
  version: string;
  description?: string;
  // Faction directories relative to data root
  factions: string[];
  // Default faction for single-player
  defaultFaction?: string;
  // Shared data files
  shared?: {
    damageTypes?: string;
    abilityTemplates?: string;
  };
}

/**
 * Validation result for definition loading
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: 'missing_required' | 'invalid_type' | 'invalid_reference' | 'duplicate_id';
  path: string;
  message: string;
  value?: unknown;
}

export interface ValidationWarning {
  type: 'unused_reference' | 'deprecated_field' | 'recommended_missing';
  path: string;
  message: string;
}

/**
 * Loaded faction data
 */
export interface FactionData {
  manifest: FactionManifest;
  units: Record<string, UnitDefinition>;
  buildings: Record<string, BuildingDefinition>;
  research: Record<string, ResearchDefinition>;
  abilities: Record<string, AbilityDefinition>;
  walls?: Record<string, WallDefinition>;
  wallUpgrades?: Record<string, WallUpgradeDefinition>;
  unitTypes: Record<string, UnitCategory>;
  addonUnits: {
    researchModule: Record<string, string[]>;
    productionModule: Record<string, string[]>;
  };
}

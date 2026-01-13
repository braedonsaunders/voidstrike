/**
 * Resource Types Configuration - Data-Driven Resource System
 *
 * This file defines all resource types in the game. The system supports
 * any number of resources with different gathering mechanics.
 *
 * Example configurations:
 * - Sci-fi RTS: minerals, vespene (2 resources)
 * - Medieval RTS: food, wood, gold, stone (4 resources)
 * - Fantasy RTS: gold, lumber, mana (3 resources)
 */

// ==================== RESOURCE TYPE DEFINITIONS ====================

export interface ResourceTypeDefinition {
  id: string;
  name: string;
  description: string;
  color: string; // UI display color
  icon?: string;

  // Gathering mechanics
  gatherRate: number; // Base units gathered per trip
  gatherTime: number; // Seconds to gather
  carryCapacity: number; // Max units a worker can carry

  // Worker assignment
  optimalWorkersPerSource: number; // Optimal workers per resource node

  // Source properties
  requiresBuilding: boolean; // Requires extractor/refinery building
  buildingType?: string; // Building ID required (e.g., 'extractor')
  defaultSourceAmount: number; // Default amount in resource nodes

  // UI
  shortName: string; // Short display name (e.g., "Min" for minerals)
  pluralName: string;
}

export const RESOURCE_TYPES: Record<string, ResourceTypeDefinition> = {
  minerals: {
    id: 'minerals',
    name: 'Minerals',
    description: 'Basic construction material gathered from mineral patches.',
    color: '#60a0ff',
    gatherRate: 5,
    gatherTime: 2.786, // ~2.8 seconds per trip
    carryCapacity: 5,
    optimalWorkersPerSource: 2,
    requiresBuilding: false,
    defaultSourceAmount: 1500,
    shortName: 'Min',
    pluralName: 'Minerals',
  },
  vespene: {
    id: 'vespene',
    name: 'Vespene Gas',
    description: 'Rare gas extracted from geysers, required for advanced units.',
    color: '#40ff80',
    gatherRate: 4,
    gatherTime: 2.786,
    carryCapacity: 4,
    optimalWorkersPerSource: 3,
    requiresBuilding: true,
    buildingType: 'extractor',
    defaultSourceAmount: 2000,
    shortName: 'Gas',
    pluralName: 'Vespene',
  },
};

// ==================== RESOURCE SYSTEM CONFIG ====================

export interface ResourceSystemConfig {
  // Worker behavior
  autoReturnEnabled: boolean; // Workers auto-return to nearest base
  smartGatherEnabled: boolean; // Workers find new patches when current depleted

  // Distance bonuses
  closeRangeBonus: number; // Bonus for gathering near base
  closeRangeThreshold: number; // Distance for close range bonus

  // Saturation
  maxWorkersPerSource: number; // Hard cap on workers per source
  diminishingReturnsStart: number; // Workers after this get reduced efficiency
  diminishingReturnsFactor: number; // Efficiency multiplier per extra worker
}

export const RESOURCE_SYSTEM_CONFIG: ResourceSystemConfig = {
  autoReturnEnabled: true,
  smartGatherEnabled: true,
  closeRangeBonus: 1.0, // No bonus currently
  closeRangeThreshold: 8,
  maxWorkersPerSource: 3,
  diminishingReturnsStart: 2,
  diminishingReturnsFactor: 0.7,
};

// ==================== STARTING RESOURCES ====================

/**
 * Starting resources for different game modes.
 * Key is the resource ID, value is starting amount.
 */
export interface StartingResources {
  [resourceId: string]: number;
}

export const STARTING_RESOURCES: Record<string, StartingResources> = {
  standard: {
    minerals: 50,
    vespene: 0,
  },
  quick: {
    minerals: 200,
    vespene: 100,
  },
  rich: {
    minerals: 1000,
    vespene: 500,
  },
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Get all registered resource type IDs.
 */
export function getResourceTypeIds(): string[] {
  return Object.keys(RESOURCE_TYPES);
}

/**
 * Get a resource type definition by ID.
 */
export function getResourceType(id: string): ResourceTypeDefinition | undefined {
  return RESOURCE_TYPES[id];
}

/**
 * Get the primary resource type (first one, used for basic units).
 */
export function getPrimaryResourceType(): ResourceTypeDefinition {
  const ids = getResourceTypeIds();
  return RESOURCE_TYPES[ids[0]];
}

/**
 * Get secondary resource types (all except primary).
 */
export function getSecondaryResourceTypes(): ResourceTypeDefinition[] {
  const ids = getResourceTypeIds();
  return ids.slice(1).map(id => RESOURCE_TYPES[id]);
}

/**
 * Calculate effective gather rate with diminishing returns.
 */
export function getEffectiveGatherRate(
  resourceType: string,
  workersAssigned: number
): number {
  const config = RESOURCE_SYSTEM_CONFIG;
  const resource = RESOURCE_TYPES[resourceType];
  if (!resource) return 0;

  let effectiveWorkers = 0;
  for (let i = 0; i < workersAssigned; i++) {
    if (i < config.diminishingReturnsStart) {
      effectiveWorkers += 1;
    } else {
      effectiveWorkers += Math.pow(
        config.diminishingReturnsFactor,
        i - config.diminishingReturnsStart + 1
      );
    }
  }

  return effectiveWorkers * resource.gatherRate;
}

/**
 * Check if a resource type requires a building to gather.
 */
export function requiresBuilding(resourceType: string): boolean {
  return RESOURCE_TYPES[resourceType]?.requiresBuilding ?? false;
}

/**
 * Get the building type required for a resource (if any).
 */
export function getRequiredBuilding(resourceType: string): string | undefined {
  return RESOURCE_TYPES[resourceType]?.buildingType;
}

/**
 * Create an empty resource bag (all resources set to 0).
 */
export function createEmptyResourceBag(): Record<string, number> {
  const bag: Record<string, number> = {};
  for (const id of getResourceTypeIds()) {
    bag[id] = 0;
  }
  return bag;
}

/**
 * Create starting resources for a game mode.
 */
export function createStartingResourceBag(mode: string = 'standard'): Record<string, number> {
  const starting = STARTING_RESOURCES[mode] || STARTING_RESOURCES.standard;
  const bag = createEmptyResourceBag();
  for (const [id, amount] of Object.entries(starting)) {
    bag[id] = amount;
  }
  return bag;
}

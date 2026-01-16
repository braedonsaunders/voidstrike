/**
 * Definition Bootstrap
 *
 * This module provides backwards compatibility by registering the existing
 * TypeScript definitions with the DefinitionRegistry. This allows the game
 * to work exactly as before while enabling the data-driven system.
 *
 * Usage:
 *   // In your game initialization:
 *   import { bootstrapDefinitions, initializeDefinitions } from '@/engine/definitions/bootstrap';
 *
 *   // Option 1: Use existing TypeScript data (backwards compatible)
 *   bootstrapDefinitions();
 *
 *   // Option 2: Load from JSON files (data-driven)
 *   await initializeDefinitions('/data/game.json');
 */

import { DefinitionRegistry } from './DefinitionRegistry';
import { debugInitialization } from '@/utils/debugLogger';

// Import existing TypeScript definitions
import { UNIT_DEFINITIONS as DOMINION_UNITS } from '@/data/units/dominion';
import {
  BUILDING_DEFINITIONS as DOMINION_BUILDINGS,
  RESEARCH_MODULE_UNITS,
  PRODUCTION_MODULE_UNITS,
} from '@/data/buildings/dominion';
import {
  RESEARCH_DEFINITIONS as DOMINION_RESEARCH,
  UNIT_TYPES,
} from '@/data/research/dominion';
import { DOMINION_ABILITIES } from '@/engine/components/Ability';
import {
  WALL_DEFINITIONS,
  WALL_UPGRADE_DEFINITIONS,
} from '@/data/buildings/walls';

import type { UnitDefinition, BuildingDefinition, ResearchDefinition, AbilityDefinition, WallDefinition, WallUpgradeDefinition, UnitCategory } from './types';

/**
 * Bootstrap definitions from existing TypeScript data files.
 * This provides backwards compatibility - the game works exactly as before.
 */
export function bootstrapDefinitions(): void {
  if (DefinitionRegistry.isInitialized()) {
    debugInitialization.log('[Bootstrap] Definitions already initialized, skipping');
    return;
  }

  debugInitialization.log('[Bootstrap] Registering TypeScript definitions with registry...');

  // Merge buildings with walls
  const allBuildings: Record<string, BuildingDefinition> = {
    ...DOMINION_BUILDINGS,
  };

  // Add wall definitions with proper typing
  for (const [id, wall] of Object.entries(WALL_DEFINITIONS)) {
    allBuildings[id] = wall as BuildingDefinition;
  }

  // Register the Dominion faction
  DefinitionRegistry.registerFaction('dominion', {
    manifest: {
      id: 'dominion',
      name: 'Dominion',
      description: 'The Terran Dominion - A militaristic human faction with versatile units and powerful siege capabilities.',
      color: '#4A90D9',
    },
    units: DOMINION_UNITS as Record<string, UnitDefinition>,
    buildings: allBuildings,
    research: DOMINION_RESEARCH as Record<string, ResearchDefinition>,
    abilities: DOMINION_ABILITIES as Record<string, AbilityDefinition>,
    walls: WALL_DEFINITIONS as Record<string, WallDefinition>,
    wallUpgrades: WALL_UPGRADE_DEFINITIONS as Record<string, WallUpgradeDefinition>,
    unitTypes: UNIT_TYPES as Record<string, UnitCategory>,
    addonUnits: {
      researchModule: RESEARCH_MODULE_UNITS,
      productionModule: PRODUCTION_MODULE_UNITS,
    },
  });

  debugInitialization.log('[Bootstrap] Definitions registered:', DefinitionRegistry.getStats());
}

/**
 * Initialize definitions from JSON files.
 * This is the data-driven approach for new games.
 *
 * @param manifestPath - Path to the game manifest JSON file
 */
export async function initializeDefinitions(manifestPath: string = '/data/game.json'): Promise<void> {
  if (DefinitionRegistry.isInitialized()) {
    debugInitialization.log('[Bootstrap] Definitions already initialized, skipping');
    return;
  }

  debugInitialization.log('[Bootstrap] Loading definitions from JSON:', manifestPath);
  await DefinitionRegistry.loadFromManifest(manifestPath);
  debugInitialization.log('[Bootstrap] Definitions loaded:', DefinitionRegistry.getStats());
}

/**
 * Check if definitions are ready to use
 */
export function definitionsReady(): boolean {
  return DefinitionRegistry.isInitialized();
}

/**
 * Wait for definitions to be ready
 */
export async function waitForDefinitions(): Promise<void> {
  await DefinitionRegistry.waitForInitialization();
}

/**
 * Vitest Test Setup
 *
 * This file initializes the DefinitionRegistry with data from JSON files
 * before any tests run. This ensures that proxy objects like UNIT_DEFINITIONS,
 * BUILDING_DEFINITIONS, etc. work correctly in tests.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DefinitionRegistry } from '@/engine/definitions/DefinitionRegistry';
import type {
  UnitDefinition,
  BuildingDefinition,
  ResearchDefinition,
  AbilityDefinition,
  WallUpgradeDefinition,
  FactionManifest,
  UnitCategory,
} from '@/engine/definitions/types';

/**
 * Load JSON file from the public/data directory
 */
function loadJSON<T>(relativePath: string): T {
  const absolutePath = resolve(__dirname, '..', 'public', 'data', relativePath);
  const content = readFileSync(absolutePath, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Initialize the DefinitionRegistry with test data from JSON files
 */
function initializeTestDefinitions(): void {
  // Skip if already initialized
  if (DefinitionRegistry.isInitialized()) {
    return;
  }

  // Load the Dominion faction data
  const manifest = loadJSON<FactionManifest>('factions/dominion/manifest.json');
  const units = loadJSON<Record<string, UnitDefinition>>('factions/dominion/units.json');
  const buildings = loadJSON<Record<string, BuildingDefinition>>('factions/dominion/buildings.json');
  const research = loadJSON<Record<string, ResearchDefinition>>('factions/dominion/research.json');
  const abilities = loadJSON<Record<string, AbilityDefinition>>('factions/dominion/abilities.json');
  const wallUpgrades = loadJSON<Record<string, WallUpgradeDefinition>>('factions/dominion/wall_upgrades.json');

  // Extract wall definitions from buildings
  const walls: Record<string, BuildingDefinition & { isWall: true }> = {};
  for (const [id, building] of Object.entries(buildings)) {
    if ((building as { isWall?: boolean }).isWall) {
      walls[id] = building as BuildingDefinition & { isWall: true };
    }
  }

  // Register the faction with the DefinitionRegistry
  DefinitionRegistry.registerFaction('dominion', {
    manifest: {
      ...manifest,
      // Ensure required fields are present
      id: manifest.id || 'dominion',
      name: manifest.name || 'Dominion',
      description: manifest.description || '',
      color: manifest.color || '#4A90D9',
      unitsFile: manifest.unitsFile || 'units.json',
      buildingsFile: manifest.buildingsFile || 'buildings.json',
      researchFile: manifest.researchFile || 'research.json',
      abilitiesFile: manifest.abilitiesFile || 'abilities.json',
    },
    units,
    buildings,
    research,
    abilities,
    walls,
    wallUpgrades,
    unitTypes: (manifest.unitTypes || {}) as Record<string, UnitCategory>,
    addonUnits: {
      researchModule: manifest.addonUnits?.researchModule || {},
      productionModule: manifest.addonUnits?.productionModule || {},
    },
  });
}

// Initialize definitions when this module is loaded
initializeTestDefinitions();

// Export for use in individual tests if needed
export { initializeTestDefinitions };

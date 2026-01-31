/**
 * Definition Bootstrap
 *
 * This module initializes game definitions from JSON files.
 * JSON is the single source of truth for all game data.
 *
 * Usage:
 *   import { initializeDefinitions, waitForDefinitions } from '@/engine/definitions/bootstrap';
 *
 *   // Initialize from JSON (call once at app startup)
 *   await initializeDefinitions();
 *
 *   // Or wait if initialization is in progress
 *   await waitForDefinitions();
 */

import { DefinitionRegistry } from './DefinitionRegistry';
import { debugInitialization } from '@/utils/debugLogger';

// Re-export types for backwards compatibility
export type { UnitDefinition, BuildingDefinition, ResearchDefinition, AbilityDefinition, WallDefinition, WallUpgradeDefinition, UnitCategory } from './types';

/**
 * Initialize definitions from JSON files.
 * This is the primary initialization method - JSON is the source of truth.
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

// Store the initialization promise so it can be awaited by callers
let initializationPromise: Promise<void> | null = null;

/**
 * @deprecated Use initializeDefinitions() instead. This is kept for backwards compatibility.
 * Will internally call initializeDefinitions() to load from JSON.
 *
 * @returns Promise that resolves when definitions are loaded.
 *          Callers should await this before accessing definitions.
 */
export function bootstrapDefinitions(): Promise<void> {
  if (DefinitionRegistry.isInitialized()) {
    return Promise.resolve();
  }

  // Return existing promise if initialization is already in progress
  if (initializationPromise) {
    return initializationPromise;
  }

  debugInitialization.log('[Bootstrap] bootstrapDefinitions() called - starting async JSON load');
  initializationPromise = initializeDefinitions()
    .catch((err) => {
      console.error('[Bootstrap] Failed to load definitions from JSON:', err);
      initializationPromise = null;
      throw err;
    });

  return initializationPromise;
}

// ==================== BACKWARDS COMPATIBILITY EXPORTS ====================
// These getters provide backwards-compatible access to definitions.
// They pull from the DefinitionRegistry which loads from JSON.

/**
 * Get all unit definitions.
 * @throws Error if definitions not initialized
 */
export function getUnitDefinitions() {
  if (!DefinitionRegistry.isInitialized()) {
    throw new Error('Definitions not initialized. Call initializeDefinitions() first.');
  }
  return DefinitionRegistry.getAllUnits();
}

/**
 * Get all building definitions.
 * @throws Error if definitions not initialized
 */
export function getBuildingDefinitions() {
  if (!DefinitionRegistry.isInitialized()) {
    throw new Error('Definitions not initialized. Call initializeDefinitions() first.');
  }
  return DefinitionRegistry.getAllBuildings();
}

/**
 * Get all research definitions.
 * @throws Error if definitions not initialized
 */
export function getResearchDefinitions() {
  if (!DefinitionRegistry.isInitialized()) {
    throw new Error('Definitions not initialized. Call initializeDefinitions() first.');
  }
  return DefinitionRegistry.getAllResearch();
}

/**
 * Get all ability definitions.
 * @throws Error if definitions not initialized
 */
export function getAbilityDefinitions() {
  if (!DefinitionRegistry.isInitialized()) {
    throw new Error('Definitions not initialized. Call initializeDefinitions() first.');
  }
  return DefinitionRegistry.getAllAbilities();
}

/**
 * Get all wall definitions.
 * @throws Error if definitions not initialized
 */
export function getWallDefinitions() {
  if (!DefinitionRegistry.isInitialized()) {
    throw new Error('Definitions not initialized. Call initializeDefinitions() first.');
  }
  return DefinitionRegistry.getAllWalls();
}

/**
 * Get all wall upgrade definitions.
 * @throws Error if definitions not initialized
 */
export function getWallUpgradeDefinitions() {
  if (!DefinitionRegistry.isInitialized()) {
    throw new Error('Definitions not initialized. Call initializeDefinitions() first.');
  }
  return DefinitionRegistry.getAllWallUpgrades();
}

/**
 * Get research module unit mappings.
 * @throws Error if definitions not initialized
 */
export function getResearchModuleUnits() {
  if (!DefinitionRegistry.isInitialized()) {
    throw new Error('Definitions not initialized. Call initializeDefinitions() first.');
  }
  return DefinitionRegistry.getAllResearchModuleUnits();
}

/**
 * Get production module unit mappings.
 * @throws Error if definitions not initialized
 */
export function getProductionModuleUnits() {
  if (!DefinitionRegistry.isInitialized()) {
    throw new Error('Definitions not initialized. Call initializeDefinitions() first.');
  }
  return DefinitionRegistry.getAllProductionModuleUnits();
}

/**
 * Get unit type mappings.
 * @throws Error if definitions not initialized
 */
export function getUnitTypes() {
  if (!DefinitionRegistry.isInitialized()) {
    throw new Error('Definitions not initialized. Call initializeDefinitions() first.');
  }
  return DefinitionRegistry.getUnitTypes();
}

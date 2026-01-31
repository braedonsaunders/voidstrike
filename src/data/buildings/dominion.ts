/**
 * Dominion Building Definitions
 *
 * This file re-exports building definitions from the DefinitionRegistry.
 * The source of truth is: public/data/factions/dominion/buildings.json
 *
 * For backwards compatibility, this module provides the same exports
 * that were previously defined here as inline TypeScript data.
 */

import { DefinitionRegistry } from '@/engine/definitions/DefinitionRegistry';
import type { BuildingDefinition } from '@/engine/components/Building';

// Re-export types
export type { BuildingDefinition };

/**
 * Proxy object that delegates to the DefinitionRegistry.
 * Provides backwards-compatible access to building definitions.
 */
export const BUILDING_DEFINITIONS: Record<string, BuildingDefinition> = new Proxy(
  {} as Record<string, BuildingDefinition>,
  {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'toJSON' || typeof prop === 'symbol') {
        return undefined;
      }
      if (!DefinitionRegistry.isInitialized()) {
        console.warn(`[BUILDING_DEFINITIONS] Accessing '${prop}' before definitions initialized`);
        return undefined;
      }
      return DefinitionRegistry.getBuilding(prop);
    },
    has(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return false;
      return DefinitionRegistry.getBuilding(prop) !== undefined;
    },
    ownKeys() {
      if (!DefinitionRegistry.isInitialized()) return [];
      return Object.keys(DefinitionRegistry.getAllBuildings());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return undefined;
      const building = DefinitionRegistry.getBuilding(prop);
      if (!building) return undefined;
      return {
        value: building,
        writable: false,
        enumerable: true,
        configurable: true,
      };
    },
  }
);

/**
 * Units that require Research Module addon.
 * Proxies to DefinitionRegistry.getAllResearchModuleUnits()
 */
export const RESEARCH_MODULE_UNITS: Record<string, string[]> = new Proxy(
  {} as Record<string, string[]>,
  {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'toJSON' || typeof prop === 'symbol') {
        return undefined;
      }
      if (!DefinitionRegistry.isInitialized()) {
        console.warn(`[RESEARCH_MODULE_UNITS] Accessing '${prop}' before definitions initialized`);
        return [];
      }
      return DefinitionRegistry.getResearchModuleUnits(prop);
    },
    has(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return false;
      const units = DefinitionRegistry.getResearchModuleUnits(prop);
      return units.length > 0;
    },
    ownKeys() {
      if (!DefinitionRegistry.isInitialized()) return [];
      return Object.keys(DefinitionRegistry.getAllResearchModuleUnits());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return undefined;
      const units = DefinitionRegistry.getResearchModuleUnits(prop);
      if (units.length === 0) return undefined;
      return {
        value: units,
        writable: false,
        enumerable: true,
        configurable: true,
      };
    },
  }
);

/**
 * Units that can be double-produced with Production Module addon.
 * Proxies to DefinitionRegistry.getAllProductionModuleUnits()
 */
export const PRODUCTION_MODULE_UNITS: Record<string, string[]> = new Proxy(
  {} as Record<string, string[]>,
  {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'toJSON' || typeof prop === 'symbol') {
        return undefined;
      }
      if (!DefinitionRegistry.isInitialized()) {
        console.warn(`[PRODUCTION_MODULE_UNITS] Accessing '${prop}' before definitions initialized`);
        return [];
      }
      return DefinitionRegistry.getProductionModuleUnits(prop);
    },
    has(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return false;
      const units = DefinitionRegistry.getProductionModuleUnits(prop);
      return units.length > 0;
    },
    ownKeys() {
      if (!DefinitionRegistry.isInitialized()) return [];
      return Object.keys(DefinitionRegistry.getAllProductionModuleUnits());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return undefined;
      const units = DefinitionRegistry.getProductionModuleUnits(prop);
      if (units.length === 0) return undefined;
      return {
        value: units,
        writable: false,
        enumerable: true,
        configurable: true,
      };
    },
  }
);


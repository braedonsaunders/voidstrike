/**
 * Dominion Research Definitions
 *
 * This file re-exports research definitions from the DefinitionRegistry.
 * The source of truth is: public/data/factions/dominion/research.json
 *
 * For backwards compatibility, this module provides the same exports
 * that were previously defined here as inline TypeScript data.
 */

import { DefinitionRegistry } from '@/engine/definitions/DefinitionRegistry';
import type { ResearchDefinition as RegistryResearchDefinition, UnitCategory } from '@/engine/definitions/types';

// Re-export types
export type UpgradeEffect = {
  type: 'damage_bonus' | 'armor_bonus' | 'attack_speed' | 'ability_unlock' | 'range_bonus' | 'health_bonus' | 'speed_bonus';
  value: number;
  targets?: string[]; // unit IDs this affects, empty = all
  unitTypes?: ('infantry' | 'vehicle' | 'ship')[]; // unit type categories
};

export interface ResearchDefinition {
  id: string;
  name: string;
  description: string;
  faction: string;
  mineralCost: number;
  vespeneCost: number;
  researchTime: number; // seconds
  effects: UpgradeEffect[];
  requirements?: string[]; // building IDs or upgrade IDs required
  level?: number; // 1, 2, 3 for tiered upgrades
  nextLevel?: string; // upgrade ID for next level
  icon?: string;
}

/**
 * Unit type mappings.
 * Proxies to DefinitionRegistry.getUnitTypes()
 */
export const UNIT_TYPES: Record<string, 'infantry' | 'vehicle' | 'ship' | 'naval'> = new Proxy(
  {} as Record<string, 'infantry' | 'vehicle' | 'ship' | 'naval'>,
  {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'toJSON' || typeof prop === 'symbol') {
        return undefined;
      }
      if (!DefinitionRegistry.isInitialized()) {
        console.warn(`[UNIT_TYPES] Accessing '${prop}' before definitions initialized`);
        return undefined;
      }
      return DefinitionRegistry.getUnitType(prop);
    },
    has(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return false;
      return DefinitionRegistry.getUnitType(prop) !== undefined;
    },
    ownKeys() {
      if (!DefinitionRegistry.isInitialized()) return [];
      return Object.keys(DefinitionRegistry.getUnitTypes());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return undefined;
      const unitType = DefinitionRegistry.getUnitType(prop);
      if (!unitType) return undefined;
      return {
        value: unitType,
        writable: false,
        enumerable: true,
        configurable: true,
      };
    },
  }
);

/**
 * Proxy object that delegates to the DefinitionRegistry.
 * Provides backwards-compatible access to research definitions.
 */
export const RESEARCH_DEFINITIONS: Record<string, ResearchDefinition> = new Proxy(
  {} as Record<string, ResearchDefinition>,
  {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'toJSON' || typeof prop === 'symbol') {
        return undefined;
      }
      if (!DefinitionRegistry.isInitialized()) {
        console.warn(`[RESEARCH_DEFINITIONS] Accessing '${prop}' before definitions initialized`);
        return undefined;
      }
      return DefinitionRegistry.getResearch(prop) as ResearchDefinition | undefined;
    },
    has(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return false;
      return DefinitionRegistry.getResearch(prop) !== undefined;
    },
    ownKeys() {
      if (!DefinitionRegistry.isInitialized()) return [];
      return Object.keys(DefinitionRegistry.getAllResearch());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return undefined;
      const research = DefinitionRegistry.getResearch(prop);
      if (!research) return undefined;
      return {
        value: research,
        writable: false,
        enumerable: true,
        configurable: true,
      };
    },
  }
);

/**
 * Array of all Dominion research definitions.
 * @deprecated Use DefinitionRegistry.getAllResearch() instead
 */
export const DOMINION_RESEARCH: ResearchDefinition[] = new Proxy([] as ResearchDefinition[], {
  get(target, prop) {
    if (prop === 'length') {
      if (!DefinitionRegistry.isInitialized()) return 0;
      return Object.keys(DefinitionRegistry.getAllResearch()).length;
    }
    if (typeof prop === 'string' && !isNaN(Number(prop))) {
      if (!DefinitionRegistry.isInitialized()) return undefined;
      const research = Object.values(DefinitionRegistry.getAllResearch());
      return research[Number(prop)] as ResearchDefinition | undefined;
    }
    if (prop === Symbol.iterator) {
      return function* () {
        if (!DefinitionRegistry.isInitialized()) return;
        yield* Object.values(DefinitionRegistry.getAllResearch()) as ResearchDefinition[];
      };
    }
    // Delegate array methods
    if (typeof prop === 'string' && typeof Array.prototype[prop as keyof typeof Array.prototype] === 'function') {
      const research = DefinitionRegistry.isInitialized()
        ? Object.values(DefinitionRegistry.getAllResearch())
        : [];
      return (research as unknown as Record<string, unknown>)[prop];
    }
    return (target as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/**
 * Building -> research mapping.
 * This is derived from the building canResearch arrays.
 */
export const BUILDING_RESEARCH_MAP: Record<string, string[]> = new Proxy(
  {} as Record<string, string[]>,
  {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'toJSON' || typeof prop === 'symbol') {
        return undefined;
      }
      if (!DefinitionRegistry.isInitialized()) {
        console.warn(`[BUILDING_RESEARCH_MAP] Accessing '${prop}' before definitions initialized`);
        return [];
      }
      const building = DefinitionRegistry.getBuilding(prop);
      return building?.canResearch ?? [];
    },
    has(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return false;
      const building = DefinitionRegistry.getBuilding(prop);
      return building !== undefined && (building.canResearch?.length ?? 0) > 0;
    },
    ownKeys() {
      if (!DefinitionRegistry.isInitialized()) return [];
      const buildings = DefinitionRegistry.getAllBuildings();
      return Object.keys(buildings).filter((id) => {
        const building = buildings[id];
        return building.canResearch && building.canResearch.length > 0;
      });
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return undefined;
      const building = DefinitionRegistry.getBuilding(prop);
      if (!building || !building.canResearch?.length) return undefined;
      return {
        value: building.canResearch,
        writable: false,
        enumerable: true,
        configurable: true,
      };
    },
  }
);

/**
 * Helper function to get all available research for a building.
 */
export function getAvailableResearch(buildingId: string): ResearchDefinition[] {
  if (!DefinitionRegistry.isInitialized()) {
    console.warn('[getAvailableResearch] Definitions not initialized');
    return [];
  }
  return DefinitionRegistry.getAvailableResearch(buildingId) as ResearchDefinition[];
}

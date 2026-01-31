/**
 * Dominion Unit Definitions
 *
 * This file re-exports unit definitions from the DefinitionRegistry.
 * The source of truth is: public/data/factions/dominion/units.json
 *
 * For backwards compatibility, this module provides the same exports
 * that were previously defined here as inline TypeScript data.
 */

import { DefinitionRegistry } from '@/engine/definitions/DefinitionRegistry';
import type { UnitDefinition, TransformMode } from '@/engine/components/Unit';

// Re-export types
export type { UnitDefinition, TransformMode };

/**
 * Proxy object that delegates to the DefinitionRegistry.
 * Provides backwards-compatible access to unit definitions.
 */
export const UNIT_DEFINITIONS: Record<string, UnitDefinition> = new Proxy(
  {} as Record<string, UnitDefinition>,
  {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'toJSON' || typeof prop === 'symbol') {
        return undefined;
      }
      if (!DefinitionRegistry.isInitialized()) {
        console.warn(`[UNIT_DEFINITIONS] Accessing '${prop}' before definitions initialized`);
        return undefined;
      }
      return DefinitionRegistry.getUnit(prop);
    },
    has(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return false;
      return DefinitionRegistry.getUnit(prop) !== undefined;
    },
    ownKeys() {
      if (!DefinitionRegistry.isInitialized()) return [];
      return Object.keys(DefinitionRegistry.getAllUnits());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return undefined;
      const unit = DefinitionRegistry.getUnit(prop);
      if (!unit) return undefined;
      return {
        value: unit,
        writable: false,
        enumerable: true,
        configurable: true,
      };
    },
  }
);


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

/**
 * Array of all Dominion unit definitions.
 * @deprecated Use DefinitionRegistry.getAllUnits() instead
 */
export const DOMINION_UNITS: UnitDefinition[] = new Proxy([] as UnitDefinition[], {
  get(target, prop) {
    if (prop === 'length') {
      if (!DefinitionRegistry.isInitialized()) return 0;
      return Object.keys(DefinitionRegistry.getAllUnits()).length;
    }
    if (typeof prop === 'string' && !isNaN(Number(prop))) {
      if (!DefinitionRegistry.isInitialized()) return undefined;
      const units = Object.values(DefinitionRegistry.getAllUnits());
      return units[Number(prop)];
    }
    if (prop === Symbol.iterator) {
      return function* () {
        if (!DefinitionRegistry.isInitialized()) return;
        yield* Object.values(DefinitionRegistry.getAllUnits());
      };
    }
    // Delegate array methods - bind to the real array so 'this' works correctly
    if (typeof prop === 'string' && typeof Array.prototype[prop as keyof typeof Array.prototype] === 'function') {
      const units = DefinitionRegistry.isInitialized()
        ? Object.values(DefinitionRegistry.getAllUnits())
        : [];
      const method = (units as unknown as Record<string, unknown>)[prop];
      if (typeof method === 'function') {
        return method.bind(units);
      }
      return method;
    }
    return (target as unknown as Record<string | symbol, unknown>)[prop];
  },
  has(_target, prop) {
    // Support 'in' operator for numeric indices so array algorithms work
    if (typeof prop === 'string' && !isNaN(Number(prop))) {
      if (!DefinitionRegistry.isInitialized()) return false;
      const index = Number(prop);
      const length = Object.keys(DefinitionRegistry.getAllUnits()).length;
      return index >= 0 && index < length;
    }
    return prop in Array.prototype;
  },
});

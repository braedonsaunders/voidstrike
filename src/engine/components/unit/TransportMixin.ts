/**
 * Transport Mixin
 *
 * Provides transport/carrier functionality for units that can load other units.
 */

import type { Constructor, UnitDefinition } from './types';

/**
 * Interface for transport-related properties
 */
export interface TransportFields {
  isTransport: boolean;
  transportCapacity: number;
  loadedUnits: number[];
}

/**
 * Mixin that adds transport functionality to a unit
 */
export function TransportMixin<TBase extends Constructor>(Base: TBase) {
  return class WithTransport extends Base implements TransportFields {
    public isTransport: boolean = false;
    public transportCapacity: number = 0;
    public loadedUnits: number[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Load a unit into this transport
     * @returns true if unit was loaded successfully
     */
    public loadUnit(unitId: number): boolean {
      if (!this.isTransport) return false;
      if (this.loadedUnits.length >= this.transportCapacity) return false;
      if (this.loadedUnits.includes(unitId)) return false;

      this.loadedUnits.push(unitId);
      return true;
    }

    /**
     * Unload a specific unit from this transport
     * @returns true if unit was unloaded successfully
     */
    public unloadUnit(unitId: number): boolean {
      const index = this.loadedUnits.indexOf(unitId);
      if (index === -1) return false;

      this.loadedUnits.splice(index, 1);
      return true;
    }

    /**
     * Unload all units from this transport
     * @returns array of unloaded unit IDs
     */
    public unloadAll(): number[] {
      const units = [...this.loadedUnits];
      this.loadedUnits = [];
      return units;
    }

    /**
     * Get remaining transport capacity
     */
    public getRemainingCapacity(): number {
      return this.transportCapacity - this.loadedUnits.length;
    }

    /**
     * Initialize transport fields from definition (called by composed class)
     */
    protected initializeTransportFields(definition: UnitDefinition): void {
      this.isTransport = definition.isTransport ?? false;
      this.transportCapacity = definition.transportCapacity ?? 0;
      this.loadedUnits = [];
    }
  };
}

/**
 * Cloak Mixin
 *
 * Provides cloaking and detection functionality for units.
 */

import type { Constructor, UnitDefinition } from './types';

/**
 * Interface for cloak-related properties
 */
export interface CloakFields {
  canCloak: boolean;
  isCloaked: boolean;
  cloakEnergyCost: number;
  isDetector: boolean;
  detectionRange: number;
}

/**
 * Mixin that adds cloak/detection functionality to a unit
 */
export function CloakMixin<TBase extends Constructor>(Base: TBase) {
  return class WithCloak extends Base implements CloakFields {
    public canCloak: boolean = false;
    public isCloaked: boolean = false;
    public cloakEnergyCost: number = 1;
    public isDetector: boolean = false;
    public detectionRange: number = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Toggle cloak state
     * @returns true if cloak was toggled successfully
     */
    public toggleCloak(): boolean {
      if (!this.canCloak) return false;
      this.isCloaked = !this.isCloaked;
      return true;
    }

    /**
     * Set cloak state directly
     */
    public setCloak(cloaked: boolean): void {
      if (this.canCloak) {
        this.isCloaked = cloaked;
      }
    }

    /**
     * Initialize cloak fields from definition (called by composed class)
     */
    protected initializeCloakFields(definition: UnitDefinition): void {
      this.canCloak = definition.canCloak ?? false;
      this.isCloaked = false;
      this.cloakEnergyCost = definition.cloakEnergyCost ?? 1;
      this.isDetector = definition.isDetector ?? false;
      this.detectionRange = definition.detectionRange ?? 0;
    }
  };
}

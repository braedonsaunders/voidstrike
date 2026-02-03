/**
 * Submarine Mixin
 *
 * Provides submarine submerge/surface mechanics for naval units.
 */

import type { Constructor, UnitDefinition } from './types';

/**
 * Interface for submarine-related properties
 */
export interface SubmarineFields {
  isSubmarine: boolean;
  canSubmerge: boolean;
  isSubmerged: boolean;
  submergedSpeed: number;
}

/**
 * Interface for base class requirements (needs cloak and buff for full functionality)
 */
export interface SubmarineBase {
  speed: number;
  canCloak?: boolean;
  isCloaked?: boolean;
  getBuffEffect?(effectName: string): number;
  getEffectiveSpeed?(): number;
}

/**
 * Mixin that adds submarine functionality to a unit
 */
export function SubmarineMixin<TBase extends Constructor<SubmarineBase>>(Base: TBase) {
  return class WithSubmarine extends Base implements SubmarineFields {
    public isSubmarine: boolean = false;
    public canSubmerge: boolean = false;
    public isSubmerged: boolean = false;
    public submergedSpeed: number = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Toggle submerged state
     * @returns true if submerge was toggled successfully
     */
    public toggleSubmerge(): boolean {
      if (!this.canSubmerge) return false;
      this.isSubmerged = !this.isSubmerged;
      // Submerged subs are cloaked
      if (this.canCloak !== undefined) {
        this.isCloaked = this.isSubmerged;
      }
      return true;
    }

    /**
     * Set submerged state directly
     */
    public setSubmerged(submerged: boolean): void {
      if (this.canSubmerge) {
        this.isSubmerged = submerged;
        if (this.canCloak !== undefined) {
          this.isCloaked = submerged;
        }
      }
    }

    /**
     * Get effective speed for current domain (submerged vs surface)
     */
    public getEffectiveSpeedForDomain(): number {
      if (this.isSubmarine && this.isSubmerged) {
        const buffEffect = this.getBuffEffect ? this.getBuffEffect('moveSpeedBonus') : 0;
        return this.submergedSpeed * (1 + buffEffect);
      }
      return this.getEffectiveSpeed ? this.getEffectiveSpeed() : this.speed;
    }

    /**
     * Initialize submarine fields from definition (called by composed class)
     */
    protected initializeSubmarineFields(definition: UnitDefinition): void {
      this.isSubmarine = definition.isSubmarine ?? false;
      this.canSubmerge = definition.canSubmerge ?? this.isSubmarine;
      this.isSubmerged = false;
      this.submergedSpeed = definition.submergedSpeed ?? this.speed * 0.67;
    }
  };
}

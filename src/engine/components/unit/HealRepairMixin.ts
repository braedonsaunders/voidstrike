/**
 * Heal/Repair Mixin
 *
 * Provides healing and repair capabilities for support units.
 */

import type { Constructor, UnitDefinition, UnitState } from './types';

/**
 * Interface for heal/repair-related properties
 */
export interface HealRepairFields {
  canHeal: boolean;
  healRange: number;
  healRate: number;
  healEnergyCost: number;
  canRepair: boolean;
  isRepairing: boolean;
  repairTargetId: number | null;
  healTargetId: number | null;
  autocastRepair: boolean;
}

/**
 * Interface for base class requirements
 */
export interface HealRepairBase {
  state: UnitState;
  gatherTargetId?: number | null;
  isMining?: boolean;
}

/**
 * Mixin that adds heal/repair functionality to a unit
 */
export function HealRepairMixin<TBase extends Constructor<HealRepairBase>>(Base: TBase) {
  return class WithHealRepair extends Base implements HealRepairFields {
    public canHeal: boolean = false;
    public healRange: number = 0;
    public healRate: number = 0;
    public healEnergyCost: number = 0;
    public canRepair: boolean = false;
    public isRepairing: boolean = false;
    public repairTargetId: number | null = null;
    public healTargetId: number | null = null;
    public autocastRepair: boolean = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Set a heal target for this unit
     */
    public setHealTarget(targetId: number): void {
      if (!this.canHeal) return;
      this.healTargetId = targetId;
    }

    /**
     * Set a repair target for this unit
     */
    public setRepairTarget(targetId: number): void {
      if (!this.canRepair) return;
      // Clear any gathering state to prevent ResourceSystem interference
      if (this.state === 'gathering') {
        if (this.gatherTargetId !== undefined) {
          this.gatherTargetId = null;
        }
        if (this.isMining !== undefined) {
          this.isMining = false;
        }
      }
      this.repairTargetId = targetId;
      this.isRepairing = true;
      this.state = 'idle'; // Use idle state so movement works and ResourceSystem doesn't interfere
    }

    /**
     * Clear heal target
     */
    public clearHealTarget(): void {
      this.healTargetId = null;
    }

    /**
     * Clear repair target
     */
    public clearRepairTarget(): void {
      this.repairTargetId = null;
      this.isRepairing = false;
    }

    /**
     * Initialize heal/repair fields from definition (called by composed class)
     */
    protected initializeHealRepairFields(definition: UnitDefinition): void {
      this.canHeal = definition.canHeal ?? false;
      this.healRange = definition.healRange ?? 0;
      this.healRate = definition.healRate ?? 0;
      this.healEnergyCost = definition.healEnergyCost ?? 0;
      this.canRepair = definition.canRepair ?? false;
      this.isRepairing = false;
      this.repairTargetId = null;
      this.healTargetId = null;
      this.autocastRepair = false; // Off by default, player can toggle
    }
  };
}

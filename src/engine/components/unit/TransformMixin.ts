/**
 * Transform Mixin
 *
 * Provides transformation mechanics for units that can switch between forms.
 * Examples: siege tanks, flying/ground hybrids
 */

import type { Constructor, TransformMode, UnitDefinition, UnitState } from './types';

/**
 * Interface for transform-related properties
 */
export interface TransformFields {
  canTransform: boolean;
  transformModes: TransformMode[];
  currentMode: string;
  transformProgress: number;
  transformTargetMode: string | null;
}

/**
 * Interface for base class requirements.
 * Many properties come from earlier mixins and are accessed via the full
 * composed Unit type. Properties are optional to allow loose mixin chaining.
 */
export interface TransformBase {
  state: UnitState;
  speed?: number;
  maxSpeed?: number;
  currentSpeed?: number;
  attackRange?: number;
  attackDamage?: number;
  attackSpeed?: number;
  splashRadius?: number;
  sightRange?: number;
  isFlying?: boolean;
  canAttackGround?: boolean;
  canAttackAir?: boolean;
}

/**
 * Mixin that adds transformation functionality to a unit
 */
export function TransformMixin<TBase extends Constructor<TransformBase>>(Base: TBase) {
  return class WithTransform extends Base implements TransformFields {
    public canTransform: boolean = false;
    public transformModes: TransformMode[] = [];
    public currentMode: string = 'default';
    public transformProgress: number = 0;
    public transformTargetMode: string | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Start transforming to a new mode
     * @returns true if transformation started successfully
     */
    public startTransform(targetMode: string): boolean {
      if (!this.canTransform) return false;
      if (this.state === 'transforming') return false;

      const mode = this.transformModes.find((m) => m.id === targetMode);
      if (!mode) return false;
      if (this.currentMode === targetMode) return false;

      this.transformTargetMode = targetMode;
      this.transformProgress = 0;
      this.state = 'transforming';
      if (this.currentSpeed !== undefined) {
        this.currentSpeed = 0; // Stop moving during transform
      }
      return true;
    }

    /**
     * Update transform progress
     * @returns true when transformation completes
     */
    public updateTransform(deltaTime: number): boolean {
      if (this.state !== 'transforming' || !this.transformTargetMode) return false;

      const mode = this.transformModes.find((m) => m.id === this.transformTargetMode);
      if (!mode) {
        this.state = 'idle';
        this.transformTargetMode = null;
        return false;
      }

      this.transformProgress += deltaTime / mode.transformTime;

      if (this.transformProgress >= 1) {
        this.completeTransform();
        return true;
      }

      return false;
    }

    /**
     * Complete the transformation and apply new stats
     */
    public completeTransform(): void {
      if (!this.transformTargetMode) return;

      const mode = this.transformModes.find((m) => m.id === this.transformTargetMode);
      if (!mode) return;

      // Apply new mode stats (properties exist at runtime via mixin chain)
      this.currentMode = this.transformTargetMode;
      if (this.speed !== undefined) this.speed = mode.speed;
      if (this.maxSpeed !== undefined) this.maxSpeed = mode.speed;
      if (this.attackRange !== undefined) this.attackRange = mode.attackRange;
      if (this.attackDamage !== undefined) this.attackDamage = mode.attackDamage;
      if (this.attackSpeed !== undefined) this.attackSpeed = mode.attackSpeed;
      if (this.splashRadius !== undefined) this.splashRadius = mode.splashRadius ?? 0;
      if (this.sightRange !== undefined) this.sightRange = mode.sightRange;
      if (this.isFlying !== undefined) this.isFlying = mode.isFlying ?? false;

      // Apply targeting restrictions from mode (default: can attack ground if has damage)
      const hasDamage = mode.attackDamage > 0;
      if (this.canAttackGround !== undefined)
        this.canAttackGround = mode.canAttackGround ?? hasDamage;
      if (this.canAttackAir !== undefined) this.canAttackAir = mode.canAttackAir ?? false;

      // Reset transform state
      this.transformTargetMode = null;
      this.transformProgress = 0;
      this.state = 'idle';
    }

    /**
     * Get current mode info
     */
    public getCurrentMode(): TransformMode | undefined {
      return this.transformModes.find((m) => m.id === this.currentMode);
    }

    /**
     * Check if unit can move in current mode
     */
    public canMoveInCurrentMode(): boolean {
      if (!this.canTransform) return true;
      const mode = this.getCurrentMode();
      return mode?.canMove ?? true;
    }

    /**
     * Initialize transform fields from definition (called by composed class)
     */
    protected initializeTransformFields(definition: UnitDefinition): void {
      this.canTransform = definition.canTransform ?? false;
      this.transformModes = definition.transformModes ?? [];
      this.currentMode = definition.defaultMode ?? 'default';
      this.transformProgress = 0;
      this.transformTargetMode = null;
    }
  };
}

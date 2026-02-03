/**
 * Combat Mixin
 *
 * Provides combat targeting and attack capabilities for units.
 */

import type { Constructor, DamageType, UnitDefinition, UnitState } from './types';

/**
 * Interface for combat-related properties
 */
export interface CombatFields {
  attackRange: number;
  attackDamage: number;
  attackSpeed: number;
  damageType: DamageType;
  lastAttackTime: number;
  targetEntityId: number | null;
  splashRadius: number;
  projectileType: string;
  canAttackGround: boolean;
  canAttackAir: boolean;
  canAttackNaval: boolean;
  canAttackWhileMoving: boolean;
}

/**
 * Interface for base class requirements.
 * CommandQueue properties are optional since that mixin comes before this one
 * in the chain but TypeScript can't infer the full type.
 */
export interface CombatBase {
  state: UnitState;
  targetX: number | null;
  targetY: number | null;
  currentSpeed: number;
  isHoldingPosition: boolean;
  isNaval: boolean;
  // Path properties from UnitCore - needed for holdPosition to clear stale paths
  path: Array<{ x: number; y: number }>;
  pathIndex: number;
  // CommandQueue properties - accessed dynamically (optional for type safety)
  commandQueue?: unknown[];
  patrolPoints?: unknown[];
  assaultDestination?: { x: number; y: number } | null;
  isInAssaultMode?: boolean;
  assaultIdleTicks?: number;
}

/**
 * Mixin that adds combat functionality to a unit
 */
export function CombatMixin<TBase extends Constructor<CombatBase>>(Base: TBase) {
  return class WithCombat extends Base implements CombatFields {
    public attackRange: number = 0;
    public attackDamage: number = 0;
    public attackSpeed: number = 1;
    public damageType: DamageType = 'normal';
    public lastAttackTime: number = 0;
    public targetEntityId: number | null = null;
    public splashRadius: number = 0;
    public projectileType: string = 'bullet_rifle';
    public canAttackGround: boolean = true;
    public canAttackAir: boolean = false;
    public canAttackNaval: boolean = false;
    public canAttackWhileMoving: boolean = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Set attack target for this unit
     */
    public setAttackTarget(entityId: number): void {
      this.targetEntityId = entityId;
      this.state = 'attacking';
      this.targetX = null;
      this.targetY = null;
    }

    /**
     * Set attack target while continuing to move (for units with canAttackWhileMoving)
     */
    public setAttackTargetWhileMoving(entityId: number): void {
      this.targetEntityId = entityId;
      // Don't change state or clear move target - unit keeps moving
    }

    /**
     * Attack-move: move toward a position while engaging enemies along the way
     * RTS-style: Sets assault mode so unit stays aggressive even after arriving
     */
    public setAttackMoveTarget(x: number, y: number): void {
      this.targetX = x;
      this.targetY = y;
      this.state = 'attackmoving';
      this.targetEntityId = null;
      // RTS-style: Enable assault mode - unit will keep scanning for targets
      if (this.assaultDestination !== undefined) {
        this.assaultDestination = { x, y };
      }
      if (this.isInAssaultMode !== undefined) {
        this.isInAssaultMode = true;
      }
      if (this.assaultIdleTicks !== undefined) {
        this.assaultIdleTicks = 0;
      }
    }

    /**
     * Check if unit can attack based on cooldown
     */
    public canAttack(gameTime: number): boolean {
      const timeSinceLastAttack = gameTime - this.lastAttackTime;
      return timeSinceLastAttack >= 1 / this.attackSpeed;
    }

    /**
     * Check if this unit can attack a target based on air/ground/naval restrictions
     * @param targetIsFlying Whether the target is a flying unit
     * @param targetIsNaval Whether the target is a naval unit
     * @returns True if this unit can attack the target type
     */
    public canAttackTarget(targetIsFlying: boolean, targetIsNaval: boolean = false): boolean {
      if (targetIsFlying) {
        return this.canAttackAir;
      }
      if (targetIsNaval) {
        return this.canAttackNaval;
      }
      return this.canAttackGround;
    }

    /**
     * Hold position - stop and don't chase
     */
    public holdPosition(): void {
      this.targetX = null;
      this.targetY = null;
      this.targetEntityId = null;
      this.state = 'idle';
      this.currentSpeed = 0;
      // Clear path to prevent stale path from being followed after hold is released
      this.path = [];
      this.pathIndex = 0;
      if (this.commandQueue !== undefined) {
        (this as unknown as { commandQueue: unknown[] }).commandQueue = [];
      }
      if (this.patrolPoints !== undefined) {
        (this as unknown as { patrolPoints: unknown[] }).patrolPoints = [];
      }
      this.isHoldingPosition = true;
      // RTS-style: Hold position clears assault mode
      if (this.assaultDestination !== undefined) {
        this.assaultDestination = null;
      }
      if (this.isInAssaultMode !== undefined) {
        this.isInAssaultMode = false;
      }
      if (this.assaultIdleTicks !== undefined) {
        this.assaultIdleTicks = 0;
      }
    }

    /**
     * Initialize combat fields from definition (called by composed class)
     */
    protected initializeCombatFields(definition: UnitDefinition): void {
      this.attackRange = definition.attackRange;
      this.attackDamage = definition.attackDamage;
      this.attackSpeed = definition.attackSpeed;
      this.damageType = definition.damageType;
      this.lastAttackTime = 0;
      this.targetEntityId = null;
      this.splashRadius = definition.splashRadius ?? 0;
      this.projectileType = definition.projectileType ?? 'bullet_rifle';

      // Targeting restrictions - default: can attack ground if has damage, can't attack air by default
      const hasDamage = definition.attackDamage > 0;
      this.canAttackGround = definition.canAttackGround ?? hasDamage;
      this.canAttackAir = definition.canAttackAir ?? false;
      this.canAttackWhileMoving = definition.canAttackWhileMoving ?? false;
      // Naval targeting - naval units can attack naval by default
      this.canAttackNaval = definition.canAttackNaval ?? this.isNaval;
    }
  };
}

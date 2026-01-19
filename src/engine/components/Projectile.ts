import { Component } from '../ecs/Component';
import { DamageType } from './Unit';

/**
 * Projectile behavior types:
 * - homing: Tracks moving target, always hits (most units)
 * - ballistic: Arcs to target position, can miss if target moves (siege tanks, artillery)
 * - linear: Straight line to target position (lasers, some abilities)
 */
export type ProjectileBehavior = 'homing' | 'ballistic' | 'linear';

/**
 * Trail visual types for BattleEffectsRenderer
 */
export type ProjectileTrailType = 'bullet' | 'plasma' | 'missile' | 'shell' | 'laser' | 'none';

/**
 * Projectile definition - static data for projectile types
 * Referenced by units via projectileType field
 */
export interface ProjectileDefinition {
  id: string;
  behavior: ProjectileBehavior;
  speed: number;                    // Units per second
  turnRate: number;                 // Radians per tick for homing (Infinity = instant tracking)
  arcHeight: number;                // Peak height for ballistic projectiles (0 for others)
  trailType: ProjectileTrailType;
  scale: number;                    // Visual scale multiplier
}

/**
 * Projectile Component - ECS component for in-flight projectiles
 *
 * Projectiles are created by CombatSystem/AbilitySystem when units attack,
 * and processed by ProjectileSystem for movement and damage application on impact.
 *
 * DETERMINISM: All position and damage values use quantized fixed-point math.
 * Entity creation is deterministic because it happens in simulation update,
 * not in response to events. Both clients create projectiles at the same tick
 * in the same order, ensuring identical entity IDs.
 */
export class Projectile extends Component {
  public readonly type = 'Projectile';

  // Identity
  public projectileId: string;
  public sourceEntityId: number;
  public sourcePlayerId: string;
  public sourceFaction: string;

  // Behavior
  public behavior: ProjectileBehavior;

  // Targeting
  public targetEntityId: number | null;
  public targetX: number;
  public targetY: number;
  public targetZ: number;

  // Movement (values stored in game units, quantized on use)
  public speed: number;
  public turnRate: number;
  public arcHeight: number;
  public velocityX: number;
  public velocityY: number;
  public velocityZ: number;

  // Damage
  public damage: number;
  public damageType: DamageType;
  public splashRadius: number;
  public splashFalloff: number;

  // Lifecycle
  public spawnTick: number;
  public maxLifetimeTicks: number;
  public hasImpacted: boolean;

  // Visual (for renderer)
  public trailType: ProjectileTrailType;
  public visualScale: number;

  constructor(data: {
    projectileId: string;
    sourceEntityId: number;
    sourcePlayerId: string;
    sourceFaction: string;
    behavior: ProjectileBehavior;
    targetEntityId: number | null;
    targetX: number;
    targetY: number;
    targetZ: number;
    speed: number;
    turnRate: number;
    arcHeight: number;
    damage: number;
    damageType: DamageType;
    splashRadius: number;
    splashFalloff: number;
    spawnTick: number;
    maxLifetimeTicks: number;
    trailType: ProjectileTrailType;
    visualScale: number;
  }) {
    super();

    this.projectileId = data.projectileId;
    this.sourceEntityId = data.sourceEntityId;
    this.sourcePlayerId = data.sourcePlayerId;
    this.sourceFaction = data.sourceFaction;

    this.behavior = data.behavior;

    this.targetEntityId = data.targetEntityId;
    this.targetX = data.targetX;
    this.targetY = data.targetY;
    this.targetZ = data.targetZ;

    this.speed = data.speed;
    this.turnRate = data.turnRate;
    this.arcHeight = data.arcHeight;
    this.velocityX = 0;
    this.velocityY = 0;
    this.velocityZ = 0;

    this.damage = data.damage;
    this.damageType = data.damageType;
    this.splashRadius = data.splashRadius;
    this.splashFalloff = data.splashFalloff;

    this.spawnTick = data.spawnTick;
    this.maxLifetimeTicks = data.maxLifetimeTicks;
    this.hasImpacted = false;

    this.trailType = data.trailType;
    this.visualScale = data.visualScale;
  }

  /**
   * Clear source entity reference (called when source dies)
   * Projectile continues to target but kill credit is lost
   */
  public clearSource(): void {
    this.sourceEntityId = -1;
  }

  /**
   * Switch to position-only targeting (called when target dies)
   * Projectile continues to last known position
   */
  public clearTarget(): void {
    this.targetEntityId = null;
  }
}

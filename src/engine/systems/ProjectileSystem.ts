import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Health } from '../components/Health';
import { Unit, DamageType } from '../components/Unit';
import { Selectable } from '../components/Selectable';
import { Projectile, ProjectileDefinition, ProjectileBehavior } from '../components/Projectile';
import { quantize, QUANT_POSITION, QUANT_DAMAGE } from '@/utils/FixedPoint';
import { getDamageMultiplier } from '@/data/combat/combat';
import { debugCombat as debugProjectile } from '@/utils/debugLogger';

/**
 * ProjectileSystem - Handles projectile movement and damage application on impact
 *
 * EXECUTION ORDER:
 * Priority 21 runs AFTER CombatSystem (priority 20) which creates projectiles.
 * Projectiles move immediately on the same tick they're created.
 *
 * DETERMINISM:
 * - All movement uses tick-based calculations with quantized values
 * - Projectile entities are sorted by ID before processing
 * - Damage calculations use deterministicDamage() pattern
 * - No floating-point accumulation - positions are snapped each tick
 */
export class ProjectileSystem extends System {
  public readonly name = 'ProjectileSystem';
  public priority = 21; // Run after CombatSystem (20) creates projectiles

  // Tick rate for movement calculations
  private readonly TICK_DURATION = 0.05; // 50ms at 20 TPS
  private readonly IMPACT_RADIUS_SQ = 0.25; // 0.5^2 - distance threshold for impact
  private readonly MAX_PROJECTILES = 500; // Performance cap

  // Pre-allocated buffer for deterministic iteration
  private _projectileBuffer: Entity[] = [];

  // Track active projectile count for performance monitoring
  private activeProjectileCount = 0;

  constructor(game: Game) {
    super(game);
  }

  public update(_deltaTime: number): void {
    const currentTick = this.game.getCurrentTick();

    // Get all projectiles, sorted by ID for deterministic processing
    const projectiles = this.world.getEntitiesWith('Projectile', 'Transform');
    this._projectileBuffer.length = 0;
    for (const p of projectiles) {
      this._projectileBuffer.push(p);
    }
    this._projectileBuffer.sort((a, b) => a.id - b.id);

    this.activeProjectileCount = this._projectileBuffer.length;

    for (const entity of this._projectileBuffer) {
      const projectile = entity.get<Projectile>('Projectile')!;
      const transform = entity.get<Transform>('Transform')!;

      // Skip already impacted projectiles (cleanup next frame)
      if (projectile.hasImpacted) {
        this.destroyProjectile(entity.id);
        continue;
      }

      // Check lifetime expiration
      const age = currentTick - projectile.spawnTick;
      if (age >= projectile.maxLifetimeTicks) {
        this.handleExpiredProjectile(entity, projectile, transform, currentTick);
        continue;
      }

      // Update position based on behavior type
      switch (projectile.behavior) {
        case 'homing':
          this.updateHomingProjectile(entity, projectile, transform);
          break;
        case 'ballistic':
          this.updateBallisticProjectile(entity, projectile, transform, currentTick);
          break;
        case 'linear':
          this.updateLinearProjectile(projectile, transform);
          break;
      }

      // Check for impact with target
      this.checkImpact(entity, projectile, transform, currentTick);
    }
  }

  /**
   * Update homing projectile - tracks moving target
   */
  private updateHomingProjectile(
    _entity: Entity,
    projectile: Projectile,
    transform: Transform
  ): void {
    // Update target position if target entity still exists
    if (projectile.targetEntityId !== null) {
      const targetEntity = this.world.getEntity(projectile.targetEntityId);
      if (targetEntity) {
        const targetTransform = targetEntity.get<Transform>('Transform');
        const targetHealth = targetEntity.get<Health>('Health');

        if (targetTransform && targetHealth && !targetHealth.isDead()) {
          // Update target position
          projectile.targetX = targetTransform.x;
          projectile.targetY = targetTransform.y;
          projectile.targetZ = targetTransform.z;
        } else {
          // Target died - continue to last known position
          projectile.targetEntityId = null;
        }
      } else {
        projectile.targetEntityId = null;
      }
    }

    // Calculate direction to target
    const dx = projectile.targetX - transform.x;
    const dy = projectile.targetY - transform.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < 0.0001) return; // Already at target

    const distance = Math.sqrt(distSq);

    // Calculate movement for this tick
    const moveDistance = projectile.speed * this.TICK_DURATION;

    // If we'd overshoot, move directly to target
    if (moveDistance >= distance) {
      transform.x = quantize(projectile.targetX, QUANT_POSITION);
      transform.y = quantize(projectile.targetY, QUANT_POSITION);
    } else {
      // Normalize and move
      const dirX = dx / distance;
      const dirY = dy / distance;

      // Apply turn rate limiting for missiles (if turnRate < Infinity)
      // For now, all homing projectiles track instantly
      // TODO: Implement smooth turning for missiles with finite turnRate

      transform.x = quantize(transform.x + dirX * moveDistance, QUANT_POSITION);
      transform.y = quantize(transform.y + dirY * moveDistance, QUANT_POSITION);
    }

    // Update rotation to face movement direction
    transform.rotation = Math.atan2(dy, dx);
  }

  /**
   * Update ballistic projectile - follows parabolic arc to target position
   */
  private updateBallisticProjectile(
    _entity: Entity,
    projectile: Projectile,
    transform: Transform,
    currentTick: number
  ): void {
    const age = currentTick - projectile.spawnTick;
    const totalTicks = projectile.maxLifetimeTicks;
    const progress = (age + 1) / totalTicks; // Progress after this tick

    // Linear interpolation for X/Y (horizontal movement)
    // velocityX/Y were pre-calculated at spawn as distance/ticks
    transform.x = quantize(transform.x + projectile.velocityX, QUANT_POSITION);
    transform.y = quantize(transform.y + projectile.velocityY, QUANT_POSITION);

    // Parabolic arc for Z (height)
    // z = arcHeight * 4 * progress * (1 - progress)
    // Peaks at progress = 0.5 with value = arcHeight
    if (projectile.arcHeight > 0) {
      const arcZ = projectile.arcHeight * 4 * progress * (1 - progress);
      transform.z = quantize(arcZ, QUANT_POSITION);
    }

    // Rotation follows movement direction
    transform.rotation = Math.atan2(projectile.velocityY, projectile.velocityX);
  }

  /**
   * Update linear projectile - straight line movement
   */
  private updateLinearProjectile(projectile: Projectile, transform: Transform): void {
    // velocityX/Y/Z were pre-calculated at spawn
    transform.x = quantize(transform.x + projectile.velocityX, QUANT_POSITION);
    transform.y = quantize(transform.y + projectile.velocityY, QUANT_POSITION);
    transform.z = quantize(transform.z + projectile.velocityZ, QUANT_POSITION);
  }

  /**
   * Check if projectile has reached its target
   */
  private checkImpact(
    entity: Entity,
    projectile: Projectile,
    transform: Transform,
    currentTick: number
  ): void {
    const dx = projectile.targetX - transform.x;
    const dy = projectile.targetY - transform.y;
    const distSq = dx * dx + dy * dy;

    if (distSq <= this.IMPACT_RADIUS_SQ) {
      this.applyImpactDamage(entity, projectile, transform, currentTick);
    }
  }

  /**
   * Apply damage when projectile impacts
   */
  private applyImpactDamage(
    entity: Entity,
    projectile: Projectile,
    transform: Transform,
    _currentTick: number
  ): void {
    projectile.hasImpacted = true;

    const gameTime = this.game.getGameTime();

    // Apply damage to primary target
    if (projectile.targetEntityId !== null) {
      const targetEntity = this.world.getEntity(projectile.targetEntityId);
      if (targetEntity) {
        const targetHealth = targetEntity.get<Health>('Health');
        if (targetHealth && !targetHealth.isDead()) {
          // Calculate damage with armor type multiplier
          const multiplier = getDamageMultiplier(projectile.damageType, targetHealth.armorType);
          const finalDamage = Math.max(1, Math.floor(projectile.damage * multiplier));

          targetHealth.takeDamage(finalDamage, gameTime);

          debugProjectile.log(
            `Projectile ${entity.id} hit target ${projectile.targetEntityId} for ${finalDamage} damage`
          );

          // Check for kill and emit event
          if (targetHealth.isDead()) {
            this.emitKillEvent(projectile, targetEntity);
          }
        }
      }
    }

    // Apply splash damage at impact point
    if (projectile.splashRadius > 0) {
      this.applySplashDamage(projectile, transform, gameTime);
    }

    // Emit impact event for visual effects
    this.game.eventBus.emit('projectile:impact', {
      entityId: entity.id,
      position: { x: transform.x, y: transform.y, z: transform.z },
      damageType: projectile.damageType,
      splashRadius: projectile.splashRadius,
      faction: projectile.sourceFaction,
      projectileId: projectile.projectileId,
    });

    // Destroy the projectile entity
    this.destroyProjectile(entity.id);
  }

  /**
   * Apply splash damage to nearby units and buildings
   */
  private applySplashDamage(
    projectile: Projectile,
    impactTransform: Transform,
    gameTime: number
  ): void {
    // Query spatial grid for nearby units
    const nearbyUnitIds = this.world.unitGrid.queryRadius(
      impactTransform.x,
      impactTransform.y,
      projectile.splashRadius
    );

    for (const entityId of nearbyUnitIds) {
      // Skip primary target (already damaged)
      if (entityId === projectile.targetEntityId) continue;

      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');

      if (!transform || !health || !selectable) continue;
      if (health.isDead()) continue;

      // No friendly fire
      if (selectable.playerId === projectile.sourcePlayerId) continue;

      // Calculate distance-based falloff (quantized for determinism)
      const dx = transform.x - impactTransform.x;
      const dy = transform.y - impactTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Skip if outside splash radius (edge case from grid query)
      if (distance > projectile.splashRadius) continue;

      // Falloff: 100% at center, (1 - splashFalloff) at edge
      const normalizedDist = distance / projectile.splashRadius;
      const falloffFactor = 1 - normalizedDist * projectile.splashFalloff;

      // Calculate splash damage with armor multiplier
      const multiplier = getDamageMultiplier(projectile.damageType, health.armorType);
      const baseSplashDamage = Math.floor(projectile.damage * falloffFactor);
      const finalSplashDamage = Math.max(1, Math.floor(baseSplashDamage * multiplier));

      health.takeDamage(finalSplashDamage, gameTime);

      if (health.isDead()) {
        this.emitKillEvent(projectile, entity);
      }
    }

    // Also check buildings in splash radius
    const nearbyBuildingIds = this.world.buildingGrid.queryRadius(
      impactTransform.x,
      impactTransform.y,
      projectile.splashRadius
    );

    for (const entityId of nearbyBuildingIds) {
      if (entityId === projectile.targetEntityId) continue;

      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');

      if (!transform || !health || !selectable) continue;
      if (health.isDead()) continue;
      if (selectable.playerId === projectile.sourcePlayerId) continue;

      const dx = transform.x - impactTransform.x;
      const dy = transform.y - impactTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > projectile.splashRadius) continue;

      const normalizedDist = distance / projectile.splashRadius;
      const falloffFactor = 1 - normalizedDist * projectile.splashFalloff;

      const multiplier = getDamageMultiplier(projectile.damageType, health.armorType);
      const baseSplashDamage = Math.floor(projectile.damage * falloffFactor);
      const finalSplashDamage = Math.max(1, Math.floor(baseSplashDamage * multiplier));

      health.takeDamage(finalSplashDamage, gameTime);
    }
  }

  /**
   * Emit kill event for scoring and statistics
   */
  private emitKillEvent(projectile: Projectile, victim: Entity): void {
    const victimUnit = victim.get<Unit>('Unit');
    const victimSelectable = victim.get<Selectable>('Selectable');
    const victimTransform = victim.get<Transform>('Transform');

    this.game.eventBus.emit('unit:died', {
      entityId: victim.id,
      killerPlayerId: projectile.sourcePlayerId,
      killerEntityId: projectile.sourceEntityId,
      unitType: victimUnit?.unitId,
      playerId: victimSelectable?.playerId,
      position: victimTransform ? { x: victimTransform.x, y: victimTransform.y } : undefined,
    });
  }

  /**
   * Handle projectile that reached max lifetime
   */
  private handleExpiredProjectile(
    entity: Entity,
    projectile: Projectile,
    transform: Transform,
    currentTick: number
  ): void {
    // Ballistic projectiles apply damage at final position (they hit the ground)
    if (projectile.behavior === 'ballistic') {
      // Move to final target position
      transform.x = projectile.targetX;
      transform.y = projectile.targetY;
      transform.z = 0;

      this.applyImpactDamage(entity, projectile, transform, currentTick);
    } else {
      // Homing/linear projectiles that expired without hitting just disappear
      // This shouldn't normally happen for homing, but handles edge cases
      this.destroyProjectile(entity.id);
    }
  }

  /**
   * Destroy a projectile entity
   */
  private destroyProjectile(entityId: number): void {
    this.world.destroyEntity(entityId);
  }

  /**
   * Create a projectile entity - called by CombatSystem when units attack
   *
   * DETERMINISM: This must be called from within the simulation update loop,
   * not from event handlers, to ensure all clients create projectiles at the
   * same tick in the same order.
   */
  public spawnProjectile(data: {
    sourceEntityId: number;
    sourcePlayerId: string;
    sourceFaction: string;
    startX: number;
    startY: number;
    startZ: number;
    targetEntityId: number | null;
    targetX: number;
    targetY: number;
    targetZ: number;
    projectileType: ProjectileDefinition;
    damage: number;
    damageType: DamageType;
    splashRadius: number;
    splashFalloff?: number;
  }): Entity | null {
    // Performance cap
    if (this.activeProjectileCount >= this.MAX_PROJECTILES) {
      debugProjectile.warn('Projectile cap reached, skipping spawn');
      return null;
    }

    const currentTick = this.game.getCurrentTick();
    const def = data.projectileType;

    // Calculate distance and travel time
    const dx = data.targetX - data.startX;
    const dy = data.targetY - data.startY;
    const dz = data.targetZ - data.startZ;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Calculate how many ticks to reach target
    const speedPerTick = def.speed * this.TICK_DURATION;
    const travelTicks = Math.max(1, Math.ceil(distance / speedPerTick));

    // Pre-calculate velocity for linear/ballistic projectiles
    const velocityX = dx / travelTicks;
    const velocityY = dy / travelTicks;
    const velocityZ = dz / travelTicks;

    // Create projectile entity
    const entity = this.world.createEntity();

    const transform = new Transform(
      quantize(data.startX, QUANT_POSITION),
      quantize(data.startY, QUANT_POSITION),
      quantize(data.startZ, QUANT_POSITION)
    );
    transform.rotation = Math.atan2(dy, dx);
    entity.add(transform);

    const projectile = new Projectile({
      projectileId: def.id,
      sourceEntityId: data.sourceEntityId,
      sourcePlayerId: data.sourcePlayerId,
      sourceFaction: data.sourceFaction,
      behavior: def.behavior,
      targetEntityId: data.targetEntityId,
      targetX: quantize(data.targetX, QUANT_POSITION),
      targetY: quantize(data.targetY, QUANT_POSITION),
      targetZ: quantize(data.targetZ, QUANT_POSITION),
      speed: def.speed,
      turnRate: def.turnRate,
      arcHeight: def.arcHeight,
      damage: quantize(data.damage, QUANT_DAMAGE),
      damageType: data.damageType,
      splashRadius: data.splashRadius,
      splashFalloff: data.splashFalloff ?? 0.5,
      spawnTick: currentTick,
      maxLifetimeTicks: travelTicks + 10, // Buffer for edge cases
      trailType: def.trailType,
      visualScale: def.scale,
    });

    // Set pre-calculated velocity
    projectile.velocityX = velocityX;
    projectile.velocityY = velocityY;
    projectile.velocityZ = velocityZ;

    entity.add(projectile);

    // Emit spawn event for visual effects
    this.game.eventBus.emit('projectile:spawned', {
      entityId: entity.id,
      startPos: { x: data.startX, y: data.startY, z: data.startZ },
      targetPos: { x: data.targetX, y: data.targetY, z: data.targetZ },
      projectileType: def.id,
      faction: data.sourceFaction,
      trailType: def.trailType,
      visualScale: def.scale,
    });

    debugProjectile.log(
      `Spawned projectile ${entity.id} (${def.id}) from ${data.sourceEntityId} to ${data.targetEntityId ?? 'position'}`
    );

    return entity;
  }

  /**
   * Get debug statistics
   */
  public getDebugStats(): { activeProjectiles: number; maxProjectiles: number } {
    return {
      activeProjectiles: this.activeProjectileCount,
      maxProjectiles: this.MAX_PROJECTILES,
    };
  }
}

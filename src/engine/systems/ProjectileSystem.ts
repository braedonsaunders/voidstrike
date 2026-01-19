import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Health } from '../components/Health';
import { Unit, DamageType } from '../components/Unit';
import { Selectable } from '../components/Selectable';
import { Building } from '../components/Building';
import { Projectile, ProjectileDefinition, ProjectileBehavior } from '../components/Projectile';
import { quantize, QUANT_POSITION, QUANT_DAMAGE } from '@/utils/FixedPoint';
import { getDamageMultiplier } from '@/data/combat/combat';
import { debugCombat as debugProjectile } from '@/utils/debugLogger';
import { isLocalPlayer } from '@/store/gameSetupStore';
import { DEFAULT_AIRBORNE_HEIGHT } from '@/assets/AssetManager';

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

    // Debug: Log projectile count periodically (every 20 ticks = 1 second)
    if (this.activeProjectileCount > 0 && currentTick % 20 === 0) {
      debugProjectile.log(`ProjectileSystem: ${this.activeProjectileCount} active projectiles at tick ${currentTick}`);
    }

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
   * Update homing projectile - tracks moving target in 3D
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
        const targetUnit = targetEntity.get<Unit>('Unit');

        if (targetTransform && targetHealth && !targetHealth.isDead()) {
          // Update target position including Z for flying units
          projectile.targetX = targetTransform.x;
          projectile.targetY = targetTransform.y;
          // Add flying height offset if target is airborne
          const flyingOffset = targetUnit?.isFlying ? DEFAULT_AIRBORNE_HEIGHT : 0;
          projectile.targetZ = targetTransform.z + flyingOffset;
        } else {
          // Target died - continue to last known position
          projectile.targetEntityId = null;
        }
      } else {
        projectile.targetEntityId = null;
      }
    }

    // Calculate 3D direction to target
    const dx = projectile.targetX - transform.x;
    const dy = projectile.targetY - transform.y;
    const dz = projectile.targetZ - transform.z;

    // Use 3D distance for proper tracking
    const dist3DSq = dx * dx + dy * dy + dz * dz;
    if (dist3DSq < 0.0001) return; // Already at target

    const distance3D = Math.sqrt(dist3DSq);

    // Calculate movement for this tick
    const moveDistance = projectile.speed * this.TICK_DURATION;

    // If we'd overshoot, move directly to target
    if (moveDistance >= distance3D) {
      transform.x = quantize(projectile.targetX, QUANT_POSITION);
      transform.y = quantize(projectile.targetY, QUANT_POSITION);
      transform.z = quantize(projectile.targetZ, QUANT_POSITION);
    } else {
      // Normalize and move in 3D
      const dirX = dx / distance3D;
      const dirY = dy / distance3D;
      const dirZ = dz / distance3D;

      transform.x = quantize(transform.x + dirX * moveDistance, QUANT_POSITION);
      transform.y = quantize(transform.y + dirY * moveDistance, QUANT_POSITION);
      transform.z = quantize(transform.z + dirZ * moveDistance, QUANT_POSITION);
    }

    // Update rotation to face movement direction (XY plane)
    transform.rotation = Math.atan2(dy, dx);
  }

  /**
   * Update ballistic projectile - follows parabolic arc to target position
   *
   * The Z position is calculated as:
   * 1. Linear interpolation from startZ to targetZ based on progress
   * 2. PLUS a parabolic arc that peaks at arcHeight at progress=0.5
   *
   * This allows ballistic projectiles to properly hit air targets.
   */
  private updateBallisticProjectile(
    _entity: Entity,
    projectile: Projectile,
    transform: Transform,
    currentTick: number
  ): void {
    const age = currentTick - projectile.spawnTick;
    // Use maxLifetimeTicks - 10 to get actual travel ticks (we added 10 buffer at spawn)
    const travelTicks = projectile.maxLifetimeTicks - 10;
    const progress = Math.min(1, (age + 1) / Math.max(1, travelTicks)); // Progress after this tick, clamped

    // Linear interpolation for X/Y (horizontal movement)
    transform.x = quantize(transform.x + projectile.velocityX, QUANT_POSITION);
    transform.y = quantize(transform.y + projectile.velocityY, QUANT_POSITION);

    // Z = linear interpolation from startZ to targetZ, plus parabolic arc
    // Linear component: lerp(startZ, targetZ, progress)
    const baseZ = projectile.startZ + progress * (projectile.targetZ - projectile.startZ);

    // Arc component: peaks at arcHeight when progress = 0.5
    // arc = arcHeight * 4 * progress * (1 - progress)
    const arcZ = projectile.arcHeight * 4 * progress * (1 - progress);

    transform.z = quantize(baseZ + arcZ, QUANT_POSITION);

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
   * Check if projectile has reached its target (3D distance check)
   */
  private checkImpact(
    entity: Entity,
    projectile: Projectile,
    transform: Transform,
    currentTick: number
  ): void {
    const dx = projectile.targetX - transform.x;
    const dy = projectile.targetY - transform.y;
    const dz = projectile.targetZ - transform.z;

    // Use 3D distance for proper air unit handling
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq <= this.IMPACT_RADIUS_SQ) {
      this.applyImpactDamage(entity, projectile, transform, currentTick);
    }
  }

  /**
   * Apply damage when projectile impacts
   *
   * NOTE: Damage is pre-calculated by CombatSystem with multiplier and armor already applied.
   * We apply it directly here - do NOT recalculate multipliers or armor.
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
    // NOTE: projectile.damage already has multiplier applied from CombatSystem
    if (projectile.targetEntityId !== null) {
      const targetEntity = this.world.getEntity(projectile.targetEntityId);
      if (targetEntity) {
        const targetHealth = targetEntity.get<Health>('Health');
        const targetTransform = targetEntity.get<Transform>('Transform');
        const targetSelectable = targetEntity.get<Selectable>('Selectable');
        const targetUnit = targetEntity.get<Unit>('Unit');
        const targetBuilding = targetEntity.get<Building>('Building');

        if (targetHealth && !targetHealth.isDead()) {
          // Apply pre-calculated damage directly (no armor - already factored in)
          const finalDamage = Math.max(1, projectile.damage);

          // Use applyDamageRaw to bypass Health's armor reduction (already applied)
          targetHealth.applyDamageRaw(finalDamage, gameTime);

          const isKillingBlow = targetHealth.isDead();
          const targetIsFlying = targetUnit?.isFlying ?? false;
          const targetHeight = targetIsFlying ? DEFAULT_AIRBORNE_HEIGHT : 0;

          debugProjectile.log(
            `Projectile ${entity.id} hit target ${projectile.targetEntityId} for ${finalDamage} damage ` +
            `(health: ${targetHealth.current.toFixed(1)}/${targetHealth.max})${isKillingBlow ? ' [KILL]' : ''}`
          );

          // Emit damage:dealt for UI damage numbers
          if (targetTransform) {
            this.game.eventBus.emit('damage:dealt', {
              targetId: projectile.targetEntityId,
              damage: finalDamage,
              targetPos: { x: targetTransform.x, y: targetTransform.y },
              targetHeight,
              targetIsFlying,
              targetUnitType: targetUnit?.unitId ?? targetBuilding?.buildingId,
              targetPlayerId: targetSelectable?.playerId,
              isKillingBlow,
            });

            // Emit player:damage for local player overlay effects
            if (targetSelectable?.playerId && isLocalPlayer(targetSelectable.playerId)) {
              this.game.eventBus.emit('player:damage', {
                damage: finalDamage,
                position: { x: targetTransform.x, y: targetTransform.y },
              });
            }
          }

          // Check for kill and emit event
          if (isKillingBlow) {
            this.emitKillEvent(projectile, targetEntity);
          }
        }
      } else {
        debugProjectile.log(`Projectile ${entity.id} target ${projectile.targetEntityId} no longer exists`);
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
   *
   * NOTE: Uses rawDamage (base damage before multiplier/armor) to calculate
   * splash damage individually for each target based on their armor type.
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
      const unit = entity.get<Unit>('Unit');

      if (!transform || !health || !selectable) continue;
      if (health.isDead()) continue;

      // No friendly fire
      if (selectable.playerId === projectile.sourcePlayerId) continue;

      // Calculate distance-based falloff
      const dx = transform.x - impactTransform.x;
      const dy = transform.y - impactTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Skip if outside splash radius (edge case from grid query)
      if (distance > projectile.splashRadius) continue;

      // Falloff: 100% at center, (1 - splashFalloff) at edge
      const normalizedDist = distance / projectile.splashRadius;
      const falloffFactor = 1 - normalizedDist * projectile.splashFalloff;

      // Calculate splash damage using rawDamage with per-target multiplier
      // rawDamage is base damage before any multiplier/armor was applied
      const multiplier = getDamageMultiplier(projectile.damageType, health.armorType);
      const baseSplashDamage = Math.floor(projectile.rawDamage * falloffFactor);
      const damageWithMultiplier = Math.max(1, Math.floor(baseSplashDamage * multiplier));

      // takeDamage will apply this target's armor reduction
      health.takeDamage(damageWithMultiplier, gameTime);

      const isKillingBlow = health.isDead();
      const targetIsFlying = unit?.isFlying ?? false;
      const targetHeight = targetIsFlying ? DEFAULT_AIRBORNE_HEIGHT : 0;

      debugProjectile.log(
        `Splash hit entity ${entityId} for ${damageWithMultiplier} damage (falloff: ${falloffFactor.toFixed(2)})${isKillingBlow ? ' [KILL]' : ''}`
      );

      // Emit damage:dealt for UI damage numbers
      this.game.eventBus.emit('damage:dealt', {
        targetId: entityId,
        damage: damageWithMultiplier,
        targetPos: { x: transform.x, y: transform.y },
        targetHeight,
        targetIsFlying,
        targetUnitType: unit?.unitId,
        targetPlayerId: selectable.playerId,
        isKillingBlow,
      });

      // Emit player:damage for local player overlay effects
      if (selectable.playerId && isLocalPlayer(selectable.playerId)) {
        this.game.eventBus.emit('player:damage', {
          damage: damageWithMultiplier,
          position: { x: transform.x, y: transform.y },
        });
      }

      if (isKillingBlow) {
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
      const building = entity.get<Building>('Building');

      if (!transform || !health || !selectable) continue;
      if (health.isDead()) continue;
      if (selectable.playerId === projectile.sourcePlayerId) continue;

      const dx = transform.x - impactTransform.x;
      const dy = transform.y - impactTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > projectile.splashRadius) continue;

      const normalizedDist = distance / projectile.splashRadius;
      const falloffFactor = 1 - normalizedDist * projectile.splashFalloff;

      // Calculate splash damage using rawDamage with per-target multiplier
      const multiplier = getDamageMultiplier(projectile.damageType, health.armorType);
      const baseSplashDamage = Math.floor(projectile.rawDamage * falloffFactor);
      const damageWithMultiplier = Math.max(1, Math.floor(baseSplashDamage * multiplier));

      // takeDamage will apply building's armor reduction
      health.takeDamage(damageWithMultiplier, gameTime);

      const isKillingBlow = health.isDead();

      // Emit damage:dealt for UI damage numbers
      this.game.eventBus.emit('damage:dealt', {
        targetId: entityId,
        damage: damageWithMultiplier,
        targetPos: { x: transform.x, y: transform.y },
        targetHeight: 0,
        targetIsFlying: false,
        targetUnitType: building?.buildingId,
        targetPlayerId: selectable.playerId,
        isKillingBlow,
      });

      // Emit player:damage for local player overlay effects
      if (selectable.playerId && isLocalPlayer(selectable.playerId)) {
        this.game.eventBus.emit('player:damage', {
          damage: damageWithMultiplier,
          position: { x: transform.x, y: transform.y },
        });
      }

      if (isKillingBlow) {
        this.emitKillEvent(projectile, entity);
      }
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
    // Ballistic projectiles apply damage at final position
    if (projectile.behavior === 'ballistic') {
      // Move to final target position (including targetZ for air units)
      transform.x = projectile.targetX;
      transform.y = projectile.targetY;
      transform.z = projectile.targetZ;

      this.applyImpactDamage(entity, projectile, transform, currentTick);
    } else {
      // Homing/linear projectiles that expired without hitting just disappear
      // This shouldn't normally happen for homing, but handles edge cases
      debugProjectile.log(`Projectile ${entity.id} expired without impact (behavior: ${projectile.behavior})`);
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
    rawDamage: number; // Base damage before multiplier/armor (for splash calculations)
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

    // Calculate 3D distance and travel time
    const dx = data.targetX - data.startX;
    const dy = data.targetY - data.startY;
    const dz = data.targetZ - data.startZ;
    // Use 3D distance for proper air unit timing
    const distance3D = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Calculate how many ticks to reach target
    const speedPerTick = def.speed * this.TICK_DURATION;
    const travelTicks = Math.max(1, Math.ceil(distance3D / speedPerTick));

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
      startZ: quantize(data.startZ, QUANT_POSITION),
      speed: def.speed,
      turnRate: def.turnRate,
      arcHeight: def.arcHeight,
      damage: quantize(data.damage, QUANT_DAMAGE),
      rawDamage: quantize(data.rawDamage, QUANT_DAMAGE),
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

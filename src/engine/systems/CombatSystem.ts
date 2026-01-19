import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit, DamageType } from '../components/Unit';
import { Health, ArmorType } from '../components/Health';
import { Game } from '../core/Game';
import { Selectable } from '../components/Selectable';
import { Building } from '../components/Building';
import { Resource } from '../components/Resource';
import { isLocalPlayer } from '@/store/gameSetupStore';
import { debugCombat } from '@/utils/debugLogger';
import { deterministicDamage, quantize, QUANT_DAMAGE } from '@/utils/FixedPoint';
import { getDamageMultiplier, COMBAT_CONFIG } from '@/data/combat/combat';
import { getDefaultTargetPriority } from '@/data/units/categories';
import AssetManager from '@/assets/AssetManager';
import { getProjectileType, DEFAULT_PROJECTILE, isInstantProjectile } from '@/data/projectiles';
import { DEFAULT_AIRBORNE_HEIGHT } from '@/assets/AssetManager';

// PERF: Reusable event payload objects to avoid allocation per attack
const attackEventPayload = {
  attackerId: '', // Unit type ID (e.g., "trooper", "valkyrie") - for airborne height lookup
  attackerEntityId: 0 as number, // Entity ID - for focus fire tracking
  attackerPos: { x: 0, y: 0 },
  targetId: 0 as number, // Target entity ID - for focus fire tracking
  targetPos: { x: 0, y: 0 },
  targetUnitType: '' as string | undefined, // Target unit type ID for airborne height lookup
  damage: 0,
  damageType: 'normal' as import('../components/Unit').DamageType,
  targetHeight: 0,
  targetPlayerId: undefined as string | undefined,
  attackerIsFlying: false,
  targetIsFlying: false,
  attackerFaction: 'terran' as string,
};

const splashEventPayload = {
  position: { x: 0, y: 0 },
  damage: 0,
};

const missEventPayload = {
  attackerId: '',
  attackerPos: { x: 0, y: 0 },
  targetPos: { x: 0, y: 0 },
  reason: 'high_ground',
};

const playerDamagePayload = {
  damage: 0,
  position: { x: 0, y: 0 },
};

const underAttackPayload = {
  playerId: '',
  position: { x: 0, y: 0 },
  time: 0,
};

// Combat constants now loaded from data-driven config (@/data/combat/combat.ts)
// Target priorities now loaded from unit definitions or categories (@/data/units/categories.ts)

/**
 * Get target priority for a unit, checking unit component first, then category defaults.
 * Higher values = more likely to be targeted first.
 */
function getTargetPriority(unitId: string, unit?: Unit): number {
  // First check if unit has explicit priority set (from unit definition)
  // The Unit component doesn't store targetPriority directly, so we use category defaults
  // Fall back to category-based default priority from data config
  return getDefaultTargetPriority(unitId);
}

export class CombatSystem extends System {
  public readonly name = 'CombatSystem';
  public priority = 20;

  // Track last under attack alert time per player
  private lastUnderAttackAlert: Map<string, number> = new Map();

  // Target acquisition throttling - don't search every frame
  private lastTargetSearchTick: Map<number, number> = new Map();
  private readonly TARGET_SEARCH_INTERVAL = 3; // Search every 3 ticks (~150ms) for sight-range search
  private readonly IMMEDIATE_SEARCH_INTERVAL = 1; // Search every 1 tick (~50ms) for attack-range search

  // Cache current targets to avoid re-searching
  private cachedTargets: Map<number, { targetId: number; validUntilTick: number }> = new Map();
  private readonly TARGET_CACHE_DURATION = 10; // Cache valid for 10 ticks (~0.5 sec)

  // Separate throttle tracking for immediate attack-range checks
  private lastImmediateSearchTick: Map<number, number> = new Map();

  // PERF: Combat zone tracking - units with enemies nearby
  // Units NOT in this set can skip target acquisition entirely when idle
  private combatAwareUnits: Set<number> = new Set();
  private combatZoneCheckTick: Map<number, number> = new Map();
  private readonly COMBAT_ZONE_CHECK_INTERVAL = 15; // Re-check zone every 15 ticks (~750ms)

  // PERF: Track player unit counts per grid cell for fast enemy detection
  private lastEnemyCheckResult: Map<number, boolean> = new Map();

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:attack', this.handleAttackCommand.bind(this));
    this.game.eventBus.on('command:stop', this.handleStopCommand.bind(this));
    this.game.eventBus.on('command:hold', this.handleHoldCommand.bind(this));

    // Clean up target caches when units are destroyed to prevent memory leaks
    this.game.eventBus.on('unit:died', this.handleUnitDeath.bind(this));
    this.game.eventBus.on('unit:destroyed', this.handleUnitDeath.bind(this));
  }

  /**
   * Clean up target caches when a unit dies to prevent memory leaks
   */
  private handleUnitDeath(data: { entityId: number }): void {
    this.cachedTargets.delete(data.entityId);
    this.lastTargetSearchTick.delete(data.entityId);
    this.lastImmediateSearchTick.delete(data.entityId);
    // PERF: Clean up combat zone tracking
    this.combatAwareUnits.delete(data.entityId);
    this.combatZoneCheckTick.delete(data.entityId);
    this.lastEnemyCheckResult.delete(data.entityId);
  }

  private handleAttackCommand(command: {
    entityIds: number[];
    targetEntityId?: number;
    targetPosition?: { x: number; y: number };
    queue?: boolean;
  }): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      if (command.queue) {
        // Queue the attack command
        if (command.targetEntityId !== undefined) {
          unit.queueCommand({
            type: 'attack',
            targetEntityId: command.targetEntityId,
          });
        } else if (command.targetPosition) {
          unit.queueCommand({
            type: 'attackmove',
            targetX: command.targetPosition.x,
            targetY: command.targetPosition.y,
          });
        }
      } else {
        // If worker is currently constructing, release them from construction (SC2-style)
        if (unit.state === 'building' && unit.constructingBuildingId !== null) {
          unit.cancelBuilding();
        }

        const transform = entity.get<Transform>('Transform');

        if (command.targetEntityId !== undefined) {
          unit.setAttackTarget(command.targetEntityId);
          // Set initial rotation to face target entity
          // Note: Y is negated for Three.js coordinate system
          if (transform) {
            const targetEntity = this.world.getEntity(command.targetEntityId);
            if (targetEntity) {
              const targetTransform = targetEntity.get<Transform>('Transform');
              if (targetTransform) {
                transform.rotation = Math.atan2(
                  -(targetTransform.y - transform.y),
                  targetTransform.x - transform.x
                );
              }
            }
          }
        } else if (command.targetPosition) {
          // Attack-move: move toward position while engaging enemies
          unit.setAttackMoveTarget(command.targetPosition.x, command.targetPosition.y);
          // Set initial rotation to face target direction
          // Note: Y is negated for Three.js coordinate system
          if (transform) {
            transform.rotation = Math.atan2(
              -(command.targetPosition.y - transform.y),
              command.targetPosition.x - transform.x
            );
          }
        }
      }
    }
  }

  private handleStopCommand(command: { entityIds: number[] }): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (unit) {
        unit.stop();
      }
    }
  }

  private handleHoldCommand(command: { entityIds: number[] }): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (unit) {
        unit.holdPosition();
      }
    }
  }

  public update(deltaTime: number): void {
    const gameTime = this.game.getGameTime();
    const currentTick = this.game.getCurrentTick();
    const attackers = this.world.getEntitiesWith('Transform', 'Unit', 'Health');

    for (const attacker of attackers) {
      const transform = attacker.get<Transform>('Transform');
      const unit = attacker.get<Unit>('Unit');
      const health = attacker.get<Health>('Health');
      if (!transform || !unit || !health) continue;

      // Skip dead units
      if (health.isDead()) {
        if (unit.state !== 'dead') {
          unit.state = 'dead';
          const selectable = attacker.get<Selectable>('Selectable');
          this.game.eventBus.emit('unit:died', {
            entityId: attacker.id,
            position: { x: transform.x, y: transform.y },
            isPlayerUnit: selectable?.playerId ? isLocalPlayer(selectable.playerId) : false,
            isFlying: unit.isFlying,
            playerId: selectable?.playerId,
            unitType: unit.unitId, // For airborne height lookup in effects
          });
        }
        continue;
      }

      // Auto-acquire targets for units that need them
      // Includes: idle, patrolling, attackmoving, holding, or 'attacking' with invalid target
      const needsTarget = unit.targetEntityId === null && (
        unit.state === 'idle' ||
        unit.state === 'patrolling' ||
        unit.state === 'attackmoving' ||
        unit.state === 'attacking' ||  // Edge case: attacking but lost target
        unit.isHoldingPosition
      );

      if (needsTarget) {
        // PERF: Skip target acquisition entirely for idle units not in combat zones
        // This avoids expensive spatial queries for units far from any enemies
        if (unit.state === 'idle' && !unit.isHoldingPosition) {
          const inCombatZone = this.checkCombatZone(attacker.id, transform, unit, currentTick);
          if (!inCombatZone) {
            // Not in combat zone - skip all target acquisition this tick
            continue;
          }
        }

        let target: number | null = null;

        // For idle units, do a fast check for enemies within ATTACK range
        // Uses light throttle (1 tick = ~50ms) for performance while staying responsive
        if (unit.state === 'idle' || unit.isHoldingPosition) {
          target = this.findImmediateAttackTarget(attacker.id, transform, unit, currentTick);
        }

        // If no immediate target found, use throttled search within sight range
        if (target === null && !unit.isHoldingPosition) {
          target = this.getTargetThrottled(attacker.id, transform, unit, currentTick);
        }

        if (target && !unit.isHoldingPosition) {
          // For attackmoving units, save the destination before switching to attacking
          const savedTargetX = unit.targetX;
          const savedTargetY = unit.targetY;
          const wasAttackMoving = unit.state === 'attackmoving';

          unit.setAttackTarget(target);

          // Restore attack-move destination so unit resumes after killing target
          if (wasAttackMoving && savedTargetX !== null && savedTargetY !== null) {
            unit.targetX = savedTargetX;
            unit.targetY = savedTargetY;
          }
        } else if (target && unit.isHoldingPosition) {
          // Holding position units only attack if in range (already confirmed by findImmediateAttackTarget)
          unit.setAttackTarget(target);
        }
      }

      // Process attacks
      if (unit.state === 'attacking' && unit.targetEntityId !== null) {
        const targetEntity = this.world.getEntity(unit.targetEntityId);

        if (!targetEntity || targetEntity.isDestroyed()) {
          // Target no longer exists - check if we were attack-moving
          if (unit.targetX !== null && unit.targetY !== null) {
            // Resume attack-move to destination
            unit.state = 'attackmoving';
            unit.targetEntityId = null;
          } else if (!unit.executeNextCommand()) {
            unit.clearTarget();
          }
          continue;
        }

        const targetTransform = targetEntity.get<Transform>('Transform');
        const targetHealth = targetEntity.get<Health>('Health');
        const targetUnit = targetEntity.get<Unit>('Unit');
        const targetBuilding = targetEntity.get<Building>('Building');

        if (!targetTransform || !targetHealth || targetHealth.isDead()) {
          // Target dead - check if we were attack-moving
          if (unit.targetX !== null && unit.targetY !== null) {
            // Resume attack-move to destination
            unit.state = 'attackmoving';
            unit.targetEntityId = null;
          } else if (!unit.executeNextCommand()) {
            unit.clearTarget();
          }
          continue;
        }

        // Check if attacker can target this entity based on air/ground status
        // Buildings are always ground targets, units check isFlying
        const targetIsFlying = targetUnit?.isFlying ?? false;
        const canAttackThisTarget = targetBuilding
          ? unit.canAttackGround  // Buildings are ground targets
          : unit.canAttackTarget(targetIsFlying);  // Units check air/ground

        if (!canAttackThisTarget) {
          // Cannot attack this target type - clear and find new target
          if (unit.targetX !== null && unit.targetY !== null) {
            unit.state = 'attackmoving';
            unit.targetEntityId = null;
          } else if (!unit.executeNextCommand()) {
            unit.clearTarget();
          }
          continue;
        }

        // Calculate effective distance (edge-to-edge, like SC2)
        // Uses visual radius (model scale) not just collision radius
        let effectiveDistance: number;
        const attackerRadius = AssetManager.getCachedVisualRadius(unit.unitId, unit.collisionRadius);

        if (targetBuilding) {
          // Distance to building edge, minus attacker's visual radius
          const halfW = targetBuilding.width / 2;
          const halfH = targetBuilding.height / 2;
          const clampedX = Math.max(targetTransform.x - halfW, Math.min(transform.x, targetTransform.x + halfW));
          const clampedY = Math.max(targetTransform.y - halfH, Math.min(transform.y, targetTransform.y + halfH));
          const edgeDx = transform.x - clampedX;
          const edgeDy = transform.y - clampedY;
          effectiveDistance = Math.max(0, Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy) - attackerRadius);
        } else {
          // Distance between unit edges (center-to-center minus both visual radii)
          const centerDistance = transform.distanceTo(targetTransform);
          const targetRadius = targetUnit ? AssetManager.getCachedVisualRadius(targetUnit.unitId, targetUnit.collisionRadius) : 0.5;
          effectiveDistance = Math.max(0, centerDistance - attackerRadius - targetRadius);
        }

        if (effectiveDistance <= unit.attackRange) {
          // In range - attempt attack
          if (unit.canAttack(gameTime)) {
            this.performAttack(attacker.id, unit, transform, targetEntity.id, targetHealth, targetTransform, gameTime);
          }
        }
        // If not in range, MovementSystem will handle moving toward target
      }
    }

    // Check for building deaths - CRITICAL: Must destroy buildings with 0 health
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Health', 'Selectable');
    for (const building of buildings) {
      const health = building.get<Health>('Health');
      const buildingComp = building.get<Building>('Building');
      const selectable = building.get<Selectable>('Selectable');
      const transform = building.get<Transform>('Transform');
      if (!health || !buildingComp || !selectable || !transform) continue;

      // Check multiple conditions for death to ensure we catch all cases
      // Building should be destroyed if: health <= 0, OR if health is very low (floating point safety)
      const shouldDestroy = health.isDead() || health.current <= 0.01;

      if (shouldDestroy && buildingComp.state !== 'destroyed') {
        // Force health to exactly 0 to prevent edge cases
        health.current = 0;
        buildingComp.state = 'destroyed';

        // PERF: If this is an extractor, restore the vespene geyser visibility
        // Uses O(1) reverse lookup via linkedResourceId instead of O(n) scan
        if (buildingComp.buildingId === 'extractor') {
          if (buildingComp.linkedResourceId !== null) {
            const resourceEntity = this.world.getEntity(buildingComp.linkedResourceId);
            if (resourceEntity) {
              const resource = resourceEntity.get<Resource>('Resource');
              if (resource) {
                resource.extractorEntityId = null;
                debugCombat.log(`CombatSystem: Extractor destroyed, vespene geyser ${buildingComp.linkedResourceId} restored`);
              }
            }
          }
        }

        debugCombat.log(`CombatSystem: Building ${buildingComp.buildingId} (${building.id}) destroyed at (${transform.x.toFixed(1)}, ${transform.y.toFixed(1)})`);

        this.game.eventBus.emit('building:destroyed', {
          entityId: building.id,
          playerId: selectable.playerId,
          buildingType: buildingComp.buildingId,
          position: { x: transform.x, y: transform.y },
          width: buildingComp.width,
          height: buildingComp.height,
        });

        // Schedule entity for destruction immediately
        this.world.destroyEntity(building.id);
      }
    }

    // Handle health regeneration
    // PERF: Only process entities that actually have regeneration > 0
    for (const entity of this.world.getEntitiesWith('Health')) {
      const health = entity.get<Health>('Health')!;
      // Skip entities with no regen or already at full health
      if (health.regeneration <= 0 && health.shieldRegeneration <= 0) continue;
      if (health.current >= health.max && health.shield >= health.maxShield) continue;
      health.regenerate(deltaTime / 1000, gameTime);
    }
  }

  /**
   * PERF: Check if unit is in a "combat zone" (has enemies within sight range)
   * Uses heavy throttling since this is just to skip processing for truly isolated units.
   * Returns cached result if available, only does actual check every COMBAT_ZONE_CHECK_INTERVAL ticks.
   */
  private checkCombatZone(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    currentTick: number
  ): boolean {
    // Check if we have a recent cached result
    const lastCheck = this.combatZoneCheckTick.get(selfId) || 0;
    if (currentTick - lastCheck < this.COMBAT_ZONE_CHECK_INTERVAL) {
      // Use cached result
      return this.combatAwareUnits.has(selfId);
    }

    // Time to do an actual check
    this.combatZoneCheckTick.set(selfId, currentTick);

    // Get self's player ID
    const selfEntity = this.world.getEntity(selfId);
    const selfSelectable = selfEntity?.get<Selectable>('Selectable');
    if (!selfSelectable) {
      this.combatAwareUnits.delete(selfId);
      return false;
    }

    // Quick scan for ANY enemy unit within sight range
    // We don't need the best target, just need to know if enemies exist nearby
    const nearbyUnitIds = this.world.unitGrid.queryRadius(
      selfTransform.x,
      selfTransform.y,
      selfUnit.sightRange
    );

    let hasEnemyNearby = false;

    for (const entityId of nearbyUnitIds) {
      if (entityId === selfId) continue;

      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');
      const targetUnit = entity.get<Unit>('Unit');

      if (!selectable || !health) continue;
      if (selectable.playerId === selfSelectable.playerId) continue;
      if (health.isDead()) continue;

      // Check if we can even attack this unit type
      const targetIsFlying = targetUnit?.isFlying ?? false;
      if (!selfUnit.canAttackTarget(targetIsFlying)) continue;

      // Found an enemy we could potentially attack
      hasEnemyNearby = true;
      break;
    }

    // Also check for enemy buildings if we can attack ground
    if (!hasEnemyNearby && selfUnit.canAttackGround) {
      const nearbyBuildingIds = this.world.buildingGrid.queryRadius(
        selfTransform.x,
        selfTransform.y,
        selfUnit.sightRange
      );

      for (const entityId of nearbyBuildingIds) {
        const entity = this.world.getEntity(entityId);
        if (!entity) continue;

        const selectable = entity.get<Selectable>('Selectable');
        const health = entity.get<Health>('Health');

        if (!selectable || !health) continue;
        if (selectable.playerId === selfSelectable.playerId) continue;
        if (health.isDead()) continue;

        // Found an enemy building
        hasEnemyNearby = true;
        break;
      }
    }

    // Update cached state
    if (hasEnemyNearby) {
      this.combatAwareUnits.add(selfId);
    } else {
      this.combatAwareUnits.delete(selfId);
    }

    return hasEnemyNearby;
  }

  /**
   * Fast attack target search for idle/holding units
   * Checks only within ATTACK range (not sight range) for responsive auto-attack
   * Uses light throttle (1 tick = ~50ms) for performance
   */
  private findImmediateAttackTarget(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    currentTick: number
  ): number | null {
    // Light throttle - check every tick (~50ms) instead of every frame
    const lastSearch = this.lastImmediateSearchTick.get(selfId) || 0;
    if (currentTick - lastSearch < this.IMMEDIATE_SEARCH_INTERVAL) {
      return null;
    }
    this.lastImmediateSearchTick.set(selfId, currentTick);

    // Get self's player ID
    const selfEntity = this.world.getEntity(selfId);
    const selfSelectable = selfEntity?.get<Selectable>('Selectable');
    if (!selfSelectable) return null;

    let bestTarget: { id: number; score: number } | null = null;

    // Use spatial grid to find nearby units within ATTACK range
    const nearbyUnitIds = this.world.unitGrid.queryRadius(
      selfTransform.x,
      selfTransform.y,
      selfUnit.attackRange
    );

    // Check nearby units
    for (const entityId of nearbyUnitIds) {
      if (entityId === selfId) continue;

      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');
      const unit = entity.get<Unit>('Unit');

      if (!transform || !health || !selectable) continue;
      if (selectable.playerId === selfSelectable.playerId) continue;
      if (health.isDead()) continue;

      // Check if attacker can target this unit based on air/ground status
      const targetIsFlying = unit?.isFlying ?? false;
      if (!selfUnit.canAttackTarget(targetIsFlying)) continue;

      // Edge-to-edge distance using visual radius (like SC2)
      const centerDistance = selfTransform.distanceTo(transform);
      const attackerRadius = AssetManager.getCachedVisualRadius(selfUnit.unitId, selfUnit.collisionRadius);
      const targetRadius = unit ? AssetManager.getCachedVisualRadius(unit.unitId, unit.collisionRadius) : 0.5;
      const distance = Math.max(0, centerDistance - attackerRadius - targetRadius);
      if (distance > selfUnit.attackRange) continue;

      // Calculate target score based on priority and distance
      const unitId = unit?.unitId || 'default';
      const basePriority = getTargetPriority(unitId, unit);
      const distanceFactor = 1 - (distance / selfUnit.attackRange);
      const healthFactor = 1 - (health.current / health.max);
      const score = basePriority * 0.5 + distanceFactor * 30 + healthFactor * 20;

      if (!bestTarget || score > bestTarget.score) {
        bestTarget = { id: entityId, score };
      }
    }

    // Also check nearby buildings within attack range
    // Buildings are ground targets, so require canAttackGround
    if (selfUnit.canAttackGround) {
      const nearbyBuildingIds = this.world.buildingGrid.queryRadius(
        selfTransform.x,
        selfTransform.y,
        selfUnit.attackRange
      );

      for (const entityId of nearbyBuildingIds) {
        const entity = this.world.getEntity(entityId);
        if (!entity) continue;

        const transform = entity.get<Transform>('Transform');
        const health = entity.get<Health>('Health');
        const selectable = entity.get<Selectable>('Selectable');
        const building = entity.get<Building>('Building');

        if (!transform || !health || !selectable || !building) continue;
        if (selectable.playerId === selfSelectable.playerId) continue;
        if (health.isDead()) continue;

        // Distance to building edge, minus attacker's visual radius
        const halfW = building.width / 2;
        const halfH = building.height / 2;
        const clampedX = Math.max(transform.x - halfW, Math.min(selfTransform.x, transform.x + halfW));
        const clampedY = Math.max(transform.y - halfH, Math.min(selfTransform.y, transform.y + halfH));
        const edgeDx = selfTransform.x - clampedX;
        const edgeDy = selfTransform.y - clampedY;
        const attackerRadius = AssetManager.getCachedVisualRadius(selfUnit.unitId, selfUnit.collisionRadius);
        const distance = Math.max(0, Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy) - attackerRadius);

        if (distance > selfUnit.attackRange) continue;

        // Buildings have lower priority than combat units
        const basePriority = 30;
        const distanceFactor = 1 - (distance / selfUnit.attackRange);
        const healthFactor = 1 - (health.current / health.max);
        const score = basePriority * 0.5 + distanceFactor * 30 + healthFactor * 20;

        if (!bestTarget || score > bestTarget.score) {
          bestTarget = { id: entityId, score };
        }
      }
    }

    return bestTarget?.id || null;
  }

  /**
   * Throttled target acquisition - only searches for targets periodically
   * and caches results to reduce CPU usage
   */
  private getTargetThrottled(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    currentTick: number
  ): number | null {
    // Check cache first
    const cached = this.cachedTargets.get(selfId);
    if (cached && cached.validUntilTick > currentTick) {
      // Verify cached target is still valid
      const targetEntity = this.world.getEntity(cached.targetId);
      if (targetEntity && !targetEntity.isDestroyed()) {
        const targetHealth = targetEntity.get<Health>('Health');
        if (targetHealth && !targetHealth.isDead()) {
          return cached.targetId;
        }
      }
      // Cached target invalid, remove it and allow immediate re-search
      this.cachedTargets.delete(selfId);
      this.lastTargetSearchTick.delete(selfId); // Allow immediate re-targeting
    }

    // Check if enough time has passed since last search
    const lastSearch = this.lastTargetSearchTick.get(selfId) || 0;
    if (currentTick - lastSearch < this.TARGET_SEARCH_INTERVAL) {
      return null; // Not time to search yet
    }

    // Perform the search
    this.lastTargetSearchTick.set(selfId, currentTick);
    const target = this.findBestTargetSpatial(selfId, selfTransform, selfUnit);

    // Cache the result
    if (target !== null) {
      this.cachedTargets.set(selfId, {
        targetId: target,
        validUntilTick: currentTick + this.TARGET_CACHE_DURATION,
      });
    }

    return target;
  }

  /**
   * Find the best target using spatial grid for O(nearby) instead of O(all entities)
   * Prioritizes high-threat units over workers
   */
  private findBestTargetSpatial(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit
  ): number | null {
    // Get self's player ID
    const selfEntity = this.world.getEntity(selfId);
    const selfSelectable = selfEntity?.get<Selectable>('Selectable');
    if (!selfSelectable) return null;

    let bestTarget: { id: number; score: number } | null = null;

    // Use spatial grid to find nearby units - much faster than checking all entities
    const nearbyUnitIds = this.world.unitGrid.queryRadius(
      selfTransform.x,
      selfTransform.y,
      selfUnit.sightRange
    );

    // Check nearby units
    for (const entityId of nearbyUnitIds) {
      if (entityId === selfId) continue;

      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');
      const unit = entity.get<Unit>('Unit');

      if (!transform || !health || !selectable) continue;
      if (selectable.playerId === selfSelectable.playerId) continue;
      if (health.isDead()) continue;

      // Check if attacker can target this unit based on air/ground status
      const targetIsFlying = unit?.isFlying ?? false;
      if (!selfUnit.canAttackTarget(targetIsFlying)) continue;

      // Edge-to-edge distance using visual radius (like SC2)
      const centerDistance = selfTransform.distanceTo(transform);
      const attackerRadius = AssetManager.getCachedVisualRadius(selfUnit.unitId, selfUnit.collisionRadius);
      const targetRadius = unit ? AssetManager.getCachedVisualRadius(unit.unitId, unit.collisionRadius) : 0.5;
      const distance = Math.max(0, centerDistance - attackerRadius - targetRadius);
      if (distance > selfUnit.sightRange) continue;

      // Calculate target score based on priority and distance
      const unitId = unit?.unitId || 'default';
      const basePriority = getTargetPriority(unitId, unit);
      const distanceFactor = 1 - (distance / selfUnit.sightRange);
      const healthFactor = 1 - (health.current / health.max);
      const score = basePriority * 0.5 + distanceFactor * 30 + healthFactor * 20;

      if (!bestTarget || score > bestTarget.score) {
        bestTarget = { id: entityId, score };
      }
    }

    // Also check nearby buildings using building grid
    // Buildings are ground targets, so require canAttackGround
    if (selfUnit.canAttackGround) {
      const nearbyBuildingIds = this.world.buildingGrid.queryRadius(
        selfTransform.x,
        selfTransform.y,
        selfUnit.sightRange
      );

      for (const entityId of nearbyBuildingIds) {
        const entity = this.world.getEntity(entityId);
        if (!entity) continue;

        const transform = entity.get<Transform>('Transform');
        const health = entity.get<Health>('Health');
        const selectable = entity.get<Selectable>('Selectable');
        const building = entity.get<Building>('Building');

        if (!transform || !health || !selectable || !building) continue;
        if (selectable.playerId === selfSelectable.playerId) continue;
        if (health.isDead()) continue;

        // Distance to building edge, minus attacker's visual radius
        const halfW = building.width / 2;
        const halfH = building.height / 2;
        const clampedX = Math.max(transform.x - halfW, Math.min(selfTransform.x, transform.x + halfW));
        const clampedY = Math.max(transform.y - halfH, Math.min(selfTransform.y, transform.y + halfH));
        const edgeDx = selfTransform.x - clampedX;
        const edgeDy = selfTransform.y - clampedY;
        const attackerRadius = AssetManager.getCachedVisualRadius(selfUnit.unitId, selfUnit.collisionRadius);
        const distance = Math.max(0, Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy) - attackerRadius);

        if (distance > selfUnit.sightRange) continue;

        // Buildings have lower priority than combat units
        const basePriority = 30;
        const distanceFactor = 1 - (distance / selfUnit.sightRange);
        const healthFactor = 1 - (health.current / health.max);
        const score = basePriority * 0.5 + distanceFactor * 30 + healthFactor * 20;

        if (!bestTarget || score > bestTarget.score) {
          bestTarget = { id: entityId, score };
        }
      }
    }

    return bestTarget?.id || null;
  }

  private performAttack(
    attackerId: number,
    attacker: Unit,
    attackerTransform: Transform,
    targetId: number,
    targetHealth: Health,
    targetTransform: Transform,
    gameTime: number
  ): void {
    attacker.lastAttackTime = gameTime;

    // High ground miss chance check (using data-driven config)
    const heightDifference = targetTransform.z - attackerTransform.z;
    if (heightDifference > COMBAT_CONFIG.highGroundThreshold) {
      // DETERMINISM: Use integer-based hash for miss chance instead of floating-point Math.sin
      // This ensures identical results across all platforms/browsers
      const tick = this.game.getCurrentTick();
      const seed = ((tick * 1103515245 + attackerId * 12345) >>> 0) % 1000;
      const missThreshold = Math.floor(COMBAT_CONFIG.highGroundMissChance * 1000);
      if (seed < missThreshold) {
        // Attack missed - PERF: Use pooled payload object
        missEventPayload.attackerId = attacker.unitId;
        missEventPayload.attackerPos.x = attackerTransform.x;
        missEventPayload.attackerPos.y = attackerTransform.y;
        missEventPayload.targetPos.x = targetTransform.x;
        missEventPayload.targetPos.y = targetTransform.y;
        this.game.eventBus.emit('combat:miss', missEventPayload);
        return;
      }
    }

    // Get projectile type for this unit
    const projectileTypeId = attacker.projectileType ?? 'bullet_rifle';
    const projectileType = getProjectileType(projectileTypeId) ?? DEFAULT_PROJECTILE;

    // DETERMINISM: Calculate damage using quantized fixed-point math
    // This ensures identical damage values across different platforms/browsers
    // Using data-driven damage multipliers from @/data/combat/combat.ts
    const multiplier = getDamageMultiplier(attacker.damageType, targetHealth.armorType);

    // Psionic damage ignores armor
    const armorReduction = attacker.damageType === 'psionic' ? 0 : targetHealth.armor;

    // Use deterministic damage calculation with quantization
    const finalDamage = deterministicDamage(
      attacker.attackDamage,
      multiplier,
      armorReduction
    );

    // Get target info for events and projectile
    const targetEntity = this.world.getEntity(targetId);
    const targetBuilding = targetEntity?.get<Building>('Building');
    const targetHeight = targetBuilding ? Math.max(targetBuilding.width, targetBuilding.height) : 0;
    const targetUnit = targetEntity?.get<Unit>('Unit');
    const targetIsFlying = targetUnit?.isFlying ?? false;
    const targetSelectable = targetEntity?.get<Selectable>('Selectable');

    // Get attacker info
    const attackerEntity = this.world.getEntity(attackerId);
    const attackerSelectable = attackerEntity?.get<Selectable>('Selectable');

    // Check if this is an instant weapon (melee, beam) or projectile-based
    if (isInstantProjectile(projectileTypeId)) {
      // INSTANT DAMAGE: Apply damage immediately (melee, beams, etc.)
      targetHealth.takeDamage(finalDamage, gameTime);

      // Emit attack event with full damage info
      attackEventPayload.attackerId = attacker.unitId;
      attackEventPayload.attackerEntityId = attackerId;
      attackEventPayload.attackerPos.x = attackerTransform.x;
      attackEventPayload.attackerPos.y = attackerTransform.y;
      attackEventPayload.targetId = targetId;
      attackEventPayload.targetPos.x = targetTransform.x;
      attackEventPayload.targetPos.y = targetTransform.y;
      attackEventPayload.targetUnitType = targetUnit?.unitId;
      attackEventPayload.damage = finalDamage;
      attackEventPayload.damageType = attacker.damageType;
      attackEventPayload.targetHeight = targetHeight;
      attackEventPayload.targetPlayerId = targetSelectable?.playerId;
      attackEventPayload.attackerIsFlying = attacker.isFlying;
      attackEventPayload.targetIsFlying = targetIsFlying;
      attackEventPayload.attackerFaction = attacker.faction || 'terran';
      this.game.eventBus.emit('combat:attack', attackEventPayload);

      // Emit damage:dealt for Phaser damage number system
      this.game.eventBus.emit('damage:dealt', {
        targetId,
        damage: finalDamage,
        targetPos: { x: targetTransform.x, y: targetTransform.y },
        targetHeight,
        targetIsFlying,
        targetUnitType: targetUnit?.unitId,
        targetPlayerId: targetSelectable?.playerId,
        isKillingBlow: targetHealth && targetHealth.current <= 0,
      });

      // Emit player:damage for Phaser overlay effects
      if (targetSelectable?.playerId && isLocalPlayer(targetSelectable.playerId)) {
        playerDamagePayload.damage = finalDamage;
        playerDamagePayload.position.x = targetTransform.x;
        playerDamagePayload.position.y = targetTransform.y;
        this.game.eventBus.emit('player:damage', playerDamagePayload);
      }

      // Apply splash damage immediately for instant weapons
      if (attacker.splashRadius > 0) {
        this.applySplashDamage(
          attackerId,
          attacker,
          attackerTransform,
          targetTransform,
          finalDamage,
          gameTime
        );
      }
    } else {
      // PROJECTILE-BASED: Spawn projectile entity, damage on impact
      const startZ = attacker.isFlying ? DEFAULT_AIRBORNE_HEIGHT : 0.5;
      const targetZ = targetIsFlying ? DEFAULT_AIRBORNE_HEIGHT : 0.5;

      const projectileEntity = this.game.projectileSystem.spawnProjectile({
        sourceEntityId: attackerId,
        sourcePlayerId: attackerSelectable?.playerId ?? '',
        sourceFaction: attacker.faction || 'terran',
        startX: attackerTransform.x,
        startY: attackerTransform.y,
        startZ: attackerTransform.z + startZ,
        targetEntityId: targetId,
        targetX: targetTransform.x,
        targetY: targetTransform.y,
        targetZ: targetTransform.z + targetZ,
        projectileType,
        damage: finalDamage,
        rawDamage: attacker.attackDamage, // Base damage for splash calculations
        damageType: attacker.damageType,
        splashRadius: attacker.splashRadius,
        splashFalloff: 0.5,
      });

      debugCombat.log(
        `CombatSystem: ${attacker.unitId} (${attackerId}) fired ${projectileTypeId} projectile ` +
        `(entity: ${projectileEntity?.id ?? 'null'}) at target ${targetId}, damage: ${finalDamage}`
      );

      // Emit attack event for muzzle flash/audio (no damage info - damage on impact)
      attackEventPayload.attackerId = attacker.unitId;
      attackEventPayload.attackerEntityId = attackerId;
      attackEventPayload.attackerPos.x = attackerTransform.x;
      attackEventPayload.attackerPos.y = attackerTransform.y;
      attackEventPayload.targetId = targetId;
      attackEventPayload.targetPos.x = targetTransform.x;
      attackEventPayload.targetPos.y = targetTransform.y;
      attackEventPayload.targetUnitType = targetUnit?.unitId;
      attackEventPayload.damage = 0; // Damage applied on projectile impact
      attackEventPayload.damageType = attacker.damageType;
      attackEventPayload.targetHeight = targetHeight;
      attackEventPayload.targetPlayerId = targetSelectable?.playerId;
      attackEventPayload.attackerIsFlying = attacker.isFlying;
      attackEventPayload.targetIsFlying = targetIsFlying;
      attackEventPayload.attackerFaction = attacker.faction || 'terran';
      this.game.eventBus.emit('combat:attack', attackEventPayload);
    }

    // Check for under attack alert
    this.checkUnderAttackAlert(targetId, targetTransform, gameTime);
  }

  /**
   * Apply splash damage to nearby enemies
   * OPTIMIZED: Uses spatial grid for O(nearby) instead of O(all entities)
   */
  private applySplashDamage(
    attackerId: number,
    attacker: Unit,
    attackerTransform: Transform,
    impactPos: Transform,
    baseDamage: number,
    gameTime: number
  ): void {
    // Get attacker's player ID
    const attackerEntity = this.world.getEntity(attackerId);
    const attackerSelectable = attackerEntity?.get<Selectable>('Selectable');
    if (!attackerSelectable) return;

    // Use spatial grid to find nearby units - much faster than checking all entities
    const nearbyUnitIds = this.world.unitGrid.queryRadius(
      impactPos.x,
      impactPos.y,
      attacker.splashRadius
    );

    // Check nearby units
    for (const entityId of nearbyUnitIds) {
      if (entityId === attackerId) continue;

      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');

      // Skip allies and dead units
      if (!transform || !health || !selectable) continue;
      if (selectable.playerId === attackerSelectable.playerId) continue;
      if (health.isDead()) continue;

      // Calculate distance from impact point
      const dx = transform.x - impactPos.x;
      const dy = transform.y - impactPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Apply splash damage with falloff
      if (distance > 0 && distance <= attacker.splashRadius) {
        // DETERMINISM: Linear falloff using quantized calculation
        // 100% at center, 50% at edge
        const qDistance = quantize(distance, QUANT_DAMAGE);
        const qRadius = quantize(attacker.splashRadius, QUANT_DAMAGE);
        const qFalloff = QUANT_DAMAGE - Math.floor((qDistance * QUANT_DAMAGE * 0.5) / qRadius);
        const qBaseDamage = quantize(baseDamage, QUANT_DAMAGE);
        const splashDamage = Math.max(1, Math.floor((qBaseDamage * qFalloff) / (QUANT_DAMAGE * QUANT_DAMAGE)));

        health.takeDamage(splashDamage, gameTime);

        // Emit splash damage event - PERF: Use pooled payload
        splashEventPayload.position.x = transform.x;
        splashEventPayload.position.y = transform.y;
        splashEventPayload.damage = splashDamage;
        this.game.eventBus.emit('combat:splash', splashEventPayload);

        // Check for under attack alert for splash victims
        this.checkUnderAttackAlert(entity.id, transform, gameTime);
      }
    }

    // Also check nearby buildings for splash damage
    const nearbyBuildingIds = this.world.buildingGrid.queryRadius(
      impactPos.x,
      impactPos.y,
      attacker.splashRadius
    );

    for (const entityId of nearbyBuildingIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');

      if (!transform || !health || !selectable || !building) continue;
      if (selectable.playerId === attackerSelectable.playerId) continue;
      if (health.isDead()) continue;

      // Distance to building edge
      const halfW = building.width / 2;
      const halfH = building.height / 2;
      const clampedX = Math.max(transform.x - halfW, Math.min(impactPos.x, transform.x + halfW));
      const clampedY = Math.max(transform.y - halfH, Math.min(impactPos.y, transform.y + halfH));
      const edgeDx = impactPos.x - clampedX;
      const edgeDy = impactPos.y - clampedY;
      const distance = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

      if (distance <= attacker.splashRadius) {
        const falloff = 1 - (distance / attacker.splashRadius) * 0.5;
        const splashDamage = Math.max(1, Math.floor(baseDamage * falloff));

        health.takeDamage(splashDamage, gameTime);

        // PERF: Use pooled payload
        splashEventPayload.position.x = transform.x;
        splashEventPayload.position.y = transform.y;
        splashEventPayload.damage = splashDamage;
        this.game.eventBus.emit('combat:splash', splashEventPayload);

        this.checkUnderAttackAlert(entity.id, transform, gameTime);
      }
    }
  }

  /**
   * Emit under attack alert for the player who owns the target
   */
  private checkUnderAttackAlert(
    targetId: number,
    targetTransform: Transform,
    gameTime: number
  ): void {
    const targetEntity = this.world.getEntity(targetId);
    const targetSelectable = targetEntity?.get<Selectable>('Selectable');
    if (!targetSelectable) return;

    const playerId = targetSelectable.playerId;
    const lastAlert = this.lastUnderAttackAlert.get(playerId) || 0;

    // Check cooldown (using data-driven config)
    if (gameTime - lastAlert < COMBAT_CONFIG.underAttackCooldown) return;

    // Update last alert time
    this.lastUnderAttackAlert.set(playerId, gameTime);

    // Emit under attack alert - PERF: Use pooled payload
    underAttackPayload.playerId = playerId;
    underAttackPayload.position.x = targetTransform.x;
    underAttackPayload.position.y = targetTransform.y;
    underAttackPayload.time = gameTime;
    this.game.eventBus.emit('alert:underAttack', underAttackPayload);
  }
}

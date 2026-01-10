import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit, DamageType } from '../components/Unit';
import { Health, ArmorType } from '../components/Health';
import { Game } from '../core/Game';
import { Selectable } from '../components/Selectable';
import { Building } from '../components/Building';
import { Resource } from '../components/Resource';
import { PooledVector2 } from '@/utils/VectorPool';
import { isLocalPlayer } from '@/store/gameSetupStore';
import { debugCombat } from '@/utils/debugLogger';

// Static temp vectors to avoid allocations in hot loops
const tempTargetScore: { id: number; score: number } | null = null;

// Damage multipliers: [damageType][armorType]
const DAMAGE_MULTIPLIERS: Record<DamageType, Record<ArmorType, number>> = {
  normal: {
    light: 1.0,
    armored: 1.0,
    massive: 1.0,
    structure: 1.0,
  },
  explosive: {
    light: 0.5,
    armored: 1.5,
    massive: 1.25,
    structure: 1.5,
  },
  concussive: {
    light: 1.5,
    armored: 0.5,
    massive: 0.25,
    structure: 0.5,
  },
  psionic: {
    light: 1.0,
    armored: 1.0,
    massive: 1.0,
    structure: 0.5,
  },
};

// Target priority - higher = more likely to be attacked first
const TARGET_PRIORITY: Record<string, number> = {
  // High threat combat units
  devastator: 100,
  dreadnought: 95,
  colossus: 90,
  specter: 85,
  operative: 80,
  breacher: 70,
  trooper: 60,
  scorcher: 55,
  valkyrie: 50,
  lifter: 45, // Support units have moderate priority
  vanguard: 40,
  // Workers are low priority
  constructor: 10,
  probe: 10,
  drone: 10,
};

// Cooldown for under attack alerts (prevent spam)
const UNDER_ATTACK_COOLDOWN = 10000; // 10 seconds

// High ground advantage constants
const HIGH_GROUND_MISS_CHANCE = 0.3; // 30% miss chance when attacking uphill
const HIGH_GROUND_THRESHOLD = 1.5; // Height difference to count as high ground

export class CombatSystem extends System {
  public priority = 20;

  // Track last under attack alert time per player
  private lastUnderAttackAlert: Map<string, number> = new Map();

  // Target acquisition throttling - don't search every frame
  private lastTargetSearchTick: Map<number, number> = new Map();
  private readonly TARGET_SEARCH_INTERVAL = 3; // Search every 3 ticks (~150ms) for responsive auto-attack

  // Cache current targets to avoid re-searching
  private cachedTargets: Map<number, { targetId: number; validUntilTick: number }> = new Map();
  private readonly TARGET_CACHE_DURATION = 10; // Cache valid for 10 ticks (~0.5 sec)

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

        if (command.targetEntityId !== undefined) {
          unit.setAttackTarget(command.targetEntityId);
        } else if (command.targetPosition) {
          // Attack-move: move toward position while engaging enemies
          unit.setAttackMoveTarget(command.targetPosition.x, command.targetPosition.y);
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
      const transform = attacker.get<Transform>('Transform')!;
      const unit = attacker.get<Unit>('Unit')!;
      const health = attacker.get<Health>('Health')!;

      // Skip dead units
      if (health.isDead()) {
        if (unit.state !== 'dead') {
          unit.state = 'dead';
          const selectable = attacker.get<Selectable>('Selectable');
          this.game.eventBus.emit('unit:died', {
            entityId: attacker.id,
            position: { x: transform.x, y: transform.y },
            isPlayerUnit: selectable?.playerId ? isLocalPlayer(selectable.playerId) : false,
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
        // Use throttled/cached target search for performance
        const target = this.getTargetThrottled(attacker.id, transform, unit, currentTick);
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
          // Only attack if in range
          const targetEntity = this.world.getEntity(target);
          if (targetEntity) {
            const targetTransform = targetEntity.get<Transform>('Transform');
            if (targetTransform) {
              const distance = transform.distanceTo(targetTransform);
              if (distance <= unit.attackRange) {
                unit.setAttackTarget(target);
              }
            }
          }
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

        // Calculate effective distance (to edge for buildings, center for units)
        let effectiveDistance: number;
        const targetBuilding = targetEntity.get<Building>('Building');

        if (targetBuilding) {
          // Distance to building edge
          const halfW = targetBuilding.width / 2;
          const halfH = targetBuilding.height / 2;
          const clampedX = Math.max(targetTransform.x - halfW, Math.min(transform.x, targetTransform.x + halfW));
          const clampedY = Math.max(targetTransform.y - halfH, Math.min(transform.y, targetTransform.y + halfH));
          const edgeDx = transform.x - clampedX;
          const edgeDy = transform.y - clampedY;
          effectiveDistance = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
        } else {
          effectiveDistance = transform.distanceTo(targetTransform);
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
      const health = building.get<Health>('Health')!;
      const buildingComp = building.get<Building>('Building')!;
      const selectable = building.get<Selectable>('Selectable')!;
      const transform = building.get<Transform>('Transform')!;

      // Check multiple conditions for death to ensure we catch all cases
      // Building should be destroyed if: health <= 0, OR if health is very low (floating point safety)
      const shouldDestroy = health.isDead() || health.current <= 0.01;

      if (shouldDestroy && buildingComp.state !== 'destroyed') {
        // Force health to exactly 0 to prevent edge cases
        health.current = 0;
        buildingComp.state = 'destroyed';

        // If this is an extractor, restore the vespene geyser visibility
        if (buildingComp.buildingId === 'extractor') {
          const resources = this.world.getEntitiesWith('Resource', 'Transform');
          for (const resourceEntity of resources) {
            const resource = resourceEntity.get<Resource>('Resource');
            if (resource && resource.extractorEntityId === building.id) {
              resource.extractorEntityId = null;
              debugCombat.log(`CombatSystem: Extractor destroyed, vespene geyser ${resourceEntity.id} restored`);
              break;
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
    for (const entity of this.world.getEntitiesWith('Health')) {
      const health = entity.get<Health>('Health')!;
      health.regenerate(deltaTime / 1000, gameTime);
    }
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

      const distance = selfTransform.distanceTo(transform);
      if (distance > selfUnit.sightRange) continue;

      // Calculate target score based on priority and distance
      const unitId = unit?.unitId || 'default';
      const basePriority = TARGET_PRIORITY[unitId] || 50;
      const distanceFactor = 1 - (distance / selfUnit.sightRange);
      const healthFactor = 1 - (health.current / health.max);
      const score = basePriority * 0.5 + distanceFactor * 30 + healthFactor * 20;

      if (!bestTarget || score > bestTarget.score) {
        bestTarget = { id: entityId, score };
      }
    }

    // Also check nearby buildings using building grid
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

      // Distance to building edge
      const halfW = building.width / 2;
      const halfH = building.height / 2;
      const clampedX = Math.max(transform.x - halfW, Math.min(selfTransform.x, transform.x + halfW));
      const clampedY = Math.max(transform.y - halfH, Math.min(selfTransform.y, transform.y + halfH));
      const edgeDx = selfTransform.x - clampedX;
      const edgeDy = selfTransform.y - clampedY;
      const distance = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

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

    // High ground miss chance check
    const heightDifference = targetTransform.z - attackerTransform.z;
    if (heightDifference > HIGH_GROUND_THRESHOLD) {
      // Target is on high ground - check for miss
      // Use deterministic pseudo-random based on game time and attacker ID
      const seed = (gameTime * 1000 + attackerId) % 1;
      const missRoll = Math.abs(Math.sin(seed * 12345.6789) % 1);
      if (missRoll < HIGH_GROUND_MISS_CHANCE) {
        // Attack missed
        this.game.eventBus.emit('combat:miss', {
          attackerId: attacker.unitId,
          attackerPos: { x: attackerTransform.x, y: attackerTransform.y },
          targetPos: { x: targetTransform.x, y: targetTransform.y },
          reason: 'high_ground',
        });
        return;
      }
    }

    // Calculate damage with type multiplier
    const multiplier = DAMAGE_MULTIPLIERS[attacker.damageType][targetHealth.armorType];
    const damage = attacker.attackDamage * multiplier;

    // Psionic damage ignores armor
    const finalDamage =
      attacker.damageType === 'psionic'
        ? damage
        : Math.max(1, damage - targetHealth.armor);

    // Apply primary target damage
    targetHealth.takeDamage(finalDamage, gameTime);

    // Check if target is a building (for damage number positioning)
    const targetEntity = this.world.getEntity(targetId);
    const targetBuilding = targetEntity?.get<Building>('Building');
    const targetHeight = targetBuilding ? Math.max(targetBuilding.width, targetBuilding.height) : 0;

    // Emit attack event
    const targetSelectable = targetEntity?.get<Selectable>('Selectable');
    this.game.eventBus.emit('combat:attack', {
      attackerId: attacker.unitId,
      attackerPos: { x: attackerTransform.x, y: attackerTransform.y },
      targetPos: { x: targetTransform.x, y: targetTransform.y },
      damage: finalDamage,
      damageType: attacker.damageType,
      targetHeight,
      targetPlayerId: targetSelectable?.playerId,
    });

    // Emit player:damage for Phaser overlay effects when local player's unit takes damage
    if (targetSelectable?.playerId && isLocalPlayer(targetSelectable.playerId)) {
      this.game.eventBus.emit('player:damage', {
        damage: finalDamage,
        position: { x: targetTransform.x, y: targetTransform.y },
      });
    }

    // Check for under attack alert
    this.checkUnderAttackAlert(targetId, targetTransform, gameTime);

    // Apply AoE/splash damage if applicable
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
        // Linear falloff: 100% at center, 50% at edge
        const falloff = 1 - (distance / attacker.splashRadius) * 0.5;
        const splashDamage = Math.max(1, Math.floor(baseDamage * falloff));

        health.takeDamage(splashDamage, gameTime);

        // Emit splash damage event
        this.game.eventBus.emit('combat:splash', {
          position: { x: transform.x, y: transform.y },
          damage: splashDamage,
        });

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

        this.game.eventBus.emit('combat:splash', {
          position: { x: transform.x, y: transform.y },
          damage: splashDamage,
        });

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

    // Check cooldown
    if (gameTime - lastAlert < UNDER_ATTACK_COOLDOWN) return;

    // Update last alert time
    this.lastUnderAttackAlert.set(playerId, gameTime);

    // Emit under attack alert
    this.game.eventBus.emit('alert:underAttack', {
      playerId,
      position: { x: targetTransform.x, y: targetTransform.y },
      time: gameTime,
    });
  }
}

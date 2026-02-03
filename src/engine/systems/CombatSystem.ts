import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import type { IGameInstance } from '../core/IGameInstance';
import { Selectable } from '../components/Selectable';
import { Building } from '../components/Building';
import { Resource } from '../components/Resource';
import { isLocalPlayer } from '@/store/gameSetupStore';
import { debugCombat } from '@/utils/debugLogger';
import { deterministicDamage, quantize, QUANT_DAMAGE } from '@/utils/FixedPoint';
import { getDamageMultiplier, COMBAT_CONFIG } from '@/data/combat/combat';
import AssetManager from '@/assets/AssetManager';
import { getProjectileType, DEFAULT_PROJECTILE, isInstantProjectile } from '@/data/projectiles';
import { SpatialEntityData, SpatialUnitState } from '../core/SpatialGrid';
import { findBestTarget as findBestTargetShared, isEnemy } from '../combat/TargetAcquisition';
import { distance, clamp } from '@/utils/math';
import { ThrottledCache } from '@/utils/ThrottledCache';
import { validateEntityAlive } from '@/utils/EntityValidator';

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

// Assault mode timeout - clear assault mode after this many ticks of being idle with no targets
// 60 ticks = ~3 seconds at 20 ticks/sec - enough time to scan for new targets before giving up
const ASSAULT_IDLE_TIMEOUT = 60;

export class CombatSystem extends System {
  public readonly name = 'CombatSystem';
  // Priority is set by SystemRegistry based on dependencies (runs after MovementSystem, VisionSystem)

  // Track last under attack alert time per player (uses game time in seconds)
  private readonly underAttackAlertThrottle = new ThrottledCache<string>({
    cooldown: COMBAT_CONFIG.underAttackCooldown,
    maxEntries: 16,
  });

  // Target acquisition throttling - don't search every frame
  private readonly TARGET_SEARCH_INTERVAL = 3; // Search every 3 ticks (~150ms) for sight-range search
  private readonly IMMEDIATE_SEARCH_INTERVAL = 1; // Search every 1 tick (~50ms) for attack-range search

  // Throttle for sight-range target search (uses ticks)
  private readonly targetSearchThrottle = new ThrottledCache<number>({
    cooldown: 3, // TARGET_SEARCH_INTERVAL
    maxEntries: 1000,
  });

  // Throttle for immediate attack-range search (uses ticks)
  private readonly immediateSearchThrottle = new ThrottledCache<number>({
    cooldown: 1, // IMMEDIATE_SEARCH_INTERVAL
    maxEntries: 1000,
  });

  // Cache current targets to avoid re-searching
  private readonly targetCache = new ThrottledCache<number, number>({
    cooldown: 10, // TARGET_CACHE_DURATION - cache valid for 10 ticks (~0.5 sec)
    maxEntries: 1000,
  });

  // PERF: Combat zone tracking - units with enemies nearby
  // Units NOT in this set can skip target acquisition entirely when idle
  private combatAwareUnits: Set<number> = new Set();
  private combatZoneCheckTick: Map<number, number> = new Map();
  // RTS-STYLE: Reduced from 15 to 5 ticks for more responsive combat detection
  private readonly COMBAT_ZONE_CHECK_INTERVAL = 5; // Re-check zone every 5 ticks (~250ms)

  // PERF OPTIMIZATION: Combat-active entity list
  // Only units in this set are processed for target acquisition
  private combatActiveUnits: Set<number> = new Set();
  private combatActiveLastUpdate: number = 0;
  private readonly COMBAT_ACTIVE_UPDATE_INTERVAL = 5; // Rebuild list every 5 ticks

  // PERF OPTIMIZATION: Hot cell tracking from SpatialGrid
  // Cells containing units from multiple players are "hot"
  private hotCells: Set<number> = new Set();
  private hotCellsLastUpdate: number = 0;
  // RTS-STYLE: Reduced from 10 to 5 ticks for faster combat zone detection
  private readonly HOT_CELLS_UPDATE_INTERVAL = 5; // Rebuild every 5 ticks

  // PERF OPTIMIZATION: Attack cooldown priority queue (min-heap by next attack time)
  // Only units in this queue are checked for attacks
  private attackReadyQueue: Array<{ entityId: number; nextAttackTime: number }> = [];
  private attackQueueDirty: boolean = true;

  // PERF OPTIMIZATION: Target visibility cache
  // Maps attacker ID to set of visible enemy IDs
  private visibilityCache: Map<number, { enemies: number[]; validUntilTick: number }> = new Map();
  private readonly VISIBILITY_CACHE_DURATION = 5; // Cache valid for 5 ticks

  // PERF: Player ID to numeric index mapping
  private playerIdToIndex: Map<string, number> = new Map();
  private nextPlayerIndex: number = 1;

  // PERF: Pre-allocated query result buffer
  private readonly _targetDataBuffer: SpatialEntityData[] = [];

  constructor(game: IGameInstance) {
    super(game);
    this.setupEventListeners();

    // Pre-allocate target data buffer
    for (let i = 0; i < 64; i++) {
      this._targetDataBuffer.push({
        id: 0,
        x: 0,
        y: 0,
        radius: 0,
        isFlying: false,
        state: SpatialUnitState.Idle,
        playerId: 0,
        collisionRadius: 0,
        isWorker: false,
        maxSpeed: 0,
      });
    }
  }

  /**
   * Get numeric player index for fast comparison
   */
  private getPlayerIndex(playerId: string): number {
    let index = this.playerIdToIndex.get(playerId);
    if (index === undefined) {
      index = this.nextPlayerIndex++;
      this.playerIdToIndex.set(playerId, index);
    }
    return index;
  }

  /**
   * PERF OPTIMIZATION: Update hot cells from SpatialGrid
   * Hot cells contain units from multiple players - likely combat zones
   */
  private updateHotCells(currentTick: number): void {
    if (currentTick - this.hotCellsLastUpdate < this.HOT_CELLS_UPDATE_INTERVAL) {
      return;
    }

    this.hotCells = this.world.unitGrid.getHotCells();
    this.hotCellsLastUpdate = currentTick;
  }

  /**
   * PERF OPTIMIZATION: Rebuild the combat-active unit list
   * Only units in hot cells or with active targets are tracked
   *
   * RTS-STYLE: Units in assault mode are ALWAYS combat-active and never throttled.
   * They continue scanning for enemies even when idle at their destination.
   */
  private updateCombatActiveUnits(currentTick: number): void {
    if (currentTick - this.combatActiveLastUpdate < this.COMBAT_ACTIVE_UPDATE_INTERVAL) {
      return;
    }

    this.combatActiveUnits.clear();

    const units = this.world.getEntitiesWith('Transform', 'Unit', 'Health');
    for (const entity of units) {
      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');
      if (!transform || !unit || !health || health.isDead()) continue;

      // Always include units with active targets
      if (unit.targetEntityId !== null) {
        this.combatActiveUnits.add(entity.id);
        continue;
      }

      // RTS-STYLE: Always include assault mode units - they never stop scanning
      // This is the key fix for idle units in enemy bases
      if (unit.isInAssaultMode) {
        this.combatActiveUnits.add(entity.id);
        continue;
      }

      // Include units in attack-move or patrolling states
      if (unit.state === 'attackmoving' || unit.state === 'patrolling') {
        this.combatActiveUnits.add(entity.id);
        continue;
      }

      // Include canAttackWhileMoving units that are moving
      if (unit.canAttackWhileMoving && unit.state === 'moving') {
        this.combatActiveUnits.add(entity.id);
        continue;
      }

      // Include units in hot cells (near enemies)
      if (this.world.unitGrid.isInHotCell(transform.x, transform.y, this.hotCells)) {
        this.combatActiveUnits.add(entity.id);
        continue;
      }

      // Include holding position units
      if (unit.isHoldingPosition) {
        this.combatActiveUnits.add(entity.id);
        continue;
      }

      // RTS-STYLE INSTANT ATTACK: Include idle units that have an enemy in attack range
      // This ensures units immediately respond when an enemy walks into their attack range
      // Uses fast hasEnemyInRadius check (O(cells) not O(entities))
      if (unit.state === 'idle' && unit.attackRange > 0) {
        const selectable = entity.get<Selectable>('Selectable');
        if (selectable) {
          const myPlayerId = this.getPlayerIndex(selectable.playerId);
          const hasEnemyInAttackRange = this.world.unitGrid.hasEnemyInRadius(
            transform.x,
            transform.y,
            unit.attackRange + 1, // +1 for edge tolerance
            myPlayerId
          );
          if (hasEnemyInAttackRange) {
            this.combatActiveUnits.add(entity.id);
            continue;
          }
        }
      }
    }

    this.combatActiveLastUpdate = currentTick;
  }

  /**
   * PERF OPTIMIZATION: Min-heap operations for attack cooldown queue
   */
  private heapPush(item: { entityId: number; nextAttackTime: number }): void {
    this.attackReadyQueue.push(item);
    this.heapSiftUp(this.attackReadyQueue.length - 1);
  }

  private heapPop(): { entityId: number; nextAttackTime: number } | undefined {
    if (this.attackReadyQueue.length === 0) return undefined;
    const result = this.attackReadyQueue[0];
    const last = this.attackReadyQueue.pop()!;
    if (this.attackReadyQueue.length > 0) {
      this.attackReadyQueue[0] = last;
      this.heapSiftDown(0);
    }
    return result;
  }

  private heapPeek(): { entityId: number; nextAttackTime: number } | undefined {
    return this.attackReadyQueue[0];
  }

  private heapSiftUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (
        this.attackReadyQueue[parent].nextAttackTime <= this.attackReadyQueue[index].nextAttackTime
      ) {
        break;
      }
      [this.attackReadyQueue[parent], this.attackReadyQueue[index]] = [
        this.attackReadyQueue[index],
        this.attackReadyQueue[parent],
      ];
      index = parent;
    }
  }

  private heapSiftDown(index: number): void {
    const length = this.attackReadyQueue.length;
    while (true) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let smallest = index;

      if (
        left < length &&
        this.attackReadyQueue[left].nextAttackTime < this.attackReadyQueue[smallest].nextAttackTime
      ) {
        smallest = left;
      }
      if (
        right < length &&
        this.attackReadyQueue[right].nextAttackTime < this.attackReadyQueue[smallest].nextAttackTime
      ) {
        smallest = right;
      }

      if (smallest === index) break;

      [this.attackReadyQueue[index], this.attackReadyQueue[smallest]] = [
        this.attackReadyQueue[smallest],
        this.attackReadyQueue[index],
      ];
      index = smallest;
    }
  }

  /**
   * PERF OPTIMIZATION: Rebuild attack ready queue from all combat units
   */
  private rebuildAttackQueue(): void {
    this.attackReadyQueue.length = 0;

    for (const entityId of this.combatActiveUnits) {
      const entity = this.world.getEntity(entityId);
      if (!validateEntityAlive(entity, entityId, 'CombatSystem:rebuildAttackQueue')) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit || unit.state === 'dead') continue;

      // Calculate next attack time (attackSpeed is attacks per second, so cooldown = 1/attackSpeed)
      const cooldown = 1 / unit.attackSpeed;
      const nextAttackTime = unit.lastAttackTime + cooldown;
      this.heapPush({ entityId, nextAttackTime });
    }

    this.attackQueueDirty = false;
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
    this.targetCache.delete(data.entityId);
    this.targetSearchThrottle.delete(data.entityId);
    this.immediateSearchThrottle.delete(data.entityId);
    // PERF: Clean up combat zone tracking
    this.combatAwareUnits.delete(data.entityId);
    this.combatZoneCheckTick.delete(data.entityId);
  }

  private handleAttackCommand(command: {
    entityIds: number[];
    targetEntityId?: number;
    targetPosition?: { x: number; y: number };
    queue?: boolean;
  }): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!validateEntityAlive(entity, entityId, 'CombatSystem:handleAttackCommand')) continue;

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
        // If worker is currently constructing, release them from construction
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

    // PERF OPTIMIZATION: Update hot cells and combat-active unit list
    this.updateHotCells(currentTick);
    this.updateCombatActiveUnits(currentTick);

    // PERF OPTIMIZATION: Rebuild attack queue if dirty
    if (this.attackQueueDirty) {
      this.rebuildAttackQueue();
    }

    // PERF OPTIMIZATION: First pass - handle dead units (fast scan of all units)
    const allUnits = this.world.getEntitiesWith('Transform', 'Unit', 'Health');
    for (const entity of allUnits) {
      const health = entity.get<Health>('Health');
      const unit = entity.get<Unit>('Unit');
      if (!health || !unit) continue;

      if (health.isDead() && unit.state !== 'dead') {
        unit.state = 'dead';
        const transform = entity.get<Transform>('Transform');
        const selectable = entity.get<Selectable>('Selectable');
        if (transform) {
          this.game.eventBus.emit('unit:died', {
            entityId: entity.id,
            position: { x: transform.x, y: transform.y },
            isPlayerUnit: selectable?.playerId ? isLocalPlayer(selectable.playerId) : false,
            isFlying: unit.isFlying,
            playerId: selectable?.playerId,
            unitType: unit.unitId,
          });
        }
        // Remove from combat-active set
        this.combatActiveUnits.delete(entity.id);
      }
    }

    // PERF OPTIMIZATION: Second pass - target acquisition for combat-active units only
    for (const entityId of this.combatActiveUnits) {
      const attacker = this.world.getEntity(entityId);
      if (!validateEntityAlive(attacker, entityId, 'CombatSystem:targetAcquisition')) continue;

      const transform = attacker.get<Transform>('Transform');
      const unit = attacker.get<Unit>('Unit');
      const health = attacker.get<Health>('Health');
      if (!transform || !unit || !health || health.isDead()) continue;

      // Auto-acquire targets for units that need them
      // canAttackWhileMoving units also acquire targets while moving
      // RTS-STYLE: Assault mode units ALWAYS need to acquire targets when idle
      const needsTarget =
        unit.targetEntityId === null &&
        (unit.state === 'idle' ||
          unit.state === 'patrolling' ||
          unit.state === 'attackmoving' ||
          unit.state === 'attacking' ||
          unit.isHoldingPosition ||
          unit.isInAssaultMode || // RTS-STYLE: Assault mode units always scan
          (unit.canAttackWhileMoving && unit.state === 'moving'));

      if (needsTarget) {
        // PERF: Use hot cell check instead of expensive spatial query for idle units
        // RTS-STYLE: Skip this optimization for assault mode units - they always search
        if (unit.state === 'idle' && !unit.isHoldingPosition && !unit.isInAssaultMode) {
          // Fast check: is this unit in a hot cell?
          const inHotCell = this.world.unitGrid.isInHotCell(
            transform.x,
            transform.y,
            this.hotCells
          );
          if (!inHotCell) {
            // Also do the full combat zone check for edge cases
            const inCombatZone = this.checkCombatZone(attacker.id, transform, unit, currentTick);
            if (!inCombatZone) {
              // Not in combat zone - skip all target acquisition this tick
              continue;
            }
          }
        }

        let target: number | null = null;

        // RTS-STYLE: Assault mode units always search at sight range, no throttling
        if (unit.isInAssaultMode && unit.state === 'idle') {
          // Aggressive sight-range search for assault mode units
          target = this.findBestTargetSpatial(attacker.id, transform, unit);
          // Track idle time for assault mode units
          unit.assaultIdleTicks++;

          // Clear assault mode after timeout if no target found
          // This allows the AI tactical system to reclaim and re-command these units
          if (target === null && unit.assaultIdleTicks > ASSAULT_IDLE_TIMEOUT) {
            unit.isInAssaultMode = false;
            unit.assaultDestination = null;
            unit.assaultIdleTicks = 0;
            debugCombat.log(
              `[CombatSystem] Unit ${attacker.id} cleared assault mode after ${ASSAULT_IDLE_TIMEOUT} ticks idle`
            );
          }
        } else if (unit.state === 'idle' || unit.isHoldingPosition) {
          // For regular idle units, do a fast check for enemies within ATTACK range
          // Uses light throttle (1 tick = ~50ms) for performance while staying responsive
          target = this.findImmediateAttackTarget(attacker.id, transform, unit, currentTick);
        }

        // If no immediate target found, use throttled search within sight range
        if (target === null && !unit.isHoldingPosition) {
          target = this.getTargetThrottled(attacker.id, transform, unit, currentTick);
        }

        if (target && !unit.isHoldingPosition) {
          // Units with canAttackWhileMoving keep moving while attacking
          if (
            unit.canAttackWhileMoving &&
            (unit.state === 'moving' || unit.state === 'attackmoving')
          ) {
            unit.setAttackTargetWhileMoving(target);
          } else {
            // For attackmoving units, save the destination before switching to attacking
            const savedTargetX = unit.targetX;
            const savedTargetY = unit.targetY;
            const wasAttackMoving = unit.state === 'attackmoving';
            // RTS-STYLE: Remember assault destination
            const savedAssaultDest = unit.assaultDestination;
            const wasInAssaultMode = unit.isInAssaultMode;

            unit.setAttackTarget(target);

            // Restore attack-move destination so unit resumes after killing target
            if (wasAttackMoving && savedTargetX !== null && savedTargetY !== null) {
              unit.targetX = savedTargetX;
              unit.targetY = savedTargetY;
            }

            // RTS-STYLE: Preserve assault mode through target acquisition
            if (wasInAssaultMode && savedAssaultDest) {
              unit.assaultDestination = savedAssaultDest;
              unit.isInAssaultMode = true;
              unit.assaultIdleTicks = 0; // Reset idle counter - we found a target
            }
          }
        } else if (target && unit.isHoldingPosition) {
          // Holding position units only attack if in range (already confirmed by findImmediateAttackTarget)
          unit.setAttackTarget(target);
        }
      }

      // Process attacks for units in attacking state
      // Also process for canAttackWhileMoving units that are moving/attackmoving with a target
      const canProcessAttack =
        unit.targetEntityId !== null &&
        (unit.state === 'attacking' ||
          (unit.canAttackWhileMoving &&
            (unit.state === 'moving' || unit.state === 'attackmoving')));

      if (canProcessAttack) {
        const targetEntity = this.world.getEntity(unit.targetEntityId!);
        const isAttackingWhileMoving =
          unit.canAttackWhileMoving && (unit.state === 'moving' || unit.state === 'attackmoving');

        if (!targetEntity || targetEntity.isDestroyed()) {
          // Target no longer exists
          if (isAttackingWhileMoving) {
            // Attack-while-moving units just clear target and keep moving
            unit.targetEntityId = null;
          } else if (unit.targetX !== null && unit.targetY !== null) {
            // Resume attack-move to destination
            unit.state = 'attackmoving';
            unit.targetEntityId = null;
          } else if (unit.isInAssaultMode) {
            // RTS-STYLE: Assault mode units stay in assault mode, ready to scan for new targets
            // They go "idle" but with assault mode flag still set, so they keep scanning
            unit.targetEntityId = null;
            unit.state = 'idle';
            // Don't clear assault mode - unit will immediately scan for new targets next tick
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
          // Target dead
          if (isAttackingWhileMoving) {
            // Attack-while-moving units just clear target and keep moving
            unit.targetEntityId = null;
          } else if (unit.targetX !== null && unit.targetY !== null) {
            // Resume attack-move to destination
            unit.state = 'attackmoving';
            unit.targetEntityId = null;
          } else if (unit.isInAssaultMode) {
            // RTS-STYLE: Assault mode units stay aggressive and keep scanning
            unit.targetEntityId = null;
            unit.state = 'idle';
            // Assault mode preserved - unit will scan for new targets
          } else if (!unit.executeNextCommand()) {
            unit.clearTarget();
          }
          continue;
        }

        // Check if attacker can target this entity based on air/ground status
        // Buildings are always ground targets, units check isFlying
        const targetIsFlying = targetUnit?.isFlying ?? false;
        const canAttackThisTarget = targetBuilding
          ? unit.canAttackGround // Buildings are ground targets
          : unit.canAttackTarget(targetIsFlying); // Units check air/ground

        if (!canAttackThisTarget) {
          // Cannot attack this target type - clear and find new target
          if (isAttackingWhileMoving) {
            // Attack-while-moving units just clear target and keep moving
            unit.targetEntityId = null;
          } else if (unit.targetX !== null && unit.targetY !== null) {
            unit.state = 'attackmoving';
            unit.targetEntityId = null;
          } else if (unit.isInAssaultMode) {
            // RTS-STYLE: Stay aggressive, find a target we CAN attack
            unit.targetEntityId = null;
            unit.state = 'idle';
          } else if (!unit.executeNextCommand()) {
            unit.clearTarget();
          }
          continue;
        }

        // Calculate effective distance (edge-to-edge)
        // Uses visual radius (model scale) not just collision radius
        let effectiveDistance: number;
        const attackerRadius = AssetManager.getCachedVisualRadius(
          unit.unitId,
          unit.collisionRadius
        );

        if (targetBuilding) {
          // Distance to building edge, minus attacker's visual radius
          const halfW = targetBuilding.width / 2;
          const halfH = targetBuilding.height / 2;
          const clampedX = Math.max(
            targetTransform.x - halfW,
            Math.min(transform.x, targetTransform.x + halfW)
          );
          const clampedY = Math.max(
            targetTransform.y - halfH,
            Math.min(transform.y, targetTransform.y + halfH)
          );
          const edgeDx = transform.x - clampedX;
          const edgeDy = transform.y - clampedY;
          effectiveDistance = Math.max(
            0,
            Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy) - attackerRadius
          );
        } else {
          // Distance between unit edges (center-to-center minus both visual radii)
          const centerDistance = transform.distanceTo(targetTransform);
          const targetRadius = targetUnit
            ? AssetManager.getCachedVisualRadius(targetUnit.unitId, targetUnit.collisionRadius)
            : 0.5;
          effectiveDistance = Math.max(0, centerDistance - attackerRadius - targetRadius);
        }

        if (effectiveDistance <= unit.attackRange) {
          // In range - attempt attack
          if (unit.canAttack(gameTime)) {
            this.performAttack(
              attacker.id,
              unit,
              transform,
              targetEntity.id,
              targetHealth,
              targetTransform,
              gameTime
            );
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

        // PERF: If this is an extractor, restore the plasma geyser visibility
        // Uses O(1) reverse lookup via linkedResourceId instead of O(n) scan
        if (buildingComp.buildingId === 'extractor') {
          if (buildingComp.linkedResourceId !== null) {
            const resourceEntity = this.world.getEntity(buildingComp.linkedResourceId);
            if (resourceEntity) {
              const resource = resourceEntity.get<Resource>('Resource');
              if (resource) {
                resource.extractorEntityId = null;
                debugCombat.log(
                  `CombatSystem: Extractor destroyed, plasma geyser ${buildingComp.linkedResourceId} restored`
                );
              }
            }
          }
        }

        debugCombat.log(
          `CombatSystem: Building ${buildingComp.buildingId} (${building.id}) destroyed at (${transform.x.toFixed(1)}, ${transform.y.toFixed(1)})`
        );

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
   *
   * PERF OPTIMIZATION: Uses SpatialGrid.hasEnemyInRadius for fast inline data lookup.
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
    if (!validateEntityAlive(selfEntity, selfId, 'CombatSystem:checkCombatZone')) {
      this.combatAwareUnits.delete(selfId);
      return false;
    }
    const selfSelectable = selfEntity.get<Selectable>('Selectable');
    if (!selfSelectable) {
      this.combatAwareUnits.delete(selfId);
      return false;
    }

    // PERF OPTIMIZATION: Use fast hasEnemyInRadius with inline data
    // This avoids entity lookups for each potential target
    const myPlayerId = this.getPlayerIndex(selfSelectable.playerId);
    let hasEnemyNearby = this.world.unitGrid.hasEnemyInRadius(
      selfTransform.x,
      selfTransform.y,
      selfUnit.sightRange,
      myPlayerId
    );

    // Also check for enemy buildings if we can attack ground
    if (!hasEnemyNearby && selfUnit.canAttackGround) {
      const nearbyBuildingIds = this.world.buildingGrid.queryRadius(
        selfTransform.x,
        selfTransform.y,
        selfUnit.sightRange
      );

      for (const entityId of nearbyBuildingIds) {
        const entity = this.world.getEntity(entityId);
        if (!validateEntityAlive(entity, entityId, 'CombatSystem:checkCombatZone:buildings'))
          continue;

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
   * Uses shared TargetAcquisition utility for consistent priority scoring.
   */
  private findImmediateAttackTarget(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    currentTick: number
  ): number | null {
    // Light throttle - check every tick (~50ms) instead of every frame
    if (!this.immediateSearchThrottle.canExecute(selfId, currentTick)) {
      return null;
    }
    this.immediateSearchThrottle.markExecuted(selfId, currentTick);

    // Get self's player ID
    const selfEntity = this.world.getEntity(selfId);
    if (!validateEntityAlive(selfEntity, selfId, 'CombatSystem:findImmediateAttackTarget'))
      return null;
    const selfSelectable = selfEntity.get<Selectable>('Selectable');
    if (!selfSelectable) return null;

    // Use shared target acquisition for attack-range search
    const result = findBestTargetShared(this.world, {
      x: selfTransform.x,
      y: selfTransform.y,
      range: selfUnit.attackRange,
      attackerPlayerId: selfSelectable.playerId,
      attackerTeamId: selfSelectable.teamId,
      attackRange: selfUnit.attackRange,
      canAttackAir: selfUnit.canAttackAir,
      canAttackGround: selfUnit.canAttackGround,
      includeBuildingsInSearch: selfUnit.canAttackGround,
      attackerVisualRadius: AssetManager.getCachedVisualRadius(
        selfUnit.unitId,
        selfUnit.collisionRadius
      ),
      excludeEntityId: selfId,
    });

    return result?.entityId ?? null;
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
    // Check cache first - returns cached target if still valid
    const cachedTargetId = this.targetCache.getIfValid(selfId, currentTick);
    if (cachedTargetId !== undefined) {
      // Verify cached target is still valid (alive and exists)
      const targetEntity = this.world.getEntity(cachedTargetId);
      if (targetEntity && !targetEntity.isDestroyed()) {
        const targetHealth = targetEntity.get<Health>('Health');
        if (targetHealth && !targetHealth.isDead()) {
          return cachedTargetId;
        }
      }
      // Cached target invalid, remove it and allow immediate re-search
      this.targetCache.delete(selfId);
      this.targetSearchThrottle.delete(selfId); // Allow immediate re-targeting
    }

    // Check if enough time has passed since last search
    if (!this.targetSearchThrottle.canExecute(selfId, currentTick)) {
      return null; // Not time to search yet
    }

    // Perform the search
    this.targetSearchThrottle.markExecuted(selfId, currentTick);
    const target = this.findBestTargetSpatial(selfId, selfTransform, selfUnit);

    // Cache the result
    if (target !== null) {
      this.targetCache.set(selfId, target, currentTick);
    }

    return target;
  }

  /**
   * Find the best target using spatial grid for O(nearby) instead of O(all entities)
   * Prioritizes high-threat units over workers.
   * Uses shared TargetAcquisition utility for consistent priority scoring.
   */
  private findBestTargetSpatial(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit
  ): number | null {
    // Get self's player ID
    const selfEntity = this.world.getEntity(selfId);
    if (!validateEntityAlive(selfEntity, selfId, 'CombatSystem:findBestTargetSpatial')) return null;
    const selfSelectable = selfEntity.get<Selectable>('Selectable');
    if (!selfSelectable) return null;

    // Use shared target acquisition for sight-range search
    const result = findBestTargetShared(this.world, {
      x: selfTransform.x,
      y: selfTransform.y,
      range: selfUnit.sightRange,
      attackerPlayerId: selfSelectable.playerId,
      attackerTeamId: selfSelectable.teamId,
      attackRange: selfUnit.attackRange,
      canAttackAir: selfUnit.canAttackAir,
      canAttackGround: selfUnit.canAttackGround,
      includeBuildingsInSearch: selfUnit.canAttackGround,
      attackerVisualRadius: AssetManager.getCachedVisualRadius(
        selfUnit.unitId,
        selfUnit.collisionRadius
      ),
      excludeEntityId: selfId,
    });

    return result?.entityId ?? null;
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
    const finalDamage = deterministicDamage(attacker.attackDamage, multiplier, armorReduction);

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
      // Use per-unit airborne heights from assets.json for accurate targeting
      const startZ = attacker.isFlying ? AssetManager.getAirborneHeight(attacker.unitId) : 0.5;
      const targetZ =
        targetIsFlying && targetUnit ? AssetManager.getAirborneHeight(targetUnit.unitId) : 0.5;

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
    if (!validateEntityAlive(attackerEntity, attackerId, 'CombatSystem:applySplashDamage')) return;
    const attackerSelectable = attackerEntity.get<Selectable>('Selectable');
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
      if (!validateEntityAlive(entity, entityId, 'CombatSystem:applySplashDamage:units')) continue;

      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');

      // Skip allies and dead units
      if (!transform || !health || !selectable) continue;
      // Use isEnemy to check team alliance
      if (
        !isEnemy(
          attackerSelectable.playerId,
          attackerSelectable.teamId,
          selectable.playerId,
          selectable.teamId
        )
      )
        continue;
      if (health.isDead()) continue;

      // Calculate distance from impact point
      const dist = distance(impactPos.x, impactPos.y, transform.x, transform.y);

      // Apply splash damage with falloff
      if (dist > 0 && dist <= attacker.splashRadius) {
        // DETERMINISM: Linear falloff using quantized calculation
        // 100% at center, 50% at edge
        const qDistance = quantize(dist, QUANT_DAMAGE);
        const qRadius = quantize(attacker.splashRadius, QUANT_DAMAGE);
        const qFalloff = QUANT_DAMAGE - Math.floor((qDistance * QUANT_DAMAGE * 0.5) / qRadius);
        const qBaseDamage = quantize(baseDamage, QUANT_DAMAGE);
        const splashDamage = Math.max(
          1,
          Math.floor((qBaseDamage * qFalloff) / (QUANT_DAMAGE * QUANT_DAMAGE))
        );

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
      if (!validateEntityAlive(entity, entityId, 'CombatSystem:applySplashDamage:buildings'))
        continue;

      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');

      if (!transform || !health || !selectable || !building) continue;
      // Use isEnemy to check team alliance
      if (
        !isEnemy(
          attackerSelectable.playerId,
          attackerSelectable.teamId,
          selectable.playerId,
          selectable.teamId
        )
      )
        continue;
      if (health.isDead()) continue;

      // Distance to building edge
      const halfW = building.width / 2;
      const halfH = building.height / 2;
      const clampedX = clamp(impactPos.x, transform.x - halfW, transform.x + halfW);
      const clampedY = clamp(impactPos.y, transform.y - halfH, transform.y + halfH);
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

    // Check cooldown (using ThrottledCache with game time)
    if (!this.underAttackAlertThrottle.canExecute(playerId, gameTime)) return;

    // Update last alert time
    this.underAttackAlertThrottle.markExecuted(playerId, gameTime);

    // Emit under attack alert - PERF: Use pooled payload
    underAttackPayload.playerId = playerId;
    underAttackPayload.position.x = targetTransform.x;
    underAttackPayload.position.y = targetTransform.y;
    underAttackPayload.time = gameTime;
    this.game.eventBus.emit('alert:underAttack', underAttackPayload);
  }
}

import { System } from '../ecs/System';
import { Entity } from '../ecs/Entity';
import { Game } from '../core/Game';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Ability } from '../components/Ability';
import { Building } from '../components/Building';

interface TransformCommand {
  entityIds: number[];
  targetMode: string;
}

interface CloakCommand {
  entityIds: number[];
  enable?: boolean;
}

interface LoadCommand {
  transportId: number;
  unitIds: number[];
}

interface UnloadCommand {
  transportId: number;
  position: { x: number; y: number };
  unitId?: number; // If specified, unload specific unit. Otherwise unload all
}

interface HealCommand {
  healerId: number;
  targetId: number;
}

interface RepairCommand {
  repairerId: number;
  targetId: number;
}

interface LoadIntoBunkerCommand {
  bunkerId: number;
  unitIds: number[];
}

interface UnloadFromBunkerCommand {
  bunkerId: number;
  unitId?: number;
}

// Extended Building component for bunker mechanics
interface BunkerData {
  loadedUnits: number[];
  maxCapacity: number;
}

export class UnitMechanicsSystem extends System {
  public priority = 15; // After selection, before movement

  // Track bunker data separately since Building component doesn't have it
  private bunkerData: Map<number, BunkerData> = new Map();

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Transform commands
    this.game.eventBus.on('command:transform', this.handleTransformCommand.bind(this));

    // Cloak commands
    this.game.eventBus.on('command:cloak', this.handleCloakCommand.bind(this));

    // Transport commands
    this.game.eventBus.on('command:load', this.handleLoadCommand.bind(this));
    this.game.eventBus.on('command:unload', this.handleUnloadCommand.bind(this));

    // Bunker commands
    this.game.eventBus.on('command:loadBunker', this.handleLoadBunkerCommand.bind(this));
    this.game.eventBus.on('command:unloadBunker', this.handleUnloadBunkerCommand.bind(this));
    this.game.eventBus.on('command:salvageBunker', this.handleSalvageBunkerCommand.bind(this));

    // Healing/Repair commands
    this.game.eventBus.on('command:heal', this.handleHealCommand.bind(this));
    this.game.eventBus.on('command:repair', this.handleRepairCommand.bind(this));
    this.game.eventBus.on('command:toggleAutocastRepair', this.handleToggleAutocastRepair.bind(this));

    // Buff application
    this.game.eventBus.on('buff:apply', this.handleBuffApply.bind(this));
  }

  // ==================== AUTOCAST REPAIR TOGGLE ====================

  private handleToggleAutocastRepair(data: { entityIds: number[] }): void {
    for (const entityId of data.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit || !unit.canRepair) continue;

      unit.autocastRepair = !unit.autocastRepair;

      this.game.eventBus.emit('unit:autocastToggled', {
        entityId,
        ability: 'repair',
        enabled: unit.autocastRepair,
      });
    }
  }

  // ==================== TRANSFORM HANDLING ====================

  private handleTransformCommand(command: TransformCommand): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit || !unit.canTransform) continue;

      if (unit.startTransform(command.targetMode)) {
        this.game.eventBus.emit('unit:transformStart', {
          entityId,
          fromMode: unit.currentMode,
          toMode: command.targetMode,
        });
      }
    }
  }

  // ==================== CLOAK HANDLING ====================

  private handleCloakCommand(command: CloakCommand): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit || !unit.canCloak) continue;

      const ability = entity.get<Ability>('Ability');

      // Check if unit has energy for cloak
      if (command.enable !== false && !unit.isCloaked) {
        if (ability && ability.energy < 25) continue; // Need minimum energy to start cloak
      }

      if (command.enable !== undefined) {
        unit.setCloak(command.enable);
      } else {
        unit.toggleCloak();
      }

      this.game.eventBus.emit('unit:cloakToggle', {
        entityId,
        isCloaked: unit.isCloaked,
      });
    }
  }

  // ==================== TRANSPORT HANDLING ====================

  private handleLoadCommand(command: LoadCommand): void {
    const transport = this.world.getEntity(command.transportId);
    if (!transport) return;

    const transportUnit = transport.get<Unit>('Unit');
    const transportTransform = transport.get<Transform>('Transform');
    const transportSelectable = transport.get<Selectable>('Selectable');

    if (!transportUnit || !transportUnit.isTransport || !transportTransform || !transportSelectable) return;

    for (const unitId of command.unitIds) {
      const entity = this.world.getEntity(unitId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      const selectable = entity.get<Selectable>('Selectable');

      if (!unit || !transform || !selectable) continue;

      // Can only load own units
      if (selectable.playerId !== transportSelectable.playerId) continue;

      // Can't load flying units or other transports
      if (unit.isFlying || unit.isTransport) continue;

      // Check if in range (4 units)
      const dx = transform.x - transportTransform.x;
      const dy = transform.y - transportTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 4) continue;

      // Try to load
      if (transportUnit.loadUnit(unitId)) {
        unit.state = 'loaded';
        unit.clearTarget();

        this.game.eventBus.emit('unit:loaded', {
          transportId: command.transportId,
          unitId,
        });
      }
    }
  }

  private handleUnloadCommand(command: UnloadCommand): void {
    const transport = this.world.getEntity(command.transportId);
    if (!transport) return;

    const transportUnit = transport.get<Unit>('Unit');
    const transportTransform = transport.get<Transform>('Transform');

    if (!transportUnit || !transportUnit.isTransport || !transportTransform) return;

    // Calculate unload positions in a circle around the transport
    const unloadUnits = command.unitId
      ? [command.unitId]
      : [...transportUnit.loadedUnits];

    let angle = 0;
    const angleStep = (2 * Math.PI) / Math.max(unloadUnits.length, 1);

    for (const unitId of unloadUnits) {
      if (!transportUnit.unloadUnit(unitId)) continue;

      const entity = this.world.getEntity(unitId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');

      if (!unit || !transform) continue;

      // Position unit around unload point
      const unloadX = command.position.x + Math.cos(angle) * 2;
      const unloadY = command.position.y + Math.sin(angle) * 2;
      angle += angleStep;

      transform.x = unloadX;
      transform.y = unloadY;
      unit.state = 'idle';

      this.game.eventBus.emit('unit:unloaded', {
        transportId: command.transportId,
        unitId,
        position: { x: unloadX, y: unloadY },
      });
    }
  }

  // ==================== BUNKER HANDLING ====================

  private handleLoadBunkerCommand(command: LoadIntoBunkerCommand): void {
    const bunker = this.world.getEntity(command.bunkerId);
    if (!bunker) return;

    const building = bunker.get<Building>('Building');
    const bunkerTransform = bunker.get<Transform>('Transform');
    const bunkerSelectable = bunker.get<Selectable>('Selectable');

    if (!building || building.buildingId !== 'bunker' || !bunkerTransform || !bunkerSelectable) return;

    // Initialize bunker data if needed
    if (!this.bunkerData.has(command.bunkerId)) {
      this.bunkerData.set(command.bunkerId, { loadedUnits: [], maxCapacity: 4 });
    }

    const data = this.bunkerData.get(command.bunkerId)!;

    for (const unitId of command.unitIds) {
      if (data.loadedUnits.length >= data.maxCapacity) break;

      const entity = this.world.getEntity(unitId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      const selectable = entity.get<Selectable>('Selectable');

      if (!unit || !transform || !selectable) continue;

      // Can only load own infantry units
      if (selectable.playerId !== bunkerSelectable.playerId) continue;
      if (unit.isFlying || unit.isWorker || unit.isMechanical) continue;

      // Check if in range
      const dx = transform.x - bunkerTransform.x;
      const dy = transform.y - bunkerTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 5) continue;

      data.loadedUnits.push(unitId);
      unit.state = 'loaded';
      unit.clearTarget();

      this.game.eventBus.emit('unit:loadedBunker', {
        bunkerId: command.bunkerId,
        unitId,
      });
    }
  }

  private handleUnloadBunkerCommand(command: UnloadFromBunkerCommand): void {
    const bunker = this.world.getEntity(command.bunkerId);
    if (!bunker) return;

    const bunkerTransform = bunker.get<Transform>('Transform');
    if (!bunkerTransform) return;

    const data = this.bunkerData.get(command.bunkerId);
    if (!data) return;

    const unloadUnits = command.unitId
      ? [command.unitId]
      : [...data.loadedUnits];

    let angle = 0;
    const angleStep = (2 * Math.PI) / Math.max(unloadUnits.length, 1);

    for (const unitId of unloadUnits) {
      const index = data.loadedUnits.indexOf(unitId);
      if (index === -1) continue;

      data.loadedUnits.splice(index, 1);

      const entity = this.world.getEntity(unitId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');

      if (!unit || !transform) continue;

      // Position unit around bunker
      const unloadX = bunkerTransform.x + Math.cos(angle) * 3;
      const unloadY = bunkerTransform.y + Math.sin(angle) * 3;
      angle += angleStep;

      transform.x = unloadX;
      transform.y = unloadY;
      unit.state = 'idle';

      this.game.eventBus.emit('unit:unloadedBunker', {
        bunkerId: command.bunkerId,
        unitId,
        position: { x: unloadX, y: unloadY },
      });
    }
  }

  private handleSalvageBunkerCommand(data: { bunkerId: number; playerId: string }): void {
    const bunker = this.world.getEntity(data.bunkerId);
    if (!bunker) return;

    const building = bunker.get<Building>('Building');
    const selectable = bunker.get<Selectable>('Selectable');

    if (!building || building.buildingId !== 'bunker' || !selectable) return;
    if (selectable.playerId !== data.playerId) return;

    // Unload all units first
    this.handleUnloadBunkerCommand({ bunkerId: data.bunkerId });

    // Return 75% of bunker cost (100 minerals * 0.75 = 75)
    this.game.eventBus.emit('resources:add', {
      playerId: data.playerId,
      minerals: 75,
      vespene: 0,
    });

    // Destroy the bunker
    const health = bunker.get<Health>('Health');
    if (health) {
      health.current = 0;
    }

    this.bunkerData.delete(data.bunkerId);

    this.game.eventBus.emit('building:salvaged', {
      bunkerId: data.bunkerId,
      refund: 75,
    });
  }

  // ==================== HEALING/REPAIR HANDLING ====================

  private handleHealCommand(command: HealCommand): void {
    const healer = this.world.getEntity(command.healerId);
    if (!healer) return;

    const healerUnit = healer.get<Unit>('Unit');
    if (!healerUnit || !healerUnit.canHeal) return;

    healerUnit.setHealTarget(command.targetId);
  }

  private handleRepairCommand(command: RepairCommand): void {
    const repairer = this.world.getEntity(command.repairerId);
    if (!repairer) return;

    const repairerUnit = repairer.get<Unit>('Unit');
    if (!repairerUnit || !repairerUnit.canRepair) return;

    // If worker is currently constructing, release them from construction (SC2-style)
    if (repairerUnit.state === 'building' && repairerUnit.constructingBuildingId !== null) {
      repairerUnit.cancelBuilding();
    }

    repairerUnit.setRepairTarget(command.targetId);
  }

  // ==================== BUFF HANDLING ====================

  private handleBuffApply(data: {
    entityId: number;
    buffId: string;
    duration: number;
    effects: Record<string, number>;
  }): void {
    const entity = this.world.getEntity(data.entityId);
    if (!entity) return;

    const unit = entity.get<Unit>('Unit');
    if (!unit) return;

    unit.applyBuff(data.buffId, data.duration, data.effects);

    this.game.eventBus.emit('buff:applied', {
      entityId: data.entityId,
      buffId: data.buffId,
      duration: data.duration,
    });
  }

  // ==================== UPDATE LOOP ====================

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000;
    const gameTime = this.game.getGameTime();

    const entities = this.world.getEntitiesWith('Unit');

    for (const entity of entities) {
      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');
      if (!unit) continue;

      if (health?.isDead()) continue;

      // Update transforms
      if (unit.state === 'transforming') {
        const completed = unit.updateTransform(dt);
        if (completed) {
          this.game.eventBus.emit('unit:transformComplete', {
            entityId: entity.id,
            mode: unit.currentMode,
          });
        }
      }

      // Update cloak energy drain
      if (unit.isCloaked) {
        const ability = entity.get<Ability>('Ability');
        if (ability) {
          ability.energy -= unit.cloakEnergyCost * dt;
          if (ability.energy <= 0) {
            ability.energy = 0;
            unit.setCloak(false);
            this.game.eventBus.emit('unit:cloakDepleted', { entityId: entity.id });
          }
        }
      }

      // Update buffs
      const expiredBuffs = unit.updateBuffs(dt);
      for (const buffId of expiredBuffs) {
        this.game.eventBus.emit('buff:expired', {
          entityId: entity.id,
          buffId,
        });
      }

      // Process healing
      this.processHealing(entity, unit, dt, gameTime);

      // Process repair
      this.processRepair(entity, unit, dt);

      // Process autocast repair (look for nearby damaged buildings/mechanical units)
      this.processAutocastRepair(entity, unit);
    }

    // Process bunker attacks
    this.processBunkerAttacks(gameTime);
  }

  private processAutocastRepair(entity: { id: number }, unit: Unit): void {
    // Skip if autocast is disabled or unit can't repair
    if (!unit.autocastRepair || !unit.canRepair) return;

    // Skip if unit is already repairing something
    if (unit.repairTargetId !== null) return;

    // Skip if unit is busy (building, gathering, attacking, etc.)
    if (unit.state !== 'idle') return;

    const repairer = this.world.getEntity(entity.id);
    if (!repairer) return;

    const repairerTransform = repairer.get<Transform>('Transform');
    const repairerSelectable = repairer.get<Selectable>('Selectable');

    if (!repairerTransform || !repairerSelectable) return;

    const autocastRange = 8; // Range to look for damaged things to repair
    let closestTarget: { id: number; distance: number } | null = null;

    // Use spatial grid for O(1) lookups instead of O(n) scans
    // Look for damaged buildings using spatial grid
    const nearbyBuildingIds = this.world.buildingGrid.queryRadius(
      repairerTransform.x,
      repairerTransform.y,
      autocastRange
    );

    for (const buildingId of nearbyBuildingIds) {
      const buildingEntity = this.world.getEntity(buildingId);
      if (!buildingEntity) continue;

      const buildingSelectable = buildingEntity.get<Selectable>('Selectable');
      const buildingHealth = buildingEntity.get<Health>('Health');
      const buildingTransform = buildingEntity.get<Transform>('Transform');
      const building = buildingEntity.get<Building>('Building');

      if (!buildingSelectable || !buildingHealth || !buildingTransform || !building) continue;

      // Only repair own buildings
      if (buildingSelectable.playerId !== repairerSelectable.playerId) continue;

      // Only repair damaged buildings
      if (buildingHealth.current >= buildingHealth.max) continue;

      // Only repair completed buildings
      if (!building.isComplete()) continue;

      // Skip dead buildings
      if (buildingHealth.isDead()) continue;

      // Calculate distance to building edge
      const halfW = building.width / 2;
      const halfH = building.height / 2;
      const clampedX = Math.max(buildingTransform.x - halfW, Math.min(repairerTransform.x, buildingTransform.x + halfW));
      const clampedY = Math.max(buildingTransform.y - halfH, Math.min(repairerTransform.y, buildingTransform.y + halfH));
      const dx = repairerTransform.x - clampedX;
      const dy = repairerTransform.y - clampedY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= autocastRange) {
        if (!closestTarget || distance < closestTarget.distance) {
          closestTarget = { id: buildingId, distance };
        }
      }
    }

    // Look for damaged mechanical units using spatial grid
    const nearbyUnitIds = this.world.unitGrid.queryRadius(
      repairerTransform.x,
      repairerTransform.y,
      autocastRange
    );

    for (const unitId of nearbyUnitIds) {
      if (unitId === entity.id) continue; // Skip self

      const unitEntity = this.world.getEntity(unitId);
      if (!unitEntity) continue;

      const targetUnit = unitEntity.get<Unit>('Unit');
      const targetSelectable = unitEntity.get<Selectable>('Selectable');
      const targetHealth = unitEntity.get<Health>('Health');
      const targetTransform = unitEntity.get<Transform>('Transform');

      if (!targetUnit || !targetSelectable || !targetHealth || !targetTransform) continue;

      // Only repair own mechanical units
      if (targetSelectable.playerId !== repairerSelectable.playerId) continue;
      if (!targetUnit.isMechanical) continue;

      // Only repair damaged units
      if (targetHealth.current >= targetHealth.max) continue;

      // Skip dead units
      if (targetHealth.isDead()) continue;

      // Calculate distance
      const dx = targetTransform.x - repairerTransform.x;
      const dy = targetTransform.y - repairerTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= autocastRange) {
        if (!closestTarget || distance < closestTarget.distance) {
          closestTarget = { id: unitId, distance };
        }
      }
    }

    // Auto-repair the closest target
    if (closestTarget) {
      unit.setRepairTarget(closestTarget.id);
    }
  }

  private processHealing(
    entity: { id: number },
    unit: Unit,
    dt: number,
    gameTime: number
  ): void {
    if (!unit.canHeal || unit.healTargetId === null) return;

    const healer = this.world.getEntity(entity.id);
    if (!healer) return;

    const healerTransform = healer.get<Transform>('Transform');
    const healerAbility = healer.get<Ability>('Ability');

    if (!healerTransform || !healerAbility) return;

    const target = this.world.getEntity(unit.healTargetId);
    if (!target) {
      unit.clearHealTarget();
      return;
    }

    const targetHealth = target.get<Health>('Health');
    const targetTransform = target.get<Transform>('Transform');
    const targetUnit = target.get<Unit>('Unit');

    if (!targetHealth || !targetTransform || !targetUnit) {
      unit.clearHealTarget();
      return;
    }

    // Can only heal biological units
    if (!targetUnit.isBiological) {
      unit.clearHealTarget();
      return;
    }

    // Check if target is at full health
    if (targetHealth.current >= targetHealth.max) {
      unit.clearHealTarget();
      return;
    }

    // Check range
    const dx = targetTransform.x - healerTransform.x;
    const dy = targetTransform.y - healerTransform.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > unit.healRange) {
      // Move toward target
      unit.setMoveTarget(targetTransform.x, targetTransform.y, true);
      return;
    }

    // Check energy
    const energyCost = unit.healEnergyCost * dt;
    if (healerAbility.energy < energyCost) return;

    // Perform healing
    healerAbility.energy -= energyCost;
    const healAmount = unit.healRate * dt;
    targetHealth.heal(healAmount);

    this.game.eventBus.emit('unit:healed', {
      healerId: entity.id,
      targetId: unit.healTargetId,
      amount: healAmount,
    });
  }

  private processRepair(entity: { id: number }, unit: Unit, dt: number): void {
    if (!unit.canRepair || unit.repairTargetId === null) return;

    const repairer = this.world.getEntity(entity.id);
    if (!repairer) return;

    const repairerTransform = repairer.get<Transform>('Transform');
    const repairerSelectable = repairer.get<Selectable>('Selectable');

    if (!repairerTransform || !repairerSelectable) return;

    const target = this.world.getEntity(unit.repairTargetId);
    if (!target) {
      unit.clearRepairTarget();
      return;
    }

    const targetHealth = target.get<Health>('Health');
    const targetTransform = target.get<Transform>('Transform');

    // Can repair buildings or mechanical units
    const targetBuilding = target.get<Building>('Building');
    const targetUnit = target.get<Unit>('Unit');

    if (!targetHealth || !targetTransform) {
      unit.clearRepairTarget();
      return;
    }

    const canRepairTarget =
      targetBuilding || (targetUnit && targetUnit.isMechanical);

    if (!canRepairTarget) {
      unit.clearRepairTarget();
      return;
    }

    // Check if target is at full health
    if (targetHealth.current >= targetHealth.max) {
      unit.clearRepairTarget();
      return;
    }

    // Calculate effective distance - for buildings, measure to edge not center
    const repairRange = 2.0; // Repair range
    let effectiveDistance: number;
    let moveTargetX = targetTransform.x;
    let moveTargetY = targetTransform.y;

    if (targetBuilding) {
      // Calculate closest point on building edge
      const halfW = targetBuilding.width / 2;
      const halfH = targetBuilding.height / 2;
      const clampedX = Math.max(targetTransform.x - halfW, Math.min(repairerTransform.x, targetTransform.x + halfW));
      const clampedY = Math.max(targetTransform.y - halfH, Math.min(repairerTransform.y, targetTransform.y + halfH));
      const edgeDx = repairerTransform.x - clampedX;
      const edgeDy = repairerTransform.y - clampedY;
      effectiveDistance = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

      // Calculate move target at building edge with buffer
      if (effectiveDistance > repairRange) {
        // Direction from building center to repairer
        const dx = repairerTransform.x - targetTransform.x;
        const dy = repairerTransform.y - targetTransform.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.01) {
          const dirX = dx / dist;
          const dirY = dy / dist;
          // Position at building edge + small buffer
          moveTargetX = targetTransform.x + dirX * (Math.max(halfW, halfH) + 0.5);
          moveTargetY = targetTransform.y + dirY * (Math.max(halfW, halfH) + 0.5);
        }
      }
    } else {
      // For units, use center-to-center distance
      const dx = targetTransform.x - repairerTransform.x;
      const dy = targetTransform.y - repairerTransform.y;
      effectiveDistance = Math.sqrt(dx * dx + dy * dy);
    }

    if (effectiveDistance > repairRange) {
      // Move toward target (at edge for buildings)
      // Don't preserve state - need to be in 'moving' state for MovementSystem to work
      unit.targetX = moveTargetX;
      unit.targetY = moveTargetY;
      unit.state = 'moving';
      return;
    }

    // Repair costs resources (simplified: 0.27 minerals per HP for most units)
    const repairRate = 5; // HP per second
    const repairAmount = repairRate * dt;
    const resourceCost = repairAmount * 0.27;

    // For now, skip resource check and just repair
    // In full implementation, would deduct from player resources
    targetHealth.heal(repairAmount);

    this.game.eventBus.emit('unit:repaired', {
      repairerId: entity.id,
      targetId: unit.repairTargetId,
      amount: repairAmount,
    });
  }

  private processBunkerAttacks(gameTime: number): void {
    for (const [bunkerId, data] of this.bunkerData) {
      if (data.loadedUnits.length === 0) continue;

      const bunker = this.world.getEntity(bunkerId);
      if (!bunker) continue;

      const bunkerTransform = bunker.get<Transform>('Transform');
      const bunkerSelectable = bunker.get<Selectable>('Selectable');
      const bunkerHealth = bunker.get<Health>('Health');

      if (!bunkerTransform || !bunkerSelectable || bunkerHealth?.isDead()) continue;

      // Find enemies in range and have garrisoned units attack
      const enemies = this.findEnemiesInRange(
        bunkerTransform.x,
        bunkerTransform.y,
        7, // Bunker attack range
        bunkerSelectable.playerId
      );

      if (enemies.length === 0) continue;

      // Each loaded unit attacks
      for (const unitId of data.loadedUnits) {
        const unitEntity = this.world.getEntity(unitId);
        if (!unitEntity) continue;

        const unit = unitEntity.get<Unit>('Unit');
        if (!unit || !unit.canAttack(gameTime)) continue;

        // Pick closest enemy
        let closestEnemy = enemies[0];
        let closestDist = Infinity;

        for (const enemy of enemies) {
          const enemyTransform = enemy.get<Transform>('Transform')!;
          const dx = enemyTransform.x - bunkerTransform.x;
          const dy = enemyTransform.y - bunkerTransform.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < closestDist) {
            closestDist = dist;
            closestEnemy = enemy;
          }
        }

        const enemyHealth = closestEnemy.get<Health>('Health')!;
        const damage = unit.getEffectiveDamage();
        enemyHealth.takeDamage(damage, gameTime);
        unit.lastAttackTime = gameTime;

        const enemyTransform = closestEnemy.get<Transform>('Transform')!;
        this.game.eventBus.emit('combat:attack', {
          attackerId: unitId,
          attackerPos: { x: bunkerTransform.x, y: bunkerTransform.y },
          targetPos: { x: enemyTransform.x, y: enemyTransform.y },
          damage,
          fromBunker: true,
        });
      }
    }
  }

  private findEnemiesInRange(
    x: number,
    y: number,
    range: number,
    playerId: string
  ): Entity[] {
    const enemies: Entity[] = [];

    // Use spatial grid for O(1) lookups - check both unit and building grids
    const nearbyUnitIds = this.world.unitGrid.queryRadius(x, y, range);
    const nearbyBuildingIds = this.world.buildingGrid.queryRadius(x, y, range);

    // Check units
    for (const unitId of nearbyUnitIds) {
      const entity = this.world.getEntity(unitId);
      if (!entity) continue;

      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');

      if (!selectable || !health || !transform) continue;
      if (selectable.playerId === playerId) continue;
      if (health.isDead()) continue;

      const dx = transform.x - x;
      const dy = transform.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= range) {
        enemies.push(entity);
      }
    }

    // Check buildings
    for (const buildingId of nearbyBuildingIds) {
      const entity = this.world.getEntity(buildingId);
      if (!entity) continue;

      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');

      if (!selectable || !health || !transform) continue;
      if (selectable.playerId === playerId) continue;
      if (health.isDead()) continue;

      const dx = transform.x - x;
      const dy = transform.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= range) {
        enemies.push(entity);
      }
    }

    return enemies;
  }

  // Get bunker data for UI
  public getBunkerData(bunkerId: number): BunkerData | undefined {
    return this.bunkerData.get(bunkerId);
  }
}

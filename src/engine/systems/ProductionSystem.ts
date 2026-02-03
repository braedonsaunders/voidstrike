import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Building, ProductionQueueItem } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Ability, DOMINION_ABILITIES } from '../components/Ability';
import type { IGameInstance } from '../core/IGameInstance';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import {
  BUILDING_DEFINITIONS,
  RESEARCH_MODULE_UNITS,
  PRODUCTION_MODULE_UNITS,
} from '@/data/buildings/dominion';
import { debugProduction, debugSpawning } from '@/utils/debugLogger';
import { EnhancedAISystem } from './EnhancedAISystem';
import { validateEntityAlive } from '@/utils/EntityValidator';

export class ProductionSystem extends System {
  public readonly name = 'ProductionSystem';
  // Priority is set by SystemRegistry based on dependencies (runs after ResourceSystem)

  // Cached reference to AI system (lazy loaded)
  private aiSystem: EnhancedAISystem | null = null;

  constructor(game: IGameInstance) {
    super(game);
    this.setupEventListeners();
  }

  /**
   * Get the AI system (lazy loaded and cached)
   */
  private getAISystem(): EnhancedAISystem | null {
    if (!this.aiSystem) {
      this.aiSystem = this.world.getSystem(EnhancedAISystem) || null;
    }
    return this.aiSystem;
  }

  /**
   * Check if a player is controlled by AI
   */
  private isAIPlayer(playerId: string): boolean {
    const aiSystem = this.getAISystem();
    return aiSystem?.isAIPlayer(playerId) ?? false;
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:train', this.handleTrainCommand.bind(this));
    this.game.eventBus.on('command:build', this.handleBuildCommand.bind(this));
    this.game.eventBus.on('command:upgrade_building', this.handleUpgradeBuildingCommand.bind(this));
    // Multiplayer-synced production commands
    this.game.eventBus.on('production:cancel', this.handleCancelProductionCommand.bind(this));
    this.game.eventBus.on('production:reorder', this.handleReorderQueueCommand.bind(this));
  }

  private handleCancelProductionCommand(command: {
    entityId: number;
    queueIndex: number;
    playerId?: string;
  }): void {
    const entity = this.world.getEntity(command.entityId);
    if (
      !validateEntityAlive(
        entity,
        command.entityId,
        'ProductionSystem:handleCancelProductionCommand'
      )
    )
      return;

    const building = entity.get<Building>('Building');
    if (!building) return;

    const cancelled = building.cancelProduction(command.queueIndex);
    if (cancelled) {
      const unitDef = UNIT_DEFINITIONS[cancelled.id];
      if (unitDef) {
        const selectable = entity.get<Selectable>('Selectable');
        const playerId = selectable?.playerId;
        const refundPercent = cancelled.progress < 0.5 ? 1 : 0.5;
        const produceCount = cancelled.produceCount || 1;
        const mineralRefund = Math.floor(unitDef.mineralCost * produceCount * refundPercent);
        const plasmaRefund = Math.floor(unitDef.plasmaCost * produceCount * refundPercent);

        // Check AI status FIRST before checking local player
        const aiSystem = this.getAISystem();
        const aiPlayer = playerId ? aiSystem?.getAIPlayer(playerId) : undefined;

        if (aiPlayer) {
          // Refund to AI player
          aiPlayer.minerals += mineralRefund;
          aiPlayer.plasma += plasmaRefund;
          if (cancelled.supplyAllocated) {
            // Note: AI supply is recalculated from entities, no manual adjustment needed
          }
        } else if (playerId === this.game.config.playerId) {
          // Refund to local human player
          this.game.statePort.addResources(mineralRefund, plasmaRefund);
          if (cancelled.supplyAllocated) {
            this.game.statePort.addSupply(-cancelled.supplyCost);
          }
        }
      }

      this.game.eventBus.emit('production:cancelled', {
        buildingId: command.entityId,
        itemId: cancelled.id,
        itemType: cancelled.type,
      });
    }
  }

  private handleReorderQueueCommand(command: {
    entityId: number;
    queueIndex: number;
    newQueueIndex: number;
    playerId?: string;
  }): void {
    const entity = this.world.getEntity(command.entityId);
    if (
      !validateEntityAlive(entity, command.entityId, 'ProductionSystem:handleReorderQueueCommand')
    )
      return;

    const building = entity.get<Building>('Building');
    if (!building) return;

    // Determine direction and call appropriate method
    if (command.newQueueIndex < command.queueIndex) {
      building.moveQueueItemUp(command.queueIndex);
    } else if (command.newQueueIndex > command.queueIndex) {
      building.moveQueueItemDown(command.queueIndex);
    }
  }

  private handleTrainCommand(command: { entityIds: number[]; unitType: string }): void {
    const { entityIds, unitType } = command;
    const unitDef = UNIT_DEFINITIONS[unitType];

    if (!unitDef) {
      debugProduction.warn(`Unknown unit type: ${unitType}`);
      return;
    }

    // Find all valid buildings that can produce this unit, then pick the one with shortest queue
    let bestBuilding: {
      entityId: number;
      building: Building;
      selectable: Selectable | undefined;
    } | null = null;
    let shortestQueueLength = Infinity;

    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!validateEntityAlive(entity, entityId, 'ProductionSystem:handleTrainCommand')) continue;

      const building = entity.get<Building>('Building');
      if (!building || !building.isComplete()) continue;

      // Check if building can produce this unit:
      // 1. Unit is in canProduce (basic units), OR
      // 2. Unit is in RESEARCH_MODULE_UNITS for this building type AND building has tech lab
      const canProduceBasic = building.canProduce.includes(unitType);
      const techGatedUnits = RESEARCH_MODULE_UNITS[building.buildingId] || [];
      const canProduceTechGated = techGatedUnits.includes(unitType) && building.hasTechLab();

      if (!canProduceBasic && !canProduceTechGated) continue;

      // Track building with shortest queue
      if (building.productionQueue.length < shortestQueueLength) {
        shortestQueueLength = building.productionQueue.length;
        const selectable = entity.get<Selectable>('Selectable');
        bestBuilding = { entityId, building, selectable };
      }
    }

    if (!bestBuilding) return;

    // Determine if building owner is AI
    const ownerPlayerId = bestBuilding.selectable?.playerId;
    const isOwnerAI = ownerPlayerId ? this.isAIPlayer(ownerPlayerId) : false;

    // FIX: AI players have already deducted resources via EnhancedAISystem
    // Only check/deduct from game store for human players (local player)
    if (!isOwnerAI) {
      // Human player - check resources from game store
      if (this.game.statePort.getMinerals() < unitDef.mineralCost) {
        this.game.eventBus.emit('alert:notEnoughMinerals', {});
        this.game.eventBus.emit('warning:lowMinerals', {});
        return;
      }
      if (this.game.statePort.getPlasma() < unitDef.plasmaCost) {
        this.game.eventBus.emit('alert:notEnoughPlasma', {});
        this.game.eventBus.emit('warning:lowPlasma', {});
        return;
      }
    }
    // Note: AI resources are checked and deducted in EnhancedAISystem before this is called

    // Note: Supply is only checked when unit starts producing, not when queueing.
    // This allows unlimited queueing - supply is allocated for the active unit only.

    // Check if building has reactor and unit is reactor-eligible (double production = 2 units)
    const reactorUnits = PRODUCTION_MODULE_UNITS[bestBuilding.building.buildingId] || [];
    const hasReactorBonus = bestBuilding.building.hasReactor() && reactorUnits.includes(unitType);

    // Determine how many units to produce: 2 if reactor bonus AND enough resources, else 1
    let produceCount = 1;
    if (hasReactorBonus) {
      if (isOwnerAI) {
        // AI: already checked resources, assume they can afford 2 if they have reactor
        // (AI should only trigger this if it can afford)
        produceCount = 2;
      } else {
        // Human: check if they can afford two
        const canAffordTwo =
          this.game.statePort.getMinerals() >= unitDef.mineralCost * 2 &&
          this.game.statePort.getPlasma() >= unitDef.plasmaCost * 2;
        produceCount = canAffordTwo ? 2 : 1;
      }
    }

    // Deduct resources based on produceCount (only for human players)
    if (!isOwnerAI) {
      this.game.statePort.addResources(
        -unitDef.mineralCost * produceCount,
        -unitDef.plasmaCost * produceCount
      );
    }
    // AI resources were already deducted in EnhancedAISystem

    // Add to production queue with supply cost stored (doubled for reactor)
    // Supply allocation is handled in the update() loop when the item starts producing
    bestBuilding.building.addToProductionQueue(
      'unit',
      unitType,
      unitDef.buildTime,
      unitDef.supplyCost * produceCount,
      produceCount
    );

    this.game.eventBus.emit('production:started', {
      buildingId: bestBuilding.entityId,
      unitType,
      hasReactorBonus,
    });
  }

  private handleBuildCommand(command: {
    entityIds: number[];
    buildingType: string;
    targetPosition: { x: number; y: number };
  }): void {
    // Building placement is handled by the UI/placement system
    // This just signals the intent
    this.game.eventBus.emit('building:place', {
      workerIds: command.entityIds,
      buildingType: command.buildingType,
      position: command.targetPosition,
    });
  }

  private handleUpgradeBuildingCommand(command: { entityIds: number[]; upgradeTo: string }): void {
    const { entityIds, upgradeTo } = command;
    const upgradeDef = BUILDING_DEFINITIONS[upgradeTo];

    if (!upgradeDef) {
      debugProduction.warn(`Unknown building type: ${upgradeTo}`);
      return;
    }

    // Check resources
    if (this.game.statePort.getMinerals() < upgradeDef.mineralCost) {
      this.game.eventBus.emit('alert:notEnoughMinerals', {});
      this.game.eventBus.emit('warning:lowMinerals', {});
      return;
    }
    if (this.game.statePort.getPlasma() < upgradeDef.plasmaCost) {
      this.game.eventBus.emit('alert:notEnoughPlasma', {});
      this.game.eventBus.emit('warning:lowPlasma', {});
      return;
    }

    // Find first valid building that can upgrade
    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const building = entity.get<Building>('Building');
      if (!building || !building.isComplete()) continue;

      // Check if this building can upgrade to the target
      if (!building.canUpgradeTo || !building.canUpgradeTo.includes(upgradeTo)) continue;

      // Check if already upgrading
      const isUpgrading = building.productionQueue.some(
        (item) => item.type === 'upgrade' && building.canUpgradeTo?.includes(item.id)
      );
      if (isUpgrading) continue;

      // Deduct resources
      this.game.statePort.addResources(-upgradeDef.mineralCost, -upgradeDef.plasmaCost);

      // Add to production queue as 'upgrade' type with building ID
      building.addToProductionQueue('upgrade', upgradeTo, upgradeDef.buildTime);

      this.game.eventBus.emit('building:upgrade_started', {
        buildingId: entityId,
        upgradeTo,
      });

      return; // Only upgrade one building
    }
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000;
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Health');

    for (const entity of buildings) {
      const building = entity.get<Building>('Building');
      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');

      // Defensive null checks
      if (!building || !transform || !health) continue;

      // Skip destroyed buildings
      if (health.isDead()) continue;

      // NOTE: Construction is handled by BuildingPlacementSystem which properly updates health
      // Skip buildings still under construction
      if (building.state === 'constructing' || building.state === 'waiting_for_worker') {
        continue;
      }

      // Check if production is supply-blocked
      if (building.productionQueue.length > 0) {
        const currentItem = building.productionQueue[0];

        // Check if we need to allocate supply for this item
        // An item needs supply allocated if it's a unit with supplyCost > 0
        // and supply hasn't been allocated yet
        if (
          currentItem.type === 'unit' &&
          currentItem.supplyCost > 0 &&
          !currentItem.supplyAllocated
        ) {
          // FIX: Only use game store for human players, not AI
          const selectable = entity.get<Selectable>('Selectable');
          const ownerPlayerId = selectable?.playerId;
          const isOwnerAI = ownerPlayerId ? this.isAIPlayer(ownerPlayerId) : false;

          if (isOwnerAI) {
            // AI supply is managed by EnhancedAISystem - just mark as allocated
            currentItem.supplyAllocated = true;
          } else {
            // Human player - use game store for supply tracking
            // Try to allocate supply if there's room
            if (
              this.game.statePort.getSupply() + currentItem.supplyCost <=
              this.game.statePort.getMaxSupply()
            ) {
              // We have room - allocate supply
              this.game.statePort.addSupply(currentItem.supplyCost);
              currentItem.supplyAllocated = true;
            } else {
              // No room - skip this building (supply blocked)
              continue;
            }
          }
        }
      }

      // Update production
      const completed = building.updateProduction(dt);
      if (completed) {
        this.handleProductionComplete(entity.id, building, transform, completed);
        // Note: Supply for the next item (if any) will be allocated on the next update() tick
        // when the progress === 0 check passes. This avoids duplicate allocation.
      }
    }
  }

  private handleProductionComplete(
    buildingId: number,
    building: Building,
    buildingTransform: Transform,
    item: ProductionQueueItem
  ): void {
    if (item.type === 'unit') {
      // Spawn the unit(s) near the building (not at rally point)
      // For reactor bonus, produceCount will be 2
      const baseSpawnX = buildingTransform.x + building.width / 2 + 1;
      const baseSpawnY = buildingTransform.y;

      // Get the building's owner from its Selectable component
      const buildingEntity = this.world.getEntity(buildingId);
      // Building should still exist since we're in its production callback
      const selectable = buildingEntity?.isDestroyed()
        ? undefined
        : buildingEntity?.get<Selectable>('Selectable');
      const ownerPlayerId = selectable?.playerId;

      // Spawn multiple units if produceCount > 1 (reactor bonus)
      for (let i = 0; i < item.produceCount; i++) {
        // Offset spawn position slightly for multiple units to avoid overlap
        const spawnX = baseSpawnX + i * 0.5;
        const spawnY = baseSpawnY + i * 0.5;

        // Diagnostic: log when units are spawned (helps debug AI production issues)
        debugSpawning.log(
          `[ProductionSystem] ${ownerPlayerId}: Spawning ${item.id} at (${spawnX.toFixed(1)}, ${spawnY.toFixed(1)})`
        );

        this.game.eventBus.emit('unit:spawn', {
          unitType: item.id,
          x: spawnX,
          y: spawnY,
          playerId: ownerPlayerId,
          // Pass rally point coordinates so unit walks there after spawn
          rallyX: building.rallyX,
          rallyY: building.rallyY,
          // Pass rally target for auto-gather (workers rallied to resources)
          rallyTargetId: building.rallyTargetId,
        });
      }

      // Emit production complete for Phaser overlay (local player's units only)
      if (ownerPlayerId === this.game.config.playerId) {
        const unitDef = UNIT_DEFINITIONS[item.id];
        this.game.eventBus.emit('production:complete', {
          buildingId,
          unitType: item.id,
          unitName: unitDef?.name ?? item.id,
          produceCount: item.produceCount,
        });
      }
    } else if (item.type === 'upgrade') {
      // Check if this is a building upgrade or research upgrade
      const upgradeBuildingDef = BUILDING_DEFINITIONS[item.id];
      if (upgradeBuildingDef) {
        // This is a building upgrade (e.g., CC -> Orbital Command)
        this.handleBuildingUpgradeComplete(buildingId, building, item.id, upgradeBuildingDef);
      } else {
        // This is a research upgrade - emit for Phaser overlay
        const buildingEntity = this.world.getEntity(buildingId);
        const buildingSelectable = buildingEntity?.isDestroyed()
          ? undefined
          : buildingEntity?.get<Selectable>('Selectable');
        if (buildingSelectable?.playerId === this.game.config.playerId) {
          this.game.eventBus.emit('research:complete', {
            buildingId,
            upgradeId: item.id,
            researchName: item.id.replace(/_/g, ' '),
          });
        }
      }
    }
  }

  private handleBuildingUpgradeComplete(
    buildingId: number,
    building: Building,
    newBuildingType: string,
    newDef: (typeof BUILDING_DEFINITIONS)[string]
  ): void {
    // Transform the building to the new type
    building.buildingId = newDef.id;
    building.name = newDef.name;
    building.canProduce = newDef.canProduce ?? [];
    building.canResearch = newDef.canResearch ?? [];
    building.canUpgradeTo = newDef.canUpgradeTo ?? [];
    building.canLiftOff = newDef.canLiftOff ?? false;
    building.attackRange = newDef.attackRange ?? 0;
    building.attackDamage = newDef.attackDamage ?? 0;
    building.attackSpeed = newDef.attackSpeed ?? 0;
    building.isDetector = newDef.isDetector ?? false;
    building.detectionRange = newDef.detectionRange ?? 0;

    // Update entity for mesh refresh
    const entity = this.world.getEntity(buildingId);
    if (validateEntityAlive(entity, buildingId, 'ProductionSystem:handleBuildingUpgradeComplete')) {
      const health = entity.get<Health>('Health');
      if (health && newDef.maxHealth) {
        // Keep current health percentage, apply to new max
        const healthPercent = health.current / health.max;
        health.max = newDef.maxHealth;
        health.current = Math.round(newDef.maxHealth * healthPercent);
      }

      // Add abilities for Orbital Station
      if (newBuildingType === 'orbital_station') {
        const orbitalAbilities = [
          DOMINION_ABILITIES.mule,
          DOMINION_ABILITIES.scanner_sweep,
          DOMINION_ABILITIES.supply_drop,
        ];
        // Orbital Station starts with 50 energy, max 200, regen 0.5625/sec
        const abilityComponent = new Ability(200, 0.5625, orbitalAbilities);
        abilityComponent.energy = 50; // Start with 50 energy
        entity.add(abilityComponent);
        debugProduction.log(`[ProductionSystem] Added abilities to Orbital Station ${buildingId}`);
      }
    }

    this.game.eventBus.emit('building:upgraded', {
      buildingId,
      newType: newBuildingType,
    });

    debugProduction.log(`[ProductionSystem] Building ${buildingId} upgraded to ${newDef.name}`);
  }
}

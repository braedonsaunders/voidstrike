import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Building, ProductionQueueItem } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Ability, DOMINION_ABILITIES } from '../components/Ability';
import { Game } from '../core/Game';
import { useGameStore } from '@/store/gameStore';
import { isLocalPlayer } from '@/store/gameSetupStore';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS, RESEARCH_MODULE_UNITS, PRODUCTION_MODULE_UNITS } from '@/data/buildings/dominion';
import { debugProduction } from '@/utils/debugLogger';

export class ProductionSystem extends System {
  public readonly name = 'ProductionSystem';
  public priority = 30;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:train', this.handleTrainCommand.bind(this));
    this.game.eventBus.on('command:build', this.handleBuildCommand.bind(this));
    this.game.eventBus.on('command:upgrade_building', this.handleUpgradeBuildingCommand.bind(this));
  }

  private handleTrainCommand(command: {
    entityIds: number[];
    unitType: string;
  }): void {
    const { entityIds, unitType } = command;
    const unitDef = UNIT_DEFINITIONS[unitType];

    if (!unitDef) {
      debugProduction.warn(`Unknown unit type: ${unitType}`);
      return;
    }

    const store = useGameStore.getState();

    // Check resources
    if (store.minerals < unitDef.mineralCost) {
      this.game.eventBus.emit('ui:error', { message: 'Not enough minerals' });
      this.game.eventBus.emit('warning:lowMinerals', {});
      return;
    }
    if (store.vespene < unitDef.vespeneCost) {
      this.game.eventBus.emit('ui:error', { message: 'Not enough vespene' });
      this.game.eventBus.emit('warning:lowVespene', {});
      return;
    }

    // Note: Supply is only checked when unit starts producing, not when queueing.
    // This allows unlimited queueing - supply is allocated for the active unit only.

    // Find all valid buildings that can produce this unit, then pick the one with shortest queue
    let bestBuilding: { entityId: number; building: Building } | null = null;
    let shortestQueueLength = Infinity;

    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

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
        bestBuilding = { entityId, building };
      }
    }

    if (!bestBuilding) return;

    // Deduct resources
    store.addResources(-unitDef.mineralCost, -unitDef.vespeneCost);

    // Check if building has reactor and unit is reactor-eligible (double production = halved build time)
    const reactorUnits = PRODUCTION_MODULE_UNITS[bestBuilding.building.buildingId] || [];
    const hasReactorBonus = bestBuilding.building.hasReactor() && reactorUnits.includes(unitType);
    const effectiveBuildTime = hasReactorBonus ? unitDef.buildTime / 2 : unitDef.buildTime;

    // Add to production queue with supply cost stored
    // Supply allocation is handled in the update() loop when the item starts producing
    bestBuilding.building.addToProductionQueue('unit', unitType, effectiveBuildTime, unitDef.supplyCost);

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

  private handleUpgradeBuildingCommand(command: {
    entityIds: number[];
    upgradeTo: string;
  }): void {
    const { entityIds, upgradeTo } = command;
    const upgradeDef = BUILDING_DEFINITIONS[upgradeTo];

    if (!upgradeDef) {
      debugProduction.warn(`Unknown building type: ${upgradeTo}`);
      return;
    }

    const store = useGameStore.getState();

    // Check resources
    if (store.minerals < upgradeDef.mineralCost) {
      this.game.eventBus.emit('ui:error', { message: 'Not enough minerals' });
      this.game.eventBus.emit('warning:lowMinerals', {});
      return;
    }
    if (store.vespene < upgradeDef.vespeneCost) {
      this.game.eventBus.emit('ui:error', { message: 'Not enough vespene' });
      this.game.eventBus.emit('warning:lowVespene', {});
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
        (item) => item.type === 'upgrade' && building.canUpgradeTo.includes(item.id)
      );
      if (isUpgrading) continue;

      // Deduct resources
      store.addResources(-upgradeDef.mineralCost, -upgradeDef.vespeneCost);

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
        const store = useGameStore.getState();

        // Check if we need to allocate supply for this item
        // An item needs supply allocated if it's a unit with supplyCost > 0
        // and supply hasn't been allocated yet
        if (currentItem.type === 'unit' && currentItem.supplyCost > 0 && !currentItem.supplyAllocated) {
          // Try to allocate supply if there's room
          if (store.supply + currentItem.supplyCost <= store.maxSupply) {
            // We have room - allocate supply
            store.addSupply(currentItem.supplyCost);
            currentItem.supplyAllocated = true;
          } else {
            // No room - skip this building (supply blocked)
            continue;
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
      // Spawn the unit near the building (not at rally point)
      const spawnX = buildingTransform.x + building.width / 2 + 1;
      const spawnY = buildingTransform.y;

      // Get the building's owner from its Selectable component
      const buildingEntity = this.world.getEntity(buildingId);
      const selectable = buildingEntity?.get<Selectable>('Selectable');
      const ownerPlayerId = selectable?.playerId;

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

      // Emit production complete for Phaser overlay (local player's units only)
      if (ownerPlayerId && isLocalPlayer(ownerPlayerId)) {
        const unitDef = UNIT_DEFINITIONS[item.id];
        this.game.eventBus.emit('production:complete', {
          buildingId,
          unitType: item.id,
          unitName: unitDef?.name ?? item.id,
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
        const buildingSelectable = buildingEntity?.get<Selectable>('Selectable');
        if (buildingSelectable?.playerId && isLocalPlayer(buildingSelectable.playerId)) {
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
    newDef: typeof BUILDING_DEFINITIONS[string]
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
    if (entity) {
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

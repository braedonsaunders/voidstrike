import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Ability, DOMINION_ABILITIES } from '../components/Ability';
import { Game } from '../core/Game';
import { useGameStore } from '@/store/gameStore';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';

export class ProductionSystem extends System {
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
      console.warn(`Unknown unit type: ${unitType}`);
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

    // Check supply
    if (store.supply + unitDef.supplyCost > store.maxSupply) {
      this.game.eventBus.emit('ui:error', { message: 'Not enough supply' });
      this.game.eventBus.emit('warning:supplyBlocked', {});
      return;
    }

    // Find first valid building
    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const building = entity.get<Building>('Building');
      if (!building || !building.isComplete()) continue;

      if (!building.canProduce.includes(unitType)) continue;

      // Deduct resources
      store.addResources(-unitDef.mineralCost, -unitDef.vespeneCost);
      store.addSupply(unitDef.supplyCost);

      // Add to production queue
      building.addToProductionQueue('unit', unitType, unitDef.buildTime);

      this.game.eventBus.emit('production:started', {
        buildingId: entityId,
        unitType,
      });

      return; // Only train from one building
    }
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
      console.warn(`Unknown building type: ${upgradeTo}`);
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
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      // Skip destroyed buildings
      if (health.isDead()) continue;

      // Update construction
      if (building.state === 'constructing') {
        const wasComplete = building.isComplete();
        building.updateConstruction(dt);

        if (!wasComplete && building.isComplete()) {
          const selectable = entity.get<Selectable>('Selectable');
          const buildingDef = BUILDING_DEFINITIONS[building.buildingId];

          // Emit building complete for Phaser overlay (player buildings only)
          if (selectable?.playerId === 'player1') {
            this.game.eventBus.emit('building:complete', {
              entityId: entity.id,
              buildingType: building.buildingId,
              buildingName: buildingDef?.name ?? building.buildingId,
            });
          }

          // Add supply if applicable
          if (building.supplyProvided > 0) {
            useGameStore.getState().addMaxSupply(building.supplyProvided);
          }

          // Set default rally point for production buildings
          if (building.canProduce.length > 0 && building.rallyX === null) {
            // Default rally point is in front of the building (offset by building size)
            building.setRallyPoint(
              transform.x + building.width / 2 + 3,
              transform.y
            );
          }
        }
      }

      // Update production
      const completed = building.updateProduction(dt);
      if (completed) {
        this.handleProductionComplete(entity.id, building, transform, completed);
      }
    }
  }

  private handleProductionComplete(
    buildingId: number,
    building: Building,
    buildingTransform: Transform,
    item: { type: string; id: string }
  ): void {
    if (item.type === 'unit') {
      // Spawn the unit at rally point or near building
      const spawnX = building.rallyX ?? buildingTransform.x + building.width + 1;
      const spawnY = building.rallyY ?? buildingTransform.y + building.height / 2;

      // Get the building's owner from its Selectable component
      const buildingEntity = this.world.getEntity(buildingId);
      const selectable = buildingEntity?.get<Selectable>('Selectable');
      const ownerPlayerId = selectable?.playerId ?? 'player1';

      this.game.eventBus.emit('unit:spawn', {
        unitType: item.id,
        x: spawnX,
        y: spawnY,
        playerId: ownerPlayerId,
      });

      // Emit production complete for Phaser overlay (player units only)
      if (ownerPlayerId === 'player1') {
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
        if (buildingSelectable?.playerId === 'player1') {
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

      // Add abilities for Orbital Command
      if (newBuildingType === 'orbital_command') {
        const orbitalAbilities = [
          DOMINION_ABILITIES.mule,
          DOMINION_ABILITIES.scanner_sweep,
          DOMINION_ABILITIES.supply_drop,
        ];
        // Orbital Command starts with 50 energy, max 200, regen 0.5625/sec
        const abilityComponent = new Ability(200, 0.5625, orbitalAbilities);
        abilityComponent.energy = 50; // Start with 50 energy
        entity.add(abilityComponent);
        console.log(`[ProductionSystem] Added abilities to Orbital Command ${buildingId}`);
      }
    }

    this.game.eventBus.emit('building:upgraded', {
      buildingId,
      newType: newBuildingType,
    });

    console.log(`[ProductionSystem] Building ${buildingId} upgraded to ${newDef.name}`);
  }
}

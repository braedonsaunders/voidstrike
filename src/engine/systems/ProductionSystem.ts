import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Game } from '../core/Game';
import { useGameStore } from '@/store/gameStore';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';

export class ProductionSystem extends System {
  public priority = 30;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:train', this.handleTrainCommand.bind(this));
    this.game.eventBus.on('command:build', this.handleBuildCommand.bind(this));
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
    if (
      store.minerals < unitDef.mineralCost ||
      store.vespene < unitDef.vespeneCost
    ) {
      this.game.eventBus.emit('ui:error', { message: 'Not enough resources' });
      return;
    }

    // Check supply
    if (store.supply + unitDef.supplyCost > store.maxSupply) {
      this.game.eventBus.emit('ui:error', { message: 'Not enough supply' });
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
          this.game.eventBus.emit('building:complete', {
            entityId: entity.id,
            buildingType: building.buildingId,
          });

          // Add supply if applicable
          if (building.supplyProvided > 0) {
            useGameStore.getState().addMaxSupply(building.supplyProvided);
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

      this.game.eventBus.emit('unit:spawn', {
        unitType: item.id,
        x: spawnX,
        y: spawnY,
        playerId: 'player1', // TODO: Get from building owner
      });

      this.game.eventBus.emit('production:complete', {
        buildingId,
        unitType: item.id,
      });
    } else if (item.type === 'upgrade') {
      this.game.eventBus.emit('research:complete', {
        buildingId,
        upgradeId: item.id,
      });
    }
  }
}

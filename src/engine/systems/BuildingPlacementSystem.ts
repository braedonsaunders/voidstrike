import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Transform } from '../components/Transform';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Unit } from '../components/Unit';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { useGameStore } from '@/store/gameStore';

/**
 * BuildingPlacementSystem handles placing new buildings when workers construct them
 */
export class BuildingPlacementSystem extends System {
  public priority = 10;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Handle building placement from UI or workers
    this.game.eventBus.on('building:place', this.handleBuildingPlace.bind(this));

    // Handle instant building completion (for testing/cheats)
    this.game.eventBus.on('building:complete:instant', this.handleInstantComplete.bind(this));
  }

  private handleBuildingPlace(data: {
    buildingType: string;
    position: { x: number; y: number };
    workerId?: number;
    playerId?: string;
  }): void {
    const { buildingType, position, playerId = 'player1' } = data;
    const definition = BUILDING_DEFINITIONS[buildingType];

    if (!definition) {
      console.warn(`BuildingPlacementSystem: Unknown building type: ${buildingType}`);
      this.game.eventBus.emit('ui:error', { message: `Unknown building: ${buildingType}` });
      return;
    }

    const store = useGameStore.getState();

    // Check resources
    if (store.minerals < definition.mineralCost || store.vespene < definition.vespeneCost) {
      this.game.eventBus.emit('ui:error', { message: 'Not enough resources' });
      return;
    }

    // Check placement validity (simple check - could be enhanced)
    if (!this.isValidPlacement(position.x, position.y, definition.width, definition.height)) {
      this.game.eventBus.emit('ui:error', { message: 'Invalid placement' });
      return;
    }

    // Deduct resources
    store.addResources(-definition.mineralCost, -definition.vespeneCost);

    // Create the building entity
    const entity = this.world.createEntity();
    entity
      .add(new Transform(position.x, position.y, 0))
      .add(new Building(definition))
      .add(new Health(definition.maxHealth * 0.1, definition.armor, 'structure')) // Start at 10% health
      .add(new Selectable(definition.width, 10, playerId));

    // Building starts in 'constructing' state automatically from Building constructor

    // Emit placement success event
    this.game.eventBus.emit('building:placed', {
      entityId: entity.id,
      buildingType,
      playerId,
      position,
    });

    console.log(`BuildingPlacementSystem: Placed ${definition.name} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}) for ${playerId}`);
  }

  private handleInstantComplete(data: { entityId: number }): void {
    const entity = this.world.getEntity(data.entityId);
    if (!entity) return;

    const building = entity.get<Building>('Building');
    const health = entity.get<Health>('Health');

    if (building && health) {
      building.buildProgress = 1;
      building.state = 'complete';
      health.current = health.max; // Full health when complete

      // Add supply if applicable
      if (building.supplyProvided > 0) {
        useGameStore.getState().addMaxSupply(building.supplyProvided);
      }

      this.game.eventBus.emit('building:complete', {
        entityId: data.entityId,
        buildingType: building.buildingId,
      });
    }
  }

  private isValidPlacement(x: number, y: number, width: number, height: number): boolean {
    // Check map bounds
    const config = this.game.config;
    if (x < 0 || y < 0 || x + width > config.mapWidth || y + height > config.mapHeight) {
      return false;
    }

    // Check for overlapping buildings
    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;

      // Simple AABB collision check
      if (
        x < transform.x + building.width &&
        x + width > transform.x &&
        y < transform.y + building.height &&
        y + height > transform.y
      ) {
        return false;
      }
    }

    // Check for overlapping resources
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;

      // Resources are roughly 2x2
      if (
        x < transform.x + 2 &&
        x + width > transform.x &&
        y < transform.y + 2 &&
        y + height > transform.y
      ) {
        return false;
      }
    }

    return true;
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000;

    // Update construction progress for all buildings
    const buildings = this.world.getEntitiesWith('Building', 'Health');

    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health')!;

      if (building.state === 'constructing') {
        const wasComplete = building.isComplete();
        building.updateConstruction(dt);

        // Gradually restore health as construction progresses
        if (!building.isComplete()) {
          health.current = health.max * building.buildProgress;
        }

        // Check if just completed
        if (!wasComplete && building.isComplete()) {
          health.current = health.max;

          // Add supply if applicable
          if (building.supplyProvided > 0) {
            useGameStore.getState().addMaxSupply(building.supplyProvided);
          }

          this.game.eventBus.emit('building:complete', {
            entityId: entity.id,
            buildingType: building.buildingId,
          });

          console.log(`BuildingPlacementSystem: ${building.name} construction complete!`);
        }
      }
    }
  }
}

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
    const { buildingType, playerId = 'player1' } = data;
    const definition = BUILDING_DEFINITIONS[buildingType];

    if (!definition) {
      console.warn(`BuildingPlacementSystem: Unknown building type: ${buildingType}`);
      this.game.eventBus.emit('ui:error', { message: `Unknown building: ${buildingType}` });
      return;
    }

    // Snap click position to grid for clean placement (center-based)
    const snappedX = Math.round(data.position.x);
    const snappedY = Math.round(data.position.y);

    const store = useGameStore.getState();

    // Check resources
    if (store.minerals < definition.mineralCost || store.vespene < definition.vespeneCost) {
      this.game.eventBus.emit('ui:error', { message: 'Not enough resources' });
      return;
    }

    // Check building dependencies (tech requirements)
    if (definition.requirements && definition.requirements.length > 0) {
      const missingDep = this.checkBuildingDependencies(definition.requirements, playerId);
      if (missingDep) {
        this.game.eventBus.emit('ui:error', { message: `Requires ${missingDep}` });
        return;
      }
    }

    // Check placement validity using center position
    if (!this.isValidPlacement(snappedX, snappedY, definition.width, definition.height)) {
      this.game.eventBus.emit('ui:error', { message: 'Cannot build here - area blocked' });
      return;
    }

    // Deduct resources
    store.addResources(-definition.mineralCost, -definition.vespeneCost);

    // Create the building entity at the snapped center position
    const entity = this.world.createEntity();
    entity
      .add(new Transform(snappedX, snappedY, 0))
      .add(new Building(definition))
      .add(new Health(definition.maxHealth * 0.1, definition.armor, 'structure')) // Start at 10% health
      .add(new Selectable(Math.max(definition.width, definition.height) * 0.6, 10, playerId));

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

  /**
   * Check if all required buildings exist for the player
   * Returns the name of the first missing requirement, or null if all met
   */
  private checkBuildingDependencies(requirements: string[], playerId: string): string | null {
    const playerBuildings = this.world.getEntitiesWith('Building', 'Selectable');

    for (const reqBuildingId of requirements) {
      let found = false;

      for (const entity of playerBuildings) {
        const building = entity.get<Building>('Building')!;
        const selectable = entity.get<Selectable>('Selectable')!;

        // Check if this building belongs to the player and is the required type
        if (selectable.playerId === playerId && building.buildingId === reqBuildingId) {
          // Must be complete (not under construction)
          if (building.isComplete()) {
            found = true;
            break;
          }
        }
      }

      if (!found) {
        // Return human-readable name
        const def = BUILDING_DEFINITIONS[reqBuildingId];
        return def?.name || reqBuildingId;
      }
    }

    return null; // All requirements met
  }

  private isValidPlacement(centerX: number, centerY: number, width: number, height: number): boolean {
    // Check map bounds (center-based)
    const config = this.game.config;
    const halfW = width / 2;
    const halfH = height / 2;

    if (centerX - halfW < 0 || centerY - halfH < 0 ||
        centerX + halfW > config.mapWidth || centerY + halfH > config.mapHeight) {
      return false;
    }

    // Check for overlapping buildings (center-to-center with half-width separation)
    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;

      // Both positions are centers - check if bounding boxes overlap
      const existingHalfW = building.width / 2;
      const existingHalfH = building.height / 2;

      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      // Add a small buffer (0.5) to prevent buildings from touching
      if (dx < halfW + existingHalfW + 0.5 && dy < halfH + existingHalfH + 0.5) {
        return false;
      }
    }

    // Check for overlapping resources (resources are point-based with ~2 unit radius)
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;

      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      // Resources have roughly 1.5 unit radius, add building half-size
      if (dx < halfW + 1.5 && dy < halfH + 1.5) {
        return false;
      }
    }

    // Check for overlapping units (don't build on top of units)
    const units = this.world.getEntitiesWith('Unit', 'Transform');
    for (const entity of units) {
      const transform = entity.get<Transform>('Transform')!;

      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      // Units have roughly 0.5 unit radius
      if (dx < halfW + 0.5 && dy < halfH + 0.5) {
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

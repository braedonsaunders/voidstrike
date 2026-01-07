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
 * BuildingPlacementSystem handles placing new buildings when workers construct them.
 *
 * Flow:
 * 1. Player selects worker and clicks to place building
 * 2. Resources are deducted, building entity is created (constructing state)
 * 3. Worker is assigned to build and walks to the site
 * 4. When worker arrives, they begin construction
 * 5. Construction only progresses while a worker is actively constructing
 * 6. When complete, worker is released and returns to idle
 */
export class BuildingPlacementSystem extends System {
  public priority = 10;

  // Distance threshold for worker to be "at" the building site
  private readonly CONSTRUCTION_RANGE = 2.5;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Handle building placement from UI
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

    // Find a worker to assign to this construction
    const worker = this.findWorkerForConstruction(data.workerId, playerId);
    if (!worker) {
      this.game.eventBus.emit('ui:error', { message: 'No worker available' });
      return;
    }

    // Deduct resources
    store.addResources(-definition.mineralCost, -definition.vespeneCost);

    // Create the building entity at the snapped center position
    const buildingEntity = this.world.createEntity();
    buildingEntity
      .add(new Transform(snappedX, snappedY, 0))
      .add(new Building(definition))
      .add(new Health(definition.maxHealth * 0.1, definition.armor, 'structure'))
      .add(new Selectable(Math.max(definition.width, definition.height) * 0.6, 10, playerId));

    // Get the building component and set it to wait for worker
    const building = buildingEntity.get<Building>('Building')!;
    building.state = 'constructing';
    building.buildProgress = 0;

    // Assign the worker to this construction
    const workerUnit = worker.entity.get<Unit>('Unit')!;
    workerUnit.startBuilding(buildingType, snappedX, snappedY);
    workerUnit.constructingBuildingId = buildingEntity.id;

    // Emit placement success event
    this.game.eventBus.emit('building:placed', {
      entityId: buildingEntity.id,
      buildingType,
      playerId,
      position: { x: snappedX, y: snappedY },
      workerId: worker.entity.id,
    });

    console.log(`BuildingPlacementSystem: ${definition.name} placed at (${snappedX}, ${snappedY}), SCV ${worker.entity.id} assigned`);
  }

  /**
   * Find a worker to assign to construction
   * Priority: provided workerId > selected workers > any idle worker
   */
  private findWorkerForConstruction(
    workerId: number | undefined,
    playerId: string
  ): { entity: { id: number; get: <T>(type: string) => T | null } } | null {
    const store = useGameStore.getState();
    const selectedUnits = store.selectedUnits;

    // If specific worker ID provided, use that
    if (workerId !== undefined) {
      const entity = this.world.getEntity(workerId);
      if (entity) {
        const unit = entity.get<Unit>('Unit');
        const selectable = entity.get<Selectable>('Selectable');
        if (unit?.isWorker && selectable?.playerId === playerId) {
          return { entity };
        }
      }
    }

    // Check selected units for workers
    for (const entityId of selectedUnits) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');

      if (unit?.isWorker && selectable?.playerId === playerId) {
        // Prefer idle or gathering workers
        if (unit.state === 'idle' || unit.state === 'gathering' || unit.state === 'moving') {
          return { entity };
        }
      }
    }

    // Fall back to any available worker
    const workers = this.world.getEntitiesWith('Unit', 'Selectable', 'Transform');
    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      if (unit.isWorker && selectable.playerId === playerId) {
        if (unit.state === 'idle' || unit.state === 'gathering') {
          return { entity };
        }
      }
    }

    return null;
  }

  private handleInstantComplete(data: { entityId: number }): void {
    const entity = this.world.getEntity(data.entityId);
    if (!entity) return;

    const building = entity.get<Building>('Building');
    const health = entity.get<Health>('Health');

    if (building && health) {
      building.buildProgress = 1;
      building.state = 'complete';
      health.current = health.max;

      // Add supply if applicable
      if (building.supplyProvided > 0) {
        useGameStore.getState().addMaxSupply(building.supplyProvided);
      }

      // Release any workers constructing this building
      this.releaseWorkersFromBuilding(data.entityId);

      this.game.eventBus.emit('building:complete', {
        entityId: data.entityId,
        buildingType: building.buildingId,
      });
    }
  }

  /**
   * Release all workers assigned to a building
   */
  private releaseWorkersFromBuilding(buildingEntityId: number): void {
    const workers = this.world.getEntitiesWith('Unit', 'Transform');
    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit')!;
      if (unit.constructingBuildingId === buildingEntityId) {
        unit.cancelBuilding();
        console.log(`Worker ${entity.id} released from construction`);
      }
    }
  }

  /**
   * Check if all required buildings exist for the player
   */
  private checkBuildingDependencies(requirements: string[], playerId: string): string | null {
    const playerBuildings = this.world.getEntitiesWith('Building', 'Selectable');

    for (const reqBuildingId of requirements) {
      let found = false;

      for (const entity of playerBuildings) {
        const building = entity.get<Building>('Building')!;
        const selectable = entity.get<Selectable>('Selectable')!;

        if (selectable.playerId === playerId && building.buildingId === reqBuildingId) {
          if (building.isComplete()) {
            found = true;
            break;
          }
        }
      }

      if (!found) {
        const def = BUILDING_DEFINITIONS[reqBuildingId];
        return def?.name || reqBuildingId;
      }
    }

    return null;
  }

  private isValidPlacement(centerX: number, centerY: number, width: number, height: number): boolean {
    const config = this.game.config;
    const halfW = width / 2;
    const halfH = height / 2;

    // Check map bounds
    if (centerX - halfW < 0 || centerY - halfH < 0 ||
        centerX + halfW > config.mapWidth || centerY + halfH > config.mapHeight) {
      return false;
    }

    // Check for overlapping buildings
    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;

      const existingHalfW = building.width / 2;
      const existingHalfH = building.height / 2;
      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      if (dx < halfW + existingHalfW + 0.5 && dy < halfH + existingHalfH + 0.5) {
        return false;
      }
    }

    // Check for overlapping resources
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;
      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      if (dx < halfW + 1.5 && dy < halfH + 1.5) {
        return false;
      }
    }

    // Check for overlapping units (except the worker who will build)
    const units = this.world.getEntitiesWith('Unit', 'Transform');
    for (const entity of units) {
      const transform = entity.get<Transform>('Transform')!;
      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      if (dx < halfW + 0.5 && dy < halfH + 0.5) {
        return false;
      }
    }

    return true;
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000;

    // Update workers going to construction sites
    this.updateWorkerConstruction(dt);

    // Update construction progress for buildings with workers present
    this.updateBuildingConstruction(dt);
  }

  /**
   * Handle workers moving to and arriving at construction sites
   */
  private updateWorkerConstruction(dt: number): void {
    const workers = this.world.getEntitiesWith('Unit', 'Transform');

    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;

      if (unit.state !== 'building' || unit.constructingBuildingId === null) {
        continue;
      }

      // Check if the building still exists
      const buildingEntity = this.world.getEntity(unit.constructingBuildingId);
      if (!buildingEntity) {
        // Building was destroyed or cancelled
        unit.cancelBuilding();
        continue;
      }

      const buildingTransform = buildingEntity.get<Transform>('Transform')!;
      const building = buildingEntity.get<Building>('Building')!;

      // Check if worker is close enough to construct
      const dx = transform.x - buildingTransform.x;
      const dy = transform.y - buildingTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= this.CONSTRUCTION_RANGE + building.width / 2) {
        // Worker has arrived - stop moving and construct
        unit.targetX = null;
        unit.targetY = null;
        unit.currentSpeed = 0;
      } else {
        // Keep moving towards building
        unit.targetX = buildingTransform.x;
        unit.targetY = buildingTransform.y;
      }
    }
  }

  /**
   * Update construction progress for buildings based on worker presence
   */
  private updateBuildingConstruction(dt: number): void {
    const buildings = this.world.getEntitiesWith('Building', 'Health', 'Transform');

    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health')!;
      const buildingTransform = entity.get<Transform>('Transform')!;

      if (building.state !== 'constructing') {
        continue;
      }

      // Check if any worker is actively constructing this building
      const workerConstructing = this.isWorkerConstructing(entity.id, buildingTransform);

      if (workerConstructing) {
        // Progress construction
        const wasComplete = building.isComplete();
        building.updateConstruction(dt);

        // Update health based on progress
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

          // Release workers
          this.releaseWorkersFromBuilding(entity.id);

          this.game.eventBus.emit('building:complete', {
            entityId: entity.id,
            buildingType: building.buildingId,
          });

          console.log(`BuildingPlacementSystem: ${building.name} construction complete!`);
        }
      }
    }
  }

  /**
   * Check if any worker is actively constructing a building
   */
  private isWorkerConstructing(buildingEntityId: number, buildingTransform: Transform): boolean {
    const workers = this.world.getEntitiesWith('Unit', 'Transform');

    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit')!;

      if (unit.constructingBuildingId !== buildingEntityId) {
        continue;
      }

      if (unit.state !== 'building') {
        continue;
      }

      const workerTransform = entity.get<Transform>('Transform')!;
      const dx = workerTransform.x - buildingTransform.x;
      const dy = workerTransform.y - buildingTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Worker is close enough to construct
      if (distance <= this.CONSTRUCTION_RANGE + 3) {
        return true;
      }
    }

    return false;
  }
}

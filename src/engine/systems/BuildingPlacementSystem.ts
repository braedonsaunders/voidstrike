import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Unit } from '../components/Unit';
import { Resource } from '../components/Resource';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { useGameStore } from '@/store/gameStore';
import { isLocalPlayer, getLocalPlayerId } from '@/store/gameSetupStore';
import { debugBuildingPlacement } from '@/utils/debugLogger';

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
  public priority = 5; // Run before MovementSystem to populate buildingGrid

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

    // Handle addon construction
    this.game.eventBus.on('building:build_addon', this.handleBuildAddon.bind(this));

    // Handle worker resuming construction on a paused/in-progress building (SC2-style)
    this.game.eventBus.on('command:resume_construction', this.handleResumeConstruction.bind(this));
  }

  /**
   * Handle a worker being commanded to resume construction on a paused or in-progress building (SC2-style)
   */
  private handleResumeConstruction(data: {
    workerId: number;
    buildingId: number;
  }): void {
    const { workerId, buildingId } = data;

    // Get the worker entity
    const workerEntity = this.world.getEntity(workerId);
    if (!workerEntity) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Worker ${workerId} not found for resume construction`);
      return;
    }

    const unit = workerEntity.get<Unit>('Unit');
    if (!unit || !unit.isWorker) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Entity ${workerId} is not a worker`);
      return;
    }

    // Get the building entity
    const buildingEntity = this.world.getEntity(buildingId);
    if (!buildingEntity) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Building ${buildingId} not found for resume construction`);
      return;
    }

    const building = buildingEntity.get<Building>('Building');
    const buildingTransform = buildingEntity.get<Transform>('Transform');
    const buildingSelectable = buildingEntity.get<Selectable>('Selectable');
    const workerSelectable = workerEntity.get<Selectable>('Selectable');

    if (!building || !buildingTransform || !buildingSelectable) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Building ${buildingId} missing required components`);
      return;
    }

    // Verify building is under construction (waiting, constructing, or paused)
    if (building.state !== 'waiting_for_worker' && building.state !== 'constructing' && building.state !== 'paused') {
      debugBuildingPlacement.log(`BuildingPlacementSystem: Building ${buildingId} is not under construction (state: ${building.state})`);
      return;
    }

    // Verify worker and building belong to same player
    if (workerSelectable?.playerId !== buildingSelectable.playerId) {
      debugBuildingPlacement.log(`BuildingPlacementSystem: Worker ${workerId} cannot construct enemy building`);
      return;
    }

    // Assign the worker to this construction
    unit.constructingBuildingId = buildingId;
    unit.buildingType = building.buildingId;
    unit.buildTargetX = buildingTransform.x;
    unit.buildTargetY = buildingTransform.y;
    unit.state = 'building';
    unit.targetX = buildingTransform.x;
    unit.targetY = buildingTransform.y;
    unit.gatherTargetId = null;
    unit.carryingMinerals = 0;
    unit.carryingVespene = 0;

    debugBuildingPlacement.log(`BuildingPlacementSystem: Worker ${workerId} assigned to resume construction of ${building.name} at ${Math.round(building.buildProgress * 100)}%`);
  }

  private handleBuildingPlace(data: {
    buildingType: string;
    position: { x: number; y: number };
    workerId?: number;
    playerId?: string;
  }): void {
    const { buildingType, playerId = getLocalPlayerId() ?? 'player1' } = data;
    const definition = BUILDING_DEFINITIONS[buildingType];

    if (!definition) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Unknown building type: ${buildingType}`);
      this.game.eventBus.emit('ui:error', { message: `Unknown building: ${buildingType}`, playerId });
      return;
    }

    // Validate position exists
    if (!data.position || typeof data.position.x !== 'number' || typeof data.position.y !== 'number') {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Invalid position for ${buildingType}:`, data.position);
      return;
    }

    // Snap click position to grid for clean placement (center-based)
    const snappedX = Math.round(data.position.x);
    const snappedY = Math.round(data.position.y);

    const store = useGameStore.getState();
    const isPlayerLocal = isLocalPlayer(playerId);

    // Check resources (only for local player - AI handles its own resources)
    if (isPlayerLocal) {
      if (store.minerals < definition.mineralCost || store.vespene < definition.vespeneCost) {
        this.game.eventBus.emit('ui:error', { message: 'Not enough resources', playerId });
        return;
      }
    }

    // Check building dependencies (tech requirements)
    if (definition.requirements && definition.requirements.length > 0) {
      const missingDep = this.checkBuildingDependencies(definition.requirements, playerId);
      if (missingDep) {
        this.game.eventBus.emit('ui:error', { message: `Requires ${missingDep}`, playerId });
        return;
      }
    }

    // Special handling for extractors: must be placed on vespene geysers
    let vespeneGeyserEntity: Entity | null = null;
    if (buildingType === 'extractor') {
      vespeneGeyserEntity = this.findVespeneGeyserAt(snappedX, snappedY);
      if (!vespeneGeyserEntity) {
        this.game.eventBus.emit('ui:error', { message: 'Extractor must be placed on a Vespene Geyser', playerId });
        return;
      }
      const resource = vespeneGeyserEntity.get<Resource>('Resource')!;
      if (resource.hasRefinery()) {
        this.game.eventBus.emit('ui:error', { message: 'Vespene Geyser already has an Extractor', playerId });
        return;
      }
    }

    // Find a worker to assign to this construction FIRST (before placement check)
    // so we can exclude them from collision detection
    const worker = this.findWorkerForConstruction(data.workerId, playerId);
    if (!worker) {
      this.game.eventBus.emit('ui:error', { message: 'No worker available', playerId });
      return;
    }

    // Check placement validity using center position (exclude builder from collision)
    // Skip collision check for extractors since they go on vespene geysers
    if (buildingType !== 'extractor' && !this.isValidPlacement(snappedX, snappedY, definition.width, definition.height, worker.entity.id)) {
      this.game.eventBus.emit('ui:error', { message: 'Cannot build here - area blocked', playerId });
      return;
    }

    // Deduct resources (only for local player - AI handles its own resources)
    if (isPlayerLocal) {
      store.addResources(-definition.mineralCost, -definition.vespeneCost);
    }

    // Create the building entity at the snapped center position
    // Building starts at full max health but current health at 10% (under construction)
    const buildingEntity = this.world.createEntity();
    const health = new Health(definition.maxHealth, definition.armor, 'structure');
    health.current = definition.maxHealth * 0.1; // Start at 10% health (under construction)
    buildingEntity
      .add(new Transform(snappedX, snappedY, 0))
      .add(new Building(definition))
      .add(health)
      .add(new Selectable(Math.max(definition.width, definition.height) * 0.6, 10, playerId));

    // Building starts in 'waiting_for_worker' state (from constructor)
    // Construction will start when worker arrives at site

    // Associate extractor with vespene geyser
    if (vespeneGeyserEntity) {
      const resource = vespeneGeyserEntity.get<Resource>('Resource')!;
      resource.extractorEntityId = buildingEntity.id;
      debugBuildingPlacement.log(`BuildingPlacementSystem: Extractor ${buildingEntity.id} associated with vespene geyser ${vespeneGeyserEntity.id}`);
    }

    // Assign the worker to this construction
    const workerUnit = worker.entity.get<Unit>('Unit')!;
    workerUnit.startBuilding(buildingType, snappedX, snappedY);
    workerUnit.constructingBuildingId = buildingEntity.id;

    // Emit placement success event (includes dimensions for pathfinding grid update)
    this.game.eventBus.emit('building:placed', {
      entityId: buildingEntity.id,
      buildingType,
      playerId,
      position: { x: snappedX, y: snappedY },
      width: definition.width,
      height: definition.height,
      workerId: worker.entity.id,
      vespeneGeyserId: vespeneGeyserEntity?.id,
    });

    debugBuildingPlacement.log(`BuildingPlacementSystem: ${definition.name} placed at (${snappedX}, ${snappedY}), SCV ${worker.entity.id} assigned`);
  }

  /**
   * Find a vespene geyser at or near the given position
   */
  private findVespeneGeyserAt(x: number, y: number): Entity | null {
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    const searchRadius = 3; // Allow some tolerance for click position

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource')!;
      if (resource.resourceType !== 'vespene') continue;

      const transform = entity.get<Transform>('Transform')!;
      const dx = Math.abs(transform.x - x);
      const dy = Math.abs(transform.y - y);

      if (dx <= searchRadius && dy <= searchRadius) {
        return entity;
      }
    }

    return null;
  }

  /**
   * Find a worker to assign to construction
   * Priority: provided workerId > selected workers > any idle worker
   */
  private findWorkerForConstruction(
    workerId: number | undefined,
    playerId: string
  ): { entity: Entity } | null {
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

    // Fall back to any available worker - broader search
    const workers = this.world.getEntitiesWith('Unit', 'Selectable', 'Transform');

    // First pass: idle or gathering workers
    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');

      if (unit?.isWorker && selectable?.playerId === playerId) {
        if (unit.state === 'idle' || unit.state === 'gathering') {
          return { entity };
        }
      }
    }

    // Second pass: moving workers (can be redirected)
    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');

      if (unit?.isWorker && selectable?.playerId === playerId) {
        if (unit.state === 'moving') {
          return { entity };
        }
      }
    }

    // Third pass: any non-building worker
    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (unit?.isWorker && selectable?.playerId === playerId && !health?.isDead()) {
        if (unit.state !== 'building') {
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

      // Add supply if applicable - only for local player's buildings
      const selectable = entity.get<Selectable>('Selectable');
      if (building.supplyProvided > 0 && selectable?.playerId && isLocalPlayer(selectable.playerId)) {
        useGameStore.getState().addMaxSupply(building.supplyProvided);
      }

      // Release any workers constructing this building
      this.releaseWorkersFromBuilding(data.entityId);

      this.game.eventBus.emit('building:complete', {
        entityId: data.entityId,
        buildingType: building.buildingId,
        playerId: selectable?.playerId,
      });
    }
  }

  private handleBuildAddon(data: {
    buildingId: number;
    addonType: string;
    playerId?: string;
  }): void {
    const { buildingId, addonType, playerId = getLocalPlayerId() ?? 'player1' } = data;

    // Get the parent building entity
    const parentEntity = this.world.getEntity(buildingId);
    if (!parentEntity) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Parent building ${buildingId} not found`);
      return;
    }

    const parentBuilding = parentEntity.get<Building>('Building');
    const parentTransform = parentEntity.get<Transform>('Transform');
    const parentSelectable = parentEntity.get<Selectable>('Selectable');

    if (!parentBuilding || !parentTransform || !parentSelectable) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Parent building missing components`);
      return;
    }

    // Verify building can have an addon
    if (!parentBuilding.canHaveAddon) {
      this.game.eventBus.emit('ui:error', { message: 'This building cannot have addons', playerId });
      return;
    }

    // Check if building already has an addon
    if (parentBuilding.hasAddon()) {
      this.game.eventBus.emit('ui:error', { message: 'Building already has an addon', playerId });
      return;
    }

    // Check if building is complete
    if (!parentBuilding.isComplete()) {
      this.game.eventBus.emit('ui:error', { message: 'Building must be complete first', playerId });
      return;
    }

    // Get the addon definition
    const addonDef = BUILDING_DEFINITIONS[addonType];
    if (!addonDef) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Unknown addon type: ${addonType}`);
      return;
    }

    // Check resources (only for local player)
    const store = useGameStore.getState();
    const isPlayerLocal = isLocalPlayer(playerId);
    if (isPlayerLocal) {
      if (store.minerals < addonDef.mineralCost || store.vespene < addonDef.vespeneCost) {
        this.game.eventBus.emit('ui:error', { message: 'Not enough resources', playerId });
        return;
      }
    }

    // Calculate addon position (to the right of the parent building)
    const addonX = parentTransform.x + parentBuilding.width / 2 + addonDef.width / 2;
    const addonY = parentTransform.y;

    // Check if addon position is valid (no collisions - exclude parent building from check)
    if (!this.isValidAddonPlacement(addonX, addonY, addonDef.width, addonDef.height, buildingId)) {
      this.game.eventBus.emit('ui:error', { message: 'Cannot build addon here - blocked', playerId });
      return;
    }

    // Deduct resources (only for local player)
    if (isPlayerLocal) {
      store.addResources(-addonDef.mineralCost, -addonDef.vespeneCost);
    }

    // Create the addon entity - addons complete instantly when built
    const addonEntity = this.world.createEntity();
    const addonBuilding = new Building(addonDef);
    addonBuilding.buildProgress = 1;
    addonBuilding.state = 'complete';
    addonBuilding.attachedToId = buildingId;

    const addonHealth = new Health(addonDef.maxHealth, addonDef.armor, 'structure');

    addonEntity
      .add(new Transform(addonX, addonY, 0))
      .add(addonBuilding)
      .add(addonHealth)
      .add(new Selectable(Math.max(addonDef.width, addonDef.height) * 0.6, 10, playerId));

    // Attach the addon to the parent building
    const techLabType = addonType === 'research_module' ? 'tech_lab' :
                        addonType === 'production_module' ? 'reactor' : null;
    if (techLabType) {
      parentBuilding.attachAddon(techLabType, addonEntity.id);
    }

    // Emit success event
    this.game.eventBus.emit('building:addon_complete', {
      parentId: buildingId,
      addonId: addonEntity.id,
      addonType,
      playerId,
    });

    debugBuildingPlacement.log(`BuildingPlacementSystem: ${addonDef.name} built for ${parentBuilding.name} at (${addonX}, ${addonY})`);
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
        debugBuildingPlacement.log(`Worker ${entity.id} released from construction`);
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

  private isValidPlacement(centerX: number, centerY: number, width: number, height: number, excludeEntityId?: number): boolean {
    const config = this.game.config;
    const halfW = width / 2;
    const halfH = height / 2;

    // Debug: log placement attempt
    debugBuildingPlacement.log(`BuildingPlacement: Attempting at (${centerX.toFixed(1)}, ${centerY.toFixed(1)}), size ${width}x${height}, map bounds: ${config.mapWidth}x${config.mapHeight}`);

    // Check map bounds
    if (centerX - halfW < 0 || centerY - halfH < 0 ||
        centerX + halfW > config.mapWidth || centerY + halfH > config.mapHeight) {
      debugBuildingPlacement.log(`BuildingPlacement: Failed - out of map bounds (centerX-halfW=${(centerX - halfW).toFixed(1)}, centerY-halfH=${(centerY - halfH).toFixed(1)}, centerX+halfW=${(centerX + halfW).toFixed(1)}, centerY+halfH=${(centerY + halfH).toFixed(1)})`);
      return false;
    }

    // Check terrain validity (must be on ground, same elevation, not on ramps/cliffs)
    if (!this.game.isValidTerrainForBuilding(centerX, centerY, width, height)) {
      debugBuildingPlacement.log(`BuildingPlacement: Failed - invalid terrain (cliff edge, ramp, or elevation mismatch)`);
      return false;
    }

    // Check for overlapping buildings
    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!transform || !building) continue;

      const existingHalfW = building.width / 2;
      const existingHalfH = building.height / 2;
      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      if (dx < halfW + existingHalfW + 0.5 && dy < halfH + existingHalfH + 0.5) {
        debugBuildingPlacement.log(`BuildingPlacement: Failed - overlaps building at (${transform.x}, ${transform.y})`);
        return false;
      }
    }

    // Check for overlapping resources
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform');
      if (!transform) continue;

      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      if (dx < halfW + 1.5 && dy < halfH + 1.5) {
        debugBuildingPlacement.log(`BuildingPlacement: Failed - overlaps resource at (${transform.x}, ${transform.y})`);
        return false;
      }
    }

    // Check for overlapping units (exclude the builder worker)
    const units = this.world.getEntitiesWith('Unit', 'Transform');
    for (const entity of units) {
      // Skip the worker who will build this structure
      if (excludeEntityId !== undefined && entity.id === excludeEntityId) {
        continue;
      }

      const transform = entity.get<Transform>('Transform');
      if (!transform) continue;

      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      if (dx < halfW + 0.5 && dy < halfH + 0.5) {
        debugBuildingPlacement.log(`BuildingPlacement: Failed - overlaps unit ${entity.id} at (${transform.x}, ${transform.y})`);
        return false;
      }
    }

    // Check for overlapping decorations (rocks, trees, etc.)
    if (!this.game.isPositionClearOfDecorations(centerX, centerY, width, height)) {
      debugBuildingPlacement.log(`BuildingPlacement: Failed - overlaps decoration at (${centerX}, ${centerY})`);
      return false;
    }

    return true;
  }

  /**
   * Check if an addon placement is valid (excludes parent building from collision check)
   */
  private isValidAddonPlacement(centerX: number, centerY: number, width: number, height: number, parentBuildingId: number): boolean {
    const config = this.game.config;
    const halfW = width / 2;
    const halfH = height / 2;

    // Check map bounds
    if (centerX - halfW < 0 || centerY - halfH < 0 ||
        centerX + halfW > config.mapWidth || centerY + halfH > config.mapHeight) {
      debugBuildingPlacement.log(`AddonPlacement: Failed - out of map bounds`);
      return false;
    }

    // Check terrain validity (must be on ground, same elevation, not on ramps/cliffs)
    if (!this.game.isValidTerrainForBuilding(centerX, centerY, width, height)) {
      debugBuildingPlacement.log(`AddonPlacement: Failed - invalid terrain`);
      return false;
    }

    // Check for overlapping buildings (exclude parent building)
    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    for (const entity of buildings) {
      // Skip the parent building
      if (entity.id === parentBuildingId) continue;

      const transform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!transform || !building) continue;

      const existingHalfW = building.width / 2;
      const existingHalfH = building.height / 2;
      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      if (dx < halfW + existingHalfW + 0.5 && dy < halfH + existingHalfH + 0.5) {
        debugBuildingPlacement.log(`AddonPlacement: Failed - overlaps building at (${transform.x}, ${transform.y})`);
        return false;
      }
    }

    // Check for overlapping resources
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform');
      if (!transform) continue;

      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      if (dx < halfW + 1.5 && dy < halfH + 1.5) {
        debugBuildingPlacement.log(`AddonPlacement: Failed - overlaps resource`);
        return false;
      }
    }

    // Check for overlapping units
    const units = this.world.getEntitiesWith('Unit', 'Transform');
    for (const entity of units) {
      const transform = entity.get<Transform>('Transform');
      if (!transform) continue;

      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      if (dx < halfW + 0.5 && dy < halfH + 0.5) {
        debugBuildingPlacement.log(`AddonPlacement: Failed - overlaps unit`);
        return false;
      }
    }

    // Check for overlapping decorations
    if (!this.game.isPositionClearOfDecorations(centerX, centerY, width, height)) {
      debugBuildingPlacement.log(`AddonPlacement: Failed - overlaps decoration`);
      return false;
    }

    return true;
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000;

    // Update building positions in spatial grid (buildings don't move, but ensures all are registered)
    const allBuildings = this.world.getEntitiesWith('Building', 'Transform');
    for (const entity of allBuildings) {
      const transform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!transform || !building) continue;
      // Use larger of width/height as radius for spatial queries
      const radius = Math.max(building.width, building.height) / 2 + 1;
      this.world.buildingGrid.update(entity.id, transform.x, transform.y, radius);
    }

    // Update workers going to construction sites
    this.updateWorkerConstruction(dt);

    // Update construction progress for buildings with workers present
    this.updateBuildingConstruction(dt);

    // Cancel orphaned blueprints (buildings with no workers assigned)
    this.cancelOrphanedBlueprints();
  }

  /**
   * Handle workers moving to and arriving at construction sites
   */
  private updateWorkerConstruction(dt: number): void {
    const workers = this.world.getEntitiesWith('Unit', 'Transform');

    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      if (!unit || !transform) continue;

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
   * SC2-style: Construction only progresses while a worker is actively constructing.
   * If worker leaves, construction pauses but does NOT cancel.
   */
  private updateBuildingConstruction(dt: number): void {
    const buildings = this.world.getEntitiesWith('Building', 'Health', 'Transform');

    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health')!;
      const buildingTransform = entity.get<Transform>('Transform')!;

      // Skip buildings that are not in an under-construction state
      if (building.state !== 'waiting_for_worker' && building.state !== 'constructing' && building.state !== 'paused') {
        continue;
      }

      // Check if any worker is actively constructing this building
      const workerConstructing = this.isWorkerConstructing(entity.id, buildingTransform);

      if (workerConstructing) {
        // If building was waiting for worker, start construction now
        if (building.state === 'waiting_for_worker') {
          building.startConstruction();
          this.game.eventBus.emit('building:construction_started', {
            entityId: entity.id,
            buildingType: building.buildingId,
            position: { x: buildingTransform.x, y: buildingTransform.y },
          });
          debugBuildingPlacement.log(`BuildingPlacementSystem: ${building.name} construction started - worker arrived!`);
        }

        // If building was paused, resume construction (SC2-style)
        if (building.state === 'paused') {
          building.resumeConstruction();
          this.game.eventBus.emit('building:construction_resumed', {
            entityId: entity.id,
            buildingType: building.buildingId,
            position: { x: buildingTransform.x, y: buildingTransform.y },
            progress: building.buildProgress,
          });
          debugBuildingPlacement.log(`BuildingPlacementSystem: ${building.name} construction resumed at ${Math.round(building.buildProgress * 100)}%!`);
        }

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

          // Get the building's owner
          const selectable = entity.get<Selectable>('Selectable');
          const buildingDef = BUILDING_DEFINITIONS[building.buildingId];

          // Add supply if applicable - only for local player's buildings
          if (building.supplyProvided > 0 && selectable?.playerId && isLocalPlayer(selectable.playerId)) {
            useGameStore.getState().addMaxSupply(building.supplyProvided);
          }

          // Set default rally point for production buildings
          if (building.canProduce.length > 0 && building.rallyX === null) {
            building.setRallyPoint(
              buildingTransform.x + building.width / 2 + 3,
              buildingTransform.y
            );
          }

          // Release workers
          this.releaseWorkersFromBuilding(entity.id);

          this.game.eventBus.emit('building:complete', {
            entityId: entity.id,
            buildingType: building.buildingId,
            buildingName: buildingDef?.name ?? building.name,
            playerId: selectable?.playerId,
          });

          debugBuildingPlacement.log(`BuildingPlacementSystem: ${building.name} construction complete!`);
        }
      } else {
        // No worker is constructing - pause if construction had started (SC2-style)
        if (building.state === 'constructing') {
          building.pauseConstruction();
          this.game.eventBus.emit('building:construction_paused', {
            entityId: entity.id,
            buildingType: building.buildingId,
            position: { x: buildingTransform.x, y: buildingTransform.y },
            progress: building.buildProgress,
          });
          debugBuildingPlacement.log(`BuildingPlacementSystem: ${building.name} construction paused at ${Math.round(building.buildProgress * 100)}% - no worker present`);
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
      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      if (unit.constructingBuildingId !== buildingEntityId) {
        continue;
      }

      if (unit.state !== 'building') {
        continue;
      }

      const workerTransform = entity.get<Transform>('Transform');
      if (!workerTransform) continue;
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

  /**
   * Check if any worker is assigned to a building (even if not close yet)
   */
  private hasWorkerAssigned(buildingEntityId: number): boolean {
    const workers = this.world.getEntitiesWith('Unit');

    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      if (unit.constructingBuildingId === buildingEntityId && unit.state === 'building') {
        return true;
      }
    }

    return false;
  }

  /**
   * Cancel orphaned blueprints (buildings in waiting_for_worker state with no workers assigned)
   * and refund resources to the player.
   */
  private cancelOrphanedBlueprints(): void {
    const buildings = this.world.getEntitiesWith('Building', 'Selectable', 'Transform');

    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const transform = entity.get<Transform>('Transform')!;

      // Only check blueprints that are waiting for a worker
      if (building.state !== 'waiting_for_worker') {
        continue;
      }

      // Check if any worker is assigned to this building
      if (this.hasWorkerAssigned(entity.id)) {
        continue;
      }

      // No worker assigned - cancel the blueprint
      const definition = BUILDING_DEFINITIONS[building.buildingId];
      if (definition) {
        // Refund resources to the player (only for local player)
        if (isLocalPlayer(selectable.playerId)) {
          const store = useGameStore.getState();
          store.addResources(definition.mineralCost, definition.vespeneCost);
          debugBuildingPlacement.log(`BuildingPlacementSystem: Refunded ${definition.mineralCost} minerals, ${definition.vespeneCost} vespene for cancelled ${building.name}`);
        }

        // If this is an extractor/refinery, restore the vespene geyser visibility
        if (building.buildingId === 'extractor' || building.buildingId === 'refinery') {
          const resources = this.world.getEntitiesWith('Resource', 'Transform');
          for (const resourceEntity of resources) {
            const resource = resourceEntity.get<Resource>('Resource');
            if (resource && resource.extractorEntityId === entity.id) {
              resource.extractorEntityId = null;
              debugBuildingPlacement.log(`BuildingPlacementSystem: Extractor cancelled, vespene geyser ${resourceEntity.id} restored`);
              break;
            }
          }
        }

        // Emit cancellation event
        this.game.eventBus.emit('building:cancelled', {
          entityId: entity.id,
          buildingType: building.buildingId,
          playerId: selectable.playerId,
          position: { x: transform.x, y: transform.y },
        });

        debugBuildingPlacement.log(`BuildingPlacementSystem: Cancelled orphaned blueprint ${building.name} at (${transform.x}, ${transform.y}) - no workers assigned`);
      }

      // Remove the building entity
      this.world.destroyEntity(entity.id);
    }
  }
}

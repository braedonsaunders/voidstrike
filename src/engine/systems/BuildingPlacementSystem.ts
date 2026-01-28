import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Unit } from '../components/Unit';
import { Resource } from '../components/Resource';
import { Wall } from '../components/Wall';
import { EnhancedAISystem } from './EnhancedAISystem';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { WALL_DEFINITIONS } from '@/data/buildings/walls';
import { isLocalPlayer, getLocalPlayerId } from '@/store/gameSetupStore';
import { debugBuildingPlacement } from '@/utils/debugLogger';
import { SeededRandom, distance, clamp } from '@/utils/math';

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
  public readonly name = 'BuildingPlacementSystem';
  // Priority is set by SystemRegistry based on dependencies (runs after SelectionSystem)

  // Distance threshold for worker to be "at" the building site
  private readonly CONSTRUCTION_RANGE = 2.5;

  // AoE construction range for walls - workers contribute to all walls within this range
  private readonly WALL_AOE_CONSTRUCTION_RANGE = 3.0;

  // Track pending addon attachments (addon ID -> parent building info)
  private pendingAddonAttachments: Map<number, { parentBuildingId: number; addonType: 'research_module' | 'production_module' | null }> = new Map();

  // Wall line ID counter for tracking wall segments placed together
  private nextWallLineId = 1;

  // Deterministic RNG for worker wandering (multiplayer sync)
  private readonly wanderRng = new SeededRandom(1);

  // Cache reference to AI system for AI resource checks
  private aiSystem: EnhancedAISystem | null = null;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Handle building placement from UI
    this.game.eventBus.on('building:place', this.handleBuildingPlace.bind(this));

    // Handle wall line placement
    this.game.eventBus.on('wall:place_line', this.handleWallLinePlacement.bind(this));

    // Handle instant building completion (for testing/cheats)
    this.game.eventBus.on('building:complete:instant', this.handleInstantComplete.bind(this));

    // Handle addon construction
    this.game.eventBus.on('building:build_addon', this.handleBuildAddon.bind(this));

    // Handle worker resuming construction on a paused/in-progress building
    this.game.eventBus.on('command:resume_construction', this.handleResumeConstruction.bind(this));
  }

  /**
   * Get the AI system, lazily initializing if needed.
   * Always re-checks if null since AI system may be registered after init.
   */
  private getAISystem(): EnhancedAISystem | null {
    if (!this.aiSystem) {
      this.aiSystem = this.world.getSystem(EnhancedAISystem) || null;
    }
    return this.aiSystem;
  }

  /**
   * Handle wall line placement - places multiple wall segments at once
   * Uses smart worker assignment for efficient construction of long walls
   */
  private handleWallLinePlacement(data: {
    positions: Array<{ x: number; y: number; valid: boolean }>;
    buildingType: string;
    playerId?: string;
  }): void {
    const { positions, buildingType, playerId = getLocalPlayerId() ?? 'player1' } = data;
    const definition = WALL_DEFINITIONS[buildingType] || BUILDING_DEFINITIONS[buildingType];

    if (!definition) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Unknown wall type: ${buildingType}`);
      return;
    }

    // Filter to valid positions only
    const validPositions = positions.filter(p => p.valid);
    if (validPositions.length === 0) {
      this.game.eventBus.emit('ui:error', { message: 'No valid wall positions', playerId });
      return;
    }

    // Calculate total cost
    const totalCost = {
      minerals: definition.mineralCost * validPositions.length,
      vespene: definition.vespeneCost * validPositions.length,
    };

    const isPlayerLocal = isLocalPlayer(playerId);

    // Check resources
    if (isPlayerLocal) {
      if (this.game.statePort.getMinerals() < totalCost.minerals) {
        this.game.eventBus.emit('alert:notEnoughMinerals', {});
        this.game.eventBus.emit('warning:lowMinerals', {});
        return;
      }
      if (this.game.statePort.getVespene() < totalCost.vespene) {
        this.game.eventBus.emit('alert:notEnoughVespene', {});
        this.game.eventBus.emit('warning:lowVespene', {});
        return;
      }
    }

    // Find workers for construction
    const availableWorkers: Array<{ entity: Entity; x: number; y: number }> = [];
    const workers = this.world.getEntitiesWith('Unit', 'Selectable', 'Transform', 'Health');
    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      const transform = entity.get<Transform>('Transform')!;

      if (unit.isWorker && selectable.playerId === playerId && !health.isDead()) {
        if (unit.state === 'idle' || unit.state === 'gathering' || unit.state === 'moving') {
          availableWorkers.push({ entity, x: transform.x, y: transform.y });
        }
      }
    }

    if (availableWorkers.length === 0) {
      this.game.eventBus.emit('ui:error', { message: 'No workers available', playerId });
      return;
    }

    // Deduct resources
    if (isPlayerLocal) {
      this.game.statePort.addResources(-totalCost.minerals, -totalCost.vespene);
    }

    // Generate unique wall line ID for this placement
    const wallLineId = this.nextWallLineId++;

    // Create all wall entities first
    const placedWalls: Array<{ entityId: number; x: number; y: number }> = [];

    for (const pos of validPositions) {
      const wallEntity = this.world.createEntity();
      const health = new Health(definition.maxHealth, definition.armor, 'structure');
      health.current = definition.maxHealth * 0.1; // Start at 10% health

      const building = new Building(definition);
      const isGate = 'isGate' in definition && definition.isGate;
      const canMount = 'canMountTurret' in definition ? definition.canMountTurret : true;
      const wall = new Wall(isGate as boolean, canMount as boolean);

      wallEntity
        .add(new Transform(pos.x, pos.y, 0))
        .add(building)
        .add(health)
        .add(wall)
        .add(new Selectable(0.8, 10, playerId));

      placedWalls.push({ entityId: wallEntity.id, x: pos.x, y: pos.y });

      // Push any units out of the wall footprint
      this.pushUnitsFromBuilding(pos.x, pos.y, definition.width, definition.height);

      // Emit placement event
      this.game.eventBus.emit('wall:placed', {
        entityId: wallEntity.id,
        position: { x: pos.x, y: pos.y },
        playerId,
      });
    }

    // Get all entity IDs for wall line tracking
    const allWallEntityIds = placedWalls.map(w => w.entityId);

    // Smart worker assignment: assign each worker to the nearest unassigned segment
    // Then workers can contribute to ALL nearby walls with AoE construction
    const assignedSegments = new Set<number>();
    const workerAssignments: Array<{ worker: Entity; segmentIdx: number }> = [];

    // Sort workers by their distance to the wall line center for balanced distribution
    const lineCenterX = placedWalls.reduce((sum, w) => sum + w.x, 0) / placedWalls.length;
    const lineCenterY = placedWalls.reduce((sum, w) => sum + w.y, 0) / placedWalls.length;
    availableWorkers.sort((a, b) => {
      const distA = Math.abs(a.x - lineCenterX) + Math.abs(a.y - lineCenterY);
      const distB = Math.abs(b.x - lineCenterX) + Math.abs(b.y - lineCenterY);
      return distA - distB;
    });

    // Assign workers to segments - each worker gets assigned to nearest unassigned segment
    // Workers will use AoE construction to build ALL nearby walls
    for (const workerData of availableWorkers) {
      if (assignedSegments.size >= placedWalls.length) break;

      // Find nearest unassigned segment to this worker
      let nearestIdx = -1;
      let nearestDist = Infinity;

      for (let i = 0; i < placedWalls.length; i++) {
        if (assignedSegments.has(i)) continue;

        const wall = placedWalls[i];
        const dist = Math.abs(workerData.x - wall.x) + Math.abs(workerData.y - wall.y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }

      if (nearestIdx >= 0) {
        assignedSegments.add(nearestIdx);
        workerAssignments.push({ worker: workerData.entity, segmentIdx: nearestIdx });
      }
    }

    // If we have more segments than workers, distribute remaining segments round-robin
    // Each worker will handle multiple segments via auto-continue
    if (assignedSegments.size < placedWalls.length) {
      let workerIdx = 0;
      for (let i = 0; i < placedWalls.length; i++) {
        if (!assignedSegments.has(i)) {
          // This segment will be built via auto-continue by the nearest worker
          assignedSegments.add(i);
          workerIdx = (workerIdx + 1) % workerAssignments.length;
        }
      }
    }

    // Apply worker assignments
    for (const assignment of workerAssignments) {
      const segment = placedWalls[assignment.segmentIdx];
      const workerUnit = assignment.worker.get<Unit>('Unit')!;

      workerUnit.startBuilding(buildingType, segment.x, segment.y);
      workerUnit.constructingBuildingId = segment.entityId;
      workerUnit.wallLineId = wallLineId;
      workerUnit.wallLineSegments = [...allWallEntityIds]; // All segments for auto-continue
    }

    debugBuildingPlacement.log(`BuildingPlacementSystem: Placed ${placedWalls.length} wall segments (line #${wallLineId}), assigned ${workerAssignments.length} workers with smart distribution`);
  }

  /**
   * Handle a worker being commanded to resume construction on a paused or in-progress building    */
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
    isAddon?: boolean;
    attachTo?: number; // Parent building ID for addons
    parentBuildingId?: number; // Alternative name for parent (used by AI)
  }): void {
    const { buildingType, playerId = getLocalPlayerId() ?? 'player1' } = data;
    const definition = BUILDING_DEFINITIONS[buildingType];
    const isAddon = data.isAddon === true;
    const parentBuildingId = data.attachTo ?? data.parentBuildingId;

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

    // Handle addon placement separately (no worker needed, instant build)
    if (isAddon && parentBuildingId !== undefined) {
      this.handleAddonPlacement(buildingType, snappedX, snappedY, playerId, parentBuildingId);
      return;
    }

    const isPlayerLocal = isLocalPlayer(playerId);
    const aiPlayer = !isPlayerLocal ? this.getAISystem()?.getAIPlayer(playerId) : undefined;
    const isPlayerAI = aiPlayer !== undefined;

    // Check resources (local player via game store, AI via AI state)
    if (isPlayerLocal) {
      if (this.game.statePort.getMinerals() < definition.mineralCost) {
        this.game.eventBus.emit('alert:notEnoughMinerals', {});
        this.game.eventBus.emit('warning:lowMinerals', {});
        return;
      }
      if (this.game.statePort.getVespene() < definition.vespeneCost) {
        this.game.eventBus.emit('alert:notEnoughVespene', {});
        this.game.eventBus.emit('warning:lowVespene', {});
        return;
      }
    } else if (isPlayerAI && aiPlayer) {
      if (aiPlayer.minerals < definition.mineralCost || aiPlayer.vespene < definition.vespeneCost) {
        debugBuildingPlacement.log(`BuildingPlacementSystem: AI ${playerId} lacks resources for ${buildingType} (need ${definition.mineralCost}M/${definition.vespeneCost}G, have ${Math.floor(aiPlayer.minerals)}M/${Math.floor(aiPlayer.vespene)}G)`);
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
      // Check if ANY extractor exists (complete or under construction) - not just complete ones
      // This prevents duplicate extractor placement attempts while one is being built
      if (resource.extractorEntityId !== null) {
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

    // Deduct resources (local player via store, AI via AI state)
    if (isPlayerLocal) {
      this.game.statePort.addResources(-definition.mineralCost, -definition.vespeneCost);
    } else if (isPlayerAI && aiPlayer) {
      aiPlayer.minerals -= definition.mineralCost;
      aiPlayer.vespene -= definition.vespeneCost;
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

    // Diagnostic: confirm building entity was created (helps debug AI placement issues)
    console.log(`[BuildingPlacement] ${playerId}: Created ${buildingType} entity #${buildingEntity.id} at (${snappedX}, ${snappedY})`);

    // Building starts in 'waiting_for_worker' state (from constructor)
    // Construction will start when worker arrives at site

    // Associate extractor with vespene geyser
    if (vespeneGeyserEntity) {
      const resource = vespeneGeyserEntity.get<Resource>('Resource')!;
      resource.extractorEntityId = buildingEntity.id;
      // PERF: Store reverse lookup for O(1) access when extractor is destroyed
      const buildingComp = buildingEntity.get<Building>('Building')!;
      buildingComp.linkedResourceId = vespeneGeyserEntity.id;
      debugBuildingPlacement.log(`BuildingPlacementSystem: Extractor ${buildingEntity.id} associated with vespene geyser ${vespeneGeyserEntity.id}`);
    }

    // Push any units out of the building footprint
    this.pushUnitsFromBuilding(snappedX, snappedY, definition.width, definition.height, worker.entity.id);

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
   * Handle addon placement (research_module, production_module)
   * Addons don't require workers but build over time
   */
  private handleAddonPlacement(
    buildingType: string,
    x: number,
    y: number,
    playerId: string,
    parentBuildingId: number
  ): void {
    const definition = BUILDING_DEFINITIONS[buildingType];
    if (!definition) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Unknown addon type: ${buildingType}`);
      return;
    }

    // Get and validate parent building
    const parentEntity = this.world.getEntity(parentBuildingId);
    if (!parentEntity) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Parent building ${parentBuildingId} not found for addon`);
      return;
    }

    const parentBuilding = parentEntity.get<Building>('Building');
    const parentSelectable = parentEntity.get<Selectable>('Selectable');
    if (!parentBuilding || !parentSelectable) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Parent building ${parentBuildingId} missing components`);
      return;
    }

    // Validate parent can have addon and doesn't already have one
    if (!parentBuilding.canHaveAddon) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: ${parentBuilding.name} cannot have addons`);
      return;
    }
    if (parentBuilding.hasAddon()) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: ${parentBuilding.name} already has an addon`);
      return;
    }
    if (parentBuilding.state !== 'complete') {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: ${parentBuilding.name} is not complete`);
      return;
    }

    // Check addon placement validity (exclude parent from collision)
    if (!this.isValidAddonPlacement(x, y, definition.width, definition.height, parentBuildingId)) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Addon position (${x}, ${y}) is blocked`);
      this.game.eventBus.emit('building:addonFailed', {
        buildingId: parentBuildingId,
        reason: 'Addon position blocked',
      });
      return;
    }

    // Create the addon entity - starts in 'constructing' state (no worker needed)
    const addonEntity = this.world.createEntity();
    const addonBuilding = new Building(definition);
    addonBuilding.buildProgress = 0;
    addonBuilding.state = 'constructing'; // Addons don't need workers, start constructing immediately
    addonBuilding.attachedToId = parentBuildingId;

    // Store addon type for later attachment when complete
    const addonTypeForAttachment = buildingType === 'research_module' ? 'research_module' :
                        buildingType === 'production_module' ? 'production_module' : null;

    const addonHealth = new Health(definition.maxHealth, definition.armor, 'structure');
    addonHealth.current = definition.maxHealth * 0.1; // Start at 10% health like buildings

    addonEntity
      .add(new Transform(x, y, 0))
      .add(addonBuilding)
      .add(addonHealth)
      .add(new Selectable(Math.max(definition.width, definition.height) * 0.6, 10, playerId));

    // Store pending addon attachment info (will be attached when construction completes)
    this.pendingAddonAttachments.set(addonEntity.id, {
      parentBuildingId,
      addonType: addonTypeForAttachment,
    });

    // Emit placement event
    this.game.eventBus.emit('building:placed', {
      entityId: addonEntity.id,
      buildingType,
      playerId,
      position: { x, y },
      width: definition.width,
      height: definition.height,
      isAddon: true,
      parentBuildingId,
    });

    // Emit construction started event
    this.game.eventBus.emit('building:addon_started', {
      parentId: parentBuildingId,
      addonId: addonEntity.id,
      addonType: buildingType,
      playerId,
    });

    debugBuildingPlacement.log(`BuildingPlacementSystem: ${definition.name} addon construction started for ${parentBuilding.name} at (${x}, ${y})`);
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
   * Priority: provided workerId (if not already building) > selected workers > any idle worker
   *
   * IMPORTANT: Workers already assigned to construction are NEVER reassigned.
   * This ensures queued buildings are built in order - first building completes before
   * worker moves to second building.
   */
  private findWorkerForConstruction(
    workerId: number | undefined,
    playerId: string
  ): { entity: Entity } | null {
    const selectedUnits = this.game.statePort.getSelectedUnits();

    // If specific worker ID provided, use that ONLY if they're not already building
    if (workerId !== undefined) {
      const entity = this.world.getEntity(workerId);
      if (entity) {
        const unit = entity.get<Unit>('Unit');
        const selectable = entity.get<Selectable>('Selectable');
        // Only use this worker if they're not already constructing something
        if (unit?.isWorker && selectable?.playerId === playerId) {
          if (unit.state !== 'building' && unit.constructingBuildingId === null) {
            return { entity };
          }
          // Worker is busy building - fall through to find another worker
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
        this.game.statePort.addMaxSupply(building.supplyProvided);
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

    // Check resources (local player via game store, AI via AI state)
    const isPlayerLocal = isLocalPlayer(playerId);
    const aiPlayer = !isPlayerLocal ? this.getAISystem()?.getAIPlayer(playerId) : undefined;
    const isPlayerAI = aiPlayer !== undefined;
    if (isPlayerLocal) {
      if (this.game.statePort.getMinerals() < addonDef.mineralCost) {
        this.game.eventBus.emit('alert:notEnoughMinerals', {});
        this.game.eventBus.emit('warning:lowMinerals', {});
        return;
      }
      if (this.game.statePort.getVespene() < addonDef.vespeneCost) {
        this.game.eventBus.emit('alert:notEnoughVespene', {});
        this.game.eventBus.emit('warning:lowVespene', {});
        return;
      }
    } else if (isPlayerAI && aiPlayer) {
      if (aiPlayer.minerals < addonDef.mineralCost || aiPlayer.vespene < addonDef.vespeneCost) {
        debugBuildingPlacement.log(`BuildingPlacementSystem: AI ${playerId} lacks resources for addon ${addonType} (need ${addonDef.mineralCost}M/${addonDef.vespeneCost}G, have ${Math.floor(aiPlayer.minerals)}M/${Math.floor(aiPlayer.vespene)}G)`);
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

    // Deduct resources (local player via store, AI via AI state)
    if (isPlayerLocal) {
      this.game.statePort.addResources(-addonDef.mineralCost, -addonDef.vespeneCost);
    } else if (isPlayerAI && aiPlayer) {
      aiPlayer.minerals -= addonDef.mineralCost;
      aiPlayer.vespene -= addonDef.vespeneCost;
    }

    // Create the addon entity - starts in 'constructing' state (no worker needed)
    const addonEntity = this.world.createEntity();
    const addonBuilding = new Building(addonDef);
    addonBuilding.buildProgress = 0;
    addonBuilding.state = 'constructing'; // Addons don't need workers, start constructing immediately
    addonBuilding.attachedToId = buildingId;

    // Store addon type for later attachment when complete
    const addonTypeForAttachment = addonType === 'research_module' ? 'research_module' :
                        addonType === 'production_module' ? 'production_module' : null;

    const addonHealth = new Health(addonDef.maxHealth, addonDef.armor, 'structure');
    addonHealth.current = addonDef.maxHealth * 0.1; // Start at 10% health like buildings

    addonEntity
      .add(new Transform(addonX, addonY, 0))
      .add(addonBuilding)
      .add(addonHealth)
      .add(new Selectable(Math.max(addonDef.width, addonDef.height) * 0.6, 10, playerId));

    // Store pending addon attachment info (will be attached when construction completes)
    this.pendingAddonAttachments.set(addonEntity.id, {
      parentBuildingId: buildingId,
      addonType: addonTypeForAttachment,
    });

    // Emit construction started event
    this.game.eventBus.emit('building:addon_started', {
      parentId: buildingId,
      addonId: addonEntity.id,
      addonType,
      playerId,
    });

    debugBuildingPlacement.log(`BuildingPlacementSystem: ${addonDef.name} built for ${parentBuilding.name} at (${addonX}, ${addonY})`);
  }

  /**
   * Release all workers assigned to a building and push them out of the footprint
   * For walls: supports auto-continue to next unfinished segment in the wall line
   * For other buildings: Primary workers check for queued build commands, helper workers return to original position
   */
  private releaseWorkersFromBuilding(
    buildingEntityId: number,
    buildingX?: number,
    buildingY?: number,
    buildingWidth?: number,
    buildingHeight?: number
  ): void {
    const workers = this.world.getEntitiesWith('Unit', 'Transform');

    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;

      if (unit.constructingBuildingId === buildingEntityId) {
        // Push worker out of building footprint if they're inside
        // This ensures they can pathfind correctly after being released
        if (buildingX !== undefined && buildingY !== undefined && buildingWidth !== undefined && buildingHeight !== undefined) {
          const halfW = buildingWidth / 2 + 0.5;
          const halfH = buildingHeight / 2 + 0.5;
          const dx = transform.x - buildingX;
          const dy = transform.y - buildingY;

          if (Math.abs(dx) < halfW && Math.abs(dy) < halfH) {
            // Worker is inside building, push to nearest edge
            const pushDistX = halfW - Math.abs(dx);
            const pushDistY = halfH - Math.abs(dy);

            if (pushDistX < pushDistY) {
              // Push to left/right edge
              transform.x = buildingX + (dx >= 0 ? halfW + 0.5 : -halfW - 0.5);
            } else {
              // Push to top/bottom edge
              transform.y = buildingY + (dy >= 0 ? halfH + 0.5 : -halfH - 0.5);
            }

            // Clamp to map bounds
            transform.x = clamp(transform.x, 1, this.game.config.mapWidth - 1);
            transform.y = clamp(transform.y, 1, this.game.config.mapHeight - 1);

            // Update spatial grid position
            this.world.unitGrid.update(entity.id, transform.x, transform.y, unit.collisionRadius);

            debugBuildingPlacement.log(`Worker ${entity.id} pushed out of completed building to (${transform.x.toFixed(1)}, ${transform.y.toFixed(1)})`);
          }
        }

        // Check if this worker has wall line segments for auto-continue
        if (unit.wallLineSegments.length > 0) {
          // Find the next unfinished wall segment in the line
          const nextSegment = this.findNextUnfinishedWallSegment(
            unit.wallLineSegments,
            buildingEntityId,
            transform.x,
            transform.y
          );

          if (nextSegment) {
            // Auto-continue to next segment
            const nextTransform = nextSegment.entity.get<Transform>('Transform')!;
            unit.constructingBuildingId = nextSegment.entity.id;
            unit.buildTargetX = nextTransform.x;
            unit.buildTargetY = nextTransform.y;
            unit.targetX = nextTransform.x;
            unit.targetY = nextTransform.y;
            // Clear path so MovementSystem calculates new path
            unit.path = [];
            unit.pathIndex = 0;
            debugBuildingPlacement.log(`Worker ${entity.id} auto-continuing to wall segment ${nextSegment.entity.id}`);
            continue;
          } else {
            // All segments complete, clear wall line data
            unit.wallLineId = null;
            unit.wallLineSegments = [];
            debugBuildingPlacement.log(`Worker ${entity.id} finished wall line, all segments complete`);
          }
        }

        // Check if this is a helper worker that should return to their original task
        if (unit.isHelperWorker) {
          const previousGatherTargetId = unit.previousGatherTargetId;
          const returnX = unit.returnPositionX;
          const returnY = unit.returnPositionY;

          // Check if the worker had a previous gather target and it still exists
          if (previousGatherTargetId !== null) {
            const resourceEntity = this.world.getEntity(previousGatherTargetId);
            if (resourceEntity) {
              const resource = resourceEntity.get<Resource>('Resource');
              // Verify resource still exists and has resources left
              if (resource && resource.amount > 0) {
                // Restore gathering task
                unit.cancelBuilding();
                unit.gatherTargetId = previousGatherTargetId;
                unit.state = 'gathering';
                // Get resource position and move to it
                const resourceTransform = resourceEntity.get<Transform>('Transform');
                if (resourceTransform) {
                  unit.targetX = resourceTransform.x;
                  unit.targetY = resourceTransform.y;
                }
                debugBuildingPlacement.log(`Helper worker ${entity.id} returning to gather resource ${previousGatherTargetId}`);
                continue;
              }
            }
          }

          // Fall back to returning to original position if no valid gather target
          if (returnX !== null && returnY !== null) {
            unit.cancelBuilding();
            unit.setMoveTarget(returnX, returnY);
            debugBuildingPlacement.log(`Helper worker ${entity.id} returning to original position (${returnX.toFixed(1)}, ${returnY.toFixed(1)})`);
          } else {
            unit.cancelBuilding();
          }
        }
        // Check if the worker has queued build commands
        else if (unit.commandQueue.length > 0 && unit.commandQueue[0].type === 'build') {
          const nextBuild = unit.commandQueue[0];
          if (nextBuild.buildingEntityId !== undefined) {
            // Check if the queued building still exists and needs construction
            const nextBuildingEntity = this.world.getEntity(nextBuild.buildingEntityId);
            if (nextBuildingEntity) {
              const nextBuilding = nextBuildingEntity.get<Building>('Building');
              if (nextBuilding && !nextBuilding.isComplete()) {
                // Execute the queued build command
                unit.executeNextCommand();
                debugBuildingPlacement.log(`Worker ${entity.id} moving to next queued building ${nextBuild.buildingEntityId}`);
                continue;
              }
            }
            // Building no longer exists or is complete, skip it
            unit.commandQueue.shift();
          }
          // Try to execute remaining commands if any
          if (unit.commandQueue.length > 0) {
            unit.cancelBuilding();
            unit.executeNextCommand();
          } else {
            unit.cancelBuilding();
          }
          debugBuildingPlacement.log(`Worker ${entity.id} released from construction`);
        } else {
          unit.cancelBuilding();
          debugBuildingPlacement.log(`Worker ${entity.id} released from construction`);
        }
      }
    }
  }

  /**
   * Find the next unfinished wall segment in a wall line
   * Prioritizes segments closest to the worker
   */
  private findNextUnfinishedWallSegment(
    wallLineSegments: number[],
    justCompletedId: number,
    workerX: number,
    workerY: number
  ): { entity: Entity; distance: number } | null {
    let nearest: { entity: Entity; distance: number } | null = null;

    for (const segmentId of wallLineSegments) {
      if (segmentId === justCompletedId) continue;

      const segmentEntity = this.world.getEntity(segmentId);
      if (!segmentEntity) continue;

      const building = segmentEntity.get<Building>('Building');
      if (!building) continue;

      // Skip complete or destroyed buildings
      if (building.state === 'complete' || building.state === 'destroyed') continue;

      const transform = segmentEntity.get<Transform>('Transform');
      if (!transform) continue;

      const dist = distance(workerX, workerY, transform.x, transform.y);

      if (!nearest || dist < nearest.distance) {
        nearest = { entity: segmentEntity, distance: dist };
      }
    }

    return nearest;
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
    // Debug: log placement attempt
    debugBuildingPlacement.log(`BuildingPlacement: Attempting at (${centerX.toFixed(1)}, ${centerY.toFixed(1)}), size ${width}x${height}, map bounds: ${this.game.config.mapWidth}x${this.game.config.mapHeight}`);

    // Use the centralized validation from Game class
    // Skip unit check - units will be pushed away after placement
    const isValid = this.game.isValidBuildingPlacement(centerX, centerY, width, height, excludeEntityId, true);

    if (!isValid) {
      debugBuildingPlacement.log(`BuildingPlacement: Failed at (${centerX.toFixed(1)}, ${centerY.toFixed(1)})`);
    }

    return isValid;
  }

  /**
   * Push all units out of a building footprint.
   * Units are moved to the nearest edge of the building.
   */
  private pushUnitsFromBuilding(centerX: number, centerY: number, width: number, height: number, excludeEntityId?: number): void {
    const halfW = width / 2 + 0.5; // Add buffer
    const halfH = height / 2 + 0.5;

    // Query nearby units
    const nearbyUnitIds = this.world.unitGrid.queryRect(
      centerX - halfW - 2,
      centerY - halfH - 2,
      centerX + halfW + 2,
      centerY + halfH + 2
    );

    for (const unitId of nearbyUnitIds) {
      // Skip the builder worker
      if (excludeEntityId !== undefined && unitId === excludeEntityId) {
        continue;
      }

      const entity = this.world.getEntity(unitId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      if (!transform || !unit) continue;

      const dx = transform.x - centerX;
      const dy = transform.y - centerY;

      // Check if unit is inside building footprint
      if (Math.abs(dx) < halfW && Math.abs(dy) < halfH) {
        // Calculate push direction - move to nearest edge
        const pushDistX = halfW - Math.abs(dx);
        const pushDistY = halfH - Math.abs(dy);

        let pushX = 0;
        let pushY = 0;

        if (pushDistX < pushDistY) {
          // Closer to left/right edge
          pushX = dx >= 0 ? halfW + 0.5 : -halfW - 0.5;
          pushY = dy;
        } else {
          // Closer to top/bottom edge
          pushX = dx;
          pushY = dy >= 0 ? halfH + 0.5 : -halfH - 0.5;
        }

        const newX = centerX + pushX;
        const newY = centerY + pushY;

        // Clamp to map bounds
        const clampedX = clamp(newX, 1, this.game.config.mapWidth - 1);
        const clampedY = clamp(newY, 1, this.game.config.mapHeight - 1);

        // Move the unit
        unit.setMoveTarget(clampedX, clampedY);
        debugBuildingPlacement.log(`Pushed unit ${unitId} from building footprint to (${clampedX.toFixed(1)}, ${clampedY.toFixed(1)})`);
      }
    }
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

    // Auto-assign nearby idle workers to help with unassigned blueprints
    this.autoAssignIdleWorkers();

    // Cancel orphaned blueprints (buildings with no workers assigned)
    this.cancelOrphanedBlueprints();
  }

  // Track worker wander state for RTS-style construction movement
  private workerWanderState: Map<number, { targetX: number; targetY: number; timer: number }> = new Map();

  /**
   * Handle workers moving to and arriving at construction sites
   * RTS-style: Workers move around inside the building footprint while constructing
   */
  private updateWorkerConstruction(dt: number): void {
    const workers = this.world.getEntitiesWith('Unit', 'Transform');

    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      if (!unit || !transform) continue;

      if (unit.state !== 'building' || unit.constructingBuildingId === null) {
        // Clean up wander state for workers no longer constructing
        this.workerWanderState.delete(entity.id);
        continue;
      }

      // Check if the building still exists
      const buildingEntity = this.world.getEntity(unit.constructingBuildingId);
      if (!buildingEntity) {
        // Building was destroyed or cancelled
        unit.cancelBuilding();
        this.workerWanderState.delete(entity.id);
        continue;
      }

      const buildingTransform = buildingEntity.get<Transform>('Transform')!;
      const building = buildingEntity.get<Building>('Building')!;

      // Safety check: If building is already complete, release the worker
      // This handles edge cases where worker didn't get properly released
      if (building.isComplete()) {
        debugBuildingPlacement.log(`Worker ${entity.id} was stuck on completed building ${unit.constructingBuildingId}, releasing`);

        // Push worker out of building footprint
        const halfW = building.width / 2 + 0.5;
        const halfH = building.height / 2 + 0.5;
        const dx = transform.x - buildingTransform.x;
        const dy = transform.y - buildingTransform.y;

        if (Math.abs(dx) < halfW && Math.abs(dy) < halfH) {
          const pushDistX = halfW - Math.abs(dx);
          const pushDistY = halfH - Math.abs(dy);

          if (pushDistX < pushDistY) {
            transform.x = buildingTransform.x + (dx >= 0 ? halfW + 0.5 : -halfW - 0.5);
          } else {
            transform.y = buildingTransform.y + (dy >= 0 ? halfH + 0.5 : -halfH - 0.5);
          }

          transform.x = clamp(transform.x, 1, this.game.config.mapWidth - 1);
          transform.y = clamp(transform.y, 1, this.game.config.mapHeight - 1);
          this.world.unitGrid.update(entity.id, transform.x, transform.y, unit.collisionRadius);
        }

        unit.cancelBuilding();
        this.workerWanderState.delete(entity.id);
        continue;
      }

      // Check if worker is close enough to construct
      const dist = distance(buildingTransform.x, buildingTransform.y, transform.x, transform.y);

      // RTS-style: Move inside building footprint when actively constructing
      // Use same threshold formula as isWorkerConstructing for consistency
      const constructThreshold = Math.max(building.width / 2, 3);
      const isCloseEnough = dist <= this.CONSTRUCTION_RANGE + constructThreshold;

      if (isCloseEnough && building.state === 'constructing') {
        // Worker is actively constructing - move around inside the building
        let wander = this.workerWanderState.get(entity.id);

        // Initialize or update wander target
        if (!wander || wander.timer <= 0) {
          // Pick new random position inside building footprint
          // Use deterministic RNG seeded by entity ID + tick for multiplayer sync
          const currentTick = this.game.getCurrentTick();
          this.wanderRng.reseed(entity.id * 31337 + currentTick);
          const halfW = building.width * 0.35;
          const halfH = building.height * 0.35;
          const newX = buildingTransform.x + (this.wanderRng.next() - 0.5) * halfW * 2;
          const newY = buildingTransform.y + (this.wanderRng.next() - 0.5) * halfH * 2;
          wander = {
            targetX: newX,
            targetY: newY,
            timer: 0.8 + this.wanderRng.next() * 1.2, // Wander to new spot every 0.8-2 seconds
          };
          this.workerWanderState.set(entity.id, wander);
        }

        // Update timer
        wander.timer -= dt;

        // Move towards wander target at slow speed
        const wanderDx = wander.targetX - transform.x;
        const wanderDy = wander.targetY - transform.y;
        const wanderDist = Math.sqrt(wanderDx * wanderDx + wanderDy * wanderDy);

        if (wanderDist > 0.3) {
          // Move slowly inside building (1/3 normal speed)
          const wanderSpeed = unit.speed * 0.33 * dt;
          transform.x += (wanderDx / wanderDist) * Math.min(wanderSpeed, wanderDist);
          transform.y += (wanderDy / wanderDist) * Math.min(wanderSpeed, wanderDist);
        }

        // Clear pathfinding targets (handled manually here)
        unit.targetX = null;
        unit.targetY = null;
        unit.currentSpeed = 0;
      } else if (isCloseEnough) {
        // Worker has arrived but construction not active - just wait
        unit.targetX = null;
        unit.targetY = null;
        unit.currentSpeed = 0;
        this.workerWanderState.delete(entity.id);
      } else {
        // Keep moving towards building
        unit.targetX = buildingTransform.x;
        unit.targetY = buildingTransform.y;
        this.workerWanderState.delete(entity.id);
      }
    }
  }

  /**
   * Update construction progress for buildings based on worker presence
   * RTS-style: Construction only progresses while a worker is actively constructing.
   * If worker leaves, construction pauses but does NOT cancel.
   * Exception: Addons auto-construct without workers.
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

      // Check if this is an addon (addons auto-construct without workers)
      const buildingDef = BUILDING_DEFINITIONS[building.buildingId];
      const isAddon = buildingDef?.isAddon === true;

      // Check if any worker is actively constructing this building (not needed for addons)
      const workerConstructing = isAddon || this.isWorkerConstructing(entity.id, buildingTransform);

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

        // If building was paused, resume construction
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

          // Handle addon completion - attach to parent building
          if (isAddon) {
            this.handleAddonCompletion(entity.id, building, selectable?.playerId);
          } else {
            // Add supply if applicable - only for local player's buildings
            if (building.supplyProvided > 0 && selectable?.playerId && isLocalPlayer(selectable.playerId)) {
              this.game.statePort.addMaxSupply(building.supplyProvided);
            }

            // Set default rally point for production buildings
            if (building.canProduce.length > 0 && building.rallyX === null) {
              building.setRallyPoint(
                buildingTransform.x + building.width / 2 + 3,
                buildingTransform.y
              );
            }

            // Release workers and push them out of the building footprint
            this.releaseWorkersFromBuilding(entity.id, buildingTransform.x, buildingTransform.y, building.width, building.height);

            this.game.eventBus.emit('building:complete', {
              entityId: entity.id,
              buildingType: building.buildingId,
              buildingName: buildingDef?.name ?? building.name,
              playerId: selectable?.playerId,
            });
          }

          debugBuildingPlacement.log(`BuildingPlacementSystem: ${building.name} construction complete!`);
        }
      } else {
        // No worker is constructing - pause if construction had started
        // Note: Addons never reach this branch since workerConstructing is always true for them
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
   * Handle addon construction completion - attach to parent building
   */
  private handleAddonCompletion(addonEntityId: number, addonBuilding: Building, playerId?: string): void {
    const pendingAttachment = this.pendingAddonAttachments.get(addonEntityId);
    if (!pendingAttachment) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: No pending attachment found for addon ${addonEntityId}`);
      return;
    }

    const { parentBuildingId, addonType } = pendingAttachment;

    // Get the parent building
    const parentEntity = this.world.getEntity(parentBuildingId);
    if (!parentEntity) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Parent building ${parentBuildingId} not found for addon completion`);
      this.pendingAddonAttachments.delete(addonEntityId);
      return;
    }

    const parentBuilding = parentEntity.get<Building>('Building');
    if (!parentBuilding) {
      debugBuildingPlacement.warn(`BuildingPlacementSystem: Parent building ${parentBuildingId} missing Building component`);
      this.pendingAddonAttachments.delete(addonEntityId);
      return;
    }

    // Attach the addon to the parent building
    if (addonType) {
      parentBuilding.attachAddon(addonType, addonEntityId);
    }

    // Clean up pending attachment
    this.pendingAddonAttachments.delete(addonEntityId);

    // Emit addon completion event
    this.game.eventBus.emit('building:addon_complete', {
      parentId: parentBuildingId,
      addonId: addonEntityId,
      addonType: addonBuilding.buildingId,
      playerId,
    });

    debugBuildingPlacement.log(`BuildingPlacementSystem: Addon ${addonBuilding.name} attached to parent building ${parentBuildingId}`);
  }

  /**
   * Check if any worker is actively constructing a building
   * For walls: supports AoE construction - workers contribute to ALL nearby walls in their line
   */
  private isWorkerConstructing(buildingEntityId: number, buildingTransform: Transform): boolean {
    // Get building to use its width for consistent threshold with isCloseEnough
    const buildingEntity = this.world.getEntity(buildingEntityId);
    if (!buildingEntity) return false;

    const building = buildingEntity.get<Building>('Building');
    if (!building) return false;

    // Check if this is a wall (for AoE construction)
    const wall = buildingEntity.get<Wall>('Wall');
    const isWall = wall !== undefined;

    const workers = this.world.getEntitiesWith('Unit', 'Transform');

    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      if (unit.state !== 'building') {
        continue;
      }

      // For walls: Allow any worker with this wall in their wallLineSegments to contribute (AoE construction)
      // For regular buildings: Only the assigned worker can construct
      const canConstruct = isWall
        ? (unit.wallLineSegments.includes(buildingEntityId) || unit.constructingBuildingId === buildingEntityId)
        : (unit.constructingBuildingId === buildingEntityId);

      if (!canConstruct) {
        continue;
      }

      const workerTransform = entity.get<Transform>('Transform');
      if (!workerTransform) continue;
      const dist = distance(buildingTransform.x, buildingTransform.y, workerTransform.x, workerTransform.y);

      // Worker is close enough to construct
      // For walls: Use larger AoE construction range so workers can build multiple nearby walls
      // For regular buildings: Use standard construction range
      const constructThreshold = isWall
        ? this.WALL_AOE_CONSTRUCTION_RANGE
        : Math.max(building.width / 2, 3);
      const effectiveRange = isWall
        ? this.WALL_AOE_CONSTRUCTION_RANGE
        : this.CONSTRUCTION_RANGE + constructThreshold;

      if (dist <= effectiveRange) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if any worker is assigned to a building (even if not close yet).
   * Only one worker can build a building at a time.
   */
  private hasWorkerAssigned(buildingEntityId: number): boolean {
    const workers = this.world.getEntitiesWith('Unit');

    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      // Check if worker is assigned to this building, regardless of state
      // (worker could be walking to site, or actively building)
      if (unit.constructingBuildingId === buildingEntityId) {
        return true;
      }
    }

    return false;
  }

  // Range within which idle workers will auto-assist with construction
  private readonly AUTO_ASSIST_RANGE = 15;

  /**
   * Auto-assign nearby idle or gathering workers to help with blueprints that have no workers assigned.
   * These workers are marked as helpers and will return to their original task when done.
   */
  private autoAssignIdleWorkers(): void {
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    const workers = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');

    for (const buildingEntity of buildings) {
      const building = buildingEntity.get<Building>('Building')!;
      const buildingTransform = buildingEntity.get<Transform>('Transform')!;
      const buildingSelectable = buildingEntity.get<Selectable>('Selectable')!;

      // Only check blueprints that need workers (waiting or paused)
      if (building.state !== 'waiting_for_worker' && building.state !== 'paused') {
        continue;
      }

      // Skip if already has a worker assigned
      if (this.hasWorkerAssigned(buildingEntity.id)) {
        continue;
      }

      // Find a nearby idle or gathering worker to auto-assign
      let closestWorker: Entity | null = null;
      let closestDistance = this.AUTO_ASSIST_RANGE;

      for (const workerEntity of workers) {
        const unit = workerEntity.get<Unit>('Unit')!;
        const workerTransform = workerEntity.get<Transform>('Transform')!;
        const workerSelectable = workerEntity.get<Selectable>('Selectable')!;
        const health = workerEntity.get<Health>('Health')!;

        // Must be a worker, same player, idle or gathering, and alive
        if (!unit.isWorker) continue;
        if (workerSelectable.playerId !== buildingSelectable.playerId) continue;
        // Auto-enlist idle workers or gathering workers (they'll return to gathering after)
        if (unit.state !== 'idle' && unit.state !== 'gathering') continue;
        if (health.isDead()) continue;
        // Don't auto-assign workers that already have queued commands
        if (unit.commandQueue.length > 0) continue;
        // Don't auto-assign workers that are already building something
        if (unit.constructingBuildingId !== null) continue;

        const dist = distance(buildingTransform.x, buildingTransform.y, workerTransform.x, workerTransform.y);

        if (dist < closestDistance) {
          closestDistance = dist;
          closestWorker = workerEntity;
        }
      }

      // Assign the closest available worker as a helper
      if (closestWorker) {
        const unit = closestWorker.get<Unit>('Unit')!;
        const workerTransform = closestWorker.get<Transform>('Transform')!;

        // Record original position before helping
        unit.returnPositionX = workerTransform.x;
        unit.returnPositionY = workerTransform.y;
        unit.isHelperWorker = true;

        // Store previous gather target if worker was gathering
        if (unit.state === 'gathering' && unit.gatherTargetId !== null) {
          unit.previousGatherTargetId = unit.gatherTargetId;
        } else {
          unit.previousGatherTargetId = null;
        }

        // Assign to construction
        unit.constructingBuildingId = buildingEntity.id;
        unit.buildingType = building.buildingId;
        unit.buildTargetX = buildingTransform.x;
        unit.buildTargetY = buildingTransform.y;
        unit.state = 'building';
        unit.targetX = buildingTransform.x;
        unit.targetY = buildingTransform.y;
        unit.path = [];
        unit.pathIndex = 0;
        // Clear gathering state while building
        unit.gatherTargetId = null;
        unit.isMining = false;
        unit.miningTimer = 0;

        const taskInfo = unit.previousGatherTargetId
          ? `will return to gathering resource ${unit.previousGatherTargetId}`
          : `will return to (${unit.returnPositionX?.toFixed(1)}, ${unit.returnPositionY?.toFixed(1)})`;
        debugBuildingPlacement.log(`Auto-assigned worker ${closestWorker.id} to help build ${building.name} (${taskInfo})`);
      }
    }
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
        // Refund resources to the player (local player via store, AI via AI state)
        if (isLocalPlayer(selectable.playerId)) {
          this.game.statePort.addResources(definition.mineralCost, definition.vespeneCost);
          debugBuildingPlacement.log(`BuildingPlacementSystem: Refunded ${definition.mineralCost} minerals, ${definition.vespeneCost} vespene for cancelled ${building.name}`);
        } else {
          const aiPlayer = this.getAISystem()?.getAIPlayer(selectable.playerId);
          if (aiPlayer) {
            aiPlayer.minerals += definition.mineralCost;
            aiPlayer.vespene += definition.vespeneCost;
            debugBuildingPlacement.log(`BuildingPlacementSystem: Refunded AI ${selectable.playerId} ${definition.mineralCost} minerals, ${definition.vespeneCost} vespene for cancelled ${building.name}`);
          }
        }

        // PERF: If this is an extractor/refinery, restore the vespene geyser visibility
        // Uses O(1) reverse lookup via linkedResourceId instead of O(n) scan
        if (building.buildingId === 'extractor' || building.buildingId === 'refinery') {
          if (building.linkedResourceId !== null) {
            const resourceEntity = this.world.getEntity(building.linkedResourceId);
            if (resourceEntity) {
              const resource = resourceEntity.get<Resource>('Resource');
              if (resource) {
                resource.extractorEntityId = null;
                debugBuildingPlacement.log(`BuildingPlacementSystem: Extractor cancelled, vespene geyser ${building.linkedResourceId} restored`);
              }
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

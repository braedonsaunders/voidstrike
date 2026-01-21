import { System } from '../ecs/System';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Resource } from '../components/Resource';
import { Building } from '../components/Building';
import { Selectable } from '../components/Selectable';
import { Game } from '../core/Game';
import { World } from '../ecs/World';
import { debugResources } from '@/utils/debugLogger';
import { isLocalPlayer } from '@/store/gameSetupStore';
import { EnhancedAISystem } from './EnhancedAISystem';
import { distance } from '@/utils/math';

// Mining time in seconds (base value - AI may get speed bonuses)
const MINING_TIME = 2.5;

export class ResourceSystem extends System {
  public readonly name = 'ResourceSystem';
  // Priority is set by SystemRegistry based on dependencies (runs after MovementSystem)

  // PERF: Cache resources to avoid repeated getEntitiesWith calls
  private cachedResources: Entity[] | null = null;
  private lastCacheTick: number = -1;

  // PERF: Cache bases per tick to avoid O(workers × bases) in handleResourceReturn
  private cachedBases: Entity[] | null = null;
  private lastBaseCacheTick: number = -1;

  // Cache reference to AI system for mining speed bonuses and resource crediting
  private aiSystem: EnhancedAISystem | null = null;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  public init(world: World): void {
    super.init(world);
    this.setupExtractorCheckers();
    // Cache AI system reference for mining speed bonuses
    this.aiSystem = this.world.getSystem(EnhancedAISystem) || null;
  }

  /**
   * Get the AI system, lazily initializing if needed
   */
  private getAISystem(): EnhancedAISystem | null {
    if (!this.aiSystem) {
      this.aiSystem = this.world.getSystem(EnhancedAISystem) || null;
    }
    return this.aiSystem;
  }

  /**
   * Get the mining time for a player (applies AI speed bonuses)
   */
  private getMiningTimeForPlayer(playerId: string | undefined): number {
    if (!playerId) return MINING_TIME;

    const aiSystem = this.getAISystem();
    if (!aiSystem || !aiSystem.isAIPlayer(playerId)) {
      return MINING_TIME;
    }

    // AI gets faster mining based on difficulty
    const speedMultiplier = aiSystem.getMiningSpeedMultiplier(playerId);
    return MINING_TIME / speedMultiplier;
  }

  /**
   * Set up extractor completion checkers for all vespene geysers.
   * This allows Resource.hasExtractor() to verify the extractor is complete.
   */
  private setupExtractorCheckers(): void {
    // Create a checker function that looks up the building entity
    const extractorChecker = (entityId: number): boolean => {
      const entity = this.world.getEntity(entityId);
      if (!entity) return false;
      const building = entity.get<Building>('Building');
      return building ? building.isComplete() : false;
    };

    // Apply to all existing vespene resources
    const resources = this.world.getEntitiesWith('Resource');
    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource')!;
      if (resource.resourceType === 'vespene') {
        resource.setExtractorCompleteChecker(extractorChecker);
      }
    }

    // Also listen for new resources (if spawned dynamically)
    this.game.eventBus.on('resource:spawned', (data: { entityId: number }) => {
      const entity = this.world.getEntity(data.entityId);
      if (entity) {
        const resource = entity.get<Resource>('Resource');
        if (resource && resource.resourceType === 'vespene') {
          resource.setExtractorCompleteChecker(extractorChecker);
        }
      }
    });
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:gather', this.handleGatherCommand.bind(this));
    this.game.eventBus.on('command:return', this.handleReturnCommand.bind(this));
  }

  private handleGatherCommand(command: {
    entityIds: number[];
    targetEntityId: number;
    queue?: boolean;
  }): void {
    const targetEntity = this.world.getEntity(command.targetEntityId);
    if (!targetEntity) return;

    const resource = targetEntity.get<Resource>('Resource');
    if (!resource) return;

    // Check if trying to gather vespene without an extractor
    if (resource.resourceType === 'vespene' && !resource.hasRefinery()) {
      this.game.eventBus.emit('ui:error', { message: 'Requires an Extractor' });
      return;
    }

    const targetTransform = targetEntity.get<Transform>('Transform');
    if (!targetTransform) return;

    // For minerals, find all nearby mineral patches for worker splitting
    let mineralPatches: Array<{ entity: Entity; resource: Resource; transform: Transform; gathererCount: number }> = [];
    if (resource.resourceType === 'minerals') {
      mineralPatches = this.findNearbyMineralPatches(targetTransform.x, targetTransform.y, 15);
    }

    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit || !unit.isWorker) continue;

      const transform = entity.get<Transform>('Transform');
      if (!transform) continue;

      // Mineral splitting: assign worker to patch with fewest gatherers
      let assignedTargetId = command.targetEntityId;
      let assignedTransform = targetTransform;

      if (resource.resourceType === 'minerals' && mineralPatches.length > 0) {
        // Find the patch with fewest workers (prefer patches with < 2 workers)
        const bestPatch = this.findBestMineralPatch(mineralPatches, transform);
        if (bestPatch) {
          assignedTargetId = bestPatch.entity.id;
          assignedTransform = bestPatch.transform;
          // Increment virtual gatherer count for next worker assignment
          bestPatch.gathererCount++;
        }
      }

      if (command.queue) {
        // Queue the gather command instead of executing immediately
        unit.queueCommand({
          type: 'gather',
          targetEntityId: assignedTargetId,
        });
      } else {
        // If worker is currently constructing, release them from construction
        if (unit.state === 'building' && unit.constructingBuildingId !== null) {
          unit.cancelBuilding();
        }

        // Execute immediately
        unit.gatherTargetId = assignedTargetId;
        unit.state = 'gathering';

        // Clear any existing path so worker will request new path to resource
        unit.path = [];
        unit.pathIndex = 0;

        // Move to assigned resource
        unit.moveToPosition(assignedTransform.x, assignedTransform.y);

        // Debug: log gather command for all workers
        const selectable = entity.get<Selectable>('Selectable');
        debugResources.log(`[ResourceSystem] ${selectable?.playerId} worker ${entityId} assigned to gather resource ${assignedTargetId}, moving to (${assignedTransform.x.toFixed(1)}, ${assignedTransform.y.toFixed(1)}), targetX=${unit.targetX?.toFixed(1)}, targetY=${unit.targetY?.toFixed(1)}, state=${unit.state}`);
      }
    }
  }

  /**
   * PERF: Get cached resources, refreshing if needed
   */
  private getCachedResources(): Entity[] {
    const currentTick = this.game.getCurrentTick();
    if (this.cachedResources === null || this.lastCacheTick !== currentTick) {
      this.cachedResources = this.world.getEntitiesWith('Resource', 'Transform');
      this.lastCacheTick = currentTick;
    }
    return this.cachedResources;
  }

  /**
   * PERF: Get cached bases, refreshing once per tick.
   * Avoids O(workers × bases) when many workers return resources.
   */
  private getCachedBases(): Entity[] {
    const currentTick = this.game.getCurrentTick();
    if (this.cachedBases === null || this.lastBaseCacheTick !== currentTick) {
      this.cachedBases = this.world.getEntitiesWith('Building', 'Transform');
      this.lastBaseCacheTick = currentTick;
    }
    return this.cachedBases;
  }

  /**
   * Find all mineral patches within range of a position (mineral line)
   */
  private findNearbyMineralPatches(
    x: number,
    y: number,
    range: number
  ): Array<{ entity: Entity; resource: Resource; transform: Transform; gathererCount: number }> {
    const patches: Array<{ entity: Entity; resource: Resource; transform: Transform; gathererCount: number }> = [];
    // PERF: Use cached resources instead of querying every time
    const resources = this.getCachedResources();

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource')!;
      const transform = entity.get<Transform>('Transform')!;

      if (resource.resourceType !== 'minerals' || resource.isDepleted()) continue;

      const dist = distance(transform.x, transform.y, x, y);

      if (dist <= range) {
        patches.push({
          entity,
          resource,
          transform,
          gathererCount: resource.getCurrentGatherers(),
        });
      }
    }

    return patches;
  }

  /**
   * Find the best mineral patch for a worker
   * Prefers patches with 0-1 workers, then closest with fewest workers
   */
  private findBestMineralPatch(
    patches: Array<{ entity: Entity; resource: Resource; transform: Transform; gathererCount: number }>,
    workerTransform: Transform
  ): { entity: Entity; resource: Resource; transform: Transform; gathererCount: number } | null {
    if (patches.length === 0) return null;

    // Sort by: 1) gatherer count (fewer first), 2) distance (closer first)
    const sortedPatches = patches
      .filter(p => !p.resource.isDepleted())
      .sort((a, b) => {
        // Strongly prefer patches with < 2 workers (optimal saturation)
        const aOptimal = a.gathererCount < 2 ? 0 : 1;
        const bOptimal = b.gathererCount < 2 ? 0 : 1;
        if (aOptimal !== bOptimal) return aOptimal - bOptimal;

        // Then by gatherer count
        if (a.gathererCount !== b.gathererCount) {
          return a.gathererCount - b.gathererCount;
        }

        // Then by distance
        const distA = workerTransform.distanceTo(a.transform);
        const distB = workerTransform.distanceTo(b.transform);
        return distA - distB;
      });

    return sortedPatches[0] || null;
  }

  /**
   * Find the nearest non-depleted resource of a given type.
   * Used for auto-reassigning workers when their resource depletes.
   * For vespene, only returns resources with completed extractors owned by the player.
   */
  private findNearestResource(
    x: number,
    y: number,
    resourceType: 'minerals' | 'vespene',
    playerId: string | undefined
  ): { entityId: number; x: number; y: number } | null {
    const resources = this.getCachedResources();
    let nearest: { entityId: number; x: number; y: number; dist: number } | null = null;

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');

      if (!resource || !transform) continue;
      if (resource.resourceType !== resourceType) continue;
      if (resource.isDepleted()) continue;

      // For vespene, check if extractor is built and owned by this player
      if (resourceType === 'vespene') {
        if (!resource.hasRefinery()) continue;

        // Verify extractor ownership
        if (resource.extractorEntityId !== null && playerId) {
          const extractorEntity = this.world.getEntity(resource.extractorEntityId);
          if (extractorEntity) {
            const extractorSelectable = extractorEntity.get<Selectable>('Selectable');
            if (extractorSelectable?.playerId !== playerId) continue;
          }
        }
      }

      // Prefer resources with fewer gatherers (saturation check)
      const currentGatherers = resource.getCurrentGatherers();
      const maxGatherers = resourceType === 'minerals' ? 3 : 3; // Allow some oversaturation
      if (currentGatherers >= maxGatherers) continue;

      const dist = distance(transform.x, transform.y, x, y);

      // Limit search range to reasonable distance (60 units = ~2 base widths)
      if (dist > 60) continue;

      if (!nearest || dist < nearest.dist) {
        nearest = {
          entityId: entity.id,
          x: transform.x,
          y: transform.y,
          dist,
        };
      }
    }

    return nearest ? { entityId: nearest.entityId, x: nearest.x, y: nearest.y } : null;
  }

  private handleReturnCommand(command: { entityIds: number[] }): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit || !unit.isWorker) continue;

      if (unit.carryingMinerals > 0 || unit.carryingVespene > 0) {
        this.findAndReturnToBase(entity);
      }
    }
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000; // Convert ms to seconds
    const workers = this.world.getEntitiesWith('Transform', 'Unit');

    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      if (!unit.isWorker || unit.state !== 'gathering') continue;

      const transform = entity.get<Transform>('Transform');
      if (!transform) continue;

      // Check if carrying resources
      if (unit.carryingMinerals > 0 || unit.carryingVespene > 0) {
        this.handleResourceReturn(entity, transform, unit);
        continue;
      }

      // Check if at resource node
      if (unit.gatherTargetId !== null) {
        const resourceEntity = this.world.getEntity(unit.gatherTargetId);
        if (!resourceEntity) {
          unit.gatherTargetId = null;
          unit.isMining = false;
          unit.miningTimer = 0;
          unit.state = 'idle';
          continue;
        }

        const resource = resourceEntity.get<Resource>('Resource');
        const resourceTransform = resourceEntity.get<Transform>('Transform');

        if (!resource || !resourceTransform || resource.isDepleted()) {
          // Resource depleted or destroyed - try to find another nearby resource
          unit.isMining = false;
          unit.miningTimer = 0;

          const selectable = entity.get<Selectable>('Selectable');
          const newResource = this.findNearestResource(
            transform.x,
            transform.y,
            resource?.resourceType || 'minerals',
            selectable?.playerId
          );

          if (newResource) {
            // Auto-assign to new resource
            unit.gatherTargetId = newResource.entityId;
            unit.moveToPosition(newResource.x, newResource.y);
            debugResources.log(`[ResourceSystem] Worker ${entity.id} auto-reassigned from depleted resource to ${newResource.entityId}`);
          } else {
            // No resources available - go idle
            unit.gatherTargetId = null;
            unit.state = 'idle';
          }
          continue;
        }

        const dist = transform.distanceTo(resourceTransform);

        // Get worker's owner for AI speed bonuses and resource crediting
        const selectable = entity.get<Selectable>('Selectable');
        const workerId = selectable?.playerId;

        // Debug: log distance for all workers periodically
        // DETERMINISM: Use tick-based sampling instead of Math.random() to avoid multiplayer desync
        if (this.game.getCurrentTick() % 100 === 0 && entity.id % 5 === 0) {
          debugResources.log(`[ResourceSystem] ${workerId} worker ${entity.id}: distance=${dist.toFixed(2)}, isMining=${unit.isMining}, gatherTargetId=${unit.gatherTargetId}, targetX=${unit.targetX?.toFixed(1)}, targetY=${unit.targetY?.toFixed(1)}, state=${unit.state}`);
        }

        // Vespene extractors are 2x2 buildings - workers need larger gathering distance
        // Minerals are single tiles - workers can get close
        const gatherDistance = resource.resourceType === 'vespene' ? 3.5 : 2;

        if (dist <= gatherDistance) {
          // At resource - start or continue mining
          if (!unit.isMining) {
            // Start mining - use player-specific mining time (AI gets speed bonus)
            unit.isMining = true;
            unit.miningTimer = this.getMiningTimeForPlayer(workerId);
            // Reserve a spot at the resource
            resource.addGatherer(entity.id);
          } else {
            // Continue mining - decrement timer (dt is in seconds)
            unit.miningTimer -= dt;
            if (unit.miningTimer <= 0) {
              // Mining complete - gather resources
              this.gatherResource(entity, unit, resource, resourceTransform);
              unit.isMining = false;
              unit.miningTimer = 0;
            }
          }
        } else {
          // Move to resource (keep gathering state)
          // If we were mining, cancel it
          if (unit.isMining) {
            resource.removeGatherer(entity.id);
            unit.isMining = false;
            unit.miningTimer = 0;
          }

          // For vespene, target a position outside the extractor (which blocks the center)
          // Calculate a point on the edge of the extractor closest to the worker
          if (resource.resourceType === 'vespene') {
            const dx = transform.x - resourceTransform.x;
            const dy = transform.y - resourceTransform.y;
            const dist = distance(transform.x, transform.y, resourceTransform.x, resourceTransform.y);
            if (dist > 0.1) {
              // Target a point 2 units from center (just outside 2x2 extractor)
              const targetX = resourceTransform.x + (dx / dist) * 2;
              const targetY = resourceTransform.y + (dy / dist) * 2;
              unit.moveToPosition(targetX, targetY);
            } else {
              // Worker is at center somehow, move to a default edge
              unit.moveToPosition(resourceTransform.x + 2, resourceTransform.y);
            }
          } else {
            unit.moveToPosition(resourceTransform.x, resourceTransform.y);
          }
        }
      }
    }
  }

  private gatherResource(
    workerEntity: { id: number },
    unit: Unit,
    resource: Resource,
    resourceTransform: Transform
  ): void {
    // Gather the resources (gatherer was already added when mining started)
    const gathered = resource.gather();

    if (resource.resourceType === 'minerals') {
      unit.carryingMinerals = gathered;
    } else {
      unit.carryingVespene = gathered;
    }

    // Remove gatherer - mining complete
    resource.removeGatherer(workerEntity.id);

    // If resource depleted, emit event with position for AI expansion tracking
    if (resource.isDepleted()) {
      this.game.eventBus.emit('resource:depleted', {
        resourceType: resource.resourceType,
        position: { x: resourceTransform.x, y: resourceTransform.y },
      });
    }
  }

  private handleResourceReturn(
    workerEntity: Entity,
    transform: Transform,
    unit: Unit
  ): void {
    // PERF: Use cached bases instead of querying every worker return
    const bases = this.getCachedBases();
    let nearestBase: { transform: Transform; building: Building } | null = null;
    let nearestDistance = Infinity;

    // Get worker's owner to match against bases
    const workerSelectable = workerEntity.get<Selectable>('Selectable');
    const workerOwner = workerSelectable?.playerId;

    for (const baseEntity of bases) {
      const building = baseEntity.get<Building>('Building');
      const baseTransform = baseEntity.get<Transform>('Transform');
      const baseSelectable = baseEntity.get<Selectable>('Selectable');

      // Skip if components are missing or building is destroyed/incomplete
      if (!building || !baseTransform) continue;
      if (!building.isComplete()) continue;

      // Only use bases owned by the same player
      if (baseSelectable?.playerId !== workerOwner) continue;

      const resourceDropOffBuildings = [
        'headquarters', 'orbital_station', 'bastion',
        'nexus',
        'hatchery', 'lair', 'hive'
      ];
      if (!resourceDropOffBuildings.includes(building.buildingId)) {
        continue;
      }

      const distance = transform.distanceTo(baseTransform);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestBase = { transform: baseTransform, building };
      }
    }

    if (!nearestBase) {
      // No base to return to
      unit.state = 'idle';
      return;
    }

    // Calculate drop-off range based on building size
    // Workers carrying resources skip building avoidance, so they can get close
    // Use a generous range to ensure drop-off succeeds
    // FIX: Increased from 2.5 to 3.5 to account for arrival threshold (0.8)
    // Target position is halfWidth + 2.0, so workers can stop at halfWidth + 2.8
    const buildingHalfWidth = (nearestBase.building.width || 5) / 2;
    const dropOffRange = buildingHalfWidth + 3.5; // Generous range accounting for arrival threshold

    if (nearestDistance <= dropOffRange) {
      // At base - deposit resources
      const minerals = unit.carryingMinerals;
      const vespene = unit.carryingVespene;

      if (workerOwner) {
        const aiSystem = this.getAISystem();
        if (aiSystem && aiSystem.isAIPlayer(workerOwner)) {
          // Credit AI player - this is the ONLY way AI gets resources (simulation-based)
          aiSystem.creditResources(workerOwner, minerals, vespene);
        } else if (isLocalPlayer(workerOwner)) {
          // Credit local human player via game store
          this.game.statePort.addResources(minerals, vespene);
        }
      }

      // Emit event for metrics/UI tracking
      this.game.eventBus.emit('resource:delivered', {
        playerId: workerOwner,
        minerals,
        vespene,
      });

      unit.carryingMinerals = 0;
      unit.carryingVespene = 0;

      // Return to gather target if it still exists
      if (unit.gatherTargetId !== null) {
        const resourceEntity = this.world.getEntity(unit.gatherTargetId);
        if (resourceEntity) {
          const resourceTransform = resourceEntity.get<Transform>('Transform');
          const resource = resourceEntity.get<Resource>('Resource');

          if (resourceTransform && resource && !resource.isDepleted()) {
            // Rebalancing: check if we should switch to a less saturated patch
            if (resource.resourceType === 'minerals' && resource.getCurrentGatherers() >= 2) {
              const nearbyPatches = this.findNearbyMineralPatches(resourceTransform.x, resourceTransform.y, 15);
              const betterPatch = nearbyPatches.find(p =>
                p.entity.id !== resourceEntity.id &&
                !p.resource.isDepleted() &&
                p.gathererCount < resource.getCurrentGatherers()
              );

              if (betterPatch) {
                // Switch to less saturated patch
                unit.gatherTargetId = betterPatch.entity.id;
                unit.moveToPosition(betterPatch.transform.x, betterPatch.transform.y);
                debugResources.log(`[ResourceSystem] Worker ${workerEntity.id} switching to less saturated patch ${betterPatch.entity.id}`);
                return;
              }
            }

            unit.moveToPosition(resourceTransform.x, resourceTransform.y);
            debugResources.log(`[ResourceSystem] Worker ${workerEntity.id} dropped off, returning to gather at (${resourceTransform.x.toFixed(1)}, ${resourceTransform.y.toFixed(1)}), targetX=${unit.targetX?.toFixed(1)}`);
            // State already 'gathering'
            return;
          } else {
            debugResources.warn(`[ResourceSystem] Worker ${workerEntity.id} resource invalid after drop-off: transform=${!!resourceTransform}, resource=${!!resource}, depleted=${resource?.isDepleted()}`);
          }
        } else {
          debugResources.warn(`[ResourceSystem] Worker ${workerEntity.id} gatherTargetId ${unit.gatherTargetId} entity not found after drop-off`);
        }
      } else {
        debugResources.warn(`[ResourceSystem] Worker ${workerEntity.id} has no gatherTargetId after drop-off`);
      }

      debugResources.log(`[ResourceSystem] Worker ${workerEntity.id} becoming idle after drop-off (no valid gather target)`);
      unit.state = 'idle';
    } else {
      // Move toward the edge of the base building (not the center)
      // Target must be OUTSIDE the building avoidance zone (halfWidth + 1.0) to prevent oscillation
      const dx = transform.x - nearestBase.transform.x;
      const dy = transform.y - nearestBase.transform.y;
      const dist = distance(transform.x, transform.y, nearestBase.transform.x, nearestBase.transform.y);

      if (dist > 0.1) {
        // Target a point outside the avoidance zone, in direction toward worker
        const dirX = dx / dist;
        const dirY = dy / dist;
        const edgeDistance = buildingHalfWidth + 2.0; // Outside the avoidance margin (halfWidth + 1.0)
        const targetX = nearestBase.transform.x + dirX * edgeDistance;
        const targetY = nearestBase.transform.y + dirY * edgeDistance;
        unit.moveToPosition(targetX, targetY);
      } else {
        // Worker is at center somehow, just move away slightly
        unit.moveToPosition(nearestBase.transform.x + buildingHalfWidth + 2, nearestBase.transform.y);
      }
    }
  }

  private findAndReturnToBase(workerEntity: Entity): void {
    const transform = workerEntity.get<Transform>('Transform');
    const unit = workerEntity.get<Unit>('Unit');

    if (!transform || !unit) return;

    // PERF: Use cached bases instead of querying every worker
    const bases = this.getCachedBases();

    // Get worker's owner
    const workerSelectable = workerEntity.get<Selectable>('Selectable');
    const workerOwner = workerSelectable?.playerId;

    for (const baseEntity of bases) {
      const building = baseEntity.get<Building>('Building');
      const baseTransform = baseEntity.get<Transform>('Transform');
      const baseSelectable = baseEntity.get<Selectable>('Selectable');

      // Skip if components are missing or building destroyed/incomplete
      if (!building || !baseTransform) continue;
      if (!building.isComplete()) continue;

      // Only return to bases owned by the same player
      if (baseSelectable?.playerId !== workerOwner) continue;

      const resourceDropOffBuildings = [
        'headquarters', 'orbital_station', 'bastion',
        'nexus',
        'hatchery', 'lair', 'hive'
      ];
      if (!resourceDropOffBuildings.includes(building.buildingId)) {
        continue;
      }

      // Move toward edge of building, not center (prevents fighting building collision)
      // Target must be outside the avoidance zone (halfWidth + 1.0)
      const buildingHalfWidth = (building.width || 5) / 2;
      const dx = transform.x - baseTransform.x;
      const dy = transform.y - baseTransform.y;
      const dist = distance(transform.x, transform.y, baseTransform.x, baseTransform.y);

      if (dist > 0.1) {
        const dirX = dx / dist;
        const dirY = dy / dist;
        const edgeDistance = buildingHalfWidth + 2.0; // Outside avoidance zone
        unit.moveToPosition(baseTransform.x + dirX * edgeDistance, baseTransform.y + dirY * edgeDistance);
      } else {
        unit.moveToPosition(baseTransform.x + buildingHalfWidth + 2, baseTransform.y);
      }
      unit.state = 'gathering';
      return;
    }
  }
}

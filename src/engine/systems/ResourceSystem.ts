import { System } from '../ecs/System';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Resource } from '../components/Resource';
import { Building } from '../components/Building';
import { Selectable } from '../components/Selectable';
import { Game } from '../core/Game';
import { World } from '../ecs/World';
import { useGameStore } from '@/store/gameStore';

// Mining time in seconds
const MINING_TIME = 2.5;

export class ResourceSystem extends System {
  public priority = 25;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  public init(world: World): void {
    super.init(world);
    this.setupRefineryCheckers();
  }

  /**
   * Set up refinery completion checkers for all vespene geysers.
   * This allows Resource.hasRefinery() to verify the refinery is complete.
   */
  private setupRefineryCheckers(): void {
    // Create a checker function that looks up the building entity
    const refineryChecker = (entityId: number): boolean => {
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
        resource.setRefineryCompleteChecker(refineryChecker);
      }
    }

    // Also listen for new resources (if spawned dynamically)
    this.game.eventBus.on('resource:spawned', (data: { entityId: number }) => {
      const entity = this.world.getEntity(data.entityId);
      if (entity) {
        const resource = entity.get<Resource>('Resource');
        if (resource && resource.resourceType === 'vespene') {
          resource.setRefineryCompleteChecker(refineryChecker);
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
  }): void {
    const targetEntity = this.world.getEntity(command.targetEntityId);
    if (!targetEntity) return;

    const resource = targetEntity.get<Resource>('Resource');
    if (!resource) return;

    // Check if trying to gather vespene without a refinery
    if (resource.resourceType === 'vespene' && !resource.hasRefinery()) {
      this.game.eventBus.emit('ui:error', { message: 'Requires a Refinery' });
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

      // SC2-style mineral splitting: assign worker to patch with fewest gatherers
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

      unit.gatherTargetId = assignedTargetId;
      unit.state = 'gathering';

      // Move to assigned resource
      unit.moveToPosition(assignedTransform.x, assignedTransform.y);
    }
  }

  /**
   * Find all mineral patches within range of a position (SC2-style mineral line)
   */
  private findNearbyMineralPatches(
    x: number,
    y: number,
    range: number
  ): Array<{ entity: Entity; resource: Resource; transform: Transform; gathererCount: number }> {
    const patches: Array<{ entity: Entity; resource: Resource; transform: Transform; gathererCount: number }> = [];
    const resources = this.world.getEntitiesWith('Resource', 'Transform');

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource')!;
      const transform = entity.get<Transform>('Transform')!;

      if (resource.resourceType !== 'minerals' || resource.isDepleted()) continue;

      const dx = transform.x - x;
      const dy = transform.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= range) {
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
   * SC2-style: Find the best mineral patch for a worker
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
      const unit = entity.get<Unit>('Unit')!;

      if (!unit.isWorker || unit.state !== 'gathering') continue;

      const transform = entity.get<Transform>('Transform')!;

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
          unit.gatherTargetId = null;
          unit.isMining = false;
          unit.miningTimer = 0;
          unit.state = 'idle';
          continue;
        }

        const distance = transform.distanceTo(resourceTransform);

        if (distance <= 2) {
          // At resource - start or continue mining
          if (!unit.isMining) {
            // Start mining
            unit.isMining = true;
            unit.miningTimer = MINING_TIME;
            // Reserve a spot at the resource
            resource.addGatherer(entity.id);
          } else {
            // Continue mining - decrement timer (dt is in seconds)
            unit.miningTimer -= dt;
            if (unit.miningTimer <= 0) {
              // Mining complete - gather resources
              this.gatherResource(entity, unit, resource);
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
          unit.moveToPosition(resourceTransform.x, resourceTransform.y);
        }
      }
    }
  }

  private gatherResource(
    workerEntity: { id: number },
    unit: Unit,
    resource: Resource
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

    // If resource depleted, emit event
    if (resource.isDepleted()) {
      this.game.eventBus.emit('resource:depleted', {
        resourceType: resource.resourceType,
      });
    }
  }

  private handleResourceReturn(
    workerEntity: Entity,
    transform: Transform,
    unit: Unit
  ): void {
    // Find nearest command center / main building owned by the same player
    const bases = this.world.getEntitiesWith('Building', 'Transform');
    let nearestBase: { transform: Transform; building: Building } | null = null;
    let nearestDistance = Infinity;

    // Get worker's owner to match against bases
    const workerSelectable = workerEntity.get<Selectable>('Selectable');
    const workerOwner = workerSelectable?.playerId;

    for (const baseEntity of bases) {
      const building = baseEntity.get<Building>('Building')!;
      const baseTransform = baseEntity.get<Transform>('Transform')!;
      const baseSelectable = baseEntity.get<Selectable>('Selectable');

      // Check if this is a main building that accepts resources
      // Includes upgraded versions: Orbital Command, Planetary Fortress, Lair, Hive
      if (!building.isComplete()) continue;

      // Only use bases owned by the same player
      if (baseSelectable?.playerId !== workerOwner) continue;

      const resourceDropOffBuildings = [
        'command_center', 'orbital_command', 'planetary_fortress',
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

    if (nearestDistance <= 3) {
      // At base - deposit resources
      const store = useGameStore.getState();
      store.addResources(unit.carryingMinerals, unit.carryingVespene);

      this.game.eventBus.emit('resource:gathered', {
        minerals: unit.carryingMinerals,
        vespene: unit.carryingVespene,
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
            // SC2-style rebalancing: check if we should switch to a less saturated patch
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
                return;
              }
            }

            unit.moveToPosition(resourceTransform.x, resourceTransform.y);
            // State already 'gathering'
            return;
          }
        }
      }

      unit.state = 'idle';
    } else {
      // Move to base (keep gathering state)
      unit.moveToPosition(nearestBase.transform.x, nearestBase.transform.y);
    }
  }

  private findAndReturnToBase(workerEntity: Entity): void {
    const transform = workerEntity.get<Transform>('Transform');
    const unit = workerEntity.get<Unit>('Unit');

    if (!transform || !unit) return;

    // Find nearest base
    const bases = this.world.getEntitiesWith('Building', 'Transform');

    // Get worker's owner
    const workerSelectable = workerEntity.get<Selectable>('Selectable');
    const workerOwner = workerSelectable?.playerId;

    for (const baseEntity of bases) {
      const building = baseEntity.get<Building>('Building')!;
      const baseTransform = baseEntity.get<Transform>('Transform')!;
      const baseSelectable = baseEntity.get<Selectable>('Selectable');

      if (!building.isComplete()) continue;

      // Only return to bases owned by the same player
      if (baseSelectable?.playerId !== workerOwner) continue;

      const resourceDropOffBuildings = [
        'command_center', 'orbital_command', 'planetary_fortress',
        'nexus',
        'hatchery', 'lair', 'hive'
      ];
      if (!resourceDropOffBuildings.includes(building.buildingId)) {
        continue;
      }

      unit.moveToPosition(baseTransform.x, baseTransform.y);
      unit.state = 'gathering';
      return;
    }
  }
}

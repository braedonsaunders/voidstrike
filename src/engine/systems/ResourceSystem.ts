import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Resource } from '../components/Resource';
import { Building } from '../components/Building';
import { Game } from '../core/Game';
import { useGameStore } from '@/store/gameStore';

export class ResourceSystem extends System {
  public priority = 25;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
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

    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit || !unit.isWorker) continue;

      unit.gatherTargetId = command.targetEntityId;
      unit.state = 'gathering';

      // Move to resource
      const transform = entity.get<Transform>('Transform');
      const targetTransform = targetEntity.get<Transform>('Transform');
      if (transform && targetTransform) {
        unit.setMoveTarget(targetTransform.x, targetTransform.y);
        unit.state = 'gathering';
      }
    }
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
          unit.state = 'idle';
          continue;
        }

        const resource = resourceEntity.get<Resource>('Resource');
        const resourceTransform = resourceEntity.get<Transform>('Transform');

        if (!resource || !resourceTransform || resource.isDepleted()) {
          unit.gatherTargetId = null;
          unit.state = 'idle';
          continue;
        }

        const distance = transform.distanceTo(resourceTransform);

        if (distance <= 2) {
          // At resource - gather
          this.gatherResource(entity, unit, resource);
        } else {
          // Move to resource
          unit.setMoveTarget(resourceTransform.x, resourceTransform.y);
          unit.state = 'gathering';
        }
      }
    }
  }

  private gatherResource(
    workerEntity: { id: number },
    unit: Unit,
    resource: Resource
  ): void {
    // Check if can gather
    if (!resource.canGather()) {
      // Resource is occupied, wait
      return;
    }

    // Add gatherer
    resource.addGatherer(workerEntity.id);

    // Simulate gathering (instant for now, could add animation delay)
    const gathered = resource.gather();

    if (resource.resourceType === 'minerals') {
      unit.carryingMinerals = gathered;
    } else {
      unit.carryingVespene = gathered;
    }

    // Remove gatherer
    resource.removeGatherer(workerEntity.id);

    // If resource depleted, emit event
    if (resource.isDepleted()) {
      this.game.eventBus.emit('resource:depleted', {
        resourceType: resource.resourceType,
      });
    }
  }

  private handleResourceReturn(
    workerEntity: { id: number; get: <T>(type: string) => T | undefined },
    transform: Transform,
    unit: Unit
  ): void {
    // Find nearest command center / main building
    const bases = this.world.getEntitiesWith('Building', 'Transform');
    let nearestBase: { transform: Transform; building: Building } | null = null;
    let nearestDistance = Infinity;

    for (const baseEntity of bases) {
      const building = baseEntity.get<Building>('Building')!;
      const baseTransform = baseEntity.get<Transform>('Transform')!;

      // Check if this is a main building that accepts resources
      if (!building.isComplete()) continue;
      if (!['command_center', 'nexus', 'hatchery'].includes(building.buildingId)) {
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
          if (resourceTransform) {
            unit.setMoveTarget(resourceTransform.x, resourceTransform.y);
            unit.state = 'gathering';
            return;
          }
        }
      }

      unit.state = 'idle';
    } else {
      // Move to base
      unit.setMoveTarget(nearestBase.transform.x, nearestBase.transform.y);
      unit.state = 'gathering'; // Keep in gathering state while returning
    }
  }

  private findAndReturnToBase(workerEntity: {
    id: number;
    get: <T>(type: string) => T | undefined;
  }): void {
    const transform = workerEntity.get<Transform>('Transform');
    const unit = workerEntity.get<Unit>('Unit');

    if (!transform || !unit) return;

    // Find nearest base
    const bases = this.world.getEntitiesWith('Building', 'Transform');

    for (const baseEntity of bases) {
      const building = baseEntity.get<Building>('Building')!;
      const baseTransform = baseEntity.get<Transform>('Transform')!;

      if (!building.isComplete()) continue;
      if (!['command_center', 'nexus', 'hatchery'].includes(building.buildingId)) {
        continue;
      }

      unit.setMoveTarget(baseTransform.x, baseTransform.y);
      unit.state = 'gathering';
      return;
    }
  }
}

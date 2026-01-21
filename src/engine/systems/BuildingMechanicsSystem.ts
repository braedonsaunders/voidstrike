import { System } from '../ecs/System';
import { Entity } from '../ecs/Entity';
import { Game } from '../core/Game';
import { Transform } from '../components/Transform';
import { Building, AddonType } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { BUILDING_DEFINITIONS, RESEARCH_MODULE_UNITS, PRODUCTION_MODULE_UNITS } from '@/data/buildings/dominion';
import { useGameStore } from '@/store/gameStore';
import { findBuildingTarget } from '../combat/TargetAcquisition';
import { distance } from '@/utils/math';

interface LiftOffCommand {
  buildingId: number;
}

interface LandCommand {
  buildingId: number;
  position: { x: number; y: number };
}

interface FlyingBuildingMoveCommand {
  buildingId: number;
  targetPosition: { x: number; y: number };
}

interface BuildAddonCommand {
  buildingId: number;
  addonType: 'research_module' | 'production_module';
  playerId: string;
}

interface LowerSupplyDepotCommand {
  buildingId: number;
  lower?: boolean;
}

interface DemolishCommand {
  entityIds: number[];
}

export class BuildingMechanicsSystem extends System {
  public readonly name = 'BuildingMechanicsSystem';
  // Priority is set by SystemRegistry based on dependencies (runs after BuildingPlacementSystem)

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:liftOff', this.handleLiftOffCommand.bind(this));
    this.game.eventBus.on('command:land', this.handleLandCommand.bind(this));
    this.game.eventBus.on('command:buildAddon', this.handleBuildAddonCommand.bind(this));
    this.game.eventBus.on('command:lowerSupplyDepot', this.handleLowerSupplyDepotCommand.bind(this));
    this.game.eventBus.on('command:attachToAddon', this.handleAttachToAddonCommand.bind(this));
    this.game.eventBus.on('command:flyingBuildingMove', this.handleFlyingBuildingMoveCommand.bind(this));
    this.game.eventBus.on('command:demolish', this.handleDemolishCommand.bind(this));
    // Multiplayer-synced addon commands
    this.game.eventBus.on('addon:lift', this.handleAddonLiftCommand.bind(this));
    this.game.eventBus.on('addon:land', this.handleAddonLandCommand.bind(this));
  }

  private handleAddonLiftCommand(command: { buildingId: number; playerId?: string }): void {
    const entity = this.world.getEntity(command.buildingId);
    if (!entity) return;

    const building = entity.get<Building>('Building');
    if (!building || !building.addonEntityId) return;

    // Detach the addon from this building
    const addonEntity = this.world.getEntity(building.addonEntityId);
    if (addonEntity) {
      const addon = addonEntity.get<Building>('Building');
      if (addon) {
        addon.attachedToId = null;
      }
    }
    building.detachAddon();

    this.game.eventBus.emit('addon:detached', {
      buildingId: command.buildingId,
    });
  }

  private handleAddonLandCommand(command: { buildingId: number; targetPosition?: { x: number; y: number }; playerId?: string }): void {
    // This handles a building attaching to an existing addon at a position
    // The building should fly to the position and then attach
    const entity = this.world.getEntity(command.buildingId);
    if (!entity) return;

    const building = entity.get<Building>('Building');
    if (!building) return;

    // If targetPosition is provided, set the building to fly there
    if (command.targetPosition) {
      building.setFlyingTarget(command.targetPosition.x, command.targetPosition.y);
    }
  }

  private handleLiftOffCommand(command: LiftOffCommand): void {
    const entity = this.world.getEntity(command.buildingId);
    if (!entity) return;

    const building = entity.get<Building>('Building');
    if (!building) return;

    // Save addon entity ID before lift-off (startLiftOff will clear it)
    const addonEntityId = building.addonEntityId;

    if (building.startLiftOff()) {
      // Clear the addon entity's attachedToId so it's available for other buildings
      if (addonEntityId !== null) {
        const addonEntity = this.world.getEntity(addonEntityId);
        if (addonEntity) {
          const addon = addonEntity.get<Building>('Building');
          if (addon) {
            addon.attachedToId = null;
          }
        }
        this.game.eventBus.emit('addon:detached', {
          buildingId: command.buildingId,
          addonId: addonEntityId,
        });
      }

      this.game.eventBus.emit('building:liftOffStart', {
        buildingId: command.buildingId,
      });
    }
  }

  private handleLandCommand(command: LandCommand): void {
    const entity = this.world.getEntity(command.buildingId);
    if (!entity) return;

    const building = entity.get<Building>('Building');
    const transform = entity.get<Transform>('Transform');

    if (!building || !transform) return;

    // Check if landing spot is valid
    if (!this.isValidLandingSpot(command.position.x, command.position.y, building.width, building.height, command.buildingId)) {
      this.game.eventBus.emit('building:landingFailed', {
        buildingId: command.buildingId,
        reason: 'Invalid landing position',
      });
      return;
    }

    // Set landing target - building will fly there first, then land when it arrives
    building.setPendingLanding(command.position.x, command.position.y);
    building.setFlyingTarget(command.position.x, command.position.y);

    this.game.eventBus.emit('building:landingQueued', {
      buildingId: command.buildingId,
      position: command.position,
    });
  }

  private handleFlyingBuildingMoveCommand(command: FlyingBuildingMoveCommand): void {
    const entity = this.world.getEntity(command.buildingId);
    if (!entity) return;

    const building = entity.get<Building>('Building');
    if (!building) return;

    // Only flying buildings can receive move commands
    if (building.state !== 'flying') return;

    building.setFlyingTarget(command.targetPosition.x, command.targetPosition.y);
  }

  private handleBuildAddonCommand(command: BuildAddonCommand): void {
    const entity = this.world.getEntity(command.buildingId);
    if (!entity) return;

    const building = entity.get<Building>('Building');
    const transform = entity.get<Transform>('Transform');
    const selectable = entity.get<Selectable>('Selectable');

    if (!building || !transform || !selectable) return;
    if (!building.canHaveAddon) return;
    if (building.hasAddon()) return;
    if (building.state !== 'complete') return;

    // Check if addon spot is clear
    const addonX = transform.x + building.width;
    const addonY = transform.y;

    if (!this.isValidBuildingSpot(addonX, addonY, 2, 2, -1)) {
      this.game.eventBus.emit('building:addonFailed', {
        buildingId: command.buildingId,
        reason: 'Addon position blocked',
      });
      return;
    }

    // Emit event to create the addon building
    this.game.eventBus.emit('building:place', {
      buildingType: command.addonType,
      position: { x: addonX, y: addonY },
      playerId: command.playerId,
      isAddon: true,
      attachTo: command.buildingId,
    });
  }

  private handleAttachToAddonCommand(data: { buildingId: number; addonId: number }): void {
    const buildingEntity = this.world.getEntity(data.buildingId);
    const addonEntity = this.world.getEntity(data.addonId);

    if (!buildingEntity || !addonEntity) return;

    const building = buildingEntity.get<Building>('Building');
    const addon = addonEntity.get<Building>('Building');

    if (!building || !addon) return;

    const addonType = addon.buildingId === 'research_module' ? 'research_module' : 'production_module';
    building.attachAddon(addonType, data.addonId);
    addon.attachedToId = data.buildingId;

    this.game.eventBus.emit('building:addonAttached', {
      buildingId: data.buildingId,
      addonId: data.addonId,
      addonType,
    });
  }

  private handleLowerSupplyDepotCommand(command: LowerSupplyDepotCommand): void {
    const entity = this.world.getEntity(command.buildingId);
    if (!entity) return;

    const building = entity.get<Building>('Building');
    if (!building) return;

    if (command.lower !== undefined) {
      building.setLowered(command.lower);
    } else {
      building.toggleLowered();
    }

    this.game.eventBus.emit('building:supplyDepotToggled', {
      buildingId: command.buildingId,
      isLowered: building.isLowered,
    });
  }

  private handleDemolishCommand(command: DemolishCommand): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const building = entity.get<Building>('Building');
      const transform = entity.get<Transform>('Transform');
      const selectable = entity.get<Selectable>('Selectable');

      if (!building || !transform || !selectable) continue;

      // Cannot demolish buildings that are destroyed or flying
      if (building.state === 'destroyed' || building.state === 'lifting' ||
          building.state === 'flying' || building.state === 'landing') {
        continue;
      }

      // Get building definition for cost calculation
      const buildingDef = BUILDING_DEFINITIONS[building.buildingId];
      if (!buildingDef) continue;

      // Calculate refund based on building state and progress
      // Under construction: 75% of resources spent so far
      // Complete: 50% of total cost (salvage value)
      let refundMinerals = 0;
      let refundVespene = 0;

      if (building.isComplete()) {
        // Complete building: 50% salvage value
        refundMinerals = Math.floor(buildingDef.mineralCost * 0.5);
        refundVespene = Math.floor(buildingDef.vespeneCost * 0.5);
      } else {
        // Under construction: 75% of resources spent so far
        const spentMinerals = buildingDef.mineralCost * building.buildProgress;
        const spentVespene = buildingDef.vespeneCost * building.buildProgress;
        refundMinerals = Math.floor(spentMinerals * 0.75);
        refundVespene = Math.floor(spentVespene * 0.75);
      }

      // Refund supply if building provides supply and is complete
      if (building.isComplete() && building.supplyProvided > 0) {
        useGameStore.getState().addMaxSupply(-building.supplyProvided);
      }

      // Refund resources
      if (refundMinerals > 0 || refundVespene > 0) {
        useGameStore.getState().addResources(refundMinerals, refundVespene);
      }

      // Mark as destroyed
      building.state = 'destroyed';

      // Emit building:destroyed event
      this.game.eventBus.emit('building:destroyed', {
        entityId: entityId,
        playerId: selectable.playerId,
        buildingType: building.buildingId,
        position: { x: transform.x, y: transform.y },
        width: building.width,
        height: building.height,
        demolished: true, // Flag to indicate this was a manual demolish
        refund: { minerals: refundMinerals, vespene: refundVespene },
      });

      // Destroy the entity
      this.world.destroyEntity(entityId);
    }
  }

  private isValidLandingSpot(x: number, y: number, width: number, height: number, excludeId: number): boolean {
    return this.isValidBuildingSpot(x, y, width, height, excludeId);
  }

  private isValidBuildingSpot(x: number, y: number, width: number, height: number, excludeId: number): boolean {
    const config = this.game.config;
    if (x < 0 || y < 0 || x + width > config.mapWidth || y + height > config.mapHeight) {
      return false;
    }

    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    for (const entity of buildings) {
      if (entity.id === excludeId) continue;

      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;

      // Skip flying buildings (includes lifting, flying, and landing states)
      if (building.isFlying || building.state === 'lifting' || building.state === 'flying' || building.state === 'landing') continue;

      if (
        x < transform.x + building.width + 1 &&
        x + width > transform.x - 1 &&
        y < transform.y + building.height + 1 &&
        y + height > transform.y - 1
      ) {
        return false;
      }
    }

    return true;
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000;
    const gameTime = this.game.getGameTime();

    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');

    for (const entity of buildings) {
      const building = entity.get<Building>('Building');
      const transform = entity.get<Transform>('Transform');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');
      if (!building || !transform || !selectable) continue;

      if (health?.isDead()) continue;

      // Update lift/land animations
      if (building.state === 'lifting') {
        if (building.updateLift(dt)) {
          // Update visualHeight for selection - flying buildings at 8 units height
          selectable.visualHeight = 8;

          this.game.eventBus.emit('building:liftOffComplete', {
            buildingId: entity.id,
          });
        }
      } else if (building.state === 'landing') {
        if (building.updateLanding(dt)) {
          // Reset visualHeight when landed
          selectable.visualHeight = 0;

          // Check for nearby addon to attach
          this.checkForAddonAttachment(entity.id, transform, building);

          this.game.eventBus.emit('building:landingComplete', {
            buildingId: entity.id,
          });
        }
      } else if (building.state === 'flying') {
        if (building.hasFlyingTarget()) {
          // Update flying building movement with acceleration/deceleration
          const targetX = building.flyingTargetX!;
          const targetY = building.flyingTargetY!;

          const dx = targetX - transform.x;
          const dy = targetY - transform.y;
          const dist = distance(transform.x, transform.y, targetX, targetY);

          const arrivalThreshold = 0.5;
          if (dist < arrivalThreshold) {
            // Arrived at destination
            building.clearFlyingTarget();

            // If we have a pending landing, start the landing animation now
            if (building.hasPendingLanding()) {
              const landX = building.pendingLandingX!;
              const landY = building.pendingLandingY!;
              building.clearPendingLanding();

              // Snap to exact landing position
              transform.x = landX;
              transform.y = landY;

              if (building.startLanding(landX, landY)) {
                this.game.eventBus.emit('building:landingStart', {
                  buildingId: entity.id,
                  position: { x: landX, y: landY },
                });
              }
            }
          } else {
            // Move toward target with smooth acceleration/deceleration
            const maxSpeed = building.flyingSpeed;
            const acceleration = 1.5; // units per second squared
            const deceleration = 2.0;

            // Calculate stopping distance
            const currentSpeedSq = building.flyingCurrentSpeed ? building.flyingCurrentSpeed * building.flyingCurrentSpeed : 0;
            const stoppingDistance = currentSpeedSq / (2 * deceleration);

            let targetSpeed: number;
            if (dist <= stoppingDistance + 0.5) {
              // Decelerate as we approach
              targetSpeed = Math.max(0.3, Math.sqrt(2 * deceleration * dist));
            } else {
              // Accelerate toward max speed
              targetSpeed = maxSpeed;
            }

            // Smoothly adjust current speed
            if (!building.flyingCurrentSpeed) {
              building.flyingCurrentSpeed = 0;
            }

            if (building.flyingCurrentSpeed < targetSpeed) {
              building.flyingCurrentSpeed = Math.min(targetSpeed, building.flyingCurrentSpeed + acceleration * dt);
            } else {
              building.flyingCurrentSpeed = Math.max(targetSpeed, building.flyingCurrentSpeed - deceleration * dt);
            }

            const moveDistance = building.flyingCurrentSpeed * dt;
            const ratio = Math.min(moveDistance / dist, 1);
            transform.x += dx * ratio;
            transform.y += dy * ratio;
          }
        } else if (building.hasPendingLanding()) {
          // Edge case: has pending landing but no flying target (shouldn't happen, but handle it)
          const landX = building.pendingLandingX!;
          const landY = building.pendingLandingY!;
          building.clearPendingLanding();
          transform.x = landX;
          transform.y = landY;

          if (building.startLanding(landX, landY)) {
            this.game.eventBus.emit('building:landingStart', {
              buildingId: entity.id,
              position: { x: landX, y: landY },
            });
          }
        }
      }

      // Process turret/building attacks
      this.processBuildingAttack(entity.id, building, transform, selectable, gameTime);
    }
  }

  private checkForAddonAttachment(buildingId: number, transform: Transform, building: Building): void {
    if (!building.canHaveAddon || building.hasAddon()) return;

    // Check for addon at expected position
    const addonX = transform.x + building.width;
    const addonY = transform.y;

    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    for (const entity of buildings) {
      if (entity.id === buildingId) continue;

      const addonBuilding = entity.get<Building>('Building')!;
      const addonTransform = entity.get<Transform>('Transform')!;

      // Check if this is an unattached addon at the right position
      if (addonBuilding.buildingId !== 'research_module' && addonBuilding.buildingId !== 'production_module') continue;
      if (addonBuilding.attachedToId !== null) continue;

      const dx = Math.abs(addonTransform.x - addonX);
      const dy = Math.abs(addonTransform.y - addonY);

      if (dx < 0.5 && dy < 0.5) {
        // Found matching addon, attach it
        this.handleAttachToAddonCommand({ buildingId, addonId: entity.id });
        break;
      }
    }
  }

  private processBuildingAttack(
    buildingId: number,
    building: Building,
    transform: Transform,
    selectable: Selectable,
    gameTime: number
  ): void {
    if (building.attackDamage <= 0 || building.attackRange <= 0) return;
    if (!building.canAttack(gameTime)) return;
    if (building.state !== 'complete') return;

    // Find enemies in range
    const target = this.findBestTarget(transform, selectable.playerId, building.attackRange);
    if (!target) return;

    const targetHealth = target.entity.get<Health>('Health')!;
    const targetTransform = target.entity.get<Transform>('Transform')!;

    // Apply damage
    targetHealth.takeDamage(building.attackDamage, gameTime);
    building.lastAttackTime = gameTime;

    this.game.eventBus.emit('combat:attack', {
      attackerId: buildingId,
      attackerPos: { x: transform.x, y: transform.y },
      targetPos: { x: targetTransform.x, y: targetTransform.y },
      damage: building.attackDamage,
      fromBuilding: true,
    });
  }

  /**
   * Find best target using spatial grid for O(nearby) instead of O(all entities).
   * Uses the shared TargetAcquisition utility with priority-based scoring.
   */
  private findBestTarget(
    transform: Transform,
    playerId: string,
    range: number
  ): { entity: Entity; distance: number } | null {
    return findBuildingTarget(this.world, transform, playerId, range);
  }

  // Check if a unit can be produced with current addon
  public canProduceUnit(building: Building, unitId: string): boolean {
    const buildingType = building.buildingId;

    // Check if unit requires tech lab
    const techLabUnits = RESEARCH_MODULE_UNITS[buildingType] || [];
    if (techLabUnits.includes(unitId)) {
      return building.hasTechLab();
    }

    // Basic units can be produced without addon
    return true;
  }

  // Check if reactor double-production is available
  public canDoubleProduceUnit(building: Building, unitId: string): boolean {
    if (!building.hasReactor()) return false;

    const buildingType = building.buildingId;
    const reactorUnits = PRODUCTION_MODULE_UNITS[buildingType] || [];

    return reactorUnits.includes(unitId);
  }
}

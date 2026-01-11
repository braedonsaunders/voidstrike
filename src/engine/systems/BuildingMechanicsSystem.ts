import { System } from '../ecs/System';
import { Entity } from '../ecs/Entity';
import { Game } from '../core/Game';
import { Transform } from '../components/Transform';
import { Building, AddonType } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { RESEARCH_MODULE_UNITS, PRODUCTION_MODULE_UNITS } from '@/data/buildings/dominion';

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

export class BuildingMechanicsSystem extends System {
  public priority = 8; // Before UnitMechanicsSystem

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
  }

  private handleLiftOffCommand(command: LiftOffCommand): void {
    const entity = this.world.getEntity(command.buildingId);
    if (!entity) return;

    const building = entity.get<Building>('Building');
    if (!building) return;

    if (building.startLiftOff()) {
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

    // Move building to landing position
    transform.x = command.position.x;
    transform.y = command.position.y;

    if (building.startLanding(command.position.x, command.position.y)) {
      this.game.eventBus.emit('building:landingStart', {
        buildingId: command.buildingId,
        position: command.position,
      });
    }
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
    building.attachAddon(addonType as AddonType, data.addonId);
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

      // Skip flying buildings
      if (building.isFlying) continue;

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
      } else if (building.state === 'flying' && building.hasFlyingTarget()) {
        // Update flying building movement
        const targetX = building.flyingTargetX!;
        const targetY = building.flyingTargetY!;

        const dx = targetX - transform.x;
        const dy = targetY - transform.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const arrivalThreshold = 0.5;
        if (distance < arrivalThreshold) {
          // Arrived at destination
          building.clearFlyingTarget();
        } else {
          // Move toward target
          const moveDistance = building.flyingSpeed * dt;
          const ratio = Math.min(moveDistance / distance, 1);
          transform.x += dx * ratio;
          transform.y += dy * ratio;
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

  private findBestTarget(
    transform: Transform,
    playerId: string,
    range: number
  ): { entity: Entity; distance: number } | null {
    let bestTarget: { entity: Entity; distance: number } | null = null;

    const entities = this.world.getEntitiesWith('Transform', 'Health', 'Selectable');

    for (const entity of entities) {
      const targetSelectable = entity.get<Selectable>('Selectable')!;
      const targetHealth = entity.get<Health>('Health')!;
      const targetTransform = entity.get<Transform>('Transform')!;

      if (targetSelectable.playerId === playerId) continue;
      if (targetHealth.isDead()) continue;

      const dx = targetTransform.x - transform.x;
      const dy = targetTransform.y - transform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= range) {
        if (!bestTarget || distance < bestTarget.distance) {
          bestTarget = { entity, distance };
        }
      }
    }

    return bestTarget;
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

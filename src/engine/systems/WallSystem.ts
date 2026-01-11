import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Building } from '../components/Building';
import { Wall } from '../components/Wall';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Unit } from '../components/Unit';
import { WALL_DEFINITIONS, WALL_UPGRADE_DEFINITIONS, WallUpgradeType } from '@/data/buildings/walls';
import { useGameStore } from '@/store/gameStore';
import { isLocalPlayer, getLocalPlayerId } from '@/store/gameSetupStore';

/**
 * WallSystem handles all wall-related mechanics:
 * - Auto-connecting walls to neighbors
 * - Gate open/close state machine
 * - Auto-opening gates for friendly units
 * - Wall shield regeneration
 * - Repair drone healing
 * - Wall upgrade application
 */
export class WallSystem extends System {
  public priority = 15; // Run after BuildingPlacementSystem

  // Distance to check for gate proximity
  private static readonly GATE_TRIGGER_DISTANCE = 3;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Wall placed - update connections
    this.game.eventBus.on('wall:placed', this.handleWallPlaced.bind(this));

    // Wall destroyed - update neighbor connections
    this.game.eventBus.on('wall:destroyed', this.handleWallDestroyed.bind(this));

    // Gate commands
    this.game.eventBus.on('command:gate_toggle', this.handleGateToggle.bind(this));
    this.game.eventBus.on('command:gate_lock', this.handleGateLock.bind(this));
    this.game.eventBus.on('command:gate_auto', this.handleGateAuto.bind(this));

    // Wall upgrade commands
    this.game.eventBus.on('command:wall_upgrade', this.handleWallUpgrade.bind(this));

    // Turret mounting
    this.game.eventBus.on('command:mount_turret', this.handleMountTurret.bind(this));
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000;

    const walls = this.world.getEntitiesWith('Wall', 'Building', 'Transform', 'Health');

    for (const entity of walls) {
      const wall = entity.get<Wall>('Wall')!;
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health')!;

      // Skip incomplete walls
      if (!building.isComplete()) continue;

      // Update gate mechanics
      if (wall.isGate) {
        this.updateGateProximity(entity, wall);
        wall.updateGate(dt);
      }

      // Update shield regeneration
      wall.updateShield(dt);

      // Update repair drone healing
      if (wall.hasRepairDrone) {
        this.updateRepairDrone(entity, wall, dt);
      }

      // Update wall upgrades in progress
      if (wall.upgradeInProgress !== null) {
        const upgradeDef = WALL_UPGRADE_DEFINITIONS[wall.upgradeInProgress];
        if (wall.updateUpgrade(dt, upgradeDef.applyTime)) {
          // Upgrade completed
          this.applyWallUpgradeEffects(entity, wall, building, health);
        }
      }
    }
  }

  /**
   * Check if friendly units are near gate and trigger opening
   */
  private updateGateProximity(gateEntity: Entity, wall: Wall): void {
    if (wall.gateState !== 'auto') return;

    const gateTransform = gateEntity.get<Transform>('Transform')!;
    const gateSelectable = gateEntity.get<Selectable>('Selectable')!;

    // Check for nearby friendly units
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable');

    for (const unitEntity of units) {
      const unitSelectable = unitEntity.get<Selectable>('Selectable')!;

      // Must be same player
      if (unitSelectable.playerId !== gateSelectable.playerId) continue;

      const unitTransform = unitEntity.get<Transform>('Transform')!;
      const dx = unitTransform.x - gateTransform.x;
      const dy = unitTransform.y - gateTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= WallSystem.GATE_TRIGGER_DISTANCE) {
        wall.triggerOpen();
        break;
      }
    }
  }

  /**
   * Repair drone heals adjacent walls
   */
  private updateRepairDrone(droneEntity: Entity, wall: Wall, dt: number): void {
    const droneTransform = droneEntity.get<Transform>('Transform')!;
    const droneSelectable = droneEntity.get<Selectable>('Selectable')!;

    // Find adjacent walls to heal
    const walls = this.world.getEntitiesWith('Wall', 'Building', 'Transform', 'Health', 'Selectable');

    for (const wallEntity of walls) {
      if (wallEntity.id === droneEntity.id) continue;

      const wallSelectable = wallEntity.get<Selectable>('Selectable')!;
      if (wallSelectable.playerId !== droneSelectable.playerId) continue;

      const wallTransform = wallEntity.get<Transform>('Transform')!;
      const dx = wallTransform.x - droneTransform.x;
      const dy = wallTransform.y - droneTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= wall.repairRadius) {
        const wallHealth = wallEntity.get<Health>('Health')!;
        if (wallHealth.current < wallHealth.max) {
          wallHealth.current = Math.min(wallHealth.max, wallHealth.current + wall.repairRate * dt);
        }
      }
    }
  }

  /**
   * Apply visual and stat effects when wall upgrade completes
   */
  private applyWallUpgradeEffects(entity: Entity, wall: Wall, building: Building, health: Health): void {
    switch (wall.appliedUpgrade) {
      case 'reinforced':
        // Double health, increase armor
        health.max = 800;
        health.current = Math.min(health.current + 400, health.max);
        health.armor = 3;
        break;

      case 'shielded':
        // Shield is already set in Wall.applyUpgradeEffects()
        health.armor = 2;
        break;

      case 'weapon':
        // Add attack capabilities
        building.attackRange = 6;
        building.attackDamage = 5;
        building.attackSpeed = 1.0;
        health.armor = 2;
        break;

      case 'repair_drone':
        // Repair drone is set in Wall.applyUpgradeEffects()
        break;
    }

    const selectable = entity.get<Selectable>('Selectable');
    this.game.eventBus.emit('wall:upgrade_complete', {
      entityId: entity.id,
      upgradeType: wall.appliedUpgrade,
      playerId: selectable?.playerId,
    });
  }

  /**
   * Handle a new wall being placed - find and update connections
   */
  private handleWallPlaced(data: { entityId: number; position: { x: number; y: number } }): void {
    const entity = this.world.getEntity(data.entityId);
    if (!entity) return;

    const wall = entity.get<Wall>('Wall');
    if (!wall) return;

    const transform = entity.get<Transform>('Transform')!;

    // Find adjacent walls
    this.updateWallConnections(entity, wall, transform);
  }

  /**
   * Handle a wall being destroyed - update neighbor connections
   */
  private handleWallDestroyed(data: { entityId: number }): void {
    // Find all walls that had this wall as a neighbor
    const walls = this.world.getEntitiesWith('Wall', 'Transform');

    for (const entity of walls) {
      const wall = entity.get<Wall>('Wall')!;
      const neighborIds = wall.getNeighborIds();

      if (neighborIds.includes(data.entityId)) {
        // Remove this neighbor
        if (wall.neighborNorth === data.entityId) wall.setNeighbor('north', null);
        if (wall.neighborSouth === data.entityId) wall.setNeighbor('south', null);
        if (wall.neighborEast === data.entityId) wall.setNeighbor('east', null);
        if (wall.neighborWest === data.entityId) wall.setNeighbor('west', null);
      }
    }
  }

  /**
   * Find and connect to adjacent walls
   */
  private updateWallConnections(entity: Entity, wall: Wall, transform: Transform): void {
    const walls = this.world.getEntitiesWith('Wall', 'Transform', 'Building');
    const selectable = entity.get<Selectable>('Selectable');

    for (const otherEntity of walls) {
      if (otherEntity.id === entity.id) continue;

      const otherSelectable = otherEntity.get<Selectable>('Selectable');
      // Only connect walls of the same player
      if (selectable?.playerId !== otherSelectable?.playerId) continue;

      const otherTransform = otherEntity.get<Transform>('Transform')!;
      const otherWall = otherEntity.get<Wall>('Wall')!;

      const dx = otherTransform.x - transform.x;
      const dy = otherTransform.y - transform.y;

      // Check for cardinal adjacency (within 1.5 units to account for different sizes)
      if (Math.abs(dx) <= 1.5 && Math.abs(dy) <= 0.5) {
        // Horizontal neighbor
        if (dx > 0) {
          wall.setNeighbor('east', otherEntity.id);
          otherWall.setNeighbor('west', entity.id);
        } else if (dx < 0) {
          wall.setNeighbor('west', otherEntity.id);
          otherWall.setNeighbor('east', entity.id);
        }
      } else if (Math.abs(dy) <= 1.5 && Math.abs(dx) <= 0.5) {
        // Vertical neighbor
        if (dy > 0) {
          wall.setNeighbor('south', otherEntity.id);
          otherWall.setNeighbor('north', entity.id);
        } else if (dy < 0) {
          wall.setNeighbor('north', otherEntity.id);
          otherWall.setNeighbor('south', entity.id);
        }
      }
    }
  }

  /**
   * Handle gate toggle command
   */
  private handleGateToggle(data: { entityIds: number[] }): void {
    for (const entityId of data.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const wall = entity.get<Wall>('Wall');
      if (wall?.isGate) {
        wall.toggleGate();
      }
    }
  }

  /**
   * Handle gate lock command
   */
  private handleGateLock(data: { entityIds: number[] }): void {
    for (const entityId of data.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const wall = entity.get<Wall>('Wall');
      if (wall?.isGate) {
        wall.toggleLock();
      }
    }
  }

  /**
   * Handle gate auto mode command
   */
  private handleGateAuto(data: { entityIds: number[] }): void {
    for (const entityId of data.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const wall = entity.get<Wall>('Wall');
      if (wall?.isGate) {
        wall.setAutoMode();
      }
    }
  }

  /**
   * Handle wall upgrade command
   */
  private handleWallUpgrade(data: {
    entityIds: number[];
    upgradeType: WallUpgradeType;
    playerId?: string;
  }): void {
    const { entityIds, upgradeType, playerId = getLocalPlayerId() ?? 'player1' } = data;
    const upgradeDef = WALL_UPGRADE_DEFINITIONS[upgradeType];

    if (!upgradeDef) return;

    const store = useGameStore.getState();
    const isPlayerLocal = isLocalPlayer(playerId);

    // Check if research is complete
    if (!store.hasResearch(playerId, `wall_${upgradeType}`)) {
      this.game.eventBus.emit('ui:error', { message: `Research ${upgradeDef.name} first`, playerId });
      return;
    }

    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const wall = entity.get<Wall>('Wall');
      const selectable = entity.get<Selectable>('Selectable');

      if (!wall || selectable?.playerId !== playerId) continue;

      // Check if already upgraded
      if (wall.appliedUpgrade !== null) {
        this.game.eventBus.emit('ui:error', { message: 'Wall already upgraded', playerId });
        continue;
      }

      // Check cost
      if (isPlayerLocal) {
        if (store.minerals < upgradeDef.applyCost.minerals || store.vespene < upgradeDef.applyCost.vespene) {
          this.game.eventBus.emit('ui:error', { message: 'Not enough resources', playerId });
          continue;
        }
      }

      // Deduct resources
      if (isPlayerLocal) {
        store.addResources(-upgradeDef.applyCost.minerals, -upgradeDef.applyCost.vespene);
      }

      // Start upgrade
      wall.startUpgrade(upgradeType);

      this.game.eventBus.emit('wall:upgrade_started', {
        entityId,
        upgradeType,
        playerId,
      });
    }
  }

  /**
   * Handle mounting a turret on a wall
   */
  private handleMountTurret(data: {
    wallId: number;
    turretId: number;
    playerId?: string;
  }): void {
    const { wallId, turretId, playerId = getLocalPlayerId() ?? 'player1' } = data;

    const wallEntity = this.world.getEntity(wallId);
    const turretEntity = this.world.getEntity(turretId);

    if (!wallEntity || !turretEntity) return;

    const wall = wallEntity.get<Wall>('Wall');
    const wallBuilding = wallEntity.get<Building>('Building');
    const wallTransform = wallEntity.get<Transform>('Transform');
    const wallSelectable = wallEntity.get<Selectable>('Selectable');

    const turretBuilding = turretEntity.get<Building>('Building');
    const turretTransform = turretEntity.get<Transform>('Transform');
    const turretSelectable = turretEntity.get<Selectable>('Selectable');

    if (!wall || !wallBuilding || !turretBuilding) return;

    // Verify ownership
    if (wallSelectable?.playerId !== playerId || turretSelectable?.playerId !== playerId) {
      this.game.eventBus.emit('ui:error', { message: 'Cannot mount turret on enemy wall', playerId });
      return;
    }

    // Verify wall is complete
    if (!wallBuilding.isComplete()) {
      this.game.eventBus.emit('ui:error', { message: 'Wall must be complete', playerId });
      return;
    }

    // Verify turret is a defense turret
    if (turretBuilding.buildingId !== 'defense_turret') {
      this.game.eventBus.emit('ui:error', { message: 'Only Defense Turrets can be mounted', playerId });
      return;
    }

    // Check if wall can mount
    if (!wall.canMount()) {
      this.game.eventBus.emit('ui:error', { message: 'Cannot mount turret here', playerId });
      return;
    }

    // Mount the turret
    if (wall.mountTurret(turretId) && wallTransform && turretTransform) {
      // Move turret to wall position (elevated)
      turretTransform.x = wallTransform.x;
      turretTransform.y = wallTransform.y;

      // Increase turret range when mounted
      turretBuilding.attackRange += 1;

      this.game.eventBus.emit('wall:turret_mounted', {
        wallId,
        turretId,
        playerId,
      });
    }
  }

  /**
   * Check if a position has a wall (for pathfinding)
   */
  public isWallAt(x: number, y: number, playerId: string): { blocked: boolean; gatePassable: boolean } {
    const walls = this.world.getEntitiesWith('Wall', 'Building', 'Transform', 'Selectable');

    for (const entity of walls) {
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;
      const wall = entity.get<Wall>('Wall')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      if (!building.isComplete()) continue;

      const halfW = building.width / 2;
      const halfH = building.height / 2;

      if (x >= transform.x - halfW && x <= transform.x + halfW &&
          y >= transform.y - halfH && y <= transform.y + halfH) {
        // Found wall at position
        if (wall.isGate && wall.isPassable() && selectable.playerId === playerId) {
          return { blocked: false, gatePassable: true };
        }
        return { blocked: true, gatePassable: false };
      }
    }

    return { blocked: false, gatePassable: false };
  }
}

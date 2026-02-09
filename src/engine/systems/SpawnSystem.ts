import { System } from '../ecs/System';
import type { IGameInstance } from '../core/IGameInstance';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Velocity } from '../components/Velocity';
import { Ability } from '../components/Ability';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { DOMINION_ABILITIES } from '../components/Ability';
import { debugSpawning } from '@/utils/debugLogger';
import { AssetManager } from '@/assets/AssetManager';
import { EnhancedAISystem } from './EnhancedAISystem';

// Note: Airborne height is now configured per-unit-type in assets.json
// Use AssetManager.getAirborneHeight(unitType) to get the configured height

/**
 * SpawnSystem handles creating new units when production completes
 * or when units need to be spawned dynamically (eg. from abilities)
 */
export class SpawnSystem extends System {
  public readonly name = 'SpawnSystem';
  // Priority is set by SystemRegistry based on dependencies (no deps, runs early)

  // Cached reference to AI system (lazy loaded)
  private aiSystem: EnhancedAISystem | null = null;

  constructor(game: IGameInstance) {
    super(game);
    this.setupEventListeners();
  }

  private getAISystem(): EnhancedAISystem | null {
    if (!this.aiSystem) {
      this.aiSystem = this.world.getSystem(EnhancedAISystem) || null;
    }
    return this.aiSystem;
  }

  private setupEventListeners(): void {
    // Handle unit spawning from production
    this.game.eventBus.on('unit:spawn', this.handleUnitSpawn.bind(this));

    // Handle building spawning (console command / debug)
    this.game.eventBus.on('building:spawn', this.handleBuildingSpawn.bind(this));

    // Handle unit death (cleanup)
    this.game.eventBus.on('unit:died', this.handleUnitDeath.bind(this));

    // Handle direct entity destruction (e.g., from battle simulator clear)
    this.game.eventBus.on('entity:destroy', this.handleEntityDestroy.bind(this));
  }

  private handleEntityDestroy(data: { entityId: number }): void {
    const entity = this.world.getEntity(data.entityId);
    if (entity) {
      this.world.destroyEntity(data.entityId);
    }
  }

  private handleUnitSpawn(data: {
    unitType: string;
    x: number;
    y: number;
    playerId: string;
    rallyX?: number | null;
    rallyY?: number | null;
    rallyTargetId?: number | null;
  }): void {
    const { unitType, x, y, playerId, rallyX, rallyY, rallyTargetId } = data;
    const definition = UNIT_DEFINITIONS[unitType];

    if (!definition) {
      debugSpawning.warn(`SpawnSystem: Unknown unit type: ${unitType}`);
      return;
    }

    // Create the entity
    const entity = this.world.createEntity();

    // Calculate visual properties for selection
    // Flying units need visualHeight to match their rendered position
    const isFlying = definition.isFlying ?? false;
    // Per-unit-type airborne height from assets.json
    const visualHeight = isFlying ? AssetManager.getAirborneHeight(unitType) : 0;

    // Visual scale based on unit size (larger units get bigger hitboxes)
    // This helps select larger units like capital ships more easily
    const visualScale = definition.maxHealth > 300 ? 1.5 : definition.maxHealth > 150 ? 1.2 : 1.0;

    // Selection radius based on unit type
    const selectionRadius = isFlying ? 1.5 : 1.2;

    // Get terrain height at spawn position (for ramps and elevated platforms)
    // Flying units stay at Z=0 since their visual height is handled by visualHeight
    const spawnHeight = isFlying ? 0 : this.game.getTerrainHeightAt(x, y);

    // Get team from authoritative player team registry
    const teamId = this.game.getPlayerTeam(playerId);

    // Add core components
    entity
      .add(new Transform(x, y, spawnHeight))
      .add(new Unit(definition))
      .add(new Health(definition.maxHealth, definition.armor, this.getArmorType(definition)))
      .add(new Selectable(selectionRadius, 5, playerId, visualScale, visualHeight, teamId))
      .add(new Velocity());

    // Add abilities if the unit has any
    if (definition.abilities && definition.abilities.length > 0) {
      const maxEnergy = definition.maxEnergy ?? 0;
      const energyRegen = definition.energyRegen ?? 0;
      const abilityComponent = new Ability(maxEnergy, energyRegen);

      for (const abilityId of definition.abilities) {
        const abilityDef = DOMINION_ABILITIES[abilityId];
        if (abilityDef) {
          abilityComponent.addAbility(abilityDef);
        }
      }

      entity.add(abilityComponent);
    }

    // Note: Supply is already reserved when production is queued in ProductionSystem
    // So we don't add supply here - it was already accounted for

    // Handle rally point - send unit to rally after spawn
    if (rallyTargetId && definition.isWorker) {
      // Worker rallied to resource - auto-gather
      const targetEntity = this.world.getEntity(rallyTargetId);
      if (targetEntity) {
        const resource = targetEntity.get('Resource');
        if (resource) {
          this.game.eventBus.emit('command:gather', {
            entityIds: [entity.id],
            targetEntityId: rallyTargetId,
          });
          debugSpawning.log(
            `SpawnSystem: Auto-gather for ${definition.name} to resource ${rallyTargetId}`
          );
        }
      }
    } else if (rallyX !== null && rallyX !== undefined && rallyY !== null && rallyY !== undefined) {
      // Send unit to rally point
      this.game.eventBus.emit('command:move', {
        entityIds: [entity.id],
        targetPosition: { x: rallyX, y: rallyY },
      });
      debugSpawning.log(
        `SpawnSystem: Moving ${definition.name} to rally point (${rallyX.toFixed(1)}, ${rallyY.toFixed(1)})`
      );
    }

    // Emit spawn complete event for UI feedback
    this.game.eventBus.emit('unit:spawned', {
      entityId: entity.id,
      unitType,
      playerId,
      position: { x, y },
    });

    debugSpawning.log(
      `SpawnSystem: Spawned ${definition.name} at (${x.toFixed(1)}, ${y.toFixed(1)}) for ${playerId}`
    );
  }

  /**
   * Handle building spawn from console command or debug tools
   * Creates a fully completed building at the specified position
   */
  private handleBuildingSpawn(data: {
    buildingType: string;
    x: number;
    y: number;
    playerId: string;
    completed?: boolean;
  }): void {
    const { buildingType, x, y, playerId, completed = true } = data;
    const definition = BUILDING_DEFINITIONS[buildingType];

    if (!definition) {
      debugSpawning.warn(`SpawnSystem: Unknown building type: ${buildingType}`);
      return;
    }

    // Create the entity
    const entity = this.world.createEntity();

    // Create health component - full health if completed, 10% if under construction
    const health = new Health(definition.maxHealth, definition.armor, 'structure');
    if (completed) {
      health.current = definition.maxHealth;
    } else {
      health.current = definition.maxHealth * 0.1;
    }

    // Create building component
    const building = new Building(definition);
    if (completed) {
      building.state = 'complete';
      building.buildProgress = 1;
    }

    // Selection radius based on building size
    const selectionRadius = Math.max(definition.width, definition.height) * 0.6;

    // Get team from authoritative player team registry
    const teamId = this.game.getPlayerTeam(playerId);

    entity
      .add(new Transform(x, y, 0))
      .add(building)
      .add(health)
      .add(new Selectable(selectionRadius, 10, playerId, 1, 0, teamId));

    // Emit placement event for pathfinding grid update
    this.game.eventBus.emit('building:placed', {
      entityId: entity.id,
      buildingType,
      playerId,
      position: { x, y },
      width: definition.width,
      height: definition.height,
    });

    // Emit spawned event
    this.game.eventBus.emit('building:spawned', {
      entityId: entity.id,
      buildingType,
      playerId,
      position: { x, y },
    });

    debugSpawning.log(
      `SpawnSystem: Spawned ${definition.name} at (${x.toFixed(1)}, ${y.toFixed(1)}) for ${playerId}`
    );
  }

  private handleUnitDeath(data: { entityId: number }): void {
    const entity = this.world.getEntity(data.entityId);
    if (entity) {
      // Reduce supply for local player's units (AI supply is recalculated from entities)
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');

      if (unit && selectable && selectable.playerId) {
        const definition = UNIT_DEFINITIONS[unit.unitId];
        if (definition && definition.supplyCost > 0) {
          // Check AI status FIRST - AI supply is recalculated, don't touch human store
          const aiSystem = this.getAISystem();
          const isAI = aiSystem?.isAIPlayer(selectable.playerId) ?? false;

          if (!isAI && selectable.playerId === this.game.config.playerId) {
            this.game.statePort.addSupply(-definition.supplyCost);
          }
        }
      }

      // Schedule entity for removal
      // The actual removal should happen at the end of the tick to avoid issues
      this.world.destroyEntity(data.entityId);
    }
  }

  private getArmorType(definition: {
    isFlying?: boolean;
    maxHealth: number;
  }): 'light' | 'armored' | 'massive' | 'structure' {
    if (definition.isFlying) {
      return definition.maxHealth > 200 ? 'massive' : 'light';
    }
    if (definition.maxHealth > 300) {
      return 'massive';
    }
    if (definition.maxHealth > 100) {
      return 'armored';
    }
    return 'light';
  }

  public update(_deltaTime: number): void {
    // SpawnSystem is event-driven, no per-tick update needed
  }
}

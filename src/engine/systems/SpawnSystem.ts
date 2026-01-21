import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Velocity } from '../components/Velocity';
import { Ability } from '../components/Ability';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { DOMINION_ABILITIES } from '../components/Ability';
import { debugSpawning } from '@/utils/debugLogger';
import { isLocalPlayer } from '@/store/gameSetupStore';
import { AssetManager } from '@/assets/AssetManager';

// Note: Airborne height is now configured per-unit-type in assets.json
// Use AssetManager.getAirborneHeight(unitType) to get the configured height

/**
 * SpawnSystem handles creating new units when production completes
 * or when units need to be spawned dynamically (eg. from abilities)
 */
export class SpawnSystem extends System {
  public readonly name = 'SpawnSystem';
  public priority = 5; // Run early

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Handle unit spawning from production
    this.game.eventBus.on('unit:spawn', this.handleUnitSpawn.bind(this));

    // Handle unit death (cleanup)
    this.game.eventBus.on('unit:died', this.handleUnitDeath.bind(this));
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
    const visualScale = definition.maxHealth > 300 ? 1.5 :
                        definition.maxHealth > 150 ? 1.2 : 1.0;

    // Selection radius based on unit type
    const selectionRadius = isFlying ? 1.5 : 1.2;

    // Add core components
    entity
      .add(new Transform(x, y, 0))
      .add(new Unit(definition))
      .add(new Health(definition.maxHealth, definition.armor, this.getArmorType(definition)))
      .add(new Selectable(selectionRadius, 5, playerId, visualScale, visualHeight))
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
          debugSpawning.log(`SpawnSystem: Auto-gather for ${definition.name} to resource ${rallyTargetId}`);
        }
      }
    } else if (rallyX != null && rallyY != null) {
      // Send unit to rally point
      this.game.eventBus.emit('command:move', {
        entityIds: [entity.id],
        targetPosition: { x: rallyX, y: rallyY },
      });
      debugSpawning.log(`SpawnSystem: Moving ${definition.name} to rally point (${rallyX.toFixed(1)}, ${rallyY.toFixed(1)})`);
    }

    // Emit spawn complete event for UI feedback
    this.game.eventBus.emit('unit:spawned', {
      entityId: entity.id,
      unitType,
      playerId,
      position: { x, y },
    });

    debugSpawning.log(`SpawnSystem: Spawned ${definition.name} at (${x.toFixed(1)}, ${y.toFixed(1)}) for ${playerId}`);
  }

  private handleUnitDeath(data: { entityId: number }): void {
    const entity = this.world.getEntity(data.entityId);
    if (entity) {
      // Reduce supply for local player's units
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');

      if (unit && selectable && selectable.playerId && isLocalPlayer(selectable.playerId)) {
        const definition = UNIT_DEFINITIONS[unit.unitId];
        if (definition && definition.supplyCost > 0) {
          this.game.statePort.addSupply(-definition.supplyCost);
        }
      }

      // Schedule entity for removal
      // The actual removal should happen at the end of the tick to avoid issues
      this.world.destroyEntity(data.entityId);
    }
  }

  private getArmorType(definition: { isFlying?: boolean; maxHealth: number }): 'light' | 'armored' | 'massive' | 'structure' {
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

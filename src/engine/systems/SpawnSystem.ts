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

/**
 * SpawnSystem handles creating new units when production completes
 * or when units need to be spawned dynamically (eg. from abilities)
 */
export class SpawnSystem extends System {
  public priority = 5; // Run early

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Handle unit spawning from production
    this.game.eventBus.on('unit:spawn', this.handleUnitSpawn.bind(this));

    // Handle unit death (cleanup)
    this.game.eventBus.on('unit:death', this.handleUnitDeath.bind(this));
  }

  private handleUnitSpawn(data: {
    unitType: string;
    x: number;
    y: number;
    playerId: string;
  }): void {
    const { unitType, x, y, playerId } = data;
    const definition = UNIT_DEFINITIONS[unitType];

    if (!definition) {
      console.warn(`SpawnSystem: Unknown unit type: ${unitType}`);
      return;
    }

    // Create the entity
    const entity = this.world.createEntity();

    // Add core components
    entity
      .add(new Transform(x, y, 0))
      .add(new Unit(definition))
      .add(new Health(definition.maxHealth, definition.armor, this.getArmorType(definition)))
      .add(new Selectable(0.5, 5, playerId))
      .add(new Velocity());

    // Add abilities if the unit has any
    if (definition.abilities && definition.abilities.length > 0) {
      const abilityComponent = new Ability();

      for (const abilityId of definition.abilities) {
        const abilityDef = DOMINION_ABILITIES[abilityId];
        if (abilityDef) {
          abilityComponent.addAbility(abilityDef);
        }
      }

      entity.add(abilityComponent);
    }

    // Emit spawn complete event for UI feedback
    this.game.eventBus.emit('unit:spawned', {
      entityId: entity.id,
      unitType,
      playerId,
      position: { x, y },
    });

    console.log(`SpawnSystem: Spawned ${definition.name} at (${x.toFixed(1)}, ${y.toFixed(1)}) for ${playerId}`);
  }

  private handleUnitDeath(data: { entityId: number }): void {
    const entity = this.world.getEntity(data.entityId);
    if (entity) {
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

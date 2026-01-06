import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Ability, AbilityDefinition, AbilityTargetType } from '../components/Ability';
import { Selectable } from '../components/Selectable';

interface AbilityCommand {
  entityIds: number[];
  abilityId: string;
  targetPosition?: { x: number; y: number };
  targetEntityId?: number;
}

export class AbilitySystem extends System {
  public priority = 25;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:ability', this.handleAbilityCommand.bind(this));
  }

  private handleAbilityCommand(command: AbilityCommand): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const ability = entity.get<Ability>('Ability');
      if (!ability) continue;

      const abilityState = ability.getAbility(command.abilityId);
      if (!abilityState) continue;

      // Validate target
      if (!this.validateTarget(entity, abilityState.definition, command)) {
        continue;
      }

      // Try to use the ability
      if (ability.useAbility(command.abilityId)) {
        this.executeAbility(entity, abilityState.definition, command);
      }
    }
  }

  private validateTarget(
    caster: { id: number },
    definition: AbilityDefinition,
    command: AbilityCommand
  ): boolean {
    switch (definition.targetType) {
      case 'none':
      case 'self':
        return true;

      case 'point':
        return command.targetPosition !== undefined;

      case 'unit':
      case 'ally':
        if (command.targetEntityId === undefined) return false;
        const target = this.world.getEntity(command.targetEntityId);
        if (!target) return false;

        // Check range
        const casterEntity = this.world.getEntity(caster.id);
        if (!casterEntity) return false;

        const casterTransform = casterEntity.get<Transform>('Transform');
        const targetTransform = target.get<Transform>('Transform');

        if (!casterTransform || !targetTransform) return false;

        const distance = casterTransform.distanceTo(targetTransform);
        if (distance > definition.range) return false;

        // For 'ally', check if same player
        if (definition.targetType === 'ally') {
          const casterSelect = casterEntity.get<Selectable>('Selectable');
          const targetSelect = target.get<Selectable>('Selectable');
          if (casterSelect?.playerId !== targetSelect?.playerId) return false;
        }

        return true;

      default:
        return false;
    }
  }

  private executeAbility(
    caster: { id: number },
    definition: AbilityDefinition,
    command: AbilityCommand
  ): void {
    const casterEntity = this.world.getEntity(caster.id);
    if (!casterEntity) return;

    const casterTransform = casterEntity.get<Transform>('Transform');
    const casterSelectable = casterEntity.get<Selectable>('Selectable');

    this.game.eventBus.emit('ability:used', {
      casterId: caster.id,
      abilityId: definition.id,
      casterPos: casterTransform ? { x: casterTransform.x, y: casterTransform.y } : null,
      targetPos: command.targetPosition,
      targetEntityId: command.targetEntityId,
    });

    // Execute based on ability type
    switch (definition.id) {
      case 'stim_pack':
        this.executeStimPack(casterEntity);
        break;

      case 'siege_mode':
        this.executeSiegeMode(casterEntity);
        break;

      case 'snipe':
        if (command.targetEntityId) {
          this.executeSnipe(casterEntity, command.targetEntityId, definition.damage || 150);
        }
        break;

      case 'emp_round':
        if (command.targetPosition) {
          this.executeEMP(command.targetPosition, definition.aoeRadius || 2.5);
        }
        break;

      case 'scanner_sweep':
        if (command.targetPosition) {
          this.executeScannerSweep(
            casterSelectable?.playerId || 'player1',
            command.targetPosition,
            definition.aoeRadius || 8,
            definition.duration || 15
          );
        }
        break;

      case 'nuke':
        if (command.targetPosition) {
          this.executeNuke(
            command.targetPosition,
            definition.damage || 300,
            definition.aoeRadius || 8
          );
        }
        break;

      default:
        // Generic ability - just emit the event
        break;
    }
  }

  private executeStimPack(caster: { id: number }): void {
    const entity = this.world.getEntity(caster.id);
    if (!entity) return;

    const health = entity.get<Health>('Health');
    const unit = entity.get<Unit>('Unit');

    if (health && unit) {
      // Cost: 10 HP
      health.takeDamage(10, this.game.getGameTime());

      // Buff: +50% attack speed and movement speed for 10 seconds
      // Store the buff info (would need a buff system for proper implementation)
      this.game.eventBus.emit('buff:apply', {
        entityId: caster.id,
        buffId: 'stim_pack',
        duration: 10,
        effects: {
          attackSpeedBonus: 0.5,
          moveSpeedBonus: 0.5,
        },
      });
    }
  }

  private executeSiegeMode(caster: { id: number }): void {
    const entity = this.world.getEntity(caster.id);
    if (!entity) return;

    const unit = entity.get<Unit>('Unit');
    if (!unit) return;

    // Toggle siege mode
    this.game.eventBus.emit('unit:siegeMode', {
      entityId: caster.id,
      enabled: !unit.isHoldingPosition, // Use this as a proxy for now
    });
  }

  private executeSnipe(
    caster: { id: number },
    targetId: number,
    damage: number
  ): void {
    const target = this.world.getEntity(targetId);
    if (!target) return;

    const targetHealth = target.get<Health>('Health');
    if (!targetHealth) return;

    // Snipe deals damage to target
    targetHealth.takeDamage(damage, this.game.getGameTime());

    const casterEntity = this.world.getEntity(caster.id);
    const casterTransform = casterEntity?.get<Transform>('Transform');
    const targetTransform = target.get<Transform>('Transform');

    this.game.eventBus.emit('combat:attack', {
      attackerId: caster.id,
      attackerPos: casterTransform ? { x: casterTransform.x, y: casterTransform.y } : null,
      targetPos: targetTransform ? { x: targetTransform.x, y: targetTransform.y } : null,
      damage,
      damageType: 'psionic',
    });
  }

  private executeEMP(
    position: { x: number; y: number },
    radius: number
  ): void {
    // Find all units in range and drain their energy/shields
    const entities = this.world.getEntitiesWith('Transform', 'Health');

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      const ability = entity.get<Ability>('Ability');

      const dx = transform.x - position.x;
      const dy = transform.y - position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= radius) {
        // Drain all shields
        if (health.shield > 0) {
          health.shield = 0;
        }

        // Drain all energy
        if (ability && ability.energy > 0) {
          ability.energy = 0;
        }
      }
    }

    this.game.eventBus.emit('ability:effect', {
      type: 'emp',
      position,
      radius,
    });
  }

  private executeScannerSweep(
    playerId: string,
    position: { x: number; y: number },
    radius: number,
    duration: number
  ): void {
    // Reveal area temporarily (would need proper implementation with vision system)
    this.game.eventBus.emit('vision:reveal', {
      playerId,
      position,
      radius,
      duration,
    });

    this.game.eventBus.emit('ability:effect', {
      type: 'scanner',
      position,
      radius,
      duration,
    });
  }

  private executeNuke(
    position: { x: number; y: number },
    damage: number,
    radius: number
  ): void {
    // Delayed nuclear strike
    this.game.eventBus.emit('ability:nuke_incoming', {
      position,
      delay: 10, // 10 seconds to impact
    });

    // Schedule the actual damage
    setTimeout(() => {
      const entities = this.world.getEntitiesWith('Transform', 'Health');

      for (const entity of entities) {
        const transform = entity.get<Transform>('Transform')!;
        const health = entity.get<Health>('Health')!;

        const dx = transform.x - position.x;
        const dy = transform.y - position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= radius) {
          // Calculate damage falloff from center
          const falloff = 1 - (distance / radius) * 0.5;
          health.takeDamage(damage * falloff, this.game.getGameTime());
        }
      }

      this.game.eventBus.emit('ability:nuke_impact', {
        position,
        radius,
        damage,
      });
    }, 10000); // 10 second delay
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000; // Convert to seconds

    // Update cooldowns and energy for all entities with abilities
    const entities = this.world.getEntitiesWith('Ability');

    for (const entity of entities) {
      const ability = entity.get<Ability>('Ability')!;
      ability.updateCooldowns(dt);
    }
  }
}

import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Ability, AbilityDefinition, AbilityTargetType } from '../components/Ability';
import { Selectable } from '../components/Selectable';
import { Building } from '../components/Building';

interface AbilityCommand {
  entityIds: number[];
  abilityId: string;
  targetPosition?: { x: number; y: number };
  targetEntityId?: number;
}

// Delayed ability effect to be processed at a specific tick (replaces setTimeout)
interface DelayedAbilityEffect {
  executeTick: number;
  type: 'nuke' | 'nova_cannon';
  data: {
    position?: { x: number; y: number };
    damage?: number;
    radius?: number;
    casterId?: number;
    targetId?: number;
    targetPos?: { x: number; y: number } | null;
  };
}

export class AbilitySystem extends System {
  public readonly name = 'AbilitySystem';
  public priority = 25;

  // Queue for delayed ability effects (replaces setTimeout)
  private pendingEffects: DelayedAbilityEffect[] = [];

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
      case 'combat_stim':
        this.executeCombatStim(casterEntity);
        break;

      case 'bombardment_mode':
        this.executeBombardmentMode(casterEntity);
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

      case 'nova_cannon':
        if (command.targetEntityId) {
          this.executeNovaCannon(casterEntity, command.targetEntityId, definition.damage || 240);
        }
        break;

      case 'tactical_jump':
      case 'warp_jump':
        if (command.targetPosition) {
          this.executeTacticalJump(casterEntity, command.targetPosition);
        }
        break;

      case 'power_cannon':
        if (command.targetEntityId) {
          this.executePowerCannon(
            casterEntity,
            command.targetEntityId,
            definition.damage || 300
          );
        }
        break;

      case 'mule':
        if (command.targetPosition) {
          this.executeMULE(
            casterSelectable?.playerId || 'player1',
            command.targetPosition,
            definition.duration || 64
          );
        }
        break;

      case 'supply_drop':
        if (command.targetEntityId) {
          this.executeSupplyDrop(command.targetEntityId);
        }
        break;

      case 'concussive_shells':
        if (command.targetEntityId) {
          this.applyConcussiveShells(command.targetEntityId);
        }
        break;

      case 'combat_shield':
        this.applyCombatShield(casterEntity);
        break;

      default:
        // Generic ability - just emit the event
        break;
    }
  }

  private executeCombatStim(caster: { id: number }): void {
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
        buffId: 'combat_stim',
        duration: 10,
        effects: {
          attackSpeedBonus: 0.5,
          moveSpeedBonus: 0.5,
        },
      });

      // Emit major ability for Phaser overlay
      const transform = entity?.get<Transform>('Transform');
      if (transform) {
        this.game.eventBus.emit('ability:major', {
          abilityName: 'COMBAT STIM',
          position: { x: transform.x, y: transform.y },
          color: 0xff4444,
        });
      }
    }
  }

  private executeBombardmentMode(caster: { id: number }): void {
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

    // Schedule the actual damage using tick-based delay (200 ticks = 10 seconds at 20 TPS)
    // This replaces setTimeout with deterministic tick-based timing
    this.pendingEffects.push({
      executeTick: this.game.getCurrentTick() + 200,
      type: 'nuke',
      data: { position, damage, radius },
    });
  }

  private executeNovaCannon(
    caster: { id: number },
    targetId: number,
    damage: number
  ): void {
    const target = this.world.getEntity(targetId);
    if (!target) return;

    const casterEntity = this.world.getEntity(caster.id);
    const casterTransform = casterEntity?.get<Transform>('Transform');
    const targetTransform = target.get<Transform>('Transform');

    // Nova Cannon has a 3 second channel time
    this.game.eventBus.emit('ability:channeling', {
      casterId: caster.id,
      abilityId: 'nova_cannon',
      duration: 3,
      targetId,
    });

    // Emit major ability for Phaser overlay (channeling starts)
    if (casterTransform) {
      this.game.eventBus.emit('ability:major', {
        abilityName: 'NOVA CANNON',
        position: { x: casterTransform.x, y: casterTransform.y },
        color: 0xffaa00,
      });
    }

    // Schedule the damage after channel completes using tick-based delay (60 ticks = 3 seconds at 20 TPS)
    // This replaces setTimeout with deterministic tick-based timing
    this.pendingEffects.push({
      executeTick: this.game.getCurrentTick() + 60,
      type: 'nova_cannon',
      data: {
        casterId: caster.id,
        targetId,
        damage,
        targetPos: targetTransform ? { x: targetTransform.x, y: targetTransform.y } : null,
      },
    });
  }

  private executeTacticalJump(
    caster: { id: number },
    position: { x: number; y: number }
  ): void {
    const entity = this.world.getEntity(caster.id);
    if (!entity) return;

    const transform = entity.get<Transform>('Transform');
    if (!transform) return;

    // Emit effect at origin
    this.game.eventBus.emit('ability:effect', {
      type: 'tactical_jump_start',
      position: { x: transform.x, y: transform.y },
    });

    // Teleport the Battlecruiser to target location
    transform.setPosition(position.x, position.y);

    // Emit effect at destination
    this.game.eventBus.emit('ability:effect', {
      type: 'tactical_jump_end',
      position,
    });
  }

  private executePowerCannon(
    caster: { id: number },
    targetId: number,
    damage: number
  ): void {
    const target = this.world.getEntity(targetId);
    if (!target) return;

    const casterEntity = this.world.getEntity(caster.id);
    const casterTransform = casterEntity?.get<Transform>('Transform');
    const targetTransform = target.get<Transform>('Transform');
    const targetHealth = target.get<Health>('Health');

    if (!targetHealth || !targetTransform) return;

    // Emit major ability notification for charge-up
    if (casterTransform) {
      this.game.eventBus.emit('ability:major', {
        abilityName: 'POWER CANNON',
        position: { x: casterTransform.x, y: casterTransform.y },
        color: 0xffaa00, // Orange-yellow
      });
    }

    // Deal massive single-target damage
    targetHealth.takeDamage(damage, this.game.getGameTime());

    // Emit attack event for visual effect (big beam projectile)
    this.game.eventBus.emit('combat:attack', {
      attackerId: caster.id,
      attackerPos: casterTransform ? { x: casterTransform.x, y: casterTransform.y } : null,
      targetPos: { x: targetTransform.x, y: targetTransform.y },
      damage,
      damageType: 'psionic', // Big energy beam
    });

    // Emit power cannon impact effect
    this.game.eventBus.emit('ability:effect', {
      type: 'power_cannon',
      casterId: caster.id,
      targetId,
      damage,
      position: { x: targetTransform.x, y: targetTransform.y },
    });

    // Impact visual notification
    this.game.eventBus.emit('ability:major', {
      abilityName: 'POWER CANNON IMPACT',
      position: { x: targetTransform.x, y: targetTransform.y },
      color: 0xff6600,
    });
  }

  private executeMULE(
    playerId: string,
    position: { x: number; y: number },
    duration: number
  ): void {
    // Spawn a MULE unit at the position
    this.game.eventBus.emit('spawn:unit', {
      unitType: 'mule',
      playerId,
      position,
      isTimed: true,
      duration,
    });

    this.game.eventBus.emit('ability:effect', {
      type: 'mule_drop',
      position,
      playerId,
    });
  }

  private executeSupplyDrop(targetId: number): void {
    const target = this.world.getEntity(targetId);
    if (!target) return;

    const building = target.get<Building>('Building');
    if (!building || building.buildingId !== 'supply_cache') return;

    // Instantly complete the supply cache construction
    if (building.state === 'constructing') {
      building.buildProgress = 1.0;
      building.state = 'complete';

      this.game.eventBus.emit('building:complete', {
        entityId: targetId,
        buildingType: 'supply_cache',
        instant: true,
      });
    }

    this.game.eventBus.emit('ability:effect', {
      type: 'supply_drop',
      targetId,
    });
  }

  private applyConcussiveShells(targetId: number): void {
    const target = this.world.getEntity(targetId);
    if (!target) return;

    const unit = target.get<Unit>('Unit');
    if (!unit) return;

    // Apply 50% slow for 1.07 seconds
    unit.applyBuff('concussive_shells', 1.07, {
      moveSpeedMultiplier: 0.5,
    });

    this.game.eventBus.emit('buff:apply', {
      entityId: targetId,
      buffId: 'concussive_shells',
      duration: 1.07,
      effects: {
        moveSpeedMultiplier: 0.5,
      },
    });
  }

  private applyCombatShield(caster: { id: number }): void {
    const entity = this.world.getEntity(caster.id);
    if (!entity) return;

    const health = entity.get<Health>('Health');
    if (!health) return;

    // Increase max HP by 10 (permanent)
    health.max += 10;
    health.current += 10;

    this.game.eventBus.emit('ability:effect', {
      type: 'combat_shield',
      entityId: caster.id,
    });
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000; // Convert to seconds
    const currentTick = this.game.getCurrentTick();

    // Process pending delayed ability effects (replaces setTimeout)
    this.processPendingEffects(currentTick);

    // Update cooldowns and energy for all entities with abilities
    const entities = this.world.getEntitiesWith('Ability');

    for (const entity of entities) {
      const ability = entity.get<Ability>('Ability')!;
      ability.updateCooldowns(dt);
    }

    // Process auto-cast abilities
    this.processAutoCast(dt);
  }

  /**
   * Process pending delayed ability effects (replaces setTimeout)
   */
  private processPendingEffects(currentTick: number): void {
    let i = 0;
    while (i < this.pendingEffects.length) {
      const effect = this.pendingEffects[i];
      if (effect.executeTick <= currentTick) {
        // Execute the effect
        if (effect.type === 'nuke') {
          this.executeNukeImpact(effect.data);
        } else if (effect.type === 'nova_cannon') {
          this.executeNovaCannonImpact(effect.data);
        }
        // Remove from queue (swap with last for O(1) removal)
        this.pendingEffects[i] = this.pendingEffects[this.pendingEffects.length - 1];
        this.pendingEffects.pop();
      } else {
        i++;
      }
    }
  }

  /**
   * Execute nuke impact damage (called from tick-based delay)
   */
  private executeNukeImpact(data: DelayedAbilityEffect['data']): void {
    const { position, damage, radius } = data;
    if (!position || damage === undefined || radius === undefined) return;

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
  }

  /**
   * Execute nova cannon impact damage (called from tick-based delay)
   */
  private executeNovaCannonImpact(data: DelayedAbilityEffect['data']): void {
    const { casterId, targetId, damage, targetPos } = data;
    if (targetId === undefined || damage === undefined) return;

    const currentTarget = this.world.getEntity(targetId);
    if (!currentTarget) return;

    const targetHealth = currentTarget.get<Health>('Health');
    if (!targetHealth) return;

    // Deal massive damage to single target
    targetHealth.takeDamage(damage, this.game.getGameTime());

    this.game.eventBus.emit('ability:effect', {
      type: 'nova_cannon',
      casterId,
      targetId,
      damage,
      position: targetPos,
    });

    // Impact effect for Phaser overlay
    if (targetPos) {
      this.game.eventBus.emit('ability:major', {
        abilityName: 'NOVA IMPACT',
        position: targetPos,
        color: 0xff6600,
      });
    }
  }

  private processAutoCast(deltaTime: number): void {
    const healers = this.world.getEntitiesWith('Unit', 'Ability', 'Transform', 'Selectable');

    for (const healer of healers) {
      const unit = healer.get<Unit>('Unit')!;
      const ability = healer.get<Ability>('Ability')!;
      const transform = healer.get<Transform>('Transform')!;
      const selectable = healer.get<Selectable>('Selectable')!;

      // Auto-heal for lifters
      if (unit.canHeal && ability.canUseAbility('heal')) {
        const target = this.findHealTarget(healer.id, transform, selectable.playerId, unit.healRange);
        if (target !== null) {
          // Emit heal command
          this.game.eventBus.emit('command:heal', {
            healerId: healer.id,
            targetId: target,
          });
        }
      }
    }
  }

  private findHealTarget(
    selfId: number,
    selfTransform: Transform,
    playerId: string,
    range: number
  ): number | null {
    const entities = this.world.getEntitiesWith('Transform', 'Health', 'Unit', 'Selectable');

    let bestTarget: { id: number; healthPercent: number } | null = null;

    for (const entity of entities) {
      if (entity.id === selfId) continue;

      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      const unit = entity.get<Unit>('Unit')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      // Must be ally, biological, and damaged
      if (selectable.playerId !== playerId) continue;
      if (!unit.isBiological) continue;
      if (health.isDead()) continue;
      if (health.current >= health.max) continue;

      const distance = selfTransform.distanceTo(transform);
      if (distance > range) continue;

      const healthPercent = health.current / health.max;

      // Prefer lower health targets
      if (!bestTarget || healthPercent < bestTarget.healthPercent) {
        bestTarget = { id: entity.id, healthPercent };
      }
    }

    return bestTarget?.id || null;
  }
}

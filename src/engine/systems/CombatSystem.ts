import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit, DamageType } from '../components/Unit';
import { Health, ArmorType } from '../components/Health';
import { Game } from '../core/Game';

// Damage multipliers: [damageType][armorType]
const DAMAGE_MULTIPLIERS: Record<DamageType, Record<ArmorType, number>> = {
  normal: {
    light: 1.0,
    armored: 1.0,
    massive: 1.0,
    structure: 1.0,
  },
  explosive: {
    light: 0.5,
    armored: 1.5,
    massive: 1.25,
    structure: 1.5,
  },
  concussive: {
    light: 1.5,
    armored: 0.5,
    massive: 0.25,
    structure: 0.5,
  },
  psionic: {
    light: 1.0,
    armored: 1.0,
    massive: 1.0,
    structure: 0.5,
  },
};

export class CombatSystem extends System {
  public priority = 20;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:attack', this.handleAttackCommand.bind(this));
    this.game.eventBus.on('command:stop', this.handleStopCommand.bind(this));
    this.game.eventBus.on('command:hold', this.handleHoldCommand.bind(this));
  }

  private handleAttackCommand(command: {
    entityIds: number[];
    targetEntityId?: number;
    targetPosition?: { x: number; y: number };
  }): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      if (command.targetEntityId !== undefined) {
        unit.setAttackTarget(command.targetEntityId);
      } else if (command.targetPosition) {
        // Attack-move
        unit.setMoveTarget(command.targetPosition.x, command.targetPosition.y);
      }
    }
  }

  private handleStopCommand(command: { entityIds: number[] }): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (unit) {
        unit.stop();
      }
    }
  }

  private handleHoldCommand(command: { entityIds: number[] }): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (unit) {
        unit.holdPosition();
      }
    }
  }

  public update(deltaTime: number): void {
    const gameTime = this.game.getGameTime();
    const attackers = this.world.getEntitiesWith('Transform', 'Unit', 'Health');

    for (const attacker of attackers) {
      const transform = attacker.get<Transform>('Transform')!;
      const unit = attacker.get<Unit>('Unit')!;
      const health = attacker.get<Health>('Health')!;

      // Skip dead units
      if (health.isDead()) {
        if (unit.state !== 'dead') {
          unit.state = 'dead';
          this.game.eventBus.emit('unit:died', { entityId: attacker.id });
        }
        continue;
      }

      // Auto-acquire targets for idle or holding units
      if (
        (unit.state === 'idle' || unit.isHoldingPosition) &&
        unit.targetEntityId === null
      ) {
        const target = this.findNearestEnemy(attacker.id, transform, unit);
        if (target && !unit.isHoldingPosition) {
          unit.setAttackTarget(target);
        } else if (target && unit.isHoldingPosition) {
          // Only attack if in range
          const targetEntity = this.world.getEntity(target);
          if (targetEntity) {
            const targetTransform = targetEntity.get<Transform>('Transform');
            if (targetTransform) {
              const distance = transform.distanceTo(targetTransform);
              if (distance <= unit.attackRange) {
                unit.setAttackTarget(target);
              }
            }
          }
        }
      }

      // Process attacks
      if (unit.state === 'attacking' && unit.targetEntityId !== null) {
        const targetEntity = this.world.getEntity(unit.targetEntityId);

        if (!targetEntity || targetEntity.isDestroyed()) {
          // Target no longer exists
          unit.clearTarget();
          continue;
        }

        const targetTransform = targetEntity.get<Transform>('Transform');
        const targetHealth = targetEntity.get<Health>('Health');

        if (!targetTransform || !targetHealth || targetHealth.isDead()) {
          unit.clearTarget();
          continue;
        }

        const distance = transform.distanceTo(targetTransform);

        if (distance <= unit.attackRange) {
          // In range - attempt attack
          if (unit.canAttack(gameTime)) {
            this.performAttack(unit, transform, targetHealth, targetTransform, gameTime);
          }
        }
        // If not in range, MovementSystem will handle moving toward target
      }
    }

    // Handle health regeneration
    for (const entity of this.world.getEntitiesWith('Health')) {
      const health = entity.get<Health>('Health')!;
      health.regenerate(deltaTime / 1000, gameTime);
    }
  }

  private findNearestEnemy(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit
  ): number | null {
    const entities = this.world.getEntitiesWith('Transform', 'Health', 'Selectable');
    let nearestId: number | null = null;
    let nearestDistance = Infinity;

    for (const entity of entities) {
      if (entity.id === selfId) continue;

      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      const selectable = entity.get('Selectable') as { playerId: string } | undefined;

      // Skip if same player or dead
      if (!selectable) continue;

      // Get player ID from the self entity's selectable component
      const selfEntity = this.world.getEntity(selfId);
      const selfSelectable = selfEntity?.get('Selectable') as { playerId: string } | undefined;

      if (selectable.playerId === selfSelectable?.playerId) continue;
      if (health.isDead()) continue;

      const distance = selfTransform.distanceTo(transform);

      // Only consider enemies within sight range
      if (distance <= selfUnit.sightRange && distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = entity.id;
      }
    }

    return nearestId;
  }

  private performAttack(
    attacker: Unit,
    attackerTransform: Transform,
    targetHealth: Health,
    targetTransform: Transform,
    gameTime: number
  ): void {
    attacker.lastAttackTime = gameTime;

    // Calculate damage with type multiplier
    const multiplier = DAMAGE_MULTIPLIERS[attacker.damageType][targetHealth.armorType];
    const damage = attacker.attackDamage * multiplier;

    // Psionic damage ignores armor
    const finalDamage =
      attacker.damageType === 'psionic'
        ? damage
        : Math.max(1, damage - targetHealth.armor);

    targetHealth.takeDamage(finalDamage, gameTime);

    this.game.eventBus.emit('combat:attack', {
      attackerId: attacker.unitId,
      attackerPos: { x: attackerTransform.x, y: attackerTransform.y },
      targetPos: { x: targetTransform.x, y: targetTransform.y },
      damage: finalDamage,
      damageType: attacker.damageType,
    });
  }
}

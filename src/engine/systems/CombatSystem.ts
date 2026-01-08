import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit, DamageType } from '../components/Unit';
import { Health, ArmorType } from '../components/Health';
import { Game } from '../core/Game';
import { Selectable } from '../components/Selectable';

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

// Target priority - higher = more likely to be attacked first
const TARGET_PRIORITY: Record<string, number> = {
  // High threat combat units
  siege_tank: 100,
  battlecruiser: 95,
  thor: 90,
  banshee: 85,
  ghost: 80,
  marauder: 70,
  marine: 60,
  hellion: 55,
  viking: 50,
  medivac: 45, // Support units have moderate priority
  reaper: 40,
  // Workers are low priority
  scv: 10,
  probe: 10,
  drone: 10,
};

// Cooldown for under attack alerts (prevent spam)
const UNDER_ATTACK_COOLDOWN = 10000; // 10 seconds

// High ground advantage constants
const HIGH_GROUND_MISS_CHANCE = 0.3; // 30% miss chance when attacking uphill
const HIGH_GROUND_THRESHOLD = 1.5; // Height difference to count as high ground

export class CombatSystem extends System {
  public priority = 20;

  // Track last under attack alert time per player
  private lastUnderAttackAlert: Map<string, number> = new Map();

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
    queue?: boolean;
  }): void {
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      if (command.queue) {
        // Queue the attack command
        if (command.targetEntityId !== undefined) {
          unit.queueCommand({
            type: 'attack',
            targetEntityId: command.targetEntityId,
          });
        } else if (command.targetPosition) {
          unit.queueCommand({
            type: 'attackmove',
            targetX: command.targetPosition.x,
            targetY: command.targetPosition.y,
          });
        }
      } else {
        if (command.targetEntityId !== undefined) {
          unit.setAttackTarget(command.targetEntityId);
        } else if (command.targetPosition) {
          // Attack-move
          unit.setMoveTarget(command.targetPosition.x, command.targetPosition.y);
        }
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
          const selectable = attacker.get<Selectable>('Selectable');
          this.game.eventBus.emit('unit:died', {
            entityId: attacker.id,
            position: { x: transform.x, y: transform.y },
            isPlayerUnit: selectable?.playerId === 'player1',
          });
        }
        continue;
      }

      // Auto-acquire targets for idle, patrolling, or holding units
      if (
        (unit.state === 'idle' || unit.state === 'patrolling' || unit.isHoldingPosition) &&
        unit.targetEntityId === null
      ) {
        const target = this.findBestTarget(attacker.id, transform, unit);
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
          // Target no longer exists - check for queued commands
          if (!unit.executeNextCommand()) {
            unit.clearTarget();
          }
          continue;
        }

        const targetTransform = targetEntity.get<Transform>('Transform');
        const targetHealth = targetEntity.get<Health>('Health');

        if (!targetTransform || !targetHealth || targetHealth.isDead()) {
          if (!unit.executeNextCommand()) {
            unit.clearTarget();
          }
          continue;
        }

        const distance = transform.distanceTo(targetTransform);

        if (distance <= unit.attackRange) {
          // In range - attempt attack
          if (unit.canAttack(gameTime)) {
            this.performAttack(attacker.id, unit, transform, targetEntity.id, targetHealth, targetTransform, gameTime);
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

  /**
   * Find the best target using smart targeting (priority system)
   * Prioritizes high-threat units over workers
   */
  private findBestTarget(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit
  ): number | null {
    const entities = this.world.getEntitiesWith('Transform', 'Health', 'Selectable');

    // Get self's player ID
    const selfEntity = this.world.getEntity(selfId);
    const selfSelectable = selfEntity?.get<Selectable>('Selectable');
    if (!selfSelectable) return null;

    let bestTarget: { id: number; score: number } | null = null;

    for (const entity of entities) {
      if (entity.id === selfId) continue;

      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      const selectable = entity.get<Selectable>('Selectable');
      const unit = entity.get<Unit>('Unit');

      // Skip if same player or dead
      if (!selectable) continue;
      if (selectable.playerId === selfSelectable.playerId) continue;
      if (health.isDead()) continue;

      const distance = selfTransform.distanceTo(transform);

      // Only consider enemies within sight range
      if (distance > selfUnit.sightRange) continue;

      // Calculate target score based on priority and distance
      const unitId = unit?.unitId || 'default';
      const basePriority = TARGET_PRIORITY[unitId] || 50;

      // Distance factor: closer targets score higher (normalize to 0-1 range)
      const distanceFactor = 1 - (distance / selfUnit.sightRange);

      // Low health factor: prefer targets that can be killed quickly
      const healthFactor = 1 - (health.current / health.max);

      // Combined score
      const score = basePriority * 0.5 + distanceFactor * 30 + healthFactor * 20;

      if (!bestTarget || score > bestTarget.score) {
        bestTarget = { id: entity.id, score };
      }
    }

    return bestTarget?.id || null;
  }

  private performAttack(
    attackerId: number,
    attacker: Unit,
    attackerTransform: Transform,
    targetId: number,
    targetHealth: Health,
    targetTransform: Transform,
    gameTime: number
  ): void {
    attacker.lastAttackTime = gameTime;

    // High ground miss chance check
    const heightDifference = targetTransform.z - attackerTransform.z;
    if (heightDifference > HIGH_GROUND_THRESHOLD) {
      // Target is on high ground - check for miss
      // Use deterministic pseudo-random based on game time and attacker ID
      const seed = (gameTime * 1000 + attackerId) % 1;
      const missRoll = Math.abs(Math.sin(seed * 12345.6789) % 1);
      if (missRoll < HIGH_GROUND_MISS_CHANCE) {
        // Attack missed
        this.game.eventBus.emit('combat:miss', {
          attackerId: attacker.unitId,
          attackerPos: { x: attackerTransform.x, y: attackerTransform.y },
          targetPos: { x: targetTransform.x, y: targetTransform.y },
          reason: 'high_ground',
        });
        return;
      }
    }

    // Calculate damage with type multiplier
    const multiplier = DAMAGE_MULTIPLIERS[attacker.damageType][targetHealth.armorType];
    const damage = attacker.attackDamage * multiplier;

    // Psionic damage ignores armor
    const finalDamage =
      attacker.damageType === 'psionic'
        ? damage
        : Math.max(1, damage - targetHealth.armor);

    // Apply primary target damage
    targetHealth.takeDamage(finalDamage, gameTime);

    // Emit attack event
    this.game.eventBus.emit('combat:attack', {
      attackerId: attacker.unitId,
      attackerPos: { x: attackerTransform.x, y: attackerTransform.y },
      targetPos: { x: targetTransform.x, y: targetTransform.y },
      damage: finalDamage,
      damageType: attacker.damageType,
    });

    // Emit player:damage for Phaser overlay effects when player unit takes damage
    const targetEntity = this.world.getEntity(targetId);
    const targetSelectable = targetEntity?.get<Selectable>('Selectable');
    if (targetSelectable?.playerId === 'player1') {
      this.game.eventBus.emit('player:damage', {
        damage: finalDamage,
        position: { x: targetTransform.x, y: targetTransform.y },
      });
    }

    // Check for under attack alert
    this.checkUnderAttackAlert(targetId, targetTransform, gameTime);

    // Apply AoE/splash damage if applicable
    if (attacker.splashRadius > 0) {
      this.applySplashDamage(
        attackerId,
        attacker,
        attackerTransform,
        targetTransform,
        finalDamage,
        gameTime
      );
    }
  }

  /**
   * Apply splash damage to nearby enemies
   */
  private applySplashDamage(
    attackerId: number,
    attacker: Unit,
    attackerTransform: Transform,
    impactPos: Transform,
    baseDamage: number,
    gameTime: number
  ): void {
    const entities = this.world.getEntitiesWith('Transform', 'Health', 'Selectable');

    // Get attacker's player ID
    const attackerEntity = this.world.getEntity(attackerId);
    const attackerSelectable = attackerEntity?.get<Selectable>('Selectable');
    if (!attackerSelectable) return;

    for (const entity of entities) {
      if (entity.id === attackerId) continue;

      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      const selectable = entity.get<Selectable>('Selectable');

      // Skip allies and dead units
      if (!selectable) continue;
      if (selectable.playerId === attackerSelectable.playerId) continue;
      if (health.isDead()) continue;

      // Calculate distance from impact point
      const dx = transform.x - impactPos.x;
      const dy = transform.y - impactPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Apply splash damage with falloff
      if (distance > 0 && distance <= attacker.splashRadius) {
        // Linear falloff: 100% at center, 50% at edge
        const falloff = 1 - (distance / attacker.splashRadius) * 0.5;
        const splashDamage = Math.max(1, Math.floor(baseDamage * falloff));

        health.takeDamage(splashDamage, gameTime);

        // Emit splash damage event
        this.game.eventBus.emit('combat:splash', {
          position: { x: transform.x, y: transform.y },
          damage: splashDamage,
        });

        // Check for under attack alert for splash victims
        this.checkUnderAttackAlert(entity.id, transform, gameTime);
      }
    }
  }

  /**
   * Emit under attack alert for the player who owns the target
   */
  private checkUnderAttackAlert(
    targetId: number,
    targetTransform: Transform,
    gameTime: number
  ): void {
    const targetEntity = this.world.getEntity(targetId);
    const targetSelectable = targetEntity?.get<Selectable>('Selectable');
    if (!targetSelectable) return;

    const playerId = targetSelectable.playerId;
    const lastAlert = this.lastUnderAttackAlert.get(playerId) || 0;

    // Check cooldown
    if (gameTime - lastAlert < UNDER_ATTACK_COOLDOWN) return;

    // Update last alert time
    this.lastUnderAttackAlert.set(playerId, gameTime);

    // Emit under attack alert
    this.game.eventBus.emit('alert:underAttack', {
      playerId,
      position: { x: targetTransform.x, y: targetTransform.y },
      time: gameTime,
    });
  }
}

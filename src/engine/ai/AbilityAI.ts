/**
 * Ability AI System for RTS AI
 *
 * Manages AI ability usage decisions:
 * - Stim when engaging
 * - Siege mode at appropriate ranges
 * - EMP on energy units
 * - AOE abilities on clumped enemies
 * - Healing/support abilities on low-health allies
 *
 * Integrates with behavior trees for per-unit decisions.
 */

import { Entity } from '../ecs/Entity';
import { World } from '../ecs/World';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Ability, AbilityState, DOMINION_ABILITIES } from '../components/Ability';

/**
 * Ability usage decision
 */
export interface AbilityDecision {
  abilityId: string;
  targetType: 'self' | 'unit' | 'position' | 'none';
  targetEntityId?: number;
  targetPosition?: { x: number; y: number };
  priority: number; // Higher = more urgent
}

/**
 * Cluster of units (for AOE targeting)
 */
export interface UnitCluster {
  center: { x: number; y: number };
  units: number[];
  totalValue: number;
  radius: number;
}

/**
 * Configuration for ability AI
 */
export interface AbilityAIConfig {
  /** Health threshold to use stim (0-1) */
  stimHealthThreshold: number;
  /** Minimum enemies nearby to use stim */
  stimMinEnemies: number;
  /** Minimum cluster value to use AOE */
  minAoeValue: number;
  /** Energy threshold to use EMP */
  empEnergyThreshold: number;
  /** Health threshold to heal ally */
  healHealthThreshold: number;
  /** Cooldown between ability checks (ticks) */
  checkCooldown: number;
}

const DEFAULT_CONFIG: AbilityAIConfig = {
  stimHealthThreshold: 0.7,
  stimMinEnemies: 2,
  minAoeValue: 200,
  empEnergyThreshold: 50,
  healHealthThreshold: 0.5,
  checkCooldown: 10,
};

/**
 * Ability evaluation function type
 */
type AbilityEvaluator = (
  world: World,
  caster: Entity,
  ability: AbilityState,
  context: AbilityContext
) => AbilityDecision | null;

/**
 * Context for ability evaluation
 */
interface AbilityContext {
  enemies: Entity[];
  allies: Entity[];
  casterPos: { x: number; y: number };
  casterHealth: number;
  casterMaxHealth: number;
}

/**
 * Ability AI - Manages AI ability usage
 */
export class AbilityAI {
  private config: AbilityAIConfig;

  // Last check tick per unit
  private lastCheckTick: Map<number, number> = new Map();

  // Ability evaluators by ability ID
  private evaluators: Map<string, AbilityEvaluator> = new Map();

  constructor(config?: Partial<AbilityAIConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerDefaultEvaluators();
  }

  /**
   * Register default ability evaluators
   */
  private registerDefaultEvaluators(): void {
    // Stim Pack - Use when engaging multiple enemies with decent health
    this.evaluators.set('stim_pack', (world, caster, ability, ctx) => {
      // Don't stim if low health (it costs HP)
      if (ctx.casterHealth / ctx.casterMaxHealth < this.config.stimHealthThreshold) {
        return null;
      }

      // Need enemies nearby
      const nearbyEnemies = ctx.enemies.filter(e => {
        const t = e.get<Transform>('Transform')!;
        const dx = t.x - ctx.casterPos.x;
        const dy = t.y - ctx.casterPos.y;
        return Math.sqrt(dx * dx + dy * dy) < 8;
      });

      if (nearbyEnemies.length < this.config.stimMinEnemies) {
        return null;
      }

      // Check if already stimmed
      const unit = caster.get<Unit>('Unit')!;
      if (unit.hasBuff('stim')) {
        return null;
      }

      return {
        abilityId: 'stim_pack',
        targetType: 'self',
        priority: 5,
      };
    });

    // Siege Mode - Transform at appropriate range
    this.evaluators.set('siege_mode', (world, caster, ability, ctx) => {
      const unit = caster.get<Unit>('Unit')!;

      // Find closest enemy
      let closestDist = Infinity;
      for (const enemy of ctx.enemies) {
        const t = enemy.get<Transform>('Transform')!;
        const dx = t.x - ctx.casterPos.x;
        const dy = t.y - ctx.casterPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist) closestDist = dist;
      }

      // Siege up when enemies are at medium range
      const shouldSiege = closestDist > 5 && closestDist < 12;

      // Check current mode
      if (unit.currentMode === 'siege' && !shouldSiege) {
        // Unsiege
        return {
          abilityId: 'siege_mode',
          targetType: 'self',
          priority: 3,
        };
      } else if (unit.currentMode !== 'siege' && shouldSiege) {
        // Siege up
        return {
          abilityId: 'siege_mode',
          targetType: 'self',
          priority: 3,
        };
      }

      return null;
    });

    // EMP Round - Target high-energy enemies or clumps
    this.evaluators.set('emp_round', (world, caster, ability, ctx) => {
      const empDef = DOMINION_ABILITIES.emp_round;
      if (!empDef) return null;

      // Find best target cluster
      const bestTarget = this.findBestAoeTarget(ctx.enemies, ctx.casterPos, empDef.aoeRadius || 2.5, empDef.range);
      if (!bestTarget) return null;

      // Calculate cluster value (prioritize energy units)
      let clusterValue = 0;
      for (const entityId of bestTarget.units) {
        const entity = world.getEntity(entityId);
        if (!entity) continue;

        const abilityComp = entity.get<Ability>('Ability');
        if (abilityComp && abilityComp.energy > this.config.empEnergyThreshold) {
          clusterValue += abilityComp.energy * 2; // Energy worth double
        }

        const health = entity.get<Health>('Health');
        if (health) {
          clusterValue += health.current * 0.5;
        }
      }

      if (clusterValue < this.config.minAoeValue) {
        return null;
      }

      return {
        abilityId: 'emp_round',
        targetType: 'position',
        targetPosition: bestTarget.center,
        priority: 7,
      };
    });

    // Snipe - Target high-value biological units
    this.evaluators.set('snipe', (world, caster, ability, ctx) => {
      const snipeDef = DOMINION_ABILITIES.snipe;
      if (!snipeDef) return null;

      // Find best snipe target
      let bestTarget: Entity | null = null;
      let bestValue = 0;

      for (const enemy of ctx.enemies) {
        const transform = enemy.get<Transform>('Transform')!;
        const health = enemy.get<Health>('Health')!;
        const unit = enemy.get<Unit>('Unit');

        // Range check
        const dx = transform.x - ctx.casterPos.x;
        const dy = transform.y - ctx.casterPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > snipeDef.range) continue;

        // Must be biological
        if (!unit?.isBiological) continue;

        // Value based on how close to death snipe would bring them
        const snipeDamage = snipeDef.damage || 150;
        const wouldKill = health.current <= snipeDamage;
        const value = wouldKill ? 1000 : (snipeDamage / health.current) * 100;

        if (value > bestValue) {
          bestValue = value;
          bestTarget = enemy;
        }
      }

      if (!bestTarget || bestValue < 50) return null;

      return {
        abilityId: 'snipe',
        targetType: 'unit',
        targetEntityId: bestTarget.id,
        priority: 6,
      };
    });

    // Yamato Cannon / Power Cannon - Target high-HP enemies
    this.evaluators.set('yamato_cannon', this.createYamatoEvaluator('yamato_cannon'));
    this.evaluators.set('power_cannon', this.createYamatoEvaluator('power_cannon'));

    // Scanner Sweep - Reveal cloaked enemies
    this.evaluators.set('scanner_sweep', (world, caster, ability, ctx) => {
      // Only use if there are suspected cloaked enemies nearby
      // (for now, use if enemies were recently attacking but are now invisible)
      // This is a simplified version - real implementation would track cloaked units

      return null; // Disabled for now - needs cloak detection system
    });
  }

  /**
   * Create evaluator for high-damage single-target abilities
   */
  private createYamatoEvaluator(abilityId: string): AbilityEvaluator {
    return (world, caster, ability, ctx) => {
      const def = DOMINION_ABILITIES[abilityId];
      if (!def) return null;

      let bestTarget: Entity | null = null;
      let bestValue = 0;

      for (const enemy of ctx.enemies) {
        const transform = enemy.get<Transform>('Transform')!;
        const health = enemy.get<Health>('Health')!;
        const unit = enemy.get<Unit>('Unit');

        // Range check
        const dx = transform.x - ctx.casterPos.x;
        const dy = transform.y - ctx.casterPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > def.range) continue;

        // Prioritize high-value targets we can kill or heavily damage
        const damage = def.damage || 300;
        const wouldKill = health.current <= damage;

        // Value calculation
        let value = 0;
        if (wouldKill) {
          // Can kill it - very valuable
          value = health.max * 3;
        } else if (health.current < damage * 2) {
          // Will bring to low health
          value = damage * 2;
        } else {
          // Chip damage on high HP target
          value = damage;
        }

        // Bonus for high-priority targets
        if (unit) {
          const highPriority = ['colossus', 'dreadnought', 'devastator', 'carrier', 'battlecruiser'];
          if (highPriority.includes(unit.unitId)) {
            value *= 1.5;
          }
        }

        if (value > bestValue) {
          bestValue = value;
          bestTarget = enemy;
        }
      }

      // Only use on valuable targets
      if (!bestTarget || bestValue < 200) return null;

      return {
        abilityId,
        targetType: 'unit',
        targetEntityId: bestTarget.id,
        priority: 8, // High priority
      };
    };
  }

  /**
   * Find best target position for AOE ability
   */
  private findBestAoeTarget(
    enemies: Entity[],
    casterPos: { x: number; y: number },
    aoeRadius: number,
    maxRange: number
  ): UnitCluster | null {
    if (enemies.length === 0) return null;

    // Simple clustering: find center of mass of enemies in range
    let totalX = 0;
    let totalY = 0;
    let count = 0;
    const inRangeEnemies: number[] = [];

    for (const enemy of enemies) {
      const transform = enemy.get<Transform>('Transform')!;
      const dx = transform.x - casterPos.x;
      const dy = transform.y - casterPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= maxRange) {
        totalX += transform.x;
        totalY += transform.y;
        count++;
        inRangeEnemies.push(enemy.id);
      }
    }

    if (count < 2) return null;

    const center = { x: totalX / count, y: totalY / count };

    // Count units that would be hit
    const hitUnits: number[] = [];
    let totalValue = 0;

    for (const enemy of enemies) {
      const transform = enemy.get<Transform>('Transform')!;
      const health = enemy.get<Health>('Health')!;
      const dx = transform.x - center.x;
      const dy = transform.y - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= aoeRadius) {
        hitUnits.push(enemy.id);
        totalValue += health.current;
      }
    }

    if (hitUnits.length < 2) return null;

    return {
      center,
      units: hitUnits,
      totalValue,
      radius: aoeRadius,
    };
  }

  /**
   * Evaluate abilities for a unit and return best decision
   */
  public evaluateUnit(
    world: World,
    entity: Entity,
    currentTick: number
  ): AbilityDecision | null {
    // Check cooldown
    const lastCheck = this.lastCheckTick.get(entity.id) || 0;
    if (currentTick - lastCheck < this.config.checkCooldown) {
      return null;
    }
    this.lastCheckTick.set(entity.id, currentTick);

    // Get required components
    const abilityComp = entity.get<Ability>('Ability');
    const transform = entity.get<Transform>('Transform');
    const health = entity.get<Health>('Health');
    const selectable = entity.get<Selectable>('Selectable');

    if (!abilityComp || !transform || !health || !selectable) return null;
    if (abilityComp.abilities.size === 0) return null;

    // Build context
    const ctx = this.buildContext(world, entity, transform, health, selectable);

    // Evaluate each ability
    const decisions: AbilityDecision[] = [];

    for (const [abilityId, abilityState] of abilityComp.abilities) {
      // Skip if can't use
      if (!abilityComp.canUseAbility(abilityId)) continue;

      // Get evaluator
      const evaluator = this.evaluators.get(abilityId);
      if (!evaluator) continue;

      const decision = evaluator(world, entity, abilityState, ctx);
      if (decision) {
        decisions.push(decision);
      }
    }

    // Return highest priority decision
    if (decisions.length === 0) return null;

    decisions.sort((a, b) => b.priority - a.priority);
    return decisions[0];
  }

  /**
   * Build evaluation context
   */
  private buildContext(
    world: World,
    entity: Entity,
    transform: Transform,
    health: Health,
    selectable: Selectable
  ): AbilityContext {
    const enemies: Entity[] = [];
    const allies: Entity[] = [];

    const units = world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');

    for (const other of units) {
      if (other.id === entity.id) continue;

      const otherSelectable = other.get<Selectable>('Selectable')!;
      const otherHealth = other.get<Health>('Health')!;

      if (otherHealth.isDead()) continue;

      if (otherSelectable.playerId === selectable.playerId) {
        allies.push(other);
      } else {
        enemies.push(other);
      }
    }

    return {
      enemies,
      allies,
      casterPos: { x: transform.x, y: transform.y },
      casterHealth: health.current,
      casterMaxHealth: health.max,
    };
  }

  /**
   * Register custom ability evaluator
   */
  public registerEvaluator(abilityId: string, evaluator: AbilityEvaluator): void {
    this.evaluators.set(abilityId, evaluator);
  }

  /**
   * Clear all state
   */
  public clear(): void {
    this.lastCheckTick.clear();
  }
}

/**
 * Execute ability decision on a unit
 */
export function executeAbilityDecision(
  world: World,
  casterEntity: Entity,
  decision: AbilityDecision,
  eventBus: { emit: (event: string, data: unknown) => void }
): boolean {
  const abilityComp = casterEntity.get<Ability>('Ability');
  if (!abilityComp) return false;

  if (!abilityComp.canUseAbility(decision.abilityId)) return false;

  // Use the ability (updates cooldown and energy)
  const success = abilityComp.useAbility(decision.abilityId);
  if (!success) return false;

  // Emit ability used event
  eventBus.emit('ability:used', {
    casterId: casterEntity.id,
    abilityId: decision.abilityId,
    targetType: decision.targetType,
    targetEntityId: decision.targetEntityId,
    targetPosition: decision.targetPosition,
  });

  return true;
}

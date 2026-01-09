/**
 * Behavior Tree Implementation for RTS Unit AI
 *
 * Provides a flexible, composable way to define unit behaviors
 * for combat micro, positioning, and tactical decision making.
 */

export type BehaviorStatus = 'success' | 'failure' | 'running';

export interface BehaviorContext {
  entityId: number;
  world: import('../ecs/World').World;
  game: import('../core/Game').Game;
  blackboard: Map<string, unknown>;
  deltaTime: number;
}

export type BehaviorNode = (context: BehaviorContext) => BehaviorStatus;

// ==================== COMPOSITE NODES ====================

/**
 * Selector (OR) - Tries children in order until one succeeds
 * Returns success if any child succeeds, failure if all fail
 */
export function selector(...children: BehaviorNode[]): BehaviorNode {
  return (context: BehaviorContext) => {
    for (const child of children) {
      const status = child(context);
      if (status === 'success') return 'success';
      if (status === 'running') return 'running';
    }
    return 'failure';
  };
}

/**
 * Sequence (AND) - Tries children in order until one fails
 * Returns success if all children succeed, failure if any fails
 */
export function sequence(...children: BehaviorNode[]): BehaviorNode {
  return (context: BehaviorContext) => {
    for (const child of children) {
      const status = child(context);
      if (status === 'failure') return 'failure';
      if (status === 'running') return 'running';
    }
    return 'success';
  };
}

/**
 * Parallel - Runs all children simultaneously
 * Returns success if required number succeed, failure if too many fail
 */
export function parallel(
  successThreshold: number,
  ...children: BehaviorNode[]
): BehaviorNode {
  return (context: BehaviorContext) => {
    let successCount = 0;
    let failureCount = 0;
    const failureThreshold = children.length - successThreshold + 1;

    for (const child of children) {
      const status = child(context);
      if (status === 'success') successCount++;
      if (status === 'failure') failureCount++;
    }

    if (successCount >= successThreshold) return 'success';
    if (failureCount >= failureThreshold) return 'failure';
    return 'running';
  };
}

// ==================== DECORATOR NODES ====================

/**
 * Inverter - Inverts the result of a child node
 */
export function inverter(child: BehaviorNode): BehaviorNode {
  return (context: BehaviorContext) => {
    const status = child(context);
    if (status === 'success') return 'failure';
    if (status === 'failure') return 'success';
    return 'running';
  };
}

/**
 * Succeeder - Always returns success (useful for optional actions)
 */
export function succeeder(child: BehaviorNode): BehaviorNode {
  return (context: BehaviorContext) => {
    child(context);
    return 'success';
  };
}

/**
 * Repeater - Repeats a child node a number of times
 */
export function repeater(times: number, child: BehaviorNode): BehaviorNode {
  let count = 0;
  return (context: BehaviorContext) => {
    if (count >= times) {
      count = 0;
      return 'success';
    }
    const status = child(context);
    if (status === 'success' || status === 'failure') {
      count++;
    }
    return 'running';
  };
}

/**
 * Condition - Only runs child if condition is true
 */
export function condition(
  predicate: (context: BehaviorContext) => boolean,
  child: BehaviorNode
): BehaviorNode {
  return (context: BehaviorContext) => {
    if (predicate(context)) {
      return child(context);
    }
    return 'failure';
  };
}

/**
 * Cooldown - Only allows child to run after cooldown period
 */
export function cooldown(cooldownMs: number, child: BehaviorNode): BehaviorNode {
  let lastRunTime = 0;
  return (context: BehaviorContext) => {
    const now = Date.now();
    if (now - lastRunTime < cooldownMs) {
      return 'failure';
    }
    const status = child(context);
    if (status === 'success') {
      lastRunTime = now;
    }
    return status;
  };
}

// ==================== ACTION NODES ====================

/**
 * Action - Wraps a function that performs an action
 */
export function action(
  fn: (context: BehaviorContext) => boolean
): BehaviorNode {
  return (context: BehaviorContext) => {
    return fn(context) ? 'success' : 'failure';
  };
}

/**
 * Wait - Waits for a specified duration
 */
export function wait(durationMs: number): BehaviorNode {
  let startTime: number | null = null;
  return (_context: BehaviorContext) => {
    const now = Date.now();
    if (startTime === null) {
      startTime = now;
    }
    if (now - startTime >= durationMs) {
      startTime = null;
      return 'success';
    }
    return 'running';
  };
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Creates a stateful behavior tree runner
 */
export class BehaviorTreeRunner {
  private root: BehaviorNode;
  private blackboard: Map<string, unknown> = new Map();

  constructor(root: BehaviorNode) {
    this.root = root;
  }

  public tick(
    entityId: number,
    world: import('../ecs/World').World,
    game: import('../core/Game').Game,
    deltaTime: number
  ): BehaviorStatus {
    const context: BehaviorContext = {
      entityId,
      world,
      game,
      blackboard: this.blackboard,
      deltaTime,
    };
    return this.root(context);
  }

  public setBlackboard(key: string, value: unknown): void {
    this.blackboard.set(key, value);
  }

  public getBlackboard<T>(key: string): T | undefined {
    return this.blackboard.get(key) as T | undefined;
  }

  public clearBlackboard(): void {
    this.blackboard.clear();
  }
}

// ==================== PRESET BEHAVIOR TREES ====================

import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';

/**
 * Check if unit should kite (ranged unit with enemy in range but too close)
 */
export function shouldKite(context: BehaviorContext): boolean {
  const entity = context.world.getEntity(context.entityId);
  if (!entity) return false;

  const unit = entity.get<Unit>('Unit');
  const transform = entity.get<Transform>('Transform');
  if (!unit || !transform) return false;

  // Only ranged units kite
  if (unit.attackRange < 3) return false;

  // Check if there's a melee enemy too close
  const dangerRange = unit.attackRange * 0.5;
  const kiteThreshold = unit.attackRange * 0.3;

  const nearbyUnits = context.world.unitGrid.queryRadius(
    transform.x,
    transform.y,
    dangerRange
  );

  for (const nearbyId of nearbyUnits) {
    if (nearbyId === context.entityId) continue;

    const nearbyEntity = context.world.getEntity(nearbyId);
    if (!nearbyEntity) continue;

    const nearbyUnit = nearbyEntity.get<Unit>('Unit');
    const nearbyTransform = nearbyEntity.get<Transform>('Transform');
    const nearbySelectable = nearbyEntity.get<Selectable>('Selectable');
    const nearbyHealth = nearbyEntity.get<Health>('Health');

    if (!nearbyUnit || !nearbyTransform || !nearbySelectable || !nearbyHealth) continue;

    // Check if enemy and alive
    const mySelectable = entity.get<Selectable>('Selectable');
    if (!mySelectable || nearbySelectable.playerId === mySelectable.playerId) continue;
    if (nearbyHealth.isDead()) continue;

    // Check if enemy is a melee threat that's too close
    const dx = nearbyTransform.x - transform.x;
    const dy = nearbyTransform.y - transform.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (nearbyUnit.attackRange < 3 && distance < kiteThreshold) {
      context.blackboard.set('kiteFromX', nearbyTransform.x);
      context.blackboard.set('kiteFromY', nearbyTransform.y);
      return true;
    }
  }

  return false;
}

/**
 * Execute kiting movement away from enemy
 */
export function executeKite(context: BehaviorContext): boolean {
  const entity = context.world.getEntity(context.entityId);
  if (!entity) return false;

  const unit = entity.get<Unit>('Unit');
  const transform = entity.get<Transform>('Transform');
  if (!unit || !transform) return false;

  const kiteFromX = context.blackboard.get('kiteFromX') as number;
  const kiteFromY = context.blackboard.get('kiteFromY') as number;

  if (kiteFromX === undefined || kiteFromY === undefined) return false;

  // Calculate direction away from threat
  const dx = transform.x - kiteFromX;
  const dy = transform.y - kiteFromY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 0.1) return false;

  // Move away to max attack range
  const kiteDistance = unit.attackRange * 0.8;
  const targetX = transform.x + (dx / distance) * kiteDistance;
  const targetY = transform.y + (dy / distance) * kiteDistance;

  // Clamp to map bounds
  const config = context.game.config;
  const clampedX = Math.max(1, Math.min(config.mapWidth - 1, targetX));
  const clampedY = Math.max(1, Math.min(config.mapHeight - 1, targetY));

  // Set move target while preserving attack state
  unit.targetX = clampedX;
  unit.targetY = clampedY;

  return true;
}

/**
 * Find nearby threats and calculate threat score
 */
export function calculateThreatScore(context: BehaviorContext): number {
  const entity = context.world.getEntity(context.entityId);
  if (!entity) return 0;

  const transform = entity.get<Transform>('Transform');
  const unit = entity.get<Unit>('Unit');
  const mySelectable = entity.get<Selectable>('Selectable');
  if (!transform || !unit || !mySelectable) return 0;

  let threatScore = 0;
  const threatRange = unit.sightRange;

  const nearbyUnits = context.world.unitGrid.queryRadius(
    transform.x,
    transform.y,
    threatRange
  );

  for (const nearbyId of nearbyUnits) {
    if (nearbyId === context.entityId) continue;

    const nearbyEntity = context.world.getEntity(nearbyId);
    if (!nearbyEntity) continue;

    const nearbyUnit = nearbyEntity.get<Unit>('Unit');
    const nearbyTransform = nearbyEntity.get<Transform>('Transform');
    const nearbySelectable = nearbyEntity.get<Selectable>('Selectable');
    const nearbyHealth = nearbyEntity.get<Health>('Health');

    if (!nearbyUnit || !nearbyTransform || !nearbySelectable || !nearbyHealth) continue;

    // Only count enemies
    if (nearbySelectable.playerId === mySelectable.playerId) continue;
    if (nearbyHealth.isDead()) continue;

    const dx = nearbyTransform.x - transform.x;
    const dy = nearbyTransform.y - transform.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Threat increases with damage and decreases with distance
    const distanceFactor = 1 - (distance / threatRange);
    const damageFactor = nearbyUnit.attackDamage / 10;
    threatScore += damageFactor * distanceFactor;
  }

  context.blackboard.set('threatScore', threatScore);
  return threatScore;
}

/**
 * Check if unit is in danger (low health and under threat)
 */
export function isInDanger(context: BehaviorContext): boolean {
  const entity = context.world.getEntity(context.entityId);
  if (!entity) return false;

  const health = entity.get<Health>('Health');
  if (!health) return false;

  const healthPercent = health.getHealthPercent();
  const threatScore = calculateThreatScore(context);

  // In danger if low health and threats nearby
  return healthPercent < 0.3 && threatScore > 2;
}

/**
 * Find best position for ranged combat
 */
export function findOptimalCombatPosition(context: BehaviorContext): { x: number; y: number } | null {
  const entity = context.world.getEntity(context.entityId);
  if (!entity) return null;

  const unit = entity.get<Unit>('Unit');
  const transform = entity.get<Transform>('Transform');
  const mySelectable = entity.get<Selectable>('Selectable');
  if (!unit || !transform || !mySelectable) return null;

  // Only ranged units need to position
  if (unit.attackRange < 3) return null;

  // Find current target
  if (unit.targetEntityId === null) return null;

  const targetEntity = context.world.getEntity(unit.targetEntityId);
  if (!targetEntity) return null;

  const targetTransform = targetEntity.get<Transform>('Transform');
  if (!targetTransform) return null;

  // Calculate ideal position at max attack range
  const dx = transform.x - targetTransform.x;
  const dy = transform.y - targetTransform.y;
  const currentDistance = Math.sqrt(dx * dx + dy * dy);

  if (currentDistance < 0.1) return null;

  // Position at 90% of attack range for safety buffer
  const idealDistance = unit.attackRange * 0.9;
  const dirX = dx / currentDistance;
  const dirY = dy / currentDistance;

  return {
    x: targetTransform.x + dirX * idealDistance,
    y: targetTransform.y + dirY * idealDistance,
  };
}

/**
 * Create a combat micro behavior tree for a unit type
 */
export function createCombatMicroTree(): BehaviorNode {
  return selector(
    // Priority 1: Kite from melee enemies if ranged
    sequence(
      action(ctx => shouldKite(ctx)),
      action(ctx => executeKite(ctx))
    ),
    // Priority 2: Retreat if in danger
    sequence(
      action(ctx => isInDanger(ctx)),
      action(ctx => {
        const entity = ctx.world.getEntity(ctx.entityId);
        if (!entity) return false;
        const unit = entity.get<Unit>('Unit');
        if (!unit) return false;
        // Will be handled by retreat logic
        ctx.blackboard.set('shouldRetreat', true);
        return true;
      })
    ),
    // Priority 3: Position optimally for combat
    action(ctx => {
      const pos = findOptimalCombatPosition(ctx);
      if (!pos) return false;

      const entity = ctx.world.getEntity(ctx.entityId);
      if (!entity) return false;

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      if (!unit || !transform) return false;

      // Only reposition if significantly out of position
      const dx = pos.x - transform.x;
      const dy = pos.y - transform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 1) {
        unit.targetX = pos.x;
        unit.targetY = pos.y;
        return true;
      }
      return false;
    })
  );
}

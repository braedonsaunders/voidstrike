/**
 * Pre-built Behavior Trees for RTS Unit AI
 *
 * Comprehensive behaviors for:
 * - Combat micro (kiting, focus fire, retreat)
 * - Worker automation (gathering, building)
 * - Patrol and scouting
 * - Formation movement
 * - Ability usage
 */

import {
  BehaviorNode,
  BehaviorContext,
  selector,
  sequence,
  memorySelector,
  memorySequence,
  parallel,
  utilitySelector,
  condition,
  cooldownTicks,
  timeout,
  reactive,
  action,
  asyncAction,
  wait,
} from './BehaviorTree';
import { clamp } from '@/utils/math';

import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Building } from '../components/Building';
import { findBestTarget as findBestTargetShared } from '../combat/TargetAcquisition';
import AssetManager from '@/assets/AssetManager';
import { distance } from '@/utils/math';

// ==================== HELPER FUNCTIONS ====================

/**
 * Get unit's current entity and components
 */
function getUnitData(ctx: BehaviorContext) {
  const entity = ctx.world.getEntity(ctx.entityId);
  if (!entity) return null;

  const unit = entity.get<Unit>('Unit');
  const transform = entity.get<Transform>('Transform');
  const health = entity.get<Health>('Health');
  const selectable = entity.get<Selectable>('Selectable');

  if (!unit || !transform || !health || !selectable) return null;

  return { entity, unit, transform, health, selectable };
}

/**
 * Get nearest enemy unit
 */
function getNearestEnemy(
  ctx: BehaviorContext,
  range: number
): {
  entityId: number;
  distance: number;
  transform: Transform;
  unit: Unit;
  health: Health;
} | null {
  const data = getUnitData(ctx);
  if (!data) return null;

  const { transform, selectable } = data;

  const nearbyIds = ctx.world.unitGrid.queryRadius(transform.x, transform.y, range);

  let nearest: ReturnType<typeof getNearestEnemy> = null;
  let nearestDist = Infinity;

  for (const id of nearbyIds) {
    if (id === ctx.entityId) continue;

    // SpatialGrid returns entity indices, use getEntityByIndex for lookup
    const enemy = ctx.world.getEntityByIndex(id);
    if (!enemy) continue;

    const enemySelectable = enemy.get<Selectable>('Selectable');
    const enemyHealth = enemy.get<Health>('Health');
    const enemyTransform = enemy.get<Transform>('Transform');
    const enemyUnit = enemy.get<Unit>('Unit');

    if (!enemySelectable || !enemyHealth || !enemyTransform || !enemyUnit) continue;
    if (enemySelectable.playerId === selectable.playerId) continue;
    if (enemyHealth.isDead()) continue;

    const dist = distance(transform.x, transform.y, enemyTransform.x, enemyTransform.y);

    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = {
        entityId: enemy.id,
        distance: dist,
        transform: enemyTransform,
        unit: enemyUnit,
        health: enemyHealth,
      };
    }
  }

  return nearest;
}

/**
 * Calculate threat score from nearby enemies
 */
function calculateThreatScore(ctx: BehaviorContext): number {
  const data = getUnitData(ctx);
  if (!data) return 0;

  const { transform, unit, selectable } = data;
  const threatRange = unit.sightRange * 1.2;

  let totalThreat = 0;
  const nearbyIds = ctx.world.unitGrid.queryRadius(transform.x, transform.y, threatRange);

  for (const id of nearbyIds) {
    if (id === ctx.entityId) continue;

    // SpatialGrid returns entity indices, use getEntityByIndex for lookup
    const enemy = ctx.world.getEntityByIndex(id);
    if (!enemy) continue;

    const enemySelectable = enemy.get<Selectable>('Selectable');
    const enemyHealth = enemy.get<Health>('Health');
    const enemyTransform = enemy.get<Transform>('Transform');
    const enemyUnit = enemy.get<Unit>('Unit');

    if (!enemySelectable || !enemyHealth || !enemyTransform || !enemyUnit) continue;
    if (enemySelectable.playerId === selectable.playerId) continue;
    if (enemyHealth.isDead()) continue;

    const dist = distance(transform.x, transform.y, enemyTransform.x, enemyTransform.y);
    const distanceFactor = Math.max(0, 1 - dist / threatRange);
    const damageFactor = enemyUnit.attackDamage / 20;
    const healthFactor = enemyHealth.getHealthPercent();

    // Enemies in attack range are more threatening
    const inRangeFactor = dist <= enemyUnit.attackRange ? 1.5 : 1.0;

    totalThreat += damageFactor * distanceFactor * healthFactor * inRangeFactor;
  }

  return totalThreat;
}

/**
 * Find best target using shared TargetAcquisition utility.
 * Uses data-driven priority weights from unit categories.
 */
function findBestTarget(ctx: BehaviorContext): number | null {
  const data = getUnitData(ctx);
  if (!data) return null;

  const { transform, unit, selectable } = data;

  // Use shared target acquisition with behavior tree scoring config
  const result = findBestTargetShared(ctx.world, {
    x: transform.x,
    y: transform.y,
    range: unit.sightRange,
    attackerPlayerId: selectable.playerId,
    attackRange: unit.attackRange,
    canAttackAir: unit.canAttackAir,
    canAttackGround: unit.canAttackGround,
    canAttackNaval: unit.canAttackNaval,
    includeBuildingsInSearch: unit.canAttackGround,
    attackerVisualRadius: AssetManager.getCachedVisualRadius(unit.unitId, unit.collisionRadius),
    excludeEntityId: ctx.entityId,
    // AI behavior tree uses slightly different weights
    scoringConfig: {
      priorityWeight: 0.6,
      distanceWeight: 25,
      healthWeight: 25,
      inRangeBonus: 30,
      buildingBasePriority: 25,
    },
  });

  return result?.entityId ?? null;
}

// ==================== CONDITION NODES ====================

/**
 * Check if unit is a ranged attacker
 */
export function isRangedUnit(ctx: BehaviorContext): boolean {
  const data = getUnitData(ctx);
  return data !== null && data.unit.attackRange >= 3;
}

/**
 * Check if unit is a melee attacker
 */
export function isMeleeUnit(ctx: BehaviorContext): boolean {
  const data = getUnitData(ctx);
  return data !== null && data.unit.attackRange < 3;
}

/**
 * Check if health is low
 */
export function isLowHealth(ctx: BehaviorContext, threshold = 0.3): boolean {
  const data = getUnitData(ctx);
  return data !== null && data.health.getHealthPercent() < threshold;
}

/**
 * Check if there are enemies nearby
 */
export function hasEnemiesNearby(ctx: BehaviorContext): boolean {
  const nearest = getNearestEnemy(ctx, 15);
  return nearest !== null;
}

/**
 * Check if under significant threat
 */
export function isUnderThreat(ctx: BehaviorContext, threshold = 2): boolean {
  const threat = calculateThreatScore(ctx);
  return threat >= threshold;
}

/**
 * Check if unit has a valid target
 */
export function hasTarget(ctx: BehaviorContext): boolean {
  const data = getUnitData(ctx);
  if (!data) return false;

  const targetId = data.unit.targetEntityId;
  if (targetId === null) return false;

  const target = ctx.world.getEntity(targetId);
  if (!target) return false;

  const targetHealth = target.get<Health>('Health');
  return targetHealth !== undefined && targetHealth !== null && !targetHealth.isDead();
}

/**
 * Check if melee threat is too close (for kiting)
 */
export function hasMeleeThreatClose(ctx: BehaviorContext): boolean {
  const data = getUnitData(ctx);
  if (!data || !isRangedUnit(ctx)) return false;

  const { transform, unit, selectable } = data;
  const dangerRange = unit.attackRange * 0.4;

  const nearbyIds = ctx.world.unitGrid.queryRadius(transform.x, transform.y, dangerRange);

  for (const id of nearbyIds) {
    if (id === ctx.entityId) continue;

    // SpatialGrid returns entity indices, use getEntityByIndex for lookup
    const enemy = ctx.world.getEntityByIndex(id);
    if (!enemy) continue;

    const enemySelectable = enemy.get<Selectable>('Selectable');
    const enemyHealth = enemy.get<Health>('Health');
    const enemyUnit = enemy.get<Unit>('Unit');

    if (!enemySelectable || !enemyHealth || !enemyUnit) continue;
    if (enemySelectable.playerId === selectable.playerId) continue;
    if (enemyHealth.isDead()) continue;

    // Check if enemy is melee
    if (enemyUnit.attackRange < 3) {
      return true;
    }
  }

  return false;
}

// ==================== ACTION NODES ====================

/**
 * Acquire best target and store in blackboard
 */
export const acquireTarget = action('AcquireTarget', (ctx) => {
  const targetId = findBestTarget(ctx);
  if (targetId !== null) {
    ctx.blackboard.set('targetId', targetId);
    return true;
  }
  return false;
});

/**
 * Attack the current target
 */
export const attackTarget = action('AttackTarget', (ctx) => {
  const data = getUnitData(ctx);
  if (!data) return false;

  const targetId = ctx.blackboard.get<number>('targetId') ?? data.unit.targetEntityId;
  if (targetId === null) return false;

  const target = ctx.world.getEntity(targetId);
  if (!target) return false;

  const targetHealth = target.get<Health>('Health');
  if (!targetHealth || targetHealth.isDead()) return false;

  // Set attack target
  data.unit.targetEntityId = targetId;
  data.unit.state = 'attacking';

  return true;
});

/**
 * Move to attack range of target
 */
export const moveToAttackRange = asyncAction('MoveToAttackRange', (ctx) => {
  const data = getUnitData(ctx);
  if (!data) return 'failure';

  const targetId = ctx.blackboard.get<number>('targetId') ?? data.unit.targetEntityId;
  if (targetId === null) return 'failure';

  const target = ctx.world.getEntity(targetId);
  if (!target) return 'failure';

  const targetTransform = target.get<Transform>('Transform');
  if (!targetTransform) return 'failure';

  // If unit is already in 'attacking' state with a valid target, let CombatSystem +
  // MovementOrchestrator handle approach via processAttackingUnit (dynamic entity tracking).
  // Overriding to 'moving' here would replace dynamic tracking with a static position,
  // causing state oscillation: attacking → moving → idle → attacking → ...
  if (data.unit.state === 'attacking' && data.unit.targetEntityId !== null) {
    return 'success';
  }

  const dist = distance(data.transform.x, data.transform.y, targetTransform.x, targetTransform.y);

  // Already in range
  if (dist <= data.unit.attackRange * 0.9) {
    return 'success';
  }

  // Move toward target
  const dx = targetTransform.x - data.transform.x;
  const dy = targetTransform.y - data.transform.y;
  const moveDistance = dist - data.unit.attackRange * 0.8;

  data.unit.targetX = data.transform.x + (dx / dist) * moveDistance;
  data.unit.targetY = data.transform.y + (dy / dist) * moveDistance;
  data.unit.state = 'moving';

  return 'running';
});

/**
 * Kite away from melee threats
 */
export const kiteFromMelee = action('KiteFromMelee', (ctx) => {
  const data = getUnitData(ctx);
  if (!data) return false;

  const { transform, unit, selectable } = data;
  const dangerRange = unit.attackRange * 0.5;

  // Find nearest melee threat
  let threatX = 0;
  let threatY = 0;
  let threatCount = 0;

  const nearbyIds = ctx.world.unitGrid.queryRadius(transform.x, transform.y, dangerRange);

  for (const id of nearbyIds) {
    if (id === ctx.entityId) continue;

    // SpatialGrid returns entity indices, use getEntityByIndex for lookup
    const enemy = ctx.world.getEntityByIndex(id);
    if (!enemy) continue;

    const enemySelectable = enemy.get<Selectable>('Selectable');
    const enemyHealth = enemy.get<Health>('Health');
    const enemyTransform = enemy.get<Transform>('Transform');
    const enemyUnit = enemy.get<Unit>('Unit');

    if (!enemySelectable || !enemyHealth || !enemyTransform || !enemyUnit) continue;
    if (enemySelectable.playerId === selectable.playerId) continue;
    if (enemyHealth.isDead()) continue;

    if (enemyUnit.attackRange < 3) {
      threatX += enemyTransform.x;
      threatY += enemyTransform.y;
      threatCount++;
    }
  }

  if (threatCount === 0) return false;

  // Average threat position
  threatX /= threatCount;
  threatY /= threatCount;

  // Move away from threat
  const dx = transform.x - threatX;
  const dy = transform.y - threatY;
  const dist = distance(transform.x, transform.y, threatX, threatY);

  if (dist < 0.1) return false;

  const kiteDistance = unit.attackRange * 0.7;
  const targetX = transform.x + (dx / dist) * kiteDistance;
  const targetY = transform.y + (dy / dist) * kiteDistance;

  // Clamp to map bounds
  const mapWidth = ctx.game.config.mapWidth;
  const mapHeight = ctx.game.config.mapHeight;

  unit.targetX = clamp(targetX, 1, mapWidth - 1);
  unit.targetY = clamp(targetY, 1, mapHeight - 1);

  return true;
});

/**
 * Retreat toward friendly base
 */
export const retreatToBase = action('RetreatToBase', (ctx) => {
  const data = getUnitData(ctx);
  if (!data) return false;

  const { transform, unit, selectable } = data;

  // Find nearest friendly building
  const buildings = ctx.world.getEntitiesWith('Building', 'Transform', 'Selectable');

  let nearestBuilding: { x: number; y: number } | null = null;
  let nearestDist = Infinity;

  for (const building of buildings) {
    const buildingSelectable = building.get<Selectable>('Selectable')!;
    if (buildingSelectable.playerId !== selectable.playerId) continue;

    const buildingTransform = building.get<Transform>('Transform')!;
    const dist = distance(transform.x, transform.y, buildingTransform.x, buildingTransform.y);

    if (dist < nearestDist) {
      nearestDist = dist;
      nearestBuilding = { x: buildingTransform.x, y: buildingTransform.y };
    }
  }

  if (!nearestBuilding) {
    // No friendly building, just move away from enemies
    const enemy = getNearestEnemy(ctx, 20);
    if (enemy) {
      const dx = transform.x - enemy.transform.x;
      const dy = transform.y - enemy.transform.y;
      const dist = distance(transform.x, transform.y, enemy.transform.x, enemy.transform.y);
      if (dist > 0.1) {
        unit.targetX = transform.x + (dx / dist) * 15;
        unit.targetY = transform.y + (dy / dist) * 15;
        return true;
      }
    }
    return false;
  }

  // Move toward base
  unit.targetX = nearestBuilding.x;
  unit.targetY = nearestBuilding.y;
  unit.state = 'moving';

  return true;
});

/**
 * Position at optimal attack range
 */
export const positionOptimally = action('PositionOptimally', (ctx) => {
  const data = getUnitData(ctx);
  if (!data) return false;

  const { transform, unit } = data;
  const targetId = ctx.blackboard.get<number>('targetId') ?? unit.targetEntityId;

  if (targetId === null) return false;

  const target = ctx.world.getEntity(targetId);
  if (!target) return false;

  const targetTransform = target.get<Transform>('Transform');
  if (!targetTransform) return false;

  const dist = distance(transform.x, transform.y, targetTransform.x, targetTransform.y);

  // Ideal position at 85% of attack range
  const idealDist = unit.attackRange * 0.85;
  const diff = idealDist - dist;

  // Only reposition if significantly out of position
  if (Math.abs(diff) < 0.5) return false;

  const dx = transform.x - targetTransform.x;
  const dy = transform.y - targetTransform.y;

  if (dist < 0.1) return false;

  unit.targetX = targetTransform.x + (dx / dist) * idealDist;
  unit.targetY = targetTransform.y + (dy / dist) * idealDist;

  return true;
});

/**
 * Stop all movement and actions
 */
export const stop = action('Stop', (ctx) => {
  const data = getUnitData(ctx);
  if (!data) return false;

  data.unit.targetX = null;
  data.unit.targetY = null;
  data.unit.targetEntityId = null;
  data.unit.state = 'idle';
  data.unit.path = [];
  data.unit.pathIndex = 0;

  return true;
});

// ==================== COMPOSITE BEHAVIOR TREES ====================

/**
 * Basic combat micro tree for all units
 */
export function createCombatMicroTree(): BehaviorNode {
  return selector(
    'CombatMicro',

    // Priority 1: Retreat if in danger (low health + high threat)
    sequence(
      'DangerRetreat',
      condition(
        'CheckDanger',
        (ctx) => isLowHealth(ctx, 0.25) && isUnderThreat(ctx, 3),
        retreatToBase
      )
    ),

    // Priority 2: Kite if ranged unit has melee threat close
    condition(
      'KiteCondition',
      (ctx) => isRangedUnit(ctx) && hasMeleeThreatClose(ctx),
      cooldownTicks('KiteCooldown', 8, kiteFromMelee)
    ),

    // Priority 3: Attack current target
    sequence('AttackSequence', condition('HasValidTarget', hasTarget, attackTarget)),

    // Priority 4: Acquire and attack new target
    sequence('AcquireAndAttack', acquireTarget, moveToAttackRange, attackTarget),

    // Priority 5: Position optimally if ranged
    condition('OptimalPosition', (ctx) => isRangedUnit(ctx) && hasTarget(ctx), positionOptimally)
  );
}

/**
 * Advanced ranged unit combat tree with sophisticated kiting
 */
export function createRangedCombatTree(): BehaviorNode {
  return memorySelector(
    'RangedCombat',

    // Emergency retreat
    sequence(
      'EmergencyRetreat',
      condition('CriticalHealth', (ctx) => isLowHealth(ctx, 0.2), retreatToBase),
      wait('RetreatCooldown', 40)
    ),

    // Kiting behavior
    reactive(
      'KitingBehavior',
      hasMeleeThreatClose,
      sequence(
        'KiteSequence',
        cooldownTicks('KiteCooldown', 6, kiteFromMelee),
        wait('KiteDelay', 3),
        attackTarget
      )
    ),

    // Continue attacking current valid target (CombatSystem handles chase + range)
    sequence('AttackCurrent', condition('HasValidTarget', hasTarget, attackTarget)),

    // Acquire NEW target and engage
    sequence(
      'NormalCombat',
      acquireTarget,
      parallel('AttackAndPosition', 2, moveToAttackRange, positionOptimally, attackTarget)
    )
  );
}

/**
 * Melee unit combat tree with aggression
 */
export function createMeleeCombatTree(): BehaviorNode {
  return memorySelector(
    'MeleeCombat',

    // Low health retreat
    condition(
      'LowHealthRetreat',
      (ctx) => isLowHealth(ctx, 0.15) && isUnderThreat(ctx, 4),
      retreatToBase
    ),

    // Continue attacking current valid target (CombatSystem handles chase + range)
    sequence('AttackCurrent', condition('HasValidTarget', hasTarget, attackTarget)),

    // Aggressive engage - acquire NEW target, chase and attack
    sequence(
      'AggressiveEngage',
      acquireTarget,
      timeout('ChaseTimeout', 100, moveToAttackRange),
      attackTarget
    )
  );
}

/**
 * Defensive behavior tree (hold position, attack in range only)
 */
export function createDefensiveCombatTree(): BehaviorNode {
  return selector(
    'DefensiveCombat',

    // Attack enemies in range only
    sequence(
      'AttackInRange',
      condition(
        'EnemyInRange',
        (ctx) => {
          const data = getUnitData(ctx);
          if (!data) return false;
          const enemy = getNearestEnemy(ctx, data.unit.attackRange);
          if (enemy) {
            ctx.blackboard.set('targetId', enemy.entityId);
            return true;
          }
          return false;
        },
        attackTarget
      )
    ),

    // Don't move, just idle
    stop
  );
}

/**
 * Focus fire behavior - coordinates with other units
 */
export function createFocusFireTree(): BehaviorNode {
  return sequence(
    'FocusFire',

    // Get shared target from blackboard or find one
    action('GetSharedTarget', (ctx) => {
      // Check for shared focus target first
      const sharedTarget = ctx.blackboard.get<number>('focusTarget');
      if (sharedTarget !== null && sharedTarget !== undefined) {
        const target = ctx.world.getEntity(sharedTarget);
        if (target) {
          const health = target.get<Health>('Health');
          if (health && !health.isDead()) {
            ctx.blackboard.set('targetId', sharedTarget);
            return true;
          }
        }
      }

      // Find new target
      const targetId = findBestTarget(ctx);
      if (targetId !== null) {
        ctx.blackboard.set('targetId', targetId);
        ctx.blackboard.set('focusTarget', targetId); // Share with others
        return true;
      }
      return false;
    }),

    moveToAttackRange,
    attackTarget
  );
}

/**
 * Utility-based combat tree - evaluates multiple options
 */
export function createUtilityCombatTree(): BehaviorNode {
  return utilitySelector('UtilityCombat', [
    {
      node: retreatToBase,
      score: (ctx) => {
        const data = getUnitData(ctx);
        if (!data) return 0;
        const healthPercent = data.health.getHealthPercent();
        const threat = calculateThreatScore(ctx);
        // High score when low health and high threat
        return (1 - healthPercent) * threat * 50;
      },
      threshold: 25,
    },
    {
      node: sequence('KiteAndAttack', kiteFromMelee, attackTarget),
      score: (ctx) => {
        if (!isRangedUnit(ctx)) return 0;
        if (!hasMeleeThreatClose(ctx)) return 0;
        return 40; // Fixed high priority when kiting is needed
      },
      threshold: 30,
    },
    {
      node: sequence('StandardAttack', acquireTarget, moveToAttackRange, attackTarget),
      score: (ctx) => {
        const enemy = getNearestEnemy(ctx, 15);
        if (!enemy) return 0;
        // Prefer attacking low health enemies
        return 20 + (1 - enemy.health.getHealthPercent()) * 30;
      },
      threshold: 10,
    },
    {
      node: stop,
      score: () => 5, // Default idle score
      threshold: 0,
    },
  ]);
}

/**
 * Patrol behavior tree
 */
export function createPatrolTree(): BehaviorNode {
  return memorySelector(
    'Patrol',

    // Engage enemies encountered during patrol
    condition(
      'EngageEnemy',
      hasEnemiesNearby,
      sequence('PatrolCombat', createCombatMicroTree(), wait('CombatPause', 20))
    ),

    // Continue patrol movement
    asyncAction('ContinuePatrol', (ctx) => {
      const data = getUnitData(ctx);
      if (!data) return 'failure';

      const { unit, transform } = data;

      // Check if we have patrol points
      if (unit.patrolPoints.length < 2) {
        return 'failure';
      }

      // Get current patrol point
      const currentPoint = unit.patrolPoints[unit.patrolIndex];
      if (!currentPoint) return 'failure';

      // Check if at current patrol point
      const atPoint = distance(transform.x, transform.y, currentPoint.x, currentPoint.y) < 1;

      if (atPoint) {
        // Move to next patrol point
        unit.nextPatrolPoint();
        const nextPoint = unit.patrolPoints[unit.patrolIndex];
        if (nextPoint) {
          unit.targetX = nextPoint.x;
          unit.targetY = nextPoint.y;
        }
      } else if (unit.targetX === null) {
        // Start patrol toward current point
        unit.targetX = currentPoint.x;
        unit.targetY = currentPoint.y;
      }

      unit.state = 'moving';
      return 'running';
    })
  );
}

/**
 * Worker gathering behavior tree
 */
export function createWorkerGatheringTree(): BehaviorNode {
  return memorySequence(
    'WorkerGathering',

    // Find resource if not assigned
    action('FindResource', (ctx) => {
      const data = getUnitData(ctx);
      if (!data) return false;

      // Check if already has a resource target
      if (ctx.blackboard.has('resourceId')) return true;

      // Find nearest mineral patch or refinery
      const resources = ctx.world.getEntitiesWith('Building', 'Transform');
      let nearestResource: number | null = null;
      let nearestDist = Infinity;

      for (const resource of resources) {
        const building = resource.get<Building>('Building')!;
        if (building.buildingId !== 'mineral_patch' && building.buildingId !== 'refinery') continue;

        const transform = resource.get<Transform>('Transform')!;
        const dist = distance(data.transform.x, data.transform.y, transform.x, transform.y);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestResource = resource.id;
        }
      }

      if (nearestResource !== null) {
        ctx.blackboard.set('resourceId', nearestResource);
        return true;
      }
      return false;
    }),

    // Move to resource
    asyncAction('MoveToResource', (ctx) => {
      const data = getUnitData(ctx);
      if (!data) return 'failure';

      const resourceId = ctx.blackboard.get<number>('resourceId');
      if (resourceId === undefined) return 'failure';

      const resource = ctx.world.getEntity(resourceId);
      if (!resource) {
        ctx.blackboard.delete('resourceId');
        return 'failure';
      }

      const resourceTransform = resource.get<Transform>('Transform')!;
      const dist = distance(
        data.transform.x,
        data.transform.y,
        resourceTransform.x,
        resourceTransform.y
      );

      if (dist < 2) {
        data.unit.state = 'gathering';
        return 'success';
      }

      data.unit.targetX = resourceTransform.x;
      data.unit.targetY = resourceTransform.y;
      data.unit.state = 'moving';

      return 'running';
    }),

    // Gather resources
    wait('Gathering', 60), // 3 seconds at 20 TPS

    // Return to base with resources
    asyncAction('ReturnToBase', (ctx) => {
      const data = getUnitData(ctx);
      if (!data) return 'failure';

      // Find command center
      const buildings = ctx.world.getEntitiesWith('Building', 'Transform', 'Selectable');
      let nearestBase: { x: number; y: number } | null = null;
      let nearestDist = Infinity;

      for (const building of buildings) {
        const buildingComp = building.get<Building>('Building')!;
        const buildingSelectable = building.get<Selectable>('Selectable')!;

        if (buildingSelectable.playerId !== data.selectable.playerId) continue;
        if (
          buildingComp.buildingId !== 'command_center' &&
          buildingComp.buildingId !== 'headquarters'
        )
          continue;

        const transform = building.get<Transform>('Transform')!;
        const dist = distance(data.transform.x, data.transform.y, transform.x, transform.y);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestBase = { x: transform.x, y: transform.y };
        }
      }

      if (!nearestBase) return 'failure';

      if (nearestDist < 3) {
        // Deposit resources
        data.unit.state = 'idle';
        return 'success';
      }

      data.unit.targetX = nearestBase.x;
      data.unit.targetY = nearestBase.y;
      data.unit.state = 'moving';

      return 'running';
    })
  );
}

// ==================== TREE FACTORY ====================

export type UnitBehaviorType =
  | 'combat'
  | 'ranged_combat'
  | 'melee_combat'
  | 'defensive'
  | 'focus_fire'
  | 'utility'
  | 'patrol'
  | 'worker';

/**
 * Factory function to create behavior tree by type
 */
export function createBehaviorTree(type: UnitBehaviorType): BehaviorNode {
  switch (type) {
    case 'combat':
      return createCombatMicroTree();
    case 'ranged_combat':
      return createRangedCombatTree();
    case 'melee_combat':
      return createMeleeCombatTree();
    case 'defensive':
      return createDefensiveCombatTree();
    case 'focus_fire':
      return createFocusFireTree();
    case 'utility':
      return createUtilityCombatTree();
    case 'patrol':
      return createPatrolTree();
    case 'worker':
      return createWorkerGatheringTree();
    default:
      return createCombatMicroTree();
  }
}

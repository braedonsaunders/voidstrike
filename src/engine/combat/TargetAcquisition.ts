/**
 * TargetAcquisition - Unified Target Selection System
 *
 * Consolidated target acquisition logic used by:
 * - CombatSystem (unit auto-targeting)
 * - BuildingMechanicsSystem (turret targeting)
 * - UnitBehaviors (AI behavior trees)
 *
 * Uses spatial grids for O(nearby) queries instead of O(n) entity scans.
 * Priority weights are data-driven from unit categories.
 */

import { World } from '../ecs/World';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { getDefaultTargetPriority } from '@/data/units/categories';
import AssetManager from '@/assets/AssetManager';

/**
 * Configuration for target scoring algorithm.
 * Higher values = more likely to be targeted.
 */
export interface TargetScoringConfig {
  /** Weight for unit category priority (0-1) */
  priorityWeight: number;
  /** Weight for distance factor (0-1), closer = higher score */
  distanceWeight: number;
  /** Weight for low health bonus (0-1), lower health = higher score */
  healthWeight: number;
  /** Bonus for targets already in attack range */
  inRangeBonus: number;
  /** Base priority for buildings (typically lower than combat units) */
  buildingBasePriority: number;
}

/** Default scoring configuration */
export const DEFAULT_SCORING_CONFIG: TargetScoringConfig = {
  priorityWeight: 0.5,
  distanceWeight: 30,
  healthWeight: 20,
  inRangeBonus: 30,
  buildingBasePriority: 30,
};

/**
 * Options for target acquisition query.
 */
export interface TargetQueryOptions {
  /** Position to search from */
  x: number;
  y: number;
  /** Search radius (typically attack range or sight range) */
  range: number;
  /** Player ID of the attacker (to exclude friendly units) */
  attackerPlayerId: string;
  /** Attacker's attack range for in-range bonus calculation */
  attackRange?: number;
  /** Whether attacker can attack air units */
  canAttackAir?: boolean;
  /** Whether attacker can attack ground units */
  canAttackGround?: boolean;
  /** Whether to include buildings in search */
  includeBuildingsInSearch?: boolean;
  /** Attacker's visual radius for edge-to-edge distance calculations */
  attackerVisualRadius?: number;
  /** Exclude specific entity ID (usually self) */
  excludeEntityId?: number;
  /** Custom scoring config (uses defaults if not provided) */
  scoringConfig?: Partial<TargetScoringConfig>;
}

/**
 * Result from target acquisition.
 */
export interface TargetResult {
  entityId: number;
  score: number;
  distance: number;
  isBuilding: boolean;
}

/**
 * Find the best target using spatial grid queries.
 * Uses O(nearby) complexity instead of O(all entities).
 *
 * @param world - The ECS world containing spatial grids
 * @param options - Query options
 * @returns Best target or null if none found
 */
export function findBestTarget(
  world: World,
  options: TargetQueryOptions
): TargetResult | null {
  const config: TargetScoringConfig = {
    ...DEFAULT_SCORING_CONFIG,
    ...options.scoringConfig,
  };

  // Default targeting capabilities
  const canAttackAir = options.canAttackAir ?? true;
  const canAttackGround = options.canAttackGround ?? true;
  const includeBuildings = options.includeBuildingsInSearch ?? canAttackGround;
  const attackRange = options.attackRange ?? options.range;
  const attackerRadius = options.attackerVisualRadius ?? 0.5;

  let bestTarget: TargetResult | null = null;

  // Query units from spatial grid
  const nearbyUnitIds = world.unitGrid.queryRadius(
    options.x,
    options.y,
    options.range
  );

  for (const entityId of nearbyUnitIds) {
    if (options.excludeEntityId !== undefined && entityId === options.excludeEntityId) {
      continue;
    }

    const entity = world.getEntity(entityId);
    if (!entity) continue;

    const transform = entity.get<Transform>('Transform');
    const health = entity.get<Health>('Health');
    const selectable = entity.get<Selectable>('Selectable');
    const unit = entity.get<Unit>('Unit');

    if (!transform || !health || !selectable) continue;
    if (selectable.playerId === options.attackerPlayerId) continue;
    if (health.isDead()) continue;

    // Check air/ground targeting capability
    const targetIsFlying = unit?.isFlying ?? false;
    if (targetIsFlying && !canAttackAir) continue;
    if (!targetIsFlying && !canAttackGround) continue;

    // Calculate edge-to-edge distance
    const centerDistance = Math.sqrt(
      (transform.x - options.x) ** 2 + (transform.y - options.y) ** 2
    );
    const targetRadius = unit
      ? AssetManager.getCachedVisualRadius(unit.unitId, unit.collisionRadius)
      : 0.5;
    const distance = Math.max(0, centerDistance - attackerRadius - targetRadius);

    if (distance > options.range) continue;

    // Calculate score
    const score = calculateTargetScore(
      unit?.unitId ?? 'default',
      distance,
      options.range,
      attackRange,
      health.current / health.max,
      false,
      config
    );

    if (!bestTarget || score > bestTarget.score) {
      bestTarget = { entityId, score, distance, isBuilding: false };
    }
  }

  // Query buildings from spatial grid if enabled
  if (includeBuildings) {
    const nearbyBuildingIds = world.buildingGrid.queryRadius(
      options.x,
      options.y,
      options.range
    );

    for (const entityId of nearbyBuildingIds) {
      if (options.excludeEntityId !== undefined && entityId === options.excludeEntityId) {
        continue;
      }

      const entity = world.getEntity(entityId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');

      if (!transform || !health || !selectable || !building) continue;
      if (selectable.playerId === options.attackerPlayerId) continue;
      if (health.isDead()) continue;

      // Calculate distance to building edge
      const halfW = building.width / 2;
      const halfH = building.height / 2;
      const clampedX = Math.max(
        transform.x - halfW,
        Math.min(options.x, transform.x + halfW)
      );
      const clampedY = Math.max(
        transform.y - halfH,
        Math.min(options.y, transform.y + halfH)
      );
      const edgeDx = options.x - clampedX;
      const edgeDy = options.y - clampedY;
      const distance = Math.max(
        0,
        Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy) - attackerRadius
      );

      if (distance > options.range) continue;

      // Calculate score (buildings use fixed base priority)
      const score = calculateTargetScore(
        'building',
        distance,
        options.range,
        attackRange,
        health.current / health.max,
        true,
        config
      );

      if (!bestTarget || score > bestTarget.score) {
        bestTarget = { entityId, score, distance, isBuilding: true };
      }
    }
  }

  return bestTarget;
}

/**
 * Find all valid targets sorted by score (highest first).
 * Useful for focus fire or multi-target abilities.
 */
export function findAllTargets(
  world: World,
  options: TargetQueryOptions,
  maxResults: number = 10
): TargetResult[] {
  const config: TargetScoringConfig = {
    ...DEFAULT_SCORING_CONFIG,
    ...options.scoringConfig,
  };

  const canAttackAir = options.canAttackAir ?? true;
  const canAttackGround = options.canAttackGround ?? true;
  const includeBuildings = options.includeBuildingsInSearch ?? canAttackGround;
  const attackRange = options.attackRange ?? options.range;
  const attackerRadius = options.attackerVisualRadius ?? 0.5;

  const targets: TargetResult[] = [];

  // Query units
  const nearbyUnitIds = world.unitGrid.queryRadius(
    options.x,
    options.y,
    options.range
  );

  for (const entityId of nearbyUnitIds) {
    if (options.excludeEntityId !== undefined && entityId === options.excludeEntityId) {
      continue;
    }

    const entity = world.getEntity(entityId);
    if (!entity) continue;

    const transform = entity.get<Transform>('Transform');
    const health = entity.get<Health>('Health');
    const selectable = entity.get<Selectable>('Selectable');
    const unit = entity.get<Unit>('Unit');

    if (!transform || !health || !selectable) continue;
    if (selectable.playerId === options.attackerPlayerId) continue;
    if (health.isDead()) continue;

    const targetIsFlying = unit?.isFlying ?? false;
    if (targetIsFlying && !canAttackAir) continue;
    if (!targetIsFlying && !canAttackGround) continue;

    const centerDistance = Math.sqrt(
      (transform.x - options.x) ** 2 + (transform.y - options.y) ** 2
    );
    const targetRadius = unit
      ? AssetManager.getCachedVisualRadius(unit.unitId, unit.collisionRadius)
      : 0.5;
    const distance = Math.max(0, centerDistance - attackerRadius - targetRadius);

    if (distance > options.range) continue;

    const score = calculateTargetScore(
      unit?.unitId ?? 'default',
      distance,
      options.range,
      attackRange,
      health.current / health.max,
      false,
      config
    );

    targets.push({ entityId, score, distance, isBuilding: false });
  }

  // Query buildings
  if (includeBuildings) {
    const nearbyBuildingIds = world.buildingGrid.queryRadius(
      options.x,
      options.y,
      options.range
    );

    for (const entityId of nearbyBuildingIds) {
      if (options.excludeEntityId !== undefined && entityId === options.excludeEntityId) {
        continue;
      }

      const entity = world.getEntity(entityId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');

      if (!transform || !health || !selectable || !building) continue;
      if (selectable.playerId === options.attackerPlayerId) continue;
      if (health.isDead()) continue;

      const halfW = building.width / 2;
      const halfH = building.height / 2;
      const clampedX = Math.max(
        transform.x - halfW,
        Math.min(options.x, transform.x + halfW)
      );
      const clampedY = Math.max(
        transform.y - halfH,
        Math.min(options.y, transform.y + halfH)
      );
      const edgeDx = options.x - clampedX;
      const edgeDy = options.y - clampedY;
      const distance = Math.max(
        0,
        Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy) - attackerRadius
      );

      if (distance > options.range) continue;

      const score = calculateTargetScore(
        'building',
        distance,
        options.range,
        attackRange,
        health.current / health.max,
        true,
        config
      );

      targets.push({ entityId, score, distance, isBuilding: true });
    }
  }

  // Sort by score (highest first) and limit results
  targets.sort((a, b) => b.score - a.score);
  return targets.slice(0, maxResults);
}

/**
 * Calculate target score using unified algorithm.
 *
 * Score components:
 * - Category priority: Higher priority units (e.g., siege, casters) score higher
 * - Distance factor: Closer targets score higher
 * - Health factor: Lower health targets score higher (finish off wounded)
 * - In-range bonus: Targets already in attack range get a bonus
 */
function calculateTargetScore(
  unitId: string,
  distance: number,
  searchRange: number,
  attackRange: number,
  healthPercent: number,
  isBuilding: boolean,
  config: TargetScoringConfig
): number {
  // Base priority from unit category (or fixed for buildings)
  const basePriority = isBuilding
    ? config.buildingBasePriority
    : getDefaultTargetPriority(unitId);

  // Distance factor: 1.0 at center, 0.0 at edge of search range
  const distanceFactor = Math.max(0, 1 - distance / searchRange);

  // Health factor: 1.0 at 0% health, 0.0 at 100% health
  const healthFactor = 1 - healthPercent;

  // In-range bonus for targets within attack range
  const inRangeBonus = distance <= attackRange ? config.inRangeBonus : 0;

  // Calculate final score
  return (
    basePriority * config.priorityWeight +
    distanceFactor * config.distanceWeight +
    healthFactor * config.healthWeight +
    inRangeBonus
  );
}

/**
 * Simplified target acquisition for buildings/turrets.
 * Uses spatial grids for O(nearby) instead of O(n) entity scan.
 *
 * @param world - ECS world
 * @param buildingTransform - Building position
 * @param playerId - Building owner's player ID
 * @param attackRange - Turret attack range
 * @returns Best target entity or null
 */
export function findBuildingTarget(
  world: World,
  buildingTransform: Transform,
  playerId: string,
  attackRange: number
): { entity: Entity; distance: number } | null {
  const result = findBestTarget(world, {
    x: buildingTransform.x,
    y: buildingTransform.y,
    range: attackRange,
    attackerPlayerId: playerId,
    attackRange: attackRange,
    canAttackAir: true,
    canAttackGround: true,
    includeBuildingsInSearch: false, // Buildings typically don't attack other buildings
    attackerVisualRadius: 0, // Buildings don't have visual radius for distance calc
    // Buildings use simple scoring - prioritize closest targets
    scoringConfig: {
      priorityWeight: 0.3,
      distanceWeight: 50, // Higher weight for distance - turrets prefer closest
      healthWeight: 15,
      inRangeBonus: 20,
      buildingBasePriority: 20,
    },
  });

  if (!result) return null;

  const entity = world.getEntity(result.entityId);
  if (!entity) return null;

  return { entity, distance: result.distance };
}

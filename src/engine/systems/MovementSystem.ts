/**
 * Movement System - SC2-Style Clumping & Formations
 *
 * Handles unit movement using Recast's DetourCrowd for collision avoidance.
 * Implements SC2-style "magic box" detection for clump vs formation behavior:
 * - Target INSIDE selection bounding box → units clump to same point
 * - Target OUTSIDE bounding box → units preserve relative spacing
 *
 * Also supports explicit formation commands using data-driven formations.
 */

import { System } from '../ecs/System';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Velocity } from '../components/Velocity';
import { Building } from '../components/Building';
import { Resource } from '../components/Resource';
import { Game } from '../core/Game';
import { PooledVector2 } from '@/utils/VectorPool';
import { TERRAIN_FEATURE_CONFIG, TerrainFeature } from '@/data/maps';
import { getRecastNavigation, RecastNavigation } from '../pathfinding/RecastNavigation';
import { debugPerformance, debugPathfinding } from '@/utils/debugLogger';
import { snapValue, QUANT_POSITION } from '@/utils/FixedPoint';
import {
  generateFormationPositions,
  sortUnitsForFormation,
  getFormation,
  FORMATION_CONFIG,
} from '@/data/formations/formations';

// ==================== SC2-STYLE STEERING CONSTANTS ====================

// Separation - prevents overlapping (strongest force)
const SEPARATION_RADIUS = 1.0;
const SEPARATION_STRENGTH_MOVING = 1.2;      // Weak while moving - allow clumping
const SEPARATION_STRENGTH_IDLE = 2.5;        // Strong when idle - spread out
const SEPARATION_STRENGTH_ARRIVING = 3.0;    // Strongest at arrival - natural spreading
const MAX_AVOIDANCE_FORCE = 1.5;
const MAX_AVOIDANCE_FORCE_SQ = MAX_AVOIDANCE_FORCE * MAX_AVOIDANCE_FORCE;

// Cohesion - keeps group together (weak force)
const COHESION_RADIUS = 8.0;
const COHESION_STRENGTH = 0.1;               // Very weak - just prevents extreme spreading

// Alignment - matches group heading (moderate force)
const ALIGNMENT_RADIUS = 4.0;
const ALIGNMENT_STRENGTH = 0.3;

// Arrival spreading - units spread out when reaching destination
const ARRIVAL_SPREAD_RADIUS = 2.5;           // Distance from target where spreading kicks in
const ARRIVAL_SPREAD_STRENGTH = 2.0;         // Additional separation at arrival

// Building avoidance - runtime steering to handle edge cases
// The navmesh walkableRadius (0.6) provides primary clearance; these are backup
const BUILDING_AVOIDANCE_STRENGTH = 25.0; // Moderate push strength
const BUILDING_AVOIDANCE_MARGIN = 0.3;    // Small safety margin for hard avoidance
const BUILDING_AVOIDANCE_SOFT_MARGIN = 0.8; // Reduced early detection zone
const BUILDING_PREDICTION_LOOKAHEAD = 0.5;  // Seconds to look ahead for collision

// Path request cooldown in ticks (10 ticks @ 20 ticks/sec = 500ms)
const PATH_REQUEST_COOLDOWN_TICKS = 10;

// Use Recast crowd for collision avoidance
// Re-enabled with fixes: proper position sync and crowd update timing
const USE_RECAST_CROWD = true;

// Static temp vectors for steering behaviors
const tempSeparation: PooledVector2 = { x: 0, y: 0 };
const tempCohesion: PooledVector2 = { x: 0, y: 0 };
const tempAlignment: PooledVector2 = { x: 0, y: 0 };
const tempBuildingAvoid: PooledVector2 = { x: 0, y: 0 };

// PERF: Cached building query results to avoid double spatial grid lookups
const cachedBuildingQuery: { entityId: number; results: number[] } = { entityId: -1, results: [] };

// PERF: Separation force throttle interval (recalculate every N ticks instead of every frame)
const SEPARATION_THROTTLE_TICKS = 5;

// PERF: Static array to avoid allocation on every building avoidance check
const DROP_OFF_BUILDINGS = Object.freeze([
  'headquarters',
  'orbital_station',
  'bastion',
  'nexus',
  'hatchery',
  'lair',
  'hive',
]);

// PERF: Pooled formation position buffer to avoid allocation per move command
const FORMATION_BUFFER_SIZE = 256; // Max units in a single move command
const formationBuffer: Array<{ x: number; y: number }> = [];
for (let i = 0; i < FORMATION_BUFFER_SIZE; i++) {
  formationBuffer.push({ x: 0, y: 0 });
}

export class MovementSystem extends System {
  public readonly name = 'MovementSystem';
  public priority = 10;

  private arrivalThreshold = 0.5;
  private decelerationThreshold = 2.0;
  private lastPathRequestTime: Map<number, number> = new Map();
  private recast: RecastNavigation;

  // Track which units are registered with crowd
  private crowdAgents: Set<number> = new Set();

  // PERF: Cached separation forces to avoid recalculating every frame
  private separationCache: Map<number, { x: number; y: number; tick: number }> = new Map();
  private currentTick: number = 0;

  constructor(game: Game) {
    super(game);
    this.recast = getRecastNavigation();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:move', this.handleMoveCommand.bind(this));
    this.game.eventBus.on('command:patrol', this.handlePatrolCommand.bind(this));
    this.game.eventBus.on('command:formation', this.handleFormationCommand.bind(this));

    // Clean up path request tracking and separation cache when units die to prevent memory leaks
    this.game.eventBus.on('unit:died', (data: { entityId: number }) => {
      this.lastPathRequestTime.delete(data.entityId);
      this.separationCache.delete(data.entityId);
    });
    this.game.eventBus.on('unit:destroyed', (data: { entityId: number }) => {
      this.lastPathRequestTime.delete(data.entityId);
      this.separationCache.delete(data.entityId);
    });
  }

  // ==================== MAGIC BOX DETECTION ====================

  /**
   * Calculate the bounding box of a set of units.
   * Used for SC2-style "magic box" detection.
   */
  private calculateBoundingBox(entityIds: number[]): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    centerX: number;
    centerY: number;
  } | null {
    if (entityIds.length === 0) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let validCount = 0;

    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;
      const transform = entity.get<Transform>('Transform');
      if (!transform) continue;

      minX = Math.min(minX, transform.x);
      maxX = Math.max(maxX, transform.x);
      minY = Math.min(minY, transform.y);
      maxY = Math.max(maxY, transform.y);
      validCount++;
    }

    if (validCount === 0) return null;

    return {
      minX,
      maxX,
      minY,
      maxY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
  }

  /**
   * Check if a target point is inside the bounding box of selected units.
   * SC2 behavior: target inside box = clump, target outside = preserve spacing
   */
  private isTargetInsideMagicBox(
    targetX: number,
    targetY: number,
    box: { minX: number; maxX: number; minY: number; maxY: number }
  ): boolean {
    // Add a small margin to prevent edge-case toggling
    const margin = 0.5;
    return (
      targetX >= box.minX - margin &&
      targetX <= box.maxX + margin &&
      targetY >= box.minY - margin &&
      targetY <= box.maxY + margin
    );
  }

  /**
   * Calculate average facing direction from group center to target.
   * Used for formation orientation.
   */
  private calculateGroupFacing(
    centerX: number,
    centerY: number,
    targetX: number,
    targetY: number
  ): number {
    const dx = targetX - centerX;
    const dy = targetY - centerY;
    return Math.atan2(dy, dx);
  }

  private requestPathWithCooldown(
    entityId: number,
    targetX: number,
    targetY: number,
    force: boolean = false
  ): boolean {
    const currentTick = this.game.getCurrentTick();
    const lastRequestTick = this.lastPathRequestTime.get(entityId) || 0;

    if (!force && currentTick - lastRequestTick < PATH_REQUEST_COOLDOWN_TICKS) {
      return false;
    }

    this.lastPathRequestTime.set(entityId, currentTick);
    this.game.eventBus.emit('pathfinding:request', {
      entityId,
      targetX,
      targetY,
    });
    return true;
  }

  /**
   * Handle move command with SC2-style magic box detection.
   *
   * Magic Box Behavior:
   * - Target INSIDE the bounding box of selected units → CLUMP MODE
   *   All units move to the SAME target point, separation spreads them on arrival.
   * - Target OUTSIDE the bounding box → PRESERVE SPACING MODE
   *   Each unit maintains its relative offset from the group center.
   *
   * This creates natural SC2-like behavior where:
   * - Short moves (within group) create tight clumps
   * - Long moves (outside group) maintain army spread
   */
  private handleMoveCommand(data: {
    entityIds: number[];
    targetPosition: { x: number; y: number };
    queue?: boolean;
  }): void {
    const { entityIds, targetPosition, queue } = data;

    // Single unit always goes directly to target
    if (entityIds.length === 1) {
      const entityId = entityIds[0];
      const entity = this.world.getEntity(entityId);
      if (!entity) return;

      const unit = entity.get<Unit>('Unit');
      if (!unit) return;

      if (queue) {
        unit.queueCommand({
          type: 'move',
          targetX: targetPosition.x,
          targetY: targetPosition.y,
        });
      } else {
        if (unit.state === 'building' && unit.constructingBuildingId !== null) {
          unit.cancelBuilding();
        }
        unit.setMoveTarget(targetPosition.x, targetPosition.y);
        unit.path = [];
        unit.pathIndex = 0;
        this.requestPathWithCooldown(entityId, targetPosition.x, targetPosition.y, true);
      }
      return;
    }

    // Multi-unit move: apply magic box logic
    const box = this.calculateBoundingBox(entityIds);
    if (!box) return;

    const isInsideBox = this.isTargetInsideMagicBox(targetPosition.x, targetPosition.y, box);

    if (isInsideBox) {
      // CLUMP MODE: All units move to the same point
      // Separation forces will spread them naturally on arrival
      this.moveUnitsToSamePoint(entityIds, targetPosition.x, targetPosition.y, queue);
    } else {
      // PRESERVE SPACING MODE: Maintain relative offsets from group center
      this.moveUnitsWithRelativeOffsets(entityIds, targetPosition.x, targetPosition.y, box, queue);
    }
  }

  /**
   * Clump mode: All units move to the exact same target point.
   * Separation forces will naturally spread them on arrival (SC2 style).
   */
  private moveUnitsToSamePoint(
    entityIds: number[],
    targetX: number,
    targetY: number,
    queue?: boolean
  ): void {
    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      if (queue) {
        unit.queueCommand({
          type: 'move',
          targetX,
          targetY,
        });
      } else {
        if (unit.state === 'building' && unit.constructingBuildingId !== null) {
          unit.cancelBuilding();
        }
        unit.setMoveTarget(targetX, targetY);
        unit.path = [];
        unit.pathIndex = 0;
        this.requestPathWithCooldown(entityId, targetX, targetY, true);
      }
    }
  }

  /**
   * Preserve spacing mode: Each unit maintains its relative offset from the group center.
   * Creates formation-like movement without explicit formation slots.
   */
  private moveUnitsWithRelativeOffsets(
    entityIds: number[],
    targetX: number,
    targetY: number,
    box: { centerX: number; centerY: number },
    queue?: boolean
  ): void {
    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      if (!transform || !unit) continue;

      // Calculate this unit's offset from group center
      const offsetX = transform.x - box.centerX;
      const offsetY = transform.y - box.centerY;

      // Apply offset to target position
      const unitTargetX = targetX + offsetX;
      const unitTargetY = targetY + offsetY;

      if (queue) {
        unit.queueCommand({
          type: 'move',
          targetX: unitTargetX,
          targetY: unitTargetY,
        });
      } else {
        if (unit.state === 'building' && unit.constructingBuildingId !== null) {
          unit.cancelBuilding();
        }
        unit.setMoveTarget(unitTargetX, unitTargetY);
        unit.path = [];
        unit.pathIndex = 0;
        this.requestPathWithCooldown(entityId, unitTargetX, unitTargetY, true);
      }
    }
  }

  /**
   * Handle explicit formation command - player requested a specific formation.
   * Uses the data-driven formation system from formations.ts.
   */
  private handleFormationCommand(data: {
    entityIds: number[];
    formationId: string;
    targetPosition: { x: number; y: number };
    queue?: boolean;
  }): void {
    const { entityIds, formationId, targetPosition, queue } = data;

    if (entityIds.length === 0) return;

    const formation = getFormation(formationId);
    if (!formation) {
      // Fall back to normal move if formation not found
      this.handleMoveCommand({ entityIds, targetPosition, queue });
      return;
    }

    // Calculate group center for facing direction
    const box = this.calculateBoundingBox(entityIds);
    if (!box) return;

    const facingAngle = this.calculateGroupFacing(
      box.centerX,
      box.centerY,
      targetPosition.x,
      targetPosition.y
    );

    // Build unit info for sorting
    const unitInfos: Array<{
      id: number;
      category: string;
      isRanged: boolean;
      isMelee: boolean;
      isSupport: boolean;
    }> = [];

    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      // Determine unit type based on attack range
      const isRanged = unit.attackRange >= 5;
      const isMelee = unit.attackRange < 2 && unit.attackDamage > 0;
      const isSupport = unit.canHeal || unit.attackDamage === 0;

      unitInfos.push({
        id: entityId,
        category: unit.unitId,
        isRanged,
        isMelee,
        isSupport,
      });
    }

    // Sort units for formation (melee front, ranged back, etc.)
    const sortedUnits = sortUnitsForFormation(formationId, unitInfos);

    // Generate formation positions
    const formationPositions = generateFormationPositions(
      formationId,
      sortedUnits.length,
      targetPosition.x,
      targetPosition.y,
      facingAngle
    );

    // Assign each unit to its formation slot
    for (let i = 0; i < sortedUnits.length; i++) {
      const entityId = sortedUnits[i].id;
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      const pos = formationPositions[i];
      if (!pos) continue;

      if (queue) {
        unit.queueCommand({
          type: 'move',
          targetX: pos.x,
          targetY: pos.y,
        });
      } else {
        if (unit.state === 'building' && unit.constructingBuildingId !== null) {
          unit.cancelBuilding();
        }
        unit.setMoveTarget(pos.x, pos.y);
        unit.path = [];
        unit.pathIndex = 0;
        this.requestPathWithCooldown(entityId, pos.x, pos.y, true);
      }
    }
  }

  private handlePatrolCommand(data: {
    entityIds: number[];
    targetPosition: { x: number; y: number };
    queue?: boolean;
  }): void {
    const { entityIds, targetPosition, queue } = data;

    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      if (!unit || !transform) continue;

      if (queue) {
        unit.queueCommand({
          type: 'patrol',
          targetX: targetPosition.x,
          targetY: targetPosition.y,
        });
      } else {
        unit.setPatrol(
          transform.x,
          transform.y,
          targetPosition.x,
          targetPosition.y
        );
        this.requestPathWithCooldown(
          entityId,
          targetPosition.x,
          targetPosition.y,
          true
        );
      }
    }
  }

  /**
   * Calculate formation positions for a group move command
   * PERF: Uses pooled buffer to avoid array allocation per move command
   * Returns a slice of the pooled buffer - DO NOT store reference, copy values immediately
   */
  private calculateFormationPositions(
    targetX: number,
    targetY: number,
    count: number
  ): Array<{ x: number; y: number }> {
    // Clamp to buffer size
    const effectiveCount = Math.min(count, FORMATION_BUFFER_SIZE);

    if (effectiveCount === 1) {
      formationBuffer[0].x = targetX;
      formationBuffer[0].y = targetY;
      return formationBuffer;
    }

    const spacing = 1.5;
    const cols = Math.ceil(Math.sqrt(effectiveCount));
    const rows = Math.ceil(effectiveCount / cols);
    const offsetX = ((cols - 1) * spacing) / 2;
    const offsetY = ((rows - 1) * spacing) / 2;

    // PERF: Reuse pooled buffer objects instead of allocating new ones
    for (let i = 0; i < effectiveCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      formationBuffer[i].x = targetX + col * spacing - offsetX;
      formationBuffer[i].y = targetY + row * spacing - offsetY;
    }

    return formationBuffer;
  }

  /**
   * Ensure unit is registered with crowd
   */
  private ensureAgentRegistered(
    entityId: number,
    transform: Transform,
    unit: Unit
  ): void {
    if (!USE_RECAST_CROWD) return;
    if (unit.isFlying) return;
    if (this.crowdAgents.has(entityId)) return;

    const agentIndex = this.recast.addAgent(
      entityId,
      transform.x,
      transform.y,
      unit.collisionRadius,
      unit.maxSpeed
    );

    if (agentIndex >= 0) {
      this.crowdAgents.add(entityId);
    }
  }

  /**
   * Remove unit from crowd
   */
  private removeAgentIfRegistered(entityId: number): void {
    if (!this.crowdAgents.has(entityId)) return;
    this.recast.removeAgent(entityId);
    this.crowdAgents.delete(entityId);
  }

  /**
   * Get state-dependent separation strength.
   * SC2 style: weak while moving (allow clumping), strong when idle (spread out).
   */
  private getSeparationStrength(unit: Unit, distanceToTarget: number): number {
    // Workers gathering/building have no separation
    if (unit.state === 'gathering' || unit.state === 'building') {
      return 0;
    }

    // Near arrival: strongest separation for natural spreading
    if (distanceToTarget < ARRIVAL_SPREAD_RADIUS && distanceToTarget > 0) {
      return SEPARATION_STRENGTH_ARRIVING;
    }

    // Moving: weak separation, allow clumping for faster group movement
    if (
      unit.state === 'moving' ||
      unit.state === 'attackmoving' ||
      unit.state === 'patrolling'
    ) {
      return SEPARATION_STRENGTH_MOVING;
    }

    // Idle/attacking: strong separation, spread out
    return SEPARATION_STRENGTH_IDLE;
  }

  /**
   * Calculate separation force (SC2-style soft avoidance)
   * State-dependent: weak while moving (clumping), strong when idle (spreading).
   * PERF: Results are cached and only recalculated every SEPARATION_THROTTLE_TICKS ticks
   */
  private calculateSeparationForce(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    out: PooledVector2,
    distanceToTarget: number = Infinity
  ): void {
    const baseStrength = this.getSeparationStrength(selfUnit, distanceToTarget);
    if (baseStrength === 0) {
      out.x = 0;
      out.y = 0;
      return;
    }

    // PERF: Check cache first - reuse result if calculated recently
    const cached = this.separationCache.get(selfId);
    if (cached && (this.currentTick - cached.tick) < SEPARATION_THROTTLE_TICKS) {
      // Scale cached result by current strength (state may have changed)
      out.x = cached.x;
      out.y = cached.y;
      return;
    }

    let forceX = 0;
    let forceY = 0;

    const nearbyIds = this.world.unitGrid.queryRadius(
      selfTransform.x,
      selfTransform.y,
      SEPARATION_RADIUS + selfUnit.collisionRadius
    );

    for (const entityId of nearbyIds) {
      if (entityId === selfId) continue;

      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const otherTransform = entity.get<Transform>('Transform');
      const otherUnit = entity.get<Unit>('Unit');
      if (!otherTransform || !otherUnit) continue;

      if (otherUnit.state === 'dead') continue;
      if (selfUnit.isFlying !== otherUnit.isFlying) continue;
      if (otherUnit.state === 'gathering') continue;
      // Allow workers to clip into each other for easier mining
      if (selfUnit.isWorker && otherUnit.isWorker) continue;

      const dx = selfTransform.x - otherTransform.x;
      const dy = selfTransform.y - otherTransform.y;
      const distanceSq = dx * dx + dy * dy;

      const combinedRadius = selfUnit.collisionRadius + otherUnit.collisionRadius;
      const separationDist = Math.max(combinedRadius * 0.5, SEPARATION_RADIUS);
      const separationDistSq = separationDist * separationDist;

      // PERF: Use squared distance for threshold check, only sqrt when needed
      if (distanceSq < separationDistSq && distanceSq > 0.0001) {
        const distance = Math.sqrt(distanceSq);
        const strength = baseStrength * (1 - distance / separationDist);
        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;

        forceX += normalizedDx * strength;
        forceY += normalizedDy * strength;
      }
    }

    // PERF: Use squared magnitude comparison first
    const magnitudeSq = forceX * forceX + forceY * forceY;
    if (magnitudeSq > MAX_AVOIDANCE_FORCE_SQ) {
      const magnitude = Math.sqrt(magnitudeSq);
      const scale = MAX_AVOIDANCE_FORCE / magnitude;
      forceX *= scale;
      forceY *= scale;
    }

    // PERF: Cache the result
    this.separationCache.set(selfId, { x: forceX, y: forceY, tick: this.currentTick });

    out.x = forceX;
    out.y = forceY;
  }

  /**
   * Calculate cohesion force - steers toward the average position of nearby units.
   * Keeps groups together but with very weak force (SC2 style).
   */
  private calculateCohesionForce(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    out: PooledVector2
  ): void {
    out.x = 0;
    out.y = 0;

    // No cohesion for workers or idle units
    if (selfUnit.isWorker || selfUnit.state === 'idle' || selfUnit.state === 'gathering') {
      return;
    }

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    const nearbyIds = this.world.unitGrid.queryRadius(
      selfTransform.x,
      selfTransform.y,
      COHESION_RADIUS
    );

    for (const entityId of nearbyIds) {
      if (entityId === selfId) continue;

      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const otherTransform = entity.get<Transform>('Transform');
      const otherUnit = entity.get<Unit>('Unit');
      if (!otherTransform || !otherUnit) continue;

      if (otherUnit.state === 'dead') continue;
      if (selfUnit.isFlying !== otherUnit.isFlying) continue;
      // Only cohere with units moving in same direction
      if (otherUnit.state !== selfUnit.state) continue;

      sumX += otherTransform.x;
      sumY += otherTransform.y;
      count++;
    }

    if (count === 0) return;

    // Calculate center of mass
    const centerX = sumX / count;
    const centerY = sumY / count;

    // Direction to center of mass
    const dx = centerX - selfTransform.x;
    const dy = centerY - selfTransform.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.1) return;

    // Weak cohesion force toward center
    out.x = (dx / dist) * COHESION_STRENGTH;
    out.y = (dy / dist) * COHESION_STRENGTH;
  }

  /**
   * Calculate alignment force - steers toward the average heading of nearby units.
   * Helps groups move together smoothly.
   */
  private calculateAlignmentForce(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    selfVelocity: Velocity,
    out: PooledVector2
  ): void {
    out.x = 0;
    out.y = 0;

    // No alignment for workers or stationary units
    if (selfUnit.isWorker || selfUnit.state === 'idle' || selfUnit.state === 'gathering') {
      return;
    }

    let sumVx = 0;
    let sumVy = 0;
    let count = 0;

    const nearbyIds = this.world.unitGrid.queryRadius(
      selfTransform.x,
      selfTransform.y,
      ALIGNMENT_RADIUS
    );

    for (const entityId of nearbyIds) {
      if (entityId === selfId) continue;

      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const otherTransform = entity.get<Transform>('Transform');
      const otherUnit = entity.get<Unit>('Unit');
      const otherVelocity = entity.get<Velocity>('Velocity');
      if (!otherTransform || !otherUnit || !otherVelocity) continue;

      if (otherUnit.state === 'dead') continue;
      if (selfUnit.isFlying !== otherUnit.isFlying) continue;

      // Only align with moving units
      const otherSpeed = otherVelocity.getMagnitude();
      if (otherSpeed < 0.1) continue;

      // Add normalized velocity
      sumVx += otherVelocity.x / otherSpeed;
      sumVy += otherVelocity.y / otherSpeed;
      count++;
    }

    if (count === 0) return;

    // Average heading
    const avgVx = sumVx / count;
    const avgVy = sumVy / count;
    const avgMag = Math.sqrt(avgVx * avgVx + avgVy * avgVy);

    if (avgMag < 0.1) return;

    // Alignment force toward average heading
    out.x = (avgVx / avgMag) * ALIGNMENT_STRENGTH;
    out.y = (avgVy / avgMag) * ALIGNMENT_STRENGTH;
  }

  /**
   * PERF: Get cached building query results - avoids duplicate spatial grid lookups
   * Both calculateBuildingAvoidanceForce and resolveHardBuildingCollision need nearby buildings
   */
  private getCachedBuildingQuery(
    entityId: number,
    x: number,
    y: number,
    radius: number
  ): number[] {
    // Return cached results if same entity (called twice per frame for same entity)
    if (cachedBuildingQuery.entityId === entityId) {
      return cachedBuildingQuery.results;
    }

    // New entity - perform query and cache results
    const results = this.world.buildingGrid.queryRadius(x, y, radius);
    cachedBuildingQuery.entityId = entityId;
    cachedBuildingQuery.results.length = 0;
    for (const id of results) {
      cachedBuildingQuery.results.push(id);
    }
    return cachedBuildingQuery.results;
  }

  /**
   * CROWD FIX: Prepare all crowd agents before the crowd simulation update.
   * This syncs positions and sets targets so the crowd has fresh data.
   */
  private prepareCrowdAgents(entities: Entity[], dt: number): void {
    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      if (!transform || !unit) continue;

      // Skip dead units and flying units (crowd is for ground collision avoidance)
      if (unit.state === 'dead' || unit.isFlying) {
        this.removeAgentIfRegistered(entity.id);
        continue;
      }

      // Only register moving units
      const canMove =
        unit.state === 'moving' ||
        unit.state === 'attackmoving' ||
        unit.state === 'attacking' ||
        unit.state === 'gathering' ||
        unit.state === 'patrolling' ||
        unit.state === 'building';

      if (!canMove) {
        this.removeAgentIfRegistered(entity.id);
        continue;
      }

      // Ensure agent is registered
      this.ensureAgentRegistered(entity.id, transform, unit);

      // Sync agent position to entity position (handles external movement like knockback)
      if (this.crowdAgents.has(entity.id)) {
        this.recast.updateAgentPosition(entity.id, transform.x, transform.y);

        // Calculate target for this unit
        let targetX: number | null = null;
        let targetY: number | null = null;

        if (unit.path.length > 0 && unit.pathIndex < unit.path.length) {
          const waypoint = unit.path[unit.pathIndex];
          targetX = waypoint.x;
          targetY = waypoint.y;
        } else if (unit.targetX !== null && unit.targetY !== null) {
          targetX = unit.targetX;
          targetY = unit.targetY;
        }

        // Set target if we have one
        if (targetX !== null && targetY !== null) {
          this.recast.setAgentTarget(entity.id, targetX, targetY);
          // Use unit.maxSpeed for crowd - let the crowd simulation handle velocity fully
          // Previously used currentSpeed which capped velocity to accelerating speed
          this.recast.updateAgentParams(entity.id, {
            maxSpeed: unit.maxSpeed,
            radius: unit.collisionRadius,
          });
        }
      }
    }
  }

  /**
   * Calculate building avoidance force with predictive collision detection
   *
   * Uses three-tier avoidance:
   * 1. Hard avoidance - immediate push when very close (within margin)
   * 2. Soft avoidance - gentle steering when approaching (soft margin zone)
   * 3. Predictive avoidance - steer away from predicted collision points
   *
   * PERF: Uses cached building query to avoid duplicate spatial grid lookups
   */
  private calculateBuildingAvoidanceForce(
    entityId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    out: PooledVector2,
    velocityX: number = 0,
    velocityY: number = 0
  ): void {
    if (selfUnit.isFlying) {
      out.x = 0;
      out.y = 0;
      return;
    }

    let forceX = 0;
    let forceY = 0;

    // Query larger radius to include soft avoidance zone
    // PERF: Use cached query - same query used by resolveHardBuildingCollision
    const queryRadius = BUILDING_AVOIDANCE_SOFT_MARGIN + selfUnit.collisionRadius + 8;
    const nearbyBuildingIds = this.getCachedBuildingQuery(
      entityId,
      selfTransform.x,
      selfTransform.y,
      queryRadius
    );

    const isCarryingResources =
      selfUnit.isWorker &&
      (selfUnit.carryingMinerals > 0 || selfUnit.carryingVespene > 0);

    let gatheringExtractorId: number | null = null;
    if (
      selfUnit.isWorker &&
      selfUnit.state === 'gathering' &&
      selfUnit.gatherTargetId !== null
    ) {
      const resourceEntity = this.world.getEntity(selfUnit.gatherTargetId);
      if (resourceEntity) {
        const resource = resourceEntity.get<Resource>('Resource');
        if (
          resource &&
          resource.resourceType === 'vespene' &&
          resource.extractorEntityId !== null
        ) {
          gatheringExtractorId = resource.extractorEntityId;
        }
      }
    }

    // Calculate predicted position for predictive avoidance
    const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
    const predictedX = selfTransform.x + velocityX * BUILDING_PREDICTION_LOOKAHEAD;
    const predictedY = selfTransform.y + velocityY * BUILDING_PREDICTION_LOOKAHEAD;

    for (const buildingId of nearbyBuildingIds) {
      if (selfUnit.constructingBuildingId === buildingId) continue;
      if (gatheringExtractorId === buildingId) continue;

      const entity = this.world.getEntity(buildingId);
      if (!entity) continue;

      const buildingTransform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!buildingTransform || !building) continue;

      if (isCarryingResources && DROP_OFF_BUILDINGS.includes(building.buildingId)) {
        continue;
      }

      const baseHalfWidth = building.width / 2;
      const baseHalfHeight = building.height / 2;

      // === TIER 1: Hard avoidance (immediate collision prevention) ===
      const hardHalfWidth = baseHalfWidth + BUILDING_AVOIDANCE_MARGIN;
      const hardHalfHeight = baseHalfHeight + BUILDING_AVOIDANCE_MARGIN;

      const clampedX = Math.max(
        buildingTransform.x - hardHalfWidth,
        Math.min(selfTransform.x, buildingTransform.x + hardHalfWidth)
      );
      const clampedY = Math.max(
        buildingTransform.y - hardHalfHeight,
        Math.min(selfTransform.y, buildingTransform.y + hardHalfHeight)
      );

      const dx = selfTransform.x - clampedX;
      const dy = selfTransform.y - clampedY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const hardCollisionDist = selfUnit.collisionRadius + BUILDING_AVOIDANCE_MARGIN;

      if (distance < hardCollisionDist && distance > 0.01) {
        // Strong push proportional to how deep we are
        const penetration = 1 - (distance / hardCollisionDist);
        const strength = BUILDING_AVOIDANCE_STRENGTH * penetration * penetration; // Quadratic for stronger close push
        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;

        forceX += normalizedDx * strength;
        forceY += normalizedDy * strength;
      } else if (distance < 0.01) {
        // Inside building - emergency escape
        const toCenterX = selfTransform.x - buildingTransform.x;
        const toCenterY = selfTransform.y - buildingTransform.y;
        const toCenterDist = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY);

        if (toCenterDist > 0.01) {
          forceX += (toCenterX / toCenterDist) * BUILDING_AVOIDANCE_STRENGTH * 1.5;
          forceY += (toCenterY / toCenterDist) * BUILDING_AVOIDANCE_STRENGTH * 1.5;
        } else {
          forceX += BUILDING_AVOIDANCE_STRENGTH * 1.5;
        }
        continue; // Skip soft avoidance for emergency case
      }

      // === TIER 2: Soft avoidance (smooth steering in approach zone) ===
      const softHalfWidth = baseHalfWidth + BUILDING_AVOIDANCE_SOFT_MARGIN;
      const softHalfHeight = baseHalfHeight + BUILDING_AVOIDANCE_SOFT_MARGIN;

      const softClampedX = Math.max(
        buildingTransform.x - softHalfWidth,
        Math.min(selfTransform.x, buildingTransform.x + softHalfWidth)
      );
      const softClampedY = Math.max(
        buildingTransform.y - softHalfHeight,
        Math.min(selfTransform.y, buildingTransform.y + softHalfHeight)
      );

      const softDx = selfTransform.x - softClampedX;
      const softDy = selfTransform.y - softClampedY;
      const softDistance = Math.sqrt(softDx * softDx + softDy * softDy);

      const softCollisionDist = selfUnit.collisionRadius + BUILDING_AVOIDANCE_SOFT_MARGIN;

      if (softDistance < softCollisionDist && softDistance > hardCollisionDist) {
        // Gentle steering force in soft zone
        const t = (softDistance - hardCollisionDist) / (softCollisionDist - hardCollisionDist);
        const softStrength = BUILDING_AVOIDANCE_STRENGTH * 0.3 * (1 - t);
        const normalizedDx = softDx / softDistance;
        const normalizedDy = softDy / softDistance;

        forceX += normalizedDx * softStrength;
        forceY += normalizedDy * softStrength;
      }

      // === TIER 3: Predictive avoidance (steer away from future collision) ===
      if (speed > 0.5) {
        const predClampedX = Math.max(
          buildingTransform.x - hardHalfWidth,
          Math.min(predictedX, buildingTransform.x + hardHalfWidth)
        );
        const predClampedY = Math.max(
          buildingTransform.y - hardHalfHeight,
          Math.min(predictedY, buildingTransform.y + hardHalfHeight)
        );

        const predDx = predictedX - predClampedX;
        const predDy = predictedY - predClampedY;
        const predDistance = Math.sqrt(predDx * predDx + predDy * predDy);

        // If predicted position would be inside collision zone, steer perpendicular to velocity
        if (predDistance < selfUnit.collisionRadius + BUILDING_AVOIDANCE_MARGIN * 0.5) {
          // Calculate perpendicular direction (choose the one away from building center)
          const toBuildingX = buildingTransform.x - selfTransform.x;
          const toBuildingY = buildingTransform.y - selfTransform.y;

          // Perpendicular to velocity
          const perpX = -velocityY / speed;
          const perpY = velocityX / speed;

          // Choose direction away from building
          const dot = perpX * toBuildingX + perpY * toBuildingY;
          const sign = dot > 0 ? -1 : 1;

          const predictiveStrength = BUILDING_AVOIDANCE_STRENGTH * 0.5;
          forceX += perpX * sign * predictiveStrength;
          forceY += perpY * sign * predictiveStrength;
        }
      }
    }

    out.x = forceX;
    out.y = forceY;
  }

  public update(deltaTime: number): void {
    const updateStart = performance.now();
    const entities = this.world.getEntitiesWith('Transform', 'Unit', 'Velocity');
    const dt = deltaTime / 1000;

    // PERF: Track current tick for separation force throttling
    this.currentTick = this.game.getCurrentTick();

    // PERF: Invalidate building query cache at start of frame
    cachedBuildingQuery.entityId = -1;

    // Update spatial grid
    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      if (!transform || !unit) continue;
      if (unit.state !== 'dead') {
        this.world.unitGrid.update(
          entity.id,
          transform.x,
          transform.y,
          unit.collisionRadius
        );
      }
    }

    // CROWD FIX: First pass - sync positions and set targets BEFORE crowd update
    // This ensures the crowd simulation has fresh data when it runs
    if (USE_RECAST_CROWD) {
      this.prepareCrowdAgents(entities, dt);
      // Now update the crowd with all agents synced and targets set
      this.recast.updateCrowd(dt);
    }

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      const velocity = entity.get<Velocity>('Velocity');
      if (!transform || !unit || !velocity) continue;

      // Handle dead units
      if (unit.state === 'dead') {
        velocity.zero();
        this.world.unitGrid.remove(entity.id);
        this.removeAgentIfRegistered(entity.id);
        continue;
      }

      const canMove =
        unit.state === 'moving' ||
        unit.state === 'attackmoving' ||
        unit.state === 'attacking' ||
        unit.state === 'gathering' ||
        unit.state === 'patrolling' ||
        unit.state === 'building';

      if (!canMove) {
        if (unit.currentSpeed > 0) {
          // Use unit's deceleration rate for stopping (SC2-style snappy stops)
          unit.currentSpeed = Math.max(
            0,
            unit.currentSpeed - unit.deceleration * dt
          );
        }
        this.removeAgentIfRegistered(entity.id);

        // IDLE REPULSION: Apply separation forces to idle units so they spread out
        // This was previously skipped, causing units to stack on top of each other
        if (unit.state === 'idle' && !unit.isFlying) {
          this.calculateSeparationForce(entity.id, transform, unit, tempSeparation, Infinity);
          const sepMagSq = tempSeparation.x * tempSeparation.x + tempSeparation.y * tempSeparation.y;

          // Only apply movement if there's meaningful separation force
          if (sepMagSq > 0.001) {
            // Scale by idle separation strength and apply as velocity
            const idleRepelSpeed = Math.min(unit.maxSpeed * 0.5, Math.sqrt(sepMagSq) * SEPARATION_STRENGTH_IDLE);
            const sepMag = Math.sqrt(sepMagSq);
            velocity.x = (tempSeparation.x / sepMag) * idleRepelSpeed;
            velocity.y = (tempSeparation.y / sepMag) * idleRepelSpeed;

            // Apply movement
            transform.translate(velocity.x * dt, velocity.y * dt);

            // Snap position for determinism
            transform.x = snapValue(transform.x, QUANT_POSITION);
            transform.y = snapValue(transform.y, QUANT_POSITION);

            // Resolve any building collisions from the push
            this.resolveHardBuildingCollision(entity.id, transform, unit);
            continue;
          }
        }

        velocity.zero();
        continue;
      }

      // Ensure agent is in crowd for collision avoidance
      if (USE_RECAST_CROWD && !unit.isFlying) {
        this.ensureAgentRegistered(entity.id, transform, unit);
      }

      // Get current target
      let targetX: number | null = null;
      let targetY: number | null = null;

      if (unit.path.length > 0 && unit.pathIndex < unit.path.length) {
        const waypoint = unit.path[unit.pathIndex];
        targetX = waypoint.x;
        targetY = waypoint.y;
      } else if (unit.targetX !== null && unit.targetY !== null) {
        targetX = unit.targetX;
        targetY = unit.targetY;

        if (!unit.isFlying) {
          const directDx = unit.targetX - transform.x;
          const directDy = unit.targetY - transform.y;
          // PERF: Use squared distance - avoid sqrt for simple threshold check
          const directDistanceSq = directDx * directDx + directDy * directDy;

          const needsPath =
            unit.state === 'moving' ||
            unit.state === 'gathering' ||
            unit.state === 'building';
          if (directDistanceSq > 9 && needsPath) { // 9 = 3^2
            this.requestPathWithCooldown(entity.id, unit.targetX, unit.targetY);
          }
        }
      }

      // Handle attacking state
      if (unit.state === 'attacking' && unit.targetEntityId !== null) {
        const targetEntity = this.world.getEntity(unit.targetEntityId);
        if (targetEntity) {
          const targetTransform = targetEntity.get<Transform>('Transform');
          const targetBuilding = targetEntity.get<Building>('Building');
          if (targetTransform) {
            let effectiveDistance: number;
            let attackTargetX = targetTransform.x;
            let attackTargetY = targetTransform.y;
            let needsToEscape = false;

            if (targetBuilding) {
              const halfW = targetBuilding.width / 2;
              const halfH = targetBuilding.height / 2;
              const clampedX = Math.max(
                targetTransform.x - halfW,
                Math.min(transform.x, targetTransform.x + halfW)
              );
              const clampedY = Math.max(
                targetTransform.y - halfH,
                Math.min(transform.y, targetTransform.y + halfH)
              );
              const edgeDx = transform.x - clampedX;
              const edgeDy = transform.y - clampedY;
              effectiveDistance = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

              const standOffDistance = unit.attackRange * 0.8;
              const minSafeDistance = unit.collisionRadius + 0.5;

              if (effectiveDistance > minSafeDistance) {
                const dirX = edgeDx / effectiveDistance;
                const dirY = edgeDy / effectiveDistance;
                attackTargetX = clampedX + dirX * standOffDistance;
                attackTargetY = clampedY + dirY * standOffDistance;
              } else {
                needsToEscape = true;
                const awayDx = transform.x - targetTransform.x;
                const awayDy = transform.y - targetTransform.y;
                const awayDist = Math.sqrt(awayDx * awayDx + awayDy * awayDy);
                if (awayDist > 0.1) {
                  const escapeDistance =
                    Math.max(halfW, halfH) + standOffDistance + 0.5;
                  attackTargetX =
                    targetTransform.x + (awayDx / awayDist) * escapeDistance;
                  attackTargetY =
                    targetTransform.y + (awayDy / awayDist) * escapeDistance;
                } else {
                  attackTargetX = targetTransform.x + halfW + standOffDistance + 0.5;
                  attackTargetY = targetTransform.y;
                }
              }
            } else {
              effectiveDistance = transform.distanceTo(targetTransform);
            }

            if (effectiveDistance > unit.attackRange || needsToEscape) {
              targetX = attackTargetX;
              targetY = attackTargetY;
            } else {
              transform.rotation = Math.atan2(
                targetTransform.y - transform.y,
                targetTransform.x - transform.x
              );
              // Use unit's deceleration rate for stopping when in attack range
              unit.currentSpeed = Math.max(
                0,
                unit.currentSpeed - unit.deceleration * dt
              );
              velocity.zero();
              continue;
            }
          }
        } else {
          if (!unit.executeNextCommand()) {
            unit.clearTarget();
          }
          velocity.zero();
          continue;
        }
      }

      if (targetX === null || targetY === null) {
        if (unit.executeNextCommand()) {
          if (unit.targetX !== null && unit.targetY !== null) {
            unit.path = [];
            unit.pathIndex = 0;
            this.requestPathWithCooldown(
              entity.id,
              unit.targetX,
              unit.targetY,
              true
            );
          }
        } else {
          // Use unit's deceleration rate for stopping when no target
          unit.currentSpeed = Math.max(
            0,
            unit.currentSpeed - unit.deceleration * dt
          );
        }
        velocity.zero();
        continue;
      }

      const dx = targetX - transform.x;
      const dy = targetY - transform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check arrival
      if (distance < this.arrivalThreshold) {
        if (unit.path.length > 0 && unit.pathIndex < unit.path.length - 1) {
          unit.pathIndex++;
        } else if (unit.state === 'patrolling') {
          unit.nextPatrolPoint();
          unit.path = [];
          unit.pathIndex = 0;
          if (unit.targetX !== null && unit.targetY !== null) {
            this.requestPathWithCooldown(
              entity.id,
              unit.targetX,
              unit.targetY,
              true
            );
          }
        } else {
          if (unit.state === 'gathering') {
            unit.targetX = null;
            unit.targetY = null;
            velocity.zero();
            continue;
          }

          if (unit.state === 'building') {
            unit.targetX = null;
            unit.targetY = null;
            unit.currentSpeed = 0;
            velocity.zero();
            continue;
          }

          if (unit.executeNextCommand()) {
            if (unit.targetX !== null && unit.targetY !== null) {
              unit.path = [];
              unit.pathIndex = 0;
              this.requestPathWithCooldown(
                entity.id,
                unit.targetX,
                unit.targetY,
                true
              );
            }
          } else {
            unit.clearTarget();
          }
          velocity.zero();
          continue;
        }
      }

      // Calculate speed
      let targetSpeed = unit.maxSpeed;
      const terrainSpeedMod = this.getTerrainSpeedModifier(
        transform.x,
        transform.y,
        unit.isFlying
      );
      targetSpeed *= terrainSpeedMod;

      if (distance < this.decelerationThreshold) {
        targetSpeed = targetSpeed * (distance / this.decelerationThreshold);
        targetSpeed = Math.max(targetSpeed, unit.maxSpeed * terrainSpeedMod * 0.3);
      }

      // SC2-style acceleration: use per-unit rates for smooth/snappy feel
      // Ground units have instant acceleration (1000), air units have gradual (1-5)
      if (unit.currentSpeed < targetSpeed) {
        unit.currentSpeed = Math.min(
          targetSpeed,
          unit.currentSpeed + unit.acceleration * dt
        );
      } else if (unit.currentSpeed > targetSpeed) {
        // Use deceleration rate for slowing down (typically faster than acceleration)
        unit.currentSpeed = Math.max(
          targetSpeed,
          unit.currentSpeed - unit.deceleration * dt
        );
      }

      // Calculate velocity
      let finalVx = 0;
      let finalVy = 0;

      if (USE_RECAST_CROWD && this.crowdAgents.has(entity.id) && !unit.isFlying) {
        // CROWD FIX: Targets and positions are already synced in prepareCrowdAgents()
        // and crowd was updated before this loop. Just read the computed velocity.
        const state = this.recast.getAgentState(entity.id);
        if (state) {
          finalVx = state.vx;
          finalVy = state.vy;

          // CROWD FIX: If velocity is very small but we should be moving,
          // fall back to direct movement (handles edge cases like first frame after agent add)
          const velMagSq = finalVx * finalVx + finalVy * finalVy;
          const minVelSq = 0.01 * 0.01;
          if (velMagSq < minVelSq && distance > this.arrivalThreshold) {
            // Crowd returned near-zero velocity - use direct movement
            if (distance > 0.01) {
              finalVx = (dx / distance) * unit.maxSpeed;
              finalVy = (dy / distance) * unit.maxSpeed;
            }
          }

          // SC2-style: add extra separation near arrival for natural spreading
          // Crowd handles basic separation, but we boost it near destination
          const distToFinalTarget = unit.targetX !== null && unit.targetY !== null
            ? Math.sqrt(
                (unit.targetX - transform.x) * (unit.targetX - transform.x) +
                (unit.targetY - transform.y) * (unit.targetY - transform.y)
              )
            : distance;

          if (distToFinalTarget < ARRIVAL_SPREAD_RADIUS) {
            this.calculateSeparationForce(entity.id, transform, unit, tempSeparation, distToFinalTarget);
            // Add arrival spreading force
            finalVx += tempSeparation.x * ARRIVAL_SPREAD_STRENGTH;
            finalVy += tempSeparation.y * ARRIVAL_SPREAD_STRENGTH;
          }

          // Add cohesion and alignment for group movement
          if (unit.state === 'moving' || unit.state === 'attackmoving' || unit.state === 'patrolling') {
            this.calculateCohesionForce(entity.id, transform, unit, tempCohesion);
            this.calculateAlignmentForce(entity.id, transform, unit, velocity, tempAlignment);
            finalVx += tempCohesion.x;
            finalVy += tempCohesion.y;
            finalVx += tempAlignment.x;
            finalVy += tempAlignment.y;
          }
        } else {
          // Agent not in crowd or state unavailable - fallback to direct movement
          if (distance > 0.01) {
            finalVx = (dx / distance) * unit.currentSpeed;
            finalVy = (dy / distance) * unit.currentSpeed;
          }
        }
      } else {
        // Direct movement for flying units or when crowd not available
        let prefVx = 0;
        let prefVy = 0;
        if (distance > 0.01) {
          prefVx = (dx / distance) * unit.currentSpeed;
          prefVy = (dy / distance) * unit.currentSpeed;
        }

        // SC2-style flocking behaviors for non-crowd units
        if (!unit.isFlying) {
          // Calculate distance to final target for arrival spreading
          const distToFinalTarget = unit.targetX !== null && unit.targetY !== null
            ? Math.sqrt(
                (unit.targetX - transform.x) * (unit.targetX - transform.x) +
                (unit.targetY - transform.y) * (unit.targetY - transform.y)
              )
            : distance;

          // Separation - state-dependent strength (stronger at arrival)
          this.calculateSeparationForce(entity.id, transform, unit, tempSeparation, distToFinalTarget);

          // Cohesion - keeps group together (weak force)
          this.calculateCohesionForce(entity.id, transform, unit, tempCohesion);

          // Alignment - matches group heading (moderate force)
          this.calculateAlignmentForce(entity.id, transform, unit, velocity, tempAlignment);

          // Blend all forces with direction to target
          let dirX = distance > 0.01 ? dx / distance : 0;
          let dirY = distance > 0.01 ? dy / distance : 0;

          // Separation is strongest force - full weight
          dirX += tempSeparation.x;
          dirY += tempSeparation.y;

          // Cohesion only while moving
          if (unit.state === 'moving' || unit.state === 'attackmoving' || unit.state === 'patrolling') {
            dirX += tempCohesion.x;
            dirY += tempCohesion.y;
            dirX += tempAlignment.x;
            dirY += tempAlignment.y;
          }

          const newMag = Math.sqrt(dirX * dirX + dirY * dirY);
          if (newMag > 0.01) {
            dirX /= newMag;
            dirY /= newMag;
          }

          finalVx = dirX * unit.currentSpeed;
          finalVy = dirY * unit.currentSpeed;
        } else {
          // Flying units - direct movement only
          finalVx = prefVx;
          finalVy = prefVy;
        }
      }

      // Building avoidance (always active) - pass current velocity for predictive avoidance
      // PERF: Pass entityId for cached building query (shared with hard collision check)
      this.calculateBuildingAvoidanceForce(entity.id, transform, unit, tempBuildingAvoid, finalVx, finalVy);
      finalVx += tempBuildingAvoid.x;
      finalVy += tempBuildingAvoid.y;

      // Apply velocity
      const speedDamping = unit.currentSpeed < unit.maxSpeed * 0.2 ? 0.5 : 1.0;
      velocity.x = finalVx * speedDamping;
      velocity.y = finalVy * speedDamping;

      // Update rotation
      const targetRotation = Math.atan2(dy, dx);
      const rotationDiff = targetRotation - transform.rotation;

      let normalizedDiff = rotationDiff;
      while (normalizedDiff > Math.PI) normalizedDiff -= Math.PI * 2;
      while (normalizedDiff < -Math.PI) normalizedDiff += Math.PI * 2;

      const turnRate = 8 * dt;
      if (Math.abs(normalizedDiff) < turnRate) {
        transform.rotation = targetRotation;
      } else {
        transform.rotation += Math.sign(normalizedDiff) * turnRate;
      }

      // Apply movement
      transform.translate(velocity.x * dt, velocity.y * dt);

      // DETERMINISM: Snap position to quantization grid to prevent floating-point divergence
      // This ensures identical positions across different platforms/browsers
      transform.x = snapValue(transform.x, QUANT_POSITION);
      transform.y = snapValue(transform.y, QUANT_POSITION);

      // Hard collision resolution
      // PERF: Uses same cached building query as avoidance force above
      if (!unit.isFlying) {
        this.resolveHardBuildingCollision(entity.id, transform, unit);
      }
    }

    const updateElapsed = performance.now() - updateStart;
    if (updateElapsed > 16) {
      debugPerformance.warn(
        `[MovementSystem] UPDATE: ${entities.length} entities took ${updateElapsed.toFixed(1)}ms`
      );
    }
  }

  private getTerrainSpeedModifier(
    x: number,
    y: number,
    isFlying: boolean
  ): number {
    if (isFlying) return 1.0;

    const cell = this.game.getTerrainAt(x, y);
    if (!cell) return 1.0;

    const feature: TerrainFeature = (cell.feature as TerrainFeature) || 'none';
    const config = TERRAIN_FEATURE_CONFIG[feature];

    if (isFlying && config.flyingIgnores) {
      return 1.0;
    }

    return config.speedModifier;
  }

  /**
   * Hard collision resolution - last resort safety net
   *
   * Immediately pushes units out of buildings if they somehow got inside.
   * Uses the same margin as building avoidance for consistency.
   * PERF: Uses cached building query from calculateBuildingAvoidanceForce
   */
  private resolveHardBuildingCollision(entityId: number, transform: Transform, unit: Unit): void {
    // PERF: Use cached query - same query already performed by calculateBuildingAvoidanceForce
    const queryRadius = BUILDING_AVOIDANCE_SOFT_MARGIN + unit.collisionRadius + 8;
    const nearbyBuildingIds = this.getCachedBuildingQuery(
      entityId,
      transform.x,
      transform.y,
      queryRadius
    );

    const isCarryingResources =
      unit.isWorker &&
      (unit.carryingMinerals > 0 || unit.carryingVespene > 0);

    for (const buildingId of nearbyBuildingIds) {
      if (unit.constructingBuildingId === buildingId) continue;

      const entity = this.world.getEntity(buildingId);
      if (!entity) continue;

      const buildingTransform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!buildingTransform || !building) continue;

      if (isCarryingResources && DROP_OFF_BUILDINGS.includes(building.buildingId)) {
        continue;
      }

      // Use consistent margin with building avoidance system
      const collisionMargin = BUILDING_AVOIDANCE_MARGIN + unit.collisionRadius;
      const halfWidth = building.width / 2 + collisionMargin;
      const halfHeight = building.height / 2 + collisionMargin;

      const dx = transform.x - buildingTransform.x;
      const dy = transform.y - buildingTransform.y;

      if (Math.abs(dx) < halfWidth && Math.abs(dy) < halfHeight) {
        // Calculate shortest escape direction
        const escapeLeft = -(halfWidth + dx);
        const escapeRight = halfWidth - dx;
        const escapeUp = -(halfHeight + dy);
        const escapeDown = halfHeight - dy;

        const escapeX =
          Math.abs(escapeLeft) < Math.abs(escapeRight) ? escapeLeft : escapeRight;
        const escapeY =
          Math.abs(escapeUp) < Math.abs(escapeDown) ? escapeUp : escapeDown;

        // Push out with extra buffer to prevent oscillation
        const pushBuffer = 0.3;
        if (Math.abs(escapeX) < Math.abs(escapeY)) {
          transform.x += escapeX + (escapeX > 0 ? pushBuffer : -pushBuffer);
        } else {
          transform.y += escapeY + (escapeY > 0 ? pushBuffer : -pushBuffer);
        }
      }
    }
  }
}

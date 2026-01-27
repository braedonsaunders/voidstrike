/**
 * FlockingBehavior - Boids-style steering behaviors for RTS unit movement
 *
 * Implements separation, cohesion, and alignment forces along with
 * physics pushing, velocity smoothing, and stuck detection.
 *
 * Key behaviors:
 * - Separation: Prevents unit overlapping, state-dependent strength
 * - Cohesion: Keeps groups together (weak force)
 * - Alignment: Matches group heading direction
 * - Physics Push: Units push through each other for natural flow
 * - Velocity Smoothing: Prevents jitter with history averaging
 * - Stuck Detection: Nudges stuck units with tangential escape
 */

import { Transform } from '../../components/Transform';
import { Unit } from '../../components/Unit';
import { Velocity } from '../../components/Velocity';
import { PooledVector2 } from '@/utils/VectorPool';
import { SpatialEntityData, SpatialUnitState, stateToEnum } from '../../core/SpatialGrid';
import { collisionConfig } from '@/data/collisionConfig';
import {
  COHESION_RADIUS,
  COHESION_STRENGTH,
  ALIGNMENT_RADIUS,
  ALIGNMENT_STRENGTH,
  VELOCITY_SMOOTHING_FACTOR,
  VELOCITY_HISTORY_FRAMES,
  DIRECTION_COMMIT_THRESHOLD,
  DIRECTION_COMMIT_STRENGTH,
  SEPARATION_THROTTLE_TICKS,
  COHESION_THROTTLE_TICKS,
  ALIGNMENT_THROTTLE_TICKS,
  PHYSICS_PUSH_THROTTLE_TICKS,
} from '@/data/movement.config';

// Velocity history entry for smoothing
interface VelocityHistoryEntry {
  vx: number;
  vy: number;
}

// Stuck detection state per unit
interface StuckState {
  framesStuck: number;
  lastX: number;
  lastY: number;
}

// Cached force result
interface CachedForce {
  x: number;
  y: number;
  tick: number;
}

/**
 * Interface for accessing entity data during flocking calculations.
 * Allows the flocking system to work with any compatible entity cache.
 */
export interface FlockingEntityCache {
  get(entityId: number): { transform: Transform; unit: Unit; velocity: Velocity } | undefined;
}

/**
 * Interface for the spatial grid used for neighbor queries.
 */
export interface FlockingSpatialGrid {
  queryRadiusWithData(
    x: number,
    y: number,
    radius: number,
    buffer: SpatialEntityData[]
  ): SpatialEntityData[];
  queryRadius(x: number, y: number, radius: number): number[];
}

/**
 * FlockingBehavior - Manages all boids-style steering behaviors
 */
export class FlockingBehavior {
  // PERF: Cached steering forces to avoid recalculating every frame
  private separationCache: Map<number, CachedForce> = new Map();
  private cohesionCache: Map<number, CachedForce> = new Map();
  private alignmentCache: Map<number, CachedForce> = new Map();
  private physicsPushCache: Map<number, CachedForce> = new Map();
  private currentTick: number = 0;

  // PERF: Batched neighbor query - query once, reuse for all steering behaviors
  private batchedNeighborCache: Map<number, { ids: number[]; tick: number }> = new Map();

  // RTS-STYLE: Velocity history for smoothing (prevents jitter)
  private velocityHistory: Map<number, VelocityHistoryEntry[]> = new Map();

  // RTS-STYLE: Stuck detection state
  private stuckState: Map<number, StuckState> = new Map();

  // PERF: Pre-allocated query result buffer for inline data
  private readonly _neighborDataBuffer: SpatialEntityData[] = [];

  constructor() {
    // Pre-allocate neighbor data buffer
    for (let i = 0; i < 128; i++) {
      this._neighborDataBuffer.push({
        id: 0, x: 0, y: 0, radius: 0,
        isFlying: false, state: SpatialUnitState.Idle, playerId: 0,
        collisionRadius: 0, isWorker: false, maxSpeed: 0,
      });
    }
  }

  /**
   * Set the current tick for cache invalidation
   */
  public setCurrentTick(tick: number): void {
    this.currentTick = tick;
  }

  /**
   * Get the neighbor data buffer for external use
   */
  public getNeighborDataBuffer(): SpatialEntityData[] {
    return this._neighborDataBuffer;
  }

  /**
   * Clean up all tracking data for a unit (call when unit dies/destroyed)
   */
  public cleanupUnit(entityId: number): void {
    this.separationCache.delete(entityId);
    this.cohesionCache.delete(entityId);
    this.alignmentCache.delete(entityId);
    this.physicsPushCache.delete(entityId);
    this.batchedNeighborCache.delete(entityId);
    this.velocityHistory.delete(entityId);
    this.stuckState.delete(entityId);
  }

  // ==================== SEPARATION STRENGTH ====================

  /**
   * Get state-dependent separation strength.
   * RTS style: weak while moving (allow clumping), strong when idle/attacking (spread out).
   * Attacking units actively spread apart while firing.
   */
  public getSeparationStrength(unit: Unit, distanceToTarget: number): number {
    // Workers gathering/building have no separation
    if (unit.state === 'gathering' || unit.state === 'building') {
      return 0;
    }

    // Near arrival: gentle spreading at destination
    if (distanceToTarget < collisionConfig.arrivalSpreadRadius && distanceToTarget > 0) {
      return collisionConfig.separationStrengthArriving;
    }

    // Attacking: minimal separation - focus on attacking, not spreading
    if (unit.state === 'attacking') {
      return collisionConfig.separationStrengthCombat;
    }

    // Moving: very weak separation, allow clumping during movement
    if (
      unit.state === 'moving' ||
      unit.state === 'attackmoving' ||
      unit.state === 'patrolling'
    ) {
      return collisionConfig.separationStrengthMoving;
    }

    // Idle: gentle spreading over time
    return collisionConfig.separationStrengthIdle;
  }

  // ==================== SEPARATION FORCE ====================

  /**
   * Calculate separation force (RTS-style soft avoidance)
   * State-dependent: weak while moving (clumping), strong when idle (spreading).
   * PERF: Results are cached and only recalculated every SEPARATION_THROTTLE_TICKS ticks
   */
  public calculateSeparationForce(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    out: PooledVector2,
    distanceToTarget: number,
    unitGrid: FlockingSpatialGrid
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
      out.x = cached.x;
      out.y = cached.y;
      return;
    }

    let forceX = 0;
    let forceY = 0;

    // PERF OPTIMIZATION: Use queryRadiusWithData to get inline entity data
    // This eliminates entity.get() lookups in the hot path
    // Query radius based on unit's collision radius and config multiplier
    const selfDesiredSpacing = selfUnit.collisionRadius * collisionConfig.separationQueryRadiusMultiplier;
    const queryRadius = selfDesiredSpacing * 2; // Query wider to catch all potential neighbors
    const nearbyData = unitGrid.queryRadiusWithData(
      selfTransform.x,
      selfTransform.y,
      queryRadius,
      this._neighborDataBuffer
    );

    for (let i = 0; i < nearbyData.length; i++) {
      const other = nearbyData[i];
      if (other.id === selfId) continue;

      // Use inline data - no entity lookups needed!
      if (other.state === SpatialUnitState.Dead) continue;
      if (selfUnit.isFlying !== other.isFlying) continue;
      if (other.state === SpatialUnitState.Gathering) continue;
      // Allow workers to clip into each other for easier mining
      if (selfUnit.isWorker && other.isWorker) continue;

      const dx = selfTransform.x - other.x;
      const dy = selfTransform.y - other.y;
      const distanceSq = dx * dx + dy * dy;

      // Separation distance is proportional to combined unit sizes
      // No fixed constant - units separate based purely on their model sizes
      const combinedRadius = selfUnit.collisionRadius + other.collisionRadius;
      const separationDist = combinedRadius * collisionConfig.separationMultiplier;
      const separationDistSq = separationDist * separationDist;

      // PERF: Use squared distance for threshold check, only sqrt when needed
      if (distanceSq < separationDistSq && distanceSq > 0.0001) {
        const distance = Math.sqrt(distanceSq);
        // Inverse square falloff - much stronger when close, still effective at range
        const normalizedDist = distance / separationDist;
        const strength = baseStrength * (1 - normalizedDist) * (1 - normalizedDist);
        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;

        forceX += normalizedDx * strength;
        forceY += normalizedDy * strength;
      }
    }

    // Cap the force magnitude to prevent jerky movement
    const maxForce = collisionConfig.separationMaxForce;
    const maxForceSq = maxForce * maxForce;
    const magnitudeSq = forceX * forceX + forceY * forceY;
    if (magnitudeSq > maxForceSq) {
      const magnitude = Math.sqrt(magnitudeSq);
      const scale = maxForce / magnitude;
      forceX *= scale;
      forceY *= scale;
    }

    // PERF: Cache the result
    this.separationCache.set(selfId, { x: forceX, y: forceY, tick: this.currentTick });

    out.x = forceX;
    out.y = forceY;
  }

  // ==================== COHESION FORCE ====================

  /**
   * Calculate cohesion force - steers toward the average position of nearby units.
   * Keeps groups together but with very weak force (RTS style).
   * PERF: Results are cached and only recalculated every COHESION_THROTTLE_TICKS ticks
   */
  public calculateCohesionForce(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    out: PooledVector2,
    unitGrid: FlockingSpatialGrid
  ): void {
    out.x = 0;
    out.y = 0;

    // No cohesion for workers or idle units
    if (selfUnit.isWorker || selfUnit.state === 'idle' || selfUnit.state === 'gathering') {
      return;
    }

    // PERF: Check cache first - reuse result if calculated recently
    const cached = this.cohesionCache.get(selfId);
    if (cached && (this.currentTick - cached.tick) < COHESION_THROTTLE_TICKS) {
      out.x = cached.x;
      out.y = cached.y;
      return;
    }

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    // PERF OPTIMIZATION: Use queryRadiusWithData for inline entity data
    const selfState = stateToEnum(selfUnit.state);
    const nearbyData = unitGrid.queryRadiusWithData(
      selfTransform.x,
      selfTransform.y,
      COHESION_RADIUS,
      this._neighborDataBuffer
    );

    for (let i = 0; i < nearbyData.length; i++) {
      const other = nearbyData[i];
      if (other.id === selfId) continue;

      // Use inline data - no entity lookups needed!
      if (other.state === SpatialUnitState.Dead) continue;
      if (selfUnit.isFlying !== other.isFlying) continue;
      // Only cohere with units in same state
      if (other.state !== selfState) continue;

      sumX += other.x;
      sumY += other.y;
      count++;
    }

    if (count === 0) {
      this.cohesionCache.set(selfId, { x: 0, y: 0, tick: this.currentTick });
      return;
    }

    // Calculate center of mass
    const centerX = sumX / count;
    const centerY = sumY / count;

    // Direction to center of mass
    const dx = centerX - selfTransform.x;
    const dy = centerY - selfTransform.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.1) {
      this.cohesionCache.set(selfId, { x: 0, y: 0, tick: this.currentTick });
      return;
    }

    // Weak cohesion force toward center
    const forceX = (dx / dist) * COHESION_STRENGTH;
    const forceY = (dy / dist) * COHESION_STRENGTH;

    // PERF: Cache the result
    this.cohesionCache.set(selfId, { x: forceX, y: forceY, tick: this.currentTick });

    out.x = forceX;
    out.y = forceY;
  }

  // ==================== ALIGNMENT FORCE ====================

  /**
   * Calculate alignment force - steers toward the average heading of nearby units.
   * Helps groups move together smoothly.
   * PERF: Results are cached and only recalculated every ALIGNMENT_THROTTLE_TICKS ticks
   */
  public calculateAlignmentForce(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    selfVelocity: Velocity,
    out: PooledVector2,
    unitGrid: FlockingSpatialGrid,
    entityCache: FlockingEntityCache
  ): void {
    out.x = 0;
    out.y = 0;

    // No alignment for workers or stationary units
    if (selfUnit.isWorker || selfUnit.state === 'idle' || selfUnit.state === 'gathering') {
      return;
    }

    // PERF: Check cache first - reuse result if calculated recently
    const cached = this.alignmentCache.get(selfId);
    if (cached && (this.currentTick - cached.tick) < ALIGNMENT_THROTTLE_TICKS) {
      out.x = cached.x;
      out.y = cached.y;
      return;
    }

    let sumVx = 0;
    let sumVy = 0;
    let count = 0;

    // PERF OPTIMIZATION: Use queryRadiusWithData for initial filtering, then get velocity from cache
    const nearbyData = unitGrid.queryRadiusWithData(
      selfTransform.x,
      selfTransform.y,
      ALIGNMENT_RADIUS,
      this._neighborDataBuffer
    );

    for (let i = 0; i < nearbyData.length; i++) {
      const other = nearbyData[i];
      if (other.id === selfId) continue;

      // Use inline data for fast filtering
      if (other.state === SpatialUnitState.Dead) continue;
      if (selfUnit.isFlying !== other.isFlying) continue;

      // Get velocity from entity cache
      const cachedEntity = entityCache.get(other.id);
      const otherVelocity = cachedEntity?.velocity;
      if (!otherVelocity) continue;

      // Only align with moving units
      const otherSpeed = otherVelocity.getMagnitude();
      if (otherSpeed < 0.1) continue;

      // Add normalized velocity
      sumVx += otherVelocity.x / otherSpeed;
      sumVy += otherVelocity.y / otherSpeed;
      count++;
    }

    if (count === 0) {
      this.alignmentCache.set(selfId, { x: 0, y: 0, tick: this.currentTick });
      return;
    }

    // Average heading
    const avgVx = sumVx / count;
    const avgVy = sumVy / count;
    const avgMag = Math.sqrt(avgVx * avgVx + avgVy * avgVy);

    if (avgMag < 0.1) {
      this.alignmentCache.set(selfId, { x: 0, y: 0, tick: this.currentTick });
      return;
    }

    // Alignment force toward average heading
    const forceX = (avgVx / avgMag) * ALIGNMENT_STRENGTH;
    const forceY = (avgVy / avgMag) * ALIGNMENT_STRENGTH;

    // PERF: Cache the result
    this.alignmentCache.set(selfId, { x: forceX, y: forceY, tick: this.currentTick });

    out.x = forceX;
    out.y = forceY;
  }

  // ==================== PHYSICS PUSH ====================

  /**
   * Calculate physics push force from nearby units.
   * SC2-style: units push each other with priority based on movement state.
   * - Moving units have priority over idle units
   * - Units don't push through others who have higher priority
   * This creates natural streaming flow through choke points.
   * PERF: Results are cached and only recalculated every PHYSICS_PUSH_THROTTLE_TICKS ticks
   */
  public calculatePhysicsPush(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    out: PooledVector2,
    unitGrid: FlockingSpatialGrid
  ): void {
    out.x = 0;
    out.y = 0;

    if (selfUnit.isFlying) return;

    // PERF: Check cache first - reuse result if calculated recently
    const cached = this.physicsPushCache.get(selfId);
    if (cached && (this.currentTick - cached.tick) < PHYSICS_PUSH_THROTTLE_TICKS) {
      out.x = cached.x;
      out.y = cached.y;
      return;
    }

    // PERF OPTIMIZATION: Use queryRadiusWithData for inline entity data
    const queryRadius = collisionConfig.physicsPushRadius + selfUnit.collisionRadius;
    const nearbyData = unitGrid.queryRadiusWithData(
      selfTransform.x,
      selfTransform.y,
      queryRadius,
      this._neighborDataBuffer
    );

    let forceX = 0;
    let forceY = 0;

    // SC2-style priority: determine if self is "heavy" (moving with purpose) or "light" (idle)
    const selfIsMoving = selfUnit.state === 'moving' || selfUnit.state === 'attackmoving' ||
                         selfUnit.state === 'patrolling' || selfUnit.state === 'gathering' ||
                         selfUnit.state === 'building';

    for (let i = 0; i < nearbyData.length; i++) {
      const other = nearbyData[i];
      if (other.id === selfId) continue;

      // Use inline data - no entity lookups needed!
      if (other.state === SpatialUnitState.Dead) continue;
      if (other.isFlying) continue; // Don't push flying units
      // Allow workers to pass through each other for easier mining
      if (selfUnit.isWorker && other.isWorker) continue;

      const dx = selfTransform.x - other.x;
      const dy = selfTransform.y - other.y;
      const distSq = dx * dx + dy * dy;
      const minDist = selfUnit.collisionRadius + other.collisionRadius;
      const pushDist = minDist + collisionConfig.physicsPushRadius;

      if (distSq < pushDist * pushDist && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);

        // Normalize direction (away from other unit)
        const nx = dx / dist;
        const ny = dy / dist;

        // SC2-style priority: moving units push idle units more than vice versa
        // Idle units yield to moving units by receiving stronger push
        const otherIsMoving = other.state === SpatialUnitState.Moving ||
                              other.state === SpatialUnitState.AttackMoving ||
                              other.state === SpatialUnitState.Gathering;

        // Priority multiplier: if I'm idle and they're moving, I get pushed more (yield)
        // If I'm moving and they're idle, I push them but they don't push me much
        let priorityMultiplier = 1.0;
        if (!selfIsMoving && otherIsMoving) {
          // I'm idle, they're moving - I yield (get pushed more)
          priorityMultiplier = 1.5;
        } else if (selfIsMoving && !otherIsMoving) {
          // I'm moving, they're idle - push through them (they should yield, not me)
          priorityMultiplier = 0.3;
        }
        // If both moving or both idle: equal push (priorityMultiplier = 1.0)

        // Calculate push strength based on distance
        let pushStrength: number;
        if (dist < minDist) {
          // Overlapping - gentle push to resolve
          pushStrength = collisionConfig.physicsOverlapPush * (1 - dist / minDist);
        } else {
          // Normal push with falloff
          const t = (dist - minDist) / collisionConfig.physicsPushRadius;
          pushStrength = collisionConfig.physicsPushStrength * Math.pow(1 - t, collisionConfig.physicsPushFalloff);
        }

        // Apply priority multiplier
        pushStrength *= priorityMultiplier;

        forceX += nx * pushStrength;
        forceY += ny * pushStrength;
      }
    }

    // PERF: Cache the result
    this.physicsPushCache.set(selfId, { x: forceX, y: forceY, tick: this.currentTick });

    out.x = forceX;
    out.y = forceY;
  }

  // ==================== VELOCITY SMOOTHING ====================

  /**
   * Apply velocity smoothing to prevent jitter.
   * Blends current velocity with history using exponential moving average.
   */
  public smoothVelocity(
    entityId: number,
    vx: number,
    vy: number,
    prevVx: number,
    prevVy: number
  ): { vx: number; vy: number } {
    // Get or create history
    let history = this.velocityHistory.get(entityId);
    if (!history) {
      history = [];
      this.velocityHistory.set(entityId, history);
    }

    // Add current velocity to history
    history.push({ vx, vy });
    if (history.length > VELOCITY_HISTORY_FRAMES) {
      history.shift();
    }

    // Calculate average from history
    let avgVx = 0;
    let avgVy = 0;
    for (const entry of history) {
      avgVx += entry.vx;
      avgVy += entry.vy;
    }
    avgVx /= history.length;
    avgVy /= history.length;

    // Blend with current using smoothing factor
    let smoothedVx = vx * VELOCITY_SMOOTHING_FACTOR + avgVx * (1 - VELOCITY_SMOOTHING_FACTOR);
    let smoothedVy = vy * VELOCITY_SMOOTHING_FACTOR + avgVy * (1 - VELOCITY_SMOOTHING_FACTOR);

    // Direction commitment: resist sudden direction changes
    const prevMag = Math.sqrt(prevVx * prevVx + prevVy * prevVy);
    const currMag = Math.sqrt(smoothedVx * smoothedVx + smoothedVy * smoothedVy);

    if (prevMag > 0.1 && currMag > 0.1) {
      // Normalize directions
      const prevDirX = prevVx / prevMag;
      const prevDirY = prevVy / prevMag;
      const currDirX = smoothedVx / currMag;
      const currDirY = smoothedVy / currMag;

      // Calculate dot product (1 = same direction, -1 = opposite)
      const dot = prevDirX * currDirX + prevDirY * currDirY;

      // If direction change is significant, blend toward previous direction
      if (dot < DIRECTION_COMMIT_THRESHOLD) {
        const blendFactor = DIRECTION_COMMIT_STRENGTH * (1 - dot) / 2;
        smoothedVx = smoothedVx * (1 - blendFactor) + prevVx * blendFactor;
        smoothedVy = smoothedVy * (1 - blendFactor) + prevVy * blendFactor;
      }
    }

    return { vx: smoothedVx, vy: smoothedVy };
  }

  // ==================== STUCK DETECTION ====================

  /**
   * Detect if a unit is stuck and apply random nudge if needed.
   * Returns nudge force to apply (or zero if not stuck).
   *
   * RTS-style: Only applies to units actively trying to reach a distant target.
   * Units at or near their destination should NOT receive stuck nudges.
   */
  public handleStuckDetection(
    entityId: number,
    transform: Transform,
    unit: Unit,
    currentVelMag: number,
    distanceToTarget: number,
    out: PooledVector2
  ): void {
    out.x = 0;
    out.y = 0;

    // Don't nudge units that are very close to their target
    if (distanceToTarget < collisionConfig.stuckMinDistanceToTarget) {
      const state = this.stuckState.get(entityId);
      if (state) {
        state.framesStuck = 0;
      }
      return;
    }

    // Get or create stuck state
    let state = this.stuckState.get(entityId);
    if (!state) {
      state = { framesStuck: 0, lastX: transform.x, lastY: transform.y };
      this.stuckState.set(entityId, state);
    }

    // Check if unit has moved significantly
    const movedX = Math.abs(transform.x - state.lastX);
    const movedY = Math.abs(transform.y - state.lastY);
    const moved = movedX + movedY;

    // Update last position
    state.lastX = transform.x;
    state.lastY = transform.y;

    // Determine if stuck - must be low velocity AND haven't moved
    const isStuck = currentVelMag < collisionConfig.stuckVelocityThreshold && moved < 0.03;

    if (isStuck) {
      state.framesStuck++;

      if (state.framesStuck >= collisionConfig.stuckDetectionFrames) {
        const dx = unit.targetX !== null ? unit.targetX - transform.x : 0;
        const dy = unit.targetY !== null ? unit.targetY - transform.y : 0;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0.1) {
          // Use deterministic random to pick tangential direction
          const seed = entityId * 12345 + this.currentTick;
          const tangentSign = (seed % 2 === 0) ? 1 : -1;

          // Perpendicular (tangential) direction to target
          const perpX = -dy / dist;
          const perpY = dx / dist;

          // Blend between tangential escape and toward-target based on tangentialBias
          // High tangentialBias = more sideways movement to escape obstacles
          const bias = collisionConfig.stuckTangentialBias;
          const towardX = dx / dist;
          const towardY = dy / dist;

          // Nudge direction: blend tangential and toward-target
          const nudgeX = perpX * tangentSign * bias + towardX * (1 - bias);
          const nudgeY = perpY * tangentSign * bias + towardY * (1 - bias);

          out.x = nudgeX * collisionConfig.stuckNudgeStrength;
          out.y = nudgeY * collisionConfig.stuckNudgeStrength;
        }

        // Reset counter after nudge
        state.framesStuck = 0;
      }
    } else {
      // Reset if moving
      state.framesStuck = 0;
    }
  }

  // ==================== NEIGHBOR BATCHING ====================

  /**
   * PERF: Pre-compute batched neighbors for all steering behaviors.
   * Query once with the largest radius, then filter by distance in each force calculation.
   * This reduces 4 spatial queries to 1 per unit in the JS fallback path.
   */
  public preBatchNeighbors(
    entityId: number,
    transform: Transform,
    unit: Unit,
    unitGrid: FlockingSpatialGrid
  ): void {
    // Compute the maximum radius needed across all steering behaviors
    const maxRadius = Math.max(
      unit.collisionRadius * collisionConfig.separationQueryRadiusMultiplier,
      COHESION_RADIUS,
      ALIGNMENT_RADIUS,
      collisionConfig.physicsPushRadius + unit.collisionRadius
    );

    // Query once and cache
    const nearbyIds = unitGrid.queryRadius(
      transform.x,
      transform.y,
      maxRadius
    );

    // Store in cache (copy the array to avoid reference issues)
    const cached = this.batchedNeighborCache.get(entityId);
    if (cached) {
      cached.ids.length = 0;
      for (const id of nearbyIds) {
        cached.ids.push(id);
      }
      cached.tick = this.currentTick;
    } else {
      this.batchedNeighborCache.set(entityId, {
        ids: [...nearbyIds],
        tick: this.currentTick
      });
    }
  }
}

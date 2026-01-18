/**
 * Movement System - SC2-Style Clumping & Formations
 *
 * Handles unit movement using Recast's DetourCrowd for collision avoidance.
 * Implements SC2-style "magic box" detection for clump vs formation behavior:
 * - Target OUTSIDE selection bounding box → units converge to same point (clump)
 * - Target INSIDE bounding box → units preserve relative spacing (formation nudge)
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
import { Selectable } from '../components/Selectable';
import { Game } from '../core/Game';
import { PooledVector2 } from '@/utils/VectorPool';
import { TERRAIN_FEATURE_CONFIG, TerrainFeature } from '@/data/maps';
import { getRecastNavigation, RecastNavigation } from '../pathfinding/RecastNavigation';
import { debugPerformance, debugPathfinding, debugResources } from '@/utils/debugLogger';
import { snapValue, QUANT_POSITION } from '@/utils/FixedPoint';
import {
  generateFormationPositions,
  sortUnitsForFormation,
  getFormation,
  FORMATION_CONFIG,
} from '@/data/formations/formations';
import AssetManager from '@/assets/AssetManager';
import { WasmBoids, getWasmBoids } from '../wasm/WasmBoids';

// ==================== SC2-STYLE STEERING CONSTANTS ====================

// Separation - prevents overlapping (strongest force)
const SEPARATION_RADIUS = 1.0;
const SEPARATION_STRENGTH_MOVING = 1.2;      // Weak while moving - allow clumping
const SEPARATION_STRENGTH_IDLE = 1.5;        // Moderate when idle (reduced from 2.5) - prevents jiggling
const SEPARATION_STRENGTH_ARRIVING = 2.0;    // Strong at arrival (reduced from 3.0) - natural spreading
const MAX_AVOIDANCE_FORCE = 1.5;
const MAX_AVOIDANCE_FORCE_SQ = MAX_AVOIDANCE_FORCE * MAX_AVOIDANCE_FORCE;

// Cohesion - keeps group together (weak force)
const COHESION_RADIUS = 8.0;
const COHESION_STRENGTH = 0.1;               // Very weak - just prevents extreme spreading

// Alignment - matches group heading (moderate force)
const ALIGNMENT_RADIUS = 4.0;
const ALIGNMENT_STRENGTH = 0.3;

// Arrival spreading - units spread out when reaching destination
// SC2-style: Gentle spreading to prevent bunching without causing oscillation
const ARRIVAL_SPREAD_RADIUS = 2.0;           // Distance from target where spreading kicks in (reduced from 2.5)
const ARRIVAL_SPREAD_STRENGTH = 1.0;         // Additional separation at arrival (reduced from 2.0)

// Building avoidance - runtime steering to handle edge cases
// SC2-STYLE: Reduced margins - trust the navmesh for primary clearance
const BUILDING_AVOIDANCE_STRENGTH = 15.0; // Reduced from 25 - navmesh handles most avoidance
const BUILDING_AVOIDANCE_MARGIN = 0.1;    // Minimal margin - navmesh walkableRadius handles clearance
const BUILDING_AVOIDANCE_SOFT_MARGIN = 0.3; // Reduced from 0.8 - less conservative
const BUILDING_PREDICTION_LOOKAHEAD = 0.3;  // Reduced from 0.5 - react closer to buildings

// Path request cooldown in ticks (10 ticks @ 20 ticks/sec = 500ms)
const PATH_REQUEST_COOLDOWN_TICKS = 10;

// Use Recast crowd for pathfinding direction (obstacle avoidance disabled in crowd config)
const USE_RECAST_CROWD = true;

// ==================== SC2-STYLE VELOCITY SMOOTHING ====================
// Prevents jitter by blending velocity over multiple frames
// SC2-style: Stronger smoothing prevents micro-oscillations

const VELOCITY_SMOOTHING_FACTOR = 0.25;      // Blend factor: 0=full history, 1=no smoothing (reduced from 0.3)
const VELOCITY_HISTORY_FRAMES = 4;           // Number of frames to average (increased from 3)
const DIRECTION_COMMIT_THRESHOLD = 0.6;      // Dot product threshold for direction commitment (reduced from 0.7)
const DIRECTION_COMMIT_STRENGTH = 0.6;       // How strongly to resist direction changes (increased from 0.5)

// ==================== SC2-STYLE PHYSICS PUSHING ====================
// Units push each other instead of avoiding - creates natural flow
// SC2-style: Moderate push prevents stacking without causing jitter

const PHYSICS_PUSH_RADIUS = 1.2;             // Distance at which pushing starts
const PHYSICS_PUSH_STRENGTH = 6.0;           // Push force strength (reduced from 8.0)
const PHYSICS_PUSH_FALLOFF = 0.6;            // How quickly push falls off with distance (increased from 0.5)
const PHYSICS_OVERLAP_PUSH = 15.0;           // Extra strong push when overlapping (reduced from 20.0)

// ==================== STUCK DETECTION ====================
// If unit hasn't moved for N frames, apply random nudge
// SC2-style: Only trigger for units actively trying to reach a distant target

const STUCK_DETECTION_FRAMES = 20;           // Frames of near-zero movement to trigger (increased from 12)
const STUCK_VELOCITY_THRESHOLD = 0.05;       // Below this speed = considered stuck (reduced from 0.1)
const STUCK_NUDGE_STRENGTH = 1.5;            // Random nudge force when stuck (reduced from 2.0)
const STUCK_MIN_DISTANCE_TO_TARGET = 2.0;    // Only apply stuck nudge if farther than this from target

// Static temp vectors for steering behaviors
const tempSeparation: PooledVector2 = { x: 0, y: 0 };
const tempCohesion: PooledVector2 = { x: 0, y: 0 };
const tempAlignment: PooledVector2 = { x: 0, y: 0 };
const tempBuildingAvoid: PooledVector2 = { x: 0, y: 0 };
const tempPhysicsPush: PooledVector2 = { x: 0, y: 0 };
const tempStuckNudge: PooledVector2 = { x: 0, y: 0 };

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

export class MovementSystem extends System {
  public readonly name = 'MovementSystem';
  public priority = 10;

  // SC2-style: Larger arrival threshold prevents micro-oscillations at destination
  private arrivalThreshold = 0.8;
  private decelerationThreshold = 2.0;
  private lastPathRequestTime: Map<number, number> = new Map();
  private recast: RecastNavigation;

  // Track which units are registered with crowd
  private crowdAgents: Set<number> = new Set();

  // PERF: Cached separation forces to avoid recalculating every frame
  private separationCache: Map<number, { x: number; y: number; tick: number }> = new Map();
  private currentTick: number = 0;

  // SC2-STYLE: Velocity history for smoothing (prevents jitter)
  private velocityHistory: Map<number, VelocityHistoryEntry[]> = new Map();

  // SC2-STYLE: Stuck detection state
  private stuckState: Map<number, StuckState> = new Map();

  // WASM SIMD boids acceleration
  private wasmBoids: WasmBoids | null = null;
  private useWasmBoids: boolean = false;
  private wasmBoidsInitializing: boolean = false;

  // Threshold: only use WASM when we have enough units to benefit
  private static readonly WASM_UNIT_THRESHOLD = 20;

  constructor(game: Game) {
    super(game);
    this.recast = getRecastNavigation();
    this.setupEventListeners();
    this.initWasmBoids();
  }

  /**
   * Initialize WASM SIMD boids module asynchronously
   * Falls back to JS if WASM/SIMD unavailable
   */
  private async initWasmBoids(): Promise<void> {
    if (this.wasmBoidsInitializing) return;
    this.wasmBoidsInitializing = true;

    try {
      this.wasmBoids = await getWasmBoids(500);
      this.useWasmBoids = this.wasmBoids.isAvailable();

      if (this.useWasmBoids) {
        // Configure WASM with game parameters
        this.wasmBoids.setSeparationParams(
          SEPARATION_RADIUS,
          SEPARATION_STRENGTH_IDLE,
          MAX_AVOIDANCE_FORCE
        );
        this.wasmBoids.setCohesionParams(COHESION_RADIUS, COHESION_STRENGTH);
        this.wasmBoids.setAlignmentParams(ALIGNMENT_RADIUS, ALIGNMENT_STRENGTH);

        console.log('[MovementSystem] WASM SIMD boids enabled');
      } else {
        console.log('[MovementSystem] WASM SIMD unavailable, using JS fallback');
      }
    } catch (error) {
      console.warn('[MovementSystem] WASM boids init failed:', error);
      this.useWasmBoids = false;
    }

    this.wasmBoidsInitializing = false;
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:move', this.handleMoveCommand.bind(this));
    this.game.eventBus.on('command:attackMove', this.handleAttackMoveCommand.bind(this));
    this.game.eventBus.on('command:patrol', this.handlePatrolCommand.bind(this));
    this.game.eventBus.on('command:formation', this.handleFormationCommand.bind(this));

    // Clean up tracking data when units die to prevent memory leaks
    this.game.eventBus.on('unit:died', (data: { entityId: number }) => {
      this.lastPathRequestTime.delete(data.entityId);
      this.separationCache.delete(data.entityId);
      this.velocityHistory.delete(data.entityId);
      this.stuckState.delete(data.entityId);
    });
    this.game.eventBus.on('unit:destroyed', (data: { entityId: number }) => {
      this.lastPathRequestTime.delete(data.entityId);
      this.separationCache.delete(data.entityId);
      this.velocityHistory.delete(data.entityId);
      this.stuckState.delete(data.entityId);
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
   * SC2 behavior: target outside box = clump (converge), target inside = preserve spacing
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
   * - Target OUTSIDE the bounding box of selected units → CLUMP MODE
   *   All units move to the SAME target point, separation spreads them on arrival.
   * - Target INSIDE the bounding box → PRESERVE SPACING MODE
   *   Each unit maintains its relative offset from the group center.
   *
   * This creates natural SC2-like behavior where:
   * - Long moves (outside group) converge units to the target point
   * - Short moves (within group) nudge formation while maintaining spacing
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

        // Set initial rotation to face target direction
        // Note: Y is negated for Three.js coordinate system
        const transform = entity.get<Transform>('Transform');
        if (transform) {
          transform.rotation = Math.atan2(
            -(targetPosition.y - transform.y),
            targetPosition.x - transform.x
          );
        }
      }
      return;
    }

    // Multi-unit move: apply magic box logic
    const box = this.calculateBoundingBox(entityIds);
    if (!box) return;

    const isInsideBox = this.isTargetInsideMagicBox(targetPosition.x, targetPosition.y, box);

    if (isInsideBox) {
      // PRESERVE SPACING MODE: Target is within the group - maintain relative offsets
      // This is for small adjustments where the player wants to nudge formation
      this.moveUnitsWithRelativeOffsets(entityIds, targetPosition.x, targetPosition.y, box, queue);
    } else {
      // CLUMP MODE: Target is outside the group - all units converge to same point
      // Separation forces will spread them naturally on arrival (SC2 style)
      this.moveUnitsToSamePoint(entityIds, targetPosition.x, targetPosition.y, queue);
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

        // Set initial rotation to face target direction
        // Note: Y is negated for Three.js coordinate system
        const transform = entity.get<Transform>('Transform');
        if (transform) {
          transform.rotation = Math.atan2(
            -(targetY - transform.y),
            targetX - transform.x
          );
        }
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

        // Set initial rotation to face target direction
        // Note: Y is negated for Three.js coordinate system
        transform.rotation = Math.atan2(
          -(unitTargetY - transform.y),
          unitTargetX - transform.x
        );
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
      const transform = entity.get<Transform>('Transform');
      if (!unit || !transform) continue;

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
        // Set initial rotation to face target direction
        // Note: Y is negated for Three.js coordinate system
        transform.rotation = Math.atan2(
          -(pos.y - transform.y),
          pos.x - transform.x
        );
      }
    }
  }

  private handleAttackMoveCommand(data: {
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
          type: 'attackmove',
          targetX: targetPosition.x,
          targetY: targetPosition.y,
        });
      } else {
        unit.setAttackMoveTarget(targetPosition.x, targetPosition.y);
        unit.path = [];
        unit.pathIndex = 0;
        this.requestPathWithCooldown(entityId, targetPosition.x, targetPosition.y, true);
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
        // Set initial rotation to face target direction
        // Note: Y is negated for Three.js coordinate system
        transform.rotation = Math.atan2(
          -(targetPosition.y - transform.y),
          targetPosition.x - transform.x
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
    } else {
      // FIX: Log warning when agent addition fails (crowd limit exceeded)
      // This helps diagnose pathfinding issues when there are many units
      console.warn(
        `[MovementSystem] Failed to add crowd agent for entity ${entityId}. ` +
        `Crowd may be at capacity (500 agents). Current agents: ${this.crowdAgents.size}. ` +
        `Unit will use fallback pathfinding without crowd avoidance.`
      );
      // Track failures for debugging - don't spam logs, just warn once per entity
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

  // ==================== SC2-STYLE VELOCITY SMOOTHING ====================

  /**
   * Apply velocity smoothing to prevent jitter.
   * Blends current velocity with history using exponential moving average.
   */
  private smoothVelocity(
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

  // ==================== SC2-STYLE PHYSICS PUSHING ====================

  /**
   * Calculate physics push force from nearby units.
   * Units push each other instead of avoiding - creates natural flow.
   */
  private calculatePhysicsPush(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    out: PooledVector2
  ): void {
    out.x = 0;
    out.y = 0;

    if (selfUnit.isFlying) return;

    const nearbyIds = this.world.unitGrid.queryRadius(
      selfTransform.x,
      selfTransform.y,
      PHYSICS_PUSH_RADIUS + selfUnit.collisionRadius
    );

    for (const entityId of nearbyIds) {
      if (entityId === selfId) continue;

      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const otherTransform = entity.get<Transform>('Transform');
      const otherUnit = entity.get<Unit>('Unit');
      if (!otherTransform || !otherUnit) continue;

      if (otherUnit.state === 'dead') continue;
      if (otherUnit.isFlying) continue; // Don't push flying units
      // Allow workers to pass through each other for easier mining
      if (selfUnit.isWorker && otherUnit.isWorker) continue;

      const dx = selfTransform.x - otherTransform.x;
      const dy = selfTransform.y - otherTransform.y;
      const distSq = dx * dx + dy * dy;
      const minDist = selfUnit.collisionRadius + otherUnit.collisionRadius;
      const pushDist = minDist + PHYSICS_PUSH_RADIUS;

      if (distSq < pushDist * pushDist && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);

        // Normalize direction (away from other unit)
        const nx = dx / dist;
        const ny = dy / dist;

        // Calculate push strength based on distance
        let pushStrength: number;
        if (dist < minDist) {
          // Overlapping - extra strong push
          pushStrength = PHYSICS_OVERLAP_PUSH * (1 - dist / minDist);
        } else {
          // Normal push with falloff
          const t = (dist - minDist) / PHYSICS_PUSH_RADIUS;
          pushStrength = PHYSICS_PUSH_STRENGTH * Math.pow(1 - t, PHYSICS_PUSH_FALLOFF);
        }

        out.x += nx * pushStrength;
        out.y += ny * pushStrength;
      }
    }
  }

  // ==================== STUCK DETECTION ====================

  /**
   * Detect if a unit is stuck and apply random nudge if needed.
   * Returns nudge force to apply (or zero if not stuck).
   *
   * SC2-style: Only applies to units actively trying to reach a distant target.
   * Units at or near their destination should NOT receive stuck nudges.
   */
  private handleStuckDetection(
    entityId: number,
    transform: Transform,
    unit: Unit,
    currentVelMag: number,
    distanceToTarget: number,
    out: PooledVector2
  ): void {
    out.x = 0;
    out.y = 0;

    // SC2-style: Don't nudge units that are close to their target
    // This is the primary fix for the jiggling issue - units at destination shouldn't be nudged
    if (distanceToTarget < STUCK_MIN_DISTANCE_TO_TARGET) {
      // Clear stuck state when near target
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
    const isStuck = currentVelMag < STUCK_VELOCITY_THRESHOLD && moved < 0.03;

    if (isStuck) {
      state.framesStuck++;

      if (state.framesStuck >= STUCK_DETECTION_FRAMES) {
        // Apply nudge TOWARD target instead of random direction
        // This helps units escape stuck positions while still moving toward goal
        const dx = unit.targetX !== null ? unit.targetX - transform.x : 0;
        const dy = unit.targetY !== null ? unit.targetY - transform.y : 0;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0.1) {
          // Nudge toward target with slight perpendicular offset
          const seed = entityId * 12345 + this.currentTick;
          const perpOffset = ((seed % 100) / 100 - 0.5) * 0.5; // -0.25 to 0.25

          // Perpendicular direction
          const perpX = -dy / dist;
          const perpY = dx / dist;

          out.x = (dx / dist + perpX * perpOffset) * STUCK_NUDGE_STRENGTH;
          out.y = (dy / dist + perpY * perpOffset) * STUCK_NUDGE_STRENGTH;
        }

        // Reset counter after nudge
        state.framesStuck = 0;
      }
    } else {
      // Reset if moving
      state.framesStuck = 0;
    }
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

    // WASM SIMD boids: batch process when we have enough units
    const useWasmThisFrame = this.useWasmBoids &&
      this.wasmBoids !== null &&
      entities.length >= MovementSystem.WASM_UNIT_THRESHOLD;

    if (useWasmThisFrame) {
      // Sync all entities to WASM buffers and compute forces in batch
      this.wasmBoids!.syncEntities(entities, this.world.unitGrid);
      this.wasmBoids!.computeForces();
    }

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      const velocity = entity.get<Velocity>('Velocity');
      if (!transform || !unit || !velocity) continue;

      // Store previous rotation for render interpolation
      transform.prevRotation = transform.rotation;

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
        // SC2-style: Only push units that are SIGNIFICANTLY overlapping to prevent jiggling
        if (unit.state === 'idle' && !unit.isFlying) {
          this.calculateSeparationForce(entity.id, transform, unit, tempSeparation, Infinity);
          const sepMagSq = tempSeparation.x * tempSeparation.x + tempSeparation.y * tempSeparation.y;

          // SC2-style: Higher threshold prevents minor separation adjustments that cause jiggling
          // Only move when units are actually overlapping (force > 0.5), not just close
          const IDLE_SEPARATION_THRESHOLD = 0.25; // Much higher than 0.001 to prevent micro-adjustments

          if (sepMagSq > IDLE_SEPARATION_THRESHOLD) {
            // SC2-style: Slower, gentler push for idle units (0.3x max speed instead of 0.5x)
            const sepMag = Math.sqrt(sepMagSq);
            const idleRepelSpeed = Math.min(unit.maxSpeed * 0.3, sepMag * SEPARATION_STRENGTH_IDLE * 0.5);
            velocity.x = (tempSeparation.x / sepMag) * idleRepelSpeed;
            velocity.y = (tempSeparation.y / sepMag) * idleRepelSpeed;

            // Update rotation to face movement direction
            // Note: Y is negated for Three.js coordinate system
            const targetRotation = Math.atan2(-velocity.y, velocity.x);
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

      // Debug: log gathering worker targets periodically
      if (unit.state === 'gathering' && this.currentTick % 100 === 0 && entity.id % 5 === 0) {
        const selectable = entity.get<Selectable>('Selectable');
        debugResources.log(`[MovementSystem] ${selectable?.playerId} gathering worker ${entity.id}: targetX=${unit.targetX?.toFixed(1)}, targetY=${unit.targetY?.toFixed(1)}, pos=(${transform.x.toFixed(1)}, ${transform.y.toFixed(1)}), speed=${unit.currentSpeed.toFixed(2)}, maxSpeed=${unit.maxSpeed}`);
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
          const targetUnit = targetEntity.get<Unit>('Unit');
          if (targetTransform) {
            let effectiveDistance: number;
            let attackTargetX = targetTransform.x;
            let attackTargetY = targetTransform.y;
            let needsToEscape = false;

            // Use visual radius for distance calculations (matches how big unit looks)
            const attackerRadius = AssetManager.getCachedVisualRadius(unit.unitId, unit.collisionRadius);

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
              // Edge-to-edge distance (subtract attacker's visual radius)
              effectiveDistance = Math.max(0, Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy) - attackerRadius);

              const standOffDistance = unit.attackRange * 0.8;
              const minSafeDistance = attackerRadius + 0.5;

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
              // Edge-to-edge distance for units using visual radii
              const centerDistance = transform.distanceTo(targetTransform);
              const targetRadius = targetUnit ? AssetManager.getCachedVisualRadius(targetUnit.unitId, targetUnit.collisionRadius) : 0.5;
              effectiveDistance = Math.max(0, centerDistance - attackerRadius - targetRadius);
            }

            if (effectiveDistance > unit.attackRange || needsToEscape) {
              targetX = attackTargetX;
              targetY = attackTargetY;
            } else {
              // Note: Y is negated for Three.js coordinate system
              transform.rotation = Math.atan2(
                -(targetTransform.y - transform.y),
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
            // FIX: Only clear target if NOT carrying resources
            // Workers carrying resources need to reach the base for drop-off
            // ResourceSystem will handle setting new targets after delivery
            const isCarryingResources = unit.carryingMinerals > 0 || unit.carryingVespene > 0;
            if (!isCarryingResources) {
              // At mineral/vespene - clear target, let ResourceSystem handle mining
              unit.targetX = null;
              unit.targetY = null;
              velocity.zero();
              continue;
            }
            // Carrying resources - don't clear target, let ResourceSystem handle delivery
            // Just zero velocity so we don't overshoot, but keep target for distance checks
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
            // RAMP DEBUG: Log when crowd returns zero velocity
            if (distance > 2 && unit.path.length > 0) {
              console.warn(
                `[MovementSystem] RAMP DEBUG: Crowd returned zero velocity for entity ${entity.id}. ` +
                `Pos: (${transform.x.toFixed(1)}, ${transform.y.toFixed(1)}), ` +
                `Target: (${targetX.toFixed(1)}, ${targetY.toFixed(1)}), ` +
                `Distance: ${distance.toFixed(1)}, Path: ${unit.pathIndex}/${unit.path.length}`
              );
            }
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
            // WASM SIMD: Use pre-computed separation when available
            if (useWasmThisFrame) {
              const wasmForces = this.wasmBoids!.getForces(entity.id);
              if (wasmForces) {
                tempSeparation.x = wasmForces.separationX;
                tempSeparation.y = wasmForces.separationY;
              } else {
                this.calculateSeparationForce(entity.id, transform, unit, tempSeparation, distToFinalTarget);
              }
            } else {
              this.calculateSeparationForce(entity.id, transform, unit, tempSeparation, distToFinalTarget);
            }
            // Add arrival spreading force
            finalVx += tempSeparation.x * ARRIVAL_SPREAD_STRENGTH;
            finalVy += tempSeparation.y * ARRIVAL_SPREAD_STRENGTH;
          }

          // Add cohesion and alignment for group movement
          if (unit.state === 'moving' || unit.state === 'attackmoving' || unit.state === 'patrolling') {
            // WASM SIMD: Use pre-computed forces when available
            if (useWasmThisFrame) {
              const wasmForces = this.wasmBoids!.getForces(entity.id);
              if (wasmForces) {
                tempCohesion.x = wasmForces.cohesionX;
                tempCohesion.y = wasmForces.cohesionY;
                tempAlignment.x = wasmForces.alignmentX;
                tempAlignment.y = wasmForces.alignmentY;
              } else {
                this.calculateCohesionForce(entity.id, transform, unit, tempCohesion);
                this.calculateAlignmentForce(entity.id, transform, unit, velocity, tempAlignment);
              }
            } else {
              this.calculateCohesionForce(entity.id, transform, unit, tempCohesion);
              this.calculateAlignmentForce(entity.id, transform, unit, velocity, tempAlignment);
            }
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

          // WASM SIMD: Use pre-computed forces when available
          if (useWasmThisFrame) {
            const wasmForces = this.wasmBoids!.getForces(entity.id);
            if (wasmForces) {
              tempSeparation.x = wasmForces.separationX;
              tempSeparation.y = wasmForces.separationY;
              tempCohesion.x = wasmForces.cohesionX;
              tempCohesion.y = wasmForces.cohesionY;
              tempAlignment.x = wasmForces.alignmentX;
              tempAlignment.y = wasmForces.alignmentY;
            } else {
              // Entity not in WASM buffer, fallback to JS
              this.calculateSeparationForce(entity.id, transform, unit, tempSeparation, distToFinalTarget);
              this.calculateCohesionForce(entity.id, transform, unit, tempCohesion);
              this.calculateAlignmentForce(entity.id, transform, unit, velocity, tempAlignment);
            }
          } else {
            // JS fallback: calculate forces directly
            this.calculateSeparationForce(entity.id, transform, unit, tempSeparation, distToFinalTarget);
            this.calculateCohesionForce(entity.id, transform, unit, tempCohesion);
            this.calculateAlignmentForce(entity.id, transform, unit, velocity, tempAlignment);
          }

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

      // SC2-STYLE: Physics pushing between units (replaces RVO collision avoidance)
      if (!unit.isFlying) {
        this.calculatePhysicsPush(entity.id, transform, unit, tempPhysicsPush);
        finalVx += tempPhysicsPush.x;
        finalVy += tempPhysicsPush.y;
      }

      // SC2-STYLE: Velocity smoothing to prevent jitter
      const smoothed = this.smoothVelocity(
        entity.id,
        finalVx,
        finalVy,
        velocity.x,
        velocity.y
      );
      finalVx = smoothed.vx;
      finalVy = smoothed.vy;

      // SC2-STYLE: Stuck detection and nudge
      // Only apply to units far from their target to prevent destination jiggling
      const currentVelMag = Math.sqrt(finalVx * finalVx + finalVy * finalVy);
      if (distance > this.arrivalThreshold) {
        this.handleStuckDetection(entity.id, transform, unit, currentVelMag, distance, tempStuckNudge);
        finalVx += tempStuckNudge.x;
        finalVy += tempStuckNudge.y;
      }

      // Apply velocity (removed speed damping - physics push handles this better)
      velocity.x = finalVx;
      velocity.y = finalVy;

      // Update rotation
      // Note: Y is negated because Three.js rotation.y goes CCW (from +X toward +Z),
      // but game Y maps to Three.js Z, so we need to flip the Y component
      const targetRotation = Math.atan2(-(dy), dx);
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

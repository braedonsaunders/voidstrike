/**
 * FormationMovement - RTS-style group movement and formations
 *
 * Implements "magic box" detection for intelligent group movement:
 * - Target OUTSIDE selection bounding box → units converge to same point (clump)
 * - Target INSIDE bounding box → units preserve relative spacing (formation nudge)
 *
 * Also supports explicit formation commands using data-driven formations.
 */

import { Transform } from '../../components/Transform';
import { Unit } from '../../components/Unit';
import { World } from '../../ecs/World';
import { EventBus } from '../../core/EventBus';
import type { Game } from '../../core/Game';
import {
  generateFormationPositions,
  sortUnitsForFormation,
  getFormation,
} from '@/data/formations/formations';
import { MAGIC_BOX_MARGIN, FORMATION_BUFFER_SIZE } from '@/data/movement.config';
import { RecastNavigation, getRecastNavigation, MovementDomain } from '../../pathfinding/RecastNavigation';

// PERF: Pooled formation position buffer to avoid allocation per move command
const formationBuffer: Array<{ x: number; y: number }> = [];
for (let i = 0; i < FORMATION_BUFFER_SIZE; i++) {
  formationBuffer.push({ x: 0, y: 0 });
}

/**
 * Bounding box for a group of units
 */
interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

/**
 * Interface for path request callback
 */
export type PathRequestCallback = (
  entityId: number,
  targetX: number,
  targetY: number,
  force?: boolean
) => boolean;

/**
 * FormationMovement - Handles group movement and formation commands
 */
export class FormationMovement {
  private world: World;
  private eventBus: EventBus;
  private requestPathWithCooldown: PathRequestCallback;
  private recast: RecastNavigation;
  private game: Game;

  constructor(
    world: World,
    eventBus: EventBus,
    requestPathWithCooldown: PathRequestCallback,
    game: Game
  ) {
    this.world = world;
    this.eventBus = eventBus;
    this.requestPathWithCooldown = requestPathWithCooldown;
    this.recast = getRecastNavigation();
    this.game = game;
  }

  /**
   * Fast O(1) check if a position is on navigable water terrain for naval units.
   * Uses terrain grid lookup instead of expensive navmesh queries.
   *
   * Only water_deep is valid for naval units. water_shallow represents beaches
   * and shallow water where ground units can wade, but boats cannot navigate.
   */
  private isNavalWaterTerrain(x: number, y: number): boolean {
    const cell = this.game.getTerrainAt(x, y);
    if (!cell) return false;
    const feature = cell.feature || 'none';
    // Only deep water is valid for naval units - shallow water is for wading ground units
    return feature === 'water_deep';
  }

  /**
   * Validate and adjust target position for unit's movement domain.
   * Prevents naval units from targeting land positions and vice versa.
   * Returns adjusted target position, or null if no valid position can be found.
   * PERF: Uses O(1) terrain lookup for naval units instead of expensive navmesh queries.
   */
  private validateTargetForDomain(
    targetX: number,
    targetY: number,
    domain: MovementDomain
  ): { x: number; y: number } | null {
    // Air units can go anywhere
    if (domain === 'air') {
      return { x: targetX, y: targetY };
    }

    // Naval units: use fast O(1) terrain lookup
    if (domain === 'water') {
      const isWater = this.isNavalWaterTerrain(targetX, targetY);
      if (isWater) {
        return { x: targetX, y: targetY };
      }
      // Find nearest water point (only when target is invalid)
      return this.recast.findNearestPointForDomain(targetX, targetY, 'water');
    }

    // Ground/amphibious units: use navmesh validation
    const isValidTarget = this.recast.isWalkableForDomain(targetX, targetY, domain);
    if (isValidTarget) {
      return { x: targetX, y: targetY };
    }

    // Target is invalid - find nearest valid point for this domain
    return this.recast.findNearestPointForDomain(targetX, targetY, domain);
  }

  /**
   * Update world reference (needed after world re-initialization)
   */
  public setWorld(world: World): void {
    this.world = world;
  }

  /**
   * Update path request callback
   */
  public setPathRequestCallback(callback: PathRequestCallback): void {
    this.requestPathWithCooldown = callback;
  }

  // ==================== MAGIC BOX DETECTION ====================

  /**
   * Calculate the bounding box of a set of units.
   * Used for RTS-style "magic box" detection.
   */
  public calculateBoundingBox(entityIds: number[]): BoundingBox | null {
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
   * RTS behavior: target outside box = clump (converge), target inside = preserve spacing
   */
  public isTargetInsideMagicBox(
    targetX: number,
    targetY: number,
    box: BoundingBox
  ): boolean {
    // Add a small margin to prevent edge-case toggling
    const margin = MAGIC_BOX_MARGIN;
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
  public calculateGroupFacing(
    centerX: number,
    centerY: number,
    targetX: number,
    targetY: number
  ): number {
    const dx = targetX - centerX;
    const dy = targetY - centerY;
    return Math.atan2(dy, dx);
  }

  // ==================== MOVE COMMAND HANDLING ====================

  /**
   * Handle move command with RTS-style magic box detection.
   *
   * Magic Box Behavior:
   * - Target OUTSIDE the bounding box of selected units → CLUMP MODE
   *   All units move to the SAME target point, separation spreads them on arrival.
   * - Target INSIDE the bounding box → PRESERVE SPACING MODE
   *   Each unit maintains its relative offset from the group center.
   *
   * This creates natural RTS-like behavior where:
   * - Long moves (outside group) converge units to the target point
   * - Short moves (within group) nudge formation while maintaining spacing
   */
  public handleMoveCommand(data: {
    entityIds: number[];
    targetPosition: { x: number; y: number };
    queue?: boolean;
  }): void {
    console.log('[FormationMovement] handleMoveCommand received:', {
      entityIds: data.entityIds,
      targetPosition: data.targetPosition,
      queue: data.queue,
    });
    const { entityIds, targetPosition, queue } = data;

    // Single unit always goes directly to target
    if (entityIds.length === 1) {
      const entityId = entityIds[0];
      const entity = this.world.getEntity(entityId);
      if (!entity) return;

      const unit = entity.get<Unit>('Unit');
      if (!unit) return;

      // Validate target for unit's movement domain (prevents boats on land, etc.)
      const validatedTarget = this.validateTargetForDomain(
        targetPosition.x,
        targetPosition.y,
        unit.movementDomain
      );

      // If no valid target can be found, abort the move command
      if (!validatedTarget) {
        return;
      }

      if (queue) {
        unit.queueCommand({
          type: 'move',
          targetX: validatedTarget.x,
          targetY: validatedTarget.y,
        });
      } else {
        if (unit.state === 'building' && unit.constructingBuildingId !== null) {
          unit.cancelBuilding();
        }
        unit.setMoveTarget(validatedTarget.x, validatedTarget.y);
        unit.path = [];
        unit.pathIndex = 0;
        this.requestPathWithCooldown(entityId, validatedTarget.x, validatedTarget.y, true);

        // Set initial rotation to face target direction
        // Note: Y is negated for Three.js coordinate system
        const transform = entity.get<Transform>('Transform');
        if (transform) {
          transform.rotation = Math.atan2(
            -(validatedTarget.y - transform.y),
            validatedTarget.x - transform.x
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
      // Separation forces will spread them naturally on arrival (RTS style)
      this.moveUnitsToSamePoint(entityIds, targetPosition.x, targetPosition.y, queue);
    }
  }

  /**
   * Clump mode: All units move to the exact same target point.
   * Separation forces will naturally spread them on arrival (RTS style).
   */
  public moveUnitsToSamePoint(
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

      // Validate target for unit's movement domain (prevents boats on land, etc.)
      const validatedTarget = this.validateTargetForDomain(targetX, targetY, unit.movementDomain);
      if (!validatedTarget) continue;

      if (queue) {
        unit.queueCommand({
          type: 'move',
          targetX: validatedTarget.x,
          targetY: validatedTarget.y,
        });
      } else {
        if (unit.state === 'building' && unit.constructingBuildingId !== null) {
          unit.cancelBuilding();
        }
        unit.setMoveTarget(validatedTarget.x, validatedTarget.y);
        unit.path = [];
        unit.pathIndex = 0;
        this.requestPathWithCooldown(entityId, validatedTarget.x, validatedTarget.y, true);

        // Set initial rotation to face target direction
        // Note: Y is negated for Three.js coordinate system
        const transform = entity.get<Transform>('Transform');
        if (transform) {
          transform.rotation = Math.atan2(
            -(validatedTarget.y - transform.y),
            validatedTarget.x - transform.x
          );
        }
      }
    }
  }

  /**
   * Preserve spacing mode: Each unit maintains its relative offset from the group center.
   * Creates formation-like movement without explicit formation slots.
   */
  public moveUnitsWithRelativeOffsets(
    entityIds: number[],
    targetX: number,
    targetY: number,
    box: BoundingBox,
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

      // Validate target for unit's movement domain (prevents boats on land, etc.)
      const validatedTarget = this.validateTargetForDomain(unitTargetX, unitTargetY, unit.movementDomain);
      if (!validatedTarget) continue;

      if (queue) {
        unit.queueCommand({
          type: 'move',
          targetX: validatedTarget.x,
          targetY: validatedTarget.y,
        });
      } else {
        if (unit.state === 'building' && unit.constructingBuildingId !== null) {
          unit.cancelBuilding();
        }
        unit.setMoveTarget(validatedTarget.x, validatedTarget.y);
        unit.path = [];
        unit.pathIndex = 0;
        this.requestPathWithCooldown(entityId, validatedTarget.x, validatedTarget.y, true);

        // Set initial rotation to face target direction
        // Note: Y is negated for Three.js coordinate system
        transform.rotation = Math.atan2(
          -(validatedTarget.y - transform.y),
          validatedTarget.x - transform.x
        );
      }
    }
  }

  // ==================== FORMATION COMMAND ====================

  /**
   * Handle explicit formation command - player requested a specific formation.
   * Uses the data-driven formation system from formations.ts.
   */
  public handleFormationCommand(data: {
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

      // Validate target for unit's movement domain (prevents boats on land, etc.)
      const validatedTarget = this.validateTargetForDomain(pos.x, pos.y, unit.movementDomain);
      if (!validatedTarget) continue;

      if (queue) {
        unit.queueCommand({
          type: 'move',
          targetX: validatedTarget.x,
          targetY: validatedTarget.y,
        });
      } else {
        if (unit.state === 'building' && unit.constructingBuildingId !== null) {
          unit.cancelBuilding();
        }
        unit.setMoveTarget(validatedTarget.x, validatedTarget.y);
        unit.path = [];
        unit.pathIndex = 0;
        this.requestPathWithCooldown(entityId, validatedTarget.x, validatedTarget.y, true);
        // Set initial rotation to face target direction
        // Note: Y is negated for Three.js coordinate system
        transform.rotation = Math.atan2(
          -(validatedTarget.y - transform.y),
          validatedTarget.x - transform.x
        );
      }
    }
  }

  // ==================== GRID FORMATION POSITIONS ====================

  /**
   * Calculate formation positions for a group move command
   * PERF: Uses pooled buffer to avoid array allocation per move command
   * Returns a slice of the pooled buffer - DO NOT store reference, copy values immediately
   */
  public calculateFormationPositions(
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
}

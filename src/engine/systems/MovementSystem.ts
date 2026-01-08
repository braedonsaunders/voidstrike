import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Velocity } from '../components/Velocity';
import { Building } from '../components/Building';
import { Game } from '../core/Game';

// Steering behavior constants
const SEPARATION_RADIUS = 2.0; // Units start avoiding at this distance
const SEPARATION_STRENGTH = 8.0; // How strongly units push apart
const MAX_AVOIDANCE_FORCE = 5.0; // Cap on avoidance force
const BUILDING_AVOIDANCE_STRENGTH = 50.0; // Very strong push from buildings (hard collision)
const BUILDING_AVOIDANCE_MARGIN = 1.0; // Extra margin around buildings

export class MovementSystem extends System {
  public priority = 10;

  private arrivalThreshold = 0.5;
  private decelerationThreshold = 2.0; // Start slowing down at this distance

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Handle move commands
    this.game.eventBus.on('command:move', this.handleMoveCommand.bind(this));
    this.game.eventBus.on('command:patrol', this.handlePatrolCommand.bind(this));
  }

  private handleMoveCommand(data: {
    entityIds: number[];
    targetPosition: { x: number; y: number };
    queue?: boolean; // If true, queue the command instead of replacing
  }): void {
    const { entityIds, targetPosition, queue } = data;

    // Calculate formation positions for multiple units
    const positions = this.calculateFormationPositions(
      targetPosition.x,
      targetPosition.y,
      entityIds.length
    );

    for (let i = 0; i < entityIds.length; i++) {
      const entityId = entityIds[i];
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      const pos = positions[i];

      if (queue) {
        // Add to command queue instead of executing immediately
        unit.queueCommand({
          type: 'move',
          targetX: pos.x,
          targetY: pos.y,
        });
      } else {
        // Execute immediately
        unit.setMoveTarget(pos.x, pos.y);
        unit.path = [];
        unit.pathIndex = 0;
      }
    }
  }

  private handlePatrolCommand(data: {
    entityIds: number[];
    targetPosition: { x: number; y: number };
  }): void {
    const { entityIds, targetPosition } = data;

    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      if (!unit || !transform) continue;

      // Set patrol between current position and target
      unit.setPatrol(transform.x, transform.y, targetPosition.x, targetPosition.y);
    }
  }

  private calculateFormationPositions(
    targetX: number,
    targetY: number,
    count: number
  ): Array<{ x: number; y: number }> {
    if (count === 1) {
      return [{ x: targetX, y: targetY }];
    }

    const positions: Array<{ x: number; y: number }> = [];
    const spacing = 1.5;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    const offsetX = ((cols - 1) * spacing) / 2;
    const offsetY = ((rows - 1) * spacing) / 2;

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.push({
        x: targetX + col * spacing - offsetX,
        y: targetY + row * spacing - offsetY,
      });
    }

    return positions;
  }

  /**
   * Calculate separation force (boids-like avoidance)
   * Units push away from nearby units to avoid overlapping
   * Uses spatial grid for O(1) lookups instead of checking all entities
   */
  private calculateSeparationForce(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit
  ): { x: number; y: number } {
    let forceX = 0;
    let forceY = 0;

    // Use spatial grid to find nearby units - only check units within separation radius
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

      // Skip dead units
      if (otherUnit.state === 'dead') continue;

      // Flying units don't collide with ground units
      if (selfUnit.isFlying !== otherUnit.isFlying) continue;

      const dx = selfTransform.x - otherTransform.x;
      const dy = selfTransform.y - otherTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Combined radius for collision
      const combinedRadius = selfUnit.collisionRadius + otherUnit.collisionRadius;
      const separationDist = Math.max(combinedRadius, SEPARATION_RADIUS);

      if (distance < separationDist && distance > 0.01) {
        // Inverse square falloff - stronger push when closer
        const strength = SEPARATION_STRENGTH * (1 - distance / separationDist);
        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;

        forceX += normalizedDx * strength;
        forceY += normalizedDy * strength;
      }
    }

    // Clamp the force magnitude
    const magnitude = Math.sqrt(forceX * forceX + forceY * forceY);
    if (magnitude > MAX_AVOIDANCE_FORCE) {
      const scale = MAX_AVOIDANCE_FORCE / magnitude;
      forceX *= scale;
      forceY *= scale;
    }

    return { x: forceX, y: forceY };
  }

  /**
   * Calculate building avoidance force
   * Units are pushed away from buildings they're overlapping with
   * Uses spatial grid for O(1) lookups
   */
  private calculateBuildingAvoidanceForce(
    selfTransform: Transform,
    selfUnit: Unit
  ): { x: number; y: number } {
    // Flying units don't collide with buildings
    if (selfUnit.isFlying) {
      return { x: 0, y: 0 };
    }

    let forceX = 0;
    let forceY = 0;

    // Use spatial grid to find nearby buildings
    const nearbyBuildingIds = this.world.buildingGrid.queryRadius(
      selfTransform.x,
      selfTransform.y,
      BUILDING_AVOIDANCE_MARGIN + selfUnit.collisionRadius + 5 // Extra range for large buildings
    );

    for (const buildingId of nearbyBuildingIds) {
      // Skip the building this worker is constructing - they need to get close to it
      if (selfUnit.constructingBuildingId === buildingId) {
        continue;
      }
      const entity = this.world.getEntity(buildingId);
      if (!entity) continue;

      const buildingTransform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!buildingTransform || !building) continue;

      // Get building bounds (center-based)
      const halfWidth = building.width / 2 + BUILDING_AVOIDANCE_MARGIN;
      const halfHeight = building.height / 2 + BUILDING_AVOIDANCE_MARGIN;

      // Calculate closest point on building to unit
      const clampedX = Math.max(
        buildingTransform.x - halfWidth,
        Math.min(selfTransform.x, buildingTransform.x + halfWidth)
      );
      const clampedY = Math.max(
        buildingTransform.y - halfHeight,
        Math.min(selfTransform.y, buildingTransform.y + halfHeight)
      );

      // Distance from unit to closest point on building
      const dx = selfTransform.x - clampedX;
      const dy = selfTransform.y - clampedY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // If unit is overlapping with building (within collision radius)
      const collisionDist = selfUnit.collisionRadius + BUILDING_AVOIDANCE_MARGIN;

      if (distance < collisionDist && distance > 0.01) {
        // Push unit away from building
        const strength = BUILDING_AVOIDANCE_STRENGTH * (1 - distance / collisionDist);
        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;

        forceX += normalizedDx * strength;
        forceY += normalizedDy * strength;
      } else if (distance < 0.01) {
        // Unit is inside building - push toward center direction
        const toCenterX = selfTransform.x - buildingTransform.x;
        const toCenterY = selfTransform.y - buildingTransform.y;
        const toCenterDist = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY);

        if (toCenterDist > 0.01) {
          forceX += (toCenterX / toCenterDist) * BUILDING_AVOIDANCE_STRENGTH;
          forceY += (toCenterY / toCenterDist) * BUILDING_AVOIDANCE_STRENGTH;
        } else {
          // Exactly at center - push in random direction
          forceX += BUILDING_AVOIDANCE_STRENGTH;
        }
      }
    }

    return { x: forceX, y: forceY };
  }

  public update(deltaTime: number): void {
    const entities = this.world.getEntitiesWith('Transform', 'Unit', 'Velocity');
    const dt = deltaTime / 1000; // Convert to seconds

    // Update all unit positions in spatial grid at start of frame
    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      if (unit.state !== 'dead') {
        this.world.unitGrid.update(entity.id, transform.x, transform.y, unit.collisionRadius);
      }
    }

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      const velocity = entity.get<Velocity>('Velocity')!;

      // Skip dead units
      if (unit.state === 'dead') {
        velocity.zero();
        this.world.unitGrid.remove(entity.id);
        continue;
      }

      // Allow movement for moving, attacking, gathering, patrolling, and building states
      const canMove = unit.state === 'moving' || unit.state === 'attacking' ||
                      unit.state === 'gathering' || unit.state === 'patrolling' ||
                      unit.state === 'building';

      if (!canMove) {
        // Decelerate to stop
        if (unit.currentSpeed > 0) {
          unit.currentSpeed = Math.max(0, unit.currentSpeed - unit.acceleration * dt * 2);
        }
        velocity.zero();
        continue;
      }

      // Get current target from path or direct target
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

      // If attacking, we need to get the target's position
      if (unit.state === 'attacking' && unit.targetEntityId !== null) {
        const targetEntity = this.world.getEntity(unit.targetEntityId);
        if (targetEntity) {
          const targetTransform = targetEntity.get<Transform>('Transform');
          if (targetTransform) {
            const distance = transform.distanceTo(targetTransform);
            if (distance > unit.attackRange) {
              // Move toward target
              targetX = targetTransform.x;
              targetY = targetTransform.y;
            } else {
              // In range, stop moving but keep facing target
              transform.rotation = Math.atan2(
                targetTransform.y - transform.y,
                targetTransform.x - transform.x
              );
              // Decelerate
              unit.currentSpeed = Math.max(0, unit.currentSpeed - unit.acceleration * dt * 2);
              velocity.zero();
              continue;
            }
          }
        } else {
          // Target no longer exists - check for queued commands
          if (!unit.executeNextCommand()) {
            unit.clearTarget();
          }
          velocity.zero();
          continue;
        }
      }

      if (targetX === null || targetY === null) {
        // No target - check for queued commands
        if (!unit.executeNextCommand()) {
          // Decelerate
          unit.currentSpeed = Math.max(0, unit.currentSpeed - unit.acceleration * dt * 2);
        }
        velocity.zero();
        continue;
      }

      // Calculate direction to target
      const dx = targetX - transform.x;
      const dy = targetY - transform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check if arrived at waypoint
      if (distance < this.arrivalThreshold) {
        if (unit.path.length > 0 && unit.pathIndex < unit.path.length - 1) {
          // Move to next waypoint
          unit.pathIndex++;
        } else if (unit.state === 'patrolling') {
          // Advance to next patrol point
          unit.nextPatrolPoint();
        } else {
          // Arrived at final destination
          if (unit.state === 'gathering') {
            unit.targetX = null;
            unit.targetY = null;
            velocity.zero();
            continue;
          }

          // Check for queued commands before going idle
          if (!unit.executeNextCommand()) {
            unit.clearTarget();
          }
          velocity.zero();
          continue;
        }
      }

      // Calculate separation force for unit avoidance
      // Reduce separation for units close to destination to prevent twitching
      const separationWeight = distance > this.decelerationThreshold ? 0.5 : 0.1;
      const separation = distance > this.arrivalThreshold * 2
        ? this.calculateSeparationForce(entity.id, transform, unit)
        : { x: 0, y: 0 }; // No separation when nearly arrived

      // Calculate building avoidance (always active)
      const buildingAvoidance = this.calculateBuildingAvoidanceForce(transform, unit);

      // Normalize direction to target
      let dirX = distance > 0.01 ? dx / distance : 0;
      let dirY = distance > 0.01 ? dy / distance : 0;

      // Add separation force to direction (reduced near destination)
      dirX += separation.x * separationWeight;
      dirY += separation.y * separationWeight;

      // Add building avoidance (with full weight - buildings are solid)
      dirX += buildingAvoidance.x;
      dirY += buildingAvoidance.y;

      // Re-normalize
      const newMag = Math.sqrt(dirX * dirX + dirY * dirY);
      if (newMag > 0.01) {
        dirX /= newMag;
        dirY /= newMag;
      }

      // Calculate target speed with deceleration near destination
      let targetSpeed = unit.maxSpeed;
      if (distance < this.decelerationThreshold) {
        // Smooth deceleration as we approach target
        targetSpeed = unit.maxSpeed * (distance / this.decelerationThreshold);
        targetSpeed = Math.max(targetSpeed, unit.maxSpeed * 0.3); // Minimum speed
      }

      // Accelerate or decelerate toward target speed
      if (unit.currentSpeed < targetSpeed) {
        unit.currentSpeed = Math.min(targetSpeed, unit.currentSpeed + unit.acceleration * dt);
      } else if (unit.currentSpeed > targetSpeed) {
        unit.currentSpeed = Math.max(targetSpeed, unit.currentSpeed - unit.acceleration * dt * 2);
      }

      // Apply velocity with damping for nearly-stopped units
      // This prevents oscillation/twitching when units are at rest
      const speedDamping = unit.currentSpeed < unit.maxSpeed * 0.2 ? 0.5 : 1.0;
      velocity.x = dirX * unit.currentSpeed * speedDamping;
      velocity.y = dirY * unit.currentSpeed * speedDamping;

      // Update rotation to face movement direction (smooth rotation)
      const targetRotation = Math.atan2(dy, dx);
      const rotationDiff = targetRotation - transform.rotation;

      // Normalize rotation difference to [-PI, PI]
      let normalizedDiff = rotationDiff;
      while (normalizedDiff > Math.PI) normalizedDiff -= Math.PI * 2;
      while (normalizedDiff < -Math.PI) normalizedDiff += Math.PI * 2;

      // Smooth rotation (turn rate based on speed)
      const turnRate = 8 * dt;
      if (Math.abs(normalizedDiff) < turnRate) {
        transform.rotation = targetRotation;
      } else {
        transform.rotation += Math.sign(normalizedDiff) * turnRate;
      }

      // Apply velocity
      transform.translate(velocity.x * dt, velocity.y * dt);

      // Hard collision resolution - push unit out of buildings if overlapping
      if (!unit.isFlying) {
        this.resolveHardBuildingCollision(transform, unit);
      }
    }
  }

  /**
   * Push unit out of any building they're overlapping with.
   * This is a hard collision resolution that runs after movement.
   */
  private resolveHardBuildingCollision(transform: Transform, unit: Unit): void {
    const nearbyBuildingIds = this.world.buildingGrid.queryRadius(
      transform.x,
      transform.y,
      unit.collisionRadius + 5
    );

    for (const buildingId of nearbyBuildingIds) {
      // Skip the building this worker is constructing - they need to be at it
      if (unit.constructingBuildingId === buildingId) {
        continue;
      }

      const entity = this.world.getEntity(buildingId);
      if (!entity) continue;

      const buildingTransform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!buildingTransform || !building) continue;

      // Check if unit is inside building bounds
      const halfWidth = building.width / 2 + unit.collisionRadius;
      const halfHeight = building.height / 2 + unit.collisionRadius;

      const dx = transform.x - buildingTransform.x;
      const dy = transform.y - buildingTransform.y;

      if (Math.abs(dx) < halfWidth && Math.abs(dy) < halfHeight) {
        // Unit is inside building - push them out
        // Find the shortest escape direction
        const escapeLeft = buildingTransform.x - halfWidth - transform.x;
        const escapeRight = buildingTransform.x + halfWidth - transform.x;
        const escapeUp = buildingTransform.y - halfHeight - transform.y;
        const escapeDown = buildingTransform.y + halfHeight - transform.y;

        // Find minimum absolute escape distance
        const escapeX = Math.abs(escapeLeft) < Math.abs(escapeRight) ? escapeLeft : escapeRight;
        const escapeY = Math.abs(escapeUp) < Math.abs(escapeDown) ? escapeUp : escapeDown;

        // Push in the direction requiring least movement
        if (Math.abs(escapeX) < Math.abs(escapeY)) {
          transform.x += escapeX;
        } else {
          transform.y += escapeY;
        }
      }
    }
  }
}

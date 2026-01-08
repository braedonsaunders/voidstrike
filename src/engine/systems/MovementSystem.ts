import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Velocity } from '../components/Velocity';
import { Building } from '../components/Building';
import { Game } from '../core/Game';

// Steering behavior constants - SC2-style soft separation (units can overlap and clump)
const SEPARATION_RADIUS = 1.0; // Units only avoid when nearly overlapping
const SEPARATION_STRENGTH = 2.0; // Very soft push - allows clumping like SC2
const MAX_AVOIDANCE_FORCE = 1.5; // Low cap - units can stack
const BUILDING_AVOIDANCE_STRENGTH = 25.0; // Push from buildings (still solid)
const BUILDING_AVOIDANCE_MARGIN = 0.25; // Minimal margin around buildings - hitbox should match model

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
   * Calculate separation force (SC2-style soft avoidance)
   * Units can overlap and clump - separation is very soft
   * Gathering workers skip separation entirely (like SC2 mining)
   * Uses spatial grid for O(1) lookups instead of checking all entities
   */
  private calculateSeparationForce(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit
  ): { x: number; y: number } {
    // SC2-style: gathering workers walk through each other completely
    if (selfUnit.state === 'gathering') {
      return { x: 0, y: 0 };
    }

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

      // SC2-style: skip separation with gathering workers (they walk through)
      if (otherUnit.state === 'gathering') continue;

      const dx = selfTransform.x - otherTransform.x;
      const dy = selfTransform.y - otherTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Combined radius for collision - only push when nearly overlapping
      const combinedRadius = selfUnit.collisionRadius + otherUnit.collisionRadius;
      const separationDist = Math.max(combinedRadius * 0.5, SEPARATION_RADIUS);

      if (distance < separationDist && distance > 0.01) {
        // Very soft push - allows clumping like SC2
        const strength = SEPARATION_STRENGTH * (1 - distance / separationDist);
        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;

        forceX += normalizedDx * strength;
        forceY += normalizedDy * strength;
      }
    }

    // Clamp the force magnitude - low cap allows stacking
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

    // Resource drop-off buildings - workers carrying resources skip avoidance for these
    const dropOffBuildings = [
      'command_center', 'orbital_command', 'planetary_fortress',
      'nexus', 'hatchery', 'lair', 'hive'
    ];
    const isCarryingResources = selfUnit.isWorker &&
      (selfUnit.carryingMinerals > 0 || selfUnit.carryingVespene > 0);

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

      // Skip drop-off buildings for workers carrying resources - they need to get close
      if (isCarryingResources && dropOffBuildings.includes(building.buildingId)) {
        continue;
      }

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
          const targetBuilding = targetEntity.get<Building>('Building');
          if (targetTransform) {
            // For buildings, calculate distance to edge, not center
            let effectiveDistance: number;
            let attackTargetX = targetTransform.x;
            let attackTargetY = targetTransform.y;

            if (targetBuilding) {
              // Calculate closest point on building edge
              const halfW = targetBuilding.width / 2;
              const halfH = targetBuilding.height / 2;
              const clampedX = Math.max(targetTransform.x - halfW, Math.min(transform.x, targetTransform.x + halfW));
              const clampedY = Math.max(targetTransform.y - halfH, Math.min(transform.y, targetTransform.y + halfH));
              const edgeDx = transform.x - clampedX;
              const edgeDy = transform.y - clampedY;
              effectiveDistance = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

              // Target a point OUTSIDE the building at attack range distance from the edge
              // NOT the edge itself - units should never try to get inside buildings
              if (effectiveDistance > 0.1) {
                // Calculate direction from edge to unit
                const dirX = edgeDx / effectiveDistance;
                const dirY = edgeDy / effectiveDistance;
                // Target position is just outside the building edge at attack range
                // Add a small margin (0.5) to ensure unit stays outside
                const standOffDistance = Math.max(unit.attackRange * 0.8, 0.5);
                attackTargetX = clampedX + dirX * standOffDistance;
                attackTargetY = clampedY + dirY * standOffDistance;
              } else {
                // Unit is at the edge or inside - move away from building center
                const awayDx = transform.x - targetTransform.x;
                const awayDy = transform.y - targetTransform.y;
                const awayDist = Math.sqrt(awayDx * awayDx + awayDy * awayDy);
                if (awayDist > 0.1) {
                  const standOffDistance = Math.max(halfW, halfH) + unit.attackRange;
                  attackTargetX = targetTransform.x + (awayDx / awayDist) * standOffDistance;
                  attackTargetY = targetTransform.y + (awayDy / awayDist) * standOffDistance;
                } else {
                  // At center - move to any edge
                  attackTargetX = targetTransform.x + halfW + unit.attackRange;
                  attackTargetY = targetTransform.y;
                }
              }
            } else {
              effectiveDistance = transform.distanceTo(targetTransform);
            }

            if (effectiveDistance > unit.attackRange) {
              // Move toward target position (outside building for buildings, near center for units)
              targetX = attackTargetX;
              targetY = attackTargetY;
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

    // Resource drop-off buildings - workers carrying resources skip collision for these
    const dropOffBuildings = [
      'command_center', 'orbital_command', 'planetary_fortress',
      'nexus', 'hatchery', 'lair', 'hive'
    ];
    const isCarryingResources = unit.isWorker &&
      (unit.carryingMinerals > 0 || unit.carryingVespene > 0);

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

      // Skip drop-off buildings for workers carrying resources
      if (isCarryingResources && dropOffBuildings.includes(building.buildingId)) {
        continue;
      }

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

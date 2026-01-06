import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Velocity } from '../components/Velocity';
import { Game } from '../core/Game';

export class MovementSystem extends System {
  public priority = 10;

  private arrivalThreshold = 0.5;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Handle move commands
    this.game.eventBus.on('command:move', this.handleMoveCommand.bind(this));
  }

  private handleMoveCommand(data: {
    entityIds: number[];
    targetPosition: { x: number; y: number };
  }): void {
    const { entityIds, targetPosition } = data;

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

      // Set target position (using formation if multiple units)
      const pos = positions[i];
      unit.setMoveTarget(pos.x, pos.y);

      // Clear any path (simple direct movement for now)
      unit.path = [];
      unit.pathIndex = 0;
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

  public update(deltaTime: number): void {
    const entities = this.world.getEntitiesWith('Transform', 'Unit', 'Velocity');
    const dt = deltaTime / 1000; // Convert to seconds

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      const velocity = entity.get<Velocity>('Velocity')!;

      // Allow movement for moving, attacking, and gathering states
      if (unit.state !== 'moving' && unit.state !== 'attacking' && unit.state !== 'gathering') {
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
              // In range, stop moving
              velocity.zero();
              continue;
            }
          }
        } else {
          // Target no longer exists
          unit.clearTarget();
          velocity.zero();
          continue;
        }
      }

      if (targetX === null || targetY === null) {
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
        } else {
          // Arrived at final destination
          // For gathering units, just clear the move target but keep the state
          if (unit.state === 'gathering') {
            unit.targetX = null;
            unit.targetY = null;
            velocity.zero();
            continue;
          }
          unit.clearTarget();
          velocity.zero();
          continue;
        }
      }

      // Normalize direction and apply speed
      const dirX = dx / distance;
      const dirY = dy / distance;

      velocity.x = dirX * unit.speed;
      velocity.y = dirY * unit.speed;

      // Update rotation to face movement direction
      transform.rotation = Math.atan2(dy, dx);

      // Apply velocity
      transform.translate(velocity.x * dt, velocity.y * dt);
    }
  }
}

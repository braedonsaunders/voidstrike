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
  }

  public update(deltaTime: number): void {
    const entities = this.world.getEntitiesWith('Transform', 'Unit', 'Velocity');
    const dt = deltaTime / 1000; // Convert to seconds

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      const velocity = entity.get<Velocity>('Velocity')!;

      if (unit.state !== 'moving' && unit.state !== 'attacking') {
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

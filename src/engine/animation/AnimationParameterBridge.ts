/**
 * AnimationParameterBridge
 *
 * Bridges game state (Unit, Velocity, etc.) to animation parameters.
 * This is the single point where game logic connects to the animation system.
 */

import { AnimationController } from './AnimationController';

/**
 * Velocity threshold for movement detection
 * Below this magnitude, unit is considered stationary
 */
const VELOCITY_THRESHOLD = 0.01;

/**
 * Unit state interface (matches Unit component)
 */
interface UnitState {
  state: string;
  unitId: string;
}

/**
 * Velocity interface (matches Velocity component or VelocityAdapter)
 */
interface VelocityState {
  x: number;
  y: number;
}

/**
 * Update animation parameters from game state
 *
 * Call this each frame for each animated unit to sync
 * game state with animation parameters.
 */
export function updateAnimationParameters(
  controller: AnimationController,
  unit: UnitState,
  velocity: VelocityState | null
): void {
  // Calculate velocity magnitude
  const velocityMagnitude = velocity
    ? Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y)
    : 0;

  // Set velocity parameter
  controller.setFloat('velocity', velocityMagnitude);

  // Set attacking parameter
  // Unit is "attacking" when in attacking state AND stationary
  // (moving toward target = walk animation, not attack)
  const isStationary = velocityMagnitude <= VELOCITY_THRESHOLD;
  const isAttacking = unit.state === 'attacking' && isStationary;
  controller.setBool('isAttacking', isAttacking);

  // Set dead parameter
  controller.setBool('isDead', unit.state === 'dead');

  // Additional state parameters that could be useful
  controller.setBool('isGathering', unit.state === 'gathering');
  controller.setBool('isBuilding', unit.state === 'building');
}

/**
 * Unit states that should play walk animation when moving
 */
const _WALKING_STATES = new Set([
  'moving',
  'attackmoving',
  'patrolling',
  'gathering',
  'building',
]);

/**
 * Get the logical animation state from game state
 * (for debugging / state inspection)
 */
export function getLogicalAnimationState(
  unit: UnitState,
  velocity: VelocityState | null
): 'idle' | 'walk' | 'attack' | 'death' | 'gather' | 'build' {
  if (unit.state === 'dead') {
    return 'death';
  }

  const velocityMagnitude = velocity
    ? Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y)
    : 0;
  const isMoving = velocityMagnitude > VELOCITY_THRESHOLD;

  if (isMoving) {
    return 'walk';
  }

  if (unit.state === 'attacking') {
    return 'attack';
  }

  if (unit.state === 'gathering') {
    return 'gather';
  }

  if (unit.state === 'building') {
    return 'build';
  }

  return 'idle';
}

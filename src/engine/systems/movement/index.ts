/**
 * Movement System Module Exports
 *
 * This module contains the refactored movement system split into concerns:
 * - FlockingBehavior: Boids-style steering (separation, cohesion, alignment)
 * - PathfindingMovement: A-star/navmesh pathfinding and crowd simulation
 * - FormationMovement: Magic box detection and group formations
 * - MovementOrchestrator: Main coordinator that ties everything together
 */

export { FlockingBehavior } from './FlockingBehavior';
export type { FlockingEntityCache, FlockingSpatialGrid } from './FlockingBehavior';

export { PathfindingMovement } from './PathfindingMovement';
export type { PathfindingWorld, PathfindingGame } from './PathfindingMovement';

export { FormationMovement } from './FormationMovement';
export type { PathRequestCallback } from './FormationMovement';

export { MovementOrchestrator } from './MovementOrchestrator';

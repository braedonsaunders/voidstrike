/**
 * Movement System - RTS-Style Clumping & Formations
 *
 * Handles unit movement using Recast's DetourCrowd for collision avoidance.
 * Implements RTS-style "magic box" detection for clump vs formation behavior:
 * - Target OUTSIDE selection bounding box → units converge to same point (clump)
 * - Target INSIDE bounding box → units preserve relative spacing (formation nudge)
 *
 * Also supports explicit formation commands using data-driven formations.
 *
 * This system is a thin wrapper around the modular movement subsystems:
 * - FlockingBehavior: Boids-style steering (separation, cohesion, alignment)
 * - PathfindingMovement: A-star/navmesh pathfinding and crowd simulation
 * - FormationMovement: Magic box detection and group formations
 * - MovementOrchestrator: Main coordinator that ties everything together
 */

import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { MovementOrchestrator } from './movement/MovementOrchestrator';

export class MovementSystem extends System {
  public readonly name = 'MovementSystem';
  public priority = 10;

  private orchestrator: MovementOrchestrator;

  constructor(game: Game) {
    super(game);
    this.orchestrator = new MovementOrchestrator(game, game.world);
    this.orchestrator.setupEventListeners();
  }

  /**
   * Called when the world is initialized/re-initialized
   */
  public init(world: import('../ecs/World').World): void {
    super.init(world);
    this.orchestrator.setWorld(world);
  }

  /**
   * Main update loop - delegates to MovementOrchestrator
   */
  public update(deltaTime: number): void {
    const entities = this.world.getEntitiesWith('Transform', 'Unit', 'Velocity');
    this.orchestrator.update(deltaTime, entities);
  }
}

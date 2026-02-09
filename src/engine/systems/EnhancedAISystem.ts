/**
 * EnhancedAISystem - Backward-compatible wrapper for the modular AI architecture
 *
 * This system delegates to the new AICoordinator which manages focused subsystems:
 * - AIEconomyManager: Worker management, resource gathering, repair
 * - AIBuildOrderExecutor: Build orders, macro rules, unit/building production, research
 * - AITacticsManager: Combat state, attack/defend/harass execution
 * - AIScoutingManager: Map exploration, intel gathering
 *
 * The refactored architecture splits the original 3,011-line monolith into focused,
 * maintainable modules while preserving all existing behavior.
 *
 * @see src/engine/systems/ai/ for the new modular implementation
 */

import { System } from '../ecs/System';
import { World } from '../ecs/World';
import type { IGameInstance } from '../core/IGameInstance';
import { AICoordinator, type AIPlayer, type AIState, type AIDifficulty } from './ai/AICoordinator';
import type { AIPersonality } from '@/data/ai/aiConfig';

// Re-export types for backward compatibility
export type { AIPlayer, AIState, AIDifficulty };

export class EnhancedAISystem extends System {
  public readonly name = 'EnhancedAISystem';
  // Priority is set by SystemRegistry based on dependencies (runs after CombatSystem, ResourceSystem)

  private coordinator: AICoordinator;

  constructor(game: IGameInstance, difficulty: AIDifficulty = 'medium') {
    super(game);
    this.coordinator = new AICoordinator(game, difficulty);
  }

  public init(world: World): void {
    super.init(world);
    this.coordinator.init(world);
  }

  public update(deltaTime: number): void {
    this.coordinator.update(deltaTime);
  }

  // === Public API (delegates to coordinator) ===

  /**
   * Register an AI player.
   */
  public registerAI(
    playerId: string,
    faction: string,
    difficulty: AIDifficulty = 'medium',
    personality: AIPersonality = 'balanced',
    teamId: number = 0
  ): void {
    this.coordinator.registerAI(playerId, faction, difficulty, personality, teamId);

    // Also register with AIMicroSystem for unit micro management
    this.game.eventBus.emit('ai:registered', { playerId });
  }

  /**
   * Check if a player is AI-controlled.
   */
  public isAIPlayer(playerId: string): boolean {
    return this.coordinator.isAIPlayer(playerId);
  }

  /**
   * Get an AI player's state.
   */
  public getAIPlayer(playerId: string): AIPlayer | undefined {
    return this.coordinator.getAIPlayer(playerId);
  }

  /**
   * Get all AI players.
   */
  public getAllAIPlayers(): AIPlayer[] {
    return this.coordinator.getAllAIPlayers();
  }

  /**
   * Get the mining speed multiplier for an AI player (difficulty-based).
   */
  public getMiningSpeedMultiplier(playerId: string): number {
    return this.coordinator.getMiningSpeedMultiplier(playerId);
  }

  /**
   * Credit resources to an AI player (simulation-based economy).
   */
  public creditResources(playerId: string, minerals: number, plasma: number): void {
    this.coordinator.creditResources(playerId, minerals, plasma);
  }
}

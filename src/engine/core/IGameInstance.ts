/**
 * IGameInstance - Shared interface for game instances
 *
 * This interface defines the contract that Game, GameCore, and WorkerGame all implement.
 * Systems use this interface instead of concrete Game type, enabling them to work
 * in both main thread and worker contexts.
 *
 * This eliminates the need for 'this as any' casts in GameCore and GameWorker.
 */

import type { World } from '../ecs/World';
import type { EventBus } from './EventBus';
import type { GameConfig, TerrainCell } from './GameCore';
import type { GameCommand } from './GameCommand';
import type { GameStatePort } from './GameStatePort';
import type { VisionSystem } from '../systems/VisionSystem';
import type { PathfindingSystem } from '../systems/PathfindingSystem';
import type { ProjectileSystem } from '../systems/ProjectileSystem';
import type { ChecksumSystem } from '../systems/ChecksumSystem';
import type { GameStateSystem } from '../systems/GameStateSystem';
import type { SaveLoadSystem } from '../systems/SaveLoadSystem';
import type { AIMicroSystem } from '../systems/AIMicroSystem';
import type { AudioSystem } from '../systems/AudioSystem';

/**
 * Core game instance interface implemented by Game, GameCore, and WorkerGame.
 * Systems should accept this interface type in their constructors.
 */
export interface IGameInstance {
  // ============================================================================
  // CORE SYSTEMS
  // ============================================================================

  /** The ECS World containing all entities and components */
  readonly world: World;

  /** Event bus for pub/sub communication between systems */
  readonly eventBus: EventBus;

  /** Game configuration (map size, tick rate, multiplayer settings) */
  readonly config: GameConfig;

  // ============================================================================
  // SYSTEM REFERENCES
  // ============================================================================

  /** Vision system for fog of war queries */
  readonly visionSystem: VisionSystem;

  /** Pathfinding system for path queries and navmesh access */
  readonly pathfindingSystem: PathfindingSystem;

  /** Projectile system for spawning projectiles */
  readonly projectileSystem: ProjectileSystem;

  /** Game state system for win/loss detection */
  readonly gameStateSystem: GameStateSystem;

  /** Save/load system for game state serialization */
  readonly saveLoadSystem: SaveLoadSystem;

  /** AI micro system for unit control behaviors */
  readonly aiMicroSystem: AIMicroSystem;

  /** Checksum system for multiplayer determinism (null in single player) */
  readonly checksumSystem: ChecksumSystem | null;

  /** Audio system for sound effects (main thread only, null in worker) */
  readonly audioSystem: AudioSystem | null;

  /**
   * State port for resource/selection management.
   * Main thread: ZustandStateAdapter for UI integration
   * Worker: Internal implementation for game logic
   */
  readonly statePort: GameStatePort;

  // ============================================================================
  // GAME STATE METHODS
  // ============================================================================

  /** Get the current game tick (fixed timestep frame counter) */
  getCurrentTick(): number;

  /** Get total game time in seconds */
  getGameTime(): number;

  /** Check if running in multiplayer mode */
  isInMultiplayerMode(): boolean;

  /** Get team ID for a player (0 = FFA, 1-4 = team alliance) */
  getPlayerTeam(playerId: string): number;

  // ============================================================================
  // TERRAIN METHODS
  // ============================================================================

  /** Get terrain cell data at world position */
  getTerrainAt(worldX: number, worldY: number): TerrainCell | null;

  /** Get terrain height at world position */
  getTerrainHeightAt(worldX: number, worldY: number): number;

  /** Get the full terrain grid (read-only) */
  getTerrainGrid(): TerrainCell[][] | null;

  /** Get decoration collision data */
  getDecorationCollisions(): Array<{ x: number; z: number; radius: number }>;

  // ============================================================================
  // BUILDING PLACEMENT VALIDATION
  // ============================================================================

  /** Check if position is clear of decorations */
  isPositionClearOfDecorations(
    centerX: number,
    centerY: number,
    width: number,
    height: number
  ): boolean;

  /** Check if terrain is valid for building placement */
  isValidTerrainForBuilding(
    centerX: number,
    centerY: number,
    width: number,
    height: number
  ): boolean;

  /** Full building placement validation */
  isValidBuildingPlacement(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    excludeEntityId?: number,
    skipUnitCheck?: boolean
  ): boolean;

  // ============================================================================
  // COMMAND PROCESSING
  // ============================================================================

  /**
   * Issue an AI command for immediate execution.
   * AI commands bypass multiplayer validation since AI logic is deterministic.
   */
  issueAICommand(command: GameCommand): void;

  /**
   * Process a command via the event bus dispatcher.
   */
  processCommand(command: GameCommand): void;

  // ============================================================================
  // GAME LOOP CONTROL (main-thread only, optional)
  // ============================================================================

  /**
   * Pause the game loop.
   * Only available on main thread (Game class).
   * @returns void
   */
  pause?(): void;

  /**
   * Resume the game loop.
   * Only available on main thread (Game class).
   * @returns void
   */
  resume?(): void;

  /**
   * Stop the game completely.
   * Only available on main thread (Game class).
   * @returns void
   */
  stop?(): void;
}

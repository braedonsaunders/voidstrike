/**
 * GameCore - Abstract base class for game instances
 *
 * Provides shared game logic used by both:
 * - Game.ts (main thread: selection, audio, UI)
 * - WorkerGame (web worker: simulation, AI, anti-throttling)
 *
 * This eliminates code duplication and ensures terrain validation,
 * building placement, and command processing stay synchronized.
 */

import { World } from '../ecs/World';
import { EventBus } from '../core/EventBus';
import { SystemRegistry } from '../core/SystemRegistry';
import { bootstrapDefinitions, definitionsReady } from '../definitions';

// Systems with direct references
import { VisionSystem } from '../systems/VisionSystem';
import { GameStateSystem } from '../systems/GameStateSystem';
import { SaveLoadSystem } from '../systems/SaveLoadSystem';
import { PathfindingSystem } from '../systems/PathfindingSystem';
import { AIMicroSystem } from '../systems/AIMicroSystem';
import { ChecksumSystem } from '../systems/ChecksumSystem';
import { ProjectileSystem } from '../systems/ProjectileSystem';

// Components for validation
import { Transform } from '../components/Transform';
import { Building } from '../components/Building';
import { Selectable } from '../components/Selectable';

import { validateEntity } from '@/utils/EntityValidator';
import { dispatchCommand, type GameCommand } from './GameCommand';

export type GameState = 'initializing' | 'running' | 'paused' | 'ended';

export interface TerrainCell {
  terrain: 'ground' | 'platform' | 'unwalkable' | 'ramp' | 'unbuildable' | 'creep';
  elevation: number;
  feature?: 'none' | 'water_shallow' | 'water_deep' | 'forest_light' | 'forest_dense' | 'mud' | 'road' | 'void' | 'cliff';
}

export interface GameConfig {
  mapWidth: number;
  mapHeight: number;
  tickRate: number;
  isMultiplayer: boolean;
  playerId: string;
  aiEnabled: boolean;
  aiDifficulty: 'easy' | 'medium' | 'hard' | 'insane';
}

export const DEFAULT_CONFIG: GameConfig = {
  mapWidth: 128,
  mapHeight: 128,
  tickRate: 20,
  isMultiplayer: false,
  playerId: 'player1',
  aiEnabled: true,
  aiDifficulty: 'medium',
};

/**
 * Abstract base class providing shared game logic.
 * Subclasses implement thread-specific behavior (main thread vs worker).
 */
export abstract class GameCore {
  // ============================================================================
  // CORE SYSTEMS (shared between main thread and worker)
  // ============================================================================

  public world: World;
  public eventBus: EventBus;
  public config: GameConfig;

  // Direct system references - initialized in constructor before initializeSystems()
  public visionSystem: VisionSystem;
  public gameStateSystem: GameStateSystem;
  public saveLoadSystem: SaveLoadSystem;
  public pathfindingSystem: PathfindingSystem;
  public aiMicroSystem: AIMicroSystem;
  public checksumSystem: ChecksumSystem | null = null;

  // System assigned during initializeSystems()
  protected _projectileSystem: ProjectileSystem | null = null;

  /**
   * Get the ProjectileSystem instance.
   * @throws Error if accessed before system initialization
   */
  public get projectileSystem(): ProjectileSystem {
    if (!this._projectileSystem) {
      throw new Error('[GameCore] ProjectileSystem accessed before initialization');
    }
    return this._projectileSystem;
  }

  // ============================================================================
  // TERRAIN DATA
  // ============================================================================

  protected terrainGrid: TerrainCell[][] | null = null;
  protected decorationCollisions: Array<{ x: number; z: number; radius: number }> = [];

  // ============================================================================
  // GAME STATE
  // ============================================================================

  protected state: GameState = 'initializing';
  protected currentTick = 0;

  // ============================================================================
  // COMMAND QUEUE
  // ============================================================================

  protected commandQueue: Map<number, GameCommand[]> = new Map();

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  constructor(config: Partial<GameConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Ensure definitions are loaded
    // Callers should await initializeDefinitions() before creating GameCore
    if (!definitionsReady()) {
      console.warn('[GameCore] Definitions not initialized before GameCore creation. Starting async load...');
      // Fire off async load, but this may cause race conditions
      bootstrapDefinitions();
    }

    // Initialize ECS World with map dimensions
    this.world = new World(this.config.mapWidth, this.config.mapHeight);
    this.eventBus = new EventBus();

    // Pre-create systems that need direct references
    // Using 'this as any' to satisfy Game type requirement (GameCore is compatible)
    this.visionSystem = new VisionSystem(this as any, this.config.mapWidth, this.config.mapHeight);
    this.gameStateSystem = new GameStateSystem(this as any);
    this.saveLoadSystem = new SaveLoadSystem(this as any);
    this.pathfindingSystem = new PathfindingSystem(this as any, this.config.mapWidth, this.config.mapHeight);
    this.aiMicroSystem = new AIMicroSystem(this as any);

    // Initialize checksum system for multiplayer
    if (this.config.isMultiplayer) {
      this.checksumSystem = new ChecksumSystem(this as any, {
        checksumInterval: 5,
        emitNetworkChecksums: true,
        logChecksums: false,
        autoDumpOnDesync: true,
      });
    }
  }

  // ============================================================================
  // ABSTRACT METHODS (implemented by subclasses)
  // ============================================================================

  /**
   * Get system definitions for this game instance.
   * Main thread includes SelectionSystem + AudioSystem.
   * Worker excludes them (not available in worker context).
   * Returns any[] to allow different definition formats between threads.
   */
  protected abstract getSystemDefinitions(): any[];

  /**
   * Start the game loop.
   */
  public abstract start(gameStartTime?: number): void;

  /**
   * Stop the game.
   */
  public abstract stop(): void;

  // ============================================================================
  // SYSTEM INITIALIZATION (shared logic)
  // ============================================================================

  /**
   * Initialize systems using dependency-based ordering.
   * Subclasses can override to add thread-specific setup.
   */
  protected initializeSystems(): void {
    const registry = new SystemRegistry();
    registry.registerAll(this.getSystemDefinitions());

    // Validate dependencies at startup
    const errors = registry.validate();
    if (errors.length > 0) {
      console.error('[GameCore] System dependency errors:', errors);
      throw new Error(`Invalid system dependencies:\n${errors.join('\n')}`);
    }

    // Create systems in dependency order
    const systems = registry.createSystems(this as any);

    // Add all systems to world and capture references
    for (const system of systems) {
      this.world.addSystem(system);
      this.onSystemCreated(system);
    }
  }

  /**
   * Hook for subclasses to capture system references.
   * Called for each system after creation.
   */
  protected onSystemCreated(system: any): void {
    if (system.name === 'ProjectileSystem') {
      this._projectileSystem = system as ProjectileSystem;
    }
  }

  // ============================================================================
  // TERRAIN METHODS (shared implementation)
  // ============================================================================

  /**
   * Get the terrain grid (read-only access for systems)
   */
  public getTerrainGrid(): TerrainCell[][] | null {
    return this.terrainGrid;
  }

  /**
   * Get terrain cell at a specific world position
   */
  public getTerrainAt(worldX: number, worldY: number): TerrainCell | null {
    if (!this.terrainGrid || this.terrainGrid.length === 0) return null;

    const gridX = Math.floor(worldX);
    const gridY = Math.floor(worldY);

    const firstRow = this.terrainGrid[0];
    if (!firstRow || gridY < 0 || gridY >= this.terrainGrid.length ||
        gridX < 0 || gridX >= firstRow.length) {
      return null;
    }

    return this.terrainGrid[gridY][gridX];
  }

  /**
   * Get terrain height at a specific world position.
   * Converts elevation (0-255) to world height units.
   * Returns 0 if terrain data is not available.
   */
  public getTerrainHeightAt(worldX: number, worldY: number): number {
    const cell = this.getTerrainAt(worldX, worldY);
    if (!cell) return 0;

    // Convert elevation to height using same formula as Terrain.ts
    // elevation * 0.04 gives range 0 to ~10.2 units
    return cell.elevation * 0.04;
  }

  /**
   * Set the terrain grid for building placement validation.
   * Should be called after map is loaded.
   */
  public setTerrainGrid(terrain: TerrainCell[][]): void {
    this.terrainGrid = terrain;
    this.pathfindingSystem.loadTerrainData();
  }

  /**
   * Set decoration collision data for building placement validation and pathfinding.
   * Should be called after environment is loaded.
   */
  public setDecorationCollisions(collisions: Array<{ x: number; z: number; radius: number }>): void {
    this.decorationCollisions = collisions;
    this.pathfindingSystem.registerDecorationCollisions(collisions);
  }

  /**
   * Get decoration collision data for building placement validation
   */
  public getDecorationCollisions(): Array<{ x: number; z: number; radius: number }> {
    return this.decorationCollisions;
  }

  // ============================================================================
  // NAVMESH METHODS (shared implementation)
  // ============================================================================

  /**
   * Initialize the navmesh for pathfinding from terrain walkable geometry.
   */
  public async initializeNavMesh(
    positions: Float32Array,
    indices: Uint32Array
  ): Promise<boolean> {
    return this.pathfindingSystem.initializeNavMesh(positions, indices);
  }

  /**
   * Initialize the water navmesh for naval unit pathfinding.
   */
  public async initializeWaterNavMesh(
    positions: Float32Array,
    indices: Uint32Array
  ): Promise<boolean> {
    return this.pathfindingSystem.initializeWaterNavMesh(positions, indices);
  }

  // ============================================================================
  // BUILDING PLACEMENT VALIDATION (shared implementation)
  // ============================================================================

  /**
   * Check if a building position overlaps with decorations (rocks, trees)
   */
  public isPositionClearOfDecorations(centerX: number, centerY: number, width: number, height: number): boolean {
    const halfW = width / 2 + 0.5;
    const halfH = height / 2 + 0.5;

    for (const deco of this.decorationCollisions) {
      const dx = Math.abs(centerX - deco.x);
      const dz = Math.abs(centerY - deco.z);

      if (dx < halfW + deco.radius && dz < halfH + deco.radius) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if terrain is valid for building placement.
   * Returns true if all tiles are buildable ground at the same elevation.
   */
  public isValidTerrainForBuilding(centerX: number, centerY: number, width: number, height: number): boolean {
    if (!this.terrainGrid) {
      // No terrain data - allow placement (legacy behavior)
      return true;
    }

    const halfWidth = width / 2;
    const halfHeight = height / 2;
    let requiredElevation: number | null = null;

    const firstRow = this.terrainGrid[0];
    if (!firstRow) return false;

    for (let dy = -Math.floor(halfHeight); dy < Math.ceil(halfHeight); dy++) {
      for (let dx = -Math.floor(halfWidth); dx < Math.ceil(halfWidth); dx++) {
        const tileX = Math.floor(centerX + dx);
        const tileY = Math.floor(centerY + dy);

        if (tileY < 0 || tileY >= this.terrainGrid.length ||
            tileX < 0 || tileX >= firstRow.length) {
          return false;
        }

        const cell = this.terrainGrid[tileY][tileX];

        if (cell.terrain !== 'ground' && cell.terrain !== 'platform') {
          return false;
        }

        if (requiredElevation === null) {
          requiredElevation = cell.elevation;
        } else if (cell.elevation !== requiredElevation) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if a building can be placed at the given position.
   * Performs all validation: terrain, buildings, resources, units, and decorations.
   */
  public isValidBuildingPlacement(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    excludeEntityId?: number,
    skipUnitCheck: boolean = false
  ): boolean {
    const halfW = width / 2;
    const halfH = height / 2;

    // Check map bounds
    if (centerX - halfW < 0 || centerY - halfH < 0 ||
        centerX + halfW > this.config.mapWidth || centerY + halfH > this.config.mapHeight) {
      return false;
    }

    // Check terrain validity
    if (!this.isValidTerrainForBuilding(centerX, centerY, width, height)) {
      return false;
    }

    // Check for overlapping buildings using spatial grid
    const queryPadding = 10;
    const nearbyBuildingIds = this.world.buildingGrid.queryRect(
      centerX - halfW - queryPadding,
      centerY - halfH - queryPadding,
      centerX + halfW + queryPadding,
      centerY + halfH + queryPadding
    );

    for (const buildingId of nearbyBuildingIds) {
      const entity = this.world.getEntity(buildingId);
      if (!validateEntity(entity, buildingId, 'GameCore.isValidBuildingPlacement:building', this.currentTick)) continue;

      const transform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!transform || !building) continue;

      // Skip flying buildings
      if (building.isFlying || building.state === 'lifting' ||
          building.state === 'flying' || building.state === 'landing') {
        continue;
      }

      const existingHalfW = building.width / 2;
      const existingHalfH = building.height / 2;
      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      if (dx < halfW + existingHalfW && dy < halfH + existingHalfH) {
        return false;
      }
    }

    // Check for overlapping resources
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform');
      if (!transform) continue;

      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      if (dx < halfW + 1.5 && dy < halfH + 1.5) {
        return false;
      }
    }

    // Check for overlapping units
    if (!skipUnitCheck) {
      const nearbyUnitIds = this.world.unitGrid.queryRect(
        centerX - halfW - 2,
        centerY - halfH - 2,
        centerX + halfW + 2,
        centerY + halfH + 2
      );

      for (const unitId of nearbyUnitIds) {
        if (excludeEntityId !== undefined && unitId === excludeEntityId) {
          continue;
        }

        const entity = this.world.getEntity(unitId);
        if (!validateEntity(entity, unitId, 'GameCore.isValidBuildingPlacement:unit', this.currentTick)) continue;

        const transform = entity.get<Transform>('Transform');
        if (!transform) continue;

        const dx = Math.abs(centerX - transform.x);
        const dy = Math.abs(centerY - transform.y);

        if (dx < halfW + 0.5 && dy < halfH + 0.5) {
          return false;
        }
      }
    }

    // Check for overlapping decorations
    if (!this.isPositionClearOfDecorations(centerX, centerY, width, height)) {
      return false;
    }

    return true;
  }

  // ============================================================================
  // GAME STATE METHODS (shared implementation)
  // ============================================================================

  public getState(): GameState {
    return this.state;
  }

  public getCurrentTick(): number {
    return this.currentTick;
  }

  public getGameTime(): number {
    return this.currentTick / this.config.tickRate;
  }

  // ============================================================================
  // COMMAND PROCESSING (shared implementation)
  // ============================================================================

  /**
   * Queue a command for execution at a specific tick (lockstep multiplayer)
   */
  protected queueCommand(command: GameCommand): void {
    const tick = command.tick;
    if (!this.commandQueue.has(tick)) {
      this.commandQueue.set(tick, []);
    }
    this.commandQueue.get(tick)!.push(command);
  }

  /**
   * Process a command via the event bus dispatcher.
   * Subclasses may override to add authorization checks.
   */
  public processCommand(command: GameCommand): void {
    dispatchCommand(this.eventBus, command);
  }

  /**
   * Process all commands scheduled for the current tick.
   * Sorts by player ID for deterministic ordering.
   */
  protected processQueuedCommands(): void {
    const commands = this.commandQueue.get(this.currentTick);
    if (!commands) return;

    // Sort by player ID for determinism
    commands.sort((a, b) => a.playerId.localeCompare(b.playerId));

    for (const command of commands) {
      this.processCommand(command);
    }

    this.commandQueue.delete(this.currentTick);
  }
}

import { World } from '../ecs/World';
import { GameLoop } from './GameLoop';
import { EventBus } from './EventBus';
import { MovementSystem } from '../systems/MovementSystem';
import { SelectionSystem } from '../systems/SelectionSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { ProductionSystem } from '../systems/ProductionSystem';
import { ResourceSystem } from '../systems/ResourceSystem';
import { ResearchSystem } from '../systems/ResearchSystem';
import { EnhancedAISystem, AIDifficulty } from '../systems/EnhancedAISystem';
import { VisionSystem } from '../systems/VisionSystem';
import { AbilitySystem } from '../systems/AbilitySystem';
import { SpawnSystem } from '../systems/SpawnSystem';
import { BuildingPlacementSystem } from '../systems/BuildingPlacementSystem';
import { debugInitialization, debugPerformance } from '@/utils/debugLogger';
import { AudioSystem } from '../systems/AudioSystem';
import { Transform } from '../components/Transform';
import { Building } from '../components/Building';
import { Unit } from '../components/Unit';
import { Resource } from '../components/Resource';
import { UnitMechanicsSystem } from '../systems/UnitMechanicsSystem';
import { BuildingMechanicsSystem } from '../systems/BuildingMechanicsSystem';
import { GameStateSystem } from '../systems/GameStateSystem';
import { SaveLoadSystem } from '../systems/SaveLoadSystem';
import { PathfindingSystem } from '../systems/PathfindingSystem';
import { AIMicroSystem } from '../systems/AIMicroSystem';
import { RecastNavigation } from '../pathfinding/RecastNavigation';
import { getLocalPlayerId } from '@/store/gameSetupStore';
import { PerformanceMonitor } from './PerformanceMonitor';
import { ChecksumSystem, ChecksumConfig } from '../systems/ChecksumSystem';
import {
  isMultiplayerMode,
  isNetworkPaused,
  sendMultiplayerMessage,
  addMultiplayerMessageHandler,
  removeMultiplayerMessageHandler,
  reportDesync,
  getDesyncState,
} from '@/store/multiplayerStore';

// Multiplayer message types
// Supports two formats for backwards compatibility:
// 1. { type: 'command', payload: GameCommand } - Game.issueCommand format
// 2. { type: 'command', commandType: string, data: any } - WebGPUGameCanvas format
interface MultiplayerMessage {
  type: 'command' | 'quit';
  payload?: unknown;
  // Alternative format used by WebGPUGameCanvas
  commandType?: string;
  data?: unknown;
}
import { DesyncDetectionManager, DesyncDetectionConfig } from '../network/DesyncDetection';
import { bootstrapDefinitions } from '../definitions';

export type GameState = 'initializing' | 'running' | 'paused' | 'ended';

// Terrain cell for building placement validation
export interface TerrainCell {
  terrain: 'ground' | 'unwalkable' | 'ramp' | 'unbuildable' | 'creep';
  elevation: number; // 0-255 for new terrain system
  feature?: 'none' | 'water_shallow' | 'water_deep' | 'forest_light' | 'forest_dense' | 'mud' | 'road' | 'void' | 'cliff';
}

export interface GameConfig {
  mapWidth: number;
  mapHeight: number;
  tickRate: number;
  isMultiplayer: boolean;
  playerId: string;
  aiEnabled: boolean;
  aiDifficulty: AIDifficulty;
}

const DEFAULT_CONFIG: GameConfig = {
  mapWidth: 128,
  mapHeight: 128,
  tickRate: 20,
  isMultiplayer: false,
  playerId: 'player1',
  aiEnabled: true,
  aiDifficulty: 'medium',
};

export class Game {
  private static instance: Game | null = null;

  public world: World;
  public eventBus: EventBus;
  public config: GameConfig;
  public visionSystem: VisionSystem;
  public audioSystem: AudioSystem;
  public gameStateSystem: GameStateSystem;
  public saveLoadSystem: SaveLoadSystem;
  public pathfindingSystem: PathfindingSystem;
  public aiMicroSystem: AIMicroSystem;
  public selectionSystem!: SelectionSystem;

  // Determinism and multiplayer sync systems (only active in multiplayer)
  public checksumSystem: ChecksumSystem | null = null;
  public desyncDetection: DesyncDetectionManager | null = null;

  // Terrain grid for building placement validation and terrain features
  private terrainGrid: TerrainCell[][] | null = null;

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
    if (!this.terrainGrid) return null;

    const gridX = Math.floor(worldX);
    const gridY = Math.floor(worldY);

    if (gridY < 0 || gridY >= this.terrainGrid.length ||
        gridX < 0 || gridX >= this.terrainGrid[0].length) {
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

  // Decoration collision data for building placement (rocks, trees)
  private decorationCollisions: Array<{ x: number; z: number; radius: number }> = [];

  private gameLoop: GameLoop;
  private state: GameState = 'initializing';
  private currentTick = 0;

  private constructor(config: Partial<GameConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventBus = new EventBus();

    // Bootstrap definition registry from TypeScript data
    // This must happen before systems initialize as they depend on definitions
    bootstrapDefinitions();

    // Pass map dimensions for spatial grid initialization
    this.world = new World(this.config.mapWidth, this.config.mapHeight);
    this.gameLoop = new GameLoop(this.config.tickRate, this.update.bind(this));

    // Initialize vision system (needs to be created before other systems)
    // Note: passing `this` is safe here since VisionSystem doesn't use game in constructor
    this.visionSystem = new VisionSystem(this, this.config.mapWidth, this.config.mapHeight);

    // Initialize audio system (needs camera later for spatial audio)
    this.audioSystem = new AudioSystem(this);

    // Initialize game state system for victory/defeat tracking
    this.gameStateSystem = new GameStateSystem(this);

    // Initialize save/load system
    this.saveLoadSystem = new SaveLoadSystem(this);

    // Initialize pathfinding system
    this.pathfindingSystem = new PathfindingSystem(this, this.config.mapWidth, this.config.mapHeight);

    // Initialize AI micro system
    this.aiMicroSystem = new AIMicroSystem(this);

    // Initialize checksum system ONLY for multiplayer - no overhead in single-player
    if (this.config.isMultiplayer) {
      this.checksumSystem = new ChecksumSystem(this, {
        checksumInterval: 5,
        emitNetworkChecksums: true,
        logChecksums: false,
        autoDumpOnDesync: true,
      });

      this.desyncDetection = new DesyncDetectionManager(this, {
        enabled: true,
        pauseOnDesync: false,
        showDesyncIndicator: true,
      });
      this.desyncDetection.setChecksumSystem(this.checksumSystem);

      // Set up multiplayer message handler for receiving remote commands
      this.setupMultiplayerMessageHandler();

      // Set up desync handler - SC2-style: end game on desync
      this.setupDesyncHandler();
    }

    this.initializeSystems();
  }

  // Multiplayer message handler reference (for cleanup)
  private multiplayerMessageHandler: ((data: unknown) => void) | null = null;

  private setupMultiplayerMessageHandler(): void {
    this.multiplayerMessageHandler = (data: unknown) => {
      const message = data as MultiplayerMessage;
      if (message.type === 'command') {
        // Handle two message formats:
        // Format 1: { type: 'command', payload: GameCommand } - from Game.issueCommand
        // Format 2: { type: 'command', commandType: string, data: any } - from WebGPUGameCanvas
        if (message.payload) {
          // Format 1: GameCommand in payload
          const command = message.payload as GameCommand;
          console.log('[Game] Received remote command (payload format):', command.type, 'from', command.playerId);
          this.processCommand(command);
        } else if (message.commandType && message.data) {
          // Format 2: Event-based command from WebGPUGameCanvas
          // Emit directly to event bus for systems to process
          console.log('[Game] Received remote command (event format):', message.commandType);
          this.eventBus.emit(message.commandType, message.data);
        }
      } else if (message.type === 'quit') {
        console.log('[Game] Remote player quit');
        this.eventBus.emit('multiplayer:playerQuit', message.payload);
      }
    };
    addMultiplayerMessageHandler(this.multiplayerMessageHandler);
  }

  /**
   * Set up desync handler - SC2-style: end game on desync
   * When a desync is detected, we cannot recover (deterministic simulation diverged)
   * so we end the game and notify players.
   */
  private setupDesyncHandler(): void {
    this.eventBus.on('desync:detected', (data: {
      tick: number;
      localChecksum: number;
      remoteChecksum: number;
      remotePeerId: string;
    }) => {
      console.error(`[Game] DESYNC at tick ${data.tick}! Game state has diverged.`);

      // Update multiplayer store with desync state
      reportDesync(data.tick);

      // Emit game-ending desync event for UI
      this.eventBus.emit('multiplayer:desync', {
        tick: data.tick,
        localChecksum: data.localChecksum,
        remoteChecksum: data.remoteChecksum,
        message: `Game desynchronized at tick ${data.tick}. The game cannot continue.`,
      });

      // End the game state (but don't stop() - let UI handle that)
      this.state = 'ended';
    });
  }

  public static getInstance(config?: Partial<GameConfig>): Game {
    if (!Game.instance) {
      debugInitialization.log(`[Game] CREATING NEW INSTANCE with config:`, config ? `${config.mapWidth}x${config.mapHeight}` : 'DEFAULT 128x128');
      Game.instance = new Game(config);
    } else if (config && (config.mapWidth || config.mapHeight)) {
      // Update map dimensions if a new config is provided with map settings
      // This handles cases where components access Game before GameCanvas initializes it
      const oldWidth = Game.instance.config.mapWidth;
      const oldHeight = Game.instance.config.mapHeight;
      if (config.mapWidth) Game.instance.config.mapWidth = config.mapWidth;
      if (config.mapHeight) Game.instance.config.mapHeight = config.mapHeight;

      // Reinitialize systems if dimensions changed (keep same instance to preserve event listeners)
      if (Game.instance.config.mapWidth !== oldWidth || Game.instance.config.mapHeight !== oldHeight) {
        debugInitialization.log(`[Game] DIMENSION CHANGE: ${oldWidth}x${oldHeight} -> ${Game.instance.config.mapWidth}x${Game.instance.config.mapHeight}, calling reinitialize`);
        Game.instance.pathfindingSystem.reinitialize(
          Game.instance.config.mapWidth,
          Game.instance.config.mapHeight
        );
        Game.instance.visionSystem.reinitialize(
          Game.instance.config.mapWidth,
          Game.instance.config.mapHeight
        );
      }
    }
    return Game.instance;
  }

  public static resetInstance(): void {
    if (Game.instance) {
      Game.instance.stop();
      Game.instance = null;
    }
    // Reset navmesh singleton so new game gets fresh navmesh for its map
    RecastNavigation.resetInstance();
  }

  private initializeSystems(): void {
    // Add systems in order of execution
    this.world.addSystem(new SpawnSystem(this));
    this.world.addSystem(new BuildingPlacementSystem(this));
    this.selectionSystem = new SelectionSystem(this);
    this.world.addSystem(this.selectionSystem);
    this.world.addSystem(this.pathfindingSystem); // Dynamic pathfinding with obstacle detection
    this.world.addSystem(new BuildingMechanicsSystem(this)); // Lift-off, Addons, Building attacks
    this.world.addSystem(new UnitMechanicsSystem(this)); // Transform, Cloak, Transport, Heal, Repair
    this.world.addSystem(new MovementSystem(this));
    this.world.addSystem(new CombatSystem(this));
    this.world.addSystem(new ProductionSystem(this));
    this.world.addSystem(new ResourceSystem(this));
    this.world.addSystem(new ResearchSystem(this));
    this.world.addSystem(new AbilitySystem(this));
    this.world.addSystem(this.visionSystem);
    this.world.addSystem(this.audioSystem);
    this.world.addSystem(this.gameStateSystem); // Victory/defeat conditions
    this.world.addSystem(this.saveLoadSystem); // Save/Load functionality

    if (this.config.aiEnabled) {
      const enhancedAI = new EnhancedAISystem(this, this.config.aiDifficulty);
      this.world.addSystem(enhancedAI);
      this.world.addSystem(this.aiMicroSystem); // AI unit micro (kiting, focus fire)
      // NOTE: AI player registration with AIMicroSystem happens in spawnInitialEntities()
      // This ensures the store has the correct player configuration when registration occurs
      // Do NOT register here as the store may have stale/default state at this point
    }

    // Checksum system runs LAST to capture final state after all gameplay systems
    // Only added in multiplayer - no overhead in single-player
    if (this.checksumSystem) {
      this.world.addSystem(this.checksumSystem);
    }
  }

  /**
   * Start the game with a countdown.
   *
   * MULTIPLAYER ARCHITECTURE:
   * The game start is based on wall-clock time, NOT on the countdown visual.
   * This ensures all clients start at exactly the same time, even if:
   * - A client's browser tab is in the background
   * - The countdown visual is lagging or skipped
   * - Network latency varies between clients
   *
   * For multiplayer, the server will provide a `gameStartTime` that all clients use.
   * For single player, we calculate it locally as now + countdown duration.
   *
   * @param gameStartTime Optional wall-clock time (Date.now()) when game should start.
   *                      If not provided, starts after countdown duration (4 seconds).
   */
  public start(gameStartTime?: number): void {
    if (this.state === 'running') return;

    // Set state to 'initializing' so we don't try to start twice
    this.state = 'initializing';

    // Calculate when the game should actually start (wall-clock time)
    const countdownDuration = 4000; // 3, 2, 1, GO = 4 seconds
    const scheduledStartTime = gameStartTime ?? (Date.now() + countdownDuration);

    const startGameLoop = () => {
      if (this.state === 'running') return; // Already started
      this.state = 'running';
      this.gameLoop.start();
      PerformanceMonitor.start(); // Start performance monitoring
      this.eventBus.emit('game:started', { tick: this.currentTick });
    };

    // Show countdown visual - this is purely cosmetic
    // The countdown uses a Web Worker for timing (not throttled in background tabs)
    this.eventBus.emit('game:countdown', { startTime: scheduledStartTime });

    // Schedule the actual game start at the predetermined time
    // This uses setTimeout which works independently of the visual countdown
    const delayUntilStart = scheduledStartTime - Date.now();

    if (delayUntilStart <= 0) {
      // Start time is in the past (e.g., tab was backgrounded) - start immediately
      debugInitialization.log('[Game] Start time already passed - starting immediately');
      startGameLoop();
    } else {
      // Schedule game start at exact wall-clock time
      debugInitialization.log(`[Game] Scheduling game start in ${delayUntilStart}ms`);
      setTimeout(() => {
        if (this.state !== 'running') {
          startGameLoop();
        }
      }, delayUntilStart);
    }

    // Also listen for countdown complete as a backup (in case setTimeout drifts)
    // This ensures the game starts even if there's minor timing discrepancy
    this.eventBus.once('game:countdownComplete', () => {
      if (this.state !== 'running') {
        debugInitialization.log('[Game] Countdown complete - starting game');
        startGameLoop();
      }
    });
  }

  public pause(): void {
    if (this.state !== 'running') return;

    this.state = 'paused';
    this.gameLoop.stop();
    this.eventBus.emit('game:paused', { tick: this.currentTick });
  }

  public resume(): void {
    if (this.state !== 'paused') return;

    this.state = 'running';
    this.gameLoop.start();
    this.eventBus.emit('game:resumed', { tick: this.currentTick });
  }

  public stop(): void {
    this.state = 'ended';
    this.gameLoop.stop();
    PerformanceMonitor.stop(); // Stop performance monitoring

    // Notify remote player in multiplayer
    this.notifyQuit();

    // Clean up multiplayer message handler
    if (this.multiplayerMessageHandler) {
      removeMultiplayerMessageHandler(this.multiplayerMessageHandler);
      this.multiplayerMessageHandler = null;
    }

    this.eventBus.emit('game:ended', { tick: this.currentTick });
  }

  private update(deltaTime: number): void {
    if (this.state !== 'running') return;

    // In multiplayer, pause if network is paused (disconnection/reconnection)
    if (this.config.isMultiplayer && isNetworkPaused()) {
      // Don't advance game state while waiting for connection
      return;
    }

    // In multiplayer, check for desync state
    if (this.config.isMultiplayer && getDesyncState() === 'desynced') {
      // Game should end on desync - don't process any more ticks
      return;
    }

    const tickStart = performance.now();

    this.currentTick++;

    // Set current tick for query cache invalidation
    this.world.setCurrentTick(this.currentTick);

    // Update all systems
    this.world.update(deltaTime);

    // Emit tick event
    this.eventBus.emit('game:tick', {
      tick: this.currentTick,
      deltaTime,
    });

    const tickElapsed = performance.now() - tickStart;

    // Record tick time for performance monitoring
    PerformanceMonitor.recordTickTime(tickElapsed);

    // Update entity counts every 20 ticks (1 second at 20 tick/sec)
    if (this.currentTick % 20 === 0) {
      this.updateEntityCounts();
    }

    if (tickElapsed > 10) {
      debugPerformance.warn(`[Game] TICK ${this.currentTick}: ${tickElapsed.toFixed(1)}ms`);
    }
  }

  /**
   * Update entity counts for performance monitoring
   */
  private updateEntityCounts(): void {
    const units = this.world.getEntitiesWith('Unit', 'Transform');
    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    const projectiles = this.world.getEntitiesWith('Projectile');

    PerformanceMonitor.updateEntityCounts({
      total: this.world.getEntityCount(),
      units: units.length,
      buildings: buildings.length,
      resources: resources.length,
      projectiles: projectiles.length,
      effects: 0, // Could add effect entity tracking if needed
    });
  }

  public getState(): GameState {
    return this.state;
  }

  public getCurrentTick(): number {
    return this.currentTick;
  }

  public getGameTime(): number {
    return this.currentTick / this.config.tickRate;
  }

  /**
   * Set the terrain grid for building placement validation
   * Should be called after map is loaded
   */
  public setTerrainGrid(terrain: TerrainCell[][]): void {
    debugInitialization.log(`[Game] SET_TERRAIN_GRID: ${terrain[0]?.length}x${terrain.length}, pathfinding dimensions: ${this.config.mapWidth}x${this.config.mapHeight}`);
    this.terrainGrid = terrain;
    // Legacy call - navmesh is now initialized separately via initializeNavMesh
    this.pathfindingSystem.loadTerrainData();
  }

  /**
   * Initialize the navmesh for pathfinding from terrain walkable geometry.
   * Should be called after terrain is created.
   */
  public async initializeNavMesh(
    positions: Float32Array,
    indices: Uint32Array
  ): Promise<boolean> {
    debugInitialization.log(`[Game] INITIALIZING_NAVMESH: ${positions.length / 3} vertices, ${indices.length / 3} triangles`);
    return this.pathfindingSystem.initializeNavMesh(positions, indices);
  }

  /**
   * Set decoration collision data for building placement validation and pathfinding.
   * Should be called after environment is loaded.
   * Large decorations (radius > 1) will also block pathfinding cells.
   */
  public setDecorationCollisions(collisions: Array<{ x: number; z: number; radius: number }>): void {
    this.decorationCollisions = collisions;

    // Register large decorations with pathfinding system
    // This prevents units from trying to path through rock formations
    this.pathfindingSystem.registerDecorationCollisions(collisions);
  }

  /**
   * Get decoration collision data for building placement validation
   */
  public getDecorationCollisions(): Array<{ x: number; z: number; radius: number }> {
    return this.decorationCollisions;
  }

  /**
   * Check if a building position overlaps with decorations (rocks, trees)
   */
  public isPositionClearOfDecorations(centerX: number, centerY: number, width: number, height: number): boolean {
    const halfW = width / 2 + 0.5; // Small buffer
    const halfH = height / 2 + 0.5;

    for (const deco of this.decorationCollisions) {
      // Check if decoration is within the building footprint
      const dx = Math.abs(centerX - deco.x);
      const dz = Math.abs(centerY - deco.z);

      if (dx < halfW + deco.radius && dz < halfH + deco.radius) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a building can be placed at the given position
   * Returns true if all tiles under the building are walkable ground at the same elevation
   */
  public isValidTerrainForBuilding(centerX: number, centerY: number, width: number, height: number): boolean {
    if (!this.terrainGrid) {
      // No terrain data - allow placement (legacy behavior)
      return true;
    }

    const halfWidth = width / 2;
    const halfHeight = height / 2;
    let requiredElevation: number | null = null;

    // Check all tiles the building would occupy
    for (let dy = -Math.floor(halfHeight); dy < Math.ceil(halfHeight); dy++) {
      for (let dx = -Math.floor(halfWidth); dx < Math.ceil(halfWidth); dx++) {
        const tileX = Math.floor(centerX + dx);
        const tileY = Math.floor(centerY + dy);

        // Check bounds
        if (tileY < 0 || tileY >= this.terrainGrid.length ||
            tileX < 0 || tileX >= this.terrainGrid[0].length) {
          return false;
        }

        const cell = this.terrainGrid[tileY][tileX];

        // Must be buildable ground (not unwalkable, ramp, or unbuildable)
        if (cell.terrain !== 'ground') {
          return false;
        }

        // All tiles must be at the same elevation
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
   * Check if a building can be placed at the given position
   * This performs all validation checks: terrain, buildings, resources, units, and decorations
   * Buildings can be placed directly adjacent to each other (no spacing buffer)
   *
   * PERF: Uses spatial grid queries instead of O(n) loops for buildings and units
   */
  public isValidBuildingPlacement(centerX: number, centerY: number, width: number, height: number, excludeEntityId?: number, skipUnitCheck: boolean = false): boolean {
    const halfW = width / 2;
    const halfH = height / 2;

    // Check map bounds
    if (centerX - halfW < 0 || centerY - halfH < 0 ||
        centerX + halfW > this.config.mapWidth || centerY + halfH > this.config.mapHeight) {
      return false;
    }

    // Check terrain validity (must be on ground, same elevation, not on ramps/cliffs)
    if (!this.isValidTerrainForBuilding(centerX, centerY, width, height)) {
      return false;
    }

    // PERF: Use spatial grid query instead of iterating all buildings
    // Query area slightly larger than building footprint to catch nearby entities
    const queryPadding = 10; // Max building half-size plus buffer
    const nearbyBuildingIds = this.world.buildingGrid.queryRect(
      centerX - halfW - queryPadding,
      centerY - halfH - queryPadding,
      centerX + halfW + queryPadding,
      centerY + halfH + queryPadding
    );

    // Check for overlapping buildings (no buffer - buildings can touch but not overlap)
    for (const buildingId of nearbyBuildingIds) {
      const entity = this.world.getEntity(buildingId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!transform || !building) continue;

      const existingHalfW = building.width / 2;
      const existingHalfH = building.height / 2;
      const dx = Math.abs(centerX - transform.x);
      const dy = Math.abs(centerY - transform.y);

      // Buildings can be placed directly adjacent (touching) but not overlapping
      if (dx < halfW + existingHalfW && dy < halfH + existingHalfH) {
        return false;
      }
    }

    // Check for overlapping resources (typically ~10-50 per map, so O(n) is acceptable)
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

    // PERF: Use spatial grid query instead of iterating all units
    // Skip unit check if requested (units will be pushed away after placement)
    if (!skipUnitCheck) {
      const nearbyUnitIds = this.world.unitGrid.queryRect(
        centerX - halfW - 2,
        centerY - halfH - 2,
        centerX + halfW + 2,
        centerY + halfH + 2
      );

      // Check for overlapping units (exclude the builder worker)
      for (const unitId of nearbyUnitIds) {
        // Skip the worker who will build this structure
        if (excludeEntityId !== undefined && unitId === excludeEntityId) {
          continue;
        }

        const entity = this.world.getEntity(unitId);
        if (!entity) continue;

        const transform = entity.get<Transform>('Transform');
        if (!transform) continue;

        const dx = Math.abs(centerX - transform.x);
        const dy = Math.abs(centerY - transform.y);

        if (dx < halfW + 0.5 && dy < halfH + 0.5) {
          return false;
        }
      }
    }

    // Check for overlapping decorations (rocks, trees, etc.)
    if (!this.isPositionClearOfDecorations(centerX, centerY, width, height)) {
      return false;
    }

    return true;
  }

  /**
   * Issue a command from the local player.
   * In multiplayer, this sends the command to the remote player AND processes locally.
   * In single player, this just processes the command locally.
   */
  public issueCommand(command: GameCommand): void {
    // In multiplayer, send to remote player
    if (isMultiplayerMode()) {
      const message: MultiplayerMessage = {
        type: 'command',
        payload: command,
      };
      sendMultiplayerMessage(message);
      console.log('[Game] Sent command to remote:', command.type);
    }

    // Process locally
    this.processCommand(command);
  }

  /**
   * Notify remote player that we're quitting
   */
  public notifyQuit(): void {
    if (isMultiplayerMode()) {
      const message: MultiplayerMessage = {
        type: 'quit',
        payload: { playerId: this.config.playerId },
      };
      sendMultiplayerMessage(message);
      console.log('[Game] Sent quit notification');
    }
  }

  // Command processing for multiplayer lockstep
  public processCommand(command: GameCommand): void {
    this.eventBus.emit('command:received', command);

    switch (command.type) {
      case 'MOVE':
        this.eventBus.emit('command:move', command);
        break;
      case 'ATTACK':
        this.eventBus.emit('command:attack', command);
        break;
      case 'BUILD':
        this.eventBus.emit('command:build', command);
        break;
      case 'TRAIN':
        this.eventBus.emit('command:train', command);
        break;
      case 'ABILITY':
        this.eventBus.emit('command:ability', command);
        break;
      case 'STOP':
        this.eventBus.emit('command:stop', command);
        break;
      case 'HOLD':
        this.eventBus.emit('command:hold', command);
        break;
      case 'RESEARCH':
        this.eventBus.emit('command:research', command);
        break;
      case 'PATROL':
        this.eventBus.emit('command:patrol', command);
        break;
      case 'TRANSFORM':
        this.eventBus.emit('command:transform', {
          entityIds: command.entityIds,
          targetMode: command.targetMode,
        });
        break;
      case 'CLOAK':
        this.eventBus.emit('command:cloak', {
          entityIds: command.entityIds,
        });
        break;
      case 'LOAD':
        this.eventBus.emit('command:load', {
          transportId: command.transportId,
          unitIds: command.entityIds,
        });
        break;
      case 'UNLOAD':
        this.eventBus.emit('command:unload', {
          transportId: command.transportId,
          position: command.targetPosition,
          unitId: command.targetEntityId,
        });
        break;
      case 'LOAD_BUNKER':
        this.eventBus.emit('command:loadBunker', {
          bunkerId: command.bunkerId,
          unitIds: command.entityIds,
        });
        break;
      case 'UNLOAD_BUNKER':
        this.eventBus.emit('command:unloadBunker', {
          bunkerId: command.bunkerId,
          unitId: command.targetEntityId,
        });
        break;
      case 'HEAL':
        this.eventBus.emit('command:heal', {
          healerId: command.entityIds[0],
          targetId: command.targetEntityId,
        });
        break;
      case 'REPAIR':
        this.eventBus.emit('command:repair', {
          repairerId: command.entityIds[0],
          targetId: command.targetEntityId,
        });
        break;
      case 'DEMOLISH':
        this.eventBus.emit('command:demolish', {
          entityIds: command.entityIds,
        });
        break;
      case 'LIFTOFF':
        this.eventBus.emit('command:liftOff', {
          buildingId: command.buildingId ?? command.entityIds[0],
          playerId: command.playerId,
        });
        break;
      case 'LAND':
        this.eventBus.emit('command:land', {
          buildingId: command.buildingId ?? command.entityIds[0],
          targetPosition: command.targetPosition,
          playerId: command.playerId,
        });
        break;
      case 'RALLY':
        this.eventBus.emit('command:rally', {
          buildingId: command.buildingId ?? command.entityIds[0],
          targetPosition: command.targetPosition,
          targetEntityId: command.targetEntityId,
          playerId: command.playerId,
        });
        break;
      case 'GATHER':
        this.eventBus.emit('command:gather', {
          entityIds: command.entityIds,
          targetEntityId: command.targetEntityId,
          playerId: command.playerId,
        });
        break;
      case 'CANCEL_PRODUCTION':
        this.eventBus.emit('production:cancel', {
          entityId: command.entityIds[0],
          queueIndex: command.queueIndex ?? 0,
          playerId: command.playerId,
        });
        break;
      case 'CANCEL_RESEARCH':
        this.eventBus.emit('research:cancel', {
          entityId: command.entityIds[0],
          playerId: command.playerId,
        });
        break;
      case 'CANCEL_BUILDING':
        this.eventBus.emit('building:cancel', {
          entityId: command.entityIds[0],
          playerId: command.playerId,
        });
        break;
      case 'QUEUE_REORDER':
        this.eventBus.emit('production:reorder', {
          entityId: command.entityIds[0],
          queueIndex: command.queueIndex ?? 0,
          newQueueIndex: command.newQueueIndex ?? 0,
          playerId: command.playerId,
        });
        break;
      case 'SUPPLY_DEPOT_LOWER':
        this.eventBus.emit('command:lowerSupplyDepot', {
          buildingId: command.entityIds[0],
          lower: true,
          playerId: command.playerId,
        });
        break;
      case 'SUPPLY_DEPOT_RAISE':
        this.eventBus.emit('command:lowerSupplyDepot', {
          buildingId: command.entityIds[0],
          lower: false,
          playerId: command.playerId,
        });
        break;
      case 'SET_AUTOCAST':
        this.eventBus.emit('ability:setAutocast', {
          entityId: command.entityIds[0],
          abilityId: command.abilityId,
          enabled: command.autocastEnabled ?? false,
          playerId: command.playerId,
        });
        break;
      case 'BUILD_WALL':
        this.eventBus.emit('wall:build', {
          segments: command.wallSegments ?? [],
          playerId: command.playerId,
        });
        break;
      case 'ADDON_LIFT':
        this.eventBus.emit('addon:lift', {
          buildingId: command.buildingId ?? command.entityIds[0],
          playerId: command.playerId,
        });
        break;
      case 'ADDON_LAND':
        this.eventBus.emit('addon:land', {
          buildingId: command.buildingId ?? command.entityIds[0],
          targetPosition: command.targetPosition,
          playerId: command.playerId,
        });
        break;
    }
  }
}

export interface GameCommand {
  tick: number;
  playerId: string;
  type:
    | 'MOVE'
    | 'ATTACK'
    | 'BUILD'
    | 'TRAIN'
    | 'ABILITY'
    | 'STOP'
    | 'HOLD'
    | 'RESEARCH'
    | 'TRANSFORM'
    | 'CLOAK'
    | 'LOAD'
    | 'UNLOAD'
    | 'LOAD_BUNKER'
    | 'UNLOAD_BUNKER'
    | 'HEAL'
    | 'REPAIR'
    | 'PATROL'
    | 'DEMOLISH'
    | 'LIFTOFF'
    | 'LAND'
    | 'RALLY'
    | 'GATHER'
    // New command types for 100% multiplayer sync
    | 'CANCEL_PRODUCTION'
    | 'CANCEL_RESEARCH'
    | 'CANCEL_BUILDING'
    | 'QUEUE_REORDER'
    | 'SUPPLY_DEPOT_LOWER'
    | 'SUPPLY_DEPOT_RAISE'
    | 'SET_AUTOCAST'
    | 'BUILD_WALL'
    | 'ADDON_LIFT'
    | 'ADDON_LAND';
  entityIds: number[];
  targetPosition?: { x: number; y: number };
  targetEntityId?: number;
  buildingType?: string;
  unitType?: string;
  abilityId?: string;
  upgradeId?: string;
  targetMode?: string; // For transform
  transportId?: number; // For load/unload
  bunkerId?: number; // For bunker load/unload
  buildingId?: number; // For liftoff/land
  // New fields for additional commands
  queueIndex?: number; // For cancel/reorder production
  newQueueIndex?: number; // For queue reorder (move to position)
  autocastEnabled?: boolean; // For SET_AUTOCAST
  wallSegments?: Array<{ x: number; y: number }>; // For BUILD_WALL
}

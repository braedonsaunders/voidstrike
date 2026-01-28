import { World } from '../ecs/World';
import { GameLoop } from './GameLoop';
import { EventBus } from './EventBus';
import { SystemRegistry } from './SystemRegistry';
import { getSystemDefinitions } from '../systems/systemDependencies';

// Systems that need direct references in Game class
import { SelectionSystem } from '../systems/SelectionSystem';
import { ProjectileSystem } from '../systems/ProjectileSystem';
import { AIDifficulty } from '../systems/EnhancedAISystem';
import { VisionSystem } from '../systems/VisionSystem';
import { AudioSystem } from '../systems/AudioSystem';
import { GameStateSystem } from '../systems/GameStateSystem';
import { SaveLoadSystem } from '../systems/SaveLoadSystem';
import { PathfindingSystem } from '../systems/PathfindingSystem';
import { AIMicroSystem } from '../systems/AIMicroSystem';
import { ChecksumSystem } from '../systems/ChecksumSystem';

import { debugInitialization, debugPerformance, debugNetworking } from '@/utils/debugLogger';
import { validateEntity } from '@/utils/EntityValidator';
import { dispatchCommand, type GameCommand } from './GameCommand';
import { Transform } from '../components/Transform';
import { Building } from '../components/Building';
import { Unit } from '../components/Unit';
import { Resource } from '../components/Resource';
import { Selectable } from '../components/Selectable';
import { RecastNavigation } from '../pathfinding/RecastNavigation';
import { getLocalPlayerId } from '@/store/gameSetupStore';
import { PerformanceMonitor } from './PerformanceMonitor';
import {
  isMultiplayerMode,
  isNetworkPaused,
  sendMultiplayerMessage,
  addMultiplayerMessageHandler,
  removeMultiplayerMessageHandler,
  reportDesync,
  getDesyncState,
  useMultiplayerStore,
} from '@/store/multiplayerStore';

// Multiplayer message types
// Supports two formats for backwards compatibility:
// 1. { type: 'command', payload: GameCommand } - Game.issueCommand format
// 2. { type: 'command', commandType: string, data: any } - WebGPUGameCanvas format
interface MultiplayerMessage {
  type: 'command' | 'quit' | 'checksum';
  payload?: unknown;
  // Alternative format used by WebGPUGameCanvas
  commandType?: string;
  data?: unknown;
}
import { DesyncDetectionManager, DesyncDetectionConfig } from '../network/DesyncDetection';
import { bootstrapDefinitions } from '../definitions';
import type { GameStatePort } from './GameStatePort';
import { ZustandStateAdapter } from '@/adapters/ZustandStateAdapter';

export type GameState = 'initializing' | 'running' | 'paused' | 'ended';

// Terrain cell for building placement validation
export interface TerrainCell {
  terrain: 'ground' | 'platform' | 'unwalkable' | 'ramp' | 'unbuildable' | 'creep';
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

  public statePort: GameStatePort;
  public world: World;
  public eventBus: EventBus;
  public config: GameConfig;
  public visionSystem: VisionSystem;
  public audioSystem: AudioSystem;
  public gameStateSystem: GameStateSystem;
  public saveLoadSystem: SaveLoadSystem;
  public pathfindingSystem: PathfindingSystem;
  public aiMicroSystem: AIMicroSystem;
  // Systems assigned during initializeSystems() - null until then
  private _selectionSystem: SelectionSystem | null = null;
  private _projectileSystem: ProjectileSystem | null = null;

  /**
   * Get the SelectionSystem instance.
   * @throws Error if accessed before system initialization
   */
  public get selectionSystem(): SelectionSystem {
    if (!this._selectionSystem) {
      throw new Error('[Game] SelectionSystem accessed before initialization');
    }
    return this._selectionSystem;
  }

  /**
   * Get the ProjectileSystem instance.
   * @throws Error if accessed before system initialization
   */
  public get projectileSystem(): ProjectileSystem {
    if (!this._projectileSystem) {
      throw new Error('[Game] ProjectileSystem accessed before initialization');
    }
    return this._projectileSystem;
  }

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

  // Decoration collision data for building placement (rocks, trees)
  private decorationCollisions: Array<{ x: number; z: number; radius: number }> = [];

  private gameLoop: GameLoop;
  private state: GameState = 'initializing';
  private currentTick = 0;

  // Mutex flag to prevent double game start race condition
  private startMutex = false;

  // Command queue for lockstep multiplayer - commands are scheduled for future ticks
  private commandQueue: Map<number, GameCommand[]> = new Map();
  // Number of ticks to delay command execution (allows time for network sync)
  // FIX: Increased from 2 to 4 ticks (200ms at 20 TPS) to handle high-latency connections
  // 2 ticks (100ms) was too aggressive and caused stale command desyncs on connections >100ms RTT
  private readonly COMMAND_DELAY_TICKS = 4;

  // LOCKSTEP BARRIER: Track which players have sent commands for each tick
  // Format: Map<tick, Set<playerId>>
  private tickCommandReceipts: Map<number, Set<string>> = new Map();
  // Maximum ticks to wait for remote commands before triggering desync (10 ticks = 500ms at 20 tick/sec)
  private readonly LOCKSTEP_TIMEOUT_TICKS = 10;

  private constructor(config: Partial<GameConfig> = {}, statePort?: GameStatePort) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.statePort = statePort ?? new ZustandStateAdapter();
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

      // Set up desync handler - end game on desync
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
          // Format 1: GameCommand in payload - LOCKSTEP: queue for scheduled tick
          const command = message.payload as GameCommand;

          // SECURITY FIX: Validate that the command's playerId matches the remote peer
          // This prevents a malicious player from spoofing commands as another player
          const remotePeerId = useMultiplayerStore.getState().remotePeerId;
          if (command.playerId !== remotePeerId) {
            console.error(
              `[Game] SECURITY: Rejected command with spoofed playerId. ` +
              `Expected: ${remotePeerId}, Got: ${command.playerId}. Command type: ${command.type}`
            );
            this.eventBus.emit('security:spoofedPlayerId', {
              expectedPlayerId: remotePeerId,
              spoofedPlayerId: command.playerId,
              commandType: command.type,
              tick: command.tick,
            });
            return; // Reject the command
          }

          // SECURITY FIX: Validate command tick is within acceptable range
          // Prevents commands scheduled for absurdly far future or past
          const minTick = this.currentTick - this.COMMAND_DELAY_TICKS;
          const maxTick = this.currentTick + 100; // Allow up to 100 ticks (~5 seconds) in future
          if (command.tick < minTick || command.tick > maxTick) {
            console.error(
              `[Game] SECURITY: Rejected command with invalid tick. ` +
              `Current: ${this.currentTick}, Command tick: ${command.tick}, Valid range: [${minTick}, ${maxTick}]`
            );
            this.eventBus.emit('security:invalidCommandTick', {
              playerId: command.playerId,
              commandType: command.type,
              commandTick: command.tick,
              currentTick: this.currentTick,
            });
            return; // Reject the command
          }

          debugNetworking.log('[Game] Received remote command for tick', command.tick, ':', command.type, 'from', command.playerId);
          // Queue for execution at the scheduled tick (lockstep)
          this.queueCommand(command);
        } else if (message.commandType && message.data) {
          // Format 2: Event-based command from WebGPUGameCanvas
          // Emit directly to event bus for systems to process
          debugNetworking.log('[Game] Received remote command (event format):', message.commandType);
          this.eventBus.emit(message.commandType, message.data);
        }
      } else if (message.type === 'quit') {
        debugNetworking.log('[Game] Remote player quit');
        this.eventBus.emit('multiplayer:playerQuit', message.payload);
      } else if (message.type === 'checksum') {
        // CRITICAL FIX: Receive remote checksums and forward to ChecksumSystem
        const checksumData = message.payload as {
          tick: number;
          checksum: number;
          unitCount: number;
          buildingCount: number;
          resourceSum: number;
          peerId: string;
        };
        this.eventBus.emit('network:checksum', checksumData);
      }
    };
    addMultiplayerMessageHandler(this.multiplayerMessageHandler);

    // CRITICAL FIX: Wire local checksum events to network transmission
    // This was missing - checksums were computed but never sent to peers
    this.eventBus.on('checksum:computed', (data: {
      tick: number;
      checksum: number;
      unitCount: number;
      buildingCount: number;
      resourceSum: number;
    }) => {
      const message = {
        type: 'checksum' as const,
        payload: {
          ...data,
          peerId: this.config.playerId,
        },
      };
      sendMultiplayerMessage(message);
    });
  }

  /**
   * Set up desync handler - end game on desync
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

  public static getInstance(config?: Partial<GameConfig>, statePort?: GameStatePort): Game {
    if (!Game.instance) {
      debugInitialization.log(`[Game] CREATING NEW INSTANCE with config:`, config ? `${config.mapWidth}x${config.mapHeight}` : 'DEFAULT 128x128');
      Game.instance = new Game(config, statePort);
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
    // Use SystemRegistry for dependency-based ordering
    // This replaces the old priority-based system which had conflicts
    const registry = new SystemRegistry();
    registry.registerAll(getSystemDefinitions());

    // Validate dependencies at startup
    const errors = registry.validate();
    if (errors.length > 0) {
      console.error('[Game] System dependency errors:', errors);
      throw new Error(`Invalid system dependencies:\n${errors.join('\n')}`);
    }

    // Log execution order for debugging
    const order = registry.getExecutionOrder();
    debugInitialization.log('[Game] System execution order:', order.join(' → '));

    // Create systems in dependency order
    const systems = registry.createSystems(this);

    // Add all systems to world
    for (const system of systems) {
      this.world.addSystem(system);

      // Capture references to systems that are accessed elsewhere
      if (system.name === 'SelectionSystem') {
        this._selectionSystem = system as SelectionSystem;
      } else if (system.name === 'ProjectileSystem') {
        this._projectileSystem = system as ProjectileSystem;
      }
    }

    // NOTE: AI player registration with AIMicroSystem happens in spawnInitialEntities()
    // This ensures the store has the correct player configuration when registration occurs
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

    // Atomic start function with mutex to prevent race condition
    const startGameLoop = () => {
      // Use mutex to ensure only one path can start the game
      if (this.startMutex || this.state === 'running') return;
      this.startMutex = true;

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
        startGameLoop();
      }, delayUntilStart);
    }

    // Also listen for countdown complete as a backup (in case setTimeout drifts)
    // This ensures the game starts even if there's minor timing discrepancy
    this.eventBus.once('game:countdownComplete', () => {
      debugInitialization.log('[Game] Countdown complete - starting game');
      startGameLoop();
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

    // Clean up all event listeners to prevent memory leaks and duplicate handlers
    // This must be done AFTER emitting game:ended so handlers can respond to shutdown
    this.eventBus.clear();

    // Reset command queue for clean restart
    this.commandQueue.clear();

    // Reset start mutex so game can be started again
    this.startMutex = false;
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

    // LOCKSTEP: Process any commands scheduled for this tick (before systems update)
    if (this.config.isMultiplayer) {
      this.processQueuedCommands();
    }

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
   * Initialize the water navmesh for naval unit pathfinding.
   * Should be called after terrain is created if the map has water.
   */
  public async initializeWaterNavMesh(
    positions: Float32Array,
    indices: Uint32Array
  ): Promise<boolean> {
    debugInitialization.log(`[Game] INITIALIZING_WATER_NAVMESH: ${positions.length / 3} vertices, ${indices.length / 3} triangles`);
    return this.pathfindingSystem.initializeWaterNavMesh(positions, indices);
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
    const firstRow = this.terrainGrid[0];
    if (!firstRow) return false; // Empty terrain grid

    for (let dy = -Math.floor(halfHeight); dy < Math.ceil(halfHeight); dy++) {
      for (let dx = -Math.floor(halfWidth); dx < Math.ceil(halfWidth); dx++) {
        const tileX = Math.floor(centerX + dx);
        const tileY = Math.floor(centerY + dy);

        // Check bounds
        if (tileY < 0 || tileY >= this.terrainGrid.length ||
            tileX < 0 || tileX >= firstRow.length) {
          return false;
        }

        const cell = this.terrainGrid[tileY][tileX];

        // Must be buildable ground or platform (not unwalkable, ramp, or unbuildable)
        if (cell.terrain !== 'ground' && cell.terrain !== 'platform') {
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
      if (!validateEntity(entity, buildingId, 'Game.isValidBuildingPlacement:building', this.currentTick)) continue;

      const transform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!transform || !building) continue;

      // Skip flying buildings - they don't block ground placement
      if (building.isFlying || building.state === 'lifting' ||
          building.state === 'flying' || building.state === 'landing') {
        continue;
      }

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
        if (!validateEntity(entity, unitId, 'Game.isValidBuildingPlacement:unit', this.currentTick)) continue;

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
   * In multiplayer, commands are scheduled for a future tick (lockstep) to ensure
   * both players execute the command at the same game tick.
   * In single player, commands are processed immediately.
   */
  public issueCommand(command: GameCommand): void {
    if (isMultiplayerMode()) {
      // LOCKSTEP: Schedule command for future tick so both players execute at same tick
      const executionTick = this.currentTick + this.COMMAND_DELAY_TICKS;
      command.tick = executionTick;

      // Send to remote player with the scheduled execution tick
      const message: MultiplayerMessage = {
        type: 'command',
        payload: command,
      };
      sendMultiplayerMessage(message);
      debugNetworking.log('[Game] Sent command to remote for tick', executionTick, ':', command.type);

      // Queue locally for execution at the scheduled tick
      this.queueCommand(command);
    } else {
      // Single player: process immediately
      this.processCommand(command);
    }
  }

  /**
   * Queue a command for execution at a specific tick (lockstep multiplayer)
   */
  private queueCommand(command: GameCommand): void {
    const tick = command.tick;
    if (!this.commandQueue.has(tick)) {
      this.commandQueue.set(tick, []);
    }
    this.commandQueue.get(tick)!.push(command);

    // LOCKSTEP BARRIER: Track that we received a command from this player for this tick
    if (!this.tickCommandReceipts.has(tick)) {
      this.tickCommandReceipts.set(tick, new Set());
    }
    this.tickCommandReceipts.get(tick)!.add(command.playerId);
  }

  /**
   * Get the list of all active players in the multiplayer game.
   * In 2-player P2P mode, this is local player + remote player.
   */
  private getActivePlayerIds(): string[] {
    const playerIds: string[] = [this.config.playerId];
    const remotePeerId = useMultiplayerStore.getState().remotePeerId;
    if (remotePeerId) {
      playerIds.push(remotePeerId);
    }
    return playerIds;
  }

  /**
   * LOCKSTEP BARRIER: Track when we first started waiting for a tick
   * Format: Map<tick, firstWaitTick>
   */
  private tickWaitStart: Map<number, number> = new Map();

  /**
   * Process all commands scheduled for the current tick
   * LOCKSTEP SYNC: Processes commands from all players in deterministic order.
   * Desync detection is handled via checksums (ChecksumSystem) rather than
   * blocking on command arrival, since players may have no-op ticks.
   */
  private processQueuedCommands(): void {
    // Process commands for the current tick
    const commands = this.commandQueue.get(this.currentTick);
    if (commands) {
      // Sort by player ID for deterministic ordering across all clients
      commands.sort((a, b) => a.playerId.localeCompare(b.playerId));
      for (const command of commands) {
        this.processCommand(command);
      }
      this.commandQueue.delete(this.currentTick);
    }

    // Clean up receipts for this tick
    this.tickCommandReceipts.delete(this.currentTick);

    // CRITICAL FIX: Stale commands trigger desync instead of silent drop
    // Stale commands indicate a timing/synchronization failure
    const staleTicks: number[] = [];
    for (const tick of this.commandQueue.keys()) {
      if (tick < this.currentTick) {
        staleTicks.push(tick);
      }
    }
    for (const tick of staleTicks) {
      const staleCommands = this.commandQueue.get(tick);
      // CRITICAL: Stale commands indicate a synchronization failure
      // This should never happen if networking is working correctly
      console.error(
        `[Game] CRITICAL: Stale commands detected for tick ${tick} ` +
        `(current: ${this.currentTick}). Commands from: ${
          staleCommands?.map(c => c.playerId).join(', ') || 'none'
        }. This indicates desync!`
      );
      // Report desync instead of silently dropping
      reportDesync(tick);
      this.eventBus.emit('desync:detected', {
        tick,
        localChecksum: 0,
        remoteChecksum: 0,
        remotePeerId: useMultiplayerStore.getState().remotePeerId || 'unknown',
        reason: 'stale_commands',
      });
      // Clean up
      this.commandQueue.delete(tick);
      this.tickCommandReceipts.delete(tick);
    }

    // Clean up old wait tracking entries
    for (const tick of this.tickWaitStart.keys()) {
      if (tick <= this.currentTick) {
        this.tickWaitStart.delete(tick);
      }
    }
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
      debugNetworking.log('[Game] Sent quit notification');
    }
  }

  /**
   * Validate that the command's playerId owns all entities in entityIds.
   * Returns true if valid, false if authorization fails.
   * Commands without entityIds (like BUILD with targetPosition) are always valid.
   */
  private validateCommandAuthorization(command: GameCommand): boolean {
    // Commands that don't require entity ownership validation
    const noEntityValidationCommands: GameCommand['type'][] = [
      'BUILD', 'BUILD_WALL', // Building placement uses targetPosition
    ];

    if (noEntityValidationCommands.includes(command.type)) {
      return true;
    }

    // If no entities specified, command is valid
    if (!command.entityIds || command.entityIds.length === 0) {
      return true;
    }

    // Validate each entity is owned by the command's playerId
    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) {
        // Entity doesn't exist - could be destroyed, skip validation
        continue;
      }

      const selectable = entity.get<Selectable>('Selectable');
      if (!selectable) {
        // Entity has no owner - skip validation (resources, etc.)
        continue;
      }

      // CRITICAL: Verify ownership
      if (selectable.playerId !== command.playerId) {
        console.error(
          `[Game] COMMAND AUTHORIZATION FAILED: Player ${command.playerId} ` +
          `attempted to control entity ${entityId} owned by ${selectable.playerId}. ` +
          `Command type: ${command.type}`
        );
        // Emit security event for monitoring
        this.eventBus.emit('security:unauthorizedCommand', {
          playerId: command.playerId,
          entityId,
          entityOwner: selectable.playerId,
          commandType: command.type,
          tick: command.tick,
        });
        return false;
      }
    }

    // Also validate special fields that reference entities
    if (command.transportId !== undefined) {
      const transport = this.world.getEntity(command.transportId);
      const selectable = transport?.get<Selectable>('Selectable');
      if (selectable && selectable.playerId !== command.playerId) {
        console.error(
          `[Game] Transport ownership mismatch: entity ${command.transportId} ` +
          `belongs to player ${selectable.playerId}, not ${command.playerId}`
        );
        return false;
      }
    }

    if (command.bunkerId !== undefined) {
      const bunker = this.world.getEntity(command.bunkerId);
      const selectable = bunker?.get<Selectable>('Selectable');
      if (selectable && selectable.playerId !== command.playerId) {
        console.error(
          `[Game] Bunker ownership mismatch: entity ${command.bunkerId} ` +
          `belongs to player ${selectable.playerId}, not ${command.playerId}`
        );
        return false;
      }
    }

    if (command.buildingId !== undefined) {
      const building = this.world.getEntity(command.buildingId);
      const selectable = building?.get<Selectable>('Selectable');
      if (selectable && selectable.playerId !== command.playerId) {
        console.error(
          `[Game] Building ownership mismatch: entity ${command.buildingId} ` +
          `belongs to player ${selectable.playerId}, not ${command.playerId}`
        );
        return false;
      }
    }

    return true;
  }

  // Command processing for multiplayer lockstep
  public processCommand(command: GameCommand): void {
    // SECURITY: Validate command authorization before processing
    if (this.config.isMultiplayer && !this.validateCommandAuthorization(command)) {
      // Reject unauthorized commands - do not process
      return;
    }

    // Dispatch command to appropriate event handlers via shared dispatcher
    dispatchCommand(this.eventBus, command);
  }
}

// Re-export GameCommand for backwards compatibility
export type { GameCommand } from './GameCommand';

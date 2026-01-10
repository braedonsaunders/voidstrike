import { World } from '../ecs/World';
import { GameLoop } from './GameLoop';
import { EventBus } from './EventBus';
import { MovementSystem } from '../systems/MovementSystem';
import { SelectionSystem } from '../systems/SelectionSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { ProductionSystem } from '../systems/ProductionSystem';
import { ResourceSystem } from '../systems/ResourceSystem';
import { ResearchSystem } from '../systems/ResearchSystem';
import { AISystem } from '../systems/AISystem';
import { EnhancedAISystem, AIDifficulty } from '../systems/EnhancedAISystem';
import { VisionSystem } from '../systems/VisionSystem';
import { AbilitySystem } from '../systems/AbilitySystem';
import { SpawnSystem } from '../systems/SpawnSystem';
import { BuildingPlacementSystem } from '../systems/BuildingPlacementSystem';
import { debugInitialization } from '@/utils/debugLogger';
import { AudioSystem } from '../systems/AudioSystem';
import { UnitMechanicsSystem } from '../systems/UnitMechanicsSystem';
import { BuildingMechanicsSystem } from '../systems/BuildingMechanicsSystem';
import { GameStateSystem } from '../systems/GameStateSystem';
import { SaveLoadSystem } from '../systems/SaveLoadSystem';
import { PathfindingSystem } from '../systems/PathfindingSystem';
import { AIMicroSystem } from '../systems/AIMicroSystem';
import { getLocalPlayerId } from '@/store/gameSetupStore';

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
  useEnhancedAI: boolean;
}

const DEFAULT_CONFIG: GameConfig = {
  mapWidth: 128,
  mapHeight: 128,
  tickRate: 20,
  isMultiplayer: false,
  playerId: 'player1',
  aiEnabled: true,
  aiDifficulty: 'medium',
  useEnhancedAI: true,
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

  // Decoration collision data for building placement (rocks, trees)
  private decorationCollisions: Array<{ x: number; z: number; radius: number }> = [];

  private gameLoop: GameLoop;
  private state: GameState = 'initializing';
  private currentTick = 0;

  private constructor(config: Partial<GameConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventBus = new EventBus();
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

    this.initializeSystems();
  }

  public static getInstance(config?: Partial<GameConfig>): Game {
    if (!Game.instance) {
      Game.instance = new Game(config);
    } else if (config && (config.mapWidth || config.mapHeight)) {
      // Update map dimensions if a new config is provided with map settings
      // This handles cases where components access Game before GameCanvas initializes it
      if (config.mapWidth) Game.instance.config.mapWidth = config.mapWidth;
      if (config.mapHeight) Game.instance.config.mapHeight = config.mapHeight;
      debugInitialization.log(`[Game] Updated map dimensions to ${Game.instance.config.mapWidth}x${Game.instance.config.mapHeight}`);
    }
    return Game.instance;
  }

  public static resetInstance(): void {
    if (Game.instance) {
      Game.instance.stop();
      Game.instance = null;
    }
  }

  private initializeSystems(): void {
    // Add systems in order of execution
    this.world.addSystem(new SpawnSystem(this));
    this.world.addSystem(new BuildingPlacementSystem(this));
    this.world.addSystem(new SelectionSystem(this));
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
      if (this.config.useEnhancedAI) {
        const enhancedAI = new EnhancedAISystem(this, this.config.aiDifficulty);
        this.world.addSystem(enhancedAI);
        this.world.addSystem(this.aiMicroSystem); // AI unit micro (kiting, focus fire)
        // NOTE: AI player registration with AIMicroSystem happens in spawnInitialEntities()
        // This ensures the store has the correct player configuration when registration occurs
        // Do NOT register here as the store may have stale/default state at this point
      } else {
        this.world.addSystem(new AISystem(this));
      }
    }
  }

  public start(): void {
    if (this.state === 'running') return;

    this.state = 'running';
    this.gameLoop.start();
    this.eventBus.emit('game:countdown', {}); // SC2-style 3, 2, 1, GO! countdown
    this.eventBus.emit('game:started', { tick: this.currentTick });
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
    this.eventBus.emit('game:ended', { tick: this.currentTick });
  }

  private update(deltaTime: number): void {
    if (this.state !== 'running') return;

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
    this.terrainGrid = terrain;
    // Load terrain walkability into pathfinding system
    this.pathfindingSystem.loadTerrainData();
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
    | 'PATROL';
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
}

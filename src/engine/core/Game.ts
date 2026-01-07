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
import { AudioSystem } from '../systems/AudioSystem';
import { UnitMechanicsSystem } from '../systems/UnitMechanicsSystem';
import { BuildingMechanicsSystem } from '../systems/BuildingMechanicsSystem';
import { GameStateSystem } from '../systems/GameStateSystem';
import { SaveLoadSystem } from '../systems/SaveLoadSystem';

export type GameState = 'initializing' | 'running' | 'paused' | 'ended';

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

  private gameLoop: GameLoop;
  private state: GameState = 'initializing';
  private currentTick = 0;

  private constructor(config: Partial<GameConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventBus = new EventBus();
    this.world = new World();
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

    this.initializeSystems();
  }

  public static getInstance(config?: Partial<GameConfig>): Game {
    if (!Game.instance) {
      Game.instance = new Game(config);
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
        this.world.addSystem(new EnhancedAISystem(this, this.config.aiDifficulty));
      } else {
        this.world.addSystem(new AISystem(this));
      }
    }
  }

  public start(): void {
    if (this.state === 'running') return;

    this.state = 'running';
    this.gameLoop.start();
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

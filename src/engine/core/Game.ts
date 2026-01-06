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
import { VisionSystem } from '../systems/VisionSystem';
import { AbilitySystem } from '../systems/AbilitySystem';
import { SpawnSystem } from '../systems/SpawnSystem';
import { BuildingPlacementSystem } from '../systems/BuildingPlacementSystem';
import { AudioSystem } from '../systems/AudioSystem';

export type GameState = 'initializing' | 'running' | 'paused' | 'ended';

export interface GameConfig {
  mapWidth: number;
  mapHeight: number;
  tickRate: number;
  isMultiplayer: boolean;
  playerId: string;
  aiEnabled: boolean;
}

const DEFAULT_CONFIG: GameConfig = {
  mapWidth: 128,
  mapHeight: 128,
  tickRate: 20,
  isMultiplayer: false,
  playerId: 'player1',
  aiEnabled: true,
};

export class Game {
  private static instance: Game | null = null;

  public world: World;
  public eventBus: EventBus;
  public config: GameConfig;
  public visionSystem: VisionSystem;
  public audioSystem: AudioSystem;

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
    this.world.addSystem(new MovementSystem(this));
    this.world.addSystem(new CombatSystem(this));
    this.world.addSystem(new ProductionSystem(this));
    this.world.addSystem(new ResourceSystem(this));
    this.world.addSystem(new ResearchSystem(this));
    this.world.addSystem(new AbilitySystem(this));
    this.world.addSystem(this.visionSystem);
    this.world.addSystem(this.audioSystem);

    if (this.config.aiEnabled) {
      this.world.addSystem(new AISystem(this));
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
    }
  }
}

export interface GameCommand {
  tick: number;
  playerId: string;
  type: 'MOVE' | 'ATTACK' | 'BUILD' | 'TRAIN' | 'ABILITY' | 'STOP' | 'HOLD' | 'RESEARCH';
  entityIds: number[];
  targetPosition?: { x: number; y: number };
  targetEntityId?: number;
  buildingType?: string;
  unitType?: string;
  abilityId?: string;
  upgradeId?: string;
}

/**
 * Game Worker
 *
 * Runs all game logic in a dedicated Web Worker for:
 * 1. Anti-throttling: Workers are NOT throttled when tab is inactive
 * 2. Performance: Game logic runs on a separate thread from rendering
 *
 * This worker contains the ECS World and all game systems except:
 * - AudioSystem (requires Web Audio API on main thread)
 * - Selection callbacks (require Three.js projection on main thread)
 *
 * Communication:
 * - Receives: Commands, initialization data, terrain/navmesh
 * - Sends: RenderState snapshots, game events for audio/effects
 */

// Debug flag for worker logging (workers can't access UI store)
const DEBUG = false;

import { World } from '../ecs/World';
import { EventBus } from '../core/EventBus';
import { SystemRegistry } from '../core/SystemRegistry';
import { bootstrapDefinitions } from '../definitions';

// Components
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Resource } from '../components/Resource';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Projectile } from '../components/Projectile';
import { Velocity } from '../components/Velocity';

// Systems (worker-safe)
import { SpawnSystem } from '../systems/SpawnSystem';
import { BuildingPlacementSystem } from '../systems/BuildingPlacementSystem';
import { PathfindingSystem } from '../systems/PathfindingSystem';
import { BuildingMechanicsSystem } from '../systems/BuildingMechanicsSystem';
import { WallSystem } from '../systems/WallSystem';
import { UnitMechanicsSystem } from '../systems/UnitMechanicsSystem';
import { MovementSystem } from '../systems/MovementSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { ProjectileSystem } from '../systems/ProjectileSystem';
import { ProductionSystem } from '../systems/ProductionSystem';
import { ResourceSystem } from '../systems/ResourceSystem';
import { ResearchSystem } from '../systems/ResearchSystem';
import { AbilitySystem } from '../systems/AbilitySystem';
import { VisionSystem } from '../systems/VisionSystem';
import { GameStateSystem } from '../systems/GameStateSystem';
import { SaveLoadSystem } from '../systems/SaveLoadSystem';
import { EnhancedAISystem, AIDifficulty } from '../systems/EnhancedAISystem';
import { AIEconomySystem } from '../systems/AIEconomySystem';
import { AIMicroSystem } from '../systems/AIMicroSystem';
import { ChecksumSystem } from '../systems/ChecksumSystem';

// Types
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  SerializedRenderState,
  GameEvent,
  UnitRenderState,
  BuildingRenderState,
  ResourceRenderState,
  ProjectileRenderState,
  SpawnMapData,
} from './types';
import type { GameConfig, GameState, TerrainCell } from '../core/Game';
import { dispatchCommand, type GameCommand } from '../core/GameCommand';

// ============================================================================
// WORKER GAME CLASS
// ============================================================================

/**
 * WorkerGame - Self-contained game instance running in a Web Worker
 *
 * This is a stripped-down version of Game.ts that runs entirely in the worker
 * without any main-thread dependencies (no Three.js, no Zustand, no Web Audio).
 */
class WorkerGame {
  public world: World;
  public eventBus: EventBus;
  public config: GameConfig;

  // Direct system references (initialized in constructor before initializeSystems)
  public visionSystem: VisionSystem;
  public gameStateSystem: GameStateSystem;
  public saveLoadSystem: SaveLoadSystem;
  public pathfindingSystem: PathfindingSystem;
  public aiMicroSystem: AIMicroSystem;
  public checksumSystem: ChecksumSystem | null = null;

  // System assigned during initializeSystems() - null until then
  private _projectileSystem: ProjectileSystem | null = null;

  /**
   * Get the ProjectileSystem instance.
   * @throws Error if accessed before system initialization
   */
  public get projectileSystem(): ProjectileSystem {
    if (!this._projectileSystem) {
      throw new Error('[WorkerGame] ProjectileSystem accessed before initialization');
    }
    return this._projectileSystem;
  }

  // Terrain
  private terrainGrid: TerrainCell[][] | null = null;
  private decorationCollisions: Array<{ x: number; z: number; radius: number }> = [];

  // Game state
  private state: GameState = 'initializing';
  private currentTick = 0;
  private gameTime = 0;
  private tickMs: number;

  // Game loop (runs in worker via setInterval - NOT throttled!)
  private loopIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastTickTime = 0;
  private accumulator = 0;

  // Command queue
  private commandQueue: Map<number, GameCommand[]> = new Map();
  private readonly COMMAND_DELAY_TICKS = 4;

  // Event collection for main thread
  private pendingEvents: GameEvent[] = [];

  // Player resources cache
  private playerResources: Map<string, { minerals: number; vespene: number; supply: number; maxSupply: number }> = new Map();

  // Selection state (for UI feedback)
  private selectedEntityIds: number[] = [];
  private controlGroups: Map<number, number[]> = new Map();

  constructor(config: GameConfig) {
    this.config = config;
    this.tickMs = 1000 / config.tickRate;

    // Initialize ECS World
    this.world = new World(config.mapWidth, config.mapHeight);
    this.eventBus = new EventBus();

    // Initialize player resources
    this.playerResources.set(config.playerId, { minerals: 50, vespene: 0, supply: 0, maxSupply: 0 });

    // Bootstrap unit/building definitions
    bootstrapDefinitions();

    // Pre-create systems that need direct references (like Game.ts does)
    this.visionSystem = new VisionSystem(this as any, config.mapWidth, config.mapHeight);
    this.gameStateSystem = new GameStateSystem(this as any);
    this.saveLoadSystem = new SaveLoadSystem(this as any);
    this.pathfindingSystem = new PathfindingSystem(this as any, config.mapWidth, config.mapHeight);
    this.aiMicroSystem = new AIMicroSystem(this as any);

    if (config.isMultiplayer) {
      this.checksumSystem = new ChecksumSystem(this as any, {
        checksumInterval: 5,
        emitNetworkChecksums: true,
        logChecksums: false,
        autoDumpOnDesync: true,
      });
    }

    // Setup event listeners for game events we need to forward
    this.setupEventListeners();

    // Register and initialize systems
    this.initializeSystems();
  }

  private setupEventListeners(): void {
    // Combat events
    this.eventBus.on('combat:attack', (data: any) => {
      this.pendingEvents.push({
        type: 'combat:attack',
        attackerId: data.attackerEntityId,
        attackerType: data.attackerId || 'unknown',
        attackerPos: data.attackerPos,
        targetPos: data.targetPos,
        targetId: data.targetEntityId,
        targetUnitType: data.targetUnitType,
        damage: data.damage,
        damageType: data.damageType,
        attackerIsFlying: data.attackerIsFlying ?? false,
        targetIsFlying: data.targetIsFlying ?? false,
        attackerFaction: data.attackerFaction ?? 'dominion',
      });
    });

    // Projectile events
    this.eventBus.on('projectile:spawned', (data: any) => {
      this.pendingEvents.push({
        type: 'projectile:spawned',
        entityId: data.entityId,
        startPos: data.startPos,
        targetPos: data.targetPos,
        projectileType: data.projectileType,
        faction: data.faction ?? 'dominion',
        trailType: data.trailType,
      });
    });

    this.eventBus.on('projectile:impact', (data: any) => {
      this.pendingEvents.push({
        type: 'projectile:impact',
        entityId: data.entityId,
        position: data.position,
        damageType: data.damageType,
        splashRadius: data.splashRadius ?? 0,
        faction: data.faction ?? 'dominion',
      });
    });

    // Unit events
    this.eventBus.on('unit:died', (data: any) => {
      this.pendingEvents.push({
        type: 'unit:died',
        entityId: data.entityId,
        position: data.position ?? { x: 0, y: 0 },
        isFlying: data.isFlying ?? false,
        unitType: data.unitType ?? 'unknown',
        faction: data.faction ?? 'dominion',
      });
    });

    this.eventBus.on('unit:trained', (data: any) => {
      this.pendingEvents.push({
        type: 'unit:trained',
        entityId: data.entityId,
        unitType: data.unitType,
        playerId: data.playerId,
        position: data.position,
      });
    });

    // Building events
    this.eventBus.on('building:destroyed', (data: any) => {
      this.pendingEvents.push({
        type: 'building:destroyed',
        entityId: data.entityId,
        playerId: data.playerId,
        buildingType: data.buildingType,
        position: data.position,
        faction: data.faction ?? 'dominion',
      });
    });

    this.eventBus.on('building:complete', (data: any) => {
      this.pendingEvents.push({
        type: 'building:complete',
        entityId: data.entityId,
        buildingType: data.buildingType,
        playerId: data.playerId,
        position: data.position,
      });
    });

    // Upgrade events
    this.eventBus.on('upgrade:complete', (data: any) => {
      this.pendingEvents.push({
        type: 'upgrade:complete',
        upgradeId: data.upgradeId,
        playerId: data.playerId,
      });
    });

    // Ability events
    this.eventBus.on('ability:used', (data: any) => {
      this.pendingEvents.push({
        type: 'ability:used',
        abilityId: data.abilityId,
        casterId: data.casterId,
        casterType: data.casterType,
        position: data.position,
        targetId: data.targetId,
        targetPosition: data.targetPosition,
      });
    });

    // Alert events
    this.eventBus.on('alert:triggered', (data: any) => {
      this.pendingEvents.push({
        type: 'alert',
        alertType: data.alertType,
        position: data.position,
        playerId: data.playerId,
        details: data.details,
      });
    });

    // Game over
    this.eventBus.on('game:over', (data: any) => {
      postMessage({
        type: 'gameOver',
        winnerId: data.winnerId,
        reason: data.reason,
      } satisfies WorkerToMainMessage);
    });
  }

  private initializeSystems(): void {
    // Use SystemRegistry for dependency-based ordering (like Game.ts)
    const registry = new SystemRegistry();
    registry.registerAll(this.getWorkerSystemDefinitions());

    // Validate dependencies at startup
    const errors = registry.validate();
    if (errors.length > 0) {
      console.error('[WorkerGame] System dependency errors:', errors);
      throw new Error(`Invalid system dependencies:\n${errors.join('\n')}`);
    }

    // Create systems in dependency order
    const systems = registry.createSystems(this as any);

    // Add all systems to world
    for (const system of systems) {
      this.world.addSystem(system);

      // Capture references to systems that are accessed elsewhere
      if (system.name === 'ProjectileSystem') {
        this._projectileSystem = system as ProjectileSystem;
      }
    }
  }

  private getWorkerSystemDefinitions() {
    // Return system definitions excluding main-thread-only systems (AudioSystem)
    return [
      // SPAWN LAYER
      {
        name: 'SpawnSystem',
        dependencies: [] as string[],
        factory: () => new SpawnSystem(this as any),
      },

      // PLACEMENT LAYER
      {
        name: 'BuildingPlacementSystem',
        dependencies: [] as string[],
        factory: () => new BuildingPlacementSystem(this as any),
      },
      {
        name: 'PathfindingSystem',
        dependencies: ['BuildingPlacementSystem'],
        factory: () => this.pathfindingSystem,
      },

      // MECHANICS LAYER
      {
        name: 'BuildingMechanicsSystem',
        dependencies: ['BuildingPlacementSystem'],
        factory: () => new BuildingMechanicsSystem(this as any),
      },
      {
        name: 'WallSystem',
        dependencies: ['BuildingPlacementSystem'],
        factory: () => new WallSystem(this as any),
      },
      {
        name: 'UnitMechanicsSystem',
        dependencies: [] as string[],
        factory: () => new UnitMechanicsSystem(this as any),
      },

      // MOVEMENT LAYER
      {
        name: 'MovementSystem',
        dependencies: ['PathfindingSystem', 'UnitMechanicsSystem'],
        factory: () => new MovementSystem(this as any),
      },

      // VISION LAYER
      {
        name: 'VisionSystem',
        dependencies: ['MovementSystem'],
        factory: () => this.visionSystem,
      },

      // COMBAT LAYER
      {
        name: 'CombatSystem',
        dependencies: ['MovementSystem', 'VisionSystem'],
        factory: () => new CombatSystem(this as any),
      },
      {
        name: 'ProjectileSystem',
        dependencies: ['CombatSystem'],
        factory: () => new ProjectileSystem(this as any),
      },
      {
        name: 'AbilitySystem',
        dependencies: ['CombatSystem'],
        factory: () => new AbilitySystem(this as any),
      },

      // ECONOMY LAYER
      {
        name: 'ResourceSystem',
        dependencies: ['MovementSystem'],
        factory: () => new ResourceSystem(this as any),
      },
      {
        name: 'ProductionSystem',
        dependencies: ['ResourceSystem'],
        factory: () => new ProductionSystem(this as any),
      },
      {
        name: 'ResearchSystem',
        dependencies: ['ProductionSystem'],
        factory: () => new ResearchSystem(this as any),
      },

      // AI LAYER (conditional)
      ...(this.config.aiEnabled ? [
        {
          name: 'EnhancedAISystem',
          dependencies: ['CombatSystem', 'ResourceSystem'],
          factory: () => new EnhancedAISystem(this as any, this.config.aiDifficulty),
        },
        {
          name: 'AIEconomySystem',
          dependencies: ['EnhancedAISystem'],
          factory: () => new AIEconomySystem(this as any),
        },
        {
          name: 'AIMicroSystem',
          dependencies: ['EnhancedAISystem', 'CombatSystem'],
          factory: () => this.aiMicroSystem,
        },
      ] : []),

      // META LAYER
      {
        name: 'GameStateSystem',
        dependencies: ['CombatSystem', 'ProductionSystem', 'ResourceSystem'],
        factory: () => this.gameStateSystem,
      },
      ...(this.config.isMultiplayer && this.checksumSystem ? [{
        name: 'ChecksumSystem',
        dependencies: ['GameStateSystem'],
        factory: () => this.checksumSystem!,
      }] : []),
      {
        name: 'SaveLoadSystem',
        dependencies: ['GameStateSystem'],
        factory: () => this.saveLoadSystem,
      },
    ];
  }

  // ============================================================================
  // GAME LOOP (runs via setInterval in worker - NOT throttled!)
  // ============================================================================

  public start(): void {
    if (this.state === 'running') return;

    if (DEBUG) {
      console.log('[GameWorker] Starting game loop. Entity counts:', {
        units: this.world.getEntitiesWith('Unit').length,
        buildings: this.world.getEntitiesWith('Building').length,
        resources: this.world.getEntitiesWith('Resource').length,
      });
    }

    this.state = 'running';
    this.lastTickTime = performance.now();
    this.accumulator = 0;

    // Run game loop via setInterval - NOT throttled in Web Workers!
    this.loopIntervalId = setInterval(() => this.tick(), this.tickMs);
  }

  public stop(): void {
    this.state = 'paused';
    if (this.loopIntervalId !== null) {
      clearInterval(this.loopIntervalId);
      this.loopIntervalId = null;
    }
  }

  private tick(): void {
    if (this.state !== 'running') return;

    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastTickTime;
    this.lastTickTime = currentTime;

    // Cap delta to prevent spiral of death
    const cappedDelta = Math.min(deltaTime, 250);
    this.accumulator += cappedDelta;

    // Fixed timestep updates
    let iterations = 0;
    const maxIterations = 10;
    const timeBudgetMs = 40; // 40ms budget per tick for game logic
    const tickStart = performance.now();

    while (this.accumulator >= this.tickMs && iterations < maxIterations) {
      if (iterations > 0 && performance.now() - tickStart > timeBudgetMs) {
        break;
      }

      this.update(this.tickMs);
      this.accumulator -= this.tickMs;
      iterations++;
    }

    // Send render state and events to main thread
    this.sendRenderState();
    this.sendEvents();
  }

  private update(deltaTime: number): void {
    this.currentTick++;
    this.gameTime += deltaTime / 1000;

    // Process queued commands for this tick
    this.processQueuedCommands();

    // Update all systems
    this.world.update(deltaTime);

    // Update player resources from ResourceSystem
    this.updatePlayerResources();
  }

  // ============================================================================
  // COMMAND PROCESSING
  // ============================================================================

  public issueCommand(command: GameCommand): void {
    if (this.config.isMultiplayer) {
      // Lockstep: schedule for future tick
      const executionTick = this.currentTick + this.COMMAND_DELAY_TICKS;
      command.tick = executionTick;
      this.queueCommand(command);

      // Notify main thread to send to peer
      postMessage({
        type: 'multiplayerCommand',
        command,
      } satisfies WorkerToMainMessage);
    } else {
      // Single player: process immediately
      this.processCommand(command);
    }
  }

  public receiveMultiplayerCommand(command: GameCommand): void {
    this.queueCommand(command);
  }

  private queueCommand(command: GameCommand): void {
    const tick = command.tick;
    if (!this.commandQueue.has(tick)) {
      this.commandQueue.set(tick, []);
    }
    this.commandQueue.get(tick)!.push(command);
  }

  private processQueuedCommands(): void {
    const commands = this.commandQueue.get(this.currentTick);
    if (!commands) return;

    // Sort for determinism
    commands.sort((a, b) => {
      if (a.playerId !== b.playerId) return a.playerId.localeCompare(b.playerId);
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return (a.entityIds[0] ?? 0) - (b.entityIds[0] ?? 0);
    });

    for (const command of commands) {
      this.processCommand(command);
    }

    this.commandQueue.delete(this.currentTick);
  }

  public processCommand(command: GameCommand): void {
    // Dispatch command to appropriate event handlers via shared dispatcher
    dispatchCommand(this.eventBus, command);
  }

  // ============================================================================
  // TERRAIN & NAVMESH
  // ============================================================================

  public setTerrainGrid(terrain: TerrainCell[][]): void {
    this.terrainGrid = terrain;
    this.pathfindingSystem.loadTerrainData();
  }

  public getTerrainGrid(): TerrainCell[][] | null {
    return this.terrainGrid;
  }

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

  public async initializeNavMesh(positions: Float32Array, indices: Uint32Array): Promise<boolean> {
    return this.pathfindingSystem.initializeNavMesh(positions, indices);
  }

  public async initializeWaterNavMesh(positions: Float32Array, indices: Uint32Array): Promise<boolean> {
    return this.pathfindingSystem.initializeWaterNavMesh(positions, indices);
  }

  public setDecorationCollisions(collisions: Array<{ x: number; z: number; radius: number }>): void {
    this.decorationCollisions = collisions;
  }

  public getDecorationCollisions(): Array<{ x: number; z: number; radius: number }> {
    return this.decorationCollisions;
  }

  // ============================================================================
  // RENDER STATE COLLECTION
  // ============================================================================

  private updatePlayerResources(): void {
    // Update resources for each player from their entities
    const buildings = this.world.getEntitiesWith('Building', 'Selectable');
    const playerSupply = new Map<string, { supply: number; maxSupply: number }>();

    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      if (!playerSupply.has(selectable.playerId)) {
        playerSupply.set(selectable.playerId, { supply: 0, maxSupply: 0 });
      }

      const ps = playerSupply.get(selectable.playerId)!;
      if (building.isComplete() && building.supplyProvided > 0) {
        ps.maxSupply += building.supplyProvided;
      }
    }

    // Count unit supply
    const units = this.world.getEntitiesWith('Unit', 'Selectable');
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;

      if (!playerSupply.has(selectable.playerId)) {
        playerSupply.set(selectable.playerId, { supply: 0, maxSupply: 0 });
      }
      // Each unit costs 1 supply by default (could be expanded)
      playerSupply.get(selectable.playerId)!.supply += 1;
    }

    // Update our cache
    for (const [playerId, supply] of playerSupply) {
      const current = this.playerResources.get(playerId) ?? { minerals: 50, vespene: 0, supply: 0, maxSupply: 0 };
      current.supply = supply.supply;
      current.maxSupply = supply.maxSupply;
      this.playerResources.set(playerId, current);
    }
  }

  // Debug: log first render state only
  private hasLoggedFirstRenderState = false;
  private renderStatesSent = 0;

  private sendRenderState(): void {
    const units = this.collectUnitRenderState();
    const buildings = this.collectBuildingRenderState();
    const resources = this.collectResourceRenderState();
    const projectiles = this.collectProjectileRenderState();

    this.renderStatesSent++;

    // Debug: log first 5 sends and every 100th send
    if (DEBUG && (this.renderStatesSent <= 5 || this.renderStatesSent % 100 === 0)) {
      console.log(`[GameWorker] sendRenderState #${this.renderStatesSent}: units=${units.length}, buildings=${buildings.length}, resources=${resources.length}`);
    }

    // Debug log first render state with entities
    if (DEBUG && !this.hasLoggedFirstRenderState && (units.length > 0 || buildings.length > 0 || resources.length > 0)) {
      console.log('[GameWorker] Sending first render state with entities:', {
        tick: this.currentTick,
        units: units.length,
        buildings: buildings.length,
        resources: resources.length,
      });
      this.hasLoggedFirstRenderState = true;
    }

    // Serialize Maps to arrays for postMessage (Maps can't be serialized)
    const serializedRenderState: SerializedRenderState = {
      tick: this.currentTick,
      gameTime: this.gameTime,
      gameState: this.state,
      interpolation: this.accumulator / this.tickMs,
      units,
      buildings,
      resources,
      projectiles,
      visionGrids: [], // Vision grids collected by VisionSystem - TODO if needed
      playerResources: Array.from(this.playerResources.entries()),
      selectedEntityIds: [...this.selectedEntityIds],
      controlGroups: Array.from(this.controlGroups.entries()),
    };

    postMessage({ type: 'renderState', state: serializedRenderState } satisfies WorkerToMainMessage);
  }

  private collectUnitRenderState(): UnitRenderState[] {
    const states: UnitRenderState[] = [];
    const entities = this.world.getEntitiesWith('Transform', 'Unit', 'Health', 'Selectable');

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      states.push({
        id: entity.id,
        x: transform.x,
        y: transform.y,
        z: transform.z,
        rotation: transform.rotation,
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
        scaleZ: transform.scaleZ,
        prevX: transform.prevX,
        prevY: transform.prevY,
        prevZ: transform.prevZ,
        prevRotation: transform.prevRotation,
        unitId: unit.unitId,
        faction: unit.faction,
        state: unit.state,
        isFlying: unit.isFlying,
        isSubmerged: unit.isSubmerged,
        isCloaked: unit.isCloaked,
        health: health.current,
        maxHealth: health.max,
        shield: health.shield,
        maxShield: health.maxShield,
        isDead: health.isDead(),
        playerId: selectable.playerId,
        isSelected: selectable.isSelected,
        controlGroup: selectable.controlGroup,
        targetEntityId: unit.targetEntityId,
        lastAttackTime: unit.lastAttackTime,
        isWorker: unit.isWorker,
        carryingMinerals: unit.carryingMinerals,
        carryingVespene: unit.carryingVespene,
        isMining: unit.isMining,
        currentMode: unit.currentMode,
        transformProgress: unit.transformProgress,
        isRepairing: unit.isRepairing,
        repairTargetId: unit.repairTargetId,
        hasSpeedBuff: unit.hasBuff('stim'),
        hasDamageBuff: unit.hasBuff('damage_boost'),
      });
    }

    return states;
  }

  private collectBuildingRenderState(): BuildingRenderState[] {
    const states: BuildingRenderState[] = [];
    const entities = this.world.getEntitiesWith('Transform', 'Building', 'Health', 'Selectable');

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      states.push({
        id: entity.id,
        x: transform.x,
        y: transform.y,
        z: transform.z,
        rotation: transform.rotation,
        buildingId: building.buildingId,
        faction: building.faction,
        state: building.state,
        buildProgress: building.buildProgress,
        width: building.width,
        height: building.height,
        health: health.current,
        maxHealth: health.max,
        isDead: health.isDead(),
        playerId: selectable.playerId,
        isSelected: selectable.isSelected,
        isFlying: building.isFlying,
        liftProgress: building.liftProgress,
        currentAddon: building.currentAddon,
        isLowered: building.isLowered,
        productionProgress: building.getProductionProgress(),
        hasProductionQueue: building.productionQueue.length > 0,
        rallyX: building.rallyX,
        rallyY: building.rallyY,
      });
    }

    return states;
  }

  private collectResourceRenderState(): ResourceRenderState[] {
    const states: ResourceRenderState[] = [];
    const entities = this.world.getEntitiesWith('Transform', 'Resource');

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const resource = entity.get<Resource>('Resource')!;

      states.push({
        id: entity.id,
        x: transform.x,
        y: transform.y,
        z: transform.z,
        resourceType: resource.resourceType,
        amount: resource.amount,
        maxAmount: resource.maxAmount,
        percentRemaining: resource.getPercentRemaining(),
        gathererCount: resource.getCurrentGatherers(),
        hasExtractor: resource.hasExtractor(),
      });
    }

    return states;
  }

  private collectProjectileRenderState(): ProjectileRenderState[] {
    const states: ProjectileRenderState[] = [];
    const entities = this.world.getEntitiesWith('Transform', 'Projectile');

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const projectile = entity.get<Projectile>('Projectile')!;

      states.push({
        id: entity.id,
        x: transform.x,
        y: transform.y,
        z: transform.z,
        prevX: transform.prevX,
        prevY: transform.prevY,
        prevZ: transform.prevZ,
        projectileType: projectile.projectileId,
        faction: projectile.sourceFaction ?? 'dominion',
        isActive: !projectile.hasImpacted,
      });
    }

    return states;
  }

  private sendEvents(): void {
    if (this.pendingEvents.length === 0) return;

    postMessage({ type: 'events', events: this.pendingEvents } satisfies WorkerToMainMessage);
    this.pendingEvents = [];
  }

  // ============================================================================
  // GETTERS FOR SYSTEMS
  // ============================================================================

  public getCurrentTick(): number {
    return this.currentTick;
  }

  public getGameTime(): number {
    return this.gameTime;
  }

  public getState(): GameState {
    return this.state;
  }

  public setSelection(entityIds: number[]): void {
    // Deselect previous
    for (const id of this.selectedEntityIds) {
      const entity = this.world.getEntity(id);
      if (entity) {
        const selectable = entity.get<Selectable>('Selectable');
        if (selectable) selectable.deselect();
      }
    }

    // Select new
    this.selectedEntityIds = [...entityIds];
    for (const id of this.selectedEntityIds) {
      const entity = this.world.getEntity(id);
      if (entity) {
        const selectable = entity.get<Selectable>('Selectable');
        if (selectable) selectable.select();
      }
    }
  }

  public setControlGroup(groupNumber: number, entityIds: number[]): void {
    this.controlGroups.set(groupNumber, [...entityIds]);
    for (const id of entityIds) {
      const entity = this.world.getEntity(id);
      if (entity) {
        const selectable = entity.get<Selectable>('Selectable');
        if (selectable) selectable.setControlGroup(groupNumber);
      }
    }
  }

  public requestChecksum(): void {
    if (this.checksumSystem) {
      // Get checksum data from the system
      const checksumData = this.checksumSystem.getLatestChecksum();
      if (checksumData) {
        postMessage({
          type: 'checksum',
          tick: checksumData.tick,
          checksum: checksumData.checksum.toString(),
        } satisfies WorkerToMainMessage);
      }
    }
  }

  public registerAI(playerId: string, difficulty: AIDifficulty): void {
    this.eventBus.emit('ai:registered', { playerId, difficulty });
    this.playerResources.set(playerId, { minerals: 50, vespene: 0, supply: 0, maxSupply: 0 });
  }

  /**
   * Spawn initial entities based on map data.
   * Creates resources and player bases for all players.
   */
  public spawnInitialEntities(mapData: SpawnMapData): void {
    if (DEBUG) {
      console.log('[GameWorker] spawnInitialEntities called:', {
        resourceCount: mapData.resources?.length ?? 0,
        spawnCount: mapData.spawns?.length ?? 0,
        playerSlotCount: mapData.playerSlots?.length ?? 0,
      });
    }

    // Spawn resources
    if (mapData.resources) {
      for (const resourceDef of mapData.resources) {
        const entity = this.world.createEntity();
        entity
          .add(new Transform(resourceDef.x, resourceDef.y, 0))
          .add(new Resource(
            resourceDef.type === 'mineral' ? 'minerals' : 'vespene',
            resourceDef.amount ?? (resourceDef.type === 'mineral' ? 1500 : 2500)
          ));
      }
      if (DEBUG) console.log('[GameWorker] Spawned', mapData.resources.length, 'resources');
    }

    // Get active player slots (human or AI)
    const activeSlots = mapData.playerSlots?.filter(
      slot => slot.type === 'human' || slot.type === 'ai'
    ) ?? [];

    // Track used spawn indices to prevent duplicates
    const usedSpawnIndices = new Set<number>();
    const spawns = mapData.spawns ?? [];

    // Spawn bases for each active player
    for (const slot of activeSlots) {
      // Find the slot's player number (1-8) from the slot.id (e.g., "player1" -> 1)
      const playerNumber = parseInt(slot.id.replace('player', ''), 10);

      // Find spawn point for this player
      let spawnIndex = spawns.findIndex(s => s.playerSlot === playerNumber);
      if (spawnIndex === -1 || usedSpawnIndices.has(spawnIndex)) {
        spawnIndex = spawns.findIndex((_, idx) => !usedSpawnIndices.has(idx));
      }

      if (spawnIndex === -1) {
        console.warn(`[GameWorker] No available spawn point for ${slot.id}`);
        continue;
      }

      const spawn = spawns[spawnIndex];
      usedSpawnIndices.add(spawnIndex);

      // Initialize player resources
      this.playerResources.set(slot.id, {
        minerals: 50,
        vespene: 0,
        supply: 0,
        maxSupply: 11,
      });

      // Spawn base for this player
      this.spawnBase(slot.id, spawn.x, spawn.y);

      // Register AI players with the AI system
      if (slot.type === 'ai' && this.config.aiEnabled) {
        if (DEBUG) console.log(`[GameWorker] Registering AI for ${slot.id} (${slot.faction}, ${slot.aiDifficulty})`);
        this.registerAI(slot.id, slot.aiDifficulty ?? 'medium');

        // Also notify the EnhancedAISystem about this AI player
        const enhancedAI = this.world.getSystem(EnhancedAISystem);
        if (enhancedAI) {
          enhancedAI.registerAI(slot.id, slot.faction, slot.aiDifficulty ?? 'medium');
        }

        // Register with AIMicroSystem for unit micro behavior
        if (this.aiMicroSystem) {
          this.aiMicroSystem.registerAIPlayer(slot.id);
        }
      }
    }

    // Fallback: If no player slots provided, spawn local player at first spawn
    if (activeSlots.length === 0 && spawns.length > 0) {
      this.playerResources.set(this.config.playerId, {
        minerals: 50,
        vespene: 0,
        supply: 0,
        maxSupply: 11,
      });
      this.spawnBase(this.config.playerId, spawns[0].x, spawns[0].y);
    }

    // Set watch towers if available
    if (mapData.watchTowers) {
      this.visionSystem?.setWatchTowers(mapData.watchTowers);
    }

    this.eventBus.emit('game:entitiesSpawned', { mapName: mapData.name });
  }

  private spawnBase(playerId: string, x: number, y: number): void {
    // Spawn Headquarters using proper BuildingDefinition interface
    const ccDef = {
      id: 'headquarters',
      name: 'Headquarters',
      faction: 'dominion',
      mineralCost: 400,
      vespeneCost: 0,
      buildTime: 0,
      width: 5,
      height: 5,
      maxHealth: 1500,
      armor: 2,
      sightRange: 10,
      supplyProvided: 11,
      canProduce: ['fabricator'],
    };

    const headquarters = this.world.createEntity();
    headquarters
      .add(new Transform(x, y, 0))
      .add(new Building(ccDef))
      .add(new Health(ccDef.maxHealth, ccDef.armor, 'structure'))
      .add(new Selectable(Math.max(ccDef.width, ccDef.height) * 0.6, 10, playerId));

    // Mark as complete
    const building = headquarters.get<Building>('Building')!;
    building.buildProgress = 1;
    building.state = 'complete';

    // Emit building placed event
    this.eventBus.emit('building:placed', {
      entityId: headquarters.id,
      buildingType: 'headquarters',
      playerId,
      position: { x, y },
      width: ccDef.width,
      height: ccDef.height,
    });

    // Set rally point
    building.setRallyPoint(x + ccDef.width / 2 + 3, y);

    // Spawn initial workers
    const workerPositions = [
      { dx: -4, dy: -4 },
      { dx: 0, dy: -4 },
      { dx: 4, dy: -4 },
      { dx: -4, dy: 0 },
      { dx: 4, dy: 0 },
      { dx: 0, dy: 4 },
    ];

    for (const pos of workerPositions) {
      this.spawnUnit('fabricator', playerId, x + pos.dx, y + pos.dy);
    }
  }

  private spawnUnit(unitType: string, playerId: string, x: number, y: number): void {
    // Spawn unit using proper UnitDefinition interface
    const unitDef = {
      id: unitType,
      name: 'Fabricator',
      faction: 'dominion',
      mineralCost: 50,
      vespeneCost: 0,
      buildTime: 17,
      supplyCost: 1,
      speed: 2.8,
      sightRange: 8,
      attackRange: 0,
      attackDamage: 0,
      attackSpeed: 0,
      damageType: 'normal' as const,
      maxHealth: 45,
      armor: 0,
      isWorker: true,
    };

    const unit = this.world.createEntity();
    unit
      .add(new Transform(x, y, 0))
      .add(new Unit(unitDef))
      .add(new Health(unitDef.maxHealth, unitDef.armor, 'light'))
      .add(new Selectable(0.5, 1, playerId))
      .add(new Velocity());

    // Update supply
    const resources = this.playerResources.get(playerId);
    if (resources) {
      resources.supply += 1;
    }
  }
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

let game: WorkerGame | null = null;

self.onmessage = async (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'init': {
        game = new WorkerGame(message.config);
        postMessage({ type: 'initialized', success: true } satisfies WorkerToMainMessage);
        break;
      }

      case 'start': {
        if (DEBUG) console.log('[GameWorker] Received start command');
        if (!game) {
          console.error('[GameWorker] Game not initialized when start called');
          postMessage({ type: 'error', message: 'Game not initialized' } satisfies WorkerToMainMessage);
          return;
        }
        game.start();
        break;
      }

      case 'stop': {
        game?.stop();
        break;
      }

      case 'pause': {
        game?.stop();
        break;
      }

      case 'resume': {
        game?.start();
        break;
      }

      case 'command': {
        if (!game) return;
        game.issueCommand(message.command);
        break;
      }

      case 'multiplayerCommand': {
        if (!game) return;
        game.receiveMultiplayerCommand(message.command);
        break;
      }

      case 'setTerrain': {
        game?.setTerrainGrid(message.terrain);
        break;
      }

      case 'setNavMesh': {
        if (!game) return;
        const success = await game.initializeNavMesh(message.positions, message.indices);
        if (!success) {
          postMessage({ type: 'error', message: 'Failed to initialize navmesh' } satisfies WorkerToMainMessage);
        }
        break;
      }

      case 'setWaterNavMesh': {
        if (!game) return;
        await game.initializeWaterNavMesh(message.positions, message.indices);
        break;
      }

      case 'setDecorations': {
        game?.setDecorationCollisions(message.collisions);
        break;
      }

      case 'registerAI': {
        game?.registerAI(message.playerId, message.difficulty);
        break;
      }

      case 'spawnEntities': {
        game?.spawnInitialEntities(message.mapData);
        break;
      }

      case 'setSelection': {
        game?.setSelection(message.entityIds);
        break;
      }

      case 'setControlGroup': {
        game?.setControlGroup(message.groupNumber, message.entityIds);
        break;
      }

      case 'requestChecksum': {
        game?.requestChecksum();
        break;
      }

      case 'networkPause': {
        if (message.paused) {
          game?.stop();
        } else {
          game?.start();
        }
        break;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    postMessage({ type: 'error', message: errorMessage, stack } satisfies WorkerToMainMessage);
  }
};

// Handle uncaught errors
self.onerror = (event) => {
  const message = typeof event === 'string' ? event : (event as ErrorEvent).message ?? 'Unknown error';
  let stack: string | undefined;
  if (typeof event === 'object' && event !== null) {
    const errEvent = event as ErrorEvent;
    if (errEvent.filename) {
      stack = `${errEvent.filename}:${errEvent.lineno}:${errEvent.colno}`;
    }
  }
  postMessage({
    type: 'error',
    message: `Uncaught error: ${message}`,
    stack,
  } satisfies WorkerToMainMessage);
};

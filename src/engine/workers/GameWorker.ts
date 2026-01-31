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

import { GameCore, GameConfig } from '../core/GameCore';
import { PerformanceMonitor } from '../core/PerformanceMonitor';
import { debugInitialization, debugPerformance } from '@/utils/debugLogger';
import { initializeDefinitions } from '../definitions/bootstrap';

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
import { EnhancedAISystem } from '../systems/EnhancedAISystem';
import { AIEconomySystem } from '../systems/AIEconomySystem';

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
  WorkerPerformanceMetrics,
} from './types';
import type { GameState, TerrainCell } from '../core/GameCore';
import type { GameCommand } from '../core/GameCommand';
import { setWorkerDebugSettings } from '@/utils/debugLogger';

// Re-export types for backwards compatibility
export type { GameState, TerrainCell };

// ============================================================================
// WORKER GAME CLASS
// ============================================================================

/**
 * WorkerGame - Game instance running in a Web Worker
 *
 * Extends GameCore with worker-specific features:
 * - setInterval-based game loop (NOT throttled in workers!)
 * - Render state collection and postMessage
 * - Event forwarding to main thread for audio/effects
 *
 * This is where the actual game simulation runs.
 */
export class WorkerGame extends GameCore {
  // Worker-specific state
  private gameTime = 0;
  private tickMs: number;

  // Game loop (runs in worker via setInterval - NOT throttled!)
  private loopIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastTickTime = 0;
  private accumulator = 0;

  // Command delay for lockstep
  private readonly COMMAND_DELAY_TICKS = 4;

  // Event collection for main thread
  private pendingEvents: GameEvent[] = [];

  // Player resources cache
  private playerResources: Map<string, { minerals: number; vespene: number; supply: number; maxSupply: number }> = new Map();

  // Player team assignments (0 = FFA, 1-4 = team alliance)
  private playerTeams: Map<string, number> = new Map();

  // Selection state (for UI feedback)
  private selectedEntityIds: number[] = [];

  // Idempotency flag to prevent duplicate entity spawning
  private entitiesAlreadySpawned = false;
  private controlGroups: Map<number, number[]> = new Map();

  // Debug tracking
  private hasLoggedFirstRenderState = false;
  private renderStatesSent = 0;

  // Performance collection (zero-cost when disabled)
  private performanceCollectionEnabled = false;
  private perfMetricsInterval: ReturnType<typeof setInterval> | null = null;
  private lastTickDuration = 0;
  private lastSystemTimings: Array<[string, number]> = [];

  constructor(config: GameConfig) {
    super(config);

    this.tickMs = 1000 / config.tickRate;

    // Initialize player resources
    this.playerResources.set(config.playerId, { minerals: 50, vespene: 0, supply: 0, maxSupply: 0 });

    // Setup event listeners for game events to forward
    this.setupEventListeners();

    // Initialize systems
    this.initializeSystems();
  }

  // ============================================================================
  // SYSTEM DEFINITIONS (worker excludes Selection + Audio)
  // ============================================================================

  protected getSystemDefinitions(): any[] {
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

  protected override onSystemCreated(system: any): void {
    super.onSystemCreated(system);

    // Capture ProjectileSystem reference
    if (system.name === 'ProjectileSystem') {
      this._projectileSystem = system as ProjectileSystem;
    }
  }

  // ============================================================================
  // EVENT FORWARDING
  // ============================================================================

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

    // Damage dealt events (for UI damage numbers)
    this.eventBus.on('damage:dealt', (data: any) => {
      this.pendingEvents.push({
        type: 'damage:dealt',
        targetId: data.targetId,
        damage: data.damage,
        targetPos: data.targetPos,
        targetHeight: data.targetHeight,
        isKillingBlow: data.isKillingBlow,
        isCritical: data.isCritical,
        targetIsFlying: data.targetIsFlying,
        targetUnitType: data.targetUnitType,
        targetPlayerId: data.targetPlayerId,
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

  // ============================================================================
  // GAME LOOP (runs via setInterval in worker - NOT throttled!)
  // ============================================================================

  public override start(): void {
    if (this.state === 'running') return;

    if (debugInitialization.isEnabled()) {
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

  public override stop(): void {
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
    const timeBudgetMs = 40;
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

    // Track tick time only when performance collection is enabled (zero-cost when disabled)
    let tickStart = 0;
    if (this.performanceCollectionEnabled) {
      tickStart = performance.now();
    }

    // Update all systems
    this.world.update(deltaTime);

    // Record tick duration for performance metrics
    if (this.performanceCollectionEnabled) {
      this.lastTickDuration = performance.now() - tickStart;
    }

    // Update player resources
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

  public override getGameTime(): number {
    return this.gameTime;
  }

  // ============================================================================
  // RENDER STATE COLLECTION
  // ============================================================================

  private updatePlayerResources(): void {
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

    const units = this.world.getEntitiesWith('Unit', 'Selectable');
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;

      if (!playerSupply.has(selectable.playerId)) {
        playerSupply.set(selectable.playerId, { supply: 0, maxSupply: 0 });
      }
      playerSupply.get(selectable.playerId)!.supply += 1;
    }

    for (const [playerId, supply] of playerSupply) {
      const current = this.playerResources.get(playerId) ?? { minerals: 50, vespene: 0, supply: 0, maxSupply: 0 };
      current.supply = supply.supply;
      current.maxSupply = supply.maxSupply;
      this.playerResources.set(playerId, current);
    }
  }

  private sendRenderState(): void {
    const units = this.collectUnitRenderState();
    const buildings = this.collectBuildingRenderState();
    const resources = this.collectResourceRenderState();
    const projectiles = this.collectProjectileRenderState();

    this.renderStatesSent++;

    if (debugInitialization.isEnabled() && (this.renderStatesSent <= 5 || this.renderStatesSent % 100 === 0)) {
      console.log(`[GameWorker] sendRenderState #${this.renderStatesSent}: units=${units.length}, buildings=${buildings.length}, resources=${resources.length}`);
    }

    if (debugInitialization.isEnabled() && !this.hasLoggedFirstRenderState && (units.length > 0 || buildings.length > 0 || resources.length > 0)) {
      console.log('[GameWorker] First render state with entities:', {
        tick: this.currentTick,
        units: units.length,
        buildings: buildings.length,
        resources: resources.length,
      });
      this.hasLoggedFirstRenderState = true;
    }

    const serializedRenderState: SerializedRenderState = {
      tick: this.currentTick,
      gameTime: this.gameTime,
      gameState: this.state,
      interpolation: this.accumulator / this.tickMs,
      units,
      buildings,
      resources,
      projectiles,
      visionGrids: [],
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
        gatherTargetId: unit.gatherTargetId,
        currentMode: unit.currentMode,
        transformProgress: unit.transformProgress,
        isRepairing: unit.isRepairing,
        repairTargetId: unit.repairTargetId,
        hasSpeedBuff: unit.hasBuff('stim'),
        hasDamageBuff: unit.hasBuff('damage_boost'),
        // Movement/targeting for waypoint visualization
        targetX: unit.targetX,
        targetY: unit.targetY,
        speed: unit.speed,
        // Command queue (serialized for transfer)
        commandQueue: unit.commandQueue.map(cmd => ({
          type: cmd.type,
          targetX: cmd.targetX,
          targetY: cmd.targetY,
          targetEntityId: cmd.targetEntityId,
        })),
        // Combat stats for range overlays
        attackRange: unit.attackRange,
        sightRange: unit.sightRange,
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
        // Combat stats for range overlays
        attackRange: building.attackRange,
        sightRange: building.sightRange,
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
  // SELECTION STATE (forwarded from main thread)
  // ============================================================================

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

  // ============================================================================
  // CHECKSUM (multiplayer)
  // ============================================================================

  public requestChecksum(): void {
    if (this.checksumSystem) {
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

  // ============================================================================
  // PERFORMANCE COLLECTION
  // ============================================================================

  /**
   * Enable or disable performance metrics collection.
   * When enabled, starts a 10Hz interval to send metrics to main thread.
   * When disabled, all timing overhead is eliminated.
   */
  public setPerformanceCollection(enabled: boolean): void {
    if (this.performanceCollectionEnabled === enabled) return;

    this.performanceCollectionEnabled = enabled;
    PerformanceMonitor.setCollecting(enabled);

    if (enabled) {
      // Start 10Hz metrics reporting (100ms interval)
      this.perfMetricsInterval = setInterval(() => this.sendPerformanceMetrics(), 100);
    } else {
      // Stop metrics reporting
      if (this.perfMetricsInterval !== null) {
        clearInterval(this.perfMetricsInterval);
        this.perfMetricsInterval = null;
      }
      // Clear cached data
      this.lastTickDuration = 0;
      this.lastSystemTimings = [];
    }
  }

  /**
   * Collect and send performance metrics to main thread.
   * Called at 10Hz when collection is enabled.
   */
  private sendPerformanceMetrics(): void {
    if (!this.performanceCollectionEnabled) return;

    // Get system timings from PerformanceMonitor
    const systemTimings = PerformanceMonitor.getSystemTimings();
    const timingTuples: Array<[string, number]> = systemTimings.map(t => [t.name, t.duration]);

    // Cache for next call (in case update hasn't run)
    this.lastSystemTimings = timingTuples;

    // Get entity counts (O(1) - just reading lengths)
    const units = this.world.getEntitiesWith('Unit').length;
    const buildings = this.world.getEntitiesWith('Building').length;
    const resources = this.world.getEntitiesWith('Resource').length;
    const projectiles = this.world.getEntitiesWith('Projectile').length;

    const metrics: WorkerPerformanceMetrics = {
      tickTime: this.lastTickDuration,
      systemTimings: timingTuples,
      entityCounts: [units, buildings, resources, projectiles],
    };

    postMessage({ type: 'performanceMetrics', metrics } satisfies WorkerToMainMessage);
  }

  // ============================================================================
  // ENTITY SPAWNING
  // ============================================================================

  public spawnInitialEntities(mapData: SpawnMapData): void {
    // Idempotency guard - prevent duplicate entity spawning
    if (this.entitiesAlreadySpawned) {
      console.warn('[GameWorker] spawnInitialEntities called multiple times - skipping duplicate spawn');
      return;
    }
    this.entitiesAlreadySpawned = true;

    debugInitialization.log('[GameWorker] spawnInitialEntities called:', {
      resourceCount: mapData.resources?.length ?? 0,
      spawnCount: mapData.spawns?.length ?? 0,
      playerSlotCount: mapData.playerSlots?.length ?? 0,
    });

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
      debugInitialization.log('[GameWorker] Spawned', mapData.resources.length, 'resources');
    }

    // Get active player slots
    const activeSlots = mapData.playerSlots?.filter(
      slot => slot.type === 'human' || slot.type === 'ai'
    ) ?? [];

    const usedSpawnIndices = new Set<number>();
    const spawns = mapData.spawns ?? [];

    // Spawn bases for each active player
    for (const slot of activeSlots) {
      const playerNumber = parseInt(slot.id.replace('player', ''), 10);

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

      this.playerResources.set(slot.id, {
        minerals: 50,
        vespene: 0,
        supply: 0,
        maxSupply: 11,
      });

      // Store team assignment (0 = FFA/no team)
      const team = slot.team ?? 0;
      this.playerTeams.set(slot.id, team);

      this.spawnBase(slot.id, spawn.x, spawn.y, team);

      // Register AI players
      if (slot.type === 'ai' && this.config.aiEnabled) {
        debugInitialization.log(`[GameWorker] Registering AI for ${slot.id}`);

        const enhancedAI = this.world.getSystem(EnhancedAISystem);
        if (enhancedAI) {
          enhancedAI.registerAI(slot.id, slot.faction, slot.aiDifficulty ?? 'medium');
        }
      }
    }

    // Fallback
    if (activeSlots.length === 0 && spawns.length > 0) {
      this.playerResources.set(this.config.playerId, {
        minerals: 50,
        vespene: 0,
        supply: 0,
        maxSupply: 11,
      });
      this.playerTeams.set(this.config.playerId, 0); // FFA
      this.spawnBase(this.config.playerId, spawns[0].x, spawns[0].y, 0);
    }

    // Set watch towers
    if (mapData.watchTowers) {
      this.visionSystem?.setWatchTowers(mapData.watchTowers);
    }

    this.eventBus.emit('game:entitiesSpawned', { mapName: mapData.name });

    // Send initial render state so main thread can display entities before game starts
    // This allows the loading screen to complete once entities are ready
    this.sendRenderState();
    debugInitialization.log('[GameWorker] Sent initial render state after spawning entities');
  }

  private spawnBase(playerId: string, x: number, y: number, teamId: number): void {
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
      .add(new Selectable(Math.max(ccDef.width, ccDef.height) * 0.6, 10, playerId, 1, 0, teamId));

    const building = headquarters.get<Building>('Building')!;
    building.buildProgress = 1;
    building.state = 'complete';

    this.eventBus.emit('building:placed', {
      entityId: headquarters.id,
      buildingType: 'headquarters',
      playerId,
      position: { x, y },
      width: ccDef.width,
      height: ccDef.height,
    });

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
      this.spawnUnit('fabricator', playerId, x + pos.dx, y + pos.dy, teamId);
    }
  }

  private spawnUnit(unitType: string, playerId: string, x: number, y: number, teamId: number): void {
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
      .add(new Selectable(0.5, 1, playerId, 1, 0, teamId))
      .add(new Velocity());

    const resources = this.playerResources.get(playerId);
    if (resources) {
      resources.supply += 1;
    }
  }

  /** Get team ID for a player. Used by SpawnSystem to set team on spawned units/buildings. */
  public getPlayerTeam(playerId: string): number {
    return this.playerTeams.get(playerId) ?? 0;
  }
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

let game: WorkerGame | null = null;


if (typeof self !== 'undefined') {
  self.onmessage = async (event: MessageEvent<MainToWorkerMessage>) => {
    const message = event.data;

    try {
      switch (message.type) {
        case 'init': {
          // Load definitions in worker context before creating game
          // Workers have their own JS context, so definitions must be loaded here too
          debugInitialization.log('[GameWorker] Loading definitions in worker...');
          await initializeDefinitions();
          debugInitialization.log('[GameWorker] Definitions loaded, creating WorkerGame');

          game = new WorkerGame(message.config);
          postMessage({ type: 'initialized', success: true } satisfies WorkerToMainMessage);
          break;
        }

        case 'start': {
          debugInitialization.log('[GameWorker] Received start command');
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

        case 'setDebugSettings': {
          setWorkerDebugSettings(message.settings);
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

        case 'spawnEntities': {
          debugInitialization.log('[GameWorker] Received spawnEntities message');
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

        case 'setPerformanceCollection': {
          game?.setPerformanceCollection(message.enabled);
          break;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      postMessage({ type: 'error', message: errorMessage, stack } satisfies WorkerToMainMessage);
    }
  };
}

if (typeof self !== 'undefined') {
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
}

/**
 * Worker Bridge
 *
 * Main thread interface for communicating with the GameWorker.
 * Provides an API similar to the original Game class for easy integration.
 *
 * Responsibilities:
 * - Create and manage the GameWorker
 * - Send commands and initialization data to the worker
 * - Receive render state snapshots and game events
 * - Dispatch events to main thread handlers (audio, effects)
 * - Handle multiplayer message bridging
 */

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  RenderState,
  GameEvent,
  GameCommand,
  UnitRenderState,
  BuildingRenderState,
  ResourceRenderState,
  ProjectileRenderState,
  SpawnMapData,
} from './types';
import { deserializeRenderState } from './types';
import { RenderStateWorldAdapter } from './RenderStateAdapter';
import type { MapData } from '@/data/maps';
import type { GameConfig, GameState, TerrainCell } from '../core/Game';
import type { DebugSettings } from '@/store/uiStore';
import { EventBus } from '../core/EventBus';
import {
  isMultiplayerMode,
  sendMultiplayerMessage,
  addMultiplayerMessageHandler,
  removeMultiplayerMessageHandler,
} from '@/store/multiplayerStore';
import { debugInitialization } from '@/utils/debugLogger';
import { PerformanceMonitor } from '../core/PerformanceMonitor';

// ============================================================================
// TYPES
// ============================================================================

export interface WorkerBridgeConfig {
  config: GameConfig;
  playerId: string;
  onRenderState?: (state: RenderState) => void;
  onGameEvent?: (event: GameEvent) => void;
  onGameOver?: (winnerId: string | null, reason: string) => void;
  onError?: (message: string, stack?: string) => void;
}

// ============================================================================
// WORKER BRIDGE CLASS
// ============================================================================

export class WorkerBridge {
  private static instance: WorkerBridge | null = null;

  private worker: Worker | null = null;
  private config: GameConfig;
  private playerId: string;

  // Event bus for main thread event handling (audio, effects, UI)
  public eventBus: EventBus;

  // Latest render state from worker
  private _renderState: RenderState | null = null;

  // Callbacks
  private onRenderState?: (state: RenderState) => void;
  private onGameEvent?: (event: GameEvent) => void;
  private onGameOver?: (winnerId: string | null, reason: string) => void;
  private onError?: (message: string, stack?: string) => void;

  // State
  private _initialized = false;
  private _running = false;
  private initPromise: Promise<void> | null = null;

  // First render state synchronization
  private firstRenderStateReceived = false;
  private firstRenderStateResolver: (() => void) | null = null;
  private firstRenderStatePromise: Promise<void> | null = null;

  // Multiplayer message handler cleanup
  private multiplayerMessageCleanup: (() => void) | null = null;
  private multiplayerMessageHandler: ((data: unknown) => void) | null = null;

  private constructor(bridgeConfig: WorkerBridgeConfig) {
    this.config = bridgeConfig.config;
    this.playerId = bridgeConfig.playerId;
    this.onRenderState = bridgeConfig.onRenderState;
    this.onGameEvent = bridgeConfig.onGameEvent;
    this.onGameOver = bridgeConfig.onGameOver;
    this.onError = bridgeConfig.onError;

    this.eventBus = new EventBus();
  }

  // ============================================================================
  // SINGLETON
  // ============================================================================

  public static getInstance(bridgeConfig?: WorkerBridgeConfig): WorkerBridge {
    if (!WorkerBridge.instance) {
      if (!bridgeConfig) {
        throw new Error('WorkerBridge.getInstance() requires config on first call');
      }
      WorkerBridge.instance = new WorkerBridge(bridgeConfig);
    }
    return WorkerBridge.instance;
  }

  public static hasInstance(): boolean {
    return WorkerBridge.instance !== null;
  }

  public static resetInstance(): void {
    if (WorkerBridge.instance) {
      WorkerBridge.instance.dispose();
      WorkerBridge.instance = null;
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  public async initialize(): Promise<void> {
    if (this._initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    debugInitialization.log('[WorkerBridge] _initialize() starting');
    // Create the worker
    this.worker = new Worker(new URL('./GameWorker.ts', import.meta.url), { type: 'module' });
    debugInitialization.log('[WorkerBridge] Worker created:', !!this.worker);

    // Set up message handler
    this.worker.onmessage = this.handleWorkerMessage.bind(this);
    this.worker.onerror = (error) => {
      debugInitialization.error('[WorkerBridge] Worker error event:', error.message);
      this.onError?.(error.message);
    };
    debugInitialization.log('[WorkerBridge] Message handlers set up');

    // Initialize the worker with game config
    await this.sendAndWait('init', {
      type: 'init',
      config: this.config,
      playerId: this.playerId,
    });

    // Set up multiplayer message handling
    if (this.config.isMultiplayer) {
      this.setupMultiplayerBridge();
    }

    this._initialized = true;
  }

  private async sendAndWait(expectedType: string, message: MainToWorkerMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for ${expectedType} response`));
      }, 10000);

      const handler = (event: MessageEvent<WorkerToMainMessage>) => {
        if (event.data.type === 'initialized' || event.data.type === 'error') {
          clearTimeout(timeout);
          this.worker?.removeEventListener('message', handler);

          if (event.data.type === 'error') {
            reject(new Error(event.data.message));
          } else {
            resolve();
          }
        }
      };

      this.worker?.addEventListener('message', handler);
      this.worker?.postMessage(message);
    });
  }

  // ============================================================================
  // WORKER MESSAGE HANDLING
  // ============================================================================

  // Debug: track first render state message
  private hasLoggedFirstRenderState = false;

  // Debug: count all messages received
  private messageCount = 0;

  private handleWorkerMessage(event: MessageEvent<WorkerToMainMessage>): void {
    const message = event.data;
    this.messageCount++;

    // Debug: log every 100th message or first 5 messages
    if (this.messageCount <= 5 || this.messageCount % 100 === 0) {
      debugInitialization.log(`[WorkerBridge] Message #${this.messageCount}: type=${message.type}`);
    }

    switch (message.type) {
      case 'renderState':
        // Deserialize the render state (converts array tuples back to Maps)
        const renderState = deserializeRenderState(message.state);

        // Debug: log first render state with entities
        if (
          !this.hasLoggedFirstRenderState &&
          (renderState.units.length > 0 ||
            renderState.buildings.length > 0 ||
            renderState.resources.length > 0)
        ) {
          debugInitialization.log('[WorkerBridge] First renderState message received:', {
            tick: renderState.tick,
            units: renderState.units.length,
            buildings: renderState.buildings.length,
            resources: renderState.resources.length,
            hasCallback: !!this.onRenderState,
          });
          this.hasLoggedFirstRenderState = true;

          // Signal that first render state has been received
          this.firstRenderStateReceived = true;
          if (this.firstRenderStateResolver) {
            this.firstRenderStateResolver();
            this.firstRenderStateResolver = null;
          }
        }
        this._renderState = renderState;

        // CRITICAL: Update the singleton adapter directly via globalThis
        // This ensures all bundles (including Minimap) see the same data
        // regardless of which bundle the callback was created in
        RenderStateWorldAdapter.getInstance().updateFromRenderState(renderState);

        this.onRenderState?.(renderState);
        break;

      case 'events':
        this.dispatchEvents(message.events);
        break;

      case 'gameOver':
        this.onGameOver?.(message.winnerId, message.reason);
        this.eventBus.emit('game:over', { winnerId: message.winnerId, reason: message.reason });
        break;

      case 'error':
        debugInitialization.error('[WorkerBridge] Worker error:', message.message, message.stack);
        this.onError?.(message.message, message.stack);
        break;

      case 'multiplayerCommand':
        // Forward command to peer
        if (isMultiplayerMode()) {
          sendMultiplayerMessage({
            type: 'command',
            payload: message.command,
          });
        }
        break;

      case 'checksum':
        this.eventBus.emit('checksum', { tick: message.tick, checksum: message.checksum });
        break;

      case 'desync':
        this.eventBus.emit('desync', {
          tick: message.tick,
          localChecksum: message.localChecksum,
          remoteChecksum: message.remoteChecksum,
        });
        break;

      case 'performanceMetrics':
        // Forward worker performance metrics to main thread's PerformanceMonitor
        PerformanceMonitor.applyWorkerMetrics(
          message.metrics.tickTime,
          message.metrics.systemTimings,
          message.metrics.entityCounts
        );
        break;
    }
  }

  private dispatchEvents(events: GameEvent[]): void {
    for (const event of events) {
      // Dispatch to event bus for audio/effects handlers
      this.eventBus.emit(event.type, event);

      // Also call the onGameEvent callback if provided
      this.onGameEvent?.(event);
    }
  }

  // ============================================================================
  // MULTIPLAYER BRIDGE
  // ============================================================================

  private setupMultiplayerBridge(): void {
    // Listen for commands from peer and forward to worker
    this.multiplayerMessageHandler = (message: unknown) => {
      const msg = message as { type?: string; payload?: GameCommand; fromPeerId?: string };
      if (msg.type === 'command' && msg.payload) {
        this.worker?.postMessage({
          type: 'multiplayerCommand',
          command: msg.payload,
          fromPeerId: msg.fromPeerId ?? 'unknown',
        } satisfies MainToWorkerMessage);
      }
    };
    addMultiplayerMessageHandler(this.multiplayerMessageHandler);

    // Store cleanup function that removes the handler
    this.multiplayerMessageCleanup = () => {
      if (this.multiplayerMessageHandler) {
        removeMultiplayerMessageHandler(this.multiplayerMessageHandler);
        this.multiplayerMessageHandler = null;
      }
    };
  }

  // ============================================================================
  // SYNCHRONIZATION
  // ============================================================================

  /**
   * Wait for the first render state with entities to be received from the worker.
   * This ensures entities are ready to render before the loading screen completes.
   * Resolves immediately if first render state has already been received.
   */
  public waitForFirstRenderState(): Promise<void> {
    // Already received - resolve immediately
    if (this.firstRenderStateReceived) {
      return Promise.resolve();
    }

    // Create promise if not already waiting
    if (!this.firstRenderStatePromise) {
      this.firstRenderStatePromise = new Promise((resolve) => {
        this.firstRenderStateResolver = resolve;
      });
    }

    return this.firstRenderStatePromise;
  }

  // ============================================================================
  // GAME CONTROL
  // ============================================================================

  public start(): void {
    debugInitialization.log('[WorkerBridge] start() called', {
      initialized: this._initialized,
      running: this._running,
      hasWorker: !!this.worker,
    });
    if (!this._initialized || this._running) {
      debugInitialization.log(
        '[WorkerBridge] start() early return - already running or not initialized'
      );
      return;
    }
    this._running = true;
    debugInitialization.log('[WorkerBridge] Sending start message to worker');
    this.worker?.postMessage({ type: 'start' } satisfies MainToWorkerMessage);
  }

  public stop(): void {
    if (!this._running) return;
    this._running = false;
    this.worker?.postMessage({ type: 'stop' } satisfies MainToWorkerMessage);
  }

  public pause(): void {
    this._running = false;
    this.worker?.postMessage({ type: 'pause' } satisfies MainToWorkerMessage);
  }

  public resume(): void {
    this._running = true;
    this.worker?.postMessage({ type: 'resume' } satisfies MainToWorkerMessage);
  }

  // ============================================================================
  // COMMANDS
  // ============================================================================

  public issueCommand(command: GameCommand): void {
    if (!this._initialized) {
      console.warn(
        '[WorkerBridge] issueCommand called before initialization, command dropped:',
        command.type
      );
      return;
    }
    if (!this.worker) {
      console.warn(
        '[WorkerBridge] issueCommand called but worker is null, command dropped:',
        command.type
      );
      return;
    }
    this.worker.postMessage({ type: 'command', command } satisfies MainToWorkerMessage);
  }

  // ============================================================================
  // TERRAIN & NAVMESH
  // ============================================================================

  public setTerrainGrid(terrain: TerrainCell[][]): void {
    this.worker?.postMessage({ type: 'setTerrain', terrain } satisfies MainToWorkerMessage);
  }

  public setNavMesh(positions: Float32Array, indices: Uint32Array): void {
    // Transfer buffers for efficiency
    this.worker?.postMessage(
      { type: 'setNavMesh', positions, indices } satisfies MainToWorkerMessage,
      [positions.buffer, indices.buffer]
    );
  }

  public setWaterNavMesh(positions: Float32Array, indices: Uint32Array): void {
    this.worker?.postMessage(
      { type: 'setWaterNavMesh', positions, indices } satisfies MainToWorkerMessage,
      [positions.buffer, indices.buffer]
    );
  }

  public setDecorationCollisions(
    collisions: Array<{ x: number; z: number; radius: number }>
  ): void {
    this.worker?.postMessage({ type: 'setDecorations', collisions } satisfies MainToWorkerMessage);
  }

  // ============================================================================
  // DEBUG SETTINGS
  // ============================================================================

  public setDebugSettings(settings: DebugSettings): void {
    this.worker?.postMessage({ type: 'setDebugSettings', settings } satisfies MainToWorkerMessage);
  }

  // ============================================================================
  // PERFORMANCE COLLECTION
  // ============================================================================

  /**
   * Enable or disable performance metrics collection in the worker.
   * When enabled, the worker sends metrics at 10Hz for the performance dashboard.
   * When disabled, zero overhead - no timing, no messages.
   */
  public setPerformanceCollection(enabled: boolean): void {
    this.worker?.postMessage({
      type: 'setPerformanceCollection',
      enabled,
    } satisfies MainToWorkerMessage);
  }

  // ============================================================================
  // ENTITY SPAWNING
  // ============================================================================

  /**
   * Spawn initial entities based on map data.
   * Sends map spawn/resource data to worker for entity creation.
   */
  public spawnInitialEntities(
    mapData: MapData,
    playerSlots?: Array<{
      id: string;
      type: 'human' | 'ai' | 'empty';
      faction: string;
      aiDifficulty?: 'easy' | 'medium' | 'hard' | 'insane';
      team?: number;
    }>
  ): void {
    // Convert expansions to flat resource array
    const resources: Array<{ type: 'mineral' | 'vespene'; x: number; y: number; amount?: number }> =
      [];
    for (const expansion of mapData.expansions) {
      for (const mineral of expansion.minerals) {
        resources.push({
          type: 'mineral',
          x: mineral.x,
          y: mineral.y,
          amount: mineral.amount,
        });
      }
      for (const gas of expansion.vespene) {
        resources.push({
          type: 'vespene',
          x: gas.x,
          y: gas.y,
          amount: gas.amount,
        });
      }
    }

    const spawnData: SpawnMapData = {
      width: mapData.width,
      height: mapData.height,
      name: mapData.name,
      spawns: mapData.spawns,
      resources,
      watchTowers: mapData.watchTowers,
      playerSlots,
    };
    this.worker?.postMessage({
      type: 'spawnEntities',
      mapData: spawnData,
    } satisfies MainToWorkerMessage);
  }

  // ============================================================================
  // SELECTION
  // ============================================================================

  public setSelection(entityIds: number[], playerId: string): void {
    this.worker?.postMessage({
      type: 'setSelection',
      entityIds,
      playerId,
    } satisfies MainToWorkerMessage);

    // Also emit locally for UI update
    this.eventBus.emit('selection:changed', { entityIds, playerId });
  }

  public setControlGroup(groupNumber: number, entityIds: number[]): void {
    this.worker?.postMessage({
      type: 'setControlGroup',
      groupNumber,
      entityIds,
    } satisfies MainToWorkerMessage);
  }

  // ============================================================================
  // MULTIPLAYER
  // ============================================================================

  public setNetworkPaused(paused: boolean): void {
    this.worker?.postMessage({ type: 'networkPause', paused } satisfies MainToWorkerMessage);
  }

  public requestChecksum(): void {
    this.worker?.postMessage({ type: 'requestChecksum' } satisfies MainToWorkerMessage);
  }

  // ============================================================================
  // RENDER STATE ACCESS
  // ============================================================================

  public get renderState(): RenderState | null {
    return this._renderState;
  }

  public get currentTick(): number {
    return this._renderState?.tick ?? 0;
  }

  public get gameTime(): number {
    return this._renderState?.gameTime ?? 0;
  }

  public get gameState(): GameState {
    return this._renderState?.gameState ?? 'initializing';
  }

  public get interpolation(): number {
    return this._renderState?.interpolation ?? 0;
  }

  /**
   * Get unit render states by entity IDs
   */
  public getUnits(entityIds?: number[]): UnitRenderState[] {
    if (!this._renderState) return [];
    if (!entityIds) return this._renderState.units;
    const idSet = new Set(entityIds);
    return this._renderState.units.filter((u) => idSet.has(u.id));
  }

  /**
   * Get building render states by entity IDs
   */
  public getBuildings(entityIds?: number[]): BuildingRenderState[] {
    if (!this._renderState) return [];
    if (!entityIds) return this._renderState.buildings;
    const idSet = new Set(entityIds);
    return this._renderState.buildings.filter((b) => idSet.has(b.id));
  }

  /**
   * Get resource render states
   */
  public getResources(): ResourceRenderState[] {
    return this._renderState?.resources ?? [];
  }

  /**
   * Get projectile render states
   */
  public getProjectiles(): ProjectileRenderState[] {
    return this._renderState?.projectiles ?? [];
  }

  /**
   * Get selected entity IDs
   */
  public getSelectedEntityIds(): number[] {
    return this._renderState?.selectedEntityIds ?? [];
  }

  /**
   * Get control group entity IDs
   */
  public getControlGroup(groupNumber: number): number[] {
    return this._renderState?.controlGroups.get(groupNumber) ?? [];
  }

  /**
   * Get player resources
   */
  public getPlayerResources(
    playerId: string
  ): { minerals: number; vespene: number; supply: number; maxSupply: number } | undefined {
    return this._renderState?.playerResources.get(playerId);
  }

  /**
   * Get entity by ID (searches all entity types)
   */
  public getEntityById(
    entityId: number
  ): UnitRenderState | BuildingRenderState | ResourceRenderState | null {
    if (!this._renderState) return null;

    // Search units
    const unit = this._renderState.units.find((u) => u.id === entityId);
    if (unit) return unit;

    // Search buildings
    const building = this._renderState.buildings.find((b) => b.id === entityId);
    if (building) return building;

    // Search resources
    const resource = this._renderState.resources.find((r) => r.id === entityId);
    if (resource) return resource;

    return null;
  }

  // ============================================================================
  // STATUS
  // ============================================================================

  public get initialized(): boolean {
    return this._initialized;
  }

  public get running(): boolean {
    return this._running;
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  public dispose(): void {
    // Stop the game
    this.stop();

    // Clean up multiplayer handler
    if (this.multiplayerMessageCleanup) {
      this.multiplayerMessageCleanup();
      this.multiplayerMessageCleanup = null;
    }

    // Terminate worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    // Clear state
    this._renderState = null;
    this._initialized = false;
    this._running = false;
    this.initPromise = null;

    // Clear first render state tracking
    this.firstRenderStateReceived = false;
    this.firstRenderStateResolver = null;
    this.firstRenderStatePromise = null;
    this.hasLoggedFirstRenderState = false;

    // Clear event bus
    this.eventBus.clear();
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get the WorkerBridge instance (must be initialized first)
 */
export function getWorkerBridge(): WorkerBridge | null {
  return WorkerBridge.hasInstance() ? WorkerBridge.getInstance() : null;
}

/**
 * Create and initialize a new WorkerBridge
 */
export async function createWorkerBridge(config: WorkerBridgeConfig): Promise<WorkerBridge> {
  const bridge = WorkerBridge.getInstance(config);
  await bridge.initialize();
  return bridge;
}

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
import type { MapData } from '@/data/maps';
import type { GameConfig, GameState, TerrainCell } from '../core/Game';
import type { AIDifficulty } from '../systems/EnhancedAISystem';
import { EventBus } from '../core/EventBus';
import {
  isMultiplayerMode,
  sendMultiplayerMessage,
  addMultiplayerMessageHandler,
  removeMultiplayerMessageHandler,
} from '@/store/multiplayerStore';

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
    // Create the worker
    this.worker = new Worker(
      new URL('./GameWorker.ts', import.meta.url),
      { type: 'module' }
    );

    // Set up message handler
    this.worker.onmessage = this.handleWorkerMessage.bind(this);
    this.worker.onerror = (error) => {
      console.error('[WorkerBridge] Worker error:', error);
      this.onError?.(error.message);
    };

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

  private handleWorkerMessage(event: MessageEvent<WorkerToMainMessage>): void {
    const message = event.data;

    switch (message.type) {
      case 'renderState':
        // Debug: log first render state with entities
        if (!this.hasLoggedFirstRenderState &&
            (message.state.units.length > 0 || message.state.buildings.length > 0 || message.state.resources.length > 0)) {
          console.log('[WorkerBridge] First renderState message received:', {
            tick: message.state.tick,
            units: message.state.units.length,
            buildings: message.state.buildings.length,
            resources: message.state.resources.length,
            hasCallback: !!this.onRenderState,
          });
          this.hasLoggedFirstRenderState = true;
        }
        this._renderState = message.state;
        this.onRenderState?.(message.state);
        break;

      case 'events':
        this.dispatchEvents(message.events);
        break;

      case 'gameOver':
        this.onGameOver?.(message.winnerId, message.reason);
        this.eventBus.emit('game:over', { winnerId: message.winnerId, reason: message.reason });
        break;

      case 'error':
        console.error('[WorkerBridge] Worker error:', message.message, message.stack);
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
  // GAME CONTROL
  // ============================================================================

  public start(): void {
    if (!this._initialized || this._running) return;
    this._running = true;
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
    if (!this._initialized) return;
    this.worker?.postMessage({ type: 'command', command } satisfies MainToWorkerMessage);
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

  public setDecorationCollisions(collisions: Array<{ x: number; z: number; radius: number }>): void {
    this.worker?.postMessage({ type: 'setDecorations', collisions } satisfies MainToWorkerMessage);
  }

  // ============================================================================
  // AI
  // ============================================================================

  public registerAI(playerId: string, difficulty: AIDifficulty): void {
    this.worker?.postMessage({ type: 'registerAI', playerId, difficulty } satisfies MainToWorkerMessage);
  }

  // ============================================================================
  // ENTITY SPAWNING
  // ============================================================================

  /**
   * Spawn initial entities based on map data.
   * Sends map spawn/resource data to worker for entity creation.
   */
  public spawnInitialEntities(mapData: MapData, playerSlots?: Array<{ id: string; type: 'human' | 'ai' | 'empty'; faction: string; aiDifficulty?: 'easy' | 'medium' | 'hard' | 'insane' }>): void {
    // Convert expansions to flat resource array
    const resources: Array<{ type: 'mineral' | 'vespene'; x: number; y: number; amount?: number }> = [];
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
    this.worker?.postMessage({ type: 'spawnEntities', mapData: spawnData } satisfies MainToWorkerMessage);
  }

  // ============================================================================
  // SELECTION
  // ============================================================================

  public setSelection(entityIds: number[], playerId: string): void {
    this.worker?.postMessage({ type: 'setSelection', entityIds, playerId } satisfies MainToWorkerMessage);

    // Also emit locally for UI update
    this.eventBus.emit('selection:changed', { entityIds, playerId });
  }

  public setControlGroup(groupNumber: number, entityIds: number[]): void {
    this.worker?.postMessage({ type: 'setControlGroup', groupNumber, entityIds } satisfies MainToWorkerMessage);
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
    return this._renderState.units.filter(u => idSet.has(u.id));
  }

  /**
   * Get building render states by entity IDs
   */
  public getBuildings(entityIds?: number[]): BuildingRenderState[] {
    if (!this._renderState) return [];
    if (!entityIds) return this._renderState.buildings;
    const idSet = new Set(entityIds);
    return this._renderState.buildings.filter(b => idSet.has(b.id));
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
  public getPlayerResources(playerId: string): { minerals: number; vespene: number; supply: number; maxSupply: number } | undefined {
    return this._renderState?.playerResources.get(playerId);
  }

  /**
   * Get entity by ID (searches all entity types)
   */
  public getEntityById(entityId: number): UnitRenderState | BuildingRenderState | ResourceRenderState | null {
    if (!this._renderState) return null;

    // Search units
    const unit = this._renderState.units.find(u => u.id === entityId);
    if (unit) return unit;

    // Search buildings
    const building = this._renderState.buildings.find(b => b.id === entityId);
    if (building) return building;

    // Search resources
    const resource = this._renderState.resources.find(r => r.id === entityId);
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

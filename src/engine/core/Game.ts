import { GameCore, GameConfig, GameState, TerrainCell } from './GameCore';
import type { SystemDefinition } from './SystemRegistry';
import { GameLoop } from './GameLoop';
import { getSystemDefinitions } from '../systems/systemDependencies';

// Systems that need direct references in Game class
import { SelectionSystem } from '../systems/SelectionSystem';
import { AudioSystem } from '../systems/AudioSystem';

import { debugInitialization, debugPerformance, debugNetworking } from '@/utils/debugLogger';
import { dispatchCommand, type GameCommand } from './GameCommand';
import { Selectable } from '../components/Selectable';
import { RecastNavigation } from '../pathfinding/RecastNavigation';
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
  getAdaptiveCommandDelay,
  getLatencyStats,
} from '@/store/multiplayerStore';

// Multiplayer message types
interface MultiplayerMessage {
  type: 'command' | 'quit' | 'checksum' | 'sync-request' | 'sync-response';
  payload?: unknown;
  commandType?: string;
  data?: unknown;
}

interface SyncRequestPayload {
  lastKnownTick: number;
  playerId: string;
}

interface SyncResponsePayload {
  currentTick: number;
  commands: Array<{ tick: number; commands: GameCommand[] }>;
  playerId: string;
}

import { DesyncDetectionManager } from '../network/DesyncDetection';
import { commandIdGenerator } from '../network/types';
import type { GameStatePort } from './GameStatePort';
import { ZustandStateAdapter } from '@/adapters/ZustandStateAdapter';

// Re-export types for backwards compatibility
export type { GameState, TerrainCell, GameConfig } from './GameCore';

/**
 * Game - Main thread game instance
 *
 * Extends GameCore with main-thread-specific features:
 * - SelectionSystem (requires Three.js raycasting)
 * - AudioSystem (requires Web Audio API)
 * - Multiplayer message handling
 * - Performance monitoring
 *
 * The actual game simulation runs in the worker (WorkerGame).
 * This class handles UI interaction and audio playback.
 */
export class Game extends GameCore {
  private static instance: Game | null = null;

  public statePort: GameStatePort;
  public audioSystem: AudioSystem;

  // Systems assigned during initializeSystems() - null until then
  private _selectionSystem: SelectionSystem | null = null;

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

  // Determinism and multiplayer sync systems (only active in multiplayer)
  public desyncDetection: DesyncDetectionManager | null = null;

  private gameLoop: GameLoop;

  // Mutex flag to prevent double game start race condition
  private startMutex = false;

  // Command delay for lockstep multiplayer
  private readonly DEFAULT_COMMAND_DELAY_TICKS = 4;
  private currentCommandDelay = 4;
  private readonly DELAY_RECALC_INTERVAL = 20;

  // LOCKSTEP BARRIER: Track which players have sent commands for each tick
  private tickCommandReceipts: Map<number, Set<string>> = new Map();
  private readonly LOCKSTEP_TIMEOUT_TICKS = 10;

  // Command history for sync responses
  private executedCommandHistory: Map<number, GameCommand[]> = new Map();
  private readonly COMMAND_HISTORY_SIZE = 200;

  // Sync state
  private awaitingSyncResponse = false;
  private syncRequestTick = 0;

  // Multiplayer message handler reference (for cleanup)
  private multiplayerMessageHandler: ((data: unknown) => void) | null = null;

  // LOCKSTEP BARRIER: Track when we first started waiting for a tick
  private tickWaitStart: Map<number, number> = new Map();

  private constructor(config: Partial<GameConfig> = {}, statePort?: GameStatePort) {
    super(config);

    this.statePort = statePort ?? new ZustandStateAdapter();
    this.gameLoop = new GameLoop(this.config.tickRate, this.update.bind(this));

    // Initialize audio system (main-thread only)
    this.audioSystem = new AudioSystem(this as any);

    // Initialize desync detection for multiplayer
    if (this.config.isMultiplayer) {
      this.desyncDetection = new DesyncDetectionManager(this as any, {
        enabled: true,
        pauseOnDesync: false,
        showDesyncIndicator: true,
      });
      this.desyncDetection.setChecksumSystem(this.checksumSystem!);

      this.setupMultiplayerMessageHandler();
      this.setupDesyncHandler();
    }

    this.initializeSystems();
  }

  // ============================================================================
  // SYSTEM DEFINITIONS (main thread includes Selection + Audio)
  // ============================================================================

  protected getSystemDefinitions(): SystemDefinition[] {
    return getSystemDefinitions();
  }

  protected override onSystemCreated(system: any): void {
    super.onSystemCreated(system);

    if (system.name === 'SelectionSystem') {
      this._selectionSystem = system as SelectionSystem;
    }
  }

  // ============================================================================
  // MULTIPLAYER MESSAGE HANDLING
  // ============================================================================

  private setupMultiplayerMessageHandler(): void {
    this.multiplayerMessageHandler = (data: unknown) => {
      const message = data as MultiplayerMessage;
      if (message.type === 'command') {
        if (message.payload) {
          const command = message.payload as GameCommand;

          // SECURITY: Validate playerId matches remote peer
          const remotePeerId = useMultiplayerStore.getState().remotePeerId;
          if (command.playerId !== remotePeerId) {
            console.error(
              `[Game] SECURITY: Rejected command with spoofed playerId. ` +
              `Expected: ${remotePeerId}, Got: ${command.playerId}`
            );
            this.eventBus.emit('security:spoofedPlayerId', {
              expectedPlayerId: remotePeerId,
              spoofedPlayerId: command.playerId,
              commandType: command.type,
              tick: command.tick,
            });
            return;
          }

          // SECURITY: Validate command tick is within acceptable range
          const maxDelay = Math.max(this.currentCommandDelay, this.DEFAULT_COMMAND_DELAY_TICKS, 10);
          const minTick = this.currentTick - maxDelay;
          const maxTick = this.currentTick + 100;
          if (command.tick < minTick || command.tick > maxTick) {
            console.error(
              `[Game] SECURITY: Rejected command with invalid tick. ` +
              `Current: ${this.currentTick}, Command tick: ${command.tick}`
            );
            this.eventBus.emit('security:invalidCommandTick', {
              playerId: command.playerId,
              commandType: command.type,
              commandTick: command.tick,
              currentTick: this.currentTick,
            });
            return;
          }

          debugNetworking.log('[Game] Received remote command for tick', command.tick);
          this.queueCommandWithReceipt(command);
        } else if (message.commandType && message.data) {
          debugNetworking.log('[Game] Received remote command (event format):', message.commandType);
          this.eventBus.emit(message.commandType, message.data);
        }
      } else if (message.type === 'quit') {
        debugNetworking.log('[Game] Remote player quit');
        this.eventBus.emit('multiplayer:playerQuit', message.payload);
      } else if (message.type === 'checksum') {
        const checksumData = message.payload as {
          tick: number;
          checksum: number;
          unitCount: number;
          buildingCount: number;
          resourceSum: number;
          peerId: string;
        };
        this.eventBus.emit('network:checksum', checksumData);
      } else if (message.type === 'sync-request') {
        const syncRequest = message.payload as SyncRequestPayload;
        debugNetworking.log('[Game] Received sync request from', syncRequest.playerId);
        this.handleSyncRequest(syncRequest);
      } else if (message.type === 'sync-response') {
        const syncResponse = message.payload as SyncResponsePayload;
        debugNetworking.log('[Game] Received sync response');
        this.handleSyncResponse(syncResponse);
      }
    };
    addMultiplayerMessageHandler(this.multiplayerMessageHandler);

    // Wire local checksum events to network transmission
    this.eventBus.on('checksum:computed', (data: {
      tick: number;
      checksum: number;
      unitCount: number;
      buildingCount: number;
      resourceSum: number;
    }) => {
      sendMultiplayerMessage({
        type: 'checksum' as const,
        payload: { ...data, peerId: this.config.playerId },
      });
    });
  }

  private setupDesyncHandler(): void {
    this.eventBus.on('desync:detected', (data: {
      tick: number;
      localChecksum: number;
      remoteChecksum: number;
      remotePeerId: string;
    }) => {
      console.error(`[Game] DESYNC at tick ${data.tick}!`);
      reportDesync(data.tick);
      this.eventBus.emit('multiplayer:desync', {
        tick: data.tick,
        localChecksum: data.localChecksum,
        remoteChecksum: data.remoteChecksum,
        message: `Game desynchronized at tick ${data.tick}.`,
      });
      this.state = 'ended';
    });
  }

  // ============================================================================
  // SINGLETON MANAGEMENT
  // ============================================================================

  public static getInstance(config?: Partial<GameConfig>, statePort?: GameStatePort): Game {
    if (!Game.instance) {
      debugInitialization.log(`[Game] CREATING NEW INSTANCE`);
      Game.instance = new Game(config, statePort);
    } else if (config && (config.mapWidth || config.mapHeight)) {
      const oldWidth = Game.instance.config.mapWidth;
      const oldHeight = Game.instance.config.mapHeight;
      if (config.mapWidth) Game.instance.config.mapWidth = config.mapWidth;
      if (config.mapHeight) Game.instance.config.mapHeight = config.mapHeight;

      if (Game.instance.config.mapWidth !== oldWidth || Game.instance.config.mapHeight !== oldHeight) {
        debugInitialization.log(`[Game] DIMENSION CHANGE: ${oldWidth}x${oldHeight} -> ${Game.instance.config.mapWidth}x${Game.instance.config.mapHeight}`);
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
    RecastNavigation.resetInstance();
  }

  // ============================================================================
  // GAME LIFECYCLE
  // ============================================================================

  public override start(gameStartTime?: number): void {
    if (this.state === 'running') return;

    // Reset command ID generator for deterministic IDs from tick 0
    commandIdGenerator.reset();

    this.state = 'initializing';
    const countdownDuration = 4000;
    const scheduledStartTime = gameStartTime ?? (Date.now() + countdownDuration);

    const startGameLoop = () => {
      if (this.startMutex || this.state === 'running') return;
      this.startMutex = true;

      this.state = 'running';
      this.gameLoop.start();
      PerformanceMonitor.start();
      this.eventBus.emit('game:started', { tick: this.currentTick });
    };

    this.eventBus.emit('game:countdown', { startTime: scheduledStartTime });

    const delayUntilStart = scheduledStartTime - Date.now();
    if (delayUntilStart <= 0) {
      debugInitialization.log('[Game] Start time passed - starting immediately');
      startGameLoop();
    } else {
      debugInitialization.log(`[Game] Scheduling game start in ${delayUntilStart}ms`);
      setTimeout(() => startGameLoop(), delayUntilStart);
    }

    this.eventBus.once('game:countdownComplete', () => {
      debugInitialization.log('[Game] Countdown complete');
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

  public override stop(): void {
    this.state = 'ended';
    this.gameLoop.stop();
    PerformanceMonitor.stop();

    this.notifyQuit();

    if (this.multiplayerMessageHandler) {
      removeMultiplayerMessageHandler(this.multiplayerMessageHandler);
      this.multiplayerMessageHandler = null;
    }

    this.eventBus.emit('game:ended', { tick: this.currentTick });
    this.eventBus.clear();
    this.commandQueue.clear();
    this.startMutex = false;
  }

  // ============================================================================
  // GAME UPDATE LOOP
  // ============================================================================

  private update(deltaTime: number): void {
    if (this.state !== 'running') return;

    if (this.config.isMultiplayer && isNetworkPaused()) {
      return;
    }

    if (this.config.isMultiplayer && getDesyncState() === 'desynced') {
      return;
    }

    // LOCKSTEP BARRIER: In multiplayer, wait for all players before advancing tick
    if (this.config.isMultiplayer) {
      const nextTick = this.currentTick + 1;
      if (!this.hasAllCommandsForTick(nextTick)) {
        // Start tracking wait time if not already
        if (!this.tickWaitStart.has(nextTick)) {
          this.tickWaitStart.set(nextTick, this.currentTick);
          debugNetworking.log(`[Game] LOCKSTEP: Waiting for commands for tick ${nextTick}`);
        }

        // Check for timeout
        const waitStartTick = this.tickWaitStart.get(nextTick)!;
        const ticksWaited = this.currentTick - waitStartTick;

        if (ticksWaited >= this.LOCKSTEP_TIMEOUT_TICKS) {
          // Timeout - report desync and proceed anyway to avoid infinite hang
          console.error(
            `[Game] LOCKSTEP TIMEOUT: No commands from all players for tick ${nextTick} ` +
            `after waiting ${ticksWaited} ticks. Expected: ${this.getExpectedPlayerIds().join(', ')}, ` +
            `Received: ${Array.from(this.tickCommandReceipts.get(nextTick) || []).join(', ')}`
          );
          reportDesync(nextTick);
          this.eventBus.emit('desync:detected', {
            tick: nextTick,
            localChecksum: 0,
            remoteChecksum: 0,
            remotePeerId: useMultiplayerStore.getState().remotePeerId || 'unknown',
            reason: 'lockstep_timeout',
          });
          // Clear wait tracking and proceed - game may desync but won't freeze
          this.tickWaitStart.delete(nextTick);
        } else {
          // Still waiting - skip this frame
          return;
        }
      } else {
        // Got all commands - clear wait tracking
        this.tickWaitStart.delete(nextTick);
      }
    }

    const tickStart = performance.now();

    this.currentTick++;
    this.world.setCurrentTick(this.currentTick);

    // Sync command ID generator with current tick for deterministic command IDs
    commandIdGenerator.setTick(this.currentTick);

    if (this.config.isMultiplayer) {
      this.processQueuedCommandsWithCleanup();
      // Send heartbeats for upcoming ticks to keep lockstep flowing
      this.ensureHeartbeatsForUpcomingTicks();
    }

    this.world.update(deltaTime);

    this.eventBus.emit('game:tick', {
      tick: this.currentTick,
      deltaTime,
    });

    const tickElapsed = performance.now() - tickStart;
    PerformanceMonitor.recordTickTime(tickElapsed);

    if (this.currentTick % 20 === 0) {
      this.updateEntityCounts();
    }

    if (this.config.isMultiplayer && this.currentTick % this.DELAY_RECALC_INTERVAL === 0) {
      this.updateAdaptiveCommandDelay();
    }

    if (tickElapsed > 10) {
      debugPerformance.warn(`[Game] TICK ${this.currentTick}: ${tickElapsed.toFixed(1)}ms`);
    }
  }

  // ============================================================================
  // LOCKSTEP BARRIER HELPERS
  // ============================================================================

  /**
   * Get the set of player IDs that should send commands for lockstep.
   * In 2-player multiplayer, this is local player + remote peer.
   */
  private getExpectedPlayerIds(): string[] {
    const players: string[] = [this.config.playerId];
    const remotePeerId = useMultiplayerStore.getState().remotePeerId;
    if (remotePeerId) {
      players.push(remotePeerId);
    }
    return players;
  }

  /**
   * Check if we have received command acknowledgments from all expected players for a tick.
   * For lockstep, every player must send at least one command or heartbeat for each tick.
   * We track receipts when commands are queued via queueCommandWithReceipt().
   */
  private hasAllCommandsForTick(tick: number): boolean {
    const expectedPlayers = this.getExpectedPlayerIds();
    const receipts = this.tickCommandReceipts.get(tick);

    if (!receipts) {
      // No commands received yet for this tick
      return false;
    }

    // Check if all expected players have sent commands
    for (const playerId of expectedPlayers) {
      if (!receipts.has(playerId)) {
        return false;
      }
    }

    return true;
  }

  // Track which ticks we've sent commands for (to avoid duplicate heartbeats)
  private sentCommandForTick: Set<number> = new Set();

  /**
   * Send a heartbeat command to acknowledge a tick when no other commands were sent.
   * This ensures the lockstep barrier can proceed even when a player has no actions.
   */
  private sendHeartbeatForTick(tick: number): void {
    if (this.sentCommandForTick.has(tick)) {
      return; // Already sent a command for this tick
    }

    const heartbeat: GameCommand = {
      tick,
      playerId: this.config.playerId,
      type: 'HEARTBEAT',
      entityIds: [],
    };

    sendMultiplayerMessage({
      type: 'command',
      payload: heartbeat,
    });

    this.queueCommandWithReceipt(heartbeat);
    this.sentCommandForTick.add(tick);

    // Cleanup old entries
    const oldestRelevant = this.currentTick - this.COMMAND_HISTORY_SIZE;
    for (const t of this.sentCommandForTick) {
      if (t < oldestRelevant) {
        this.sentCommandForTick.delete(t);
      }
    }

    debugNetworking.log(`[Game] Sent heartbeat for tick ${tick}`);
  }

  /**
   * Ensure heartbeats are sent for upcoming ticks that need acknowledgment.
   * Called periodically to keep lockstep in sync.
   */
  private ensureHeartbeatsForUpcomingTicks(): void {
    // Send heartbeats for ticks within the command delay window
    const startTick = this.currentTick + 1;
    const endTick = this.currentTick + this.currentCommandDelay + 1;

    for (let tick = startTick; tick <= endTick; tick++) {
      if (!this.sentCommandForTick.has(tick)) {
        this.sendHeartbeatForTick(tick);
      }
    }
  }

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
      effects: 0,
    });
  }

  // ============================================================================
  // COMMAND HANDLING (extends base with multiplayer features)
  // ============================================================================

  public getCommandDelayTicks(): number {
    if (!this.config.isMultiplayer) {
      return this.DEFAULT_COMMAND_DELAY_TICKS;
    }
    return this.currentCommandDelay;
  }

  private updateAdaptiveCommandDelay(): void {
    if (!this.config.isMultiplayer) return;

    const newDelay = getAdaptiveCommandDelay(this.config.tickRate);

    if (newDelay > this.currentCommandDelay) {
      this.currentCommandDelay = Math.min(this.currentCommandDelay + 1, newDelay);
    } else if (newDelay < this.currentCommandDelay) {
      this.currentCommandDelay = Math.max(this.currentCommandDelay - 1, newDelay);
    }
  }

  public issueCommand(command: GameCommand): void {
    if (isMultiplayerMode()) {
      const executionTick = this.currentTick + this.currentCommandDelay;
      command.tick = executionTick;

      sendMultiplayerMessage({
        type: 'command',
        payload: command,
      });
      debugNetworking.log('[Game] Sent command for tick', executionTick);

      this.queueCommandWithReceipt(command);

      // Track that we sent a real command for this tick (not just a heartbeat)
      this.sentCommandForTick.add(executionTick);
    } else {
      this.processCommand(command);
    }
  }

  /**
   * Issue an AI command. In multiplayer, AI commands execute at current tick
   * since AI logic is deterministic and runs identically on all clients.
   * Commands are recorded for desync detection but not broadcast (both clients compute same AI).
   */
  public issueAICommand(command: GameCommand): void {
    // Ensure command tick is set to current tick for deterministic execution
    command.tick = this.currentTick;

    if (this.config.isMultiplayer) {
      // In multiplayer, record the command for desync detection
      // Both clients compute identical AI decisions, so no network broadcast needed
      this.recordExecutedCommand(command);
    }

    // Execute command via parent class (bypasses multiplayer validation since AI is local)
    super.processCommand(command);
  }

  /**
   * Check if this client is in multiplayer mode.
   * Used by AI systems to disable non-deterministic features.
   */
  public isInMultiplayerMode(): boolean {
    return this.config.isMultiplayer;
  }

  private queueCommandWithReceipt(command: GameCommand): void {
    this.queueCommand(command);

    // Track receipt for lockstep barrier
    const tick = command.tick;
    if (!this.tickCommandReceipts.has(tick)) {
      this.tickCommandReceipts.set(tick, new Set());
    }
    this.tickCommandReceipts.get(tick)!.add(command.playerId);
  }

  private recordExecutedCommand(command: GameCommand): void {
    const tick = command.tick;
    if (!this.executedCommandHistory.has(tick)) {
      this.executedCommandHistory.set(tick, []);
    }
    this.executedCommandHistory.get(tick)!.push(command);

    // Cleanup old history
    const oldestAllowed = this.currentTick - this.COMMAND_HISTORY_SIZE;
    for (const historyTick of this.executedCommandHistory.keys()) {
      if (historyTick < oldestAllowed) {
        this.executedCommandHistory.delete(historyTick);
      }
    }
  }

  public override processCommand(command: GameCommand): void {
    // Validate authorization in multiplayer
    if (this.config.isMultiplayer && !this.validateCommandAuthorization(command)) {
      return;
    }

    if (this.config.isMultiplayer) {
      this.recordExecutedCommand(command);
    }

    super.processCommand(command);
  }

  private processQueuedCommandsWithCleanup(): void {
    // Process commands for current tick
    const commands = this.commandQueue.get(this.currentTick);
    if (commands) {
      commands.sort((a, b) => a.playerId.localeCompare(b.playerId));
      for (const command of commands) {
        this.processCommand(command);
      }
      this.commandQueue.delete(this.currentTick);
    }

    this.tickCommandReceipts.delete(this.currentTick);

    // Handle stale commands
    const staleTicks: number[] = [];
    for (const tick of this.commandQueue.keys()) {
      if (tick < this.currentTick) {
        staleTicks.push(tick);
      }
    }
    for (const tick of staleTicks) {
      const staleCommands = this.commandQueue.get(tick);
      console.error(
        `[Game] CRITICAL: Stale commands for tick ${tick} ` +
        `(current: ${this.currentTick}). Commands from: ${staleCommands?.map(c => c.playerId).join(', ')}`
      );
      reportDesync(tick);
      this.eventBus.emit('desync:detected', {
        tick,
        localChecksum: 0,
        remoteChecksum: 0,
        remotePeerId: useMultiplayerStore.getState().remotePeerId || 'unknown',
        reason: 'stale_commands',
      });
      this.commandQueue.delete(tick);
      this.tickCommandReceipts.delete(tick);
    }

    // Cleanup wait tracking
    for (const tick of this.tickWaitStart.keys()) {
      if (tick <= this.currentTick) {
        this.tickWaitStart.delete(tick);
      }
    }
  }

  private validateCommandAuthorization(command: GameCommand): boolean {
    const noEntityValidationCommands: GameCommand['type'][] = ['BUILD', 'BUILD_WALL'];

    if (noEntityValidationCommands.includes(command.type)) {
      return true;
    }

    if (!command.entityIds || command.entityIds.length === 0) {
      return true;
    }

    for (const entityId of command.entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const selectable = entity.get<Selectable>('Selectable');
      if (!selectable) continue;

      if (selectable.playerId !== command.playerId) {
        console.error(
          `[Game] AUTHORIZATION FAILED: Player ${command.playerId} ` +
          `tried to control entity ${entityId} owned by ${selectable.playerId}`
        );
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

    // Validate special entity references
    if (command.transportId !== undefined) {
      const transport = this.world.getEntity(command.transportId);
      const selectable = transport?.get<Selectable>('Selectable');
      if (selectable && selectable.playerId !== command.playerId) {
        return false;
      }
    }

    if (command.bunkerId !== undefined) {
      const bunker = this.world.getEntity(command.bunkerId);
      const selectable = bunker?.get<Selectable>('Selectable');
      if (selectable && selectable.playerId !== command.playerId) {
        return false;
      }
    }

    if (command.buildingId !== undefined) {
      const building = this.world.getEntity(command.buildingId);
      const selectable = building?.get<Selectable>('Selectable');
      if (selectable && selectable.playerId !== command.playerId) {
        return false;
      }
    }

    return true;
  }

  // ============================================================================
  // SYNC HANDLING
  // ============================================================================

  public requestSync(): void {
    if (!this.config.isMultiplayer) return;

    debugNetworking.log('[Game] Requesting sync from tick:', this.currentTick);

    this.awaitingSyncResponse = true;
    this.syncRequestTick = this.currentTick;

    sendMultiplayerMessage({
      type: 'sync-request',
      payload: {
        lastKnownTick: this.currentTick,
        playerId: this.config.playerId,
      } as SyncRequestPayload,
    });

    useMultiplayerStore.getState().setNetworkPaused(true, 'Synchronizing game state...');
  }

  private handleSyncRequest(request: SyncRequestPayload): void {
    const commandsToSend: Array<{ tick: number; commands: GameCommand[] }> = [];

    for (let tick = request.lastKnownTick + 1; tick <= this.currentTick; tick++) {
      const commands = this.executedCommandHistory.get(tick);
      if (commands && commands.length > 0) {
        commandsToSend.push({ tick, commands });
      }
    }

    debugNetworking.log('[Game] Sending sync response with', commandsToSend.length, 'tick entries');

    sendMultiplayerMessage({
      type: 'sync-response',
      payload: {
        currentTick: this.currentTick,
        commands: commandsToSend,
        playerId: this.config.playerId,
      } as SyncResponsePayload,
    });
  }

  private handleSyncResponse(response: SyncResponsePayload): void {
    if (!this.awaitingSyncResponse) {
      debugNetworking.warn('[Game] Unexpected sync response');
      return;
    }

    this.awaitingSyncResponse = false;

    let totalCommands = 0;
    for (const { tick, commands } of response.commands) {
      for (const command of commands) {
        if (tick <= this.currentTick) {
          this.processCommand(command);
        } else {
          this.queueCommand(command);
        }
        totalCommands++;
      }
    }

    debugNetworking.log('[Game] Sync complete:', totalCommands, 'commands');

    useMultiplayerStore.getState().setNetworkPaused(false);

    this.eventBus.emit('multiplayer:syncComplete', {
      fromTick: this.syncRequestTick,
      toTick: response.currentTick,
      commandsReplayed: totalCommands,
    });
  }

  public notifyQuit(): void {
    if (isMultiplayerMode()) {
      sendMultiplayerMessage({
        type: 'quit',
        payload: { playerId: this.config.playerId },
      });
      debugNetworking.log('[Game] Sent quit notification');
    }
  }

  // ============================================================================
  // MAIN-THREAD-ONLY: TERRAIN WITH LOGGING
  // ============================================================================

  public override setTerrainGrid(terrain: TerrainCell[][]): void {
    debugInitialization.log(`[Game] SET_TERRAIN_GRID: ${terrain[0]?.length}x${terrain.length}`);
    super.setTerrainGrid(terrain);
  }

  // ============================================================================
  // MAIN-THREAD-ONLY: NAVMESH WITH LOGGING
  // ============================================================================

  public override async initializeNavMesh(
    positions: Float32Array,
    indices: Uint32Array
  ): Promise<boolean> {
    debugInitialization.log(`[Game] INITIALIZING_NAVMESH: ${positions.length / 3} vertices`);
    return super.initializeNavMesh(positions, indices);
  }

  public override async initializeWaterNavMesh(
    positions: Float32Array,
    indices: Uint32Array
  ): Promise<boolean> {
    debugInitialization.log(`[Game] INITIALIZING_WATER_NAVMESH: ${positions.length / 3} vertices`);
    return super.initializeWaterNavMesh(positions, indices);
  }
}

// Re-export GameCommand for backwards compatibility
export type { GameCommand } from './GameCommand';

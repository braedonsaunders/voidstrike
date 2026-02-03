/**
 * useWorkerBridge Hook
 *
 * Manages the game worker lifecycle including WorkerBridge creation,
 * MainThreadEventHandler setup, and game instance initialization.
 * Handles communication between the main thread and web worker.
 */

import type { MutableRefObject } from 'react';
import { useRef, useEffect, useCallback, useState } from 'react';

import { Game } from '@/engine/core/Game';
import type { EventBus } from '@/engine/core/EventBus';
import type { IWorldProvider } from '@/engine/ecs/IWorldProvider';
import { initializeDefinitions, definitionsReady } from '@/engine/definitions/bootstrap';
import {
  WorkerBridge,
  MainThreadEventHandler,
  RenderStateWorldAdapter,
  type RenderState,
  type GameEvent,
} from '@/engine/workers';
import { useGameSetupStore, getLocalPlayerId, isBattleSimulatorMode, type GameSetupState } from '@/store/gameSetupStore';
import { useUIStore } from '@/store/uiStore';
import { useGameStore } from '@/store/gameStore';
import { isMultiplayerMode } from '@/store/multiplayerStore';
import { MapData } from '@/data/maps';
import { debugInitialization, debugNetworking } from '@/utils/debugLogger';

export interface UseWorkerBridgeProps {
  map: MapData;
  onGameOver?: (winnerId: string | null, reason: string) => void;
}

export interface UseWorkerBridgeReturn {
  /** Reference to the WorkerBridge instance */
  workerBridgeRef: MutableRefObject<WorkerBridge | null>;
  /** Reference to the MainThreadEventHandler instance */
  eventHandlerRef: MutableRefObject<MainThreadEventHandler | null>;
  /** Reference to the Game instance (selection system only) */
  gameRef: MutableRefObject<Game | null>;
  /** Reference to the world provider (RenderStateWorldAdapter) */
  worldProviderRef: MutableRefObject<IWorldProvider | null>;
  /** Reference to the event bus */
  eventBusRef: MutableRefObject<EventBus | null>;
  /** Whether the worker bridge is initialized */
  isInitialized: boolean;
  /** Whether the game has finished */
  isGameFinished: boolean;
  /** Initialize the worker bridge */
  initializeWorkerBridge: () => Promise<boolean>;
  /** Spawn initial entities on the map */
  spawnEntities: () => Promise<void>;
  /** Get the current game time */
  getGameTime: () => number;
}

export function useWorkerBridge({ map, onGameOver }: UseWorkerBridgeProps): UseWorkerBridgeReturn {
  // Refs
  const workerBridgeRef = useRef<WorkerBridge | null>(null);
  const eventHandlerRef = useRef<MainThreadEventHandler | null>(null);
  const gameRef = useRef<Game | null>(null);
  const worldProviderRef = useRef<IWorldProvider | null>(null);
  const eventBusRef = useRef<EventBus | null>(null);
  const eventUnsubscribersRef = useRef<(() => void)[]>([]);
  const firstRenderStateLoggedRef = useRef(false);

  // State
  const [isInitialized, setIsInitialized] = useState(false);
  const [isGameFinished, setIsGameFinished] = useState(false);

  // Store map in a ref so we always get the latest value
  const mapRef = useRef<MapData>(map);
  useEffect(() => {
    mapRef.current = map;
  }, [map]);

  // Handle render state updates from worker
  const handleRenderState = useCallback((state: RenderState) => {
    if (
      !firstRenderStateLoggedRef.current &&
      (state.units.length > 0 || state.buildings.length > 0 || state.resources.length > 0)
    ) {
      debugInitialization.log('[useWorkerBridge] Received first render state:', {
        tick: state.tick,
        units: state.units.length,
        buildings: state.buildings.length,
        resources: state.resources.length,
      });
      firstRenderStateLoggedRef.current = true;
    }

    // Update game time in store
    useGameStore.getState().setGameTime(state.gameTime);
  }, []);

  // Handle game events from worker
  const handleGameEvent = useCallback((_event: GameEvent) => {
    // Events are dispatched through eventBus by MainThreadEventHandler
  }, []);

  // Handle game over
  const handleGameOver = useCallback(
    (winnerId: string | null, reason: string) => {
      debugInitialization.log(`[useWorkerBridge] Game over: winner=${winnerId}, reason=${reason}`);
      setIsGameFinished(true);

      // Notify UI of game over
      const message = winnerId
        ? `Game over! ${winnerId === getLocalPlayerId() ? 'Victory!' : 'Defeat!'}`
        : `Game over: ${reason}`;
      useUIStore
        .getState()
        .addNotification(winnerId === getLocalPlayerId() ? 'success' : 'warning', message, 10000);

      onGameOver?.(winnerId, reason);
    },
    [onGameOver]
  );

  // Handle worker errors
  const handleWorkerError = useCallback((message: string, stack?: string) => {
    console.error('[GameWorker Error]', message, stack);
    useUIStore.getState().addNotification('error', `Game error: ${message}`, 5000);
  }, []);

  // Get game time from render state adapter
  const getGameTime = useCallback(() => {
    return RenderStateWorldAdapter.getInstance().getGameTime();
  }, []);

  // Initialize worker bridge
  const initializeWorkerBridge = useCallback(async (): Promise<boolean> => {
    if (isInitialized) return true;

    try {
      const currentMap = mapRef.current;
      const mapWidth = currentMap.width;
      const mapHeight = currentMap.height;
      const localPlayerId = getLocalPlayerId();
      const isMultiplayer = isMultiplayerMode();

      debugInitialization.log('[useWorkerBridge] Initializing game (worker mode)');

      // Ensure definitions are loaded before creating Game instance
      if (!definitionsReady()) {
        debugInitialization.log('[useWorkerBridge] Waiting for definitions to load...');
        await initializeDefinitions();
        debugInitialization.log('[useWorkerBridge] Definitions loaded');
      }

      // Create worker bridge for game logic communication
      const fogOfWar = useGameSetupStore.getState().fogOfWar;
      const bridge = WorkerBridge.getInstance({
        config: {
          mapWidth,
          mapHeight,
          tickRate: 20,
          isMultiplayer,
          playerId: localPlayerId ?? 'spectator',
          aiEnabled: !isBattleSimulatorMode() && !isMultiplayer,
          aiDifficulty: 'medium',
          fogOfWar,
        },
        playerId: localPlayerId ?? 'spectator',
        onRenderState: handleRenderState,
        onGameEvent: handleGameEvent,
        onGameOver: handleGameOver,
        onError: handleWorkerError,
      });
      workerBridgeRef.current = bridge;

      // Set up refs for hook consumption
      worldProviderRef.current = RenderStateWorldAdapter.getInstance();
      eventBusRef.current = bridge.eventBus;

      // Create main thread event handler for audio/effects
      // Pass localPlayerId directly - null means spectator mode (no local-only audio)
      const eventHandler = new MainThreadEventHandler(bridge, localPlayerId);
      eventHandlerRef.current = eventHandler;

      // Subscribe to localPlayerId changes to handle spectator mode transitions
      const unsubscribeLocalPlayer = useGameSetupStore.subscribe(
        (state: GameSetupState, prevState: GameSetupState) => {
          if (state.localPlayerId !== prevState.localPlayerId) {
            eventHandler.setLocalPlayerId(state.localPlayerId);
          }
        }
      );
      eventUnsubscribersRef.current.push(unsubscribeLocalPlayer);

      // Initialize the worker
      await bridge.initialize();

      // Sync debug settings to worker for category filtering
      bridge.setDebugSettings(useUIStore.getState().debugSettings);

      // Set terrain data on worker
      bridge.setTerrainGrid(currentMap.terrain);

      // Multiplayer: Remote player quit
      eventUnsubscribersRef.current.push(
        bridge.eventBus.on('multiplayer:playerQuit', () => {
          debugNetworking.log('[Game] Remote player quit the game');
          useUIStore
            .getState()
            .addNotification('warning', 'Remote player has left the game', 10000);
        })
      );

      // Create minimal Game instance for selection system and placement validation
      // Game loop is NOT started - worker handles game logic
      const game = Game.getInstance({
        mapWidth,
        mapHeight,
        tickRate: 20,
        isMultiplayer,
        playerId: localPlayerId ?? 'spectator',
        aiEnabled: false, // AI runs in worker
      });
      gameRef.current = game;

      // Set terrain data on game instance
      game.setTerrainGrid(currentMap.terrain);

      // Configure SelectionSystem:
      // - Use RenderStateWorldAdapter for entity queries (has actual entity data from worker)
      // - Sync selection changes to worker via WorkerBridge.setSelection
      const selectionSystem = game.selectionSystem;
      selectionSystem.setWorldProvider(worldProviderRef.current!);
      selectionSystem.setSelectionSyncCallback((entityIds, playerId) => {
        bridge.setSelection(entityIds, playerId);
      });
      if (localPlayerId) {
        selectionSystem.setPlayerId(localPlayerId);
      }

      // Forward commands to worker via WorkerBridge
      game.setCommandCallback((command) => {
        bridge.issueCommand(command);
      });

      setIsInitialized(true);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[useWorkerBridge] Initialization failed:', error);
      debugInitialization.error('[useWorkerBridge] Initialization failed:', error);

      // Show user-visible notification for initialization failures (e.g., validation errors)
      useUIStore.getState().addNotification(
        'error',
        `Game initialization failed: ${errorMessage}`,
        30000 // Show for 30 seconds so user can read the full error
      );
      return false;
    }
  }, [isInitialized, handleRenderState, handleGameEvent, handleGameOver, handleWorkerError]);

  // Spawn initial entities
  const spawnEntities = useCallback(async () => {
    if (!workerBridgeRef.current) return;

    if (!isBattleSimulatorMode()) {
      const playerSlots = useGameSetupStore.getState().playerSlots.map((slot) => ({
        id: slot.id,
        type: slot.type === 'open' || slot.type === 'closed' ? ('empty' as const) : slot.type,
        faction: slot.faction,
        aiDifficulty: slot.aiDifficulty,
        team: slot.team,
      }));
      workerBridgeRef.current.spawnInitialEntities(mapRef.current, playerSlots);

      // Wait for first render state with entities before completing loading
      await workerBridgeRef.current.waitForFirstRenderState();
      debugInitialization.log('[useWorkerBridge] First render state received, entities ready');
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Unsubscribe from events
      for (const unsubscribe of eventUnsubscribersRef.current) {
        unsubscribe();
      }
      eventUnsubscribersRef.current = [];

      // Cleanup worker and game resources
      if (eventHandlerRef.current) {
        eventHandlerRef.current.stopGameplayMusic();
        eventHandlerRef.current.dispose();
        eventHandlerRef.current = null;
      }
      if (workerBridgeRef.current) {
        WorkerBridge.resetInstance();
        workerBridgeRef.current = null;
      }
      RenderStateWorldAdapter.resetInstance();
      worldProviderRef.current = null;
      eventBusRef.current = null;

      if (gameRef.current) {
        Game.resetInstance();
        gameRef.current = null;
      }
    };
  }, []);

  return {
    workerBridgeRef,
    eventHandlerRef,
    gameRef,
    worldProviderRef,
    eventBusRef,
    isInitialized,
    isGameFinished,
    initializeWorkerBridge,
    spawnEntities,
    getGameTime,
  };
}

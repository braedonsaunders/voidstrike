/**
 * useGameInput Hook
 *
 * Thin React wrapper around the InputManager singleton.
 * Provides React integration for the centralized input system.
 *
 * Key features:
 * - Initializes InputManager once on mount
 * - Syncs selection state to React via useSyncExternalStore
 * - Updates dependencies when refs change
 * - Cleans up on unmount
 */

import type { RefObject, MutableRefObject } from 'react';
import { useRef, useCallback, useEffect, useSyncExternalStore } from 'react';
import { Game } from '@/engine/core/Game';
import type { IWorldProvider } from '@/engine/ecs/IWorldProvider';
import type { EventBus } from '@/engine/core/EventBus';
import { RTSCamera } from '@/rendering/Camera';
import { BuildingPlacementPreview } from '@/rendering/BuildingPlacementPreview';
import { WallPlacementPreview } from '@/rendering/WallPlacementPreview';
import { TSLGameOverlayManager } from '@/rendering/tsl';
import { getLocalPlayerId } from '@/store/gameSetupStore';
import {
  InputManager,
  GameplayInputHandler,
  CommandInputHandler,
  BuildingInputHandler,
  WallInputHandler,
  type SelectionState,
} from '@/engine/input';

// =============================================================================
// TYPES
// =============================================================================

export interface UseGameInputProps {
  containerRef: RefObject<HTMLDivElement | null>;
  cameraRef: MutableRefObject<RTSCamera | null>;
  gameRef: MutableRefObject<Game | null>;
  /** World provider for entity queries - if provided, uses this instead of game.world */
  worldProviderRef?: MutableRefObject<IWorldProvider | null>;
  /** Event bus for emitting commands - if provided, uses this instead of game.eventBus */
  eventBusRef?: MutableRefObject<EventBus | null>;
  /** Signal that game is initialized - triggers InputManager dependency update */
  isGameInitialized?: boolean;
  placementPreviewRef: MutableRefObject<BuildingPlacementPreview | null>;
  wallPlacementPreviewRef: MutableRefObject<WallPlacementPreview | null>;
  overlayManagerRef: MutableRefObject<TSLGameOverlayManager | null>;
  lastControlGroupTap: MutableRefObject<{ group: number; time: number } | null>;
}

export interface UseGameInputReturn {
  selectionState: SelectionState;
}

// Default selection state for SSR or before initialization
const defaultSelectionState: SelectionState = {
  isSelecting: false,
  selectionStart: { x: 0, y: 0 },
  selectionEnd: { x: 0, y: 0 },
};

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

export function useGameInput({
  containerRef,
  cameraRef,
  gameRef,
  worldProviderRef,
  eventBusRef,
  isGameInitialized,
  placementPreviewRef,
  wallPlacementPreviewRef,
}: UseGameInputProps): UseGameInputReturn {
  // Track if we've initialized
  const initializedRef = useRef(false);
  const handlersRef = useRef<{
    gameplay: GameplayInputHandler;
    command: CommandInputHandler;
    ability: CommandInputHandler;
    rally: CommandInputHandler;
    repair: CommandInputHandler;
    building: BuildingInputHandler;
    landing: BuildingInputHandler;
    wall: WallInputHandler;
  } | null>(null);

  // =============================================================================
  // INITIALIZATION
  // =============================================================================

  useEffect(() => {
    const container = containerRef.current;
    if (!container || initializedRef.current) return;

    const inputManager = InputManager.getInstance();

    // Create handlers
    const gameplayHandler = new GameplayInputHandler();
    const commandHandler = new CommandInputHandler('command');
    const abilityHandler = new CommandInputHandler('ability');
    const rallyHandler = new CommandInputHandler('rally');
    const repairHandler = new CommandInputHandler('repair');
    const buildingHandler = new BuildingInputHandler('building');
    const landingHandler = new BuildingInputHandler('landing');
    const wallHandler = new WallInputHandler();

    handlersRef.current = {
      gameplay: gameplayHandler,
      command: commandHandler,
      ability: abilityHandler,
      rally: rallyHandler,
      repair: repairHandler,
      building: buildingHandler,
      landing: landingHandler,
      wall: wallHandler,
    };

    // Register handlers for each context
    inputManager.registerHandler('gameplay', gameplayHandler);
    inputManager.registerHandler('command', commandHandler);
    inputManager.registerHandler('ability', abilityHandler);
    inputManager.registerHandler('rally', rallyHandler);
    inputManager.registerHandler('repair', repairHandler);
    inputManager.registerHandler('building', buildingHandler);
    inputManager.registerHandler('landing', landingHandler);
    inputManager.registerHandler('wall', wallHandler);

    // Initialize with container
    // Use game.eventBus for selection events - these are internal to main thread
    // and SelectionSystem listens on game.eventBus, not bridge.eventBus
    inputManager.initialize(container, {
      camera: cameraRef.current,
      game: gameRef.current,
      worldProvider:
        worldProviderRef?.current ?? (gameRef.current?.world as unknown as IWorldProvider),
      eventBus: gameRef.current?.eventBus,
      getLocalPlayerId,
    });

    initializedRef.current = true;

    // Cleanup on unmount
    return () => {
      inputManager.dispose();
      initializedRef.current = false;
      handlersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only depends on container; other refs are updated via updateDependencies
  }, [containerRef]);

  // =============================================================================
  // UPDATE DEPENDENCIES WHEN REFS CHANGE
  // =============================================================================

  useEffect(() => {
    if (!initializedRef.current) return;

    const inputManager = InputManager.getInstance();
    // Use game.eventBus for selection events - these are internal to main thread
    // and SelectionSystem listens on game.eventBus, not bridge.eventBus
    inputManager.updateDependencies({
      camera: cameraRef.current,
      game: gameRef.current,
      worldProvider:
        worldProviderRef?.current ?? (gameRef.current?.world as unknown as IWorldProvider),
      eventBus: gameRef.current?.eventBus,
    });
  }, [cameraRef, gameRef, worldProviderRef, isGameInitialized]);

  // =============================================================================
  // VISUAL FEEDBACK EVENT FORWARDING
  // =============================================================================

  // Forward visual feedback events from game.eventBus to bridge.eventBus
  // OverlayScene (Phaser) listens on bridge.eventBus for ground click indicators
  useEffect(() => {
    const gameEventBus = gameRef.current?.eventBus;
    const bridgeEventBus = eventBusRef?.current;

    // Only set up forwarding if both event buses exist and are different
    if (!gameEventBus || !bridgeEventBus || gameEventBus === bridgeEventBus) return;

    // Forward ground click visual feedback events
    // EventBus.on() returns an unsubscribe function
    const unsubMoveGround = gameEventBus.on('command:moveGround', (data: unknown) => {
      bridgeEventBus.emit('command:moveGround', data);
    });
    const unsubAttackGround = gameEventBus.on('command:attackGround', (data: unknown) => {
      bridgeEventBus.emit('command:attackGround', data);
    });

    return () => {
      unsubMoveGround();
      unsubAttackGround();
    };
  }, [gameRef, eventBusRef, isGameInitialized]);

  // Update building handler with placement preview
  useEffect(() => {
    if (!initializedRef.current) return;

    let frameId: number | null = null;

    const syncPlacementPreview = () => {
      const preview = placementPreviewRef.current;

      if (handlersRef.current?.building) {
        handlersRef.current.building.setPlacementPreview(preview);
      }
      if (handlersRef.current?.landing) {
        handlersRef.current.landing.setPlacementPreview(preview);
      }

      if (!preview) {
        frameId = window.requestAnimationFrame(syncPlacementPreview);
      }
    };

    syncPlacementPreview();

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [placementPreviewRef, isGameInitialized]);

  useEffect(() => {
    if (!initializedRef.current) return;

    let frameId: number | null = null;

    const syncWallPlacementPreview = () => {
      const preview = wallPlacementPreviewRef.current;

      if (handlersRef.current?.wall) {
        handlersRef.current.wall.setPlacementPreview(preview);
      }

      if (!preview) {
        frameId = window.requestAnimationFrame(syncWallPlacementPreview);
      }
    };

    syncWallPlacementPreview();

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [wallPlacementPreviewRef, isGameInitialized]);

  // =============================================================================
  // SELECTION STATE SYNC
  // =============================================================================

  // Subscribe to selection state changes using useSyncExternalStore
  const subscribe = useCallback((callback: () => void) => {
    const inputManager = InputManager.getInstanceSync();
    if (!inputManager) return () => {};
    return inputManager.subscribeSelectionState(callback);
  }, []);

  const getSnapshot = useCallback(() => {
    const inputManager = InputManager.getInstanceSync();
    if (!inputManager) return defaultSelectionState;
    return inputManager.getSelectionState();
  }, []);

  const selectionState = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => defaultSelectionState // Server snapshot
  );

  return {
    selectionState,
  };
}

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
  placementPreviewRef,
  wallPlacementPreviewRef,
  overlayManagerRef,
  lastControlGroupTap,
}: UseGameInputProps): UseGameInputReturn {
  // Track if we've initialized
  const initializedRef = useRef(false);
  const handlersRef = useRef<{
    gameplay: GameplayInputHandler;
    command: CommandInputHandler;
    building: BuildingInputHandler;
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
    const commandHandler = new CommandInputHandler();
    const buildingHandler = new BuildingInputHandler();

    handlersRef.current = {
      gameplay: gameplayHandler,
      command: commandHandler,
      building: buildingHandler,
    };

    // Register handlers for each context
    inputManager.registerHandler('gameplay', gameplayHandler);
    inputManager.registerHandler('command', commandHandler);
    inputManager.registerHandler('building', buildingHandler);
    // Reuse command handler for other targeting modes
    inputManager.registerHandler('ability', commandHandler);
    inputManager.registerHandler('rally', commandHandler);
    inputManager.registerHandler('repair', commandHandler);
    inputManager.registerHandler('landing', buildingHandler);

    // Initialize with container
    inputManager.initialize(container, {
      camera: cameraRef.current,
      game: gameRef.current,
      worldProvider: worldProviderRef?.current ?? (gameRef.current?.world as unknown as IWorldProvider),
      eventBus: eventBusRef?.current ?? gameRef.current?.eventBus,
      getLocalPlayerId,
    });

    initializedRef.current = true;

    // Cleanup on unmount
    return () => {
      inputManager.dispose();
      initializedRef.current = false;
      handlersRef.current = null;
    };
  }, [containerRef]); // Only depends on container - other refs are updated separately

  // =============================================================================
  // UPDATE DEPENDENCIES WHEN REFS CHANGE
  // =============================================================================

  useEffect(() => {
    if (!initializedRef.current) return;

    const inputManager = InputManager.getInstance();
    inputManager.updateDependencies({
      camera: cameraRef.current,
      game: gameRef.current,
      worldProvider: worldProviderRef?.current ?? (gameRef.current?.world as unknown as IWorldProvider),
      eventBus: eventBusRef?.current ?? gameRef.current?.eventBus,
    });
  }, [cameraRef, gameRef, worldProviderRef, eventBusRef]);

  // Update building handler with placement preview
  useEffect(() => {
    if (handlersRef.current?.building) {
      handlersRef.current.building.setPlacementPreview(placementPreviewRef.current);
    }
  }, [placementPreviewRef]);

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

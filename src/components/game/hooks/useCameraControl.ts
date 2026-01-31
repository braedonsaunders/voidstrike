/**
 * useCameraControl Hook
 *
 * Manages camera position control, control group centering, and pending camera moves.
 * Note: RTSCamera handles its own input (edge scrolling, zoom, rotation) internally.
 * This hook manages external camera operations like jumping to control groups.
 */

import type { MutableRefObject } from 'react';
import { useEffect, useRef, useCallback } from 'react';
import { RTSCamera } from '@/rendering/Camera';
import { Game } from '@/engine/core/Game';
import { RenderStateWorldAdapter } from '@/engine/workers/RenderStateAdapter';
import { useGameStore, GameState } from '@/store/gameStore';

export interface UseCameraControlProps {
  cameraRef: MutableRefObject<RTSCamera | null>;
  gameRef: MutableRefObject<Game | null>;
}

export interface UseCameraControlReturn {
  lastControlGroupTap: MutableRefObject<{ group: number; time: number } | null>;
  subgroupIndexRef: MutableRefObject<number>;
  handleControlGroupSelect: (groupNumber: number, isDoubleClick: boolean) => void;
  centerOnEntity: (entityId: number) => void;
  centerOnPosition: (x: number, y: number) => void;
}

export function useCameraControl({ cameraRef, gameRef: _gameRef }: UseCameraControlProps): UseCameraControlReturn {
  // Control group tracking for double-tap detection
  const lastControlGroupTap = useRef<{ group: number; time: number } | null>(null);
  const subgroupIndexRef = useRef(0);

  // Handle control group selection with optional camera centering
  const handleControlGroupSelect = useCallback(
    (groupNumber: number, isDoubleClick: boolean) => {
      const camera = cameraRef.current;
      if (!camera) return;

      const store = useGameStore.getState();
      const group = store.controlGroups.get(groupNumber);

      if (group && group.length > 0) {
        if (isDoubleClick) {
          // Center camera on first unit in the group using RenderStateWorldAdapter
          const worldAdapter = RenderStateWorldAdapter.getInstance();
          if (worldAdapter) {
            const firstEntity = worldAdapter.getEntity(group[0]);
            const transform = firstEntity?.get<{ x: number; y: number }>('Transform');
            if (transform) {
              camera.setPosition(transform.x, transform.y);
            }
          }
        }

        // Update last tap for double-click detection
        lastControlGroupTap.current = { group: groupNumber, time: Date.now() };
        store.selectUnits(group);
      }
    },
    [cameraRef]
  );

  // Center camera on a specific entity
  const centerOnEntity = useCallback(
    (entityId: number) => {
      const camera = cameraRef.current;
      if (!camera) return;

      // Use RenderStateWorldAdapter for entity lookup (has actual entity data from worker)
      const worldAdapter = RenderStateWorldAdapter.getInstance();
      if (!worldAdapter) return;

      const entity = worldAdapter.getEntity(entityId);
      const transform = entity?.get<{ x: number; y: number }>('Transform');
      if (transform) {
        camera.setPosition(transform.x, transform.y);
      }
    },
    [cameraRef]
  );

  // Center camera on a world position
  const centerOnPosition = useCallback(
    (x: number, y: number) => {
      const camera = cameraRef.current;
      if (!camera) return;
      camera.setPosition(x, y);
    },
    [cameraRef]
  );

  // Handle pending camera moves from store (e.g., minimap clicks)
  useEffect(() => {
    const unsubscribe = useGameStore.subscribe((state: GameState) => {
      const pendingMove = state.pendingCameraMove;
      if (pendingMove && cameraRef.current) {
        cameraRef.current.setPosition(pendingMove.x, pendingMove.y);
        useGameStore.getState().clearPendingCameraMove();
      }
    });

    return () => unsubscribe();
  }, [cameraRef]);

  return {
    lastControlGroupTap,
    subgroupIndexRef,
    handleControlGroupSelect,
    centerOnEntity,
    centerOnPosition,
  };
}

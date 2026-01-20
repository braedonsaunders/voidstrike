/**
 * useGameInput Hook
 *
 * Handles all mouse and keyboard input for the game canvas.
 * Manages selection, building placement, command targeting, and keyboard shortcuts.
 */

import type { RefObject, MutableRefObject, MouseEvent as ReactMouseEvent } from 'react';
import { useRef, useCallback, useEffect, useState } from 'react';
import { Game } from '@/engine/core/Game';
import { RTSCamera } from '@/rendering/Camera';
import { BuildingPlacementPreview } from '@/rendering/BuildingPlacementPreview';
import { WallPlacementPreview } from '@/rendering/WallPlacementPreview';
import { TSLGameOverlayManager } from '@/rendering/tsl';
import { useGameStore } from '@/store/gameStore';
import { useUIStore, GameOverlayType } from '@/store/uiStore';
import { getLocalPlayerId, isBattleSimulatorMode } from '@/store/gameSetupStore';
import { Transform } from '@/engine/components/Transform';
import { Resource } from '@/engine/components/Resource';
import { Unit } from '@/engine/components/Unit';
import { Selectable } from '@/engine/components/Selectable';
import { Health } from '@/engine/components/Health';
import { Building } from '@/engine/components/Building';

const DOUBLE_CLICK_TIME = 400;
const DOUBLE_CLICK_DIST = 10;

export interface UseGameInputProps {
  containerRef: RefObject<HTMLDivElement | null>;
  cameraRef: MutableRefObject<RTSCamera | null>;
  gameRef: MutableRefObject<Game | null>;
  placementPreviewRef: MutableRefObject<BuildingPlacementPreview | null>;
  wallPlacementPreviewRef: MutableRefObject<WallPlacementPreview | null>;
  overlayManagerRef: MutableRefObject<TSLGameOverlayManager | null>;
  lastControlGroupTap: MutableRefObject<{ group: number; time: number } | null>;
}

export interface SelectionState {
  isSelecting: boolean;
  selectionStart: { x: number; y: number };
  selectionEnd: { x: number; y: number };
}

export interface UseGameInputReturn {
  selectionState: SelectionState;
  handleMouseDown: (e: ReactMouseEvent) => void;
  handleMouseMove: (e: ReactMouseEvent) => void;
  handleMouseUp: (e: ReactMouseEvent) => void;
  handleContextMenu: (e: ReactMouseEvent) => void;
}

// Helper to find entity at a world position
function findEntityAtPosition(game: Game, x: number, z: number) {
  const resourceClickRadius = 2.5;
  const unitClickRadius = 1.5;
  const buildingClickRadius = 2.0;

  // Check resources first
  const resources = game.world.getEntitiesWith('Resource', 'Transform');
  for (const entity of resources) {
    const transform = entity.get<Transform>('Transform')!;
    const dx = transform.x - x;
    const dy = transform.y - z;
    if (dx * dx + dy * dy < resourceClickRadius * resourceClickRadius) {
      return { entity };
    }
  }

  // Check units
  const units = game.world.getEntitiesWith('Unit', 'Transform', 'Health');
  for (const entity of units) {
    const transform = entity.get<Transform>('Transform')!;
    const health = entity.get<Health>('Health')!;
    if (health.isDead()) continue;
    const dx = transform.x - x;
    const dy = transform.y - z;
    if (dx * dx + dy * dy < unitClickRadius * unitClickRadius) {
      return { entity };
    }
  }

  // Check buildings
  const buildings = game.world.getEntitiesWith('Building', 'Transform', 'Health');
  for (const entity of buildings) {
    const transform = entity.get<Transform>('Transform')!;
    const health = entity.get<Health>('Health')!;
    if (health.isDead()) continue;
    const dx = transform.x - x;
    const dy = transform.y - z;
    if (dx * dx + dy * dy < buildingClickRadius * buildingClickRadius) {
      return { entity };
    }
  }

  return null;
}

export function useGameInput({
  containerRef,
  cameraRef,
  gameRef,
  placementPreviewRef,
  wallPlacementPreviewRef,
  overlayManagerRef,
  lastControlGroupTap,
}: UseGameInputProps): UseGameInputReturn {
  // Selection state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 });
  const [selectionEnd, setSelectionEnd] = useState({ x: 0, y: 0 });

  // Double-click detection
  const lastClickRef = useRef<{ time: number; x: number; y: number } | null>(null);

  // Get store state for input handling
  const {
    isBuilding,
    buildingType,
    isSettingRallyPoint,
    isRepairMode,
    isLandingMode,
    landingBuildingId,
    abilityTargetMode,
    isWallPlacementMode,
    commandTargetMode,
  } = useGameStore();

  // Helper to convert mouse coordinates to container-relative coordinates
  const getContainerCoords = useCallback(
    (e: ReactMouseEvent | MouseEvent): { x: number; y: number } => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        return {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }
      return { x: e.clientX, y: e.clientY };
    },
    [containerRef]
  );

  // Handle right-click actions
  const handleRightClick = useCallback(
    (e: ReactMouseEvent) => {
      // Right-click cancels command modes
      if (commandTargetMode) {
        useGameStore.getState().setCommandTargetMode(null);
        return;
      }
      if (isWallPlacementMode) {
        wallPlacementPreviewRef.current?.cancelLine();
        useGameStore.getState().setWallPlacementMode(false);
        return;
      }
      if (isBuilding) {
        useGameStore.getState().setBuildingMode(null);
        return;
      }
      if (abilityTargetMode) {
        useGameStore.getState().setAbilityTargetMode(null);
        return;
      }

      const coords = getContainerCoords(e);
      const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
      if (!worldPos || !gameRef.current) return;

      const selectedUnits = useGameStore.getState().selectedUnits;
      const game = gameRef.current;

      // Handle rally point mode
      if (isSettingRallyPoint) {
        for (const buildingId of selectedUnits) {
          game.eventBus.emit('rally:set', {
            buildingId,
            x: worldPos.x,
            y: worldPos.z,
          });
        }
        useGameStore.getState().setRallyPointMode(false);
        return;
      }

      // Handle repair mode
      if (isRepairMode) {
        const clickedEntity = findEntityAtPosition(game, worldPos.x, worldPos.z);
        if (clickedEntity) {
          const building = clickedEntity.entity.get<Building>('Building');
          const unit = clickedEntity.entity.get<Unit>('Unit');
          const health = clickedEntity.entity.get<Health>('Health');
          const selectable = clickedEntity.entity.get<Selectable>('Selectable');

          const localPlayer = getLocalPlayerId();
          if (localPlayer && selectable?.playerId === localPlayer && health && !health.isDead()) {
            if (building || unit?.isMechanical) {
              game.eventBus.emit('command:repair', {
                entityIds: selectedUnits,
                targetId: clickedEntity.entity.id,
              });
              useGameStore.getState().setRepairMode(false);
              return;
            }
          }
        }
        useGameStore.getState().setRepairMode(false);
        return;
      }

      // Handle landing mode
      if (isLandingMode && landingBuildingId) {
        if (placementPreviewRef.current) {
          const snappedPos = placementPreviewRef.current.getSnappedPosition();
          const isValid = placementPreviewRef.current.isPlacementValid();
          const localPlayer = getLocalPlayerId();

          if (isValid && localPlayer) {
            game.issueCommand({
              tick: game.getCurrentTick(),
              playerId: localPlayer,
              type: 'LAND',
              entityIds: [landingBuildingId],
              buildingId: landingBuildingId,
              targetPosition: { x: snappedPos.x, y: snappedPos.y },
            });
            useGameStore.getState().setLandingMode(false);
          }
        }
        return;
      }

      // Handle normal right-click commands
      if (selectedUnits.length > 0) {
        const queue = e.shiftKey;
        const clickedEntity = findEntityAtPosition(game, worldPos.x, worldPos.z);

        if (clickedEntity) {
          const resource = clickedEntity.entity.get<Resource>('Resource');
          const selectable = clickedEntity.entity.get<Selectable>('Selectable');
          const health = clickedEntity.entity.get<Health>('Health');

          // Gather command
          if (resource) {
            const workerIds = selectedUnits.filter((id: number) => {
              const entity = game.world.getEntity(id);
              const unit = entity?.get<Unit>('Unit');
              return unit?.isWorker;
            });
            const localPlayer = getLocalPlayerId();

            if (workerIds.length > 0 && localPlayer) {
              game.issueCommand({
                tick: game.getCurrentTick(),
                playerId: localPlayer,
                type: 'GATHER',
                entityIds: workerIds,
                targetEntityId: clickedEntity.entity.id,
                queue,
              });
              return;
            }
          }

          // Attack enemy
          const localPlayerId = getLocalPlayerId();
          if (selectable && localPlayerId && selectable.playerId !== localPlayerId && health && !health.isDead()) {
            game.eventBus.emit('command:attack', {
              entityIds: selectedUnits,
              targetEntityId: clickedEntity.entity.id,
              queue,
            });
            return;
          }

          // Resume construction
          const building = clickedEntity.entity.get<Building>('Building');
          if (building && localPlayerId && selectable?.playerId === localPlayerId) {
            if (
              building.state === 'paused' ||
              building.state === 'waiting_for_worker' ||
              building.state === 'constructing'
            ) {
              const workerIds = selectedUnits.filter((id: number) => {
                const entity = game.world.getEntity(id);
                const unit = entity?.get<Unit>('Unit');
                return unit?.isWorker;
              });

              if (workerIds.length > 0) {
                game.eventBus.emit('command:resume_construction', {
                  workerId: workerIds[0],
                  buildingId: clickedEntity.entity.id,
                });
                return;
              }
            }
          }
        }

        // Categorize selected entities
        const flyingBuildingIds: number[] = [];
        const groundedProductionBuildingIds: number[] = [];
        const unitIds: number[] = [];

        for (const id of selectedUnits) {
          const entity = game.world.getEntity(id);
          const building = entity?.get<Building>('Building');
          const unit = entity?.get<Unit>('Unit');

          if (building?.isFlying && building.state === 'flying') {
            flyingBuildingIds.push(id);
          } else if (building && building.canProduce.length > 0 && !building.isFlying) {
            groundedProductionBuildingIds.push(id);
          } else if (unit) {
            unitIds.push(id);
          }
        }

        // Move flying buildings
        if (flyingBuildingIds.length > 0) {
          for (const buildingId of flyingBuildingIds) {
            game.eventBus.emit('command:flyingBuildingMove', {
              buildingId,
              targetPosition: { x: worldPos.x, y: worldPos.z },
            });
          }
        }

        // Set rally point for grounded production buildings
        if (groundedProductionBuildingIds.length > 0 && flyingBuildingIds.length === 0 && unitIds.length === 0) {
          let targetId: number | undefined;
          if (clickedEntity) {
            const resource = clickedEntity.entity.get<Resource>('Resource');
            if (resource) {
              targetId = clickedEntity.entity.id;
            }
          }
          for (const buildingId of groundedProductionBuildingIds) {
            game.eventBus.emit('rally:set', {
              buildingId,
              x: worldPos.x,
              y: worldPos.z,
              targetId,
            });
          }
        }

        // Move units
        if (unitIds.length > 0) {
          const localPlayer = getLocalPlayerId();
          if (localPlayer) {
            game.issueCommand({
              tick: game.getCurrentTick(),
              playerId: localPlayer,
              type: 'MOVE',
              entityIds: unitIds,
              targetPosition: { x: worldPos.x, y: worldPos.z },
              queue,
            });
            game.eventBus.emit('command:moveGround', {
              targetPosition: { x: worldPos.x, y: worldPos.z },
              playerId: localPlayer,
            });
          }
        }
      }
    },
    [
      commandTargetMode,
      isWallPlacementMode,
      isBuilding,
      abilityTargetMode,
      isSettingRallyPoint,
      isRepairMode,
      isLandingMode,
      landingBuildingId,
      getContainerCoords,
      cameraRef,
      gameRef,
      wallPlacementPreviewRef,
      placementPreviewRef,
    ]
  );

  // Handle mouse down
  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      const coords = getContainerCoords(e);

      if (e.button === 0) {
        // Left click
        if (commandTargetMode === 'attack') {
          const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
          if (worldPos && gameRef.current) {
            const selectedUnits = useGameStore.getState().selectedUnits;
            const localPlayer = getLocalPlayerId();
            if (selectedUnits.length > 0 && localPlayer) {
              gameRef.current.issueCommand({
                tick: gameRef.current.getCurrentTick(),
                playerId: localPlayer,
                type: 'ATTACK',
                entityIds: selectedUnits,
                targetPosition: { x: worldPos.x, y: worldPos.z },
                queue: e.shiftKey,
              });
              gameRef.current.eventBus.emit('command:attackGround', {
                targetPosition: { x: worldPos.x, y: worldPos.z },
                playerId: localPlayer,
              });
            }
          }
          if (!e.shiftKey) useGameStore.getState().setCommandTargetMode(null);
        } else if (commandTargetMode === 'patrol') {
          const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
          if (worldPos && gameRef.current) {
            const selectedUnits = useGameStore.getState().selectedUnits;
            const localPlayer = getLocalPlayerId();
            if (selectedUnits.length > 0 && localPlayer) {
              gameRef.current.issueCommand({
                tick: gameRef.current.getCurrentTick(),
                playerId: localPlayer,
                type: 'PATROL',
                entityIds: selectedUnits,
                targetPosition: { x: worldPos.x, y: worldPos.z },
                queue: e.shiftKey,
              });
            }
          }
          if (!e.shiftKey) useGameStore.getState().setCommandTargetMode(null);
        } else if (commandTargetMode === 'move') {
          const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
          if (worldPos && gameRef.current) {
            const selectedUnits = useGameStore.getState().selectedUnits;
            const localPlayer = getLocalPlayerId();
            if (selectedUnits.length > 0 && localPlayer) {
              gameRef.current.issueCommand({
                tick: gameRef.current.getCurrentTick(),
                playerId: localPlayer,
                type: 'MOVE',
                entityIds: selectedUnits,
                targetPosition: { x: worldPos.x, y: worldPos.z },
                queue: e.shiftKey,
              });
              gameRef.current.eventBus.emit('command:moveGround', {
                targetPosition: { x: worldPos.x, y: worldPos.z },
                playerId: localPlayer,
              });
            }
          }
          if (!e.shiftKey) useGameStore.getState().setCommandTargetMode(null);
        } else if (abilityTargetMode) {
          const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
          if (worldPos && gameRef.current) {
            const selectedUnits = useGameStore.getState().selectedUnits;
            const clickedEntity = findEntityAtPosition(gameRef.current, worldPos.x, worldPos.z);
            const localPlayer = getLocalPlayerId();

            if (localPlayer) {
              gameRef.current.issueCommand({
                tick: gameRef.current.getCurrentTick(),
                playerId: localPlayer,
                type: 'ABILITY',
                entityIds: selectedUnits,
                abilityId: abilityTargetMode,
                targetPosition: { x: worldPos.x, y: worldPos.z },
                targetEntityId: clickedEntity?.entity.id,
              });
            }
          }
          useGameStore.getState().setAbilityTargetMode(null);
        } else if (isWallPlacementMode) {
          const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
          if (worldPos && wallPlacementPreviewRef.current) {
            wallPlacementPreviewRef.current.startLine(worldPos.x, worldPos.z);
          }
        } else if (isLandingMode && landingBuildingId) {
          if (placementPreviewRef.current && gameRef.current) {
            const snappedPos = placementPreviewRef.current.getSnappedPosition();
            const isValid = placementPreviewRef.current.isPlacementValid();
            const localPlayer = getLocalPlayerId();

            if (isValid && localPlayer) {
              gameRef.current.issueCommand({
                tick: gameRef.current.getCurrentTick(),
                playerId: localPlayer,
                type: 'LAND',
                entityIds: [landingBuildingId],
                buildingId: landingBuildingId,
                targetPosition: { x: snappedPos.x, y: snappedPos.y },
              });
              useGameStore.getState().setLandingMode(false);
            }
          }
        } else if (isBuilding && buildingType && placementPreviewRef.current) {
          const snappedPos = placementPreviewRef.current.getSnappedPosition();
          const isValid = placementPreviewRef.current.isPlacementValid();

          if (isValid && gameRef.current) {
            const selectedUnits = useGameStore.getState().selectedUnits;
            gameRef.current.eventBus.emit('building:place', {
              buildingType,
              position: { x: snappedPos.x, y: snappedPos.y },
              workerId: selectedUnits.length > 0 ? selectedUnits[0] : undefined,
            });

            if (e.shiftKey) {
              useGameStore.getState().addToBuildingQueue({
                buildingType,
                x: snappedPos.x,
                y: snappedPos.y,
              });
            } else {
              useGameStore.getState().setBuildingMode(null);
            }
          } else if (!isValid && !e.shiftKey) {
            useGameStore.getState().setBuildingMode(null);
          }
        } else if (isBattleSimulatorMode()) {
          const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
          if (worldPos && gameRef.current) {
            gameRef.current.eventBus.emit('simulator:spawn', {
              worldX: worldPos.x,
              worldY: worldPos.z,
            });
          }
        } else {
          // Start selection box
          setIsSelecting(true);
          setSelectionStart({ x: coords.x, y: coords.y });
          setSelectionEnd({ x: coords.x, y: coords.y });
        }
      } else if (e.button === 2) {
        handleRightClick(e);
      }
    },
    [
      getContainerCoords,
      commandTargetMode,
      abilityTargetMode,
      isWallPlacementMode,
      isLandingMode,
      landingBuildingId,
      isBuilding,
      buildingType,
      cameraRef,
      gameRef,
      wallPlacementPreviewRef,
      placementPreviewRef,
      handleRightClick,
    ]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      const coords = getContainerCoords(e);

      if (isSelecting) {
        setSelectionEnd({ x: coords.x, y: coords.y });
      }

      // Wall placement preview
      if (isWallPlacementMode && wallPlacementPreviewRef.current && cameraRef.current) {
        const worldPos = cameraRef.current.screenToWorld(coords.x, coords.y);
        if (worldPos) {
          wallPlacementPreviewRef.current.updateLine(worldPos.x, worldPos.z);
        }
      }

      // Building placement preview
      if (placementPreviewRef.current && cameraRef.current) {
        if ((isBuilding && buildingType) || isLandingMode) {
          const worldPos = cameraRef.current.screenToWorld(coords.x, coords.y);
          if (worldPos) {
            placementPreviewRef.current.updatePosition(worldPos.x, worldPos.z);
          }
        }
      }
    },
    [
      getContainerCoords,
      isSelecting,
      isWallPlacementMode,
      isBuilding,
      buildingType,
      isLandingMode,
      wallPlacementPreviewRef,
      placementPreviewRef,
      cameraRef,
    ]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(
    (e: ReactMouseEvent) => {
      const coords = getContainerCoords(e);

      // Handle wall placement finish
      if (e.button === 0 && isWallPlacementMode && wallPlacementPreviewRef.current?.isCurrentlyDrawing()) {
        const result = wallPlacementPreviewRef.current.finishLine();
        const game = gameRef.current;

        if (game && result.positions.length > 0) {
          const store = useGameStore.getState();
          const wallBuildingType = store.buildingType || 'wall_segment';

          game.eventBus.emit('wall:place_line', {
            positions: result.positions,
            buildingType: wallBuildingType,
            playerId: getLocalPlayerId(),
          });

          if (!e.shiftKey) {
            useGameStore.getState().setWallPlacementMode(false);
          }
        }
        return;
      }

      // Handle selection box
      if (e.button === 0 && isSelecting) {
        setIsSelecting(false);

        const game = gameRef.current;
        if (game) {
          const screenDx = Math.abs(selectionEnd.x - selectionStart.x);
          const screenDy = Math.abs(selectionEnd.y - selectionStart.y);
          const MIN_BOX_DRAG = 10;

          if (screenDx > MIN_BOX_DRAG || screenDy > MIN_BOX_DRAG) {
            // Box selection
            game.eventBus.emit('selection:boxScreen', {
              screenStartX: selectionStart.x,
              screenStartY: selectionStart.y,
              screenEndX: selectionEnd.x,
              screenEndY: selectionEnd.y,
              additive: e.shiftKey,
              playerId: getLocalPlayerId(),
            });
            lastClickRef.current = null;
          } else {
            // Click selection - check for double-click
            const now = Date.now();
            let isDoubleClick = false;

            if (lastClickRef.current) {
              const timeDiff = now - lastClickRef.current.time;
              const clickDx = Math.abs(coords.x - lastClickRef.current.x);
              const clickDy = Math.abs(coords.y - lastClickRef.current.y);

              isDoubleClick = timeDiff < DOUBLE_CLICK_TIME && clickDx < DOUBLE_CLICK_DIST && clickDy < DOUBLE_CLICK_DIST;
            }

            lastClickRef.current = { time: now, x: coords.x, y: coords.y };

            game.eventBus.emit('selection:clickScreen', {
              screenX: coords.x,
              screenY: coords.y,
              additive: e.shiftKey,
              selectAllOfType: e.ctrlKey || isDoubleClick,
              playerId: getLocalPlayerId(),
            });
          }
        }
      }
    },
    [
      getContainerCoords,
      isWallPlacementMode,
      isSelecting,
      selectionStart,
      selectionEnd,
      wallPlacementPreviewRef,
      gameRef,
    ]
  );

  // Handle context menu
  const handleContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
  }, []);

  // Document-level mouse listeners for selection box
  useEffect(() => {
    if (!isSelecting) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      const coords = getContainerCoords(e);
      setSelectionEnd({ x: coords.x, y: coords.y });
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;

      setIsSelecting(false);

      const game = gameRef.current;
      if (!game) return;

      const coords = getContainerCoords(e);
      const finalEndX = coords.x;
      const finalEndY = coords.y;

      const screenDx = Math.abs(finalEndX - selectionStart.x);
      const screenDy = Math.abs(finalEndY - selectionStart.y);
      const MIN_BOX_DRAG = 10;

      if (screenDx > MIN_BOX_DRAG || screenDy > MIN_BOX_DRAG) {
        game.eventBus.emit('selection:boxScreen', {
          screenStartX: selectionStart.x,
          screenStartY: selectionStart.y,
          screenEndX: finalEndX,
          screenEndY: finalEndY,
          additive: e.shiftKey,
          playerId: getLocalPlayerId(),
        });
        lastClickRef.current = null;
      } else {
        const now = Date.now();
        let isDoubleClick = false;

        if (lastClickRef.current) {
          const timeDiff = now - lastClickRef.current.time;
          const clickDx = Math.abs(coords.x - lastClickRef.current.x);
          const clickDy = Math.abs(coords.y - lastClickRef.current.y);

          isDoubleClick = timeDiff < DOUBLE_CLICK_TIME && clickDx < DOUBLE_CLICK_DIST && clickDy < DOUBLE_CLICK_DIST;
        }

        lastClickRef.current = { time: now, x: coords.x, y: coords.y };

        game.eventBus.emit('selection:clickScreen', {
          screenX: coords.x,
          screenY: coords.y,
          additive: e.shiftKey,
          selectAllOfType: e.ctrlKey || isDoubleClick,
          playerId: getLocalPlayerId(),
        });
      }
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [isSelecting, selectionStart, getContainerCoords, gameRef]);

  // Keyboard handlers
  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      const key = e.key.toLowerCase();

      switch (key) {
        case 'escape': {
          const hasActiveCommand =
            commandTargetMode !== null ||
            isRepairMode ||
            isLandingMode ||
            isSettingRallyPoint ||
            abilityTargetMode !== null ||
            isBuilding ||
            isWallPlacementMode;

          if (hasActiveCommand && useUIStore.getState().isFullscreen) {
            e.preventDefault();
          }

          if (commandTargetMode) useGameStore.getState().setCommandTargetMode(null);
          else if (isRepairMode) useGameStore.getState().setRepairMode(false);
          else if (isLandingMode) useGameStore.getState().setLandingMode(false);
          else if (isSettingRallyPoint) useGameStore.getState().setRallyPointMode(false);
          else if (abilityTargetMode) useGameStore.getState().setAbilityTargetMode(null);
          else if (isWallPlacementMode) {
            wallPlacementPreviewRef.current?.cancelLine();
            useGameStore.getState().setWallPlacementMode(false);
          } else if (isBuilding) useGameStore.getState().setBuildingMode(null);
          else game.eventBus.emit('selection:clear');
          break;
        }
        case 'l': {
          const store = useGameStore.getState();
          const localPlayer = getLocalPlayerId();
          if (store.selectedUnits.length > 0 && localPlayer) {
            const firstEntity = game.world.getEntity(store.selectedUnits[0]);
            const building = firstEntity?.get<Building>('Building');
            if (building?.canLiftOff) {
              if (building.isFlying && building.state === 'flying') {
                store.setLandingMode(true, store.selectedUnits[0]);
              } else if (building.state === 'complete' && !building.isFlying && building.productionQueue.length === 0) {
                game.issueCommand({
                  tick: game.getCurrentTick(),
                  playerId: localPlayer,
                  type: 'LIFTOFF',
                  entityIds: [store.selectedUnits[0]],
                  buildingId: store.selectedUnits[0],
                });
              }
            }
          }
          break;
        }
        case 'r': {
          const store = useGameStore.getState();
          if (store.selectedUnits.length > 0) {
            const firstEntity = game.world.getEntity(store.selectedUnits[0]);
            const unit = firstEntity?.get<Unit>('Unit');
            const building = firstEntity?.get<Building>('Building');

            if (unit?.isWorker && unit?.canRepair) {
              store.setRepairMode(true);
            } else if (building) {
              store.setRallyPointMode(true);
            }
          }
          break;
        }
        case 'o': {
          const uiStore = useUIStore.getState();
          const currentOverlay = uiStore.overlaySettings.activeOverlay;
          const overlayOrder: GameOverlayType[] = ['none', 'elevation', 'threat', 'navmesh', 'resource', 'buildable'];
          const currentIndex = overlayOrder.indexOf(currentOverlay);
          const nextIndex = (currentIndex + 1) % overlayOrder.length;
          uiStore.setActiveOverlay(overlayOrder[nextIndex]);
          break;
        }
        case 'a':
          if (!isBuilding) {
            useGameStore.getState().setCommandTargetMode('attack');
          }
          break;
        case 'm':
          if (!isBuilding) {
            useGameStore.getState().setCommandTargetMode('move');
          }
          break;
        case 'p':
          if (!isBuilding) {
            useGameStore.getState().setCommandTargetMode('patrol');
          }
          break;
        case 's': {
          const selectedUnits = useGameStore.getState().selectedUnits;
          const localPlayer = getLocalPlayerId();
          if (selectedUnits.length > 0 && localPlayer) {
            game.issueCommand({
              tick: game.getCurrentTick(),
              playerId: localPlayer,
              type: 'STOP',
              entityIds: selectedUnits,
            });
          }
          break;
        }
        case 'h': {
          const selectedUnits = useGameStore.getState().selectedUnits;
          const localPlayer = getLocalPlayerId();
          if (selectedUnits.length > 0 && localPlayer) {
            game.issueCommand({
              tick: game.getCurrentTick(),
              playerId: localPlayer,
              type: 'HOLD',
              entityIds: selectedUnits,
            });
          }
          break;
        }
        case '?': {
          const store = useGameStore.getState();
          store.setShowKeyboardShortcuts(!store.showKeyboardShortcuts);
          break;
        }
      }

      // Alt+A: Toggle attack range overlay
      if (e.altKey && key === 'a') {
        e.preventDefault();
        if (overlayManagerRef.current) {
          const state = overlayManagerRef.current.getRangeOverlayState();
          overlayManagerRef.current.setShowAttackRange(!state.attackRange);
        }
        return;
      }

      // Alt+V: Toggle vision range overlay
      if (e.altKey && key === 'v') {
        e.preventDefault();
        if (overlayManagerRef.current) {
          const state = overlayManagerRef.current.getRangeOverlayState();
          overlayManagerRef.current.setShowVisionRange(!state.visionRange);
        }
        return;
      }

      // Control groups (0-9)
      if (/^[0-9]$/.test(key)) {
        const groupNumber = parseInt(key);
        const store = useGameStore.getState();
        const camera = cameraRef.current;

        if (e.ctrlKey || e.metaKey) {
          store.setControlGroup(groupNumber, store.selectedUnits);
        } else if (e.shiftKey) {
          const existing = store.controlGroups.get(groupNumber) || [];
          const selected = store.selectedUnits;
          const combinedSet = new Set(existing);
          for (const id of selected) {
            combinedSet.add(id);
          }
          store.setControlGroup(groupNumber, Array.from(combinedSet));
        } else {
          const group = store.controlGroups.get(groupNumber);
          if (group && group.length > 0) {
            const now = Date.now();
            const lastTap = lastControlGroupTap.current;

            if (lastTap && lastTap.group === groupNumber && now - lastTap.time < 300) {
              const firstEntity = game.world.getEntity(group[0]);
              const transform = firstEntity?.get<Transform>('Transform');
              if (transform && camera) {
                camera.setPosition(transform.x, transform.y);
              }
            }

            lastControlGroupTap.current = { group: groupNumber, time: now };
            store.selectUnits(group);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    gameRef,
    cameraRef,
    wallPlacementPreviewRef,
    overlayManagerRef,
    lastControlGroupTap,
    isBuilding,
    commandTargetMode,
    isRepairMode,
    isLandingMode,
    isSettingRallyPoint,
    abilityTargetMode,
    isWallPlacementMode,
  ]);

  return {
    selectionState: {
      isSelecting,
      selectionStart,
      selectionEnd,
    },
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleContextMenu,
  };
}

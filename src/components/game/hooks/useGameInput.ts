/**
 * useGameInput Hook
 *
 * Handles all mouse and keyboard input for the game canvas.
 * Manages selection, building placement, command targeting, and keyboard shortcuts.
 */

import type { RefObject, MutableRefObject, MouseEvent as ReactMouseEvent } from 'react';
import { useRef, useCallback, useEffect, useState } from 'react';
import { Game } from '@/engine/core/Game';
import type { IWorldProvider } from '@/engine/ecs/IWorldProvider';
import type { EventBus } from '@/engine/core/EventBus';
import { RTSCamera } from '@/rendering/Camera';
import { BuildingPlacementPreview } from '@/rendering/BuildingPlacementPreview';
import { WallPlacementPreview } from '@/rendering/WallPlacementPreview';
import { TSLGameOverlayManager } from '@/rendering/tsl';
import { useGameStore } from '@/store/gameStore';
import { useUIStore, GameOverlayType } from '@/store/uiStore';
import { getLocalPlayerId, isBattleSimulatorMode, isMultiplayerMode } from '@/store/gameSetupStore';
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
  /** World provider for entity queries - if provided, uses this instead of game.world */
  worldProviderRef?: MutableRefObject<IWorldProvider | null>;
  /** Event bus for emitting commands - if provided, uses this instead of game.eventBus */
  eventBusRef?: MutableRefObject<EventBus | null>;
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

// Helper to find entity at a screen position using screen-space distance
// This correctly handles air units by projecting their visual position to screen space
// Uses IWorldProvider interface for both worker mode and direct game.world mode
function findEntityAtScreenPosition(
  world: IWorldProvider,
  screenX: number,
  screenY: number,
  camera: RTSCamera
): { entity: ReturnType<IWorldProvider['getEntity']> } | null {
  // Screen-space click radii in pixels
  const resourceScreenRadius = 40;
  const unitScreenRadius = 35;
  const buildingScreenRadius = 50;

  // Convert screen position to world coordinates
  const worldPos = camera.screenToWorld(screenX, screenY);
  if (!worldPos) return null;

  // Calculate world-space search radius based on camera zoom
  const zoom = camera.getZoom?.() ?? 1;
  const maxScreenRadius = Math.max(resourceScreenRadius, unitScreenRadius, buildingScreenRadius);
  const worldSearchRadius = (maxScreenRadius / zoom) * 1.5 + 5;

  type ClickCandidate = { entity: NonNullable<ReturnType<IWorldProvider['getEntity']>>; distance: number };
  let closestEntity: ClickCandidate | null = null;

  // Check resources using IWorldProvider query
  const resources = world.getEntitiesWith('Resource', 'Transform');
  for (const entity of resources) {
    const transform = entity.get<Transform>('Transform');
    if (!transform) continue;

    // Early world-space distance check
    const worldDx = transform.x - worldPos.x;
    const worldDz = transform.y - worldPos.z;
    if (worldDx * worldDx + worldDz * worldDz > worldSearchRadius * worldSearchRadius) continue;

    const screenPos = camera.worldToScreen(transform.x, transform.y);
    if (!screenPos) continue;

    const dx = screenPos.x - screenX;
    const dy = screenPos.y - screenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < resourceScreenRadius) {
      if (!closestEntity || dist < closestEntity.distance) {
        closestEntity = { entity, distance: dist };
      }
    }
  }

  // Check units using IWorldProvider query (brute-force, but typically <500 entities)
  const units = world.getEntitiesWith('Unit', 'Transform');
  for (const entity of units) {
    const transform = entity.get<Transform>('Transform');
    const health = entity.get<Health>('Health');
    const selectable = entity.get<Selectable>('Selectable');
    if (!transform || !health || !selectable) continue;
    if (health.isDead?.() || (health as { current?: number }).current === 0) continue;

    // Early world-space distance check
    const worldDx = transform.x - worldPos.x;
    const worldDz = transform.y - worldPos.z;
    if (worldDx * worldDx + worldDz * worldDz > worldSearchRadius * worldSearchRadius) continue;

    // Get terrain height and add visual height for flying units
    const getTerrainHeight = camera.getTerrainHeightFunction();
    const terrainHeight = getTerrainHeight?.(transform.x, transform.y) ?? 0;
    const visualHeight = selectable.visualHeight ?? 0;
    const worldY = terrainHeight + visualHeight;

    const screenPos = camera.worldToScreen(transform.x, transform.y, worldY);
    if (!screenPos) continue;

    const dx = screenPos.x - screenX;
    const dy = screenPos.y - screenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Scale click radius by visual scale for larger units
    const visualScale = selectable.visualScale ?? 1;
    const effectiveRadius = unitScreenRadius * visualScale;

    if (dist < effectiveRadius) {
      // Prioritize units over resources
      if (!closestEntity || dist < closestEntity.distance) {
        closestEntity = { entity, distance: dist };
      }
    }
  }

  // If we found a unit, return it (units have priority over buildings/resources)
  if (closestEntity) {
    const unit = closestEntity.entity?.get<Unit>('Unit');
    if (unit) {
      return { entity: closestEntity.entity };
    }
  }

  // Check buildings using IWorldProvider query
  const buildings = world.getEntitiesWith('Building', 'Transform');
  for (const entity of buildings) {
    const transform = entity.get<Transform>('Transform');
    const health = entity.get<Health>('Health');
    const selectable = entity.get<Selectable>('Selectable');
    const building = entity.get<Building>('Building');
    if (!transform || !health || !selectable || !building) continue;
    if (health.isDead?.() || (health as { current?: number }).current === 0) continue;

    // Early world-space distance check
    const worldDx = transform.x - worldPos.x;
    const worldDz = transform.y - worldPos.z;
    if (worldDx * worldDx + worldDz * worldDz > worldSearchRadius * worldSearchRadius) continue;

    // Flying buildings need height consideration
    const getTerrainHeightFn = camera.getTerrainHeightFunction();
    const terrainHeight = getTerrainHeightFn?.(transform.x, transform.y) ?? 0;
    const visualHeight = building.isFlying && building.state === 'flying' ? (selectable.visualHeight ?? 0) : 0;
    const worldY = terrainHeight + visualHeight;

    const screenPos = camera.worldToScreen(transform.x, transform.y, worldY);
    if (!screenPos) continue;

    const dx = screenPos.x - screenX;
    const dy = screenPos.y - screenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const visualScale = selectable.visualScale ?? 1;
    const effectiveRadius = buildingScreenRadius * visualScale;

    if (dist < effectiveRadius) {
      if (!closestEntity || dist < closestEntity.distance) {
        closestEntity = { entity, distance: dist };
      }
    }
  }

  return closestEntity ? { entity: closestEntity.entity } : null;
}

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
  // Helper to get world provider (from worker mode or direct game.world)
  const getWorldProvider = useCallback((): IWorldProvider | null => {
    if (worldProviderRef?.current) return worldProviderRef.current;
    const game = gameRef.current;
    if (game?.world) return game.world as unknown as IWorldProvider;
    return null;
  }, [worldProviderRef, gameRef]);

  // Helper to get event bus (from worker mode or direct game.eventBus)
  const getEventBus = useCallback((): EventBus | null => {
    if (eventBusRef?.current) return eventBusRef.current;
    return gameRef.current?.eventBus ?? null;
  }, [eventBusRef, gameRef]);
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
      const camera = cameraRef.current;
      const worldPos = camera?.screenToWorld(coords.x, coords.y);
      const world = getWorldProvider();
      const eventBus = getEventBus();
      const game = gameRef.current;
      if (!worldPos || !camera || !world || !eventBus) return;

      const selectedUnits = useGameStore.getState().selectedUnits;

      // Handle rally point mode
      if (isSettingRallyPoint) {
        for (const buildingId of selectedUnits) {
          eventBus.emit('rally:set', {
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
        const clickedEntity = findEntityAtScreenPosition(world, coords.x, coords.y, camera);
        if (clickedEntity && clickedEntity.entity) {
          const building = clickedEntity.entity.get<Building>('Building');
          const unit = clickedEntity.entity.get<Unit>('Unit');
          const health = clickedEntity.entity.get<Health>('Health');
          const selectable = clickedEntity.entity.get<Selectable>('Selectable');

          const localPlayer = getLocalPlayerId();
          const isDead = health?.isDead?.() || (health as { current?: number })?.current === 0;
          if (localPlayer && selectable?.playerId === localPlayer && health && !isDead) {
            if (building || unit?.isMechanical) {
              eventBus.emit('command:repair', {
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
      if (isLandingMode && landingBuildingId && game) {
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
        const clickedEntity = findEntityAtScreenPosition(world, coords.x, coords.y, camera);

        if (clickedEntity && clickedEntity.entity) {
          const resource = clickedEntity.entity.get<Resource>('Resource');
          const selectable = clickedEntity.entity.get<Selectable>('Selectable');
          const health = clickedEntity.entity.get<Health>('Health');

          // Gather command
          if (resource && game) {
            const workerIds = selectedUnits.filter((id: number) => {
              const entity = world.getEntity(id);
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
          const isDead = health?.isDead?.() || (health as { current?: number })?.current === 0;
          if (selectable && localPlayerId && selectable.playerId !== localPlayerId && health && !isDead) {
            eventBus.emit('command:attack', {
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
                const entity = world.getEntity(id);
                const unit = entity?.get<Unit>('Unit');
                return unit?.isWorker;
              });

              if (workerIds.length > 0) {
                eventBus.emit('command:resume_construction', {
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
          const entity = world.getEntity(id);
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
            eventBus.emit('command:flyingBuildingMove', {
              buildingId,
              targetPosition: { x: worldPos.x, y: worldPos.z },
            });
          }
        }

        // Set rally point for grounded production buildings
        if (groundedProductionBuildingIds.length > 0 && flyingBuildingIds.length === 0 && unitIds.length === 0) {
          let targetId: number | undefined;
          if (clickedEntity && clickedEntity.entity) {
            const resource = clickedEntity.entity.get<Resource>('Resource');
            if (resource) {
              targetId = clickedEntity.entity.id;
            }
          }
          for (const buildingId of groundedProductionBuildingIds) {
            eventBus.emit('rally:set', {
              buildingId,
              x: worldPos.x,
              y: worldPos.z,
              targetId,
            });
          }
        }

        // Move units
        if (unitIds.length > 0 && game) {
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
            eventBus.emit('command:moveGround', {
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
      getWorldProvider,
      getEventBus,
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
      const world = getWorldProvider();
      const eventBus = getEventBus();
      const game = gameRef.current;

      if (e.button === 0) {
        // Left click
        if (commandTargetMode === 'attack') {
          const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
          if (worldPos && game && eventBus) {
            const selectedUnits = useGameStore.getState().selectedUnits;
            const localPlayer = getLocalPlayerId();
            if (selectedUnits.length > 0 && localPlayer) {
              game.issueCommand({
                tick: game.getCurrentTick(),
                playerId: localPlayer,
                type: 'ATTACK',
                entityIds: selectedUnits,
                targetPosition: { x: worldPos.x, y: worldPos.z },
                queue: e.shiftKey,
              });
              eventBus.emit('command:attackGround', {
                targetPosition: { x: worldPos.x, y: worldPos.z },
                playerId: localPlayer,
              });
            }
          }
          if (!e.shiftKey) useGameStore.getState().setCommandTargetMode(null);
        } else if (commandTargetMode === 'patrol') {
          const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
          if (worldPos && game) {
            const selectedUnits = useGameStore.getState().selectedUnits;
            const localPlayer = getLocalPlayerId();
            if (selectedUnits.length > 0 && localPlayer) {
              game.issueCommand({
                tick: game.getCurrentTick(),
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
          if (worldPos && game && eventBus) {
            const selectedUnits = useGameStore.getState().selectedUnits;
            const localPlayer = getLocalPlayerId();
            if (selectedUnits.length > 0 && localPlayer) {
              game.issueCommand({
                tick: game.getCurrentTick(),
                playerId: localPlayer,
                type: 'MOVE',
                entityIds: selectedUnits,
                targetPosition: { x: worldPos.x, y: worldPos.z },
                queue: e.shiftKey,
              });
              eventBus.emit('command:moveGround', {
                targetPosition: { x: worldPos.x, y: worldPos.z },
                playerId: localPlayer,
              });
            }
          }
          if (!e.shiftKey) useGameStore.getState().setCommandTargetMode(null);
        } else if (abilityTargetMode) {
          const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
          if (worldPos && game && cameraRef.current && world) {
            const selectedUnits = useGameStore.getState().selectedUnits;
            const clickedEntity = findEntityAtScreenPosition(world, coords.x, coords.y, cameraRef.current);
            const localPlayer = getLocalPlayerId();

            if (localPlayer) {
              game.issueCommand({
                tick: game.getCurrentTick(),
                playerId: localPlayer,
                type: 'ABILITY',
                entityIds: selectedUnits,
                abilityId: abilityTargetMode,
                targetPosition: { x: worldPos.x, y: worldPos.z },
                targetEntityId: clickedEntity?.entity?.id,
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
          if (placementPreviewRef.current && game) {
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
        } else if (isBuilding && buildingType && placementPreviewRef.current) {
          const snappedPos = placementPreviewRef.current.getSnappedPosition();
          const isValid = placementPreviewRef.current.isPlacementValid();

          if (isValid && eventBus) {
            const selectedUnits = useGameStore.getState().selectedUnits;
            eventBus.emit('building:place', {
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
          if (worldPos && eventBus) {
            eventBus.emit('simulator:spawn', {
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
      getWorldProvider,
      getEventBus,
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
      const eventBus = getEventBus();

      // Handle wall placement finish
      if (e.button === 0 && isWallPlacementMode && wallPlacementPreviewRef.current?.isCurrentlyDrawing()) {
        const result = wallPlacementPreviewRef.current.finishLine();

        if (eventBus && result.positions.length > 0) {
          const store = useGameStore.getState();
          const wallBuildingType = store.buildingType || 'wall_segment';

          eventBus.emit('wall:place_line', {
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

        if (eventBus) {
          const screenDx = Math.abs(selectionEnd.x - selectionStart.x);
          const screenDy = Math.abs(selectionEnd.y - selectionStart.y);
          const MIN_BOX_DRAG = 10;

          if (screenDx > MIN_BOX_DRAG || screenDy > MIN_BOX_DRAG) {
            // Box selection
            eventBus.emit('selection:boxScreen', {
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

            eventBus.emit('selection:clickScreen', {
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
      getEventBus,
      isWallPlacementMode,
      isSelecting,
      selectionStart,
      selectionEnd,
      wallPlacementPreviewRef,
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

      const eventBus = getEventBus();
      if (!eventBus) return;

      const coords = getContainerCoords(e);
      const finalEndX = coords.x;
      const finalEndY = coords.y;

      const screenDx = Math.abs(finalEndX - selectionStart.x);
      const screenDy = Math.abs(finalEndY - selectionStart.y);
      const MIN_BOX_DRAG = 10;

      if (screenDx > MIN_BOX_DRAG || screenDy > MIN_BOX_DRAG) {
        eventBus.emit('selection:boxScreen', {
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

        eventBus.emit('selection:clickScreen', {
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
  }, [isSelecting, selectionStart, getContainerCoords, getEventBus]);

  // Keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      const key = e.key.toLowerCase();
      const world = getWorldProvider();
      const eventBus = getEventBus();
      const game = gameRef.current;

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
          else eventBus?.emit('selection:clear');
          break;
        }
        case 'l': {
          const store = useGameStore.getState();
          const localPlayer = getLocalPlayerId();
          if (store.selectedUnits.length > 0 && localPlayer && world && game) {
            const firstEntity = world.getEntity(store.selectedUnits[0]);
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
          if (store.selectedUnits.length > 0 && world) {
            const firstEntity = world.getEntity(store.selectedUnits[0]);
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
        case '`': {
          // Toggle debug console (only in single player)
          if (!isMultiplayerMode()) {
            e.preventDefault();
            const uiStore = useUIStore.getState();
            if (!uiStore.consoleEnabled) {
              uiStore.setConsoleEnabled(true);
            }
            uiStore.toggleConsole();
          }
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
          if (selectedUnits.length > 0 && localPlayer && game) {
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
          if (selectedUnits.length > 0 && localPlayer && game) {
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
          if (group && group.length > 0 && world) {
            const now = Date.now();
            const lastTap = lastControlGroupTap.current;

            if (lastTap && lastTap.group === groupNumber && now - lastTap.time < 300) {
              const firstEntity = world.getEntity(group[0]);
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
    getWorldProvider,
    getEventBus,
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

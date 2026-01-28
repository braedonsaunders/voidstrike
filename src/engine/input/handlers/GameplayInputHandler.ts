/**
 * GameplayInputHandler - Handles normal gameplay input
 *
 * Processes input for the main gameplay context including:
 * - Unit selection (click, box select, double-click)
 * - Movement commands (right-click move)
 * - Attack commands
 * - Control groups
 * - Keyboard shortcuts
 */

import type {
  InputHandler,
  InputState,
  InputHandlerDependencies,
  KeyboardInputEvent,
  MouseInputEvent,
} from '../types';
import { MouseButton } from '../types';
import { InputManager } from '../InputManager';
import { useGameStore } from '@/store/gameStore';
import { useUIStore, GameOverlayType } from '@/store/uiStore';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Health } from '@/engine/components/Health';
import { Resource } from '@/engine/components/Resource';
import { Selectable } from '@/engine/components/Selectable';
import { Building } from '@/engine/components/Building';
import { isBattleSimulatorMode, isMultiplayerMode } from '@/store/gameSetupStore';

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_BOX_DRAG = 10;

// =============================================================================
// GAMEPLAY INPUT HANDLER
// =============================================================================

export class GameplayInputHandler implements InputHandler {
  private lastControlGroupTap: { group: number; time: number } | null = null;

  // =============================================================================
  // KEYBOARD INPUT
  // =============================================================================

  onKeyDown(
    event: KeyboardInputEvent,
    state: InputState,
    deps: InputHandlerDependencies
  ): boolean {
    const { key } = event;
    const { game, world, eventBus, camera, getLocalPlayerId } = deps;

    switch (key) {
      case 'escape':
        return this.handleEscape(eventBus);

      case 's':
        return this.handleStop(game, getLocalPlayerId);

      case 'h':
        return this.handleHold(game, getLocalPlayerId);

      case 'a':
        return this.handleAttackMode();

      case 'm':
        return this.handleMoveMode();

      case 'p':
        return this.handlePatrolMode();

      case 'r':
        return this.handleRepairOrRally(world);

      case 'l':
        return this.handleLiftoffOrLand(world, game, getLocalPlayerId);

      case 'o':
        return this.handleOverlayToggle();

      case '`':
        return this.handleConsoleToggle();

      case '?':
        return this.handleShortcutsToggle();
    }

    // Alt+A: Toggle attack range overlay
    if (event.modifiers.alt && key === 'a') {
      return this.handleAttackRangeOverlay();
    }

    // Alt+V: Toggle vision range overlay
    if (event.modifiers.alt && key === 'v') {
      return this.handleVisionRangeOverlay();
    }

    // Control groups (0-9)
    if (/^[0-9]$/.test(key)) {
      return this.handleControlGroup(
        parseInt(key),
        event.modifiers,
        world,
        camera
      );
    }

    return false;
  }

  // =============================================================================
  // MOUSE INPUT
  // =============================================================================

  onMouseDown(
    event: MouseInputEvent,
    state: InputState,
    deps: InputHandlerDependencies
  ): boolean {
    const { eventBus, game, getLocalPlayerId } = deps;
    const inputManager = InputManager.getInstance();

    if (event.button === MouseButton.Left) {
      // Battle simulator mode - spawn units
      if (isBattleSimulatorMode() && event.worldPosition && eventBus) {
        eventBus.emit('simulator:spawn', {
          worldX: event.worldPosition.x,
          worldY: event.worldPosition.z,
        });
        return true;
      }

      // Start selection box
      inputManager.startSelection(event.position.x, event.position.y);
      return true;
    }

    if (event.button === MouseButton.Right) {
      return this.handleRightClick(event, state, deps);
    }

    return false;
  }

  onMouseMove(
    event: MouseInputEvent,
    state: InputState,
    deps: InputHandlerDependencies
  ): boolean {
    const inputManager = InputManager.getInstance();
    const selectionState = inputManager.getSelectionState();

    if (selectionState.isSelecting) {
      inputManager.updateSelection(event.position.x, event.position.y);
      return true;
    }

    return false;
  }

  onMouseUp(
    event: MouseInputEvent,
    state: InputState,
    deps: InputHandlerDependencies
  ): boolean {
    const { eventBus, getLocalPlayerId } = deps;
    const inputManager = InputManager.getInstance();
    const selectionState = inputManager.getSelectionState();

    if (event.button === MouseButton.Left && selectionState.isSelecting) {
      const finalState = inputManager.endSelection();

      if (!eventBus) return true;

      const screenDx = Math.abs(finalState.end.x - finalState.start.x);
      const screenDy = Math.abs(finalState.end.y - finalState.start.y);

      if (screenDx > MIN_BOX_DRAG || screenDy > MIN_BOX_DRAG) {
        // Box selection
        eventBus.emit('selection:boxScreen', {
          screenStartX: finalState.start.x,
          screenStartY: finalState.start.y,
          screenEndX: finalState.end.x,
          screenEndY: finalState.end.y,
          additive: state.modifiers.shift,
          playerId: getLocalPlayerId(),
        });
      } else {
        // Click selection (handled by onClick)
      }

      return true;
    }

    return false;
  }

  onClick(
    event: MouseInputEvent,
    state: InputState,
    deps: InputHandlerDependencies
  ): boolean {
    const { eventBus, getLocalPlayerId } = deps;

    if (event.button === MouseButton.Left && eventBus) {
      eventBus.emit('selection:clickScreen', {
        screenX: event.position.x,
        screenY: event.position.y,
        additive: state.modifiers.shift,
        selectAllOfType: state.modifiers.ctrl,
        playerId: getLocalPlayerId(),
      });
      return true;
    }

    return false;
  }

  onDoubleClick(
    event: MouseInputEvent,
    state: InputState,
    deps: InputHandlerDependencies
  ): boolean {
    const { eventBus, getLocalPlayerId } = deps;

    if (event.button === MouseButton.Left && eventBus) {
      // Double-click selects all units of same type
      eventBus.emit('selection:clickScreen', {
        screenX: event.position.x,
        screenY: event.position.y,
        additive: state.modifiers.shift,
        selectAllOfType: true,
        playerId: getLocalPlayerId(),
      });
      return true;
    }

    return false;
  }

  onContextMenu(
    event: MouseInputEvent,
    state: InputState,
    deps: InputHandlerDependencies
  ): boolean {
    // Right-click is handled in onMouseDown
    return true;
  }

  onBlur(): void {
    // Cancel selection on focus loss
    InputManager.getInstance().cancelSelection();
  }

  // =============================================================================
  // COMMAND HANDLERS
  // =============================================================================

  private handleRightClick(
    event: MouseInputEvent,
    state: InputState,
    deps: InputHandlerDependencies
  ): boolean {
    const { game, world, eventBus, camera, getLocalPlayerId } = deps;
    if (!event.worldPosition || !camera || !world || !eventBus) return false;

    const selectedUnits = useGameStore.getState().selectedUnits;
    if (selectedUnits.length === 0) return false;

    const queue = state.modifiers.shift;
    const localPlayer = getLocalPlayerId();
    if (!localPlayer) return false;

    // Find entity at click position
    const clickedEntity = this.findEntityAtScreenPosition(
      world,
      event.position.x,
      event.position.y,
      camera
    );

    if (clickedEntity) {
      const resource = clickedEntity.get<Resource>('Resource');
      const selectable = clickedEntity.get<Selectable>('Selectable');
      const health = clickedEntity.get<Health>('Health');
      const building = clickedEntity.get<Building>('Building');

      // Gather command
      if (resource && game) {
        const workerIds = selectedUnits.filter((id: number) => {
          const entity = world.getEntity(id);
          const unit = entity?.get<Unit>('Unit');
          return unit?.isWorker;
        });

        if (workerIds.length > 0) {
          game.issueCommand({
            tick: game.getCurrentTick(),
            playerId: localPlayer,
            type: 'GATHER',
            entityIds: workerIds,
            targetEntityId: clickedEntity.id,
            queue,
          });
          return true;
        }
      }

      // Attack enemy
      const isDead = health?.isDead?.() || (health as { current?: number })?.current === 0;
      if (selectable && selectable.playerId !== localPlayer && health && !isDead) {
        eventBus.emit('command:attack', {
          entityIds: selectedUnits,
          targetEntityId: clickedEntity.id,
          queue,
        });
        return true;
      }

      // Resume construction
      if (building && selectable?.playerId === localPlayer) {
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
              buildingId: clickedEntity.id,
            });
            return true;
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
          targetPosition: { x: event.worldPosition.x, y: event.worldPosition.z },
        });
      }
    }

    // Set rally point for grounded production buildings
    if (groundedProductionBuildingIds.length > 0 && flyingBuildingIds.length === 0 && unitIds.length === 0) {
      let targetId: number | undefined;
      if (clickedEntity) {
        const resource = clickedEntity.get<Resource>('Resource');
        if (resource) {
          targetId = clickedEntity.id;
        }
      }
      for (const buildingId of groundedProductionBuildingIds) {
        eventBus.emit('rally:set', {
          buildingId,
          x: event.worldPosition.x,
          y: event.worldPosition.z,
          targetId,
        });
      }
    }

    // Move units
    if (unitIds.length > 0 && game) {
      game.issueCommand({
        tick: game.getCurrentTick(),
        playerId: localPlayer,
        type: 'MOVE',
        entityIds: unitIds,
        targetPosition: { x: event.worldPosition.x, y: event.worldPosition.z },
        queue,
      });
      eventBus.emit('command:moveGround', {
        targetPosition: { x: event.worldPosition.x, y: event.worldPosition.z },
        playerId: localPlayer,
      });
    }

    return true;
  }

  // =============================================================================
  // KEYBOARD COMMAND HANDLERS
  // =============================================================================

  private handleEscape(eventBus: InputHandlerDependencies['eventBus']): boolean {
    eventBus?.emit('selection:clear');
    return true;
  }

  private handleStop(
    game: InputHandlerDependencies['game'],
    getLocalPlayerId: InputHandlerDependencies['getLocalPlayerId']
  ): boolean {
    const selectedUnits = useGameStore.getState().selectedUnits;
    const localPlayer = getLocalPlayerId();

    if (selectedUnits.length > 0 && localPlayer && game) {
      game.issueCommand({
        tick: game.getCurrentTick(),
        playerId: localPlayer,
        type: 'STOP',
        entityIds: selectedUnits,
      });
      return true;
    }
    return false;
  }

  private handleHold(
    game: InputHandlerDependencies['game'],
    getLocalPlayerId: InputHandlerDependencies['getLocalPlayerId']
  ): boolean {
    const selectedUnits = useGameStore.getState().selectedUnits;
    const localPlayer = getLocalPlayerId();

    if (selectedUnits.length > 0 && localPlayer && game) {
      game.issueCommand({
        tick: game.getCurrentTick(),
        playerId: localPlayer,
        type: 'HOLD',
        entityIds: selectedUnits,
      });
      return true;
    }
    return false;
  }

  private handleAttackMode(): boolean {
    useGameStore.getState().setCommandTargetMode('attack');
    InputManager.getInstance().setContext('command');
    return true;
  }

  private handleMoveMode(): boolean {
    useGameStore.getState().setCommandTargetMode('move');
    InputManager.getInstance().setContext('command');
    return true;
  }

  private handlePatrolMode(): boolean {
    useGameStore.getState().setCommandTargetMode('patrol');
    InputManager.getInstance().setContext('command');
    return true;
  }

  private handleRepairOrRally(world: InputHandlerDependencies['world']): boolean {
    const store = useGameStore.getState();
    if (store.selectedUnits.length > 0 && world) {
      const firstEntity = world.getEntity(store.selectedUnits[0]);
      const unit = firstEntity?.get<Unit>('Unit');
      const building = firstEntity?.get<Building>('Building');

      if (unit?.isWorker && unit?.canRepair) {
        store.setRepairMode(true);
        InputManager.getInstance().setContext('repair');
        return true;
      } else if (building) {
        store.setRallyPointMode(true);
        InputManager.getInstance().setContext('rally');
        return true;
      }
    }
    return false;
  }

  private handleLiftoffOrLand(
    world: InputHandlerDependencies['world'],
    game: InputHandlerDependencies['game'],
    getLocalPlayerId: InputHandlerDependencies['getLocalPlayerId']
  ): boolean {
    const store = useGameStore.getState();
    const localPlayer = getLocalPlayerId();

    if (store.selectedUnits.length > 0 && localPlayer && world && game) {
      const firstEntity = world.getEntity(store.selectedUnits[0]);
      const building = firstEntity?.get<Building>('Building');

      if (building?.canLiftOff) {
        if (building.isFlying && building.state === 'flying') {
          store.setLandingMode(true, store.selectedUnits[0]);
          InputManager.getInstance().setContext('landing');
          return true;
        } else if (building.state === 'complete' && !building.isFlying && building.productionQueue.length === 0) {
          game.issueCommand({
            tick: game.getCurrentTick(),
            playerId: localPlayer,
            type: 'LIFTOFF',
            entityIds: [store.selectedUnits[0]],
            buildingId: store.selectedUnits[0],
          });
          return true;
        }
      }
    }
    return false;
  }

  private handleOverlayToggle(): boolean {
    const uiStore = useUIStore.getState();
    const currentOverlay = uiStore.overlaySettings.activeOverlay;
    const overlayOrder: GameOverlayType[] = ['none', 'elevation', 'threat', 'navmesh', 'resource', 'buildable'];
    const currentIndex = overlayOrder.indexOf(currentOverlay);
    const nextIndex = (currentIndex + 1) % overlayOrder.length;
    uiStore.setActiveOverlay(overlayOrder[nextIndex]);
    return true;
  }

  private handleConsoleToggle(): boolean {
    if (!isMultiplayerMode()) {
      const uiStore = useUIStore.getState();
      if (!uiStore.consoleEnabled) {
        uiStore.setConsoleEnabled(true);
      }
      uiStore.toggleConsole();
      return true;
    }
    return false;
  }

  private handleShortcutsToggle(): boolean {
    const store = useGameStore.getState();
    store.setShowKeyboardShortcuts(!store.showKeyboardShortcuts);
    return true;
  }

  private handleAttackRangeOverlay(): boolean {
    // This requires overlay manager reference - emit event instead
    useUIStore.getState().toggleAttackRangeOverlay?.();
    return true;
  }

  private handleVisionRangeOverlay(): boolean {
    useUIStore.getState().toggleVisionRangeOverlay?.();
    return true;
  }

  private handleControlGroup(
    groupNumber: number,
    modifiers: InputState['modifiers'],
    world: InputHandlerDependencies['world'],
    camera: InputHandlerDependencies['camera']
  ): boolean {
    const store = useGameStore.getState();

    if (modifiers.ctrl || modifiers.meta) {
      // Set control group
      store.setControlGroup(groupNumber, store.selectedUnits);
      return true;
    } else if (modifiers.shift) {
      // Add to control group
      const existing = store.controlGroups.get(groupNumber) || [];
      const selected = store.selectedUnits;
      const combinedSet = new Set(existing);
      for (const id of selected) {
        combinedSet.add(id);
      }
      store.setControlGroup(groupNumber, Array.from(combinedSet));
      return true;
    } else {
      // Select control group (double-tap to center camera)
      const group = store.controlGroups.get(groupNumber);
      if (group && group.length > 0 && world) {
        const now = Date.now();

        if (
          this.lastControlGroupTap &&
          this.lastControlGroupTap.group === groupNumber &&
          now - this.lastControlGroupTap.time < 300
        ) {
          // Double-tap: center camera on first unit
          const firstEntity = world.getEntity(group[0]);
          const transform = firstEntity?.get<Transform>('Transform');
          if (transform && camera) {
            camera.setPosition(transform.x, transform.y);
          }
        }

        this.lastControlGroupTap = { group: groupNumber, time: now };
        store.selectUnits(group);
        return true;
      }
    }

    return false;
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  private findEntityAtScreenPosition(
    world: InputHandlerDependencies['world'],
    screenX: number,
    screenY: number,
    camera: InputHandlerDependencies['camera']
  ): ReturnType<NonNullable<InputHandlerDependencies['world']>['getEntity']> | null {
    if (!world || !camera) return null;

    const resourceScreenRadius = 40;
    const unitScreenRadius = 35;
    const buildingScreenRadius = 50;

    const worldPos = camera.screenToWorld(screenX, screenY);
    if (!worldPos) return null;

    const zoom = camera.getZoom?.() ?? 1;
    const maxScreenRadius = Math.max(resourceScreenRadius, unitScreenRadius, buildingScreenRadius);
    const worldSearchRadius = (maxScreenRadius / zoom) * 1.5 + 5;

    type ClickCandidate = { entity: NonNullable<ReturnType<typeof world.getEntity>>; distance: number };
    let closestEntity: ClickCandidate | null = null;

    // Check units first (priority)
    const units = world.getEntitiesWith('Unit', 'Transform');
    for (const entity of units) {
      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');
      if (!transform || !health || !selectable) continue;
      if (health.isDead?.() || (health as { current?: number }).current === 0) continue;

      const worldDx = transform.x - worldPos.x;
      const worldDz = transform.y - worldPos.z;
      if (worldDx * worldDx + worldDz * worldDz > worldSearchRadius * worldSearchRadius) continue;

      const getTerrainHeight = camera.getTerrainHeightFunction();
      const terrainHeight = getTerrainHeight?.(transform.x, transform.y) ?? 0;
      const visualHeight = selectable.visualHeight ?? 0;
      const worldY = terrainHeight + visualHeight;

      const screenPos = camera.worldToScreen(transform.x, transform.y, worldY);
      if (!screenPos) continue;

      const dx = screenPos.x - screenX;
      const dy = screenPos.y - screenY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const visualScale = selectable.visualScale ?? 1;
      const effectiveRadius = unitScreenRadius * visualScale;

      if (dist < effectiveRadius) {
        if (!closestEntity || dist < closestEntity.distance) {
          closestEntity = { entity, distance: dist };
        }
      }
    }

    // Return unit if found (units have priority)
    if (closestEntity) {
      const unit = closestEntity.entity?.get<Unit>('Unit');
      if (unit) {
        return closestEntity.entity;
      }
    }

    // Check buildings
    const buildings = world.getEntitiesWith('Building', 'Transform');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');
      if (!transform || !health || !selectable || !building) continue;
      if (health.isDead?.() || (health as { current?: number }).current === 0) continue;

      const worldDx = transform.x - worldPos.x;
      const worldDz = transform.y - worldPos.z;
      if (worldDx * worldDx + worldDz * worldDz > worldSearchRadius * worldSearchRadius) continue;

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

    // Check resources
    const resources = world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform');
      if (!transform) continue;

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

    return closestEntity?.entity ?? null;
  }
}

/**
 * BuildingInputHandler - Handles building placement mode
 *
 * Processes input for the building placement context where
 * the player is positioning a building to construct.
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
import type { BuildingPlacementPreview } from '@/rendering/BuildingPlacementPreview';

export class BuildingInputHandler implements InputHandler {
  constructor(private readonly mode: 'building' | 'landing') {}

  private placementPreview: BuildingPlacementPreview | null = null;

  private syncPreviewToCurrentPointer(): void {
    if (!this.placementPreview) return;

    const inputManager = InputManager.getInstanceSync();
    if (!inputManager) return;

    const mousePosition = inputManager.getMousePosition();
    const worldPosition = inputManager.containerToWorld(mousePosition.x, mousePosition.y);
    if (!worldPosition) return;

    this.placementPreview.updatePosition(worldPosition.x, worldPosition.z);
  }

  /**
   * Set the placement preview reference
   */
  setPlacementPreview(preview: BuildingPlacementPreview | null): void {
    this.placementPreview = preview;
  }

  onActivate(): void {
    this.syncPreviewToCurrentPointer();
  }

  onDeactivate(): void {
    const store = useGameStore.getState();

    if (this.mode === 'building' && store.isBuilding) {
      store.setBuildingMode(null);
    }

    if (this.mode === 'landing' && store.isLandingMode) {
      store.setLandingMode(false);
    }
  }

  onKeyDown(
    event: KeyboardInputEvent,
    _state: InputState,
    _deps: InputHandlerDependencies
  ): boolean {
    if (event.key === 'escape') {
      if (this.mode === 'building') {
        useGameStore.getState().setBuildingMode(null);
      } else {
        useGameStore.getState().setLandingMode(false);
      }
      InputManager.getInstance().setContext('gameplay');
      return true;
    }
    return false;
  }

  onMouseDown(event: MouseInputEvent, state: InputState, deps: InputHandlerDependencies): boolean {
    const { game, getLocalPlayerId } = deps;
    const store = useGameStore.getState();
    const { buildingType, landingBuildingId } = store;

    if (event.button === MouseButton.Right) {
      if (this.mode === 'landing' && event.worldPosition && game && landingBuildingId !== null) {
        const localPlayer = getLocalPlayerId();
        if (!localPlayer) return true;

        game.issueCommand({
          tick: game.getCurrentTick(),
          playerId: localPlayer,
          type: 'LAND',
          entityIds: [landingBuildingId],
          buildingId: landingBuildingId,
          targetPosition: { x: event.worldPosition.x, y: event.worldPosition.z },
          queue: state.modifiers.shift,
        });

        if (!state.modifiers.shift) {
          store.setLandingMode(false);
          InputManager.getInstance().setContext('gameplay');
        }
        return true;
      }

      if (this.mode === 'building') {
        store.setBuildingMode(null);
      } else {
        store.setLandingMode(false);
      }
      InputManager.getInstance().setContext('gameplay');
      return true;
    }

    if (
      this.mode === 'landing' &&
      event.button === MouseButton.Left &&
      event.worldPosition &&
      game
    ) {
      const localPlayer = getLocalPlayerId();
      if (!localPlayer || landingBuildingId === null) return true;

      game.issueCommand({
        tick: game.getCurrentTick(),
        playerId: localPlayer,
        type: 'LAND',
        entityIds: [landingBuildingId],
        buildingId: landingBuildingId,
        targetPosition: { x: event.worldPosition.x, y: event.worldPosition.z },
        queue: state.modifiers.shift,
      });

      if (!state.modifiers.shift) {
        store.setLandingMode(false);
        InputManager.getInstance().setContext('gameplay');
      }

      return true;
    }

    if (
      this.mode === 'building' &&
      event.button === MouseButton.Left &&
      this.placementPreview &&
      buildingType &&
      game
    ) {
      if (event.worldPosition) {
        this.placementPreview.updatePosition(event.worldPosition.x, event.worldPosition.z);
      }

      const snappedPos = this.placementPreview.getSnappedPosition();
      const isValid = this.placementPreview.isPlacementValid();
      const localPlayer = getLocalPlayerId();

      if (isValid && localPlayer) {
        game.issueCommand({
          tick: game.getCurrentTick(),
          playerId: localPlayer,
          type: 'BUILD',
          entityIds: store.selectedUnits,
          buildingType,
          targetPosition: { x: snappedPos.x, y: snappedPos.y },
          queue: state.modifiers.shift,
        });

        if (state.modifiers.shift) {
          store.addToBuildingQueue({
            buildingType,
            x: snappedPos.x,
            y: snappedPos.y,
          });
        } else {
          store.setBuildingMode(null);
          InputManager.getInstance().setContext('gameplay');
        }
      } else if (!isValid && !state.modifiers.shift) {
        store.setBuildingMode(null);
        InputManager.getInstance().setContext('gameplay');
      }

      return true;
    }

    return false;
  }

  onMouseMove(event: MouseInputEvent, state: InputState, deps: InputHandlerDependencies): boolean {
    const { camera } = deps;

    // Update placement preview position
    if (this.placementPreview && camera && event.worldPosition) {
      this.placementPreview.updatePosition(event.worldPosition.x, event.worldPosition.z);
      return true;
    }

    return false;
  }

  onBlur(): void {
    if (this.mode === 'building') {
      useGameStore.getState().setBuildingMode(null);
    } else {
      useGameStore.getState().setLandingMode(false);
    }
    InputManager.getInstance().setContext('gameplay');
  }
}

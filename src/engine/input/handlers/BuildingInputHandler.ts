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
  private placementPreview: BuildingPlacementPreview | null = null;

  /**
   * Set the placement preview reference
   */
  setPlacementPreview(preview: BuildingPlacementPreview | null): void {
    this.placementPreview = preview;
  }

  onActivate(): void {
    // Building mode activated
  }

  onDeactivate(): void {
    // Clear building mode when leaving
    useGameStore.getState().setBuildingMode(null);
  }

  onKeyDown(
    event: KeyboardInputEvent,
    state: InputState,
    deps: InputHandlerDependencies
  ): boolean {
    if (event.key === 'escape') {
      useGameStore.getState().setBuildingMode(null);
      InputManager.getInstance().setContext('gameplay');
      return true;
    }
    return false;
  }

  onMouseDown(
    event: MouseInputEvent,
    state: InputState,
    deps: InputHandlerDependencies
  ): boolean {
    const { eventBus } = deps;
    const { buildingType } = useGameStore.getState();

    // Right-click cancels building mode
    if (event.button === MouseButton.Right) {
      useGameStore.getState().setBuildingMode(null);
      InputManager.getInstance().setContext('gameplay');
      return true;
    }

    // Left-click places building
    if (event.button === MouseButton.Left && this.placementPreview && buildingType) {
      const snappedPos = this.placementPreview.getSnappedPosition();
      const isValid = this.placementPreview.isPlacementValid();

      if (isValid && eventBus) {
        const selectedUnits = useGameStore.getState().selectedUnits;
        eventBus.emit('building:place', {
          buildingType,
          position: { x: snappedPos.x, y: snappedPos.y },
          workerId: selectedUnits.length > 0 ? selectedUnits[0] : undefined,
        });

        if (state.modifiers.shift) {
          // Queue another building of same type
          useGameStore.getState().addToBuildingQueue({
            buildingType,
            x: snappedPos.x,
            y: snappedPos.y,
          });
        } else {
          useGameStore.getState().setBuildingMode(null);
          InputManager.getInstance().setContext('gameplay');
        }
      } else if (!isValid && !state.modifiers.shift) {
        useGameStore.getState().setBuildingMode(null);
        InputManager.getInstance().setContext('gameplay');
      }

      return true;
    }

    return false;
  }

  onMouseMove(
    event: MouseInputEvent,
    state: InputState,
    deps: InputHandlerDependencies
  ): boolean {
    const { camera } = deps;

    // Update placement preview position
    if (this.placementPreview && camera && event.worldPosition) {
      this.placementPreview.updatePosition(event.worldPosition.x, event.worldPosition.z);
      return true;
    }

    return false;
  }

  onBlur(): void {
    useGameStore.getState().setBuildingMode(null);
    InputManager.getInstance().setContext('gameplay');
  }
}

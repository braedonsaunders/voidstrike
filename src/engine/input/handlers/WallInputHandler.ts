import { InputManager } from '../InputManager';
import type {
  InputHandler,
  InputHandlerDependencies,
  InputState,
  KeyboardInputEvent,
  MouseInputEvent,
} from '../types';
import { MouseButton } from '../types';
import type { WallPlacementPreview } from '@/rendering/WallPlacementPreview';
import { useGameStore } from '@/store/gameStore';

export class WallInputHandler implements InputHandler {
  private placementPreview: WallPlacementPreview | null = null;

  public setPlacementPreview(preview: WallPlacementPreview | null): void {
    this.placementPreview = preview;
  }

  onDeactivate(): void {
    if (useGameStore.getState().isWallPlacementMode) {
      useGameStore.getState().setWallPlacementMode(false);
    }
  }

  onKeyDown(
    event: KeyboardInputEvent,
    _state: InputState,
    _deps: InputHandlerDependencies
  ): boolean {
    if (event.key === 'escape') {
      useGameStore.getState().cancelWallLine();
      useGameStore.getState().setWallPlacementMode(false);
      InputManager.getInstance().setContext('gameplay');
      return true;
    }

    return false;
  }

  onMouseDown(
    event: MouseInputEvent,
    _state: InputState,
    _deps: InputHandlerDependencies
  ): boolean {
    const store = useGameStore.getState();

    if (event.button === MouseButton.Right) {
      store.cancelWallLine();
      store.setWallPlacementMode(false);
      InputManager.getInstance().setContext('gameplay');
      return true;
    }

    if (
      event.button === MouseButton.Left &&
      event.worldPosition &&
      this.placementPreview &&
      !this.placementPreview.isCurrentlyDrawing()
    ) {
      this.placementPreview.startLine(event.worldPosition.x, event.worldPosition.z);
      store.startWallLine(event.worldPosition.x, event.worldPosition.z);
      return true;
    }

    return false;
  }

  onMouseMove(
    event: MouseInputEvent,
    _state: InputState,
    _deps: InputHandlerDependencies
  ): boolean {
    if (!this.placementPreview || !event.worldPosition) return false;

    this.placementPreview.updateLine(event.worldPosition.x, event.worldPosition.z);
    if (this.placementPreview.isCurrentlyDrawing()) {
      useGameStore.getState().updateWallLine(event.worldPosition.x, event.worldPosition.z);
    }

    return true;
  }

  onMouseUp(event: MouseInputEvent, state: InputState, deps: InputHandlerDependencies): boolean {
    const { game, getLocalPlayerId } = deps;
    const store = useGameStore.getState();

    if (
      event.button !== MouseButton.Left ||
      !this.placementPreview ||
      !this.placementPreview.isCurrentlyDrawing() ||
      !game
    ) {
      return false;
    }

    const localPlayer = getLocalPlayerId();
    const buildingType = store.buildingType;
    const selectedUnits = store.selectedUnits;

    store.finishWallLine();
    const { positions } = this.placementPreview.finishLine();
    const validSegments = positions
      .filter((segment) => segment.valid)
      .map(({ x, y }) => ({ x, y }));

    if (localPlayer && buildingType && selectedUnits.length > 0 && validSegments.length > 0) {
      game.issueCommand({
        tick: game.getCurrentTick(),
        playerId: localPlayer,
        type: 'BUILD_WALL',
        entityIds: selectedUnits,
        buildingType,
        wallSegments: validSegments,
        queue: state.modifiers.shift,
      });
    }

    if (!state.modifiers.shift) {
      store.setWallPlacementMode(false);
      InputManager.getInstance().setContext('gameplay');
    }

    return true;
  }

  onBlur(): void {
    useGameStore.getState().cancelWallLine();
    useGameStore.getState().setWallPlacementMode(false);
    InputManager.getInstance().setContext('gameplay');
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildingInputHandler } from '@/engine/input/handlers/BuildingInputHandler';
import { InputManager } from '@/engine/input/InputManager';
import { MouseButton, type InputHandlerDependencies, type InputState } from '@/engine/input/types';
import { useGameStore } from '@/store/gameStore';

function createInputState(): InputState {
  return {
    keysPressed: new Set(),
    modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    mousePosition: { x: 0, y: 0 },
    mouseButtons: new Set(),
    mouseInBounds: true,
    isDragging: false,
    dragStart: null,
  };
}

describe('BuildingInputHandler', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    InputManager.resetInstance();
    vi.restoreAllMocks();
  });

  it('seeds the preview from the current pointer when building mode activates', () => {
    const handler = new BuildingInputHandler('building');
    const preview = {
      updatePosition: vi.fn(),
    } as const;

    handler.setPlacementPreview(preview as never);

    vi.spyOn(InputManager, 'getInstanceSync').mockReturnValue({
      getMousePosition: () => ({ x: 320, y: 640 }),
      containerToWorld: () => ({ x: 14, z: 22 }),
    } as unknown as InputManager);

    handler.onActivate?.({
      game: null,
      world: null,
      eventBus: null,
      camera: null,
      getLocalPlayerId: () => 'player1',
    });

    expect(preview.updatePosition).toHaveBeenCalledWith(14, 22);
  });

  it('uses the actual click world position for the first placement click even without an event bus', () => {
    useGameStore.setState({
      ...useGameStore.getState(),
      selectedUnits: [7],
    });
    useGameStore.getState().setBuildingMode('supply_cache');

    const handler = new BuildingInputHandler('building');
    let snappedPosition = { x: 0, y: 0 };
    const preview = {
      updatePosition: vi.fn((x: number, y: number) => {
        snappedPosition = { x: Math.round(x), y: Math.round(y) };
      }),
      getSnappedPosition: vi.fn(() => snappedPosition),
      isPlacementValid: vi.fn(() => true),
    };

    handler.setPlacementPreview(preview as never);

    const game = {
      getCurrentTick: () => 123,
      issueCommand: vi.fn(),
    };
    const deps: InputHandlerDependencies = {
      game: game as never,
      world: null,
      eventBus: null,
      camera: null,
      getLocalPlayerId: () => 'player1',
    };

    const consumed = handler.onMouseDown(
      {
        type: 'mousedown',
        timestamp: Date.now(),
        context: 'building',
        modifiers: { shift: false, ctrl: false, alt: false, meta: false },
        button: MouseButton.Left,
        position: { x: 500, y: 300 },
        worldPosition: { x: 42.4, z: 17.2 },
      },
      createInputState(),
      deps
    );

    expect(consumed).toBe(true);
    expect(preview.updatePosition).toHaveBeenCalledWith(42.4, 17.2);
    expect(game.issueCommand).toHaveBeenCalledWith({
      tick: 123,
      playerId: 'player1',
      type: 'BUILD',
      entityIds: [7],
      buildingType: 'supply_cache',
      targetPosition: { x: 42, y: 17 },
      queue: false,
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/engine/core/EventBus';
import { dispatchCommand, type GameCommand } from '@/engine/core/GameCommand';

function createCommand(overrides: Partial<GameCommand> = {}): GameCommand {
  return {
    tick: 10,
    playerId: 'player1',
    type: 'MOVE',
    entityIds: [101],
    ...overrides,
  };
}

describe('dispatchCommand', () => {
  it('maps resume construction commands to worker/building payloads', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('command:resume_construction', listener);

    dispatchCommand(
      bus,
      createCommand({
        type: 'RESUME_CONSTRUCTION',
        entityIds: [7],
        targetEntityId: 55,
      })
    );

    expect(listener).toHaveBeenCalledWith({
      workerId: 7,
      buildingId: 55,
      playerId: 'player1',
    });
  });

  it('maps rally commands to the rally payload expected by building systems', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('command:rally', listener);

    dispatchCommand(
      bus,
      createCommand({
        type: 'RALLY',
        entityIds: [12],
        buildingId: 12,
        targetPosition: { x: 18, y: 24 },
        targetEntityId: 99,
      })
    );

    expect(listener).toHaveBeenCalledWith({
      buildingId: 12,
      targetPosition: { x: 18, y: 24 },
      targetEntityId: 99,
      playerId: 'player1',
    });
  });

  it('maps addon commands onto the building addon channel', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('building:build_addon', listener);

    dispatchCommand(
      bus,
      createCommand({
        type: 'BUILD_ADDON',
        entityIds: [42],
        buildingId: 42,
        addonType: 'research_module',
      })
    );

    expect(listener).toHaveBeenCalledWith({
      buildingId: 42,
      addonType: 'research_module',
      playerId: 'player1',
    });
  });

  it('maps wall line commands to wall placement payloads', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('wall:place_line', listener);

    dispatchCommand(
      bus,
      createCommand({
        type: 'BUILD_WALL',
        entityIds: [3],
        buildingType: 'wall_segment',
        wallSegments: [
          { x: 10, y: 10 },
          { x: 11, y: 10 },
        ],
      })
    );

    expect(listener).toHaveBeenCalledWith({
      positions: [
        { x: 10, y: 10, valid: true },
        { x: 11, y: 10, valid: true },
      ],
      buildingType: 'wall_segment',
      playerId: 'player1',
    });
  });
});

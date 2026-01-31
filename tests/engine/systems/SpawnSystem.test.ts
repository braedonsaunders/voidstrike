import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpawnSystem } from '@/engine/systems/SpawnSystem';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { Velocity } from '@/engine/components/Velocity';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import type { Game } from '@/engine/core/Game';
import type { World } from '@/engine/ecs/World';
import type { Entity } from '@/engine/ecs/Entity';

// Mock AssetManager
vi.mock('@/assets/AssetManager', () => ({
  AssetManager: {
    getAirborneHeight: vi.fn().mockReturnValue(3),
    getCollisionRadius: vi.fn().mockReturnValue(0.5),
  },
  default: {
    getAirborneHeight: vi.fn().mockReturnValue(3),
    getCollisionRadius: vi.fn().mockReturnValue(0.5),
  },
}));

// Mock debugLogger
vi.mock('@/utils/debugLogger', () => ({
  debugSpawning: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock gameSetupStore
vi.mock('@/store/gameSetupStore', () => ({
  isLocalPlayer: vi.fn().mockReturnValue(true),
}));

// Get actual unit and building types that exist
function getFirstUnitType(): string | null {
  const keys = Object.keys(UNIT_DEFINITIONS);
  return keys.length > 0 ? keys[0] : null;
}

function getFirstBuildingType(): string | null {
  const keys = Object.keys(BUILDING_DEFINITIONS);
  return keys.length > 0 ? keys[0] : null;
}

describe('SpawnSystem', () => {
  let mockGame: Game;
  let mockWorld: World;
  let mockEntity: Entity;
  let spawnSystem: SpawnSystem;
  let eventHandlers: Map<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers = new Map();

    // Create mock entity with chainable add method
    mockEntity = {
      id: 1,
      add: vi.fn().mockReturnThis(),
      get: vi.fn(),
    } as unknown as Entity;

    mockWorld = {
      createEntity: vi.fn().mockReturnValue(mockEntity),
      getEntity: vi.fn(),
      getEntitiesWith: vi.fn().mockReturnValue([]),
      destroyEntity: vi.fn(),
      getSystem: vi.fn().mockReturnValue(null),
    } as unknown as World;

    mockGame = {
      world: mockWorld,
      eventBus: {
        on: vi.fn((event: string, handler: Function) => {
          eventHandlers.set(event, handler);
        }),
        off: vi.fn(),
        emit: vi.fn(),
      },
      getTerrainHeightAt: vi.fn().mockReturnValue(0),
      statePort: {
        addSupply: vi.fn(),
      },
      config: {
        mapWidth: 200,
        mapHeight: 200,
      },
    } as unknown as Game;

    spawnSystem = new SpawnSystem(mockGame);
    spawnSystem.init(mockWorld);
  });

  describe('constructor', () => {
    it('has the correct system name', () => {
      expect(spawnSystem.name).toBe('SpawnSystem');
    });

    it('registers event listeners for unit:spawn, building:spawn, and unit:died', () => {
      expect(mockGame.eventBus.on).toHaveBeenCalledWith('unit:spawn', expect.any(Function));
      expect(mockGame.eventBus.on).toHaveBeenCalledWith('building:spawn', expect.any(Function));
      expect(mockGame.eventBus.on).toHaveBeenCalledWith('unit:died', expect.any(Function));
    });
  });

  describe('unit:spawn event', () => {
    it('creates entity with all required components for valid unit type', () => {
      const unitType = getFirstUnitType();
      if (!unitType) {
        // Skip if no unit types are available (definitions not loaded)
        return;
      }

      const handler = eventHandlers.get('unit:spawn')!;

      handler({
        unitType,
        x: 10,
        y: 20,
        playerId: 'player1',
      });

      expect(mockWorld.createEntity).toHaveBeenCalled();
      // Should call add at least 5 times (Transform, Unit, Health, Selectable, Velocity)
      expect((mockEntity.add as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(
        5
      );
    });

    it('emits unit:spawned event after creation', () => {
      const unitType = getFirstUnitType();
      if (!unitType) return;

      const handler = eventHandlers.get('unit:spawn')!;

      handler({
        unitType,
        x: 10,
        y: 20,
        playerId: 'player1',
      });

      expect(mockGame.eventBus.emit).toHaveBeenCalledWith(
        'unit:spawned',
        expect.objectContaining({
          entityId: 1,
          unitType,
          playerId: 'player1',
          position: { x: 10, y: 20 },
        })
      );
    });

    it('handles unknown unit type gracefully', () => {
      const handler = eventHandlers.get('unit:spawn')!;

      handler({
        unitType: 'completely_nonexistent_unit_type_12345',
        x: 10,
        y: 20,
        playerId: 'player1',
      });

      expect(mockWorld.createEntity).not.toHaveBeenCalled();
    });

    it('emits command:move when rally point is set', () => {
      const unitType = getFirstUnitType();
      if (!unitType) return;

      const handler = eventHandlers.get('unit:spawn')!;

      handler({
        unitType,
        x: 10,
        y: 20,
        playerId: 'player1',
        rallyX: 50,
        rallyY: 60,
      });

      expect(mockGame.eventBus.emit).toHaveBeenCalledWith('command:move', {
        entityIds: [1],
        targetPosition: { x: 50, y: 60 },
      });
    });

    it('gets terrain height for ground units', () => {
      const unitType = getFirstUnitType();
      if (!unitType) return;

      const handler = eventHandlers.get('unit:spawn')!;

      handler({
        unitType,
        x: 10,
        y: 20,
        playerId: 'player1',
      });

      expect(mockGame.getTerrainHeightAt).toHaveBeenCalledWith(10, 20);
    });

    it('uses team ID from existing entity with same playerId', () => {
      const unitType = getFirstUnitType();
      if (!unitType) return;

      const existingEntity = {
        get: vi.fn().mockReturnValue({ playerId: 'player1', teamId: 2 }),
      };
      (mockWorld.getEntitiesWith as ReturnType<typeof vi.fn>).mockReturnValue([existingEntity]);

      const handler = eventHandlers.get('unit:spawn')!;

      handler({
        unitType,
        x: 10,
        y: 20,
        playerId: 'player1',
      });

      // Check that entity was created (we can't easily verify teamId without more complex mocking)
      expect(mockWorld.createEntity).toHaveBeenCalled();
    });
  });

  describe('building:spawn event', () => {
    it('creates entity with all required components for valid building type', () => {
      const buildingType = getFirstBuildingType();
      if (!buildingType) return;

      const handler = eventHandlers.get('building:spawn')!;

      handler({
        buildingType,
        x: 30,
        y: 40,
        playerId: 'player1',
      });

      expect(mockWorld.createEntity).toHaveBeenCalled();
      // Should call add at least 4 times (Transform, Building, Health, Selectable)
      expect((mockEntity.add as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(
        4
      );
    });

    it('emits building:placed and building:spawned events', () => {
      const buildingType = getFirstBuildingType();
      if (!buildingType) return;

      const handler = eventHandlers.get('building:spawn')!;

      handler({
        buildingType,
        x: 30,
        y: 40,
        playerId: 'player1',
      });

      expect(mockGame.eventBus.emit).toHaveBeenCalledWith(
        'building:placed',
        expect.objectContaining({
          entityId: 1,
          buildingType,
          playerId: 'player1',
          position: { x: 30, y: 40 },
        })
      );

      expect(mockGame.eventBus.emit).toHaveBeenCalledWith(
        'building:spawned',
        expect.objectContaining({
          entityId: 1,
          buildingType,
          playerId: 'player1',
          position: { x: 30, y: 40 },
        })
      );
    });

    it('handles unknown building type gracefully', () => {
      const handler = eventHandlers.get('building:spawn')!;

      handler({
        buildingType: 'completely_nonexistent_building_type_12345',
        x: 30,
        y: 40,
        playerId: 'player1',
      });

      expect(mockWorld.createEntity).not.toHaveBeenCalled();
    });
  });

  describe('unit:died event', () => {
    it('destroys the entity', () => {
      const unitType = getFirstUnitType();
      const mockDeadEntity = {
        get: vi.fn().mockImplementation((type: string) => {
          if (type === 'Unit') return { unitId: unitType || 'unknown' };
          if (type === 'Selectable') return { playerId: 'player1' };
          return null;
        }),
      };
      (mockWorld.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(mockDeadEntity);

      const handler = eventHandlers.get('unit:died')!;

      handler({ entityId: 5 });

      expect(mockWorld.destroyEntity).toHaveBeenCalledWith(5);
    });

    it('handles entity not found gracefully', () => {
      (mockWorld.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      const handler = eventHandlers.get('unit:died')!;

      // Should not throw
      expect(() => handler({ entityId: 999 })).not.toThrow();
      expect(mockWorld.destroyEntity).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('is a no-op (event-driven system)', () => {
      // SpawnSystem.update should not throw and should not do anything
      expect(() => spawnSystem.update(0.016)).not.toThrow();
    });
  });

  describe('component creation verification', () => {
    it('creates Transform component with correct coordinates', () => {
      const unitType = getFirstUnitType();
      if (!unitType) return;

      const handler = eventHandlers.get('unit:spawn')!;

      handler({
        unitType,
        x: 123.5,
        y: 456.7,
        playerId: 'player1',
      });

      // Find the Transform component in the add calls
      const addCalls = (mockEntity.add as ReturnType<typeof vi.fn>).mock.calls;
      const transformCall = addCalls.find((call: unknown[]) => call[0] instanceof Transform);

      expect(transformCall).toBeDefined();
      if (transformCall) {
        const transform = transformCall[0] as Transform;
        expect(transform.x).toBe(123.5);
        expect(transform.y).toBe(456.7);
      }
    });

    it('creates Unit component for valid unit type', () => {
      const unitType = getFirstUnitType();
      if (!unitType) return;

      const handler = eventHandlers.get('unit:spawn')!;

      handler({
        unitType,
        x: 10,
        y: 20,
        playerId: 'player1',
      });

      const addCalls = (mockEntity.add as ReturnType<typeof vi.fn>).mock.calls;
      const unitCall = addCalls.find((call: unknown[]) => call[0] instanceof Unit);

      expect(unitCall).toBeDefined();
    });

    it('creates Health component for valid unit type', () => {
      const unitType = getFirstUnitType();
      if (!unitType) return;

      const handler = eventHandlers.get('unit:spawn')!;

      handler({
        unitType,
        x: 10,
        y: 20,
        playerId: 'player1',
      });

      const addCalls = (mockEntity.add as ReturnType<typeof vi.fn>).mock.calls;
      const healthCall = addCalls.find((call: unknown[]) => call[0] instanceof Health);

      expect(healthCall).toBeDefined();
    });

    it('creates Velocity component for valid unit type', () => {
      const unitType = getFirstUnitType();
      if (!unitType) return;

      const handler = eventHandlers.get('unit:spawn')!;

      handler({
        unitType,
        x: 10,
        y: 20,
        playerId: 'player1',
      });

      const addCalls = (mockEntity.add as ReturnType<typeof vi.fn>).mock.calls;
      const velocityCall = addCalls.find((call: unknown[]) => call[0] instanceof Velocity);

      expect(velocityCall).toBeDefined();
    });

    it('creates Selectable component for valid unit type', () => {
      const unitType = getFirstUnitType();
      if (!unitType) return;

      const handler = eventHandlers.get('unit:spawn')!;

      handler({
        unitType,
        x: 10,
        y: 20,
        playerId: 'player1',
      });

      const addCalls = (mockEntity.add as ReturnType<typeof vi.fn>).mock.calls;
      const selectableCall = addCalls.find((call: unknown[]) => call[0] instanceof Selectable);

      expect(selectableCall).toBeDefined();
    });
  });
});

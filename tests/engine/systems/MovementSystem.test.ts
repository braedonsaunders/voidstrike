import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MovementSystem } from '@/engine/systems/MovementSystem';
import type { Game } from '@/engine/core/Game';
import type { World } from '@/engine/ecs/World';
import type { Entity } from '@/engine/ecs/Entity';

// Create mock orchestrator instance that persists
const mockOrchestratorInstance = {
  setupEventListeners: vi.fn(),
  setWorld: vi.fn(),
  update: vi.fn(),
};

// Mock the MovementOrchestrator module
vi.mock('@/engine/systems/movement/MovementOrchestrator', () => {
  return {
    MovementOrchestrator: vi.fn().mockImplementation(function () {
      return mockOrchestratorInstance;
    }),
  };
});

// Import after mock is set up
import { MovementOrchestrator } from '@/engine/systems/movement/MovementOrchestrator';

describe('MovementSystem', () => {
  let mockGame: Game;
  let mockWorld: World;
  let mockEntities: Entity[];
  let movementSystem: MovementSystem;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock orchestrator
    mockOrchestratorInstance.setupEventListeners.mockClear();
    mockOrchestratorInstance.setWorld.mockClear();
    mockOrchestratorInstance.update.mockClear();

    mockEntities = [{ id: 1 } as Entity, { id: 2 } as Entity, { id: 3 } as Entity];

    mockWorld = {
      getEntitiesWith: vi.fn().mockReturnValue(mockEntities),
    } as unknown as World;

    mockGame = {
      world: mockWorld,
      eventBus: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      },
    } as unknown as Game;

    movementSystem = new MovementSystem(mockGame);
  });

  describe('constructor', () => {
    it('creates a MovementOrchestrator instance', () => {
      expect(MovementOrchestrator).toHaveBeenCalledWith(mockGame, mockWorld);
    });

    it('sets up event listeners on the orchestrator', () => {
      expect(mockOrchestratorInstance.setupEventListeners).toHaveBeenCalled();
    });

    it('has the correct system name', () => {
      expect(movementSystem.name).toBe('MovementSystem');
    });
  });

  describe('init', () => {
    it('calls setWorld on the orchestrator with the new world', () => {
      const newWorld = { id: 'new-world' } as unknown as World;

      movementSystem.init(newWorld);

      expect(mockOrchestratorInstance.setWorld).toHaveBeenCalledWith(newWorld);
    });
  });

  describe('update', () => {
    it('queries entities with Transform, Unit, and Velocity components', () => {
      movementSystem.init(mockWorld);
      movementSystem.update(0.016);

      expect(mockWorld.getEntitiesWith).toHaveBeenCalledWith('Transform', 'Unit', 'Velocity');
    });

    it('delegates update to the orchestrator with deltaTime and entities', () => {
      movementSystem.init(mockWorld);
      const deltaTime = 0.016;

      movementSystem.update(deltaTime);

      expect(mockOrchestratorInstance.update).toHaveBeenCalledWith(deltaTime, mockEntities);
    });

    it('passes different deltaTime values correctly', () => {
      movementSystem.init(mockWorld);

      movementSystem.update(0.033);

      expect(mockOrchestratorInstance.update).toHaveBeenCalledWith(0.033, mockEntities);
    });

    it('passes empty entity array when no entities match', () => {
      (mockWorld.getEntitiesWith as ReturnType<typeof vi.fn>).mockReturnValue([]);
      movementSystem.init(mockWorld);

      movementSystem.update(0.016);

      expect(mockOrchestratorInstance.update).toHaveBeenCalledWith(0.016, []);
    });

    it('passes large entity arrays correctly', () => {
      const largeEntityArray = Array.from({ length: 500 }, (_, i) => ({ id: i }) as Entity);
      (mockWorld.getEntitiesWith as ReturnType<typeof vi.fn>).mockReturnValue(largeEntityArray);
      movementSystem.init(mockWorld);

      movementSystem.update(0.016);

      expect(mockOrchestratorInstance.update).toHaveBeenCalledWith(0.016, largeEntityArray);
    });
  });

  describe('system integration', () => {
    it('updates orchestrator with new world reference after re-initialization', () => {
      const world1 = { id: 'world1' } as unknown as World;
      const world2 = { id: 'world2' } as unknown as World;

      movementSystem.init(world1);
      movementSystem.init(world2);

      expect(mockOrchestratorInstance.setWorld).toHaveBeenCalledTimes(2);
      expect(mockOrchestratorInstance.setWorld).toHaveBeenLastCalledWith(world2);
    });
  });
});

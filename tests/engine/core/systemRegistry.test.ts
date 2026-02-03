import { describe, it, expect, beforeEach } from 'vitest';
import { SystemRegistry, SystemDefinition } from '@/engine/core/SystemRegistry';
import { System } from '@/engine/ecs/System';
import type { IGameInstance } from '@/engine/core/IGameInstance';

// Mock system class for testing
class MockSystem extends System {
  public readonly name: string;

  constructor(game: IGameInstance, name: string) {
    super(game);
    this.name = name;
  }

  update(_deltaTime: number): void {
    // No-op
  }
}

// Helper to create system definitions
function createDef(
  name: string,
  dependencies: string[] = [],
  condition?: (game: IGameInstance) => boolean
): SystemDefinition {
  return {
    name,
    dependencies,
    factory: (game: IGameInstance) => new MockSystem(game, name),
    condition,
  };
}

describe('SystemRegistry', () => {
  let registry: SystemRegistry;

  beforeEach(() => {
    registry = new SystemRegistry();
  });

  describe('register', () => {
    it('registers a system definition', () => {
      registry.register(createDef('TestSystem'));

      expect(registry.getSystemNames()).toContain('TestSystem');
    });

    it('throws on duplicate registration', () => {
      registry.register(createDef('TestSystem'));

      expect(() => registry.register(createDef('TestSystem'))).toThrow(
        'System "TestSystem" is already registered'
      );
    });
  });

  describe('registerAll', () => {
    it('registers multiple definitions', () => {
      registry.registerAll([createDef('SystemA'), createDef('SystemB'), createDef('SystemC')]);

      const names = registry.getSystemNames();
      expect(names).toContain('SystemA');
      expect(names).toContain('SystemB');
      expect(names).toContain('SystemC');
    });
  });

  describe('validate', () => {
    it('returns empty array for valid definitions', () => {
      registry.registerAll([createDef('SystemA'), createDef('SystemB', ['SystemA'])]);

      const errors = registry.validate();

      expect(errors).toEqual([]);
    });

    it('detects missing dependencies', () => {
      registry.register(createDef('SystemA', ['NonExistent']));

      const errors = registry.validate();

      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('NonExistent');
      expect(errors[0]).toContain('unknown system');
    });

    it('detects circular dependencies', () => {
      registry.registerAll([createDef('SystemA', ['SystemB']), createDef('SystemB', ['SystemA'])]);

      const errors = registry.validate();

      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('Circular dependency');
    });

    it('detects complex circular dependencies', () => {
      registry.registerAll([
        createDef('SystemA', ['SystemC']),
        createDef('SystemB', ['SystemA']),
        createDef('SystemC', ['SystemB']),
      ]);

      const errors = registry.validate();

      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('Circular dependency');
    });
  });

  describe('getExecutionOrder', () => {
    it('returns systems with no dependencies first', () => {
      registry.registerAll([createDef('SystemB', ['SystemA']), createDef('SystemA')]);

      const order = registry.getExecutionOrder();

      expect(order.indexOf('SystemA')).toBeLessThan(order.indexOf('SystemB'));
    });

    it('handles complex dependency chains', () => {
      registry.registerAll([
        createDef('SystemD', ['SystemC']),
        createDef('SystemC', ['SystemB']),
        createDef('SystemB', ['SystemA']),
        createDef('SystemA'),
      ]);

      const order = registry.getExecutionOrder();

      expect(order).toEqual(['SystemA', 'SystemB', 'SystemC', 'SystemD']);
    });

    it('handles multiple independent chains', () => {
      registry.registerAll([
        createDef('ChainA1'),
        createDef('ChainA2', ['ChainA1']),
        createDef('ChainB1'),
        createDef('ChainB2', ['ChainB1']),
      ]);

      const order = registry.getExecutionOrder();

      // ChainA1 before ChainA2, ChainB1 before ChainB2
      expect(order.indexOf('ChainA1')).toBeLessThan(order.indexOf('ChainA2'));
      expect(order.indexOf('ChainB1')).toBeLessThan(order.indexOf('ChainB2'));
    });

    it('handles diamond dependencies', () => {
      // A -> B, A -> C, B -> D, C -> D (diamond shape)
      registry.registerAll([
        createDef('SystemA'),
        createDef('SystemB', ['SystemA']),
        createDef('SystemC', ['SystemA']),
        createDef('SystemD', ['SystemB', 'SystemC']),
      ]);

      const order = registry.getExecutionOrder();

      // A must be first, D must be last
      expect(order[0]).toBe('SystemA');
      expect(order[order.length - 1]).toBe('SystemD');
      // B and C must be before D
      expect(order.indexOf('SystemB')).toBeLessThan(order.indexOf('SystemD'));
      expect(order.indexOf('SystemC')).toBeLessThan(order.indexOf('SystemD'));
    });

    it('produces deterministic order for systems at same level', () => {
      // Multiple systems with no dependencies should be sorted alphabetically
      registry.registerAll([createDef('Zebra'), createDef('Alpha'), createDef('Middle')]);

      const order1 = registry.getExecutionOrder();
      const order2 = registry.getExecutionOrder();

      expect(order1).toEqual(order2);
      expect(order1).toEqual(['Alpha', 'Middle', 'Zebra']);
    });

    it('throws on circular dependency', () => {
      registry.registerAll([createDef('SystemA', ['SystemB']), createDef('SystemB', ['SystemA'])]);

      expect(() => registry.getExecutionOrder()).toThrow('Circular dependency');
    });
  });

  describe('createSystems', () => {
    it('creates systems in dependency order', () => {
      registry.registerAll([
        createDef('SystemC', ['SystemB']),
        createDef('SystemB', ['SystemA']),
        createDef('SystemA'),
      ]);

      // Mock game
      const mockGame = {} as IGameInstance;
      const systems = registry.createSystems(mockGame);

      expect(systems.length).toBe(3);
      expect(systems[0].name).toBe('SystemA');
      expect(systems[1].name).toBe('SystemB');
      expect(systems[2].name).toBe('SystemC');
    });

    it('assigns priorities based on order', () => {
      registry.registerAll([
        createDef('SystemA'),
        createDef('SystemB', ['SystemA']),
        createDef('SystemC', ['SystemB']),
      ]);

      const mockGame = {} as IGameInstance;
      const systems = registry.createSystems(mockGame);

      expect(systems[0].priority).toBe(0);
      expect(systems[1].priority).toBe(10);
      expect(systems[2].priority).toBe(20);
    });

    it('respects condition function', () => {
      registry.registerAll([
        createDef('AlwaysSystem'),
        createDef('ConditionalSystem', [], () => false),
        createDef('AnotherSystem'),
      ]);

      const mockGame = {} as IGameInstance;
      const systems = registry.createSystems(mockGame);

      expect(systems.length).toBe(2);
      expect(systems.map((s) => s.name)).not.toContain('ConditionalSystem');
    });

    it('throws on name mismatch between definition and system', () => {
      const badDef: SystemDefinition = {
        name: 'DefinedName',
        dependencies: [],
        factory: (game: IGameInstance) => new MockSystem(game, 'DifferentName'),
      };

      registry.register(badDef);
      const mockGame = {} as IGameInstance;

      expect(() => registry.createSystems(mockGame)).toThrow('System name mismatch');
    });

    it('throws on validation errors', () => {
      registry.register(createDef('SystemA', ['NonExistent']));

      const mockGame = {} as IGameInstance;

      expect(() => registry.createSystems(mockGame)).toThrow('System dependency errors');
    });
  });

  describe('getDefinition', () => {
    it('returns registered definition', () => {
      const def = createDef('TestSystem', ['Dep1', 'Dep2']);
      registry.register(def);

      const retrieved = registry.getDefinition('TestSystem');

      expect(retrieved).toBe(def);
    });

    it('returns undefined for unknown system', () => {
      const result = registry.getDefinition('NonExistent');

      expect(result).toBeUndefined();
    });
  });

  describe('getSystemNames', () => {
    it('returns all registered names', () => {
      registry.registerAll([createDef('SystemA'), createDef('SystemB'), createDef('SystemC')]);

      const names = registry.getSystemNames();

      expect(names.length).toBe(3);
      expect(names).toContain('SystemA');
      expect(names).toContain('SystemB');
      expect(names).toContain('SystemC');
    });

    it('returns empty array when no systems registered', () => {
      expect(registry.getSystemNames()).toEqual([]);
    });
  });

  describe('clear', () => {
    it('removes all registered definitions', () => {
      registry.registerAll([createDef('SystemA'), createDef('SystemB')]);

      registry.clear();

      expect(registry.getSystemNames()).toEqual([]);
    });
  });
});

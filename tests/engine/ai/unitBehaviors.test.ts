import { describe, it, expect, vi } from 'vitest';
import {
  createBehaviorTree,
  createCombatMicroTree,
  createRangedCombatTree,
  createMeleeCombatTree,
  createDefensiveCombatTree,
  createFocusFireTree,
  createUtilityCombatTree,
  createPatrolTree,
  createWorkerGatheringTree,
  isRangedUnit,
  isMeleeUnit,
  isLowHealth,
  hasEnemiesNearby,
  hasTarget,
  hasMeleeThreatClose,
  acquireTarget,
  attackTarget,
  moveToAttackRange,
  kiteFromMelee,
  stop,
  type UnitBehaviorType,
} from '@/engine/ai/UnitBehaviors';
import { Blackboard, BehaviorContext, BehaviorTreeRunner } from '@/engine/ai/BehaviorTree';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { SpatialGrid, SpatialUnitState } from '@/engine/core/SpatialGrid';
import type { World } from '@/engine/ecs/World';
import type { Game } from '@/engine/core/Game';

// Helper to create mock entity
function createMockEntity(
  overrides: {
    id?: number;
    transform?: Partial<Transform>;
    unit?: Partial<Unit>;
    health?: Partial<Health>;
    selectable?: Partial<Selectable>;
  } = {}
) {
  const id = overrides.id ?? 1;

  const mockTransform = {
    x: overrides.transform?.x ?? 50,
    y: overrides.transform?.y ?? 50,
    z: overrides.transform?.z ?? 0,
  } as Transform;

  const mockUnit = {
    unitId: 'marine',
    attackRange: overrides.unit?.attackRange ?? 5,
    attackDamage: overrides.unit?.attackDamage ?? 10,
    sightRange: overrides.unit?.sightRange ?? 10,
    canAttackAir: overrides.unit?.canAttackAir ?? true,
    canAttackGround: overrides.unit?.canAttackGround ?? true,
    collisionRadius: overrides.unit?.collisionRadius ?? 0.5,
    isFlying: overrides.unit?.isFlying ?? false,
    state: overrides.unit?.state ?? 'idle',
    targetEntityId: overrides.unit?.targetEntityId ?? null,
    targetX: overrides.unit?.targetX ?? null,
    targetY: overrides.unit?.targetY ?? null,
    path: [],
    pathIndex: 0,
    patrolPoints: overrides.unit?.patrolPoints ?? [],
    patrolIndex: 0,
    nextPatrolPoint: vi.fn(),
    ...overrides.unit,
  } as unknown as Unit;

  const mockHealth = {
    current: overrides.health?.current ?? 100,
    max: overrides.health?.max ?? 100,
    armor: overrides.health?.armor ?? 0,
    getHealthPercent: vi
      .fn()
      .mockReturnValue((overrides.health?.current ?? 100) / (overrides.health?.max ?? 100)),
    isDead: vi.fn().mockReturnValue(false),
    ...overrides.health,
  } as unknown as Health;

  const mockSelectable = {
    playerId: overrides.selectable?.playerId ?? 'player1',
    teamId: overrides.selectable?.teamId ?? 1,
    ...overrides.selectable,
  } as unknown as Selectable;

  const entity = {
    id,
    get: vi.fn((type: string) => {
      switch (type) {
        case 'Transform':
          return mockTransform;
        case 'Unit':
          return mockUnit;
        case 'Health':
          return mockHealth;
        case 'Selectable':
          return mockSelectable;
        default:
          return null;
      }
    }),
  };

  return { entity, mockTransform, mockUnit, mockHealth, mockSelectable };
}

// Helper to create mock context
function createMockContext(overrides: Partial<BehaviorContext> = {}): BehaviorContext {
  const mockUnitGrid = new SpatialGrid(100, 100, 8);
  const mockBuildingGrid = new SpatialGrid(100, 100, 8);

  const mockWorld = {
    getEntity: vi.fn(),
    getEntitiesWith: vi.fn().mockReturnValue([]),
    unitGrid: mockUnitGrid,
    buildingGrid: mockBuildingGrid,
  } as unknown as World;

  const mockGame = {
    getCurrentTick: vi.fn().mockReturnValue(0),
    eventBus: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    },
    config: {
      mapWidth: 100,
      mapHeight: 100,
    },
  } as unknown as Game;

  return {
    entityId: 1,
    world: mockWorld,
    game: mockGame,
    blackboard: new Blackboard(),
    deltaTime: 0.016,
    tick: 0,
    ...overrides,
  };
}

describe('UnitBehaviors', () => {
  describe('behavior tree factory', () => {
    it.each<UnitBehaviorType>([
      'combat',
      'ranged_combat',
      'melee_combat',
      'defensive',
      'focus_fire',
      'utility',
      'patrol',
      'worker',
    ])('creates %s behavior tree successfully', (type) => {
      const tree = createBehaviorTree(type);
      expect(tree).toBeDefined();
      expect(typeof tree).toBe('function');
    });

    it('creates combat tree with correct structure', () => {
      const tree = createCombatMicroTree();
      expect(tree).toBeDefined();
    });

    it('creates ranged combat tree with correct structure', () => {
      const tree = createRangedCombatTree();
      expect(tree).toBeDefined();
    });

    it('creates melee combat tree with correct structure', () => {
      const tree = createMeleeCombatTree();
      expect(tree).toBeDefined();
    });

    it('creates defensive combat tree with correct structure', () => {
      const tree = createDefensiveCombatTree();
      expect(tree).toBeDefined();
    });

    it('creates focus fire tree with correct structure', () => {
      const tree = createFocusFireTree();
      expect(tree).toBeDefined();
    });

    it('creates utility combat tree with correct structure', () => {
      const tree = createUtilityCombatTree();
      expect(tree).toBeDefined();
    });

    it('creates patrol tree with correct structure', () => {
      const tree = createPatrolTree();
      expect(tree).toBeDefined();
    });

    it('creates worker gathering tree with correct structure', () => {
      const tree = createWorkerGatheringTree();
      expect(tree).toBeDefined();
    });

    it('returns combat tree for unknown type', () => {
      const tree = createBehaviorTree('unknown' as UnitBehaviorType);
      expect(tree).toBeDefined();
    });
  });

  describe('condition functions', () => {
    describe('isRangedUnit', () => {
      it('returns true for units with attackRange >= 3', () => {
        const { entity } = createMockEntity({ unit: { attackRange: 5 } });
        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

        expect(isRangedUnit(ctx)).toBe(true);
      });

      it('returns false for units with attackRange < 3', () => {
        const { entity } = createMockEntity({ unit: { attackRange: 2 } });
        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

        expect(isRangedUnit(ctx)).toBe(false);
      });

      it('returns false when entity not found', () => {
        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(null);

        expect(isRangedUnit(ctx)).toBe(false);
      });
    });

    describe('isMeleeUnit', () => {
      it('returns true for units with attackRange < 3', () => {
        const { entity } = createMockEntity({ unit: { attackRange: 1 } });
        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

        expect(isMeleeUnit(ctx)).toBe(true);
      });

      it('returns false for units with attackRange >= 3', () => {
        const { entity } = createMockEntity({ unit: { attackRange: 5 } });
        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

        expect(isMeleeUnit(ctx)).toBe(false);
      });
    });

    describe('isLowHealth', () => {
      it('returns true when health below threshold', () => {
        const { entity, mockHealth } = createMockEntity({ health: { current: 20, max: 100 } });
        mockHealth.getHealthPercent.mockReturnValue(0.2);
        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

        expect(isLowHealth(ctx, 0.3)).toBe(true);
      });

      it('returns false when health above threshold', () => {
        const { entity, mockHealth } = createMockEntity({ health: { current: 80, max: 100 } });
        mockHealth.getHealthPercent.mockReturnValue(0.8);
        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

        expect(isLowHealth(ctx, 0.3)).toBe(false);
      });

      it('uses default threshold of 0.3', () => {
        const { entity, mockHealth } = createMockEntity({ health: { current: 25, max: 100 } });
        mockHealth.getHealthPercent.mockReturnValue(0.25);
        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

        expect(isLowHealth(ctx)).toBe(true);
      });
    });

    describe('hasTarget', () => {
      it('returns true when unit has valid target', () => {
        const { entity: targetEntity } = createMockEntity({ id: 2 });
        const { entity } = createMockEntity({ unit: { targetEntityId: 2 } });

        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockImplementation((id: number) => {
          if (id === 1) return entity;
          if (id === 2) return targetEntity;
          return null;
        });

        expect(hasTarget(ctx)).toBe(true);
      });

      it('returns false when target is dead', () => {
        const { entity: targetEntity, mockHealth: targetHealth } = createMockEntity({ id: 2 });
        targetHealth.isDead.mockReturnValue(true);
        const { entity } = createMockEntity({ unit: { targetEntityId: 2 } });

        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockImplementation((id: number) => {
          if (id === 1) return entity;
          if (id === 2) return targetEntity;
          return null;
        });

        expect(hasTarget(ctx)).toBe(false);
      });

      it('returns false when no target set', () => {
        const { entity } = createMockEntity({ unit: { targetEntityId: null } });
        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

        expect(hasTarget(ctx)).toBe(false);
      });
    });

    describe('hasEnemiesNearby', () => {
      it('returns true when enemies in range', () => {
        const { entity } = createMockEntity();
        const ctx = createMockContext();

        // Add enemy to spatial grid
        ctx.world.unitGrid.updateFull(2, 55, 55, 1, false, SpatialUnitState.Idle, 2, 1, false, 3);

        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockImplementation((id: number) => {
          if (id === 1) return entity;
          if (id === 2) {
            return createMockEntity({
              id: 2,
              transform: { x: 55, y: 55 },
              selectable: { playerId: 'player2' },
            }).entity;
          }
          return null;
        });

        expect(hasEnemiesNearby(ctx)).toBe(true);
      });

      it('returns false when no enemies in range', () => {
        const { entity } = createMockEntity();
        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

        expect(hasEnemiesNearby(ctx)).toBe(false);
      });
    });
  });

  describe('action nodes', () => {
    describe('stop', () => {
      it('clears unit movement state', () => {
        const { entity, mockUnit } = createMockEntity({
          unit: {
            targetX: 100,
            targetY: 100,
            targetEntityId: 5,
            state: 'moving',
          },
        });

        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

        const result = stop(ctx);

        expect(result).toBe('success');
        expect(mockUnit.targetX).toBeNull();
        expect(mockUnit.targetY).toBeNull();
        expect(mockUnit.targetEntityId).toBeNull();
        expect(mockUnit.state).toBe('idle');
      });

      it('returns failure when entity not found', () => {
        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(null);

        const result = stop(ctx);

        expect(result).toBe('failure');
      });
    });

    describe('acquireTarget', () => {
      it('returns failure when no targets available', () => {
        const { entity } = createMockEntity();
        const ctx = createMockContext();
        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

        const result = acquireTarget(ctx);

        expect(result).toBe('failure');
      });
    });

    describe('attackTarget', () => {
      it('sets unit to attacking state with valid target', () => {
        const { entity: targetEntity } = createMockEntity({ id: 2 });
        const { entity, mockUnit } = createMockEntity();

        const ctx = createMockContext();
        ctx.blackboard.set('targetId', 2);

        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockImplementation((id: number) => {
          if (id === 1) return entity;
          if (id === 2) return targetEntity;
          return null;
        });

        const result = attackTarget(ctx);

        expect(result).toBe('success');
        expect(mockUnit.targetEntityId).toBe(2);
        expect(mockUnit.state).toBe('attacking');
      });

      it('returns failure when target not found', () => {
        const { entity, mockUnit } = createMockEntity({ unit: { targetEntityId: null } });
        mockUnit.targetEntityId = null; // Ensure no target set
        const ctx = createMockContext();
        ctx.blackboard.set('targetId', 999);

        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockImplementation((id: number) => {
          if (id === 1) return entity;
          if (id === 999) return null; // Target not found
          return null;
        });

        const result = attackTarget(ctx);

        expect(result).toBe('failure');
      });
    });

    describe('moveToAttackRange', () => {
      it('returns success when already in range', () => {
        const { entity: targetEntity } = createMockEntity({
          id: 2,
          transform: { x: 52, y: 50 }, // 2 units away
        });
        const { entity } = createMockEntity({
          unit: { attackRange: 5 },
          transform: { x: 50, y: 50 },
        });

        const ctx = createMockContext();
        ctx.blackboard.set('targetId', 2);

        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockImplementation((id: number) => {
          if (id === 1) return entity;
          if (id === 2) return targetEntity;
          return null;
        });

        const result = moveToAttackRange(ctx);

        expect(result).toBe('success');
      });

      it('returns running when moving toward target', () => {
        const { entity: targetEntity } = createMockEntity({
          id: 2,
          transform: { x: 100, y: 50 }, // 50 units away
        });
        const { entity, mockUnit } = createMockEntity({
          unit: { attackRange: 5 },
          transform: { x: 50, y: 50 },
        });

        const ctx = createMockContext();
        ctx.blackboard.set('targetId', 2);

        (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockImplementation((id: number) => {
          if (id === 1) return entity;
          if (id === 2) return targetEntity;
          return null;
        });

        const result = moveToAttackRange(ctx);

        expect(result).toBe('running');
        expect(mockUnit.targetX).not.toBeNull();
        expect(mockUnit.targetY).not.toBeNull();
        expect(mockUnit.state).toBe('moving');
      });
    });
  });

  describe('BehaviorTreeRunner integration', () => {
    it('runs combat tree without errors', () => {
      const { entity } = createMockEntity();
      const ctx = createMockContext();
      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

      const tree = createCombatMicroTree();
      const runner = new BehaviorTreeRunner(tree);

      // Should not throw
      expect(() => {
        runner.tick(1, ctx.world, ctx.game, 0.016);
      }).not.toThrow();
    });

    it('runs ranged combat tree without errors', () => {
      const { entity } = createMockEntity({ unit: { attackRange: 6 } });
      const ctx = createMockContext();
      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

      const tree = createRangedCombatTree();
      const runner = new BehaviorTreeRunner(tree);

      expect(() => {
        runner.tick(1, ctx.world, ctx.game, 0.016);
      }).not.toThrow();
    });

    it('runs melee combat tree without errors', () => {
      const { entity } = createMockEntity({ unit: { attackRange: 1 } });
      const ctx = createMockContext();
      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

      const tree = createMeleeCombatTree();
      const runner = new BehaviorTreeRunner(tree);

      expect(() => {
        runner.tick(1, ctx.world, ctx.game, 0.016);
      }).not.toThrow();
    });

    it('runs defensive tree without errors', () => {
      const { entity } = createMockEntity();
      const ctx = createMockContext();
      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

      const tree = createDefensiveCombatTree();
      const runner = new BehaviorTreeRunner(tree);

      expect(() => {
        runner.tick(1, ctx.world, ctx.game, 0.016);
      }).not.toThrow();
    });

    it('runs utility tree without errors', () => {
      const { entity } = createMockEntity();
      const ctx = createMockContext();
      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

      const tree = createUtilityCombatTree();
      const runner = new BehaviorTreeRunner(tree);

      expect(() => {
        runner.tick(1, ctx.world, ctx.game, 0.016);
      }).not.toThrow();
    });

    it('runs patrol tree without errors', () => {
      const { entity } = createMockEntity({
        unit: {
          patrolPoints: [
            { x: 10, y: 10 },
            { x: 90, y: 90 },
          ],
        },
      });
      const ctx = createMockContext();
      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

      const tree = createPatrolTree();
      const runner = new BehaviorTreeRunner(tree);

      expect(() => {
        runner.tick(1, ctx.world, ctx.game, 0.016);
      }).not.toThrow();
    });

    it('runs worker tree without errors', () => {
      const { entity } = createMockEntity();
      const ctx = createMockContext();
      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

      const tree = createWorkerGatheringTree();
      const runner = new BehaviorTreeRunner(tree);

      expect(() => {
        runner.tick(1, ctx.world, ctx.game, 0.016);
      }).not.toThrow();
    });
  });

  describe('behavior tree state persistence', () => {
    it('maintains blackboard state across ticks', () => {
      const { entity } = createMockEntity();
      const ctx = createMockContext();
      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

      const tree = createCombatMicroTree();
      const runner = new BehaviorTreeRunner(tree);

      runner.set('customValue', 42);
      runner.tick(1, ctx.world, ctx.game, 0.016);

      expect(runner.get('customValue')).toBe(42);
    });

    it('clears blackboard on reset', () => {
      const tree = createCombatMicroTree();
      const runner = new BehaviorTreeRunner(tree);

      runner.set('key1', 'value1');
      runner.set('key2', 'value2');

      runner.clear();

      expect(runner.get('key1')).toBeUndefined();
      expect(runner.get('key2')).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('handles missing entity gracefully', () => {
      const ctx = createMockContext();
      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(null);

      expect(isRangedUnit(ctx)).toBe(false);
      expect(isMeleeUnit(ctx)).toBe(false);
      expect(isLowHealth(ctx)).toBe(false);
      expect(hasTarget(ctx)).toBe(false);
    });

    it('handles entity with missing components', () => {
      const entity = {
        id: 1,
        get: vi.fn().mockReturnValue(null),
      };

      const ctx = createMockContext();
      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

      expect(isRangedUnit(ctx)).toBe(false);
      expect(stop(ctx)).toBe('failure');
    });

    it('handles empty spatial grid', () => {
      const { entity } = createMockEntity();
      const ctx = createMockContext();
      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

      expect(hasEnemiesNearby(ctx)).toBe(false);
      expect(hasMeleeThreatClose(ctx)).toBe(false);
    });
  });

  describe('combat scenarios', () => {
    it('ranged unit kites from melee threat', () => {
      // Setup ranged unit
      const { entity, mockUnit } = createMockEntity({
        unit: { attackRange: 6 },
        transform: { x: 50, y: 50 },
      });

      // Setup melee enemy in close range
      const { entity: enemyEntity } = createMockEntity({
        id: 2,
        unit: { attackRange: 1 },
        transform: { x: 52, y: 50 },
        selectable: { playerId: 'player2' },
      });

      const ctx = createMockContext();

      // Add enemy to spatial grid
      ctx.world.unitGrid.updateFull(
        2,
        52,
        50,
        1,
        false,
        SpatialUnitState.Attacking,
        2,
        1,
        false,
        3
      );

      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockImplementation((id: number) => {
        if (id === 1) return entity;
        if (id === 2) return enemyEntity;
        return null;
      });

      // Should detect melee threat
      expect(hasMeleeThreatClose(ctx)).toBe(true);

      // Kite should set new target position
      const result = kiteFromMelee(ctx);
      expect(result).toBe('success');
      expect(mockUnit.targetX).not.toBeNull();
      expect(mockUnit.targetY).not.toBeNull();
    });

    it('defensive unit only attacks targets in range', () => {
      const { entity } = createMockEntity({
        unit: { attackRange: 5 },
        transform: { x: 50, y: 50 },
      });

      const ctx = createMockContext();
      (ctx.world.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(entity);

      const tree = createDefensiveCombatTree();
      const result = tree(ctx);

      // Should succeed with stop action (no targets in range)
      expect(result).toBe('success');
    });
  });
});

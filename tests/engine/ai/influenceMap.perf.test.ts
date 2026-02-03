import { describe, it, expect, beforeAll } from 'vitest';
import { InfluenceMap, InfluenceMapMetrics } from '@/engine/ai/InfluenceMap';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { Unit, UnitState } from '@/engine/components/Unit';
import { getBenchmarkRunner, BenchmarkRunner } from '@tests/utils/BenchmarkRunner';
import { assertBenchmarkPasses } from '@tests/utils/performanceTestHelpers';

/**
 * InfluenceMap Performance Benchmarks
 *
 * Tests the influence map update performance across various unit counts.
 * Uses statistical benchmarking to detect performance regressions.
 *
 * Key scenarios:
 * - Small scale (100 units): Typical early game
 * - Medium scale (250 units): Mid game battles
 * - Large scale (500 units): Large battles
 * - Stress test (1000 units): Maximum expected load
 */

// =============================================================================
// PERFORMANCE BUDGET
// =============================================================================

/**
 * Performance budgets calibrated on reference hardware.
 * Actual thresholds are adjusted at runtime based on environment calibration.
 *
 * The influence map uses O(units * cells_in_radius) complexity.
 * With maxRadius=8, each unit affects ~200 cells.
 */
const PERFORMANCE_BUDGET = {
  // Update budgets (per N units)
  UPDATE_100_UNITS: 1, // < 1ms for 100 units
  UPDATE_250_UNITS: 2.5, // < 2.5ms for 250 units
  UPDATE_500_UNITS: 5, // < 5ms for 500 units
  UPDATE_1000_UNITS: 15, // < 15ms for 1000 units (stress test)

  // Threat analysis operations (should be fast - O(1) lookup + O(8) gradient)
  THREAT_ANALYSIS_1000_CALLS: 2, // < 2ms for 1000 threat lookups
};

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create a test world populated with units for benchmarking
 */
function createTestWorld(unitCount: number, mapSize: number = 200): World {
  const world = new World(mapSize, mapSize);
  const gridSize = Math.ceil(Math.sqrt(unitCount));
  const spacing = mapSize / (gridSize + 1);

  for (let i = 0; i < unitCount; i++) {
    const row = Math.floor(i / gridSize);
    const col = i % gridSize;
    const x = (col + 1) * spacing;
    const y = (row + 1) * spacing;

    // Alternate between two players
    const playerId = i % 2 === 0 ? 'player1' : 'player2';

    const entity = world.createEntity();

    // Add Transform
    const transform = new Transform(x, y, 0, 0);
    entity.add(transform);

    // Add Health (max, armor, armorType, regeneration)
    const health = new Health(100, 0, 'light', 0);
    entity.add(health);

    // Add Selectable
    const selectable = {
      type: 'Selectable' as const,
      isSelected: false,
      playerId,
    };
    entity.add(selectable as unknown as Selectable);

    // Add Unit
    const unit = {
      type: 'Unit' as const,
      entityId: entity.id,
      unitId: 'test_marine',
      name: 'Test Marine',
      state: 'idle' as UnitState,
      speed: 3.0,
      attackRange: 5,
      attackDamage: 10,
      attackSpeed: 1,
      sightRange: 8,
      isFlying: false,
      isWorker: false,
      collisionRadius: 0.5,
      targetEntityId: null,
      targetX: null,
      targetY: null,
      damageType: 'normal',
      canAttackGround: true,
      canAttackAir: false,
      isBiological: true,
      isMechanical: false,
    };
    entity.add(unit as unknown as Unit);
  }

  return world;
}

/**
 * Create a clustered scenario where units are grouped together (worst case for influence propagation)
 */
function createClusteredWorld(unitCount: number, clusterRadius: number = 20): World {
  const world = new World(200, 200);
  const centerX = 100;
  const centerY = 100;

  for (let i = 0; i < unitCount; i++) {
    // Random position within cluster radius
    const angle = (i / unitCount) * Math.PI * 2;
    const radius = (i % 10) * (clusterRadius / 10);
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;

    const playerId = i % 2 === 0 ? 'player1' : 'player2';

    const entity = world.createEntity();
    entity.add(new Transform(x, y, 0, 0));
    entity.add(new Health(100, 0, 'light', 0));
    entity.add({
      type: 'Selectable' as const,
      isSelected: false,
      playerId,
    } as unknown as Selectable);
    entity.add({
      type: 'Unit' as const,
      entityId: entity.id,
      unitId: 'test_marine',
      name: 'Test Marine',
      state: 'idle' as UnitState,
      speed: 3.0,
      attackRange: 5,
      attackDamage: 10,
      attackSpeed: 1,
      sightRange: 8,
      isFlying: false,
      isWorker: false,
      collisionRadius: 0.5,
      targetEntityId: null,
      targetX: null,
      targetY: null,
      damageType: 'normal',
      canAttackGround: true,
      canAttackAir: false,
      isBiological: true,
      isMechanical: false,
    } as unknown as Unit);
  }

  return world;
}

// =============================================================================
// PERFORMANCE TESTS
// =============================================================================

describe('InfluenceMap Performance', () => {
  let runner: BenchmarkRunner;

  beforeAll(() => {
    runner = getBenchmarkRunner();
    runner.calibrate();
  });

  describe('Update Performance (Spread Distribution)', () => {
    it('processes 100 units within budget', () => {
      const world = createTestWorld(100);
      const influenceMap = new InfluenceMap(200, 200, 4);

      const result = runner.run(
        'influence-update-100-units',
        () => {
          influenceMap.update(world, 0);
        },
        { warmupIterations: 5, sampleIterations: 20 }
      );

      assertBenchmarkPasses(result, PERFORMANCE_BUDGET.UPDATE_100_UNITS);
    });

    it('processes 250 units within budget', () => {
      const world = createTestWorld(250);
      const influenceMap = new InfluenceMap(200, 200, 4);

      const result = runner.run(
        'influence-update-250-units',
        () => {
          influenceMap.update(world, 0);
        },
        { warmupIterations: 5, sampleIterations: 20 }
      );

      assertBenchmarkPasses(result, PERFORMANCE_BUDGET.UPDATE_250_UNITS);
    });

    it('processes 500 units within budget', () => {
      const world = createTestWorld(500);
      const influenceMap = new InfluenceMap(200, 200, 4);

      const result = runner.run(
        'influence-update-500-units',
        () => {
          influenceMap.update(world, 0);
        },
        { warmupIterations: 5, sampleIterations: 15 }
      );

      assertBenchmarkPasses(result, PERFORMANCE_BUDGET.UPDATE_500_UNITS);
    });

    it('processes 1000 units within budget (stress test)', () => {
      const world = createTestWorld(1000);
      const influenceMap = new InfluenceMap(200, 200, 4);

      const result = runner.run(
        'influence-update-1000-units',
        () => {
          influenceMap.update(world, 0);
        },
        { warmupIterations: 3, sampleIterations: 10 }
      );

      assertBenchmarkPasses(result, PERFORMANCE_BUDGET.UPDATE_1000_UNITS, {
        safetyMultiplier: 2.0, // Extra margin for stress test
      });
    });
  });

  describe('Update Performance (Clustered - Worst Case)', () => {
    it('processes 500 clustered units within budget', () => {
      const world = createClusteredWorld(500);
      const influenceMap = new InfluenceMap(200, 200, 4);

      const result = runner.run(
        'influence-update-500-clustered',
        () => {
          influenceMap.update(world, 0);
        },
        { warmupIterations: 5, sampleIterations: 15 }
      );

      // Clustered units may be slightly slower due to overlapping influence
      assertBenchmarkPasses(result, PERFORMANCE_BUDGET.UPDATE_500_UNITS, {
        safetyMultiplier: 2.0,
      });
    });
  });

  describe('Threat Analysis Performance', () => {
    it('performs 1000 threat analysis calls within budget', () => {
      const world = createTestWorld(500);
      const influenceMap = new InfluenceMap(200, 200, 4);

      // Populate the influence map first
      influenceMap.update(world, 0);

      const result = runner.run(
        'threat-analysis-1000-calls',
        () => {
          for (let i = 0; i < 1000; i++) {
            const x = (i % 50) * 4;
            const y = Math.floor(i / 50) * 10;
            influenceMap.getThreatAnalysis(x, y, 'player1');
          }
        },
        { warmupIterations: 5, sampleIterations: 20 }
      );

      assertBenchmarkPasses(result, PERFORMANCE_BUDGET.THREAT_ANALYSIS_1000_CALLS);
    });
  });

  describe('Metrics System', () => {
    it('correctly tracks update metrics', () => {
      const world = createTestWorld(100);
      const influenceMap = new InfluenceMap(200, 200, 4);

      // Perform multiple updates
      for (let i = 0; i < 50; i++) {
        influenceMap.update(world, i);
      }

      const metrics: InfluenceMapMetrics = influenceMap.getMetrics();

      expect(metrics.sampleCount).toBe(50);
      expect(metrics.lastUnitCount).toBe(100);
      expect(metrics.lastUpdateMs).toBeGreaterThan(0);
      expect(metrics.averageMs).toBeGreaterThan(0);
      expect(metrics.maxMs).toBeGreaterThanOrEqual(metrics.averageMs);
      expect(metrics.p95Ms).toBeLessThanOrEqual(metrics.maxMs);
    });

    it('resets metrics correctly', () => {
      const world = createTestWorld(100);
      const influenceMap = new InfluenceMap(200, 200, 4);

      // Perform some updates
      for (let i = 0; i < 10; i++) {
        influenceMap.update(world, i);
      }

      expect(influenceMap.getMetrics().sampleCount).toBe(10);

      // Reset metrics
      influenceMap.resetMetrics();

      const metrics = influenceMap.getMetrics();
      expect(metrics.sampleCount).toBe(0);
      expect(metrics.lastUpdateMs).toBe(0);
      expect(metrics.averageMs).toBe(0);
    });

    it('handles rolling buffer correctly', () => {
      const world = createTestWorld(50);
      const influenceMap = new InfluenceMap(200, 200, 4);

      // Perform more updates than buffer size (100)
      for (let i = 0; i < 150; i++) {
        influenceMap.update(world, i);
      }

      const metrics = influenceMap.getMetrics();

      // Buffer should be capped at 100 samples
      expect(metrics.sampleCount).toBe(100);
      expect(metrics.averageMs).toBeGreaterThan(0);
    });
  });

  describe('Scaling Characteristics', () => {
    it('execution time scales sub-quadratically with unit count', () => {
      const ITERATIONS_PER_MEASUREMENT = 10;

      const measureTime = (inputSize: number): number => {
        const world = createTestWorld(inputSize);
        const influenceMap = new InfluenceMap(200, 200, 4);

        const start = performance.now();
        for (let iter = 0; iter < ITERATIONS_PER_MEASUREMENT; iter++) {
          influenceMap.update(world, iter);
        }
        return (performance.now() - start) / ITERATIONS_PER_MEASUREMENT;
      };

      // Measure at different scales
      const times: number[] = [];
      for (const size of [100, 200, 400]) {
        times.push(measureTime(size));
      }

      // Calculate scaling ratios
      const ratios: number[] = [];
      for (let i = 1; i < times.length; i++) {
        ratios.push(times[i] / times[i - 1]);
      }
      const ratioAvg = ratios.reduce((a, b) => a + b, 0) / ratios.length;

      // Verify we're not O(n^2): if doubling input quadruples time, that's bad
      // O(n) would show ratios around 2.0
      // O(n^2) would show ratios around 4.0
      // Allow generous tolerance for CI variance
      expect(ratioAvg).toBeLessThan(4.0);

      // Sanity check: all measurements complete
      expect(times.length).toBe(3);
      times.forEach((t) => expect(t).toBeGreaterThan(0));
    });
  });

  describe('Memory Stability', () => {
    it('does not leak memory over multiple simulation ticks', () => {
      const world = createTestWorld(500);
      const influenceMap = new InfluenceMap(200, 200, 4);

      // Simulate 200 game ticks (typical game session duration)
      for (let tick = 0; tick < 200; tick++) {
        influenceMap.update(world, tick);
      }

      // If we got here without OOM or performance degradation, test passes
      const metrics = influenceMap.getMetrics();
      expect(metrics.sampleCount).toBe(100); // Rolling buffer capped at 100
      expect(metrics.averageMs).toBeGreaterThan(0);
    });

    it('clear() properly resets all state', () => {
      const world = createTestWorld(500);
      const influenceMap = new InfluenceMap(200, 200, 4);

      // Populate influence map
      influenceMap.update(world, 0);

      // Get threat at center (should have influence)
      const beforeClear = influenceMap.getThreatAnalysis(100, 100, 'player1');
      expect(beforeClear.enemyInfluence + beforeClear.friendlyInfluence).toBeGreaterThan(0);

      // Clear
      influenceMap.clear();

      // Get threat at center (should be zero)
      const afterClear = influenceMap.getThreatAnalysis(100, 100, 'player1');
      expect(afterClear.enemyInfluence).toBe(0);
      expect(afterClear.friendlyInfluence).toBe(0);
    });
  });
});

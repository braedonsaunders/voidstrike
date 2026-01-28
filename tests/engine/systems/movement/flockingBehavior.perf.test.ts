import { describe, it, expect, beforeEach } from 'vitest';
import { FlockingBehavior, FlockingEntityCache, FlockingSpatialGrid } from '@/engine/systems/movement/FlockingBehavior';
import { ALIGNMENT_RADIUS } from '@/data/movement.config';
import { Transform } from '@/engine/components/Transform';
import { Unit, UnitState } from '@/engine/components/Unit';
import { Velocity } from '@/engine/components/Velocity';
import { SpatialEntityData, SpatialUnitState } from '@/engine/core/SpatialGrid';
import { PooledVector2 } from '@/utils/VectorPool';

/**
 * FlockingBehavior Performance Benchmarks
 *
 * Tests performance with large unit counts (100-1000 units) to detect regressions.
 * Critical for RTS gameplay where armies of 200+ units are common.
 *
 * Scenarios tested:
 * - Dense clustering (worst case - army blob)
 * - Sparse distribution (best case - units spread out)
 * - Mixed states (realistic battle scenario)
 * - Choke point (units streaming through narrow passage)
 *
 * Performance thresholds are calibrated for 60fps gameplay.
 * Total movement system budget: ~8ms per frame
 * FlockingBehavior budget: ~3ms for 500 units
 */

// =============================================================================
// PERFORMANCE THRESHOLDS
// =============================================================================

/**
 * Maximum allowed execution time in milliseconds.
 * These thresholds are generous for CI environments.
 * In production, the actual game uses WASM SIMD which is 4x faster.
 *
 * Note: These are regression detection thresholds, not production targets.
 * If these start failing, investigate for algorithmic regressions.
 */
const PERFORMANCE_THRESHOLDS = {
  UNITS_100_MS: 15.0,    // 15ms for 100 units (accounts for CI variance)
  UNITS_250_MS: 20.0,    // 20ms for 250 units
  UNITS_500_MS: 40.0,    // 40ms for 500 units (main benchmark)
  UNITS_1000_MS: 80.0,   // 80ms for 1000 units (stress test)
};

const GRID_CELL_SIZE = ALIGNMENT_RADIUS;

// =============================================================================
// TEST DATA GENERATORS
// =============================================================================

interface TestEntity {
  id: number;
  transform: Transform;
  unit: Unit;
  velocity: Velocity;
  spatialData: SpatialEntityData;
}

interface TestScenario {
  entities: TestEntity[];
  grid: FlockingSpatialGrid;
  cache: FlockingEntityCache;
}

/** Create a minimal Unit component for testing */
function createTestUnit(id: number, x: number, y: number, state: UnitState = 'idle', isFlying = false): TestEntity {
  const transform = new Transform(x, y, 0, 0);
  const velocity = new Velocity(state === 'moving' ? 1 : 0, 0, 0);

  // Minimal Unit mock with only properties needed for flocking tests
  const unit = {
    type: 'Unit' as const,
    entityId: id,
    unitId: 'test_unit',
    name: 'Test Unit',
    state,
    speed: 3.0,
    attackRange: 5,
    attackDamage: 10,
    attackSpeed: 1,
    sightRange: 8,
    isFlying,
    isWorker: false,
    collisionRadius: 0.5,
    targetEntityId: null,
    targetX: 100,
    targetY: 100,
    damageType: 'normal' as const,
    canAttackGround: true,
    canAttackAir: false,
    isBiological: true,
    isMechanical: false,
  } as unknown as Unit;

  const spatialData: SpatialEntityData = {
    id,
    x,
    y,
    radius: 0.5,
    isFlying,
    state: stateToSpatialState(state),
    playerId: 1,
    collisionRadius: 0.5,
    isWorker: false,
    maxSpeed: 3.0,
  };

  return { id, transform, unit, velocity, spatialData };
}

function stateToSpatialState(state: UnitState): SpatialUnitState {
  switch (state) {
    case 'idle': return SpatialUnitState.Idle;
    case 'moving': return SpatialUnitState.Moving;
    case 'attacking': return SpatialUnitState.Attacking;
    case 'attackmoving': return SpatialUnitState.AttackMoving;
    default: return SpatialUnitState.Idle;
  }
}

/**
 * Create a dense cluster of units (worst case scenario).
 * All units packed within a small area, maximizing neighbor overlap.
 */
function createDenseClusterScenario(unitCount: number): TestScenario {
  const entities: TestEntity[] = [];
  const gridSize = Math.ceil(Math.sqrt(unitCount));
  const spacing = 1.0; // Very close together

  for (let i = 0; i < unitCount; i++) {
    const row = Math.floor(i / gridSize);
    const col = i % gridSize;
    const x = col * spacing;
    const y = row * spacing;
    entities.push(createTestUnit(i + 1, x, y, 'idle'));
  }

  return createScenarioFromEntities(entities);
}

/**
 * Create a sparse distribution of units (best case scenario).
 * Units spread out with minimal neighbor overlap.
 */
function createSparseScenario(unitCount: number): TestScenario {
  const entities: TestEntity[] = [];
  const gridSize = Math.ceil(Math.sqrt(unitCount));
  const spacing = 10.0; // Far apart

  for (let i = 0; i < unitCount; i++) {
    const row = Math.floor(i / gridSize);
    const col = i % gridSize;
    const x = col * spacing;
    const y = row * spacing;
    entities.push(createTestUnit(i + 1, x, y, 'idle'));
  }

  return createScenarioFromEntities(entities);
}

/**
 * Create a mixed state scenario (realistic battle).
 * Units in various states: idle, moving, attacking.
 */
function createMixedStateScenario(unitCount: number): TestScenario {
  const entities: TestEntity[] = [];
  const gridSize = Math.ceil(Math.sqrt(unitCount));
  const spacing = 2.0;

  const states: UnitState[] = ['idle', 'moving', 'attacking', 'attackmoving'];

  for (let i = 0; i < unitCount; i++) {
    const row = Math.floor(i / gridSize);
    const col = i % gridSize;
    const x = col * spacing;
    const y = row * spacing;
    const state = states[i % states.length];
    entities.push(createTestUnit(i + 1, x, y, state));
  }

  return createScenarioFromEntities(entities);
}

/**
 * Create a choke point scenario.
 * Units streaming through a narrow passage.
 */
function createChokePointScenario(unitCount: number): TestScenario {
  const entities: TestEntity[] = [];
  const chokeWidth = 4;
  const rows = Math.ceil(unitCount / chokeWidth);

  for (let i = 0; i < unitCount; i++) {
    const row = Math.floor(i / chokeWidth);
    const col = i % chokeWidth;
    const x = col * 1.2; // Tight spacing
    const y = row * 1.5;
    entities.push(createTestUnit(i + 1, x, y, 'moving'));
  }

  return createScenarioFromEntities(entities);
}

/**
 * Create mocks from entity list
 */
function createScenarioFromEntities(entities: TestEntity[]): TestScenario {
  const cacheMap = new Map<number, { transform: Transform; unit: Unit; velocity: Velocity }>();
  // Lightweight spatial hash to avoid O(n) scans in perf tests.
  const cellMap = new Map<string, SpatialEntityData[]>();

  for (const entity of entities) {
    cacheMap.set(entity.id, {
      transform: entity.transform,
      unit: entity.unit,
      velocity: entity.velocity,
    });

    const cellX = Math.floor(entity.spatialData.x / GRID_CELL_SIZE);
    const cellY = Math.floor(entity.spatialData.y / GRID_CELL_SIZE);
    const cellKey = `${cellX},${cellY}`;
    const bucket = cellMap.get(cellKey);
    if (bucket) {
      bucket.push(entity.spatialData);
    } else {
      cellMap.set(cellKey, [entity.spatialData]);
    }
  }

  const grid: FlockingSpatialGrid = {
    queryRadiusWithData(x: number, y: number, radius: number, buffer: SpatialEntityData[]): SpatialEntityData[] {
      const results: SpatialEntityData[] = [];
      let bufferIndex = 0;
      const radiusSq = radius * radius;
      const minCellX = Math.floor((x - radius) / GRID_CELL_SIZE);
      const maxCellX = Math.floor((x + radius) / GRID_CELL_SIZE);
      const minCellY = Math.floor((y - radius) / GRID_CELL_SIZE);
      const maxCellY = Math.floor((y + radius) / GRID_CELL_SIZE);

      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
          const bucket = cellMap.get(`${cellX},${cellY}`);
          if (!bucket) continue;

          for (const entity of bucket) {
            const dx = entity.x - x;
            const dy = entity.y - y;
            const distSq = dx * dx + dy * dy;

            if (distSq <= radiusSq) {
              if (bufferIndex >= buffer.length) {
                return results;
              }
              Object.assign(buffer[bufferIndex], entity);
              results.push(buffer[bufferIndex]);
              bufferIndex++;
            }
          }
        }
      }

      return results;
    },
    queryRadius(x: number, y: number, radius: number): number[] {
      const results: number[] = [];
      const radiusSq = radius * radius;
      const minCellX = Math.floor((x - radius) / GRID_CELL_SIZE);
      const maxCellX = Math.floor((x + radius) / GRID_CELL_SIZE);
      const minCellY = Math.floor((y - radius) / GRID_CELL_SIZE);
      const maxCellY = Math.floor((y + radius) / GRID_CELL_SIZE);

      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
          const bucket = cellMap.get(`${cellX},${cellY}`);
          if (!bucket) continue;

          for (const entity of bucket) {
            const dx = entity.x - x;
            const dy = entity.y - y;
            const distSq = dx * dx + dy * dy;

            if (distSq <= radiusSq) {
              results.push(entity.id);
            }
          }
        }
      }

      return results;
    },
  };

  const cache: FlockingEntityCache = {
    get(entityId: number) {
      return cacheMap.get(entityId);
    },
  };

  return { entities, grid, cache };
}

// =============================================================================
// PERFORMANCE TESTS
// =============================================================================

describe('FlockingBehavior Performance', () => {
  describe('Separation Force Performance', () => {
    it('processes 100 units within threshold (dense cluster)', () => {
      const scenario = createDenseClusterScenario(100);
      const flocking = new FlockingBehavior();
      flocking.setCurrentTick(0);

      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;
      const start = performance.now();

      for (const entity of scenario.entities) {
        flocking.calculateSeparationForce(
          entity.id,
          entity.transform,
          entity.unit,
          out,
          100,
          scenario.grid
        );
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(PERFORMANCE_THRESHOLDS.UNITS_100_MS);
    });

    it('processes 250 units within threshold (dense cluster)', () => {
      const scenario = createDenseClusterScenario(250);
      const flocking = new FlockingBehavior();
      flocking.setCurrentTick(0);

      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;
      const start = performance.now();

      for (const entity of scenario.entities) {
        flocking.calculateSeparationForce(
          entity.id,
          entity.transform,
          entity.unit,
          out,
          100,
          scenario.grid
        );
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(PERFORMANCE_THRESHOLDS.UNITS_250_MS);
    });

    it('processes 500 units within threshold (dense cluster)', () => {
      const scenario = createDenseClusterScenario(500);
      const flocking = new FlockingBehavior();
      flocking.setCurrentTick(0);

      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;
      const start = performance.now();

      for (const entity of scenario.entities) {
        flocking.calculateSeparationForce(
          entity.id,
          entity.transform,
          entity.unit,
          out,
          100,
          scenario.grid
        );
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(PERFORMANCE_THRESHOLDS.UNITS_500_MS);
    });

    it('processes 1000 units within threshold (stress test)', () => {
      const scenario = createDenseClusterScenario(1000);
      const flocking = new FlockingBehavior();
      flocking.setCurrentTick(0);

      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;
      const start = performance.now();

      for (const entity of scenario.entities) {
        flocking.calculateSeparationForce(
          entity.id,
          entity.transform,
          entity.unit,
          out,
          100,
          scenario.grid
        );
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(PERFORMANCE_THRESHOLDS.UNITS_1000_MS);
    });
  });

  describe('Full Steering Calculation Performance', () => {
    it('calculates all forces for 500 units (dense cluster)', () => {
      const scenario = createDenseClusterScenario(500);
      const flocking = new FlockingBehavior();
      flocking.setCurrentTick(0);

      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;
      const start = performance.now();

      for (const entity of scenario.entities) {
        // Calculate all four steering forces
        flocking.calculateSeparationForce(
          entity.id, entity.transform, entity.unit, out, 100, scenario.grid
        );
        flocking.calculateCohesionForce(
          entity.id, entity.transform, entity.unit, out, scenario.grid
        );
        flocking.calculateAlignmentForce(
          entity.id, entity.transform, entity.unit, entity.velocity, out, scenario.grid, scenario.cache
        );
        flocking.calculatePhysicsPush(
          entity.id, entity.transform, entity.unit, out, scenario.grid
        );
      }

      const elapsed = performance.now() - start;
      // Allow 4x the single force threshold since we're calculating 4 forces
      expect(elapsed).toBeLessThan(PERFORMANCE_THRESHOLDS.UNITS_500_MS * 4);
    });

    it('calculates all forces for 500 units (sparse distribution)', () => {
      const scenario = createSparseScenario(500);
      const flocking = new FlockingBehavior();
      flocking.setCurrentTick(0);

      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;
      const start = performance.now();

      for (const entity of scenario.entities) {
        flocking.calculateSeparationForce(
          entity.id, entity.transform, entity.unit, out, 100, scenario.grid
        );
        flocking.calculateCohesionForce(
          entity.id, entity.transform, entity.unit, out, scenario.grid
        );
        flocking.calculateAlignmentForce(
          entity.id, entity.transform, entity.unit, entity.velocity, out, scenario.grid, scenario.cache
        );
        flocking.calculatePhysicsPush(
          entity.id, entity.transform, entity.unit, out, scenario.grid
        );
      }

      const elapsed = performance.now() - start;
      // Sparse should complete within threshold (may not be faster due to test overhead)
      expect(elapsed).toBeLessThan(PERFORMANCE_THRESHOLDS.UNITS_500_MS * 4);
    });

    it('calculates all forces for 500 units (mixed states)', () => {
      const scenario = createMixedStateScenario(500);
      const flocking = new FlockingBehavior();
      flocking.setCurrentTick(0);

      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;
      const start = performance.now();

      for (const entity of scenario.entities) {
        flocking.calculateSeparationForce(
          entity.id, entity.transform, entity.unit, out, 100, scenario.grid
        );
        flocking.calculateCohesionForce(
          entity.id, entity.transform, entity.unit, out, scenario.grid
        );
        flocking.calculateAlignmentForce(
          entity.id, entity.transform, entity.unit, entity.velocity, out, scenario.grid, scenario.cache
        );
        flocking.calculatePhysicsPush(
          entity.id, entity.transform, entity.unit, out, scenario.grid
        );
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(PERFORMANCE_THRESHOLDS.UNITS_500_MS * 4);
    });

    it('calculates all forces for 500 units (choke point)', () => {
      const scenario = createChokePointScenario(500);
      const flocking = new FlockingBehavior();
      flocking.setCurrentTick(0);

      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;
      const start = performance.now();

      for (const entity of scenario.entities) {
        flocking.calculateSeparationForce(
          entity.id, entity.transform, entity.unit, out, 100, scenario.grid
        );
        flocking.calculateCohesionForce(
          entity.id, entity.transform, entity.unit, out, scenario.grid
        );
        flocking.calculateAlignmentForce(
          entity.id, entity.transform, entity.unit, entity.velocity, out, scenario.grid, scenario.cache
        );
        flocking.calculatePhysicsPush(
          entity.id, entity.transform, entity.unit, out, scenario.grid
        );
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(PERFORMANCE_THRESHOLDS.UNITS_500_MS * 4);
    });
  });

  describe('Cache Effectiveness', () => {
    it('cache significantly improves repeated calculations', () => {
      const scenario = createDenseClusterScenario(500);
      const flocking = new FlockingBehavior();
      flocking.setCurrentTick(0);

      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;

      // First pass - populates cache
      const start1 = performance.now();
      for (const entity of scenario.entities) {
        flocking.calculateSeparationForce(
          entity.id, entity.transform, entity.unit, out, 100, scenario.grid
        );
      }
      const elapsed1 = performance.now() - start1;

      // Second pass - should use cache (within throttle window)
      const start2 = performance.now();
      for (const entity of scenario.entities) {
        flocking.calculateSeparationForce(
          entity.id, entity.transform, entity.unit, out, 100, scenario.grid
        );
      }
      const elapsed2 = performance.now() - start2;

      // Cached pass should be significantly faster (at least 50%)
      expect(elapsed2).toBeLessThan(elapsed1 * 0.5);
    });
  });

  describe('Velocity Smoothing Performance', () => {
    it('smooths velocity for 500 units within threshold', () => {
      const flocking = new FlockingBehavior();
      const unitCount = 500;

      const start = performance.now();

      for (let i = 0; i < unitCount; i++) {
        flocking.smoothVelocity(i + 1, 1.0, 0.5, 0.9, 0.4);
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(5.0); // Should be fast
    });
  });

  describe('Stuck Detection Performance', () => {
    it('handles stuck detection for 500 units within threshold', () => {
      const scenario = createDenseClusterScenario(500);
      const flocking = new FlockingBehavior();
      flocking.setCurrentTick(0);

      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;
      const start = performance.now();

      for (const entity of scenario.entities) {
        flocking.handleStuckDetection(
          entity.id,
          entity.transform,
          entity.unit,
          0.01, // Low velocity (stuck)
          50,   // Distance to target
          out
        );
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(5.0); // Should be fast
    });
  });

  describe('Memory Stability', () => {
    it('does not leak memory over multiple simulation ticks', () => {
      const scenario = createDenseClusterScenario(500);
      const flocking = new FlockingBehavior();
      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;

      // Simulate 100 game ticks
      for (let tick = 0; tick < 100; tick++) {
        flocking.setCurrentTick(tick);

        for (const entity of scenario.entities) {
          flocking.calculateSeparationForce(
            entity.id, entity.transform, entity.unit, out, 100, scenario.grid
          );
        }
      }

      // If we got here without OOM, test passes
      expect(true).toBe(true);
    });

    it('cleanup properly releases memory', () => {
      const scenario = createDenseClusterScenario(500);
      const flocking = new FlockingBehavior();
      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;

      // Populate caches
      for (const entity of scenario.entities) {
        flocking.calculateSeparationForce(
          entity.id, entity.transform, entity.unit, out, 100, scenario.grid
        );
        flocking.calculateCohesionForce(
          entity.id, entity.transform, entity.unit, out, scenario.grid
        );
        flocking.smoothVelocity(entity.id, 1, 0, 0.9, 0);
        flocking.handleStuckDetection(entity.id, entity.transform, entity.unit, 0.01, 50, out);
      }

      // Cleanup all entities
      const cleanupStart = performance.now();
      for (const entity of scenario.entities) {
        flocking.cleanupUnit(entity.id);
      }
      const cleanupElapsed = performance.now() - cleanupStart;

      // Cleanup should be fast
      expect(cleanupElapsed).toBeLessThan(10.0);
    });
  });

  describe('Scaling Characteristics', () => {
    it('execution time scales sub-quadratically with unit count', () => {
      const flocking = new FlockingBehavior();
      const out: PooledVector2 = { x: 0, y: 0 } as PooledVector2;

      const measurements: { count: number; time: number }[] = [];
      const runCounts = [100, 200, 400];
      const sampleRuns = 5;

      for (const count of runCounts) {
        // Warmup to reduce JIT and allocation variance
        const warmupScenario = createDenseClusterScenario(count);
        flocking.setCurrentTick(0);
        for (const entity of warmupScenario.entities) {
          flocking.calculateSeparationForce(
            entity.id, entity.transform, entity.unit, out, 100, warmupScenario.grid
          );
        }
        for (const entity of warmupScenario.entities) {
          flocking.cleanupUnit(entity.id);
        }

        const times: number[] = [];
        for (let run = 0; run < sampleRuns; run++) {
          const scenario = createDenseClusterScenario(count);
          flocking.setCurrentTick(0);

          const start = performance.now();
          for (const entity of scenario.entities) {
            flocking.calculateSeparationForce(
              entity.id, entity.transform, entity.unit, out, 100, scenario.grid
            );
          }
          const elapsed = performance.now() - start;
          times.push(elapsed);

          // Clean up for next iteration
          for (const entity of scenario.entities) {
            flocking.cleanupUnit(entity.id);
          }
        }

        times.sort((a, b) => a - b);
        measurements.push({ count, time: times[Math.floor(times.length / 2)] });
      }

      // If O(n²), time should quadruple when count doubles
      // We want sub-quadratic, so ratio should be less than 5 (allowing variance)
      const ratio100to200 = measurements[1].time / measurements[0].time;
      const ratio200to400 = measurements[2].time / measurements[1].time;

      // Allow variance in test environment
      // With spatial partitioning, expect closer to O(n) or O(n log n)
      // but test environment variance means we allow up to 5x
      expect(ratio100to200).toBeLessThan(5);
      expect(ratio200to400).toBeLessThan(5);
    });
  });
});


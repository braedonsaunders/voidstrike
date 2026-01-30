# VOIDSTRIKE Testing Documentation

## Overview

Testing framework: **Vitest** with V8 coverage provider

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
npm run test:coverage # With coverage report
```

---

## Current Coverage Summary

| Category | Statements | Branches | Functions | Lines |
|----------|------------|----------|-----------|-------|
| **Overall** | 56.89% | 48.21% | 49.12% | 58.34% |

### Module Breakdown

| Module | Stmts | Branch | Funcs | Lines | Status |
|--------|-------|--------|-------|-------|--------|
| **engine/ai** |
| BehaviorTree.ts | 87.69% | 85.22% | 88.52% | 86.74% | Covered |
| **engine/components** |
| Health.ts | 94.44% | 96.55% | 100% | 94.23% | Covered |
| Transform.ts | 100% | 100% | 100% | 100% | Complete |
| Velocity.ts | 100% | 100% | 100% | 100% | Complete |
| **engine/core** |
| EventBus.ts | 95.34% | 84.61% | 100% | 97.43% | Covered |
| GameLoop.ts | 68.57% | 55.88% | 69.23% | 69.23% | Partial |
| PerformanceMonitor.ts | 51.87% | 34.37% | 71.05% | 53.95% | Partial |
| SpatialGrid.ts | 65.00% | 49.06% | 71.87% | 66.29% | Partial |
| SystemRegistry.ts | 88.31% | 80.00% | 90.90% | 89.33% | Covered |
| **engine/ecs** |
| Entity.ts | 100% | 100% | 100% | 100% | Complete |
| EntityId.ts | 82.35% | 64.70% | 85.71% | 89.36% | Covered |
| World.ts | 81.21% | 71.62% | 69.23% | 83.33% | Covered |
| **engine/network** |
| DesyncDetection.ts | 21.87% | 13.25% | 40% | 22.58% | Minimal |
| MerkleTree.ts | 74.48% | 52.50% | 90% | 77.52% | Covered |
| ConnectionCode.ts | 19.04% | 12.30% | 13.33% | 19.25% | Minimal |
| types.ts | 100% | 100% | 100% | 100% | Complete |
| **utils** |
| math.ts | 100% | 100% | 100% | 100% | Complete |
| FixedPoint.ts | 67.32% | 55.55% | 55% | 70.65% | Partial |
| debugLogger.ts | 27.27% | 37.50% | 6.94% | 27.27% | Minimal |

---

## Test File Inventory

| Test File | Tests | Status |
|-----------|-------|--------|
| `tests/engine/ai/behaviorTree.test.ts` | 55 | Active |
| `tests/engine/components/ability.test.ts` | 48 | Active |
| `tests/engine/components/building.test.ts` | 99 | Active |
| `tests/engine/components/health.test.ts` | 38 | Active |
| `tests/engine/components/projectile.test.ts` | 24 | Active |
| `tests/engine/components/resource.test.ts` | 38 | Active |
| `tests/engine/components/selectable.test.ts` | 16 | Active |
| `tests/engine/components/transform.test.ts` | 20 | Active |
| `tests/engine/components/unit.test.ts` | 96 | Active |
| `tests/engine/components/velocity.test.ts` | 18 | Active |
| `tests/engine/components/wall.test.ts` | 83 | Active |
| `tests/engine/core/eventBus.test.ts` | 5 | Active |
| `tests/engine/core/gameLoop.test.ts` | 2 | Active |
| `tests/engine/core/performanceMonitor.test.ts` | 19 | Active |
| `tests/engine/core/spatialGrid.test.ts` | 4 | Active |
| `tests/engine/core/systemRegistry.test.ts` | 23 | Active |
| `tests/engine/ecs/entity.test.ts` | 16 | Active |
| `tests/engine/ecs/entityId.test.ts` | 6 | Active |
| `tests/engine/ecs/world.test.ts` | 25 | Active |
| `tests/engine/network/connectionCode.test.ts` | 11 | Active |
| `tests/engine/network/desyncDetection.test.ts` | 16 | Active |
| `tests/engine/network/merkleTree.test.ts` | 3 | Active |
| `tests/engine/network/types.test.ts` | 9 | Active |
| `tests/engine/pathfinding/grid.test.ts` | 23 | Active |
| `tests/utils/fixedPoint.test.ts` | 7 | Active |
| `tests/utils/math.test.ts` | 7 | Active |
| `tests/utils/vectorPool.test.ts` | 28 | Active |
| `tests/data/combat.test.ts` | 51 | Active |
| `tests/data/projectileTypes.test.ts` | 42 | Active |
| `tests/data/formations.test.ts` | 34 | Active |
| `tests/data/categories.test.ts` | 55 | Active |
| `tests/data/resources.test.ts` | 45 | Active |
| `tests/data/walls.test.ts` | 49 | Active |
| `tests/data/aiConfig.test.ts` | 38 | Active |
| `tests/data/movementConfig.test.ts` | 45 | Active |
| `tests/data/techTree.test.ts` | 34 | Active |
| `tests/data/pathfindingConfig.test.ts` | 52 | Active |
| `tests/data/buildOrders.test.ts` | 55 | Active |
| `tests/data/audioConfig.test.ts` | 18 | Active |
| `tests/data/renderingConfig.test.ts` | 63 | Active |
| `tests/data/collisionConfig.test.ts` | 54 | Active |
| `tests/engine/definitions/definitionRegistry.test.ts` | 52 | Active |
| `tests/engine/definitions/definitionValidator.test.ts` | 70 | Active |
| `tests/engine/systems/combatSystem.test.ts` | 67 | Active |
| `tests/engine/systems/resourceSystem.test.ts` | 59 | Active |
| `tests/engine/systems/productionSystem.test.ts` | 51 | Active |
| `tests/engine/systems/pathfindingSystem.test.ts` | 17 | Active |
| `tests/engine/systems/visionSystem.test.ts` | 19 | Active |
| `tests/engine/systems/projectileSystem.test.ts` | 27 | Active |
| `tests/engine/systems/abilitySystem.test.ts` | 28 | Active |
| `tests/engine/systems/buildingPlacementSystem.test.ts` | 27 | Active |
| **Total** | **1791** | |

---

## Tests To Implement Checklist

### Priority 1: Core Engine (Critical Path)

- [ ] **Game.ts** - Game lifecycle, initialization, tick management
- [x] **SystemRegistry.ts** - System registration, dependency resolution (88% coverage)
- [x] **Component.ts** - Component type definitions (abstract base class)

### Priority 2: ECS Systems

- [x] **CombatSystem.ts** - Damage calculation, attack logic, target validation (67 tests)
- [ ] **MovementSystem.ts** - Position updates, collision handling, velocity
- [x] **PathfindingSystem.ts** - Path calculation, waypoint management (17 tests)
- [x] **ProductionSystem.ts** - Unit/building production queues (51 tests)
- [x] **ResourceSystem.ts** - Resource gathering, consumption, storage (59 tests)
- [ ] **SelectionSystem.ts** - Unit selection, group management
- [x] **VisionSystem.ts** - Fog of war, visibility calculations (19 tests)
- [x] **ProjectileSystem.ts** - Projectile physics, hit detection (27 tests)
- [x] **AbilitySystem.ts** - Ability casting, cooldowns, effects (28 tests)
- [x] **BuildingPlacementSystem.ts** - Building placement validation (27 tests)

### Priority 3: Components

- [x] **Health.ts** - Health component, damage application, death (94% coverage)
- [x] **Transform.ts** - Position, rotation, scale (100% coverage)
- [x] **Velocity.ts** - Movement velocity, acceleration (100% coverage)
- [x] **Unit.ts** - Unit state, attributes (96 tests)
- [x] **Building.ts** - Building state, construction, production, addons, lift-off (99 tests)
- [x] **Ability.ts** - Ability definitions, energy, cooldowns (48 tests)
- [x] **Selectable.ts** - Selection state, groups (16 tests)
- [x] **Projectile.ts** - Projectile properties (24 tests)
- [x] **Resource.ts** - Resource type, gathering, saturation (38 tests)
- [x] **Wall.ts** - Wall connections, gates, upgrades, shields (83 tests)

### Priority 4: AI Systems

- [ ] **AIWorkerManager.ts** - Worker task assignment
- [ ] **AbilityAI.ts** - AI ability usage decisions
- [ ] **FormationControl.ts** - Formation positioning
- [ ] **InfluenceMap.ts** - Influence calculations
- [ ] **PositionalAnalysis.ts** - Map analysis
- [ ] **RetreatCoordination.ts** - Retreat logic
- [ ] **ScoutingMemory.ts** - Scout information storage
- [ ] **UnitBehaviors.ts** - Unit AI state machines
- [ ] **WorkerDistribution.ts** - Worker allocation

### Priority 5: AI Subsystems

- [ ] **AIBuildOrderExecutor.ts** - Build order execution
- [ ] **AICoordinator.ts** - High-level AI coordination
- [ ] **AIEconomyManager.ts** - Economy decisions
- [ ] **AIScoutingManager.ts** - Scouting decisions
- [ ] **AITacticsManager.ts** - Combat tactics
- [ ] **EnhancedAISystem.ts** - AI main loop
- [ ] **AIEconomySystem.ts** - Economic AI logic
- [ ] **AIMicroSystem.ts** - Micro-management AI

### Priority 6: Movement Subsystems

- [ ] **FlockingBehavior.ts** - Flocking/steering behaviors
- [ ] **FormationMovement.ts** - Formation movement
- [ ] **MovementOrchestrator.ts** - Movement coordination
- [ ] **PathfindingMovement.ts** - Path following

### Priority 7: Network & Multiplayer

- [ ] **ConnectionCode.ts** - Full connection code generation/parsing
- [ ] **NostrMatchmaking.ts** - Matchmaking via Nostr
- [ ] **PeerRelay.ts** - P2P relay communication
- [ ] **ChecksumSystem.ts** - State checksumming for desync detection
- [ ] **DesyncDetectionManager** - Full desync handling (partial coverage)

### Priority 8: Pathfinding

- [x] **Grid.ts** - Navigation grid (23 tests)
- [ ] **RecastNavigation.ts** - Recast/Detour navigation

### Priority 9: Definitions & Data

- [ ] **DefinitionLoader.ts** - JSON definition loading
- [x] **DefinitionRegistry.ts** - Definition storage/lookup (52 tests)
- [x] **DefinitionValidator.ts** - Schema validation (70 tests)
- [x] **combat.ts** - Damage types, armor types, multipliers (51 tests)
- [x] **projectileTypes.ts** - Projectile definitions, behaviors (42 tests)
- [x] **formations.ts** - Formation definitions, position generation (34 tests)
- [x] **categories.ts** - Unit categories, subcategories (55 tests)
- [x] **resources.ts** - Resource types, saturation, gather rates (45 tests)
- [x] **walls.ts** - Wall definitions, line calculation, connection types (49 tests)
- [x] **aiConfig.ts** - AI condition evaluation, macro rules, utility scoring (38 tests)
- [x] **movementConfig.ts** - Movement constants, steering behaviors, configuration objects (45 tests)
- [x] **techTree.ts** - Tech categories, upgrade chains, effect formatting (34 tests)
- [x] **pathfindingConfig.ts** - Pathfinding constants, ramp validation, elevation conversion (52 tests)
- [x] **buildOrders.ts** - AI difficulty config, build orders, unit compositions (55 tests)
- [x] **audioConfig.ts** - Voiceline cooldowns, command debounce (18 tests)
- [x] **renderingConfig.ts** - Camera, unit, building, terrain, battle effects config (63 tests)
- [x] **collisionConfig.ts** - Separation, physics, building avoidance, stuck detection (54 tests)

### Priority 10: Building Systems

- [ ] **BuildingMechanicsSystem.ts** - Building logic
- [ ] **BuildingPlacementSystem.ts** - Placement validation
- [ ] **WallSystem.ts** - Wall construction/connections

### Priority 11: Utilities

- [x] **VectorPool.ts** - Vector object pooling (28 tests)
- [ ] **storage.ts** - LocalStorage utilities
- [ ] **overlayCache.ts** - Overlay caching
- [ ] **gameSetup.ts** - Game initialization helpers

### Priority 12: Other Systems

- [ ] **AudioSystem.ts** - Sound playback
- [ ] **ResearchSystem.ts** - Tech tree progression
- [ ] **SaveLoadSystem.ts** - Save/load functionality
- [ ] **UnitMechanicsSystem.ts** - Unit-specific mechanics
- [ ] **GameStateSystem.ts** - Game state management
- [ ] **GameStatePort.ts** - State port abstraction

---

## Testing Guidelines

### Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ModuleName', () => {
  describe('functionName', () => {
    it('describes expected behavior', () => {
      // Arrange
      const input = ...;

      // Act
      const result = functionName(input);

      // Assert
      expect(result).toBe(expected);
    });
  });
});
```

### Naming Conventions

- Test files: `moduleName.test.ts`
- Describe blocks: Module or class name
- It blocks: Behavior description in present tense

### What To Test

1. **Happy path** - Normal expected behavior
2. **Edge cases** - Boundary conditions, empty inputs
3. **Error handling** - Invalid inputs, error states
4. **State transitions** - Before/after state changes

### What NOT To Test

1. Private implementation details
2. Third-party library internals
3. Simple getters/setters without logic
4. Framework boilerplate

### Mocking

```typescript
// Mock dependencies
vi.mock('@/engine/core/Game', () => ({
  Game: vi.fn().mockImplementation(() => ({
    getCurrentTick: vi.fn(() => 0),
    eventBus: { on: vi.fn(), emit: vi.fn() },
  })),
}));

// Spy on methods
const spy = vi.spyOn(object, 'method');
expect(spy).toHaveBeenCalledWith(arg);
```

### Determinism Requirements

For multiplayer-critical code, tests must verify:

1. **Deterministic outputs** - Same inputs produce same outputs
2. **No Math.random()** - Use SeededRandom
3. **Fixed-point arithmetic** - Use FixedPoint utilities
4. **Quantized values** - Use quantize() for positions/damage

---

## Coverage Goals

| Phase | Target | Timeline |
|-------|--------|----------|
| Current | 55% | Baseline |
| Phase 1 | 70% | Core engine, ECS |
| Phase 2 | 80% | Systems, components |
| Phase 3 | 90% | Full coverage |

### Critical Path Coverage Targets

| Module | Current | Target |
|--------|---------|--------|
| engine/ecs | 83% | 95% |
| engine/core | 64% | 85% |
| engine/network | 44% | 80% |
| utils | 54% | 90% |

---

## Running Tests

```bash
# All tests
npm test

# Watch mode (re-run on changes)
npm run test:watch

# With coverage
npm run test:coverage

# Single file
npx vitest run tests/engine/ecs/entity.test.ts

# Pattern matching
npx vitest run --filter "World"

# Update snapshots
npx vitest run --update
```

---

## CI Integration

Tests run automatically on:
- Pull request creation
- Push to main branch
- Manual workflow dispatch

Coverage reports are generated and can be viewed in CI artifacts.

---

## Performance Testing Guidelines

Performance tests require special care to avoid flakiness. VOIDSTRIKE uses a statistical benchmarking framework inspired by Google Benchmark and Vitest bench.

### Why Performance Tests Are Flaky

Common causes of flaky performance tests:
- **JIT compilation variance** - First runs are slower before V8 optimizes
- **System load fluctuations** - CI runners have variable load
- **GC pauses** - Garbage collection can spike execution time
- **CPU scheduling** - Event loop contention affects timing
- **Environment differences** - Local vs CI have different clock precision

### The Solution: Statistical Benchmarking

Located in `tests/utils/BenchmarkRunner.ts` and `tests/utils/performanceTestHelpers.ts`.

#### Key Principles

| Principle | Bad Approach | Good Approach |
|-----------|--------------|---------------|
| **Measurements** | Single `performance.now()` | Multiple iterations with warmup |
| **Assertions** | `expect(time).toBeLessThan(50)` | Percentile-based with adaptive thresholds |
| **Comparison** | Fixed ratio `< 0.5` | Statistical significance test |
| **Complexity** | Absolute time limits | Algorithmic O(n) verification |
| **Timers** | Real `setTimeout` | Vitest fake timers |

#### Using BenchmarkRunner

```typescript
import { getBenchmarkRunner } from '@/tests/utils/BenchmarkRunner';
import { assertBenchmarkPasses } from '@/tests/utils/performanceTestHelpers';

describe('MySystem Performance', () => {
  it('processes 500 entities within budget', () => {
    const runner = getBenchmarkRunner();

    const result = runner.run(
      'my-benchmark',
      () => {
        // Code to benchmark
        mySystem.process(entities);
      },
      {
        warmupIterations: 3,  // JIT warmup
        sampleIterations: 15  // Statistical samples
      }
    );

    // Threshold is adaptive: adjusts to environment
    assertBenchmarkPasses(result, 25); // 25ms base threshold
  });
});
```

#### Algorithmic Complexity Testing

Instead of absolute timing thresholds, verify algorithmic complexity:

```typescript
import { assertComplexity } from '@/tests/utils/performanceTestHelpers';

it('scales sub-quadratically with input size', () => {
  const measureTime = (inputSize: number): number => {
    const scenario = createScenario(inputSize);
    const start = performance.now();
    processScenario(scenario);
    return performance.now() - start;
  };

  // Verify O(n log n), not O(n²)
  assertComplexity(
    measureTime,
    [100, 200, 400],     // Input sizes (double each)
    'O(n log n)',        // Expected complexity
    3.0                  // Tolerance factor
  );
});
```

#### Cache Effectiveness Testing

Use statistical comparison instead of fragile ratios:

```typescript
import { assertCacheEffectiveness } from '@/tests/utils/performanceTestHelpers';

it('cache improves performance', () => {
  const coldFn = () => {
    const fresh = new MyCache();
    fresh.process(data);
  };

  const warmFn = () => {
    cache.process(data); // Pre-populated cache
  };

  // Statistical test: expects at least 1.2x speedup
  assertCacheEffectiveness(coldFn, warmFn, 1.2);
});
```

#### Deterministic Timer Testing

For tests that involve `setTimeout`/`setInterval`, use fake timers:

```typescript
import { vi, beforeEach, afterEach } from 'vitest';

describe('GameLoop timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks at configured rate', () => {
    const updates: number[] = [];
    const loop = new GameLoop(20, (delta) => updates.push(delta));

    loop.start();
    vi.advanceTimersByTime(250); // Deterministic: exactly 250ms
    loop.stop();

    expect(updates.length).toBe(5); // Exactly 5 ticks
  });
});
```

### Performance Test File Naming

- Performance benchmarks: `*.perf.test.ts`
- Regular tests: `*.test.ts`

### BenchmarkRunner API Reference

```typescript
interface BenchmarkResult {
  name: string;
  iterations: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p75: number;
  p95: number;
  p99: number;
  stddev: number;
  operationsPerSecond: number;
}

class BenchmarkRunner {
  // Calibrate to current environment (auto-called)
  calibrate(): number;

  // Run benchmark with statistical collection
  run(name: string, fn: () => void, options?: {
    warmupIterations?: number;    // Default: 5
    sampleIterations?: number;    // Default: 20
    minTime?: number;             // Default: 100ms
    removeOutliers?: boolean;     // Default: true
  }): BenchmarkResult;

  // Assert with environment-adaptive threshold
  assertWithinThreshold(
    result: BenchmarkResult,
    thresholdMs: number,
    options?: { percentile?: 'median' | 'p75' | 'p95' }
  ): void;

  // Statistical comparison (Welch's t-test)
  isSignificantlyDifferent(
    resultA: BenchmarkResult,
    resultB: BenchmarkResult,
    confidenceLevel?: number
  ): { significant: boolean; pValue: number; speedup: number };
}
```

### Performance Budget Guidelines

| Operation | Budget (Reference Hardware) |
|-----------|----------------------------|
| Single force calculation (100 units) | 8ms |
| Single force calculation (500 units) | 25ms |
| Full steering (500 units, 4 forces) | 100ms |
| Pathfinding update (500 units) | 50ms |
| AI decision tree (per unit) | 0.1ms |
| Render state update | 16ms (60fps) |

These are **base budgets** calibrated on M1 MacBook Pro. The `BenchmarkRunner` automatically scales these for slower environments.

### When to Use Performance Tests

**DO use performance tests for:**
- Algorithms with complexity guarantees (spatial queries, pathfinding)
- Critical game loop systems (movement, combat, rendering)
- Cache effectiveness validation
- Memory allocation patterns

**DON'T use performance tests for:**
- Simple getter/setter operations
- One-time initialization code
- Code already covered by unit tests
- UI rendering (use browser devtools instead)

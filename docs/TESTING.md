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
| `tests/engine/components/health.test.ts` | 38 | Active |
| `tests/engine/components/selectable.test.ts` | 16 | Active |
| `tests/engine/components/transform.test.ts` | 20 | Active |
| `tests/engine/components/unit.test.ts` | 96 | Active |
| `tests/engine/components/velocity.test.ts` | 18 | Active |
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
| **Total** | **419** | |

---

## Tests To Implement Checklist

### Priority 1: Core Engine (Critical Path)

- [ ] **Game.ts** - Game lifecycle, initialization, tick management
- [x] **SystemRegistry.ts** - System registration, dependency resolution (88% coverage)
- [x] **Component.ts** - Component type definitions (abstract base class)

### Priority 2: ECS Systems

- [ ] **CombatSystem.ts** - Damage calculation, attack logic, target validation
- [ ] **MovementSystem.ts** - Position updates, collision handling, velocity
- [ ] **PathfindingSystem.ts** - Path calculation, waypoint management
- [ ] **ProductionSystem.ts** - Unit/building production queues
- [ ] **ResourceSystem.ts** - Resource gathering, consumption, storage
- [ ] **SelectionSystem.ts** - Unit selection, group management
- [ ] **VisionSystem.ts** - Fog of war, visibility calculations
- [ ] **ProjectileSystem.ts** - Projectile physics, hit detection
- [ ] **AbilitySystem.ts** - Ability casting, cooldowns, effects
- [ ] **SpawnSystem.ts** - Entity spawning, placement validation

### Priority 3: Components

- [x] **Health.ts** - Health component, damage application, death (94% coverage)
- [x] **Transform.ts** - Position, rotation, scale (100% coverage)
- [x] **Velocity.ts** - Movement velocity, acceleration (100% coverage)
- [x] **Unit.ts** - Unit state, attributes (96 tests)
- [ ] **Building.ts** - Building state, construction progress
- [ ] **Ability.ts** - Ability definitions, state
- [x] **Selectable.ts** - Selection state, groups (16 tests)
- [ ] **Projectile.ts** - Projectile properties
- [ ] **Resource.ts** - Resource type, amount
- [ ] **Wall.ts** - Wall connections, segments

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
- [ ] **DefinitionRegistry.ts** - Definition storage/lookup
- [ ] **DefinitionValidator.ts** - Schema validation

### Priority 10: Building Systems

- [ ] **BuildingMechanicsSystem.ts** - Building logic
- [ ] **BuildingPlacementSystem.ts** - Placement validation
- [ ] **WallSystem.ts** - Wall construction/connections

### Priority 11: Utilities

- [ ] **VectorPool.ts** - Vector object pooling
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

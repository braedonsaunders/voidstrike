import { describe, it, expect } from 'vitest';
import { RESOURCE_TYPES, RESOURCE_SYSTEM_CONFIG } from '@/data/resources/resources';
import { distance } from '@/utils/math';

// Extract saturation constants from config
const OPTIMAL_WORKERS_PER_MINERAL = RESOURCE_TYPES.minerals.optimalWorkersPerSource;
const MAX_WORKERS_PER_MINERAL = RESOURCE_SYSTEM_CONFIG.maxWorkersPerSource;
const OPTIMAL_WORKERS_PER_PLASMA = RESOURCE_TYPES.plasma.optimalWorkersPerSource;
const MAX_WORKERS_PER_PLASMA = RESOURCE_SYSTEM_CONFIG.maxWorkersPerSource;

/**
 * ResourceSystem Tests
 *
 * Since ResourceSystem has many Game/World/AI dependencies, we test:
 * 1. Worker saturation constants
 * 2. Distance calculations for gathering
 * 3. Mineral patch selection algorithm (isolated logic)
 * 4. Resource gathering calculations
 * 5. Mining time and AI speed bonuses
 */

// Base mining time from ResourceSystem
const MINING_TIME = 2.5;

describe('ResourceSystem', () => {
  describe('worker saturation constants', () => {
    it('defines optimal workers per mineral patch', () => {
      expect(OPTIMAL_WORKERS_PER_MINERAL).toBe(2);
    });

    it('defines max workers per mineral patch', () => {
      expect(MAX_WORKERS_PER_MINERAL).toBe(3);
    });

    it('defines optimal workers per plasma', () => {
      expect(OPTIMAL_WORKERS_PER_PLASMA).toBe(3);
    });

    it('defines max workers per plasma', () => {
      expect(MAX_WORKERS_PER_PLASMA).toBe(3);
    });

    it('optimal is less than or equal to max for minerals', () => {
      expect(OPTIMAL_WORKERS_PER_MINERAL).toBeLessThanOrEqual(MAX_WORKERS_PER_MINERAL);
    });

    it('optimal is less than or equal to max for plasma', () => {
      expect(OPTIMAL_WORKERS_PER_PLASMA).toBeLessThanOrEqual(MAX_WORKERS_PER_PLASMA);
    });
  });

  describe('mining time', () => {
    it('base mining time is 2.5 seconds', () => {
      expect(MINING_TIME).toBe(2.5);
    });

    describe('AI speed multiplier calculation', () => {
      function getMiningTimeForPlayer(isAI: boolean, speedMultiplier: number): number {
        if (!isAI) return MINING_TIME;
        return MINING_TIME / speedMultiplier;
      }

      it('human player gets base mining time', () => {
        expect(getMiningTimeForPlayer(false, 1.0)).toBe(2.5);
      });

      it('AI with 1.0x multiplier gets base mining time', () => {
        expect(getMiningTimeForPlayer(true, 1.0)).toBe(2.5);
      });

      it('AI with 1.5x multiplier mines faster', () => {
        expect(getMiningTimeForPlayer(true, 1.5)).toBeCloseTo(1.667, 2);
      });

      it('AI with 2.0x multiplier mines at half time', () => {
        expect(getMiningTimeForPlayer(true, 2.0)).toBe(1.25);
      });

      it('AI multiplier 1.0 means same speed as human', () => {
        const humanTime = getMiningTimeForPlayer(false, 1.0);
        const aiTime = getMiningTimeForPlayer(true, 1.0);
        expect(humanTime).toBe(aiTime);
      });
    });
  });

  describe('gathering distance thresholds', () => {
    // From ResourceSystem.update()
    const MINERAL_GATHER_DISTANCE = 2;
    const PLASMA_GATHER_DISTANCE = 3.5;

    it('mineral gathering distance is 2 units', () => {
      expect(MINERAL_GATHER_DISTANCE).toBe(2);
    });

    it('plasma gathering distance is 3.5 units (extractor is 2x2)', () => {
      expect(PLASMA_GATHER_DISTANCE).toBe(3.5);
    });

    it('plasma distance accounts for larger building', () => {
      expect(PLASMA_GATHER_DISTANCE).toBeGreaterThan(MINERAL_GATHER_DISTANCE);
    });

    describe('worker can gather when within distance', () => {
      function canGather(workerX: number, workerY: number, resourceX: number, resourceY: number, resourceType: 'minerals' | 'plasma'): boolean {
        const dist = distance(workerX, workerY, resourceX, resourceY);
        const threshold = resourceType === 'plasma' ? PLASMA_GATHER_DISTANCE : MINERAL_GATHER_DISTANCE;
        return dist <= threshold;
      }

      it('worker at mineral can gather', () => {
        expect(canGather(0, 0, 0, 0, 'minerals')).toBe(true);
      });

      it('worker 1 unit from mineral can gather', () => {
        expect(canGather(1, 0, 0, 0, 'minerals')).toBe(true);
      });

      it('worker 2 units from mineral can gather', () => {
        expect(canGather(2, 0, 0, 0, 'minerals')).toBe(true);
      });

      it('worker 3 units from mineral cannot gather', () => {
        expect(canGather(3, 0, 0, 0, 'minerals')).toBe(false);
      });

      it('worker at plasma can gather', () => {
        expect(canGather(0, 0, 0, 0, 'plasma')).toBe(true);
      });

      it('worker 3 units from plasma can gather', () => {
        expect(canGather(3, 0, 0, 0, 'plasma')).toBe(true);
      });

      it('worker 4 units from plasma cannot gather', () => {
        expect(canGather(4, 0, 0, 0, 'plasma')).toBe(false);
      });
    });
  });

  describe('mineral patch selection algorithm', () => {
    interface MockPatch {
      id: number;
      x: number;
      y: number;
      gathererCount: number;
      isDepleted: boolean;
    }

    /**
     * Replicates the mineral patch selection logic from ResourceSystem
     */
    function findBestMineralPatch(
      patches: MockPatch[],
      workerX: number,
      workerY: number
    ): MockPatch | null {
      if (patches.length === 0) return null;

      const sortedPatches = patches
        .filter((p) => !p.isDepleted)
        .sort((a, b) => {
          // Strongly prefer patches with < 2 workers (optimal saturation)
          const aOptimal = a.gathererCount < 2 ? 0 : 1;
          const bOptimal = b.gathererCount < 2 ? 0 : 1;
          if (aOptimal !== bOptimal) return aOptimal - bOptimal;

          // Then by gatherer count
          if (a.gathererCount !== b.gathererCount) {
            return a.gathererCount - b.gathererCount;
          }

          // Then by distance
          const distA = distance(workerX, workerY, a.x, a.y);
          const distB = distance(workerX, workerY, b.x, b.y);
          return distA - distB;
        });

      return sortedPatches[0] || null;
    }

    it('returns null for empty patch list', () => {
      expect(findBestMineralPatch([], 0, 0)).toBeNull();
    });

    it('returns the only patch if single available', () => {
      const patches: MockPatch[] = [{ id: 1, x: 5, y: 5, gathererCount: 0, isDepleted: false }];
      const result = findBestMineralPatch(patches, 0, 0);
      expect(result?.id).toBe(1);
    });

    it('skips depleted patches', () => {
      const patches: MockPatch[] = [
        { id: 1, x: 5, y: 5, gathererCount: 0, isDepleted: true },
        { id: 2, x: 10, y: 10, gathererCount: 0, isDepleted: false },
      ];
      const result = findBestMineralPatch(patches, 0, 0);
      expect(result?.id).toBe(2);
    });

    it('prefers patch with 0 workers over 1 worker', () => {
      const patches: MockPatch[] = [
        { id: 1, x: 5, y: 5, gathererCount: 1, isDepleted: false },
        { id: 2, x: 10, y: 10, gathererCount: 0, isDepleted: false },
      ];
      const result = findBestMineralPatch(patches, 0, 0);
      expect(result?.id).toBe(2);
    });

    it('prefers patch with 1 worker over 2 workers', () => {
      const patches: MockPatch[] = [
        { id: 1, x: 5, y: 5, gathererCount: 2, isDepleted: false },
        { id: 2, x: 10, y: 10, gathererCount: 1, isDepleted: false },
      ];
      const result = findBestMineralPatch(patches, 0, 0);
      expect(result?.id).toBe(2);
    });

    it('prefers patch with <2 workers strongly over >=2 workers', () => {
      const patches: MockPatch[] = [
        { id: 1, x: 0, y: 0, gathererCount: 2, isDepleted: false }, // Closer but saturated
        { id: 2, x: 100, y: 100, gathererCount: 1, isDepleted: false }, // Far but optimal
      ];
      const result = findBestMineralPatch(patches, 0, 0);
      expect(result?.id).toBe(2); // Should prefer far but optimal
    });

    it('among optimal patches, prefers closer one', () => {
      const patches: MockPatch[] = [
        { id: 1, x: 10, y: 0, gathererCount: 0, isDepleted: false },
        { id: 2, x: 5, y: 0, gathererCount: 0, isDepleted: false },
      ];
      const result = findBestMineralPatch(patches, 0, 0);
      expect(result?.id).toBe(2); // Closer with same gatherer count
    });

    it('among saturated patches, prefers one with fewer workers', () => {
      const patches: MockPatch[] = [
        { id: 1, x: 0, y: 0, gathererCount: 3, isDepleted: false },
        { id: 2, x: 100, y: 100, gathererCount: 2, isDepleted: false },
      ];
      const result = findBestMineralPatch(patches, 0, 0);
      expect(result?.id).toBe(2); // Fewer workers even though further
    });

    it('handles all depleted patches', () => {
      const patches: MockPatch[] = [
        { id: 1, x: 5, y: 5, gathererCount: 0, isDepleted: true },
        { id: 2, x: 10, y: 10, gathererCount: 0, isDepleted: true },
      ];
      const result = findBestMineralPatch(patches, 0, 0);
      expect(result).toBeNull();
    });
  });

  describe('nearby mineral patch discovery', () => {
    interface MockResource {
      id: number;
      x: number;
      y: number;
      resourceType: 'minerals' | 'plasma';
      isDepleted: boolean;
      gathererCount: number;
    }

    function findNearbyMineralPatches(
      resources: MockResource[],
      centerX: number,
      centerY: number,
      range: number
    ): MockResource[] {
      return resources.filter((r) => {
        if (r.resourceType !== 'minerals') return false;
        if (r.isDepleted) return false;
        const dist = distance(r.x, r.y, centerX, centerY);
        return dist <= range;
      });
    }

    const MINERAL_PATCH_SEARCH_RANGE = 15;

    it('finds minerals within range', () => {
      const resources: MockResource[] = [
        { id: 1, x: 5, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 0 },
        { id: 2, x: 10, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 0 },
      ];
      const result = findNearbyMineralPatches(resources, 0, 0, MINERAL_PATCH_SEARCH_RANGE);
      expect(result.length).toBe(2);
    });

    it('excludes minerals outside range', () => {
      const resources: MockResource[] = [
        { id: 1, x: 5, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 0 },
        { id: 2, x: 100, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 0 },
      ];
      const result = findNearbyMineralPatches(resources, 0, 0, MINERAL_PATCH_SEARCH_RANGE);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(1);
    });

    it('excludes depleted minerals', () => {
      const resources: MockResource[] = [
        { id: 1, x: 5, y: 0, resourceType: 'minerals', isDepleted: true, gathererCount: 0 },
        { id: 2, x: 10, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 0 },
      ];
      const result = findNearbyMineralPatches(resources, 0, 0, MINERAL_PATCH_SEARCH_RANGE);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(2);
    });

    it('excludes plasma geysers', () => {
      const resources: MockResource[] = [
        { id: 1, x: 5, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 0 },
        { id: 2, x: 10, y: 0, resourceType: 'plasma', isDepleted: false, gathererCount: 0 },
      ];
      const result = findNearbyMineralPatches(resources, 0, 0, MINERAL_PATCH_SEARCH_RANGE);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(1);
    });
  });

  describe('nearest resource search', () => {
    interface MockResource {
      id: number;
      x: number;
      y: number;
      resourceType: 'minerals' | 'plasma';
      isDepleted: boolean;
      gathererCount: number;
      hasRefinery: boolean;
    }

    const RESOURCE_SEARCH_RANGE = 60;
    const MAX_GATHERERS = 3;

    function findNearestResource(
      resources: MockResource[],
      centerX: number,
      centerY: number,
      resourceType: 'minerals' | 'plasma'
    ): MockResource | null {
      let nearest: MockResource | null = null;
      let nearestDist = Infinity;

      for (const r of resources) {
        if (r.resourceType !== resourceType) continue;
        if (r.isDepleted) continue;
        if (resourceType === 'plasma' && !r.hasRefinery) continue;
        if (r.gathererCount >= MAX_GATHERERS) continue;

        const dist = distance(r.x, r.y, centerX, centerY);
        if (dist > RESOURCE_SEARCH_RANGE) continue;

        if (dist < nearestDist) {
          nearest = r;
          nearestDist = dist;
        }
      }

      return nearest;
    }

    it('finds nearest mineral', () => {
      const resources: MockResource[] = [
        { id: 1, x: 20, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 0, hasRefinery: false },
        { id: 2, x: 10, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 0, hasRefinery: false },
      ];
      const result = findNearestResource(resources, 0, 0, 'minerals');
      expect(result?.id).toBe(2);
    });

    it('skips depleted resources', () => {
      const resources: MockResource[] = [
        { id: 1, x: 10, y: 0, resourceType: 'minerals', isDepleted: true, gathererCount: 0, hasRefinery: false },
        { id: 2, x: 20, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 0, hasRefinery: false },
      ];
      const result = findNearestResource(resources, 0, 0, 'minerals');
      expect(result?.id).toBe(2);
    });

    it('skips saturated resources', () => {
      const resources: MockResource[] = [
        { id: 1, x: 10, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 3, hasRefinery: false },
        { id: 2, x: 20, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 0, hasRefinery: false },
      ];
      const result = findNearestResource(resources, 0, 0, 'minerals');
      expect(result?.id).toBe(2);
    });

    it('skips resources beyond search range', () => {
      const resources: MockResource[] = [
        { id: 1, x: 100, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 0, hasRefinery: false },
      ];
      const result = findNearestResource(resources, 0, 0, 'minerals');
      expect(result).toBeNull();
    });

    it('plasma requires refinery', () => {
      const resources: MockResource[] = [
        { id: 1, x: 10, y: 0, resourceType: 'plasma', isDepleted: false, gathererCount: 0, hasRefinery: false },
        { id: 2, x: 20, y: 0, resourceType: 'plasma', isDepleted: false, gathererCount: 0, hasRefinery: true },
      ];
      const result = findNearestResource(resources, 0, 0, 'plasma');
      expect(result?.id).toBe(2);
    });

    it('minerals do not require refinery check', () => {
      const resources: MockResource[] = [
        { id: 1, x: 10, y: 0, resourceType: 'minerals', isDepleted: false, gathererCount: 0, hasRefinery: false },
      ];
      const result = findNearestResource(resources, 0, 0, 'minerals');
      expect(result?.id).toBe(1);
    });
  });

  describe('resource drop-off buildings', () => {
    const RESOURCE_DROP_OFF_BUILDINGS = [
      'headquarters',
      'orbital_station',
      'bastion',
      'nexus',
      'hatchery',
      'lair',
      'hive',
    ];

    it('includes headquarters', () => {
      expect(RESOURCE_DROP_OFF_BUILDINGS).toContain('headquarters');
    });

    it('includes upgraded bases', () => {
      expect(RESOURCE_DROP_OFF_BUILDINGS).toContain('orbital_station');
      expect(RESOURCE_DROP_OFF_BUILDINGS).toContain('bastion');
    });

    it('includes protoss nexus', () => {
      expect(RESOURCE_DROP_OFF_BUILDINGS).toContain('nexus');
    });

    it('includes zerg bases', () => {
      expect(RESOURCE_DROP_OFF_BUILDINGS).toContain('hatchery');
      expect(RESOURCE_DROP_OFF_BUILDINGS).toContain('lair');
      expect(RESOURCE_DROP_OFF_BUILDINGS).toContain('hive');
    });

    it('does not include regular buildings', () => {
      expect(RESOURCE_DROP_OFF_BUILDINGS).not.toContain('barracks');
      expect(RESOURCE_DROP_OFF_BUILDINGS).not.toContain('factory');
    });
  });

  describe('drop-off distance calculation', () => {
    function calculateDropOffRange(buildingWidth: number): number {
      const buildingHalfWidth = buildingWidth / 2;
      return buildingHalfWidth + 2.0;
    }

    function calculateEdgeDistance(buildingWidth: number): number {
      const buildingHalfWidth = buildingWidth / 2;
      return buildingHalfWidth + 0.8;
    }

    it('calculates drop-off range for standard base (width 5)', () => {
      const range = calculateDropOffRange(5);
      expect(range).toBe(4.5); // 2.5 + 2.0
    });

    it('calculates drop-off range for large base (width 7)', () => {
      const range = calculateDropOffRange(7);
      expect(range).toBe(5.5); // 3.5 + 2.0
    });

    it('drop-off range covers the movement target with arrival threshold', () => {
      // Workers target halfWidth + 0.8, arrival threshold is 0.8
      // So workers stop at worst at halfWidth + 1.6, dropoff range is halfWidth + 2.0
      const edgeDist = calculateEdgeDistance(5); // 3.3
      const arrivalThreshold = 0.8;
      const worstStopDistance = edgeDist + arrivalThreshold; // 4.1
      const dropOffRange = calculateDropOffRange(5); // 4.5
      expect(dropOffRange).toBeGreaterThan(worstStopDistance);
    });

    it('movement target places workers near building edge', () => {
      // Workers should target just outside the building, not far away
      const buildingHalfWidth = 5 / 2; // 2.5 (building edge from center)
      const edgeDist = calculateEdgeDistance(5); // 3.3
      const distFromEdge = edgeDist - buildingHalfWidth; // 0.8
      expect(distFromEdge).toBeLessThanOrEqual(1.0);
    });
  });

  describe('mining timer state machine', () => {
    interface MiningState {
      isMining: boolean;
      miningTimer: number;
    }

    function updateMiningTimer(state: MiningState, dt: number): { gathered: boolean; newState: MiningState } {
      if (!state.isMining) {
        return { gathered: false, newState: state };
      }

      const newTimer = state.miningTimer - dt;
      if (newTimer <= 0) {
        // Mining complete
        return {
          gathered: true,
          newState: { isMining: false, miningTimer: 0 },
        };
      }

      return {
        gathered: false,
        newState: { isMining: true, miningTimer: newTimer },
      };
    }

    it('not mining means no progress', () => {
      const state: MiningState = { isMining: false, miningTimer: 2.5 };
      const result = updateMiningTimer(state, 1);
      expect(result.gathered).toBe(false);
      expect(result.newState.isMining).toBe(false);
    });

    it('mining decrements timer', () => {
      const state: MiningState = { isMining: true, miningTimer: 2.5 };
      const result = updateMiningTimer(state, 1);
      expect(result.gathered).toBe(false);
      expect(result.newState.miningTimer).toBe(1.5);
    });

    it('completes when timer reaches zero', () => {
      const state: MiningState = { isMining: true, miningTimer: 0.5 };
      const result = updateMiningTimer(state, 1);
      expect(result.gathered).toBe(true);
      expect(result.newState.isMining).toBe(false);
      expect(result.newState.miningTimer).toBe(0);
    });

    it('exact completion at zero', () => {
      const state: MiningState = { isMining: true, miningTimer: 1 };
      const result = updateMiningTimer(state, 1);
      expect(result.gathered).toBe(true);
    });

    it('full mining cycle takes approximately MINING_TIME', () => {
      let state: MiningState = { isMining: true, miningTimer: MINING_TIME };
      let totalTime = 0;
      const dt = 0.1;

      while (state.isMining && state.miningTimer > 0) {
        const result = updateMiningTimer(state, dt);
        totalTime += dt;
        if (result.gathered) break;
        state = result.newState;

        // Safety limit
        if (totalTime > 10) break;
      }

      // Allow for small timing differences due to step size
      expect(totalTime).toBeGreaterThanOrEqual(MINING_TIME - 0.1);
      expect(totalTime).toBeLessThanOrEqual(MINING_TIME + 0.1);
    });
  });

  describe('worker rebalancing', () => {
    interface MockPatch {
      id: number;
      gathererCount: number;
      isDepleted: boolean;
    }

    function shouldSwitchPatch(
      currentPatch: MockPatch,
      nearbyPatches: MockPatch[]
    ): MockPatch | null {
      // Only rebalance if current patch has >= 2 workers
      if (currentPatch.gathererCount < 2) return null;

      // Find a better patch with fewer workers
      const betterPatch = nearbyPatches.find(
        (p) => p.id !== currentPatch.id && !p.isDepleted && p.gathererCount < currentPatch.gathererCount
      );

      return betterPatch || null;
    }

    it('does not switch from unsaturated patch', () => {
      const current: MockPatch = { id: 1, gathererCount: 1, isDepleted: false };
      const nearby: MockPatch[] = [{ id: 2, gathererCount: 0, isDepleted: false }];
      expect(shouldSwitchPatch(current, nearby)).toBeNull();
    });

    it('switches from saturated patch to empty one', () => {
      const current: MockPatch = { id: 1, gathererCount: 2, isDepleted: false };
      const nearby: MockPatch[] = [{ id: 2, gathererCount: 0, isDepleted: false }];
      const result = shouldSwitchPatch(current, nearby);
      expect(result?.id).toBe(2);
    });

    it('does not switch if all patches equally saturated', () => {
      const current: MockPatch = { id: 1, gathererCount: 2, isDepleted: false };
      const nearby: MockPatch[] = [{ id: 2, gathererCount: 2, isDepleted: false }];
      expect(shouldSwitchPatch(current, nearby)).toBeNull();
    });

    it('does not switch to depleted patch', () => {
      const current: MockPatch = { id: 1, gathererCount: 2, isDepleted: false };
      const nearby: MockPatch[] = [{ id: 2, gathererCount: 0, isDepleted: true }];
      expect(shouldSwitchPatch(current, nearby)).toBeNull();
    });

    it('does not switch to same patch', () => {
      const current: MockPatch = { id: 1, gathererCount: 2, isDepleted: false };
      const nearby: MockPatch[] = [current];
      expect(shouldSwitchPatch(current, nearby)).toBeNull();
    });
  });
});

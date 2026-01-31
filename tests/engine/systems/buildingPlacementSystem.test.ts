import { describe, it, expect } from 'vitest';

/**
 * BuildingPlacementSystem Tests
 *
 * Tests for building placement validation:
 * 1. AABB collision detection
 * 2. Map bounds checking
 * 3. Worker priority selection
 * 4. Unit displacement calculation
 * 5. Building dependencies
 */

describe('BuildingPlacementSystem', () => {
  describe('AABB collision detection', () => {
    interface AABB {
      x: number;
      y: number;
      width: number;
      height: number;
    }

    function aabbIntersects(a: AABB, b: AABB): boolean {
      const aLeft = a.x - a.width / 2;
      const aRight = a.x + a.width / 2;
      const aTop = a.y - a.height / 2;
      const aBottom = a.y + a.height / 2;

      const bLeft = b.x - b.width / 2;
      const bRight = b.x + b.width / 2;
      const bTop = b.y - b.height / 2;
      const bBottom = b.y + b.height / 2;

      return aLeft < bRight && aRight > bLeft && aTop < bBottom && aBottom > bTop;
    }

    it('detects overlapping buildings', () => {
      const a: AABB = { x: 10, y: 10, width: 4, height: 4 };
      const b: AABB = { x: 12, y: 10, width: 4, height: 4 };
      expect(aabbIntersects(a, b)).toBe(true);
    });

    it('detects non-overlapping buildings', () => {
      const a: AABB = { x: 10, y: 10, width: 4, height: 4 };
      const b: AABB = { x: 20, y: 10, width: 4, height: 4 };
      expect(aabbIntersects(a, b)).toBe(false);
    });

    it('touching edges do not intersect', () => {
      const a: AABB = { x: 10, y: 10, width: 4, height: 4 };
      const b: AABB = { x: 14, y: 10, width: 4, height: 4 }; // Exactly touching
      expect(aabbIntersects(a, b)).toBe(false);
    });

    it('detects contained building', () => {
      const large: AABB = { x: 10, y: 10, width: 10, height: 10 };
      const small: AABB = { x: 10, y: 10, width: 2, height: 2 };
      expect(aabbIntersects(large, small)).toBe(true);
    });

    it('handles different sized buildings', () => {
      const a: AABB = { x: 10, y: 10, width: 5, height: 5 };
      const b: AABB = { x: 13, y: 10, width: 3, height: 3 }; // Overlapping
      expect(aabbIntersects(a, b)).toBe(true);
    });
  });

  describe('map bounds checking', () => {
    function isWithinBounds(
      buildingX: number,
      buildingY: number,
      width: number,
      height: number,
      mapWidth: number,
      mapHeight: number
    ): boolean {
      const halfW = width / 2;
      const halfH = height / 2;
      return (
        buildingX - halfW >= 0 &&
        buildingX + halfW <= mapWidth &&
        buildingY - halfH >= 0 &&
        buildingY + halfH <= mapHeight
      );
    }

    it('allows centered building', () => {
      expect(isWithinBounds(50, 50, 4, 4, 100, 100)).toBe(true);
    });

    it('allows building at edge', () => {
      expect(isWithinBounds(2, 2, 4, 4, 100, 100)).toBe(true);
    });

    it('rejects building extending beyond left edge', () => {
      expect(isWithinBounds(1, 50, 4, 4, 100, 100)).toBe(false);
    });

    it('rejects building extending beyond right edge', () => {
      expect(isWithinBounds(99, 50, 4, 4, 100, 100)).toBe(false);
    });

    it('rejects building extending beyond top edge', () => {
      expect(isWithinBounds(50, 1, 4, 4, 100, 100)).toBe(false);
    });

    it('rejects building extending beyond bottom edge', () => {
      expect(isWithinBounds(50, 99, 4, 4, 100, 100)).toBe(false);
    });
  });

  describe('worker priority selection', () => {
    type WorkerState = 'specific' | 'selected' | 'idle' | 'gathering' | 'moving' | 'other';

    function getWorkerPriority(state: WorkerState, isSpecific: boolean, isSelected: boolean): number {
      if (isSpecific) return 100;
      if (isSelected) return 90;
      switch (state) {
        case 'idle':
          return 80;
        case 'gathering':
          return 70;
        case 'moving':
          return 60;
        default:
          return 0;
      }
    }

    function selectWorker(
      workers: Array<{ id: number; state: WorkerState; isSpecific: boolean; isSelected: boolean; distance: number }>
    ): number | null {
      if (workers.length === 0) return null;

      workers.sort((a, b) => {
        const aPriority = getWorkerPriority(a.state, a.isSpecific, a.isSelected);
        const bPriority = getWorkerPriority(b.state, b.isSpecific, b.isSelected);
        if (aPriority !== bPriority) return bPriority - aPriority;
        return a.distance - b.distance;
      });

      return workers[0].id;
    }

    it('prefers specifically assigned worker', () => {
      const workers = [
        { id: 1, state: 'idle' as WorkerState, isSpecific: false, isSelected: false, distance: 5 },
        { id: 2, state: 'moving' as WorkerState, isSpecific: true, isSelected: false, distance: 10 },
      ];
      expect(selectWorker(workers)).toBe(2);
    });

    it('prefers selected worker over idle', () => {
      const workers = [
        { id: 1, state: 'idle' as WorkerState, isSpecific: false, isSelected: false, distance: 5 },
        { id: 2, state: 'moving' as WorkerState, isSpecific: false, isSelected: true, distance: 10 },
      ];
      expect(selectWorker(workers)).toBe(2);
    });

    it('prefers idle over gathering', () => {
      const workers = [
        { id: 1, state: 'gathering' as WorkerState, isSpecific: false, isSelected: false, distance: 5 },
        { id: 2, state: 'idle' as WorkerState, isSpecific: false, isSelected: false, distance: 10 },
      ];
      expect(selectWorker(workers)).toBe(2);
    });

    it('breaks ties by distance', () => {
      const workers = [
        { id: 1, state: 'idle' as WorkerState, isSpecific: false, isSelected: false, distance: 10 },
        { id: 2, state: 'idle' as WorkerState, isSpecific: false, isSelected: false, distance: 5 },
      ];
      expect(selectWorker(workers)).toBe(2);
    });
  });

  describe('unit displacement calculation', () => {
    function calculatePushDirection(
      unitX: number,
      unitY: number,
      buildingX: number,
      buildingY: number,
      buildingWidth: number,
      buildingHeight: number
    ): { dx: number; dy: number } {
      const halfW = buildingWidth / 2;
      const halfH = buildingHeight / 2;

      // Find nearest edge
      const leftDist = (buildingX - halfW) - unitX;
      const rightDist = unitX - (buildingX + halfW);
      const topDist = (buildingY - halfH) - unitY;
      const bottomDist = unitY - (buildingY + halfH);

      // Find the smallest positive distance (nearest edge outside)
      // or smallest negative distance (nearest edge to push through)
      const distances = [
        { dx: -1, dy: 0, dist: -leftDist },
        { dx: 1, dy: 0, dist: -rightDist },
        { dx: 0, dy: -1, dist: -topDist },
        { dx: 0, dy: 1, dist: -bottomDist },
      ];

      distances.sort((a, b) => a.dist - b.dist);
      return { dx: distances[0].dx, dy: distances[0].dy };
    }

    it('pushes unit left when nearest to left edge', () => {
      const result = calculatePushDirection(8, 10, 10, 10, 4, 4);
      expect(result.dx).toBe(-1);
      expect(result.dy).toBe(0);
    });

    it('pushes unit right when nearest to right edge', () => {
      const result = calculatePushDirection(12, 10, 10, 10, 4, 4);
      expect(result.dx).toBe(1);
      expect(result.dy).toBe(0);
    });

    it('pushes unit up when nearest to top edge', () => {
      const result = calculatePushDirection(10, 8, 10, 10, 4, 4);
      expect(result.dx).toBe(0);
      expect(result.dy).toBe(-1);
    });

    it('pushes unit down when nearest to bottom edge', () => {
      const result = calculatePushDirection(10, 12, 10, 10, 4, 4);
      expect(result.dx).toBe(0);
      expect(result.dy).toBe(1);
    });
  });

  describe('building dependency checking', () => {
    const BUILDING_REQUIREMENTS: Record<string, string[]> = {
      barracks: ['headquarters'],
      factory: ['barracks'],
      starport: ['factory'],
      armory: ['factory'],
      tech_lab: [],
      reactor: [],
    };

    function checkDependencies(
      buildingType: string,
      ownedBuildings: Set<string>
    ): { canBuild: boolean; missingRequirements: string[] } {
      const requirements = BUILDING_REQUIREMENTS[buildingType] || [];
      const missing = requirements.filter((req) => !ownedBuildings.has(req));
      return {
        canBuild: missing.length === 0,
        missingRequirements: missing,
      };
    }

    it('allows building with no requirements', () => {
      const result = checkDependencies('tech_lab', new Set());
      expect(result.canBuild).toBe(true);
      expect(result.missingRequirements).toHaveLength(0);
    });

    it('allows building when requirements met', () => {
      const owned = new Set(['headquarters']);
      const result = checkDependencies('barracks', owned);
      expect(result.canBuild).toBe(true);
    });

    it('blocks building when requirements missing', () => {
      const owned = new Set<string>();
      const result = checkDependencies('barracks', owned);
      expect(result.canBuild).toBe(false);
      expect(result.missingRequirements).toContain('headquarters');
    });

    it('handles chain dependencies', () => {
      const owned = new Set(['headquarters']);
      const result = checkDependencies('factory', owned);
      expect(result.canBuild).toBe(false);
      expect(result.missingRequirements).toContain('barracks');
    });

    it('allows building with full tech tree', () => {
      const owned = new Set(['headquarters', 'barracks', 'factory']);
      const result = checkDependencies('starport', owned);
      expect(result.canBuild).toBe(true);
    });
  });

  describe('addon placement validation', () => {
    function isValidAddonPosition(
      buildingX: number,
      buildingY: number,
      buildingWidth: number,
      addonWidth: number
    ): { x: number; y: number } {
      // Addon is placed to the right of the building
      return {
        x: buildingX + buildingWidth / 2 + addonWidth / 2,
        y: buildingY,
      };
    }

    function hasAddonSpace(
      buildingX: number,
      buildingY: number,
      buildingWidth: number,
      addonWidth: number,
      addonHeight: number,
      existingBuildings: Array<{ x: number; y: number; width: number; height: number }>
    ): boolean {
      const addonPos = isValidAddonPosition(buildingX, buildingY, buildingWidth, addonWidth);

      for (const existing of existingBuildings) {
        const dx = Math.abs(addonPos.x - existing.x);
        const dy = Math.abs(addonPos.y - existing.y);
        if (dx < (addonWidth + existing.width) / 2 && dy < (addonHeight + existing.height) / 2) {
          return false;
        }
      }
      return true;
    }

    it('calculates addon position to right of building', () => {
      const pos = isValidAddonPosition(10, 10, 4, 2);
      expect(pos.x).toBe(13); // 10 + 4/2 + 2/2
      expect(pos.y).toBe(10);
    });

    it('allows addon with clear space', () => {
      const existing = [{ x: 20, y: 10, width: 4, height: 4 }];
      expect(hasAddonSpace(10, 10, 4, 2, 2, existing)).toBe(true);
    });

    it('blocks addon with collision', () => {
      const existing = [{ x: 13, y: 10, width: 2, height: 2 }];
      expect(hasAddonSpace(10, 10, 4, 2, 2, existing)).toBe(false);
    });
  });
});

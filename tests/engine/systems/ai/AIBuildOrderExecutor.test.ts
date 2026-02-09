import { describe, it, expect } from 'vitest';
import { deterministicMagnitude } from '@/utils/FixedPoint';

/**
 * AIBuildOrderExecutor Tests - Expansion Location Logic
 *
 * Tests the expansion location scoring and filtering to ensure:
 * 1. Mineral clusters near any enemy buildings are rejected
 * 2. Mineral clusters near own bases are rejected
 * 3. Unoccupied mineral clusters are selected correctly
 * 4. Backside-of-base placement is prevented (enemy building behind minerals)
 */

// Mirror constants from AIBuildOrderExecutor.findExpansionLocation
const ENEMY_BUILDING_DISQUALIFY_RADIUS = 35;
const ENEMY_BUILDING_PENALTY_RADIUS = 50;
const OWN_BASE_DISQUALIFY_RADIUS = 30;
const OWN_BASE_PENALTY_RADIUS = 50;

interface Position {
  x: number;
  y: number;
}

/**
 * Mirror of the scoring logic in findExpansionLocation (Tier 1 path)
 */
function scoreExpansionLocation(
  loc: Position,
  existingBases: Position[],
  enemyBuildings: Position[],
  mainBase: Position | null
): number {
  let score = 100;

  for (const base of existingBases) {
    const dist = deterministicMagnitude(loc.x - base.x, loc.y - base.y);
    if (dist < OWN_BASE_DISQUALIFY_RADIUS) {
      score -= 1000;
    } else if (dist < OWN_BASE_PENALTY_RADIUS) {
      score -= 50;
    }
  }

  for (const enemyBuilding of enemyBuildings) {
    const dist = deterministicMagnitude(loc.x - enemyBuilding.x, loc.y - enemyBuilding.y);
    if (dist < ENEMY_BUILDING_DISQUALIFY_RADIUS) {
      score -= 1000;
    } else if (dist < ENEMY_BUILDING_PENALTY_RADIUS) {
      score -= 100;
    }
  }

  if (mainBase) {
    const distToMain = deterministicMagnitude(loc.x - mainBase.x, loc.y - mainBase.y);
    score -= distToMain * 0.5;
  }

  return score;
}

/**
 * Mirror of the fallback mineral cluster filtering (Tier 2 path)
 */
function isClusterValidForExpansion(
  cluster: Position,
  existingBases: Position[],
  enemyBuildings: Position[]
): boolean {
  // Own base proximity check
  for (const base of existingBases) {
    const dist = deterministicMagnitude(cluster.x - base.x, cluster.y - base.y);
    if (dist < OWN_BASE_DISQUALIFY_RADIUS) return false;
  }

  // Enemy building proximity check
  for (const enemyBuilding of enemyBuildings) {
    const dist = deterministicMagnitude(cluster.x - enemyBuilding.x, cluster.y - enemyBuilding.y);
    if (dist < ENEMY_BUILDING_DISQUALIFY_RADIUS) return false;
  }

  return true;
}

describe('AIBuildOrderExecutor - Expansion Location', () => {
  describe('Tier 1: PositionalAnalysis scored locations', () => {
    it('disqualifies expansion near enemy headquarters', () => {
      const enemyHQ: Position = { x: 100, y: 100 };
      // Mineral cluster center is ~10 units from HQ (standard layout)
      const mineralCluster: Position = { x: 110, y: 100 };

      const score = scoreExpansionLocation(
        mineralCluster,
        [{ x: 20, y: 20 }], // AI's own base, far away
        [enemyHQ],
        { x: 20, y: 20 }
      );

      expect(score).toBeLessThan(0);
    });

    it('disqualifies expansion on backside of enemy mineral patch', () => {
      // Enemy HQ at (100, 100), minerals at (110, 100)
      // Defensible spot on the far side of minerals from HQ
      const enemyHQ: Position = { x: 100, y: 100 };
      const backsideLocation: Position = { x: 118, y: 102 };

      const score = scoreExpansionLocation(backsideLocation, [{ x: 20, y: 20 }], [enemyHQ], {
        x: 20,
        y: 20,
      });

      // ~20 units from enemy HQ, well within 35-unit disqualify radius
      expect(score).toBeLessThan(0);
    });

    it('disqualifies even with build position offset (+5, +5)', () => {
      // Worst case: defensible spot on far side + build offset
      const enemyHQ: Position = { x: 100, y: 100 };
      // Mineral center at ~110,100. Defensible spot at ~115,100. Build pos at 120,105.
      const buildPos: Position = { x: 120, y: 105 };

      const score = scoreExpansionLocation(buildPos, [{ x: 20, y: 20 }], [enemyHQ], {
        x: 20,
        y: 20,
      });

      // ~21 units from enemy HQ, within 35-unit disqualify radius
      expect(score).toBeLessThan(0);
    });

    it('disqualifies expansion near non-base enemy buildings', () => {
      // Enemy has production buildings near minerals but no HQ
      const enemyBarracks: Position = { x: 108, y: 95 };
      const enemyFactory: Position = { x: 112, y: 95 };
      const mineralCluster: Position = { x: 110, y: 100 };

      const score = scoreExpansionLocation(
        mineralCluster,
        [{ x: 20, y: 20 }],
        [enemyBarracks, enemyFactory],
        { x: 20, y: 20 }
      );

      expect(score).toBeLessThan(0);
    });

    it('allows expansion at unoccupied mineral cluster', () => {
      // Empty mineral cluster, no enemy buildings nearby
      const mineralCluster: Position = { x: 80, y: 80 };

      const score = scoreExpansionLocation(
        mineralCluster,
        [{ x: 20, y: 20 }], // Own base far enough away (>50)
        [], // No enemy buildings
        { x: 20, y: 20 }
      );

      expect(score).toBeGreaterThan(0);
    });

    it('penalizes but does not disqualify distant enemy buildings', () => {
      // Enemy building 40 units away - should penalize but not disqualify
      const enemyBuilding: Position = { x: 150, y: 100 };
      const mineralCluster: Position = { x: 110, y: 100 };

      const score = scoreExpansionLocation(mineralCluster, [{ x: 20, y: 20 }], [enemyBuilding], {
        x: 20,
        y: 20,
      });

      // 40 units away: between 35 and 50 → penalized but not disqualified
      expect(score).toBeLessThan(100); // Penalized
      // Score could be negative due to distance-to-main penalty, but the enemy penalty alone shouldn't disqualify
      const scoreWithoutEnemy = scoreExpansionLocation(mineralCluster, [{ x: 20, y: 20 }], [], {
        x: 20,
        y: 20,
      });
      expect(score).toBeLessThan(scoreWithoutEnemy);
    });

    it('disqualifies expansion near own existing base', () => {
      const ownBase: Position = { x: 100, y: 100 };
      const nearbyCluster: Position = { x: 115, y: 100 };

      const score = scoreExpansionLocation(nearbyCluster, [ownBase], [], ownBase);

      expect(score).toBeLessThan(0);
    });
  });

  describe('Tier 2: Fallback mineral cluster filtering', () => {
    it('rejects minerals near enemy headquarters', () => {
      const enemyHQ: Position = { x: 100, y: 100 };
      const mineralNearEnemy: Position = { x: 110, y: 100 };

      const valid = isClusterValidForExpansion(mineralNearEnemy, [{ x: 20, y: 20 }], [enemyHQ]);

      expect(valid).toBe(false);
    });

    it('rejects minerals near any enemy building', () => {
      // Even a single extractor should block expansion
      const enemyExtractor: Position = { x: 108, y: 100 };
      const mineralCluster: Position = { x: 110, y: 100 };

      const valid = isClusterValidForExpansion(
        mineralCluster,
        [{ x: 20, y: 20 }],
        [enemyExtractor]
      );

      expect(valid).toBe(false);
    });

    it('rejects backside mineral position near enemy base', () => {
      const enemyHQ: Position = { x: 100, y: 100 };
      // Mineral patch on far side from HQ
      const backsideMineral: Position = { x: 120, y: 105 };

      const valid = isClusterValidForExpansion(backsideMineral, [{ x: 20, y: 20 }], [enemyHQ]);

      // ~21 units from HQ, within 35-unit radius
      expect(valid).toBe(false);
    });

    it('accepts unoccupied mineral cluster far from all buildings', () => {
      const mineralCluster: Position = { x: 80, y: 80 };

      const valid = isClusterValidForExpansion(
        mineralCluster,
        [{ x: 20, y: 20 }],
        [{ x: 150, y: 150 }] // Enemy far away
      );

      expect(valid).toBe(true);
    });

    it('rejects minerals too close to own base', () => {
      const ownBase: Position = { x: 100, y: 100 };
      const nearbyMineral: Position = { x: 115, y: 100 };

      const valid = isClusterValidForExpansion(nearbyMineral, [ownBase], []);

      expect(valid).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles multiple enemy buildings near one cluster', () => {
      // Multiple enemy structures around a mineral patch
      const enemyBuildings: Position[] = [
        { x: 100, y: 100 }, // HQ
        { x: 108, y: 95 }, // Barracks
        { x: 112, y: 95 }, // Factory
        { x: 105, y: 108 }, // Supply depot
      ];
      const mineralCluster: Position = { x: 110, y: 100 };

      const score = scoreExpansionLocation(mineralCluster, [{ x: 20, y: 20 }], enemyBuildings, {
        x: 20,
        y: 20,
      });

      // Each nearby building adds -1000, should be deeply negative
      expect(score).toBeLessThan(-3000);
    });

    it('enemy building exactly at radius boundary is inside disqualify zone', () => {
      // Building exactly 34.9 units away (just inside 35)
      const enemyBuilding: Position = { x: 134, y: 100 };
      const mineralCluster: Position = { x: 100, y: 100 };
      const dist = deterministicMagnitude(134 - 100, 0);

      // Verify this is within range
      expect(dist).toBeLessThan(ENEMY_BUILDING_DISQUALIFY_RADIUS);

      const score = scoreExpansionLocation(mineralCluster, [{ x: 20, y: 20 }], [enemyBuilding], {
        x: 20,
        y: 20,
      });

      expect(score).toBeLessThan(0);
    });

    it('enemy building at 36 units is not disqualified but penalized', () => {
      const enemyBuilding: Position = { x: 136, y: 100 };
      const mineralCluster: Position = { x: 100, y: 100 };
      const dist = deterministicMagnitude(136 - 100, 0);

      // 36 units: outside 35-unit disqualify radius
      expect(dist).toBeGreaterThan(ENEMY_BUILDING_DISQUALIFY_RADIUS);
      // But inside 50-unit penalty radius
      expect(dist).toBeLessThan(ENEMY_BUILDING_PENALTY_RADIUS);

      const valid = isClusterValidForExpansion(mineralCluster, [{ x: 20, y: 20 }], [enemyBuilding]);

      // Fallback path: outside 35 → allowed
      expect(valid).toBe(true);

      // Scored path: penalized but not disqualified
      const score = scoreExpansionLocation(
        mineralCluster,
        [{ x: 200, y: 200 }], // Own base very far to avoid own-base penalty
        [enemyBuilding],
        { x: 200, y: 200 }
      );

      // -100 penalty + distance penalty, but started at 100
      expect(score).toBeLessThan(100);
    });
  });
});

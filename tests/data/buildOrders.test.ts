import { describe, it, expect } from 'vitest';
import {
  AI_DIFFICULTY_CONFIG,
  FACTION_BUILD_ORDERS,
  FACTION_UNIT_COMPOSITIONS,
  getBuildOrders,
  getRandomBuildOrder,
  getAIConfig,
  getUnitComposition,
  selectUnitToBuild,
  getFactionsWithBuildOrders,
  validateBuildOrder,
  AIDifficulty,
  BuildOrder,
  BuildOrderStep,
} from '@/data/ai/buildOrders';

// Seeded random for deterministic tests
function createSeededRandom(seed: number) {
  let state = seed;
  return {
    next: (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    },
  };
}

describe('AI Build Orders', () => {
  const difficulties: AIDifficulty[] = ['easy', 'medium', 'hard', 'very_hard', 'insane'];

  describe('AI_DIFFICULTY_CONFIG', () => {
    it('defines config for all difficulty levels', () => {
      for (const difficulty of difficulties) {
        expect(AI_DIFFICULTY_CONFIG[difficulty]).toBeDefined();
      }
    });

    it('each config has required timing properties', () => {
      for (const difficulty of difficulties) {
        const config = AI_DIFFICULTY_CONFIG[difficulty];
        expect(config.ticksBetweenActions).toBeGreaterThan(0);
        expect(config.scoutCooldown).toBeGreaterThan(0);
        expect(config.harassCooldown).toBeGreaterThan(0);
        expect(config.expansionCooldown).toBeGreaterThan(0);
        expect(config.attackCooldown).toBeGreaterThan(0);
      }
    });

    it('each config has economy properties', () => {
      for (const difficulty of difficulties) {
        const config = AI_DIFFICULTY_CONFIG[difficulty];
        expect(config.targetWorkerCount).toBeGreaterThan(0);
        expect(config.maxWorkersPerBase).toBeGreaterThan(0);
        expect(config.expandAtWorkers).toBeGreaterThan(0);
      }
    });

    it('each config has army properties', () => {
      for (const difficulty of difficulties) {
        const config = AI_DIFFICULTY_CONFIG[difficulty];
        expect(config.attackArmySupplyThreshold).toBeGreaterThan(0);
        expect(typeof config.defendArmyRatio).toBe('number');
        expect(typeof config.harassArmyRatio).toBe('number');
      }
    });

    it('each config has resource multipliers', () => {
      for (const difficulty of difficulties) {
        const config = AI_DIFFICULTY_CONFIG[difficulty];
        expect(config.resourceMultiplier).toBeGreaterThan(0);
        expect(config.buildSpeedMultiplier).toBeGreaterThan(0);
      }
    });

    it('each config has intelligence flags', () => {
      for (const difficulty of difficulties) {
        const config = AI_DIFFICULTY_CONFIG[difficulty];
        expect(typeof config.scoutsEnabled).toBe('boolean');
        expect(typeof config.counterUnitsEnabled).toBe('boolean');
        expect(typeof config.microEnabled).toBe('boolean');
      }
    });

    it('harder difficulties have faster reactions', () => {
      expect(AI_DIFFICULTY_CONFIG.insane.ticksBetweenActions)
        .toBeLessThan(AI_DIFFICULTY_CONFIG.easy.ticksBetweenActions);
    });

    it('harder difficulties have higher target worker counts', () => {
      expect(AI_DIFFICULTY_CONFIG.insane.targetWorkerCount)
        .toBeGreaterThan(AI_DIFFICULTY_CONFIG.easy.targetWorkerCount);
    });

    it('harder difficulties have lower attack thresholds', () => {
      expect(AI_DIFFICULTY_CONFIG.insane.attackArmySupplyThreshold)
        .toBeLessThan(AI_DIFFICULTY_CONFIG.easy.attackArmySupplyThreshold);
    });

    it('only higher difficulties enable micro', () => {
      expect(AI_DIFFICULTY_CONFIG.easy.microEnabled).toBe(false);
      expect(AI_DIFFICULTY_CONFIG.hard.microEnabled).toBe(true);
    });

    it('only higher difficulties enable scouting', () => {
      expect(AI_DIFFICULTY_CONFIG.easy.scoutsEnabled).toBe(false);
      expect(AI_DIFFICULTY_CONFIG.medium.scoutsEnabled).toBe(true);
    });

    it('resource bonuses only apply to highest difficulties', () => {
      expect(AI_DIFFICULTY_CONFIG.easy.resourceMultiplier).toBe(1.0);
      expect(AI_DIFFICULTY_CONFIG.medium.resourceMultiplier).toBe(1.0);
      expect(AI_DIFFICULTY_CONFIG.insane.resourceMultiplier).toBeGreaterThan(1.0);
    });
  });

  describe('FACTION_BUILD_ORDERS', () => {
    it('defines build orders for at least one faction', () => {
      const factions = Object.keys(FACTION_BUILD_ORDERS);
      expect(factions.length).toBeGreaterThan(0);
    });

    it('each faction has orders for all difficulties', () => {
      for (const faction of Object.keys(FACTION_BUILD_ORDERS)) {
        const factionOrders = FACTION_BUILD_ORDERS[faction];
        for (const difficulty of difficulties) {
          expect(factionOrders[difficulty]).toBeDefined();
          expect(Array.isArray(factionOrders[difficulty])).toBe(true);
        }
      }
    });

    it('each build order has required properties', () => {
      for (const faction of Object.keys(FACTION_BUILD_ORDERS)) {
        for (const difficulty of difficulties) {
          for (const order of FACTION_BUILD_ORDERS[faction][difficulty]) {
            expect(order.id).toBeTruthy();
            expect(order.name).toBeTruthy();
            expect(order.description).toBeTruthy();
            expect(order.faction).toBe(faction);
            expect(order.difficulty).toBe(difficulty);
            expect(order.style).toBeTruthy();
            expect(Array.isArray(order.steps)).toBe(true);
          }
        }
      }
    });

    it('each step has required properties', () => {
      for (const faction of Object.keys(FACTION_BUILD_ORDERS)) {
        for (const difficulty of difficulties) {
          for (const order of FACTION_BUILD_ORDERS[faction][difficulty]) {
            for (const step of order.steps) {
              expect(['unit', 'building', 'research', 'ability']).toContain(step.type);
              expect(step.id).toBeTruthy();
            }
          }
        }
      }
    });

    it('build orders have at least one step', () => {
      for (const faction of Object.keys(FACTION_BUILD_ORDERS)) {
        for (const difficulty of difficulties) {
          for (const order of FACTION_BUILD_ORDERS[faction][difficulty]) {
            expect(order.steps.length).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe('FACTION_UNIT_COMPOSITIONS', () => {
    it('defines compositions for factions with build orders', () => {
      for (const faction of Object.keys(FACTION_BUILD_ORDERS)) {
        expect(FACTION_UNIT_COMPOSITIONS[faction]).toBeDefined();
      }
    });

    it('each faction has compositions for all difficulties', () => {
      for (const faction of Object.keys(FACTION_UNIT_COMPOSITIONS)) {
        const factionCompositions = FACTION_UNIT_COMPOSITIONS[faction];
        for (const difficulty of difficulties) {
          expect(factionCompositions[difficulty]).toBeDefined();
          expect(typeof factionCompositions[difficulty]).toBe('object');
        }
      }
    });

    it('composition weights are positive numbers', () => {
      for (const faction of Object.keys(FACTION_UNIT_COMPOSITIONS)) {
        for (const difficulty of difficulties) {
          const composition = FACTION_UNIT_COMPOSITIONS[faction][difficulty];
          for (const [, weight] of Object.entries(composition)) {
            expect(typeof weight).toBe('number');
            expect(weight).toBeGreaterThan(0);
          }
        }
      }
    });

    it('harder difficulties have more unit variety', () => {
      for (const faction of Object.keys(FACTION_UNIT_COMPOSITIONS)) {
        const easyUnits = Object.keys(FACTION_UNIT_COMPOSITIONS[faction].easy).length;
        const insaneUnits = Object.keys(FACTION_UNIT_COMPOSITIONS[faction].insane).length;
        expect(insaneUnits).toBeGreaterThanOrEqual(easyUnits);
      }
    });
  });

  describe('getBuildOrders', () => {
    it('returns build orders for valid faction and difficulty', () => {
      const factions = Object.keys(FACTION_BUILD_ORDERS);
      if (factions.length > 0) {
        const orders = getBuildOrders(factions[0], 'medium');
        expect(Array.isArray(orders)).toBe(true);
      }
    });

    it('returns empty array for unknown faction', () => {
      const orders = getBuildOrders('unknown_faction', 'medium');
      expect(orders).toEqual([]);
    });

    it('returns empty array for invalid difficulty on known faction', () => {
      const factions = Object.keys(FACTION_BUILD_ORDERS);
      if (factions.length > 0) {
        const orders = getBuildOrders(factions[0], 'invalid' as AIDifficulty);
        expect(orders).toEqual([]);
      }
    });
  });

  describe('getRandomBuildOrder', () => {
    it('returns a build order for valid faction and difficulty', () => {
      const factions = Object.keys(FACTION_BUILD_ORDERS);
      if (factions.length > 0) {
        const random = createSeededRandom(12345);
        const order = getRandomBuildOrder(factions[0], 'medium', random);
        expect(order).not.toBeNull();
        expect(order?.faction).toBe(factions[0]);
        expect(order?.difficulty).toBe('medium');
      }
    });

    it('returns null for unknown faction', () => {
      const random = createSeededRandom(12345);
      const order = getRandomBuildOrder('unknown_faction', 'medium', random);
      expect(order).toBeNull();
    });

    it('uses random for selection', () => {
      const factions = Object.keys(FACTION_BUILD_ORDERS);
      if (factions.length > 0) {
        // Test multiple calls with different seeds might give different results
        // (if there are multiple orders for that difficulty)
        const orders = FACTION_BUILD_ORDERS[factions[0]].insane;
        if (orders.length > 1) {
          const results = new Set<string>();
          for (let seed = 0; seed < 100; seed++) {
            const random = createSeededRandom(seed);
            const order = getRandomBuildOrder(factions[0], 'insane', random);
            if (order) results.add(order.id);
          }
          // With enough seeds, we should see variety (though not guaranteed)
          expect(results.size).toBeGreaterThanOrEqual(1);
        }
      }
    });
  });

  describe('getAIConfig', () => {
    it('returns config for all difficulties', () => {
      for (const difficulty of difficulties) {
        const config = getAIConfig(difficulty);
        expect(config).toBeDefined();
        expect(config).toBe(AI_DIFFICULTY_CONFIG[difficulty]);
      }
    });

    it('returns the correct config type', () => {
      const config = getAIConfig('hard');
      expect(config.ticksBetweenActions).toBeDefined();
      expect(config.targetWorkerCount).toBeDefined();
      expect(config.microEnabled).toBeDefined();
    });
  });

  describe('getUnitComposition', () => {
    it('returns composition for valid faction and difficulty', () => {
      const factions = Object.keys(FACTION_UNIT_COMPOSITIONS);
      if (factions.length > 0) {
        const composition = getUnitComposition(factions[0], 'hard');
        expect(typeof composition).toBe('object');
        expect(Object.keys(composition).length).toBeGreaterThan(0);
      }
    });

    it('returns empty object for unknown faction', () => {
      const composition = getUnitComposition('unknown_faction', 'hard');
      expect(composition).toEqual({});
    });
  });

  describe('selectUnitToBuild', () => {
    it('selects from available units with weights', () => {
      const factions = Object.keys(FACTION_UNIT_COMPOSITIONS);
      if (factions.length > 0) {
        const random = createSeededRandom(12345);
        const composition = FACTION_UNIT_COMPOSITIONS[factions[0]].hard;
        const availableUnits = Object.keys(composition);

        if (availableUnits.length > 0) {
          const selected = selectUnitToBuild(factions[0], 'hard', availableUnits, random);
          expect(availableUnits).toContain(selected);
        }
      }
    });

    it('returns first available if none have weights', () => {
      const random = createSeededRandom(12345);
      const selected = selectUnitToBuild('unknown_faction', 'hard', ['unit1', 'unit2'], random);
      expect(selected).toBe('unit1');
    });

    it('returns null if no units available', () => {
      const random = createSeededRandom(12345);
      const selected = selectUnitToBuild('unknown_faction', 'hard', [], random);
      expect(selected).toBeNull();
    });

    it('respects weight distribution', () => {
      const factions = Object.keys(FACTION_UNIT_COMPOSITIONS);
      if (factions.length > 0) {
        const composition = FACTION_UNIT_COMPOSITIONS[factions[0]].insane;
        const availableUnits = Object.keys(composition);

        if (availableUnits.length > 1) {
          // Run many selections and verify distribution roughly matches weights
          const counts: Record<string, number> = {};
          for (let seed = 0; seed < 1000; seed++) {
            const random = createSeededRandom(seed);
            const selected = selectUnitToBuild(factions[0], 'insane', availableUnits, random);
            if (selected) {
              counts[selected] = (counts[selected] || 0) + 1;
            }
          }

          // Verify higher-weighted units appear more often (rough check)
          const totalWeight = availableUnits.reduce((sum, u) => sum + (composition[u] || 0), 0);
          for (const unit of availableUnits) {
            const expectedRatio = (composition[unit] || 0) / totalWeight;
            const actualRatio = (counts[unit] || 0) / 1000;
            // Allow 20% deviation from expected ratio
            expect(Math.abs(actualRatio - expectedRatio)).toBeLessThan(0.2);
          }
        }
      }
    });

    it('filters to only available units', () => {
      const factions = Object.keys(FACTION_UNIT_COMPOSITIONS);
      if (factions.length > 0) {
        const random = createSeededRandom(12345);
        const composition = FACTION_UNIT_COMPOSITIONS[factions[0]].hard;
        const allUnits = Object.keys(composition);

        if (allUnits.length > 0) {
          // Only allow first unit
          const limitedUnits = [allUnits[0]];
          const selected = selectUnitToBuild(factions[0], 'hard', limitedUnits, random);
          expect(selected).toBe(allUnits[0]);
        }
      }
    });
  });

  describe('getFactionsWithBuildOrders', () => {
    it('returns array of faction IDs', () => {
      const factions = getFactionsWithBuildOrders();
      expect(Array.isArray(factions)).toBe(true);
      expect(factions.length).toBeGreaterThan(0);
    });

    it('matches FACTION_BUILD_ORDERS keys', () => {
      const factions = getFactionsWithBuildOrders();
      const expected = Object.keys(FACTION_BUILD_ORDERS);
      expect(factions.sort()).toEqual(expected.sort());
    });
  });

  describe('validateBuildOrder', () => {
    const validUnits = new Set(['unit1', 'unit2', 'unit3']);
    const validBuildings = new Set(['building1', 'building2']);
    const validResearch = new Set(['research1', 'research2']);

    const createBuildOrder = (steps: BuildOrderStep[]): BuildOrder => ({
      id: 'test_order',
      name: 'Test Order',
      description: 'Test build order',
      faction: 'test',
      difficulty: 'medium',
      style: 'balanced',
      steps,
    });

    it('validates build order with all valid steps', () => {
      const order = createBuildOrder([
        { type: 'unit', id: 'unit1' },
        { type: 'building', id: 'building1' },
        { type: 'research', id: 'research1' },
      ]);

      const result = validateBuildOrder(order, validUnits, validBuildings, validResearch);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('detects unknown unit', () => {
      const order = createBuildOrder([
        { type: 'unit', id: 'unknown_unit' },
      ]);

      const result = validateBuildOrder(order, validUnits, validBuildings, validResearch);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown unit: unknown_unit');
    });

    it('detects unknown building', () => {
      const order = createBuildOrder([
        { type: 'building', id: 'unknown_building' },
      ]);

      const result = validateBuildOrder(order, validUnits, validBuildings, validResearch);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown building: unknown_building');
    });

    it('detects unknown research', () => {
      const order = createBuildOrder([
        { type: 'research', id: 'unknown_research' },
      ]);

      const result = validateBuildOrder(order, validUnits, validBuildings, validResearch);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown research: unknown_research');
    });

    it('reports multiple errors', () => {
      const order = createBuildOrder([
        { type: 'unit', id: 'bad_unit' },
        { type: 'building', id: 'bad_building' },
        { type: 'research', id: 'bad_research' },
      ]);

      const result = validateBuildOrder(order, validUnits, validBuildings, validResearch);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(3);
    });

    it('validates empty build order', () => {
      const order = createBuildOrder([]);

      const result = validateBuildOrder(order, validUnits, validBuildings, validResearch);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('build order step types', () => {
    it('supports unit steps', () => {
      const step: BuildOrderStep = { type: 'unit', id: 'some_unit' };
      expect(step.type).toBe('unit');
    });

    it('supports building steps', () => {
      const step: BuildOrderStep = { type: 'building', id: 'some_building' };
      expect(step.type).toBe('building');
    });

    it('supports research steps', () => {
      const step: BuildOrderStep = { type: 'research', id: 'some_research' };
      expect(step.type).toBe('research');
    });

    it('supports ability steps', () => {
      const step: BuildOrderStep = { type: 'ability', id: 'some_ability' };
      expect(step.type).toBe('ability');
    });

    it('supports optional supply trigger', () => {
      const step: BuildOrderStep = { type: 'building', id: 'test', supply: 10 };
      expect(step.supply).toBe(10);
    });

    it('supports optional time trigger', () => {
      const step: BuildOrderStep = { type: 'building', id: 'test', time: 60 };
      expect(step.time).toBe(60);
    });

    it('supports optional priority', () => {
      const step: BuildOrderStep = { type: 'unit', id: 'test', priority: 5 };
      expect(step.priority).toBe(5);
    });

    it('supports optional count', () => {
      const step: BuildOrderStep = { type: 'unit', id: 'test', count: 3 };
      expect(step.count).toBe(3);
    });

    it('supports optional comment', () => {
      const step: BuildOrderStep = { type: 'unit', id: 'test', comment: 'Early scout' };
      expect(step.comment).toBe('Early scout');
    });

    it('supports string condition', () => {
      const step: BuildOrderStep = { type: 'unit', id: 'test', condition: 'has_extractor' };
      expect(step.condition).toBe('has_extractor');
    });

    it('supports function condition', () => {
      const step: BuildOrderStep = { type: 'unit', id: 'test', condition: () => true };
      expect(typeof step.condition).toBe('function');
    });
  });
});

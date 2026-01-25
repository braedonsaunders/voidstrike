import { describe, it, expect } from 'vitest';
import {
  RESOURCE_TYPES,
  RESOURCE_SYSTEM_CONFIG,
  STARTING_RESOURCES,
  getResourceTypeIds,
  getResourceType,
  getPrimaryResourceType,
  getSecondaryResourceTypes,
  getEffectiveGatherRate,
  requiresBuilding,
  getRequiredBuilding,
  createEmptyResourceBag,
  createStartingResourceBag,
} from '@/data/resources/resources';

describe('Resource Configuration', () => {
  describe('RESOURCE_TYPES', () => {
    it('defines minerals resource', () => {
      expect(RESOURCE_TYPES.minerals).toBeDefined();
      expect(RESOURCE_TYPES.minerals.name).toBe('Minerals');
      expect(RESOURCE_TYPES.minerals.requiresBuilding).toBe(false);
    });

    it('defines vespene resource', () => {
      expect(RESOURCE_TYPES.vespene).toBeDefined();
      expect(RESOURCE_TYPES.vespene.name).toBe('Vespene Gas');
      expect(RESOURCE_TYPES.vespene.requiresBuilding).toBe(true);
    });

    it('all resources have required properties', () => {
      for (const [id, def] of Object.entries(RESOURCE_TYPES)) {
        expect(def.id).toBe(id);
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.color).toBeTruthy();
        expect(typeof def.gatherRate).toBe('number');
        expect(typeof def.gatherTime).toBe('number');
        expect(typeof def.carryCapacity).toBe('number');
        expect(typeof def.optimalWorkersPerSource).toBe('number');
        expect(typeof def.requiresBuilding).toBe('boolean');
        expect(typeof def.defaultSourceAmount).toBe('number');
        expect(def.shortName).toBeTruthy();
        expect(def.pluralName).toBeTruthy();
      }
    });

    it('minerals has correct gather properties', () => {
      const minerals = RESOURCE_TYPES.minerals;
      expect(minerals.gatherRate).toBe(5);
      expect(minerals.carryCapacity).toBe(5);
      expect(minerals.optimalWorkersPerSource).toBe(2);
      expect(minerals.defaultSourceAmount).toBe(1500);
    });

    it('vespene has correct gather properties', () => {
      const vespene = RESOURCE_TYPES.vespene;
      expect(vespene.gatherRate).toBe(4);
      expect(vespene.carryCapacity).toBe(4);
      expect(vespene.optimalWorkersPerSource).toBe(3);
      expect(vespene.buildingType).toBe('extractor');
      expect(vespene.defaultSourceAmount).toBe(2000);
    });

    it('uses appropriate UI colors', () => {
      expect(RESOURCE_TYPES.minerals.color).toBe('#60a0ff'); // Blue
      expect(RESOURCE_TYPES.vespene.color).toBe('#40ff80'); // Green
    });
  });

  describe('RESOURCE_SYSTEM_CONFIG', () => {
    it('enables auto return', () => {
      expect(RESOURCE_SYSTEM_CONFIG.autoReturnEnabled).toBe(true);
    });

    it('enables smart gather', () => {
      expect(RESOURCE_SYSTEM_CONFIG.smartGatherEnabled).toBe(true);
    });

    it('defines worker limits', () => {
      expect(RESOURCE_SYSTEM_CONFIG.maxWorkersPerSource).toBe(3);
      expect(RESOURCE_SYSTEM_CONFIG.diminishingReturnsStart).toBe(2);
    });

    it('defines diminishing returns factor', () => {
      expect(RESOURCE_SYSTEM_CONFIG.diminishingReturnsFactor).toBe(0.7);
    });

    it('defines close range bonus', () => {
      expect(RESOURCE_SYSTEM_CONFIG.closeRangeBonus).toBe(1.0);
      expect(RESOURCE_SYSTEM_CONFIG.closeRangeThreshold).toBe(8);
    });
  });

  describe('STARTING_RESOURCES', () => {
    it('defines standard game mode', () => {
      expect(STARTING_RESOURCES.standard).toBeDefined();
      expect(STARTING_RESOURCES.standard.minerals).toBe(50);
      expect(STARTING_RESOURCES.standard.vespene).toBe(0);
    });

    it('defines quick game mode', () => {
      expect(STARTING_RESOURCES.quick).toBeDefined();
      expect(STARTING_RESOURCES.quick.minerals).toBe(200);
      expect(STARTING_RESOURCES.quick.vespene).toBe(100);
    });

    it('defines rich game mode', () => {
      expect(STARTING_RESOURCES.rich).toBeDefined();
      expect(STARTING_RESOURCES.rich.minerals).toBe(1000);
      expect(STARTING_RESOURCES.rich.vespene).toBe(500);
    });
  });

  describe('getResourceTypeIds', () => {
    it('returns all resource IDs', () => {
      const ids = getResourceTypeIds();
      expect(ids).toContain('minerals');
      expect(ids).toContain('vespene');
    });

    it('returns array of strings', () => {
      const ids = getResourceTypeIds();
      for (const id of ids) {
        expect(typeof id).toBe('string');
      }
    });
  });

  describe('getResourceType', () => {
    it('returns resource type for valid ID', () => {
      const minerals = getResourceType('minerals');
      expect(minerals).toBeDefined();
      expect(minerals!.id).toBe('minerals');
    });

    it('returns undefined for invalid ID', () => {
      const result = getResourceType('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('getPrimaryResourceType', () => {
    it('returns minerals as primary resource', () => {
      const primary = getPrimaryResourceType();
      expect(primary.id).toBe('minerals');
    });
  });

  describe('getSecondaryResourceTypes', () => {
    it('returns vespene as secondary resource', () => {
      const secondary = getSecondaryResourceTypes();
      expect(secondary.length).toBe(1);
      expect(secondary[0].id).toBe('vespene');
    });

    it('excludes primary resource', () => {
      const secondary = getSecondaryResourceTypes();
      const ids = secondary.map(r => r.id);
      expect(ids).not.toContain('minerals');
    });
  });

  describe('getEffectiveGatherRate', () => {
    it('returns base rate for first worker', () => {
      const rate = getEffectiveGatherRate('minerals', 1);
      expect(rate).toBe(5); // 1 worker * 5 gather rate
    });

    it('returns double rate for two workers', () => {
      const rate = getEffectiveGatherRate('minerals', 2);
      expect(rate).toBe(10); // 2 workers * 5 gather rate
    });

    it('applies diminishing returns for third worker', () => {
      const rate = getEffectiveGatherRate('minerals', 3);
      // 2 workers at full + 1 worker at 0.7 = 2 + 0.7 = 2.7 effective workers
      expect(rate).toBe(2.7 * 5); // 13.5
    });

    it('applies compounding diminishing returns', () => {
      const rate = getEffectiveGatherRate('minerals', 4);
      // 2 workers at full + 0.7 + 0.49 = 3.19 effective workers
      expect(rate).toBeCloseTo(3.19 * 5);
    });

    it('returns 0 for invalid resource type', () => {
      const rate = getEffectiveGatherRate('nonexistent', 2);
      expect(rate).toBe(0);
    });

    it('returns 0 for zero workers', () => {
      const rate = getEffectiveGatherRate('minerals', 0);
      expect(rate).toBe(0);
    });

    it('works for vespene with different base rate', () => {
      const rate = getEffectiveGatherRate('vespene', 2);
      expect(rate).toBe(8); // 2 workers * 4 gather rate
    });
  });

  describe('requiresBuilding', () => {
    it('returns false for minerals', () => {
      expect(requiresBuilding('minerals')).toBe(false);
    });

    it('returns true for vespene', () => {
      expect(requiresBuilding('vespene')).toBe(true);
    });

    it('returns false for unknown resource', () => {
      expect(requiresBuilding('nonexistent')).toBe(false);
    });
  });

  describe('getRequiredBuilding', () => {
    it('returns undefined for minerals', () => {
      expect(getRequiredBuilding('minerals')).toBeUndefined();
    });

    it('returns extractor for vespene', () => {
      expect(getRequiredBuilding('vespene')).toBe('extractor');
    });

    it('returns undefined for unknown resource', () => {
      expect(getRequiredBuilding('nonexistent')).toBeUndefined();
    });
  });

  describe('createEmptyResourceBag', () => {
    it('creates bag with all resources set to 0', () => {
      const bag = createEmptyResourceBag();
      expect(bag.minerals).toBe(0);
      expect(bag.vespene).toBe(0);
    });

    it('includes all registered resources', () => {
      const bag = createEmptyResourceBag();
      const ids = getResourceTypeIds();
      for (const id of ids) {
        expect(bag[id]).toBe(0);
      }
    });
  });

  describe('createStartingResourceBag', () => {
    it('creates standard bag by default', () => {
      const bag = createStartingResourceBag();
      expect(bag.minerals).toBe(50);
      expect(bag.vespene).toBe(0);
    });

    it('creates quick game bag', () => {
      const bag = createStartingResourceBag('quick');
      expect(bag.minerals).toBe(200);
      expect(bag.vespene).toBe(100);
    });

    it('creates rich game bag', () => {
      const bag = createStartingResourceBag('rich');
      expect(bag.minerals).toBe(1000);
      expect(bag.vespene).toBe(500);
    });

    it('falls back to standard for unknown mode', () => {
      const bag = createStartingResourceBag('unknown_mode');
      expect(bag.minerals).toBe(50);
      expect(bag.vespene).toBe(0);
    });

    it('includes all resources even if not in starting config', () => {
      const bag = createStartingResourceBag('standard');
      const ids = getResourceTypeIds();
      for (const id of ids) {
        expect(id in bag).toBe(true);
      }
    });
  });

  describe('gather rate balance', () => {
    it('minerals gather faster than vespene', () => {
      const mineralRate = RESOURCE_TYPES.minerals.gatherRate;
      const vespeneRate = RESOURCE_TYPES.vespene.gatherRate;
      expect(mineralRate).toBeGreaterThan(vespeneRate);
    });

    it('gather time is consistent', () => {
      expect(RESOURCE_TYPES.minerals.gatherTime).toBeCloseTo(
        RESOURCE_TYPES.vespene.gatherTime
      );
    });
  });

  describe('saturation calculations', () => {
    it('optimal workers matches expected values', () => {
      expect(RESOURCE_TYPES.minerals.optimalWorkersPerSource).toBe(2);
      expect(RESOURCE_TYPES.vespene.optimalWorkersPerSource).toBe(3);
    });

    it('max workers per source is reasonable', () => {
      expect(RESOURCE_SYSTEM_CONFIG.maxWorkersPerSource).toBeLessThanOrEqual(5);
    });
  });
});

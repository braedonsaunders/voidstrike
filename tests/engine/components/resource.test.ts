import { describe, it, expect, beforeEach } from 'vitest';
import {
  Resource,
  OPTIMAL_WORKERS_PER_MINERAL,
  MAX_WORKERS_PER_MINERAL,
  OPTIMAL_WORKERS_PER_VESPENE,
  MAX_WORKERS_PER_VESPENE,
} from '@/engine/components/Resource';

describe('Resource Component', () => {
  describe('constructor', () => {
    it('creates mineral resource with defaults', () => {
      const resource = new Resource('minerals', 1500);

      expect(resource.resourceType).toBe('minerals');
      expect(resource.amount).toBe(1500);
      expect(resource.maxAmount).toBe(1500);
      expect(resource.maxGatherers).toBe(2);
      expect(resource.gatherRate).toBe(5);
      expect(resource.gatherTime).toBe(2);
    });

    it('creates vespene resource', () => {
      const resource = new Resource('vespene', 2000, 3, 4, 3);

      expect(resource.resourceType).toBe('vespene');
      expect(resource.amount).toBe(2000);
      expect(resource.maxGatherers).toBe(3);
      expect(resource.gatherRate).toBe(4);
      expect(resource.gatherTime).toBe(3);
    });

    it('initializes empty gatherers set', () => {
      const resource = new Resource('minerals', 1500);

      expect(resource.currentGatherers.size).toBe(0);
    });

    it('initializes extractor as null', () => {
      const resource = new Resource('vespene', 2000);

      expect(resource.extractorEntityId).toBe(null);
    });
  });

  describe('canGather', () => {
    it('allows gathering from minerals', () => {
      const resource = new Resource('minerals', 1500, 2);

      expect(resource.canGather()).toBe(true);
    });

    it('prevents gathering when depleted', () => {
      const resource = new Resource('minerals', 0);

      expect(resource.canGather()).toBe(false);
    });

    it('prevents gathering when at max gatherers', () => {
      const resource = new Resource('minerals', 1500, 2);
      resource.currentGatherers.add(1);
      resource.currentGatherers.add(2);

      expect(resource.canGather()).toBe(false);
    });

    it('prevents gathering from vespene without extractor', () => {
      const resource = new Resource('vespene', 2000);

      expect(resource.canGather()).toBe(false);
    });

    it('allows gathering from vespene with extractor', () => {
      const resource = new Resource('vespene', 2000, 3);
      resource.extractorEntityId = 42;

      expect(resource.canGather()).toBe(true);
    });

    it('checks extractor completion status', () => {
      const resource = new Resource('vespene', 2000, 3);
      resource.extractorEntityId = 42;

      // Extractor not complete
      resource.setExtractorCompleteChecker(() => false);
      expect(resource.canGather()).toBe(false);

      // Extractor complete
      resource.setExtractorCompleteChecker(() => true);
      expect(resource.canGather()).toBe(true);
    });
  });

  describe('hasExtractor', () => {
    it('returns false when no extractor', () => {
      const resource = new Resource('vespene', 2000);

      expect(resource.hasExtractor()).toBe(false);
    });

    it('returns true when extractor exists', () => {
      const resource = new Resource('vespene', 2000);
      resource.extractorEntityId = 42;

      expect(resource.hasExtractor()).toBe(true);
    });

    it('checks extractor completion status', () => {
      const resource = new Resource('vespene', 2000);
      resource.extractorEntityId = 42;
      resource.setExtractorCompleteChecker(() => false);

      expect(resource.hasExtractor()).toBe(false);
    });
  });

  describe('hasRefinery (alias)', () => {
    it('works as alias for hasExtractor', () => {
      const resource = new Resource('vespene', 2000);
      resource.extractorEntityId = 42;

      expect(resource.hasRefinery()).toBe(resource.hasExtractor());
    });
  });

  describe('addGatherer', () => {
    it('adds gatherer when slot available', () => {
      const resource = new Resource('minerals', 1500, 2);

      const result = resource.addGatherer(1);

      expect(result).toBe(true);
      expect(resource.currentGatherers.has(1)).toBe(true);
    });

    it('fails when cannot gather', () => {
      const resource = new Resource('minerals', 0);

      const result = resource.addGatherer(1);

      expect(result).toBe(false);
      expect(resource.currentGatherers.has(1)).toBe(false);
    });

    it('fails when at max gatherers', () => {
      const resource = new Resource('minerals', 1500, 2);
      resource.addGatherer(1);
      resource.addGatherer(2);

      const result = resource.addGatherer(3);

      expect(result).toBe(false);
    });
  });

  describe('removeGatherer', () => {
    it('removes gatherer from set', () => {
      const resource = new Resource('minerals', 1500);
      resource.addGatherer(1);

      resource.removeGatherer(1);

      expect(resource.currentGatherers.has(1)).toBe(false);
    });

    it('handles removing non-existent gatherer', () => {
      const resource = new Resource('minerals', 1500);

      // Should not throw
      resource.removeGatherer(999);

      expect(resource.currentGatherers.size).toBe(0);
    });
  });

  describe('gather', () => {
    it('returns gather rate when enough resources', () => {
      const resource = new Resource('minerals', 1500, 2, 5);

      const gathered = resource.gather();

      expect(gathered).toBe(5);
      expect(resource.amount).toBe(1495);
    });

    it('returns remaining amount when less than gather rate', () => {
      const resource = new Resource('minerals', 3, 2, 5);

      const gathered = resource.gather();

      expect(gathered).toBe(3);
      expect(resource.amount).toBe(0);
    });

    it('returns 0 when depleted', () => {
      const resource = new Resource('minerals', 0);

      const gathered = resource.gather();

      expect(gathered).toBe(0);
    });
  });

  describe('isDepleted', () => {
    it('returns true when amount is 0', () => {
      const resource = new Resource('minerals', 0);

      expect(resource.isDepleted()).toBe(true);
    });

    it('returns false when amount > 0', () => {
      const resource = new Resource('minerals', 1);

      expect(resource.isDepleted()).toBe(false);
    });
  });

  describe('getPercentRemaining', () => {
    it('calculates percentage correctly', () => {
      const resource = new Resource('minerals', 1000);
      resource.amount = 500;

      expect(resource.getPercentRemaining()).toBe(0.5);
    });

    it('returns 1 when full', () => {
      const resource = new Resource('minerals', 1000);

      expect(resource.getPercentRemaining()).toBe(1);
    });

    it('returns 0 when depleted', () => {
      const resource = new Resource('minerals', 1000);
      resource.amount = 0;

      expect(resource.getPercentRemaining()).toBe(0);
    });
  });

  describe('getCurrentGatherers', () => {
    it('returns count of current gatherers', () => {
      const resource = new Resource('minerals', 1500, 5);
      resource.addGatherer(1);
      resource.addGatherer(2);
      resource.addGatherer(3);

      expect(resource.getCurrentGatherers()).toBe(3);
    });
  });

  describe('worker saturation', () => {
    describe('getOptimalWorkers', () => {
      it('returns optimal for minerals', () => {
        const resource = new Resource('minerals', 1500);

        expect(resource.getOptimalWorkers()).toBe(OPTIMAL_WORKERS_PER_MINERAL);
        expect(resource.getOptimalWorkers()).toBe(1);
      });

      it('returns optimal for vespene', () => {
        const resource = new Resource('vespene', 2000);

        expect(resource.getOptimalWorkers()).toBe(OPTIMAL_WORKERS_PER_VESPENE);
        expect(resource.getOptimalWorkers()).toBe(3);
      });
    });

    describe('getMaxUsefulWorkers', () => {
      it('returns max for minerals', () => {
        const resource = new Resource('minerals', 1500);

        expect(resource.getMaxUsefulWorkers()).toBe(MAX_WORKERS_PER_MINERAL);
        expect(resource.getMaxUsefulWorkers()).toBe(3);
      });

      it('returns max for vespene', () => {
        const resource = new Resource('vespene', 2000);

        expect(resource.getMaxUsefulWorkers()).toBe(MAX_WORKERS_PER_VESPENE);
        expect(resource.getMaxUsefulWorkers()).toBe(3);
      });
    });

    describe('isOptimallySaturated', () => {
      it('returns false when under optimal', () => {
        const resource = new Resource('minerals', 1500, 5);
        // With optimal = 1, having 0 gatherers is under optimal

        expect(resource.isOptimallySaturated()).toBe(false);
      });

      it('returns true when at optimal', () => {
        const resource = new Resource('minerals', 1500, 5);
        resource.addGatherer(1);
        // With optimal = 1, having 1 gatherer is at optimal

        expect(resource.isOptimallySaturated()).toBe(true);
      });

      it('returns true when over optimal', () => {
        const resource = new Resource('minerals', 1500, 5);
        resource.addGatherer(1);
        resource.addGatherer(2);
        resource.addGatherer(3);

        expect(resource.isOptimallySaturated()).toBe(true);
      });
    });

    describe('isOversaturated', () => {
      it('returns false when at or under max useful', () => {
        const resource = new Resource('minerals', 1500, 5);
        resource.addGatherer(1);
        resource.addGatherer(2);
        resource.addGatherer(3);

        expect(resource.isOversaturated()).toBe(false);
      });

      it('returns true when over max useful', () => {
        const resource = new Resource('minerals', 1500, 5);
        resource.addGatherer(1);
        resource.addGatherer(2);
        resource.addGatherer(3);
        resource.addGatherer(4);

        expect(resource.isOversaturated()).toBe(true);
      });
    });
  });

  describe('constants', () => {
    it('exports correct worker constants', () => {
      expect(OPTIMAL_WORKERS_PER_MINERAL).toBe(1);
      expect(MAX_WORKERS_PER_MINERAL).toBe(3);
      expect(OPTIMAL_WORKERS_PER_VESPENE).toBe(3);
      expect(MAX_WORKERS_PER_VESPENE).toBe(3);
    });
  });

  describe('type property', () => {
    it('has correct component type', () => {
      const resource = new Resource('minerals', 1500);

      expect(resource.type).toBe('Resource');
    });
  });
});

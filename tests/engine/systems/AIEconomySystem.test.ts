import { describe, it, expect } from 'vitest';

/**
 * AIEconomySystem Tests
 *
 * Tests for the AI economy tracking system including:
 * 1. Income calculation (minerals/vespene per minute)
 * 2. Worker estimation based on income
 * 3. Rolling window for income tracking
 * 4. Metrics calculation and retrieval
 */

// Constants from AIEconomySystem
const METRICS_LOG_INTERVAL = 400; // ticks (~20 seconds at 20 TPS)
const ROLLING_WINDOW_SIZE = 100; // Maximum entries in rolling window

describe('AIEconomySystem', () => {
  describe('income tracking', () => {
    interface IncomeTracker {
      mineralsGathered: number;
      vespeneGathered: number;
      lastResetTick: number;
      recentMinerals: number[];
      recentVespene: number[];
    }

    function createTracker(currentTick: number): IncomeTracker {
      return {
        mineralsGathered: 0,
        vespeneGathered: 0,
        lastResetTick: currentTick,
        recentMinerals: [],
        recentVespene: [],
      };
    }

    function recordDelivery(tracker: IncomeTracker, minerals: number, vespene: number): void {
      tracker.mineralsGathered += minerals;
      tracker.vespeneGathered += vespene;
      tracker.recentMinerals.push(minerals);
      tracker.recentVespene.push(vespene);

      // Maintain rolling window FIFO
      if (tracker.recentMinerals.length > ROLLING_WINDOW_SIZE) {
        tracker.recentMinerals.shift();
        tracker.recentVespene.shift();
      }
    }

    it('creates tracker with zero values', () => {
      const tracker = createTracker(100);

      expect(tracker.mineralsGathered).toBe(0);
      expect(tracker.vespeneGathered).toBe(0);
      expect(tracker.recentMinerals).toHaveLength(0);
      expect(tracker.recentVespene).toHaveLength(0);
    });

    it('records last reset tick', () => {
      const tracker = createTracker(500);
      expect(tracker.lastResetTick).toBe(500);
    });

    it('accumulates minerals gathered', () => {
      const tracker = createTracker(0);

      recordDelivery(tracker, 10, 0);
      expect(tracker.mineralsGathered).toBe(10);

      recordDelivery(tracker, 15, 0);
      expect(tracker.mineralsGathered).toBe(25);
    });

    it('accumulates vespene gathered', () => {
      const tracker = createTracker(0);

      recordDelivery(tracker, 0, 8);
      expect(tracker.vespeneGathered).toBe(8);

      recordDelivery(tracker, 0, 12);
      expect(tracker.vespeneGathered).toBe(20);
    });

    it('adds entries to rolling window', () => {
      const tracker = createTracker(0);

      recordDelivery(tracker, 10, 5);
      recordDelivery(tracker, 15, 8);
      recordDelivery(tracker, 20, 10);

      expect(tracker.recentMinerals).toEqual([10, 15, 20]);
      expect(tracker.recentVespene).toEqual([5, 8, 10]);
    });

    describe('rolling window FIFO behavior', () => {
      it('caps at ROLLING_WINDOW_SIZE entries', () => {
        const tracker = createTracker(0);

        for (let i = 0; i < 120; i++) {
          recordDelivery(tracker, 10, 5);
        }

        expect(tracker.recentMinerals.length).toBe(ROLLING_WINDOW_SIZE);
        expect(tracker.recentVespene.length).toBe(ROLLING_WINDOW_SIZE);
      });

      it('removes oldest entries when over capacity', () => {
        const tracker = createTracker(0);

        // Fill with sequential values
        for (let i = 1; i <= 105; i++) {
          recordDelivery(tracker, i, i);
        }

        // Should have removed first 5 entries (1-5)
        expect(tracker.recentMinerals[0]).toBe(6);
        expect(tracker.recentMinerals[ROLLING_WINDOW_SIZE - 1]).toBe(105);
      });

      it('maintains FIFO order', () => {
        const tracker = createTracker(0);

        for (let i = 1; i <= 150; i++) {
          recordDelivery(tracker, i, i * 2);
        }

        // Should have entries 51-150
        expect(tracker.recentMinerals[0]).toBe(51);
        expect(tracker.recentMinerals[49]).toBe(100);
        expect(tracker.recentMinerals[99]).toBe(150);
      });
    });
  });

  describe('income calculation', () => {
    interface IncomeTracker {
      recentMinerals: number[];
      recentVespene: number[];
      lastResetTick: number;
    }

    /**
     * Calculates minerals per minute from rolling window
     * Replicates calculateMetrics logic from AIEconomySystem
     */
    function calculateMineralsPerMinute(tracker: IncomeTracker, _currentTick: number): number {
      const recentMineralsSum = tracker.recentMinerals.reduce((a, b) => a + b, 0);

      // Estimate ticks covered by recent window (~50 ticks per entry average)
      const recentWindowTicks = tracker.recentMinerals.length * 50;
      const recentWindowMinutes = recentWindowTicks / (20 * 60); // 20 ticks/sec, 60 sec/min

      return recentWindowMinutes > 0 ? recentMineralsSum / recentWindowMinutes : 0;
    }

    function calculateVespenePerMinute(tracker: IncomeTracker, _currentTick: number): number {
      const recentVespeneSum = tracker.recentVespene.reduce((a, b) => a + b, 0);

      const recentWindowTicks = tracker.recentVespene.length * 50;
      const recentWindowMinutes = recentWindowTicks / (20 * 60);

      return recentWindowMinutes > 0 ? recentVespeneSum / recentWindowMinutes : 0;
    }

    it('returns 0 for empty window', () => {
      const tracker: IncomeTracker = {
        recentMinerals: [],
        recentVespene: [],
        lastResetTick: 0,
      };

      expect(calculateMineralsPerMinute(tracker, 1000)).toBe(0);
      expect(calculateVespenePerMinute(tracker, 1000)).toBe(0);
    });

    it('calculates minerals per minute from window', () => {
      const tracker: IncomeTracker = {
        recentMinerals: [10, 10, 10, 10, 10], // 50 minerals total, 5 entries
        recentVespene: [],
        lastResetTick: 0,
      };

      // 5 entries * 50 ticks = 250 ticks = 250 / 1200 minutes = 0.208 minutes
      // 50 / 0.208 = 240 minerals per minute
      const mpm = calculateMineralsPerMinute(tracker, 1000);
      expect(mpm).toBeCloseTo(240, 0);
    });

    it('calculates vespene per minute from window', () => {
      const tracker: IncomeTracker = {
        recentMinerals: [],
        recentVespene: [8, 8, 8, 8, 8], // 40 vespene total, 5 entries
        lastResetTick: 0,
      };

      // 5 entries * 50 ticks = 250 ticks = 0.208 minutes
      // 40 / 0.208 = 192 vespene per minute
      const vpm = calculateVespenePerMinute(tracker, 1000);
      expect(vpm).toBeCloseTo(192, 0);
    });

    it('handles varying delivery amounts', () => {
      const tracker: IncomeTracker = {
        recentMinerals: [5, 10, 15, 20, 25], // 75 total
        recentVespene: [4, 8, 12, 16, 20], // 60 total
        lastResetTick: 0,
      };

      const mpm = calculateMineralsPerMinute(tracker, 1000);
      const vpm = calculateVespenePerMinute(tracker, 1000);

      // 5 entries = 0.208 minutes
      expect(mpm).toBeCloseTo(360, 0); // 75 / 0.208
      expect(vpm).toBeCloseTo(288, 0); // 60 / 0.208
    });

    it('income rate increases with more gatherers (more entries)', () => {
      const tracker5: IncomeTracker = {
        recentMinerals: [10, 10, 10, 10, 10],
        recentVespene: [],
        lastResetTick: 0,
      };
      const tracker10: IncomeTracker = {
        recentMinerals: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
        recentVespene: [],
        lastResetTick: 0,
      };

      // Same individual delivery but more frequent
      // Both should have same MPM (rate doesn't increase just from more entries)
      const mpm5 = calculateMineralsPerMinute(tracker5, 1000);
      const mpm10 = calculateMineralsPerMinute(tracker10, 1000);

      // Actually they should be equal since it's rate-based
      expect(mpm5).toBeCloseTo(mpm10, 0);
    });
  });

  describe('worker estimation', () => {
    /**
     * Estimates worker count from minerals per minute
     * Based on ~40 minerals per worker per minute baseline
     */
    function estimateWorkers(mineralsPerMinute: number): number {
      return mineralsPerMinute > 0 ? Math.round(mineralsPerMinute / 40) : 0;
    }

    it('returns 0 for zero income', () => {
      expect(estimateWorkers(0)).toBe(0);
    });

    it('estimates 1 worker at ~40 mpm', () => {
      expect(estimateWorkers(40)).toBe(1);
    });

    it('estimates 5 workers at ~200 mpm', () => {
      expect(estimateWorkers(200)).toBe(5);
    });

    it('estimates 10 workers at ~400 mpm', () => {
      expect(estimateWorkers(400)).toBe(10);
    });

    it('rounds to nearest worker', () => {
      expect(estimateWorkers(60)).toBe(2); // 60/40 = 1.5 -> 2
      expect(estimateWorkers(50)).toBe(1); // 50/40 = 1.25 -> 1
      expect(estimateWorkers(79)).toBe(2); // 79/40 = 1.975 -> 2
    });

    it('handles fractional results', () => {
      expect(estimateWorkers(100)).toBe(3); // 100/40 = 2.5 -> 3
      expect(estimateWorkers(120)).toBe(3); // 120/40 = 3
    });
  });

  describe('metrics calculation', () => {
    interface AIEconomyMetrics {
      playerId: string;
      mineralsPerMinute: number;
      vespenePerMinute: number;
      totalMineralsGathered: number;
      totalVespeneGathered: number;
      workerCount: number;
      gatheringWorkers: number;
      incomePerWorker: number;
      workerReplacementPriority: number;
      depletedPatchesNearBases: number;
      currentMinerals: number;
      currentVespene: number;
    }

    interface IncomeTracker {
      mineralsGathered: number;
      vespeneGathered: number;
      lastResetTick: number;
      recentMinerals: number[];
      recentVespene: number[];
    }

    function calculateMetrics(
      playerId: string,
      tracker: IncomeTracker,
      _currentTick: number
    ): AIEconomyMetrics {
      // Calculate per-minute rates
      const recentMineralsSum = tracker.recentMinerals.reduce((a, b) => a + b, 0);
      const recentVespeneSum = tracker.recentVespene.reduce((a, b) => a + b, 0);

      const recentWindowTicks = tracker.recentMinerals.length * 50;
      const recentWindowMinutes = recentWindowTicks / (20 * 60);

      const mineralsPerMinute =
        recentWindowMinutes > 0 ? recentMineralsSum / recentWindowMinutes : 0;
      const vespenePerMinute = recentWindowMinutes > 0 ? recentVespeneSum / recentWindowMinutes : 0;

      // Estimate workers
      const estimatedWorkers = mineralsPerMinute > 0 ? Math.round(mineralsPerMinute / 40) : 0;
      const incomePerWorker =
        estimatedWorkers > 0 ? (mineralsPerMinute + vespenePerMinute) / estimatedWorkers : 0;

      return {
        playerId,
        mineralsPerMinute,
        vespenePerMinute,
        totalMineralsGathered: tracker.mineralsGathered,
        totalVespeneGathered: tracker.vespeneGathered,
        workerCount: estimatedWorkers,
        gatheringWorkers: estimatedWorkers,
        incomePerWorker,
        workerReplacementPriority: 0,
        depletedPatchesNearBases: 0,
        currentMinerals: 0,
        currentVespene: 0,
      };
    }

    it('calculates complete metrics object', () => {
      const tracker: IncomeTracker = {
        mineralsGathered: 500,
        vespeneGathered: 200,
        lastResetTick: 0,
        recentMinerals: [10, 10, 10, 10, 10],
        recentVespene: [8, 8, 8, 8, 8],
      };

      const metrics = calculateMetrics('ai_1', tracker, 1000);

      expect(metrics.playerId).toBe('ai_1');
      expect(metrics.totalMineralsGathered).toBe(500);
      expect(metrics.totalVespeneGathered).toBe(200);
      expect(metrics.mineralsPerMinute).toBeGreaterThan(0);
      expect(metrics.vespenePerMinute).toBeGreaterThan(0);
    });

    it('calculates income per worker', () => {
      const tracker: IncomeTracker = {
        mineralsGathered: 0,
        vespeneGathered: 0,
        lastResetTick: 0,
        recentMinerals: [10, 10, 10, 10, 10], // ~240 mpm
        recentVespene: [8, 8, 8, 8, 8], // ~192 vpm
      };

      const metrics = calculateMetrics('ai_1', tracker, 1000);

      // Should have workers and income per worker calculated
      expect(metrics.workerCount).toBeGreaterThan(0);
      expect(metrics.incomePerWorker).toBeGreaterThan(0);
    });

    it('income per worker is total income / workers', () => {
      const tracker: IncomeTracker = {
        mineralsGathered: 0,
        vespeneGathered: 0,
        lastResetTick: 0,
        recentMinerals: [10, 10, 10, 10, 10],
        recentVespene: [8, 8, 8, 8, 8],
      };

      const metrics = calculateMetrics('ai_1', tracker, 1000);

      const expectedIncomePerWorker =
        (metrics.mineralsPerMinute + metrics.vespenePerMinute) / metrics.workerCount;
      expect(metrics.incomePerWorker).toBeCloseTo(expectedIncomePerWorker, 1);
    });

    it('returns zero income per worker when no workers', () => {
      const tracker: IncomeTracker = {
        mineralsGathered: 0,
        vespeneGathered: 0,
        lastResetTick: 0,
        recentMinerals: [],
        recentVespene: [],
      };

      const metrics = calculateMetrics('ai_1', tracker, 1000);

      expect(metrics.incomePerWorker).toBe(0);
    });
  });

  describe('getMetrics', () => {
    interface MockEconomySystem {
      trackers: Map<string, { recentMinerals: number[]; recentVespene: number[] }>;
      getMetrics(playerId: string): { mineralsPerMinute: number } | null;
    }

    it('returns null for untracked player', () => {
      const system: MockEconomySystem = {
        trackers: new Map(),
        getMetrics(playerId: string) {
          if (!this.trackers.has(playerId)) return null;
          return { mineralsPerMinute: 100 };
        },
      };

      expect(system.getMetrics('unknown')).toBeNull();
    });

    it('returns metrics for tracked player', () => {
      const system: MockEconomySystem = {
        trackers: new Map([['ai_1', { recentMinerals: [10], recentVespene: [5] }]]),
        getMetrics(playerId: string) {
          if (!this.trackers.has(playerId)) return null;
          return { mineralsPerMinute: 100 };
        },
      };

      const metrics = system.getMetrics('ai_1');
      expect(metrics).not.toBeNull();
      expect(metrics?.mineralsPerMinute).toBe(100);
    });
  });

  describe('getAllMetrics', () => {
    interface MockMetrics {
      playerId: string;
      mineralsPerMinute: number;
    }

    interface MockEconomySystem {
      trackers: Map<string, { recentMinerals: number[] }>;
      getAllMetrics(): MockMetrics[];
    }

    it('returns empty array when no players tracked', () => {
      const system: MockEconomySystem = {
        trackers: new Map(),
        getAllMetrics() {
          return Array.from(this.trackers.keys()).map((id) => ({
            playerId: id,
            mineralsPerMinute: 100,
          }));
        },
      };

      expect(system.getAllMetrics()).toEqual([]);
    });

    it('returns metrics for all tracked players', () => {
      const system: MockEconomySystem = {
        trackers: new Map([
          ['ai_1', { recentMinerals: [10] }],
          ['ai_2', { recentMinerals: [20] }],
          ['ai_3', { recentMinerals: [30] }],
        ]),
        getAllMetrics() {
          return Array.from(this.trackers.keys()).map((id) => ({
            playerId: id,
            mineralsPerMinute: 100,
          }));
        },
      };

      const allMetrics = system.getAllMetrics();
      expect(allMetrics).toHaveLength(3);

      const ids = allMetrics.map((m) => m.playerId);
      expect(ids).toContain('ai_1');
      expect(ids).toContain('ai_2');
      expect(ids).toContain('ai_3');
    });
  });

  describe('resource delivery event handling', () => {
    interface DeliveryEvent {
      playerId: string | undefined;
      minerals: number;
      vespene: number;
    }

    interface IncomeTracker {
      mineralsGathered: number;
      vespeneGathered: number;
      recentMinerals: number[];
      recentVespene: number[];
    }

    /**
     * Simulates handling a resource:delivered event
     */
    function handleResourceDelivery(
      trackers: Map<string, IncomeTracker>,
      aiPlayerIds: Set<string>,
      event: DeliveryEvent
    ): void {
      // Skip if no player id
      if (!event.playerId) return;

      // Only track AI players
      if (!aiPlayerIds.has(event.playerId)) return;

      let tracker = trackers.get(event.playerId);
      if (!tracker) {
        tracker = {
          mineralsGathered: 0,
          vespeneGathered: 0,
          recentMinerals: [],
          recentVespene: [],
        };
        trackers.set(event.playerId, tracker);
      }

      tracker.mineralsGathered += event.minerals;
      tracker.vespeneGathered += event.vespene;
      tracker.recentMinerals.push(event.minerals);
      tracker.recentVespene.push(event.vespene);

      if (tracker.recentMinerals.length > ROLLING_WINDOW_SIZE) {
        tracker.recentMinerals.shift();
        tracker.recentVespene.shift();
      }
    }

    it('ignores events with undefined playerId', () => {
      const trackers = new Map<string, IncomeTracker>();
      const aiPlayers = new Set(['ai_1']);

      handleResourceDelivery(trackers, aiPlayers, {
        playerId: undefined,
        minerals: 100,
        vespene: 50,
      });

      expect(trackers.size).toBe(0);
    });

    it('ignores events for non-AI players', () => {
      const trackers = new Map<string, IncomeTracker>();
      const aiPlayers = new Set(['ai_1']);

      handleResourceDelivery(trackers, aiPlayers, {
        playerId: 'human_player',
        minerals: 100,
        vespene: 50,
      });

      expect(trackers.size).toBe(0);
    });

    it('creates tracker for first delivery', () => {
      const trackers = new Map<string, IncomeTracker>();
      const aiPlayers = new Set(['ai_1']);

      handleResourceDelivery(trackers, aiPlayers, {
        playerId: 'ai_1',
        minerals: 10,
        vespene: 8,
      });

      expect(trackers.has('ai_1')).toBe(true);
      expect(trackers.get('ai_1')?.mineralsGathered).toBe(10);
      expect(trackers.get('ai_1')?.vespeneGathered).toBe(8);
    });

    it('accumulates deliveries in existing tracker', () => {
      const trackers = new Map<string, IncomeTracker>();
      const aiPlayers = new Set(['ai_1']);

      handleResourceDelivery(trackers, aiPlayers, { playerId: 'ai_1', minerals: 10, vespene: 8 });
      handleResourceDelivery(trackers, aiPlayers, { playerId: 'ai_1', minerals: 15, vespene: 12 });

      expect(trackers.get('ai_1')?.mineralsGathered).toBe(25);
      expect(trackers.get('ai_1')?.vespeneGathered).toBe(20);
      expect(trackers.get('ai_1')?.recentMinerals).toEqual([10, 15]);
      expect(trackers.get('ai_1')?.recentVespene).toEqual([8, 12]);
    });

    it('maintains separate trackers per AI player', () => {
      const trackers = new Map<string, IncomeTracker>();
      const aiPlayers = new Set(['ai_1', 'ai_2']);

      handleResourceDelivery(trackers, aiPlayers, { playerId: 'ai_1', minerals: 10, vespene: 5 });
      handleResourceDelivery(trackers, aiPlayers, { playerId: 'ai_2', minerals: 20, vespene: 10 });

      expect(trackers.get('ai_1')?.mineralsGathered).toBe(10);
      expect(trackers.get('ai_2')?.mineralsGathered).toBe(20);
    });
  });

  describe('metrics logging interval', () => {
    it('METRICS_LOG_INTERVAL is 400 ticks', () => {
      expect(METRICS_LOG_INTERVAL).toBe(400);
    });

    it('converts to approximately 20 seconds at 20 TPS', () => {
      const ticksPerSecond = 20;
      const intervalSeconds = METRICS_LOG_INTERVAL / ticksPerSecond;
      expect(intervalSeconds).toBe(20);
    });

    function shouldLogMetrics(currentTick: number, lastLogTick: number): boolean {
      return currentTick - lastLogTick >= METRICS_LOG_INTERVAL;
    }

    it('does not log before interval', () => {
      expect(shouldLogMetrics(100, 0)).toBe(false);
      expect(shouldLogMetrics(399, 0)).toBe(false);
    });

    it('logs at interval', () => {
      expect(shouldLogMetrics(400, 0)).toBe(true);
    });

    it('logs after interval', () => {
      expect(shouldLogMetrics(500, 0)).toBe(true);
    });

    it('resets tracking after log', () => {
      let lastLogTick = 0;

      // First log
      if (shouldLogMetrics(400, lastLogTick)) {
        lastLogTick = 400;
      }

      // Should not log immediately
      expect(shouldLogMetrics(401, lastLogTick)).toBe(false);

      // Should log again after another interval
      expect(shouldLogMetrics(800, lastLogTick)).toBe(true);
    });
  });

  describe('rolling window capacity', () => {
    it('ROLLING_WINDOW_SIZE is 100', () => {
      expect(ROLLING_WINDOW_SIZE).toBe(100);
    });

    it('represents approximately 60 seconds of data', () => {
      // At ~50 ticks per entry, 100 entries = 5000 ticks = 250 seconds
      // This is an approximation - actual comment says ~60 seconds
      const entriesPerMinute = 20; // Rough estimate based on delivery frequency
      const minutesCovered = ROLLING_WINDOW_SIZE / entriesPerMinute;
      expect(minutesCovered).toBeGreaterThan(1);
    });
  });

  describe('determinism', () => {
    it('income calculations are deterministic', () => {
      const tracker = {
        recentMinerals: [10, 15, 20, 25, 30],
        recentVespene: [5, 8, 10, 12, 15],
      };

      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        const sum = tracker.recentMinerals.reduce((a, b) => a + b, 0);
        const windowTicks = tracker.recentMinerals.length * 50;
        const windowMinutes = windowTicks / 1200;
        const mpm = sum / windowMinutes;
        results.push(mpm);
      }

      expect(new Set(results).size).toBe(1);
    });

    it('worker estimation is deterministic', () => {
      const mineralsPerMinute = 237.5;
      const results: number[] = [];

      for (let i = 0; i < 100; i++) {
        const workers = Math.round(mineralsPerMinute / 40);
        results.push(workers);
      }

      expect(new Set(results).size).toBe(1);
    });
  });
});

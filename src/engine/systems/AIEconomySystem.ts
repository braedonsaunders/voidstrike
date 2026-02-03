/**
 * AIEconomySystem - Tracks and reports AI economy metrics
 *
 * This system monitors the simulation-based AI economy and provides
 * debugging/metrics information. It tracks:
 * - Income rate (minerals/plasma per minute)
 * - Worker efficiency
 * - Saturation levels
 * - Resource flow
 */

import { System } from '../ecs/System';
import type { IGameInstance } from '../core/IGameInstance';
import { EnhancedAISystem } from './EnhancedAISystem';
import { debugAI } from '@/utils/debugLogger';

interface AIEconomyMetrics {
  playerId: string;
  // Income tracking
  mineralsPerMinute: number;
  plasmaPerMinute: number;
  totalMineralsGathered: number;
  totalPlasmaGathered: number;
  // Worker stats
  workerCount: number;
  gatheringWorkers: number;
  incomePerWorker: number;
  // Health indicators
  workerReplacementPriority: number;
  depletedPatchesNearBases: number;
  // Current resources
  currentMinerals: number;
  currentPlasma: number;
}

interface IncomeTracker {
  mineralsGathered: number;
  plasmaGathered: number;
  lastResetTick: number;
  // Rolling window for per-minute calculation
  recentMinerals: number[];
  recentPlasma: number[];
}

export class AIEconomySystem extends System {
  public readonly name = 'AIEconomySystem';
  // Priority is set by SystemRegistry based on dependencies (runs after EnhancedAISystem)

  private aiSystem: EnhancedAISystem | null = null;
  private incomeTrackers: Map<string, IncomeTracker> = new Map();
  private lastMetricsLogTick: number = 0;
  private readonly METRICS_LOG_INTERVAL = 400; // Log every ~20 seconds

  constructor(game: IGameInstance) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen for resource deliveries to track income
    this.game.eventBus.on(
      'resource:delivered',
      (data: { playerId: string | undefined; minerals: number; plasma: number }) => {
        if (!data.playerId) return;

        // Only track AI players
        const aiSystem = this.getAISystem();
        if (!aiSystem || !aiSystem.isAIPlayer(data.playerId)) return;

        let tracker = this.incomeTrackers.get(data.playerId);
        if (!tracker) {
          tracker = this.createTracker();
          this.incomeTrackers.set(data.playerId, tracker);
        }

        tracker.mineralsGathered += data.minerals;
        tracker.plasmaGathered += data.plasma;
        tracker.recentMinerals.push(data.minerals);
        tracker.recentPlasma.push(data.plasma);

        // Keep rolling window to ~60 seconds of data (1200 ticks at 20 ticks/sec)
        if (tracker.recentMinerals.length > 100) {
          tracker.recentMinerals.shift();
          tracker.recentPlasma.shift();
        }
      }
    );
  }

  private createTracker(): IncomeTracker {
    return {
      mineralsGathered: 0,
      plasmaGathered: 0,
      lastResetTick: this.game.getCurrentTick(),
      recentMinerals: [],
      recentPlasma: [],
    };
  }

  private getAISystem(): EnhancedAISystem | null {
    if (!this.aiSystem) {
      this.aiSystem = this.world.getSystem(EnhancedAISystem) || null;
    }
    return this.aiSystem;
  }

  public update(_deltaTime: number): void {
    const currentTick = this.game.getCurrentTick();

    // Periodically log metrics for debugging
    if (currentTick - this.lastMetricsLogTick >= this.METRICS_LOG_INTERVAL) {
      this.lastMetricsLogTick = currentTick;
      this.logAllAIMetrics();
    }
  }

  private logAllAIMetrics(): void {
    for (const [playerId, tracker] of this.incomeTrackers) {
      const metrics = this.calculateMetrics(playerId, tracker);
      if (metrics) {
        debugAI.log(
          `[AIEconomy] ${playerId}: ` +
            `${metrics.mineralsPerMinute.toFixed(0)} M/min, ` +
            `${metrics.plasmaPerMinute.toFixed(0)} G/min, ` +
            `workers: ${metrics.workerCount}, ` +
            `income/worker: ${metrics.incomePerWorker.toFixed(1)}, ` +
            `current: ${metrics.currentMinerals.toFixed(0)}M/${metrics.currentPlasma.toFixed(0)}G`
        );
      }
    }
  }

  private calculateMetrics(playerId: string, tracker: IncomeTracker): AIEconomyMetrics | null {
    const aiSystem = this.getAISystem();
    if (!aiSystem) return null;

    // Get current AI state (use public method if available, otherwise estimate)
    const currentTick = this.game.getCurrentTick();
    const ticksSinceReset = currentTick - tracker.lastResetTick;
    const _minutesSinceReset = ticksSinceReset / (20 * 60); // 20 ticks/sec, 60 sec/min

    // Calculate per-minute rates from recent window
    const recentMineralsSum = tracker.recentMinerals.reduce((a, b) => a + b, 0);
    const recentPlasmaSum = tracker.recentPlasma.reduce((a, b) => a + b, 0);

    // Estimate ticks covered by recent window (~5 seconds per entry on average)
    const recentWindowTicks = tracker.recentMinerals.length * 50;
    const recentWindowMinutes = recentWindowTicks / (20 * 60);

    const mineralsPerMinute = recentWindowMinutes > 0 ? recentMineralsSum / recentWindowMinutes : 0;
    const plasmaPerMinute = recentWindowMinutes > 0 ? recentPlasmaSum / recentWindowMinutes : 0;

    // Get worker count from AI system (we need to expose this or estimate)
    // For now, estimate based on income rate
    const estimatedWorkers = mineralsPerMinute > 0 ? Math.round(mineralsPerMinute / 40) : 0;
    const incomePerWorker =
      estimatedWorkers > 0 ? (mineralsPerMinute + plasmaPerMinute) / estimatedWorkers : 0;

    return {
      playerId,
      mineralsPerMinute,
      plasmaPerMinute,
      totalMineralsGathered: tracker.mineralsGathered,
      totalPlasmaGathered: tracker.plasmaGathered,
      workerCount: estimatedWorkers,
      gatheringWorkers: estimatedWorkers,
      incomePerWorker,
      workerReplacementPriority: 0, // Would need access to AI state
      depletedPatchesNearBases: 0, // Would need access to AI state
      currentMinerals: 0, // Would need access to AI state
      currentPlasma: 0, // Would need access to AI state
    };
  }

  /**
   * Get current economy metrics for an AI player
   */
  public getMetrics(playerId: string): AIEconomyMetrics | null {
    const tracker = this.incomeTrackers.get(playerId);
    if (!tracker) return null;
    return this.calculateMetrics(playerId, tracker);
  }

  /**
   * Get all tracked AI economy metrics
   */
  public getAllMetrics(): AIEconomyMetrics[] {
    const metrics: AIEconomyMetrics[] = [];
    for (const [playerId, tracker] of this.incomeTrackers) {
      const m = this.calculateMetrics(playerId, tracker);
      if (m) metrics.push(m);
    }
    return metrics;
  }
}

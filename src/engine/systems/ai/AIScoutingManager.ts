/**
 * AIScoutingManager - Map exploration and intel gathering
 *
 * Handles:
 * - Scout unit selection
 * - Scout target determination
 * - Scouting phase execution
 * - Tracking scouted locations
 * - Enemy intel gathering via ScoutingMemory primitive
 *
 * Integrates with ScoutingMemory for sophisticated intel tracking:
 * - Building sightings with confidence decay
 * - Unit type tracking with last-seen timestamps
 * - Strategy inference (rush/macro/tech/air transition)
 * - Tech tree reconstruction from observed buildings
 */

import { Transform } from '../../components/Transform';
import { Unit } from '../../components/Unit';
import { Building } from '../../components/Building';
import { Health } from '../../components/Health';
import { Selectable } from '../../components/Selectable';
import type { IGameInstance } from '../../core/IGameInstance';
import type { GameCommand } from '../../core/GameCommand';
import { debugAI } from '@/utils/debugLogger';
import type { AICoordinator, AIPlayer } from './AICoordinator';
import type {
  InferredStrategy,
  ScoutedBuilding,
  ScoutedUnitType,
  StrategicInference,
} from '../../ai/ScoutingMemory';

export class AIScoutingManager {
  private game: IGameInstance;
  private coordinator: AICoordinator;

  constructor(game: IGameInstance, coordinator: AICoordinator) {
    this.game = game;
    this.coordinator = coordinator;
  }

  // === Scout Unit Selection ===

  /**
   * Get a unit suitable for scouting.
   * Prefers fast units, falls back to idle workers.
   */
  public getScoutUnit(ai: AIPlayer): number | null {
    const config = ai.config!;
    const preferredScoutTypes = new Set(['vanguard', 'scorcher', config.tactical.scoutUnit]);

    const entities = this.coordinator.getCachedUnits();

    // First pass: find fast units
    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      if (preferredScoutTypes.has(unit.unitId)) {
        return entity.id;
      }
    }

    // Second pass: find idle worker
    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;
      if (unit.isWorker && unit.state === 'idle') {
        return entity.id;
      }
    }

    return null;
  }

  // === Scout Target Selection ===

  /**
   * Get the next scouting target based on map layout and what's been scouted.
   * Uses ScoutingMemory to prioritize areas with stale intel.
   */
  public getScoutTarget(ai: AIPlayer): { x: number; y: number } | null {
    const config = this.game.config;

    // Common scouting locations (expansions, map corners)
    const targets = [
      { x: config.mapWidth - 30, y: config.mapHeight - 30 }, // Far corner
      { x: 30, y: 30 }, // Near corner
      { x: config.mapWidth / 2, y: config.mapHeight / 2 }, // Center
      { x: config.mapWidth - 30, y: 30 }, // Top right
      { x: 30, y: config.mapHeight - 30 }, // Bottom left
      // Expansion locations (mid points along edges)
      { x: config.mapWidth / 2, y: 30 }, // Top middle
      { x: config.mapWidth / 2, y: config.mapHeight - 30 }, // Bottom middle
      { x: 30, y: config.mapHeight / 2 }, // Left middle
      { x: config.mapWidth - 30, y: config.mapHeight / 2 }, // Right middle
    ];

    // Find first location we haven't scouted
    for (const target of targets) {
      const key = `${Math.floor(target.x / 20)},${Math.floor(target.y / 20)}`;
      if (!ai.scoutedLocations.has(key)) {
        return target;
      }
    }

    // All locations scouted, pick random location for re-scouting
    const random = this.coordinator.getRandom(ai.playerId);
    return {
      x: random.next() * config.mapWidth,
      y: random.next() * config.mapHeight,
    };
  }

  /**
   * Mark a location as scouted.
   */
  public markScouted(ai: AIPlayer, x: number, y: number): void {
    const key = `${Math.floor(x / 20)},${Math.floor(y / 20)}`;
    ai.scoutedLocations.add(key);
  }

  // === Scouting Phase Execution ===

  /**
   * Execute the scouting phase.
   */
  public executeScoutingPhase(ai: AIPlayer, currentTick: number): void {
    ai.lastScoutTick = currentTick;

    const scoutUnit = this.getScoutUnit(ai);
    if (!scoutUnit) {
      ai.state = 'building';
      return;
    }

    const scoutTarget = this.getScoutTarget(ai);
    if (!scoutTarget) {
      ai.state = 'building';
      return;
    }

    // Issue move command to scout
    const command: GameCommand = {
      tick: currentTick,
      playerId: ai.playerId,
      type: 'MOVE',
      entityIds: [scoutUnit],
      targetPosition: scoutTarget,
    };

    this.game.issueAICommand(command);

    // Mark target area as scouted (will be updated more accurately when unit arrives)
    this.markScouted(ai, scoutTarget.x, scoutTarget.y);

    debugAI.log(
      `[AIScouting] ${ai.playerId}: Scouting location (${scoutTarget.x.toFixed(0)}, ${scoutTarget.y.toFixed(0)})`
    );

    // Return to building state
    ai.state = 'building';
  }

  // === Enemy Intel Gathering ===

  /**
   * Update enemy intel based on what's visible.
   * Uses ScoutingMemory for tracking enemy buildings and units.
   * Called periodically to track enemy composition and locations.
   */
  public updateEnemyIntel(ai: AIPlayer): void {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;
    const currentTick = this.game.getCurrentTick();
    const scoutingMemory = ai.scoutingMemory;

    // Gather visible enemy entity IDs for ScoutingMemory update
    const visibleEnemyIds = new Set<number>();

    let enemyAirUnits = 0;
    let enemyArmyStrength = 0;
    let enemyBaseCount = 0;
    let lastKnownEnemyBase: { x: number; y: number } | null = null;

    // Collect visible enemy units
    const units = this.coordinator.getCachedUnitsWithTransform();
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;

      visibleEnemyIds.add(entity.id);

      // Track air units
      if (unit.isFlying && !unit.isWorker) {
        enemyAirUnits++;
      }

      // Estimate army strength
      if (!unit.isWorker) {
        enemyArmyStrength += unit.attackDamage * 2 + health.max / 10;
      }
    }

    // Collect visible enemy buildings
    const buildings = this.coordinator.getCachedBuildingsWithTransform();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;

      visibleEnemyIds.add(entity.id);

      if (baseTypes.includes(building.buildingId)) {
        enemyBaseCount++;
        lastKnownEnemyBase = { x: transform.x, y: transform.y };
      }
    }

    // Update ScoutingMemory with visible enemies (handles intel tracking internally)
    scoutingMemory.update(this.coordinator.getWorld(), currentTick, visibleEnemyIds);

    // Update AI's intel from direct observations
    ai.enemyAirUnits = enemyAirUnits;
    ai.enemyArmyStrength = enemyArmyStrength;
    ai.enemyBaseCount = Math.max(1, enemyBaseCount); // Assume at least 1 base

    if (lastKnownEnemyBase) {
      ai.enemyBaseLocation = lastKnownEnemyBase;
    }

    // Log strategy inference periodically
    if (currentTick % 500 === 0) {
      // Get intel for each known enemy
      for (const intel of scoutingMemory.getAllIntel()) {
        debugAI.log(
          `[AIScouting] ${ai.playerId}: Enemy ${intel.playerId} strategy: ` +
            `${intel.strategy.strategy} (${intel.strategy.confidence}), ` +
            `tech level: ${intel.tech.techLevel}, ` +
            `army supply: ${intel.estimatedArmySupply}, ` +
            `workers: ${intel.estimatedWorkers}`
        );
      }
    }
  }

  /**
   * Get the inferred enemy strategy from ScoutingMemory.
   * Returns the most likely strategy the enemy is pursuing.
   */
  public getInferredEnemyStrategy(ai: AIPlayer, enemyPlayerId: string): InferredStrategy | null {
    const intel = ai.scoutingMemory.getIntel(enemyPlayerId);
    return intel?.strategy.strategy ?? null;
  }

  /**
   * Get full strategic inference for an enemy.
   */
  public getStrategicInference(ai: AIPlayer, enemyPlayerId: string): StrategicInference | null {
    const intel = ai.scoutingMemory.getIntel(enemyPlayerId);
    return intel?.strategy ?? null;
  }

  /**
   * Get known enemy buildings from ScoutingMemory.
   * Includes confidence levels based on when they were last seen.
   */
  public getKnownEnemyBuildings(ai: AIPlayer, enemyPlayerId: string): ScoutedBuilding[] {
    return ai.scoutingMemory.getConfirmedBuildings(enemyPlayerId);
  }

  /**
   * Get known enemy unit types from ScoutingMemory.
   */
  public getKnownEnemyUnitTypes(ai: AIPlayer, enemyPlayerId: string): ScoutedUnitType[] {
    const intel = ai.scoutingMemory.getIntel(enemyPlayerId);
    if (!intel) return [];
    return Array.from(intel.unitTypes.values());
  }

  /**
   * Check if a specific location has been scouted.
   */
  public isLocationScouted(ai: AIPlayer, x: number, y: number): boolean {
    const key = `${Math.floor(x / 20)},${Math.floor(y / 20)}`;
    return ai.scoutedLocations.has(key);
  }

  /**
   * Get the number of locations scouted.
   */
  public getScoutedLocationCount(ai: AIPlayer): number {
    return ai.scoutedLocations.size;
  }

  /**
   * Clear all scouted locations (useful for map refresh).
   */
  public clearScoutedLocations(ai: AIPlayer): void {
    ai.scoutedLocations.clear();
  }

  /**
   * Get enemy intel summary for a specific enemy player.
   */
  public getEnemyIntelSummary(
    ai: AIPlayer,
    enemyPlayerId: string
  ): {
    knownBuildingCount: number;
    knownUnitTypes: number;
    averageIntelConfidence: number;
    inferredStrategy: InferredStrategy | null;
    strategyConfidence: string;
    estimatedArmySupply: number;
    estimatedWorkers: number;
  } {
    const intel = ai.scoutingMemory.getIntel(enemyPlayerId);

    if (!intel) {
      return {
        knownBuildingCount: 0,
        knownUnitTypes: 0,
        averageIntelConfidence: 0,
        inferredStrategy: null,
        strategyConfidence: 'low',
        estimatedArmySupply: 0,
        estimatedWorkers: 0,
      };
    }

    const buildings = ai.scoutingMemory.getConfirmedBuildings(enemyPlayerId);
    const avgConfidence =
      buildings.length > 0
        ? buildings.reduce((sum, b) => sum + b.confidence, 0) / buildings.length
        : 0;

    return {
      knownBuildingCount: buildings.length,
      knownUnitTypes: intel.unitTypes.size,
      averageIntelConfidence: avgConfidence,
      inferredStrategy: intel.strategy.strategy,
      strategyConfidence: intel.strategy.confidence,
      estimatedArmySupply: intel.estimatedArmySupply,
      estimatedWorkers: intel.estimatedWorkers,
    };
  }

  /**
   * Check if we should build anti-air based on enemy intel.
   */
  public shouldBuildAntiAir(ai: AIPlayer, enemyPlayerId: string): boolean {
    return ai.scoutingMemory.shouldBuildAntiAir(enemyPlayerId);
  }

  /**
   * Get all known enemy players.
   */
  public getKnownEnemies(ai: AIPlayer): string[] {
    return ai.scoutingMemory.getAllIntel().map((intel) => intel.playerId);
  }

  /**
   * Get strategic recommendation for dealing with an enemy.
   */
  public getStrategicRecommendation(ai: AIPlayer, enemyPlayerId: string): string {
    return ai.scoutingMemory.getStrategicRecommendation(enemyPlayerId);
  }
}

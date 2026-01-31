/**
 * AIScoutingManager - Map exploration and intel gathering
 *
 * Handles:
 * - Scout unit selection
 * - Scout target determination
 * - Scouting phase execution
 * - Tracking scouted locations
 * - Enemy intel gathering
 */

import { Transform } from '../../components/Transform';
import { Unit } from '../../components/Unit';
import { Health } from '../../components/Health';
import { Selectable } from '../../components/Selectable';
import { Game, GameCommand } from '../../core/Game';
import { debugAI } from '@/utils/debugLogger';
import type { AICoordinator, AIPlayer } from './AICoordinator';

export class AIScoutingManager {
  private game: Game;
  private coordinator: AICoordinator;

  constructor(game: Game, coordinator: AICoordinator) {
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

    // Find first unscouted location
    for (const target of targets) {
      const key = `${Math.floor(target.x / 20)},${Math.floor(target.y / 20)}`;
      if (!ai.scoutedLocations.has(key)) {
        return target;
      }
    }

    // All predefined locations scouted, pick random location
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

    this.game.processCommand(command);

    // Mark target area as scouted (will be updated more accurately when unit arrives)
    this.markScouted(ai, scoutTarget.x, scoutTarget.y);

    debugAI.log(`[AIScouting] ${ai.playerId}: Scouting location (${scoutTarget.x.toFixed(0)}, ${scoutTarget.y.toFixed(0)})`);

    // Return to building state
    ai.state = 'building';
  }

  // === Enemy Intel Gathering ===

  /**
   * Update enemy intel based on what's visible.
   * Called periodically to track enemy composition and locations.
   */
  public updateEnemyIntel(ai: AIPlayer): void {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    let enemyAirUnits = 0;
    let enemyArmyStrength = 0;
    let enemyBaseCount = 0;
    let lastKnownEnemyBase: { x: number; y: number } | null = null;

    // Count enemy units
    const units = this.coordinator.getCachedUnitsWithTransform();
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;

      // Track air units
      if (unit.isFlying && !unit.isWorker) {
        enemyAirUnits++;
      }

      // Estimate army strength
      if (!unit.isWorker) {
        enemyArmyStrength += unit.attackDamage * 2 + health.max / 10;
      }
    }

    // Count enemy bases
    const buildings = this.coordinator.getCachedBuildingsWithTransform();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<import('../../components/Building').Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;

      if (baseTypes.includes(building.buildingId)) {
        enemyBaseCount++;
        lastKnownEnemyBase = { x: transform.x, y: transform.y };
      }
    }

    // Update AI's intel
    ai.enemyAirUnits = enemyAirUnits;
    ai.enemyArmyStrength = enemyArmyStrength;
    ai.enemyBaseCount = Math.max(1, enemyBaseCount); // Assume at least 1 base

    if (lastKnownEnemyBase) {
      ai.enemyBaseLocation = lastKnownEnemyBase;
    }
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
}

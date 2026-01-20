/**
 * AITacticsManager - Combat decisions and tactical state management
 *
 * Handles:
 * - Tactical state determination (attacking, defending, harassing, etc.)
 * - Attack phase execution
 * - Defense phase execution
 * - Harass phase execution
 * - Expand phase execution
 * - Army rallying and unit coordination
 *
 * Works with AIMicroSystem for unit-level micro (kiting, focus fire).
 */

import { Transform } from '../../components/Transform';
import { Unit } from '../../components/Unit';
import { Building } from '../../components/Building';
import { Health } from '../../components/Health';
import { Selectable } from '../../components/Selectable';
import { Game, GameCommand } from '../../core/Game';
import { debugAI } from '@/utils/debugLogger';
import type { AICoordinator, AIPlayer, AIState } from './AICoordinator';

// Threat assessment constants
const THREAT_WINDOW_TICKS = 200; // ~10 seconds at 20 ticks/sec

export class AITacticsManager {
  private game: Game;
  private coordinator: AICoordinator;

  constructor(game: Game, coordinator: AICoordinator) {
    this.game = game;
    this.coordinator = coordinator;
  }

  private get world() {
    return this.game.world;
  }

  // === Tactical State Determination ===

  /**
   * Determine and update the AI's tactical state based on game conditions.
   */
  public updateTacticalState(ai: AIPlayer, currentTick: number): void {
    const config = ai.config!;
    const diffConfig = config.difficultyConfig[ai.difficulty];
    const tacticalConfig = config.tactical;

    // Priority 1: Defense when under attack
    if (this.isUnderAttack(ai)) {
      ai.state = 'defending';
      return;
    }

    // Priority 2: Scouting (if enabled and cooldown expired)
    if (diffConfig.scoutingEnabled && currentTick - ai.lastScoutTick >= ai.scoutCooldown) {
      if (ai.scoutedLocations.size < 5) {
        ai.state = 'scouting';
        return;
      }
    }

    // Priority 3: Attack when army is strong enough
    const attackThreshold = tacticalConfig.attackThresholds[ai.difficulty];
    const canAttack = ai.armySupply >= attackThreshold;

    if (canAttack && currentTick - ai.lastAttackTick >= ai.attackCooldown) {
      ai.state = 'attacking';
      return;
    }

    // Priority 4: Harassment (if enabled and cooldown expired)
    if (diffConfig.harassmentEnabled && currentTick - ai.lastHarassTick >= ai.harassCooldown) {
      if (this.hasHarassUnits(ai)) {
        ai.state = 'harassing';
        return;
      }
    }

    // Default: Building/macro mode
    ai.state = 'building';
  }

  /**
   * Check if the AI is currently under attack.
   */
  public isUnderAttack(ai: AIPlayer): boolean {
    const currentTick = this.game.getCurrentTick();
    const recentEnemyContact = (currentTick - ai.lastEnemyContact) < THREAT_WINDOW_TICKS;

    const buildings = this.coordinator.getCachedBuildings();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;

      // Critical damage always counts as under attack
      if (health.getHealthPercent() < 0.5) return true;
      // Moderate damage with recent enemy contact
      if (health.getHealthPercent() < 0.9 && recentEnemyContact) return true;
    }
    return false;
  }

  /**
   * Check if the AI has units suitable for harassment.
   */
  private hasHarassUnits(ai: AIPlayer): boolean {
    const config = ai.config!;
    const harassUnitTypes = config.tactical.harassUnits || [];

    for (const unitType of harassUnitTypes) {
      if ((ai.armyComposition.get(unitType) || 0) > 0) {
        return true;
      }
    }
    return false;
  }

  // === Army Unit Retrieval ===

  /**
   * Get all army (non-worker) units for the AI.
   */
  public getArmyUnits(playerId: string): number[] {
    const armyUnits: number[] = [];
    const entities = this.coordinator.getCachedUnits();

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;
      if (unit.isWorker) continue;
      if (health.isDead()) continue;
      // Exclude non-combat units (0 attack damage)
      if (unit.attackDamage === 0) continue;

      armyUnits.push(entity.id);
    }

    return armyUnits;
  }

  /**
   * Get fast units suitable for harassment.
   */
  public getHarassUnits(ai: AIPlayer): number[] {
    const config = ai.config!;
    const harassUnitTypes = new Set(config.tactical.harassUnits || ['scorcher', 'vanguard']);

    const harassUnits: number[] = [];
    const entities = this.coordinator.getCachedUnits();

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      if (harassUnitTypes.has(unit.unitId)) {
        harassUnits.push(entity.id);
      }
    }

    return harassUnits.slice(0, 4); // Max 4 units for harass
  }

  // === Enemy Detection ===

  /**
   * Find the enemy base location.
   */
  public findEnemyBase(ai: AIPlayer): { x: number; y: number } | null {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId === ai.playerId) continue;
      if (baseTypes.includes(building.buildingId)) {
        return { x: transform.x, y: transform.y };
      }
    }

    // Return any enemy building
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId === ai.playerId) continue;
      return { x: transform.x, y: transform.y };
    }

    return null;
  }

  /**
   * Find harassment targets (enemy workers or expansions).
   */
  public findHarassTarget(ai: AIPlayer): { x: number; y: number } | null {
    const units = this.coordinator.getCachedUnitsWithTransform();

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) {
        return { x: transform.x, y: transform.y };
      }
    }

    // Otherwise target enemy base
    return this.findEnemyBase(ai);
  }

  // === Phase Execution ===

  /**
   * Rally newly produced units to the army rally point.
   */
  public rallyNewUnitsToArmy(ai: AIPlayer): void {
    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) return;

    // Rally point slightly in front of base
    const rallyPoint = {
      x: basePos.x + 10,
      y: basePos.y + 10,
    };

    // Find idle army units and rally them
    const units = this.coordinator.getCachedUnitsWithTransform();
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (unit.isWorker) continue;
      if (health.isDead()) continue;
      if (unit.state !== 'idle') continue;

      // Check if unit is far from rally point
      const dx = transform.x - rallyPoint.x;
      const dy = transform.y - rallyPoint.y;
      if (Math.sqrt(dx * dx + dy * dy) > 15) {
        const command: GameCommand = {
          tick: this.game.getCurrentTick(),
          playerId: ai.playerId,
          type: 'MOVE',
          entityIds: [entity.id],
          targetPosition: rallyPoint,
        };
        this.game.processCommand(command);
      }
    }
  }

  /**
   * Execute the expanding phase.
   */
  public executeExpandingPhase(ai: AIPlayer): void {
    // Expansion is handled by AIBuildOrderExecutor
    // Just switch state back to building
    ai.state = 'building';
  }

  /**
   * Execute the attacking phase.
   */
  public executeAttackingPhase(ai: AIPlayer, currentTick: number): void {
    ai.lastAttackTick = currentTick;

    const armyUnits = this.getArmyUnits(ai.playerId);
    if (armyUnits.length === 0) {
      ai.state = 'building';
      return;
    }

    // Find target
    const enemyBase = this.findEnemyBase(ai);
    if (!enemyBase) {
      ai.state = 'building';
      return;
    }

    // Issue attack command
    const command: GameCommand = {
      tick: currentTick,
      playerId: ai.playerId,
      type: 'ATTACK',
      entityIds: armyUnits,
      targetPosition: enemyBase,
    };

    this.game.processCommand(command);

    debugAI.log(`[AITactics] ${ai.playerId}: Attacking with ${armyUnits.length} units`);

    // Return to building state after issuing attack
    ai.state = 'building';
  }

  /**
   * Execute the defending phase.
   */
  public executeDefendingPhase(ai: AIPlayer, currentTick: number): void {
    const armyUnits = this.getArmyUnits(ai.playerId);
    if (armyUnits.length === 0) {
      ai.state = 'building';
      return;
    }

    // Find our base to defend
    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) {
      ai.state = 'building';
      return;
    }

    // Find nearest enemy threat
    const threatPos = this.findNearestThreat(ai, basePos);
    if (!threatPos) {
      ai.state = 'building';
      return;
    }

    // Issue attack command towards threat
    const command: GameCommand = {
      tick: currentTick,
      playerId: ai.playerId,
      type: 'ATTACK',
      entityIds: armyUnits,
      targetPosition: threatPos,
    };

    this.game.processCommand(command);

    debugAI.log(`[AITactics] ${ai.playerId}: Defending base with ${armyUnits.length} units`);

    // Check if threat is eliminated
    if (!this.isUnderAttack(ai)) {
      ai.state = 'building';
    }
  }

  /**
   * Find the nearest enemy threat to a position.
   */
  private findNearestThreat(ai: AIPlayer, position: { x: number; y: number }): { x: number; y: number } | null {
    const units = this.coordinator.getCachedUnitsWithTransform();
    let nearestThreat: { x: number; y: number; distance: number } | null = null;

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) continue;

      const dx = transform.x - position.x;
      const dy = transform.y - position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Only consider threats within reasonable distance of base
      if (distance > 50) continue;

      if (!nearestThreat || distance < nearestThreat.distance) {
        nearestThreat = { x: transform.x, y: transform.y, distance };
      }
    }

    return nearestThreat ? { x: nearestThreat.x, y: nearestThreat.y } : null;
  }

  /**
   * Execute the harassing phase.
   */
  public executeHarassingPhase(ai: AIPlayer, currentTick: number): void {
    ai.lastHarassTick = currentTick;

    const harassUnits = this.getHarassUnits(ai);
    if (harassUnits.length === 0) {
      ai.state = 'building';
      return;
    }

    // Attack enemy workers or expansion
    const harassTarget = this.findHarassTarget(ai);
    if (!harassTarget) {
      ai.state = 'building';
      return;
    }

    const command: GameCommand = {
      tick: currentTick,
      playerId: ai.playerId,
      type: 'ATTACK',
      entityIds: harassUnits,
      targetPosition: harassTarget,
    };

    this.game.processCommand(command);

    debugAI.log(`[AITactics] ${ai.playerId}: Harassing with ${harassUnits.length} units`);

    ai.state = 'building';
  }
}

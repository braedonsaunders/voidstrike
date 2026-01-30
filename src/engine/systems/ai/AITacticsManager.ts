/**
 * AITacticsManager - Combat decisions and tactical state management
 *
 * Handles:
 * - Tactical state determination (attacking, defending, harassing, etc.)
 * - Attack phase execution with SC2-style engagement persistence
 * - Defense phase execution
 * - Harass phase execution
 * - Expand phase execution
 * - Army rallying and unit coordination
 * - Hunt mode for finishing off enemies (victory pursuit)
 *
 * Works with AIMicroSystem for unit-level micro (kiting, focus fire).
 *
 * SC2-STYLE IMPROVEMENTS:
 * - Army stays in attacking state while engaged
 * - Idle assault units get re-commanded to continue fighting
 * - Hunt mode activates when enemy has few buildings left
 * - Actively seeks out remaining enemy buildings to trigger victory
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

// SC2-style engagement tracking constants
const ENGAGEMENT_CHECK_INTERVAL = 10; // Check engagement every 10 ticks (~500ms)
const RE_COMMAND_IDLE_INTERVAL = 40; // Re-command idle units every 40 ticks (~2 sec)
const HUNT_MODE_BUILDING_THRESHOLD = 3; // Enter hunt mode when enemy has <= 3 buildings
const ASSAULT_IDLE_TIMEOUT_TICKS = 100; // If assault unit idle for 5 sec, consider it "stuck"

export class AITacticsManager {
  private game: Game;
  private coordinator: AICoordinator;

  // SC2-style engagement tracking per AI player
  private lastEngagementCheck: Map<string, number> = new Map();
  private lastReCommandTick: Map<string, number> = new Map();
  private isEngaged: Map<string, boolean> = new Map();

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
   *
   * SC2-STYLE: This is a persistent engagement system, not fire-and-forget.
   * - Tracks whether army is currently engaged in combat
   * - Re-commands idle assault units to continue fighting
   * - Enters hunt mode when enemy has few buildings left
   * - Only returns to building state when battle is over
   */
  public executeAttackingPhase(ai: AIPlayer, currentTick: number): void {
    const armyUnits = this.getArmyUnits(ai.playerId);
    if (armyUnits.length === 0) {
      ai.state = 'building';
      this.isEngaged.set(ai.playerId, false);
      return;
    }

    // Count enemy buildings to determine if we should enter hunt mode
    const enemyBuildingCount = this.countEnemyBuildings(ai);

    // SC2-STYLE: Check if we should enter hunt mode
    const inHuntMode = enemyBuildingCount > 0 && enemyBuildingCount <= HUNT_MODE_BUILDING_THRESHOLD;

    // Check engagement status periodically
    const lastCheck = this.lastEngagementCheck.get(ai.playerId) || 0;
    if (currentTick - lastCheck >= ENGAGEMENT_CHECK_INTERVAL) {
      const engaged = this.checkEngagementStatus(ai, armyUnits);
      this.isEngaged.set(ai.playerId, engaged);
      this.lastEngagementCheck.set(ai.playerId, currentTick);
    }

    const engaged = this.isEngaged.get(ai.playerId) || false;

    // Find target - use different strategy based on mode
    let attackTarget: { x: number; y: number } | null = null;

    if (inHuntMode) {
      // SC2-STYLE HUNT MODE: Find ANY enemy building, spread units to hunt
      attackTarget = this.findAnyEnemyBuilding(ai);
      if (!attackTarget) {
        // No buildings found - enemy defeated or buildings are hidden
        ai.state = 'building';
        this.isEngaged.set(ai.playerId, false);
        debugAI.log(`[AITactics] ${ai.playerId}: Hunt mode - no enemy buildings found, returning to build`);
        return;
      }
      debugAI.log(`[AITactics] ${ai.playerId}: HUNT MODE - targeting enemy building at (${attackTarget.x.toFixed(0)}, ${attackTarget.y.toFixed(0)})`);
    } else {
      // Normal attack - target enemy base
      attackTarget = this.findEnemyBase(ai);
      if (!attackTarget) {
        // Try finding ANY enemy building as fallback
        attackTarget = this.findAnyEnemyBuilding(ai);
        if (!attackTarget) {
          ai.state = 'building';
          this.isEngaged.set(ai.playerId, false);
          return;
        }
      }
    }

    // SC2-STYLE: Re-command idle assault units periodically
    const lastReCommand = this.lastReCommandTick.get(ai.playerId) || 0;
    const shouldReCommand = currentTick - lastReCommand >= RE_COMMAND_IDLE_INTERVAL;

    if (shouldReCommand) {
      // Find units that are idle in assault mode or have been stuck
      const idleAssaultUnits = this.getIdleAssaultUnits(ai.playerId, armyUnits);

      if (idleAssaultUnits.length > 0) {
        // Re-command idle assault units to attack
        const command: GameCommand = {
          tick: currentTick,
          playerId: ai.playerId,
          type: 'ATTACK',
          entityIds: idleAssaultUnits,
          targetPosition: attackTarget,
        };
        this.game.processCommand(command);
        debugAI.log(`[AITactics] ${ai.playerId}: Re-commanding ${idleAssaultUnits.length} idle assault units`);
      }

      this.lastReCommandTick.set(ai.playerId, currentTick);
    }

    // Initial attack command (only when first entering attacking state)
    if (ai.lastAttackTick === 0 || currentTick - ai.lastAttackTick >= ai.attackCooldown) {
      ai.lastAttackTick = currentTick;

      // Issue attack command to all army units
      const command: GameCommand = {
        tick: currentTick,
        playerId: ai.playerId,
        type: 'ATTACK',
        entityIds: armyUnits,
        targetPosition: attackTarget,
      };
      this.game.processCommand(command);

      debugAI.log(`[AITactics] ${ai.playerId}: Attacking with ${armyUnits.length} units${inHuntMode ? ' (HUNT MODE)' : ''}`);
    }

    // SC2-STYLE: Stay in attacking state while engaged or in hunt mode
    // Only return to building when:
    // 1. No enemy buildings exist (victory imminent)
    // 2. Not engaged and no enemy buildings nearby
    if (enemyBuildingCount === 0) {
      // Victory pursuit complete
      ai.state = 'building';
      this.isEngaged.set(ai.playerId, false);
      debugAI.log(`[AITactics] ${ai.playerId}: No enemy buildings remaining, returning to build`);
    } else if (!engaged && !inHuntMode) {
      // Not engaged and not in hunt mode - check if we should retreat
      // Only retreat if we've been disengaged for a while
      const disengagedDuration = currentTick - (this.lastEngagementCheck.get(ai.playerId) || 0);
      if (disengagedDuration > 100) { // 5 seconds of no combat
        ai.state = 'building';
        this.isEngaged.set(ai.playerId, false);
        debugAI.log(`[AITactics] ${ai.playerId}: Disengaged for ${disengagedDuration} ticks, returning to build`);
      }
    }
    // Otherwise stay in attacking state - SC2-style persistence
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

  // ==================== SC2-STYLE ENGAGEMENT TRACKING ====================

  /**
   * Check if the AI's army is currently engaged in combat.
   * Returns true if units are attacking or being attacked.
   */
  private checkEngagementStatus(ai: AIPlayer, armyUnits: number[]): boolean {
    let engagedCount = 0;
    const entities = this.coordinator.getCachedUnitsWithTransform();

    for (const entityId of armyUnits) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');
      if (!unit || !health) continue;

      // Unit is engaged if:
      // 1. It has an active target
      // 2. It's in attacking state
      // 3. It recently took damage
      if (unit.targetEntityId !== null || unit.state === 'attacking') {
        engagedCount++;
      }
    }

    // Consider engaged if >= 20% of army is in combat
    return engagedCount >= Math.max(1, armyUnits.length * 0.2);
  }

  /**
   * Find army units that are idle in assault mode (need re-commanding).
   * These are units that arrived at their destination and are scanning but found nothing.
   */
  private getIdleAssaultUnits(playerId: string, armyUnits: number[]): number[] {
    const idleUnits: number[] = [];

    for (const entityId of armyUnits) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');
      if (!unit || !health) continue;
      if (health.isDead()) continue;

      // Unit needs re-commanding if:
      // 1. It's in assault mode AND
      // 2. It's idle (no target, not moving) AND
      // 3. It's been idle for a while (stuck or no enemies found)
      const isIdleAssault = unit.isInAssaultMode &&
        unit.state === 'idle' &&
        unit.targetEntityId === null;

      // Also include units that are completely idle (not in assault mode but should be attacking)
      const isCompletelyIdle = unit.state === 'idle' &&
        unit.targetEntityId === null &&
        !unit.isInAssaultMode &&
        !unit.isHoldingPosition;

      if (isIdleAssault || isCompletelyIdle) {
        idleUnits.push(entityId);
      }
    }

    return idleUnits;
  }

  /**
   * Count all enemy buildings (for hunt mode determination).
   */
  private countEnemyBuildings(ai: AIPlayer): number {
    let count = 0;
    const buildings = this.world.getEntitiesWith('Building', 'Selectable', 'Health');

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue; // Don't count blueprints

      count++;
    }

    return count;
  }

  /**
   * Find ANY enemy building (not just base buildings).
   * Used for hunt mode to track down remaining structures.
   */
  private findAnyEnemyBuilding(ai: AIPlayer): { x: number; y: number } | null {
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');

    // First try to find a base building (higher priority)
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue;

      if (baseTypes.includes(building.buildingId)) {
        return { x: transform.x, y: transform.y };
      }
    }

    // If no base found, return ANY enemy building
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue;

      return { x: transform.x, y: transform.y };
    }

    return null;
  }

  /**
   * Find all enemy buildings and return them for map sweeping.
   * Used when in hunt mode to spread units across multiple targets.
   */
  public findAllEnemyBuildings(ai: AIPlayer): Array<{ x: number; y: number; entityId: number }> {
    const results: Array<{ x: number; y: number; entityId: number }> = [];
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue;

      results.push({ x: transform.x, y: transform.y, entityId: entity.id });
    }

    return results;
  }
}

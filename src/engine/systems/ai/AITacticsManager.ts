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
import type { AICoordinator, AIPlayer, AIState, EnemyRelation } from './AICoordinator';
import { isEnemy } from '../../combat/TargetAcquisition';

// Threat assessment constants
const THREAT_WINDOW_TICKS = 200; // ~10 seconds at 20 ticks/sec

// SC2-style engagement tracking constants
const ENGAGEMENT_CHECK_INTERVAL = 10; // Check engagement every 10 ticks (~500ms)
const RE_COMMAND_IDLE_INTERVAL = 40; // Re-command idle units every 40 ticks (~2 sec)
const DEFENSE_COMMAND_INTERVAL = 20; // Re-command defending units every 20 ticks (~1 sec)
const HUNT_MODE_BUILDING_THRESHOLD = 3; // Enter hunt mode when enemy has <= 3 buildings
const ASSAULT_IDLE_TIMEOUT_TICKS = 100; // If assault unit idle for 5 sec, consider it "stuck"

export class AITacticsManager {
  private game: Game;
  private coordinator: AICoordinator;

  // SC2-style engagement tracking per AI player
  private lastEngagementCheck: Map<string, number> = new Map();
  private lastReCommandTick: Map<string, number> = new Map();
  private lastDefenseCommandTick: Map<string, number> = new Map();
  private isEngaged: Map<string, boolean> = new Map();

  constructor(game: Game, coordinator: AICoordinator) {
    this.game = game;
    this.coordinator = coordinator;
  }

  private get world() {
    return this.game.world;
  }

  // === SC2-Style Enemy Relations & Targeting ===

  /** Half-life for grudge decay in ticks (~60 seconds at 20 ticks/second) */
  private static readonly GRUDGE_HALF_LIFE_TICKS = 1200;
  /** How often to update enemy relations (every 100 ticks = 5 seconds) */
  private static readonly ENEMY_RELATIONS_UPDATE_INTERVAL = 100;
  private lastEnemyRelationsUpdate: Map<string, number> = new Map();

  /**
   * Update enemy relations for an AI player.
   * Calculates base distances, threat scores, and selects primary enemy.
   */
  public updateEnemyRelations(ai: AIPlayer, currentTick: number): void {
    const lastUpdate = this.lastEnemyRelationsUpdate.get(ai.playerId) ?? 0;
    if (currentTick - lastUpdate < AITacticsManager.ENEMY_RELATIONS_UPDATE_INTERVAL) {
      return;
    }
    this.lastEnemyRelationsUpdate.set(ai.playerId, currentTick);

    // Get our base position
    const myBase = this.coordinator.findAIBase(ai);
    if (!myBase) return;

    // Find all enemy players
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    const enemyPlayerIds = new Set<string>();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      if (selectable.playerId === ai.playerId) continue;
      // Check if this is actually an enemy (not an ally on the same team)
      // In FFA (team 0), everyone is an enemy. In team games, only different teams are enemies.
      const myBuildings = buildings.filter(b => b.get<Selectable>('Selectable')?.playerId === ai.playerId);
      const myTeam = myBuildings[0]?.get<Selectable>('Selectable')?.teamId ?? 0;
      if (!isEnemy(ai.playerId, myTeam, selectable.playerId, selectable.teamId)) continue;
      enemyPlayerIds.add(selectable.playerId);
    }

    // Update relations for each enemy
    for (const enemyPlayerId of enemyPlayerIds) {
      let relation = ai.enemyRelations.get(enemyPlayerId);
      if (!relation) {
        relation = {
          lastAttackedUsTick: 0,
          lastWeAttackedTick: 0,
          damageDealtToUs: 0,
          damageWeDealt: 0,
          baseDistance: Infinity,
          threatScore: 0,
          basePosition: null,
          armyNearUs: 0,
        };
        ai.enemyRelations.set(enemyPlayerId, relation);
      }

      // Find enemy base position and calculate distance
      let enemyBase: { x: number; y: number } | null = null;
      for (const entity of buildings) {
        const selectable = entity.get<Selectable>('Selectable')!;
        const building = entity.get<Building>('Building')!;
        const transform = entity.get<Transform>('Transform')!;
        if (selectable.playerId !== enemyPlayerId) continue;
        if (ai.config?.roles.baseTypes.includes(building.buildingId)) {
          enemyBase = { x: transform.x, y: transform.y };
          break;
        }
      }
      // Fallback to any enemy building
      if (!enemyBase) {
        for (const entity of buildings) {
          const selectable = entity.get<Selectable>('Selectable')!;
          const transform = entity.get<Transform>('Transform')!;
          if (selectable.playerId !== enemyPlayerId) continue;
          enemyBase = { x: transform.x, y: transform.y };
          break;
        }
      }

      if (enemyBase) {
        relation.basePosition = enemyBase;
        const dx = enemyBase.x - myBase.x;
        const dy = enemyBase.y - myBase.y;
        relation.baseDistance = Math.sqrt(dx * dx + dy * dy);
      }

      // Decay grudge damage over time
      const decayFactor = Math.pow(0.5, (currentTick - relation.lastAttackedUsTick) / AITacticsManager.GRUDGE_HALF_LIFE_TICKS);
      relation.damageDealtToUs *= decayFactor;

      // Calculate enemy army near our base (within 40 units)
      const THREAT_RADIUS = 40;
      let armyNearUs = 0;
      const units = this.coordinator.getCachedUnitsWithTransform();
      for (const entity of units) {
        const selectable = entity.get<Selectable>('Selectable')!;
        const unit = entity.get<Unit>('Unit')!;
        const transform = entity.get<Transform>('Transform')!;
        const health = entity.get<Health>('Health')!;
        if (selectable.playerId !== enemyPlayerId) continue;
        if (health.isDead() || unit.isWorker) continue;
        const dx = transform.x - myBase.x;
        const dy = transform.y - myBase.y;
        if (Math.sqrt(dx * dx + dy * dy) < THREAT_RADIUS) {
          // Unit component doesn't store supplyCost, use 1 as default
          armyNearUs += 1;
        }
      }
      relation.armyNearUs = armyNearUs;

      // Calculate threat score
      relation.threatScore = this.calculateThreatScore(ai, relation, currentTick);
    }

    // Clean up relations for dead players
    for (const [enemyId, _relation] of ai.enemyRelations) {
      if (!enemyPlayerIds.has(enemyId)) {
        ai.enemyRelations.delete(enemyId);
      }
    }

    // Select primary enemy based on personality-weighted scores
    ai.primaryEnemyId = this.selectPrimaryEnemy(ai);

    // Update legacy enemyBaseLocation for backward compatibility
    if (ai.primaryEnemyId) {
      const primaryRelation = ai.enemyRelations.get(ai.primaryEnemyId);
      if (primaryRelation?.basePosition) {
        ai.enemyBaseLocation = primaryRelation.basePosition;
      }
    }
  }

  /**
   * Calculate threat score for an enemy based on various factors.
   */
  private calculateThreatScore(ai: AIPlayer, relation: EnemyRelation, currentTick: number): number {
    const weights = ai.personalityWeights;

    // Normalize base distance (closer = higher score, max at 200 units)
    const maxDistance = 200;
    const proximityScore = Math.max(0, 1 - relation.baseDistance / maxDistance);

    // Threat from army near our base (normalized by our army supply)
    const myArmy = Math.max(1, ai.armySupply);
    const threatScore = Math.min(1, relation.armyNearUs / myArmy);

    // Retaliation score based on recent damage and recency
    const ticksSinceAttack = currentTick - relation.lastAttackedUsTick;
    const recency = Math.max(0, 1 - ticksSinceAttack / 2400); // 2 minute falloff
    const retaliationScore = Math.min(1, relation.damageDealtToUs / 500) * recency;

    // Opportunity score - inversely proportional to their strength
    // (we don't track enemy army supply directly, so use proximity as proxy)
    const opportunityScore = proximityScore * 0.5; // Closer enemies are easier to attack

    // Weighted sum using personality weights
    return (
      proximityScore * weights.proximity +
      threatScore * weights.threat +
      retaliationScore * weights.retaliation +
      opportunityScore * weights.opportunity
    );
  }

  /**
   * Select the primary enemy to attack based on personality-weighted threat scores.
   */
  private selectPrimaryEnemy(ai: AIPlayer): string | null {
    let bestEnemyId: string | null = null;
    let bestScore = -Infinity;

    for (const [enemyId, relation] of ai.enemyRelations) {
      if (relation.threatScore > bestScore) {
        bestScore = relation.threatScore;
        bestEnemyId = enemyId;
      }
    }

    if (bestEnemyId) {
      const relation = ai.enemyRelations.get(bestEnemyId)!;
      debugAI.log(`[AITacticsManager] ${ai.playerId} selected primary enemy: ${bestEnemyId} ` +
        `(score: ${relation.threatScore.toFixed(2)}, distance: ${relation.baseDistance.toFixed(0)}, ` +
        `armyNearUs: ${relation.armyNearUs})`);
    }

    return bestEnemyId;
  }

  /**
   * Record damage dealt to this AI by an attacker.
   * Called from event handler when units take damage.
   */
  public recordDamageReceived(ai: AIPlayer, attackerPlayerId: string, damage: number, currentTick: number): void {
    let relation = ai.enemyRelations.get(attackerPlayerId);
    if (!relation) {
      relation = {
        lastAttackedUsTick: currentTick,
        lastWeAttackedTick: 0,
        damageDealtToUs: damage,
        damageWeDealt: 0,
        baseDistance: Infinity,
        threatScore: 0,
        basePosition: null,
        armyNearUs: 0,
      };
      ai.enemyRelations.set(attackerPlayerId, relation);
    } else {
      relation.damageDealtToUs += damage;
      relation.lastAttackedUsTick = currentTick;
    }
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
   * Uses SC2-style primary enemy selection - each AI targets their own primary enemy
   * based on proximity, threat, and personality-weighted scores.
   *
   * @param targetPlayerId - Optional specific enemy to target. If not provided, uses primary enemy.
   */
  public findEnemyBase(ai: AIPlayer, targetPlayerId?: string): { x: number; y: number } | null {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    // Use primary enemy if no specific target provided
    const enemyToTarget = targetPlayerId ?? ai.primaryEnemyId;

    // If we have a primary enemy with a known base position, use it directly
    if (enemyToTarget) {
      const relation = ai.enemyRelations.get(enemyToTarget);
      if (relation?.basePosition) {
        return relation.basePosition;
      }
    }

    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');

    // If we have a specific enemy to target, find their base
    if (enemyToTarget) {
      for (const entity of buildings) {
        const selectable = entity.get<Selectable>('Selectable')!;
        const building = entity.get<Building>('Building')!;
        const transform = entity.get<Transform>('Transform')!;

        if (selectable.playerId !== enemyToTarget) continue;
        if (baseTypes.includes(building.buildingId)) {
          return { x: transform.x, y: transform.y };
        }
      }

      // Fallback: any building from this enemy
      for (const entity of buildings) {
        const selectable = entity.get<Selectable>('Selectable')!;
        const transform = entity.get<Transform>('Transform')!;

        if (selectable.playerId !== enemyToTarget) continue;
        return { x: transform.x, y: transform.y };
      }
    }

    // No primary enemy selected - fallback to legacy behavior (first enemy found)
    // This should rarely happen as updateEnemyRelations should set primaryEnemyId
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
   *
   * FIX: Added throttling to prevent constant re-commanding which was causing units
   * to move around without actually attacking. Now only re-commands idle units
   * periodically, allowing engaged units to continue fighting.
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

    // Find nearest enemy threat - search wider radius for defense (100 units instead of 50)
    const threatPos = this.findNearestThreat(ai, basePos);

    // If no threat found near base, check if we're still under attack
    // (enemy might have retreated or been killed)
    if (!threatPos) {
      if (!this.isUnderAttack(ai)) {
        ai.state = 'building';
        debugAI.log(`[AITactics] ${ai.playerId}: No threats found, returning to build`);
      }
      return;
    }

    // Throttle defense commands - don't re-command every tick
    const lastDefenseCommand = this.lastDefenseCommandTick.get(ai.playerId) || 0;
    const shouldCommand = currentTick - lastDefenseCommand >= DEFENSE_COMMAND_INTERVAL;

    if (shouldCommand) {
      // Only command units that are idle or not yet engaged in combat
      // Units already attacking or moving to attack should continue without interruption
      const idleDefenders = this.getIdleDefendingUnits(ai.playerId, armyUnits);

      if (idleDefenders.length > 0) {
        // Issue attack-move command towards threat
        // Using ATTACK with targetPosition triggers attack-move behavior
        const command: GameCommand = {
          tick: currentTick,
          playerId: ai.playerId,
          type: 'ATTACK',
          entityIds: idleDefenders,
          targetPosition: threatPos,
        };

        this.game.processCommand(command);

        debugAI.log(
          `[AITactics] ${ai.playerId}: Commanding ${idleDefenders.length}/${armyUnits.length} ` +
          `idle defenders to threat at (${threatPos.x.toFixed(0)}, ${threatPos.y.toFixed(0)})`
        );
      }

      this.lastDefenseCommandTick.set(ai.playerId, currentTick);
    }

    // Check if threat is eliminated
    if (!this.isUnderAttack(ai)) {
      ai.state = 'building';
      debugAI.log(`[AITactics] ${ai.playerId}: Threat eliminated, returning to build`);
    }
  }

  /**
   * Get army units that are idle and need to be commanded for defense.
   * Excludes units already engaged in combat or moving to attack.
   */
  private getIdleDefendingUnits(playerId: string, armyUnits: number[]): number[] {
    const idleUnits: number[] = [];

    for (const entityId of armyUnits) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');
      if (!unit || !health) continue;
      if (health.isDead()) continue;

      // Unit needs commanding if:
      // 1. It's idle (not doing anything)
      // 2. It's completely stopped (no target, no destination)
      const isIdle = unit.state === 'idle' && unit.targetEntityId === null;
      const isStuck = unit.state === 'idle' && !unit.isInAssaultMode;

      // Don't interrupt units that are:
      // - Currently attacking (has a target)
      // - Moving to attack (attackmoving state)
      // - In assault mode and actively scanning
      const isEngaged = unit.targetEntityId !== null ||
        unit.state === 'attacking' ||
        (unit.state === 'attackmoving' && unit.targetX !== null);

      if ((isIdle || isStuck) && !isEngaged) {
        idleUnits.push(entityId);
      }
    }

    return idleUnits;
  }

  /**
   * Find the nearest enemy threat to a position.
   * Searches within a reasonable radius of the base for enemy units.
   */
  private findNearestThreat(ai: AIPlayer, position: { x: number; y: number }): { x: number; y: number } | null {
    const units = this.coordinator.getCachedUnitsWithTransform();
    let nearestThreat: { x: number; y: number; distance: number } | null = null;

    // Search radius for threats - 80 units should cover most base areas
    // This is larger than before (50) to catch enemies that are attacking from range
    const THREAT_SEARCH_RADIUS = 80;

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;
      // Include workers too - they might be attacking or part of a worker rush
      // Only skip if unit has 0 attack damage
      if (unit.attackDamage === 0) continue;

      const dx = transform.x - position.x;
      const dy = transform.y - position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Only consider threats within search radius of base
      if (distance > THREAT_SEARCH_RADIUS) continue;

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

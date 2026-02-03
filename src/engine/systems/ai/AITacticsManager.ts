/**
 * AITacticsManager - Combat decisions and tactical state management
 *
 * Handles:
 * - Tactical state determination (attacking, defending, harassing, etc.)
 * - Attack phase execution with RTS-style engagement persistence
 * - Defense phase execution with coordinated retreat
 * - Harass phase execution
 * - Expand phase execution
 * - Army rallying and unit coordination
 * - Hunt mode for finishing off enemies (victory pursuit)
 *
 * Integrates AI primitives for sophisticated tactical decisions:
 * - InfluenceMap: Spatial threat analysis and safe pathfinding
 * - RetreatCoordination: Coordinated army retreat with rally points
 * - FormationControl: Army positioning and formation management
 *
 * Works with AIMicroSystem for unit-level micro (kiting, focus fire).
 */

import { Transform } from '../../components/Transform';
import { Unit } from '../../components/Unit';
import { Building } from '../../components/Building';
import { Health } from '../../components/Health';
import { Selectable } from '../../components/Selectable';
import type { Entity } from '../../ecs/Entity';
import type { IGameInstance } from '../../core/IGameInstance';
import type { GameCommand } from '../../core/GameCommand';
import { debugAI } from '@/utils/debugLogger';
import type { AICoordinator, AIPlayer, EnemyRelation } from './AICoordinator';
import { isEnemy } from '../../combat/TargetAcquisition';
import type { ThreatAnalysis } from '../../ai/InfluenceMap';
import type { FormationType } from '../../ai/FormationControl';

// Threat assessment constants
const THREAT_WINDOW_TICKS = 200; // ~10 seconds at 20 ticks/sec

// RTS-style engagement tracking constants
const ENGAGEMENT_CHECK_INTERVAL = 10; // Check engagement every 10 ticks (~500ms)
const RE_COMMAND_IDLE_INTERVAL = 40; // Re-command idle units every 40 ticks (~2 sec)
const DEFENSE_COMMAND_INTERVAL = 20; // Re-command defending units every 20 ticks (~1 sec)
const HUNT_MODE_BUILDING_THRESHOLD = 3; // Enter hunt mode when enemy has <= 3 buildings

export class AITacticsManager {
  private game: IGameInstance;
  private coordinator: AICoordinator;

  // RTS-style engagement tracking per AI player
  private lastEngagementCheck: Map<string, number> = new Map();
  private lastReCommandTick: Map<string, number> = new Map();
  private lastDefenseCommandTick: Map<string, number> = new Map();
  private isEngaged: Map<string, boolean> = new Map();

  constructor(game: IGameInstance, coordinator: AICoordinator) {
    this.game = game;
    this.coordinator = coordinator;
  }

  private get world() {
    return this.game.world;
  }

  // === RTS-Style Enemy Relations & Targeting ===

  /** Half-life for grudge decay in ticks (~60 seconds at 20 ticks/second) */
  private static readonly GRUDGE_HALF_LIFE_TICKS = 1200;
  /** How often to update enemy relations (every 100 ticks = 5 seconds) */
  private static readonly ENEMY_RELATIONS_UPDATE_INTERVAL = 100;
  private lastEnemyRelationsUpdate: Map<string, number> = new Map();

  /**
   * Update enemy relations for an AI player.
   * Uses InfluenceMap for threat analysis instead of manual calculations.
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

    // Get influence map for threat analysis
    const influenceMap = this.coordinator.getInfluenceMap();

    // Find all enemy players
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    const enemyPlayerIds = new Set<string>();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      if (selectable.playerId === ai.playerId) continue;
      const myBuildings = buildings.filter(
        (b: Entity) => b.get<Selectable>('Selectable')?.playerId === ai.playerId
      );
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
      const decayFactor = Math.pow(
        0.5,
        (currentTick - relation.lastAttackedUsTick) / AITacticsManager.GRUDGE_HALF_LIFE_TICKS
      );
      relation.damageDealtToUs *= decayFactor;

      // Use InfluenceMap for threat analysis near our base
      const threatAnalysis = influenceMap.getThreatAnalysis(myBase.x, myBase.y, ai.playerId);
      relation.armyNearUs = Math.round(threatAnalysis.enemyInfluence);

      // Calculate threat score using influence map data
      relation.threatScore = this.calculateThreatScoreWithInfluence(
        ai,
        relation,
        threatAnalysis,
        currentTick
      );
    }

    // Clean up relations for dead players
    for (const [enemyId] of ai.enemyRelations) {
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
   * Calculate threat score using InfluenceMap threat analysis.
   */
  private calculateThreatScoreWithInfluence(
    ai: AIPlayer,
    relation: EnemyRelation,
    threatAnalysis: ThreatAnalysis,
    currentTick: number
  ): number {
    const weights = ai.personalityWeights;

    // Normalize base distance (closer = higher score, max at 200 units)
    const maxDistance = 200;
    const proximityScore = Math.max(0, 1 - relation.baseDistance / maxDistance);

    // Use influence map threat data
    const threatScore = Math.min(1, threatAnalysis.dangerLevel);

    // Retaliation score based on recent damage and recency
    const ticksSinceAttack = currentTick - relation.lastAttackedUsTick;
    const recency = Math.max(0, 1 - ticksSinceAttack / 2400); // 2 minute falloff
    const retaliationScore = Math.min(1, relation.damageDealtToUs / 500) * recency;

    // Opportunity score - use influence data to determine if we have area control
    const weHaveControl = threatAnalysis.friendlyInfluence > threatAnalysis.enemyInfluence;
    const opportunityScore = proximityScore * (weHaveControl ? 0.7 : 0.3);

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
      debugAI.log(
        `[AITacticsManager] ${ai.playerId} selected primary enemy: ${bestEnemyId} ` +
          `(score: ${relation.threatScore.toFixed(2)}, distance: ${relation.baseDistance.toFixed(0)}, ` +
          `armyNearUs: ${relation.armyNearUs})`
      );
    }

    return bestEnemyId;
  }

  /**
   * Record damage dealt to this AI by an attacker.
   */
  public recordDamageReceived(
    ai: AIPlayer,
    attackerPlayerId: string,
    damage: number,
    currentTick: number
  ): void {
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
   * Check if the AI is currently under attack using InfluenceMap.
   */
  public isUnderAttack(ai: AIPlayer): boolean {
    const currentTick = this.game.getCurrentTick();
    const recentEnemyContact = currentTick - ai.lastEnemyContact < THREAT_WINDOW_TICKS;

    // Use influence map for threat detection
    const basePos = this.coordinator.findAIBase(ai);
    if (basePos) {
      const influenceMap = this.coordinator.getInfluenceMap();
      const threatAnalysis = influenceMap.getThreatAnalysis(basePos.x, basePos.y, ai.playerId);

      // High danger level indicates attack
      if (threatAnalysis.dangerLevel > 0.5) return true;
    }

    // Also check building damage
    const buildings = this.coordinator.getCachedBuildings();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;

      if (health.getHealthPercent() < 0.5) return true;
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
      if (unit.attackDamage === 0) continue;

      armyUnits.push(entity.id);
    }

    return armyUnits;
  }

  /**
   * Get army units with their positions for formation calculations.
   */
  private getArmyUnitsWithPositions(playerId: string): Array<{
    entityId: number;
    x: number;
    y: number;
    unitId: string;
    attackRange: number;
  }> {
    const units: Array<{
      entityId: number;
      x: number;
      y: number;
      unitId: string;
      attackRange: number;
    }> = [];
    const entities = this.coordinator.getCachedUnitsWithTransform();

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== playerId) continue;
      if (unit.isWorker) continue;
      if (health.isDead()) continue;
      if (unit.attackDamage === 0) continue;

      units.push({
        entityId: entity.id,
        x: transform.x,
        y: transform.y,
        unitId: unit.unitId,
        attackRange: unit.attackRange,
      });
    }

    return units;
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
   * Find the enemy base location using primary enemy selection.
   */
  public findEnemyBase(ai: AIPlayer, targetPlayerId?: string): { x: number; y: number } | null {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    const enemyToTarget = targetPlayerId ?? ai.primaryEnemyId;

    if (enemyToTarget) {
      const relation = ai.enemyRelations.get(enemyToTarget);
      if (relation?.basePosition) {
        return relation.basePosition;
      }
    }

    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');

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

      for (const entity of buildings) {
        const selectable = entity.get<Selectable>('Selectable')!;
        const transform = entity.get<Transform>('Transform')!;

        if (selectable.playerId !== enemyToTarget) continue;
        return { x: transform.x, y: transform.y };
      }
    }

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId === ai.playerId) continue;
      if (baseTypes.includes(building.buildingId)) {
        return { x: transform.x, y: transform.y };
      }
    }

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

    return this.findEnemyBase(ai);
  }

  // === Formation Control Integration ===

  // Track active formation groups per player
  private activeFormationGroups: Map<string, string> = new Map();

  /**
   * Calculate and apply formation positions for army units before attack.
   */
  private applyFormation(
    ai: AIPlayer,
    armyUnits: Array<{
      entityId: number;
      x: number;
      y: number;
      unitId: string;
      attackRange: number;
    }>,
    targetPosition: { x: number; y: number },
    formationType: FormationType
  ): Array<{ entityId: number; position: { x: number; y: number } }> {
    const formationControl = ai.formationControl;

    // Get or create formation group for this player
    let groupId = this.activeFormationGroups.get(ai.playerId);

    // Delete old group and create new one with current unit IDs
    if (groupId) {
      formationControl.deleteGroup(groupId);
    }

    const unitIds = armyUnits.map((u) => u.entityId);
    groupId = formationControl.createGroup(this.world, unitIds, ai.playerId);
    this.activeFormationGroups.set(ai.playerId, groupId);

    // Calculate formation based on type (returns FormationSlot[])
    let formationSlots;

    switch (formationType) {
      case 'concave':
        formationSlots = formationControl.calculateConcaveFormation(
          this.world,
          groupId,
          targetPosition
        );
        break;
      case 'box':
        formationSlots = formationControl.calculateBoxFormation(this.world, groupId);
        break;
      case 'spread':
        formationSlots = formationControl.calculateSpreadFormation(this.world, groupId);
        break;
      case 'line':
      default:
        // Line formation - use box as fallback since line doesn't exist
        formationSlots = formationControl.calculateBoxFormation(this.world, groupId);
        break;
    }

    // Convert FormationSlot[] to expected return type
    return formationSlots.map((slot) => ({
      entityId: slot.entityId,
      position: slot.targetPosition,
    }));
  }

  // === Phase Execution ===

  /**
   * Rally newly produced units to the army rally point.
   */
  public rallyNewUnitsToArmy(ai: AIPlayer): void {
    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) return;

    const rallyPoint = {
      x: basePos.x + 10,
      y: basePos.y + 10,
    };

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
        this.game.issueAICommand(command);
      }
    }
  }

  /**
   * Execute the expanding phase.
   */
  public executeExpandingPhase(ai: AIPlayer): void {
    ai.state = 'building';
  }

  /**
   * Execute the attacking phase with formation control.
   */
  public executeAttackingPhase(ai: AIPlayer, currentTick: number): void {
    const armyUnits = this.getArmyUnits(ai.playerId);
    if (armyUnits.length === 0) {
      ai.state = 'building';
      this.isEngaged.set(ai.playerId, false);
      return;
    }

    const enemyBuildingCount = this.countEnemyBuildings(ai);
    const inHuntMode = enemyBuildingCount > 0 && enemyBuildingCount <= HUNT_MODE_BUILDING_THRESHOLD;

    // Check engagement status periodically
    const lastCheck = this.lastEngagementCheck.get(ai.playerId) || 0;
    if (currentTick - lastCheck >= ENGAGEMENT_CHECK_INTERVAL) {
      const engaged = this.checkEngagementStatus(ai, armyUnits);
      this.isEngaged.set(ai.playerId, engaged);
      this.lastEngagementCheck.set(ai.playerId, currentTick);
    }

    const engaged = this.isEngaged.get(ai.playerId) || false;

    // Find target
    let attackTarget: { x: number; y: number } | null = null;

    if (inHuntMode) {
      attackTarget = this.findAnyEnemyBuilding(ai);
      if (!attackTarget) {
        ai.state = 'building';
        this.isEngaged.set(ai.playerId, false);
        debugAI.log(
          `[AITactics] ${ai.playerId}: Hunt mode - no enemy buildings found, returning to build`
        );
        return;
      }
      debugAI.log(
        `[AITactics] ${ai.playerId}: HUNT MODE - targeting enemy building at (${attackTarget.x.toFixed(0)}, ${attackTarget.y.toFixed(0)})`
      );
    } else {
      attackTarget = this.findEnemyBase(ai);
      if (!attackTarget) {
        attackTarget = this.findAnyEnemyBuilding(ai);
        if (!attackTarget) {
          ai.state = 'building';
          this.isEngaged.set(ai.playerId, false);
          return;
        }
      }
    }

    // Apply formation for coordinated attack
    const armyWithPositions = this.getArmyUnitsWithPositions(ai.playerId);
    if (armyWithPositions.length > 3 && !engaged) {
      // Use concave formation for engaging enemy
      const formation = this.applyFormation(ai, armyWithPositions, attackTarget, 'concave');

      // Move units to formation positions before attack
      for (const { entityId, position } of formation) {
        const command: GameCommand = {
          tick: currentTick,
          playerId: ai.playerId,
          type: 'MOVE',
          entityIds: [entityId],
          targetPosition: position,
        };
        this.game.issueAICommand(command);
      }
    }

    // Re-command idle assault units periodically
    const lastReCommand = this.lastReCommandTick.get(ai.playerId) || 0;
    const shouldReCommand = currentTick - lastReCommand >= RE_COMMAND_IDLE_INTERVAL;

    if (shouldReCommand) {
      const idleAssaultUnits = this.getIdleAssaultUnits(ai.playerId, armyUnits);

      if (idleAssaultUnits.length > 0) {
        // Spread units around the target to prevent clumping
        // Each unit gets a slightly different target position in a circle
        const spreadRadius = 12;
        for (let i = 0; i < idleAssaultUnits.length; i++) {
          const angle = (i / idleAssaultUnits.length) * Math.PI * 2;
          const spreadTarget = {
            x: attackTarget.x + Math.cos(angle) * spreadRadius,
            y: attackTarget.y + Math.sin(angle) * spreadRadius,
          };
          const command: GameCommand = {
            tick: currentTick,
            playerId: ai.playerId,
            type: 'ATTACK',
            entityIds: [idleAssaultUnits[i]],
            targetPosition: spreadTarget,
          };
          this.game.issueAICommand(command);
        }
        debugAI.log(
          `[AITactics] ${ai.playerId}: Re-commanding ${idleAssaultUnits.length} idle assault units with spread positions`
        );
      }

      this.lastReCommandTick.set(ai.playerId, currentTick);
    }

    // Initial attack command
    if (ai.lastAttackTick === 0 || currentTick - ai.lastAttackTick >= ai.attackCooldown) {
      ai.lastAttackTick = currentTick;

      if (inHuntMode && armyUnits.length > 1) {
        // In hunt mode, spread units to surround the target and prevent clumping
        const spreadRadius = 15;
        for (let i = 0; i < armyUnits.length; i++) {
          const angle = (i / armyUnits.length) * Math.PI * 2;
          const spreadTarget = {
            x: attackTarget.x + Math.cos(angle) * spreadRadius,
            y: attackTarget.y + Math.sin(angle) * spreadRadius,
          };
          const command: GameCommand = {
            tick: currentTick,
            playerId: ai.playerId,
            type: 'ATTACK',
            entityIds: [armyUnits[i]],
            targetPosition: spreadTarget,
          };
          this.game.issueAICommand(command);
        }
        debugAI.log(
          `[AITactics] ${ai.playerId}: HUNT MODE - spreading ${armyUnits.length} units around target`
        );
      } else {
        // Regular attack - send all units to same target
        const command: GameCommand = {
          tick: currentTick,
          playerId: ai.playerId,
          type: 'ATTACK',
          entityIds: armyUnits,
          targetPosition: attackTarget,
        };
        this.game.issueAICommand(command);
        debugAI.log(`[AITactics] ${ai.playerId}: Attacking with ${armyUnits.length} units`);
      }
    }

    // State transition logic
    if (enemyBuildingCount === 0) {
      // No buildings left - check for remaining enemy units
      if (this.hasRemainingEnemyUnits(ai)) {
        // Hunt remaining enemy units
        const enemyCluster = this.findEnemyUnitCluster(ai);
        if (enemyCluster) {
          debugAI.log(
            `[AITactics] ${ai.playerId}: UNIT HUNT MODE - no buildings, targeting enemy units at ` +
              `(${enemyCluster.x.toFixed(0)}, ${enemyCluster.y.toFixed(0)})`
          );

          // Attack-move to enemy unit cluster
          const command: GameCommand = {
            tick: currentTick,
            playerId: ai.playerId,
            type: 'ATTACK',
            entityIds: armyUnits,
            targetPosition: enemyCluster,
          };
          this.game.issueAICommand(command);
        }
      } else {
        // Enemy fully eliminated - return units to base and transition to building
        this.returnUnitsToBase(ai, armyUnits, currentTick);
        ai.state = 'building';
        this.isEngaged.set(ai.playerId, false);
        debugAI.log(`[AITactics] ${ai.playerId}: Enemy eliminated, returning units to base`);
      }
    } else if (!engaged && !inHuntMode) {
      const disengagedDuration = currentTick - (this.lastEngagementCheck.get(ai.playerId) || 0);
      if (disengagedDuration > 100) {
        ai.state = 'building';
        this.isEngaged.set(ai.playerId, false);
        debugAI.log(
          `[AITactics] ${ai.playerId}: Disengaged for ${disengagedDuration} ticks, returning to build`
        );
      }
    }
  }

  /**
   * Execute the defending phase with RetreatCoordination.
   */
  public executeDefendingPhase(ai: AIPlayer, currentTick: number): void {
    const armyUnits = this.getArmyUnits(ai.playerId);
    if (armyUnits.length === 0) {
      ai.state = 'building';
      return;
    }

    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) {
      ai.state = 'building';
      return;
    }

    // Get retreat coordinator and influence map
    const retreatCoordinator = ai.retreatCoordinator;
    const influenceMap = this.coordinator.getInfluenceMap();

    // Update retreat coordination with current state
    retreatCoordinator.update(this.world, currentTick, ai.playerId, influenceMap);

    // Check group retreat status
    const retreatStatus = retreatCoordinator.getGroupStatus(this.world, ai.playerId);
    if (retreatStatus.isRetreating) {
      // Issue retreat commands to retreating units
      for (const entityId of armyUnits) {
        if (retreatCoordinator.shouldRetreat(ai.playerId, entityId)) {
          const retreatTarget = retreatCoordinator.getRetreatTarget(ai.playerId, entityId);
          if (retreatTarget) {
            const command: GameCommand = {
              tick: currentTick,
              playerId: ai.playerId,
              type: 'MOVE',
              entityIds: [entityId],
              targetPosition: retreatTarget,
            };
            this.game.issueAICommand(command);
          }
        }
      }

      // Check if we can re-engage
      if (retreatStatus.canReengage) {
        retreatCoordinator.forceReengage(ai.playerId);
        debugAI.log(`[AITactics] ${ai.playerId}: Re-engaging after retreat`);
      }
      return;
    }

    // Check for individual unit retreats (e.g., low-health units in small skirmishes)
    // This handles cases where individual units need to retreat but group retreat isn't triggered
    let individualRetreatsIssued = 0;
    for (const entityId of armyUnits) {
      if (retreatCoordinator.shouldRetreat(ai.playerId, entityId)) {
        const retreatTarget = retreatCoordinator.getRetreatTarget(ai.playerId, entityId);
        if (retreatTarget) {
          const command: GameCommand = {
            tick: currentTick,
            playerId: ai.playerId,
            type: 'MOVE',
            entityIds: [entityId],
            targetPosition: retreatTarget,
          };
          this.game.issueAICommand(command);
          individualRetreatsIssued++;
        }
      }
    }
    if (individualRetreatsIssued > 0) {
      debugAI.log(
        `[AITactics] ${ai.playerId}: Issued ${individualRetreatsIssued} individual retreat orders`
      );
    }

    // Find nearest enemy threat using InfluenceMap
    const threatAnalysis = influenceMap.getThreatAnalysis(basePos.x, basePos.y, ai.playerId);

    // If threat is too high, force retreat for low health units
    if (threatAnalysis.dangerLevel > 0.7 && armyUnits.length < 5) {
      // Calculate retreat rally point (use safe direction from influence map)
      const safeDir = threatAnalysis.safeDirection;
      const rallyPoint = {
        x: basePos.x + safeDir.x * 15,
        y: basePos.y + safeDir.y * 15,
      };

      // Force retreat for all units
      for (const entityId of armyUnits) {
        retreatCoordinator.forceRetreat(ai.playerId, entityId, rallyPoint, currentTick);
      }

      debugAI.log(
        `[AITactics] ${ai.playerId}: Initiating coordinated retreat, danger level: ${threatAnalysis.dangerLevel.toFixed(2)}`
      );
      return;
    }

    // Normal defense - find threat position
    const threatPos = this.findNearestThreat(ai, basePos);

    if (!threatPos) {
      if (!this.isUnderAttack(ai)) {
        ai.state = 'building';
        debugAI.log(`[AITactics] ${ai.playerId}: No threats found, returning to build`);
      }
      return;
    }

    // Throttle defense commands
    const lastDefenseCommand = this.lastDefenseCommandTick.get(ai.playerId) || 0;
    const shouldCommand = currentTick - lastDefenseCommand >= DEFENSE_COMMAND_INTERVAL;

    if (shouldCommand) {
      const idleDefenders = this.getIdleDefendingUnits(ai.playerId, armyUnits);

      if (idleDefenders.length > 0) {
        // Apply spread formation for defense
        const armyWithPositions = this.getArmyUnitsWithPositions(ai.playerId);
        if (armyWithPositions.length > 2) {
          const formation = this.applyFormation(ai, armyWithPositions, threatPos, 'spread');

          for (const { entityId, position } of formation) {
            if (idleDefenders.includes(entityId)) {
              const command: GameCommand = {
                tick: currentTick,
                playerId: ai.playerId,
                type: 'ATTACK',
                entityIds: [entityId],
                targetPosition: position,
              };
              this.game.issueAICommand(command);
            }
          }
        } else {
          const command: GameCommand = {
            tick: currentTick,
            playerId: ai.playerId,
            type: 'ATTACK',
            entityIds: idleDefenders,
            targetPosition: threatPos,
          };
          this.game.issueAICommand(command);
        }

        debugAI.log(
          `[AITactics] ${ai.playerId}: Commanding ${idleDefenders.length}/${armyUnits.length} ` +
            `idle defenders to threat at (${threatPos.x.toFixed(0)}, ${threatPos.y.toFixed(0)})`
        );
      }

      this.lastDefenseCommandTick.set(ai.playerId, currentTick);
    }

    if (!this.isUnderAttack(ai)) {
      ai.state = 'building';
      debugAI.log(`[AITactics] ${ai.playerId}: Threat eliminated, returning to build`);
    }
  }

  /**
   * Get army units that are idle and need commanding for defense.
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

      const isIdle = unit.state === 'idle' && unit.targetEntityId === null;
      const isStuck = unit.state === 'idle' && !unit.isInAssaultMode;
      const isEngaged =
        unit.targetEntityId !== null ||
        unit.state === 'attacking' ||
        (unit.state === 'attackmoving' && unit.targetX !== null);

      if ((isIdle || isStuck) && !isEngaged) {
        idleUnits.push(entityId);
      }
    }

    return idleUnits;
  }

  /**
   * Find the nearest enemy threat using InfluenceMap for guidance.
   */
  private findNearestThreat(
    ai: AIPlayer,
    position: { x: number; y: number }
  ): { x: number; y: number } | null {
    const units = this.coordinator.getCachedUnitsWithTransform();
    let nearestThreat: { x: number; y: number; distance: number } | null = null;

    const THREAT_SEARCH_RADIUS = 80;

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;
      if (unit.attackDamage === 0) continue;

      const dx = transform.x - position.x;
      const dy = transform.y - position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

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

    const harassTarget = this.findHarassTarget(ai);
    if (!harassTarget) {
      ai.state = 'building';
      return;
    }

    // Use InfluenceMap to check if path is safe
    const influenceMap = this.coordinator.getInfluenceMap();
    const startPos = this.coordinator.findAIBase(ai);

    if (startPos) {
      // Check threat level at target - if too dangerous, find safer approach
      const targetThreat = influenceMap.getThreatAnalysis(
        harassTarget.x,
        harassTarget.y,
        ai.playerId
      );
      if (targetThreat.dangerLevel > 0.6) {
        // Try to approach from safe direction
        const safeOffset = {
          x: targetThreat.safeDirection.x * 10,
          y: targetThreat.safeDirection.y * 10,
        };
        const safeApproach = {
          x: harassTarget.x + safeOffset.x,
          y: harassTarget.y + safeOffset.y,
        };
        const command: GameCommand = {
          tick: currentTick,
          playerId: ai.playerId,
          type: 'MOVE',
          entityIds: harassUnits,
          targetPosition: safeApproach,
        };
        this.game.issueAICommand(command);
        return; // Move to safe position first, attack next cycle
      }
    }

    const command: GameCommand = {
      tick: currentTick,
      playerId: ai.playerId,
      type: 'ATTACK',
      entityIds: harassUnits,
      targetPosition: harassTarget,
    };

    this.game.issueAICommand(command);

    debugAI.log(`[AITactics] ${ai.playerId}: Harassing with ${harassUnits.length} units`);

    ai.state = 'building';
  }

  // === Engagement Tracking ===

  /**
   * Check if the AI's army is currently engaged in combat.
   */
  private checkEngagementStatus(ai: AIPlayer, armyUnits: number[]): boolean {
    let engagedCount = 0;

    for (const entityId of armyUnits) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      if (unit.targetEntityId !== null || unit.state === 'attacking') {
        engagedCount++;
      }
    }

    return engagedCount >= Math.max(1, armyUnits.length * 0.2);
  }

  /**
   * Find army units that are idle in assault mode.
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

      const isIdleAssault =
        unit.isInAssaultMode && unit.state === 'idle' && unit.targetEntityId === null;

      const isCompletelyIdle =
        unit.state === 'idle' &&
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
   * Count all enemy buildings.
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
      if (!building.isOperational()) continue;

      count++;
    }

    return count;
  }

  /**
   * Find ANY enemy building for hunt mode.
   */
  private findAnyEnemyBuilding(ai: AIPlayer): { x: number; y: number } | null {
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');
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
   * Find enemy units when no buildings remain.
   * Returns the centroid of the nearest enemy unit cluster, or null if no enemies exist.
   */
  private findEnemyUnitCluster(ai: AIPlayer): { x: number; y: number } | null {
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');
    const enemyPositions: Array<{ x: number; y: number }> = [];

    // Get AI's team ID from one of its own units
    let myTeamId = 0;
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      if (selectable.playerId === ai.playerId) {
        myTeamId = selectable.teamId;
        break;
      }
    }

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      // Skip own units, dead units, and workers
      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) continue;

      // Use isEnemy check for proper team handling
      if (!isEnemy(ai.playerId, myTeamId, selectable.playerId, selectable.teamId)) continue;

      enemyPositions.push({ x: transform.x, y: transform.y });
    }

    if (enemyPositions.length === 0) {
      return null;
    }

    // Find centroid of enemy positions
    let sumX = 0;
    let sumY = 0;
    for (const pos of enemyPositions) {
      sumX += pos.x;
      sumY += pos.y;
    }

    return {
      x: sumX / enemyPositions.length,
      y: sumY / enemyPositions.length,
    };
  }

  /**
   * Check if any enemy units remain (excluding workers).
   */
  private hasRemainingEnemyUnits(ai: AIPlayer): boolean {
    const units = this.world.getEntitiesWith('Unit', 'Selectable', 'Health');

    // Get AI's team ID from one of its own units
    let myTeamId = 0;
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      if (selectable.playerId === ai.playerId) {
        myTeamId = selectable.teamId;
        break;
      }
    }

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) continue;
      if (!isEnemy(ai.playerId, myTeamId, selectable.playerId, selectable.teamId)) continue;

      return true;
    }

    return false;
  }

  /**
   * Find all enemy buildings for map sweeping.
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

  /**
   * Get safe retreat path using InfluenceMap.
   * Returns array of waypoints from current position toward base via low-threat areas.
   */
  public getSafeRetreatPath(
    ai: AIPlayer,
    fromPosition: { x: number; y: number }
  ): Array<{ x: number; y: number }> | null {
    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) return null;

    const influenceMap = this.coordinator.getInfluenceMap();

    // Get safe direction from current position
    const threatAnalysis = influenceMap.getThreatAnalysis(
      fromPosition.x,
      fromPosition.y,
      ai.playerId
    );

    // Build path using safe direction as guide
    const path: Array<{ x: number; y: number }> = [];
    const stepSize = 10;
    let currentX = fromPosition.x;
    let currentY = fromPosition.y;

    // Generate waypoints toward base, biasing toward safe direction
    for (let i = 0; i < 5; i++) {
      // Direction to base
      const dx = basePos.x - currentX;
      const dy = basePos.y - currentY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < stepSize) {
        path.push(basePos);
        break;
      }

      // Blend safe direction with direct path to base
      const directX = dx / dist;
      const directY = dy / dist;
      const blendedX = directX * 0.7 + threatAnalysis.safeDirection.x * 0.3;
      const blendedY = directY * 0.7 + threatAnalysis.safeDirection.y * 0.3;

      currentX += blendedX * stepSize;
      currentY += blendedY * stepSize;
      path.push({ x: currentX, y: currentY });
    }

    return path.length > 0 ? path : null;
  }

  /**
   * Recover stuck assault units that have been cleared from assault mode.
   * Called in ALL AI states to prevent orphaned units from sitting forever.
   *
   * Units that timed out of assault mode (assaultIdleTicks exceeded threshold in CombatSystem)
   * are now just idle and need to be re-commanded. This method rallies them back to base
   * so the AI can use them in future attacks.
   */
  public recoverStuckAssaultUnits(ai: AIPlayer, currentTick: number): void {
    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) return;

    const rallyPoint = {
      x: basePos.x + 10,
      y: basePos.y + 10,
    };

    const armyUnits = this.getArmyUnits(ai.playerId);
    const unitsToRecover: number[] = [];

    for (const entityId of armyUnits) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');
      if (!unit || !health || !transform) continue;
      if (health.isDead()) continue;

      // Find idle units that are NOT in assault mode, NOT holding position,
      // and are far from the rally point (likely orphaned after assault)
      const isOrphanedUnit =
        unit.state === 'idle' &&
        !unit.isInAssaultMode &&
        !unit.isHoldingPosition &&
        unit.targetEntityId === null;

      if (isOrphanedUnit) {
        const dx = transform.x - rallyPoint.x;
        const dy = transform.y - rallyPoint.y;
        const distanceToRally = Math.sqrt(dx * dx + dy * dy);

        // Only recover units that are far from base (likely stuck at enemy position)
        if (distanceToRally > 40) {
          unitsToRecover.push(entityId);
        }
      }
    }

    if (unitsToRecover.length > 0) {
      const command: GameCommand = {
        tick: currentTick,
        playerId: ai.playerId,
        type: 'MOVE',
        entityIds: unitsToRecover,
        targetPosition: rallyPoint,
      };
      this.game.issueAICommand(command);
      debugAI.log(
        `[AITactics] ${ai.playerId}: Recovering ${unitsToRecover.length} orphaned units to rally point`
      );
    }
  }

  /**
   * Return army units to base after victory/hunt completion.
   * Clears assault mode on all units and issues move commands to rally point.
   */
  private returnUnitsToBase(ai: AIPlayer, armyUnits: number[], currentTick: number): void {
    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) return;

    const rallyPoint = {
      x: basePos.x + 10,
      y: basePos.y + 10,
    };

    // Clear assault mode on all army units
    for (const entityId of armyUnits) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      // Clear assault mode so units don't stay aggressive
      unit.isInAssaultMode = false;
      unit.assaultDestination = null;
      unit.assaultIdleTicks = 0;
    }

    // Send all units back to rally point
    if (armyUnits.length > 0) {
      const command: GameCommand = {
        tick: currentTick,
        playerId: ai.playerId,
        type: 'MOVE',
        entityIds: armyUnits,
        targetPosition: rallyPoint,
      };
      this.game.issueAICommand(command);
      debugAI.log(
        `[AITactics] ${ai.playerId}: Returning ${armyUnits.length} units to base after victory`
      );
    }
  }
}

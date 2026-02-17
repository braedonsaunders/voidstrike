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
import { deterministicMagnitude } from '@/utils/FixedPoint';

// Threat assessment constants
const THREAT_WINDOW_TICKS = 100; // ~5 seconds at 20 ticks/sec (reduced from 200 to prevent defense lock)

// RTS-style engagement tracking constants
const ENGAGEMENT_CHECK_INTERVAL = 10; // Check engagement every 10 ticks (~500ms)
const RE_COMMAND_IDLE_INTERVAL = 20; // Re-command idle units every 20 ticks (~1 sec)
const DEFENSE_COMMAND_INTERVAL = 20; // Re-command defending units every 20 ticks (~1 sec)
const HUNT_MODE_BUILDING_THRESHOLD = 3; // Enter hunt mode when enemy has <= 3 buildings

// Target commitment constants (prevents flip-flopping between enemies)
const COMMITMENT_SWITCH_SCORE_MULTIPLIER = 1.5; // New target must score 1.5x higher to switch
const COMMITMENT_NEAR_ELIMINATION_SCORE_FLOOR = 0.05; // Near-dead enemies almost never abandoned

// Hunt mode stuck detection: disengage even in hunt mode after prolonged non-engagement.
// Prevents armies from sitting forever at a destroyed base while hunt mode blocks normal disengage.
const HUNT_MODE_STUCK_DISENGAGE_TICKS = 300; // ~15 seconds with no combat → force disengage

// Air control constants
const AIR_HARASS_MAX_UNITS = 3; // Max air units for harassment
const AIR_FLANK_OFFSET = 20; // How far air units flank from the main army's attack vector
const _AIR_REGROUP_DISTANCE = 30; // Distance from base to regroup air units
const AIR_COMMAND_INTERVAL = 30; // Re-command air units every 30 ticks (~1.5 sec)
const SUPPORT_FOLLOW_DISTANCE = 12; // Support units stay this far behind army center

// Defense scaling during committed attacks
const COMMITTED_ATTACK_DANGER_THRESHOLD = 0.8; // Higher danger required to interrupt cleanup
const COMMITTED_ATTACK_BUILDING_DAMAGE_THRESHOLD = 0.3; // Only defend badly damaged buildings

// Defense sensitivity thresholds
const DEFENSE_DANGER_THRESHOLD = 0.4; // Danger level to trigger defense (lowered for faster response)
const DEFENSE_BUILDING_DAMAGE_THRESHOLD = 0.85; // Building health to trigger defense (raised for earlier response)

// Counter-attack: override defense when army overwhelms local threat
const COUNTER_ATTACK_STRENGTH_RATIO = 3.0; // Our influence must be 3x enemy to counter-attack

export class AITacticsManager {
  private game: IGameInstance;
  private coordinator: AICoordinator;

  // RTS-style engagement tracking per AI player
  private lastEngagementCheck: Map<string, number> = new Map();
  private lastEngagedTick: Map<string, number> = new Map(); // Tracks when engagement was last TRUE
  private lastReCommandTick: Map<string, number> = new Map();
  private lastDefenseCommandTick: Map<string, number> = new Map();
  private isEngaged: Map<string, boolean> = new Map();

  // Air unit control tracking
  private lastAirCommandTick: Map<string, number> = new Map();
  private lastAirHarassTick: Map<string, number> = new Map();

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

    // Count buildings per enemy player (for hunt mode and elimination tracking)
    const enemyBuildingCounts = new Map<string, number>();
    const enemyHasHQ = new Map<string, boolean>();
    const baseTypes = ai.config?.roles.baseTypes ?? [];

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue;

      const ownerId = selectable.playerId;
      enemyBuildingCounts.set(ownerId, (enemyBuildingCounts.get(ownerId) || 0) + 1);
      if (baseTypes.includes(building.buildingId)) {
        enemyHasHQ.set(ownerId, true);
      }
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
          buildingCount: 0,
          hasHeadquarters: false,
        };
        ai.enemyRelations.set(enemyPlayerId, relation);
      }

      // Update per-enemy building tracking
      relation.buildingCount = enemyBuildingCounts.get(enemyPlayerId) || 0;
      relation.hasHeadquarters = enemyHasHQ.get(enemyPlayerId) || false;

      // Find enemy base position and calculate distance
      let enemyBase: { x: number; y: number } | null = null;
      for (const entity of buildings) {
        const selectable = entity.get<Selectable>('Selectable')!;
        const building = entity.get<Building>('Building')!;
        const transform = entity.get<Transform>('Transform')!;
        if (selectable.playerId !== enemyPlayerId) continue;
        if (baseTypes.includes(building.buildingId)) {
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
        relation.baseDistance = deterministicMagnitude(dx, dy);
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

    // Clear commitment if committed enemy has been fully eliminated
    if (ai.committedEnemyId && !ai.enemyRelations.has(ai.committedEnemyId)) {
      debugAI.log(
        `[AITacticsManager] ${ai.playerId} committed enemy ${ai.committedEnemyId} eliminated, clearing commitment`
      );
      ai.committedEnemyId = null;
      ai.commitmentStartTick = 0;
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

    // Near-elimination bonus: heavily incentivize finishing off nearly-dead enemies
    let eliminationBonus = 0;
    if (relation.buildingCount > 0 && relation.buildingCount <= HUNT_MODE_BUILDING_THRESHOLD) {
      // Scale: 3 buildings = 0.3, 2 buildings = 0.5, 1 building = 0.8
      eliminationBonus = 0.8 - (relation.buildingCount - 1) * 0.25;
    } else if (relation.buildingCount > 0 && !relation.hasHeadquarters) {
      // Lost HQ but still has more buildings: moderate bonus
      eliminationBonus = 0.2;
    }

    // Weighted sum using personality weights + elimination awareness
    return (
      proximityScore * weights.proximity +
      threatScore * weights.threat +
      retaliationScore * weights.retaliation +
      opportunityScore * weights.opportunity +
      eliminationBonus
    );
  }

  /**
   * Select the primary enemy to attack based on personality-weighted threat scores.
   * Includes hysteresis to prevent flip-flopping between targets, especially when
   * an enemy is near elimination. SC2-style: once committed, finish them off.
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

    // Hysteresis: prefer staying on committed target to prevent flip-flopping
    const committedId = ai.committedEnemyId;
    if (committedId && ai.enemyRelations.has(committedId)) {
      const committedRelation = ai.enemyRelations.get(committedId)!;
      const committedScore = committedRelation.threatScore;

      // Near elimination: almost never switch away — finish them off
      if (
        committedRelation.buildingCount > 0 &&
        committedRelation.buildingCount <= HUNT_MODE_BUILDING_THRESHOLD
      ) {
        if (committedScore > COMMITMENT_NEAR_ELIMINATION_SCORE_FLOOR) {
          debugAI.log(
            `[AITacticsManager] ${ai.playerId} staying committed to near-eliminated enemy: ${committedId} ` +
              `(${committedRelation.buildingCount} buildings left)`
          );
          return committedId;
        }
      }

      // Normal hysteresis: new target must score significantly higher to justify switching
      if (
        bestEnemyId !== committedId &&
        bestScore < committedScore * COMMITMENT_SWITCH_SCORE_MULTIPLIER
      ) {
        debugAI.log(
          `[AITacticsManager] ${ai.playerId} staying committed to ${committedId} ` +
            `(committed: ${committedScore.toFixed(2)}, best: ${bestScore.toFixed(2)}, ` +
            `needs ${(committedScore * COMMITMENT_SWITCH_SCORE_MULTIPLIER).toFixed(2)} to switch)`
        );
        return committedId;
      }
    }

    // Update commitment tracking
    if (bestEnemyId && bestEnemyId !== committedId) {
      ai.committedEnemyId = bestEnemyId;
      ai.commitmentStartTick = this.game.getCurrentTick();
      debugAI.log(`[AITacticsManager] ${ai.playerId} committing to new enemy: ${bestEnemyId}`);
    }

    if (bestEnemyId) {
      const relation = ai.enemyRelations.get(bestEnemyId)!;
      debugAI.log(
        `[AITacticsManager] ${ai.playerId} selected primary enemy: ${bestEnemyId} ` +
          `(score: ${relation.threatScore.toFixed(2)}, distance: ${relation.baseDistance.toFixed(0)}, ` +
          `buildings: ${relation.buildingCount}, armyNearUs: ${relation.armyNearUs})`
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
        buildingCount: 0,
        hasHeadquarters: false,
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
   *
   * Key improvements over naive defense-first logic:
   * - Counter-attack: large armies overwhelm local threats instead of turtling
   * - Defense-to-attack bypass: no cooldown penalty after clearing a threat
   * - Hunt mode immunity: cleanup operations ignore minor pokes
   */
  public updateTacticalState(ai: AIPlayer, currentTick: number): void {
    const config = ai.config!;
    const diffConfig = config.difficultyConfig[ai.difficulty];
    const tacticalConfig = config.tactical;

    // Priority 1: Defense when under attack
    if (this.isUnderAttack(ai)) {
      // SC2-style: when committed to finishing off a nearly-dead enemy,
      // only defend against serious threats — ignore minor pokes
      if (ai.state === 'attacking' && ai.committedEnemyId) {
        const committedRelation = ai.enemyRelations.get(ai.committedEnemyId);
        if (
          committedRelation &&
          committedRelation.buildingCount > 0 &&
          committedRelation.buildingCount <= HUNT_MODE_BUILDING_THRESHOLD
        ) {
          if (!this.isUnderSeriousAttack(ai)) {
            debugAI.log(
              `[AITactics] ${ai.playerId}: Ignoring minor threat during cleanup of ${ai.committedEnemyId} ` +
                `(${committedRelation.buildingCount} buildings left)`
            );
            // Stay attacking — don't switch to defending
            return;
          }
        }
      }

      // Counter-attack: if our army overwhelms the local threat, attack instead of defending.
      // A 100-unit army shouldn't sit at base defending against a few raiders.
      const strengthRatio = this.getBaseStrengthRatio(ai);
      const attackThreshold = tacticalConfig.attackThresholds[ai.difficulty];
      if (strengthRatio >= COUNTER_ATTACK_STRENGTH_RATIO && ai.armySupply >= attackThreshold) {
        ai.state = 'attacking';
        ai.lastAttackTick = currentTick; // Enable attack commands immediately
        debugAI.log(
          `[AITactics] ${ai.playerId}: Counter-attacking! Army overwhelms threat ` +
            `(strength ratio: ${strengthRatio.toFixed(1)}, supply: ${ai.armySupply})`
        );
        return;
      }

      ai.state = 'defending';
      return;
    }

    // Active attack operation persists - don't re-evaluate
    // The operation ends inside executeAttackingPhase when target is destroyed
    // or when there's no army left
    if (ai.activeAttackOperation) {
      ai.state = 'attacking';
      return;
    }

    // Priority 2: Scouting (if enabled and cooldown expired)
    if (diffConfig.scoutingEnabled && currentTick - ai.lastScoutTick >= ai.scoutCooldown) {
      if (ai.scoutedLocations.size < 5) {
        ai.state = 'scouting';
        return;
      }
    }

    // Priority 2b: Expansion when economically ready and area is safe
    const baseCount = this.coordinator.countPlayerBases(ai);
    const maxBases = diffConfig.maxBases;
    if (baseCount < maxBases && currentTick - ai.lastExpansionTick >= ai.expansionCooldown) {
      if (ai.minerals >= 350 && ai.armySupply >= 6) {
        const basePos = this.coordinator.findAIBase(ai);
        if (basePos) {
          const influenceMap = this.coordinator.getInfluenceMap();
          const expansionArea = influenceMap.findBestExpansionArea(
            basePos.x,
            basePos.y,
            ai.playerId,
            40
          );
          if (expansionArea && expansionArea.score > -10) {
            ai.state = 'expanding';
            ai.lastExpansionTick = currentTick;
            return;
          }
        }
      }
    }

    // Priority 3: Start NEW attack when army is strong enough
    const attackThreshold = tacticalConfig.attackThresholds[ai.difficulty];
    const canAttack = ai.armySupply >= attackThreshold;
    // Bypass cooldown when transitioning from defense — the threat cleared, don't penalize
    const justDefended = ai.state === 'defending';

    if (canAttack && (justDefended || currentTick - ai.lastAttackTick >= ai.attackCooldown)) {
      ai.state = 'attacking';
      // Attack operation will be created in executeAttackingPhase
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
   *
   * Uses multiple signals for reliable detection:
   * - Primary: danger ratio (enemies have local superiority)
   * - Secondary: any meaningful enemy presence near base with recent contact
   * - Building damage with recent enemy contact for early response
   */
  public isUnderAttack(ai: AIPlayer): boolean {
    const currentTick = this.game.getCurrentTick();
    const recentEnemyContact = currentTick - ai.lastEnemyContact < THREAT_WINDOW_TICKS;

    const basePos = this.coordinator.findAIBase(ai);
    if (basePos) {
      const influenceMap = this.coordinator.getInfluenceMap();
      const threatAnalysis = influenceMap.getThreatAnalysis(basePos.x, basePos.y, ai.playerId);

      // Primary check: danger ratio (enemies have local superiority)
      if (threatAnalysis.dangerLevel > DEFENSE_DANGER_THRESHOLD) return true;

      // Secondary check: any meaningful enemy presence near base with recent contact
      if (threatAnalysis.threatPresence > 15 && recentEnemyContact) return true;
    }

    // Check building damage -- respond earlier
    const buildings = this.coordinator.getCachedBuildings();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;

      // Critically damaged buildings always trigger defense
      if (health.getHealthPercent() < 0.5) return true;
      // Moderately damaged buildings trigger with recent enemy contact
      if (health.getHealthPercent() < DEFENSE_BUILDING_DAMAGE_THRESHOLD && recentEnemyContact)
        return true;
    }
    return false;
  }

  /**
   * Check if the AI is under a serious attack (higher threshold than isUnderAttack).
   * Used when the AI is committed to finishing off a nearly-dead enemy — minor pokes
   * shouldn't interrupt a cleanup operation.
   */
  private isUnderSeriousAttack(ai: AIPlayer): boolean {
    const basePos = this.coordinator.findAIBase(ai);
    if (basePos) {
      const influenceMap = this.coordinator.getInfluenceMap();
      const threatAnalysis = influenceMap.getThreatAnalysis(basePos.x, basePos.y, ai.playerId);

      // Require much higher danger level to interrupt cleanup
      if (threatAnalysis.dangerLevel > COMMITTED_ATTACK_DANGER_THRESHOLD) return true;
    }

    // Only trigger for severely damaged buildings (not minor scratches)
    const buildings = this.coordinator.getCachedBuildings();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;

      if (health.getHealthPercent() < COMMITTED_ATTACK_BUILDING_DAMAGE_THRESHOLD) return true;
    }
    return false;
  }

  /**
   * Estimate the strength ratio of our forces vs enemy forces near our base.
   * Uses influence map data which accounts for DPS and unit supply.
   * Returns Infinity when no enemies are nearby (safe to attack).
   */
  private getBaseStrengthRatio(ai: AIPlayer): number {
    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) return Infinity;

    const influenceMap = this.coordinator.getInfluenceMap();
    const threatAnalysis = influenceMap.getThreatAnalysis(basePos.x, basePos.y, ai.playerId);

    if (threatAnalysis.enemyInfluence <= 0) return Infinity;
    return threatAnalysis.friendlyInfluence / threatAnalysis.enemyInfluence;
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
   * Get all army (non-worker, non-naval) units for the AI.
   * Excludes naval units since they can't participate in land attacks.
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
      if (unit.isNaval) continue; // Naval units can't attack land targets

      armyUnits.push(entity.id);
    }

    return armyUnits;
  }

  /**
   * Get only ground army units (excludes flying and naval).
   */
  public getGroundArmyUnits(playerId: string): number[] {
    const groundUnits: number[] = [];
    const entities = this.coordinator.getCachedUnits();

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;
      if (unit.isWorker) continue;
      if (health.isDead()) continue;
      if (unit.attackDamage === 0) continue;
      if (unit.isFlying || unit.isNaval) continue;

      groundUnits.push(entity.id);
    }

    return groundUnits;
  }

  /**
   * Get only flying army units for air strike operations.
   */
  public getAirArmyUnits(playerId: string): number[] {
    const airUnits: number[] = [];
    const entities = this.coordinator.getCachedUnits();

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;
      if (unit.isWorker) continue;
      if (health.isDead()) continue;
      if (unit.attackDamage === 0) continue;
      if (!unit.isFlying) continue;

      airUnits.push(entity.id);
    }

    return airUnits;
  }

  /**
   * Get support air units (healers, detectors) that should follow the army.
   */
  public getSupportAirUnits(playerId: string): number[] {
    const supportUnits: number[] = [];
    const entities = this.coordinator.getCachedUnits();

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;
      if (health.isDead()) continue;
      if (!unit.isFlying) continue;
      if (unit.isWorker) continue;
      // Support air = flying + no attack damage
      if (unit.attackDamage > 0) continue;

      supportUnits.push(entity.id);
    }

    return supportUnits;
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
  public findEnemyBase(
    ai: AIPlayer,
    targetPlayerId?: string
  ): { x: number; y: number; entityId?: number } | null {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    const enemyToTarget = targetPlayerId ?? ai.primaryEnemyId;

    // Always query live buildings so we return an entityId for direct targeting.
    // The cached relation.basePosition is position-only and causes units to
    // attack-move to a coordinate instead of attacking a specific building.
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');

    if (enemyToTarget) {
      // First pass: HQ buildings from the targeted enemy
      for (const entity of buildings) {
        const selectable = entity.get<Selectable>('Selectable')!;
        const building = entity.get<Building>('Building')!;
        const transform = entity.get<Transform>('Transform')!;
        const health = entity.get<Health>('Health')!;

        if (selectable.playerId !== enemyToTarget) continue;
        if (health.isDead()) continue;
        if (!building.isOperational()) continue;
        if (baseTypes.includes(building.buildingId)) {
          return { x: transform.x, y: transform.y, entityId: entity.id };
        }
      }

      // Second pass: any building from the targeted enemy
      for (const entity of buildings) {
        const selectable = entity.get<Selectable>('Selectable')!;
        const transform = entity.get<Transform>('Transform')!;
        const health = entity.get<Health>('Health')!;
        const building = entity.get<Building>('Building')!;

        if (selectable.playerId !== enemyToTarget) continue;
        if (health.isDead()) continue;
        if (!building.isOperational()) continue;
        return { x: transform.x, y: transform.y, entityId: entity.id };
      }
    }

    // Fallback: any enemy HQ building
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (!isEnemy(ai.playerId, ai.teamId, selectable.playerId, selectable.teamId)) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue;
      if (baseTypes.includes(building.buildingId)) {
        return { x: transform.x, y: transform.y, entityId: entity.id };
      }
    }

    // Fallback: any enemy building
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      const building = entity.get<Building>('Building')!;

      if (!isEnemy(ai.playerId, ai.teamId, selectable.playerId, selectable.teamId)) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue;
      return { x: transform.x, y: transform.y, entityId: entity.id };
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

      if (!isEnemy(ai.playerId, ai.teamId, selectable.playerId, selectable.teamId)) continue;
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
      if (unit.isInAssaultMode) continue; // Don't recall units on attack operations

      const dx = transform.x - rallyPoint.x;
      const dy = transform.y - rallyPoint.y;
      if (deterministicMagnitude(dx, dy) > 15) {
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
   *
   * Evaluates expansion area safety and sends an army escort to secure
   * contested locations before transitioning back to building state.
   * The macro rules (expand_depleted, expand_saturated, expand_timed)
   * handle actually issuing the build command for the expansion building.
   */
  public executeExpandingPhase(ai: AIPlayer, currentTick: number): void {
    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) {
      ai.state = 'building';
      return;
    }

    const influenceMap = this.coordinator.getInfluenceMap();
    const expansionArea = influenceMap.findBestExpansionArea(basePos.x, basePos.y, ai.playerId, 40);

    if (!expansionArea) {
      ai.state = 'building';
      return;
    }

    // Check if expansion area is safe enough
    const threatAnalysis = influenceMap.getThreatAnalysis(
      expansionArea.x,
      expansionArea.y,
      ai.playerId
    );

    if (threatAnalysis.dangerLevel > 0.3) {
      // Expansion area is contested -- send army to secure it first
      const armyUnits = this.getArmyUnits(ai.playerId);
      if (armyUnits.length > 0) {
        const escortCount = Math.min(
          armyUnits.length,
          Math.max(3, Math.floor(armyUnits.length * 0.3))
        );
        const escortUnits = armyUnits.slice(0, escortCount);

        const command: GameCommand = {
          tick: currentTick,
          playerId: ai.playerId,
          type: 'ATTACK_MOVE',
          entityIds: escortUnits,
          targetPosition: expansionArea,
        };
        this.game.issueAICommand(command);

        debugAI.log(
          `[AITactics] ${ai.playerId}: Securing expansion area at (${expansionArea.x.toFixed(0)}, ${expansionArea.y.toFixed(0)}) with ${escortCount} units`
        );
      }
    }

    // Transition back to building -- the macro rules handle actually building the expansion.
    // The army escort provides protection while the worker builds.
    ai.state = 'building';

    debugAI.log(
      `[AITactics] ${ai.playerId}: Expansion phase at (${expansionArea.x.toFixed(0)}, ${expansionArea.y.toFixed(0)}), danger: ${threatAnalysis.dangerLevel.toFixed(2)}`
    );
  }

  /**
   * Execute the attacking phase with formation control and attack operation lifecycle.
   * Uses per-enemy hunt mode to finish off nearly-dead opponents in FFA.
   * Manages activeAttackOperation to prevent state oscillation.
   */
  public executeAttackingPhase(ai: AIPlayer, currentTick: number): void {
    let armyUnits = this.getArmyUnits(ai.playerId);
    if (armyUnits.length === 0) {
      ai.state = 'building';
      ai.activeAttackOperation = null;
      this.isEngaged.set(ai.playerId, false);
      return;
    }

    // Split army: keep defenseRatio portion near base for defense
    const config = ai.config!;
    const defenseRatio = config.tactical.defenseRatio[ai.difficulty];
    if (defenseRatio > 0 && armyUnits.length > 3) {
      const basePos = this.coordinator.findAIBase(ai);
      if (basePos) {
        const defenseCount = Math.max(1, Math.floor(armyUnits.length * defenseRatio));
        const unitsWithDist: Array<{ id: number; dist: number }> = [];
        for (const entityId of armyUnits) {
          const entity = this.world.getEntity(entityId);
          if (!entity) continue;
          const transform = entity.get<Transform>('Transform');
          if (!transform) continue;
          const dx = transform.x - basePos.x;
          const dy = transform.y - basePos.y;
          unitsWithDist.push({ id: entityId, dist: deterministicMagnitude(dx, dy) });
        }
        unitsWithDist.sort((a, b) => a.dist - b.dist);

        // Closest units form defense garrison, rest attack
        armyUnits = unitsWithDist.slice(defenseCount).map((u) => u.id);
        if (armyUnits.length === 0) {
          // Entire army is garrison -- don't attack
          ai.state = 'building';
          ai.activeAttackOperation = null;
          this.isEngaged.set(ai.playerId, false);
          return;
        }
        debugAI.log(
          `[AITactics] ${ai.playerId}: Army split - ${armyUnits.length} attacking, ${defenseCount} defending base`
        );
      }
    }

    // Separate air units from ground army for independent control
    const groundUnits: number[] = [];
    const airCombatUnits: number[] = [];
    for (const entityId of armyUnits) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;
      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;
      if (unit.isFlying) {
        airCombatUnits.push(entityId);
      } else {
        groundUnits.push(entityId);
      }
    }

    // Use ground units for main army operations, air operates independently.
    // If no ground units exist, air units become the main force.
    const mainArmyUnits = groundUnits.length > 0 ? groundUnits : armyUnits;

    // Per-enemy hunt mode: check if the PRIMARY enemy is near elimination
    const primaryEnemyId = ai.primaryEnemyId;
    const primaryRelation = primaryEnemyId ? ai.enemyRelations.get(primaryEnemyId) : null;
    const primaryBuildingCount = primaryRelation?.buildingCount ?? Infinity;
    const inHuntMode =
      primaryBuildingCount > 0 && primaryBuildingCount <= HUNT_MODE_BUILDING_THRESHOLD;

    // Check engagement status periodically
    const lastCheck = this.lastEngagementCheck.get(ai.playerId) || 0;
    if (currentTick - lastCheck >= ENGAGEMENT_CHECK_INTERVAL) {
      const engaged = this.checkEngagementStatus(ai, armyUnits);
      this.isEngaged.set(ai.playerId, engaged);
      this.lastEngagementCheck.set(ai.playerId, currentTick);
      // Track when engagement was last true for disengage timeout
      if (engaged) {
        this.lastEngagedTick.set(ai.playerId, currentTick);
      }
    }

    const engaged = this.isEngaged.get(ai.playerId) || false;

    // Find target -- in hunt mode, target the specific nearly-dead enemy
    let attackTarget: { x: number; y: number; entityId?: number } | null = null;

    if (inHuntMode && primaryEnemyId) {
      attackTarget = this.findEnemyBuildingForPlayer(ai, primaryEnemyId);
      if (!attackTarget) {
        // Primary enemy's buildings all gone -- check for stragglers from anyone
        attackTarget = this.findAnyEnemyBuilding(ai);
        if (!attackTarget) {
          ai.state = 'building';
          ai.activeAttackOperation = null;
          this.isEngaged.set(ai.playerId, false);
          debugAI.log(
            `[AITactics] ${ai.playerId}: Hunt mode - no enemy buildings found, returning to build`
          );
          return;
        }
      }
      debugAI.log(
        `[AITactics] ${ai.playerId}: HUNT MODE - targeting ${primaryEnemyId}'s building at ` +
          `(${attackTarget.x.toFixed(0)}, ${attackTarget.y.toFixed(0)}) [${primaryBuildingCount} left]`
      );
    } else {
      attackTarget = this.findEnemyBase(ai);
      if (!attackTarget) {
        attackTarget = this.findAnyEnemyBuilding(ai);
        if (!attackTarget) {
          // No buildings found - check for enemy units (e.g., battle simulator)
          if (this.hasRemainingEnemyUnits(ai)) {
            const enemyCluster = this.findEnemyUnitCluster(ai);
            if (enemyCluster) {
              attackTarget = enemyCluster;
            }
          }
          if (!attackTarget) {
            // No valid target at all - end operation
            ai.state = 'building';
            ai.activeAttackOperation = null;
            this.isEngaged.set(ai.playerId, false);
            return;
          }
        }
      }
    }

    // Create/update attack operation
    if (!ai.activeAttackOperation) {
      ai.activeAttackOperation = {
        target: attackTarget,
        targetPlayerId: ai.primaryEnemyId || '',
        startTick: currentTick,
        engaged: false,
      };
      ai.lastAttackTick = currentTick;
      debugAI.log(
        `[AITactics] ${ai.playerId}: Starting attack operation to (${attackTarget.x.toFixed(0)}, ${attackTarget.y.toFixed(0)})`
      );

      // Use concave formation for initial attack to spread units naturally
      if (mainArmyUnits.length >= 6) {
        const groupId = ai.formationControl.createGroup(this.world, mainArmyUnits, ai.playerId);
        const slots = ai.formationControl.calculateConcaveFormation(
          this.world,
          groupId,
          attackTarget
        );

        if (slots.length > 0) {
          // Issue per-unit attack-move commands to formation positions
          for (const slot of slots) {
            const command: GameCommand = {
              tick: currentTick,
              playerId: ai.playerId,
              type: 'ATTACK_MOVE',
              entityIds: [slot.entityId],
              targetPosition: slot.targetPosition,
            };
            this.game.issueAICommand(command);
          }
          debugAI.log(
            `[AITactics] ${ai.playerId}: Attacking in concave formation with ${slots.length} units`
          );
        } else {
          // Fallback: standard group attack-move
          // Use entity-targeted attack when available (hunt mode) to prevent units
          // attack-moving to the building center instead of attacking the building itself
          const command: GameCommand = {
            tick: currentTick,
            playerId: ai.playerId,
            type: 'ATTACK_MOVE',
            entityIds: mainArmyUnits,
            ...(attackTarget.entityId !== undefined
              ? { targetEntityId: attackTarget.entityId }
              : { targetPosition: attackTarget }),
          };
          this.game.issueAICommand(command);
          debugAI.log(
            `[AITactics] ${ai.playerId}: Attacking with ${mainArmyUnits.length} units (no formation)`
          );
        }
      } else {
        // Small army: no formation needed
        // Use entity-targeted attack when available (hunt mode) to prevent units
        // attack-moving to the building center instead of attacking the building itself
        const command: GameCommand = {
          tick: currentTick,
          playerId: ai.playerId,
          type: 'ATTACK_MOVE',
          entityIds: mainArmyUnits,
          ...(attackTarget.entityId !== undefined
            ? { targetEntityId: attackTarget.entityId }
            : { targetPosition: attackTarget }),
        };
        this.game.issueAICommand(command);
        debugAI.log(`[AITactics] ${ai.playerId}: Attacking with ${mainArmyUnits.length} units`);
      }
    } else {
      // Update target position (may have changed if building was destroyed)
      ai.activeAttackOperation.target = attackTarget;

      // Track engagement status on the operation
      if (engaged && !ai.activeAttackOperation.engaged) {
        ai.activeAttackOperation.engaged = true;
      }
    }

    // Command air force independently for flanking attacks
    if (airCombatUnits.length > 0 && groundUnits.length > 0) {
      this.commandAirForce(ai, airCombatUnits, attackTarget, currentTick);
    }

    // Support air units follow the army
    this.commandSupportAir(ai, currentTick);

    // Re-command idle assault units periodically
    const lastReCommand = this.lastReCommandTick.get(ai.playerId) || 0;
    const shouldReCommand = currentTick - lastReCommand >= RE_COMMAND_IDLE_INTERVAL;

    if (shouldReCommand) {
      const idleAssaultUnits = this.getIdleAssaultUnits(ai.playerId, mainArmyUnits, attackTarget);

      if (idleAssaultUnits.length > 0) {
        // Check for nearby enemy combat units that should be dealt with first.
        // In FFA, third-party armies standing near ours must be engaged, not ignored.
        const nearbyThreat = this.findNearbyArmyThreat(ai, mainArmyUnits);

        if (nearbyThreat) {
          // Enemy combat units detected near our army - engage them first
          const command: GameCommand = {
            tick: currentTick,
            playerId: ai.playerId,
            type: 'ATTACK_MOVE',
            entityIds: idleAssaultUnits,
            targetPosition: nearbyThreat,
          };
          this.game.issueAICommand(command);
          debugAI.log(
            `[AITactics] ${ai.playerId}: Redirecting ${idleAssaultUnits.length} idle units to nearby threat at (${nearbyThreat.x.toFixed(0)}, ${nearbyThreat.y.toFixed(0)})`
          );
        } else if (attackTarget.entityId !== undefined) {
          // No nearby threats - continue attacking the building.
          // Entity-targeted attack: units go directly to 'attacking' state with
          // the building as their target, bypassing the attack-move engagement
          // buffer. This prevents the idle→attackmove→idle cycle that caused
          // units to never actually attack buildings during hunt mode.
          const command: GameCommand = {
            tick: currentTick,
            playerId: ai.playerId,
            type: 'ATTACK',
            entityIds: idleAssaultUnits,
            targetEntityId: attackTarget.entityId,
          };
          this.game.issueAICommand(command);
          debugAI.log(
            `[AITactics] ${ai.playerId}: Re-commanding ${idleAssaultUnits.length} idle assault units to attack building entity ${attackTarget.entityId}`
          );
        } else {
          // Fallback: position-based attack-move
          const command: GameCommand = {
            tick: currentTick,
            playerId: ai.playerId,
            type: 'ATTACK_MOVE',
            entityIds: idleAssaultUnits,
            targetPosition: attackTarget,
          };
          this.game.issueAICommand(command);
          debugAI.log(
            `[AITactics] ${ai.playerId}: Re-commanding ${idleAssaultUnits.length} idle assault units to target`
          );
        }
      }

      this.lastReCommandTick.set(ai.playerId, currentTick);
    }

    // State transition logic
    const totalEnemyBuildings = this.countEnemyBuildings(ai);
    if (totalEnemyBuildings === 0) {
      // No buildings left for any enemy - check for remaining enemy units
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
            type: 'ATTACK_MOVE',
            entityIds: armyUnits,
            targetPosition: enemyCluster,
          };
          this.game.issueAICommand(command);
        }
      } else {
        // Enemy fully eliminated - return units to base and transition to building
        this.returnUnitsToBase(ai, armyUnits, currentTick);
        ai.state = 'building';
        ai.activeAttackOperation = null;
        this.isEngaged.set(ai.playerId, false);
        debugAI.log(`[AITactics] ${ai.playerId}: Enemy eliminated, returning units to base`);
      }
    } else if (!engaged) {
      const lastEngaged =
        this.lastEngagedTick.get(ai.playerId) ?? ai.activeAttackOperation?.startTick ?? currentTick;
      const disengagedDuration = currentTick - lastEngaged;

      if (inHuntMode) {
        // Hunt mode stuck detection: if army has had zero combat for an extended period,
        // the target is likely unreachable or already destroyed by another player.
        // Force disengage to prevent armies sitting at destroyed bases forever.
        if (disengagedDuration > HUNT_MODE_STUCK_DISENGAGE_TICKS) {
          this.returnUnitsToBase(ai, armyUnits, currentTick);
          ai.state = 'building';
          ai.activeAttackOperation = null;
          this.isEngaged.set(ai.playerId, false);
          debugAI.log(
            `[AITactics] ${ai.playerId}: Hunt mode stuck for ${disengagedDuration} ticks with no combat, returning to build`
          );
        }
      } else if (disengagedDuration > 100) {
        this.returnUnitsToBase(ai, armyUnits, currentTick);
        ai.state = 'building';
        ai.activeAttackOperation = null;
        this.isEngaged.set(ai.playerId, false);
        debugAI.log(
          `[AITactics] ${ai.playerId}: Disengaged for ${disengagedDuration} ticks, returning to build`
        );
      }
    }
  }

  /**
   * Execute the defending phase.
   *
   * Simplified defense logic to eliminate stutter from formation recalculation:
   * - Large armies: attack-move directly toward threat (combat system handles targeting)
   * - Small armies in extreme danger: coordinated retreat
   * - No per-unit formation positioning during defense (caused oscillating commands)
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

    const influenceMap = this.coordinator.getInfluenceMap();
    const retreatCoordinator = ai.retreatCoordinator;
    const threatAnalysis = influenceMap.getThreatAnalysis(basePos.x, basePos.y, ai.playerId);

    // Update retreat coordination
    retreatCoordinator.update(this.world, currentTick, ai.playerId, influenceMap);

    // Desperate retreat: only for very small armies facing overwhelming force
    if (threatAnalysis.dangerLevel > 0.7 && armyUnits.length < 5) {
      // Use InfluenceMap A* to find safe retreat path
      const safePath = influenceMap.findSafePath(
        basePos.x,
        basePos.y,
        basePos.x + threatAnalysis.safeDirection.x * 30,
        basePos.y + threatAnalysis.safeDirection.y * 30,
        ai.playerId,
        1.0 // Maximum threat avoidance during desperate retreat
      );
      const rallyPoint =
        safePath.length > 0
          ? safePath[0]
          : {
              x: basePos.x + threatAnalysis.safeDirection.x * 15,
              y: basePos.y + threatAnalysis.safeDirection.y * 15,
            };

      for (const entityId of armyUnits) {
        retreatCoordinator.forceRetreat(ai.playerId, entityId, rallyPoint, currentTick);
      }

      // Batch retreat commands
      const retreatingIds: number[] = [];
      for (const entityId of armyUnits) {
        if (retreatCoordinator.shouldRetreat(ai.playerId, entityId)) {
          retreatingIds.push(entityId);
        }
      }
      if (retreatingIds.length > 0) {
        const command: GameCommand = {
          tick: currentTick,
          playerId: ai.playerId,
          type: 'MOVE',
          entityIds: retreatingIds,
          targetPosition: rallyPoint,
        };
        this.game.issueAICommand(command);
      }

      debugAI.log(
        `[AITactics] ${ai.playerId}: Desperate retreat, danger: ${threatAnalysis.dangerLevel.toFixed(2)}`
      );
      return;
    }

    // Handle active group retreat (if retreat was previously triggered)
    const retreatStatus = retreatCoordinator.getGroupStatus(this.world, ai.playerId);
    if (retreatStatus.isRetreating) {
      if (retreatStatus.canReengage) {
        retreatCoordinator.forceReengage(ai.playerId);
        debugAI.log(`[AITactics] ${ai.playerId}: Re-engaging after retreat`);
      } else {
        // Continue retreating — don't issue conflicting attack commands
        return;
      }
    }

    // Find threat position
    const threatPos = this.findNearestThreat(ai, basePos);
    if (!threatPos) {
      if (!this.isUnderAttack(ai)) {
        ai.state = 'building';
        debugAI.log(`[AITactics] ${ai.playerId}: No threats found, returning to build`);
      }
      return;
    }

    // Throttle defense commands to prevent command spam
    const lastDefenseCommand = this.lastDefenseCommandTick.get(ai.playerId) || 0;
    if (currentTick - lastDefenseCommand < DEFENSE_COMMAND_INTERVAL) {
      if (!this.isUnderAttack(ai)) {
        ai.state = 'building';
      }
      return;
    }

    const idleDefenders = this.getIdleDefendingUnits(ai.playerId, armyUnits);
    if (idleDefenders.length > 0) {
      // Simple defense: attack-move all idle defenders directly toward the threat.
      // No formation calculations — they cause stutter by recalculating positions
      // every command interval, oscillating units between different targets.
      // The combat system handles unit-level targeting and natural spreading.
      const command: GameCommand = {
        tick: currentTick,
        playerId: ai.playerId,
        type: 'ATTACK_MOVE',
        entityIds: idleDefenders,
        targetPosition: threatPos,
      };
      this.game.issueAICommand(command);

      debugAI.log(
        `[AITactics] ${ai.playerId}: Commanding ${idleDefenders.length}/${armyUnits.length} ` +
          `idle defenders to threat at (${threatPos.x.toFixed(0)}, ${threatPos.y.toFixed(0)})`
      );
    }

    // Air units help defend independently
    const airDefenders = this.getAirArmyUnits(ai.playerId);
    if (airDefenders.length > 0 && threatPos) {
      const command: GameCommand = {
        tick: currentTick,
        playerId: ai.playerId,
        type: 'ATTACK_MOVE',
        entityIds: airDefenders,
        targetPosition: threatPos,
      };
      this.game.issueAICommand(command);
    }

    // Support air follows during defense too
    this.commandSupportAir(ai, currentTick);

    this.lastDefenseCommandTick.set(ai.playerId, currentTick);

    if (!this.isUnderAttack(ai)) {
      ai.state = 'building';
      debugAI.log(`[AITactics] ${ai.playerId}: Threat eliminated, returning to build`);
    }
  }

  /**
   * Get army units that are idle or moving and need commanding for defense.
   * Includes moving units (e.g., walking to rally point) so they can be redirected.
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

      const isEngaged =
        unit.targetEntityId !== null ||
        unit.state === 'attacking' ||
        (unit.state === 'attackmoving' && unit.targetX !== null);

      if (isEngaged) continue;

      // Include idle units
      if (unit.state === 'idle') {
        idleUnits.push(entityId);
        continue;
      }

      // Include moving units (e.g., walking to rally point) -- redirect them to defend
      if (unit.state === 'moving') {
        idleUnits.push(entityId);
        continue;
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

      if (!isEnemy(ai.playerId, ai.teamId, selectable.playerId, selectable.teamId)) continue;
      if (health.isDead()) continue;
      if (unit.attackDamage === 0) continue;

      const dx = transform.x - position.x;
      const dy = transform.y - position.y;
      const distance = deterministicMagnitude(dx, dy);

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
        // Find safe approach path using InfluenceMap A*
        const approachPath = influenceMap.findSafePath(
          startPos.x,
          startPos.y,
          harassTarget.x,
          harassTarget.y,
          ai.playerId,
          0.6 // Moderate threat avoidance for harassment
        );
        const safeApproach =
          approachPath.length > 1
            ? approachPath[Math.min(1, approachPath.length - 1)]
            : {
                x: harassTarget.x + targetThreat.safeDirection.x * 10,
                y: harassTarget.y + targetThreat.safeDirection.y * 10,
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
      type: 'ATTACK_MOVE',
      entityIds: harassUnits,
      targetPosition: harassTarget,
    };

    this.game.issueAICommand(command);

    debugAI.log(`[AITactics] ${ai.playerId}: Harassing with ${harassUnits.length} units`);

    ai.state = 'building';
  }

  /**
   * Command air combat units independently during attacks.
   * Air units flank the enemy from a different angle than the ground army,
   * creating multi-pronged pressure. Prioritizes enemy air > support > workers.
   */
  private commandAirForce(
    ai: AIPlayer,
    airUnits: number[],
    attackTarget: { x: number; y: number },
    currentTick: number
  ): void {
    if (airUnits.length === 0) return;

    const lastCommand = this.lastAirCommandTick.get(ai.playerId) || 0;
    if (currentTick - lastCommand < AIR_COMMAND_INTERVAL) return;
    this.lastAirCommandTick.set(ai.playerId, currentTick);

    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) return;

    // Flank direction: perpendicular to the base->target vector
    const dx = attackTarget.x - basePos.x;
    const dy = attackTarget.y - basePos.y;
    const dist = deterministicMagnitude(dx, dy);
    if (dist === 0) return;

    const normX = dx / dist;
    const normY = dy / dist;
    // Perpendicular offset for flanking (air approaches from the side)
    const perpX = -normY;
    const perpY = normX;

    const flankTarget = {
      x: attackTarget.x + perpX * AIR_FLANK_OFFSET,
      y: attackTarget.y + perpY * AIR_FLANK_OFFSET,
    };

    // Clamp to map bounds
    const mapWidth = this.game.config.mapWidth;
    const mapHeight = this.game.config.mapHeight;
    flankTarget.x = Math.max(5, Math.min(mapWidth - 5, flankTarget.x));
    flankTarget.y = Math.max(5, Math.min(mapHeight - 5, flankTarget.y));

    // Issue ATTACK_MOVE to flank position — air units auto-engage enemies along the way
    const command: GameCommand = {
      tick: currentTick,
      playerId: ai.playerId,
      type: 'ATTACK_MOVE',
      entityIds: airUnits,
      targetPosition: flankTarget,
    };
    this.game.issueAICommand(command);

    debugAI.log(
      `[AITactics] ${ai.playerId}: Air force (${airUnits.length} units) flanking to ` +
        `(${flankTarget.x.toFixed(0)}, ${flankTarget.y.toFixed(0)})`
    );
  }

  /**
   * Command support air units (Lifter, Overseer) to follow the main army.
   * Support units shadow the army centroid, staying slightly behind.
   */
  private commandSupportAir(ai: AIPlayer, currentTick: number): void {
    const supportUnits = this.getSupportAirUnits(ai.playerId);
    if (supportUnits.length === 0) return;

    // Only re-command periodically
    const lastCommand = this.lastAirCommandTick.get(`${ai.playerId}_support`) || 0;
    if (currentTick - lastCommand < AIR_COMMAND_INTERVAL * 2) return;
    this.lastAirCommandTick.set(`${ai.playerId}_support`, currentTick);

    // Find army centroid
    const armyUnits = this.getArmyUnits(ai.playerId);
    if (armyUnits.length === 0) return;

    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const entityId of armyUnits) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;
      const transform = entity.get<Transform>('Transform');
      if (!transform) continue;
      sumX += transform.x;
      sumY += transform.y;
      count++;
    }
    if (count === 0) return;

    const centroidX = sumX / count;
    const centroidY = sumY / count;

    // Position support behind army center (toward own base)
    const basePos = this.coordinator.findAIBase(ai);
    if (!basePos) return;

    const dx = centroidX - basePos.x;
    const dy = centroidY - basePos.y;
    const dist = deterministicMagnitude(dx, dy);
    let followX = centroidX;
    let followY = centroidY;
    if (dist > 0) {
      // Slightly behind the army, toward base
      followX = centroidX - (dx / dist) * SUPPORT_FOLLOW_DISTANCE;
      followY = centroidY - (dy / dist) * SUPPORT_FOLLOW_DISTANCE;
    }

    const command: GameCommand = {
      tick: currentTick,
      playerId: ai.playerId,
      type: 'MOVE',
      entityIds: supportUnits,
      targetPosition: { x: followX, y: followY },
    };
    this.game.issueAICommand(command);
  }

  /**
   * Execute air harassment against enemy economy.
   * Sends a small group of air units to attack enemy worker lines.
   * Air units bypass ground defenses (they fly over terrain/obstacles).
   */
  public executeAirHarassment(ai: AIPlayer, currentTick: number): void {
    const airUnits = this.getAirArmyUnits(ai.playerId);
    if (airUnits.length === 0) return;

    const lastHarass = this.lastAirHarassTick.get(ai.playerId) || 0;
    if (currentTick - lastHarass < 200) return; // 10-second cooldown between air harass
    this.lastAirHarassTick.set(ai.playerId, currentTick);

    // Select up to AIR_HARASS_MAX_UNITS for harassment
    const harassGroup = airUnits.slice(0, AIR_HARASS_MAX_UNITS);

    // Find enemy base/workers to harass
    const harassTarget = this.findHarassTarget(ai);
    if (!harassTarget) return;

    // Air units don't need safe paths — they fly over obstacles
    const command: GameCommand = {
      tick: currentTick,
      playerId: ai.playerId,
      type: 'ATTACK_MOVE',
      entityIds: harassGroup,
      targetPosition: harassTarget,
    };
    this.game.issueAICommand(command);

    debugAI.log(
      `[AITactics] ${ai.playerId}: Air harassment with ${harassGroup.length} units to ` +
        `(${harassTarget.x.toFixed(0)}, ${harassTarget.y.toFixed(0)})`
    );
  }

  // === Near-Army Threat Detection ===

  /**
   * Find enemy combat units near the army centroid during attack operations.
   * Detects third-party threats (e.g., AI 3's army near AI 1's army while both
   * attack AI 2's base). Returns position of the nearest threat.
   */
  private findNearbyArmyThreat(ai: AIPlayer, armyUnits: number[]): { x: number; y: number } | null {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const entityId of armyUnits) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;
      const transform = entity.get<Transform>('Transform');
      if (!transform) continue;
      sumX += transform.x;
      sumY += transform.y;
      count++;
    }
    if (count === 0) return null;

    const centroidX = sumX / count;
    const centroidY = sumY / count;

    const THREAT_DETECTION_RADIUS = 25;
    const units = this.coordinator.getCachedUnitsWithTransform();

    let nearestThreat: { x: number; y: number; distance: number } | null = null;
    let threatCount = 0;

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (!isEnemy(ai.playerId, ai.teamId, selectable.playerId, selectable.teamId)) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) continue;
      if (unit.attackDamage === 0) continue;

      const dx = transform.x - centroidX;
      const dy = transform.y - centroidY;
      const dist = deterministicMagnitude(dx, dy);
      if (dist > THREAT_DETECTION_RADIUS) continue;

      threatCount++;
      if (!nearestThreat || dist < nearestThreat.distance) {
        nearestThreat = { x: transform.x, y: transform.y, distance: dist };
      }
    }

    // Only respond to meaningful threats (2+ enemy combat units)
    if (threatCount < 2) return null;
    return nearestThreat ? { x: nearestThreat.x, y: nearestThreat.y } : null;
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
   * Skips units already at the target position to avoid the re-command cycle
   * that resets assaultIdleTicks and prevents CombatSystem's timeout from firing.
   */
  private getIdleAssaultUnits(
    playerId: string,
    armyUnits: number[],
    attackTarget?: { x: number; y: number }
  ): number[] {
    const idleUnits: number[] = [];
    // Units within this distance of the target are "at target" — re-commanding
    // them to the same spot just resets their assault idle timer for no benefit
    const AT_TARGET_THRESHOLD = 8;

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
        // For units STILL in assault mode, skip if near target to avoid resetting
        // assaultIdleTicks (which prevents CombatSystem's timeout from firing).
        // For completely idle units (assault mode already timed out), ALWAYS include
        // them — they're in a dead zone where CombatSystem skips them (not in hot cell)
        // and they need an explicit ATTACK command to re-engage the target building.
        if (isIdleAssault && attackTarget) {
          const transform = entity.get<Transform>('Transform');
          if (transform) {
            const dx = transform.x - attackTarget.x;
            const dy = transform.y - attackTarget.y;
            if (deterministicMagnitude(dx, dy) < AT_TARGET_THRESHOLD) {
              continue;
            }
          }
        }
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

      if (!isEnemy(ai.playerId, ai.teamId, selectable.playerId, selectable.teamId)) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue;

      count++;
    }

    return count;
  }

  /**
   * Find ANY enemy building for hunt mode.
   */
  private findAnyEnemyBuilding(ai: AIPlayer): { x: number; y: number; entityId: number } | null {
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (!isEnemy(ai.playerId, ai.teamId, selectable.playerId, selectable.teamId)) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue;

      if (baseTypes.includes(building.buildingId)) {
        return { x: transform.x, y: transform.y, entityId: entity.id };
      }
    }

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      const building = entity.get<Building>('Building')!;

      if (!isEnemy(ai.playerId, ai.teamId, selectable.playerId, selectable.teamId)) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue;

      return { x: transform.x, y: transform.y, entityId: entity.id };
    }

    return null;
  }

  /**
   * Find a specific enemy player's building for targeted hunt mode.
   * Prioritizes HQ buildings, then falls back to any building of that player.
   */
  private findEnemyBuildingForPlayer(
    ai: AIPlayer,
    targetPlayerId: string
  ): { x: number; y: number; entityId: number } | null {
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    // First pass: look for HQ buildings
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== targetPlayerId) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue;

      if (baseTypes.includes(building.buildingId)) {
        return { x: transform.x, y: transform.y, entityId: entity.id };
      }
    }

    // Second pass: any building from this player
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId !== targetPlayerId) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue;

      return { x: transform.x, y: transform.y, entityId: entity.id };
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

      if (!isEnemy(ai.playerId, ai.teamId, selectable.playerId, selectable.teamId)) continue;
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
    const path = influenceMap.findSafePath(
      fromPosition.x,
      fromPosition.y,
      basePos.x,
      basePos.y,
      ai.playerId,
      0.8 // Strong threat avoidance for retreat
    );

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
    // Don't recover units during active attack operations - they're supposed to be out there
    if (ai.state === 'attacking' && ai.activeAttackOperation) return;

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
        const distanceToRally = deterministicMagnitude(dx, dy);

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

  // === Public Helpers for AICoordinator Reactive Defense ===

  /**
   * Public wrapper for findNearestThreat for use by AICoordinator's reactive defense.
   */
  public findNearestThreatPublic(
    ai: AIPlayer,
    position: { x: number; y: number }
  ): { x: number; y: number } | null {
    return this.findNearestThreat(ai, position);
  }

  /**
   * Get army units near a position (for reactive defense).
   * Includes idle AND moving units -- redirect them all to defend.
   */
  public getArmyUnitsNearBase(
    playerId: string,
    basePos: { x: number; y: number },
    radius: number
  ): number[] {
    const nearbyUnits: number[] = [];
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

      // Already engaged in combat - don't interrupt
      if (unit.targetEntityId !== null || unit.state === 'attacking') continue;

      const dx = transform.x - basePos.x;
      const dy = transform.y - basePos.y;
      if (deterministicMagnitude(dx, dy) <= radius) {
        nearbyUnits.push(entity.id);
      }
    }

    return nearbyUnits;
  }
}

import { describe, it, expect } from 'vitest';

/**
 * AI Game Completion Tests
 *
 * Tests for the AI's ability to finish off opponents in FFA games.
 * Covers:
 * 1. Per-enemy building count tracking
 * 2. Per-enemy hunt mode activation
 * 3. Target commitment/hysteresis
 * 4. Defense scaling during committed attacks
 * 5. Near-elimination bonus in threat scoring
 * 6. Building revelation when enemy loses HQ
 * 7. Counter-attack with overwhelming force
 * 8. Defense sensitivity thresholds (isUnderAttack)
 * 9. Defense-to-attack cooldown bypass
 * 10. Large army defense behavior (no formation stutter)
 */

// Re-implement core logic from AITacticsManager for unit testing
// These mirror the constants in AITacticsManager.ts
const HUNT_MODE_BUILDING_THRESHOLD = 3;
const COMMITMENT_SWITCH_SCORE_MULTIPLIER = 1.5;
const COMMITMENT_NEAR_ELIMINATION_SCORE_FLOOR = 0.05;
const COMMITTED_ATTACK_DANGER_THRESHOLD = 0.8;
const COMMITTED_ATTACK_BUILDING_DAMAGE_THRESHOLD = 0.3;

// Defense sensitivity constants (mirror AITacticsManager.ts)
const THREAT_WINDOW_TICKS = 100;
const DEFENSE_DANGER_THRESHOLD = 0.6;
const DEFENSE_BUILDING_DAMAGE_THRESHOLD = 0.7;
const COUNTER_ATTACK_STRENGTH_RATIO = 3.0;

interface EnemyRelation {
  lastAttackedUsTick: number;
  lastWeAttackedTick: number;
  damageDealtToUs: number;
  damageWeDealt: number;
  baseDistance: number;
  threatScore: number;
  basePosition: { x: number; y: number } | null;
  armyNearUs: number;
  buildingCount: number;
  hasHeadquarters: boolean;
}

interface PersonalityWeights {
  proximity: number;
  threat: number;
  retaliation: number;
  opportunity: number;
}

function createRelation(overrides: Partial<EnemyRelation> = {}): EnemyRelation {
  return {
    lastAttackedUsTick: 0,
    lastWeAttackedTick: 0,
    damageDealtToUs: 0,
    damageWeDealt: 0,
    baseDistance: 100,
    threatScore: 0.5,
    basePosition: { x: 50, y: 50 },
    armyNearUs: 0,
    buildingCount: 10,
    hasHeadquarters: true,
    ...overrides,
  };
}

/**
 * Mirror of calculateThreatScoreWithInfluence logic including elimination bonus
 */
function calculateThreatScore(
  weights: PersonalityWeights,
  relation: EnemyRelation,
  dangerLevel: number,
  friendlyInfluence: number,
  enemyInfluence: number,
  currentTick: number
): number {
  const maxDistance = 200;
  const proximityScore = Math.max(0, 1 - relation.baseDistance / maxDistance);
  const threatScore = Math.min(1, dangerLevel);

  const ticksSinceAttack = currentTick - relation.lastAttackedUsTick;
  const recency = Math.max(0, 1 - ticksSinceAttack / 2400);
  const retaliationScore = Math.min(1, relation.damageDealtToUs / 500) * recency;

  const weHaveControl = friendlyInfluence > enemyInfluence;
  const opportunityScore = proximityScore * (weHaveControl ? 0.7 : 0.3);

  // Near-elimination bonus
  let eliminationBonus = 0;
  if (relation.buildingCount > 0 && relation.buildingCount <= HUNT_MODE_BUILDING_THRESHOLD) {
    eliminationBonus = 0.8 - (relation.buildingCount - 1) * 0.25;
  } else if (relation.buildingCount > 0 && !relation.hasHeadquarters) {
    eliminationBonus = 0.2;
  }

  return (
    proximityScore * weights.proximity +
    threatScore * weights.threat +
    retaliationScore * weights.retaliation +
    opportunityScore * weights.opportunity +
    eliminationBonus
  );
}

/**
 * Mirror of selectPrimaryEnemy logic with hysteresis
 */
function selectPrimaryEnemy(
  enemyRelations: Map<string, EnemyRelation>,
  committedEnemyId: string | null
): string | null {
  let bestEnemyId: string | null = null;
  let bestScore = -Infinity;

  for (const [enemyId, relation] of enemyRelations) {
    if (relation.threatScore > bestScore) {
      bestScore = relation.threatScore;
      bestEnemyId = enemyId;
    }
  }

  // Hysteresis
  if (committedEnemyId && enemyRelations.has(committedEnemyId)) {
    const committedRelation = enemyRelations.get(committedEnemyId)!;
    const committedScore = committedRelation.threatScore;

    // Near elimination: almost never switch
    if (
      committedRelation.buildingCount > 0 &&
      committedRelation.buildingCount <= HUNT_MODE_BUILDING_THRESHOLD
    ) {
      if (committedScore > COMMITMENT_NEAR_ELIMINATION_SCORE_FLOOR) {
        return committedEnemyId;
      }
    }

    // Normal hysteresis
    if (
      bestEnemyId !== committedEnemyId &&
      bestScore < committedScore * COMMITMENT_SWITCH_SCORE_MULTIPLIER
    ) {
      return committedEnemyId;
    }
  }

  return bestEnemyId;
}

/**
 * Mirror of isUnderSeriousAttack logic
 */
function isUnderSeriousAttack(dangerLevel: number, lowestBuildingHealthPercent: number): boolean {
  if (dangerLevel > COMMITTED_ATTACK_DANGER_THRESHOLD) return true;
  if (lowestBuildingHealthPercent < COMMITTED_ATTACK_BUILDING_DAMAGE_THRESHOLD) return true;
  return false;
}

/**
 * Mirror of isUnderAttack logic (updated with less sensitive thresholds)
 */
function isUnderAttack(
  dangerLevel: number,
  buildingHealthPercents: number[],
  lastEnemyContactTick: number,
  currentTick: number
): boolean {
  const recentEnemyContact = currentTick - lastEnemyContactTick < THREAT_WINDOW_TICKS;

  if (dangerLevel > DEFENSE_DANGER_THRESHOLD) return true;

  for (const healthPercent of buildingHealthPercents) {
    if (healthPercent < 0.5) return true;
    if (healthPercent < DEFENSE_BUILDING_DAMAGE_THRESHOLD && recentEnemyContact) return true;
  }
  return false;
}

/**
 * Mirror of counter-attack decision logic
 */
function shouldCounterAttack(
  friendlyInfluence: number,
  enemyInfluence: number,
  armySupply: number,
  attackThreshold: number
): boolean {
  if (enemyInfluence <= 0) return true; // No enemies = safe
  const strengthRatio = friendlyInfluence / enemyInfluence;
  return strengthRatio >= COUNTER_ATTACK_STRENGTH_RATIO && armySupply >= attackThreshold;
}

/**
 * Mirror of updateTacticalState defense-to-attack cooldown bypass
 */
function shouldTransitionToAttack(
  armySupply: number,
  attackThreshold: number,
  previousState: string,
  currentTick: number,
  lastAttackTick: number,
  attackCooldown: number
): boolean {
  const canAttack = armySupply >= attackThreshold;
  const justDefended = previousState === 'defending';
  return canAttack && (justDefended || currentTick - lastAttackTick >= attackCooldown);
}

describe('AI Game Completion', () => {
  describe('Per-enemy building tracking', () => {
    it('tracks building count per enemy player', () => {
      const enemyA = createRelation({ buildingCount: 2, hasHeadquarters: false });
      const enemyB = createRelation({ buildingCount: 15, hasHeadquarters: true });
      const enemyC = createRelation({ buildingCount: 8, hasHeadquarters: true });

      expect(enemyA.buildingCount).toBe(2);
      expect(enemyB.buildingCount).toBe(15);
      expect(enemyC.buildingCount).toBe(8);
    });

    it('tracks HQ status per enemy player', () => {
      const enemyWithHQ = createRelation({ hasHeadquarters: true });
      const enemyWithoutHQ = createRelation({ hasHeadquarters: false });

      expect(enemyWithHQ.hasHeadquarters).toBe(true);
      expect(enemyWithoutHQ.hasHeadquarters).toBe(false);
    });
  });

  describe('Per-enemy hunt mode', () => {
    it('activates hunt mode when primary enemy has <= 3 buildings', () => {
      const primaryRelation = createRelation({ buildingCount: 2 });
      const inHuntMode =
        primaryRelation.buildingCount > 0 &&
        primaryRelation.buildingCount <= HUNT_MODE_BUILDING_THRESHOLD;

      expect(inHuntMode).toBe(true);
    });

    it('does NOT activate hunt mode when primary enemy has > 3 buildings', () => {
      const primaryRelation = createRelation({ buildingCount: 10 });
      const inHuntMode =
        primaryRelation.buildingCount > 0 &&
        primaryRelation.buildingCount <= HUNT_MODE_BUILDING_THRESHOLD;

      expect(inHuntMode).toBe(false);
    });

    it('activates even when total enemy buildings across all players is high', () => {
      // The old bug: global count was used instead of per-enemy
      // In a 6-player FFA, even if one player has 2 buildings left,
      // hunt mode should activate for THAT specific player
      const primaryRelation = createRelation({ buildingCount: 2 });
      // Other enemies have many buildings (irrelevant to per-enemy check)
      const _otherEnemy1 = createRelation({ buildingCount: 20 });
      const _otherEnemy2 = createRelation({ buildingCount: 15 });

      const inHuntMode =
        primaryRelation.buildingCount > 0 &&
        primaryRelation.buildingCount <= HUNT_MODE_BUILDING_THRESHOLD;

      expect(inHuntMode).toBe(true);
    });

    it('does not activate for 0 buildings (enemy fully eliminated)', () => {
      const primaryRelation = createRelation({ buildingCount: 0 });
      const inHuntMode =
        primaryRelation.buildingCount > 0 &&
        primaryRelation.buildingCount <= HUNT_MODE_BUILDING_THRESHOLD;

      expect(inHuntMode).toBe(false);
    });
  });

  describe('Target commitment / hysteresis', () => {
    it('stays on committed enemy when near elimination even if new target scores higher', () => {
      const relations = new Map<string, EnemyRelation>();
      relations.set(
        'enemyA',
        createRelation({
          threatScore: 0.3,
          buildingCount: 2, // Near elimination
          hasHeadquarters: false,
        })
      );
      relations.set(
        'enemyB',
        createRelation({
          threatScore: 0.8, // Scores much higher
          buildingCount: 15,
          hasHeadquarters: true,
        })
      );

      const result = selectPrimaryEnemy(relations, 'enemyA');
      expect(result).toBe('enemyA'); // Should stay committed
    });

    it('allows switch when committed enemy score is near zero', () => {
      const relations = new Map<string, EnemyRelation>();
      relations.set(
        'enemyA',
        createRelation({
          threatScore: 0.01, // Basically irrelevant
          buildingCount: 1,
          hasHeadquarters: false,
        })
      );
      relations.set(
        'enemyB',
        createRelation({
          threatScore: 0.8,
          buildingCount: 15,
          hasHeadquarters: true,
        })
      );

      const result = selectPrimaryEnemy(relations, 'enemyA');
      expect(result).toBe('enemyB'); // Score too low, allow switch
    });

    it('requires 1.5x score to switch from committed enemy in normal case', () => {
      const relations = new Map<string, EnemyRelation>();
      relations.set(
        'enemyA',
        createRelation({
          threatScore: 0.5,
          buildingCount: 10,
          hasHeadquarters: true,
        })
      );
      relations.set(
        'enemyB',
        createRelation({
          threatScore: 0.7, // Higher but < 1.5x (0.75)
          buildingCount: 10,
          hasHeadquarters: true,
        })
      );

      const result = selectPrimaryEnemy(relations, 'enemyA');
      expect(result).toBe('enemyA'); // 0.7 < 0.5 * 1.5, stay committed
    });

    it('allows switch when new target scores significantly higher (>1.5x)', () => {
      const relations = new Map<string, EnemyRelation>();
      relations.set(
        'enemyA',
        createRelation({
          threatScore: 0.3,
          buildingCount: 10,
          hasHeadquarters: true,
        })
      );
      relations.set(
        'enemyB',
        createRelation({
          threatScore: 0.9, // > 0.3 * 1.5 = 0.45
          buildingCount: 10,
          hasHeadquarters: true,
        })
      );

      const result = selectPrimaryEnemy(relations, 'enemyA');
      expect(result).toBe('enemyB'); // 0.9 > 0.45, switch allowed
    });

    it('picks best enemy when no prior commitment', () => {
      const relations = new Map<string, EnemyRelation>();
      relations.set('enemyA', createRelation({ threatScore: 0.3 }));
      relations.set('enemyB', createRelation({ threatScore: 0.8 }));

      const result = selectPrimaryEnemy(relations, null);
      expect(result).toBe('enemyB');
    });

    it('clears commitment when committed enemy is eliminated', () => {
      const relations = new Map<string, EnemyRelation>();
      // enemyA was committed but no longer in relations (eliminated)
      relations.set('enemyB', createRelation({ threatScore: 0.5 }));

      const result = selectPrimaryEnemy(relations, 'enemyA');
      expect(result).toBe('enemyB'); // Committed enemy gone, pick best
    });
  });

  describe('Defense scaling during committed attacks', () => {
    it('classifies low danger as non-serious', () => {
      // When AI is cleaning up an enemy and another player pokes with small force
      const serious = isUnderSeriousAttack(0.3, 0.9);
      expect(serious).toBe(false);
    });

    it('classifies high danger as serious', () => {
      const serious = isUnderSeriousAttack(0.9, 0.9);
      expect(serious).toBe(true);
    });

    it('classifies badly damaged building as serious', () => {
      const serious = isUnderSeriousAttack(0.2, 0.2); // Building at 20% HP
      expect(serious).toBe(true);
    });

    it('ignores minor building damage during cleanup', () => {
      // Building scratched to 85% is not serious during cleanup
      const serious = isUnderSeriousAttack(0.4, 0.85);
      expect(serious).toBe(false);
    });
  });

  describe('Near-elimination bonus in threat scoring', () => {
    const balancedWeights: PersonalityWeights = {
      proximity: 0.3,
      threat: 0.3,
      retaliation: 0.2,
      opportunity: 0.2,
    };

    it('gives high bonus for enemy with 1 building left', () => {
      const nearDead = createRelation({ buildingCount: 1, hasHeadquarters: false });
      const healthy = createRelation({ buildingCount: 10, hasHeadquarters: true });

      const nearDeadScore = calculateThreatScore(balancedWeights, nearDead, 0, 0, 0, 0);
      const healthyScore = calculateThreatScore(balancedWeights, healthy, 0, 0, 0, 0);

      // Near-dead enemy should score significantly higher (0.8 elimination bonus)
      expect(nearDeadScore).toBeGreaterThan(healthyScore + 0.5);
    });

    it('gives moderate bonus for enemy with 2-3 buildings left', () => {
      const twoBuildings = createRelation({ buildingCount: 2, hasHeadquarters: false });
      const threeBuildings = createRelation({ buildingCount: 3, hasHeadquarters: false });
      const healthy = createRelation({ buildingCount: 10, hasHeadquarters: true });

      const twoScore = calculateThreatScore(balancedWeights, twoBuildings, 0, 0, 0, 0);
      const threeScore = calculateThreatScore(balancedWeights, threeBuildings, 0, 0, 0, 0);
      const healthyScore = calculateThreatScore(balancedWeights, healthy, 0, 0, 0, 0);

      expect(twoScore).toBeGreaterThan(healthyScore);
      expect(threeScore).toBeGreaterThan(healthyScore);
      // Fewer buildings = higher bonus
      expect(twoScore).toBeGreaterThan(threeScore);
    });

    it('gives small bonus when enemy lost HQ but has many buildings', () => {
      const noHQ = createRelation({ buildingCount: 8, hasHeadquarters: false });
      const withHQ = createRelation({ buildingCount: 8, hasHeadquarters: true });

      const noHQScore = calculateThreatScore(balancedWeights, noHQ, 0, 0, 0, 0);
      const withHQScore = calculateThreatScore(balancedWeights, withHQ, 0, 0, 0, 0);

      // Lost HQ gives 0.2 bonus
      expect(noHQScore).toBeGreaterThan(withHQScore);
      expect(noHQScore - withHQScore).toBeCloseTo(0.2, 1);
    });

    it('gives no bonus for enemies with many buildings and HQ', () => {
      const healthy = createRelation({ buildingCount: 10, hasHeadquarters: true });

      const score = calculateThreatScore(balancedWeights, healthy, 0, 0, 0, 0);

      // With zero danger/threat/retaliation, score should just be from proximity+opportunity
      // No elimination bonus
      const expectedBase =
        Math.max(0, 1 - 100 / 200) * 0.3 + // proximity
        0 + // threat
        0 + // retaliation
        Math.max(0, 1 - 100 / 200) * 0.3 * 0.2; // opportunity (no control)

      expect(score).toBeCloseTo(expectedBase, 5);
    });
  });

  describe('Building revelation', () => {
    it('should reveal buildings when player has no HQ', () => {
      // This tests the logic concept - actual VisionSystem integration
      // is tested in vision system tests
      const playerHasHQ = new Map<string, boolean>();
      const playerBuildingPositions = new Map<string, Array<{ x: number; y: number }>>();

      // Player A: has buildings but no HQ (should be revealed)
      playerBuildingPositions.set('playerA', [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ]);
      playerHasHQ.set('playerA', false);

      // Player B: has buildings and HQ (should NOT be revealed)
      playerBuildingPositions.set('playerB', [{ x: 50, y: 60 }]);
      playerHasHQ.set('playerB', true);

      // Check which players should have buildings revealed
      const playersToReveal: string[] = [];
      for (const [playerId] of playerBuildingPositions) {
        if (!playerHasHQ.get(playerId)) {
          playersToReveal.push(playerId);
        }
      }

      expect(playersToReveal).toContain('playerA');
      expect(playersToReveal).not.toContain('playerB');
    });

    it('should not reveal when player still has HQ', () => {
      const playerHasHQ = new Map<string, boolean>();
      playerHasHQ.set('playerA', true);
      playerHasHQ.set('playerB', true);

      const playersToReveal: string[] = [];
      for (const [playerId, hasHQ] of playerHasHQ) {
        if (!hasHQ) {
          playersToReveal.push(playerId);
        }
      }

      expect(playersToReveal).toHaveLength(0);
    });
  });

  describe('Disengagement timeout', () => {
    it('never disengages during hunt mode', () => {
      // In hunt mode (enemy has <=3 buildings), the disengage timeout is bypassed
      const primaryBuildingCount = 2;
      const inHuntMode =
        primaryBuildingCount > 0 && primaryBuildingCount <= HUNT_MODE_BUILDING_THRESHOLD;
      const engaged = false;
      const disengagedDuration = 200; // Way past the 100-tick threshold

      // The condition for disengagement: !engaged && !inHuntMode
      const shouldDisengage = !engaged && !inHuntMode && disengagedDuration > 100;

      expect(inHuntMode).toBe(true);
      expect(shouldDisengage).toBe(false); // Never disengage in hunt mode
    });

    it('disengages normally when NOT in hunt mode', () => {
      const primaryBuildingCount = 10;
      const inHuntMode =
        primaryBuildingCount > 0 && primaryBuildingCount <= HUNT_MODE_BUILDING_THRESHOLD;
      const engaged = false;
      const disengagedDuration = 200;

      const shouldDisengage = !engaged && !inHuntMode && disengagedDuration > 100;

      expect(inHuntMode).toBe(false);
      expect(shouldDisengage).toBe(true);
    });

    it('does not disengage when engaged in combat even outside hunt mode', () => {
      const primaryBuildingCount = 10;
      const inHuntMode =
        primaryBuildingCount > 0 && primaryBuildingCount <= HUNT_MODE_BUILDING_THRESHOLD;
      const engaged = true;
      const disengagedDuration = 200;

      const shouldDisengage = !engaged && !inHuntMode && disengagedDuration > 100;

      expect(shouldDisengage).toBe(false);
    });
  });

  describe('FFA scenario integration', () => {
    it('AI finishes off nearly-dead enemy instead of switching to new attacker', () => {
      // Simulate: AI attacking enemyA (2 buildings left), enemyB pokes AI base
      const relations = new Map<string, EnemyRelation>();
      relations.set(
        'enemyA',
        createRelation({
          threatScore: 0.3,
          buildingCount: 2,
          hasHeadquarters: false,
          baseDistance: 80,
        })
      );
      relations.set(
        'enemyB',
        createRelation({
          threatScore: 0.6, // Higher threat (attacking us)
          buildingCount: 12,
          hasHeadquarters: true,
          baseDistance: 120,
        })
      );

      // With elimination bonus recalculated for enemyA:
      // enemyA gets +0.55 elimination bonus (2 buildings = 0.8 - 0.25 = 0.55)
      // So effective score is much higher

      // 1. Primary enemy stays enemyA due to commitment hysteresis
      const primaryEnemy = selectPrimaryEnemy(relations, 'enemyA');
      expect(primaryEnemy).toBe('enemyA');

      // 2. Hunt mode activates for enemyA specifically
      const primaryRelation = relations.get(primaryEnemy!)!;
      const inHuntMode =
        primaryRelation.buildingCount > 0 &&
        primaryRelation.buildingCount <= HUNT_MODE_BUILDING_THRESHOLD;
      expect(inHuntMode).toBe(true);

      // 3. Minor poke from enemyB doesn't trigger serious defense
      const serious = isUnderSeriousAttack(0.4, 0.85);
      expect(serious).toBe(false);
    });

    it('AI does switch targets when current target is not near elimination and new threat is serious', () => {
      const relations = new Map<string, EnemyRelation>();
      relations.set(
        'enemyA',
        createRelation({
          threatScore: 0.3,
          buildingCount: 10, // NOT near elimination
          hasHeadquarters: true,
        })
      );
      relations.set(
        'enemyB',
        createRelation({
          threatScore: 0.8, // Significantly higher (> 1.5x)
          buildingCount: 8,
          hasHeadquarters: true,
        })
      );

      // Should switch: 0.8 > 0.3 * 1.5 = 0.45
      const result = selectPrimaryEnemy(relations, 'enemyA');
      expect(result).toBe('enemyB');
    });
  });

  describe('Defense sensitivity (isUnderAttack)', () => {
    it('does NOT trigger defense for building at 85% HP (above 0.7 threshold)', () => {
      // Old bug: building at 85% + recentEnemyContact triggered defense with 0.9 threshold
      const result = isUnderAttack(0.3, [0.85], 90, 100);
      expect(result).toBe(false);
    });

    it('does NOT trigger defense for building at 75% HP without recent contact', () => {
      // Building below 0.7 but no recent contact = no defense
      const result = isUnderAttack(0.3, [0.75], 0, 200);
      expect(result).toBe(false);
    });

    it('triggers defense for building at 65% HP with recent enemy contact', () => {
      // Building below 0.7 + recent contact = defense
      const result = isUnderAttack(0.3, [0.65], 95, 100);
      expect(result).toBe(true);
    });

    it('always triggers defense for building below 50% HP', () => {
      const result = isUnderAttack(0.0, [0.4], 0, 10000);
      expect(result).toBe(true);
    });

    it('does NOT trigger for danger level 0.55 (below 0.6 threshold)', () => {
      // Old code triggered at 0.5; now needs 0.6
      const result = isUnderAttack(0.55, [1.0], 0, 100);
      expect(result).toBe(false);
    });

    it('triggers for danger level 0.65', () => {
      const result = isUnderAttack(0.65, [1.0], 0, 100);
      expect(result).toBe(true);
    });

    it('enemy contact expires after 100 ticks (not 200)', () => {
      // Contact at tick 0, current tick 150 → expired (100-tick window)
      const result = isUnderAttack(0.3, [0.65], 0, 150);
      expect(result).toBe(false);

      // Contact at tick 55, current tick 150 → still active (within 100 ticks)
      const result2 = isUnderAttack(0.3, [0.65], 55, 150);
      expect(result2).toBe(true);
    });

    it('healthy buildings with minor danger do not trigger defense', () => {
      // All buildings at full health, minor danger = no defense
      const result = isUnderAttack(0.4, [1.0, 0.95, 0.98], 90, 100);
      expect(result).toBe(false);
    });
  });

  describe('Counter-attack with overwhelming force', () => {
    it('counter-attacks when army is 3x+ stronger than local threat', () => {
      // Friendly influence 150, enemy influence 30 → ratio 5.0 >= 3.0
      const result = shouldCounterAttack(150, 30, 20, 10);
      expect(result).toBe(true);
    });

    it('does NOT counter-attack when army is only slightly stronger', () => {
      // Friendly influence 50, enemy influence 30 → ratio 1.67 < 3.0
      const result = shouldCounterAttack(50, 30, 20, 10);
      expect(result).toBe(false);
    });

    it('does NOT counter-attack when army supply is below threshold', () => {
      // Strong locally but low overall supply
      const result = shouldCounterAttack(150, 30, 5, 10);
      expect(result).toBe(false);
    });

    it('always counter-attacks when no enemies near base', () => {
      // Zero enemy influence = Infinity ratio
      const result = shouldCounterAttack(100, 0, 20, 10);
      expect(result).toBe(true);
    });

    it('100-unit army counter-attacks against a few raiders', () => {
      // Simulates the reported bug: massive army sitting at base
      // Friendly influence ~500, enemy influence ~20 (a few raiders)
      const result = shouldCounterAttack(500, 20, 100, 10);
      expect(result).toBe(true);
    });

    it('does NOT counter-attack against equal-strength armies', () => {
      // Friendly 100, enemy 80 → ratio 1.25 < 3.0
      const result = shouldCounterAttack(100, 80, 50, 10);
      expect(result).toBe(false);
    });
  });

  describe('Defense-to-attack cooldown bypass', () => {
    it('allows immediate attack transition from defending state', () => {
      // Was just defending, threat cleared, has enough army
      const result = shouldTransitionToAttack(20, 10, 'defending', 100, 50, 200);
      expect(result).toBe(true);
    });

    it('respects cooldown when transitioning from building state', () => {
      // Normal cooldown applies when not coming from defense
      const result = shouldTransitionToAttack(20, 10, 'building', 100, 50, 200);
      expect(result).toBe(false); // 100 - 50 = 50 < 200 cooldown
    });

    it('attacks normally when cooldown has expired', () => {
      const result = shouldTransitionToAttack(20, 10, 'building', 300, 50, 200);
      expect(result).toBe(true); // 300 - 50 = 250 >= 200 cooldown
    });

    it('does NOT attack without sufficient army even from defending', () => {
      const result = shouldTransitionToAttack(5, 10, 'defending', 100, 50, 200);
      expect(result).toBe(false); // 5 < 10 threshold
    });

    it('prevents AI from getting stuck in building state after defense', () => {
      // Scenario: AI just cleared a threat, has massive 100-supply army,
      // but lastAttackTick was recent. Without bypass, it would sit in building state.
      const result = shouldTransitionToAttack(100, 10, 'defending', 105, 100, 200);
      expect(result).toBe(true); // justDefended bypasses cooldown
    });
  });
});

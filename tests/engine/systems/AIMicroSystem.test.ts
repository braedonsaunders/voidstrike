import { describe, it, expect } from 'vitest';
import { distance, clamp } from '@/utils/math';

/**
 * AIMicroSystem Tests
 *
 * Tests for the AI micro-management system including:
 * 1. Behavior type selection based on unit characteristics
 * 2. Kiting calculations for ranged units
 * 3. Threat assessment scoring
 * 4. Focus fire target selection
 * 5. Transform decisions for transformable units
 * 6. Counter-building analysis functions
 */

// Constants from AIMicroSystem and DOMINION_AI_CONFIG
const KITE_COOLDOWN_TICKS = 10;
const FOCUS_FIRE_THRESHOLD = 0.7;
const TRANSFORM_SCAN_RANGE = 15;

// Unit priority for focus fire (from DOMINION_AI_CONFIG)
const UNIT_PRIORITY: Record<string, number> = {
  worker: 30,
  trooper: 50,
  breacher: 60,
  vanguard: 70,
  scorcher: 65,
  devastator: 55,
  colossus: 80,
  valkyrie: 85,
  specter: 90,
  lifter: 40,
  operative: 95,
  inferno: 75,
};

// Threat assessment weights (from DOMINION_AI_CONFIG)
const THREAT_WEIGHTS = {
  damage: 1.0,
  priority: 0.8,
  distance: 1.2,
  health: 0.5,
};

describe('AIMicroSystem', () => {
  describe('behavior type selection', () => {
    /**
     * Replicates the selectBehaviorType logic from AIMicroSystem
     */
    type UnitBehaviorType = 'worker' | 'utility' | 'ranged_combat' | 'melee_combat' | 'combat';

    interface MockUnit {
      isWorker: boolean;
      isFlying: boolean;
      attackRange: number;
    }

    function selectBehaviorType(unit: MockUnit): UnitBehaviorType {
      if (unit.isWorker) {
        return 'worker';
      }
      if (unit.isFlying) {
        return 'utility';
      }
      if (unit.attackRange >= 3) {
        return 'ranged_combat';
      }
      if (unit.attackRange < 3) {
        return 'melee_combat';
      }
      return 'combat';
    }

    it('assigns worker behavior to workers', () => {
      const unit: MockUnit = { isWorker: true, isFlying: false, attackRange: 0.5 };
      expect(selectBehaviorType(unit)).toBe('worker');
    });

    it('worker behavior takes precedence over flying', () => {
      const unit: MockUnit = { isWorker: true, isFlying: true, attackRange: 1 };
      expect(selectBehaviorType(unit)).toBe('worker');
    });

    it('assigns utility behavior to flying units', () => {
      const unit: MockUnit = { isWorker: false, isFlying: true, attackRange: 5 };
      expect(selectBehaviorType(unit)).toBe('utility');
    });

    it('assigns ranged_combat for attack range >= 3', () => {
      const unit: MockUnit = { isWorker: false, isFlying: false, attackRange: 3 };
      expect(selectBehaviorType(unit)).toBe('ranged_combat');
    });

    it('assigns ranged_combat for attack range > 3', () => {
      const unit: MockUnit = { isWorker: false, isFlying: false, attackRange: 7 };
      expect(selectBehaviorType(unit)).toBe('ranged_combat');
    });

    it('assigns melee_combat for attack range < 3', () => {
      const unit: MockUnit = { isWorker: false, isFlying: false, attackRange: 1.5 };
      expect(selectBehaviorType(unit)).toBe('melee_combat');
    });

    it('assigns melee_combat for attack range 0', () => {
      const unit: MockUnit = { isWorker: false, isFlying: false, attackRange: 0 };
      expect(selectBehaviorType(unit)).toBe('melee_combat');
    });

    it('assigns melee_combat for attack range 2.9', () => {
      const unit: MockUnit = { isWorker: false, isFlying: false, attackRange: 2.9 };
      expect(selectBehaviorType(unit)).toBe('melee_combat');
    });

    it('flying takes precedence over attack range', () => {
      const unit: MockUnit = { isWorker: false, isFlying: true, attackRange: 1 };
      expect(selectBehaviorType(unit)).toBe('utility');
    });
  });

  describe('kiting calculation', () => {
    /**
     * Replicates the kite position calculation from AIMicroSystem.executeKiting
     */
    function calculateKitePosition(
      unitX: number,
      unitY: number,
      enemyX: number,
      enemyY: number,
      attackRange: number,
      mapWidth: number,
      mapHeight: number
    ): { x: number; y: number } {
      // Calculate direction away from enemy
      const dx = unitX - enemyX;
      const dy = unitY - enemyY;
      const dist = distance(enemyX, enemyY, unitX, unitY);

      if (dist < 0.1) {
        // Too close, pick a default direction
        return { x: clamp(unitX + 1, 2, mapWidth - 2), y: clamp(unitY, 2, mapHeight - 2) };
      }

      const kiteDistance = attackRange * 0.6;
      let targetX = unitX + (dx / dist) * kiteDistance;
      let targetY = unitY + (dy / dist) * kiteDistance;

      // Clamp to map bounds
      targetX = clamp(targetX, 2, mapWidth - 2);
      targetY = clamp(targetY, 2, mapHeight - 2);

      return { x: targetX, y: targetY };
    }

    it('kites away from enemy in positive x direction', () => {
      const pos = calculateKitePosition(10, 10, 5, 10, 5, 100, 100);
      expect(pos.x).toBeGreaterThan(10); // Moved further from enemy
      expect(pos.y).toBeCloseTo(10, 5); // Y unchanged
    });

    it('kites away from enemy in negative x direction', () => {
      const pos = calculateKitePosition(5, 10, 10, 10, 5, 100, 100);
      expect(pos.x).toBeLessThan(5); // Moved further from enemy
      expect(pos.y).toBeCloseTo(10, 5);
    });

    it('kites away from enemy in positive y direction', () => {
      const pos = calculateKitePosition(10, 15, 10, 5, 5, 100, 100);
      expect(pos.x).toBeCloseTo(10, 5);
      expect(pos.y).toBeGreaterThan(15); // Moved further from enemy
    });

    it('kites away from enemy diagonally', () => {
      const pos = calculateKitePosition(10, 10, 5, 5, 5, 100, 100);
      expect(pos.x).toBeGreaterThan(10);
      expect(pos.y).toBeGreaterThan(10);
    });

    it('kite distance is 60% of attack range', () => {
      const attackRange = 10;
      const pos = calculateKitePosition(50, 50, 45, 50, attackRange, 100, 100);
      const kiteDistance = distance(50, 50, pos.x, pos.y);
      expect(kiteDistance).toBeCloseTo(attackRange * 0.6, 1);
    });

    it('clamps to minimum map bounds (x)', () => {
      const pos = calculateKitePosition(3, 50, 10, 50, 10, 100, 100);
      expect(pos.x).toBeGreaterThanOrEqual(2);
    });

    it('clamps to minimum map bounds (y)', () => {
      const pos = calculateKitePosition(50, 3, 50, 10, 10, 100, 100);
      expect(pos.y).toBeGreaterThanOrEqual(2);
    });

    it('clamps to maximum map bounds (x)', () => {
      const pos = calculateKitePosition(97, 50, 90, 50, 10, 100, 100);
      expect(pos.x).toBeLessThanOrEqual(98);
    });

    it('clamps to maximum map bounds (y)', () => {
      const pos = calculateKitePosition(50, 97, 50, 90, 10, 100, 100);
      expect(pos.y).toBeLessThanOrEqual(98);
    });

    it('handles zero distance case', () => {
      const pos = calculateKitePosition(50, 50, 50, 50, 5, 100, 100);
      // Should pick a default direction when directly on top
      expect(pos.x).toBeDefined();
      expect(pos.y).toBeDefined();
    });

    it('handles very small attack range', () => {
      const pos = calculateKitePosition(50, 50, 49, 50, 1, 100, 100);
      // Kite distance should be 0.6
      expect(pos.x).toBeCloseTo(50.6, 1);
    });
  });

  describe('threat assessment', () => {
    /**
     * Replicates the threat score calculation from updateThreatAssessment
     */
    function calculateThreatScore(
      distance: number,
      threatRange: number,
      attackDamage: number,
      attackSpeed: number,
      priority: number,
      healthPercent: number
    ): number {
      const dps = attackDamage * attackSpeed;
      const distanceFactor = Math.max(0, 1 - distance / threatRange) * THREAT_WEIGHTS.distance;
      const damageFactor = (dps / 20) * THREAT_WEIGHTS.damage;
      const priorityFactor = (priority / 100) * THREAT_WEIGHTS.priority;
      const healthFactor = (1 + (1 - healthPercent)) * THREAT_WEIGHTS.health;

      return (damageFactor + priorityFactor) * distanceFactor * healthFactor;
    }

    it('returns 0 for enemies at max range', () => {
      const score = calculateThreatScore(15, 15, 10, 1, 50, 1.0);
      expect(score).toBe(0);
    });

    it('returns higher score for closer enemies', () => {
      const scoreClose = calculateThreatScore(5, 15, 10, 1, 50, 1.0);
      const scoreFar = calculateThreatScore(10, 15, 10, 1, 50, 1.0);
      expect(scoreClose).toBeGreaterThan(scoreFar);
    });

    it('returns higher score for higher DPS', () => {
      const scoreHighDps = calculateThreatScore(5, 15, 20, 2, 50, 1.0);
      const scoreLowDps = calculateThreatScore(5, 15, 5, 1, 50, 1.0);
      expect(scoreHighDps).toBeGreaterThan(scoreLowDps);
    });

    it('DPS is attack damage * attack speed', () => {
      // Same DPS from different combinations should give same damage factor
      const score1 = calculateThreatScore(5, 15, 10, 2, 50, 1.0); // DPS = 20
      const score2 = calculateThreatScore(5, 15, 20, 1, 50, 1.0); // DPS = 20
      expect(score1).toBeCloseTo(score2, 5);
    });

    it('returns higher score for higher priority units', () => {
      const scoreHighPrio = calculateThreatScore(5, 15, 10, 1, 90, 1.0);
      const scoreLowPrio = calculateThreatScore(5, 15, 10, 1, 30, 1.0);
      expect(scoreHighPrio).toBeGreaterThan(scoreLowPrio);
    });

    it('returns higher score for lower health enemies (focus fire)', () => {
      const scoreLowHealth = calculateThreatScore(5, 15, 10, 1, 50, 0.2);
      const scoreFullHealth = calculateThreatScore(5, 15, 10, 1, 50, 1.0);
      expect(scoreLowHealth).toBeGreaterThan(scoreFullHealth);
    });

    it('health factor scales correctly', () => {
      // healthFactor = (1 + (1 - healthPercent)) * 0.5
      // At 100% health: (1 + 0) * 0.5 = 0.5
      // At 50% health: (1 + 0.5) * 0.5 = 0.75
      // At 0% health: (1 + 1) * 0.5 = 1.0
      const scoreFullHealth = calculateThreatScore(5, 15, 10, 1, 50, 1.0);
      const scoreHalfHealth = calculateThreatScore(5, 15, 10, 1, 50, 0.5);
      const scoreNoHealth = calculateThreatScore(5, 15, 10, 1, 50, 0.0);

      expect(scoreHalfHealth / scoreFullHealth).toBeCloseTo(1.5, 1);
      expect(scoreNoHealth / scoreFullHealth).toBeCloseTo(2.0, 1);
    });

    it('is deterministic', () => {
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(calculateThreatScore(7, 15, 12, 1.5, 60, 0.7));
      }
      expect(new Set(results).size).toBe(1);
    });
  });

  describe('focus fire logic', () => {
    interface MockTarget {
      entityId: number;
      healthPercent: number;
      isDead: boolean;
    }

    /**
     * Determines if unit should switch to a better target
     * Replicates handleFocusFire logic
     */
    function shouldSwitchTarget(
      currentTarget: MockTarget | null,
      betterTarget: MockTarget | null
    ): boolean {
      // No current target - should acquire new one
      if (!currentTarget || currentTarget.isDead) {
        return betterTarget !== null && !betterTarget.isDead;
      }

      // Current target is valid
      // If current target is low health, keep focusing it
      if (currentTarget.healthPercent < FOCUS_FIRE_THRESHOLD) {
        return false;
      }

      // Check if better target exists
      if (!betterTarget || betterTarget.isDead) {
        return false;
      }

      // Switch to better target if significantly better (20% health difference)
      return betterTarget.healthPercent < currentTarget.healthPercent - 0.2;
    }

    it('acquires target when no current target', () => {
      const betterTarget: MockTarget = { entityId: 2, healthPercent: 0.8, isDead: false };
      expect(shouldSwitchTarget(null, betterTarget)).toBe(true);
    });

    it('acquires target when current target is dead', () => {
      const currentTarget: MockTarget = { entityId: 1, healthPercent: 0, isDead: true };
      const betterTarget: MockTarget = { entityId: 2, healthPercent: 0.8, isDead: false };
      expect(shouldSwitchTarget(currentTarget, betterTarget)).toBe(true);
    });

    it('does not switch when current target is below focus threshold', () => {
      const currentTarget: MockTarget = { entityId: 1, healthPercent: 0.6, isDead: false };
      const betterTarget: MockTarget = { entityId: 2, healthPercent: 0.3, isDead: false };
      expect(shouldSwitchTarget(currentTarget, betterTarget)).toBe(false);
    });

    it('does not switch to dead target', () => {
      const currentTarget: MockTarget = { entityId: 1, healthPercent: 0.9, isDead: false };
      const betterTarget: MockTarget = { entityId: 2, healthPercent: 0.1, isDead: true };
      expect(shouldSwitchTarget(currentTarget, betterTarget)).toBe(false);
    });

    it('switches when better target has significantly lower health', () => {
      const currentTarget: MockTarget = { entityId: 1, healthPercent: 0.9, isDead: false };
      const betterTarget: MockTarget = { entityId: 2, healthPercent: 0.5, isDead: false };
      expect(shouldSwitchTarget(currentTarget, betterTarget)).toBe(true);
    });

    it('does not switch when health difference is small', () => {
      const currentTarget: MockTarget = { entityId: 1, healthPercent: 0.9, isDead: false };
      const betterTarget: MockTarget = { entityId: 2, healthPercent: 0.8, isDead: false };
      expect(shouldSwitchTarget(currentTarget, betterTarget)).toBe(false);
    });

    it('does not switch when better target has MORE health', () => {
      const currentTarget: MockTarget = { entityId: 1, healthPercent: 0.5, isDead: false };
      const betterTarget: MockTarget = { entityId: 2, healthPercent: 0.9, isDead: false };
      expect(shouldSwitchTarget(currentTarget, betterTarget)).toBe(false);
    });

    it('threshold of 20% is the switch boundary', () => {
      const currentTarget: MockTarget = { entityId: 1, healthPercent: 0.8, isDead: false };
      const target19Percent: MockTarget = { entityId: 2, healthPercent: 0.61, isDead: false };
      const target21Percent: MockTarget = { entityId: 3, healthPercent: 0.59, isDead: false };

      expect(shouldSwitchTarget(currentTarget, target19Percent)).toBe(false);
      expect(shouldSwitchTarget(currentTarget, target21Percent)).toBe(true);
    });
  });

  describe('transform decisions', () => {
    interface MockEnemyUnit {
      isFlying: boolean;
      attackDamage: number;
      attackSpeed: number;
      distance: number;
    }

    /**
     * Determines target mode for transformable units
     * Replicates handleTransformDecision logic
     */
    function calculateTransformDecision(
      isInFighterMode: boolean,
      nearbyEnemies: MockEnemyUnit[]
    ): { shouldTransform: boolean; targetMode: 'fighter' | 'assault' | null } {
      let nearbyAirEnemies = 0;
      let nearbyGroundEnemies = 0;
      let airThreatScore = 0;
      let groundThreatScore = 0;

      for (const enemy of nearbyEnemies) {
        const distanceWeight = Math.max(0, 1 - enemy.distance / TRANSFORM_SCAN_RANGE);
        const dps = enemy.attackDamage * enemy.attackSpeed;
        const threatScore = dps * distanceWeight;

        if (enemy.isFlying) {
          nearbyAirEnemies++;
          airThreatScore += threatScore;
        } else {
          nearbyGroundEnemies++;
          groundThreatScore += threatScore;
        }
      }

      let shouldTransform = false;
      let targetMode: 'fighter' | 'assault' | null = null;

      if (isInFighterMode) {
        // Currently in Fighter mode (can only attack air)
        if (nearbyGroundEnemies > 0 && nearbyAirEnemies === 0) {
          shouldTransform = true;
          targetMode = 'assault';
        } else if (nearbyGroundEnemies > 0 && groundThreatScore > airThreatScore * 2) {
          if (nearbyAirEnemies <= 1 && nearbyGroundEnemies >= 3) {
            shouldTransform = true;
            targetMode = 'assault';
          }
        }
      } else {
        // Currently in Assault mode (can only attack ground)
        if (nearbyAirEnemies > 0 && nearbyGroundEnemies === 0) {
          shouldTransform = true;
          targetMode = 'fighter';
        } else if (nearbyAirEnemies > 0 && airThreatScore > groundThreatScore * 2) {
          if (nearbyGroundEnemies <= 1 && nearbyAirEnemies >= 2) {
            shouldTransform = true;
            targetMode = 'fighter';
          }
        }
      }

      return { shouldTransform, targetMode };
    }

    it('transforms to assault when in fighter mode and only ground enemies', () => {
      const enemies: MockEnemyUnit[] = [
        { isFlying: false, attackDamage: 10, attackSpeed: 1, distance: 5 },
      ];
      const result = calculateTransformDecision(true, enemies);
      expect(result.shouldTransform).toBe(true);
      expect(result.targetMode).toBe('assault');
    });

    it('transforms to fighter when in assault mode and only air enemies', () => {
      const enemies: MockEnemyUnit[] = [
        { isFlying: true, attackDamage: 10, attackSpeed: 1, distance: 5 },
      ];
      const result = calculateTransformDecision(false, enemies);
      expect(result.shouldTransform).toBe(true);
      expect(result.targetMode).toBe('fighter');
    });

    it('does not transform in fighter mode when air enemies present', () => {
      const enemies: MockEnemyUnit[] = [
        { isFlying: true, attackDamage: 10, attackSpeed: 1, distance: 5 },
        { isFlying: false, attackDamage: 10, attackSpeed: 1, distance: 5 },
      ];
      const result = calculateTransformDecision(true, enemies);
      expect(result.shouldTransform).toBe(false);
    });

    it('does not transform in assault mode when ground enemies present', () => {
      const enemies: MockEnemyUnit[] = [
        { isFlying: true, attackDamage: 10, attackSpeed: 1, distance: 5 },
        { isFlying: false, attackDamage: 10, attackSpeed: 1, distance: 5 },
      ];
      const result = calculateTransformDecision(false, enemies);
      expect(result.shouldTransform).toBe(false);
    });

    it('does not transform when no enemies', () => {
      const result = calculateTransformDecision(true, []);
      expect(result.shouldTransform).toBe(false);
    });

    it('transforms to assault when ground threat significantly higher in fighter mode', () => {
      const enemies: MockEnemyUnit[] = [
        { isFlying: true, attackDamage: 5, attackSpeed: 1, distance: 10 },
        { isFlying: false, attackDamage: 20, attackSpeed: 2, distance: 3 },
        { isFlying: false, attackDamage: 20, attackSpeed: 2, distance: 3 },
        { isFlying: false, attackDamage: 20, attackSpeed: 2, distance: 3 },
      ];
      const result = calculateTransformDecision(true, enemies);
      expect(result.shouldTransform).toBe(true);
      expect(result.targetMode).toBe('assault');
    });

    it('transforms to fighter when air threat significantly higher in assault mode', () => {
      const enemies: MockEnemyUnit[] = [
        { isFlying: true, attackDamage: 20, attackSpeed: 2, distance: 3 },
        { isFlying: true, attackDamage: 20, attackSpeed: 2, distance: 3 },
        { isFlying: false, attackDamage: 5, attackSpeed: 1, distance: 10 },
      ];
      const result = calculateTransformDecision(false, enemies);
      expect(result.shouldTransform).toBe(true);
      expect(result.targetMode).toBe('fighter');
    });
  });

  describe('analyzeEnemyComposition', () => {
    interface MockUnit {
      playerId: string;
      unitId: string;
      isWorker: boolean;
      isFlying: boolean;
      isMechanical: boolean;
      isDead: boolean;
    }

    interface EnemyComposition {
      infantry: number;
      vehicles: number;
      air: number;
      workers: number;
      total: number;
    }

    function analyzeEnemyComposition(units: MockUnit[], myPlayerId: string): EnemyComposition {
      const composition: EnemyComposition = {
        infantry: 0,
        vehicles: 0,
        air: 0,
        workers: 0,
        total: 0,
      };

      for (const unit of units) {
        if (unit.playerId === myPlayerId) continue;
        if (unit.isDead) continue;

        composition.total++;

        if (unit.isWorker) {
          composition.workers++;
        } else if (unit.isFlying) {
          composition.air++;
        } else if (unit.isMechanical) {
          composition.vehicles++;
        } else {
          composition.infantry++;
        }
      }

      return composition;
    }

    it('returns zero composition for empty array', () => {
      const comp = analyzeEnemyComposition([], 'player1');
      expect(comp.total).toBe(0);
      expect(comp.infantry).toBe(0);
      expect(comp.vehicles).toBe(0);
      expect(comp.air).toBe(0);
      expect(comp.workers).toBe(0);
    });

    it('excludes own units', () => {
      const units: MockUnit[] = [
        {
          playerId: 'player1',
          unitId: 'trooper',
          isWorker: false,
          isFlying: false,
          isMechanical: false,
          isDead: false,
        },
      ];
      const comp = analyzeEnemyComposition(units, 'player1');
      expect(comp.total).toBe(0);
    });

    it('excludes dead units', () => {
      const units: MockUnit[] = [
        {
          playerId: 'enemy',
          unitId: 'trooper',
          isWorker: false,
          isFlying: false,
          isMechanical: false,
          isDead: true,
        },
      ];
      const comp = analyzeEnemyComposition(units, 'player1');
      expect(comp.total).toBe(0);
    });

    it('categorizes workers correctly', () => {
      const units: MockUnit[] = [
        {
          playerId: 'enemy',
          unitId: 'engineer',
          isWorker: true,
          isFlying: false,
          isMechanical: false,
          isDead: false,
        },
      ];
      const comp = analyzeEnemyComposition(units, 'player1');
      expect(comp.workers).toBe(1);
      expect(comp.total).toBe(1);
    });

    it('categorizes flying units correctly', () => {
      const units: MockUnit[] = [
        {
          playerId: 'enemy',
          unitId: 'valkyrie',
          isWorker: false,
          isFlying: true,
          isMechanical: true,
          isDead: false,
        },
      ];
      const comp = analyzeEnemyComposition(units, 'player1');
      expect(comp.air).toBe(1);
      expect(comp.total).toBe(1);
    });

    it('categorizes mechanical ground units as vehicles', () => {
      const units: MockUnit[] = [
        {
          playerId: 'enemy',
          unitId: 'colossus',
          isWorker: false,
          isFlying: false,
          isMechanical: true,
          isDead: false,
        },
      ];
      const comp = analyzeEnemyComposition(units, 'player1');
      expect(comp.vehicles).toBe(1);
      expect(comp.total).toBe(1);
    });

    it('categorizes non-mechanical ground units as infantry', () => {
      const units: MockUnit[] = [
        {
          playerId: 'enemy',
          unitId: 'trooper',
          isWorker: false,
          isFlying: false,
          isMechanical: false,
          isDead: false,
        },
      ];
      const comp = analyzeEnemyComposition(units, 'player1');
      expect(comp.infantry).toBe(1);
      expect(comp.total).toBe(1);
    });

    it('flying takes precedence over mechanical', () => {
      const units: MockUnit[] = [
        {
          playerId: 'enemy',
          unitId: 'specter',
          isWorker: false,
          isFlying: true,
          isMechanical: true,
          isDead: false,
        },
      ];
      const comp = analyzeEnemyComposition(units, 'player1');
      expect(comp.air).toBe(1);
      expect(comp.vehicles).toBe(0);
    });

    it('worker takes precedence over other categories', () => {
      const units: MockUnit[] = [
        {
          playerId: 'enemy',
          unitId: 'worker',
          isWorker: true,
          isFlying: true,
          isMechanical: false,
          isDead: false,
        },
      ];
      const comp = analyzeEnemyComposition(units, 'player1');
      expect(comp.workers).toBe(1);
      expect(comp.air).toBe(0);
    });

    it('handles mixed composition', () => {
      const units: MockUnit[] = [
        {
          playerId: 'enemy',
          unitId: 'engineer',
          isWorker: true,
          isFlying: false,
          isMechanical: false,
          isDead: false,
        },
        {
          playerId: 'enemy',
          unitId: 'trooper',
          isWorker: false,
          isFlying: false,
          isMechanical: false,
          isDead: false,
        },
        {
          playerId: 'enemy',
          unitId: 'colossus',
          isWorker: false,
          isFlying: false,
          isMechanical: true,
          isDead: false,
        },
        {
          playerId: 'enemy',
          unitId: 'valkyrie',
          isWorker: false,
          isFlying: true,
          isMechanical: true,
          isDead: false,
        },
        {
          playerId: 'enemy',
          unitId: 'dead_trooper',
          isWorker: false,
          isFlying: false,
          isMechanical: false,
          isDead: true,
        },
        {
          playerId: 'player1',
          unitId: 'my_trooper',
          isWorker: false,
          isFlying: false,
          isMechanical: false,
          isDead: false,
        },
      ];
      const comp = analyzeEnemyComposition(units, 'player1');
      expect(comp.total).toBe(4);
      expect(comp.workers).toBe(1);
      expect(comp.infantry).toBe(1);
      expect(comp.vehicles).toBe(1);
      expect(comp.air).toBe(1);
    });
  });

  describe('analyzeThreatGaps', () => {
    interface MockUnit {
      playerId: string;
      isFlying: boolean;
      canAttackAir: boolean;
      isWorker: boolean;
      attackDamage: number;
      attackRange: number;
      x: number;
      y: number;
      isDead: boolean;
    }

    interface ThreatAnalysis {
      uncounterableAirThreats: number;
      unitsUnderAirAttack: number;
      hasAntiAir: boolean;
      antiAirUnitCount: number;
    }

    const THREAT_RANGE = 15;

    function analyzeThreatGaps(units: MockUnit[], myPlayerId: string): ThreatAnalysis {
      const analysis: ThreatAnalysis = {
        uncounterableAirThreats: 0,
        unitsUnderAirAttack: 0,
        hasAntiAir: false,
        antiAirUnitCount: 0,
      };

      const myUnits = units.filter((u) => u.playerId === myPlayerId && !u.isDead);
      const enemyAirUnits = units.filter(
        (u) => u.playerId !== myPlayerId && !u.isDead && u.isFlying && u.attackDamage > 0
      );

      // Count anti-air
      for (const unit of myUnits) {
        if (unit.canAttackAir) {
          analysis.hasAntiAir = true;
          analysis.antiAirUnitCount++;
        }
      }

      // Check for threats to units that can't fight back
      for (const myUnit of myUnits) {
        if (myUnit.canAttackAir) continue;
        if (myUnit.isWorker) continue;

        for (const enemyAir of enemyAirUnits) {
          const dist = distance(myUnit.x, myUnit.y, enemyAir.x, enemyAir.y);
          if (dist <= THREAT_RANGE) {
            if (dist <= enemyAir.attackRange * 1.5) {
              analysis.unitsUnderAirAttack++;
              analysis.uncounterableAirThreats++;
              break;
            }
          }
        }
      }

      return analysis;
    }

    it('detects anti-air capability', () => {
      const units: MockUnit[] = [
        {
          playerId: 'player1',
          isFlying: false,
          canAttackAir: true,
          isWorker: false,
          attackDamage: 10,
          attackRange: 5,
          x: 10,
          y: 10,
          isDead: false,
        },
      ];
      const analysis = analyzeThreatGaps(units, 'player1');
      expect(analysis.hasAntiAir).toBe(true);
      expect(analysis.antiAirUnitCount).toBe(1);
    });

    it('detects lack of anti-air', () => {
      const units: MockUnit[] = [
        {
          playerId: 'player1',
          isFlying: false,
          canAttackAir: false,
          isWorker: false,
          attackDamage: 10,
          attackRange: 5,
          x: 10,
          y: 10,
          isDead: false,
        },
      ];
      const analysis = analyzeThreatGaps(units, 'player1');
      expect(analysis.hasAntiAir).toBe(false);
      expect(analysis.antiAirUnitCount).toBe(0);
    });

    it('detects uncounterable air threats', () => {
      const units: MockUnit[] = [
        {
          playerId: 'player1',
          isFlying: false,
          canAttackAir: false,
          isWorker: false,
          attackDamage: 10,
          attackRange: 2,
          x: 10,
          y: 10,
          isDead: false,
        },
        {
          playerId: 'enemy',
          isFlying: true,
          canAttackAir: true,
          isWorker: false,
          attackDamage: 15,
          attackRange: 5,
          x: 15,
          y: 10,
          isDead: false,
        },
      ];
      const analysis = analyzeThreatGaps(units, 'player1');
      expect(analysis.uncounterableAirThreats).toBeGreaterThan(0);
      expect(analysis.unitsUnderAirAttack).toBeGreaterThan(0);
    });

    it('no threats when air is outside range', () => {
      const units: MockUnit[] = [
        {
          playerId: 'player1',
          isFlying: false,
          canAttackAir: false,
          isWorker: false,
          attackDamage: 10,
          attackRange: 2,
          x: 10,
          y: 10,
          isDead: false,
        },
        {
          playerId: 'enemy',
          isFlying: true,
          canAttackAir: true,
          isWorker: false,
          attackDamage: 15,
          attackRange: 5,
          x: 100,
          y: 100,
          isDead: false,
        },
      ];
      const analysis = analyzeThreatGaps(units, 'player1');
      expect(analysis.uncounterableAirThreats).toBe(0);
    });

    it('no threats for workers', () => {
      const units: MockUnit[] = [
        {
          playerId: 'player1',
          isFlying: false,
          canAttackAir: false,
          isWorker: true,
          attackDamage: 5,
          attackRange: 1,
          x: 10,
          y: 10,
          isDead: false,
        },
        {
          playerId: 'enemy',
          isFlying: true,
          canAttackAir: true,
          isWorker: false,
          attackDamage: 15,
          attackRange: 5,
          x: 12,
          y: 10,
          isDead: false,
        },
      ];
      const analysis = analyzeThreatGaps(units, 'player1');
      expect(analysis.unitsUnderAirAttack).toBe(0);
    });

    it('no threats from dead enemy air', () => {
      const units: MockUnit[] = [
        {
          playerId: 'player1',
          isFlying: false,
          canAttackAir: false,
          isWorker: false,
          attackDamage: 10,
          attackRange: 2,
          x: 10,
          y: 10,
          isDead: false,
        },
        {
          playerId: 'enemy',
          isFlying: true,
          canAttackAir: true,
          isWorker: false,
          attackDamage: 15,
          attackRange: 5,
          x: 12,
          y: 10,
          isDead: true,
        },
      ];
      const analysis = analyzeThreatGaps(units, 'player1');
      expect(analysis.uncounterableAirThreats).toBe(0);
    });
  });

  describe('getCounterRecommendation', () => {
    interface EnemyComposition {
      infantry: number;
      vehicles: number;
      air: number;
      workers: number;
      total: number;
    }

    interface ThreatAnalysis {
      uncounterableAirThreats: number;
      hasAntiAir: boolean;
    }

    interface CounterRecommendation {
      unitsToBuild: Array<{ unitId: string; priority: number }>;
      buildingsToBuild: Array<{ buildingId: string; priority: number }>;
    }

    function getCounterRecommendation(
      enemyComp: EnemyComposition,
      threatGaps: ThreatAnalysis,
      myBuildingCounts: Map<string, number>
    ): CounterRecommendation {
      const recommendation: CounterRecommendation = {
        unitsToBuild: [],
        buildingsToBuild: [],
      };

      // URGENT: Being attacked by air units we can't hit
      if (threatGaps.uncounterableAirThreats > 0 || (enemyComp.air > 0 && !threatGaps.hasAntiAir)) {
        const urgency = Math.min(15, 10 + threatGaps.uncounterableAirThreats);
        recommendation.unitsToBuild.push({ unitId: 'trooper', priority: urgency });
        recommendation.unitsToBuild.push({ unitId: 'valkyrie', priority: urgency - 1 });
        recommendation.unitsToBuild.push({ unitId: 'colossus', priority: urgency - 2 });
        recommendation.unitsToBuild.push({ unitId: 'specter', priority: urgency - 3 });

        if (!myBuildingCounts.get('hangar')) {
          recommendation.buildingsToBuild.push({ buildingId: 'hangar', priority: urgency });
        }
        if (!myBuildingCounts.get('infantry_bay')) {
          recommendation.buildingsToBuild.push({
            buildingId: 'infantry_bay',
            priority: urgency - 1,
          });
        }
      }

      // Heavy air
      if (enemyComp.air > enemyComp.total * 0.3) {
        recommendation.unitsToBuild.push({ unitId: 'valkyrie', priority: 10 });
        recommendation.unitsToBuild.push({ unitId: 'trooper', priority: 8 });
        recommendation.unitsToBuild.push({ unitId: 'colossus', priority: 7 });

        if (!myBuildingCounts.get('hangar')) {
          recommendation.buildingsToBuild.push({ buildingId: 'hangar', priority: 10 });
        }
      }

      // Heavy vehicles
      if (enemyComp.vehicles > enemyComp.total * 0.4) {
        recommendation.unitsToBuild.push({ unitId: 'devastator', priority: 10 });
        recommendation.unitsToBuild.push({ unitId: 'breacher', priority: 8 });

        if (!myBuildingCounts.get('forge')) {
          recommendation.buildingsToBuild.push({ buildingId: 'forge', priority: 10 });
        }
      }

      // Heavy infantry
      if (enemyComp.infantry > enemyComp.total * 0.5) {
        recommendation.unitsToBuild.push({ unitId: 'scorcher', priority: 9 });
        recommendation.unitsToBuild.push({ unitId: 'inferno', priority: 8 });
        recommendation.unitsToBuild.push({ unitId: 'devastator', priority: 7 });
      }

      // Balanced (no specific counter)
      if (recommendation.unitsToBuild.length === 0) {
        recommendation.unitsToBuild.push({ unitId: 'trooper', priority: 7 });
        recommendation.unitsToBuild.push({ unitId: 'breacher', priority: 6 });
        recommendation.unitsToBuild.push({ unitId: 'lifter', priority: 5 });
      }

      // Sort and deduplicate
      const seenUnits = new Set<string>();
      recommendation.unitsToBuild.sort((a, b) => b.priority - a.priority);
      recommendation.unitsToBuild = recommendation.unitsToBuild.filter((u) => {
        if (seenUnits.has(u.unitId)) return false;
        seenUnits.add(u.unitId);
        return true;
      });

      const seenBuildings = new Set<string>();
      recommendation.buildingsToBuild.sort((a, b) => b.priority - a.priority);
      recommendation.buildingsToBuild = recommendation.buildingsToBuild.filter((b) => {
        if (seenBuildings.has(b.buildingId)) return false;
        seenBuildings.add(b.buildingId);
        return true;
      });

      return recommendation;
    }

    it('recommends anti-air when air threats are uncounterable', () => {
      const enemyComp: EnemyComposition = {
        infantry: 0,
        vehicles: 0,
        air: 5,
        workers: 0,
        total: 5,
      };
      const threatGaps: ThreatAnalysis = { uncounterableAirThreats: 3, hasAntiAir: false };
      const buildings = new Map<string, number>();

      const rec = getCounterRecommendation(enemyComp, threatGaps, buildings);

      const unitIds = rec.unitsToBuild.map((u) => u.unitId);
      expect(unitIds).toContain('trooper');
      expect(unitIds).toContain('valkyrie');
    });

    it('recommends hangar when air units needed and missing', () => {
      const enemyComp: EnemyComposition = {
        infantry: 0,
        vehicles: 0,
        air: 5,
        workers: 0,
        total: 5,
      };
      const threatGaps: ThreatAnalysis = { uncounterableAirThreats: 3, hasAntiAir: false };
      const buildings = new Map<string, number>();

      const rec = getCounterRecommendation(enemyComp, threatGaps, buildings);

      const buildingIds = rec.buildingsToBuild.map((b) => b.buildingId);
      expect(buildingIds).toContain('hangar');
    });

    it('does not recommend hangar if already have one', () => {
      const enemyComp: EnemyComposition = {
        infantry: 0,
        vehicles: 0,
        air: 5,
        workers: 0,
        total: 5,
      };
      const threatGaps: ThreatAnalysis = { uncounterableAirThreats: 3, hasAntiAir: false };
      const buildings = new Map<string, number>([['hangar', 1]]);

      const rec = getCounterRecommendation(enemyComp, threatGaps, buildings);

      const buildingIds = rec.buildingsToBuild.map((b) => b.buildingId);
      expect(buildingIds).not.toContain('hangar');
    });

    it('recommends anti-vehicle for heavy vehicle composition', () => {
      const enemyComp: EnemyComposition = {
        infantry: 1,
        vehicles: 8,
        air: 0,
        workers: 1,
        total: 10,
      };
      const threatGaps: ThreatAnalysis = { uncounterableAirThreats: 0, hasAntiAir: true };
      const buildings = new Map<string, number>();

      const rec = getCounterRecommendation(enemyComp, threatGaps, buildings);

      const unitIds = rec.unitsToBuild.map((u) => u.unitId);
      expect(unitIds).toContain('devastator');
      expect(unitIds).toContain('breacher');
    });

    it('recommends anti-infantry for heavy infantry composition', () => {
      const enemyComp: EnemyComposition = {
        infantry: 8,
        vehicles: 1,
        air: 0,
        workers: 1,
        total: 10,
      };
      const threatGaps: ThreatAnalysis = { uncounterableAirThreats: 0, hasAntiAir: true };
      const buildings = new Map<string, number>();

      const rec = getCounterRecommendation(enemyComp, threatGaps, buildings);

      const unitIds = rec.unitsToBuild.map((u) => u.unitId);
      expect(unitIds).toContain('scorcher');
      expect(unitIds).toContain('inferno');
    });

    it('recommends balanced units for balanced enemy composition', () => {
      const enemyComp: EnemyComposition = {
        infantry: 3,
        vehicles: 3,
        air: 3,
        workers: 1,
        total: 10,
      };
      const threatGaps: ThreatAnalysis = { uncounterableAirThreats: 0, hasAntiAir: true };
      const buildings = new Map<string, number>([['hangar', 1]]);

      const rec = getCounterRecommendation(enemyComp, threatGaps, buildings);

      expect(rec.unitsToBuild.length).toBeGreaterThan(0);
    });

    it('sorts units by priority (highest first)', () => {
      const enemyComp: EnemyComposition = {
        infantry: 0,
        vehicles: 0,
        air: 5,
        workers: 0,
        total: 5,
      };
      const threatGaps: ThreatAnalysis = { uncounterableAirThreats: 3, hasAntiAir: false };
      const buildings = new Map<string, number>();

      const rec = getCounterRecommendation(enemyComp, threatGaps, buildings);

      for (let i = 1; i < rec.unitsToBuild.length; i++) {
        expect(rec.unitsToBuild[i - 1].priority).toBeGreaterThanOrEqual(
          rec.unitsToBuild[i].priority
        );
      }
    });

    it('removes duplicate unit recommendations (keeps highest priority)', () => {
      const enemyComp: EnemyComposition = {
        infantry: 0,
        vehicles: 0,
        air: 5,
        workers: 0,
        total: 5,
      };
      const threatGaps: ThreatAnalysis = { uncounterableAirThreats: 3, hasAntiAir: false };
      const buildings = new Map<string, number>();

      const rec = getCounterRecommendation(enemyComp, threatGaps, buildings);

      const unitIds = rec.unitsToBuild.map((u) => u.unitId);
      const uniqueIds = new Set(unitIds);
      expect(unitIds.length).toBe(uniqueIds.size);
    });

    it('urgency caps at 15', () => {
      const enemyComp: EnemyComposition = {
        infantry: 0,
        vehicles: 0,
        air: 20,
        workers: 0,
        total: 20,
      };
      const threatGaps: ThreatAnalysis = { uncounterableAirThreats: 10, hasAntiAir: false };
      const buildings = new Map<string, number>();

      const rec = getCounterRecommendation(enemyComp, threatGaps, buildings);

      for (const unit of rec.unitsToBuild) {
        expect(unit.priority).toBeLessThanOrEqual(15);
      }
    });
  });

  describe('unit priority values', () => {
    it('operative has highest priority', () => {
      expect(UNIT_PRIORITY['operative']).toBeGreaterThan(UNIT_PRIORITY['trooper']);
      expect(UNIT_PRIORITY['operative']).toBeGreaterThan(UNIT_PRIORITY['colossus']);
    });

    it('workers have lowest priority', () => {
      expect(UNIT_PRIORITY['worker']).toBeLessThan(UNIT_PRIORITY['trooper']);
    });

    it('high-value units have high priority', () => {
      expect(UNIT_PRIORITY['specter']).toBeGreaterThan(UNIT_PRIORITY['trooper']);
      expect(UNIT_PRIORITY['valkyrie']).toBeGreaterThan(UNIT_PRIORITY['trooper']);
      expect(UNIT_PRIORITY['colossus']).toBeGreaterThan(UNIT_PRIORITY['trooper']);
    });

    it('all defined units have priorities between 0 and 100', () => {
      for (const [_unitId, priority] of Object.entries(UNIT_PRIORITY)) {
        expect(priority).toBeGreaterThanOrEqual(0);
        expect(priority).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('kite cooldown', () => {
    it('KITE_COOLDOWN_TICKS is 10', () => {
      expect(KITE_COOLDOWN_TICKS).toBe(10);
    });

    interface MockState {
      lastKiteTick: number;
    }

    function canKite(state: MockState, currentTick: number): boolean {
      return currentTick - state.lastKiteTick > KITE_COOLDOWN_TICKS;
    }

    it('cannot kite immediately after kiting', () => {
      const state: MockState = { lastKiteTick: 100 };
      expect(canKite(state, 105)).toBe(false);
    });

    it('can kite after cooldown', () => {
      const state: MockState = { lastKiteTick: 100 };
      expect(canKite(state, 111)).toBe(true);
    });

    it('cannot kite at exactly cooldown ticks', () => {
      const state: MockState = { lastKiteTick: 100 };
      expect(canKite(state, 110)).toBe(false);
    });

    it('can kite from initial state', () => {
      const state: MockState = { lastKiteTick: 0 };
      expect(canKite(state, 100)).toBe(true);
    });
  });
});

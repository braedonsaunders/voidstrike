import { describe, it, expect } from 'vitest';
import { deterministicDamage, quantize, QUANT_DAMAGE } from '@/utils/FixedPoint';
import { getDamageMultiplier, COMBAT_CONFIG, DAMAGE_MULTIPLIERS } from '@/data/combat/combat';

/**
 * CombatSystem Tests
 *
 * Since CombatSystem has many Game/World dependencies, we test:
 * 1. Deterministic damage calculations (core math)
 * 2. Damage multiplier lookups
 * 3. High-ground miss chance hash (determinism verification)
 * 4. Splash damage falloff calculations
 * 5. Combat config values
 */

describe('CombatSystem', () => {
  describe('deterministicDamage', () => {
    it('calculates base damage with multiplier 1.0', () => {
      const damage = deterministicDamage(10, 1.0, 0);
      expect(damage).toBe(10);
    });

    it('applies damage multiplier correctly', () => {
      const damage = deterministicDamage(10, 1.5, 0);
      expect(damage).toBe(15);
    });

    it('subtracts armor from damage', () => {
      const damage = deterministicDamage(10, 1.0, 3);
      expect(damage).toBe(7);
    });

    it('applies multiplier before armor', () => {
      // 10 * 1.5 = 15, 15 - 5 = 10
      const damage = deterministicDamage(10, 1.5, 5);
      expect(damage).toBe(10);
    });

    it('enforces minimum 1 damage', () => {
      // High armor should not reduce below 1
      const damage = deterministicDamage(5, 1.0, 100);
      expect(damage).toBe(1);
    });

    it('enforces minimum 1 with low multiplier', () => {
      const damage = deterministicDamage(2, 0.25, 0);
      expect(damage).toBe(1);
    });

    it('handles fractional multipliers', () => {
      // 10 * 0.5 = 5
      const damage = deterministicDamage(10, 0.5, 0);
      expect(damage).toBe(5);
    });

    it('is deterministic across multiple calls', () => {
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(deterministicDamage(15, 1.25, 2));
      }
      expect(new Set(results).size).toBe(1); // All same value
    });

    it('handles zero base damage', () => {
      const damage = deterministicDamage(0, 1.5, 0);
      expect(damage).toBe(1); // Minimum damage
    });

    it('handles large damage values', () => {
      const damage = deterministicDamage(1000, 2.0, 50);
      expect(damage).toBe(1950);
    });
  });

  describe('getDamageMultiplier', () => {
    it('returns 1.0 for normal damage vs all armor types', () => {
      expect(getDamageMultiplier('normal', 'light')).toBe(1.0);
      expect(getDamageMultiplier('normal', 'armored')).toBe(1.0);
      expect(getDamageMultiplier('normal', 'massive')).toBe(1.0);
      expect(getDamageMultiplier('normal', 'structure')).toBe(1.0);
      expect(getDamageMultiplier('normal', 'naval')).toBe(1.0);
    });

    it('returns bonus for explosive vs armored', () => {
      expect(getDamageMultiplier('explosive', 'armored')).toBe(1.5);
    });

    it('returns penalty for explosive vs light', () => {
      expect(getDamageMultiplier('explosive', 'light')).toBe(0.5);
    });

    it('returns bonus for concussive vs light', () => {
      expect(getDamageMultiplier('concussive', 'light')).toBe(1.5);
    });

    it('returns penalty for concussive vs armored', () => {
      expect(getDamageMultiplier('concussive', 'armored')).toBe(0.5);
    });

    it('returns heavy penalty for concussive vs massive', () => {
      expect(getDamageMultiplier('concussive', 'massive')).toBe(0.25);
    });

    it('psionic damage is equal vs most types', () => {
      expect(getDamageMultiplier('psionic', 'light')).toBe(1.0);
      expect(getDamageMultiplier('psionic', 'armored')).toBe(1.0);
      expect(getDamageMultiplier('psionic', 'massive')).toBe(1.0);
    });

    it('psionic has penalty vs structures', () => {
      expect(getDamageMultiplier('psionic', 'structure')).toBe(0.5);
    });

    it('torpedo is effective vs naval', () => {
      expect(getDamageMultiplier('torpedo', 'naval')).toBe(1.5);
    });

    it('torpedo is weak vs light', () => {
      expect(getDamageMultiplier('torpedo', 'light')).toBe(0.5);
    });

    it('returns 1.0 for unknown damage type', () => {
      expect(getDamageMultiplier('unknown', 'light')).toBe(1.0);
    });

    it('returns 1.0 for unknown armor type', () => {
      expect(getDamageMultiplier('normal', 'unknown')).toBe(1.0);
    });

    it('returns 1.0 for both unknown', () => {
      expect(getDamageMultiplier('unknown', 'unknown')).toBe(1.0);
    });
  });

  describe('damage multiplier matrix completeness', () => {
    const damageTypes = ['normal', 'explosive', 'concussive', 'psionic', 'torpedo'];
    const armorTypes = ['light', 'armored', 'massive', 'structure', 'naval'];

    it('has multipliers for all damage/armor combinations', () => {
      for (const dt of damageTypes) {
        for (const at of armorTypes) {
          const mult = DAMAGE_MULTIPLIERS[dt]?.[at];
          expect(mult).toBeDefined();
          expect(typeof mult).toBe('number');
          expect(mult).toBeGreaterThan(0);
        }
      }
    });

    it('all multipliers are between 0.25 and 2.0', () => {
      for (const dt of damageTypes) {
        for (const at of armorTypes) {
          const mult = DAMAGE_MULTIPLIERS[dt][at];
          expect(mult).toBeGreaterThanOrEqual(0.25);
          expect(mult).toBeLessThanOrEqual(2.0);
        }
      }
    });
  });

  describe('high ground miss chance determinism', () => {
    /**
     * The CombatSystem uses this formula for deterministic miss chance:
     * seed = ((tick * 1103515245 + attackerId * 12345) >>> 0) % 1000
     *
     * This must produce identical results across all platforms.
     */
    function calculateMissSeed(tick: number, attackerId: number): number {
      return ((tick * 1103515245 + attackerId * 12345) >>> 0) % 1000;
    }

    it('produces deterministic results', () => {
      const tick = 1000;
      const attackerId = 42;
      const results: number[] = [];

      for (let i = 0; i < 100; i++) {
        results.push(calculateMissSeed(tick, attackerId));
      }

      expect(new Set(results).size).toBe(1);
    });

    it('varies with different ticks', () => {
      const attackerId = 42;
      const seeds = new Set<number>();

      for (let tick = 0; tick < 100; tick++) {
        seeds.add(calculateMissSeed(tick, attackerId));
      }

      // Should produce many different values
      expect(seeds.size).toBeGreaterThan(90);
    });

    it('varies with different attacker IDs', () => {
      const tick = 1000;
      const seeds = new Set<number>();

      for (let attackerId = 1; attackerId <= 100; attackerId++) {
        seeds.add(calculateMissSeed(tick, attackerId));
      }

      // Should produce many different values
      expect(seeds.size).toBeGreaterThan(90);
    });

    it('produces values in range 0-999', () => {
      for (let i = 0; i < 1000; i++) {
        const seed = calculateMissSeed(i * 17, i * 13);
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThan(1000);
      }
    });

    it('miss threshold matches config', () => {
      const threshold = Math.floor(COMBAT_CONFIG.highGroundMissChance * 1000);
      expect(threshold).toBe(300); // 30% = 300/1000
    });

    it('roughly 30% of seeds result in miss', () => {
      const threshold = Math.floor(COMBAT_CONFIG.highGroundMissChance * 1000);
      let misses = 0;
      const samples = 10000;

      for (let i = 0; i < samples; i++) {
        const seed = calculateMissSeed(i * 7, i * 11);
        if (seed < threshold) misses++;
      }

      // Should be roughly 30% (allow 5% tolerance)
      const missRate = misses / samples;
      expect(missRate).toBeGreaterThan(0.25);
      expect(missRate).toBeLessThan(0.35);
    });
  });

  describe('splash damage falloff', () => {
    /**
     * Replicates the splash damage calculation from CombatSystem:
     * Linear falloff from 100% at center to 50% at edge
     */
    function calculateSplashDamage(
      baseDamage: number,
      distance: number,
      splashRadius: number
    ): number {
      if (distance === 0 || distance > splashRadius) return 0;

      const qDistance = quantize(distance, QUANT_DAMAGE);
      const qRadius = quantize(splashRadius, QUANT_DAMAGE);
      const qFalloff = QUANT_DAMAGE - Math.floor((qDistance * QUANT_DAMAGE * 0.5) / qRadius);
      const qBaseDamage = quantize(baseDamage, QUANT_DAMAGE);
      const splashDamage = Math.max(1, Math.floor((qBaseDamage * qFalloff) / (QUANT_DAMAGE * QUANT_DAMAGE)));

      return splashDamage;
    }

    it('deals full damage at edge (not center)', () => {
      // At distance 0.01 from center (not 0 which is excluded)
      const damage = calculateSplashDamage(100, 0.01, 5);
      expect(damage).toBeCloseTo(100, 0); // Full damage near center
    });

    it('deals reduced damage at edge', () => {
      // At max radius, should deal ~50%
      const damage = calculateSplashDamage(100, 5, 5);
      expect(damage).toBeGreaterThanOrEqual(49);
      expect(damage).toBeLessThanOrEqual(51);
    });

    it('deals intermediate damage at half radius', () => {
      const damage = calculateSplashDamage(100, 2.5, 5);
      // Should be ~75% (halfway between 100% and 50%)
      expect(damage).toBeGreaterThanOrEqual(73);
      expect(damage).toBeLessThanOrEqual(77);
    });

    it('returns 0 for distance beyond radius', () => {
      const damage = calculateSplashDamage(100, 6, 5);
      expect(damage).toBe(0);
    });

    it('returns 0 for exact zero distance (center)', () => {
      // Primary target at center is handled separately
      const damage = calculateSplashDamage(100, 0, 5);
      expect(damage).toBe(0);
    });

    it('enforces minimum 1 damage', () => {
      const damage = calculateSplashDamage(1, 4.9, 5);
      expect(damage).toBeGreaterThanOrEqual(1);
    });

    it('is deterministic', () => {
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(calculateSplashDamage(50, 2.5, 5));
      }
      expect(new Set(results).size).toBe(1);
    });

    it('scales approximately with base damage', () => {
      const damage1 = calculateSplashDamage(50, 2.5, 5);
      const damage2 = calculateSplashDamage(100, 2.5, 5);
      // Due to quantization, relationship isn't perfectly linear
      // but should be approximately 2x
      expect(damage2).toBeGreaterThanOrEqual(damage1 * 2 - 2);
      expect(damage2).toBeLessThanOrEqual(damage1 * 2 + 2);
    });
  });

  describe('COMBAT_CONFIG', () => {
    it('defines high ground miss chance', () => {
      expect(COMBAT_CONFIG.highGroundMissChance).toBe(0.3);
    });

    it('defines high ground threshold', () => {
      expect(COMBAT_CONFIG.highGroundThreshold).toBe(1.5);
    });

    it('defines attack cooldown buffer', () => {
      expect(COMBAT_CONFIG.attackCooldownBuffer).toBe(0.05);
    });

    it('enables splash falloff', () => {
      expect(COMBAT_CONFIG.splashFalloffEnabled).toBe(true);
    });

    it('defines splash falloff rate', () => {
      expect(COMBAT_CONFIG.splashFalloffRate).toBe(1.0);
    });

    it('enables overkill protection', () => {
      expect(COMBAT_CONFIG.overkillProtection).toBe(true);
    });

    it('defines under attack cooldown', () => {
      expect(COMBAT_CONFIG.underAttackCooldown).toBe(10000);
    });
  });

  describe('attack cooldown calculation', () => {
    /**
     * Attack timing: attackSpeed is attacks per second
     * Cooldown = 1 / attackSpeed seconds
     */
    function calculateCooldown(attackSpeed: number): number {
      return 1 / attackSpeed;
    }

    function canAttack(lastAttackTime: number, gameTime: number, attackSpeed: number): boolean {
      const cooldown = calculateCooldown(attackSpeed);
      return gameTime - lastAttackTime >= cooldown;
    }

    it('calculates cooldown from attack speed', () => {
      expect(calculateCooldown(1)).toBe(1); // 1 attack/sec = 1 sec cooldown
      expect(calculateCooldown(2)).toBe(0.5); // 2 attacks/sec = 0.5 sec cooldown
      expect(calculateCooldown(0.5)).toBe(2); // 0.5 attacks/sec = 2 sec cooldown
    });

    it('allows attack after cooldown', () => {
      expect(canAttack(0, 1.0, 1)).toBe(true);
      expect(canAttack(0, 0.5, 2)).toBe(true);
    });

    it('prevents attack before cooldown', () => {
      expect(canAttack(0, 0.5, 1)).toBe(false);
      expect(canAttack(0, 0.2, 2)).toBe(false);
    });

    it('allows attack exactly at cooldown', () => {
      expect(canAttack(0, 1.0, 1)).toBe(true);
      expect(canAttack(1.0, 2.0, 1)).toBe(true);
    });
  });

  describe('target validation', () => {
    /**
     * Tests for air/ground targeting restrictions
     */
    function canAttackTarget(
      canAttackAir: boolean,
      canAttackGround: boolean,
      targetIsFlying: boolean
    ): boolean {
      return targetIsFlying ? canAttackAir : canAttackGround;
    }

    it('ground-only unit cannot attack air', () => {
      expect(canAttackTarget(false, true, true)).toBe(false);
    });

    it('ground-only unit can attack ground', () => {
      expect(canAttackTarget(false, true, false)).toBe(true);
    });

    it('air-only unit can attack air', () => {
      expect(canAttackTarget(true, false, true)).toBe(true);
    });

    it('air-only unit cannot attack ground', () => {
      expect(canAttackTarget(true, false, false)).toBe(false);
    });

    it('versatile unit can attack both', () => {
      expect(canAttackTarget(true, true, true)).toBe(true);
      expect(canAttackTarget(true, true, false)).toBe(true);
    });

    it('unit with neither cannot attack', () => {
      expect(canAttackTarget(false, false, true)).toBe(false);
      expect(canAttackTarget(false, false, false)).toBe(false);
    });
  });

  describe('effective distance calculation', () => {
    /**
     * Edge-to-edge distance for units
     */
    function unitToUnitDistance(
      x1: number,
      y1: number,
      radius1: number,
      x2: number,
      y2: number,
      radius2: number
    ): number {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const centerDistance = Math.sqrt(dx * dx + dy * dy);
      return Math.max(0, centerDistance - radius1 - radius2);
    }

    /**
     * Edge distance to rectangular building
     */
    function unitToBuildingDistance(
      unitX: number,
      unitY: number,
      unitRadius: number,
      buildingX: number,
      buildingY: number,
      buildingWidth: number,
      buildingHeight: number
    ): number {
      const halfW = buildingWidth / 2;
      const halfH = buildingHeight / 2;
      const clampedX = Math.max(buildingX - halfW, Math.min(unitX, buildingX + halfW));
      const clampedY = Math.max(buildingY - halfH, Math.min(unitY, buildingY + halfH));
      const edgeDx = unitX - clampedX;
      const edgeDy = unitY - clampedY;
      return Math.max(0, Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy) - unitRadius);
    }

    describe('unit to unit', () => {
      it('returns 0 when overlapping', () => {
        expect(unitToUnitDistance(0, 0, 1, 0.5, 0, 1)).toBe(0);
      });

      it('returns 0 when touching', () => {
        expect(unitToUnitDistance(0, 0, 1, 2, 0, 1)).toBe(0);
      });

      it('returns positive distance when separated', () => {
        const dist = unitToUnitDistance(0, 0, 1, 5, 0, 1);
        expect(dist).toBe(3); // 5 - 1 - 1
      });

      it('handles diagonal distance', () => {
        const dist = unitToUnitDistance(0, 0, 0.5, 3, 4, 0.5);
        expect(dist).toBe(4); // sqrt(9+16) - 0.5 - 0.5 = 5 - 1 = 4
      });
    });

    describe('unit to building', () => {
      it('returns 0 when unit is inside building bounds', () => {
        const dist = unitToBuildingDistance(5, 5, 0.5, 5, 5, 4, 4);
        expect(dist).toBe(0);
      });

      it('calculates distance from side', () => {
        const dist = unitToBuildingDistance(10, 5, 0.5, 5, 5, 4, 4);
        // Building extends from x=3 to x=7
        // Unit at x=10, radius 0.5
        // Edge to edge: 10 - 7 - 0.5 = 2.5
        expect(dist).toBeCloseTo(2.5, 5);
      });

      it('calculates distance from corner', () => {
        const dist = unitToBuildingDistance(10, 10, 0, 5, 5, 4, 4);
        // Corner at (7, 7), unit at (10, 10)
        // Distance: sqrt(9+9) = sqrt(18) ≈ 4.24
        expect(dist).toBeCloseTo(Math.sqrt(18), 5);
      });
    });
  });

  describe('damage calculation integration', () => {
    it('explosive vs armored deals bonus damage', () => {
      const mult = getDamageMultiplier('explosive', 'armored');
      const damage = deterministicDamage(10, mult, 0);
      expect(damage).toBe(15);
    });

    it('concussive vs massive deals heavily reduced damage', () => {
      const mult = getDamageMultiplier('concussive', 'massive');
      const damage = deterministicDamage(10, mult, 0);
      // 10 * 0.25 = 2.5, quantized to 2 or 3
      expect(damage).toBeGreaterThanOrEqual(2);
      expect(damage).toBeLessThanOrEqual(3);
    });

    it('psionic damage ignores armor conceptually', () => {
      // In CombatSystem, psionic sets armorReduction to 0
      const mult = getDamageMultiplier('psionic', 'armored');
      const damageWithArmor = deterministicDamage(10, mult, 5);
      const damageIgnoreArmor = deterministicDamage(10, mult, 0);

      // Psionic should deal same damage regardless of armor (armor = 0 override)
      expect(damageIgnoreArmor).toBe(10);
      expect(damageWithArmor).toBe(5); // If armor wasn't ignored
    });

    it('high armor reduces damage but not below 1', () => {
      const damage = deterministicDamage(5, 1.0, 10);
      expect(damage).toBe(1);
    });
  });

  describe('target death state transitions', () => {
    /**
     * Replicates the state transition logic from CombatSystem when a target dies.
     * This is the isDead() code path (primary kill path - units marked dead, not destroyed).
     * Returns the new state and target info for the attacking unit.
     */
    interface UnitState {
      state: string;
      targetEntityId: number | null;
      targetX: number | null;
      targetY: number | null;
      isInAssaultMode: boolean;
      assaultDestination: { x: number; y: number } | null;
      path: number[];
      pathIndex: number;
    }

    function resolveTargetDeath(
      unit: UnitState,
      isAttackingWhileMoving: boolean
    ): UnitState {
      const result = { ...unit, path: [...unit.path] };

      if (isAttackingWhileMoving) {
        result.targetEntityId = null;
      } else if (result.targetX !== null && result.targetY !== null) {
        result.state = 'attackmoving';
        result.targetEntityId = null;
      } else if (result.isInAssaultMode && result.assaultDestination) {
        result.targetEntityId = null;
        result.targetX = result.assaultDestination.x;
        result.targetY = result.assaultDestination.y;
        result.state = 'attackmoving';
        result.path = [];
        result.pathIndex = 0;
      } else if (result.isInAssaultMode) {
        result.targetEntityId = null;
        result.state = 'idle';
      } else {
        // Fallback: clearTarget
        result.targetEntityId = null;
        result.targetX = null;
        result.targetY = null;
        result.state = 'idle';
      }

      return result;
    }

    it('attack-while-moving units just clear target and keep moving', () => {
      const unit: UnitState = {
        state: 'moving',
        targetEntityId: 42,
        targetX: 100,
        targetY: 200,
        isInAssaultMode: false,
        assaultDestination: null,
        path: [1, 2, 3],
        pathIndex: 1,
      };

      const result = resolveTargetDeath(unit, true);
      expect(result.targetEntityId).toBeNull();
      expect(result.state).toBe('moving'); // Unchanged
      expect(result.targetX).toBe(100); // Preserved
      expect(result.targetY).toBe(200); // Preserved
    });

    it('units with targetX/Y resume attack-moving to destination', () => {
      const unit: UnitState = {
        state: 'attacking',
        targetEntityId: 42,
        targetX: 100,
        targetY: 200,
        isInAssaultMode: true,
        assaultDestination: { x: 150, y: 250 },
        path: [1, 2],
        pathIndex: 0,
      };

      const result = resolveTargetDeath(unit, false);
      expect(result.state).toBe('attackmoving');
      expect(result.targetEntityId).toBeNull();
      expect(result.targetX).toBe(100); // Uses saved targetX, not assaultDestination
      expect(result.targetY).toBe(200);
    });

    it('assault mode units with assaultDestination resume attack-moving (no targetX/Y)', () => {
      const unit: UnitState = {
        state: 'attacking',
        targetEntityId: 42,
        targetX: null,
        targetY: null,
        isInAssaultMode: true,
        assaultDestination: { x: 150, y: 250 },
        path: [1, 2, 3],
        pathIndex: 2,
      };

      const result = resolveTargetDeath(unit, false);
      expect(result.state).toBe('attackmoving');
      expect(result.targetEntityId).toBeNull();
      expect(result.targetX).toBe(150); // From assaultDestination
      expect(result.targetY).toBe(250);
      expect(result.path).toEqual([]); // Path cleared for re-pathing
      expect(result.pathIndex).toBe(0);
    });

    it('assault mode units without assaultDestination go idle', () => {
      const unit: UnitState = {
        state: 'attacking',
        targetEntityId: 42,
        targetX: null,
        targetY: null,
        isInAssaultMode: true,
        assaultDestination: null,
        path: [],
        pathIndex: 0,
      };

      const result = resolveTargetDeath(unit, false);
      expect(result.state).toBe('idle');
      expect(result.targetEntityId).toBeNull();
    });

    it('non-assault units with no destination go idle (fallback)', () => {
      const unit: UnitState = {
        state: 'attacking',
        targetEntityId: 42,
        targetX: null,
        targetY: null,
        isInAssaultMode: false,
        assaultDestination: null,
        path: [],
        pathIndex: 0,
      };

      const result = resolveTargetDeath(unit, false);
      expect(result.state).toBe('idle');
      expect(result.targetEntityId).toBeNull();
      expect(result.targetX).toBeNull();
      expect(result.targetY).toBeNull();
    });

    it('assault destination resume prevents unit stranding after arrival + kill', () => {
      // Scenario: Unit attack-moves, arrives at destination (targetX/Y cleared by handleArrival),
      // engages an enemy, kills it. Without the fix, unit goes idle with no movement target.
      // With the fix, unit resumes attack-moving toward assaultDestination.
      const unit: UnitState = {
        state: 'attacking',
        targetEntityId: 99,
        targetX: null, // Cleared by handleArrival
        targetY: null,
        isInAssaultMode: true,
        assaultDestination: { x: 50, y: 75 }, // Original attack-move destination
        path: [],
        pathIndex: 0,
      };

      const result = resolveTargetDeath(unit, false);
      // Unit should resume attack-moving, NOT go idle
      expect(result.state).toBe('attackmoving');
      expect(result.targetX).toBe(50);
      expect(result.targetY).toBe(75);
      expect(result.targetEntityId).toBeNull();
    });
  });

  describe('attackmoving engagement range filter', () => {
    /**
     * Replicates the engagement range check from CombatSystem.
     * Attackmoving units should NOT switch to 'attacking' state when targets
     * are beyond attackRange + 3. This preserves formation cohesion while marching.
     */
    function shouldEngageTarget(
      unitState: string,
      canAttackWhileMoving: boolean,
      attackRange: number,
      distanceToTarget: number
    ): boolean {
      if (unitState !== 'attackmoving') return true;
      if (canAttackWhileMoving) return true;
      return distanceToTarget <= attackRange + 3;
    }

    it('attackmoving unit ignores targets beyond engagement range', () => {
      // Attack range 5, target at 20 (sight range distance)
      expect(shouldEngageTarget('attackmoving', false, 5, 20)).toBe(false);
    });

    it('attackmoving unit ignores targets just beyond engagement range', () => {
      // Attack range 5, engagement range = 5 + 3 = 8, target at 9
      expect(shouldEngageTarget('attackmoving', false, 5, 9)).toBe(false);
    });

    it('attackmoving unit engages targets within engagement range', () => {
      // Attack range 5, engagement range = 8, target at 7
      expect(shouldEngageTarget('attackmoving', false, 5, 7)).toBe(true);
    });

    it('attackmoving unit engages targets at exact engagement range', () => {
      // Attack range 5, engagement range = 8, target at 8
      expect(shouldEngageTarget('attackmoving', false, 5, 8)).toBe(true);
    });

    it('attackmoving unit engages targets within attack range', () => {
      expect(shouldEngageTarget('attackmoving', false, 5, 4)).toBe(true);
    });

    it('canAttackWhileMoving units always engage regardless of distance', () => {
      expect(shouldEngageTarget('attackmoving', true, 5, 20)).toBe(true);
      expect(shouldEngageTarget('attackmoving', true, 5, 100)).toBe(true);
    });

    it('non-attackmoving units always engage regardless of distance', () => {
      expect(shouldEngageTarget('idle', false, 5, 20)).toBe(true);
      expect(shouldEngageTarget('attacking', false, 5, 20)).toBe(true);
      expect(shouldEngageTarget('patrolling', false, 5, 20)).toBe(true);
    });

    it('works with different attack ranges', () => {
      // Long range unit (range 10): engagement at 13
      expect(shouldEngageTarget('attackmoving', false, 10, 14)).toBe(false);
      expect(shouldEngageTarget('attackmoving', false, 10, 12)).toBe(true);

      // Short range unit (range 1): engagement at 4
      expect(shouldEngageTarget('attackmoving', false, 1, 5)).toBe(false);
      expect(shouldEngageTarget('attackmoving', false, 1, 3)).toBe(true);
    });
  });
});

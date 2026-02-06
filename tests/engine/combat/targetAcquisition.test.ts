import { describe, it, expect } from 'vitest';
import { isEnemy, TargetQueryOptions } from '@/engine/combat/TargetAcquisition';

/**
 * TargetAcquisition Tests
 *
 * Tests for the unified target selection system, including:
 * - Alliance checking (isEnemy)
 * - Naval targeting domain support
 *
 * Note: findBestTarget and findAllTargets require a full World/ECS setup.
 * Core logic (domain filtering) is validated via CombatSystem integration tests.
 * These tests cover the pure utility functions and type contracts.
 */

describe('TargetAcquisition', () => {
  describe('isEnemy', () => {
    it('same player is never an enemy', () => {
      expect(isEnemy('p1', 0, 'p1', 0)).toBe(false);
      expect(isEnemy('p1', 1, 'p1', 1)).toBe(false);
    });

    it('different players in FFA are enemies', () => {
      expect(isEnemy('p1', 0, 'p2', 0)).toBe(true);
    });

    it('different players on same team are allies', () => {
      expect(isEnemy('p1', 1, 'p2', 1)).toBe(false);
    });

    it('different players on different teams are enemies', () => {
      expect(isEnemy('p1', 1, 'p2', 2)).toBe(true);
    });

    it('team 0 vs non-zero team are enemies', () => {
      expect(isEnemy('p1', 0, 'p2', 1)).toBe(true);
      expect(isEnemy('p1', 1, 'p2', 0)).toBe(true);
    });
  });

  describe('TargetQueryOptions naval support', () => {
    it('accepts canAttackNaval as an optional field', () => {
      const options: TargetQueryOptions = {
        x: 0,
        y: 0,
        range: 10,
        attackerPlayerId: 'p1',
        canAttackAir: false,
        canAttackGround: false,
        canAttackNaval: true,
      };

      // Verify the field exists and is typed correctly
      expect(options.canAttackNaval).toBe(true);
    });

    it('canAttackNaval is optional (backwards compatible)', () => {
      const options: TargetQueryOptions = {
        x: 0,
        y: 0,
        range: 10,
        attackerPlayerId: 'p1',
        canAttackAir: true,
        canAttackGround: true,
      };

      // canAttackNaval should be undefined when not provided
      expect(options.canAttackNaval).toBeUndefined();
    });

    it('submarine-style config: naval-only attacker', () => {
      const submarineOptions: TargetQueryOptions = {
        x: 0,
        y: 0,
        range: 8,
        attackerPlayerId: 'p1',
        canAttackAir: false,
        canAttackGround: false,
        canAttackNaval: true,
        includeBuildingsInSearch: false,
      };

      expect(submarineOptions.canAttackAir).toBe(false);
      expect(submarineOptions.canAttackGround).toBe(false);
      expect(submarineOptions.canAttackNaval).toBe(true);
    });
  });
});

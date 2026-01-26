import { describe, it, expect, beforeEach } from 'vitest';

/**
 * AbilitySystem Tests
 *
 * Tests for ability mechanics:
 * 1. Target validation
 * 2. Range checking
 * 3. Heal target selection
 * 4. Delayed effects
 * 5. Cooldown management
 */

describe('AbilitySystem', () => {
  describe('target type validation', () => {
    type TargetType = 'none' | 'self' | 'point' | 'unit' | 'ally';

    function validateTargetType(
      abilityTargetType: TargetType,
      providedTargetType: 'none' | 'point' | 'unit'
    ): boolean {
      switch (abilityTargetType) {
        case 'none':
        case 'self':
          return true; // Always valid
        case 'point':
          return providedTargetType === 'point';
        case 'unit':
        case 'ally':
          return providedTargetType === 'unit';
        default:
          return false;
      }
    }

    it('none abilities always valid', () => {
      expect(validateTargetType('none', 'none')).toBe(true);
      expect(validateTargetType('none', 'point')).toBe(true);
      expect(validateTargetType('none', 'unit')).toBe(true);
    });

    it('self abilities always valid', () => {
      expect(validateTargetType('self', 'none')).toBe(true);
    });

    it('point abilities require point target', () => {
      expect(validateTargetType('point', 'point')).toBe(true);
      expect(validateTargetType('point', 'unit')).toBe(false);
      expect(validateTargetType('point', 'none')).toBe(false);
    });

    it('unit abilities require unit target', () => {
      expect(validateTargetType('unit', 'unit')).toBe(true);
      expect(validateTargetType('unit', 'point')).toBe(false);
    });

    it('ally abilities require unit target', () => {
      expect(validateTargetType('ally', 'unit')).toBe(true);
      expect(validateTargetType('ally', 'point')).toBe(false);
    });
  });

  describe('range checking', () => {
    function isInRange(
      casterX: number,
      casterY: number,
      targetX: number,
      targetY: number,
      range: number
    ): boolean {
      const dx = targetX - casterX;
      const dy = targetY - casterY;
      return dx * dx + dy * dy <= range * range;
    }

    it('caster at target is in range', () => {
      expect(isInRange(10, 10, 10, 10, 5)).toBe(true);
    });

    it('target within range is valid', () => {
      expect(isInRange(10, 10, 14, 10, 5)).toBe(true);
    });

    it('target at edge is valid', () => {
      expect(isInRange(10, 10, 15, 10, 5)).toBe(true);
    });

    it('target beyond range is invalid', () => {
      expect(isInRange(10, 10, 16, 10, 5)).toBe(false);
    });

    it('diagonal range calculated correctly', () => {
      // sqrt(3^2 + 4^2) = 5
      expect(isInRange(0, 0, 3, 4, 5)).toBe(true);
      expect(isInRange(0, 0, 4, 4, 5)).toBe(false);
    });
  });

  describe('heal target selection', () => {
    interface HealTarget {
      entityId: number;
      currentHealth: number;
      maxHealth: number;
      distance: number;
    }

    function findBestHealTarget(
      targets: HealTarget[],
      maxRange: number
    ): HealTarget | null {
      const inRange = targets.filter((t) => t.distance <= maxRange);
      if (inRange.length === 0) return null;

      // Sort by health percentage (lowest first), then distance
      inRange.sort((a, b) => {
        const aPercent = a.currentHealth / a.maxHealth;
        const bPercent = b.currentHealth / b.maxHealth;
        if (aPercent !== bPercent) return aPercent - bPercent;
        return a.distance - b.distance;
      });

      return inRange[0];
    }

    it('selects lowest health percentage', () => {
      const targets: HealTarget[] = [
        { entityId: 1, currentHealth: 80, maxHealth: 100, distance: 5 },
        { entityId: 2, currentHealth: 40, maxHealth: 100, distance: 5 },
        { entityId: 3, currentHealth: 60, maxHealth: 100, distance: 5 },
      ];
      const result = findBestHealTarget(targets, 10);
      expect(result?.entityId).toBe(2);
    });

    it('considers max health for percentage', () => {
      const targets: HealTarget[] = [
        { entityId: 1, currentHealth: 50, maxHealth: 100, distance: 5 }, // 50%
        { entityId: 2, currentHealth: 150, maxHealth: 200, distance: 5 }, // 75%
      ];
      const result = findBestHealTarget(targets, 10);
      expect(result?.entityId).toBe(1);
    });

    it('breaks ties by distance', () => {
      const targets: HealTarget[] = [
        { entityId: 1, currentHealth: 50, maxHealth: 100, distance: 10 },
        { entityId: 2, currentHealth: 50, maxHealth: 100, distance: 5 },
      ];
      const result = findBestHealTarget(targets, 15);
      expect(result?.entityId).toBe(2);
    });

    it('excludes targets beyond range', () => {
      const targets: HealTarget[] = [
        { entityId: 1, currentHealth: 10, maxHealth: 100, distance: 20 },
        { entityId: 2, currentHealth: 90, maxHealth: 100, distance: 5 },
      ];
      const result = findBestHealTarget(targets, 10);
      expect(result?.entityId).toBe(2);
    });

    it('returns null when no targets in range', () => {
      const targets: HealTarget[] = [
        { entityId: 1, currentHealth: 10, maxHealth: 100, distance: 20 },
      ];
      const result = findBestHealTarget(targets, 10);
      expect(result).toBeNull();
    });
  });

  describe('delayed effects', () => {
    interface DelayedEffect {
      id: number;
      executeTick: number;
      executed: boolean;
    }

    function processDelayedEffects(
      effects: DelayedEffect[],
      currentTick: number
    ): { ready: DelayedEffect[]; pending: DelayedEffect[] } {
      const ready: DelayedEffect[] = [];
      const pending: DelayedEffect[] = [];

      for (const effect of effects) {
        if (!effect.executed && currentTick >= effect.executeTick) {
          ready.push(effect);
        } else if (!effect.executed) {
          pending.push(effect);
        }
      }

      return { ready, pending };
    }

    it('executes effects when tick reached', () => {
      const effects: DelayedEffect[] = [
        { id: 1, executeTick: 100, executed: false },
      ];
      const result = processDelayedEffects(effects, 100);
      expect(result.ready.length).toBe(1);
      expect(result.pending.length).toBe(0);
    });

    it('delays effects before tick', () => {
      const effects: DelayedEffect[] = [
        { id: 1, executeTick: 100, executed: false },
      ];
      const result = processDelayedEffects(effects, 99);
      expect(result.ready.length).toBe(0);
      expect(result.pending.length).toBe(1);
    });

    it('skips already executed effects', () => {
      const effects: DelayedEffect[] = [
        { id: 1, executeTick: 100, executed: true },
      ];
      const result = processDelayedEffects(effects, 100);
      expect(result.ready.length).toBe(0);
      expect(result.pending.length).toBe(0);
    });

    it('processes multiple effects correctly', () => {
      const effects: DelayedEffect[] = [
        { id: 1, executeTick: 100, executed: false },
        { id: 2, executeTick: 105, executed: false },
        { id: 3, executeTick: 95, executed: false },
      ];
      const result = processDelayedEffects(effects, 100);
      expect(result.ready.length).toBe(2); // 1 and 3
      expect(result.pending.length).toBe(1); // 2
    });
  });

  describe('cooldown management', () => {
    interface AbilityState {
      lastUsedTick: number;
      cooldownTicks: number;
    }

    function isOffCooldown(ability: AbilityState, currentTick: number): boolean {
      return currentTick >= ability.lastUsedTick + ability.cooldownTicks;
    }

    function getRemainingCooldown(ability: AbilityState, currentTick: number): number {
      const cooldownEnd = ability.lastUsedTick + ability.cooldownTicks;
      return Math.max(0, cooldownEnd - currentTick);
    }

    it('ability starts off cooldown', () => {
      const ability: AbilityState = { lastUsedTick: 0, cooldownTicks: 60 };
      expect(isOffCooldown(ability, 60)).toBe(true);
    });

    it('ability on cooldown after use', () => {
      const ability: AbilityState = { lastUsedTick: 100, cooldownTicks: 60 };
      expect(isOffCooldown(ability, 100)).toBe(false);
      expect(isOffCooldown(ability, 159)).toBe(false);
    });

    it('ability off cooldown after duration', () => {
      const ability: AbilityState = { lastUsedTick: 100, cooldownTicks: 60 };
      expect(isOffCooldown(ability, 160)).toBe(true);
    });

    it('calculates remaining cooldown', () => {
      const ability: AbilityState = { lastUsedTick: 100, cooldownTicks: 60 };
      expect(getRemainingCooldown(ability, 100)).toBe(60);
      expect(getRemainingCooldown(ability, 130)).toBe(30);
      expect(getRemainingCooldown(ability, 160)).toBe(0);
      expect(getRemainingCooldown(ability, 200)).toBe(0);
    });
  });

  describe('energy cost validation', () => {
    interface EnergyState {
      current: number;
      max: number;
    }

    function canAffordAbility(energy: EnergyState, cost: number): boolean {
      return energy.current >= cost;
    }

    function useEnergy(energy: EnergyState, cost: number): EnergyState {
      return {
        ...energy,
        current: Math.max(0, energy.current - cost),
      };
    }

    function regenEnergy(energy: EnergyState, amount: number): EnergyState {
      return {
        ...energy,
        current: Math.min(energy.max, energy.current + amount),
      };
    }

    it('can afford ability with sufficient energy', () => {
      expect(canAffordAbility({ current: 50, max: 200 }, 50)).toBe(true);
    });

    it('cannot afford ability with insufficient energy', () => {
      expect(canAffordAbility({ current: 30, max: 200 }, 50)).toBe(false);
    });

    it('using energy deducts correctly', () => {
      const result = useEnergy({ current: 100, max: 200 }, 50);
      expect(result.current).toBe(50);
    });

    it('energy cannot go negative', () => {
      const result = useEnergy({ current: 30, max: 200 }, 50);
      expect(result.current).toBe(0);
    });

    it('regen caps at max', () => {
      const result = regenEnergy({ current: 190, max: 200 }, 20);
      expect(result.current).toBe(200);
    });
  });
});

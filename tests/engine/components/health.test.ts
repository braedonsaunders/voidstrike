import { describe, it, expect, beforeEach } from 'vitest';
import { Health } from '@/engine/components/Health';

describe('Health Component', () => {
  let health: Health;

  beforeEach(() => {
    health = new Health(100, 5, 'light', 2, 50, 10, 3);
  });

  describe('constructor', () => {
    it('initializes with max health', () => {
      expect(health.current).toBe(100);
      expect(health.max).toBe(100);
    });

    it('sets armor properties', () => {
      expect(health.armor).toBe(5);
      expect(health.armorType).toBe('light');
    });

    it('sets regeneration rate', () => {
      expect(health.regeneration).toBe(2);
    });

    it('initializes shield at max', () => {
      expect(health.shield).toBe(50);
      expect(health.maxShield).toBe(50);
      expect(health.shieldRegeneration).toBe(10);
      expect(health.shieldRegenDelay).toBe(3);
    });

    it('uses default values', () => {
      const simple = new Health(50);

      expect(simple.max).toBe(50);
      expect(simple.armor).toBe(0);
      expect(simple.armorType).toBe('light');
      expect(simple.regeneration).toBe(0);
      expect(simple.maxShield).toBe(0);
    });
  });

  describe('takeDamage', () => {
    it('reduces health by damage minus armor', () => {
      const noShield = new Health(100, 5);
      const actual = noShield.takeDamage(20, 0);

      expect(actual).toBe(15); // 20 - 5 armor
      expect(noShield.current).toBe(85);
    });

    it('applies minimum 1 damage', () => {
      const highArmor = new Health(100, 50);
      const actual = highArmor.takeDamage(10, 0);

      expect(actual).toBe(1);
      expect(highArmor.current).toBe(99);
    });

    it('damages shield before health', () => {
      health.takeDamage(30, 0); // 30 - 5 armor = 25 damage

      expect(health.shield).toBe(25); // 50 - 25
      expect(health.current).toBe(100); // Health unchanged
    });

    it('overflows shield damage to health', () => {
      health.shield = 10;
      health.takeDamage(30, 0); // 30 - 5 armor = 25 damage

      expect(health.shield).toBe(0);
      expect(health.current).toBe(85); // 100 - 15 overflow
    });

    it('does not go below zero', () => {
      health.shield = 0;
      health.takeDamage(200, 0);

      expect(health.current).toBe(0);
    });

    it('is blocked by invincibility', () => {
      health.isInvincible = true;
      const actual = health.takeDamage(50, 0);

      expect(actual).toBe(0);
      expect(health.current).toBe(100);
      expect(health.shield).toBe(50);
    });
  });

  describe('applyDamageRaw', () => {
    it('applies damage without armor reduction', () => {
      const noShield = new Health(100, 10);
      const actual = noShield.applyDamageRaw(20, 0);

      expect(actual).toBe(20); // No armor reduction
      expect(noShield.current).toBe(80);
    });

    it('damages shield before health', () => {
      health.applyDamageRaw(30, 0);

      expect(health.shield).toBe(20); // 50 - 30
      expect(health.current).toBe(100);
    });

    it('is blocked by invincibility', () => {
      health.isInvincible = true;
      const actual = health.applyDamageRaw(50, 0);

      expect(actual).toBe(0);
    });
  });

  describe('heal', () => {
    it('increases health', () => {
      health.current = 50;
      const actual = health.heal(30);

      expect(actual).toBe(30);
      expect(health.current).toBe(80);
    });

    it('does not exceed max health', () => {
      health.current = 90;
      const actual = health.heal(50);

      expect(actual).toBe(10);
      expect(health.current).toBe(100);
    });

    it('returns zero when already at max', () => {
      const actual = health.heal(50);

      expect(actual).toBe(0);
      expect(health.current).toBe(100);
    });
  });

  describe('regenerate', () => {
    it('regenerates health over time', () => {
      health.current = 50;
      health.regenerate(1.0, 100);

      expect(health.current).toBe(52); // +2 per second
    });

    it('does not exceed max health', () => {
      health.current = 99;
      health.regenerate(1.0, 100);

      expect(health.current).toBe(100);
    });

    it('regenerates shield after delay', () => {
      health.shield = 0;
      // Last damage at time 0, current time 5 (after 3 second delay)
      health.takeDamage(10, 0);
      health.regenerate(1.0, 5);

      expect(health.shield).toBe(10); // +10 per second
    });

    it('does not regenerate shield during delay', () => {
      health.shield = 0;
      health.takeDamage(10, 0);
      health.regenerate(1.0, 2); // Only 2 seconds after damage (delay is 3)

      expect(health.shield).toBe(0);
    });

    it('does not regenerate if no regeneration rate', () => {
      const noRegen = new Health(100);
      noRegen.current = 50;
      noRegen.regenerate(1.0, 100);

      expect(noRegen.current).toBe(50);
    });
  });

  describe('isDead', () => {
    it('returns true when health is zero', () => {
      health.current = 0;
      expect(health.isDead()).toBe(true);
    });

    it('returns true when health is negative', () => {
      health.current = -10;
      expect(health.isDead()).toBe(true);
    });

    it('returns false when health is positive', () => {
      health.current = 1;
      expect(health.isDead()).toBe(false);
    });
  });

  describe('getHealthPercent', () => {
    it('returns 1 at full health', () => {
      expect(health.getHealthPercent()).toBe(1);
    });

    it('returns 0.5 at half health', () => {
      health.current = 50;
      expect(health.getHealthPercent()).toBe(0.5);
    });

    it('returns 0 at zero health', () => {
      health.current = 0;
      expect(health.getHealthPercent()).toBe(0);
    });
  });

  describe('getShieldPercent', () => {
    it('returns 1 at full shield', () => {
      expect(health.getShieldPercent()).toBe(1);
    });

    it('returns 0 at zero shield', () => {
      health.shield = 0;
      expect(health.getShieldPercent()).toBe(0);
    });

    it('returns 0 if no max shield', () => {
      const noShield = new Health(100);
      expect(noShield.getShieldPercent()).toBe(0);
    });
  });

  describe('getTotalHealthPercent', () => {
    it('returns 1 at full health and shield', () => {
      expect(health.getTotalHealthPercent()).toBe(1);
    });

    it('accounts for both health and shield', () => {
      health.current = 50; // 50% of 100
      health.shield = 25; // 50% of 50
      // Total: (50 + 25) / (100 + 50) = 75 / 150 = 0.5

      expect(health.getTotalHealthPercent()).toBe(0.5);
    });
  });

  describe('armor types', () => {
    it.each(['light', 'armored', 'massive', 'structure'] as const)(
      'accepts armor type: %s',
      (armorType) => {
        const h = new Health(100, 0, armorType);
        expect(h.armorType).toBe(armorType);
      }
    );
  });

  describe('type property', () => {
    it('has correct component type', () => {
      expect(health.type).toBe('Health');
    });
  });
});

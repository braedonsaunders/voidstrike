import { describe, it, expect } from 'vitest';
import {
  DAMAGE_TYPES,
  ARMOR_TYPES,
  DAMAGE_MULTIPLIERS,
  DEFAULT_TARGET_PRIORITIES,
  COMBAT_CONFIG,
  getDamageMultiplier,
  getDamageTypeIds,
  getArmorTypeIds,
  validateCombatConfig,
} from '@/data/combat/combat';

describe('Combat Configuration', () => {
  describe('DAMAGE_TYPES', () => {
    it('defines normal damage type', () => {
      expect(DAMAGE_TYPES.normal).toBeDefined();
      expect(DAMAGE_TYPES.normal.name).toBe('Normal');
    });

    it('defines explosive damage type', () => {
      expect(DAMAGE_TYPES.explosive).toBeDefined();
      expect(DAMAGE_TYPES.explosive.name).toBe('Explosive');
    });

    it('defines concussive damage type', () => {
      expect(DAMAGE_TYPES.concussive).toBeDefined();
      expect(DAMAGE_TYPES.concussive.name).toBe('Concussive');
    });

    it('defines psionic damage type', () => {
      expect(DAMAGE_TYPES.psionic).toBeDefined();
      expect(DAMAGE_TYPES.psionic.name).toBe('Psionic');
    });

    it('defines torpedo damage type', () => {
      expect(DAMAGE_TYPES.torpedo).toBeDefined();
      expect(DAMAGE_TYPES.torpedo.name).toBe('Torpedo');
    });

    it('all damage types have required properties', () => {
      for (const [id, type] of Object.entries(DAMAGE_TYPES)) {
        expect(type.id).toBe(id);
        expect(type.name).toBeTruthy();
        expect(type.description).toBeTruthy();
      }
    });
  });

  describe('ARMOR_TYPES', () => {
    it('defines light armor type', () => {
      expect(ARMOR_TYPES.light).toBeDefined();
      expect(ARMOR_TYPES.light.name).toBe('Light');
    });

    it('defines armored armor type', () => {
      expect(ARMOR_TYPES.armored).toBeDefined();
      expect(ARMOR_TYPES.armored.name).toBe('Armored');
    });

    it('defines massive armor type', () => {
      expect(ARMOR_TYPES.massive).toBeDefined();
      expect(ARMOR_TYPES.massive.name).toBe('Massive');
    });

    it('defines structure armor type', () => {
      expect(ARMOR_TYPES.structure).toBeDefined();
      expect(ARMOR_TYPES.structure.name).toBe('Structure');
    });

    it('defines naval armor type', () => {
      expect(ARMOR_TYPES.naval).toBeDefined();
      expect(ARMOR_TYPES.naval.name).toBe('Naval');
    });

    it('all armor types have required properties', () => {
      for (const [id, type] of Object.entries(ARMOR_TYPES)) {
        expect(type.id).toBe(id);
        expect(type.name).toBeTruthy();
        expect(type.description).toBeTruthy();
      }
    });
  });

  describe('DAMAGE_MULTIPLIERS', () => {
    it('normal damage has 1.0 multiplier against all armor', () => {
      expect(DAMAGE_MULTIPLIERS.normal.light).toBe(1.0);
      expect(DAMAGE_MULTIPLIERS.normal.armored).toBe(1.0);
      expect(DAMAGE_MULTIPLIERS.normal.massive).toBe(1.0);
      expect(DAMAGE_MULTIPLIERS.normal.structure).toBe(1.0);
      expect(DAMAGE_MULTIPLIERS.normal.naval).toBe(1.0);
    });

    it('explosive is effective against armored', () => {
      expect(DAMAGE_MULTIPLIERS.explosive.armored).toBe(1.5);
    });

    it('explosive is weak against light', () => {
      expect(DAMAGE_MULTIPLIERS.explosive.light).toBe(0.5);
    });

    it('concussive is effective against light', () => {
      expect(DAMAGE_MULTIPLIERS.concussive.light).toBe(1.5);
    });

    it('concussive is weak against armored', () => {
      expect(DAMAGE_MULTIPLIERS.concussive.armored).toBe(0.5);
    });

    it('concussive is very weak against massive', () => {
      expect(DAMAGE_MULTIPLIERS.concussive.massive).toBe(0.25);
    });

    it('psionic has reduced effect on structures', () => {
      expect(DAMAGE_MULTIPLIERS.psionic.structure).toBe(0.5);
    });

    it('torpedo is effective against naval', () => {
      expect(DAMAGE_MULTIPLIERS.torpedo.naval).toBe(1.5);
    });

    it('torpedo is weak against light', () => {
      expect(DAMAGE_MULTIPLIERS.torpedo.light).toBe(0.5);
    });
  });

  describe('getDamageMultiplier', () => {
    it('returns correct multiplier for normal vs light', () => {
      expect(getDamageMultiplier('normal', 'light')).toBe(1.0);
    });

    it('returns correct multiplier for explosive vs armored', () => {
      expect(getDamageMultiplier('explosive', 'armored')).toBe(1.5);
    });

    it('returns correct multiplier for concussive vs light', () => {
      expect(getDamageMultiplier('concussive', 'light')).toBe(1.5);
    });

    it('returns correct multiplier for torpedo vs naval', () => {
      expect(getDamageMultiplier('torpedo', 'naval')).toBe(1.5);
    });

    it('returns 1.0 for unknown damage type', () => {
      expect(getDamageMultiplier('unknown', 'light')).toBe(1.0);
    });

    it('returns 1.0 for unknown armor type', () => {
      expect(getDamageMultiplier('normal', 'unknown')).toBe(1.0);
    });

    it('returns 1.0 for both unknown types', () => {
      expect(getDamageMultiplier('unknown', 'unknown')).toBe(1.0);
    });
  });

  describe('getDamageTypeIds', () => {
    it('returns all damage type IDs', () => {
      const ids = getDamageTypeIds();

      expect(ids).toContain('normal');
      expect(ids).toContain('explosive');
      expect(ids).toContain('concussive');
      expect(ids).toContain('psionic');
      expect(ids).toContain('torpedo');
    });

    it('returns array of strings', () => {
      const ids = getDamageTypeIds();

      for (const id of ids) {
        expect(typeof id).toBe('string');
      }
    });
  });

  describe('getArmorTypeIds', () => {
    it('returns all armor type IDs', () => {
      const ids = getArmorTypeIds();

      expect(ids).toContain('light');
      expect(ids).toContain('armored');
      expect(ids).toContain('massive');
      expect(ids).toContain('structure');
      expect(ids).toContain('naval');
    });

    it('returns array of strings', () => {
      const ids = getArmorTypeIds();

      for (const id of ids) {
        expect(typeof id).toBe('string');
      }
    });
  });

  describe('validateCombatConfig', () => {
    it('validates complete config without errors', () => {
      const result = validateCombatConfig();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns errors array', () => {
      const result = validateCombatConfig();

      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  describe('DEFAULT_TARGET_PRIORITIES', () => {
    it('capital_ship has highest priority', () => {
      expect(DEFAULT_TARGET_PRIORITIES.capital_ship).toBe(95);
    });

    it('worker has low priority', () => {
      expect(DEFAULT_TARGET_PRIORITIES.worker).toBe(10);
    });

    it('structure has lowest priority', () => {
      expect(DEFAULT_TARGET_PRIORITIES.structure).toBe(5);
    });

    it('combat units have higher priority than workers', () => {
      expect(DEFAULT_TARGET_PRIORITIES.standard_infantry).toBeGreaterThan(
        DEFAULT_TARGET_PRIORITIES.worker
      );
    });

    it('siege units have high priority', () => {
      expect(DEFAULT_TARGET_PRIORITIES.artillery).toBeGreaterThan(80);
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

    it('enables overkill protection', () => {
      expect(COMBAT_CONFIG.overkillProtection).toBe(true);
    });

    it('defines under attack cooldown', () => {
      expect(COMBAT_CONFIG.underAttackCooldown).toBe(10000);
    });
  });

  describe('damage calculation edge cases', () => {
    it('massive armor is highly resistant to concussive', () => {
      const multiplier = getDamageMultiplier('concussive', 'massive');
      expect(multiplier).toBe(0.25);
      // 100 concussive damage to massive = 25 damage
      expect(100 * multiplier).toBe(25);
    });

    it('explosive damage calculation example', () => {
      const baseDamage = 50;
      const armorReduction = 3;

      // vs light armor (0.5x)
      const lightMultiplier = getDamageMultiplier('explosive', 'light');
      const lightDamage = Math.max(1, baseDamage * lightMultiplier - armorReduction);
      expect(lightDamage).toBe(22); // 50 * 0.5 - 3 = 22

      // vs armored (1.5x)
      const armoredMultiplier = getDamageMultiplier('explosive', 'armored');
      const armoredDamage = Math.max(1, baseDamage * armoredMultiplier - armorReduction);
      expect(armoredDamage).toBe(72); // 50 * 1.5 - 3 = 72
    });

    it('psionic ignores armor in calculations', () => {
      // Psionic typically bypasses armor - all 1.0 except structures
      expect(getDamageMultiplier('psionic', 'light')).toBe(1.0);
      expect(getDamageMultiplier('psionic', 'armored')).toBe(1.0);
      expect(getDamageMultiplier('psionic', 'massive')).toBe(1.0);
    });
  });

  describe('naval combat', () => {
    it('torpedo is highly effective against ships', () => {
      expect(getDamageMultiplier('torpedo', 'naval')).toBe(1.5);
    });

    it('torpedo is effective against structures', () => {
      expect(getDamageMultiplier('torpedo', 'structure')).toBe(1.25);
    });

    it('explosive is moderately effective against ships', () => {
      expect(getDamageMultiplier('explosive', 'naval')).toBe(1.25);
    });
  });
});

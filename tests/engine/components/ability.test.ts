import { describe, it, expect, beforeEach } from 'vitest';
import { Ability, AbilityDefinition, DOMINION_ABILITIES } from '@/engine/components/Ability';

function createAbility(overrides: Partial<AbilityDefinition> = {}): AbilityDefinition {
  return {
    id: 'test_ability',
    name: 'Test Ability',
    description: 'A test ability',
    cooldown: 10,
    energyCost: 25,
    range: 5,
    targetType: 'unit',
    hotkey: 'T',
    ...overrides,
  };
}

describe('Ability Component', () => {
  let ability: Ability;

  describe('constructor', () => {
    it('creates with default values', () => {
      ability = new Ability();

      expect(ability.energy).toBe(0);
      expect(ability.maxEnergy).toBe(0);
      expect(ability.energyRegen).toBe(0);
      expect(ability.abilities.size).toBe(0);
    });

    it('sets energy properties', () => {
      ability = new Ability(100, 2);

      expect(ability.energy).toBe(100);
      expect(ability.maxEnergy).toBe(100);
      expect(ability.energyRegen).toBe(2);
    });

    it('initializes with abilities', () => {
      const stim = createAbility({ id: 'stim' });
      const shield = createAbility({ id: 'shield' });

      ability = new Ability(100, 2, [stim, shield]);

      expect(ability.abilities.size).toBe(2);
      expect(ability.abilities.has('stim')).toBe(true);
      expect(ability.abilities.has('shield')).toBe(true);
    });

    it('initializes ability state correctly', () => {
      const def = createAbility({ cooldown: 15 });
      ability = new Ability(100, 2, [def]);

      const state = ability.abilities.get('test_ability');
      expect(state?.currentCooldown).toBe(0);
      expect(state?.isActive).toBe(false);
      expect(state?.definition).toBe(def);
    });
  });

  describe('addAbility', () => {
    beforeEach(() => {
      ability = new Ability(100, 2);
    });

    it('adds new ability', () => {
      const def = createAbility();

      ability.addAbility(def);

      expect(ability.abilities.has('test_ability')).toBe(true);
    });

    it('initializes cooldown to 0', () => {
      ability.addAbility(createAbility());

      const state = ability.abilities.get('test_ability');
      expect(state?.currentCooldown).toBe(0);
    });

    it('overwrites existing ability with same id', () => {
      ability.addAbility(createAbility({ name: 'Version 1' }));
      ability.addAbility(createAbility({ name: 'Version 2' }));

      const state = ability.abilities.get('test_ability');
      expect(state?.definition.name).toBe('Version 2');
    });
  });

  describe('removeAbility', () => {
    beforeEach(() => {
      ability = new Ability(100, 2, [createAbility()]);
    });

    it('removes ability by id', () => {
      ability.removeAbility('test_ability');

      expect(ability.abilities.has('test_ability')).toBe(false);
    });

    it('handles removing non-existent ability', () => {
      // Should not throw
      ability.removeAbility('nonexistent');

      expect(ability.abilities.size).toBe(1);
    });
  });

  describe('canUseAbility', () => {
    beforeEach(() => {
      ability = new Ability(100, 2, [createAbility({ energyCost: 25, cooldown: 10 })]);
    });

    it('returns true when ready', () => {
      expect(ability.canUseAbility('test_ability')).toBe(true);
    });

    it('returns false when on cooldown', () => {
      const state = ability.abilities.get('test_ability')!;
      state.currentCooldown = 5;

      expect(ability.canUseAbility('test_ability')).toBe(false);
    });

    it('returns false when not enough energy', () => {
      ability.energy = 10;

      expect(ability.canUseAbility('test_ability')).toBe(false);
    });

    it('returns false for unknown ability', () => {
      expect(ability.canUseAbility('unknown')).toBe(false);
    });
  });

  describe('useAbility', () => {
    beforeEach(() => {
      ability = new Ability(100, 2, [createAbility({ energyCost: 25, cooldown: 10 })]);
    });

    it('consumes energy', () => {
      ability.useAbility('test_ability');

      expect(ability.energy).toBe(75);
    });

    it('starts cooldown', () => {
      ability.useAbility('test_ability');

      const state = ability.abilities.get('test_ability')!;
      expect(state.currentCooldown).toBe(10);
    });

    it('returns true on success', () => {
      expect(ability.useAbility('test_ability')).toBe(true);
    });

    it('returns false when cannot use', () => {
      ability.energy = 0;

      expect(ability.useAbility('test_ability')).toBe(false);
    });

    it('returns false for unknown ability', () => {
      expect(ability.useAbility('unknown')).toBe(false);
    });

    it('does not modify state on failure', () => {
      ability.energy = 0;
      const originalEnergy = ability.energy;

      ability.useAbility('test_ability');

      expect(ability.energy).toBe(originalEnergy);
    });
  });

  describe('updateCooldowns', () => {
    beforeEach(() => {
      ability = new Ability(100, 10, [createAbility()]);
    });

    it('regenerates energy', () => {
      ability.energy = 50; // Start at half energy

      ability.updateCooldowns(2);

      expect(ability.energy).toBe(70); // 50 + (10 * 2) = 70
    });

    it('caps energy at max', () => {
      ability.energy = 95;
      ability.updateCooldowns(10); // Would add 100, but caps at maxEnergy (100)

      expect(ability.energy).toBe(100);
    });

    it('does not regenerate when max is 0', () => {
      ability = new Ability(0, 10, [createAbility()]);

      ability.updateCooldowns(5);

      expect(ability.energy).toBe(0);
    });

    it('reduces cooldowns', () => {
      ability.useAbility('test_ability');
      const state = ability.abilities.get('test_ability')!;

      ability.updateCooldowns(3);

      expect(state.currentCooldown).toBe(7);
    });

    it('does not reduce cooldown below 0', () => {
      ability.useAbility('test_ability');
      const state = ability.abilities.get('test_ability')!;

      ability.updateCooldowns(15);

      expect(state.currentCooldown).toBe(0);
    });
  });

  describe('getAbility', () => {
    beforeEach(() => {
      ability = new Ability(100, 2, [createAbility()]);
    });

    it('returns ability state', () => {
      const state = ability.getAbility('test_ability');

      expect(state).toBeDefined();
      expect(state?.definition.id).toBe('test_ability');
    });

    it('returns undefined for unknown ability', () => {
      expect(ability.getAbility('unknown')).toBeUndefined();
    });
  });

  describe('getAbilityList', () => {
    it('returns array of all abilities', () => {
      ability = new Ability(100, 2, [
        createAbility({ id: 'ability1' }),
        createAbility({ id: 'ability2' }),
        createAbility({ id: 'ability3' }),
      ]);

      const list = ability.getAbilityList();

      expect(list).toHaveLength(3);
      expect(list.map(a => a.definition.id)).toContain('ability1');
      expect(list.map(a => a.definition.id)).toContain('ability2');
      expect(list.map(a => a.definition.id)).toContain('ability3');
    });

    it('returns empty array when no abilities', () => {
      ability = new Ability();

      expect(ability.getAbilityList()).toEqual([]);
    });
  });

  describe('getCooldownPercent', () => {
    beforeEach(() => {
      ability = new Ability(100, 2, [createAbility({ cooldown: 10 })]);
    });

    it('returns 0 when not on cooldown', () => {
      expect(ability.getCooldownPercent('test_ability')).toBe(0);
    });

    it('returns cooldown percentage', () => {
      ability.useAbility('test_ability');
      const state = ability.abilities.get('test_ability')!;
      state.currentCooldown = 7;

      expect(ability.getCooldownPercent('test_ability')).toBe(0.7);
    });

    it('returns 0 for unknown ability', () => {
      expect(ability.getCooldownPercent('unknown')).toBe(0);
    });

    it('returns 0 for ability with 0 cooldown', () => {
      ability.addAbility(createAbility({ id: 'instant', cooldown: 0 }));

      expect(ability.getCooldownPercent('instant')).toBe(0);
    });
  });

  describe('ability target types', () => {
    it('supports self-cast abilities', () => {
      ability = new Ability(100, 2, [createAbility({ targetType: 'self' })]);

      const state = ability.getAbility('test_ability');
      expect(state?.definition.targetType).toBe('self');
    });

    it('supports point targeting', () => {
      ability = new Ability(100, 2, [createAbility({ targetType: 'point' })]);

      const state = ability.getAbility('test_ability');
      expect(state?.definition.targetType).toBe('point');
    });

    it('supports unit targeting', () => {
      ability = new Ability(100, 2, [createAbility({ targetType: 'unit' })]);

      const state = ability.getAbility('test_ability');
      expect(state?.definition.targetType).toBe('unit');
    });

    it('supports ally targeting', () => {
      ability = new Ability(100, 2, [createAbility({ targetType: 'ally' })]);

      const state = ability.getAbility('test_ability');
      expect(state?.definition.targetType).toBe('ally');
    });

    it('supports no targeting', () => {
      ability = new Ability(100, 2, [createAbility({ targetType: 'none' })]);

      const state = ability.getAbility('test_ability');
      expect(state?.definition.targetType).toBe('none');
    });
  });

  describe('DOMINION_ABILITIES', () => {
    it('includes stim pack', () => {
      expect(DOMINION_ABILITIES.stim_pack).toBeDefined();
      expect(DOMINION_ABILITIES.stim_pack.cooldown).toBe(10);
      expect(DOMINION_ABILITIES.stim_pack.targetType).toBe('self');
    });

    it('includes siege mode', () => {
      expect(DOMINION_ABILITIES.siege_mode).toBeDefined();
      expect(DOMINION_ABILITIES.siege_mode.cooldown).toBe(3);
    });

    it('includes emp round', () => {
      expect(DOMINION_ABILITIES.emp_round).toBeDefined();
      expect(DOMINION_ABILITIES.emp_round.energyCost).toBe(75);
      expect(DOMINION_ABILITIES.emp_round.targetType).toBe('point');
      expect(DOMINION_ABILITIES.emp_round.aoeRadius).toBe(2.5);
    });

    it('includes snipe', () => {
      expect(DOMINION_ABILITIES.snipe).toBeDefined();
      expect(DOMINION_ABILITIES.snipe.damage).toBe(150);
      expect(DOMINION_ABILITIES.snipe.targetType).toBe('unit');
    });

    it('includes nuke', () => {
      expect(DOMINION_ABILITIES.nuke).toBeDefined();
      expect(DOMINION_ABILITIES.nuke.damage).toBe(300);
      expect(DOMINION_ABILITIES.nuke.aoeRadius).toBe(8);
    });

    it('includes scanner sweep', () => {
      expect(DOMINION_ABILITIES.scanner_sweep).toBeDefined();
      expect(DOMINION_ABILITIES.scanner_sweep.duration).toBe(15);
    });

    it('includes mule', () => {
      expect(DOMINION_ABILITIES.mule).toBeDefined();
      expect(DOMINION_ABILITIES.mule.duration).toBe(64);
    });

    it('includes power cannon', () => {
      expect(DOMINION_ABILITIES.power_cannon).toBeDefined();
      expect(DOMINION_ABILITIES.power_cannon.damage).toBe(300);
      expect(DOMINION_ABILITIES.power_cannon.duration).toBe(2);
    });

    it('includes warp jump', () => {
      expect(DOMINION_ABILITIES.warp_jump).toBeDefined();
      expect(DOMINION_ABILITIES.warp_jump.range).toBe(20);
    });
  });

  describe('type property', () => {
    it('has correct component type', () => {
      ability = new Ability();

      expect(ability.type).toBe('Ability');
    });
  });
});

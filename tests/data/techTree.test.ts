import { describe, it, expect, vi } from 'vitest';
import {
  BUILDING_DISPLAY_NAMES,
  BUILDING_RESEARCH_MAP,
  buildTechCategories,
  formatEffect,
  getEffectIcon,
  checkRequirements,
  TECH_CATEGORIES,
  TechCategory,
} from '@/data/tech-tree';
import { RESEARCH_DEFINITIONS, UpgradeEffect } from '@/data/research/dominion';

describe('Tech Tree', () => {
  describe('BUILDING_DISPLAY_NAMES', () => {
    it('defines display names for buildings', () => {
      expect(BUILDING_DISPLAY_NAMES.tech_center).toBe('Tech Center');
      expect(BUILDING_DISPLAY_NAMES.arsenal).toBe('Arsenal');
      expect(BUILDING_DISPLAY_NAMES.power_core).toBe('Power Core');
      expect(BUILDING_DISPLAY_NAMES.ops_center).toBe('Ops Center');
    });

    it('all names are strings', () => {
      for (const [key, name] of Object.entries(BUILDING_DISPLAY_NAMES)) {
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
    });
  });

  describe('buildTechCategories', () => {
    it('returns array of categories', () => {
      const categories = buildTechCategories();
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBeGreaterThan(0);
    });

    it('each category has required properties', () => {
      const categories = buildTechCategories();
      for (const category of categories) {
        expect(category.id).toBeTruthy();
        expect(category.name).toBeTruthy();
        expect(typeof category.description).toBe('string');
        expect(category.buildingId).toBeTruthy();
        expect(category.buildingName).toBeTruthy();
        expect(Array.isArray(category.upgrades)).toBe(true);
        expect(Array.isArray(category.upgradeChains)).toBe(true);
      }
    });

    it('creates categories from BUILDING_RESEARCH_MAP', () => {
      const categories = buildTechCategories();
      const categoryIds = categories.map(c => c.id);

      for (const buildingId of Object.keys(BUILDING_RESEARCH_MAP)) {
        expect(categoryIds).toContain(buildingId);
      }
    });

    it('groups upgrades by building', () => {
      const categories = buildTechCategories();

      for (const category of categories) {
        const expectedResearchIds = BUILDING_RESEARCH_MAP[category.buildingId];
        if (expectedResearchIds) {
          for (const researchId of expectedResearchIds) {
            const hasUpgrade = category.upgrades.some(u => u.id === researchId);
            if (RESEARCH_DEFINITIONS[researchId]) {
              expect(hasUpgrade).toBe(true);
            }
          }
        }
      }
    });

    it('builds upgrade chains from level 1 upgrades', () => {
      const categories = buildTechCategories();

      for (const category of categories) {
        for (const chain of category.upgradeChains) {
          expect(chain.id).toBeTruthy();
          expect(chain.name).toBeTruthy();
          expect(Array.isArray(chain.levels)).toBe(true);
          expect(chain.levels.length).toBeGreaterThan(0);

          // First level should be level 1 or standalone
          const firstLevel = chain.levels[0];
          if (firstLevel.level !== undefined) {
            expect(firstLevel.level).toBe(1);
          }

          // Chain should be in order
          for (let i = 1; i < chain.levels.length; i++) {
            const prev = chain.levels[i - 1];
            const curr = chain.levels[i];
            expect(prev.nextLevel).toBe(curr.id);
          }
        }
      }
    });
  });

  describe('formatEffect', () => {
    it('formats damage bonus with percentage', () => {
      const effect: UpgradeEffect = { type: 'damage_bonus', value: 0.1, targets: ['infantry'] };
      const result = formatEffect(effect);
      expect(result).toContain('+10%');
      expect(result).toContain('Damage');
      expect(result).toContain('infantry');
    });

    it('formats armor bonus with integer', () => {
      const effect: UpgradeEffect = { type: 'armor_bonus', value: 2, targets: ['vehicle'] };
      const result = formatEffect(effect);
      expect(result).toContain('+2');
      expect(result).toContain('Armor');
    });

    it('formats attack speed bonus', () => {
      const effect: UpgradeEffect = { type: 'attack_speed', value: 0.15 };
      const result = formatEffect(effect);
      expect(result).toContain('+15%');
      expect(result).toContain('Attack Speed');
    });

    it('formats ability unlock', () => {
      const effect: UpgradeEffect = { type: 'ability_unlock', value: 1 };
      const result = formatEffect(effect);
      expect(result).toBe('Unlocks ability');
    });

    it('formats range bonus', () => {
      const effect: UpgradeEffect = { type: 'range_bonus', value: 1 };
      const result = formatEffect(effect);
      expect(result).toContain('+1');
      expect(result).toContain('Range');
    });

    it('formats health bonus', () => {
      const effect: UpgradeEffect = { type: 'health_bonus', value: 0.2 };
      const result = formatEffect(effect);
      expect(result).toContain('+20%');
      expect(result).toContain('Health');
    });

    it('formats speed bonus', () => {
      const effect: UpgradeEffect = { type: 'speed_bonus', value: 0.1 };
      const result = formatEffect(effect);
      expect(result).toContain('+10%');
      expect(result).toContain('Speed');
    });

    it('includes unit types when specified', () => {
      const effect: UpgradeEffect = { type: 'damage_bonus', value: 1, unitTypes: ['infantry', 'vehicle'] };
      const result = formatEffect(effect);
      expect(result).toContain('infantry');
      expect(result).toContain('vehicle');
    });
  });

  describe('getEffectIcon', () => {
    it('returns sword for damage bonus', () => {
      expect(getEffectIcon('damage_bonus')).toBe('⚔️');
    });

    it('returns shield for armor bonus', () => {
      expect(getEffectIcon('armor_bonus')).toBe('🛡️');
    });

    it('returns lightning for attack speed', () => {
      expect(getEffectIcon('attack_speed')).toBe('⚡');
    });

    it('returns sparkle for ability unlock', () => {
      expect(getEffectIcon('ability_unlock')).toBe('✨');
    });

    it('returns target for range bonus', () => {
      expect(getEffectIcon('range_bonus')).toBe('🎯');
    });

    it('returns heart for health bonus', () => {
      expect(getEffectIcon('health_bonus')).toBe('❤️');
    });

    it('returns wind for speed bonus', () => {
      expect(getEffectIcon('speed_bonus')).toBe('💨');
    });

    it('returns default for unknown type', () => {
      expect(getEffectIcon('unknown' as UpgradeEffect['type'])).toBe('◆');
    });
  });

  describe('checkRequirements', () => {
    it('returns met=true for research with no requirements', () => {
      // Find a research with no requirements
      const noReqResearch = Object.entries(RESEARCH_DEFINITIONS).find(
        ([_, def]) => !def.requirements || def.requirements.length === 0
      );

      if (noReqResearch) {
        const hasResearch = vi.fn(() => false);
        const result = checkRequirements(noReqResearch[0], hasResearch, 'player1');
        expect(result.met).toBe(true);
        expect(result.missing).toEqual([]);
      }
    });

    it('returns met=true when all research requirements are met', () => {
      // Find a level 2 research that requires level 1
      const level2Research = Object.entries(RESEARCH_DEFINITIONS).find(
        ([_, def]) => def.level === 2 && def.requirements && def.requirements.length > 0
      );

      if (level2Research) {
        const hasResearch = vi.fn(() => true);
        const result = checkRequirements(level2Research[0], hasResearch, 'player1');
        expect(result.met).toBe(true);
        expect(result.missing).toEqual([]);
      }
    });

    it('returns met=false with missing requirements', () => {
      // Find a level 2 research that requires level 1
      const level2Research = Object.entries(RESEARCH_DEFINITIONS).find(
        ([_, def]) => def.level === 2 && def.requirements && def.requirements.length > 0
      );

      if (level2Research) {
        const hasResearch = vi.fn(() => false);
        const result = checkRequirements(level2Research[0], hasResearch, 'player1');
        expect(result.met).toBe(false);
        expect(result.missing.length).toBeGreaterThan(0);
      }
    });

    it('returns met=true for unknown research', () => {
      const hasResearch = vi.fn(() => false);
      const result = checkRequirements('nonexistent_research', hasResearch, 'player1');
      expect(result.met).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  describe('TECH_CATEGORIES', () => {
    it('is pre-built array of categories', () => {
      expect(Array.isArray(TECH_CATEGORIES)).toBe(true);
      expect(TECH_CATEGORIES.length).toBeGreaterThan(0);
    });

    it('matches buildTechCategories result', () => {
      const dynamic = buildTechCategories();
      expect(TECH_CATEGORIES.length).toBe(dynamic.length);

      for (let i = 0; i < TECH_CATEGORIES.length; i++) {
        expect(TECH_CATEGORIES[i].id).toBe(dynamic[i].id);
      }
    });
  });

  describe('upgrade chain integrity', () => {
    it('all chains have valid effect types', () => {
      const validTypes = [
        'damage_bonus',
        'armor_bonus',
        'attack_speed',
        'ability_unlock',
        'range_bonus',
        'health_bonus',
        'speed_bonus',
      ];

      for (const category of TECH_CATEGORIES) {
        for (const chain of category.upgradeChains) {
          expect(validTypes).toContain(chain.effectType);
        }
      }
    });

    it('chain names are derived from first level', () => {
      for (const category of TECH_CATEGORIES) {
        for (const chain of category.upgradeChains) {
          if (chain.levels.length > 0) {
            // Name should be similar to first level name (minus "Level X")
            const firstName = chain.levels[0].name.replace(/ Level \d+$/, '');
            expect(chain.name).toBe(firstName);
          }
        }
      }
    });
  });

  describe('category properties', () => {
    it('tech_center has infantry upgrades', () => {
      const techCenter = TECH_CATEGORIES.find(c => c.id === 'tech_center');
      if (techCenter) {
        expect(techCenter.name).toContain('Infantry');
      }
    });

    it('arsenal has vehicle/ship upgrades', () => {
      const arsenal = TECH_CATEGORIES.find(c => c.id === 'arsenal');
      if (arsenal) {
        expect(arsenal.name).toContain('Vehicle');
      }
    });
  });
});

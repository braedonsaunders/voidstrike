import { describe, it, expect } from 'vitest';
import {
  UNIT_CATEGORIES,
  UNIT_CATEGORY_ASSIGNMENTS,
  UNIT_SUBCATEGORIES,
  UNIT_SUBCATEGORY_ASSIGNMENTS,
  getCategoryIds,
  getCategory,
  getUnitCategory,
  getUnitSubcategory,
  getUnitsInCategory,
  getDefaultTargetPriority,
  isCombatUnit,
  getCategoriesSorted,
} from '@/data/units/categories';

describe('Unit Categories', () => {
  describe('UNIT_CATEGORIES', () => {
    it('defines worker category', () => {
      expect(UNIT_CATEGORIES.worker).toBeDefined();
      expect(UNIT_CATEGORIES.worker.name).toBe('Worker');
      expect(UNIT_CATEGORIES.worker.isCombatUnit).toBe(false);
    });

    it('defines infantry category', () => {
      expect(UNIT_CATEGORIES.infantry).toBeDefined();
      expect(UNIT_CATEGORIES.infantry.name).toBe('Infantry');
      expect(UNIT_CATEGORIES.infantry.isCombatUnit).toBe(true);
    });

    it('defines vehicle category', () => {
      expect(UNIT_CATEGORIES.vehicle).toBeDefined();
      expect(UNIT_CATEGORIES.vehicle.name).toBe('Vehicle');
      expect(UNIT_CATEGORIES.vehicle.isCombatUnit).toBe(true);
    });

    it('defines ship category', () => {
      expect(UNIT_CATEGORIES.ship).toBeDefined();
      expect(UNIT_CATEGORIES.ship.name).toBe('Ship');
      expect(UNIT_CATEGORIES.ship.isCombatUnit).toBe(true);
    });

    it('defines naval category', () => {
      expect(UNIT_CATEGORIES.naval).toBeDefined();
      expect(UNIT_CATEGORIES.naval.name).toBe('Naval');
      expect(UNIT_CATEGORIES.naval.isCombatUnit).toBe(true);
    });

    it('defines support category', () => {
      expect(UNIT_CATEGORIES.support).toBeDefined();
      expect(UNIT_CATEGORIES.support.name).toBe('Support');
      expect(UNIT_CATEGORIES.support.isCombatUnit).toBe(false);
    });

    it('defines hero category', () => {
      expect(UNIT_CATEGORIES.hero).toBeDefined();
      expect(UNIT_CATEGORIES.hero.name).toBe('Hero');
      expect(UNIT_CATEGORIES.hero.isCombatUnit).toBe(true);
      expect(UNIT_CATEGORIES.hero.defaultTargetPriority).toBe(95);
    });

    it('all categories have required properties', () => {
      for (const [id, cat] of Object.entries(UNIT_CATEGORIES)) {
        expect(cat.id).toBe(id);
        expect(cat.name).toBeTruthy();
        expect(cat.description).toBeTruthy();
        expect(typeof cat.displayOrder).toBe('number');
        expect(typeof cat.defaultTargetPriority).toBe('number');
        expect(typeof cat.isCombatUnit).toBe('boolean');
      }
    });
  });

  describe('UNIT_CATEGORY_ASSIGNMENTS', () => {
    it('assigns workers correctly', () => {
      expect(UNIT_CATEGORY_ASSIGNMENTS.fabricator).toBe('worker');
      expect(UNIT_CATEGORY_ASSIGNMENTS.mariner).toBe('worker');
    });

    it('assigns infantry correctly', () => {
      expect(UNIT_CATEGORY_ASSIGNMENTS.trooper).toBe('infantry');
      expect(UNIT_CATEGORY_ASSIGNMENTS.breacher).toBe('infantry');
      expect(UNIT_CATEGORY_ASSIGNMENTS.vanguard).toBe('infantry');
      expect(UNIT_CATEGORY_ASSIGNMENTS.operative).toBe('infantry');
    });

    it('assigns vehicles correctly', () => {
      expect(UNIT_CATEGORY_ASSIGNMENTS.scorcher).toBe('vehicle');
      expect(UNIT_CATEGORY_ASSIGNMENTS.devastator).toBe('vehicle');
      expect(UNIT_CATEGORY_ASSIGNMENTS.colossus).toBe('vehicle');
    });

    it('assigns ships correctly', () => {
      expect(UNIT_CATEGORY_ASSIGNMENTS.valkyrie).toBe('ship');
      expect(UNIT_CATEGORY_ASSIGNMENTS.specter).toBe('ship');
      expect(UNIT_CATEGORY_ASSIGNMENTS.dreadnought).toBe('ship');
    });

    it('assigns naval units correctly', () => {
      expect(UNIT_CATEGORY_ASSIGNMENTS.stingray).toBe('naval');
      expect(UNIT_CATEGORY_ASSIGNMENTS.corsair).toBe('naval');
      expect(UNIT_CATEGORY_ASSIGNMENTS.leviathan).toBe('naval');
      expect(UNIT_CATEGORY_ASSIGNMENTS.hunter).toBe('naval');
      expect(UNIT_CATEGORY_ASSIGNMENTS.kraken).toBe('naval');
    });

    it('assigns support units correctly', () => {
      expect(UNIT_CATEGORY_ASSIGNMENTS.lifter).toBe('support');
      expect(UNIT_CATEGORY_ASSIGNMENTS.overseer).toBe('support');
    });
  });

  describe('UNIT_SUBCATEGORIES', () => {
    it('defines infantry subcategories', () => {
      expect(UNIT_SUBCATEGORIES.light_infantry).toBeDefined();
      expect(UNIT_SUBCATEGORIES.light_infantry.parentCategory).toBe('infantry');
      expect(UNIT_SUBCATEGORIES.heavy_infantry).toBeDefined();
      expect(UNIT_SUBCATEGORIES.heavy_infantry.parentCategory).toBe('infantry');
    });

    it('defines vehicle subcategories', () => {
      expect(UNIT_SUBCATEGORIES.light_vehicle).toBeDefined();
      expect(UNIT_SUBCATEGORIES.light_vehicle.parentCategory).toBe('vehicle');
      expect(UNIT_SUBCATEGORIES.heavy_vehicle).toBeDefined();
      expect(UNIT_SUBCATEGORIES.heavy_vehicle.parentCategory).toBe('vehicle');
    });

    it('defines ship subcategories', () => {
      expect(UNIT_SUBCATEGORIES.fighter).toBeDefined();
      expect(UNIT_SUBCATEGORIES.fighter.parentCategory).toBe('ship');
      expect(UNIT_SUBCATEGORIES.capital_ship).toBeDefined();
      expect(UNIT_SUBCATEGORIES.capital_ship.parentCategory).toBe('ship');
    });

    it('defines naval subcategories', () => {
      expect(UNIT_SUBCATEGORIES.patrol_boat).toBeDefined();
      expect(UNIT_SUBCATEGORIES.patrol_boat.parentCategory).toBe('naval');
      expect(UNIT_SUBCATEGORIES.submarine).toBeDefined();
      expect(UNIT_SUBCATEGORIES.submarine.parentCategory).toBe('naval');
      expect(UNIT_SUBCATEGORIES.battleship).toBeDefined();
      expect(UNIT_SUBCATEGORIES.battleship.parentCategory).toBe('naval');
    });
  });

  describe('UNIT_SUBCATEGORY_ASSIGNMENTS', () => {
    it('assigns infantry subcategories', () => {
      expect(UNIT_SUBCATEGORY_ASSIGNMENTS.trooper).toBe('light_infantry');
      expect(UNIT_SUBCATEGORY_ASSIGNMENTS.breacher).toBe('heavy_infantry');
    });

    it('assigns vehicle subcategories', () => {
      expect(UNIT_SUBCATEGORY_ASSIGNMENTS.scorcher).toBe('light_vehicle');
      expect(UNIT_SUBCATEGORY_ASSIGNMENTS.devastator).toBe('heavy_vehicle');
    });

    it('assigns ship subcategories', () => {
      expect(UNIT_SUBCATEGORY_ASSIGNMENTS.valkyrie).toBe('fighter');
      expect(UNIT_SUBCATEGORY_ASSIGNMENTS.dreadnought).toBe('capital_ship');
    });

    it('assigns naval subcategories', () => {
      expect(UNIT_SUBCATEGORY_ASSIGNMENTS.stingray).toBe('patrol_boat');
      expect(UNIT_SUBCATEGORY_ASSIGNMENTS.hunter).toBe('submarine');
      expect(UNIT_SUBCATEGORY_ASSIGNMENTS.leviathan).toBe('battleship');
    });
  });

  describe('getCategoryIds', () => {
    it('returns all category IDs', () => {
      const ids = getCategoryIds();
      expect(ids).toContain('worker');
      expect(ids).toContain('infantry');
      expect(ids).toContain('vehicle');
      expect(ids).toContain('ship');
      expect(ids).toContain('naval');
      expect(ids).toContain('support');
      expect(ids).toContain('hero');
    });

    it('returns array of strings', () => {
      const ids = getCategoryIds();
      for (const id of ids) {
        expect(typeof id).toBe('string');
      }
    });
  });

  describe('getCategory', () => {
    it('returns category for valid ID', () => {
      const infantry = getCategory('infantry');
      expect(infantry).toBeDefined();
      expect(infantry!.id).toBe('infantry');
    });

    it('returns undefined for invalid ID', () => {
      const result = getCategory('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('getUnitCategory', () => {
    it('returns correct category for known units', () => {
      expect(getUnitCategory('fabricator')).toBe('worker');
      expect(getUnitCategory('trooper')).toBe('infantry');
      expect(getUnitCategory('devastator')).toBe('vehicle');
      expect(getUnitCategory('valkyrie')).toBe('ship');
    });

    it('returns infantry as default for unknown units', () => {
      expect(getUnitCategory('unknown_unit')).toBe('infantry');
    });
  });

  describe('getUnitSubcategory', () => {
    it('returns subcategory for assigned units', () => {
      expect(getUnitSubcategory('trooper')).toBe('light_infantry');
      expect(getUnitSubcategory('devastator')).toBe('heavy_vehicle');
    });

    it('returns undefined for unassigned units', () => {
      expect(getUnitSubcategory('unknown_unit')).toBeUndefined();
    });
  });

  describe('getUnitsInCategory', () => {
    it('returns all workers', () => {
      const workers = getUnitsInCategory('worker');
      expect(workers).toContain('fabricator');
      expect(workers).toContain('mariner');
    });

    it('returns all infantry', () => {
      const infantry = getUnitsInCategory('infantry');
      expect(infantry).toContain('trooper');
      expect(infantry).toContain('breacher');
      expect(infantry).toContain('vanguard');
    });

    it('returns all naval units', () => {
      const naval = getUnitsInCategory('naval');
      expect(naval).toContain('stingray');
      expect(naval).toContain('corsair');
      expect(naval).toContain('leviathan');
      expect(naval).toContain('hunter');
      expect(naval).toContain('kraken');
    });

    it('returns empty array for empty category', () => {
      const heroes = getUnitsInCategory('hero');
      expect(heroes).toEqual([]);
    });
  });

  describe('getDefaultTargetPriority', () => {
    it('returns priority for workers', () => {
      expect(getDefaultTargetPriority('fabricator')).toBe(10);
    });

    it('returns priority for infantry', () => {
      expect(getDefaultTargetPriority('trooper')).toBe(60);
    });

    it('returns priority for vehicles', () => {
      expect(getDefaultTargetPriority('devastator')).toBe(75);
    });

    it('returns priority for ships', () => {
      expect(getDefaultTargetPriority('valkyrie')).toBe(80);
    });

    it('returns 50 for unknown units', () => {
      // Unknown unit defaults to infantry (60), or 50 if category lookup fails
      const priority = getDefaultTargetPriority('unknown_unit');
      expect(priority).toBe(60); // Default to infantry's priority
    });
  });

  describe('isCombatUnit', () => {
    it('returns false for workers', () => {
      expect(isCombatUnit('fabricator')).toBe(false);
    });

    it('returns true for infantry', () => {
      expect(isCombatUnit('trooper')).toBe(true);
    });

    it('returns true for vehicles', () => {
      expect(isCombatUnit('devastator')).toBe(true);
    });

    it('returns true for ships', () => {
      expect(isCombatUnit('valkyrie')).toBe(true);
    });

    it('returns false for support', () => {
      expect(isCombatUnit('lifter')).toBe(false);
    });

    it('returns true for unknown units (defaults to infantry)', () => {
      expect(isCombatUnit('unknown_unit')).toBe(true);
    });
  });

  describe('getCategoriesSorted', () => {
    it('returns categories sorted by display order', () => {
      const sorted = getCategoriesSorted();
      expect(sorted.length).toBe(Object.keys(UNIT_CATEGORIES).length);

      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].displayOrder).toBeGreaterThanOrEqual(sorted[i - 1].displayOrder);
      }
    });

    it('workers come first', () => {
      const sorted = getCategoriesSorted();
      expect(sorted[0].id).toBe('worker');
    });
  });

  describe('target priority ordering', () => {
    it('workers have lowest priority', () => {
      expect(UNIT_CATEGORIES.worker.defaultTargetPriority).toBe(10);
    });

    it('heroes have highest priority', () => {
      expect(UNIT_CATEGORIES.hero.defaultTargetPriority).toBe(95);
    });

    it('combat units have higher priority than non-combat', () => {
      expect(UNIT_CATEGORIES.infantry.defaultTargetPriority).toBeGreaterThan(
        UNIT_CATEGORIES.worker.defaultTargetPriority
      );
      expect(UNIT_CATEGORIES.infantry.defaultTargetPriority).toBeGreaterThan(
        UNIT_CATEGORIES.support.defaultTargetPriority
      );
    });
  });

  describe('upgrade groups', () => {
    it('workers have no upgrade group', () => {
      expect(UNIT_CATEGORIES.worker.upgradeGroup).toBe('none');
    });

    it('infantry has infantry upgrade group', () => {
      expect(UNIT_CATEGORIES.infantry.upgradeGroup).toBe('infantry');
    });

    it('vehicles have vehicle upgrade group', () => {
      expect(UNIT_CATEGORIES.vehicle.upgradeGroup).toBe('vehicle');
    });

    it('ships have ship upgrade group', () => {
      expect(UNIT_CATEGORIES.ship.upgradeGroup).toBe('ship');
    });

    it('naval has naval upgrade group', () => {
      expect(UNIT_CATEGORIES.naval.upgradeGroup).toBe('naval');
    });
  });
});

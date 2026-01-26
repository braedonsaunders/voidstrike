import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DefinitionRegistryClass } from '@/engine/definitions/DefinitionRegistry';
import type {
  UnitDefinition,
  BuildingDefinition,
  ResearchDefinition,
  AbilityDefinition,
  WallDefinition,
  WallUpgradeDefinition,
} from '@/engine/definitions/types';

// Factory functions for test data
function createUnitDefinition(overrides: Partial<UnitDefinition> = {}): UnitDefinition {
  return {
    id: 'test_unit',
    name: 'Test Unit',
    faction: 'test_faction',
    mineralCost: 50,
    vespeneCost: 0,
    buildTime: 10,
    supplyCost: 1,
    speed: 2.5,
    acceleration: 3,
    sightRange: 8,
    attackRange: 5,
    attackDamage: 10,
    attackSpeed: 1,
    maxHealth: 100,
    armor: 0,
    armorType: 'light',
    damageType: 'normal',
    canAttackGround: true,
    canAttackAir: false,
    ...overrides,
  } as UnitDefinition;
}

function createBuildingDefinition(overrides: Partial<BuildingDefinition> = {}): BuildingDefinition {
  return {
    id: 'test_building',
    name: 'Test Building',
    faction: 'test_faction',
    mineralCost: 100,
    vespeneCost: 0,
    buildTime: 30,
    width: 3,
    height: 3,
    maxHealth: 500,
    armor: 1,
    sightRange: 10,
    canProduce: [],
    canResearch: [],
    requirements: [],
    ...overrides,
  } as BuildingDefinition;
}

function createResearchDefinition(overrides: Partial<ResearchDefinition> = {}): ResearchDefinition {
  return {
    id: 'test_research',
    name: 'Test Research',
    description: 'A test research upgrade',
    faction: 'test_faction',
    mineralCost: 100,
    vespeneCost: 100,
    researchTime: 60,
    effects: [{ type: 'damage_bonus', value: 0.1 }],
    ...overrides,
  } as ResearchDefinition;
}

function createAbilityDefinition(overrides: Partial<AbilityDefinition> = {}): AbilityDefinition {
  return {
    id: 'test_ability',
    name: 'Test Ability',
    description: 'A test ability',
    cooldown: 10,
    energyCost: 50,
    range: 8,
    targetType: 'unit',
    hotkey: 'Q',
    ...overrides,
  } as AbilityDefinition;
}

describe('DefinitionRegistry', () => {
  let registry: DefinitionRegistryClass;

  beforeEach(() => {
    registry = new DefinitionRegistryClass();
  });

  describe('initialization', () => {
    it('starts uninitialized', () => {
      expect(registry.isInitialized()).toBe(false);
    });

    it('reports empty stats when uninitialized', () => {
      const stats = registry.getStats();
      expect(stats.factions).toBe(0);
      expect(stats.units).toBe(0);
      expect(stats.buildings).toBe(0);
      expect(stats.research).toBe(0);
      expect(stats.abilities).toBe(0);
    });

    it('returns empty arrays for faction queries when uninitialized', () => {
      expect(registry.getFactionIds()).toEqual([]);
    });
  });

  describe('registerFaction', () => {
    it('registers a faction with minimal data', () => {
      registry.registerFaction('test_faction', {
        units: {},
        buildings: {},
        research: {},
        abilities: {},
      });

      expect(registry.isInitialized()).toBe(true);
      expect(registry.getFactionIds()).toContain('test_faction');
    });

    it('registers faction with full data', () => {
      const unit = createUnitDefinition();
      const building = createBuildingDefinition();
      const research = createResearchDefinition();
      const ability = createAbilityDefinition();

      registry.registerFaction('test_faction', {
        manifest: { name: 'Test Faction', description: 'A test faction' },
        units: { test_unit: unit },
        buildings: { test_building: building },
        research: { test_research: research },
        abilities: { test_ability: ability },
      });

      const stats = registry.getStats();
      expect(stats.factions).toBe(1);
      expect(stats.units).toBe(1);
      expect(stats.buildings).toBe(1);
      expect(stats.research).toBe(1);
      expect(stats.abilities).toBe(1);
    });

    it('registers multiple factions', () => {
      registry.registerFaction('faction_a', {
        units: { unit_a: createUnitDefinition({ id: 'unit_a' }) },
        buildings: {},
        research: {},
        abilities: {},
      });

      registry.registerFaction('faction_b', {
        units: { unit_b: createUnitDefinition({ id: 'unit_b' }) },
        buildings: {},
        research: {},
        abilities: {},
      });

      expect(registry.getFactionIds()).toHaveLength(2);
      expect(registry.getStats().units).toBe(2);
    });

    it('includes walls and wall upgrades', () => {
      const wall: WallDefinition = {
        ...createBuildingDefinition({ id: 'test_wall' }),
        isWall: true,
      } as WallDefinition;

      const wallUpgrade: WallUpgradeDefinition = {
        id: 'reinforced',
        name: 'Reinforced',
        description: 'Stronger walls',
        researchCost: { minerals: 100, vespene: 50 },
        researchTime: 60,
        applyCost: { minerals: 25, vespene: 0 },
        applyTime: 5,
        researchBuilding: 'arsenal',
      };

      registry.registerFaction('test_faction', {
        units: {},
        buildings: {},
        research: {},
        abilities: {},
        walls: { test_wall: wall },
        wallUpgrades: { reinforced: wallUpgrade },
      });

      expect(registry.getWall('test_wall')).toBeDefined();
      expect(registry.getWallUpgrade('reinforced')).toBeDefined();
    });

    it('includes unit types', () => {
      registry.registerFaction('test_faction', {
        units: { test_unit: createUnitDefinition() },
        buildings: {},
        research: {},
        abilities: {},
        unitTypes: { test_unit: 'infantry' },
      });

      expect(registry.getUnitType('test_unit')).toBe('infantry');
    });

    it('includes addon units', () => {
      registry.registerFaction('test_faction', {
        units: {},
        buildings: { infantry_bay: createBuildingDefinition({ id: 'infantry_bay' }) },
        research: {},
        abilities: {},
        addonUnits: {
          researchModule: { infantry_bay: ['breacher', 'operative'] },
          productionModule: { infantry_bay: ['trooper'] },
        },
      });

      expect(registry.getResearchModuleUnits('infantry_bay')).toEqual(['breacher', 'operative']);
      expect(registry.getProductionModuleUnits('infantry_bay')).toEqual(['trooper']);
    });
  });

  describe('unit access', () => {
    beforeEach(() => {
      registry.registerFaction('faction_a', {
        units: {
          unit_a: createUnitDefinition({ id: 'unit_a', faction: 'faction_a' }),
          unit_b: createUnitDefinition({ id: 'unit_b', faction: 'faction_a' }),
        },
        buildings: {},
        research: {},
        abilities: {},
      });
    });

    it('gets unit by ID', () => {
      const unit = registry.getUnit('unit_a');
      expect(unit).toBeDefined();
      expect(unit?.id).toBe('unit_a');
    });

    it('returns undefined for unknown unit', () => {
      expect(registry.getUnit('nonexistent')).toBeUndefined();
    });

    it('gets all units', () => {
      const allUnits = registry.getAllUnits();
      expect(Object.keys(allUnits)).toHaveLength(2);
      expect(allUnits.unit_a).toBeDefined();
      expect(allUnits.unit_b).toBeDefined();
    });

    it('gets units by faction', () => {
      registry.registerFaction('faction_b', {
        units: { unit_c: createUnitDefinition({ id: 'unit_c', faction: 'faction_b' }) },
        buildings: {},
        research: {},
        abilities: {},
      });

      const factionAUnits = registry.getUnitsByFaction('faction_a');
      expect(Object.keys(factionAUnits)).toHaveLength(2);

      const factionBUnits = registry.getUnitsByFaction('faction_b');
      expect(Object.keys(factionBUnits)).toHaveLength(1);
    });

    it('returns empty object for unknown faction', () => {
      const units = registry.getUnitsByFaction('nonexistent');
      expect(units).toEqual({});
    });
  });

  describe('building access', () => {
    beforeEach(() => {
      registry.registerFaction('test_faction', {
        units: {},
        buildings: {
          building_a: createBuildingDefinition({ id: 'building_a' }),
          building_b: createBuildingDefinition({ id: 'building_b' }),
        },
        research: {},
        abilities: {},
      });
    });

    it('gets building by ID', () => {
      const building = registry.getBuilding('building_a');
      expect(building).toBeDefined();
      expect(building?.id).toBe('building_a');
    });

    it('returns undefined for unknown building', () => {
      expect(registry.getBuilding('nonexistent')).toBeUndefined();
    });

    it('gets all buildings', () => {
      const allBuildings = registry.getAllBuildings();
      expect(Object.keys(allBuildings)).toHaveLength(2);
    });

    it('gets buildings by faction', () => {
      const buildings = registry.getBuildingsByFaction('test_faction');
      expect(Object.keys(buildings)).toHaveLength(2);
    });
  });

  describe('research access', () => {
    beforeEach(() => {
      registry.registerFaction('test_faction', {
        units: {},
        buildings: {},
        research: {
          research_a: createResearchDefinition({ id: 'research_a' }),
          research_b: createResearchDefinition({ id: 'research_b' }),
        },
        abilities: {},
      });
    });

    it('gets research by ID', () => {
      const research = registry.getResearch('research_a');
      expect(research).toBeDefined();
      expect(research?.id).toBe('research_a');
    });

    it('returns undefined for unknown research', () => {
      expect(registry.getResearch('nonexistent')).toBeUndefined();
    });

    it('gets all research', () => {
      const allResearch = registry.getAllResearch();
      expect(Object.keys(allResearch)).toHaveLength(2);
    });

    it('gets research by faction', () => {
      const research = registry.getResearchByFaction('test_faction');
      expect(Object.keys(research)).toHaveLength(2);
    });
  });

  describe('ability access', () => {
    beforeEach(() => {
      registry.registerFaction('test_faction', {
        units: {},
        buildings: {},
        research: {},
        abilities: {
          ability_a: createAbilityDefinition({ id: 'ability_a' }),
          ability_b: createAbilityDefinition({ id: 'ability_b' }),
        },
      });
    });

    it('gets ability by ID', () => {
      const ability = registry.getAbility('ability_a');
      expect(ability).toBeDefined();
      expect(ability?.id).toBe('ability_a');
    });

    it('returns undefined for unknown ability', () => {
      expect(registry.getAbility('nonexistent')).toBeUndefined();
    });

    it('gets all abilities', () => {
      const allAbilities = registry.getAllAbilities();
      expect(Object.keys(allAbilities)).toHaveLength(2);
    });

    it('gets abilities by faction', () => {
      const abilities = registry.getAbilitiesByFaction('test_faction');
      expect(Object.keys(abilities)).toHaveLength(2);
    });
  });

  describe('wall access', () => {
    beforeEach(() => {
      const wall: WallDefinition = {
        ...createBuildingDefinition({ id: 'wall_segment' }),
        isWall: true,
      } as WallDefinition;

      registry.registerFaction('test_faction', {
        units: {},
        buildings: {},
        research: {},
        abilities: {},
        walls: { wall_segment: wall },
        wallUpgrades: {
          reinforced: {
            id: 'reinforced',
            name: 'Reinforced',
            description: 'Stronger walls',
            researchCost: { minerals: 100, vespene: 50 },
            researchTime: 60,
            applyCost: { minerals: 25, vespene: 0 },
            applyTime: 5,
            researchBuilding: 'arsenal',
          },
        },
      });
    });

    it('gets wall by ID', () => {
      const wall = registry.getWall('wall_segment');
      expect(wall).toBeDefined();
      expect(wall?.isWall).toBe(true);
    });

    it('returns undefined for unknown wall', () => {
      expect(registry.getWall('nonexistent')).toBeUndefined();
    });

    it('gets all walls', () => {
      const allWalls = registry.getAllWalls();
      expect(Object.keys(allWalls)).toHaveLength(1);
    });

    it('gets wall upgrade by ID', () => {
      const upgrade = registry.getWallUpgrade('reinforced');
      expect(upgrade).toBeDefined();
      expect(upgrade?.id).toBe('reinforced');
    });

    it('gets all wall upgrades', () => {
      const allUpgrades = registry.getAllWallUpgrades();
      expect(Object.keys(allUpgrades)).toHaveLength(1);
    });
  });

  describe('faction access', () => {
    beforeEach(() => {
      registry.registerFaction('faction_a', {
        manifest: { name: 'Faction A' },
        units: {},
        buildings: {},
        research: {},
        abilities: {},
      });
      registry.registerFaction('faction_b', {
        manifest: { name: 'Faction B' },
        units: {},
        buildings: {},
        research: {},
        abilities: {},
      });
    });

    it('gets all faction IDs', () => {
      const ids = registry.getFactionIds();
      expect(ids).toContain('faction_a');
      expect(ids).toContain('faction_b');
    });

    it('gets faction by ID', () => {
      const faction = registry.getFaction('faction_a');
      expect(faction).toBeDefined();
      expect(faction?.manifest.name).toBe('Faction A');
    });

    it('returns undefined for unknown faction', () => {
      expect(registry.getFaction('nonexistent')).toBeUndefined();
    });

    it('gets default faction ID', () => {
      const defaultId = registry.getDefaultFactionId();
      // Without a game manifest, returns first faction
      expect(['faction_a', 'faction_b']).toContain(defaultId);
    });
  });

  describe('utility methods', () => {
    beforeEach(() => {
      registry.registerFaction('test_faction', {
        units: {
          trooper: createUnitDefinition({ id: 'trooper' }),
          breacher: createUnitDefinition({ id: 'breacher' }),
        },
        buildings: {
          infantry_bay: createBuildingDefinition({
            id: 'infantry_bay',
            canProduce: ['trooper'],
            canResearch: ['infantry_weapons_1'],
          }),
        },
        research: {
          infantry_weapons_1: createResearchDefinition({ id: 'infantry_weapons_1' }),
        },
        abilities: {},
        addonUnits: {
          researchModule: { infantry_bay: ['breacher'] },
          productionModule: {},
        },
      });
    });

    it('gets available research for building', () => {
      const research = registry.getAvailableResearch('infantry_bay');
      expect(research).toHaveLength(1);
      expect(research[0].id).toBe('infantry_weapons_1');
    });

    it('returns empty array for building without research', () => {
      registry.registerFaction('test_faction_2', {
        units: {},
        buildings: {
          supply_depot: createBuildingDefinition({ id: 'supply_depot', canResearch: [] }),
        },
        research: {},
        abilities: {},
      });

      const research = registry.getAvailableResearch('supply_depot');
      expect(research).toHaveLength(0);
    });

    it('returns empty array for unknown building', () => {
      const research = registry.getAvailableResearch('nonexistent');
      expect(research).toHaveLength(0);
    });

    it('gets produceable units without research module', () => {
      const units = registry.getProduceableUnits('infantry_bay', false);
      expect(units).toHaveLength(1);
      expect(units[0].id).toBe('trooper');
    });

    it('gets produceable units with research module', () => {
      const units = registry.getProduceableUnits('infantry_bay', true);
      expect(units).toHaveLength(2);
      expect(units.map(u => u.id)).toContain('trooper');
      expect(units.map(u => u.id)).toContain('breacher');
    });

    it('returns empty array for unknown building', () => {
      const units = registry.getProduceableUnits('nonexistent');
      expect(units).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('clears all registered data', () => {
      registry.registerFaction('test_faction', {
        units: { unit_a: createUnitDefinition() },
        buildings: { building_a: createBuildingDefinition() },
        research: { research_a: createResearchDefinition() },
        abilities: { ability_a: createAbilityDefinition() },
      });

      expect(registry.isInitialized()).toBe(true);

      registry.clear();

      expect(registry.isInitialized()).toBe(false);
      expect(registry.getStats().factions).toBe(0);
      expect(registry.getStats().units).toBe(0);
      expect(registry.getFactionIds()).toHaveLength(0);
    });
  });

  describe('unit types', () => {
    beforeEach(() => {
      registry.registerFaction('test_faction', {
        units: {
          trooper: createUnitDefinition({ id: 'trooper' }),
          devastator: createUnitDefinition({ id: 'devastator' }),
        },
        buildings: {},
        research: {},
        abilities: {},
        unitTypes: {
          trooper: 'infantry',
          devastator: 'vehicle',
        },
      });
    });

    it('gets unit type for known unit', () => {
      expect(registry.getUnitType('trooper')).toBe('infantry');
      expect(registry.getUnitType('devastator')).toBe('vehicle');
    });

    it('returns undefined for unit without type', () => {
      registry.registerFaction('test_faction_2', {
        units: { unknown_unit: createUnitDefinition({ id: 'unknown_unit' }) },
        buildings: {},
        research: {},
        abilities: {},
      });

      expect(registry.getUnitType('unknown_unit')).toBeUndefined();
    });

    it('gets all unit types', () => {
      const types = registry.getUnitTypes();
      expect(Object.keys(types)).toHaveLength(2);
      expect(types.trooper).toBe('infantry');
      expect(types.devastator).toBe('vehicle');
    });
  });

  describe('addon units', () => {
    beforeEach(() => {
      registry.registerFaction('test_faction', {
        units: {},
        buildings: {
          infantry_bay: createBuildingDefinition({ id: 'infantry_bay' }),
          forge: createBuildingDefinition({ id: 'forge' }),
        },
        research: {},
        abilities: {},
        addonUnits: {
          researchModule: {
            infantry_bay: ['breacher', 'operative'],
            forge: ['devastator'],
          },
          productionModule: {
            infantry_bay: ['trooper', 'breacher'],
          },
        },
      });
    });

    it('gets research module units for building', () => {
      expect(registry.getResearchModuleUnits('infantry_bay')).toEqual(['breacher', 'operative']);
      expect(registry.getResearchModuleUnits('forge')).toEqual(['devastator']);
    });

    it('returns empty array for building without research module units', () => {
      expect(registry.getResearchModuleUnits('unknown_building')).toEqual([]);
    });

    it('gets all research module units', () => {
      const all = registry.getAllResearchModuleUnits();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all.infantry_bay).toEqual(['breacher', 'operative']);
    });

    it('gets production module units for building', () => {
      expect(registry.getProductionModuleUnits('infantry_bay')).toEqual(['trooper', 'breacher']);
    });

    it('returns empty array for building without production module units', () => {
      expect(registry.getProductionModuleUnits('forge')).toEqual([]);
    });

    it('gets all production module units', () => {
      const all = registry.getAllProductionModuleUnits();
      expect(Object.keys(all)).toHaveLength(1);
    });
  });

  describe('stats', () => {
    it('reports accurate statistics', () => {
      registry.registerFaction('faction_a', {
        units: {
          unit_1: createUnitDefinition({ id: 'unit_1' }),
          unit_2: createUnitDefinition({ id: 'unit_2' }),
        },
        buildings: {
          building_1: createBuildingDefinition({ id: 'building_1' }),
        },
        research: {
          research_1: createResearchDefinition({ id: 'research_1' }),
          research_2: createResearchDefinition({ id: 'research_2' }),
          research_3: createResearchDefinition({ id: 'research_3' }),
        },
        abilities: {},
      });

      registry.registerFaction('faction_b', {
        units: { unit_3: createUnitDefinition({ id: 'unit_3' }) },
        buildings: {},
        research: {},
        abilities: { ability_1: createAbilityDefinition({ id: 'ability_1' }) },
      });

      const stats = registry.getStats();
      expect(stats.factions).toBe(2);
      expect(stats.units).toBe(3);
      expect(stats.buildings).toBe(1);
      expect(stats.research).toBe(3);
      expect(stats.abilities).toBe(1);
    });
  });
});

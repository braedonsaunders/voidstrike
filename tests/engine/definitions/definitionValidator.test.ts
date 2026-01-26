import { describe, it, expect, beforeEach } from 'vitest';
import { DefinitionValidator } from '@/engine/definitions/DefinitionValidator';
import type {
  UnitDefinition,
  BuildingDefinition,
  ResearchDefinition,
  AbilityDefinition,
} from '@/engine/definitions/types';

describe('DefinitionValidator', () => {
  let validator: DefinitionValidator;

  beforeEach(() => {
    validator = new DefinitionValidator();
  });

  describe('validateGameManifest', () => {
    it('validates valid game manifest', () => {
      const manifest = {
        name: 'Test Game',
        version: '1.0.0',
        description: 'A test game',
        factions: ['factions/test_faction'],
        defaultFaction: 'test_faction',
      };

      const result = validator.validateGameManifest(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates minimal valid manifest', () => {
      const manifest = {
        name: 'Test',
        version: '1.0',
        factions: ['faction1'],
      };

      const result = validator.validateGameManifest(manifest);
      expect(result.valid).toBe(true);
    });

    it('rejects non-object manifest', () => {
      const result = validator.validateGameManifest('not an object');
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('invalid_type');
    });

    it('rejects null manifest', () => {
      const result = validator.validateGameManifest(null);
      expect(result.valid).toBe(false);
    });

    it('rejects manifest with missing name', () => {
      const manifest = {
        version: '1.0',
        factions: ['faction1'],
      };

      const result = validator.validateGameManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('name'))).toBe(true);
    });

    it('rejects manifest with missing version', () => {
      const manifest = {
        name: 'Test',
        factions: ['faction1'],
      };

      const result = validator.validateGameManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('version'))).toBe(true);
    });

    it('rejects manifest with non-array factions', () => {
      const manifest = {
        name: 'Test',
        version: '1.0',
        factions: 'not an array',
      };

      const result = validator.validateGameManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('factions'))).toBe(true);
    });

    it('rejects manifest with empty factions array', () => {
      const manifest = {
        name: 'Test',
        version: '1.0',
        factions: [],
      };

      const result = validator.validateGameManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('At least one faction'))).toBe(true);
    });

    it('rejects manifest with non-string faction entries', () => {
      const manifest = {
        name: 'Test',
        version: '1.0',
        factions: [123, null],
      };

      const result = validator.validateGameManifest(manifest);
      expect(result.valid).toBe(false);
    });
  });

  describe('validateFactionManifest', () => {
    function createValidFactionManifest() {
      return {
        id: 'test_faction',
        name: 'Test Faction',
        description: 'A test faction',
        color: '#FF0000',
        icon: 'faction_icon.png',
        unitsFile: 'units.json',
        buildingsFile: 'buildings.json',
        researchFile: 'research.json',
        abilitiesFile: 'abilities.json',
        wallsFile: 'walls.json',
        wallUpgradesFile: 'wall_upgrades.json',
      };
    }

    it('validates valid faction manifest', () => {
      const result = validator.validateFactionManifest(createValidFactionManifest());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates manifest without optional fields', () => {
      const manifest = {
        id: 'test',
        name: 'Test',
        description: 'Desc',
        color: '#000',
        unitsFile: 'units.json',
        buildingsFile: 'buildings.json',
        researchFile: 'research.json',
        abilitiesFile: 'abilities.json',
      };

      const result = validator.validateFactionManifest(manifest);
      expect(result.valid).toBe(true);
    });

    it('rejects manifest with missing id', () => {
      const manifest = createValidFactionManifest();
      delete (manifest as any).id;

      const result = validator.validateFactionManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('id'))).toBe(true);
    });

    it('rejects manifest with missing required files', () => {
      const manifest = {
        id: 'test',
        name: 'Test',
        description: 'Desc',
        color: '#000',
      };

      const result = validator.validateFactionManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('unitsFile'))).toBe(true);
      expect(result.errors.some((e) => e.path.includes('buildingsFile'))).toBe(true);
    });

    it('rejects non-object manifest', () => {
      const result = validator.validateFactionManifest([]);
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('invalid_type');
    });
  });

  describe('validateUnitDefinition', () => {
    function createValidUnit(): Record<string, unknown> {
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
      };
    }

    it('validates valid unit definition', () => {
      const result = validator.validateUnitDefinition(createValidUnit(), 'test_unit');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates unit with all optional fields', () => {
      const unit = {
        ...createValidUnit(),
        description: 'A test unit',
        isWorker: true,
        isFlying: false,
        isBiological: true,
        isMechanical: false,
        canCloak: false,
        isTransport: false,
        isDetector: false,
        canHeal: false,
        canRepair: false,
        canTransform: false,
        splashRadius: 0,
        cloakEnergyCost: 0,
        transportCapacity: 0,
        detectionRange: 0,
        healRange: 0,
        healRate: 0,
        healEnergyCost: 0,
        abilities: ['ability1', 'ability2'],
      };

      const result = validator.validateUnitDefinition(unit, 'test_unit');
      expect(result.valid).toBe(true);
    });

    it('rejects unit with missing required fields', () => {
      const result = validator.validateUnitDefinition({}, 'test_unit');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects unit with invalid damage type', () => {
      const unit = {
        ...createValidUnit(),
        damageType: 'invalid_type',
      };

      const result = validator.validateUnitDefinition(unit, 'test_unit');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('damageType'))).toBe(true);
    });

    it('accepts all valid damage types', () => {
      const damageTypes = ['normal', 'explosive', 'concussive', 'psionic'];

      for (const damageType of damageTypes) {
        const unit = { ...createValidUnit(), damageType };
        const result = validator.validateUnitDefinition(unit, 'test_unit');
        expect(result.valid).toBe(true);
      }
    });

    it('rejects unit with negative costs', () => {
      const unit = {
        ...createValidUnit(),
        mineralCost: -50,
      };

      const result = validator.validateUnitDefinition(unit, 'test_unit');
      expect(result.valid).toBe(false);
    });

    it('rejects unit with zero maxHealth', () => {
      const unit = {
        ...createValidUnit(),
        maxHealth: 0,
      };

      const result = validator.validateUnitDefinition(unit, 'test_unit');
      expect(result.valid).toBe(false);
    });

    it('warns when id does not match key', () => {
      const unit = createValidUnit();
      const result = validator.validateUnitDefinition(unit, 'different_key');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].message).toContain('does not match');
    });

    it('validates transform modes when canTransform is true', () => {
      const unit = {
        ...createValidUnit(),
        canTransform: true,
        defaultMode: 'mode1',
        transformModes: [
          {
            id: 'mode1',
            name: 'Mode 1',
            speed: 2,
            attackRange: 5,
            attackDamage: 10,
            attackSpeed: 1,
            sightRange: 8,
            transformTime: 2,
            canMove: true,
          },
        ],
      };

      const result = validator.validateUnitDefinition(unit, 'test_unit');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid transform modes', () => {
      const unit = {
        ...createValidUnit(),
        canTransform: true,
        transformModes: 'not an array',
      };

      const result = validator.validateUnitDefinition(unit, 'test_unit');
      expect(result.valid).toBe(false);
    });

    it('rejects transform mode with missing required fields', () => {
      const unit = {
        ...createValidUnit(),
        canTransform: true,
        transformModes: [
          {
            id: 'mode1',
            // Missing other required fields
          },
        ],
      };

      const result = validator.validateUnitDefinition(unit, 'test_unit');
      expect(result.valid).toBe(false);
    });

    it('validates abilities as string array', () => {
      const unit = {
        ...createValidUnit(),
        abilities: [123, null], // Invalid
      };

      const result = validator.validateUnitDefinition(unit, 'test_unit');
      expect(result.valid).toBe(false);
    });

    it('rejects non-object unit', () => {
      const result = validator.validateUnitDefinition(null, 'test_unit');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateBuildingDefinition', () => {
    function createValidBuilding(): Record<string, unknown> {
      return {
        id: 'test_building',
        name: 'Test Building',
        faction: 'test_faction',
        mineralCost: 150,
        vespeneCost: 0,
        buildTime: 60,
        width: 3,
        height: 3,
        maxHealth: 1500,
        armor: 1,
        sightRange: 10,
      };
    }

    it('validates valid building definition', () => {
      const result = validator.validateBuildingDefinition(createValidBuilding(), 'test_building');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates building with all optional fields', () => {
      const building = {
        ...createValidBuilding(),
        description: 'A test building',
        supplyProvided: 8,
        canLiftOff: true,
        canHaveAddon: true,
        isAddon: false,
        isBunker: false,
        canLower: false,
        isDetector: true,
        bunkerCapacity: 0,
        detectionRange: 10,
        attackRange: 6,
        attackDamage: 20,
        attackSpeed: 1.5,
        canProduce: ['unit1', 'unit2'],
        canResearch: ['research1'],
        requirements: ['building1'],
        addonFor: ['main_building'],
        canUpgradeTo: ['upgraded_building'],
      };

      const result = validator.validateBuildingDefinition(building, 'test_building');
      expect(result.valid).toBe(true);
    });

    it('rejects building with missing required fields', () => {
      const result = validator.validateBuildingDefinition({}, 'test_building');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects building with invalid dimensions', () => {
      const building = {
        ...createValidBuilding(),
        width: 0,
        height: -1,
      };

      const result = validator.validateBuildingDefinition(building, 'test_building');
      expect(result.valid).toBe(false);
    });

    it('rejects building with zero maxHealth', () => {
      const building = {
        ...createValidBuilding(),
        maxHealth: 0,
      };

      const result = validator.validateBuildingDefinition(building, 'test_building');
      expect(result.valid).toBe(false);
    });

    it('warns when id does not match key', () => {
      const building = createValidBuilding();
      const result = validator.validateBuildingDefinition(building, 'different_key');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('validates canProduce as string array', () => {
      const building = {
        ...createValidBuilding(),
        canProduce: [123], // Invalid
      };

      const result = validator.validateBuildingDefinition(building, 'test_building');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateResearchDefinition', () => {
    function createValidResearch(): Record<string, unknown> {
      return {
        id: 'test_research',
        name: 'Test Research',
        description: 'A test research',
        faction: 'test_faction',
        mineralCost: 100,
        vespeneCost: 100,
        researchTime: 120,
        effects: [
          {
            type: 'damage_bonus',
            value: 1,
          },
        ],
      };
    }

    it('validates valid research definition', () => {
      const result = validator.validateResearchDefinition(createValidResearch(), 'test_research');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates research with all optional fields', () => {
      const research = {
        ...createValidResearch(),
        level: 1,
        nextLevel: 'test_research_2',
        icon: 'research_icon.png',
        requirements: ['building1', 'research1'],
      };

      const result = validator.validateResearchDefinition(research, 'test_research');
      expect(result.valid).toBe(true);
    });

    it('validates all effect types', () => {
      const effectTypes = [
        'damage_bonus',
        'armor_bonus',
        'attack_speed',
        'ability_unlock',
        'range_bonus',
        'health_bonus',
        'speed_bonus',
      ];

      for (const type of effectTypes) {
        const research = {
          ...createValidResearch(),
          effects: [{ type, value: 1 }],
        };
        const result = validator.validateResearchDefinition(research, 'test_research');
        expect(result.valid).toBe(true);
      }
    });

    it('rejects research with invalid effect type', () => {
      const research = {
        ...createValidResearch(),
        effects: [{ type: 'invalid_type', value: 1 }],
      };

      const result = validator.validateResearchDefinition(research, 'test_research');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('type'))).toBe(true);
    });

    it('rejects research with non-array effects', () => {
      const research = {
        ...createValidResearch(),
        effects: 'not an array',
      };

      const result = validator.validateResearchDefinition(research, 'test_research');
      expect(result.valid).toBe(false);
    });

    it('rejects effect with missing value', () => {
      const research = {
        ...createValidResearch(),
        effects: [{ type: 'damage_bonus' }],
      };

      const result = validator.validateResearchDefinition(research, 'test_research');
      expect(result.valid).toBe(false);
    });

    it('validates effect with targets array', () => {
      const research = {
        ...createValidResearch(),
        effects: [{ type: 'damage_bonus', value: 1, targets: ['unit1', 'unit2'] }],
      };

      const result = validator.validateResearchDefinition(research, 'test_research');
      expect(result.valid).toBe(true);
    });

    it('validates effect with unitTypes', () => {
      const research = {
        ...createValidResearch(),
        effects: [{ type: 'armor_bonus', value: 1, unitTypes: ['infantry', 'vehicle'] }],
      };

      const result = validator.validateResearchDefinition(research, 'test_research');
      expect(result.valid).toBe(true);
    });

    it('rejects effect with invalid unitTypes', () => {
      const research = {
        ...createValidResearch(),
        effects: [{ type: 'armor_bonus', value: 1, unitTypes: ['invalid_type'] }],
      };

      const result = validator.validateResearchDefinition(research, 'test_research');
      expect(result.valid).toBe(false);
    });

    it('rejects effect with non-array unitTypes', () => {
      const research = {
        ...createValidResearch(),
        effects: [{ type: 'armor_bonus', value: 1, unitTypes: 'infantry' }],
      };

      const result = validator.validateResearchDefinition(research, 'test_research');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateAbilityDefinition', () => {
    function createValidAbility(): Record<string, unknown> {
      return {
        id: 'test_ability',
        name: 'Test Ability',
        description: 'A test ability',
        cooldown: 10,
        energyCost: 50,
        range: 8,
        hotkey: 'Q',
        targetType: 'unit',
      };
    }

    it('validates valid ability definition', () => {
      const result = validator.validateAbilityDefinition(createValidAbility(), 'test_ability');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates ability with all optional fields', () => {
      const ability = {
        ...createValidAbility(),
        iconId: 'ability_icon',
        damage: 100,
        healing: 0,
        duration: 5,
        aoeRadius: 2,
        buffId: 'buff1',
      };

      const result = validator.validateAbilityDefinition(ability, 'test_ability');
      expect(result.valid).toBe(true);
    });

    it('validates all target types', () => {
      const targetTypes = ['none', 'point', 'unit', 'ally', 'self'];

      for (const targetType of targetTypes) {
        const ability = { ...createValidAbility(), targetType };
        const result = validator.validateAbilityDefinition(ability, 'test_ability');
        expect(result.valid).toBe(true);
      }
    });

    it('rejects ability with invalid target type', () => {
      const ability = {
        ...createValidAbility(),
        targetType: 'invalid_target',
      };

      const result = validator.validateAbilityDefinition(ability, 'test_ability');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('targetType'))).toBe(true);
    });

    it('rejects ability with missing required fields', () => {
      const result = validator.validateAbilityDefinition({}, 'test_ability');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects ability with negative cooldown', () => {
      const ability = {
        ...createValidAbility(),
        cooldown: -5,
      };

      const result = validator.validateAbilityDefinition(ability, 'test_ability');
      expect(result.valid).toBe(false);
    });

    it('rejects ability with negative energy cost', () => {
      const ability = {
        ...createValidAbility(),
        energyCost: -10,
      };

      const result = validator.validateAbilityDefinition(ability, 'test_ability');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateReferences', () => {
    function createTestData() {
      const units: Record<string, UnitDefinition> = {
        unit1: {
          id: 'unit1',
          name: 'Unit 1',
          faction: 'test',
          abilities: ['ability1'],
        } as UnitDefinition,
        unit2: {
          id: 'unit2',
          name: 'Unit 2',
          faction: 'test',
        } as UnitDefinition,
      };

      const buildings: Record<string, BuildingDefinition> = {
        building1: {
          id: 'building1',
          name: 'Building 1',
          faction: 'test',
          canProduce: ['unit1'],
          canResearch: ['research1'],
        } as BuildingDefinition,
        building2: {
          id: 'building2',
          name: 'Building 2',
          faction: 'test',
          requirements: ['building1'],
          canUpgradeTo: ['building3'],
        } as BuildingDefinition,
        building3: {
          id: 'building3',
          name: 'Building 3',
          faction: 'test',
        } as BuildingDefinition,
      };

      const research: Record<string, ResearchDefinition> = {
        research1: {
          id: 'research1',
          name: 'Research 1',
          description: 'Test research 1',
          faction: 'test',
          mineralCost: 100,
          vespeneCost: 100,
          researchTime: 60,
          effects: [{ type: 'damage_bonus', value: 1, targets: ['unit1'] }],
        } as ResearchDefinition,
        research2: {
          id: 'research2',
          name: 'Research 2',
          description: 'Test research 2',
          faction: 'test',
          mineralCost: 100,
          vespeneCost: 100,
          researchTime: 60,
          requirements: ['building1', 'research1'],
          nextLevel: 'research3',
          effects: [],
        } as ResearchDefinition,
        research3: {
          id: 'research3',
          name: 'Research 3',
          description: 'Test research 3',
          faction: 'test',
          mineralCost: 100,
          vespeneCost: 100,
          researchTime: 60,
          effects: [],
        } as ResearchDefinition,
      };

      const abilities: Record<string, AbilityDefinition> = {
        ability1: {
          id: 'ability1',
          name: 'Ability 1',
        } as AbilityDefinition,
      };

      return { units, buildings, research, abilities };
    }

    it('validates valid references', () => {
      const { units, buildings, research, abilities } = createTestData();
      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('detects invalid unit ability reference', () => {
      const { units, buildings, research, abilities } = createTestData();
      units.unit1.abilities = ['nonexistent_ability'];

      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('nonexistent_ability'))).toBe(true);
    });

    it('detects invalid building canProduce reference', () => {
      const { units, buildings, research, abilities } = createTestData();
      buildings.building1.canProduce = ['nonexistent_unit'];

      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('nonexistent_unit'))).toBe(true);
    });

    it('detects invalid building canResearch reference', () => {
      const { units, buildings, research, abilities } = createTestData();
      buildings.building1.canResearch = ['nonexistent_research'];

      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('nonexistent_research'))).toBe(true);
    });

    it('detects invalid building requirements reference', () => {
      const { units, buildings, research, abilities } = createTestData();
      buildings.building2.requirements = ['nonexistent_building'];

      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('nonexistent_building'))).toBe(true);
    });

    it('detects invalid building canUpgradeTo reference', () => {
      const { units, buildings, research, abilities } = createTestData();
      buildings.building2.canUpgradeTo = ['nonexistent_upgrade'];

      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('nonexistent_upgrade'))).toBe(true);
    });

    it('detects invalid research requirements reference', () => {
      const { units, buildings, research, abilities } = createTestData();
      research.research2.requirements = ['nonexistent_req'];

      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('nonexistent_req'))).toBe(true);
    });

    it('detects invalid research nextLevel reference', () => {
      const { units, buildings, research, abilities } = createTestData();
      research.research2.nextLevel = 'nonexistent_research';

      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('nonexistent_research'))).toBe(true);
    });

    it('warns for invalid effect target reference', () => {
      const { units, buildings, research, abilities } = createTestData();
      research.research1.effects = [
        { type: 'damage_bonus', value: 1, targets: ['nonexistent_target'] } as any,
      ];

      const result = validator.validateReferences(units, buildings, research, abilities);
      // Warnings don't invalidate, they just warn
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.message.includes('nonexistent_target'))).toBe(true);
    });

    it('allows research requirements to reference buildings or research', () => {
      const { units, buildings, research, abilities } = createTestData();
      research.research2.requirements = ['building1', 'research1'];

      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(true);
    });

    it('validates empty collections', () => {
      const result = validator.validateReferences({}, {}, {}, {});
      expect(result.valid).toBe(true);
    });

    it('handles units without abilities', () => {
      const { units, buildings, research, abilities } = createTestData();
      delete units.unit1.abilities;

      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(true);
    });

    it('handles buildings without optional arrays', () => {
      const { units, buildings, research, abilities } = createTestData();
      delete buildings.building1.canProduce;
      delete buildings.building1.canResearch;
      delete buildings.building2.requirements;
      delete buildings.building2.canUpgradeTo;

      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(true);
    });

    it('handles research without optional fields', () => {
      const { units, buildings, research, abilities } = createTestData();
      delete research.research2.requirements;
      delete research.research2.nextLevel;

      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(true);
    });

    it('handles effects without targets', () => {
      const { units, buildings, research, abilities } = createTestData();
      research.research1.effects = [{ type: 'damage_bonus', value: 1 } as any];

      const result = validator.validateReferences(units, buildings, research, abilities);
      expect(result.valid).toBe(true);
    });
  });

  describe('validation helpers', () => {
    it('handles NaN numbers', () => {
      const unit = {
        id: 'test',
        name: 'Test',
        faction: 'test',
        mineralCost: NaN,
        vespeneCost: 0,
        buildTime: 10,
        supplyCost: 1,
        speed: 2.5,
        sightRange: 8,
        attackRange: 5,
        attackDamage: 10,
        attackSpeed: 1,
        maxHealth: 100,
        armor: 0,
        damageType: 'normal',
      };

      const result = validator.validateUnitDefinition(unit, 'test');
      expect(result.valid).toBe(false);
    });

    it('handles empty strings', () => {
      const manifest = {
        name: '',
        version: '1.0',
        factions: ['faction1'],
      };

      const result = validator.validateGameManifest(manifest);
      expect(result.valid).toBe(false);
    });

    it('handles wrong types for optional fields', () => {
      const unit = {
        id: 'test',
        name: 'Test',
        faction: 'test',
        mineralCost: 50,
        vespeneCost: 0,
        buildTime: 10,
        supplyCost: 1,
        speed: 2.5,
        sightRange: 8,
        attackRange: 5,
        attackDamage: 10,
        attackSpeed: 1,
        maxHealth: 100,
        armor: 0,
        damageType: 'normal',
        description: 123, // Should be string
        isWorker: 'yes', // Should be boolean
        splashRadius: 'big', // Should be number
      };

      const result = validator.validateUnitDefinition(unit, 'test');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('resets errors between validations', () => {
      // First validation with errors
      validator.validateGameManifest({});
      const result1 = validator.validateGameManifest({
        name: 'Test',
        version: '1.0',
        factions: ['faction1'],
      });

      // Second validation should be clean
      expect(result1.valid).toBe(true);
      expect(result1.errors).toHaveLength(0);
    });
  });
});

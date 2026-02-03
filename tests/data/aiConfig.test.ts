import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateCondition,
  evaluateRule,
  findBestMacroRule,
  calculateUtilityScore,
  registerFactionAIConfig,
  getFactionAIConfig,
  getRegisteredFactions,
  AIStateSnapshot,
  RuleCondition,
  MacroRule,
  UtilityScore,
  FactionAIConfig,
} from '@/data/ai/aiConfig';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import '@/data/ai/factions/dominion';

// Helper to create minimal test state
function createTestState(overrides: Partial<AIStateSnapshot> = {}): AIStateSnapshot {
  const defaultConfig: Partial<FactionAIConfig> = {
    economy: {
      optimalWorkersPerMineral: 2,
      optimalWorkersPerGas: 3,
      optimalWorkersPerBase: 22,
      supplyPerMainBase: 15,
      supplyPerSupplyBuilding: 8,
      supplyBuildBuffer: 4,
      expansionMineralThreshold: 400,
      saturationExpansionRatio: 0.8,
    },
    difficultyConfig: {
      easy: { targetWorkers: 40 },
      medium: { targetWorkers: 50 },
      hard: { targetWorkers: 60 },
      very_hard: { targetWorkers: 70 },
      insane: { targetWorkers: 80 },
    } as FactionAIConfig['difficultyConfig'],
  };

  return {
    playerId: 'test-ai',
    difficulty: 'medium',
    personality: 'balanced',
    currentTick: 1000,
    minerals: 200,
    plasma: 100,
    supply: 50,
    maxSupply: 100,
    workerCount: 20,
    workerReplacementPriority: 0,
    armySupply: 30,
    armyValue: 1000,
    unitCounts: new Map(),
    depletedPatchesNearBases: 0,
    baseCount: 1,
    buildingCounts: new Map(),
    productionBuildingsCount: 2,
    enemyArmyStrength: 500,
    enemyBaseCount: 1,
    enemyAirUnits: 0,
    underAttack: false,
    hasAntiAir: false,
    config: defaultConfig as FactionAIConfig,
    ...overrides,
  };
}

describe('evaluateCondition', () => {
  describe('mineral conditions', () => {
    it('evaluates minerals > value', () => {
      const state = createTestState({ minerals: 300 });
      const condition: RuleCondition = { type: 'minerals', operator: '>', value: 200 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });

    it('evaluates minerals < value', () => {
      const state = createTestState({ minerals: 100 });
      const condition: RuleCondition = { type: 'minerals', operator: '<', value: 200 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });

    it('evaluates minerals >= value', () => {
      const state = createTestState({ minerals: 200 });
      const condition: RuleCondition = { type: 'minerals', operator: '>=', value: 200 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });

    it('evaluates minerals == value', () => {
      const state = createTestState({ minerals: 200 });
      const condition: RuleCondition = { type: 'minerals', operator: '==', value: 200 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });
  });

  describe('plasma conditions', () => {
    it('evaluates plasma > value', () => {
      const state = createTestState({ plasma: 150 });
      const condition: RuleCondition = { type: 'plasma', operator: '>', value: 100 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });
  });

  describe('supply conditions', () => {
    it('evaluates supplyRatio', () => {
      const state = createTestState({ supply: 50, maxSupply: 100 });
      const condition: RuleCondition = { type: 'supplyRatio', operator: '==', value: 0.5 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });

    it('evaluates supply >= value', () => {
      const state = createTestState({ supply: 80 });
      const condition: RuleCondition = { type: 'supply', operator: '>=', value: 50 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });
  });

  describe('worker conditions', () => {
    it('evaluates workers > value', () => {
      const state = createTestState({ workerCount: 25 });
      const condition: RuleCondition = { type: 'workers', operator: '>', value: 20 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });

    it('evaluates workerSaturation', () => {
      const state = createTestState({ workerCount: 22, baseCount: 1 });
      const condition: RuleCondition = { type: 'workerSaturation', operator: '==', value: 1 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });
  });

  describe('building and unit counts', () => {
    it('evaluates buildingCount', () => {
      const buildingCounts = new Map([['barracks', 2]]);
      const state = createTestState({ buildingCounts });
      const condition: RuleCondition = {
        type: 'buildingCount',
        operator: '>=',
        value: 2,
        targetId: 'barracks',
      };
      expect(evaluateCondition(condition, state)).toBe(true);
    });

    it('evaluates unitCount', () => {
      const unitCounts = new Map([['marine', 10]]);
      const state = createTestState({ unitCounts });
      const condition: RuleCondition = {
        type: 'unitCount',
        operator: '>=',
        value: 5,
        targetId: 'marine',
      };
      expect(evaluateCondition(condition, state)).toBe(true);
    });

    it('returns 0 for missing targetId', () => {
      const state = createTestState();
      const condition: RuleCondition = {
        type: 'buildingCount',
        operator: '==',
        value: 0,
        targetId: 'nonexistent',
      };
      expect(evaluateCondition(condition, state)).toBe(true);
    });
  });

  describe('enemy conditions', () => {
    it('evaluates enemyArmyStrength', () => {
      const state = createTestState({ enemyArmyStrength: 1000 });
      const condition: RuleCondition = { type: 'enemyArmyStrength', operator: '>', value: 500 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });

    it('evaluates underAttack', () => {
      const state = createTestState({ underAttack: true });
      const condition: RuleCondition = { type: 'underAttack', operator: '==', value: true };
      expect(evaluateCondition(condition, state)).toBe(true);
    });

    it('evaluates enemyAirUnits', () => {
      const state = createTestState({ enemyAirUnits: 5 });
      const condition: RuleCondition = { type: 'enemyAirUnits', operator: '>', value: 0 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });
  });

  describe('has/missing operators', () => {
    it('evaluates has operator', () => {
      const buildingCounts = new Map([['barracks', 1]]);
      const state = createTestState({ buildingCounts });
      const condition: RuleCondition = {
        type: 'buildingCount',
        operator: 'has',
        value: 0,
        targetId: 'barracks',
      };
      expect(evaluateCondition(condition, state)).toBe(true);
    });

    it('evaluates missing operator', () => {
      const state = createTestState();
      const condition: RuleCondition = {
        type: 'buildingCount',
        operator: 'missing',
        value: 0,
        targetId: 'factory',
      };
      expect(evaluateCondition(condition, state)).toBe(true);
    });
  });

  describe('compareRef', () => {
    it('compares workers to bases * multiplier', () => {
      const state = createTestState({ workerCount: 44, baseCount: 2 });
      const condition: RuleCondition = {
        type: 'workers',
        operator: '>=',
        value: 0,
        compareRef: 'optimalWorkersPerBase',
        compareMultiplier: 2, // 2 bases * 22 = 44
      };
      expect(evaluateCondition(condition, state)).toBe(true);
    });
  });

  describe('game time', () => {
    it('evaluates gameTime', () => {
      const state = createTestState({ currentTick: 2400 }); // 2 minutes at 20 TPS
      const condition: RuleCondition = { type: 'gameTime', operator: '>', value: 1200 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns false for unknown condition type', () => {
      const state = createTestState();
      const condition = {
        type: 'unknownType',
        operator: '>',
        value: 0,
      } as unknown as RuleCondition;
      expect(evaluateCondition(condition, state)).toBe(false);
    });

    it('handles supplyRatio with zero maxSupply', () => {
      const state = createTestState({ supply: 50, maxSupply: 0 });
      const condition: RuleCondition = { type: 'supplyRatio', operator: '==', value: 0 };
      expect(evaluateCondition(condition, state)).toBe(true);
    });
  });
});

describe('evaluateRule', () => {
  it('returns true when all conditions pass', () => {
    const state = createTestState({ minerals: 300, plasma: 100 });
    const rule: MacroRule = {
      id: 'test-rule',
      name: 'Test Rule',
      priority: 50,
      conditions: [
        { type: 'minerals', operator: '>', value: 200 },
        { type: 'plasma', operator: '>=', value: 50 },
      ],
      action: { type: 'train', targetId: 'marine' },
      cooldownTicks: 0,
    };

    expect(evaluateRule(rule, state)).toBe(true);
  });

  it('returns false when any condition fails', () => {
    const state = createTestState({ minerals: 100, plasma: 100 });
    const rule: MacroRule = {
      id: 'test-rule',
      name: 'Test Rule',
      priority: 50,
      conditions: [
        { type: 'minerals', operator: '>', value: 200 },
        { type: 'plasma', operator: '>=', value: 50 },
      ],
      action: { type: 'train', targetId: 'marine' },
      cooldownTicks: 0,
    };

    expect(evaluateRule(rule, state)).toBe(false);
  });

  it('filters by difficulty', () => {
    const state = createTestState({ difficulty: 'easy' });
    const rule: MacroRule = {
      id: 'hard-only',
      name: 'Hard Only',
      priority: 50,
      conditions: [],
      action: { type: 'train', targetId: 'marine' },
      cooldownTicks: 0,
      difficulties: ['hard', 'very_hard', 'insane'],
    };

    expect(evaluateRule(rule, state)).toBe(false);
  });

  it('filters by personality', () => {
    const state = createTestState({ personality: 'defensive' });
    const rule: MacroRule = {
      id: 'aggressive-only',
      name: 'Aggressive Only',
      priority: 50,
      conditions: [],
      action: { type: 'attack' },
      cooldownTicks: 0,
      personalities: ['aggressive'],
    };

    expect(evaluateRule(rule, state)).toBe(false);
  });

  it('passes when difficulty matches', () => {
    const state = createTestState({ difficulty: 'hard' });
    const rule: MacroRule = {
      id: 'hard-only',
      name: 'Hard Only',
      priority: 50,
      conditions: [],
      action: { type: 'train', targetId: 'marine' },
      cooldownTicks: 0,
      difficulties: ['hard', 'very_hard', 'insane'],
    };

    expect(evaluateRule(rule, state)).toBe(true);
  });
});

describe('findBestMacroRule', () => {
  const rules: MacroRule[] = [
    {
      id: 'low-priority',
      name: 'Low Priority',
      priority: 10,
      conditions: [{ type: 'minerals', operator: '>', value: 100 }],
      action: { type: 'train', targetId: 'marine' },
      cooldownTicks: 0,
    },
    {
      id: 'high-priority',
      name: 'High Priority',
      priority: 90,
      conditions: [{ type: 'minerals', operator: '>', value: 100 }],
      action: { type: 'build', targetId: 'barracks' },
      cooldownTicks: 0,
    },
    {
      id: 'medium-priority',
      name: 'Medium Priority',
      priority: 50,
      conditions: [{ type: 'minerals', operator: '>', value: 100 }],
      action: { type: 'expand' },
      cooldownTicks: 0,
    },
  ];

  it('returns highest priority matching rule', () => {
    const state = createTestState({ minerals: 200 });
    const cooldowns = new Map<string, number>();

    const result = findBestMacroRule(rules, state, cooldowns);

    expect(result).not.toBeNull();
    expect(result!.id).toBe('high-priority');
  });

  it('respects cooldowns', () => {
    const state = createTestState({ minerals: 200, currentTick: 100 });
    const cooldowns = new Map<string, number>([['high-priority', 100]]);

    // High priority used at tick 100, needs cooldown
    const rulesWithCooldown: MacroRule[] = [
      {
        id: 'high-priority',
        name: 'High Priority',
        priority: 90,
        conditions: [{ type: 'minerals', operator: '>', value: 100 }],
        action: { type: 'build', targetId: 'barracks' },
        cooldownTicks: 50, // Still on cooldown at tick 100
      },
      {
        id: 'low-priority',
        name: 'Low Priority',
        priority: 10,
        conditions: [{ type: 'minerals', operator: '>', value: 100 }],
        action: { type: 'train', targetId: 'marine' },
        cooldownTicks: 0,
      },
    ];

    const result = findBestMacroRule(rulesWithCooldown, state, cooldowns);

    expect(result).not.toBeNull();
    expect(result!.id).toBe('low-priority');
  });

  it('returns null when no rules match', () => {
    const state = createTestState({ minerals: 50 });
    const cooldowns = new Map<string, number>();

    const result = findBestMacroRule(rules, state, cooldowns);

    expect(result).toBeNull();
  });

  it('handles empty rules array', () => {
    const state = createTestState();
    const cooldowns = new Map<string, number>();

    const result = findBestMacroRule([], state, cooldowns);

    expect(result).toBeNull();
  });
});

describe('calculateUtilityScore', () => {
  it('returns base score with no conditions', () => {
    const state = createTestState();
    const utility: UtilityScore = {
      baseScore: 100,
      conditions: [],
    };

    expect(calculateUtilityScore(utility, state)).toBe(100);
  });

  it('applies multiplier when condition passes', () => {
    const state = createTestState({ minerals: 500 });
    const utility: UtilityScore = {
      baseScore: 100,
      conditions: [{ type: 'minerals', operator: '>', value: 400, multiplier: 2 }],
    };

    expect(calculateUtilityScore(utility, state)).toBe(200);
  });

  it('does not apply multiplier when condition fails', () => {
    const state = createTestState({ minerals: 100 });
    const utility: UtilityScore = {
      baseScore: 100,
      conditions: [{ type: 'minerals', operator: '>', value: 400, multiplier: 2 }],
    };

    expect(calculateUtilityScore(utility, state)).toBe(100);
  });

  it('applies multiple multipliers', () => {
    const state = createTestState({ minerals: 500, plasma: 200 });
    const utility: UtilityScore = {
      baseScore: 100,
      conditions: [
        { type: 'minerals', operator: '>', value: 400, multiplier: 2 },
        { type: 'plasma', operator: '>', value: 100, multiplier: 1.5 },
      ],
    };

    expect(calculateUtilityScore(utility, state)).toBe(300); // 100 * 2 * 1.5
  });

  it('handles fractional multipliers', () => {
    const state = createTestState({ enemyAirUnits: 5 });
    const utility: UtilityScore = {
      baseScore: 100,
      conditions: [{ type: 'enemyAirUnits', operator: '>', value: 0, multiplier: 0.5 }],
    };

    expect(calculateUtilityScore(utility, state)).toBe(50);
  });
});

describe('faction config registry', () => {
  beforeEach(() => {
    // Clear registry before each test by registering a test config
  });

  it('registers and retrieves faction config', () => {
    const config: Partial<FactionAIConfig> = {
      factionId: 'test-faction',
      factionName: 'Test Faction',
    };

    registerFactionAIConfig(config as FactionAIConfig);
    const retrieved = getFactionAIConfig('test-faction');

    expect(retrieved).toBeDefined();
    expect(retrieved!.factionId).toBe('test-faction');
  });

  it('returns undefined for unregistered faction', () => {
    const result = getFactionAIConfig('nonexistent-faction');
    expect(result).toBeUndefined();
  });

  it('getRegisteredFactions returns registered IDs', () => {
    const config: Partial<FactionAIConfig> = {
      factionId: 'registered-faction',
      factionName: 'Registered Faction',
    };

    registerFactionAIConfig(config as FactionAIConfig);
    const factions = getRegisteredFactions();

    expect(factions).toContain('registered-faction');
  });
});

describe('dominion AI macro rules', () => {
  it('requires full supply cache cost for supply rules', () => {
    const config = getFactionAIConfig('dominion');
    expect(config).toBeDefined();

    const supplyCost = BUILDING_DEFINITIONS.supply_cache.mineralCost;
    const supplyRules = config!.macroRules.filter(
      (rule) => rule.action.type === 'build' && rule.action.targetId === 'supply_cache'
    );

    expect(supplyRules.length).toBeGreaterThan(0);

    for (const rule of supplyRules) {
      const mineralCondition = rule.conditions.find(
        (condition) => condition.type === 'minerals' && condition.operator === '>='
      );
      expect(mineralCondition).toBeDefined();
      expect(mineralCondition!.value).toBeGreaterThanOrEqual(supplyCost);
    }
  });
});

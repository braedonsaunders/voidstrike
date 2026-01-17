/**
 * Data-Driven AI Configuration System
 *
 * Defines a fully data-driven AI architecture
 * that allows creating new factions, strategies, and behaviors without
 * touching engine code.
 *
 * Architecture:
 * - FactionAIConfig: All faction-specific AI settings
 * - UtilityScoring: Weighted decision-making for macro choices
 * - MacroRules: Dynamic production/building rules with conditions
 * - TacticalConfig: Combat priorities, counters, threat assessment
 * - MicroConfig: Unit-level behaviors (kiting, abilities, retreating)
 *
 * Usage:
 * 1. Define a FactionAIConfig for your faction
 * 2. Engine reads config and executes generic AI logic
 * 3. No engine code changes needed for balance tuning
 */

// ==================== CORE TYPES ====================

export type AIDifficulty = 'easy' | 'medium' | 'hard' | 'very_hard' | 'insane';
export type AIPersonality = 'aggressive' | 'defensive' | 'economic' | 'balanced' | 'cheese' | 'turtle';
export type AIState = 'building' | 'expanding' | 'attacking' | 'defending' | 'scouting' | 'harassing';

// ==================== UTILITY AI SCORING ====================

/**
 * Utility AI uses weighted scoring to make decisions.
 * Higher scores = more likely to be chosen.
 * Scores are normalized and compared across options.
 */
export interface UtilityScore {
  baseScore: number;
  conditions: UtilityCondition[];
}

export interface UtilityCondition {
  type: ConditionType;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number;
  /** Multiplier applied to base score when condition is true */
  multiplier: number;
  /** Optional: reference to another value (e.g., compare workers to bases * 22) */
  compareRef?: string;
}

export type ConditionType =
  | 'minerals'
  | 'vespene'
  | 'supply'
  | 'maxSupply'
  | 'supplyRatio' // supply / maxSupply
  | 'workers'
  | 'workerReplacementPriority' // 0-1, urgency of replacing lost workers
  | 'workerSaturation' // workers / (bases * optimalWorkersPerBase)
  | 'depletedPatchesNearBases' // number of resource patches depleted near bases
  | 'armySupply'
  | 'armyValue'
  | 'bases'
  | 'buildingCount' // requires buildingId parameter
  | 'unitCount' // requires unitId parameter
  | 'gameTime' // in ticks
  | 'enemyArmyStrength'
  | 'enemyBases'
  | 'underAttack'
  | 'enemyAirUnits'
  | 'hasAntiAir'
  | 'productionBuildingsCount';

// ==================== MACRO RULES ====================

/**
 * MacroRules define what the AI should build/train and when.
 * Rules are evaluated in priority order; first matching rule executes.
 * This replaces all hardcoded production logic.
 */
export interface MacroRule {
  id: string;
  name: string;
  description?: string;

  /** Higher priority rules are evaluated first (default: 50) */
  priority: number;

  /** All conditions must be true for rule to activate */
  conditions: RuleCondition[];

  /** Action to take when rule activates */
  action: MacroAction;

  /** Cooldown in ticks before rule can trigger again (0 = no cooldown) */
  cooldownTicks: number;

  /** Only active for specific difficulties (empty = all) */
  difficulties?: AIDifficulty[];

  /** Only active for specific personalities (empty = all) */
  personalities?: AIPersonality[];
}

export interface RuleCondition {
  type: ConditionType;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=' | 'has' | 'missing';
  value: number | string | boolean;
  /** For buildingCount/unitCount conditions */
  targetId?: string;
  /** Compare to another dynamic value */
  compareRef?: string;
  /** Multiply compareRef value */
  compareMultiplier?: number;
}

export interface MacroAction {
  type: 'build' | 'train' | 'research' | 'expand' | 'attack' | 'defend' | 'scout';
  /** Building or unit ID */
  targetId?: string;
  /** For multiple builds */
  count?: number;
  /** Random selection from list (weighted) */
  options?: Array<{ id: string; weight: number }>;
}

// ==================== TACTICAL CONFIG ====================

/**
 * TacticalConfig defines combat-related decision making:
 * - Unit priorities for focus fire
 * - Counter-unit relationships
 * - Threat assessment weights
 * - Army composition goals
 */
export interface TacticalConfig {
  /** Priority values for focus fire targeting (higher = kill first) */
  unitPriorities: Record<string, number>;

  /** What units counter what (unitId -> list of counters) */
  counterMatrix: Record<string, string[]>;

  /** Weights for threat score calculation */
  threatWeights: ThreatWeights;

  /** Army composition goals by game phase */
  compositionGoals: CompositionGoal[];

  /** When to attack (army supply thresholds by difficulty) */
  attackThresholds: Record<AIDifficulty, number>;

  /** Minimum army to keep for defense (ratio 0-1) */
  defenseRatio: Record<AIDifficulty, number>;

  /** Harass unit types */
  harassUnits: string[];

  /** Scout unit (usually first produced) */
  scoutUnit: string;
}

export interface ThreatWeights {
  /** Weight for enemy DPS */
  damage: number;
  /** Weight for unit priority value */
  priority: number;
  /** Weight for distance (closer = more threat) */
  distance: number;
  /** Weight for health (lower health = higher priority to finish) */
  health: number;
  /** Weight for targeting units attacking us */
  aggression: number;
}

export interface CompositionGoal {
  /** Game time range in ticks [start, end] */
  timeRange: [number, number];
  /** Target unit ratios (unitId -> percentage 0-100) */
  composition: Record<string, number>;
  /** Minimum total army supply before enforcing composition */
  minArmySupply: number;
}

// ==================== MICRO CONFIG ====================

/**
 * MicroConfig defines individual unit behaviors.
 * This is evaluated per-unit during combat.
 */
export interface MicroConfig {
  /** Unit-specific micro behaviors */
  unitBehaviors: Record<string, UnitMicroBehavior>;

  /** Global micro settings */
  global: GlobalMicroSettings;
}

export interface UnitMicroBehavior {
  /** Should this unit kite (maintain distance from melee) */
  kiting: KitingConfig | false;

  /** Health threshold to retreat (0 = never retreat) */
  retreatThreshold: number;

  /** Should focus on low-health targets */
  focusFire: boolean;

  /** Focus fire health threshold (switch target if current above this) */
  focusFireThreshold: number;

  /** Special ability usage */
  abilities?: AbilityUsageConfig[];

  /** Transform decision logic (for transformable units) */
  transformLogic?: TransformLogic;

  /** Preferred engagement range (for positioning) */
  preferredRange?: number;
}

export interface KitingConfig {
  /** Enable kiting behavior */
  enabled: true;
  /** Distance to maintain from melee enemies */
  distance: number;
  /** Cooldown between kite commands (ticks) */
  cooldownTicks: number;
  /** Only kite from these unit types (empty = all melee) */
  kiteFrom?: string[];
}

export interface AbilityUsageConfig {
  abilityId: string;
  /** Conditions to use ability */
  conditions: RuleCondition[];
  /** Target selection strategy */
  targeting: 'self' | 'enemy' | 'ally' | 'ground' | 'cluster';
  /** Cooldown override (uses ability cooldown if not set) */
  cooldownTicks?: number;
}

export interface TransformLogic {
  /** Conditions to transform to mode A */
  modeA: {
    name: string;
    conditions: RuleCondition[];
  };
  /** Conditions to transform to mode B */
  modeB: {
    name: string;
    conditions: RuleCondition[];
  };
}

export interface GlobalMicroSettings {
  /** Update interval for micro decisions (ticks) */
  updateInterval: number;
  /** Threat assessment update interval (ticks) */
  threatUpdateInterval: number;
  /** Range to scan for nearby enemies */
  scanRange: number;
  /** Focus fire health threshold (global default) */
  focusFireThreshold: number;
}

// ==================== ECONOMY CONFIG ====================

/**
 * EconomyConfig defines economic behavior and thresholds.
 */
export interface EconomyConfig {
  /** Optimal workers per mineral line */
  optimalWorkersPerMineral: number;
  /** Optimal workers per gas */
  optimalWorkersPerGas: number;
  /** Total optimal workers per base */
  optimalWorkersPerBase: number;
  /** Supply provided by main base */
  supplyPerMainBase: number;
  /** Supply provided by supply building */
  supplyPerSupplyBuilding: number;
  /** Build supply when within this amount of max */
  supplyBuildBuffer: number;
  /** Minimum minerals to start expansion */
  expansionMineralThreshold: number;
  /** Worker saturation ratio to trigger expansion (0-1) */
  saturationExpansionRatio: number;
}

// ==================== PRODUCTION CONFIG ====================

/**
 * ProductionConfig defines how production buildings scale.
 * This replaces hardcoded limits like "max 2 infantry bays".
 */
export interface ProductionConfig {
  /** Production buildings to scale */
  buildings: ProductionBuildingConfig[];
  /** Research module (tech lab) priorities */
  researchModulePriority: string[];
  /** Max research modules total */
  maxResearchModules: number;
}

export interface ProductionBuildingConfig {
  buildingId: string;
  /** Workers needed for first building */
  firstAt: number;
  /** Additional workers needed for each subsequent */
  additionalEvery: number;
  /** Max buildings per base */
  maxPerBase: number;
  /** Absolute max buildings */
  maxTotal: number;
  /** Required buildings before this can be built */
  requires?: string[];
  /** Minimum vespene to consider building */
  minVespene?: number;
}

// ==================== FACTION AI CONFIG ====================

/**
 * Complete AI configuration for a faction.
 * This is the main export that defines all AI behavior.
 */
export interface FactionAIConfig {
  factionId: string;
  factionName: string;

  // === Unit Role Mappings ===
  // Maps abstract roles to concrete unit IDs
  roles: {
    worker: string;
    mainBase: string;
    supplyBuilding: string;
    gasExtractor: string;
    basicProduction: string;
    basicUnit: string;
    scout: string;
    /** Anti-air capable units */
    antiAir: string[];
    /** Siege/heavy damage units */
    siege: string[];
    /** Fast harassment units */
    harass: string[];
    /** All base types (for counting) */
    baseTypes: string[];
  };

  // === Difficulty Scaling ===
  difficultyConfig: Record<AIDifficulty, DifficultySettings>;

  // === Economy ===
  economy: EconomyConfig;

  // === Production Scaling ===
  production: ProductionConfig;

  // === Macro Rules ===
  // Evaluated in priority order for build decisions
  macroRules: MacroRule[];

  // === Tactical ===
  tactical: TacticalConfig;

  // === Micro ===
  micro: MicroConfig;

  // === Build Orders ===
  // Initial build orders by difficulty (from buildOrders.ts)
  // After build order completes, macroRules take over
  buildOrdersRef: string; // Reference to FACTION_BUILD_ORDERS key
}

export interface DifficultySettings {
  /** Ticks between AI decisions */
  actionDelayTicks: number;
  /** Target worker count */
  targetWorkers: number;
  /** Max bases */
  maxBases: number;
  /** Mining speed multiplier - reduces gather time (1.0 = normal, 1.5 = 50% faster) */
  miningSpeedMultiplier: number;
  /** Build speed multiplier */
  buildSpeedMultiplier: number;
  /** Enable scouting */
  scoutingEnabled: boolean;
  /** Enable counter-unit building */
  counterBuildingEnabled: boolean;
  /** Enable micro (kiting, focus fire) */
  microEnabled: boolean;
  /** Enable harassment */
  harassmentEnabled: boolean;
  /** Expansion cooldown (ticks) */
  expansionCooldown: number;
  /** Attack cooldown (ticks) */
  attackCooldown: number;
  /** Scout cooldown (ticks) */
  scoutCooldown: number;
  /** Harass cooldown (ticks) */
  harassCooldown: number;
  /** Min workers before considering expansion */
  minWorkersForExpansion: number;
  /** Min army before considering expansion */
  minArmyForExpansion: number;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Evaluate a condition against AI state
 */
export function evaluateCondition(
  condition: RuleCondition,
  state: AIStateSnapshot
): boolean {
  let value: number | boolean | string;
  let compareValue: number = condition.value as number;

  // Get the value to compare
  switch (condition.type) {
    case 'minerals':
      value = state.minerals;
      break;
    case 'vespene':
      value = state.vespene;
      break;
    case 'supply':
      value = state.supply;
      break;
    case 'maxSupply':
      value = state.maxSupply;
      break;
    case 'supplyRatio':
      value = state.maxSupply > 0 ? state.supply / state.maxSupply : 0;
      break;
    case 'workers':
      value = state.workerCount;
      break;
    case 'workerReplacementPriority':
      value = state.workerReplacementPriority;
      break;
    case 'depletedPatchesNearBases':
      value = state.depletedPatchesNearBases;
      break;
    case 'workerSaturation':
      const optimalWorkers = state.baseCount * state.config.economy.optimalWorkersPerBase;
      value = optimalWorkers > 0 ? state.workerCount / optimalWorkers : 0;
      break;
    case 'armySupply':
      value = state.armySupply;
      break;
    case 'armyValue':
      value = state.armyValue;
      break;
    case 'bases':
      value = state.baseCount;
      break;
    case 'buildingCount':
      value = state.buildingCounts.get(condition.targetId || '') || 0;
      break;
    case 'unitCount':
      value = state.unitCounts.get(condition.targetId || '') || 0;
      break;
    case 'gameTime':
      value = state.currentTick;
      break;
    case 'enemyArmyStrength':
      value = state.enemyArmyStrength;
      break;
    case 'enemyBases':
      value = state.enemyBaseCount;
      break;
    case 'underAttack':
      value = state.underAttack;
      break;
    case 'enemyAirUnits':
      value = state.enemyAirUnits;
      break;
    case 'hasAntiAir':
      value = state.hasAntiAir;
      break;
    case 'productionBuildingsCount':
      value = state.productionBuildingsCount;
      break;
    default:
      return false;
  }

  // Handle compare reference
  if (condition.compareRef) {
    const refValue = getRefValue(condition.compareRef, state);
    compareValue = refValue * (condition.compareMultiplier || 1);
  }

  // Evaluate operator
  switch (condition.operator) {
    case '>':
      return (value as number) > compareValue;
    case '<':
      return (value as number) < compareValue;
    case '>=':
      return (value as number) >= compareValue;
    case '<=':
      return (value as number) <= compareValue;
    case '==':
      return value === condition.value;
    case '!=':
      return value !== condition.value;
    case 'has':
      return (value as number) > 0;
    case 'missing':
      return (value as number) === 0;
    default:
      return false;
  }
}

function getRefValue(ref: string, state: AIStateSnapshot): number {
  switch (ref) {
    case 'bases':
      return state.baseCount;
    case 'workers':
      return state.workerCount;
    case 'armySupply':
      return state.armySupply;
    case 'optimalWorkersPerBase':
      return state.config.economy.optimalWorkersPerBase;
    case 'productionBuildingsPerBase':
      return 2; // Default: 2 production buildings per base
    default:
      return 0;
  }
}

/**
 * Evaluate all conditions in a rule
 */
export function evaluateRule(rule: MacroRule, state: AIStateSnapshot): boolean {
  // Check difficulty filter
  if (rule.difficulties && rule.difficulties.length > 0) {
    if (!rule.difficulties.includes(state.difficulty)) {
      return false;
    }
  }

  // Check personality filter
  if (rule.personalities && rule.personalities.length > 0) {
    if (!rule.personalities.includes(state.personality)) {
      return false;
    }
  }

  // All conditions must pass
  return rule.conditions.every(cond => evaluateCondition(cond, state));
}

/**
 * Find the best macro rule to execute
 */
export function findBestMacroRule(
  rules: MacroRule[],
  state: AIStateSnapshot,
  cooldowns: Map<string, number>
): MacroRule | null {
  // Sort by priority (descending)
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    // Check cooldown
    const lastUsed = cooldowns.get(rule.id) || 0;
    if (state.currentTick - lastUsed < rule.cooldownTicks) {
      continue;
    }

    // Evaluate conditions
    if (evaluateRule(rule, state)) {
      return rule;
    }
  }

  return null;
}

/**
 * Calculate utility score for a decision
 */
export function calculateUtilityScore(
  utility: UtilityScore,
  state: AIStateSnapshot
): number {
  let score = utility.baseScore;

  for (const condition of utility.conditions) {
    // Create a RuleCondition to reuse evaluation logic
    const ruleCondition: RuleCondition = {
      type: condition.type,
      operator: condition.operator,
      value: condition.value,
      compareRef: condition.compareRef,
    };

    if (evaluateCondition(ruleCondition, state)) {
      score *= condition.multiplier;
    }
  }

  return score;
}

// ==================== STATE SNAPSHOT ====================

/**
 * Snapshot of AI state for rule evaluation.
 * This is passed to all evaluation functions.
 */
export interface AIStateSnapshot {
  playerId: string;
  difficulty: AIDifficulty;
  personality: AIPersonality;
  currentTick: number;

  // Resources
  minerals: number;
  vespene: number;
  supply: number;
  maxSupply: number;

  // Units
  workerCount: number;
  workerReplacementPriority: number; // 0-1, urgency of replacing lost workers
  armySupply: number;
  armyValue: number;
  unitCounts: Map<string, number>;

  // Economy health
  depletedPatchesNearBases: number; // Resources depleted near AI bases

  // Buildings
  baseCount: number;
  buildingCounts: Map<string, number>;
  productionBuildingsCount: number;

  // Enemy info
  enemyArmyStrength: number;
  enemyBaseCount: number;
  enemyAirUnits: number;
  underAttack: boolean;

  // Capabilities
  hasAntiAir: boolean;

  // Config reference
  config: FactionAIConfig;
}

// ==================== REGISTRY ====================

const factionConfigs: Map<string, FactionAIConfig> = new Map();

/**
 * Register a faction's AI configuration
 */
export function registerFactionAIConfig(config: FactionAIConfig): void {
  factionConfigs.set(config.factionId, config);
}

/**
 * Get a faction's AI configuration
 */
export function getFactionAIConfig(factionId: string): FactionAIConfig | undefined {
  return factionConfigs.get(factionId);
}

/**
 * Get all registered faction IDs
 */
export function getRegisteredFactions(): string[] {
  return Array.from(factionConfigs.keys());
}

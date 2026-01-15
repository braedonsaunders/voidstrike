import { System } from '../ecs/System';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Resource, OPTIMAL_WORKERS_PER_MINERAL, OPTIMAL_WORKERS_PER_VESPENE } from '../components/Resource';
import { Game, GameCommand } from '../core/Game';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS, RESEARCH_MODULE_UNITS } from '@/data/buildings/dominion';
import { getCounterRecommendation } from './AIMicroSystem';
import { debugAI } from '@/utils/debugLogger';
import { SeededRandom } from '@/utils/math';
import {
  getRandomBuildOrder,
  type AIDifficulty,
  type BuildOrderStep,
} from '@/data/ai/buildOrders';
// Import new data-driven AI configuration system
import {
  type FactionAIConfig,
  type AIStateSnapshot,
  type AIPersonality,
  type MacroRule,
  getFactionAIConfig,
  findBestMacroRule,
} from '@/data/ai/aiConfig';
// Ensure faction configs are registered
import '@/data/ai/factions/dominion';

type AIState = 'building' | 'expanding' | 'attacking' | 'defending' | 'scouting' | 'harassing';
export type { AIDifficulty }; // Re-export for backwards compatibility

interface AIPlayer {
  playerId: string;
  faction: string;
  difficulty: AIDifficulty;
  personality: AIPersonality;
  state: AIState;
  lastActionTick: number;
  lastScoutTick: number;
  lastHarassTick: number;
  lastExpansionTick: number;

  // Economy
  minerals: number;
  vespene: number;
  supply: number;
  maxSupply: number;
  workerCount: number;
  targetWorkerCount: number;

  // Army
  armyValue: number;
  armySupply: number;
  armyComposition: Map<string, number>;

  // Buildings
  buildingCounts: Map<string, number>;
  buildingsInProgress: Map<string, number>;

  // Strategic info
  enemyBaseLocation: { x: number; y: number } | null;
  enemyArmyStrength: number;
  enemyBaseCount: number;
  enemyAirUnits: number;
  lastEnemyContact: number;
  scoutedLocations: Set<string>;

  // Build order
  buildOrder: BuildOrderStep[];
  buildOrderIndex: number;
  buildOrderFailureCount: number; // Track consecutive failures to skip stuck steps

  // Timing (loaded from FactionAIConfig)
  attackCooldown: number;
  lastAttackTick: number;
  harassCooldown: number;
  scoutCooldown: number;
  expansionCooldown: number;

  // Data-driven AI configuration
  config: FactionAIConfig | null;
  macroRuleCooldowns: Map<string, number>; // Track cooldowns for macro rules
}

// Build orders are now loaded from data-driven config (@/data/ai/buildOrders.ts)
// This allows per-faction build orders and easy modification without code changes

// PERF: Cached entity query results to avoid repeated queries per frame
interface EntityQueryCache {
  units: Entity[] | null;
  unitsWithTransform: Entity[] | null;
  buildings: Entity[] | null;
  buildingsWithTransform: Entity[] | null;
  resources: Entity[] | null;
}

export class EnhancedAISystem extends System {
  public readonly name = 'EnhancedAISystem';
  public priority = 100;

  private aiPlayers: Map<string, AIPlayer> = new Map();
  private ticksBetweenActions = 20; // ~1 second at 20 ticks/sec
  private defaultDifficulty: AIDifficulty;
  // Deterministic random for multiplayer compatibility - reseeded each update
  private random: SeededRandom = new SeededRandom(12345);

  // PERF: Entity query cache - cleared each update cycle
  private entityCache: EntityQueryCache = {
    units: null,
    unitsWithTransform: null,
    buildings: null,
    buildingsWithTransform: null,
    resources: null,
  };

  /**
   * Clear entity cache at start of each update cycle
   */
  private clearEntityCache(): void {
    this.entityCache.units = null;
    this.entityCache.unitsWithTransform = null;
    this.entityCache.buildings = null;
    this.entityCache.buildingsWithTransform = null;
    this.entityCache.resources = null;
  }

  /**
   * PERF: Get cached units query - reuses result within same update cycle
   */
  private getCachedUnits() {
    if (!this.entityCache.units) {
      this.entityCache.units = this.world.getEntitiesWith('Unit', 'Selectable', 'Health');
    }
    return this.entityCache.units;
  }

  /**
   * PERF: Get cached units with transform - reuses result within same update cycle
   */
  private getCachedUnitsWithTransform() {
    if (!this.entityCache.unitsWithTransform) {
      this.entityCache.unitsWithTransform = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');
    }
    return this.entityCache.unitsWithTransform;
  }

  /**
   * PERF: Get cached buildings query - reuses result within same update cycle
   */
  private getCachedBuildings() {
    if (!this.entityCache.buildings) {
      this.entityCache.buildings = this.world.getEntitiesWith('Building', 'Selectable', 'Health');
    }
    return this.entityCache.buildings;
  }

  /**
   * PERF: Get cached buildings with transform - reuses result within same update cycle
   */
  private getCachedBuildingsWithTransform() {
    if (!this.entityCache.buildingsWithTransform) {
      this.entityCache.buildingsWithTransform = this.world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');
    }
    return this.entityCache.buildingsWithTransform;
  }

  /**
   * PERF: Get cached resources query - reuses result within same update cycle
   */
  private getCachedResources() {
    if (!this.entityCache.resources) {
      this.entityCache.resources = this.world.getEntitiesWith('Resource', 'Transform');
    }
    return this.entityCache.resources;
  }

  constructor(game: Game, difficulty: AIDifficulty = 'medium') {
    super(game);
    this.defaultDifficulty = difficulty;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Track enemy sightings
    this.game.eventBus.on('vision:enemySighted', (data: { playerId: string; position: { x: number; y: number } }) => {
      for (const ai of this.aiPlayers.values()) {
        if (ai.playerId !== data.playerId) continue;
        ai.lastEnemyContact = this.game.getCurrentTick();
      }
    });

    // Track combat events
    this.game.eventBus.on('unit:underAttack', (data: { playerId: string }) => {
      const ai = this.aiPlayers.get(data.playerId);
      if (ai) {
        ai.state = 'defending';
      }
    });
  }

  public registerAI(
    playerId: string,
    faction: string,
    difficulty: AIDifficulty = 'medium',
    personality: AIPersonality = 'balanced'
  ): void {
    debugAI.log(`[EnhancedAI] Registering AI: ${playerId}, faction: ${faction}, difficulty: ${difficulty}`);

    // Load faction-specific AI configuration (data-driven) - REQUIRED
    const factionConfig = getFactionAIConfig(faction);
    if (!factionConfig) {
      debugAI.error(`[EnhancedAI] FATAL: No FactionAIConfig found for faction: ${faction}. AI cannot be registered without config.`);
      throw new Error(`No AI configuration found for faction: ${faction}. Define a FactionAIConfig in src/data/ai/factions/${faction}.ts`);
    }

    debugAI.log(`[EnhancedAI] Loaded data-driven config for faction: ${faction}`);

    // Get difficulty settings from data-driven config
    const difficultySettings = factionConfig.difficultyConfig[difficulty];

    this.aiPlayers.set(playerId, {
      playerId,
      faction,
      difficulty,
      personality,
      state: 'building',
      lastActionTick: 0,
      lastScoutTick: 0,
      lastHarassTick: 0,
      lastExpansionTick: 0,

      minerals: 50,
      vespene: 0,
      supply: 6,
      maxSupply: factionConfig.economy.supplyPerMainBase,
      workerCount: 6,
      targetWorkerCount: difficultySettings.targetWorkers,

      armyValue: 0,
      armySupply: 0,
      armyComposition: new Map(),

      buildingCounts: new Map([[factionConfig.roles.mainBase, 1]]),
      buildingsInProgress: new Map(),

      enemyBaseLocation: null,
      enemyArmyStrength: 0,
      enemyBaseCount: 1,
      enemyAirUnits: 0,
      lastEnemyContact: 0,
      scoutedLocations: new Set(),

      // Load build order from data-driven config
      buildOrder: this.loadBuildOrder(faction, difficulty),
      buildOrderIndex: 0,
      buildOrderFailureCount: 0,

      attackCooldown: difficultySettings.attackCooldown,
      lastAttackTick: 0,
      harassCooldown: difficultySettings.harassCooldown,
      scoutCooldown: difficultySettings.scoutCooldown,
      expansionCooldown: difficultySettings.expansionCooldown,

      // Data-driven configuration - guaranteed to exist
      config: factionConfig,
      macroRuleCooldowns: new Map(),
    });
  }

  /**
   * Create an AIStateSnapshot for macro rule evaluation.
   * Config is required - no fallbacks.
   */
  private createStateSnapshot(ai: AIPlayer, currentTick: number): AIStateSnapshot {
    const config = ai.config!; // Config is guaranteed by registerAI
    const baseCount = this.countPlayerBases(ai);

    // Count production buildings from config
    let productionBuildingsCount = 0;
    for (const prodConfig of config.production.buildings) {
      productionBuildingsCount += ai.buildingCounts.get(prodConfig.buildingId) || 0;
    }

    // Check if AI has any anti-air units from config
    let hasAntiAir = false;
    for (const unitId of config.roles.antiAir) {
      if ((ai.armyComposition.get(unitId) || 0) > 0) {
        hasAntiAir = true;
        break;
      }
    }

    return {
      playerId: ai.playerId,
      difficulty: ai.difficulty,
      personality: ai.personality,
      currentTick,

      minerals: ai.minerals,
      vespene: ai.vespene,
      supply: ai.supply,
      maxSupply: ai.maxSupply,

      workerCount: ai.workerCount,
      armySupply: ai.armySupply,
      armyValue: ai.armyValue,
      unitCounts: ai.armyComposition,

      baseCount,
      buildingCounts: ai.buildingCounts,
      productionBuildingsCount,

      enemyArmyStrength: ai.enemyArmyStrength,
      enemyBaseCount: ai.enemyBaseCount,
      enemyAirUnits: ai.enemyAirUnits,
      underAttack: ai.state === 'defending',

      hasAntiAir,

      config,
    };
  }

  /**
   * Load build order from data-driven config for a faction and difficulty.
   * Config is required - throws error if not found (no fallbacks).
   */
  private loadBuildOrder(faction: string, difficulty: AIDifficulty): BuildOrderStep[] {
    // Get build order from data-driven config - config is required
    const buildOrder = getRandomBuildOrder(faction, difficulty, this.random);

    if (!buildOrder) {
      throw new Error(`[EnhancedAI] No build order configured for faction ${faction} (${difficulty}). Build orders must be defined in data.`);
    }

    debugAI.log(`[EnhancedAI] Loaded build order: ${buildOrder.name} for ${faction} (${difficulty})`);
    return [...buildOrder.steps];
  }

  /**
   * Check a named condition for build order steps (data-driven).
   * Named conditions allow data-driven build orders without embedding functions.
   */
  private checkNamedCondition(conditionName: string, ai: AIPlayer): boolean {
    const config = ai.config!;

    switch (conditionName) {
      case 'hasRefinery':
      case 'hasExtractor':
      case 'hasGasExtractor':
        return (ai.buildingCounts.get(config.roles.gasExtractor) ?? 0) > 0;
      case 'hasBarracks':
      case 'hasInfantryBay':
      case 'hasBasicProduction':
        return (ai.buildingCounts.get(config.roles.basicProduction) ?? 0) > 0;
      case 'lowArmy':
        return ai.armySupply < 10;
      case 'hasArmy':
        return ai.armySupply >= 5;
      case 'underAttack':
        return ai.state === 'defending';
      default:
        // Try to match against building ID from config.production.buildings
        for (const prodBuilding of config.production.buildings) {
          if (conditionName === `has_${prodBuilding.buildingId}` ||
              conditionName === prodBuilding.buildingId) {
            return (ai.buildingCounts.get(prodBuilding.buildingId) ?? 0) > 0;
          }
        }
        debugAI.warn(`[EnhancedAI] Unknown condition: ${conditionName}`);
        return true; // Default to true for unknown conditions
    }
  }

  public update(_deltaTime: number): void {
    const currentTick = this.game.getCurrentTick();

    // PERF: Clear entity cache at start of update cycle
    this.clearEntityCache();

    // Reseed random based on tick for deterministic multiplayer
    // Using tick ensures same decisions across all clients
    // PERF: Reseed existing instance instead of creating new one every frame
    this.random.reseed(currentTick * 31337 + 42);

    // Log once at first tick
    if (currentTick === 1) {
      debugAI.log(`[EnhancedAI] Registered AI players: ${Array.from(this.aiPlayers.keys()).join(', ')}`);
    }

    for (const [playerId, ai] of this.aiPlayers) {
      const actionDelay = this.getActionDelay(ai.difficulty);
      if (currentTick - ai.lastActionTick < actionDelay) continue;

      ai.lastActionTick = currentTick;

      // Update AI's knowledge of the game state
      this.updateGameState(ai);

      // Check if AI is defeated (no buildings left)
      const totalBuildings = Array.from(ai.buildingCounts.values()).reduce((a, b) => a + b, 0);
      if (totalBuildings === 0) {
        // AI is defeated - stop all activity
        if (currentTick % 100 === 0) {
          debugAI.log(`[EnhancedAI] ${playerId} has no buildings, skipping`);
        }
        continue;
      }

      // Debug log periodically
      if (currentTick % 200 === 0) {
        debugAI.log(`[EnhancedAI] ${playerId}: workers=${ai.workerCount}, buildings=${totalBuildings}, minerals=${Math.floor(ai.minerals)}, state=${ai.state}`);
      }

      // Resource bonus for harder difficulties
      this.applyResourceBonus(ai);

      // Determine state based on conditions
      this.updateAIState(ai, currentTick);

      // Execute state-specific behavior
      this.executeStateBehavior(ai, currentTick);
    }
  }

  private getActionDelay(difficulty: AIDifficulty): number {
    const baseDelay = this.ticksBetweenActions;
    switch (difficulty) {
      case 'easy': return baseDelay * 3;
      case 'medium': return baseDelay * 2;
      case 'hard': return baseDelay;
      case 'very_hard': return Math.floor(baseDelay * 0.7);
      case 'insane': return Math.floor(baseDelay * 0.5);
    }
  }

  private updateGameState(ai: AIPlayer): void {
    // Count workers, army, and buildings
    let workerCount = 0;
    let armySupply = 0;
    const armyComposition = new Map<string, number>();
    const buildingCounts = new Map<string, number>();

    const units = this.getCachedUnits();
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable');
      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');

      // Defensive null checks
      if (!selectable || !unit || !health) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      if (unit.isWorker) {
        workerCount++;
      } else {
        const def = UNIT_DEFINITIONS[unit.unitId];
        if (def) {
          armySupply += def.supplyCost;
          armyComposition.set(unit.unitId, (armyComposition.get(unit.unitId) || 0) + 1);
        }
      }
    }

    const buildings = this.getCachedBuildings();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');
      const health = entity.get<Health>('Health');

      // Defensive null checks
      if (!selectable || !building || !health) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      buildingCounts.set(building.buildingId, (buildingCounts.get(building.buildingId) || 0) + 1);
    }

    ai.workerCount = workerCount;
    ai.armySupply = armySupply;
    ai.armyValue = armySupply * 10; // Simplified army value
    ai.armyComposition = armyComposition;
    ai.buildingCounts = buildingCounts;
    ai.supply = workerCount + armySupply;
  }

  private applyResourceBonus(ai: AIPlayer): void {
    const config = ai.config!; // Config is guaranteed by registerAI
    const difficultySettings = config.difficultyConfig[ai.difficulty];
    const economyConfig = config.economy;

    // All AI difficulties get passive income based on workers gathering
    // All values come from data-driven config - no fallbacks
    const baseIncomePerWorker = economyConfig.workerIncomePerTick;
    const gasIncomeMultiplier = economyConfig.gasIncomeMultiplier;
    const incomeMultiplier = difficultySettings.resourceMultiplier;

    ai.minerals += ai.workerCount * baseIncomePerWorker * incomeMultiplier;

    // Vespene income if AI has an extractor
    const gasExtractor = config.roles.gasExtractor;
    const extractorCount = ai.buildingCounts.get(gasExtractor) || 0;
    if (extractorCount > 0) {
      const workersPerGas = economyConfig.optimalWorkersPerGas;
      ai.vespene += extractorCount * workersPerGas * baseIncomePerWorker * gasIncomeMultiplier * incomeMultiplier;
    }

    // Update max supply based on buildings from config
    const supplyPerBase = economyConfig.supplyPerMainBase;
    const supplyPerSupplyBuilding = economyConfig.supplyPerSupplyBuilding;

    // Count bases using role mapping from config
    let baseSupply = 0;
    for (const baseType of config.roles.baseTypes) {
      baseSupply += (ai.buildingCounts.get(baseType) || 0) * supplyPerBase;
    }

    // Count supply buildings using role mapping from config
    const supplyBuilding = config.roles.supplyBuilding;
    const supplyBuildingCount = ai.buildingCounts.get(supplyBuilding) || 0;

    ai.maxSupply = baseSupply + supplyBuildingCount * supplyPerSupplyBuilding;
  }

  private updateAIState(ai: AIPlayer, currentTick: number): void {
    const config = ai.config!; // Config is guaranteed by registerAI
    const difficultySettings = config.difficultyConfig[ai.difficulty];
    const economyConfig = config.economy;
    const tacticalConfig = config.tactical;

    // Priority: Defending > Attacking > Harassing > Expanding > Scouting > Building
    if (this.isUnderAttack(ai.playerId)) {
      ai.state = 'defending';
      return;
    }

    // Check if should attack using tactical config
    const minArmySize = tacticalConfig.attackThresholds[ai.difficulty];
    if (ai.armySupply >= minArmySize && currentTick - ai.lastAttackTick >= ai.attackCooldown) {
      ai.state = 'attacking';
      return;
    }

    // CRITICAL: Continue attacking if already in attack state and enemies still exist
    if (ai.state === 'attacking') {
      const hasArmy = this.getArmyUnits(ai.playerId).length > 0;
      const hasEnemies = this.findAnyEnemyTarget(ai) !== null;
      if (hasArmy && hasEnemies) {
        return; // Stay in attacking state - finish the job!
      }
    }

    // Check if should harass (from difficulty settings)
    if (difficultySettings.harassmentEnabled && currentTick - ai.lastHarassTick >= ai.harassCooldown) {
      const harassUnits = this.getHarassUnits(ai);
      if (harassUnits.length > 0) {
        ai.state = 'harassing';
        return;
      }
    }

    // === EXPANSION LOGIC (FIXED) ===
    // Uses OR logic for some conditions instead of requiring ALL conditions
    const totalBases = this.countPlayerBases(ai);
    const cooldownElapsed = currentTick - ai.lastExpansionTick >= ai.expansionCooldown;
    const belowMaxBases = totalBases < difficultySettings.maxBases;

    // All values from config - no fallbacks
    const expansionMineralThreshold = economyConfig.expansionMineralThreshold;
    const optimalWorkersPerBase = economyConfig.optimalWorkersPerBase;
    const saturationRatio = economyConfig.saturationExpansionRatio;

    const hasEnoughMinerals = ai.minerals >= expansionMineralThreshold;
    const hasEnoughWorkers = ai.workerCount >= difficultySettings.minWorkersForExpansion;
    const hasEnoughArmy = ai.armySupply >= difficultySettings.minArmyForExpansion;

    // Saturation-based expansion - if workers are saturated, expand regardless of army
    const isSaturated = ai.workerCount >= totalBases * optimalWorkersPerBase * saturationRatio;

    // Time-based expansion - expand after long game time even without perfect conditions
    const longGameTime = currentTick > 2000;

    // Flexible expansion logic:
    // 1. Standard expansion: cooldown + workers + army + minerals + below max
    // 2. Saturated bases: cooldown + saturated + minerals + below max (no army requirement)
    // 3. Late game: cooldown + time + minerals + below max (no worker/army requirement)
    const standardExpansion = cooldownElapsed && hasEnoughWorkers && hasEnoughArmy && hasEnoughMinerals && belowMaxBases;
    const saturationExpansion = cooldownElapsed && isSaturated && hasEnoughMinerals && belowMaxBases;
    const timeBasedExpansion = cooldownElapsed && longGameTime && hasEnoughMinerals && belowMaxBases;

    if (standardExpansion || saturationExpansion || timeBasedExpansion) {
      ai.state = 'expanding';
      return;
    }

    // Check if should scout (from difficulty settings)
    if (difficultySettings.scoutingEnabled && currentTick - ai.lastScoutTick >= ai.scoutCooldown) {
      ai.state = 'scouting';
      return;
    }

    ai.state = 'building';
  }

  /**
   * Count total command center type buildings for a player (data-driven)
   */
  private countPlayerBases(ai: AIPlayer): number {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    let count = 0;
    const buildings = this.getCachedBuildings();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');
      const health = entity.get<Health>('Health');

      if (!selectable || !building || !health) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      if (baseTypes.includes(building.buildingId)) {
        count++;
      }
    }
    return count;
  }

  private executeStateBehavior(ai: AIPlayer, currentTick: number): void {
    switch (ai.state) {
      case 'building':
        this.executeBuildingPhase(ai);
        break;
      case 'expanding':
        this.executeExpandingPhase(ai);
        break;
      case 'attacking':
        this.executeAttackingPhase(ai, currentTick);
        break;
      case 'defending':
        this.executeDefendingPhase(ai);
        break;
      case 'scouting':
        this.executeScoutingPhase(ai, currentTick);
        break;
      case 'harassing':
        this.executeHarassingPhase(ai, currentTick);
        break;
    }
  }

  private executeBuildingPhase(ai: AIPlayer): void {
    // First priority: Resume incomplete buildings (paused or waiting for worker)
    // This prevents resources from being wasted on abandoned construction
    if (this.tryResumeIncompleteBuildings(ai)) {
      // Only resume one building per tick to avoid pulling all workers
      // Continue with other tasks after assigning a worker
    }

    // Second priority: Repair damaged buildings and units
    this.assignWorkersToRepair(ai);

    // Send idle workers to gather (instead of just passive income)
    this.assignIdleWorkersToGather(ai);

    // Follow build order if available
    if (ai.buildOrderIndex < ai.buildOrder.length) {
      const step = ai.buildOrder[ai.buildOrderIndex];

      // Check supply condition
      if (step.supply && ai.supply < step.supply) {
        // Continue macro while waiting
        this.doMacro(ai);
        return;
      }

      // Check custom condition (supports both function and named string conditions)
      if (step.condition) {
        const conditionMet = typeof step.condition === 'function'
          ? step.condition(ai)
          : this.checkNamedCondition(step.condition, ai);
        if (!conditionMet) {
          ai.buildOrderIndex++;
          return;
        }
      }

      // Execute build order step
      let success = false;
      if (step.type === 'unit') {
        success = this.tryTrainUnit(ai, step.id);
      } else if (step.type === 'building') {
        success = this.tryBuildBuilding(ai, step.id);
      }

      if (success) {
        ai.buildOrderIndex++;
        ai.buildOrderFailureCount = 0; // Reset failure counter on success
        debugAI.log(`[EnhancedAI] ${ai.playerId}: Completed build order step ${ai.buildOrderIndex - 1} (${step.type}: ${step.id})`);
      } else {
        // Track failure - only count once per second (20 ticks) to avoid instant skipping
        if (this.game.getCurrentTick() % 20 === 0) {
          ai.buildOrderFailureCount++;
        }

        // Skip stuck step after 10 consecutive failure checks (~10 seconds)
        // This prevents permanent stuck states from blocking all progress
        if (ai.buildOrderFailureCount >= 10) {
          debugAI.warn(`[EnhancedAI] ${ai.playerId}: Skipping stuck build order step ${ai.buildOrderIndex} (${step.type}: ${step.id}) after ${ai.buildOrderFailureCount} failures`);
          ai.buildOrderIndex++;
          ai.buildOrderFailureCount = 0;
        } else if (this.game.getCurrentTick() % 100 === 0) {
          // Log when stuck on a build order step (every 5 seconds)
          debugAI.log(`[EnhancedAI] ${ai.playerId}: Stuck on build order step ${ai.buildOrderIndex} (${step.type}: ${step.id}), minerals=${Math.floor(ai.minerals)}, supply=${ai.supply}/${ai.maxSupply}, failures=${ai.buildOrderFailureCount}`);
        }
      }
      return;
    }

    // Post-build order: Standard macro
    this.doMacro(ai);
  }

  /**
   * Execute macro decisions using data-driven MacroRules.
   * 100% data-driven - no fallbacks. Config is required.
   */
  private doMacro(ai: AIPlayer): void {
    if (!ai.config) {
      debugAI.error(`[EnhancedAI] ${ai.playerId}: No config loaded! AI cannot function without FactionAIConfig.`);
      return;
    }

    const currentTick = this.game.getCurrentTick();

    // Create state snapshot for rule evaluation
    const state = this.createStateSnapshot(ai, currentTick);

    // Find best matching macro rule
    const bestRule = findBestMacroRule(ai.config.macroRules, state, ai.macroRuleCooldowns);

    if (bestRule) {
      // Execute the rule's action
      const success = this.executeRuleAction(ai, bestRule);

      // Update cooldown on success
      if (success) {
        ai.macroRuleCooldowns.set(bestRule.id, currentTick);
        debugAI.log(`[EnhancedAI] ${ai.playerId}: Executed macro rule '${bestRule.name}'`);
        return;
      }
    }

    // No matching rule or rule failed - produce basic unit if we have production
    const basicUnit = ai.config.roles.basicUnit;
    const basicProduction = ai.config.roles.basicProduction;
    if ((ai.buildingCounts.get(basicProduction) || 0) > 0) {
      this.tryTrainUnit(ai, basicUnit);
    }
  }

  /**
   * Execute a macro rule action.
   */
  private executeRuleAction(ai: AIPlayer, rule: MacroRule): boolean {
    if (!ai.config) return false;

    const action = rule.action;

    switch (action.type) {
      case 'build':
        if (action.targetId) {
          return this.tryBuildBuilding(ai, action.targetId);
        }
        return false;

      case 'train':
        if (action.targetId) {
          return this.tryTrainUnit(ai, action.targetId);
        }
        // Handle weighted random selection
        if (action.options && action.options.length > 0) {
          const unitId = this.selectWeightedOption(action.options);
          if (unitId) {
            return this.tryTrainUnit(ai, unitId);
          }
        }
        return false;

      case 'expand':
        // Expansion is handled by state machine
        return false;

      case 'research':
        // TODO: Implement research when research system is ready
        return false;

      default:
        return false;
    }
  }

  /**
   * Select a weighted random option from a list.
   */
  private selectWeightedOption(options: Array<{ id: string; weight: number }>): string | null {
    const totalWeight = options.reduce((sum, opt) => sum + opt.weight, 0);
    if (totalWeight <= 0) return options[0]?.id ?? null;

    let roll = this.random.next() * totalWeight;
    for (const option of options) {
      roll -= option.weight;
      if (roll <= 0) {
        return option.id;
      }
    }
    return options[options.length - 1]?.id ?? null;
  }

  /**
   * Try to build a tech lab addon on a production building
   * Tech lab allows building of advanced units (devastator, colossus, breacher, etc.)
   */
  private tryBuildResearchModule(ai: AIPlayer, target: { entityId: number; buildingId: string; position: { x: number; y: number } }): boolean {
    const moduleDef = BUILDING_DEFINITIONS['research_module'];
    if (!moduleDef) return false;

    if (ai.minerals < moduleDef.mineralCost || ai.vespene < moduleDef.vespeneCost) return false;

    // Get the parent building and validate it can have an addon
    const parentEntity = this.world.getEntity(target.entityId);
    if (!parentEntity) return false;

    const parentBuilding = parentEntity.get<Building>('Building');
    if (!parentBuilding || !parentBuilding.canHaveAddon || parentBuilding.hasAddon()) return false;
    if (parentBuilding.state !== 'complete') return false;

    // Tech lab is placed adjacent to the building (to the right)
    // Use building width to calculate proper offset from center
    const modulePos = {
      x: target.position.x + parentBuilding.width, // Right edge of parent + addon center offset
      y: target.position.y
    };

    ai.minerals -= moduleDef.mineralCost;
    ai.vespene -= moduleDef.vespeneCost;

    // Create the addon building via the building:place event
    // The BuildingPlacementSystem's handleAddonPlacement validates placement with parent exclusion
    this.game.eventBus.emit('building:place', {
      buildingType: 'research_module',
      position: modulePos,
      playerId: ai.playerId,
      isAddon: true,
      parentBuildingId: target.entityId,
    });

    debugAI.log(`EnhancedAI: ${ai.playerId} building tech_lab on ${target.buildingId}`);
    return true;
  }

  private canProduceUnit(ai: AIPlayer, unitId: string): boolean {
    // Check what buildings can produce this unit
    const buildings = this.world.getEntitiesWith('Building', 'Selectable');

    // Check if this unit requires a research module
    const requiresResearchModule = this.unitRequiresResearchModule(unitId);

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (!building.isComplete()) continue;

      // Check if the building can produce this unit
      if (building.canProduce.includes(unitId)) {
        // Basic units don't need research module
        if (!requiresResearchModule) return true;
        // Tech units need research module attached (tech_lab in the current system)
        if (building.hasAddon() && building.hasTechLab()) return true;
      }

      // Check if building with tech lab can produce tech units
      if (requiresResearchModule && building.hasAddon() && building.hasTechLab()) {
        // Look up what units this building type can make with research module
        const buildingType = building.buildingId;
        const techUnits = RESEARCH_MODULE_UNITS[buildingType] || [];
        if (techUnits.includes(unitId)) return true;
      }
    }
    return false;
  }

  /**
   * Check if a unit requires a research module addon to be produced
   */
  private unitRequiresResearchModule(unitId: string): boolean {
    for (const units of Object.values(RESEARCH_MODULE_UNITS)) {
      if (units.includes(unitId)) return true;
    }
    return false;
  }

  /**
   * Find a production building that can build research module (tech lab) (data-driven).
   * Returns the building that needs an addon most (based on config.production.researchModulePriority)
   */
  private findBuildingNeedingResearchModule(ai: AIPlayer): { entityId: number; buildingId: string; position: { x: number; y: number } } | null {
    const config = ai.config!;
    const priorityList = config.production.researchModulePriority;

    const buildings = this.world.getEntitiesWith('Building', 'Selectable', 'Transform');
    const candidates: { entityId: number; buildingId: string; position: { x: number; y: number }; priority: number }[] = [];

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (!building.isComplete()) continue;
      if (building.hasAddon()) continue; // Already has addon
      if (!building.canHaveAddon) continue;

      // Priority from config (higher index = lower priority, so invert)
      const priorityIndex = priorityList.indexOf(building.buildingId);
      if (priorityIndex >= 0) {
        candidates.push({
          entityId: entity.id,
          buildingId: building.buildingId,
          position: { x: transform.x, y: transform.y },
          priority: priorityList.length - priorityIndex // Invert so first in list = highest priority
        });
      }
    }

    // Return highest priority building
    candidates.sort((a, b) => b.priority - a.priority);
    return candidates.length > 0 ? candidates[0] : null;
  }

  private executeExpandingPhase(ai: AIPlayer): void {
    const config = ai.config!;
    const difficultySettings = config.difficultyConfig[ai.difficulty];
    const totalBases = this.countPlayerBases(ai);
    const currentTick = this.game.getCurrentTick();

    // Check if expansion is possible
    if (totalBases < difficultySettings.maxBases && ai.minerals >= config.economy.expansionMineralThreshold) {
      const expansionPos = this.findExpansionLocation(ai);
      if (expansionPos) {
        // Try to build main base at expansion (data-driven)
        if (this.tryBuildBuildingAt(ai, config.roles.mainBase, expansionPos)) {
          debugAI.log(`EnhancedAI: ${ai.playerId} expanding to base #${totalBases + 1} at (${expansionPos.x.toFixed(1)}, ${expansionPos.y.toFixed(1)})`);
          ai.lastExpansionTick = currentTick;
          ai.state = 'building';
          return;
        }
      }
    }

    // Continue normal building phase if expansion failed or not possible
    this.executeBuildingPhase(ai);
  }

  /**
   * Find a suitable expansion location by locating resource clusters without nearby command centers
   */
  private findExpansionLocation(ai: AIPlayer): { x: number; y: number } | null {
    const aiBase = this.findAIBase(ai);
    if (!aiBase) return null;

    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    // Get all existing command center positions for this AI player only (data-driven)
    const existingBases: Array<{ x: number; y: number }> = [];
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      // Only count this AI's own bases, not enemy bases
      if (selectable.playerId === ai.playerId && baseTypes.includes(building.buildingId)) {
        existingBases.push({ x: transform.x, y: transform.y });
      }
    }

    // Find mineral patches and group them into clusters
    const resources = this.getCachedResources();
    const mineralClusters: Array<{ x: number; y: number; count: number }> = [];

    for (const resource of resources) {
      const transform = resource.get<Transform>('Transform')!;
      const resourceComp = resource.get<Resource>('Resource');
      if (!resourceComp || resourceComp.resourceType !== 'minerals') continue;

      // Check if this mineral is near an existing cluster
      let addedToCluster = false;
      for (const cluster of mineralClusters) {
        const dx = transform.x - cluster.x;
        const dy = transform.y - cluster.y;
        if (Math.sqrt(dx * dx + dy * dy) < 10) {
          // Update cluster center (weighted average)
          cluster.x = (cluster.x * cluster.count + transform.x) / (cluster.count + 1);
          cluster.y = (cluster.y * cluster.count + transform.y) / (cluster.count + 1);
          cluster.count++;
          addedToCluster = true;
          break;
        }
      }

      if (!addedToCluster) {
        mineralClusters.push({ x: transform.x, y: transform.y, count: 1 });
      }
    }

    // Find the closest resource cluster that doesn't have a command center nearby
    let bestLocation: { x: number; y: number; distance: number } | null = null;

    for (const cluster of mineralClusters) {
      // Skip very small clusters (not real bases) - lowered to 2 for compatibility with smaller maps
      if (cluster.count < 2) continue;

      // Check if this cluster already has a command center
      let hasCCNearby = false;
      for (const base of existingBases) {
        const dx = cluster.x - base.x;
        const dy = cluster.y - base.y;
        if (Math.sqrt(dx * dx + dy * dy) < 15) {
          hasCCNearby = true;
          break;
        }
      }

      if (hasCCNearby) continue;

      // Calculate distance from AI base to this cluster
      const dx = cluster.x - aiBase.x;
      const dy = cluster.y - aiBase.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Prefer closer expansions
      if (!bestLocation || distance < bestLocation.distance) {
        // Calculate CC placement: offset FROM mineral cluster TOWARD the AI's main base
        // The CC should be placed on the "home" side of the minerals (closer to AI base)
        // Standard mineral distance is ~7 units from CC center
        const ccOffset = 6; // Distance from cluster center to CC
        const dirToBase = Math.atan2(aiBase.y - cluster.y, aiBase.x - cluster.x);

        bestLocation = {
          x: cluster.x + Math.cos(dirToBase) * ccOffset,
          y: cluster.y + Math.sin(dirToBase) * ccOffset,
          distance
        };
      }
    }

    return bestLocation ? { x: bestLocation.x, y: bestLocation.y } : null;
  }

  /**
   * Try to build a building at a specific location
   */
  private tryBuildBuildingAt(ai: AIPlayer, buildingType: string, position: { x: number; y: number }): boolean {
    const buildingDef = BUILDING_DEFINITIONS[buildingType];
    if (!buildingDef) return false;

    if (ai.minerals < buildingDef.mineralCost || ai.vespene < buildingDef.vespeneCost) return false;

    // Validate position is buildable
    if (!this.isValidBuildingSpot(position.x, position.y, buildingDef.width, buildingDef.height)) {
      return false;
    }

    // Find an available worker BEFORE committing to building
    const workerId = this.findAvailableWorker(ai.playerId);
    if (workerId === null) {
      debugAI.log(`[EnhancedAI] ${ai.playerId}: tryBuildBuildingAt failed - no available worker for ${buildingType}`);
      return false;
    }

    ai.minerals -= buildingDef.mineralCost;
    ai.vespene -= buildingDef.vespeneCost;

    this.game.eventBus.emit('building:place', {
      buildingType,
      position,
      playerId: ai.playerId,
      workerId, // Include workerId so BuildingPlacementSystem uses this specific worker
    });

    debugAI.log(`[EnhancedAI] ${ai.playerId}: Placed ${buildingType} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}) with worker ${workerId}`);

    return true;
  }

  private executeAttackingPhase(ai: AIPlayer, currentTick: number): void {
    // Find any enemy target (building or unit)
    const enemyTarget = this.findAnyEnemyTarget(ai);
    if (!enemyTarget) {
      // No enemies left - victory! Go back to building
      ai.state = 'building';
      return;
    }

    const armyUnits = this.getArmyUnits(ai.playerId);
    if (armyUnits.length === 0) {
      ai.state = 'building';
      return;
    }

    // Only retreat if army is tiny AND we have significant buildings to defend
    // AND there are still substantial enemies - otherwise finish the job!
    const totalBuildings = Array.from(ai.buildingCounts.values()).reduce((a, b) => a + b, 0);
    const enemyBuildingCount = this.countEnemyBuildings(ai.playerId);

    // NEVER retreat if any enemy has only 1-2 buildings left - finish them!
    // This ensures victory conditions are met
    const anyEnemyNearlyDefeated = this.isAnyEnemyNearlyDefeated(ai.playerId);
    if (anyEnemyNearlyDefeated) {
      // Keep attacking - don't retreat!
    } else if (armyUnits.length < 2 && totalBuildings > 3 && enemyBuildingCount > 5) {
      // Only retreat if enemy has substantial presence (more than 5 buildings total)
      ai.state = 'building';
      return;
    }

    ai.lastAttackTick = currentTick;

    // FIX: Only send attack commands to units that are idle or need new orders
    // Units that are already attacking should NOT be interrupted
    // Sending attack commands every tick was resetting targetEntityId and preventing attacks
    const idleOrNeedingOrders: number[] = [];
    for (const unitId of armyUnits) {
      const entity = this.world.getEntity(unitId);
      if (!entity) continue;
      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      // Skip units that are actively attacking with a target - don't interrupt them
      if (unit.state === 'attacking' && unit.targetEntityId !== null) {
        continue;
      }

      // Give new orders to units that are:
      // - idle (not doing anything)
      // - 'moving' with no target (finished kiting/repositioning)
      // - 'attackmoving' with no target and at/near their destination
      const isIdle = unit.state === 'idle';
      const isMovingNoTarget = unit.state === 'moving' && unit.targetEntityId === null;
      const isAttackMovingNoTarget = unit.state === 'attackmoving' &&
                                     unit.targetEntityId === null &&
                                     unit.targetX !== null && unit.targetY !== null;

      // For moving/attackmoving units, check if they've arrived at destination
      if (isAttackMovingNoTarget || isMovingNoTarget) {
        const transform = entity.get<Transform>('Transform');
        if (transform && unit.targetX !== null && unit.targetY !== null) {
          const dx = unit.targetX - transform.x;
          const dy = unit.targetY - transform.y;
          const distToTarget = Math.sqrt(dx * dx + dy * dy);
          // If close to destination (or no destination for moving), give new orders
          if (distToTarget < 3) {
            idleOrNeedingOrders.push(unitId);
          }
        } else if (isMovingNoTarget && (!unit.targetX || !unit.targetY)) {
          // Moving unit with no destination - give orders immediately
          idleOrNeedingOrders.push(unitId);
        }
      } else if (isIdle) {
        idleOrNeedingOrders.push(unitId);
      }
    }

    // Issue commands to units that need them
    // For each unit, check if there's a nearby enemy to directly attack
    // This ensures units actually fire instead of just attack-moving
    for (const unitId of idleOrNeedingOrders) {
      const entity = this.world.getEntity(unitId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      if (!transform || !unit) continue;

      // Look for a nearby enemy within sight range to directly attack
      // Pass the attacker unit to filter targets it can actually hit
      const nearbyEnemy = this.findNearestEnemyEntity(
        ai.playerId,
        { x: transform.x, y: transform.y },
        unit.sightRange,
        unit  // Filter targets based on attacker's canAttackGround/canAttackAir
      );

      if (nearbyEnemy) {
        // Direct attack command with specific target entity
        const directAttackCommand: GameCommand = {
          tick: currentTick,
          playerId: ai.playerId,
          type: 'ATTACK',
          entityIds: [unitId],
          targetEntityId: nearbyEnemy.entityId,
        };
        this.game.processCommand(directAttackCommand);
      } else {
        // No nearby enemy - attack-move toward enemy base
        const attackMoveCommand: GameCommand = {
          tick: currentTick,
          playerId: ai.playerId,
          type: 'ATTACK',
          entityIds: [unitId],
          targetPosition: { x: enemyTarget.x, y: enemyTarget.y },
        };
        this.game.processCommand(attackMoveCommand);
      }
    }

    // Continue attacking - stay in attack state until enemies are gone
    // This ensures AI pursues victory
  }

  /**
   * Find any enemy target - buildings first, then units
   * Used to ensure AI destroys ALL enemy assets for victory
   * Returns a position OUTSIDE the building (at its edge) to prevent unit clipping
   * IMPROVED: Each AI targets a different enemy based on proximity to their own base
   * This prevents all AI from ganging up on one player
   */
  private findAnyEnemyTarget(ai: AIPlayer): { x: number; y: number } | null {
    // Get AI's base position for calculating closest enemy
    const aiBase = this.findAIBase(ai);
    if (!aiBase) return null;

    const config = ai.config!;
    // For enemy base detection, use our own baseTypes (works for symmetric factions)
    // In a multi-faction game with different base buildings, this should be expanded
    const baseTypes = config.roles.baseTypes;

    // Count buildings per enemy player and track their base locations
    const enemyData: Map<string, {
      buildings: { x: number; y: number; width: number; height: number }[];
      basePos: { x: number; y: number } | null;
      distance: number;
    }> = new Map();

    const buildings = this.getCachedBuildingsWithTransform();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');

      if (!selectable || !health || !transform || !building) continue;
      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;

      const enemyId = selectable.playerId;
      if (!enemyData.has(enemyId)) {
        enemyData.set(enemyId, { buildings: [], basePos: null, distance: Infinity });
      }

      const data = enemyData.get(enemyId)!;
      data.buildings.push({
        x: transform.x,
        y: transform.y,
        width: building.width,
        height: building.height
      });

      // Track headquarters position as base location (data-driven)
      if (baseTypes.includes(building.buildingId)) {
        data.basePos = { x: transform.x, y: transform.y };
        // Calculate distance from this AI's base to enemy base
        const dx = transform.x - aiBase.x;
        const dy = transform.y - aiBase.y;
        data.distance = Math.sqrt(dx * dx + dy * dy);
      }
    }

    // Calculate distance for enemies without HQ (use first building)
    for (const [enemyId, data] of enemyData) {
      if (data.distance === Infinity && data.buildings.length > 0) {
        const firstBuilding = data.buildings[0];
        const dx = firstBuilding.x - aiBase.x;
        const dy = firstBuilding.y - aiBase.y;
        data.distance = Math.sqrt(dx * dx + dy * dy);
        data.basePos = { x: firstBuilding.x, y: firstBuilding.y };
      }
    }

    // Priority 1: Find the CLOSEST enemy to this AI's base (not weakest)
    // This distributes attacks across different enemies
    let closestEnemy: string | null = null;
    let closestDistance = Infinity;

    // But if any enemy has 2 or fewer buildings, prioritize finishing them off
    let nearlyDefeatedEnemy: string | null = null;
    let nearlyDefeatedDistance = Infinity;

    for (const [enemyId, data] of enemyData) {
      if (data.buildings.length <= 2 && data.distance < nearlyDefeatedDistance) {
        nearlyDefeatedEnemy = enemyId;
        nearlyDefeatedDistance = data.distance;
      }
      if (data.distance < closestDistance) {
        closestDistance = data.distance;
        closestEnemy = enemyId;
      }
    }

    // Prefer nearly-defeated enemies, otherwise attack closest
    const targetEnemy = nearlyDefeatedEnemy || closestEnemy;

    // Attack the target enemy's buildings
    if (targetEnemy && enemyData.has(targetEnemy)) {
      const targetBuildings = enemyData.get(targetEnemy)!.buildings;
      if (targetBuildings.length > 0) {
        const target = targetBuildings[0];
        return this.getAttackPositionForBuilding(target.x, target.y, target.width, target.height, aiBase);
      }
    }

    // If no buildings, look for enemy units (also prioritize closest)
    // PERF: Track closest unit per player AND overall closest during iteration
    // to avoid sorting and nested loops later
    const closestUnitByPlayer: Map<string, { x: number; y: number; distance: number }> = new Map();
    let overallClosestUnit: { x: number; y: number; distance: number } | null = null;

    const units = this.getCachedUnitsWithTransform();
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');

      if (!selectable || !health || !transform) continue;
      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;

      const enemyId = selectable.playerId;
      const dx = transform.x - aiBase.x;
      const dy = transform.y - aiBase.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // PERF: Track closest unit per player (replaces sort + [0])
      const existing = closestUnitByPlayer.get(enemyId);
      if (!existing || distance < existing.distance) {
        closestUnitByPlayer.set(enemyId, { x: transform.x, y: transform.y, distance });
      }

      // PERF: Track overall closest (replaces nested loop)
      if (!overallClosestUnit || distance < overallClosestUnit.distance) {
        overallClosestUnit = { x: transform.x, y: transform.y, distance };
      }
    }

    // Target units from the closest enemy - O(1) lookup now instead of O(n log n) sort
    if (targetEnemy && closestUnitByPlayer.has(targetEnemy)) {
      const closest = closestUnitByPlayer.get(targetEnemy)!;
      return { x: closest.x, y: closest.y };
    }

    // Fallback: any enemy unit (already tracked during iteration)
    return overallClosestUnit ? { x: overallClosestUnit.x, y: overallClosestUnit.y } : null;
  }

  /**
   * Get attack position at the edge of a building to prevent units from clipping inside
   */
  private getAttackPositionForBuilding(
    buildingX: number,
    buildingY: number,
    buildingWidth: number,
    buildingHeight: number,
    approachFrom: { x: number; y: number } | null
  ): { x: number; y: number } {
    // Calculate direction from approach point (AI base) to building
    let dx = 0;
    let dy = -1; // Default: approach from south

    if (approachFrom) {
      dx = buildingX - approachFrom.x;
      dy = buildingY - approachFrom.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        dx /= dist;
        dy /= dist;
      }
    }

    // Calculate attack position outside the building edge
    // Add buffer distance (2 units) so units gather just outside the building
    const halfWidth = buildingWidth / 2;
    const halfHeight = buildingHeight / 2;
    const buffer = 3; // Distance outside building edge for units to gather

    // Determine which edge to approach based on direction
    let offsetX = 0;
    let offsetY = 0;

    if (Math.abs(dx) > Math.abs(dy)) {
      // Approach from left or right
      offsetX = dx > 0 ? -(halfWidth + buffer) : (halfWidth + buffer);
    } else {
      // Approach from top or bottom
      offsetY = dy > 0 ? -(halfHeight + buffer) : (halfHeight + buffer);
    }

    return {
      x: buildingX + offsetX,
      y: buildingY + offsetY
    };
  }

  /**
   * Count how many enemy buildings remain
   */
  private countEnemyBuildings(playerId: string): number {
    let count = 0;
    const buildings = this.getCachedBuildings();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!selectable || !health) continue;
      if (selectable.playerId === playerId) continue;
      if (health.isDead()) continue;

      count++;
    }
    return count;
  }

  /**
   * Check if any enemy player is nearly defeated (1-2 buildings left)
   * Used to ensure AI finishes off weakened enemies for victory
   */
  private isAnyEnemyNearlyDefeated(playerId: string): boolean {
    const buildingsPerEnemy: Map<string, number> = new Map();

    const buildings = this.getCachedBuildings();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!selectable || !health) continue;
      if (selectable.playerId === playerId) continue;
      if (health.isDead()) continue;

      const enemyId = selectable.playerId;
      buildingsPerEnemy.set(enemyId, (buildingsPerEnemy.get(enemyId) || 0) + 1);
    }

    // Check if any enemy has 2 or fewer buildings
    for (const [, count] of buildingsPerEnemy) {
      if (count <= 2) {
        return true;
      }
    }
    return false;
  }

  private executeDefendingPhase(ai: AIPlayer): void {
    const baseLocation = this.findAIBase(ai);
    if (!baseLocation) return;

    const armyUnits = this.getArmyUnits(ai.playerId);
    if (armyUnits.length === 0) {
      ai.state = 'building';
      return;
    }

    const currentTick = this.game.getCurrentTick();

    // For each army unit, find a nearby enemy it can actually attack
    let anyEnemyFound = false;
    for (const unitId of armyUnits) {
      const entity = this.world.getEntity(unitId);
      if (!entity) continue;
      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      if (!unit || !transform) continue;

      // Skip units already attacking with a target
      if (unit.state === 'attacking' && unit.targetEntityId !== null) continue;

      // Find a nearby enemy this specific unit can attack (filters by canAttackGround/canAttackAir)
      const nearbyEnemy = this.findNearestEnemyEntity(
        ai.playerId,
        { x: transform.x, y: transform.y },
        30,
        unit  // Pass attacker to filter valid targets
      );

      if (nearbyEnemy) {
        anyEnemyFound = true;
        const directAttackCommand: GameCommand = {
          tick: currentTick,
          playerId: ai.playerId,
          type: 'ATTACK',
          entityIds: [unitId],
          targetEntityId: nearbyEnemy.entityId,
        };
        this.game.processCommand(directAttackCommand);
      }
    }

    if (!anyEnemyFound) {
      // No enemy in range - rally units near the base (not AT it) to form a defensive position
      // Position units in front of the base (offset by 8 units)
      const rallyPoint = {
        x: baseLocation.x + 8,
        y: baseLocation.y + 8,
      };

      // Only send move commands to units that aren't already at the rally point
      const unitsNeedingMove: number[] = [];
      for (const unitId of armyUnits) {
        const entity = this.world.getEntity(unitId);
        if (!entity) continue;
        const transform = entity.get<Transform>('Transform');
        if (!transform) continue;

        const dx = transform.x - rallyPoint.x;
        const dy = transform.y - rallyPoint.y;
        const distToRally = Math.sqrt(dx * dx + dy * dy);

        // Only issue move command if unit is more than 3 units away from rally point
        if (distToRally > 3) {
          unitsNeedingMove.push(unitId);
        }
      }

      if (unitsNeedingMove.length > 0) {
        const command: GameCommand = {
          tick: this.game.getCurrentTick(),
          playerId: ai.playerId,
          type: 'MOVE',
          entityIds: unitsNeedingMove,
          targetPosition: rallyPoint,
        };
        this.game.processCommand(command);
      }

      // No threat nearby, switch back to building
      ai.state = 'building';
    }

    // Check if threat is cleared
    if (!this.isUnderAttack(ai.playerId)) {
      ai.state = 'building';
    }
  }

  /**
   * Find a nearby enemy unit or building to defend against
   */
  private findNearbyEnemy(playerId: string, position: { x: number; y: number }, range: number): { x: number; y: number } | null {
    // Look for enemy units first
    const units = this.getCachedUnitsWithTransform();
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');

      if (!selectable || !health || !transform) continue;
      if (selectable.playerId === playerId) continue;
      if (health.isDead()) continue;

      const dx = transform.x - position.x;
      const dy = transform.y - position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= range) {
        return { x: transform.x, y: transform.y };
      }
    }

    return null;
  }

  /**
   * Find the nearest enemy entity (unit or building) that can be attacked directly
   * Returns both the entity ID and position for more precise targeting
   * @param attacker Optional - if provided, only returns targets this unit can actually attack
   * PERF: Uses spatial grid for O(nearby) lookup instead of O(n+m) linear scan
   */
  private findNearestEnemyEntity(
    playerId: string,
    position: { x: number; y: number },
    range: number,
    attacker?: Unit
  ): { entityId: number; x: number; y: number } | null {
    let closestEnemy: { entityId: number; x: number; y: number; distance: number } | null = null;

    // PERF: Query spatial grids instead of iterating all entities
    // Units in range
    const nearbyUnitIds = this.world.unitGrid.queryRadius(position.x, position.y, range);
    for (let i = 0; i < nearbyUnitIds.length; i++) {
      const entityId = nearbyUnitIds[i];
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');
      const targetUnit = entity.get<Unit>('Unit');

      if (!selectable || !health || !transform) continue;
      if (selectable.playerId === playerId) continue;
      if (health.isDead()) continue;

      // If attacker provided, check if it can actually attack this target type
      if (attacker && targetUnit) {
        const targetIsFlying = targetUnit.isFlying;
        if (!attacker.canAttackTarget(targetIsFlying)) continue;
      }

      const dx = transform.x - position.x;
      const dy = transform.y - position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= range && (!closestEnemy || distance < closestEnemy.distance)) {
        closestEnemy = { entityId: entity.id, x: transform.x, y: transform.y, distance };
      }
    }

    // Buildings in range (buildings are always ground targets)
    // If attacker can't attack ground, skip buildings entirely
    if (!attacker || attacker.canAttackGround) {
      const nearbyBuildingIds = this.world.buildingGrid.queryRadius(position.x, position.y, range);
      for (let i = 0; i < nearbyBuildingIds.length; i++) {
        const entityId = nearbyBuildingIds[i];
        const entity = this.world.getEntity(entityId);
        if (!entity) continue;

        const selectable = entity.get<Selectable>('Selectable');
        const health = entity.get<Health>('Health');
        const transform = entity.get<Transform>('Transform');

        if (!selectable || !health || !transform) continue;
        if (selectable.playerId === playerId) continue;
        if (health.isDead()) continue;

        const dx = transform.x - position.x;
        const dy = transform.y - position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= range && (!closestEnemy || distance < closestEnemy.distance)) {
          closestEnemy = { entityId: entity.id, x: transform.x, y: transform.y, distance };
        }
      }
    }

    return closestEnemy ? { entityId: closestEnemy.entityId, x: closestEnemy.x, y: closestEnemy.y } : null;
  }

  private executeScoutingPhase(ai: AIPlayer, currentTick: number): void {
    ai.lastScoutTick = currentTick;

    // Send a worker or fast unit to scout
    const scoutUnit = this.getScoutUnit(ai);
    if (!scoutUnit) {
      ai.state = 'building';
      return;
    }

    // Pick a random unexplored location
    const scoutTarget = this.getScoutTarget(ai);
    if (!scoutTarget) {
      ai.state = 'building';
      return;
    }

    const command: GameCommand = {
      tick: currentTick,
      playerId: ai.playerId,
      type: 'MOVE',
      entityIds: [scoutUnit],
      targetPosition: scoutTarget,
    };

    this.game.processCommand(command);
    ai.scoutedLocations.add(`${Math.floor(scoutTarget.x / 20)},${Math.floor(scoutTarget.y / 20)}`);
    ai.state = 'building';
  }

  private executeHarassingPhase(ai: AIPlayer, currentTick: number): void {
    ai.lastHarassTick = currentTick;

    const harassUnits = this.getHarassUnits(ai);
    if (harassUnits.length === 0) {
      ai.state = 'building';
      return;
    }

    // Attack enemy workers or expansion
    const harassTarget = this.findHarassTarget(ai);
    if (!harassTarget) {
      ai.state = 'building';
      return;
    }

    const command: GameCommand = {
      tick: currentTick,
      playerId: ai.playerId,
      type: 'ATTACK',
      entityIds: harassUnits,
      targetPosition: harassTarget,
    };

    this.game.processCommand(command);
    ai.state = 'building';
  }

  // Helper methods
  private tryTrainUnit(ai: AIPlayer, unitType: string): boolean {
    const unitDef = UNIT_DEFINITIONS[unitType];
    if (!unitDef) return false;

    if (ai.minerals < unitDef.mineralCost || ai.vespene < unitDef.vespeneCost) return false;
    if (ai.supply + unitDef.supplyCost > ai.maxSupply) return false;

    const buildings = this.world.getEntitiesWith('Building', 'Selectable');
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (!building.isComplete()) continue;
      if (!building.canProduce.includes(unitType)) continue;
      if (building.productionQueue.length >= 3) continue;

      ai.minerals -= unitDef.mineralCost;
      ai.vespene -= unitDef.vespeneCost;
      building.addToProductionQueue('unit', unitType, unitDef.buildTime);

      return true;
    }

    return false;
  }

  private tryBuildBuilding(ai: AIPlayer, buildingType: string): boolean {
    const config = ai.config!;
    const buildingDef = BUILDING_DEFINITIONS[buildingType];
    if (!buildingDef) {
      debugAI.log(`[EnhancedAI] ${ai.playerId}: tryBuildBuilding failed - unknown building type: ${buildingType}`);
      return false;
    }

    if (ai.minerals < buildingDef.mineralCost || ai.vespene < buildingDef.vespeneCost) {
      // Not enough resources - this is normal, don't log
      return false;
    }

    const basePos = this.findAIBase(ai);
    if (!basePos) {
      debugAI.log(`[EnhancedAI] ${ai.playerId}: tryBuildBuilding failed - cannot find AI base!`);
      return false;
    }

    // Find an available worker BEFORE committing to building
    // This prevents the AI from advancing build order when no worker is available
    const workerId = this.findAvailableWorker(ai.playerId);
    if (workerId === null) {
      debugAI.log(`[EnhancedAI] ${ai.playerId}: tryBuildBuilding failed - no available worker for ${buildingType}`);
      return false;
    }

    let buildPos: { x: number; y: number } | null = null;

    // Special handling for extractors - must be placed on vespene geysers (data-driven)
    if (buildingType === config.roles.gasExtractor) {
      buildPos = this.findAvailableVespeneGeyser(ai, basePos);
      if (!buildPos) {
        // No available vespene geyser nearby, skip building refinery
        debugAI.log(`[EnhancedAI] ${ai.playerId}: tryBuildBuilding failed - no available vespene geyser near base at (${basePos.x}, ${basePos.y})`);
        return false;
      }
    } else {
      buildPos = this.findBuildingSpot(ai.playerId, basePos, buildingDef.width, buildingDef.height);
      if (!buildPos) {
        debugAI.log(`[EnhancedAI] ${ai.playerId}: tryBuildBuilding failed - no valid building spot for ${buildingType} near base at (${basePos.x}, ${basePos.y})`);
        return false;
      }
    }

    ai.minerals -= buildingDef.mineralCost;
    ai.vespene -= buildingDef.vespeneCost;

    this.game.eventBus.emit('building:place', {
      buildingType,
      position: buildPos,
      playerId: ai.playerId,
      workerId, // Include workerId so BuildingPlacementSystem uses this specific worker
    });

    debugAI.log(`[EnhancedAI] ${ai.playerId}: Placed ${buildingType} at (${buildPos.x.toFixed(1)}, ${buildPos.y.toFixed(1)}) with worker ${workerId}`);

    return true;
  }

  /**
   * Find an available worker for the AI to assign to construction.
   * Prefers idle workers, then gathering workers, then moving workers.
   * PERF: Single-pass implementation instead of triple-pass O(3n)
   */
  private findAvailableWorker(playerId: string): number | null {
    const units = this.getCachedUnits();

    // PERF: Track best candidate by priority in single pass
    let idleWorker: number | null = null;
    let gatheringWorker: number | null = null;
    let movingWorker: number | null = null;

    for (const entity of units) {
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!unit || !selectable || !health) continue;
      if (selectable.playerId !== playerId) continue;
      if (!unit.isWorker) continue;
      if (health.isDead()) continue;

      // Track by priority - idle > gathering > moving
      if (unit.state === 'idle') {
        return entity.id; // Best priority - return immediately
      } else if (unit.state === 'gathering' && gatheringWorker === null) {
        gatheringWorker = entity.id;
      } else if (unit.state === 'moving' && movingWorker === null) {
        movingWorker = entity.id;
      }
    }

    // Return best available by priority
    return gatheringWorker ?? movingWorker ?? null;
  }

  /**
   * Find incomplete buildings (paused or waiting_for_worker) that need workers assigned.
   * Returns buildings sorted by progress (highest first - prioritize nearly complete buildings).
   */
  private findIncompleteBuildings(playerId: string): { buildingId: number; progress: number }[] {
    const buildings = this.getCachedBuildingsWithTransform();
    const incomplete: { buildingId: number; progress: number }[] = [];

    for (const entity of buildings) {
      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!building || !selectable || !health) continue;
      if (selectable.playerId !== playerId) continue;
      if (health.isDead()) continue;

      // Check for paused or waiting_for_worker buildings
      if (building.state === 'paused' || building.state === 'waiting_for_worker') {
        incomplete.push({
          buildingId: entity.id,
          progress: building.buildProgress,
        });
      }
    }

    // Sort by progress descending (prioritize nearly complete buildings)
    incomplete.sort((a, b) => b.progress - a.progress);

    return incomplete;
  }

  /**
   * Try to resume construction on incomplete buildings.
   * Returns true if a worker was assigned to resume construction.
   */
  private tryResumeIncompleteBuildings(ai: AIPlayer): boolean {
    const incompleteBuildings = this.findIncompleteBuildings(ai.playerId);

    if (incompleteBuildings.length === 0) {
      return false;
    }

    // Find a worker that's not already building something
    const workerId = this.findAvailableWorkerNotBuilding(ai.playerId);
    if (workerId === null) {
      return false;
    }

    // Resume the highest priority incomplete building
    const target = incompleteBuildings[0];

    debugAI.log(`[EnhancedAI] ${ai.playerId}: Resuming incomplete building ${target.buildingId} at ${Math.round(target.progress * 100)}% with worker ${workerId}`);

    this.game.eventBus.emit('command:resume_construction', {
      workerId,
      buildingId: target.buildingId,
    });

    return true;
  }

  /**
   * Find an available worker for the AI that's not already building.
   * This is stricter than findAvailableWorker - excludes workers in 'building' state.
   * PERF: Single-pass implementation instead of triple-pass O(3n) -> O(n)
   */
  private findAvailableWorkerNotBuilding(playerId: string): number | null {
    const units = this.getCachedUnits();

    // PERF: Track best candidate by priority in single pass
    // Priority: idle (3) > gathering (2) > moving (1)
    let bestId: number | null = null;
    let bestPriority = 0;

    for (const entity of units) {
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!unit || !selectable || !health) continue;
      if (selectable.playerId !== playerId) continue;
      if (!unit.isWorker) continue;
      if (health.isDead()) continue;
      if (unit.constructingBuildingId !== null) continue; // Skip workers already assigned to construction

      // Determine priority based on state
      let priority = 0;
      if (unit.state === 'idle') {
        priority = 3;
      } else if (unit.state === 'gathering') {
        priority = 2;
      } else if (unit.state === 'moving') {
        priority = 1;
      }

      // Update best if this is higher priority
      if (priority > bestPriority) {
        bestPriority = priority;
        bestId = entity.id;
        // Early exit if we found idle (highest priority)
        if (priority === 3) return bestId;
      }
    }

    return bestId;
  }

  /**
   * Find a vespene geyser near any AI base that doesn't have a refinery yet
   * Searches near main base and all expansion bases (data-driven)
   */
  private findAvailableVespeneGeyser(ai: AIPlayer, _basePos: { x: number; y: number }): { x: number; y: number } | null {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    // Get all AI base positions to search for geysers near expansions too
    const basePositions: { x: number; y: number }[] = [];
    const buildings = this.getCachedBuildingsWithTransform();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (baseTypes.includes(building.buildingId)) {
        basePositions.push({ x: transform.x, y: transform.y });
      }
    }

    if (basePositions.length === 0) return null;

    const resources = this.getCachedResources();
    let closestGeyser: { x: number; y: number; distance: number } | null = null;

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');

      if (!resource || !transform) continue;
      if (resource.resourceType !== 'vespene') continue;
      if (resource.hasRefinery()) continue; // Already has a refinery

      // Check distance to any base
      for (const basePos of basePositions) {
        const dx = transform.x - basePos.x;
        const dy = transform.y - basePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Only consider geysers within reasonable distance of any base
        if (distance < 30) {
          if (!closestGeyser || distance < closestGeyser.distance) {
            closestGeyser = { x: transform.x, y: transform.y, distance };
          }
          break; // Found a nearby base, no need to check others
        }
      }
    }

    return closestGeyser ? { x: closestGeyser.x, y: closestGeyser.y } : null;
  }

  /**
   * Count the number of vespene geysers near any AI base that don't have extractors yet
   * This helps the AI build extractors on all available geysers at main and expansion bases (data-driven)
   */
  private countAvailableVespeneGeysers(ai: AIPlayer): number {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    // Get all AI base positions
    const basePositions: { x: number; y: number }[] = [];
    const buildings = this.getCachedBuildingsWithTransform();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (baseTypes.includes(building.buildingId)) {
        basePositions.push({ x: transform.x, y: transform.y });
      }
    }

    if (basePositions.length === 0) return 0;

    // Count vespene geysers near any base that don't have extractors
    const resources = this.getCachedResources();
    let availableCount = 0;

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');

      if (!resource || !transform) continue;
      if (resource.resourceType !== 'vespene') continue;
      if (resource.hasRefinery()) continue; // Already has an extractor

      // Check if this geyser is near any AI base
      for (const basePos of basePositions) {
        const dx = transform.x - basePos.x;
        const dy = transform.y - basePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 30) {
          availableCount++;
          break; // Don't count same geyser multiple times
        }
      }
    }

    return availableCount;
  }

  private findAIBase(ai: AIPlayer): { x: number; y: number } | null {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    let foundForPlayer = false;
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;
      foundForPlayer = true;
      if (baseTypes.includes(building.buildingId)) {
        return { x: transform.x, y: transform.y };
      }
    }
    if (!foundForPlayer) {
      debugAI.log(`[EnhancedAI] findAIBase: No buildings at all for ${ai.playerId}`);
    }
    return null;
  }

  private findEnemyBase(ai: AIPlayer): { x: number; y: number } | null {
    const config = ai.config!;
    // For enemy detection, use our own baseTypes (works for symmetric factions)
    // For multi-faction games, this would need a global registry of all base types
    const baseTypes = config.roles.baseTypes;

    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId === ai.playerId) continue;
      if (baseTypes.includes(building.buildingId)) {
        return { x: transform.x, y: transform.y };
      }
    }

    // Return any enemy building
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId === ai.playerId) continue;
      return { x: transform.x, y: transform.y };
    }

    return null;
  }

  private findBuildingSpot(
    playerId: string,
    basePos: { x: number; y: number },
    width: number,
    height: number
  ): { x: number; y: number } | null {
    // Generate more varied offsets in a spiral pattern
    const offsets: { x: number; y: number }[] = [];

    // Add offsets in expanding rings around the base
    for (let radius = 6; radius <= 20; radius += 3) {
      for (let angle = 0; angle < 8; angle++) {
        const theta = (angle * Math.PI * 2) / 8 + this.random.next() * 0.5;
        const x = Math.round(Math.cos(theta) * radius);
        const y = Math.round(Math.sin(theta) * radius);
        offsets.push({ x, y });
      }
    }

    // Shuffle offsets for variety
    for (let i = offsets.length - 1; i > 0; i--) {
      const j = Math.floor(this.random.next() * (i + 1));
      [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
    }

    // Try each offset until we find a valid spot
    for (const offset of offsets) {
      const pos = { x: basePos.x + offset.x, y: basePos.y + offset.y };
      if (this.isValidBuildingSpot(pos.x, pos.y, width, height)) {
        return pos;
      }
    }

    return null;
  }

  private isValidBuildingSpot(x: number, y: number, width: number, height: number): boolean {
    const config = this.game.config;
    const halfW = width / 2;
    const halfH = height / 2;

    // Check map bounds (position is center-based)
    if (x - halfW < 0 || y - halfH < 0 || x + halfW > config.mapWidth || y + halfH > config.mapHeight) {
      return false;
    }

    // Check for overlapping buildings
    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;
      const existingHalfW = building.width / 2;
      const existingHalfH = building.height / 2;

      const dx = Math.abs(x - transform.x);
      const dy = Math.abs(y - transform.y);

      if (dx < halfW + existingHalfW + 1 && dy < halfH + existingHalfH + 1) {
        return false;
      }
    }

    // Check for overlapping resources
    const resources = this.getCachedResources();
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;
      const dx = Math.abs(x - transform.x);
      const dy = Math.abs(y - transform.y);

      if (dx < halfW + 2 && dy < halfH + 2) {
        return false;
      }
    }

    // Check for overlapping decorations (rocks, trees, etc.)
    if (!this.game.isPositionClearOfDecorations(x, y, width, height)) {
      return false;
    }

    return true;
  }

  private isUnderAttack(playerId: string): boolean {
    const buildings = this.getCachedBuildings();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;
      if (health.getHealthPercent() < 0.9) return true;
    }
    return false;
  }

  private getArmyUnits(playerId: string): number[] {
    const armyUnits: number[] = [];
    const entities = this.getCachedUnits();

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;
      if (unit.isWorker) continue;
      if (health.isDead()) continue;
      // Exclude non-combat units (0 attack damage) like Lifter, Overseer
      if (unit.attackDamage === 0) continue;

      armyUnits.push(entity.id);
    }

    return armyUnits;
  }

  private getHarassUnits(ai: AIPlayer): number[] {
    // Get fast units for harass (hellions, reapers)
    const harassUnits: number[] = [];
    const entities = this.getCachedUnits();

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      if (unit.unitId === 'scorcher' || unit.unitId === 'vanguard') {
        harassUnits.push(entity.id);
      }
    }

    return harassUnits.slice(0, 4); // Max 4 units for harass
  }

  private getScoutUnit(ai: AIPlayer): number | null {
    const entities = this.getCachedUnits();

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      // Prefer fast units for scouting
      if (unit.unitId === 'vanguard' || unit.unitId === 'scorcher') {
        return entity.id;
      }
    }

    // Use a worker if no fast units
    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;
      if (unit.isWorker && unit.state === 'idle') {
        return entity.id;
      }
    }

    return null;
  }

  private getScoutTarget(ai: AIPlayer): { x: number; y: number } | null {
    const config = this.game.config;

    // Common expansion locations
    const targets = [
      { x: config.mapWidth - 30, y: config.mapHeight - 30 },
      { x: 30, y: 30 },
      { x: config.mapWidth / 2, y: config.mapHeight / 2 },
      { x: config.mapWidth - 30, y: 30 },
      { x: 30, y: config.mapHeight - 30 },
    ];

    for (const target of targets) {
      const key = `${Math.floor(target.x / 20)},${Math.floor(target.y / 20)}`;
      if (!ai.scoutedLocations.has(key)) {
        return target;
      }
    }

    // Random location
    return {
      x: this.random.next() * config.mapWidth,
      y: this.random.next() * config.mapHeight,
    };
  }

  private findHarassTarget(ai: AIPlayer): { x: number; y: number } | null {
    // Find enemy workers or expansion
    const units = this.getCachedUnitsWithTransform();

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === ai.playerId) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) {
        return { x: transform.x, y: transform.y };
      }
    }

    // Otherwise target enemy base
    return this.findEnemyBase(ai);
  }

  /**
   * Assign workers to repair damaged buildings and mechanical units
   */
  private assignWorkersToRepair(ai: AIPlayer): void {
    // Find damaged buildings that need repair (below 90% health)
    const damagedBuildings: { entityId: number; x: number; y: number; healthPercent: number }[] = [];
    const buildings = this.getCachedBuildingsWithTransform();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;
      if (!building.isComplete()) continue; // Don't repair buildings under construction

      const healthPercent = health.getHealthPercent();
      if (healthPercent < 0.9) {
        damagedBuildings.push({
          entityId: entity.id,
          x: transform.x,
          y: transform.y,
          healthPercent
        });
      }
    }

    // Find damaged mechanical units (below 90% health)
    const damagedUnits: { entityId: number; x: number; y: number; healthPercent: number }[] = [];
    const units = this.getCachedUnitsWithTransform();

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;
      if (!unit.isMechanical) continue; // Can only repair mechanical units
      if (unit.isWorker) continue; // Don't repair workers (they can repair each other endlessly)

      const healthPercent = health.getHealthPercent();
      if (healthPercent < 0.9) {
        damagedUnits.push({
          entityId: entity.id,
          x: transform.x,
          y: transform.y,
          healthPercent
        });
      }
    }

    // If nothing needs repair, return
    if (damagedBuildings.length === 0 && damagedUnits.length === 0) return;

    // Prioritize: critically damaged buildings > moderately damaged buildings > damaged units
    // Sort by health (most damaged first)
    damagedBuildings.sort((a, b) => a.healthPercent - b.healthPercent);
    damagedUnits.sort((a, b) => a.healthPercent - b.healthPercent);

    // Find available workers for repair (idle or gathering, not already repairing or building)
    const availableWorkers: { entityId: number; x: number; y: number; isIdle: boolean }[] = [];

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (!unit.isWorker) continue;
      if (!unit.canRepair) continue;
      if (health.isDead()) continue;
      if (unit.isRepairing) continue; // Already repairing
      if (unit.constructingBuildingId !== null) continue; // Building something
      if (unit.state === 'building') continue;

      // Use idle or moving workers for any repair
      // Use gathering workers for damaged buildings (they'll return to gathering after repair)
      const isIdle = unit.state === 'idle' || unit.state === 'moving';
      const isGathering = unit.state === 'gathering';

      if (isIdle || isGathering) {
        availableWorkers.push({
          entityId: entity.id,
          x: transform.x,
          y: transform.y,
          isIdle
        });
      }
    }

    if (availableWorkers.length === 0) return;

    // Sort workers - idle first
    availableWorkers.sort((a, b) => (b.isIdle ? 1 : 0) - (a.isIdle ? 1 : 0));

    // Assign workers to repair targets
    let workerIndex = 0;

    // Repair critically damaged buildings first (below 50%)
    for (const building of damagedBuildings) {
      if (building.healthPercent < 0.5 && workerIndex < availableWorkers.length) {
        const worker = availableWorkers[workerIndex++];
        this.game.eventBus.emit('command:repair', {
          repairerId: worker.entityId,
          targetId: building.entityId,
        });
      }
    }

    // Then repair other damaged buildings
    for (const building of damagedBuildings) {
      if (building.healthPercent >= 0.5 && workerIndex < availableWorkers.length) {
        const worker = availableWorkers[workerIndex++];
        this.game.eventBus.emit('command:repair', {
          repairerId: worker.entityId,
          targetId: building.entityId,
        });
      }
    }

    // Finally repair damaged mechanical units
    for (const unit of damagedUnits) {
      if (workerIndex < availableWorkers.length) {
        const worker = availableWorkers[workerIndex++];
        this.game.eventBus.emit('command:repair', {
          repairerId: worker.entityId,
          targetId: unit.entityId,
        });
      }
    }
  }

  /**
   * Find idle workers and send them to gather minerals or vespene
   * Uses SC2-style optimal saturation targeting
   * Now considers all AI bases (main and expansions) (data-driven)
   */
  private assignIdleWorkersToGather(ai: AIPlayer): void {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    // Find ALL AI base positions (main and expansions)
    const basePositions: { x: number; y: number }[] = [];
    const buildings = this.getCachedBuildingsWithTransform();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (baseTypes.includes(building.buildingId)) {
        basePositions.push({ x: transform.x, y: transform.y });
      }
    }

    if (basePositions.length === 0) {
      debugAI.log(`[EnhancedAI] ${ai.playerId}: No base found for gathering!`);
      return;
    }

    // Find mineral patches near ANY base with their current saturation
    const resources = this.getCachedResources();
    const nearbyMinerals: { entityId: number; x: number; y: number; distance: number; currentWorkers: number }[] = [];

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');

      if (!resource || !transform) continue;
      if (resource.resourceType !== 'minerals') continue;
      if (resource.isDepleted()) continue;

      // Check distance to ANY base
      let minDistance = Infinity;
      for (const basePos of basePositions) {
        const dx = transform.x - basePos.x;
        const dy = transform.y - basePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < minDistance) {
          minDistance = distance;
        }
      }

      // Only consider minerals within reasonable distance of any base
      if (minDistance < 30) {
        nearbyMinerals.push({
          entityId: entity.id,
          x: transform.x,
          y: transform.y,
          distance: minDistance,
          currentWorkers: resource.getCurrentGatherers()
        });
      }
    }

    // Find AI's completed refineries for vespene harvesting
    const refineries: { entityId: number; resourceEntityId: number; currentWorkers: number }[] = [];
    const extractorBuildings = this.world.getEntitiesWith('Building', 'Selectable', 'Transform');

    // PERF: Build a map of extractorEntityId -> resource for O(1) lookup instead of O(n*m) nested loop
    const extractorToResource = new Map<number, { entity: typeof resources extends Iterable<infer T> ? T : never; resource: Resource }>();
    for (const resEntity of resources) {
      const resource = resEntity.get<Resource>('Resource');
      if (!resource) continue;
      if (resource.resourceType !== 'vespene') continue;
      if (resource.extractorEntityId !== null) {
        extractorToResource.set(resource.extractorEntityId, { entity: resEntity, resource });
      }
    }

    for (const entity of extractorBuildings) {
      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');

      if (!building || !selectable) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (building.buildingId !== config.roles.gasExtractor) continue; // Data-driven gas extractor
      if (!building.isComplete()) continue;

      // PERF: O(1) lookup via map instead of O(n) nested loop
      const vespeneData = extractorToResource.get(entity.id);
      if (vespeneData) {
        refineries.push({
          entityId: entity.id,
          resourceEntityId: vespeneData.entity.id,
          currentWorkers: vespeneData.resource.getCurrentGatherers()
        });
      }
    }

    // Find idle AI workers and count workers assigned to each resource
    const units = this.getCachedUnits();
    const idleWorkers: number[] = [];

    // Track all worker states for debugging
    const workerStates: Record<string, number> = {};

    // Count workers that are moving to gather (have gatherTargetId set) - these aren't in currentGatherers yet
    const workersMovingToResource: Map<number, number> = new Map();

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable');
      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');

      // Defensive null checks
      if (!selectable || !unit || !health) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (!unit.isWorker) continue;
      if (health.isDead()) continue;

      // Track worker state counts
      workerStates[unit.state] = (workerStates[unit.state] || 0) + 1;

      // Track workers that are moving to a gather target (not yet registered as gatherers)
      if (unit.gatherTargetId !== null && (unit.state === 'moving' || unit.state === 'gathering')) {
        const count = workersMovingToResource.get(unit.gatherTargetId) || 0;
        workersMovingToResource.set(unit.gatherTargetId, count + 1);
      }

      // Grab workers that are effectively idle:
      // Consider worker idle if:
      // - Truly idle
      // - Moving but with no target (finished moving, waiting for orders)
      // NOTE: Removed buggy 'isStuckMoving' which caught workers actively moving to build
      const isIdle = unit.state === 'idle';
      const isMovingNoTarget = unit.state === 'moving' &&
                               unit.targetX === null &&
                               unit.targetY === null &&
                               unit.gatherTargetId === null;

      if (isIdle || isMovingNoTarget) {
        idleWorkers.push(entity.id);
      }
    }

    // Add workers moving to each refinery to the currentWorkers count
    // This prevents over-assigning workers to the same refinery
    for (const refinery of refineries) {
      const movingCount = workersMovingToResource.get(refinery.resourceEntityId) || 0;
      // Use the higher of registered gatherers or moving workers to avoid double-counting
      refinery.currentWorkers = Math.max(refinery.currentWorkers, movingCount);
    }

    // Also update mineral patch counts
    for (const mineral of nearbyMinerals) {
      const movingCount = workersMovingToResource.get(mineral.entityId) || 0;
      mineral.currentWorkers = Math.max(mineral.currentWorkers, movingCount);
    }

    if (nearbyMinerals.length === 0 && refineries.length === 0) return;

    // Debug log periodically
    if (this.game.getCurrentTick() % 200 === 0) {
      const statesStr = Object.entries(workerStates).map(([k, v]) => `${k}:${v}`).join(', ');
      const totalMineralWorkers = nearbyMinerals.reduce((sum, m) => sum + m.currentWorkers, 0);
      const totalGasWorkers = refineries.reduce((sum, r) => sum + r.currentWorkers, 0);
      debugAI.log(`[EnhancedAI] ${ai.playerId}: workers=[${statesStr}], idle=${idleWorkers.length}, minerals=${totalMineralWorkers}/${nearbyMinerals.length * OPTIMAL_WORKERS_PER_MINERAL}, gas=${totalGasWorkers}/${refineries.length * OPTIMAL_WORKERS_PER_VESPENE}`);
    }

    // PERF: Sort minerals ONCE before the worker loop instead of every iteration
    // Sort by workers first (fewest first), then distance - .find() still works correctly
    // after incrementing worker counts since we're looking for first match under threshold
    nearbyMinerals.sort((a, b) => {
      if (a.currentWorkers !== b.currentWorkers) {
        return a.currentWorkers - b.currentWorkers;
      }
      return a.distance - b.distance;
    });

    // PERF: Pre-compute closest mineral for fallback case to avoid sorting inside loop
    const closestMineral = nearbyMinerals.length > 0
      ? nearbyMinerals.reduce((closest, m) => m.distance < closest.distance ? m : closest)
      : null;

    // PERF: Sort refineries once too, by current workers
    refineries.sort((a, b) => a.currentWorkers - b.currentWorkers);

    // PERF: Track indices into sorted arrays instead of calling find() repeatedly
    // Since arrays are sorted by currentWorkers (ascending), we can use indices
    // that advance as elements become "full"
    let gasIndex = 0;
    let mineralIndex = 0;
    let oversatIndex = 0;

    // Assign idle workers using SC2-style optimal saturation
    for (const workerId of idleWorkers) {
      // Priority 1: Fill undersaturated gas (vespene is more valuable)
      // PERF: Use index instead of find() - advance index past full refineries
      while (gasIndex < refineries.length && refineries[gasIndex].currentWorkers >= OPTIMAL_WORKERS_PER_VESPENE) {
        gasIndex++;
      }
      if (gasIndex < refineries.length) {
        const undersaturatedGas = refineries[gasIndex];
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: undersaturatedGas.resourceEntityId,
        });
        undersaturatedGas.currentWorkers++; // Track assignment for next worker
        continue;
      }

      // Priority 2: Fill undersaturated minerals (patches with < 2 workers)
      // PERF: Use index instead of find() - advance index past full minerals
      while (mineralIndex < nearbyMinerals.length && nearbyMinerals[mineralIndex].currentWorkers >= OPTIMAL_WORKERS_PER_MINERAL) {
        mineralIndex++;
      }
      if (mineralIndex < nearbyMinerals.length) {
        const undersaturatedMineral = nearbyMinerals[mineralIndex];
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: undersaturatedMineral.entityId,
        });
        undersaturatedMineral.currentWorkers++; // Track assignment for next worker
        continue;
      }

      // Priority 3: If all minerals are at optimal (2), assign to patches with 2 workers (allows 3rd worker)
      // PERF: Use index instead of find()
      while (oversatIndex < nearbyMinerals.length && nearbyMinerals[oversatIndex].currentWorkers >= 3) {
        oversatIndex++;
      }
      if (oversatIndex < nearbyMinerals.length) {
        const mineralWithRoom = nearbyMinerals[oversatIndex];
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: mineralWithRoom.entityId,
        });
        mineralWithRoom.currentWorkers++;
        continue;
      }

      // Fallback: assign to closest mineral (shouldn't normally reach here)
      if (closestMineral) {
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: closestMineral.entityId,
        });
      }
    }
  }
}

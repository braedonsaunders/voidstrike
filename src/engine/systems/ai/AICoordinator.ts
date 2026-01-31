/**
 * AICoordinator - Central orchestrator for AI subsystems
 *
 * Manages AI player state and coordinates between focused subsystems:
 * - AIEconomyManager: Worker management, resource gathering, repair
 * - AIBuildOrderExecutor: Build orders, macro rules, unit/building production
 * - AITacticsManager: Combat state, attack/defend/harass execution
 * - AIScoutingManager: Map exploration, intel gathering
 *
 * Integrates AI primitive systems for sophisticated decision-making:
 * - InfluenceMap: Spatial threat tracking for pathfinding and positioning
 * - PositionalAnalysis: Map terrain analysis for chokes, expansions
 * - ScoutingMemory: Enemy intel tracking with confidence decay
 * - WorkerDistribution: Optimal worker saturation across bases
 * - RetreatCoordination: Coordinated army retreat with rally points
 * - FormationControl: Army positioning and formation management
 *
 * This replaces the monolithic EnhancedAISystem with a modular architecture.
 */

import { System } from '../../ecs/System';
import { Entity } from '../../ecs/Entity';
import { Transform } from '../../components/Transform';
import { Unit } from '../../components/Unit';
import { Building } from '../../components/Building';
import { Health } from '../../components/Health';
import { Selectable } from '../../components/Selectable';
import { Resource } from '../../components/Resource';
import type { Game } from '../../core/Game';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { debugAI } from '@/utils/debugLogger';
import { SeededRandom } from '@/utils/math';
import {
  getRandomBuildOrder,
  type AIDifficulty,
  type BuildOrderStep,
} from '@/data/ai/buildOrders';
import {
  type FactionAIConfig,
  type AIStateSnapshot,
  type AIPersonality,
  getFactionAIConfig,
} from '@/data/ai/aiConfig';
import '@/data/ai/factions/dominion';

// Import subsystems
import { AIEconomyManager } from './AIEconomyManager';
import { AIBuildOrderExecutor } from './AIBuildOrderExecutor';
import { AITacticsManager } from './AITacticsManager';
import { AIScoutingManager } from './AIScoutingManager';

// Import AI primitives for sophisticated decision-making
import { InfluenceMap } from '../../ai/InfluenceMap';
import { PositionalAnalysis } from '../../ai/PositionalAnalysis';
import { ScoutingMemory } from '../../ai/ScoutingMemory';
import { WorkerDistribution } from '../../ai/WorkerDistribution';
import { RetreatCoordination } from '../../ai/RetreatCoordination';
import { FormationControl } from '../../ai/FormationControl';

export type AIState = 'building' | 'expanding' | 'attacking' | 'defending' | 'scouting' | 'harassing';
export type { AIDifficulty };

/**
 * Tracks relationship with a specific enemy player.
 * Used for RTS-style threat assessment and grudge system.
 */
export interface EnemyRelation {
  /** Last tick when this enemy attacked us */
  lastAttackedUsTick: number;
  /** Last tick when we attacked this enemy */
  lastWeAttackedTick: number;
  /** Cumulative damage this enemy dealt to us (decays over time) */
  damageDealtToUs: number;
  /** Cumulative damage we dealt to this enemy */
  damageWeDealt: number;
  /** Distance from our main base to their main base */
  baseDistance: number;
  /** Calculated threat score based on proximity, damage, military strength */
  threatScore: number;
  /** Known enemy base position */
  basePosition: { x: number; y: number } | null;
  /** Estimated enemy army supply near our territory */
  armyNearUs: number;
}

/**
 * Personality weight profiles for RTS-style AI differentiation.
 * Each personality prioritizes different factors when selecting enemies.
 */
export interface PersonalityWeights {
  /** How much to prioritize nearby enemies (0-1) */
  proximity: number;
  /** How much to prioritize enemies threatening us (0-1) */
  threat: number;
  /** How much to prioritize retaliation against attackers (0-1) */
  retaliation: number;
  /** How much to prioritize weak/exposed enemies (0-1) */
  opportunity: number;
  /** Multiplier for attack threshold (lower = more aggressive) */
  attackThresholdMult: number;
  /** Multiplier for expansion frequency (higher = more economic) */
  expandFrequency: number;
}

/** RTS-style personality weight configurations */
export const PERSONALITY_WEIGHTS: Record<AIPersonality, PersonalityWeights> = {
  aggressive: {
    proximity: 0.5,
    threat: 0.1,
    retaliation: 0.2,
    opportunity: 0.2,
    attackThresholdMult: 0.7,
    expandFrequency: 0.5,
  },
  defensive: {
    proximity: 0.2,
    threat: 0.5,
    retaliation: 0.2,
    opportunity: 0.1,
    attackThresholdMult: 1.3,
    expandFrequency: 1.2,
  },
  economic: {
    proximity: 0.3,
    threat: 0.3,
    retaliation: 0.1,
    opportunity: 0.3,
    attackThresholdMult: 1.5,
    expandFrequency: 1.5,
  },
  balanced: {
    proximity: 0.3,
    threat: 0.3,
    retaliation: 0.2,
    opportunity: 0.2,
    attackThresholdMult: 1.0,
    expandFrequency: 1.0,
  },
  cheese: {
    proximity: 0.6,
    threat: 0.1,
    retaliation: 0.1,
    opportunity: 0.2,
    attackThresholdMult: 0.5,
    expandFrequency: 0.3,
  },
  turtle: {
    proximity: 0.1,
    threat: 0.6,
    retaliation: 0.2,
    opportunity: 0.1,
    attackThresholdMult: 2.0,
    expandFrequency: 0.8,
  },
};

/** Half-life for grudge decay in ticks (~60 seconds at 20 ticks/second) */
const GRUDGE_HALF_LIFE_TICKS = 1200;

export interface AIPlayer {
  playerId: string;
  faction: string;
  difficulty: AIDifficulty;
  personality: AIPersonality;
  state: AIState;
  lastActionTick: number;
  lastScoutTick: number;
  lastHarassTick: number;
  lastExpansionTick: number;

  /** Per-AI seeded random for independent decision making */
  random: SeededRandom;

  /** RTS-style enemy relationship tracking */
  enemyRelations: Map<string, EnemyRelation>;
  /** Currently selected primary enemy to attack */
  primaryEnemyId: string | null;
  /** Personality-based weights for decision making */
  personalityWeights: PersonalityWeights;

  // Economy
  minerals: number;
  vespene: number;
  supply: number;
  maxSupply: number;
  workerCount: number;
  targetWorkerCount: number;

  // Worker tracking (for simulation-based economy)
  previousWorkerIds: Set<number>;
  lastWorkerDeathTick: number;
  recentWorkerDeaths: number;
  workerReplacementPriority: number;

  // Resource depletion tracking
  depletedPatchesNearBases: number;
  lastDepletionTick: number;

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
  buildOrderFailureCount: number;

  // Timing
  attackCooldown: number;
  lastAttackTick: number;
  harassCooldown: number;
  scoutCooldown: number;
  expansionCooldown: number;

  // Data-driven AI configuration
  config: FactionAIConfig | null;
  macroRuleCooldowns: Map<string, number>;

  // Research tracking
  completedResearch: Set<string>;
  researchInProgress: Map<string, number>; // researchId -> buildingId

  // AI Primitive instances (per-player)
  scoutingMemory: ScoutingMemory;
  workerDistribution: WorkerDistribution;
  retreatCoordinator: RetreatCoordination;
  formationControl: FormationControl;
}

// Entity query cache - cleared each update cycle
interface EntityQueryCache {
  units: Entity[] | null;
  unitsWithTransform: Entity[] | null;
  buildings: Entity[] | null;
  buildingsWithTransform: Entity[] | null;
  resources: Entity[] | null;
}

export class AICoordinator extends System {
  public readonly name = 'AICoordinator';
  // Note: AICoordinator is used internally by EnhancedAISystem, not registered directly

  private aiPlayers: Map<string, AIPlayer> = new Map();
  private ticksBetweenActions = 20;
  private defaultDifficulty: AIDifficulty;
  /** Base seed for per-AI random generation - each AI gets baseSeed + playerIndex */
  private baseSeed: number = 12345;
  /** Counter for assigning unique indices to AI players */
  private aiPlayerIndex: number = 0;

  // Entity query cache
  private entityCache: EntityQueryCache = {
    units: null,
    unitsWithTransform: null,
    buildings: null,
    buildingsWithTransform: null,
    resources: null,
  };

  // Subsystems
  private economyManager: AIEconomyManager;
  private buildOrderExecutor: AIBuildOrderExecutor;
  private tacticsManager: AITacticsManager;
  private scoutingManager: AIScoutingManager;

  // Shared AI primitives (across all AI players)
  private influenceMap: InfluenceMap;
  private positionalAnalysis: PositionalAnalysis;
  private positionalAnalysisInitialized: boolean = false;

  constructor(game: Game, difficulty: AIDifficulty = 'medium') {
    super(game);
    this.defaultDifficulty = difficulty;

    // Initialize subsystems
    this.economyManager = new AIEconomyManager(game, this);
    this.buildOrderExecutor = new AIBuildOrderExecutor(game, this);
    this.tacticsManager = new AITacticsManager(game, this);
    this.scoutingManager = new AIScoutingManager(game, this);

    // Initialize shared AI primitives
    this.influenceMap = new InfluenceMap(game.config.mapWidth, game.config.mapHeight, 4);
    this.positionalAnalysis = new PositionalAnalysis(
      game.config.mapWidth,
      game.config.mapHeight,
      4 // Cell size matching influence map
    );

    // Wire up subsystem dependencies
    this.buildOrderExecutor.setEconomyManager(this.economyManager);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('vision:enemySighted', (data: { playerId: string; position: { x: number; y: number } }) => {
      for (const ai of this.aiPlayers.values()) {
        if (ai.playerId !== data.playerId) continue;
        ai.lastEnemyContact = this.game.getCurrentTick();
      }
    });

    this.game.eventBus.on('alert:underAttack', (data: { playerId: string }) => {
      const ai = this.aiPlayers.get(data.playerId);
      if (ai) {
        ai.state = 'defending';
      }
    });

    this.game.eventBus.on('resource:depleted', (data: { resourceType: string; position: { x: number; y: number } }) => {
      const currentTick = this.game.getCurrentTick();
      for (const ai of this.aiPlayers.values()) {
        const basePositions = this.getAIBasePositions(ai);
        for (const basePos of basePositions) {
          const dx = data.position.x - basePos.x;
          const dy = data.position.y - basePos.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance <= 30) {
            ai.depletedPatchesNearBases++;
            ai.lastDepletionTick = currentTick;
            debugAI.log(`[AICoordinator] ${ai.playerId}: Resource depleted near base! Total depleted: ${ai.depletedPatchesNearBases}`);
            break;
          }
        }
      }
    });

    // Track research completion
    this.game.eventBus.on('research:complete', (event: { buildingId: number; upgradeId: string }) => {
      for (const ai of this.aiPlayers.values()) {
        if (ai.researchInProgress.has(event.upgradeId)) {
          ai.completedResearch.add(event.upgradeId);
          ai.researchInProgress.delete(event.upgradeId);
          debugAI.log(`[AICoordinator] ${ai.playerId}: Research complete: ${event.upgradeId}`);
        }
      }
    });
  }

  // === Cache Methods (exposed for subsystems) ===

  public clearEntityCache(): void {
    this.entityCache.units = null;
    this.entityCache.unitsWithTransform = null;
    this.entityCache.buildings = null;
    this.entityCache.buildingsWithTransform = null;
    this.entityCache.resources = null;
  }

  public getCachedUnits(): Entity[] {
    if (!this.entityCache.units) {
      this.entityCache.units = this.world.getEntitiesWith('Unit', 'Selectable', 'Health');
    }
    return this.entityCache.units;
  }

  public getCachedUnitsWithTransform(): Entity[] {
    if (!this.entityCache.unitsWithTransform) {
      this.entityCache.unitsWithTransform = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');
    }
    return this.entityCache.unitsWithTransform;
  }

  public getCachedBuildings(): Entity[] {
    if (!this.entityCache.buildings) {
      this.entityCache.buildings = this.world.getEntitiesWith('Building', 'Selectable', 'Health');
    }
    return this.entityCache.buildings;
  }

  public getCachedBuildingsWithTransform(): Entity[] {
    if (!this.entityCache.buildingsWithTransform) {
      this.entityCache.buildingsWithTransform = this.world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');
    }
    return this.entityCache.buildingsWithTransform;
  }

  public getCachedResources(): Entity[] {
    if (!this.entityCache.resources) {
      this.entityCache.resources = this.world.getEntitiesWith('Resource', 'Transform');
    }
    return this.entityCache.resources;
  }

  // === Shared AI Primitives Accessors ===

  /** Get the shared influence map for spatial threat analysis */
  public getInfluenceMap(): InfluenceMap {
    return this.influenceMap;
  }

  /** Get the shared positional analysis for map terrain data */
  public getPositionalAnalysis(): PositionalAnalysis {
    return this.positionalAnalysis;
  }

  /**
   * Update shared AI primitives with current game state.
   * Called once per update cycle, before individual AI updates.
   */
  private updateSharedPrimitives(): void {
    // Initialize positional analysis on first update (needs passability data)
    if (!this.positionalAnalysisInitialized) {
      this.initializePositionalAnalysis();
      this.positionalAnalysisInitialized = true;
    }

    // Update influence map with current unit positions
    this.updateInfluenceMap();
  }

  /**
   * Initialize positional analysis with map terrain data.
   * Analyzes the map for choke points, expansion locations, etc.
   */
  private initializePositionalAnalysis(): void {
    // Analyze map terrain using the World for building/obstacle detection
    this.positionalAnalysis.analyzeMap(this.world);

    const chokePoints = this.positionalAnalysis.getChokePoints();
    const expansionLocations = this.positionalAnalysis.getExpansionLocations();

    debugAI.log(`[AICoordinator] Positional analysis initialized: ${chokePoints.length} choke points, ${expansionLocations.length} expansion locations`);
  }

  /**
   * Update influence map with current unit and building positions.
   */
  private updateInfluenceMap(): void {
    const currentTick = this.game.getCurrentTick();
    // InfluenceMap.update handles all influence tracking internally
    this.influenceMap.update(this.world, currentTick);
  }

  // === Public API ===

  public registerAI(
    playerId: string,
    faction: string,
    difficulty: AIDifficulty = 'medium',
    personality: AIPersonality = 'balanced'
  ): void {
    // Idempotency check: prevent duplicate registrations that would reset AI state
    if (this.aiPlayers.has(playerId)) {
      debugAI.log(`[AICoordinator] AI ${playerId} already registered, skipping duplicate registration`);
      return;
    }

    // Assign unique index for per-AI seeding
    const aiIndex = this.aiPlayerIndex++;

    // Create per-AI random with unique seed based on playerId and index
    // This ensures each AI makes independent decisions
    const playerIdHash = this.hashString(playerId);
    const aiSeed = this.baseSeed + playerIdHash + aiIndex * 7919; // Use prime multiplier
    const aiRandom = new SeededRandom(aiSeed);

    // Select personality - if balanced is passed, randomly assign one for variety
    let actualPersonality = personality;
    if (personality === 'balanced' && aiIndex > 0) {
      // Give subsequent AIs varied personalities for more interesting games
      const personalities: AIPersonality[] = ['aggressive', 'defensive', 'economic', 'balanced', 'turtle'];
      actualPersonality = personalities[aiIndex % personalities.length];
    }

    debugAI.log(`[AICoordinator] Registering AI: ${playerId}, faction: ${faction}, difficulty: ${difficulty}, personality: ${actualPersonality}, seed: ${aiSeed}`);

    const factionConfig = getFactionAIConfig(faction);
    if (!factionConfig) {
      throw new Error(`No AI configuration found for faction: ${faction}. Define a FactionAIConfig in src/data/ai/factions/${faction}.ts`);
    }

    const difficultySettings = factionConfig.difficultyConfig[difficulty];

    // Initialize per-player AI primitives
    const scoutingMemory = new ScoutingMemory(playerId);

    const workerDistribution = new WorkerDistribution({
      workersPerMineral: 2,
      workersPerGas: 3,
      baseRadius: 12,
      oversaturationThreshold: 1.3,
      undersaturationThreshold: 0.7,
    });

    const retreatCoordinator = new RetreatCoordination({
      healthThreshold: 0.3,
      strengthRetreatRatio: 0.6,
      reengageRatio: 0.9,
      minRetreatTicks: 60,
      rallyDistance: 15,
    });

    const formationControl = new FormationControl({
      unitSpacing: 1.5,
      maxConcaveAngle: Math.PI * 0.6,
      rangedOffset: 3,
      splashSpread: 2.5,
    });

    this.aiPlayers.set(playerId, {
      playerId,
      faction,
      difficulty,
      personality: actualPersonality,
      state: 'building',
      lastActionTick: 0,
      lastScoutTick: 0,
      lastHarassTick: 0,
      lastExpansionTick: 0,

      // Per-AI random for independent decisions
      random: aiRandom,

      // RTS-style enemy tracking
      enemyRelations: new Map(),
      primaryEnemyId: null,
      personalityWeights: PERSONALITY_WEIGHTS[actualPersonality],

      minerals: 50,
      vespene: 0,
      supply: 6,
      maxSupply: factionConfig.economy.supplyPerMainBase,
      workerCount: 6,
      targetWorkerCount: difficultySettings.targetWorkers,

      previousWorkerIds: new Set(),
      lastWorkerDeathTick: 0,
      recentWorkerDeaths: 0,
      workerReplacementPriority: 0,

      depletedPatchesNearBases: 0,
      lastDepletionTick: 0,

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

      buildOrder: this.loadBuildOrder(faction, difficulty, aiRandom),
      buildOrderIndex: 0,
      buildOrderFailureCount: 0,

      attackCooldown: difficultySettings.attackCooldown,
      lastAttackTick: 0,
      harassCooldown: difficultySettings.harassCooldown,
      scoutCooldown: difficultySettings.scoutCooldown,
      expansionCooldown: difficultySettings.expansionCooldown,

      config: factionConfig,
      macroRuleCooldowns: new Map(),

      completedResearch: new Set(),
      researchInProgress: new Map(),

      // AI Primitive instances
      scoutingMemory,
      workerDistribution,
      retreatCoordinator,
      formationControl,
    });
  }

  /** Simple string hash for generating unique seeds */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  public isAIPlayer(playerId: string): boolean {
    return this.aiPlayers.has(playerId);
  }

  public getAIPlayer(playerId: string): AIPlayer | undefined {
    return this.aiPlayers.get(playerId);
  }

  public getAllAIPlayers(): AIPlayer[] {
    return Array.from(this.aiPlayers.values());
  }

  public getMiningSpeedMultiplier(playerId: string): number {
    const ai = this.aiPlayers.get(playerId);
    if (!ai || !ai.config) return 1.0;
    return ai.config.difficultyConfig[ai.difficulty].miningSpeedMultiplier;
  }

  public creditResources(playerId: string, minerals: number, vespene: number): void {
    const ai = this.aiPlayers.get(playerId);
    if (!ai) {
      // Debug: this would mean resources are being credited to an unregistered player
      if (this.game.getCurrentTick() % 100 === 0) {
        debugAI.warn(`[AICoordinator] creditResources called for unregistered player: ${playerId}. Registered players: ${Array.from(this.aiPlayers.keys()).join(', ')}`);
      }
      return;
    }

    ai.minerals += minerals;
    ai.vespene += vespene;

    // Log periodically
    if (this.game.getCurrentTick() % 100 === 0) {
      debugAI.log(`[AICoordinator] ${playerId} received: +${minerals} minerals, +${vespene} gas (total: ${Math.floor(ai.minerals)}M, ${Math.floor(ai.vespene)}G)`);
    }
  }

  /**
   * Get the per-AI random instance for the given player.
   * Each AI has its own SeededRandom to ensure independent decision making.
   */
  public getRandom(playerId: string): SeededRandom {
    const ai = this.aiPlayers.get(playerId);
    if (!ai) {
      // Fallback - should not happen in normal operation
      debugAI.warn(`[AICoordinator] getRandom called for unregistered player: ${playerId}`);
      return new SeededRandom(this.baseSeed);
    }
    return ai.random;
  }

  // === State Snapshot for Rule Evaluation ===

  public createStateSnapshot(ai: AIPlayer, currentTick: number): AIStateSnapshot {
    const config = ai.config!;
    const baseCount = this.countPlayerBases(ai);

    let productionBuildingsCount = 0;
    for (const prodConfig of config.production.buildings) {
      productionBuildingsCount += ai.buildingCounts.get(prodConfig.buildingId) || 0;
    }

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
      workerReplacementPriority: ai.workerReplacementPriority,
      armySupply: ai.armySupply,
      armyValue: ai.armyValue,
      unitCounts: ai.armyComposition,

      depletedPatchesNearBases: ai.depletedPatchesNearBases,

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

  // === Helper Methods (exposed for subsystems) ===

  public getAIBasePositions(ai: AIPlayer): Array<{ x: number; y: number }> {
    const config = ai.config;
    if (!config) return [];

    const baseTypes = config.roles.baseTypes;
    const positions: Array<{ x: number; y: number }> = [];
    const buildings = this.getCachedBuildingsWithTransform();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');
      const transform = entity.get<Transform>('Transform');

      if (!selectable || !building || !transform) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (baseTypes.includes(building.buildingId)) {
        positions.push({ x: transform.x, y: transform.y });
      }
    }

    return positions;
  }

  public countPlayerBases(ai: AIPlayer): number {
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

  public findAIBase(ai: AIPlayer): { x: number; y: number } | null {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (baseTypes.includes(building.buildingId)) {
        return { x: transform.x, y: transform.y };
      }
    }
    return null;
  }

  private loadBuildOrder(faction: string, difficulty: AIDifficulty, aiRandom?: SeededRandom): BuildOrderStep[] {
    // Use provided random or create a temporary one for build order selection
    const randomToUse = aiRandom ?? new SeededRandom(this.baseSeed + this.aiPlayerIndex);
    const buildOrder = getRandomBuildOrder(faction, difficulty, randomToUse);
    if (!buildOrder) {
      throw new Error(`[AICoordinator] No build order configured for faction ${faction} (${difficulty}).`);
    }
    debugAI.log(`[AICoordinator] Loaded build order: ${buildOrder.name} for ${faction} (${difficulty})`);
    return [...buildOrder.steps];
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

  // === Game State Update ===

  private updateGameState(ai: AIPlayer): void {
    const currentTick = this.game.getCurrentTick();

    let workerCount = 0;
    let armySupply = 0;
    const armyComposition = new Map<string, number>();
    const buildingCounts = new Map<string, number>();
    const currentWorkerIds = new Set<number>();

    const units = this.getCachedUnits();
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable');
      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');

      if (!selectable || !unit || !health) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      if (unit.isWorker) {
        workerCount++;
        currentWorkerIds.add(entity.id);
      } else {
        const def = UNIT_DEFINITIONS[unit.unitId];
        if (def) {
          armySupply += def.supplyCost;
          armyComposition.set(unit.unitId, (armyComposition.get(unit.unitId) || 0) + 1);
        }
      }
    }

    // Detect worker deaths
    let newDeaths = 0;
    for (const previousId of ai.previousWorkerIds) {
      if (!currentWorkerIds.has(previousId)) {
        newDeaths++;
        ai.lastWorkerDeathTick = currentTick;
      }
    }

    const decayRate = 0.02;
    ai.recentWorkerDeaths = Math.max(0, ai.recentWorkerDeaths * (1 - decayRate) + newDeaths);

    const workerDeficit = Math.max(0, ai.targetWorkerCount - workerCount);
    const deficitRatio = workerCount > 0 ? workerDeficit / ai.targetWorkerCount : 1;
    const recentDeathsPressure = Math.min(1, ai.recentWorkerDeaths / 5);
    const isUnderHarassment = currentTick - ai.lastWorkerDeathTick < 100;

    ai.workerReplacementPriority = Math.min(1, deficitRatio * 0.5 + recentDeathsPressure * 0.3 + (isUnderHarassment ? 0.2 : 0));
    ai.previousWorkerIds = currentWorkerIds;

    if (newDeaths > 0) {
      debugAI.log(`[AICoordinator] ${ai.playerId}: ${newDeaths} worker(s) died! Recent deaths: ${ai.recentWorkerDeaths.toFixed(1)}, priority: ${ai.workerReplacementPriority.toFixed(2)}`);
    }

    const buildings = this.getCachedBuildings();
    const buildingsInProgress = new Map<string, number>();
    let queuedSupply = 0;

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');
      const health = entity.get<Health>('Health');

      if (!selectable || !building || !health) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      buildingCounts.set(building.buildingId, (buildingCounts.get(building.buildingId) || 0) + 1);

      // Track buildings under construction (not complete)
      if (!building.isComplete()) {
        buildingsInProgress.set(building.buildingId, (buildingsInProgress.get(building.buildingId) || 0) + 1);
      }

      // Calculate supply cost of units in production queues
      // This prevents infinite queuing by accounting for units that haven't spawned yet
      for (const item of building.productionQueue) {
        if (item.type === 'unit' && item.supplyCost > 0) {
          queuedSupply += item.supplyCost * item.produceCount;
        }
      }
    }

    ai.workerCount = workerCount;
    ai.armySupply = armySupply;
    ai.armyValue = armySupply * 10;
    ai.armyComposition = armyComposition;
    ai.buildingCounts = buildingCounts;
    ai.buildingsInProgress = buildingsInProgress;
    // Include queued supply to prevent infinite unit queuing
    ai.supply = workerCount + armySupply + queuedSupply;
  }

  private updateMaxSupply(ai: AIPlayer): void {
    const config = ai.config!;
    const economyConfig = config.economy;

    const supplyPerBase = economyConfig.supplyPerMainBase;
    const supplyPerSupplyBuilding = economyConfig.supplyPerSupplyBuilding;

    // Only count COMPLETED buildings for supply calculation
    // Incomplete buildings shouldn't provide supply yet
    const buildings = this.getCachedBuildings();
    let baseSupply = 0;
    let supplyBuildingCount = 0;

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');
      const health = entity.get<Health>('Health');

      if (!selectable || !building || !health) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;
      if (!building.isComplete()) continue; // Only count completed buildings

      if (config.roles.baseTypes.includes(building.buildingId)) {
        baseSupply += supplyPerBase;
      } else if (building.buildingId === config.roles.supplyBuilding) {
        supplyBuildingCount++;
      }
    }

    ai.maxSupply = baseSupply + supplyBuildingCount * supplyPerSupplyBuilding;
  }

  // === Main Update Loop ===

  public update(_deltaTime: number): void {
    const currentTick = this.game.getCurrentTick();

    this.clearEntityCache();
    // Per-AI random is now used instead of shared random - no global reseed needed

    if (currentTick === 1) {
      debugAI.log(`[AICoordinator] Tick 1: Registered AI players: ${Array.from(this.aiPlayers.keys()).join(', ') || '(none)'}`);
    }

    // Update shared AI primitives once per cycle
    if (this.aiPlayers.size > 0) {
      this.updateSharedPrimitives();
    }

    for (const [playerId, ai] of this.aiPlayers) {
      const actionDelay = this.getActionDelay(ai.difficulty);
      if (currentTick - ai.lastActionTick < actionDelay) continue;

      ai.lastActionTick = currentTick;

      this.updateGameState(ai);

      const totalBuildings = Array.from(ai.buildingCounts.values()).reduce((a, b) => a + b, 0);
      if (totalBuildings === 0) {
        if (currentTick % 100 === 0) {
          debugAI.warn(`[AICoordinator] ${playerId} has NO buildings detected! AI logic SKIPPED. buildingCounts:`, Object.fromEntries(ai.buildingCounts));
        }
        continue;
      }

      // Periodic status log
      if (currentTick % 200 === 0) {
        debugAI.log(`[AICoordinator] ${playerId}: workers=${ai.workerCount}, buildings=${totalBuildings}, minerals=${Math.floor(ai.minerals)}, vespene=${Math.floor(ai.vespene)}, supply=${ai.supply}/${ai.maxSupply}, buildOrderStep=${ai.buildOrderIndex}/${ai.buildOrder.length}, state=${ai.state}`);
      }

      this.updateMaxSupply(ai);

      // Warn if AI is supply blocked with resources available
      if (ai.supply >= ai.maxSupply && ai.minerals >= 50) {
        if (currentTick % 100 === 0) {
          debugAI.warn(`[AICoordinator] ${playerId} is SUPPLY BLOCKED: supply=${ai.supply}/${ai.maxSupply}, minerals=${Math.floor(ai.minerals)}`);
        }
      }

      // Economic layer runs EVERY tick
      this.runEconomicLayer(ai, currentTick);

      // RTS-style enemy relations update (determines which enemy to target)
      this.tacticsManager.updateEnemyRelations(ai, currentTick);

      // Tactical state determination
      this.tacticsManager.updateTacticalState(ai, currentTick);

      // Execute tactical behavior
      this.executeTacticalBehavior(ai, currentTick);
    }
  }

  private runEconomicLayer(ai: AIPlayer, currentTick: number): void {
    // Resume incomplete buildings
    this.economyManager.tryResumeIncompleteBuildings(ai);

    // Repair damaged buildings and units
    this.economyManager.assignWorkersToRepair(ai);

    // Send idle workers to gather
    this.economyManager.assignIdleWorkersToGather(ai);

    // Follow build order if still in progress
    if (ai.buildOrderIndex < ai.buildOrder.length) {
      this.buildOrderExecutor.executeBuildOrder(ai);
      // IMPORTANT: Don't return early! Continue to macro rules below.
      // This allows the AI to keep producing while waiting for build order steps.
    }

    // Always run macro rules - they complement the build order
    // Build order handles early sequencing, macro rules handle continuous production
    this.buildOrderExecutor.doMacro(ai);
  }

  private executeTacticalBehavior(ai: AIPlayer, currentTick: number): void {
    switch (ai.state) {
      case 'building':
        this.tacticsManager.rallyNewUnitsToArmy(ai);
        break;
      case 'expanding':
        this.tacticsManager.executeExpandingPhase(ai);
        break;
      case 'attacking':
        this.tacticsManager.executeAttackingPhase(ai, currentTick);
        break;
      case 'defending':
        this.tacticsManager.executeDefendingPhase(ai, currentTick);
        break;
      case 'scouting':
        this.scoutingManager.executeScoutingPhase(ai, currentTick);
        break;
      case 'harassing':
        this.tacticsManager.executeHarassingPhase(ai, currentTick);
        break;
    }
  }
}

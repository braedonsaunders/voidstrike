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
import type { IGameInstance } from '../../core/IGameInstance';
import type { GameCommand } from '../../core/GameCommand';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { debugAI } from '@/utils/debugLogger';
import { deterministicMagnitude } from '@/utils/FixedPoint';
import { SeededRandom } from '@/utils/math';
import { getRandomBuildOrder, type AIDifficulty, type BuildOrderStep } from '@/data/ai/buildOrders';
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

export type AIState =
  | 'building'
  | 'expanding'
  | 'attacking'
  | 'defending'
  | 'scouting'
  | 'harassing';
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
  /** Number of operational buildings this enemy has */
  buildingCount: number;
  /** Whether this enemy still has at least one headquarters building */
  hasHeadquarters: boolean;
}

/**
 * Persistent attack operation. Once launched, continues until completed
 * or interrupted by serious threat. Prevents state oscillation.
 */
export interface AttackOperation {
  /** Target position */
  target: { x: number; y: number };
  /** Target enemy player ID */
  targetPlayerId: string;
  /** Tick when attack was launched */
  startTick: number;
  /** Whether army has engaged the target */
  engaged: boolean;
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
const _GRUDGE_HALF_LIFE_TICKS = 1200;

export interface AIPlayer {
  playerId: string;
  faction: string;
  /** Team ID for alliance checks (0 = FFA, 1-4 = team alliance) */
  teamId: number;
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
  /** Enemy the AI has committed to attacking (persists through state transitions) */
  committedEnemyId: string | null;
  /** Tick when the current commitment began */
  commitmentStartTick: number;
  /** Active attack operation - persists until completed or interrupted */
  activeAttackOperation: AttackOperation | null;
  /** Personality-based weights for decision making */
  personalityWeights: PersonalityWeights;

  // Economy
  minerals: number;
  plasma: number;
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

  // Production diversity tracking
  /** Resources reserved for high-priority composition goal units */
  resourceReservation: { minerals: number; plasma: number };
  /** Count of consecutive trains of the same unit type */
  consecutiveTrainCount: number;
  /** Last unit type trained (for consecutive tracking) */
  lastTrainedUnitType: string | null;
  /** Tick when save mode was last active (prevents indefinite saving) */
  lastSaveModeTick: number;

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

  /** Reactive defense tick tracking per player */
  private lastReactiveDefenseTick: Map<string, number> = new Map();

  // Subsystems
  private economyManager: AIEconomyManager;
  private buildOrderExecutor: AIBuildOrderExecutor;
  private tacticsManager: AITacticsManager;
  private scoutingManager: AIScoutingManager;

  // Shared AI primitives (across all AI players)
  private influenceMap: InfluenceMap;
  private positionalAnalysis: PositionalAnalysis;
  private positionalAnalysisInitialized: boolean = false;

  constructor(game: IGameInstance, difficulty: AIDifficulty = 'medium') {
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
    this.game.eventBus.on(
      'vision:enemySighted',
      (data: { playerId: string; position: { x: number; y: number } }) => {
        for (const ai of this.aiPlayers.values()) {
          if (ai.playerId !== data.playerId) continue;
          ai.lastEnemyContact = this.game.getCurrentTick();
        }
      }
    );

    this.game.eventBus.on(
      'alert:underAttack',
      (data: { playerId: string; position?: { x: number; y: number } }) => {
        const ai = this.aiPlayers.get(data.playerId);
        if (ai) {
          ai.lastEnemyContact = this.game.getCurrentTick();

          // Reactive defense: immediately command nearby army units to respond
          // This bypasses the actionDelayTicks gate for instant response
          this.triggerReactiveDefense(ai, data.position);
        }
      }
    );

    this.game.eventBus.on(
      'resource:depleted',
      (data: { resourceType: string; position: { x: number; y: number } }) => {
        const currentTick = this.game.getCurrentTick();
        for (const ai of this.aiPlayers.values()) {
          const basePositions = this.getAIBasePositions(ai);
          for (const basePos of basePositions) {
            const dx = data.position.x - basePos.x;
            const dy = data.position.y - basePos.y;
            const distance = deterministicMagnitude(dx, dy);
            if (distance <= 30) {
              ai.depletedPatchesNearBases++;
              ai.lastDepletionTick = currentTick;
              debugAI.log(
                `[AICoordinator] ${ai.playerId}: Resource depleted near base! Total depleted: ${ai.depletedPatchesNearBases}`
              );
              break;
            }
          }
        }
      }
    );

    // Track research completion
    this.game.eventBus.on(
      'research:complete',
      (event: { buildingId: number; upgradeId: string }) => {
        for (const ai of this.aiPlayers.values()) {
          if (ai.researchInProgress.has(event.upgradeId)) {
            ai.completedResearch.add(event.upgradeId);
            ai.researchInProgress.delete(event.upgradeId);
            debugAI.log(`[AICoordinator] ${ai.playerId}: Research complete: ${event.upgradeId}`);
          }
        }
      }
    );
  }

  /**
   * Event-driven reactive defense. Called immediately when AI buildings/units
   * take damage near base. Bypasses the actionDelayTicks gate.
   *
   * SC2-style: damage event -> immediate defense command.
   */
  private triggerReactiveDefense(ai: AIPlayer, attackPosition?: { x: number; y: number }): void {
    const currentTick = this.game.getCurrentTick();

    // Throttle to once per 10 ticks to prevent command spam
    const lastTick = this.lastReactiveDefenseTick.get(ai.playerId) ?? 0;
    if (currentTick - lastTick < 10) return;
    this.lastReactiveDefenseTick.set(ai.playerId, currentTick);

    const basePos = this.findAIBase(ai);
    if (!basePos) return;

    // Find the threat position - use provided position or search for nearest enemy
    const threatPos = attackPosition || this.tacticsManager.findNearestThreatPublic(ai, basePos);
    if (!threatPos) return;

    // Command army units near base to respond. During active attacks, units near
    // base are idle reinforcements — they should still defend rather than watch
    // the base get destroyed. getArmyUnitsNearBase already filters to units within
    // the base radius that aren't engaged in combat.
    const armyUnits = this.tacticsManager.getArmyUnitsNearBase(ai.playerId, basePos, 60);
    if (armyUnits.length === 0) return;

    const command: GameCommand = {
      tick: currentTick,
      playerId: ai.playerId,
      type: 'ATTACK_MOVE' as const,
      entityIds: armyUnits,
      targetPosition: threatPos,
    };
    this.game.issueAICommand(command);

    // Only switch to defending state if not in an active attack — units on offense
    // continue their operation while home units defend independently.
    if (!ai.activeAttackOperation) {
      ai.state = 'defending';
    }

    debugAI.log(
      `[AICoordinator] ${ai.playerId}: REACTIVE DEFENSE - ${armyUnits.length} units responding to threat at (${threatPos.x.toFixed(0)}, ${threatPos.y.toFixed(0)})`
    );
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
      this.entityCache.unitsWithTransform = this.world.getEntitiesWith(
        'Unit',
        'Transform',
        'Selectable',
        'Health'
      );
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
      this.entityCache.buildingsWithTransform = this.world.getEntitiesWith(
        'Building',
        'Transform',
        'Selectable',
        'Health'
      );
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

  /** Get the world instance for subsystems that need entity access */
  public getWorld() {
    return this.world;
  }

  // Building revelation: throttle and tracking
  private lastRevelationCheckTick = 0;
  private static readonly REVELATION_CHECK_INTERVAL = 200; // Every ~10 seconds
  private static readonly REVELATION_DURATION = 12; // Reveal lasts 12 seconds (refresh every 10)
  private static readonly REVELATION_RADIUS = 5; // Reveal radius around each building

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

    // SC2-style building revelation: when a player loses all HQ buildings,
    // reveal their remaining buildings to all other players
    this.checkBuildingRevelation();
  }

  /**
   * SC2-style building revelation: when a player has no headquarters buildings,
   * reveal all their remaining buildings on the map to every other player.
   * This prevents endless games where scattered buildings can't be found.
   */
  private checkBuildingRevelation(): void {
    const currentTick = this.game.getCurrentTick();
    if (currentTick - this.lastRevelationCheckTick < AICoordinator.REVELATION_CHECK_INTERVAL) {
      return;
    }
    this.lastRevelationCheckTick = currentTick;

    // Gather all faction configs to know what HQ building types exist
    // Use the first AI player's config as reference (all factions share base type detection)
    const firstAI = this.aiPlayers.values().next().value;
    if (!firstAI?.config) return;
    const baseTypes = firstAI.config.roles.baseTypes;

    // Scan all buildings: track per-player HQ status and building positions
    const playerHasHQ = new Map<string, boolean>();
    const playerBuildingPositions = new Map<string, Array<{ x: number; y: number }>>();
    const buildings = this.getCachedBuildingsWithTransform();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');
      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');

      if (!selectable || !building || !transform || !health) continue;
      if (health.isDead()) continue;
      if (!building.isOperational()) continue;

      const ownerId = selectable.playerId;

      // Track building positions
      if (!playerBuildingPositions.has(ownerId)) {
        playerBuildingPositions.set(ownerId, []);
      }
      playerBuildingPositions.get(ownerId)!.push({ x: transform.x, y: transform.y });

      // Track HQ status
      if (baseTypes.includes(building.buildingId)) {
        playerHasHQ.set(ownerId, true);
      }
    }

    // For each player with buildings but no HQ, reveal their buildings to all other players
    for (const [playerId, buildingPositions] of playerBuildingPositions) {
      if (playerHasHQ.get(playerId)) continue; // Still has HQ — no reveal
      if (buildingPositions.length === 0) continue;

      debugAI.log(
        `[AICoordinator] Player ${playerId} has no HQ - revealing ${buildingPositions.length} buildings`
      );

      // Emit vision reveals for all other players that have buildings (i.e., alive players)
      for (const [otherPlayerId] of playerBuildingPositions) {
        if (otherPlayerId === playerId) continue;

        for (const pos of buildingPositions) {
          this.game.eventBus.emit('vision:reveal', {
            playerId: otherPlayerId,
            position: pos,
            radius: AICoordinator.REVELATION_RADIUS,
            duration: AICoordinator.REVELATION_DURATION,
          });
        }
      }
    }
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

    debugAI.log(
      `[AICoordinator] Positional analysis initialized: ${chokePoints.length} choke points, ${expansionLocations.length} expansion locations`
    );
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
    personality: AIPersonality = 'balanced',
    teamId: number = 0
  ): void {
    // Idempotency check: prevent duplicate registrations that would reset AI state
    if (this.aiPlayers.has(playerId)) {
      debugAI.log(
        `[AICoordinator] AI ${playerId} already registered, skipping duplicate registration`
      );
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
      const personalities: AIPersonality[] = [
        'aggressive',
        'defensive',
        'economic',
        'balanced',
        'turtle',
      ];
      actualPersonality = personalities[aiIndex % personalities.length];
    }

    debugAI.log(
      `[AICoordinator] Registering AI: ${playerId}, faction: ${faction}, difficulty: ${difficulty}, personality: ${actualPersonality}, seed: ${aiSeed}`
    );

    const factionConfig = getFactionAIConfig(faction);
    if (!factionConfig) {
      throw new Error(
        `No AI configuration found for faction: ${faction}. Define a FactionAIConfig in src/data/ai/factions/${faction}.ts`
      );
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

    // Register team for InfluenceMap alliance awareness
    this.influenceMap.setPlayerTeams(new Map([...this.getPlayerTeamsMap(), [playerId, teamId]]));

    this.aiPlayers.set(playerId, {
      playerId,
      faction,
      teamId,
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
      committedEnemyId: null,
      commitmentStartTick: 0,
      activeAttackOperation: null,
      personalityWeights: PERSONALITY_WEIGHTS[actualPersonality],

      minerals: 50,
      plasma: 0,
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

      // Production diversity tracking
      resourceReservation: { minerals: 0, plasma: 0 },
      consecutiveTrainCount: 0,
      lastTrainedUnitType: null,
      lastSaveModeTick: 0,

      // AI Primitive instances
      scoutingMemory,
      workerDistribution,
      retreatCoordinator,
      formationControl,
    });
  }

  /** Get player-to-team mapping for InfluenceMap alliance awareness */
  private getPlayerTeamsMap(): Map<string, number> {
    const teams = new Map<string, number>();
    for (const [id, ai] of this.aiPlayers) {
      teams.set(id, ai.teamId);
    }
    return teams;
  }

  /** Simple string hash for generating unique seeds */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
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

  public creditResources(playerId: string, minerals: number, plasma: number): void {
    const ai = this.aiPlayers.get(playerId);
    if (!ai) {
      // Debug: this would mean resources are being credited to an unregistered player
      if (this.game.getCurrentTick() % 100 === 0) {
        debugAI.warn(
          `[AICoordinator] creditResources called for unregistered player: ${playerId}. Registered players: ${Array.from(this.aiPlayers.keys()).join(', ')}`
        );
      }
      return;
    }

    ai.minerals += minerals;
    ai.plasma += plasma;

    // Log periodically
    if (this.game.getCurrentTick() % 100 === 0) {
      debugAI.log(
        `[AICoordinator] ${playerId} received: +${minerals} minerals, +${plasma} gas (total: ${Math.floor(ai.minerals)}M, ${Math.floor(ai.plasma)}G)`
      );
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

    // Scouting intel from ScoutingMemory
    let enemyStrategy: string = 'unknown';
    let enemyTechLevel = 1;
    let enemyHasAirTech = false;

    if (ai.primaryEnemyId) {
      const intel = ai.scoutingMemory.getIntel(ai.primaryEnemyId);
      if (intel) {
        enemyStrategy = intel.strategy.strategy;
        enemyTechLevel = intel.tech.techLevel;
        enemyHasAirTech = intel.tech.techBuildings.some(
          (b) => b.includes('hangar') || b.includes('starport')
        );
      }
    }

    return {
      playerId: ai.playerId,
      difficulty: ai.difficulty,
      personality: ai.personality,
      currentTick,

      minerals: ai.minerals,
      plasma: ai.plasma,
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

      enemyStrategy,
      enemyTechLevel,
      enemyHasAirTech,

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

  private loadBuildOrder(
    faction: string,
    difficulty: AIDifficulty,
    aiRandom?: SeededRandom
  ): BuildOrderStep[] {
    // Use provided random or create a temporary one for build order selection
    const randomToUse = aiRandom ?? new SeededRandom(this.baseSeed + this.aiPlayerIndex);
    const buildOrder = getRandomBuildOrder(faction, difficulty, randomToUse);
    if (!buildOrder) {
      throw new Error(
        `[AICoordinator] No build order configured for faction ${faction} (${difficulty}).`
      );
    }
    debugAI.log(
      `[AICoordinator] Loaded build order: ${buildOrder.name} for ${faction} (${difficulty})`
    );
    return [...buildOrder.steps];
  }

  private getActionDelay(difficulty: AIDifficulty): number {
    const baseDelay = this.ticksBetweenActions;
    switch (difficulty) {
      case 'easy':
        return baseDelay * 3;
      case 'medium':
        return baseDelay * 2;
      case 'hard':
        return baseDelay;
      case 'very_hard':
        return Math.floor(baseDelay * 0.7);
      case 'insane':
        return Math.floor(baseDelay * 0.5);
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

    ai.workerReplacementPriority = Math.min(
      1,
      deficitRatio * 0.5 + recentDeathsPressure * 0.3 + (isUnderHarassment ? 0.2 : 0)
    );
    ai.previousWorkerIds = currentWorkerIds;

    if (newDeaths > 0) {
      debugAI.log(
        `[AICoordinator] ${ai.playerId}: ${newDeaths} worker(s) died! Recent deaths: ${ai.recentWorkerDeaths.toFixed(1)}, priority: ${ai.workerReplacementPriority.toFixed(2)}`
      );
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
        buildingsInProgress.set(
          building.buildingId,
          (buildingsInProgress.get(building.buildingId) || 0) + 1
        );
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
      debugAI.log(
        `[AICoordinator] Tick 1: Registered AI players: ${Array.from(this.aiPlayers.keys()).join(', ') || '(none)'}`
      );
    }

    // Update shared AI primitives once per cycle
    if (this.aiPlayers.size > 0) {
      this.updateSharedPrimitives();
    }

    // Fast defense check - runs every 10 ticks regardless of actionDelayTicks
    // This ensures defense response isn't gated by the 40-tick medium delay
    if (currentTick % 10 === 0) {
      for (const [, ai] of this.aiPlayers) {
        if (this.tacticsManager.isUnderAttack(ai)) {
          if (ai.state === 'attacking' && ai.activeAttackOperation) {
            // During active attacks, trigger reactive defense for home units
            // without interrupting the attack operation
            this.triggerReactiveDefense(ai);
          } else if (ai.state !== 'defending') {
            ai.state = 'defending';
            this.tacticsManager.executeDefendingPhase(ai, currentTick);
          }
        }
      }
    }

    for (const [playerId, ai] of this.aiPlayers) {
      const actionDelay = this.getActionDelay(ai.difficulty);
      if (currentTick - ai.lastActionTick < actionDelay) continue;

      ai.lastActionTick = currentTick;

      this.updateGameState(ai);
      this.scoutingManager.updateEnemyIntel(ai);

      const totalBuildings = Array.from(ai.buildingCounts.values()).reduce((a, b) => a + b, 0);

      if (totalBuildings === 0) {
        // No buildings (e.g. battle simulator) - skip economy but still run combat tactics
        // This ensures units get re-commanded during battles even without a base
        if (ai.state !== 'attacking') {
          ai.state = 'attacking';
        }
        this.tacticsManager.updateEnemyRelations(ai, currentTick);
        this.executeTacticalBehavior(ai, currentTick);
        continue;
      }

      // Periodic status log
      if (currentTick % 200 === 0) {
        debugAI.log(
          `[AICoordinator] ${playerId}: workers=${ai.workerCount}, buildings=${totalBuildings}, minerals=${Math.floor(ai.minerals)}, plasma=${Math.floor(ai.plasma)}, supply=${ai.supply}/${ai.maxSupply}, buildOrderStep=${ai.buildOrderIndex}/${ai.buildOrder.length}, state=${ai.state}`
        );
      }

      this.updateMaxSupply(ai);

      // Warn if AI is supply blocked with resources available
      if (ai.supply >= ai.maxSupply && ai.minerals >= 50) {
        if (currentTick % 100 === 0) {
          debugAI.warn(
            `[AICoordinator] ${playerId} is SUPPLY BLOCKED: supply=${ai.supply}/${ai.maxSupply}, minerals=${Math.floor(ai.minerals)}`
          );
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

  private runEconomicLayer(ai: AIPlayer, _currentTick: number): void {
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
        this.tacticsManager.executeExpandingPhase(ai, currentTick);
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

    // Always recover orphaned assault units regardless of AI state
    // This prevents units from sitting forever after assault mode timeout
    this.tacticsManager.recoverStuckAssaultUnits(ai, currentTick);
  }
}

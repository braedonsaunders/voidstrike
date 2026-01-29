/**
 * AICoordinator - Central orchestrator for AI subsystems
 *
 * Manages AI player state and coordinates between focused subsystems:
 * - AIEconomyManager: Worker management, resource gathering, repair
 * - AIBuildOrderExecutor: Build orders, macro rules, unit/building production
 * - AITacticsManager: Combat state, attack/defend/harass execution
 * - AIScoutingManager: Map exploration, intel gathering
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
import { Game } from '../../core/Game';
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

export type AIState = 'building' | 'expanding' | 'attacking' | 'defending' | 'scouting' | 'harassing';
export type { AIDifficulty };

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
  private random: SeededRandom = new SeededRandom(12345);

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

  constructor(game: Game, difficulty: AIDifficulty = 'medium') {
    super(game);
    this.defaultDifficulty = difficulty;

    // Initialize subsystems
    this.economyManager = new AIEconomyManager(game, this);
    this.buildOrderExecutor = new AIBuildOrderExecutor(game, this);
    this.tacticsManager = new AITacticsManager(game, this);
    this.scoutingManager = new AIScoutingManager(game, this);

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

  // === Public API ===

  public registerAI(
    playerId: string,
    faction: string,
    difficulty: AIDifficulty = 'medium',
    personality: AIPersonality = 'balanced'
  ): void {
    // Idempotency check: prevent duplicate registrations that would reset AI state
    if (this.aiPlayers.has(playerId)) {
      console.log(`[AICoordinator] AI ${playerId} already registered, skipping duplicate registration`);
      return;
    }

    // Always log AI registration (bypasses debug settings for diagnostics)
    console.log(`[AICoordinator] Registering AI: ${playerId}, faction: ${faction}, difficulty: ${difficulty}`);
    debugAI.log(`[AICoordinator] Registering AI: ${playerId}, faction: ${faction}, difficulty: ${difficulty}`);

    const factionConfig = getFactionAIConfig(faction);
    if (!factionConfig) {
      throw new Error(`No AI configuration found for faction: ${faction}. Define a FactionAIConfig in src/data/ai/factions/${faction}.ts`);
    }

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

      buildOrder: this.loadBuildOrder(faction, difficulty),
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
    });
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

  public getRandom(): SeededRandom {
    return this.random;
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

  private loadBuildOrder(faction: string, difficulty: AIDifficulty): BuildOrderStep[] {
    const buildOrder = getRandomBuildOrder(faction, difficulty, this.random);
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
    this.random.reseed(currentTick * 31337 + 42);

    if (currentTick === 1) {
      // Always log on first tick for diagnostics
      console.log(`[AICoordinator] Tick 1: Registered AI players: ${Array.from(this.aiPlayers.keys()).join(', ') || '(none)'}`);
      debugAI.log(`[AICoordinator] Registered AI players: ${Array.from(this.aiPlayers.keys()).join(', ')}`);
    }

    for (const [playerId, ai] of this.aiPlayers) {
      const actionDelay = this.getActionDelay(ai.difficulty);
      if (currentTick - ai.lastActionTick < actionDelay) continue;

      ai.lastActionTick = currentTick;

      this.updateGameState(ai);

      const totalBuildings = Array.from(ai.buildingCounts.values()).reduce((a, b) => a + b, 0);
      if (totalBuildings === 0) {
        // Critical diagnostic: always log when AI has no buildings (this blocks all AI logic)
        if (currentTick % 100 === 0) {
          console.warn(`[AICoordinator] ${playerId} has NO buildings detected! AI logic SKIPPED. This is likely a bug.`);
          debugAI.warn(`[AICoordinator] ${playerId} has no buildings detected! buildingCounts:`, Object.fromEntries(ai.buildingCounts));
        }
        continue;
      }

      // Periodic status log
      if (currentTick % 200 === 0) {
        debugAI.log(`[AICoordinator] ${playerId}: workers=${ai.workerCount}, buildings=${totalBuildings}, minerals=${Math.floor(ai.minerals)}, vespene=${Math.floor(ai.vespene)}, supply=${ai.supply}/${ai.maxSupply}, buildOrderStep=${ai.buildOrderIndex}/${ai.buildOrder.length}, state=${ai.state}`);
      }

      this.updateMaxSupply(ai);

      // Economic layer runs EVERY tick
      this.runEconomicLayer(ai, currentTick);

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

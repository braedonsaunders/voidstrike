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

type AIState = 'building' | 'expanding' | 'attacking' | 'defending' | 'scouting' | 'harassing';
export type AIDifficulty = 'easy' | 'medium' | 'hard' | 'very_hard' | 'insane';

interface BuildOrderStep {
  type: 'unit' | 'building';
  id: string;
  supply?: number; // Execute at this supply
  condition?: (ai: AIPlayer) => boolean;
}

interface AIPlayer {
  playerId: string;
  faction: string;
  difficulty: AIDifficulty;
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
  lastEnemyContact: number;
  scoutedLocations: Set<string>;

  // Build order
  buildOrder: BuildOrderStep[];
  buildOrderIndex: number;
  buildOrderFailureCount: number; // Track consecutive failures to skip stuck steps

  // Timing
  attackCooldown: number;
  lastAttackTick: number;
  harassCooldown: number;
  scoutCooldown: number;
  expansionCooldown: number;
}

// Build order definitions for different difficulties
// Includes tech progression with research modules for advanced units
// Build orders with supply conditions that can actually be reached
// AI starts with 6 workers (supply 6), max supply 11 from HQ
// Supply conditions should be achievable with the workers trained before that step
const BUILD_ORDERS: Record<AIDifficulty, BuildOrderStep[]> = {
  easy: [
    { type: 'unit', id: 'fabricator' },
    { type: 'unit', id: 'fabricator' },
    { type: 'building', id: 'supply_cache' }, // No supply gate - build when affordable
    { type: 'building', id: 'infantry_bay' }, // Build immediately after supply_cache
    { type: 'unit', id: 'trooper' },
    { type: 'unit', id: 'trooper' },
    { type: 'building', id: 'extractor', supply: 10 }, // After some army is built
  ],
  medium: [
    { type: 'unit', id: 'fabricator' },
    { type: 'unit', id: 'fabricator' },
    { type: 'unit', id: 'fabricator' },
    { type: 'building', id: 'supply_cache' }, // No supply gate
    { type: 'building', id: 'infantry_bay' },
    { type: 'building', id: 'extractor' },
    { type: 'unit', id: 'trooper' },
    { type: 'building', id: 'infantry_bay', supply: 14 }, // After some economy
    { type: 'building', id: 'forge', supply: 18 },
    { type: 'building', id: 'research_module', supply: 22 }, // For breachers/devastators
  ],
  hard: [
    { type: 'unit', id: 'fabricator' },
    { type: 'unit', id: 'fabricator' },
    { type: 'unit', id: 'fabricator' },
    { type: 'building', id: 'supply_cache' }, // No supply gate
    { type: 'building', id: 'infantry_bay' },
    { type: 'building', id: 'extractor' },
    { type: 'building', id: 'research_module', supply: 12 }, // Early tech for breachers
    { type: 'building', id: 'forge', supply: 16 },
    { type: 'unit', id: 'breacher' },
    { type: 'building', id: 'research_module', supply: 20 }, // Tech on forge for devastators
    { type: 'building', id: 'hangar', supply: 24 },
  ],
  very_hard: [
    { type: 'unit', id: 'fabricator' },
    { type: 'unit', id: 'fabricator' },
    { type: 'building', id: 'supply_cache' }, // No supply gate
    { type: 'building', id: 'infantry_bay' },
    { type: 'building', id: 'extractor' },
    { type: 'building', id: 'research_module', supply: 10 }, // Early tech
    { type: 'building', id: 'forge', supply: 14 },
    { type: 'building', id: 'research_module', supply: 18 }, // Forge tech
    { type: 'building', id: 'hangar', supply: 22 },
    { type: 'building', id: 'infantry_bay', supply: 26 },
    { type: 'building', id: 'research_module', supply: 30 }, // Hangar tech
  ],
  insane: [
    { type: 'unit', id: 'fabricator' },
    { type: 'building', id: 'supply_cache' }, // No supply gate - rush
    { type: 'building', id: 'infantry_bay' },
    { type: 'building', id: 'extractor' },
    { type: 'building', id: 'research_module', supply: 9 }, // Immediate tech
    { type: 'building', id: 'forge', supply: 12 },
    { type: 'building', id: 'research_module', supply: 16 }, // Forge tech
    { type: 'building', id: 'hangar', supply: 20 },
    { type: 'building', id: 'research_module', supply: 24 }, // Hangar tech
    { type: 'building', id: 'arsenal', supply: 28 },
  ],
};

// PERF: Cached entity query results to avoid repeated queries per frame
interface EntityQueryCache {
  units: Entity[] | null;
  unitsWithTransform: Entity[] | null;
  buildings: Entity[] | null;
  buildingsWithTransform: Entity[] | null;
  resources: Entity[] | null;
}

export class EnhancedAISystem extends System {
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
    difficulty: AIDifficulty = 'medium'
  ): void {
    debugAI.log(`[EnhancedAI] Registering AI: ${playerId}, faction: ${faction}, difficulty: ${difficulty}`);
    const config = this.getDifficultyConfig(difficulty);

    this.aiPlayers.set(playerId, {
      playerId,
      faction,
      difficulty,
      state: 'building',
      lastActionTick: 0,
      lastScoutTick: 0,
      lastHarassTick: 0,
      lastExpansionTick: 0,

      minerals: 50,
      vespene: 0,
      supply: 6,
      maxSupply: 11,
      workerCount: 6,
      targetWorkerCount: config.targetWorkers,

      armyValue: 0,
      armySupply: 0,
      armyComposition: new Map(),

      buildingCounts: new Map([['headquarters', 1]]),
      buildingsInProgress: new Map(),

      enemyBaseLocation: null,
      enemyArmyStrength: 0,
      lastEnemyContact: 0,
      scoutedLocations: new Set(),

      buildOrder: [...BUILD_ORDERS[difficulty]],
      buildOrderIndex: 0,
      buildOrderFailureCount: 0,

      attackCooldown: config.attackCooldown,
      lastAttackTick: 0,
      harassCooldown: config.harassCooldown,
      scoutCooldown: config.scoutCooldown,
      expansionCooldown: config.expansionCooldown,
    });
  }

  private getDifficultyConfig(difficulty: AIDifficulty): {
    targetWorkers: number;
    attackCooldown: number;
    harassCooldown: number;
    scoutCooldown: number;
    resourceBonus: number;
    expansionCooldown: number;
    maxBases: number;
    minArmyForExpansion: number;
    minWorkersForExpansion: number;
  } {
    // Expansion timings based on SC2 AI behavior:
    // - Easy: Slower expansion, max 2 bases
    // - Medium: Natural expansion around 3-4 minutes, max 3 bases
    // - Hard: Aggressive expansion, max 4 bases
    // - Very Hard: Very aggressive, max 5 bases
    // - Insane: Immediate expansion, max 6 bases
    switch (difficulty) {
      case 'easy':
        return {
          targetWorkers: 16,
          attackCooldown: 800,
          harassCooldown: 0,
          scoutCooldown: 0,
          resourceBonus: 0,
          expansionCooldown: 1200, // ~60 seconds at 20 ticks/sec
          maxBases: 2,
          minArmyForExpansion: 8,
          minWorkersForExpansion: 12,
        };
      case 'medium':
        return {
          targetWorkers: 20,
          attackCooldown: 500,
          harassCooldown: 0,
          scoutCooldown: 600,
          resourceBonus: 0,
          expansionCooldown: 800, // ~40 seconds
          maxBases: 3,
          minArmyForExpansion: 6,
          minWorkersForExpansion: 10,
        };
      case 'hard':
        return {
          targetWorkers: 24,
          attackCooldown: 350,
          harassCooldown: 400,
          scoutCooldown: 400,
          resourceBonus: 0,
          expansionCooldown: 600, // ~30 seconds
          maxBases: 4,
          minArmyForExpansion: 4,
          minWorkersForExpansion: 8,
        };
      case 'very_hard':
        return {
          targetWorkers: 28,
          attackCooldown: 250,
          harassCooldown: 300,
          scoutCooldown: 300,
          resourceBonus: 0.25,
          expansionCooldown: 500, // ~25 seconds
          maxBases: 5,
          minArmyForExpansion: 2,
          minWorkersForExpansion: 6,
        };
      case 'insane':
        return {
          targetWorkers: 32,
          attackCooldown: 150,
          harassCooldown: 200,
          scoutCooldown: 200,
          resourceBonus: 0.5,
          expansionCooldown: 400, // ~20 seconds
          maxBases: 6,
          minArmyForExpansion: 0, // Expands even without army
          minWorkersForExpansion: 4,
        };
    }
  }

  public update(_deltaTime: number): void {
    const currentTick = this.game.getCurrentTick();

    // PERF: Clear entity cache at start of update cycle
    this.clearEntityCache();

    // Reseed random based on tick for deterministic multiplayer
    // Using tick ensures same decisions across all clients
    this.random = new SeededRandom(currentTick * 31337 + 42);

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
    const config = this.getDifficultyConfig(ai.difficulty);

    // All AI difficulties get passive income based on workers gathering
    // This simulates workers mining (since the game store is only for player1)
    // Base income: ~5 minerals per worker per action tick
    const baseIncomePerWorker = 5;
    const incomeMultiplier = 1 + config.resourceBonus;

    ai.minerals += ai.workerCount * baseIncomePerWorker * incomeMultiplier;

    // Vespene income if AI has an extractor (simplified: assume 3 workers on gas)
    if ((ai.buildingCounts.get('extractor') || 0) > 0) {
      ai.vespene += 3 * baseIncomePerWorker * 0.8 * incomeMultiplier;
    }

    // Update max supply based on buildings
    // HQ and its upgrades (orbital_station, bastion) all provide 11 supply
    const hqCount = ai.buildingCounts.get('headquarters') || 0;
    const orbitalCount = ai.buildingCounts.get('orbital_station') || 0;
    const bastionCount = ai.buildingCounts.get('bastion') || 0;
    const cacheCount = ai.buildingCounts.get('supply_cache') || 0;
    ai.maxSupply = (hqCount + orbitalCount + bastionCount) * 11 + cacheCount * 8;
  }

  private updateAIState(ai: AIPlayer, currentTick: number): void {
    // Priority: Defending > Attacking > Harassing > Expanding > Scouting > Building
    const config = this.getDifficultyConfig(ai.difficulty);

    if (this.isUnderAttack(ai.playerId)) {
      ai.state = 'defending';
      return;
    }

    // Check if should attack
    const minArmySize = this.getMinArmyForAttack(ai.difficulty);
    if (ai.armySupply >= minArmySize && currentTick - ai.lastAttackTick >= ai.attackCooldown) {
      ai.state = 'attacking';
      return;
    }

    // CRITICAL: Continue attacking if already in attack state and enemies still exist
    // This prevents the AI from giving up mid-attack when it takes losses
    if (ai.state === 'attacking') {
      const hasArmy = this.getArmyUnits(ai.playerId).length > 0;
      const hasEnemies = this.findAnyEnemyTarget(ai.playerId) !== null;
      if (hasArmy && hasEnemies) {
        // Stay in attacking state - finish the job!
        return;
      }
    }

    // Check if should harass (hard+ difficulty)
    if (ai.harassCooldown > 0 && currentTick - ai.lastHarassTick >= ai.harassCooldown) {
      const harassUnits = this.getHarassUnits(ai);
      if (harassUnits.length > 0) {
        ai.state = 'harassing';
        return;
      }
    }

    // Check if should expand - SC2-style expansion timing
    // AI considers expansion if:
    // 1. Cooldown has elapsed since last expansion
    // 2. Has enough workers to justify expansion
    // 3. Has some army for defense (configurable by difficulty)
    // 4. Has enough minerals
    // 5. Below max base count
    const totalBases = this.countPlayerBases(ai.playerId);
    const shouldConsiderExpansion =
      currentTick - ai.lastExpansionTick >= ai.expansionCooldown &&
      ai.workerCount >= config.minWorkersForExpansion &&
      ai.armySupply >= config.minArmyForExpansion &&
      ai.minerals >= 400 &&
      totalBases < config.maxBases;

    // More aggressive expansion for saturated bases
    // If workers are near saturation (3 per mineral patch = ~24 per base), expand
    const optimalWorkersPerBase = 22;
    const isSaturated = ai.workerCount >= totalBases * optimalWorkersPerBase * 0.8;

    if (shouldConsiderExpansion || (isSaturated && ai.minerals >= 400 && totalBases < config.maxBases)) {
      ai.state = 'expanding';
      return;
    }

    // Check if should scout
    if (ai.scoutCooldown > 0 && currentTick - ai.lastScoutTick >= ai.scoutCooldown) {
      ai.state = 'scouting';
      return;
    }

    ai.state = 'building';
  }

  /**
   * Count total command center type buildings for a player
   */
  private countPlayerBases(playerId: string): number {
    let count = 0;
    const buildings = this.getCachedBuildings();
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable');
      const building = entity.get<Building>('Building');
      const health = entity.get<Health>('Health');

      if (!selectable || !building || !health) continue;
      if (selectable.playerId !== playerId) continue;
      if (health.isDead()) continue;

      if (['headquarters', 'orbital_station', 'bastion'].includes(building.buildingId)) {
        count++;
      }
    }
    return count;
  }

  private getMinArmyForAttack(difficulty: AIDifficulty): number {
    switch (difficulty) {
      case 'easy': return 20;
      case 'medium': return 15;
      case 'hard': return 12;
      case 'very_hard': return 10;
      case 'insane': return 8;
    }
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
    // First priority: Repair damaged buildings and units
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

      // Check custom condition
      if (step.condition && !step.condition(ai)) {
        ai.buildOrderIndex++;
        return;
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

  private doMacro(ai: AIPlayer): void {
    // Supply check
    if (ai.supply >= ai.maxSupply - 2) {
      if (this.tryBuildBuilding(ai, 'supply_cache')) return;
    }

    // Worker production
    if (ai.workerCount < ai.targetWorkerCount) {
      if (this.tryTrainUnit(ai, 'fabricator')) return;
    }

    // Army production based on difficulty
    this.produceArmy(ai);
  }

  private produceArmy(ai: AIPlayer): void {
    const hasInfantryBay = (ai.buildingCounts.get('infantry_bay') || 0) > 0;
    const hasForge = (ai.buildingCounts.get('forge') || 0) > 0;
    const hasHangar = (ai.buildingCounts.get('hangar') || 0) > 0;
    const hasExtractor = (ai.buildingCounts.get('extractor') || 0) > 0;
    const infantryBayCount = ai.buildingCounts.get('infantry_bay') || 0;
    const researchModuleCount = ai.buildingCounts.get('research_module') || 0;

    // Build extractor early to get vespene for tech
    if (!hasExtractor && ai.workerCount >= 14) {
      if (this.tryBuildBuilding(ai, 'extractor')) return;
    }

    // Build production buildings if needed
    if (!hasInfantryBay && ai.workerCount >= 12) {
      if (this.tryBuildBuilding(ai, 'infantry_bay')) return;
    }

    // Second infantry bay for more production
    if (infantryBayCount === 1 && ai.workerCount >= 18 && ai.armySupply >= 4) {
      if (this.tryBuildBuilding(ai, 'infantry_bay')) return;
    }

    // Forge for all difficulties except easy (requires extractor for vespene)
    if (hasInfantryBay && hasExtractor && !hasForge && ai.difficulty !== 'easy' && ai.vespene >= 100) {
      if (this.tryBuildBuilding(ai, 'forge')) return;
    }

    // Hangar for medium+ difficulties
    if (hasForge && !hasHangar && ai.difficulty !== 'easy' && ai.vespene >= 100) {
      if (this.tryBuildBuilding(ai, 'hangar')) return;
    }

    // Build Research Module for tech units (medium+ difficulty)
    // This is critical for producing breachers, devastators, colossus, etc.
    if (ai.difficulty !== 'easy' && hasExtractor && ai.vespene >= 25) {
      const buildingNeedingModule = this.findBuildingNeedingResearchModule(ai);
      if (buildingNeedingModule && researchModuleCount < 3) { // Max 3 research modules
        if (this.tryBuildResearchModule(ai, buildingNeedingModule)) return;
      }
    }

    // Use counter-building logic for harder difficulties
    if (ai.difficulty === 'hard' || ai.difficulty === 'very_hard' || ai.difficulty === 'insane') {
      const recommendation = getCounterRecommendation(this.world, ai.playerId, ai.buildingCounts);

      // Try to build recommended buildings first
      for (const buildingRec of recommendation.buildingsToBuild) {
        if (this.tryBuildBuilding(ai, buildingRec.buildingId)) return;
      }

      // Try to train recommended units (with vespene checks)
      for (const unitRec of recommendation.unitsToBuild) {
        const unitDef = UNIT_DEFINITIONS[unitRec.unitId];
        if (!unitDef) continue;

        // Check we have enough vespene for this unit
        if (ai.vespene < unitDef.vespeneCost) continue;

        const canProduce = this.canProduceUnit(ai, unitRec.unitId);
        if (canProduce && this.tryTrainUnit(ai, unitRec.unitId)) return;
      }
    }

    // Produce tech units with higher probability (when we can)
    // Priority: Heavy units > Medium units > Basic units

    // Try to build Colossus (heavy unit - best tank)
    if (hasForge && this.canProduceUnit(ai, 'colossus') && ai.vespene >= 200 && ai.minerals >= 300) {
      if (this.random.next() < 0.4) {
        if (this.tryTrainUnit(ai, 'colossus')) return;
      }
    }

    // Try to build Devastator (medium-heavy tank)
    if (hasForge && this.canProduceUnit(ai, 'devastator') && ai.vespene >= 125) {
      if (this.random.next() < 0.5) {
        if (this.tryTrainUnit(ai, 'devastator')) return;
      }
    }

    // Try to build air units from Hangar
    if (hasHangar) {
      // Specter (cloaked air unit)
      if (this.canProduceUnit(ai, 'specter') && ai.vespene >= 100 && this.random.next() < 0.3) {
        if (this.tryTrainUnit(ai, 'specter')) return;
      }
      // Valkyrie (good anti-air)
      if (ai.vespene >= 75 && this.random.next() < 0.35) {
        if (this.tryTrainUnit(ai, 'valkyrie')) return;
      }
      // Lifter (transport/healer)
      if (ai.vespene >= 100 && this.random.next() < 0.2) {
        if (this.tryTrainUnit(ai, 'lifter')) return;
      }
      // Valkyrie as fallback - always try to produce something from hangar
      if (ai.vespene >= 75) {
        if (this.tryTrainUnit(ai, 'valkyrie')) return;
      }
    }

    // Produce vehicles from Forge
    if (hasForge && ai.vespene >= 25) {
      // Scorcher - fast harassment unit (doesn't need research module)
      if (this.random.next() < 0.4) {
        if (this.tryTrainUnit(ai, 'scorcher')) return;
      }
      // Scorcher as fallback - always try to produce something from forge
      if (this.tryTrainUnit(ai, 'scorcher')) return;
    }

    // Produce infantry from Infantry Bay
    if (hasInfantryBay) {
      // Breacher (needs research module) - anti-armor infantry
      if (this.canProduceUnit(ai, 'breacher') && ai.vespene >= 25 && this.random.next() < 0.5) {
        if (this.tryTrainUnit(ai, 'breacher')) return;
      }

      // Operative (needs research module) - stealth/sniper unit
      if (this.canProduceUnit(ai, 'operative') && ai.vespene >= 125 && this.random.next() < 0.25) {
        if (this.tryTrainUnit(ai, 'operative')) return;
      }

      // Vanguard - jetpack unit for harassment
      if (ai.vespene >= 50 && this.random.next() < 0.3) {
        if (this.tryTrainUnit(ai, 'vanguard')) return;
      }

      // Trooper - basic unit (fallback, no vespene needed)
      this.tryTrainUnit(ai, 'trooper');
    }
  }

  /**
   * Try to build a tech lab addon on a production building
   * Tech lab allows building of advanced units (devastator, colossus, breacher, etc.)
   */
  private tryBuildResearchModule(ai: AIPlayer, target: { entityId: number; buildingId: string; position: { x: number; y: number } }): boolean {
    const moduleDef = BUILDING_DEFINITIONS['research_module'];
    if (!moduleDef) return false;

    if (ai.minerals < moduleDef.mineralCost || ai.vespene < moduleDef.vespeneCost) return false;

    // Tech lab is placed adjacent to the building (to the right)
    const modulePos = {
      x: target.position.x + 3, // Right side of building
      y: target.position.y
    };

    // Check if position is valid
    if (!this.isValidBuildingSpot(modulePos.x, modulePos.y, moduleDef.width, moduleDef.height)) {
      return false;
    }

    // Get the parent building and attach the addon directly
    const parentEntity = this.world.getEntity(target.entityId);
    if (!parentEntity) return false;

    const parentBuilding = parentEntity.get<Building>('Building');
    if (!parentBuilding || !parentBuilding.canHaveAddon || parentBuilding.hasAddon()) return false;

    ai.minerals -= moduleDef.mineralCost;
    ai.vespene -= moduleDef.vespeneCost;

    // Create the addon building and attach it
    // Use the building:place event with a special flag for addon
    this.game.eventBus.emit('building:place', {
      buildingType: 'research_module',
      position: modulePos,
      playerId: ai.playerId,
      isAddon: true,
      parentBuildingId: target.entityId,
    });

    // Directly attach the tech_lab addon type to the parent building
    // The addon system uses 'tech_lab' internally for production capability
    parentBuilding.attachAddon('tech_lab', -1); // -1 will be updated when addon entity is created

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
   * Find a production building that can build research module (tech lab)
   * Returns the building that needs an addon most (for tech units)
   */
  private findBuildingNeedingResearchModule(ai: AIPlayer): { entityId: number; buildingId: string; position: { x: number; y: number } } | null {
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

      // Priority: forge > infantry_bay > hangar (for better tech units)
      let priority = 0;
      if (building.buildingId === 'forge') priority = 3; // Devastator, Colossus
      else if (building.buildingId === 'infantry_bay') priority = 2; // Breacher, Operative
      else if (building.buildingId === 'hangar') priority = 1; // Specter, Dreadnought

      if (priority > 0) {
        candidates.push({
          entityId: entity.id,
          buildingId: building.buildingId,
          position: { x: transform.x, y: transform.y },
          priority
        });
      }
    }

    // Return highest priority building
    candidates.sort((a, b) => b.priority - a.priority);
    return candidates.length > 0 ? candidates[0] : null;
  }

  private executeExpandingPhase(ai: AIPlayer): void {
    const config = this.getDifficultyConfig(ai.difficulty);
    const totalBases = this.countPlayerBases(ai.playerId);
    const currentTick = this.game.getCurrentTick();

    // Check if expansion is possible
    if (totalBases < config.maxBases && ai.minerals >= 400) {
      const expansionPos = this.findExpansionLocation(ai);
      if (expansionPos) {
        // Try to build headquarters at expansion
        if (this.tryBuildBuildingAt(ai, 'headquarters', expansionPos)) {
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
    const aiBase = this.findAIBase(ai.playerId);
    if (!aiBase) return null;

    // Get all existing command center positions for this AI player only
    const existingBases: Array<{ x: number; y: number }> = [];
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      // Only count this AI's own bases, not enemy bases
      if (selectable.playerId === ai.playerId &&
          ['headquarters', 'orbital_station', 'bastion', 'nexus', 'hatchery'].includes(building.buildingId)) {
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
      // Skip small clusters (not real bases)
      if (cluster.count < 4) continue;

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
    const enemyTarget = this.findAnyEnemyTarget(ai.playerId);
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
      const nearbyEnemy = this.findNearestEnemyEntity(
        ai.playerId,
        { x: transform.x, y: transform.y },
        unit.sightRange
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
  private findAnyEnemyTarget(playerId: string): { x: number; y: number } | null {
    // Get AI's base position for calculating closest enemy
    const aiBase = this.findAIBase(playerId);
    if (!aiBase) return null;

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
      if (selectable.playerId === playerId) continue;
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

      // Track headquarters position as base location
      if (building.buildingId === 'headquarters' || building.buildingId === 'orbital_station') {
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
    const enemyUnitsByPlayer: Map<string, { x: number; y: number; distance: number }[]> = new Map();
    const units = this.getCachedUnitsWithTransform();
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');

      if (!selectable || !health || !transform) continue;
      if (selectable.playerId === playerId) continue;
      if (health.isDead()) continue;

      const enemyId = selectable.playerId;
      const dx = transform.x - aiBase.x;
      const dy = transform.y - aiBase.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (!enemyUnitsByPlayer.has(enemyId)) {
        enemyUnitsByPlayer.set(enemyId, []);
      }
      enemyUnitsByPlayer.get(enemyId)!.push({ x: transform.x, y: transform.y, distance });
    }

    // Target units from the closest enemy
    if (targetEnemy && enemyUnitsByPlayer.has(targetEnemy)) {
      const targetUnits = enemyUnitsByPlayer.get(targetEnemy)!;
      if (targetUnits.length > 0) {
        // Sort by distance and pick closest
        targetUnits.sort((a, b) => a.distance - b.distance);
        return { x: targetUnits[0].x, y: targetUnits[0].y };
      }
    }

    // Fallback: any enemy unit (closest one)
    let closestUnit: { x: number; y: number } | null = null;
    let closestUnitDist = Infinity;
    for (const [, enemyUnits] of enemyUnitsByPlayer) {
      for (const unit of enemyUnits) {
        if (unit.distance < closestUnitDist) {
          closestUnitDist = unit.distance;
          closestUnit = { x: unit.x, y: unit.y };
        }
      }
    }

    return closestUnit;
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
    const baseLocation = this.findAIBase(ai.playerId);
    if (!baseLocation) return;

    const armyUnits = this.getArmyUnits(ai.playerId);
    if (armyUnits.length === 0) {
      ai.state = 'building';
      return;
    }

    const currentTick = this.game.getCurrentTick();

    // Find any nearby enemy entity to defend against - use direct targeting
    const nearbyEnemy = this.findNearestEnemyEntity(ai.playerId, baseLocation, 30);
    if (nearbyEnemy) {
      // Direct attack command with specific target entity for each army unit
      for (const unitId of armyUnits) {
        const entity = this.world.getEntity(unitId);
        if (!entity) continue;
        const unit = entity.get<Unit>('Unit');
        // Skip units already attacking with a target
        if (unit && unit.state === 'attacking' && unit.targetEntityId !== null) continue;

        const directAttackCommand: GameCommand = {
          tick: currentTick,
          playerId: ai.playerId,
          type: 'ATTACK',
          entityIds: [unitId],
          targetEntityId: nearbyEnemy.entityId,
        };
        this.game.processCommand(directAttackCommand);
      }
    } else {
      // No enemy in range - rally units near the base (not AT it) to form a defensive position
      // Position units in front of the base (offset by 8 units)
      const rallyPoint = {
        x: baseLocation.x + 8,
        y: baseLocation.y + 8,
      };

      const command: GameCommand = {
        tick: this.game.getCurrentTick(),
        playerId: ai.playerId,
        type: 'MOVE',
        entityIds: armyUnits,
        targetPosition: rallyPoint,
      };
      this.game.processCommand(command);

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
   */
  private findNearestEnemyEntity(playerId: string, position: { x: number; y: number }, range: number): { entityId: number; x: number; y: number } | null {
    let closestEnemy: { entityId: number; x: number; y: number; distance: number } | null = null;

    // Check enemy units first (higher priority)
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

      if (distance <= range && (!closestEnemy || distance < closestEnemy.distance)) {
        closestEnemy = { entityId: entity.id, x: transform.x, y: transform.y, distance };
      }
    }

    // Also check enemy buildings
    const buildings = this.getCachedBuildingsWithTransform();
    for (const entity of buildings) {
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
    const harassTarget = this.findHarassTarget(ai.playerId);
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
    const buildingDef = BUILDING_DEFINITIONS[buildingType];
    if (!buildingDef) {
      debugAI.log(`[EnhancedAI] ${ai.playerId}: tryBuildBuilding failed - unknown building type: ${buildingType}`);
      return false;
    }

    if (ai.minerals < buildingDef.mineralCost || ai.vespene < buildingDef.vespeneCost) {
      // Not enough resources - this is normal, don't log
      return false;
    }

    const basePos = this.findAIBase(ai.playerId);
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

    // Special handling for extractors - must be placed on vespene geysers
    if (buildingType === 'extractor') {
      buildPos = this.findAvailableVespeneGeyser(ai.playerId, basePos);
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
   */
  private findAvailableWorker(playerId: string): number | null {
    const units = this.getCachedUnits();

    // First pass: find idle workers
    for (const entity of units) {
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!unit || !selectable || !health) continue;
      if (selectable.playerId !== playerId) continue;
      if (!unit.isWorker) continue;
      if (health.isDead()) continue;

      if (unit.state === 'idle') {
        return entity.id;
      }
    }

    // Second pass: find gathering workers
    for (const entity of units) {
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!unit || !selectable || !health) continue;
      if (selectable.playerId !== playerId) continue;
      if (!unit.isWorker) continue;
      if (health.isDead()) continue;

      if (unit.state === 'gathering') {
        return entity.id;
      }
    }

    // Third pass: find moving workers
    for (const entity of units) {
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!unit || !selectable || !health) continue;
      if (selectable.playerId !== playerId) continue;
      if (!unit.isWorker) continue;
      if (health.isDead()) continue;

      if (unit.state === 'moving') {
        return entity.id;
      }
    }

    return null;
  }

  /**
   * Find a vespene geyser near the AI's base that doesn't have a refinery yet
   */
  private findAvailableVespeneGeyser(playerId: string, basePos: { x: number; y: number }): { x: number; y: number } | null {
    const resources = this.getCachedResources();
    let closestGeyser: { x: number; y: number; distance: number } | null = null;

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');

      if (!resource || !transform) continue;
      if (resource.resourceType !== 'vespene') continue;
      if (resource.hasRefinery()) continue; // Already has a refinery

      const dx = transform.x - basePos.x;
      const dy = transform.y - basePos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Only consider geysers within reasonable distance of base (near main or natural)
      if (distance < 30) {
        if (!closestGeyser || distance < closestGeyser.distance) {
          closestGeyser = { x: transform.x, y: transform.y, distance };
        }
      }
    }

    return closestGeyser ? { x: closestGeyser.x, y: closestGeyser.y } : null;
  }

  private findAIBase(playerId: string): { x: number; y: number } | null {
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    let foundForPlayer = false;
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== playerId) continue;
      foundForPlayer = true;
      if (building.buildingId === 'headquarters' || building.buildingId === 'orbital_station') {
        return { x: transform.x, y: transform.y };
      }
    }
    if (!foundForPlayer) {
      debugAI.log(`[EnhancedAI] findAIBase: No buildings at all for ${playerId}`);
    }
    return null;
  }

  private findEnemyBase(playerId: string): { x: number; y: number } | null {
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId === playerId) continue;
      if (building.buildingId === 'headquarters' || building.buildingId === 'nexus' || building.buildingId === 'hatchery') {
        return { x: transform.x, y: transform.y };
      }
    }

    // Return any enemy building
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId === playerId) continue;
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

  private findHarassTarget(playerId: string): { x: number; y: number } | null {
    // Find enemy workers or expansion
    const units = this.getCachedUnitsWithTransform();

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === playerId) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) {
        return { x: transform.x, y: transform.y };
      }
    }

    // Otherwise target enemy base
    return this.findEnemyBase(playerId);
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
   */
  private assignIdleWorkersToGather(ai: AIPlayer): void {
    // Find AI's base position
    const basePos = this.findAIBase(ai.playerId);
    if (!basePos) {
      debugAI.log(`[EnhancedAI] ${ai.playerId}: No base found for gathering!`);
      return;
    }

    // Find nearby mineral patches with their current saturation
    const resources = this.getCachedResources();
    const nearbyMinerals: { entityId: number; x: number; y: number; distance: number; currentWorkers: number }[] = [];

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');

      if (!resource || !transform) continue;
      if (resource.resourceType !== 'minerals') continue;
      if (resource.isDepleted()) continue;

      const dx = transform.x - basePos.x;
      const dy = transform.y - basePos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Only consider minerals within reasonable distance of base
      if (distance < 30) {
        nearbyMinerals.push({
          entityId: entity.id,
          x: transform.x,
          y: transform.y,
          distance,
          currentWorkers: resource.getCurrentGatherers()
        });
      }
    }

    // Find AI's completed refineries for vespene harvesting
    const refineries: { entityId: number; resourceEntityId: number; currentWorkers: number }[] = [];
    const buildings = this.world.getEntitiesWith('Building', 'Selectable', 'Transform');

    for (const entity of buildings) {
      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');

      if (!building || !selectable) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (building.buildingId !== 'extractor') continue;
      if (!building.isComplete()) continue;

      // Find the associated vespene geyser
      for (const resEntity of resources) {
        const resource = resEntity.get<Resource>('Resource');
        if (!resource) continue;
        if (resource.resourceType !== 'vespene') continue;
        if (resource.extractorEntityId === entity.id) {
          refineries.push({
            entityId: entity.id,
            resourceEntityId: resEntity.id,
            currentWorkers: resource.getCurrentGatherers()
          });
          break;
        }
      }
    }

    // Find idle AI workers
    const units = this.getCachedUnits();
    const idleWorkers: number[] = [];

    // Track all worker states for debugging
    const workerStates: Record<string, number> = {};

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

      // Only grab truly idle workers (not already gathering or building)
      if (unit.state === 'idle') {
        idleWorkers.push(entity.id);
      }
    }

    if (nearbyMinerals.length === 0 && refineries.length === 0) return;

    // Debug log periodically
    if (this.game.getCurrentTick() % 200 === 0) {
      const statesStr = Object.entries(workerStates).map(([k, v]) => `${k}:${v}`).join(', ');
      const totalMineralWorkers = nearbyMinerals.reduce((sum, m) => sum + m.currentWorkers, 0);
      const totalGasWorkers = refineries.reduce((sum, r) => sum + r.currentWorkers, 0);
      debugAI.log(`[EnhancedAI] ${ai.playerId}: workers=[${statesStr}], idle=${idleWorkers.length}, minerals=${totalMineralWorkers}/${nearbyMinerals.length * OPTIMAL_WORKERS_PER_MINERAL}, gas=${totalGasWorkers}/${refineries.length * OPTIMAL_WORKERS_PER_VESPENE}`);
    }

    // Assign idle workers using SC2-style optimal saturation
    for (const workerId of idleWorkers) {
      // Priority 1: Fill undersaturated gas (vespene is more valuable)
      const undersaturatedGas = refineries.find(r => r.currentWorkers < OPTIMAL_WORKERS_PER_VESPENE);
      if (undersaturatedGas) {
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: undersaturatedGas.resourceEntityId,
        });
        undersaturatedGas.currentWorkers++; // Track assignment for next worker
        continue;
      }

      // Priority 2: Fill undersaturated minerals (patches with < 2 workers)
      // Sort by workers first (fewest first), then distance
      nearbyMinerals.sort((a, b) => {
        if (a.currentWorkers !== b.currentWorkers) {
          return a.currentWorkers - b.currentWorkers;
        }
        return a.distance - b.distance;
      });

      const undersaturatedMineral = nearbyMinerals.find(m => m.currentWorkers < OPTIMAL_WORKERS_PER_MINERAL);
      if (undersaturatedMineral) {
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: undersaturatedMineral.entityId,
        });
        undersaturatedMineral.currentWorkers++; // Track assignment for next worker
        continue;
      }

      // Priority 3: If all minerals are at optimal (2), assign to patches with 2 workers (allows 3rd worker)
      // This provides some oversaturation for faster mining when worker count is high
      const mineralWithRoom = nearbyMinerals.find(m => m.currentWorkers < 3);
      if (mineralWithRoom) {
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: mineralWithRoom.entityId,
        });
        mineralWithRoom.currentWorkers++;
        continue;
      }

      // Fallback: assign to closest mineral (shouldn't normally reach here)
      if (nearbyMinerals.length > 0) {
        nearbyMinerals.sort((a, b) => a.distance - b.distance);
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: nearbyMinerals[0].entityId,
        });
      }
    }
  }
}

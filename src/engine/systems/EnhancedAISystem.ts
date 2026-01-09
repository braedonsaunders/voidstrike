import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Resource } from '../components/Resource';
import { Game, GameCommand } from '../core/Game';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';

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

  // Timing
  attackCooldown: number;
  lastAttackTick: number;
  harassCooldown: number;
  scoutCooldown: number;
}

// Build order definitions for different difficulties
const BUILD_ORDERS: Record<AIDifficulty, BuildOrderStep[]> = {
  easy: [
    { type: 'unit', id: 'scv' },
    { type: 'unit', id: 'scv' },
    { type: 'building', id: 'supply_depot', supply: 10 },
    { type: 'building', id: 'barracks', supply: 12 },
    { type: 'unit', id: 'marine' },
  ],
  medium: [
    { type: 'unit', id: 'scv' },
    { type: 'unit', id: 'scv' },
    { type: 'unit', id: 'scv' },
    { type: 'building', id: 'supply_depot', supply: 14 },
    { type: 'building', id: 'barracks', supply: 15 },
    { type: 'building', id: 'refinery', supply: 16 },
    { type: 'unit', id: 'marine' },
    { type: 'building', id: 'barracks', supply: 20 },
  ],
  hard: [
    { type: 'unit', id: 'scv' },
    { type: 'unit', id: 'scv' },
    { type: 'unit', id: 'scv' },
    { type: 'building', id: 'supply_depot', supply: 14 },
    { type: 'building', id: 'barracks', supply: 15 },
    { type: 'building', id: 'refinery', supply: 16 },
    { type: 'building', id: 'factory', supply: 22 },
    { type: 'unit', id: 'hellion' },
    { type: 'building', id: 'starport', supply: 30 },
  ],
  very_hard: [
    { type: 'unit', id: 'scv' },
    { type: 'unit', id: 'scv' },
    { type: 'building', id: 'supply_depot', supply: 13 },
    { type: 'building', id: 'barracks', supply: 14 },
    { type: 'building', id: 'refinery', supply: 15 },
    { type: 'building', id: 'factory', supply: 20 },
    { type: 'building', id: 'starport', supply: 28 },
    { type: 'building', id: 'barracks', supply: 30 },
  ],
  insane: [
    { type: 'unit', id: 'scv' },
    { type: 'building', id: 'supply_depot', supply: 12 },
    { type: 'building', id: 'barracks', supply: 13 },
    { type: 'building', id: 'refinery', supply: 14 },
    { type: 'building', id: 'factory', supply: 18 },
    { type: 'building', id: 'starport', supply: 24 },
    { type: 'building', id: 'armory', supply: 30 },
  ],
};

export class EnhancedAISystem extends System {
  public priority = 100;

  private aiPlayers: Map<string, AIPlayer> = new Map();
  private ticksBetweenActions = 20; // ~1 second at 20 ticks/sec
  private defaultDifficulty: AIDifficulty;

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
    const config = this.getDifficultyConfig(difficulty);

    this.aiPlayers.set(playerId, {
      playerId,
      faction,
      difficulty,
      state: 'building',
      lastActionTick: 0,
      lastScoutTick: 0,
      lastHarassTick: 0,

      minerals: 50,
      vespene: 0,
      supply: 6,
      maxSupply: 11,
      workerCount: 6,
      targetWorkerCount: config.targetWorkers,

      armyValue: 0,
      armySupply: 0,
      armyComposition: new Map(),

      buildingCounts: new Map([['command_center', 1]]),
      buildingsInProgress: new Map(),

      enemyBaseLocation: null,
      enemyArmyStrength: 0,
      lastEnemyContact: 0,
      scoutedLocations: new Set(),

      buildOrder: [...BUILD_ORDERS[difficulty]],
      buildOrderIndex: 0,

      attackCooldown: config.attackCooldown,
      lastAttackTick: 0,
      harassCooldown: config.harassCooldown,
      scoutCooldown: config.scoutCooldown,
    });
  }

  private getDifficultyConfig(difficulty: AIDifficulty): {
    targetWorkers: number;
    attackCooldown: number;
    harassCooldown: number;
    scoutCooldown: number;
    resourceBonus: number;
  } {
    switch (difficulty) {
      case 'easy':
        return { targetWorkers: 16, attackCooldown: 800, harassCooldown: 0, scoutCooldown: 0, resourceBonus: 0 };
      case 'medium':
        return { targetWorkers: 20, attackCooldown: 500, harassCooldown: 0, scoutCooldown: 600, resourceBonus: 0 };
      case 'hard':
        return { targetWorkers: 24, attackCooldown: 350, harassCooldown: 400, scoutCooldown: 400, resourceBonus: 0 };
      case 'very_hard':
        return { targetWorkers: 28, attackCooldown: 250, harassCooldown: 300, scoutCooldown: 300, resourceBonus: 0.25 };
      case 'insane':
        return { targetWorkers: 32, attackCooldown: 150, harassCooldown: 200, scoutCooldown: 200, resourceBonus: 0.5 };
    }
  }

  public update(_deltaTime: number): void {
    const currentTick = this.game.getCurrentTick();

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
        continue;
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

    const units = this.world.getEntitiesWith('Unit', 'Selectable', 'Health');
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

    const buildings = this.world.getEntitiesWith('Building', 'Selectable', 'Health');
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

    // Vespene income if AI has a refinery (simplified: assume 3 workers on gas)
    if ((ai.buildingCounts.get('refinery') || 0) > 0) {
      ai.vespene += 3 * baseIncomePerWorker * 0.8 * incomeMultiplier;
    }

    // Update max supply based on buildings
    const ccCount = ai.buildingCounts.get('command_center') || 0;
    const depotCount = ai.buildingCounts.get('supply_depot') || 0;
    ai.maxSupply = ccCount * 11 + depotCount * 8;
  }

  private updateAIState(ai: AIPlayer, currentTick: number): void {
    // Priority: Defending > Attacking > Harassing > Expanding > Building

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

    // Check if should harass (hard+ difficulty)
    if (ai.harassCooldown > 0 && currentTick - ai.lastHarassTick >= ai.harassCooldown) {
      const harassUnits = this.getHarassUnits(ai);
      if (harassUnits.length > 0) {
        ai.state = 'harassing';
        return;
      }
    }

    // Check if should scout
    if (ai.scoutCooldown > 0 && currentTick - ai.lastScoutTick >= ai.scoutCooldown) {
      ai.state = 'scouting';
      return;
    }

    // Check if should expand
    if (ai.workerCount >= ai.targetWorkerCount * 0.8 && ai.armySupply >= 10) {
      ai.state = 'expanding';
      return;
    }

    ai.state = 'building';
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
      }
      return;
    }

    // Post-build order: Standard macro
    this.doMacro(ai);
  }

  private doMacro(ai: AIPlayer): void {
    // Supply check
    if (ai.supply >= ai.maxSupply - 2) {
      if (this.tryBuildBuilding(ai, 'supply_depot')) return;
    }

    // Worker production
    if (ai.workerCount < ai.targetWorkerCount) {
      if (this.tryTrainUnit(ai, 'scv')) return;
    }

    // Army production based on difficulty
    this.produceArmy(ai);
  }

  private produceArmy(ai: AIPlayer): void {
    const hasBarracks = (ai.buildingCounts.get('barracks') || 0) > 0;
    const hasFactory = (ai.buildingCounts.get('factory') || 0) > 0;
    const hasStarport = (ai.buildingCounts.get('starport') || 0) > 0;
    const hasRefinery = (ai.buildingCounts.get('refinery') || 0) > 0;
    const barrackCount = ai.buildingCounts.get('barracks') || 0;

    // Build refinery early to get vespene for tech
    if (!hasRefinery && ai.workerCount >= 14) {
      if (this.tryBuildBuilding(ai, 'refinery')) return;
    }

    // Build production buildings if needed
    if (!hasBarracks && ai.workerCount >= 12) {
      if (this.tryBuildBuilding(ai, 'barracks')) return;
    }

    // Second barracks for more production
    if (barrackCount === 1 && ai.workerCount >= 18 && ai.armySupply >= 4) {
      if (this.tryBuildBuilding(ai, 'barracks')) return;
    }

    // Factory for all difficulties except easy (requires refinery for vespene)
    if (hasBarracks && hasRefinery && !hasFactory && ai.difficulty !== 'easy' && ai.vespene >= 100) {
      if (this.tryBuildBuilding(ai, 'factory')) return;
    }

    // Starport for medium+ difficulties
    if (hasFactory && !hasStarport && ai.difficulty !== 'easy' && ai.vespene >= 100) {
      if (this.tryBuildBuilding(ai, 'starport')) return;
    }

    // Produce units based on available buildings and resources
    if (hasStarport && ai.vespene >= 100 && Math.random() < 0.25) {
      if (this.tryTrainUnit(ai, 'medivac')) return;
    }

    if (hasFactory && ai.vespene >= 25) {
      if (Math.random() < 0.35) {
        if (this.tryTrainUnit(ai, 'hellion')) return;
      }
      if (ai.vespene >= 125 && Math.random() < 0.25) {
        if (this.tryTrainUnit(ai, 'siege_tank')) return;
      }
    }

    if (hasBarracks) {
      // Marines don't need vespene - always a good choice
      if (ai.vespene >= 25 && Math.random() < 0.35 && ai.difficulty !== 'easy') {
        // Marauders need vespene
        this.tryTrainUnit(ai, 'marauder');
      } else {
        this.tryTrainUnit(ai, 'marine');
      }
    }
  }

  private executeExpandingPhase(ai: AIPlayer): void {
    // Build expansion command center
    // For now, just continue building
    this.executeBuildingPhase(ai);
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

    // Only retreat if army is very small AND we have buildings to defend
    const totalBuildings = Array.from(ai.buildingCounts.values()).reduce((a, b) => a + b, 0);
    if (armyUnits.length < 3 && totalBuildings > 1) {
      ai.state = 'building';
      return;
    }

    ai.lastAttackTick = currentTick;

    // Attack-move to enemy target
    const command: GameCommand = {
      tick: currentTick,
      playerId: ai.playerId,
      type: 'ATTACK',
      entityIds: armyUnits,
      targetPosition: { x: enemyTarget.x, y: enemyTarget.y },
    };

    this.game.processCommand(command);

    // Continue attacking - stay in attack state until enemies are gone
    // This ensures AI pursues victory
  }

  /**
   * Find any enemy target - buildings first, then units
   * Used to ensure AI destroys ALL enemy assets for victory
   */
  private findAnyEnemyTarget(playerId: string): { x: number; y: number } | null {
    // First, look for enemy buildings
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');

      if (!selectable || !health || !transform) continue;
      if (selectable.playerId === playerId) continue;
      if (health.isDead()) continue;

      return { x: transform.x, y: transform.y };
    }

    // Then, look for enemy units
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');

      if (!selectable || !health || !transform) continue;
      if (selectable.playerId === playerId) continue;
      if (health.isDead()) continue;

      return { x: transform.x, y: transform.y };
    }

    return null;
  }

  private executeDefendingPhase(ai: AIPlayer): void {
    const baseLocation = this.findAIBase(ai.playerId);
    if (!baseLocation) return;

    const armyUnits = this.getArmyUnits(ai.playerId);
    if (armyUnits.length === 0) {
      ai.state = 'building';
      return;
    }

    const command: GameCommand = {
      tick: this.game.getCurrentTick(),
      playerId: ai.playerId,
      type: 'ATTACK',
      entityIds: armyUnits,
      targetPosition: baseLocation,
    };

    this.game.processCommand(command);

    // Check if threat is cleared
    if (!this.isUnderAttack(ai.playerId)) {
      ai.state = 'building';
    }
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
    if (!buildingDef) return false;

    if (ai.minerals < buildingDef.mineralCost || ai.vespene < buildingDef.vespeneCost) return false;

    const basePos = this.findAIBase(ai.playerId);
    if (!basePos) return false;

    let buildPos: { x: number; y: number } | null = null;

    // Special handling for refineries - must be placed on vespene geysers
    if (buildingType === 'refinery') {
      buildPos = this.findAvailableVespeneGeyser(ai.playerId, basePos);
      if (!buildPos) {
        // No available vespene geyser nearby, skip building refinery
        return false;
      }
    } else {
      buildPos = this.findBuildingSpot(ai.playerId, basePos, buildingDef.width, buildingDef.height);
      if (!buildPos) return false;
    }

    ai.minerals -= buildingDef.mineralCost;
    ai.vespene -= buildingDef.vespeneCost;

    this.game.eventBus.emit('building:place', {
      buildingType,
      position: buildPos,
      playerId: ai.playerId,
    });

    return true;
  }

  /**
   * Find a vespene geyser near the AI's base that doesn't have a refinery yet
   */
  private findAvailableVespeneGeyser(playerId: string, basePos: { x: number; y: number }): { x: number; y: number } | null {
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
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
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== playerId) continue;
      if (building.buildingId === 'command_center' || building.buildingId === 'orbital_command') {
        return { x: transform.x, y: transform.y };
      }
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
      if (building.buildingId === 'command_center' || building.buildingId === 'nexus' || building.buildingId === 'hatchery') {
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
        const theta = (angle * Math.PI * 2) / 8 + Math.random() * 0.5;
        const x = Math.round(Math.cos(theta) * radius);
        const y = Math.round(Math.sin(theta) * radius);
        offsets.push({ x, y });
      }
    }

    // Shuffle offsets for variety
    for (let i = offsets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
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
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;
      const dx = Math.abs(x - transform.x);
      const dy = Math.abs(y - transform.y);

      if (dx < halfW + 2 && dy < halfH + 2) {
        return false;
      }
    }

    return true;
  }

  private isUnderAttack(playerId: string): boolean {
    const buildings = this.world.getEntitiesWith('Building', 'Selectable', 'Health');
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
    const entities = this.world.getEntitiesWith('Unit', 'Selectable', 'Health');

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
    const entities = this.world.getEntitiesWith('Unit', 'Selectable', 'Health');

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      if (unit.unitId === 'hellion' || unit.unitId === 'reaper') {
        harassUnits.push(entity.id);
      }
    }

    return harassUnits.slice(0, 4); // Max 4 units for harass
  }

  private getScoutUnit(ai: AIPlayer): number | null {
    const entities = this.world.getEntitiesWith('Unit', 'Selectable', 'Health');

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      // Prefer fast units for scouting
      if (unit.unitId === 'reaper' || unit.unitId === 'hellion') {
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
      x: Math.random() * config.mapWidth,
      y: Math.random() * config.mapHeight,
    };
  }

  private findHarassTarget(playerId: string): { x: number; y: number } | null {
    // Find enemy workers or expansion
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');

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
   * Find idle workers and send them to gather minerals or vespene
   */
  private assignIdleWorkersToGather(ai: AIPlayer): void {
    // Find AI's base position
    const basePos = this.findAIBase(ai.playerId);
    if (!basePos) return;

    // Find nearby mineral patches
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    const nearbyMinerals: { entityId: number; x: number; y: number; distance: number }[] = [];

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
        nearbyMinerals.push({ entityId: entity.id, x: transform.x, y: transform.y, distance });
      }
    }

    // Sort by distance
    nearbyMinerals.sort((a, b) => a.distance - b.distance);

    // Find AI's completed refineries for vespene harvesting
    const refineries: { entityId: number; resourceEntityId: number }[] = [];
    const buildings = this.world.getEntitiesWith('Building', 'Selectable', 'Transform');

    for (const entity of buildings) {
      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');

      if (!building || !selectable) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (building.buildingId !== 'refinery') continue;
      if (!building.isComplete()) continue;

      // Find the associated vespene geyser
      for (const resEntity of resources) {
        const resource = resEntity.get<Resource>('Resource');
        if (!resource) continue;
        if (resource.resourceType !== 'vespene') continue;
        if (resource.refineryEntityId === entity.id) {
          refineries.push({ entityId: entity.id, resourceEntityId: resEntity.id });
          break;
        }
      }
    }

    // Find idle AI workers
    const units = this.world.getEntitiesWith('Unit', 'Selectable', 'Health');
    const idleWorkers: number[] = [];
    let gasWorkers = 0;

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable');
      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');

      // Defensive null checks
      if (!selectable || !unit || !health) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (!unit.isWorker) continue;
      if (health.isDead()) continue;

      // Count workers on gas
      if (unit.state === 'gathering' && unit.gatherTargetId !== null) {
        const targetEntity = this.world.getEntity(unit.gatherTargetId);
        if (targetEntity) {
          const resource = targetEntity.get<Resource>('Resource');
          if (resource?.resourceType === 'vespene') {
            gasWorkers++;
          }
        }
      }

      // Only grab truly idle workers (not already gathering or building)
      if (unit.state === 'idle') {
        idleWorkers.push(entity.id);
      }
    }

    if (nearbyMinerals.length === 0 && refineries.length === 0) return;

    // Assign idle workers - prioritize getting 3 workers per refinery first
    const targetGasWorkers = refineries.length * 3;
    let assignedToGas = 0;

    for (const workerId of idleWorkers) {
      // If we need more gas workers and have refineries, assign to gas
      if (refineries.length > 0 && gasWorkers + assignedToGas < targetGasWorkers) {
        const refinery = refineries[assignedToGas % refineries.length];
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: refinery.resourceEntityId,
        });
        assignedToGas++;
      } else if (nearbyMinerals.length > 0) {
        // Otherwise assign to minerals
        const targetMineral = nearbyMinerals[Math.floor(Math.random() * Math.min(nearbyMinerals.length, 4))];
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: targetMineral.entityId,
        });
      }
    }
  }
}

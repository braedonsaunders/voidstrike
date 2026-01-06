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

type AIState = 'building' | 'expanding' | 'attacking' | 'defending';

interface AIPlayer {
  playerId: string;
  faction: string;
  difficulty: 'easy' | 'medium' | 'hard';
  state: AIState;
  lastActionTick: number;
  targetSupply: number;
  workerCount: number;
  armyValue: number;
  // Resource tracking
  minerals: number;
  vespene: number;
  supply: number;
  maxSupply: number;
  // Building flags
  hasBarracks: boolean;
  supplyDepotsBuilding: number;
}

export class AISystem extends System {
  public priority = 100;

  private aiPlayers: Map<string, AIPlayer> = new Map();
  private ticksBetweenActions = 40; // ~2 seconds at 20 ticks/sec

  constructor(game: Game) {
    super(game);
  }

  public registerAI(
    playerId: string,
    faction: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium'
  ): void {
    this.aiPlayers.set(playerId, {
      playerId,
      faction,
      difficulty,
      state: 'building',
      lastActionTick: 0,
      targetSupply: 14,
      workerCount: 0,
      armyValue: 0,
      minerals: 50, // Starting minerals
      vespene: 0,
      supply: 6, // 6 starting workers
      maxSupply: 11, // Command Center provides 11
      hasBarracks: false,
      supplyDepotsBuilding: 0,
    });

    // Listen for production events to track AI resources
    this.setupResourceTracking(playerId);
  }

  private setupResourceTracking(playerId: string): void {
    // Track when AI units are produced (deduct resources)
    this.game.eventBus.on('unit:spawned', (data: { playerId: string; unitType: string }) => {
      if (data.playerId !== playerId) return;
      const ai = this.aiPlayers.get(playerId);
      if (!ai) return;

      const unitDef = UNIT_DEFINITIONS[data.unitType];
      if (unitDef) {
        ai.supply += unitDef.supplyCost;
      }
    });

    // Track building completions
    this.game.eventBus.on('building:complete', (data: { buildingType: string }) => {
      const buildings = this.world.getEntitiesWith('Building', 'Selectable');
      for (const entity of buildings) {
        const selectable = entity.get<Selectable>('Selectable')!;
        const building = entity.get<Building>('Building')!;

        if (selectable.playerId !== playerId) continue;
        if (building.buildingId !== data.buildingType) continue;

        const ai = this.aiPlayers.get(playerId);
        if (!ai) return;

        // Add supply
        if (building.supplyProvided > 0) {
          ai.maxSupply += building.supplyProvided;
        }

        // Track building types
        if (building.buildingId === 'barracks') {
          ai.hasBarracks = true;
        }
        if (building.buildingId === 'supply_depot') {
          ai.supplyDepotsBuilding = Math.max(0, ai.supplyDepotsBuilding - 1);
        }
      }
    });
  }

  public update(_deltaTime: number): void {
    const currentTick = this.game.getCurrentTick();

    for (const [playerId, ai] of this.aiPlayers) {
      // Throttle AI actions based on difficulty
      const actionDelay = this.getActionDelay(ai.difficulty);
      if (currentTick - ai.lastActionTick < actionDelay) continue;

      ai.lastActionTick = currentTick;

      // Update AI state
      this.updateAIState(ai);

      // Execute state-based behavior
      switch (ai.state) {
        case 'building':
          this.executeBuildingPhase(ai);
          break;
        case 'expanding':
          this.executeExpandingPhase(ai);
          break;
        case 'attacking':
          this.executeAttackingPhase(ai);
          break;
        case 'defending':
          this.executeDefendingPhase(ai);
          break;
      }
    }
  }

  private getActionDelay(difficulty: 'easy' | 'medium' | 'hard'): number {
    switch (difficulty) {
      case 'easy':
        return this.ticksBetweenActions * 2;
      case 'medium':
        return this.ticksBetweenActions;
      case 'hard':
        return Math.floor(this.ticksBetweenActions / 2);
    }
  }

  private updateAIState(ai: AIPlayer): void {
    // Count workers and army
    const entities = this.world.getEntitiesWith('Unit', 'Selectable', 'Health');
    let workerCount = 0;
    let armyValue = 0;

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      if (unit.isWorker) {
        workerCount++;
      } else {
        armyValue += 1; // Could weight by unit cost
      }
    }

    ai.workerCount = workerCount;
    ai.armyValue = armyValue;

    // Determine state based on game conditions
    if (this.isUnderAttack(ai.playerId)) {
      ai.state = 'defending';
    } else if (armyValue >= ai.targetSupply * 0.5) {
      ai.state = 'attacking';
    } else if (workerCount >= 16) {
      ai.state = 'expanding';
    } else {
      ai.state = 'building';
    }
  }

  private isUnderAttack(playerId: string): boolean {
    // Check if any buildings are under attack
    const buildings = this.world.getEntitiesWith('Building', 'Selectable', 'Health');

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;

      // Consider under attack if health is below 80%
      if (health.getHealthPercent() < 0.8) {
        return true;
      }
    }

    return false;
  }

  private executeBuildingPhase(ai: AIPlayer): void {
    // Update AI's resource count by checking what they own
    this.updateAIResources(ai);

    // Priority: Supply > Workers > Barracks > Army

    // Check if supply capped (need supply depot)
    if (ai.supply >= ai.maxSupply - 2 && ai.supplyDepotsBuilding === 0) {
      if (this.tryBuildBuilding(ai, 'supply_depot')) {
        ai.supplyDepotsBuilding++;
        return;
      }
    }

    // Build workers if we have room and need more
    if (ai.workerCount < 16 && ai.supply < ai.maxSupply) {
      if (this.tryTrainUnit(ai, 'scv')) {
        return;
      }
    }

    // Build barracks if we don't have one
    if (!ai.hasBarracks && ai.workerCount >= 10) {
      if (this.tryBuildBuilding(ai, 'barracks')) {
        return;
      }
    }

    // Build army (marines) if we have a barracks
    if (ai.hasBarracks && ai.supply < ai.maxSupply) {
      this.tryTrainUnit(ai, 'marine');
    }
  }

  private executeExpandingPhase(ai: AIPlayer): void {
    // Update resources
    this.updateAIResources(ai);

    // Keep building supply depots
    if (ai.supply >= ai.maxSupply - 2 && ai.supplyDepotsBuilding === 0) {
      if (this.tryBuildBuilding(ai, 'supply_depot')) {
        ai.supplyDepotsBuilding++;
        return;
      }
    }

    // Keep training marines
    if (ai.hasBarracks && ai.supply < ai.maxSupply) {
      this.tryTrainUnit(ai, 'marine');
    }
  }

  private updateAIResources(ai: AIPlayer): void {
    // Count minerals from gathering (simplified: give AI passive income)
    // In a real implementation, we'd track workers on minerals
    const gatherRate = ai.workerCount * 0.8; // ~0.8 minerals per worker per action
    ai.minerals += gatherRate;

    // Cap minerals at reasonable amount
    ai.minerals = Math.min(ai.minerals, 10000);
  }

  private tryTrainUnit(ai: AIPlayer, unitType: string): boolean {
    const unitDef = UNIT_DEFINITIONS[unitType];
    if (!unitDef) return false;

    // Check resources
    if (ai.minerals < unitDef.mineralCost || ai.vespene < unitDef.vespeneCost) {
      return false;
    }

    // Check supply
    if (ai.supply + unitDef.supplyCost > ai.maxSupply) {
      return false;
    }

    // Find a production building
    const buildings = this.world.getEntitiesWith('Building', 'Selectable');

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (!building.isComplete()) continue;
      if (!building.canProduce.includes(unitType)) continue;

      // Check if queue isn't too full
      if (building.productionQueue.length >= 3) continue;

      // Deduct resources
      ai.minerals -= unitDef.mineralCost;
      ai.vespene -= unitDef.vespeneCost;

      // Queue the unit
      building.addToProductionQueue('unit', unitType, unitDef.buildTime);

      return true;
    }

    return false;
  }

  private tryBuildBuilding(ai: AIPlayer, buildingType: string): boolean {
    const buildingDef = BUILDING_DEFINITIONS[buildingType];
    if (!buildingDef) return false;

    // Check resources
    if (ai.minerals < buildingDef.mineralCost || ai.vespene < buildingDef.vespeneCost) {
      return false;
    }

    // Find AI's command center for building near it
    const ccPos = this.findAIBase(ai.playerId);
    if (!ccPos) return false;

    // Find a good spot near the base
    const buildPos = this.findBuildingSpot(ai.playerId, ccPos, buildingDef.width, buildingDef.height);
    if (!buildPos) return false;

    // Deduct resources
    ai.minerals -= buildingDef.mineralCost;
    ai.vespene -= buildingDef.vespeneCost;

    // Place the building
    this.game.eventBus.emit('building:place', {
      buildingType,
      position: buildPos,
      playerId: ai.playerId,
    });

    return true;
  }

  private findAIBase(playerId: string): { x: number; y: number } | null {
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== playerId) continue;
      if (building.buildingId === 'command_center') {
        return { x: transform.x, y: transform.y };
      }
    }

    return null;
  }

  private findBuildingSpot(
    playerId: string,
    basePos: { x: number; y: number },
    width: number,
    height: number
  ): { x: number; y: number } | null {
    // Try positions around the base in a spiral
    const offsets = [
      { x: 8, y: 0 },
      { x: 8, y: 4 },
      { x: 8, y: -4 },
      { x: -8, y: 0 },
      { x: -8, y: 4 },
      { x: -8, y: -4 },
      { x: 0, y: 8 },
      { x: 4, y: 8 },
      { x: 12, y: 0 },
      { x: 12, y: 4 },
    ];

    for (const offset of offsets) {
      const pos = {
        x: basePos.x + offset.x,
        y: basePos.y + offset.y,
      };

      if (this.isValidBuildingSpot(pos.x, pos.y, width, height)) {
        return pos;
      }
    }

    return null;
  }

  private isValidBuildingSpot(x: number, y: number, width: number, height: number): boolean {
    // Check map bounds
    const config = this.game.config;
    if (x < 0 || y < 0 || x + width > config.mapWidth || y + height > config.mapHeight) {
      return false;
    }

    // Check for overlapping buildings
    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;

      if (
        x < transform.x + building.width + 1 &&
        x + width > transform.x - 1 &&
        y < transform.y + building.height + 1 &&
        y + height > transform.y - 1
      ) {
        return false;
      }
    }

    // Check for overlapping resources
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;

      if (
        x < transform.x + 3 &&
        x + width > transform.x - 1 &&
        y < transform.y + 3 &&
        y + height > transform.y - 1
      ) {
        return false;
      }
    }

    return true;
  }

  private executeAttackingPhase(ai: AIPlayer): void {
    // Find enemy base
    const enemyBase = this.findEnemyBase(ai.playerId);
    if (!enemyBase) return;

    // Get all army units
    const armyUnits: number[] = [];
    const entities = this.world.getEntitiesWith('Unit', 'Selectable', 'Health');

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (unit.isWorker) continue;
      if (health.isDead()) continue;

      armyUnits.push(entity.id);
    }

    // Attack move to enemy base
    if (armyUnits.length > 0) {
      const command: GameCommand = {
        tick: this.game.getCurrentTick(),
        playerId: ai.playerId,
        type: 'ATTACK',
        entityIds: armyUnits,
        targetPosition: { x: enemyBase.x, y: enemyBase.y },
      };

      this.game.processCommand(command);
    }
  }

  private executeDefendingPhase(ai: AIPlayer): void {
    // Find base under attack
    const buildings = this.world.getEntitiesWith(
      'Building',
      'Transform',
      'Selectable',
      'Health'
    );

    let defendPoint: { x: number; y: number } | null = null;

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;

      if (health.getHealthPercent() < 0.8) {
        defendPoint = { x: transform.x, y: transform.y };
        break;
      }
    }

    if (!defendPoint) {
      ai.state = 'building';
      return;
    }

    // Rally all units to defend point
    const armyUnits: number[] = [];
    const entities = this.world.getEntitiesWith('Unit', 'Selectable', 'Health');

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;

      armyUnits.push(entity.id);
    }

    if (armyUnits.length > 0) {
      const command: GameCommand = {
        tick: this.game.getCurrentTick(),
        playerId: ai.playerId,
        type: 'ATTACK',
        entityIds: armyUnits,
        targetPosition: defendPoint,
      };

      this.game.processCommand(command);
    }
  }

  private findEnemyBase(playerId: string): { x: number; y: number } | null {
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId === playerId) continue;

      // Found enemy building
      if (['command_center', 'nexus', 'hatchery'].includes(building.buildingId)) {
        return { x: transform.x, y: transform.y };
      }
    }

    // Return any enemy building if no main found
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId === playerId) continue;

      return { x: transform.x, y: transform.y };
    }

    return null;
  }
}

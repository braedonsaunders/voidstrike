import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Game, GameCommand } from '../core/Game';

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
    // Priority: Workers > Supply > Army

    // Check if we need workers
    if (ai.workerCount < 16) {
      this.trainUnit(ai, 'scv');
      return;
    }

    // Check if we need supply
    // TODO: Implement supply check

    // Build army
    this.trainUnit(ai, 'marine');
  }

  private executeExpandingPhase(ai: AIPlayer): void {
    // Build expansion
    // TODO: Implement expansion logic

    // Keep building army
    this.trainUnit(ai, 'marine');
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

  private trainUnit(ai: AIPlayer, unitType: string): void {
    // Find a production building
    const buildings = this.world.getEntitiesWith('Building', 'Selectable');

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (!building.isComplete()) continue;
      if (!building.canProduce.includes(unitType)) continue;

      // Found a valid building, queue unit
      this.game.eventBus.emit('command:train', {
        entityIds: [entity.id],
        unitType,
      });

      return;
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

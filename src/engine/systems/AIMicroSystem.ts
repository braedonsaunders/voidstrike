import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Building } from '../components/Building';
import { Game, GameCommand } from '../core/Game';
import {
  BehaviorTreeRunner,
  createCombatMicroTree,
  calculateThreatScore,
} from '../ai/BehaviorTree';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';

// Configuration
const MICRO_UPDATE_INTERVAL = 5; // Update micro every 5 ticks (250ms at 20 TPS)
const KITE_COOLDOWN_TICKS = 10; // Minimum ticks between kite commands
const THREAT_ASSESSMENT_INTERVAL = 10; // Update threat assessment every 10 ticks
const FOCUS_FIRE_THRESHOLD = 0.7; // Health threshold for focus fire target selection

interface UnitMicroState {
  behaviorTree: BehaviorTreeRunner;
  lastKiteTick: number;
  lastThreatAssessment: number;
  threatScore: number;
  primaryTarget: number | null;
  retreating: boolean;
  retreatEndTick: number | null; // Tick when retreat should end (replaces setTimeout)
}

// Delayed command to be processed at a specific tick
interface DelayedCommand {
  executeTick: number;
  command: GameCommand;
}

interface ThreatInfo {
  entityId: number;
  threatScore: number;
  distance: number;
  healthPercent: number;
  dps: number;
  unitType: string;
}

// Unit priority for focus fire (higher = more important to kill)
const UNIT_PRIORITY: Record<string, number> = {
  devastator: 100,
  colossus: 90,
  lifter: 85,
  specter: 80,
  valkyrie: 75,
  inferno: 70,
  breacher: 65,
  trooper: 60,
  operative: 55,
  vanguard: 50,
  scorcher: 45,
  constructor: 10,
};

export class AIMicroSystem extends System {
  public priority = 95; // Run after EnhancedAISystem but before movement

  private unitStates: Map<number, UnitMicroState> = new Map();
  private aiPlayerIds: Set<string> = new Set();

  // Queue for delayed commands (replaces setTimeout)
  private pendingCommands: DelayedCommand[] = [];

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Track which players are AI-controlled
    this.game.eventBus.on('ai:registered', (data: { playerId: string }) => {
      this.aiPlayerIds.add(data.playerId);
    });

    // Clean up when units die or are destroyed to prevent memory leaks
    this.game.eventBus.on('unit:died', (data: { entityId: number }) => {
      this.unitStates.delete(data.entityId);
      // Also remove any pending commands for this unit
      this.pendingCommands = this.pendingCommands.filter(
        cmd => cmd.command.entityIds[0] !== data.entityId
      );
    });
    this.game.eventBus.on('unit:destroyed', (data: { entityId: number }) => {
      this.unitStates.delete(data.entityId);
      this.pendingCommands = this.pendingCommands.filter(
        cmd => cmd.command.entityIds[0] !== data.entityId
      );
    });
  }

  public registerAIPlayer(playerId: string): void {
    this.aiPlayerIds.add(playerId);
  }

  public update(deltaTime: number): void {
    const currentTick = this.game.getCurrentTick();

    // Process pending delayed commands
    this.processPendingCommands(currentTick);

    // Process retreat state timeouts (tick-based instead of setTimeout)
    this.processRetreatTimeouts(currentTick);

    // Only update micro at intervals to reduce CPU load
    if (currentTick % MICRO_UPDATE_INTERVAL !== 0) return;

    const entities = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;

      // Only micro AI-controlled units
      if (!this.aiPlayerIds.has(selectable.playerId)) continue;

      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;

      // Skip dead units, workers, and idle units
      if (health.isDead()) continue;
      if (unit.isWorker) continue;
      if (unit.state !== 'attacking' && unit.state !== 'moving') continue;

      // Get or create micro state
      let state = this.unitStates.get(entity.id);
      if (!state) {
        state = {
          behaviorTree: new BehaviorTreeRunner(createCombatMicroTree()),
          lastKiteTick: 0,
          lastThreatAssessment: 0,
          threatScore: 0,
          primaryTarget: null,
          retreating: false,
          retreatEndTick: null,
        };
        this.unitStates.set(entity.id, state);
      }

      // Run behavior tree
      const status = state.behaviorTree.tick(
        entity.id,
        this.world,
        this.game,
        deltaTime
      );

      // Handle kiting with cooldown
      const shouldKite = state.behaviorTree.getBlackboard<boolean>('shouldKite');
      if (shouldKite && currentTick - state.lastKiteTick > KITE_COOLDOWN_TICKS) {
        this.executeKiting(entity.id, state, currentTick);
      }

      // Handle retreat
      const shouldRetreat = state.behaviorTree.getBlackboard<boolean>('shouldRetreat');
      if (shouldRetreat && !state.retreating) {
        this.executeRetreat(entity.id, selectable.playerId, state);
      }

      // Update threat assessment periodically
      if (currentTick - state.lastThreatAssessment > THREAT_ASSESSMENT_INTERVAL) {
        this.updateThreatAssessment(entity.id, state, currentTick);
      }

      // Focus fire logic
      if (unit.state === 'attacking') {
        this.handleFocusFire(entity.id, selectable.playerId, unit, state);
      }
    }
  }

  private executeKiting(entityId: number, state: UnitMicroState, currentTick: number): void {
    const entity = this.world.getEntity(entityId);
    if (!entity) return;

    const unit = entity.get<Unit>('Unit')!;
    const transform = entity.get<Transform>('Transform')!;

    const kiteFromX = state.behaviorTree.getBlackboard<number>('kiteFromX');
    const kiteFromY = state.behaviorTree.getBlackboard<number>('kiteFromY');

    if (kiteFromX === undefined || kiteFromY === undefined) return;

    // Calculate kite direction
    const dx = transform.x - kiteFromX;
    const dy = transform.y - kiteFromY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 0.1) return;

    const kiteDistance = unit.attackRange * 0.6;
    let targetX = transform.x + (dx / distance) * kiteDistance;
    let targetY = transform.y + (dy / distance) * kiteDistance;

    // Clamp to map bounds
    targetX = Math.max(2, Math.min(this.game.config.mapWidth - 2, targetX));
    targetY = Math.max(2, Math.min(this.game.config.mapHeight - 2, targetY));

    // Save target BEFORE move command clears it
    const savedTargetId = unit.targetEntityId;
    const playerId = entity.get<Selectable>('Selectable')!.playerId;

    // Issue move command (this clears targetEntityId)
    const command: GameCommand = {
      tick: currentTick,
      playerId,
      type: 'MOVE',
      entityIds: [entityId],
      targetPosition: { x: targetX, y: targetY },
    };

    this.game.processCommand(command);
    state.lastKiteTick = currentTick;

    // Re-target after kiting using the saved target ID
    // Use tick-based delay instead of setTimeout (5 ticks = 250ms at 20 TPS)
    if (savedTargetId !== null) {
      const retargetCommand: GameCommand = {
        tick: currentTick + 5,
        playerId,
        type: 'ATTACK',
        entityIds: [entityId],
        targetEntityId: savedTargetId,
      };
      // Queue command for execution at specific tick
      this.pendingCommands.push({
        executeTick: currentTick + 5,
        command: retargetCommand,
      });
    }
  }

  private executeRetreat(entityId: number, playerId: string, state: UnitMicroState): void {
    const entity = this.world.getEntity(entityId);
    if (!entity) return;

    const transform = entity.get<Transform>('Transform')!;

    // Find friendly base to retreat to
    const basePosition = this.findFriendlyBase(playerId);
    if (!basePosition) return;

    // Calculate retreat direction (towards base)
    const dx = basePosition.x - transform.x;
    const dy = basePosition.y - transform.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 10) {
      // Already near base
      state.retreating = false;
      return;
    }

    const retreatDistance = Math.min(15, distance);
    const targetX = transform.x + (dx / distance) * retreatDistance;
    const targetY = transform.y + (dy / distance) * retreatDistance;

    const command: GameCommand = {
      tick: this.game.getCurrentTick(),
      playerId,
      type: 'MOVE',
      entityIds: [entityId],
      targetPosition: { x: targetX, y: targetY },
    };

    this.game.processCommand(command);
    state.retreating = true;

    // Set tick when retreat should end (40 ticks = 2000ms at 20 TPS)
    // This replaces setTimeout with tick-based timing
    state.retreatEndTick = this.game.getCurrentTick() + 40;
  }

  /**
   * Process pending delayed commands (replaces setTimeout)
   */
  private processPendingCommands(currentTick: number): void {
    // Process all commands that are due
    let i = 0;
    while (i < this.pendingCommands.length) {
      const pending = this.pendingCommands[i];
      if (pending.executeTick <= currentTick) {
        // Verify the entity still exists before executing
        const entityId = pending.command.entityIds[0];
        const entity = this.world.getEntity(entityId);
        if (entity && !entity.isDestroyed()) {
          this.game.processCommand(pending.command);
        }
        // Remove from queue (swap with last for O(1) removal)
        this.pendingCommands[i] = this.pendingCommands[this.pendingCommands.length - 1];
        this.pendingCommands.pop();
      } else {
        i++;
      }
    }
  }

  /**
   * Process retreat state timeouts (replaces setTimeout)
   */
  private processRetreatTimeouts(currentTick: number): void {
    for (const [entityId, state] of this.unitStates) {
      if (state.retreating && state.retreatEndTick !== null && currentTick >= state.retreatEndTick) {
        state.retreating = false;
        state.retreatEndTick = null;
        state.behaviorTree.setBlackboard('shouldRetreat', false);
      }
    }
  }

  private findFriendlyBase(playerId: string): { x: number; y: number } | null {
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable');

    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      if (selectable.playerId !== playerId) continue;

      if (building.buildingId === 'headquarters' || building.buildingId === 'orbital_station') {
        return { x: transform.x, y: transform.y };
      }
    }

    return null;
  }

  private updateThreatAssessment(
    entityId: number,
    state: UnitMicroState,
    currentTick: number
  ): void {
    const entity = this.world.getEntity(entityId);
    if (!entity) return;

    const transform = entity.get<Transform>('Transform')!;
    const unit = entity.get<Unit>('Unit')!;
    const mySelectable = entity.get<Selectable>('Selectable')!;

    const threats: ThreatInfo[] = [];
    const threatRange = unit.sightRange * 1.2;

    const nearbyUnits = this.world.unitGrid.queryRadius(
      transform.x,
      transform.y,
      threatRange
    );

    for (const nearbyId of nearbyUnits) {
      if (nearbyId === entityId) continue;

      const nearbyEntity = this.world.getEntity(nearbyId);
      if (!nearbyEntity) continue;

      const nearbyUnit = nearbyEntity.get<Unit>('Unit');
      const nearbyTransform = nearbyEntity.get<Transform>('Transform');
      const nearbySelectable = nearbyEntity.get<Selectable>('Selectable');
      const nearbyHealth = nearbyEntity.get<Health>('Health');

      if (!nearbyUnit || !nearbyTransform || !nearbySelectable || !nearbyHealth) continue;

      // Only assess enemies
      if (nearbySelectable.playerId === mySelectable.playerId) continue;
      if (nearbyHealth.isDead()) continue;

      const dx = nearbyTransform.x - transform.x;
      const dy = nearbyTransform.y - transform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const dps = nearbyUnit.attackDamage * nearbyUnit.attackSpeed;
      const priority = UNIT_PRIORITY[nearbyUnit.unitId] || 50;
      const healthPercent = nearbyHealth.getHealthPercent();

      // Threat score calculation
      const distanceFactor = Math.max(0, 1 - distance / threatRange);
      const damageFactor = dps / 20;
      const priorityFactor = priority / 100;
      const healthFactor = 1 + (1 - healthPercent); // Damaged units are higher threat (about to die, focus)

      const threatScore = (damageFactor + priorityFactor) * distanceFactor * healthFactor;

      threats.push({
        entityId: nearbyId,
        threatScore,
        distance,
        healthPercent,
        dps,
        unitType: nearbyUnit.unitId,
      });
    }

    // Sort by threat score
    threats.sort((a, b) => b.threatScore - a.threatScore);

    // Store top threat
    state.threatScore = threats.length > 0 ? threats[0].threatScore : 0;
    state.primaryTarget = threats.length > 0 ? threats[0].entityId : null;
    state.lastThreatAssessment = currentTick;

    // Store in blackboard for behavior tree
    state.behaviorTree.setBlackboard('threats', threats);
    state.behaviorTree.setBlackboard('threatScore', state.threatScore);
  }

  private handleFocusFire(
    entityId: number,
    playerId: string,
    unit: Unit,
    state: UnitMicroState
  ): void {
    // Only switch targets if current target is invalid or better target available
    if (unit.targetEntityId !== null) {
      const currentTarget = this.world.getEntity(unit.targetEntityId);
      if (currentTarget) {
        const health = currentTarget.get<Health>('Health');
        if (health && !health.isDead()) {
          // Current target is valid
          const healthPercent = health.getHealthPercent();

          // If current target is low health, keep focusing it
          if (healthPercent < FOCUS_FIRE_THRESHOLD) {
            return;
          }

          // Check if there's a better target
          if (state.primaryTarget !== null && state.primaryTarget !== unit.targetEntityId) {
            const betterTarget = this.world.getEntity(state.primaryTarget);
            if (betterTarget) {
              const betterHealth = betterTarget.get<Health>('Health');
              if (betterHealth && !betterHealth.isDead()) {
                // Switch to better target if it's significantly better
                const betterHealthPercent = betterHealth.getHealthPercent();
                if (betterHealthPercent < healthPercent - 0.2) {
                  this.switchTarget(entityId, playerId, state.primaryTarget);
                }
              }
            }
          }
          return;
        }
      }
    }

    // No valid target, acquire new one
    if (state.primaryTarget !== null) {
      this.switchTarget(entityId, playerId, state.primaryTarget);
    }
  }

  private switchTarget(entityId: number, playerId: string, targetId: number): void {
    const command: GameCommand = {
      tick: this.game.getCurrentTick(),
      playerId,
      type: 'ATTACK',
      entityIds: [entityId],
      targetEntityId: targetId,
    };
    this.game.processCommand(command);
  }
}

// ==================== COUNTER-BUILDING LOGIC ====================

export interface EnemyComposition {
  infantry: number;
  vehicles: number;
  air: number;
  workers: number;
  total: number;
}

export interface CounterRecommendation {
  unitsToBuild: Array<{ unitId: string; priority: number }>;
  buildingsToBuild: Array<{ buildingId: string; priority: number }>;
}

// Counter matrix: what counters what
const COUNTER_MATRIX: Record<string, string[]> = {
  // Air units counter ground-heavy compositions
  trooper: ['scorcher', 'inferno', 'devastator'],
  breacher: ['trooper', 'scorcher'],
  scorcher: ['devastator', 'colossus'],
  inferno: ['trooper', 'breacher'],
  devastator: ['valkyrie', 'specter', 'trooper'],
  colossus: ['trooper', 'breacher', 'devastator'],
  valkyrie: ['trooper', 'colossus'],
  lifter: ['trooper', 'valkyrie'],
  specter: ['trooper', 'valkyrie', 'colossus'],
};

export function analyzeEnemyComposition(
  world: import('../ecs/World').World,
  myPlayerId: string
): EnemyComposition {
  const composition: EnemyComposition = {
    infantry: 0,
    vehicles: 0,
    air: 0,
    workers: 0,
    total: 0,
  };

  const units = world.getEntitiesWith('Unit', 'Selectable', 'Health');

  for (const entity of units) {
    const unit = entity.get<Unit>('Unit')!;
    const selectable = entity.get<Selectable>('Selectable')!;
    const health = entity.get<Health>('Health')!;

    if (selectable.playerId === myPlayerId) continue;
    if (health.isDead()) continue;

    const def = UNIT_DEFINITIONS[unit.unitId];
    if (!def) continue;

    composition.total++;

    if (unit.isWorker) {
      composition.workers++;
    } else if (unit.isFlying) {
      composition.air++;
    } else if (def.isMechanical) {
      composition.vehicles++;
    } else {
      composition.infantry++;
    }
  }

  return composition;
}

export function getCounterRecommendation(
  world: import('../ecs/World').World,
  myPlayerId: string,
  myBuildingCounts: Map<string, number>
): CounterRecommendation {
  const enemyComp = analyzeEnemyComposition(world, myPlayerId);
  const recommendation: CounterRecommendation = {
    unitsToBuild: [],
    buildingsToBuild: [],
  };

  // Heavy air -> Build valkyries, colossus, troopers
  if (enemyComp.air > enemyComp.total * 0.3) {
    recommendation.unitsToBuild.push({ unitId: 'valkyrie', priority: 10 });
    recommendation.unitsToBuild.push({ unitId: 'trooper', priority: 8 });
    recommendation.unitsToBuild.push({ unitId: 'colossus', priority: 7 });

    if (!myBuildingCounts.get('hangar')) {
      recommendation.buildingsToBuild.push({ buildingId: 'hangar', priority: 10 });
    }
  }

  // Heavy vehicles -> Build devastators, breachers
  if (enemyComp.vehicles > enemyComp.total * 0.4) {
    recommendation.unitsToBuild.push({ unitId: 'devastator', priority: 10 });
    recommendation.unitsToBuild.push({ unitId: 'breacher', priority: 8 });

    if (!myBuildingCounts.get('forge')) {
      recommendation.buildingsToBuild.push({ buildingId: 'forge', priority: 10 });
    }
  }

  // Heavy infantry -> Build scorchers, infernos
  if (enemyComp.infantry > enemyComp.total * 0.5) {
    recommendation.unitsToBuild.push({ unitId: 'scorcher', priority: 9 });
    recommendation.unitsToBuild.push({ unitId: 'inferno', priority: 8 });
    recommendation.unitsToBuild.push({ unitId: 'devastator', priority: 7 });
  }

  // Balanced -> Mixed composition
  if (recommendation.unitsToBuild.length === 0) {
    recommendation.unitsToBuild.push({ unitId: 'trooper', priority: 7 });
    recommendation.unitsToBuild.push({ unitId: 'breacher', priority: 6 });
    recommendation.unitsToBuild.push({ unitId: 'lifter', priority: 5 });
  }

  // Sort by priority
  recommendation.unitsToBuild.sort((a, b) => b.priority - a.priority);
  recommendation.buildingsToBuild.sort((a, b) => b.priority - a.priority);

  return recommendation;
}

import { System } from '../ecs/System';
import { World } from '../ecs/World';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Building } from '../components/Building';
import { Game, GameCommand } from '../core/Game';
import { distance, clamp } from '@/utils/math';
import { BehaviorTreeRunner, Blackboard, globalBlackboard } from '../ai/BehaviorTree';
import {
  createCombatMicroTree,
  createRangedCombatTree,
  createMeleeCombatTree,
  createUtilityCombatTree,
  isRangedUnit,
  UnitBehaviorType,
  createBehaviorTree,
} from '../ai/UnitBehaviors';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
// Import data-driven AI configuration for micro behavior
import { DOMINION_AI_CONFIG } from '@/data/ai/factions/dominion';
// Import AI Worker Manager for off-thread micro decisions
import { AIWorkerManager, MicroDecision } from '../ai/AIWorkerManager';

// Configuration - now uses data-driven config where available
// PERF: Increased from 5 to 8 ticks (400ms at 20 TPS) to reduce behavior tree evaluation frequency
const MICRO_UPDATE_INTERVAL = DOMINION_AI_CONFIG.micro.global.updateInterval;
const KITE_COOLDOWN_TICKS = 10; // Will be per-unit from config.micro.unitBehaviors
const THREAT_ASSESSMENT_INTERVAL = DOMINION_AI_CONFIG.micro.global.threatUpdateInterval;
const FOCUS_FIRE_THRESHOLD = DOMINION_AI_CONFIG.micro.global.focusFireThreshold;
const TRANSFORM_DECISION_INTERVAL = 20; // Update transform decision every 20 ticks (1 second at 20 TPS)
const TRANSFORM_SCAN_RANGE = 15; // Range to scan for potential targets when deciding to transform

interface UnitMicroState {
  behaviorTree: BehaviorTreeRunner;
  lastKiteTick: number;
  lastThreatAssessment: number;
  lastTransformDecision: number; // Tick when last transform decision was made
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

// Unit priority for focus fire (higher = more important to kill) - from data-driven config
const UNIT_PRIORITY: Record<string, number> = DOMINION_AI_CONFIG.tactical.unitPriorities;

export class AIMicroSystem extends System {
  public readonly name = 'AIMicroSystem';
  // Priority is set by SystemRegistry based on dependencies (runs after EnhancedAISystem, CombatSystem)

  private unitStates: Map<number, UnitMicroState> = new Map();
  private aiPlayerIds: Set<string> = new Set();

  // Queue for delayed commands (replaces setTimeout)
  private pendingCommands: DelayedCommand[] = [];

  // Web Worker for off-thread micro decisions
  private workerManager: AIWorkerManager;
  private useWorker: boolean = true; // Can be disabled for debugging

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
    // PERF: Set game instance for cache tick tracking
    setAnalysisCacheGameInstance(game);
    // Initialize worker manager
    this.workerManager = AIWorkerManager.getInstance(game);
  }

  public init(world: World): void {
    super.init(world);
    // Set world reference in worker manager
    this.workerManager.setWorld(world);
  }

  private setupEventListeners(): void {
    // Track which players are AI-controlled
    this.game.eventBus.on('ai:registered', (data: { playerId: string }) => {
      this.aiPlayerIds.add(data.playerId);
      this.workerManager.registerAIPlayer(data.playerId);
    });

    // Clean up when units die or are destroyed to prevent memory leaks
    this.game.eventBus.on('unit:died', (data: { entityId: number }) => {
      this.unitStates.delete(data.entityId);
      // PERF: Use splice instead of filter to avoid array allocation per unit death
      this.removeCommandsForEntity(data.entityId);
    });
    this.game.eventBus.on('unit:destroyed', (data: { entityId: number }) => {
      this.unitStates.delete(data.entityId);
      // PERF: Use splice instead of filter to avoid array allocation per unit death
      this.removeCommandsForEntity(data.entityId);
    });
  }

  /**
   * PERF: Remove commands for entity using splice instead of filter (avoids array allocation)
   */
  private removeCommandsForEntity(entityId: number): void {
    for (let i = this.pendingCommands.length - 1; i >= 0; i--) {
      if (this.pendingCommands[i].command.entityIds[0] === entityId) {
        this.pendingCommands.splice(i, 1);
      }
    }
  }

  public registerAIPlayer(playerId: string): void {
    this.aiPlayerIds.add(playerId);
    this.workerManager.registerAIPlayer(playerId);
  }

  /**
   * Select the appropriate behavior tree type based on unit characteristics
   */
  private selectBehaviorType(unit: Unit): UnitBehaviorType {
    // Workers use worker behavior
    if (unit.isWorker) {
      return 'worker';
    }

    // Flying units - use utility-based decision making
    if (unit.isFlying) {
      return 'utility';
    }

    // Ranged units (attack range >= 3) use ranged combat with kiting
    if (unit.attackRange >= 3) {
      return 'ranged_combat';
    }

    // Melee units use aggressive melee combat
    if (unit.attackRange < 3) {
      return 'melee_combat';
    }

    // Default to standard combat
    return 'combat';
  }

  public update(deltaTime: number): void {
    const currentTick = this.game.getCurrentTick();

    // Process pending delayed commands
    this.processPendingCommands(currentTick);

    // Process retreat state timeouts (tick-based instead of setTimeout)
    this.processRetreatTimeouts(currentTick);

    // Only update micro at intervals to reduce CPU load
    if (currentTick % MICRO_UPDATE_INTERVAL !== 0) return;

    // Try to use worker for micro decisions
    if (this.useWorker && this.workerManager.isWorkerReady()) {
      this.updateWithWorker(deltaTime, currentTick);
    } else {
      // Fallback to main thread
      this.updateMainThread(deltaTime, currentTick);
    }
  }

  /**
   * Update micro AI using worker (non-blocking)
   */
  private updateWithWorker(deltaTime: number, currentTick: number): void {
    // Request micro decisions for each AI player
    for (const playerId of this.aiPlayerIds) {
      // Fire-and-forget request (non-blocking)
      this.workerManager.requestMicroDecisionsAsync(playerId);

      // Get cached decisions (may be from previous tick)
      const decisions = this.workerManager.getCachedMicroDecisions(playerId);
      if (decisions) {
        this.applyWorkerDecisions(playerId, decisions, currentTick);
      }
    }

    // Still need to run behavior trees for state management (reduced scope)
    // Worker handles: kiting, focus fire, retreat, transform
    // Main thread handles: behavior tree state, unit state tracking
    this.updateBehaviorTreeStates(deltaTime, currentTick);
  }

  /**
   * Apply micro decisions from worker
   */
  private applyWorkerDecisions(playerId: string, decisions: MicroDecision[], currentTick: number): void {
    for (const decision of decisions) {
      if (decision.action === 'none') continue;

      const entity = this.world.getEntity(decision.unitId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      // Get or create micro state for tracking
      let state = this.unitStates.get(decision.unitId);
      if (!state) {
        const behaviorType = this.selectBehaviorType(unit);
        const tree = createBehaviorTree(behaviorType);
        const selectable = entity.get<Selectable>('Selectable');
        const playerBlackboard = globalBlackboard.getScope(`player_${selectable?.playerId}`);

        state = {
          behaviorTree: new BehaviorTreeRunner(tree, playerBlackboard),
          lastKiteTick: 0,
          lastThreatAssessment: currentTick,
          lastTransformDecision: 0,
          threatScore: decision.threatScore,
          primaryTarget: decision.targetId ?? null,
          retreating: false,
          retreatEndTick: null,
        };
        this.unitStates.set(decision.unitId, state);
      }

      // Update threat info from worker
      state.threatScore = decision.threatScore;
      state.primaryTarget = decision.targetId ?? null;
      state.lastThreatAssessment = currentTick;

      switch (decision.action) {
        case 'attack':
          if (decision.targetId !== undefined) {
            const command: GameCommand = {
              tick: currentTick,
              playerId,
              type: 'ATTACK',
              entityIds: [decision.unitId],
              targetEntityId: decision.targetId,
            };
            this.game.processCommand(command);
          }
          break;

        case 'kite':
          if (decision.targetPosition && currentTick - state.lastKiteTick > KITE_COOLDOWN_TICKS) {
            // Save target before kiting
            const savedTargetId = decision.targetId;

            const moveCommand: GameCommand = {
              tick: currentTick,
              playerId,
              type: 'MOVE',
              entityIds: [decision.unitId],
              targetPosition: decision.targetPosition,
            };
            this.game.processCommand(moveCommand);
            state.lastKiteTick = currentTick;

            // Re-target after kiting (5 ticks delay)
            if (savedTargetId !== undefined) {
              const retargetCommand: GameCommand = {
                tick: currentTick + 5,
                playerId,
                type: 'ATTACK',
                entityIds: [decision.unitId],
                targetEntityId: savedTargetId,
              };
              this.pendingCommands.push({
                executeTick: currentTick + 5,
                command: retargetCommand,
              });
            }
          }
          break;

        case 'retreat':
          if (!state.retreating && decision.targetPosition) {
            const command: GameCommand = {
              tick: currentTick,
              playerId,
              type: 'MOVE',
              entityIds: [decision.unitId],
              targetPosition: decision.targetPosition,
            };
            this.game.processCommand(command);
            state.retreating = true;
            state.retreatEndTick = currentTick + 40; // 2 seconds
          }
          break;

        case 'transform':
          if (decision.targetMode) {
            state.lastTransformDecision = currentTick;
            const command: GameCommand = {
              tick: currentTick,
              playerId,
              type: 'TRANSFORM',
              entityIds: [decision.unitId],
              targetMode: decision.targetMode,
            };
            this.game.processCommand(command);
          }
          break;
      }
    }
  }

  /**
   * Update behavior tree states (reduced scope when using worker)
   */
  private updateBehaviorTreeStates(deltaTime: number, currentTick: number): void {
    const entities = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable');
      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');
      if (!selectable || !unit || !health) continue;

      // Only process AI-controlled units
      if (!this.aiPlayerIds.has(selectable.playerId)) continue;

      // Skip dead units and workers
      if (health.isDead()) continue;
      if (unit.isWorker) continue;

      // Process units in combat-related states
      // RTS-STYLE: Also process idle units in assault mode - they need micro to find targets
      const canProcessUnit = unit.state === 'attacking' || unit.state === 'moving' ||
        unit.state === 'attackmoving' || (unit.canTransform && unit.state === 'idle') ||
        (unit.isInAssaultMode && unit.state === 'idle');
      if (!canProcessUnit) continue;

      // Get or create micro state
      let state = this.unitStates.get(entity.id);
      if (!state) {
        const behaviorType = this.selectBehaviorType(unit);
        const tree = createBehaviorTree(behaviorType);
        const playerBlackboard = globalBlackboard.getScope(`player_${selectable.playerId}`);

        state = {
          behaviorTree: new BehaviorTreeRunner(tree, playerBlackboard),
          lastKiteTick: 0,
          lastThreatAssessment: 0,
          lastTransformDecision: 0,
          threatScore: 0,
          primaryTarget: null,
          retreating: false,
          retreatEndTick: null,
        };
        this.unitStates.set(entity.id, state);
      }

      // Run behavior tree for state management only (worker handles actions)
      state.behaviorTree.tick(entity.id, this.world, this.game, deltaTime);
    }
  }

  /**
   * Main thread fallback for micro AI
   */
  private updateMainThread(deltaTime: number, currentTick: number): void {
    const entities = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable');
      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');
      if (!selectable || !unit || !health) continue;

      // Only micro AI-controlled units
      if (!this.aiPlayerIds.has(selectable.playerId)) continue;

      // Skip dead units and workers
      if (health.isDead()) continue;
      if (unit.isWorker) continue;

      // Process units in combat-related states
      // attackmoving = moving to position while engaging enemies along the way
      // RTS-STYLE: Also process idle units in assault mode - they need micro to find targets
      const canProcessUnit = unit.state === 'attacking' || unit.state === 'moving' ||
        unit.state === 'attackmoving' || (unit.canTransform && unit.state === 'idle') ||
        (unit.isInAssaultMode && unit.state === 'idle');
      if (!canProcessUnit) continue;

      // Get or create micro state
      let state = this.unitStates.get(entity.id);
      if (!state) {
        // Select behavior tree based on unit type
        const behaviorType = this.selectBehaviorType(unit);
        const tree = createBehaviorTree(behaviorType);

        // Create runner with shared blackboard scope for focus fire coordination
        const playerBlackboard = globalBlackboard.getScope(`player_${selectable.playerId}`);

        state = {
          behaviorTree: new BehaviorTreeRunner(tree, playerBlackboard),
          lastKiteTick: 0,
          lastThreatAssessment: 0,
          lastTransformDecision: 0,
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
      const shouldKite = state.behaviorTree.get<boolean>('shouldKite');
      if (shouldKite && currentTick - state.lastKiteTick > KITE_COOLDOWN_TICKS) {
        this.executeKiting(entity.id, state, currentTick);
      }

      // Handle retreat
      const shouldRetreat = state.behaviorTree.get<boolean>('shouldRetreat');
      if (shouldRetreat && !state.retreating) {
        this.executeRetreat(entity.id, selectable.playerId, state);
      }

      // Update threat assessment periodically
      if (currentTick - state.lastThreatAssessment > THREAT_ASSESSMENT_INTERVAL) {
        this.updateThreatAssessment(entity.id, state, currentTick);
      }

      // Transform decision for units like Valkyrie
      if (unit.canTransform && currentTick - state.lastTransformDecision > TRANSFORM_DECISION_INTERVAL) {
        this.handleTransformDecision(entity.id, selectable.playerId, unit, state, currentTick);
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

    const kiteFromX = state.behaviorTree.get<number>('kiteFromX');
    const kiteFromY = state.behaviorTree.get<number>('kiteFromY');

    if (kiteFromX === undefined || kiteFromY === undefined) return;

    // Calculate kite direction
    const dx = transform.x - kiteFromX;
    const dy = transform.y - kiteFromY;
    const dist = distance(kiteFromX, kiteFromY, transform.x, transform.y);

    if (dist < 0.1) return;

    const kiteDistance = unit.attackRange * 0.6;
    let targetX = transform.x + (dx / dist) * kiteDistance;
    let targetY = transform.y + (dy / dist) * kiteDistance;

    // Clamp to map bounds
    targetX = clamp(targetX, 2, this.game.config.mapWidth - 2);
    targetY = clamp(targetY, 2, this.game.config.mapHeight - 2);

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
    if (!basePosition) {
      // No base to retreat to - clear retreat state to prevent stuck units
      state.retreating = false;
      state.retreatEndTick = null;
      return;
    }

    // Calculate retreat direction (towards base)
    const dx = basePosition.x - transform.x;
    const dy = basePosition.y - transform.y;
    const dist = distance(transform.x, transform.y, basePosition.x, basePosition.y);

    if (dist < 10) {
      // Already near base
      state.retreating = false;
      return;
    }

    const retreatDistance = Math.min(15, dist);
    const targetX = transform.x + (dx / dist) * retreatDistance;
    const targetY = transform.y + (dy / dist) * retreatDistance;

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
        state.behaviorTree.set('shouldRetreat', false);
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

    // PERF: Track max threat in single pass instead of sorting entire array
    let maxThreatScore = 0;
    let maxThreatEntityId: number | null = null;

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

      // Skip targets this unit can't actually attack (air/ground mismatch)
      const targetIsFlying = nearbyUnit.isFlying;
      if (!unit.canAttackTarget(targetIsFlying)) continue;

      const dist = distance(transform.x, transform.y, nearbyTransform.x, nearbyTransform.y);

      const dps = nearbyUnit.attackDamage * nearbyUnit.attackSpeed;
      const priority = UNIT_PRIORITY[nearbyUnit.unitId] || 50;
      const healthPercent = nearbyHealth.getHealthPercent();

      // Threat score calculation using data-driven weights from config
      const threatWeights = DOMINION_AI_CONFIG.tactical.threatWeights;
      const distanceFactor = Math.max(0, 1 - dist / threatRange) * threatWeights.distance;
      const damageFactor = (dps / 20) * threatWeights.damage;
      const priorityFactor = (priority / 100) * threatWeights.priority;
      const healthFactor = (1 + (1 - healthPercent)) * threatWeights.health;

      const threatScore = (damageFactor + priorityFactor) * distanceFactor * healthFactor;

      // PERF: Track max in single pass - O(n) instead of O(n log n) sort
      if (threatScore > maxThreatScore) {
        maxThreatScore = threatScore;
        maxThreatEntityId = nearbyId;
      }

      threats.push({
        entityId: nearbyId,
        threatScore,
        distance: dist,
        healthPercent,
        dps,
        unitType: nearbyUnit.unitId,
      });
    }

    // PERF: Use tracked max instead of sorting - avoids O(n log n) sort
    state.threatScore = maxThreatScore;
    state.primaryTarget = maxThreatEntityId;
    state.lastThreatAssessment = currentTick;

    // Store in blackboard for behavior tree (unsorted - behavior tree can sort if needed)
    state.behaviorTree.set('threats', threats);
    state.behaviorTree.set('threatScore', state.threatScore);
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

  /**
   * Handle transform decision for units like Valkyrie.
   * Decides whether to transform based on nearby enemy composition:
   * - Fighter mode (air): Can only attack air units
   * - Assault mode (ground): Can only attack ground units
   */
  private handleTransformDecision(
    entityId: number,
    playerId: string,
    unit: Unit,
    state: UnitMicroState,
    currentTick: number
  ): void {
    // Mark that we've made a decision this tick
    state.lastTransformDecision = currentTick;

    // Don't transform if already transforming
    if (unit.state === 'transforming') return;

    const entity = this.world.getEntity(entityId);
    if (!entity) return;

    const transform = entity.get<Transform>('Transform');
    if (!transform) return;

    // Count nearby enemy units by air/ground status
    let nearbyAirEnemies = 0;
    let nearbyGroundEnemies = 0;
    let airThreatScore = 0;
    let groundThreatScore = 0;

    const nearbyUnits = this.world.unitGrid.queryRadius(
      transform.x,
      transform.y,
      TRANSFORM_SCAN_RANGE
    );

    for (const nearbyId of nearbyUnits) {
      if (nearbyId === entityId) continue;

      const nearbyEntity = this.world.getEntity(nearbyId);
      if (!nearbyEntity) continue;

      const nearbyUnit = nearbyEntity.get<Unit>('Unit');
      const nearbySelectable = nearbyEntity.get<Selectable>('Selectable');
      const nearbyHealth = nearbyEntity.get<Health>('Health');
      const nearbyTransform = nearbyEntity.get<Transform>('Transform');

      if (!nearbyUnit || !nearbySelectable || !nearbyHealth || !nearbyTransform) continue;

      // Only consider enemies
      if (nearbySelectable.playerId === playerId) continue;
      if (nearbyHealth.isDead()) continue;

      // Calculate distance for weighting
      const dist = distance(transform.x, transform.y, nearbyTransform.x, nearbyTransform.y);
      const distanceWeight = Math.max(0, 1 - dist / TRANSFORM_SCAN_RANGE);

      // Calculate threat score (damage potential)
      const dps = nearbyUnit.attackDamage * nearbyUnit.attackSpeed;
      const threatScore = dps * distanceWeight;

      if (nearbyUnit.isFlying) {
        nearbyAirEnemies++;
        airThreatScore += threatScore;
      } else {
        nearbyGroundEnemies++;
        groundThreatScore += threatScore;
      }
    }

    // Determine current mode capabilities
    const currentMode = unit.getCurrentMode();
    if (!currentMode) return;

    const isInFighterMode = currentMode.isFlying === true; // Fighter mode = flying
    const isInAssaultMode = !isInFighterMode; // Assault mode = ground

    // Decision logic:
    // - In Fighter mode (air-only attacks): Transform to Assault if there are ground enemies and no air enemies
    // - In Assault mode (ground-only attacks): Transform to Fighter if there are air enemies and no ground enemies
    // - Also consider threat scores for more nuanced decisions

    let shouldTransform = false;
    let targetMode = '';

    if (isInFighterMode) {
      // Currently in Fighter mode (can only attack air)
      // Transform to Assault if:
      // 1. There are ground enemies nearby AND no air enemies nearby
      // 2. OR ground threat score significantly outweighs air threat score
      if (nearbyGroundEnemies > 0 && nearbyAirEnemies === 0) {
        shouldTransform = true;
        targetMode = 'assault';
      } else if (nearbyGroundEnemies > 0 && groundThreatScore > airThreatScore * 2) {
        // Ground threat is much higher than air threat - might want to transform
        // But only if there are no immediate air threats
        if (nearbyAirEnemies <= 1 && nearbyGroundEnemies >= 3) {
          shouldTransform = true;
          targetMode = 'assault';
        }
      }
    } else if (isInAssaultMode) {
      // Currently in Assault mode (can only attack ground)
      // Transform to Fighter if:
      // 1. There are air enemies nearby AND no ground enemies nearby
      // 2. OR air threat score significantly outweighs ground threat score
      // 3. OR being attacked by air and can't fight back
      if (nearbyAirEnemies > 0 && nearbyGroundEnemies === 0) {
        shouldTransform = true;
        targetMode = 'fighter';
      } else if (nearbyAirEnemies > 0 && airThreatScore > groundThreatScore * 2) {
        // Air threat is much higher than ground threat
        if (nearbyGroundEnemies <= 1 && nearbyAirEnemies >= 2) {
          shouldTransform = true;
          targetMode = 'fighter';
        }
      }
    }

    // Execute transform if decided
    if (shouldTransform && targetMode) {
      const command: GameCommand = {
        tick: currentTick,
        playerId,
        type: 'TRANSFORM',
        entityIds: [entityId],
        targetMode,
      };
      this.game.processCommand(command);
    }
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

export interface ThreatAnalysis {
  // Number of enemy air units attacking our units that can't fight back
  uncounterableAirThreats: number;
  // Number of our units being attacked by air they can't hit
  unitsUnderAirAttack: number;
  // Do we have ANY units that can attack air?
  hasAntiAir: boolean;
  // Number of anti-air capable units we have
  antiAirUnitCount: number;
}

export interface CounterRecommendation {
  unitsToBuild: Array<{ unitId: string; priority: number }>;
  buildingsToBuild: Array<{ buildingId: string; priority: number }>;
}

// Counter matrix: what counters what - from data-driven config
const COUNTER_MATRIX: Record<string, string[]> = DOMINION_AI_CONFIG.tactical.counterMatrix;

// PERF: Cache for enemy composition analysis (avoids O(n) scan every AI decision)
const COMPOSITION_CACHE_DURATION = 40; // Ticks before cache expires
const compositionCache: Map<string, { tick: number; composition: EnemyComposition }> = new Map();
const threatGapsCache: Map<string, { tick: number; analysis: ThreatAnalysis }> = new Map();
const counterRecommendationCache: Map<string, { tick: number; recommendation: CounterRecommendation }> = new Map();

/**
 * Get current game tick from the global game instance
 * Used for cache invalidation
 */
let _cachedGameInstance: Game | null = null;
function getCachedGameTick(): number {
  if (!_cachedGameInstance) return 0;
  return _cachedGameInstance.getCurrentTick();
}

/**
 * Set the game instance for cache tick tracking
 * Called by AIMicroSystem on init
 */
export function setAnalysisCacheGameInstance(game: Game): void {
  _cachedGameInstance = game;
}

export function analyzeEnemyComposition(
  world: import('../ecs/World').World,
  myPlayerId: string
): EnemyComposition {
  // PERF: Check cache first
  const currentTick = getCachedGameTick();
  const cached = compositionCache.get(myPlayerId);
  if (cached && currentTick - cached.tick < COMPOSITION_CACHE_DURATION) {
    return cached.composition;
  }

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

  // PERF: Cache result for future calls
  compositionCache.set(myPlayerId, { tick: currentTick, composition });

  return composition;
}

/**
 * Analyze threats that the AI cannot counter with its current army composition.
 * This checks if enemy air units are attacking AI units that cannot attack air,
 * which should urgently trigger building anti-air units.
 */
export function analyzeThreatGaps(
  world: import('../ecs/World').World,
  myPlayerId: string
): ThreatAnalysis {
  // PERF: Check cache first
  const currentTick = getCachedGameTick();
  const cached = threatGapsCache.get(myPlayerId);
  if (cached && currentTick - cached.tick < COMPOSITION_CACHE_DURATION) {
    return cached.analysis;
  }

  const analysis: ThreatAnalysis = {
    uncounterableAirThreats: 0,
    unitsUnderAirAttack: 0,
    hasAntiAir: false,
    antiAirUnitCount: 0,
  };

  const units = world.getEntitiesWith('Unit', 'Selectable', 'Health', 'Transform');
  const myUnits: Array<{ entity: import('../ecs/Entity').Entity; unit: Unit; transform: import('../components/Transform').Transform }> = [];
  const enemyAirUnits: Array<{ entity: import('../ecs/Entity').Entity; unit: Unit; transform: import('../components/Transform').Transform }> = [];

  // First pass: categorize units
  for (const entity of units) {
    const unit = entity.get<Unit>('Unit')!;
    const selectable = entity.get<Selectable>('Selectable')!;
    const health = entity.get<Health>('Health')!;
    const transform = entity.get<import('../components/Transform').Transform>('Transform')!;

    if (health.isDead()) continue;

    if (selectable.playerId === myPlayerId) {
      myUnits.push({ entity, unit, transform });
      // Count our anti-air capable units
      if (unit.canAttackAir) {
        analysis.hasAntiAir = true;
        analysis.antiAirUnitCount++;
      }
    } else {
      // Enemy air units
      if (unit.isFlying && unit.attackDamage > 0) {
        enemyAirUnits.push({ entity, unit, transform });
      }
    }
  }

  // Second pass: check if enemy air units are near our units that can't fight back
  const THREAT_RANGE = 15; // Check for threats within this range

  for (const myUnit of myUnits) {
    // Skip units that can attack air - they can defend themselves
    if (myUnit.unit.canAttackAir) continue;
    // Skip workers (less priority)
    if (myUnit.unit.isWorker) continue;

    for (const enemyAir of enemyAirUnits) {
      const dist = distance(enemyAir.transform.x, enemyAir.transform.y, myUnit.transform.x, myUnit.transform.y);

      // Is the enemy air unit close enough to be a threat?
      if (dist <= THREAT_RANGE) {
        // Is the enemy air unit targeting our unit or nearby?
        if (dist <= enemyAir.unit.attackRange * 1.5) {
          analysis.unitsUnderAirAttack++;
          analysis.uncounterableAirThreats++;
          break; // Count each of our units only once
        }
      }
    }
  }

  // PERF: Cache result for future calls
  threatGapsCache.set(myPlayerId, { tick: currentTick, analysis });

  return analysis;
}

export function getCounterRecommendation(
  world: import('../ecs/World').World,
  myPlayerId: string,
  myBuildingCounts: Map<string, number>
): CounterRecommendation {
  // PERF: Check cache first - recommendation depends on enemy composition which changes slowly
  // Building counts are passed in but change infrequently, so tick-based cache is still valid
  const currentTick = getCachedGameTick();
  const cached = counterRecommendationCache.get(myPlayerId);
  if (cached && currentTick - cached.tick < COMPOSITION_CACHE_DURATION) {
    return cached.recommendation;
  }

  const enemyComp = analyzeEnemyComposition(world, myPlayerId);
  const threatGaps = analyzeThreatGaps(world, myPlayerId);
  const recommendation: CounterRecommendation = {
    unitsToBuild: [],
    buildingsToBuild: [],
  };

  // URGENT: Being attacked by air units we can't hit - highest priority!
  // This triggers when enemy air is actively threatening our ground-only units
  if (threatGaps.uncounterableAirThreats > 0 || (enemyComp.air > 0 && !threatGaps.hasAntiAir)) {
    // Calculate urgency based on how many threats we can't counter
    const urgency = Math.min(15, 10 + threatGaps.uncounterableAirThreats);

    // Prioritize units that can attack air
    // Trooper is cheapest and most accessible anti-air
    recommendation.unitsToBuild.push({ unitId: 'trooper', priority: urgency });
    // Valkyrie is dedicated anti-air (in fighter mode, air-only)
    recommendation.unitsToBuild.push({ unitId: 'valkyrie', priority: urgency - 1 });
    // Colossus can attack both ground and air with heavy damage
    recommendation.unitsToBuild.push({ unitId: 'colossus', priority: urgency - 2 });
    // Specter can attack both as well
    recommendation.unitsToBuild.push({ unitId: 'specter', priority: urgency - 3 });

    // If we don't have a hangar, we need one urgently for valkyries/specters
    if (!myBuildingCounts.get('hangar')) {
      recommendation.buildingsToBuild.push({ buildingId: 'hangar', priority: urgency });
    }
    // Infantry bay for troopers (usually already have, but just in case)
    if (!myBuildingCounts.get('infantry_bay')) {
      recommendation.buildingsToBuild.push({ buildingId: 'infantry_bay', priority: urgency - 1 });
    }
  }

  // Heavy air -> Build valkyries, colossus, troopers (general counter, lower priority than urgent)
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

  // Balanced -> Mixed composition (but favor units that can attack air for versatility)
  if (recommendation.unitsToBuild.length === 0) {
    recommendation.unitsToBuild.push({ unitId: 'trooper', priority: 7 }); // Can attack air
    recommendation.unitsToBuild.push({ unitId: 'breacher', priority: 6 }); // Can attack air
    recommendation.unitsToBuild.push({ unitId: 'lifter', priority: 5 }); // Support
  }

  // Sort by priority and remove duplicates (keep highest priority version)
  const seenUnits = new Set<string>();
  recommendation.unitsToBuild.sort((a, b) => b.priority - a.priority);
  recommendation.unitsToBuild = recommendation.unitsToBuild.filter(u => {
    if (seenUnits.has(u.unitId)) return false;
    seenUnits.add(u.unitId);
    return true;
  });

  const seenBuildings = new Set<string>();
  recommendation.buildingsToBuild.sort((a, b) => b.priority - a.priority);
  recommendation.buildingsToBuild = recommendation.buildingsToBuild.filter(b => {
    if (seenBuildings.has(b.buildingId)) return false;
    seenBuildings.add(b.buildingId);
    return true;
  });

  // PERF: Cache result for future calls
  counterRecommendationCache.set(myPlayerId, { tick: currentTick, recommendation });

  return recommendation;
}

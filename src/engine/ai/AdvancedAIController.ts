/**
 * Advanced AI Controller
 *
 * Integrates all advanced AI systems into a cohesive controller:
 * - Influence Maps (spatial threat tracking)
 * - Positional Analysis (terrain evaluation)
 * - Scouting Memory (enemy intelligence)
 * - Formation Control (army positioning)
 * - Retreat Coordination (tactical retreats)
 * - Ability AI (ability usage decisions)
 * - Worker Distribution (economic optimization)
 *
 * This controller is used by EnhancedAISystem to make strategic decisions.
 */

import { World } from '../ecs/World';
import { Entity } from '../ecs/Entity';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Ability } from '../components/Ability';

import { InfluenceMap, ThreatAnalysis } from './InfluenceMap';
import { PositionalAnalysis, StrategicPosition } from './PositionalAnalysis';
import { ScoutingMemory, EnemyIntel, InferredStrategy } from './ScoutingMemory';
import { FormationControl, ArmyGroup } from './FormationControl';
import { RetreatCoordination, GroupRetreatStatus } from './RetreatCoordination';
import { AbilityAI, AbilityDecision, executeAbilityDecision } from './AbilityAI';
import { WorkerDistribution, WorkerTransfer, BaseSaturation } from './WorkerDistribution';

/**
 * Configuration for the advanced AI controller
 */
export interface AdvancedAIConfig {
  /** Enable influence map updates */
  useInfluenceMaps: boolean;
  /** Enable formation control */
  useFormations: boolean;
  /** Enable ability AI */
  useAbilityAI: boolean;
  /** Enable retreat coordination */
  useRetreatCoordination: boolean;
  /** Enable worker distribution */
  useWorkerDistribution: boolean;
  /** Enable scouting memory */
  useScoutingMemory: boolean;
  /** Influence map update interval (ticks) */
  influenceUpdateInterval: number;
  /** Formation update interval (ticks) */
  formationUpdateInterval: number;
}

const DEFAULT_CONFIG: AdvancedAIConfig = {
  useInfluenceMaps: true,
  useFormations: true,
  useAbilityAI: true,
  useRetreatCoordination: true,
  useWorkerDistribution: true,
  useScoutingMemory: true,
  influenceUpdateInterval: 10,
  formationUpdateInterval: 20,
};

/**
 * Strategic assessment for a player
 */
export interface StrategicAssessment {
  /** Our army strength (supply weighted) */
  ourStrength: number;
  /** Estimated enemy strength */
  enemyStrength: number;
  /** Strength ratio (>1 = we're stronger) */
  strengthRatio: number;
  /** Should we attack? */
  shouldAttack: boolean;
  /** Should we retreat? */
  shouldRetreat: boolean;
  /** Inferred enemy strategy */
  enemyStrategy: InferredStrategy;
  /** Recommended counter-strategy */
  recommendation: string;
  /** Best attack path */
  attackPath: Array<{ x: number; y: number }> | null;
  /** Nearest defensive position */
  defensivePosition: { x: number; y: number } | null;
}

/**
 * Advanced AI Controller - Integrates all AI subsystems
 */
export class AdvancedAIController {
  private config: AdvancedAIConfig;

  // Sub-systems
  private influenceMap: InfluenceMap;
  private positionalAnalysis: PositionalAnalysis;
  private scoutingMemory: Map<string, ScoutingMemory> = new Map(); // Per-player
  private formationControl: FormationControl;
  private retreatCoordination: RetreatCoordination;
  private abilityAI: AbilityAI;
  private workerDistribution: WorkerDistribution;

  // State tracking
  private lastInfluenceUpdate: number = 0;
  private lastFormationUpdate: Map<string, number> = new Map();
  private armyGroups: Map<string, string> = new Map(); // playerId -> groupId

  // Map dimensions
  private mapWidth: number;
  private mapHeight: number;

  // Event bus reference
  private eventBus: { emit: (event: string, data: unknown) => void } | null = null;

  constructor(mapWidth: number, mapHeight: number, config?: Partial<AdvancedAIConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;

    // Initialize sub-systems
    this.influenceMap = new InfluenceMap(mapWidth, mapHeight, 4);
    this.positionalAnalysis = new PositionalAnalysis(mapWidth, mapHeight, 2);
    this.formationControl = new FormationControl();
    this.retreatCoordination = new RetreatCoordination();
    this.abilityAI = new AbilityAI();
    this.workerDistribution = new WorkerDistribution();
  }

  /**
   * Set the event bus for ability execution
   */
  public setEventBus(eventBus: { emit: (event: string, data: unknown) => void }): void {
    this.eventBus = eventBus;
  }

  /**
   * Initialize the controller (call once when map loads)
   */
  public initialize(world: World): void {
    // Analyze map terrain
    this.positionalAnalysis.analyzeMap(world);
  }

  /**
   * Create scouting memory for a player
   */
  public initializePlayer(playerId: string): void {
    if (!this.scoutingMemory.has(playerId)) {
      this.scoutingMemory.set(playerId, new ScoutingMemory(playerId));
    }
  }

  /**
   * Main update loop - call each tick
   */
  public update(world: World, currentTick: number): void {
    // Update influence map periodically
    if (this.config.useInfluenceMaps &&
        currentTick - this.lastInfluenceUpdate >= this.config.influenceUpdateInterval) {
      this.influenceMap.update(world, currentTick);
      this.lastInfluenceUpdate = currentTick;
    }
  }

  /**
   * Update for a specific AI player
   */
  public updatePlayer(
    world: World,
    playerId: string,
    currentTick: number,
    visibleEnemyIds: Set<number>
  ): void {
    // Update scouting memory
    if (this.config.useScoutingMemory) {
      const memory = this.scoutingMemory.get(playerId);
      if (memory) {
        memory.update(world, currentTick, visibleEnemyIds);
      }
    }

    // Update retreat coordination
    if (this.config.useRetreatCoordination) {
      this.retreatCoordination.update(world, currentTick, playerId, this.influenceMap);
    }

    // Update worker distribution
    if (this.config.useWorkerDistribution) {
      const transfers = this.workerDistribution.update(world, playerId, currentTick);

      // Execute transfers
      for (const transfer of transfers) {
        this.workerDistribution.executeTransfer(world, transfer);
      }
    }
  }

  // ==================== STRATEGIC QUERIES ====================

  /**
   * Get strategic assessment for a player
   */
  public getStrategicAssessment(
    world: World,
    playerId: string,
    enemyPlayerId: string
  ): StrategicAssessment {
    // Calculate our strength
    const ourStrength = this.calculateArmyStrength(world, playerId);

    // Get enemy intel
    const memory = this.scoutingMemory.get(playerId);
    const enemyIntel = memory?.getIntel(enemyPlayerId);
    const enemyStrength = enemyIntel?.estimatedArmySupply || 0;

    const strengthRatio = enemyStrength > 0 ? ourStrength / enemyStrength : 2.0;

    // Determine if we should attack or retreat
    const shouldAttack = strengthRatio > 1.2 && ourStrength > 10;
    const shouldRetreat = strengthRatio < 0.6 || this.retreatCoordination.getGroupStatus(world, playerId).isRetreating;

    // Get enemy strategy
    const enemyStrategy = enemyIntel?.strategy.strategy || 'unknown';
    const recommendation = enemyIntel?.strategy.recommendation || 'Scout to gather information';

    // Find attack path if attacking
    let attackPath: Array<{ x: number; y: number }> | null = null;
    if (shouldAttack) {
      const ourBase = this.findPlayerBase(world, playerId);
      const enemyBase = memory?.getEnemyMainBase(enemyPlayerId);

      if (ourBase && enemyBase) {
        attackPath = this.influenceMap.findSafePath(
          ourBase.x, ourBase.y,
          enemyBase.position.x, enemyBase.position.y,
          playerId,
          0.5 // Moderate threat avoidance when attacking
        );
      }
    }

    // Find defensive position if retreating
    let defensivePosition: { x: number; y: number } | null = null;
    if (shouldRetreat) {
      const ourBase = this.findPlayerBase(world, playerId);
      if (ourBase) {
        const nearestChoke = this.positionalAnalysis.getNearestChoke(ourBase.x, ourBase.y);
        defensivePosition = nearestChoke || ourBase;
      }
    }

    return {
      ourStrength,
      enemyStrength,
      strengthRatio,
      shouldAttack,
      shouldRetreat,
      enemyStrategy,
      recommendation,
      attackPath,
      defensivePosition,
    };
  }

  /**
   * Get threat analysis at a position
   */
  public getThreatAt(x: number, y: number, playerId: string): ThreatAnalysis {
    return this.influenceMap.getThreatAnalysis(x, y, playerId);
  }

  /**
   * Check if position is safe
   */
  public isPositionSafe(x: number, y: number, playerId: string, threshold: number = 0.3): boolean {
    const threat = this.influenceMap.getThreatAnalysis(x, y, playerId);
    return threat.dangerLevel < threshold;
  }

  /**
   * Find safe expansion location
   */
  public findSafeExpansion(
    world: World,
    playerId: string,
    baseX: number,
    baseY: number
  ): { x: number; y: number } | null {
    // Get map expansion locations
    const expansions = this.positionalAnalysis.getExpansionLocations();

    // Filter by safety and distance
    let best: { pos: StrategicPosition; score: number } | null = null;

    for (const exp of expansions) {
      const threat = this.influenceMap.getThreatAnalysis(exp.x, exp.y, playerId);

      // Skip dangerous expansions
      if (threat.dangerLevel > 0.4) continue;

      // Score: lower distance + lower danger + higher quality
      const dx = exp.x - baseX;
      const dy = exp.y - baseY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const score = -dist * 0.1 - threat.dangerLevel * 10 + exp.quality * 5;

      if (!best || score > best.score) {
        best = { pos: exp, score };
      }
    }

    return best ? { x: best.pos.x, y: best.pos.y } : null;
  }

  // ==================== FORMATION & COMBAT ====================

  /**
   * Create or update army formation
   */
  public updateArmyFormation(
    world: World,
    playerId: string,
    enemyCenter: { x: number; y: number } | null
  ): void {
    if (!this.config.useFormations) return;

    // Get army units
    const armyUnits = this.getArmyUnits(world, playerId);
    if (armyUnits.length === 0) return;

    // Get or create group
    let groupId = this.armyGroups.get(playerId);
    if (!groupId) {
      groupId = this.formationControl.createGroup(world, armyUnits.map(e => e.id), playerId);
      this.armyGroups.set(playerId, groupId);
    }

    // Update group
    this.formationControl.updateGroup(world, groupId);

    // Calculate formation if we have enemy position
    if (enemyCenter) {
      this.formationControl.calculateConcaveFormation(world, groupId, enemyCenter);
    }
  }

  /**
   * Apply formation positions to army
   */
  public applyFormation(world: World, playerId: string): void {
    const groupId = this.armyGroups.get(playerId);
    if (groupId) {
      this.formationControl.applyFormation(world, groupId);
    }
  }

  /**
   * Get army group for player
   */
  public getArmyGroup(playerId: string): ArmyGroup | undefined {
    const groupId = this.armyGroups.get(playerId);
    return groupId ? this.formationControl.getGroup(groupId) : undefined;
  }

  // ==================== RETREAT ====================

  /**
   * Check if player should retreat
   */
  public shouldRetreat(world: World, playerId: string): boolean {
    const status = this.retreatCoordination.getGroupStatus(world, playerId);
    return status.isRetreating;
  }

  /**
   * Get retreat status
   */
  public getRetreatStatus(world: World, playerId: string): GroupRetreatStatus {
    return this.retreatCoordination.getGroupStatus(world, playerId);
  }

  /**
   * Get retreat target for a unit
   */
  public getRetreatTarget(playerId: string, entityId: number): { x: number; y: number } | null {
    return this.retreatCoordination.getRetreatTarget(playerId, entityId);
  }

  /**
   * Force army to re-engage
   */
  public forceReengage(playerId: string): void {
    this.retreatCoordination.forceReengage(playerId);
  }

  // ==================== ABILITY AI ====================

  /**
   * Evaluate and execute abilities for a unit
   */
  public evaluateAbilities(
    world: World,
    entity: Entity,
    currentTick: number
  ): boolean {
    if (!this.config.useAbilityAI || !this.eventBus) return false;

    const decision = this.abilityAI.evaluateUnit(world, entity, currentTick);
    if (!decision) return false;

    return executeAbilityDecision(world, entity, decision, this.eventBus);
  }

  /**
   * Get ability decision for a unit (without executing)
   */
  public getAbilityDecision(
    world: World,
    entity: Entity,
    currentTick: number
  ): AbilityDecision | null {
    return this.abilityAI.evaluateUnit(world, entity, currentTick);
  }

  // ==================== WORKER DISTRIBUTION ====================

  /**
   * Get base saturation status
   */
  public getBaseSaturations(playerId: string): BaseSaturation[] {
    return this.workerDistribution.getSaturations(playerId);
  }

  /**
   * Check if workers need redistribution
   */
  public needsWorkerRedistribution(playerId: string): boolean {
    return this.workerDistribution.hasOversaturation(playerId) ||
           this.workerDistribution.hasUndersaturation(playerId);
  }

  /**
   * Find best base for a new worker
   */
  public findBestBaseForWorker(world: World, playerId: string): { x: number; y: number } | null {
    return this.workerDistribution.findBestBaseForWorker(world, playerId);
  }

  /**
   * Assign idle workers to resources
   */
  public assignIdleWorkers(world: World, playerId: string): number {
    return this.workerDistribution.assignIdleWorkers(world, playerId);
  }

  // ==================== SCOUTING ====================

  /**
   * Get enemy intel
   */
  public getEnemyIntel(playerId: string, enemyId: string): EnemyIntel | undefined {
    return this.scoutingMemory.get(playerId)?.getIntel(enemyId);
  }

  /**
   * Check if enemy has specific tech
   */
  public enemyHasTech(playerId: string, enemyId: string, buildingId: string): boolean {
    return this.scoutingMemory.get(playerId)?.enemyHasTech(enemyId, buildingId) || false;
  }

  /**
   * Should build anti-air?
   */
  public shouldBuildAntiAir(playerId: string, enemyId: string): boolean {
    return this.scoutingMemory.get(playerId)?.shouldBuildAntiAir(enemyId) || false;
  }

  /**
   * Get enemy main base location
   */
  public getEnemyMainBase(playerId: string, enemyId: string): { x: number; y: number } | null {
    const base = this.scoutingMemory.get(playerId)?.getEnemyMainBase(enemyId);
    return base ? base.position : null;
  }

  // ==================== TERRAIN ====================

  /**
   * Get nearest choke point
   */
  public getNearestChoke(x: number, y: number): StrategicPosition | null {
    return this.positionalAnalysis.getNearestChoke(x, y);
  }

  /**
   * Get defensive positions near a point
   */
  public getDefensivePositions(x: number, y: number, radius: number): StrategicPosition[] {
    return this.positionalAnalysis.getPositionsInRadius(x, y, radius, 'defensible');
  }

  /**
   * Check if at a choke point
   */
  public isAtChoke(x: number, y: number): boolean {
    return this.positionalAnalysis.isAtChoke(x, y);
  }

  // ==================== HELPERS ====================

  /**
   * Calculate army strength for a player
   */
  private calculateArmyStrength(world: World, playerId: string): number {
    let strength = 0;
    const units = world.getEntitiesWith('Unit', 'Selectable', 'Health');

    for (const entity of units) {
      const unit = entity.get<Unit>('Unit')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) continue;

      // Strength = DPS * health factor
      const dps = unit.attackDamage * unit.attackSpeed;
      const healthFactor = health.current / health.max;
      strength += dps * healthFactor * 2;
    }

    return Math.round(strength);
  }

  /**
   * Get army units for a player
   */
  private getArmyUnits(world: World, playerId: string): Entity[] {
    const units: Entity[] = [];
    const entities = world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');

    for (const entity of entities) {
      const unit = entity.get<Unit>('Unit')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) continue;

      units.push(entity);
    }

    return units;
  }

  /**
   * Find player's main base
   */
  private findPlayerBase(world: World, playerId: string): { x: number; y: number } | null {
    const buildings = world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');

    for (const entity of buildings) {
      const building = entity.get<import('../components/Building').Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;
      if (health.isDead()) continue;

      if (['headquarters', 'orbital_station', 'command_center', 'nexus'].includes(building.buildingId)) {
        return { x: transform.x, y: transform.y };
      }
    }

    return null;
  }

  /**
   * Clear all state
   */
  public clear(): void {
    this.influenceMap.clear();
    this.positionalAnalysis.clear();
    this.scoutingMemory.clear();
    this.formationControl.clear();
    this.retreatCoordination.clear();
    this.abilityAI.clear();
    this.workerDistribution.clear();
    this.armyGroups.clear();
    this.lastFormationUpdate.clear();
  }

  // ==================== GETTERS ====================

  public getInfluenceMap(): InfluenceMap {
    return this.influenceMap;
  }

  public getPositionalAnalysis(): PositionalAnalysis {
    return this.positionalAnalysis;
  }

  public getScoutingMemory(playerId: string): ScoutingMemory | undefined {
    return this.scoutingMemory.get(playerId);
  }

  public getFormationControl(): FormationControl {
    return this.formationControl;
  }

  public getRetreatCoordination(): RetreatCoordination {
    return this.retreatCoordination;
  }

  public getAbilityAI(): AbilityAI {
    return this.abilityAI;
  }

  public getWorkerDistribution(): WorkerDistribution {
    return this.workerDistribution;
  }
}

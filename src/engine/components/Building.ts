import { Component } from '../ecs/Component';

export type BuildingState = 'waiting_for_worker' | 'constructing' | 'paused' | 'complete' | 'destroyed' | 'lifting' | 'flying' | 'landing';
export type AddonType = 'tech_lab' | 'reactor' | null;

export interface BuildingDefinition {
  id: string;
  name: string;
  description?: string;
  faction: string;
  mineralCost: number;
  vespeneCost: number;
  buildTime: number; // seconds
  width: number; // grid cells
  height: number;
  maxHealth: number;
  armor: number;
  sightRange: number;
  supplyProvided?: number;
  canProduce?: string[]; // unit IDs
  canResearch?: string[]; // upgrade IDs
  requirements?: string[]; // building IDs required
  // New mechanics
  canLiftOff?: boolean;
  canHaveAddon?: boolean;
  isAddon?: boolean;
  addonFor?: string[]; // building types this addon can attach to
  // Bunker specific
  isBunker?: boolean;
  bunkerCapacity?: number;
  // Supply depot specific
  canLower?: boolean;
  // Detection
  isDetector?: boolean;
  detectionRange?: number;
  // Attack (for turrets, bunkers)
  attackRange?: number;
  attackDamage?: number;
  attackSpeed?: number;
  // Building upgrades (e.g., CC -> Orbital/Planetary)
  canUpgradeTo?: string[];
}

export interface ProductionQueueItem {
  type: 'unit' | 'upgrade';
  id: string;
  progress: number;
  buildTime: number;
  supplyCost: number; // Supply cost for this item (0 for upgrades)
  supplyAllocated: boolean; // Whether supply has been allocated for this item
  produceCount: number; // Number of units to produce (2 for reactor bonus)
}

export class Building extends Component {
  public readonly type = 'Building';

  public buildingId: string;
  public name: string;
  public faction: string;
  public state: BuildingState;

  // Construction
  public buildProgress: number; // 0-1
  public buildTime: number;

  // Size
  public width: number;
  public height: number;

  // Production
  public canProduce: string[];
  public canResearch: string[];
  public productionQueue: ProductionQueueItem[];
  public rallyX: number | null;
  public rallyY: number | null;
  public rallyTargetId: number | null;

  // Resources
  public supplyProvided: number;

  // Vision
  public sightRange: number;

  // Addon system
  public canLiftOff: boolean;
  public canHaveAddon: boolean;
  public currentAddon: AddonType;
  public addonEntityId: number | null; // The addon building entity
  public attachedToId: number | null; // If this is an addon, the building it's attached to

  // Flying state
  public isFlying: boolean;
  public liftProgress: number; // 0-1 for lift/land animation
  public landingTarget: { x: number; y: number } | null;
  // Movement target for flying buildings
  public flyingTargetX: number | null;
  public flyingTargetY: number | null;
  public flyingSpeed: number; // Max movement speed when flying
  public flyingCurrentSpeed: number; // Current flying speed (for accel/decel)
  // Pending landing - building flies here first, then lands
  public pendingLandingX: number | null;
  public pendingLandingY: number | null;
  // Smooth lift/land animation velocity
  public liftVelocity: number;

  // Supply depot lowered state
  public canLower: boolean;
  public isLowered: boolean;

  // Detection
  public isDetector: boolean;
  public detectionRange: number;

  // Bunker
  public isBunker: boolean;
  public bunkerCapacity: number;

  // Attack (for turrets)
  public attackRange: number;
  public attackDamage: number;
  public attackSpeed: number;
  public lastAttackTime: number;

  // Building upgrades (e.g., CC -> Orbital/Planetary)
  public canUpgradeTo: string[];

  // PERF: For extractors - stores the linked resource entity ID for O(1) lookup
  // instead of O(n) scan through all resources when destroyed
  public linkedResourceId: number | null;

  constructor(definition: BuildingDefinition) {
    super();
    this.buildingId = definition.id;
    this.name = definition.name;
    this.faction = definition.faction;
    this.state = 'waiting_for_worker'; // Starts waiting for SCV to arrive

    this.buildProgress = 0;
    this.buildTime = definition.buildTime;

    this.width = definition.width;
    this.height = definition.height;

    this.canProduce = definition.canProduce ?? [];
    this.canResearch = definition.canResearch ?? [];
    this.productionQueue = [];
    this.rallyX = null;
    this.rallyY = null;
    this.rallyTargetId = null;

    this.supplyProvided = definition.supplyProvided ?? 0;
    this.sightRange = definition.sightRange;

    // Addon system
    this.canLiftOff = definition.canLiftOff ?? false;
    this.canHaveAddon = definition.canHaveAddon ?? false;
    this.currentAddon = null;
    this.addonEntityId = null;
    this.attachedToId = null;

    // Flying state
    this.isFlying = false;
    this.liftProgress = 0;
    this.landingTarget = null;
    this.flyingTargetX = null;
    this.flyingTargetY = null;
    this.flyingSpeed = 2.5; // Max flying speed
    this.flyingCurrentSpeed = 0; // Starts at rest
    this.pendingLandingX = null;
    this.pendingLandingY = null;
    this.liftVelocity = 0;

    // Supply depot
    this.canLower = definition.canLower ?? false;
    this.isLowered = false;

    // Detection
    this.isDetector = definition.isDetector ?? false;
    this.detectionRange = definition.detectionRange ?? 0;

    // Bunker
    this.isBunker = definition.isBunker ?? false;
    this.bunkerCapacity = definition.bunkerCapacity ?? 0;

    // Attack
    this.attackRange = definition.attackRange ?? 0;
    this.attackDamage = definition.attackDamage ?? 0;
    this.attackSpeed = definition.attackSpeed ?? 0;
    this.lastAttackTime = 0;

    // Building upgrades
    this.canUpgradeTo = definition.canUpgradeTo ?? [];

    // Extractor reverse lookup
    this.linkedResourceId = null;
  }

  /**
   * Called when worker arrives at construction site to begin building
   */
  public startConstruction(): void {
    if (this.state === 'waiting_for_worker') {
      this.state = 'constructing';
    }
  }

  /**
   * Check if construction has started (worker has arrived at least once)
   */
  public hasConstructionStarted(): boolean {
    return this.state === 'constructing' || this.state === 'paused' || this.state === 'complete';
  }

  /**
   * Pause construction when worker leaves (SC2-style)
   * Construction will remain paused until another worker resumes it
   */
  public pauseConstruction(): void {
    if (this.state === 'constructing') {
      this.state = 'paused';
    }
  }

  /**
   * Resume construction when a worker arrives at a paused building (SC2-style)
   */
  public resumeConstruction(): void {
    if (this.state === 'paused') {
      this.state = 'constructing';
    }
  }

  /**
   * Check if construction is paused (waiting for worker to resume)
   */
  public isConstructionPaused(): boolean {
    return this.state === 'paused';
  }

  public updateConstruction(deltaTime: number): boolean {
    if (this.state !== 'constructing') return false;

    this.buildProgress += deltaTime / this.buildTime;

    if (this.buildProgress >= 1) {
      this.buildProgress = 1;
      this.state = 'complete';
      return true; // Construction complete
    }

    return false;
  }

  public isComplete(): boolean {
    return this.state === 'complete';
  }

  /**
   * Check if building is operational (should count for defeat conditions).
   * Includes complete buildings and those in flying states (lifting, flying, landing).
   */
  public isOperational(): boolean {
    return this.state === 'complete' || this.state === 'lifting' || this.state === 'flying' || this.state === 'landing';
  }

  public addToProductionQueue(type: 'unit' | 'upgrade', id: string, buildTime: number, supplyCost: number = 0, produceCount: number = 1): void {
    this.productionQueue.push({
      type,
      id,
      progress: 0,
      buildTime,
      supplyCost,
      supplyAllocated: false,
      produceCount,
    });
  }

  public updateProduction(deltaTime: number): ProductionQueueItem | null {
    if (this.state !== 'complete' || this.productionQueue.length === 0) {
      return null;
    }

    const current = this.productionQueue[0];
    current.progress += deltaTime / current.buildTime;

    if (current.progress >= 1) {
      return this.productionQueue.shift()!;
    }

    return null;
  }

  public getProductionProgress(): number {
    if (this.productionQueue.length === 0) return 0;
    return this.productionQueue[0].progress;
  }

  public setRallyPoint(x: number, y: number, targetId: number | null = null): void {
    this.rallyX = x;
    this.rallyY = y;
    this.rallyTargetId = targetId;
  }

  public cancelProduction(index: number): ProductionQueueItem | null {
    if (index < 0 || index >= this.productionQueue.length) return null;
    return this.productionQueue.splice(index, 1)[0];
  }

  /**
   * Reorder a production queue item to a new position.
   * Cannot move items to/from position 0 (active production).
   * @returns true if reorder was successful
   */
  public reorderProduction(fromIndex: number, toIndex: number): boolean {
    // Cannot reorder the active item (index 0) or move something to position 0
    if (fromIndex === 0 || toIndex === 0) return false;
    if (fromIndex < 0 || fromIndex >= this.productionQueue.length) return false;
    if (toIndex < 0 || toIndex >= this.productionQueue.length) return false;
    if (fromIndex === toIndex) return false;

    const [item] = this.productionQueue.splice(fromIndex, 1);
    this.productionQueue.splice(toIndex, 0, item);
    return true;
  }

  /**
   * Move a queued item up in the queue (closer to being produced).
   * Cannot move item at index 1 to position 0.
   * @returns true if move was successful
   */
  public moveQueueItemUp(index: number): boolean {
    if (index <= 1 || index >= this.productionQueue.length) return false;
    return this.reorderProduction(index, index - 1);
  }

  /**
   * Move a queued item down in the queue (further from being produced).
   * @returns true if move was successful
   */
  public moveQueueItemDown(index: number): boolean {
    if (index <= 0 || index >= this.productionQueue.length - 1) return false;
    return this.reorderProduction(index, index + 1);
  }

  // ==================== ADDON MECHANICS ====================

  public attachAddon(addonType: AddonType, addonEntityId: number): boolean {
    if (!this.canHaveAddon) return false;
    if (this.currentAddon !== null) return false;

    this.currentAddon = addonType;
    this.addonEntityId = addonEntityId;

    // Update produceable units based on addon
    this.updateProductionCapability();
    return true;
  }

  public detachAddon(): number | null {
    if (this.currentAddon === null) return null;

    const addonId = this.addonEntityId;
    this.currentAddon = null;
    this.addonEntityId = null;

    // Reset production capability
    this.updateProductionCapability();
    return addonId;
  }

  private updateProductionCapability(): void {
    // This would update canProduce based on addon type
    // Tech Lab: Enables advanced units (Marauder, Ghost, Siege Tank, Thor, etc.)
    // Reactor: Allows double production of basic units
    // For now, this is handled by production system checking addon status
  }

  public hasAddon(): boolean {
    return this.currentAddon !== null;
  }

  public hasTechLab(): boolean {
    return this.currentAddon === 'tech_lab';
  }

  public hasReactor(): boolean {
    return this.currentAddon === 'reactor';
  }

  // ==================== LIFT-OFF MECHANICS ====================

  public startLiftOff(): boolean {
    if (!this.canLiftOff) return false;
    if (this.state !== 'complete') return false;
    if (this.isFlying) return false;
    if (this.productionQueue.length > 0) return false; // Can't lift with queue

    this.state = 'lifting';
    this.liftProgress = 0;
    this.liftVelocity = 0;
    this.flyingCurrentSpeed = 0; // Start from rest when lifting

    // Detach addon when lifting
    if (this.currentAddon !== null) {
      this.detachAddon();
    }

    return true;
  }

  // Lift/land animation constants
  private static readonly LIFT_ACCELERATION = 2.0; // units per second squared
  private static readonly LIFT_DECELERATION = 3.0;
  private static readonly MAX_LIFT_VELOCITY = 0.8; // max speed of lift progress per second

  public updateLift(deltaTime: number): boolean {
    if (this.state !== 'lifting') return false;

    // Smooth acceleration at start, deceleration near end
    const distanceToEnd = 1 - this.liftProgress;
    const stoppingDistance = (this.liftVelocity * this.liftVelocity) / (2 * Building.LIFT_DECELERATION);

    if (distanceToEnd <= stoppingDistance && this.liftVelocity > 0) {
      // Decelerate as we approach the end
      this.liftVelocity = Math.max(0.05, this.liftVelocity - Building.LIFT_DECELERATION * deltaTime);
    } else {
      // Accelerate toward max velocity
      this.liftVelocity = Math.min(Building.MAX_LIFT_VELOCITY, this.liftVelocity + Building.LIFT_ACCELERATION * deltaTime);
    }

    this.liftProgress += this.liftVelocity * deltaTime;

    if (this.liftProgress >= 1) {
      this.liftProgress = 1;
      this.liftVelocity = 0;
      this.state = 'flying';
      this.isFlying = true;
      return true;
    }

    return false;
  }

  public startLanding(targetX: number, targetY: number): boolean {
    if (!this.canLiftOff) return false;
    if (this.state !== 'flying') return false;

    this.state = 'landing';
    this.liftProgress = 1;
    this.liftVelocity = 0; // Start from rest
    this.landingTarget = { x: targetX, y: targetY };
    return true;
  }

  public updateLanding(deltaTime: number): boolean {
    if (this.state !== 'landing') return false;

    // Smooth acceleration down, deceleration near ground
    const distanceToGround = this.liftProgress;
    const stoppingDistance = (this.liftVelocity * this.liftVelocity) / (2 * Building.LIFT_DECELERATION);

    if (distanceToGround <= stoppingDistance && this.liftVelocity > 0) {
      // Decelerate as we approach ground
      this.liftVelocity = Math.max(0.05, this.liftVelocity - Building.LIFT_DECELERATION * deltaTime);
    } else {
      // Accelerate downward
      this.liftVelocity = Math.min(Building.MAX_LIFT_VELOCITY, this.liftVelocity + Building.LIFT_ACCELERATION * deltaTime);
    }

    this.liftProgress -= this.liftVelocity * deltaTime;

    if (this.liftProgress <= 0) {
      this.liftProgress = 0;
      this.liftVelocity = 0;
      this.state = 'complete';
      this.isFlying = false;
      this.landingTarget = null;
      return true;
    }

    return false;
  }

  public setPendingLanding(x: number, y: number): void {
    this.pendingLandingX = x;
    this.pendingLandingY = y;
  }

  public hasPendingLanding(): boolean {
    return this.pendingLandingX !== null && this.pendingLandingY !== null;
  }

  public clearPendingLanding(): void {
    this.pendingLandingX = null;
    this.pendingLandingY = null;
  }

  // ==================== FLYING MOVEMENT MECHANICS ====================

  public setFlyingTarget(x: number, y: number): boolean {
    if (this.state !== 'flying') return false;
    this.flyingTargetX = x;
    this.flyingTargetY = y;
    return true;
  }

  public clearFlyingTarget(): void {
    this.flyingTargetX = null;
    this.flyingTargetY = null;
  }

  public hasFlyingTarget(): boolean {
    return this.flyingTargetX !== null && this.flyingTargetY !== null;
  }

  // ==================== SUPPLY DEPOT MECHANICS ====================

  public toggleLowered(): boolean {
    if (!this.canLower) return false;
    if (this.state !== 'complete') return false;

    this.isLowered = !this.isLowered;
    return true;
  }

  public setLowered(lowered: boolean): void {
    if (this.canLower && this.state === 'complete') {
      this.isLowered = lowered;
    }
  }

  // ==================== ATTACK MECHANICS (for turrets) ====================

  public canAttack(gameTime: number): boolean {
    if (this.attackDamage <= 0 || this.attackSpeed <= 0) return false;
    const timeSinceLastAttack = gameTime - this.lastAttackTime;
    return timeSinceLastAttack >= 1 / this.attackSpeed;
  }
}

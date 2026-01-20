import { Component } from '../ecs/Component';
import { AssetManager } from '@/assets/AssetManager';
import { collisionConfig } from '@/data/collisionConfig';

export type UnitState = 'idle' | 'moving' | 'attackmoving' | 'attacking' | 'gathering' | 'building' | 'dead' | 'patrolling' | 'transforming' | 'loaded';
export type DamageType = 'normal' | 'explosive' | 'concussive' | 'psionic';

// Transform mode definitions for units that can transform
export interface TransformMode {
  id: string;
  name: string;
  speed: number;
  attackRange: number;
  attackDamage: number;
  attackSpeed: number;
  splashRadius?: number;
  sightRange: number;
  isFlying?: boolean;
  canMove: boolean;
  transformTime: number; // seconds to transform
  // Targeting restrictions - which types of units this mode can attack
  canAttackGround?: boolean; // Can attack ground units/buildings (default: true if has damage)
  canAttackAir?: boolean; // Can attack flying units (default: false)
  // Projectile type override for this mode
  projectileType?: string;
}

// Audio configuration for a unit - references voice groups and sound IDs from config files
export interface UnitAudioConfig {
  // Voice group ID from voices.config.json (e.g., 'trooper', 'devastator')
  // If not set, uses the unit's id as the voice group
  voiceGroupId?: string;
  // Weapon sound ID from sounds.config.json (e.g., 'attack_rifle', 'attack_cannon')
  // If not set, no weapon sound plays
  weaponSound?: string;
  // Death sound ID from sounds.config.json (e.g., 'unit_death', 'unit_death_mech')
  // If not set, no death sound plays
  deathSound?: string;
}

export interface UnitDefinition {
  id: string;
  name: string;
  description?: string;
  faction: string;
  mineralCost: number;
  vespeneCost: number;
  buildTime: number; // seconds
  supplyCost: number;
  speed: number;
  sightRange: number;
  attackRange: number;
  attackDamage: number;
  attackSpeed: number; // attacks per second
  damageType: DamageType;
  maxHealth: number;
  armor: number;
  abilities?: string[];
  isWorker?: boolean;
  isFlying?: boolean;
  acceleration?: number; // units per second squared (ground=1000 instant, air=1-5 floaty)
  deceleration?: number; // units per second squared (typically 2x acceleration for snappy stops)
  splashRadius?: number; // AoE splash damage radius
  // Transform mechanics
  canTransform?: boolean;
  transformModes?: TransformMode[];
  defaultMode?: string;
  // Cloak mechanics
  canCloak?: boolean;
  cloakEnergyCost?: number; // energy per second while cloaked
  // Transport mechanics
  isTransport?: boolean;
  transportCapacity?: number;
  // Detection
  isDetector?: boolean;
  detectionRange?: number;
  // Healing/Repair
  canHeal?: boolean;
  healRange?: number;
  healRate?: number;
  healEnergyCost?: number;
  canRepair?: boolean;
  // Biological flag (for abilities like Snipe)
  isBiological?: boolean;
  isMechanical?: boolean;
  // Targeting restrictions - which types of units this unit can attack
  canAttackGround?: boolean; // Can attack ground units/buildings (default: true if has damage)
  canAttackAir?: boolean; // Can attack flying units (default: false)
  // AI targeting priority (higher = more likely to be targeted first)
  // If not set, uses category-based default from @/data/units/categories.ts
  targetPriority?: number;
  // Unit category for UI organization and upgrades (e.g., 'infantry', 'vehicle', 'ship')
  // If not set, uses assignment from @/data/units/categories.ts
  category?: string;
  // Armor type for damage calculations (e.g., 'light', 'armored', 'massive')
  // If not set, defaults to 'light'
  armorType?: string;
  // Audio configuration - references voice groups and sound IDs from config files
  // All audio is data-driven via public/audio/*.config.json files
  audio?: UnitAudioConfig;
  // Projectile type for ranged attacks - references PROJECTILE_TYPES
  // If not set, defaults to 'bullet_rifle'
  projectileType?: string;
  // Can attack while moving (like capital ships with tracking turrets)
  // If not set, defaults to false
  canAttackWhileMoving?: boolean;
}

// Command queue entry for shift-click queuing
export interface QueuedCommand {
  type: 'move' | 'attack' | 'attackmove' | 'patrol' | 'gather' | 'build';
  targetX?: number;
  targetY?: number;
  targetEntityId?: number;
  // For build commands
  buildingType?: string;
  buildingEntityId?: number; // Entity ID of already-placed blueprint
}

export class Unit extends Component {
  public readonly type = 'Unit';

  public unitId: string;
  public name: string;
  public faction: string;
  public state: UnitState;

  // Movement
  public speed: number;
  public maxSpeed: number; // Maximum speed (same as speed)
  public currentSpeed: number; // Current speed for acceleration
  public acceleration: number; // Acceleration rate (units/sec²) - ground=1000, air=1-5
  public deceleration: number; // Deceleration rate (units/sec²) - typically 2x acceleration for snappy stops
  public targetX: number | null;
  public targetY: number | null;
  public path: Array<{ x: number; y: number }>;
  public pathIndex: number;

  // Command queue for shift-click
  public commandQueue: QueuedCommand[];

  // Patrol
  public patrolPoints: Array<{ x: number; y: number }>;
  public patrolIndex: number;

  // Combat
  public attackRange: number;
  public attackDamage: number;
  public attackSpeed: number;
  public damageType: DamageType;
  public lastAttackTime: number;
  public targetEntityId: number | null;
  public splashRadius: number; // AoE damage radius (0 = no splash)
  public projectileType: string; // Reference to PROJECTILE_TYPES

  // Vision
  public sightRange: number;

  // Worker
  public isWorker: boolean;
  public carryingMinerals: number;
  public carryingVespene: number;
  public gatherTargetId: number | null;
  public miningTimer: number; // Time remaining until mining completes (seconds)
  public isMining: boolean; // Currently in mining animation

  // Construction (for workers building structures)
  public constructingBuildingId: number | null; // Entity ID of building being constructed
  public buildTargetX: number | null; // Target position to build at
  public buildTargetY: number | null;
  public buildingType: string | null; // Type of building to construct
  public isHelperWorker: boolean; // True if this worker auto-assisted (not primary builder)
  public returnPositionX: number | null; // Position to return to after helping
  public returnPositionY: number | null;

  // Wall line construction - workers build multiple wall segments efficiently
  public wallLineId: number | null; // Unique ID for the wall line this worker is assigned to
  public wallLineSegments: number[]; // Entity IDs of all segments in the wall line (for auto-continue)

  // Flags
  public isFlying: boolean;
  public isHoldingPosition: boolean;
  public isBiological: boolean;
  public isMechanical: boolean;

  // Targeting restrictions - which types of units this unit can attack
  public canAttackGround: boolean;
  public canAttackAir: boolean;
  public canAttackWhileMoving: boolean;

  // Collision radius for avoidance
  public collisionRadius: number;

  // Transform mechanics
  public canTransform: boolean;
  public transformModes: TransformMode[];
  public currentMode: string;
  public transformProgress: number; // 0-1, progress of current transformation
  public transformTargetMode: string | null;

  // Cloak mechanics
  public canCloak: boolean;
  public isCloaked: boolean;
  public cloakEnergyCost: number;

  // Transport mechanics
  public isTransport: boolean;
  public transportCapacity: number;
  public loadedUnits: number[]; // Entity IDs of loaded units

  // Detection
  public isDetector: boolean;
  public detectionRange: number;

  // Healing/Repair
  public canHeal: boolean;
  public healRange: number;
  public healRate: number;
  public healEnergyCost: number;
  public canRepair: boolean;
  public isRepairing: boolean;
  public repairTargetId: number | null;
  public healTargetId: number | null;
  public autocastRepair: boolean; // Auto-repair nearby damaged buildings/mechanical units

  // Buff tracking
  public activeBuffs: Map<string, { duration: number; effects: Record<string, number> }>;

  constructor(definition: UnitDefinition) {
    super();
    this.unitId = definition.id;
    this.name = definition.name;
    this.faction = definition.faction;
    this.state = 'idle';

    this.speed = definition.speed;
    this.maxSpeed = definition.speed;
    this.currentSpeed = 0; // Start at 0, accelerate to max
    // RTS-style acceleration: ground units have instant (1000), air units have gradual (1-5)
    // Default to 15 for backwards compatibility, but new units should specify explicitly
    this.acceleration = definition.acceleration ?? 15;
    // Deceleration is typically 2x acceleration for snappy stops
    this.deceleration = definition.deceleration ?? (this.acceleration * 2);
    this.targetX = null;
    this.targetY = null;
    this.path = [];
    this.pathIndex = 0;

    // Command queue
    this.commandQueue = [];

    // Patrol
    this.patrolPoints = [];
    this.patrolIndex = 0;

    this.attackRange = definition.attackRange;
    this.attackDamage = definition.attackDamage;
    this.attackSpeed = definition.attackSpeed;
    this.damageType = definition.damageType;
    this.lastAttackTime = 0;
    this.targetEntityId = null;
    this.splashRadius = definition.splashRadius ?? 0;
    this.projectileType = definition.projectileType ?? 'bullet_rifle';

    this.sightRange = definition.sightRange;

    this.isWorker = definition.isWorker ?? false;
    this.carryingMinerals = 0;
    this.carryingVespene = 0;
    this.gatherTargetId = null;
    this.miningTimer = 0;
    this.isMining = false;

    // Construction
    this.constructingBuildingId = null;
    this.buildTargetX = null;
    this.buildTargetY = null;
    this.buildingType = null;
    this.isHelperWorker = false;
    this.returnPositionX = null;
    this.returnPositionY = null;

    // Wall line construction
    this.wallLineId = null;
    this.wallLineSegments = [];

    this.isFlying = definition.isFlying ?? false;
    this.isHoldingPosition = false;
    this.isBiological = definition.isBiological ?? !definition.isMechanical;
    this.isMechanical = definition.isMechanical ?? false;

    // Targeting restrictions - default: can attack ground if has damage, can't attack air by default
    const hasDamage = definition.attackDamage > 0;
    this.canAttackGround = definition.canAttackGround ?? hasDamage;
    this.canAttackAir = definition.canAttackAir ?? false;
    this.canAttackWhileMoving = definition.canAttackWhileMoving ?? false;

    // Collision radius from assets.json, fallback to config defaults
    const assetCollisionRadius = AssetManager.getCollisionRadius(definition.id);
    if (assetCollisionRadius !== null) {
      this.collisionRadius = assetCollisionRadius;
    } else {
      // Fallback to defaults from collision.config.json
      this.collisionRadius = definition.isFlying
        ? collisionConfig.defaultFlyingUnitRadius
        : collisionConfig.defaultGroundUnitRadius;
    }

    // Transform mechanics
    this.canTransform = definition.canTransform ?? false;
    this.transformModes = definition.transformModes ?? [];
    this.currentMode = definition.defaultMode ?? 'default';
    this.transformProgress = 0;
    this.transformTargetMode = null;

    // Cloak mechanics
    this.canCloak = definition.canCloak ?? false;
    this.isCloaked = false;
    this.cloakEnergyCost = definition.cloakEnergyCost ?? 1;

    // Transport mechanics
    this.isTransport = definition.isTransport ?? false;
    this.transportCapacity = definition.transportCapacity ?? 0;
    this.loadedUnits = [];

    // Detection
    this.isDetector = definition.isDetector ?? false;
    this.detectionRange = definition.detectionRange ?? 0;

    // Healing/Repair
    this.canHeal = definition.canHeal ?? false;
    this.healRange = definition.healRange ?? 0;
    this.healRate = definition.healRate ?? 0;
    this.healEnergyCost = definition.healEnergyCost ?? 0;
    this.canRepair = definition.canRepair ?? false;
    this.isRepairing = false;
    this.repairTargetId = null;
    this.healTargetId = null;
    this.autocastRepair = false; // Off by default, player can toggle

    // Buff tracking
    this.activeBuffs = new Map();
  }

  public setMoveTarget(x: number, y: number, preserveState: boolean = false): void {
    this.targetX = x;
    this.targetY = y;
    if (!preserveState) {
      this.state = 'moving';
    }
    this.targetEntityId = null;
  }

  // Move to position while preserving current state (for gathering, etc.)
  public moveToPosition(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    // Clear any existing path so the new target takes effect
    // MovementSystem will request a new path if needed
    this.path = [];
    this.pathIndex = 0;
    // Don't change state - used for gathering movement
  }

  public setAttackTarget(entityId: number): void {
    this.targetEntityId = entityId;
    this.state = 'attacking';
    this.targetX = null;
    this.targetY = null;
  }

  // Set attack target while continuing to move (for units with canAttackWhileMoving)
  public setAttackTargetWhileMoving(entityId: number): void {
    this.targetEntityId = entityId;
    // Don't change state or clear move target - unit keeps moving
  }

  // Attack-move: move toward a position while engaging enemies along the way
  public setAttackMoveTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.state = 'attackmoving';
    this.targetEntityId = null;
  }

  public setPath(path: Array<{ x: number; y: number }>): void {
    this.path = path;
    this.pathIndex = 0;
  }

  public clearTarget(): void {
    this.targetX = null;
    this.targetY = null;
    this.targetEntityId = null;
    this.path = [];
    this.pathIndex = 0;
    this.state = 'idle';
    this.currentSpeed = 0; // Reset speed when stopping
  }

  public stop(): void {
    this.clearTarget();
    this.commandQueue = []; // Clear command queue
    this.patrolPoints = [];
    this.isHoldingPosition = false;
    this.currentSpeed = 0;
  }

  public holdPosition(): void {
    this.clearTarget();
    this.commandQueue = [];
    this.patrolPoints = [];
    this.isHoldingPosition = true;
    this.currentSpeed = 0;
  }

  public canAttack(gameTime: number): boolean {
    const timeSinceLastAttack = gameTime - this.lastAttackTime;
    return timeSinceLastAttack >= 1 / this.attackSpeed;
  }

  /**
   * Check if this unit can attack a target based on air/ground restrictions
   * @param targetIsFlying Whether the target is a flying unit
   * @returns True if this unit can attack the target type
   */
  public canAttackTarget(targetIsFlying: boolean): boolean {
    if (targetIsFlying) {
      return this.canAttackAir;
    }
    return this.canAttackGround;
  }

  // Queue a command (for shift-click)
  public queueCommand(command: QueuedCommand): void {
    this.commandQueue.push(command);
  }

  // Execute next queued command
  public executeNextCommand(): boolean {
    if (this.commandQueue.length === 0) {
      return false;
    }

    const command = this.commandQueue.shift()!;

    switch (command.type) {
      case 'move':
        if (command.targetX !== undefined && command.targetY !== undefined) {
          this.setMoveTarget(command.targetX, command.targetY);
        }
        break;
      case 'attack':
        if (command.targetEntityId !== undefined) {
          this.setAttackTarget(command.targetEntityId);
        }
        break;
      case 'attackmove':
        if (command.targetX !== undefined && command.targetY !== undefined) {
          this.setAttackMoveTarget(command.targetX, command.targetY);
        }
        break;
      case 'patrol':
        if (command.targetX !== undefined && command.targetY !== undefined) {
          this.addPatrolPoint(command.targetX, command.targetY);
        }
        break;
      case 'gather':
        if (command.targetEntityId !== undefined) {
          this.setGatherTarget(command.targetEntityId);
        }
        break;
      case 'build':
        if (command.buildingEntityId !== undefined && command.targetX !== undefined && command.targetY !== undefined) {
          // Resume construction on an existing blueprint
          this.constructingBuildingId = command.buildingEntityId;
          this.buildTargetX = command.targetX;
          this.buildTargetY = command.targetY;
          this.buildingType = command.buildingType ?? null;
          this.state = 'building';
          this.targetX = command.targetX;
          this.targetY = command.targetY;
          this.path = [];
          this.pathIndex = 0;
          this.gatherTargetId = null;
          this.carryingMinerals = 0;
          this.carryingVespene = 0;
          this.isHelperWorker = false; // Queued builds are intentional, not auto-help
        }
        break;
    }

    return true;
  }

  // Set gather target for workers
  public setGatherTarget(targetEntityId: number): void {
    if (!this.isWorker) return;
    this.gatherTargetId = targetEntityId;
    this.state = 'gathering';
    // Movement will be handled by ResourceSystem
  }

  // Set patrol between current position and target
  public setPatrol(startX: number, startY: number, endX: number, endY: number): void {
    this.patrolPoints = [
      { x: startX, y: startY },
      { x: endX, y: endY },
    ];
    this.patrolIndex = 1; // Start moving to second point
    this.state = 'patrolling';
    this.targetX = endX;
    this.targetY = endY;
    this.commandQueue = [];
  }

  // Add a patrol point
  public addPatrolPoint(x: number, y: number): void {
    this.patrolPoints.push({ x, y });
    if (this.state !== 'patrolling') {
      this.state = 'patrolling';
      this.patrolIndex = 0;
      const point = this.patrolPoints[0];
      this.targetX = point.x;
      this.targetY = point.y;
    }
  }

  // Advance to next patrol point
  public nextPatrolPoint(): void {
    if (this.patrolPoints.length === 0) {
      this.state = 'idle';
      return;
    }

    this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length;
    const point = this.patrolPoints[this.patrolIndex];
    this.targetX = point.x;
    this.targetY = point.y;
  }

  // Check if unit has queued commands
  public hasQueuedCommands(): boolean {
    return this.commandQueue.length > 0;
  }

  // ==================== TRANSFORM MECHANICS ====================

  // Start transforming to a new mode
  public startTransform(targetMode: string): boolean {
    if (!this.canTransform) return false;
    if (this.state === 'transforming') return false;

    const mode = this.transformModes.find(m => m.id === targetMode);
    if (!mode) return false;
    if (this.currentMode === targetMode) return false;

    this.transformTargetMode = targetMode;
    this.transformProgress = 0;
    this.state = 'transforming';
    this.currentSpeed = 0; // Stop moving during transform
    return true;
  }

  // Update transform progress, returns true when complete
  public updateTransform(deltaTime: number): boolean {
    if (this.state !== 'transforming' || !this.transformTargetMode) return false;

    const mode = this.transformModes.find(m => m.id === this.transformTargetMode);
    if (!mode) {
      this.state = 'idle';
      this.transformTargetMode = null;
      return false;
    }

    this.transformProgress += deltaTime / mode.transformTime;

    if (this.transformProgress >= 1) {
      this.completeTransform();
      return true;
    }

    return false;
  }

  // Complete the transformation and apply new stats
  public completeTransform(): void {
    if (!this.transformTargetMode) return;

    const mode = this.transformModes.find(m => m.id === this.transformTargetMode);
    if (!mode) return;

    // Apply new mode stats
    this.currentMode = this.transformTargetMode;
    this.speed = mode.speed;
    this.maxSpeed = mode.speed;
    this.attackRange = mode.attackRange;
    this.attackDamage = mode.attackDamage;
    this.attackSpeed = mode.attackSpeed;
    this.splashRadius = mode.splashRadius ?? 0;
    this.sightRange = mode.sightRange;
    this.isFlying = mode.isFlying ?? false;

    // Apply targeting restrictions from mode (default: can attack ground if has damage)
    const hasDamage = mode.attackDamage > 0;
    this.canAttackGround = mode.canAttackGround ?? hasDamage;
    this.canAttackAir = mode.canAttackAir ?? false;

    // Reset transform state
    this.transformTargetMode = null;
    this.transformProgress = 0;
    this.state = 'idle';
  }

  // Get current mode info
  public getCurrentMode(): TransformMode | undefined {
    return this.transformModes.find(m => m.id === this.currentMode);
  }

  // Check if unit can move in current mode
  public canMoveInCurrentMode(): boolean {
    if (!this.canTransform) return true;
    const mode = this.getCurrentMode();
    return mode?.canMove ?? true;
  }

  // ==================== CLOAK MECHANICS ====================

  public toggleCloak(): boolean {
    if (!this.canCloak) return false;
    this.isCloaked = !this.isCloaked;
    return true;
  }

  public setCloak(cloaked: boolean): void {
    if (this.canCloak) {
      this.isCloaked = cloaked;
    }
  }

  // ==================== TRANSPORT MECHANICS ====================

  // Load a unit into this transport
  public loadUnit(unitId: number): boolean {
    if (!this.isTransport) return false;
    if (this.loadedUnits.length >= this.transportCapacity) return false;
    if (this.loadedUnits.includes(unitId)) return false;

    this.loadedUnits.push(unitId);
    return true;
  }

  // Unload a specific unit
  public unloadUnit(unitId: number): boolean {
    const index = this.loadedUnits.indexOf(unitId);
    if (index === -1) return false;

    this.loadedUnits.splice(index, 1);
    return true;
  }

  // Unload all units
  public unloadAll(): number[] {
    const units = [...this.loadedUnits];
    this.loadedUnits = [];
    return units;
  }

  // Get remaining capacity
  public getRemainingCapacity(): number {
    return this.transportCapacity - this.loadedUnits.length;
  }

  // ==================== HEALING/REPAIR MECHANICS ====================

  public setHealTarget(targetId: number): void {
    if (!this.canHeal) return;
    this.healTargetId = targetId;
  }

  public setRepairTarget(targetId: number): void {
    if (!this.canRepair) return;
    // Clear any gathering state to prevent ResourceSystem interference
    if (this.state === 'gathering') {
      this.gatherTargetId = null;
      this.isMining = false;
    }
    this.repairTargetId = targetId;
    this.isRepairing = true;
    this.state = 'idle'; // Use idle state so movement works and ResourceSystem doesn't interfere
  }

  public clearHealTarget(): void {
    this.healTargetId = null;
  }

  public clearRepairTarget(): void {
    this.repairTargetId = null;
    this.isRepairing = false;
  }

  // ==================== CONSTRUCTION MECHANICS ====================

  // Start building - worker moves to location then constructs
  public startBuilding(buildingType: string, targetX: number, targetY: number): void {
    if (!this.isWorker) return;
    this.buildingType = buildingType;
    this.buildTargetX = targetX;
    this.buildTargetY = targetY;
    this.constructingBuildingId = null; // Will be set when building is placed
    this.state = 'building';
    this.targetX = targetX;
    this.targetY = targetY;
    // Clear any existing path so worker will request new path to construction site
    this.path = [];
    this.pathIndex = 0;
    this.gatherTargetId = null;
    this.carryingMinerals = 0;
    this.carryingVespene = 0;
  }

  // Assign this worker to an existing construction site
  public assignToConstruction(buildingEntityId: number): void {
    if (!this.isWorker) return;
    this.constructingBuildingId = buildingEntityId;
    this.state = 'building';
  }

  // Cancel construction task
  public cancelBuilding(): void {
    this.constructingBuildingId = null;
    this.buildTargetX = null;
    this.buildTargetY = null;
    this.buildingType = null;
    this.wallLineId = null;
    this.wallLineSegments = [];
    this.state = 'idle';
    this.targetX = null;
    this.targetY = null;
    this.isHelperWorker = false;
    this.returnPositionX = null;
    this.returnPositionY = null;
  }

  // Check if worker is actively constructing (near building site)
  public isActivelyConstructing(): boolean {
    return this.state === 'building' && this.constructingBuildingId !== null;
  }

  // ==================== BUFF MECHANICS ====================

  public applyBuff(buffId: string, duration: number, effects: Record<string, number>): void {
    this.activeBuffs.set(buffId, { duration, effects });
  }

  public removeBuff(buffId: string): void {
    this.activeBuffs.delete(buffId);
  }

  public hasBuff(buffId: string): boolean {
    return this.activeBuffs.has(buffId);
  }

  public getBuffEffect(effectName: string): number {
    let totalEffect = 0;
    for (const buff of this.activeBuffs.values()) {
      if (buff.effects[effectName]) {
        totalEffect += buff.effects[effectName];
      }
    }
    return totalEffect;
  }

  public updateBuffs(deltaTime: number): string[] {
    const expiredBuffs: string[] = [];
    for (const [buffId, buff] of this.activeBuffs) {
      buff.duration -= deltaTime;
      if (buff.duration <= 0) {
        expiredBuffs.push(buffId);
      }
    }
    for (const buffId of expiredBuffs) {
      this.activeBuffs.delete(buffId);
    }
    return expiredBuffs;
  }

  // Get effective speed including buffs
  public getEffectiveSpeed(): number {
    const speedBonus = this.getBuffEffect('moveSpeedBonus');
    return this.speed * (1 + speedBonus);
  }

  // Get effective attack speed including buffs
  public getEffectiveAttackSpeed(): number {
    const attackSpeedBonus = this.getBuffEffect('attackSpeedBonus');
    return this.attackSpeed * (1 + attackSpeedBonus);
  }

  // Get effective damage including buffs
  public getEffectiveDamage(): number {
    const damageBonus = this.getBuffEffect('damageBonus');
    return this.attackDamage * (1 + damageBonus);
  }
}

/**
 * Unit Component Types
 *
 * All type definitions for the Unit ECS component.
 * Extracted from Unit.ts for modularity.
 */

export type UnitState =
  | 'idle'
  | 'moving'
  | 'attackmoving'
  | 'attacking'
  | 'gathering'
  | 'building'
  | 'dead'
  | 'patrolling'
  | 'transforming'
  | 'loaded';

export type DamageType = 'normal' | 'explosive' | 'concussive' | 'psionic' | 'torpedo';

export type MovementDomain = 'ground' | 'water' | 'amphibious' | 'air';

/**
 * Transform mode definitions for units that can transform between forms
 */
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

/**
 * Audio configuration for a unit - references voice groups and sound IDs from config files
 */
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

/**
 * Complete unit definition for creating new units
 */
export interface UnitDefinition {
  id: string;
  name: string;
  description?: string;
  faction: string;
  mineralCost: number;
  plasmaCost: number;
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
  // Energy system (for ability-using units like Dreadnought)
  maxEnergy?: number; // max energy pool
  energyRegen?: number; // energy regenerated per second
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
  // Movement domain - determines which terrain/navmesh the unit uses
  // ground: land only, water: naval only, amphibious: both, air: ignores terrain
  // If not set, defaults to 'ground' (or 'air' if isFlying is true)
  movementDomain?: MovementDomain;
  // Can attack naval units (ships, submarines)
  // If not set, defaults to true for naval units, false otherwise
  canAttackNaval?: boolean;
  // Is this a naval unit (for targeting purposes)
  isNaval?: boolean;
  // Submarine-specific mechanics
  isSubmarine?: boolean;
  canSubmerge?: boolean;
  submergedSpeed?: number; // Speed when submerged (typically slower)
}

/**
 * Command queue entry for shift-click queuing
 */
export interface QueuedCommand {
  type: 'move' | 'attack' | 'attackmove' | 'patrol' | 'gather' | 'build';
  targetX?: number;
  targetY?: number;
  targetEntityId?: number;
  // For build commands
  buildingType?: string;
  buildingEntityId?: number; // Entity ID of already-placed blueprint
}

/**
 * Buff data structure for tracking active buffs on a unit
 */
export interface BuffData {
  duration: number;
  effects: Record<string, number>;
}

/**
 * Constructor type for mixin pattern
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T;

/**
 * Complete interface declaring all Unit properties.
 * This enables proper TypeScript inference for Partial<Unit> and other utilities.
 */
export interface UnitFields {
  // Component base
  readonly type: 'Unit';

  // Core identity (UnitCore)
  unitId: string;
  name: string;
  faction: string;
  state: UnitState;

  // Movement (UnitCore)
  speed: number;
  maxSpeed: number;
  currentSpeed: number;
  acceleration: number;
  deceleration: number;
  targetX: number | null;
  targetY: number | null;
  path: Array<{ x: number; y: number }>;
  pathIndex: number;

  // Collision (UnitCore)
  collisionRadius: number;

  // Domain (UnitCore)
  movementDomain: MovementDomain;
  isNaval: boolean;

  // Flags (UnitCore)
  isFlying: boolean;
  isHoldingPosition: boolean;
  isBiological: boolean;
  isMechanical: boolean;

  // Combat awareness decay (UnitCore)
  isNearFriendlyCombat: boolean;
  lastNearCombatTick: number;

  // Vision (UnitCore)
  sightRange: number;

  // Buff fields (BuffMixin)
  activeBuffs: Map<string, BuffData>;

  // Cloak fields (CloakMixin)
  canCloak: boolean;
  isCloaked: boolean;
  cloakEnergyCost: number;
  isDetector: boolean;
  detectionRange: number;

  // Submarine fields (SubmarineMixin)
  isSubmarine: boolean;
  canSubmerge: boolean;
  isSubmerged: boolean;
  submergedSpeed: number;

  // Transport fields (TransportMixin)
  isTransport: boolean;
  transportCapacity: number;
  loadedUnits: number[];

  // Worker fields (WorkerMixin)
  isWorker: boolean;
  carryingMinerals: number;
  carryingPlasma: number;
  gatherTargetId: number | null;
  miningTimer: number;
  isMining: boolean;
  constructingBuildingId: number | null;
  buildTargetX: number | null;
  buildTargetY: number | null;
  buildingType: string | null;
  isHelperWorker: boolean;
  returnPositionX: number | null;
  returnPositionY: number | null;
  previousGatherTargetId: number | null;
  wallLineId: number | null;
  wallLineSegments: number[];

  // HealRepair fields (HealRepairMixin)
  canHeal: boolean;
  healRange: number;
  healRate: number;
  healEnergyCost: number;
  canRepair: boolean;
  isRepairing: boolean;
  repairTargetId: number | null;
  healTargetId: number | null;
  autocastRepair: boolean;

  // CommandQueue fields (CommandQueueMixin)
  commandQueue: QueuedCommand[];
  patrolPoints: Array<{ x: number; y: number }>;
  patrolIndex: number;
  assaultDestination: { x: number; y: number } | null;
  isInAssaultMode: boolean;
  assaultIdleTicks: number;

  // Combat fields (CombatMixin)
  attackRange: number;
  attackDamage: number;
  attackSpeed: number;
  damageType: DamageType;
  lastAttackTime: number;
  targetEntityId: number | null;
  splashRadius: number;
  projectileType: string;
  canAttackGround: boolean;
  canAttackAir: boolean;
  canAttackNaval: boolean;
  canAttackWhileMoving: boolean;

  // Transform fields (TransformMixin)
  canTransform: boolean;
  transformModes: TransformMode[];
  currentMode: string;
  transformProgress: number;
  transformTargetMode: string | null;
}

/**
 * Complete interface declaring all Unit methods.
 * Combined with UnitFields via interface merging on the Unit class.
 */
export interface UnitMethods {
  // UnitCore methods
  setMoveTarget(x: number, y: number, preserveState?: boolean): void;
  moveToPosition(x: number, y: number): void;
  setPath(path: Array<{ x: number; y: number }>): void;
  clearTarget(): void;
  stop(): void;

  // BuffMixin methods
  applyBuff(buffId: string, duration: number, effects: Record<string, number>): void;
  removeBuff(buffId: string): void;
  hasBuff(buffId: string): boolean;
  getBuffEffect(effectName: string): number;
  updateBuffs(deltaTime: number): string[];
  getEffectiveSpeed(): number;
  getEffectiveAttackSpeed(): number;
  getEffectiveDamage(): number;

  // CloakMixin methods
  toggleCloak(): boolean;
  setCloak(cloaked: boolean): void;

  // SubmarineMixin methods
  toggleSubmerge(): boolean;
  setSubmerged(submerged: boolean): void;
  getEffectiveSpeedForDomain(): number;

  // TransportMixin methods
  loadUnit(unitId: number): boolean;
  unloadUnit(unitId: number): boolean;
  unloadAll(): number[];
  getRemainingCapacity(): number;

  // WorkerMixin methods
  setGatherTarget(targetEntityId: number): void;
  startBuilding(buildingType: string, targetX: number, targetY: number): void;
  assignToConstruction(buildingEntityId: number): void;
  cancelBuilding(): void;
  isActivelyConstructing(): boolean;

  // HealRepairMixin methods
  setHealTarget(targetId: number): void;
  setRepairTarget(targetId: number): void;
  clearHealTarget(): void;
  clearRepairTarget(): void;

  // CommandQueueMixin methods
  queueCommand(command: QueuedCommand): void;
  executeNextCommand(): boolean;
  hasQueuedCommands(): boolean;
  setPatrol(startX: number, startY: number, endX: number, endY: number): void;
  addPatrolPoint(x: number, y: number): void;
  nextPatrolPoint(): void;

  // CombatMixin methods
  setAttackTarget(entityId: number): void;
  setAttackTargetWhileMoving(entityId: number): void;
  setAttackMoveTarget(x: number, y: number): void;
  canAttack(gameTime: number): boolean;
  canAttackTarget(targetIsFlying: boolean, targetIsNaval?: boolean): boolean;
  holdPosition(): void;

  // TransformMixin methods
  startTransform(targetMode: string): boolean;
  updateTransform(deltaTime: number): boolean;
  completeTransform(): void;
  getCurrentMode(): TransformMode | undefined;
  canMoveInCurrentMode(): boolean;
}

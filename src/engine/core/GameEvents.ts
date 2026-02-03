/**
 * GameEvents - Typed event data interfaces for EventBus
 *
 * Provides type safety for all game events emitted through the EventBus.
 * These interfaces replace 'any' type usage in event handlers.
 *
 * Event naming convention: "category:action" (e.g., "combat:attack", "unit:died")
 */

import type { DamageType } from '../components/Unit';

// ============================================================================
// COMBAT EVENTS
// ============================================================================

/** Data for combat:attack event */
export interface CombatAttackEventData {
  /** Unit type ID of the attacker (e.g., "trooper", "valkyrie") */
  attackerId: string;
  /** Entity ID of the attacker */
  attackerEntityId: number;
  /** World position of the attacker */
  attackerPos: { x: number; y: number };
  /** Entity ID of the target */
  targetId: number;
  /** World position of the target */
  targetPos: { x: number; y: number };
  /** Unit type ID of the target (if unit) */
  targetUnitType?: string;
  /** Damage dealt */
  damage: number;
  /** Type of damage */
  damageType: DamageType;
  /** Height of target (for buildings) */
  targetHeight: number;
  /** Player ID of target owner */
  targetPlayerId?: string;
  /** Whether attacker is flying */
  attackerIsFlying: boolean;
  /** Whether target is flying */
  targetIsFlying: boolean;
  /** Faction of the attacker */
  attackerFaction: string;
}

/** Data for damage:dealt event (used by damage number UI) */
export interface DamageDealtEventData {
  /** Target entity ID */
  targetId: number;
  /** Damage amount */
  damage: number;
  /** Target world position */
  targetPos: { x: number; y: number };
  /** Target height (for buildings) */
  targetHeight: number;
  /** Whether this killed the target */
  isKillingBlow: boolean;
  /** Whether this was a critical hit */
  isCritical?: boolean;
  /** Whether target is flying */
  targetIsFlying: boolean;
  /** Target unit type ID */
  targetUnitType?: string;
  /** Target player ID */
  targetPlayerId?: string;
}

/** Data for combat:splash event */
export interface CombatSplashEventData {
  /** Impact position */
  position: { x: number; y: number };
  /** Splash damage amount */
  damage: number;
}

/** Data for combat:miss event */
export interface CombatMissEventData {
  /** Attacker unit type ID */
  attackerId: string;
  /** Attacker position */
  attackerPos: { x: number; y: number };
  /** Target position */
  targetPos: { x: number; y: number };
  /** Reason for miss */
  reason: string;
}

// ============================================================================
// PROJECTILE EVENTS
// ============================================================================

/** Data for projectile:spawned event */
export interface ProjectileSpawnedEventData {
  /** Projectile entity ID */
  entityId: number;
  /** Starting position */
  startPos: { x: number; y: number; z: number };
  /** Target position */
  targetPos: { x: number; y: number; z: number };
  /** Projectile type ID */
  projectileType: string;
  /** Source faction for visual styling */
  faction: string;
  /** Trail effect type */
  trailType?: string;
}

/** Data for projectile:impact event */
export interface ProjectileImpactEventData {
  /** Projectile entity ID */
  entityId: number;
  /** Impact position */
  position: { x: number; y: number; z: number };
  /** Damage type for impact effect */
  damageType: DamageType;
  /** Splash radius (0 for no splash) */
  splashRadius: number;
  /** Source faction for visual styling */
  faction: string;
}

// ============================================================================
// UNIT EVENTS
// ============================================================================

/** Data for unit:died event */
export interface UnitDiedEventData {
  /** Entity ID of the dead unit */
  entityId: number;
  /** Death position */
  position: { x: number; y: number };
  /** Whether this was a player-owned unit */
  isPlayerUnit?: boolean;
  /** Whether unit was flying */
  isFlying: boolean;
  /** Unit type ID */
  unitType: string;
  /** Owner player ID */
  playerId?: string;
  /** Faction of the unit */
  faction?: string;
}

/** Data for unit:trained event */
export interface UnitTrainedEventData {
  /** Entity ID of the new unit */
  entityId: number;
  /** Unit type ID */
  unitType: string;
  /** Owner player ID */
  playerId: string;
  /** Spawn position */
  position: { x: number; y: number };
}

/** Data for unit:destroyed event (for cleanup) */
export interface UnitDestroyedEventData {
  /** Entity ID */
  entityId: number;
  /** Death position */
  x: number;
  y: number;
  /** Unit type ID */
  unitId?: string;
  /** Owner player ID */
  playerId?: string;
}

// ============================================================================
// BUILDING EVENTS
// ============================================================================

/** Data for building:destroyed event */
export interface BuildingDestroyedEventData {
  /** Entity ID */
  entityId: number;
  /** Owner player ID */
  playerId: string;
  /** Building type ID */
  buildingType: string;
  /** Position */
  position: { x: number; y: number };
  /** Building dimensions */
  width: number;
  height: number;
  /** Faction */
  faction?: string;
}

/** Data for building:complete event */
export interface BuildingCompleteEventData {
  /** Entity ID */
  entityId: number;
  /** Building type ID */
  buildingType: string;
  /** Owner player ID */
  playerId: string;
  /** Position */
  position: { x: number; y: number };
}

/** Data for building:placed event */
export interface BuildingPlacedEventData {
  /** Entity ID */
  entityId: number;
  /** Building type ID */
  buildingType: string;
  /** Owner player ID */
  playerId: string;
  /** Position */
  position: { x: number; y: number };
  /** Building dimensions */
  width: number;
  height: number;
}

/** Data for building:constructionStarted event */
export interface BuildingConstructionStartedEventData {
  /** Entity ID */
  entityId: number;
  /** Position */
  position: { x: number; y: number };
  /** Building dimensions */
  width: number;
  height: number;
}

// ============================================================================
// UPGRADE/RESEARCH EVENTS
// ============================================================================

/** Data for upgrade:complete event */
export interface UpgradeCompleteEventData {
  /** Upgrade ID */
  upgradeId: string;
  /** Owner player ID */
  playerId: string;
}

/** Data for research:complete event */
export interface ResearchCompleteEventData {
  /** Research ID */
  researchId: string;
  /** Owner player ID */
  playerId: string;
}

// ============================================================================
// ABILITY EVENTS
// ============================================================================

/** Data for ability:used event */
export interface AbilityUsedEventData {
  /** Ability ID */
  abilityId: string;
  /** Caster entity ID */
  casterId: number;
  /** Caster unit type */
  casterType: string;
  /** Cast position */
  position: { x: number; y: number };
  /** Target entity ID (for targeted abilities) */
  targetId?: number;
  /** Target position (for ground-targeted abilities) */
  targetPosition?: { x: number; y: number };
}

// ============================================================================
// ALERT EVENTS
// ============================================================================

/** Data for alert:triggered event */
export interface AlertTriggeredEventData {
  /** Alert type */
  alertType: string;
  /** Alert position */
  position: { x: number; y: number };
  /** Player to notify */
  playerId: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

/** Data for alert:underAttack event */
export interface AlertUnderAttackEventData {
  /** Player being attacked */
  playerId: string;
  /** Attack location */
  position: { x: number; y: number };
  /** Game time of attack */
  time: number;
}

// ============================================================================
// GAME STATE EVENTS
// ============================================================================

/** Data for game:over event */
export interface GameOverEventData {
  /** Winning player ID */
  winnerId: string;
  /** Win reason */
  reason: string;
}

/** Data for game:tick event */
export interface GameTickEventData {
  /** Current tick number */
  tick: number;
  /** Delta time in ms */
  deltaTime: number;
}

/** Data for game:started event */
export interface GameStartedEventData {
  /** Starting tick (usually 0) */
  tick: number;
}

/** Data for game:paused event */
export interface GamePausedEventData {
  /** Tick when paused */
  tick: number;
}

/** Data for game:resumed event */
export interface GameResumedEventData {
  /** Tick when resumed */
  tick: number;
}

/** Data for game:ended event */
export interface GameEndedEventData {
  /** Final tick */
  tick: number;
}

/** Data for game:countdown event */
export interface GameCountdownEventData {
  /** Scheduled start time (Date.now() value) */
  startTime: number;
}

// ============================================================================
// SELECTION EVENTS
// ============================================================================

/** Data for selection:changed event */
export interface SelectionChangedEventData {
  /** Selected entity IDs */
  selectedIds: number[];
}

// ============================================================================
// COMMAND EVENTS
// ============================================================================

/** Data for command:move event */
export interface CommandMoveEventData {
  /** Entity IDs to move */
  entityIds: number[];
  /** Target position */
  targetX: number;
  targetY: number;
  /** Player issuing command */
  playerId?: string;
  /** Whether to queue the command */
  queue?: boolean;
}

/** Data for command:attack event */
export interface CommandAttackEventData {
  /** Entity IDs to attack with */
  entityIds: number[];
  /** Target entity ID (for attack target) */
  targetEntityId?: number;
  /** Target position (for attack-move) */
  targetPosition?: { x: number; y: number };
  /** Player issuing command */
  playerId?: string;
  /** Whether to queue the command */
  queue?: boolean;
}

/** Data for command:stop event */
export interface CommandStopEventData {
  /** Entity IDs to stop */
  entityIds: number[];
}

/** Data for command:hold event */
export interface CommandHoldEventData {
  /** Entity IDs to hold position */
  entityIds: number[];
}

// ============================================================================
// MULTIPLAYER EVENTS
// ============================================================================

/** Data for multiplayer:desync event */
export interface MultiplayerDesyncEventData {
  /** Tick when desync was detected */
  tick: number;
  /** Local checksum */
  localChecksum: number;
  /** Remote checksum */
  remoteChecksum: number;
  /** Reason for desync */
  message: string;
}

/** Data for checksum:computed event */
export interface ChecksumComputedEventData {
  /** Tick number */
  tick: number;
  /** Computed checksum */
  checksum: number;
  /** Unit count */
  unitCount: number;
  /** Building count */
  buildingCount: number;
  /** Total resources */
  resourceSum: number;
}

/** Data for network:checksum event */
export interface NetworkChecksumEventData {
  /** Tick number */
  tick: number;
  /** Checksum value */
  checksum: number;
  /** Unit count */
  unitCount: number;
  /** Building count */
  buildingCount: number;
  /** Resource sum */
  resourceSum: number;
  /** Peer ID */
  peerId: string;
}

/** Data for desync:detected event */
export interface DesyncDetectedEventData {
  /** Tick when desync detected */
  tick: number;
  /** Local checksum */
  localChecksum: number;
  /** Remote checksum */
  remoteChecksum: number;
  /** Remote peer ID */
  remotePeerId: string;
  /** Optional reason */
  reason?: string;
}

// ============================================================================
// VISION EVENTS
// ============================================================================

/** Data for vision:reveal event */
export interface VisionRevealEventData {
  /** Player receiving vision */
  playerId: string;
  /** Reveal center */
  position: { x: number; y: number };
  /** Reveal radius */
  radius: number;
  /** Duration in seconds */
  duration: number;
}

/** Data for unit:detected event (cloaked unit detection) */
export interface UnitDetectedEventData {
  /** Detected entity ID */
  entityId: number;
  /** Player who detected */
  detectedBy: string;
  /** Detection position */
  position: { x: number; y: number };
}

// ============================================================================
// PRODUCTION EVENTS
// ============================================================================

/** Data for production:started event */
export interface ProductionStartedEventData {
  /** Building entity ID */
  buildingId: number;
  /** Unit type being produced */
  unitType: string;
  /** Owner player ID */
  playerId: string;
}

/** Data for production:complete event */
export interface ProductionCompleteEventData {
  /** Unit type produced */
  unitType: string;
  /** Owner player ID */
  playerId: string;
  /** Building entity ID */
  buildingId?: number;
}

// ============================================================================
// PATHFINDING EVENTS
// ============================================================================

/** Data for pathfinding:request event */
export interface PathfindingRequestEventData {
  /** Entity ID requesting path */
  entityId: number;
  /** Target X coordinate */
  targetX: number;
  /** Target Y coordinate */
  targetY: number;
  /** Optional priority */
  priority?: number;
}

// ============================================================================
// PLAYER DAMAGE EVENT (UI overlay)
// ============================================================================

/** Data for player:damage event */
export interface PlayerDamageEventData {
  /** Damage amount */
  damage: number;
  /** Damage position */
  position: { x: number; y: number };
}

// ============================================================================
// GAME EVENT MAP (for type-safe EventBus)
// ============================================================================

/**
 * Maps event names to their data types.
 * Can be used to make EventBus generic for type-safe subscriptions.
 */
export interface GameEventMap {
  // Combat events
  'combat:attack': CombatAttackEventData;
  'combat:splash': CombatSplashEventData;
  'combat:miss': CombatMissEventData;
  'damage:dealt': DamageDealtEventData;

  // Projectile events
  'projectile:spawned': ProjectileSpawnedEventData;
  'projectile:impact': ProjectileImpactEventData;

  // Unit events
  'unit:died': UnitDiedEventData;
  'unit:trained': UnitTrainedEventData;
  'unit:destroyed': UnitDestroyedEventData;
  'unit:detected': UnitDetectedEventData;

  // Building events
  'building:destroyed': BuildingDestroyedEventData;
  'building:complete': BuildingCompleteEventData;
  'building:placed': BuildingPlacedEventData;
  'building:constructionStarted': BuildingConstructionStartedEventData;

  // Upgrade/research events
  'upgrade:complete': UpgradeCompleteEventData;
  'research:complete': ResearchCompleteEventData;

  // Ability events
  'ability:used': AbilityUsedEventData;

  // Alert events
  'alert:triggered': AlertTriggeredEventData;
  'alert:underAttack': AlertUnderAttackEventData;

  // Game state events
  'game:over': GameOverEventData;
  'game:tick': GameTickEventData;
  'game:started': GameStartedEventData;
  'game:paused': GamePausedEventData;
  'game:resumed': GameResumedEventData;
  'game:ended': GameEndedEventData;
  'game:countdown': GameCountdownEventData;

  // Selection events
  'selection:changed': SelectionChangedEventData;

  // Command events
  'command:move': CommandMoveEventData;
  'command:attack': CommandAttackEventData;
  'command:stop': CommandStopEventData;
  'command:hold': CommandHoldEventData;

  // Multiplayer events
  'multiplayer:desync': MultiplayerDesyncEventData;
  'checksum:computed': ChecksumComputedEventData;
  'network:checksum': NetworkChecksumEventData;
  'desync:detected': DesyncDetectedEventData;

  // Vision events
  'vision:reveal': VisionRevealEventData;

  // Production events
  'production:started': ProductionStartedEventData;
  'production:complete': ProductionCompleteEventData;

  // Pathfinding events
  'pathfinding:request': PathfindingRequestEventData;

  // Player damage
  'player:damage': PlayerDamageEventData;
}

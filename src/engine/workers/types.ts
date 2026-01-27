/**
 * Game Worker Types
 *
 * Defines the data structures for communication between the main thread
 * and the game worker. Uses efficient serialization with typed arrays
 * where performance is critical.
 */

import type { UnitState, DamageType, MovementDomain } from '../components/Unit';
import type { BuildingState, AddonType, ProductionQueueItem } from '../components/Building';
import type { ResourceType } from '../components/Resource';
import type { ArmorType } from '../components/Health';
import type { GameState, TerrainCell, GameConfig } from '../core/Game';
import type { AIDifficulty } from '../systems/EnhancedAISystem';

// ============================================================================
// RENDER STATE - Data transferred from worker to main thread for rendering
// ============================================================================

/**
 * Snapshot of a unit's render-relevant state.
 * Optimized for transfer - only includes data needed for rendering.
 */
export interface UnitRenderState {
  id: number;
  // Transform
  x: number;
  y: number;
  z: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  // Previous transform for interpolation
  prevX: number;
  prevY: number;
  prevZ: number;
  prevRotation: number;
  // Unit info
  unitId: string;
  faction: string;
  state: UnitState;
  isFlying: boolean;
  isSubmerged: boolean;
  isCloaked: boolean;
  // Health
  health: number;
  maxHealth: number;
  shield: number;
  maxShield: number;
  isDead: boolean;
  // Selection
  playerId: string;
  isSelected: boolean;
  controlGroup: number | null;
  // Combat visual info
  targetEntityId: number | null;
  lastAttackTime: number;
  // Worker visual info
  isWorker: boolean;
  carryingMinerals: number;
  carryingVespene: number;
  isMining: boolean;
  // Transform mode
  currentMode: string;
  transformProgress: number;
  // Repair visual
  isRepairing: boolean;
  repairTargetId: number | null;
  // Buff indicators
  hasSpeedBuff: boolean;
  hasDamageBuff: boolean;
}

/**
 * Snapshot of a building's render-relevant state.
 */
export interface BuildingRenderState {
  id: number;
  // Transform
  x: number;
  y: number;
  z: number;
  rotation: number;
  // Building info
  buildingId: string;
  faction: string;
  state: BuildingState;
  buildProgress: number;
  width: number;
  height: number;
  // Health
  health: number;
  maxHealth: number;
  isDead: boolean;
  // Selection
  playerId: string;
  isSelected: boolean;
  // Flying state
  isFlying: boolean;
  liftProgress: number;
  // Addon
  currentAddon: AddonType;
  // Supply depot
  isLowered: boolean;
  // Production visual
  productionProgress: number;
  hasProductionQueue: boolean;
  // Rally point
  rallyX: number | null;
  rallyY: number | null;
}

/**
 * Snapshot of a resource's render-relevant state.
 */
export interface ResourceRenderState {
  id: number;
  // Transform
  x: number;
  y: number;
  z: number;
  // Resource info
  resourceType: ResourceType;
  amount: number;
  maxAmount: number;
  percentRemaining: number;
  // Gatherer count for saturation visual
  gathererCount: number;
  hasExtractor: boolean;
}

/**
 * Snapshot of a projectile's render-relevant state.
 */
export interface ProjectileRenderState {
  id: number;
  x: number;
  y: number;
  z: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  projectileType: string;
  faction: string;
  isActive: boolean;
}

/**
 * Complete render state for a single frame.
 * Sent from game worker to main thread every tick.
 */
export interface RenderState {
  tick: number;
  gameTime: number;
  gameState: GameState;
  interpolation: number;

  // Entity snapshots
  units: UnitRenderState[];
  buildings: BuildingRenderState[];
  resources: ResourceRenderState[];
  projectiles: ProjectileRenderState[];

  // Vision data (per-player fog of war)
  visionGrids: Map<string, Uint8Array>;

  // Player resources (for UI)
  playerResources: Map<string, {
    minerals: number;
    vespene: number;
    supply: number;
    maxSupply: number;
  }>;

  // Selection state
  selectedEntityIds: number[];
  controlGroups: Map<number, number[]>;
}

// ============================================================================
// GAME EVENTS - Events emitted from worker for audio/effects on main thread
// ============================================================================

export interface CombatAttackEvent {
  type: 'combat:attack';
  attackerId: number;
  attackerType: string;
  attackerPos: { x: number; y: number };
  targetPos: { x: number; y: number };
  targetId?: number;
  targetUnitType?: string;
  damage: number;
  damageType: DamageType;
  attackerIsFlying: boolean;
  targetIsFlying: boolean;
  attackerFaction: string;
}

export interface ProjectileSpawnEvent {
  type: 'projectile:spawned';
  entityId: number;
  startPos: { x: number; y: number; z: number };
  targetPos: { x: number; y: number; z: number };
  projectileType: string;
  faction: string;
  trailType?: string;
}

export interface ProjectileImpactEvent {
  type: 'projectile:impact';
  entityId: number;
  position: { x: number; y: number; z: number };
  damageType: DamageType;
  splashRadius: number;
  faction: string;
}

export interface UnitDiedEvent {
  type: 'unit:died';
  entityId: number;
  position: { x: number; y: number };
  isFlying: boolean;
  unitType: string;
  faction: string;
}

export interface BuildingDestroyedEvent {
  type: 'building:destroyed';
  entityId: number;
  playerId: string;
  buildingType: string;
  position: { x: number; y: number };
  faction: string;
}

export interface UnitTrainedEvent {
  type: 'unit:trained';
  entityId: number;
  unitType: string;
  playerId: string;
  position: { x: number; y: number };
}

export interface BuildingCompleteEvent {
  type: 'building:complete';
  entityId: number;
  buildingType: string;
  playerId: string;
  position: { x: number; y: number };
}

export interface UpgradeCompleteEvent {
  type: 'upgrade:complete';
  upgradeId: string;
  playerId: string;
}

export interface AbilityUsedEvent {
  type: 'ability:used';
  abilityId: string;
  casterId: number;
  casterType: string;
  position: { x: number; y: number };
  targetId?: number;
  targetPosition?: { x: number; y: number };
}

export interface SelectionChangedEvent {
  type: 'selection:changed';
  entityIds: number[];
  primaryType?: string;
  playerId: string;
}

export interface AlertEvent {
  type: 'alert';
  alertType: 'under_attack' | 'unit_ready' | 'research_complete' | 'resources_low' | 'base_destroyed';
  position?: { x: number; y: number };
  playerId: string;
  details?: string;
}

export type GameEvent =
  | CombatAttackEvent
  | ProjectileSpawnEvent
  | ProjectileImpactEvent
  | UnitDiedEvent
  | BuildingDestroyedEvent
  | UnitTrainedEvent
  | BuildingCompleteEvent
  | UpgradeCompleteEvent
  | AbilityUsedEvent
  | SelectionChangedEvent
  | AlertEvent;

// ============================================================================
// WORKER MESSAGES - Communication protocol between main thread and worker
// ============================================================================

/**
 * Messages sent FROM main thread TO game worker
 */
export type MainToWorkerMessage =
  | { type: 'init'; config: GameConfig; playerId: string }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'command'; command: GameCommand }
  | { type: 'setTerrain'; terrain: TerrainCell[][] }
  | { type: 'setNavMesh'; positions: Float32Array; indices: Uint32Array }
  | { type: 'setWaterNavMesh'; positions: Float32Array; indices: Uint32Array }
  | { type: 'setDecorations'; collisions: Array<{ x: number; z: number; radius: number }> }
  | { type: 'registerAI'; playerId: string; difficulty: AIDifficulty }
  | { type: 'multiplayerCommand'; command: GameCommand; fromPeerId: string }
  | { type: 'networkPause'; paused: boolean }
  | { type: 'requestChecksum' }
  | { type: 'setSelection'; entityIds: number[]; playerId: string }
  | { type: 'setControlGroup'; groupNumber: number; entityIds: number[] }
  | { type: 'spawnEntities'; mapData: SpawnMapData };

/**
 * Player slot info for spawning
 */
export interface PlayerSlotInfo {
  id: string;
  type: 'human' | 'ai' | 'empty';
  faction: string;
  aiDifficulty?: 'easy' | 'medium' | 'hard' | 'insane';
}

/**
 * Map data needed for spawning entities in worker
 */
export interface SpawnMapData {
  width: number;
  height: number;
  name: string;
  spawns?: Array<{
    playerSlot: number;
    x: number;
    y: number;
  }>;
  resources?: Array<{
    type: 'mineral' | 'vespene';
    x: number;
    y: number;
    amount?: number;
  }>;
  watchTowers?: Array<{
    x: number;
    y: number;
    radius: number;
  }>;
  // Player slots with type and AI difficulty
  playerSlots?: PlayerSlotInfo[];
}

/**
 * Messages sent FROM game worker TO main thread
 */
export type WorkerToMainMessage =
  | { type: 'initialized'; success: boolean; error?: string }
  | { type: 'renderState'; state: RenderState }
  | { type: 'events'; events: GameEvent[] }
  | { type: 'checksum'; tick: number; checksum: string }
  | { type: 'gameOver'; winnerId: string | null; reason: string }
  | { type: 'error'; message: string; stack?: string }
  | { type: 'multiplayerCommand'; command: GameCommand }
  | { type: 'desync'; tick: number; localChecksum: string; remoteChecksum: string };

// ============================================================================
// GAME COMMAND - Commands sent from main thread to control game
// ============================================================================

export interface GameCommand {
  tick: number;
  playerId: string;
  type:
    | 'MOVE'
    | 'ATTACK'
    | 'ATTACK_MOVE'
    | 'BUILD'
    | 'TRAIN'
    | 'ABILITY'
    | 'STOP'
    | 'HOLD'
    | 'RESEARCH'
    | 'PATROL'
    | 'TRANSFORM'
    | 'CLOAK'
    | 'LOAD'
    | 'UNLOAD'
    | 'HEAL'
    | 'REPAIR'
    | 'DEMOLISH'
    | 'LIFTOFF'
    | 'LAND'
    | 'RALLY'
    | 'GATHER'
    | 'CANCEL_PRODUCTION'
    | 'CANCEL_RESEARCH'
    | 'CANCEL_BUILDING'
    | 'QUEUE_REORDER'
    | 'SUPPLY_DEPOT_LOWER'
    | 'SUPPLY_DEPOT_RAISE'
    | 'SET_AUTOCAST'
    | 'BUILD_WALL'
    | 'ADDON_LIFT'
    | 'ADDON_LAND'
    | 'SUBMERGE';
  entityIds: number[];
  targetPosition?: { x: number; y: number };
  targetEntityId?: number;
  buildingType?: string;
  unitType?: string;
  abilityId?: string;
  upgradeId?: string;
  queueIndex?: number;
  newQueueIndex?: number;
  targetIndex?: number;
  autocastEnabled?: boolean;
  wallPoints?: Array<{ x: number; y: number }>;
  shiftHeld?: boolean;
}

// ============================================================================
// TYPED ARRAY HELPERS - For efficient serialization
// ============================================================================

/**
 * Pack transform data into a Float32Array for efficient transfer.
 * Layout: [x, y, z, rotation, scaleX, scaleY, scaleZ, prevX, prevY, prevZ, prevRotation]
 * 11 floats = 44 bytes per entity
 */
export const TRANSFORM_FLOATS_PER_ENTITY = 11;

export function packTransforms(entities: Array<{ x: number; y: number; z: number; rotation: number; scaleX: number; scaleY: number; scaleZ: number; prevX: number; prevY: number; prevZ: number; prevRotation: number }>): Float32Array {
  const buffer = new Float32Array(entities.length * TRANSFORM_FLOATS_PER_ENTITY);
  let offset = 0;
  for (const e of entities) {
    buffer[offset++] = e.x;
    buffer[offset++] = e.y;
    buffer[offset++] = e.z;
    buffer[offset++] = e.rotation;
    buffer[offset++] = e.scaleX;
    buffer[offset++] = e.scaleY;
    buffer[offset++] = e.scaleZ;
    buffer[offset++] = e.prevX;
    buffer[offset++] = e.prevY;
    buffer[offset++] = e.prevZ;
    buffer[offset++] = e.prevRotation;
  }
  return buffer;
}

export function unpackTransform(buffer: Float32Array, index: number): {
  x: number; y: number; z: number; rotation: number;
  scaleX: number; scaleY: number; scaleZ: number;
  prevX: number; prevY: number; prevZ: number; prevRotation: number;
} {
  const offset = index * TRANSFORM_FLOATS_PER_ENTITY;
  return {
    x: buffer[offset],
    y: buffer[offset + 1],
    z: buffer[offset + 2],
    rotation: buffer[offset + 3],
    scaleX: buffer[offset + 4],
    scaleY: buffer[offset + 5],
    scaleZ: buffer[offset + 6],
    prevX: buffer[offset + 7],
    prevY: buffer[offset + 8],
    prevZ: buffer[offset + 9],
    prevRotation: buffer[offset + 10],
  };
}

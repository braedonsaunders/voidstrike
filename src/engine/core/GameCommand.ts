/**
 * GameCommand - Unified command type and dispatcher for game commands
 *
 * This module consolidates command handling shared between:
 * - Game.ts (main thread)
 * - GameWorker.ts (web worker)
 *
 * Commands are the primary way to control game entities in both single-player
 * and multiplayer modes. In multiplayer, commands are synchronized via lockstep.
 */

import type { EventBus } from './EventBus';

/**
 * All supported game command types
 */
export type GameCommandType =
  | 'MOVE'
  | 'ATTACK'
  | 'ATTACK_MOVE'
  | 'BUILD'
  | 'TRAIN'
  | 'ABILITY'
  | 'STOP'
  | 'HOLD'
  | 'RESEARCH'
  | 'TRANSFORM'
  | 'CLOAK'
  | 'LOAD'
  | 'UNLOAD'
  | 'LOAD_BUNKER'
  | 'UNLOAD_BUNKER'
  | 'HEAL'
  | 'REPAIR'
  | 'PATROL'
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
  | 'SUBMERGE'
  | 'HEARTBEAT'; // Lockstep sync - no-op command to acknowledge tick

/**
 * Game command structure for all player actions
 */
export interface GameCommand {
  /** Tick this command should execute on */
  tick: number;
  /** Player who issued the command */
  playerId: string;
  /** Command type */
  type: GameCommandType;
  /** Entity IDs this command affects */
  entityIds: number[];

  // Target information
  /** Target position for move/attack/build commands */
  targetPosition?: { x: number; y: number };
  /** Target entity for attack/heal/repair commands */
  targetEntityId?: number;

  // Build/Train specific
  /** Building type for BUILD commands */
  buildingType?: string;
  /** Unit type for TRAIN commands */
  unitType?: string;

  // Ability specific
  /** Ability ID for ABILITY commands */
  abilityId?: string;
  /** Upgrade ID for RESEARCH commands */
  upgradeId?: string;
  /** Target mode for TRANSFORM commands */
  targetMode?: string;

  // Transport/Bunker specific
  /** Transport entity ID for LOAD/UNLOAD commands */
  transportId?: number;
  /** Bunker entity ID for LOAD_BUNKER/UNLOAD_BUNKER commands */
  bunkerId?: number;
  /** Building entity ID for LIFTOFF/LAND/RALLY commands */
  buildingId?: number;

  // Production queue specific
  /** Queue index for CANCEL_PRODUCTION/QUEUE_REORDER commands */
  queueIndex?: number;
  /** New queue index for QUEUE_REORDER commands */
  newQueueIndex?: number;

  // Autocast specific
  /** Whether autocast is enabled for SET_AUTOCAST commands */
  autocastEnabled?: boolean;

  // Wall building specific
  /** Wall segment positions for BUILD_WALL commands */
  wallSegments?: Array<{ x: number; y: number }>;

  // Input modifiers
  /** Whether shift was held (for command queuing) */
  queue?: boolean;
  /** @deprecated Use `queue` instead */
  shiftHeld?: boolean;
}

/**
 * Event names for each command type
 */
const COMMAND_EVENTS: Record<GameCommandType, string> = {
  MOVE: 'command:move',
  ATTACK: 'command:attack',
  ATTACK_MOVE: 'command:attackMove',
  BUILD: 'command:build',
  TRAIN: 'command:train',
  ABILITY: 'command:ability',
  STOP: 'command:stop',
  HOLD: 'command:hold',
  RESEARCH: 'command:research',
  PATROL: 'command:patrol',
  TRANSFORM: 'command:transform',
  CLOAK: 'command:cloak',
  LOAD: 'command:load',
  UNLOAD: 'command:unload',
  LOAD_BUNKER: 'command:loadBunker',
  UNLOAD_BUNKER: 'command:unloadBunker',
  HEAL: 'command:heal',
  REPAIR: 'command:repair',
  DEMOLISH: 'command:demolish',
  LIFTOFF: 'command:liftOff',
  LAND: 'command:land',
  RALLY: 'command:rally',
  GATHER: 'command:gather',
  CANCEL_PRODUCTION: 'production:cancel',
  CANCEL_RESEARCH: 'research:cancel',
  CANCEL_BUILDING: 'building:cancel',
  QUEUE_REORDER: 'production:reorder',
  SUPPLY_DEPOT_LOWER: 'command:lowerSupplyDepot',
  SUPPLY_DEPOT_RAISE: 'command:raiseSupplyDepot',
  SET_AUTOCAST: 'ability:setAutocast',
  BUILD_WALL: 'wall:build',
  ADDON_LIFT: 'addon:lift',
  ADDON_LAND: 'addon:land',
  SUBMERGE: 'command:submerge',
  HEARTBEAT: 'command:heartbeat', // No-op for lockstep sync
};

/**
 * Dispatches a game command to the appropriate event handler via EventBus.
 *
 * This function transforms the command into the event payload format expected
 * by each system's event handlers, providing a consistent interface.
 *
 * @param eventBus The event bus to emit events on
 * @param command The game command to dispatch
 */
export function dispatchCommand(eventBus: EventBus, command: GameCommand): void {
  // Emit generic command event for logging/debugging
  eventBus.emit('command:received', command);

  // Build event payload based on command type
  switch (command.type) {
    case 'MOVE':
      eventBus.emit(COMMAND_EVENTS.MOVE, command);
      break;

    case 'ATTACK':
      eventBus.emit(COMMAND_EVENTS.ATTACK, command);
      break;

    case 'ATTACK_MOVE':
      eventBus.emit(COMMAND_EVENTS.ATTACK_MOVE, command);
      break;

    case 'BUILD':
      eventBus.emit(COMMAND_EVENTS.BUILD, command);
      break;

    case 'TRAIN':
      eventBus.emit(COMMAND_EVENTS.TRAIN, command);
      break;

    case 'ABILITY':
      eventBus.emit(COMMAND_EVENTS.ABILITY, command);
      break;

    case 'STOP':
      eventBus.emit(COMMAND_EVENTS.STOP, command);
      break;

    case 'HOLD':
      eventBus.emit(COMMAND_EVENTS.HOLD, command);
      break;

    case 'RESEARCH':
      eventBus.emit(COMMAND_EVENTS.RESEARCH, command);
      break;

    case 'PATROL':
      eventBus.emit(COMMAND_EVENTS.PATROL, command);
      break;

    case 'TRANSFORM':
      eventBus.emit(COMMAND_EVENTS.TRANSFORM, {
        entityIds: command.entityIds,
        targetMode: command.targetMode,
      });
      break;

    case 'CLOAK':
      eventBus.emit(COMMAND_EVENTS.CLOAK, {
        entityIds: command.entityIds,
      });
      break;

    case 'LOAD':
      eventBus.emit(COMMAND_EVENTS.LOAD, {
        transportId: command.transportId,
        unitIds: command.entityIds,
      });
      break;

    case 'UNLOAD':
      eventBus.emit(COMMAND_EVENTS.UNLOAD, {
        transportId: command.transportId,
        position: command.targetPosition,
        unitId: command.targetEntityId,
      });
      break;

    case 'LOAD_BUNKER':
      eventBus.emit(COMMAND_EVENTS.LOAD_BUNKER, {
        bunkerId: command.bunkerId,
        unitIds: command.entityIds,
      });
      break;

    case 'UNLOAD_BUNKER':
      eventBus.emit(COMMAND_EVENTS.UNLOAD_BUNKER, {
        bunkerId: command.bunkerId,
        unitId: command.targetEntityId,
      });
      break;

    case 'HEAL':
      eventBus.emit(COMMAND_EVENTS.HEAL, {
        healerId: command.entityIds[0],
        targetId: command.targetEntityId,
      });
      break;

    case 'REPAIR':
      eventBus.emit(COMMAND_EVENTS.REPAIR, {
        repairerId: command.entityIds[0],
        targetId: command.targetEntityId,
      });
      break;

    case 'PATROL':
      eventBus.emit(COMMAND_EVENTS.PATROL, command);
      break;

    case 'DEMOLISH':
      eventBus.emit(COMMAND_EVENTS.DEMOLISH, {
        entityIds: command.entityIds,
      });
      break;

    case 'LIFTOFF':
      eventBus.emit(COMMAND_EVENTS.LIFTOFF, {
        buildingId: command.buildingId ?? command.entityIds[0],
        playerId: command.playerId,
      });
      break;

    case 'LAND':
      eventBus.emit(COMMAND_EVENTS.LAND, {
        buildingId: command.buildingId ?? command.entityIds[0],
        position: command.targetPosition,
        playerId: command.playerId,
      });
      break;

    case 'RALLY':
      eventBus.emit(COMMAND_EVENTS.RALLY, {
        buildingId: command.buildingId ?? command.entityIds[0],
        targetPosition: command.targetPosition,
        targetEntityId: command.targetEntityId,
        playerId: command.playerId,
      });
      break;

    case 'GATHER':
      eventBus.emit(COMMAND_EVENTS.GATHER, {
        entityIds: command.entityIds,
        targetEntityId: command.targetEntityId,
        playerId: command.playerId,
        queue: command.queue,
      });
      break;

    case 'CANCEL_PRODUCTION':
      eventBus.emit(COMMAND_EVENTS.CANCEL_PRODUCTION, {
        entityId: command.entityIds[0],
        queueIndex: command.queueIndex ?? 0,
        playerId: command.playerId,
      });
      break;

    case 'CANCEL_RESEARCH':
      eventBus.emit(COMMAND_EVENTS.CANCEL_RESEARCH, {
        entityId: command.entityIds[0],
        playerId: command.playerId,
      });
      break;

    case 'CANCEL_BUILDING':
      eventBus.emit(COMMAND_EVENTS.CANCEL_BUILDING, {
        entityId: command.entityIds[0],
        playerId: command.playerId,
      });
      break;

    case 'QUEUE_REORDER':
      eventBus.emit(COMMAND_EVENTS.QUEUE_REORDER, {
        entityId: command.entityIds[0],
        queueIndex: command.queueIndex ?? 0,
        newQueueIndex: command.newQueueIndex ?? 0,
        playerId: command.playerId,
      });
      break;

    case 'SUPPLY_DEPOT_LOWER':
      eventBus.emit(COMMAND_EVENTS.SUPPLY_DEPOT_LOWER, {
        buildingId: command.entityIds[0],
        lower: true,
        playerId: command.playerId,
      });
      break;

    case 'SUPPLY_DEPOT_RAISE':
      eventBus.emit(COMMAND_EVENTS.SUPPLY_DEPOT_RAISE, {
        buildingId: command.entityIds[0],
        lower: false,
        playerId: command.playerId,
      });
      break;

    case 'SET_AUTOCAST':
      eventBus.emit(COMMAND_EVENTS.SET_AUTOCAST, {
        entityId: command.entityIds[0],
        abilityId: command.abilityId,
        enabled: command.autocastEnabled ?? false,
        playerId: command.playerId,
      });
      break;

    case 'BUILD_WALL':
      eventBus.emit(COMMAND_EVENTS.BUILD_WALL, {
        segments: command.wallSegments ?? [],
        playerId: command.playerId,
      });
      break;

    case 'ADDON_LIFT':
      eventBus.emit(COMMAND_EVENTS.ADDON_LIFT, {
        buildingId: command.buildingId ?? command.entityIds[0],
        playerId: command.playerId,
      });
      break;

    case 'ADDON_LAND':
      eventBus.emit(COMMAND_EVENTS.ADDON_LAND, {
        buildingId: command.buildingId ?? command.entityIds[0],
        targetPosition: command.targetPosition,
        playerId: command.playerId,
      });
      break;

    case 'SUBMERGE':
      eventBus.emit(COMMAND_EVENTS.SUBMERGE, {
        entityIds: command.entityIds,
        playerId: command.playerId,
      });
      break;

    case 'HEARTBEAT':
      // No-op command for lockstep sync - just acknowledges player is alive for this tick
      // The command:received event already fired at the start of dispatchCommand
      break;
  }
}

/**
 * Configuration for command queue management
 */
export interface CommandQueueConfig {
  /** Number of ticks to delay command execution (for lockstep sync) */
  commandDelayTicks: number;
}

/**
 * Command queue for managing lockstep multiplayer command execution.
 *
 * Commands are queued for future ticks to allow network synchronization
 * before execution. Both local and remote commands are queued and
 * processed in deterministic order.
 */
export class CommandQueue {
  private commandMap: Map<number, GameCommand[]> = new Map();
  private readonly commandDelayTicks: number;

  constructor(config: CommandQueueConfig) {
    this.commandDelayTicks = config.commandDelayTicks;
  }

  /**
   * Queue a command for execution at a specific tick
   */
  enqueue(command: GameCommand): void {
    const tick = command.tick;
    if (!this.commandMap.has(tick)) {
      this.commandMap.set(tick, []);
    }
    this.commandMap.get(tick)!.push(command);
  }

  /**
   * Get commands scheduled for a specific tick, sorted deterministically
   */
  getCommandsForTick(tick: number): GameCommand[] {
    const commands = this.commandMap.get(tick);
    if (!commands) return [];

    // Sort by player ID for deterministic ordering across all clients
    // Secondary sort by type and entityIds for complete determinism
    commands.sort((a, b) => {
      if (a.playerId !== b.playerId) {
        return a.playerId.localeCompare(b.playerId);
      }
      if (a.type !== b.type) {
        return a.type.localeCompare(b.type);
      }
      return (a.entityIds[0] ?? 0) - (b.entityIds[0] ?? 0);
    });

    return commands;
  }

  /**
   * Remove commands for a specific tick after processing
   */
  clearTick(tick: number): void {
    this.commandMap.delete(tick);
  }

  /**
   * Get all ticks that have stale (past) commands
   */
  getStaleTicks(currentTick: number): number[] {
    const staleTicks: number[] = [];
    for (const tick of this.commandMap.keys()) {
      if (tick < currentTick) {
        staleTicks.push(tick);
      }
    }
    return staleTicks;
  }

  /**
   * Calculate the execution tick for a new command
   */
  getExecutionTick(currentTick: number): number {
    return currentTick + this.commandDelayTicks;
  }

  /**
   * Clear all queued commands
   */
  clear(): void {
    this.commandMap.clear();
  }

  /**
   * Get the number of queued ticks
   */
  get size(): number {
    return this.commandMap.size;
  }
}

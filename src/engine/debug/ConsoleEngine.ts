/**
 * Console Engine
 *
 * Singleton that handles command parsing, execution, and console state management.
 * Provides a simple API for the console UI to interact with the game.
 */

import { Game } from '@/engine/core/Game';
import { RTSCamera } from '@/rendering/Camera';
import { RenderStateWorldAdapter } from '@/engine/workers/RenderStateAdapter';
import { getWorkerBridge } from '@/engine/workers/WorkerBridge';
import {
  CONSOLE_COMMANDS,
  COMMAND_MAP,
  getAllCommandNames,
  type ConsoleCommand,
  type CommandResult,
  type ParsedArgs,
  type GameContext,
  type ConsoleFlag,
  type CommandAction,
} from '@/config/consoleCommands';
import { getLocalPlayerId } from '@/store/gameSetupStore';
import { useGameStore } from '@/store/gameStore';
import { DefinitionRegistry } from '@/engine/definitions';

// Console output entry
export interface ConsoleEntry {
  id: string;
  type: 'input' | 'output' | 'error' | 'info' | 'success';
  text: string;
  timestamp: number;
}

// Console state flags
interface ConsoleFlags {
  godMode: boolean;
  fogDisabled: boolean;
  fastBuild: boolean;
  noCost: boolean;
  aiDisabled: boolean;
}

/**
 * ConsoleEngine - Singleton for debug console functionality
 */
export class ConsoleEngine {
  private static instance: ConsoleEngine | null = null;
  private static initPromise: Promise<ConsoleEngine> | null = null;

  // Console state
  private history: ConsoleEntry[] = [];
  private commandHistory: string[] = [];
  private commandHistoryIndex: number = -1;
  private maxHistorySize: number = 100;

  // Game references (set externally)
  private game: Game | null = null;
  private camera: RTSCamera | null = null;
  private cursorWorldPos: { x: number; y: number } | null = null;

  // Console flags
  private flags: ConsoleFlags = {
    godMode: false,
    fogDisabled: false,
    fastBuild: false,
    noCost: false,
    aiDisabled: false,
  };

  // Listeners for output changes
  private outputListeners: Set<() => void> = new Set();

  private constructor() {}

  public static async getInstance(): Promise<ConsoleEngine> {
    if (ConsoleEngine.initPromise) return ConsoleEngine.initPromise;
    if (ConsoleEngine.instance) return ConsoleEngine.instance;

    ConsoleEngine.initPromise = (async () => {
      const instance = new ConsoleEngine();
      ConsoleEngine.instance = instance;
      return instance;
    })();

    return ConsoleEngine.initPromise;
  }

  public static getInstanceSync(): ConsoleEngine | null {
    return ConsoleEngine.instance;
  }

  public static resetInstance(): void {
    ConsoleEngine.instance = null;
    ConsoleEngine.initPromise = null;
  }

  // ---------------------------------------------------------------------------
  // Game Reference Management
  // ---------------------------------------------------------------------------

  public setGame(game: Game | null): void {
    this.game = game;
  }

  public setCamera(camera: RTSCamera | null): void {
    this.camera = camera;
  }

  public setCursorWorldPos(pos: { x: number; y: number } | null): void {
    this.cursorWorldPos = pos;
  }

  // ---------------------------------------------------------------------------
  // Flag Management
  // ---------------------------------------------------------------------------

  public getFlag(flag: ConsoleFlag): boolean {
    return this.flags[flag];
  }

  public setFlag(flag: ConsoleFlag, value: boolean): void {
    this.flags[flag] = value;
  }

  public toggleFlag(flag: ConsoleFlag): boolean {
    this.flags[flag] = !this.flags[flag];
    return this.flags[flag];
  }

  public getAllFlags(): ConsoleFlags {
    return { ...this.flags };
  }

  // ---------------------------------------------------------------------------
  // Output Management
  // ---------------------------------------------------------------------------

  public addOutputListener(listener: () => void): void {
    this.outputListeners.add(listener);
  }

  public removeOutputListener(listener: () => void): void {
    this.outputListeners.delete(listener);
  }

  private notifyOutputChange(): void {
    for (const listener of this.outputListeners) {
      listener();
    }
  }

  private addEntry(type: ConsoleEntry['type'], text: string): void {
    const entry: ConsoleEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      text,
      timestamp: Date.now(),
    };

    this.history.push(entry);

    // Trim history if too large
    while (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    this.notifyOutputChange();
  }

  public getHistory(): ConsoleEntry[] {
    return [...this.history];
  }

  public clearHistory(): void {
    this.history = [];
    this.notifyOutputChange();
  }

  // ---------------------------------------------------------------------------
  // Command History Navigation
  // ---------------------------------------------------------------------------

  public addToCommandHistory(command: string): void {
    // Don't add duplicates of the last command
    if (this.commandHistory[this.commandHistory.length - 1] !== command) {
      this.commandHistory.push(command);
    }
    this.commandHistoryIndex = this.commandHistory.length;
  }

  public navigateHistoryUp(): string | null {
    if (this.commandHistoryIndex > 0) {
      this.commandHistoryIndex--;
      return this.commandHistory[this.commandHistoryIndex];
    }
    return null;
  }

  public navigateHistoryDown(): string | null {
    if (this.commandHistoryIndex < this.commandHistory.length - 1) {
      this.commandHistoryIndex++;
      return this.commandHistory[this.commandHistoryIndex];
    }
    this.commandHistoryIndex = this.commandHistory.length;
    return '';
  }

  // ---------------------------------------------------------------------------
  // Command Execution
  // ---------------------------------------------------------------------------

  public execute(input: string): CommandResult {
    const trimmed = input.trim();
    if (!trimmed) {
      return { success: false, message: '' };
    }

    // Add to history
    this.addEntry('input', `> ${trimmed}`);
    this.addToCommandHistory(trimmed);

    // Parse the command
    const parsed = this.parseCommand(trimmed);
    if (!parsed) {
      const result = { success: false, message: 'Invalid command syntax' };
      this.addEntry('error', result.message);
      return result;
    }

    const { commandName, args: rawArgs } = parsed;

    // Find the command
    const command = COMMAND_MAP.get(commandName.toLowerCase());
    if (!command) {
      const result = { success: false, message: `Unknown command: ${commandName}` };
      this.addEntry('error', result.message);
      return result;
    }

    // Parse arguments
    const argsResult = this.parseArgs(command, rawArgs);
    if (!argsResult.success) {
      this.addEntry('error', argsResult.message);
      return argsResult;
    }

    // Build context
    const ctx = this.buildContext();
    if (!ctx) {
      const result = { success: false, message: 'Game not initialized' };
      this.addEntry('error', result.message);
      return result;
    }

    // Execute
    let result: CommandResult;
    try {
      if (command.execute) {
        result = command.execute(argsResult.args!, ctx);
      } else if (command.actions) {
        result = this.executeActions(command.actions, argsResult.args!, ctx);
      } else if (command.action) {
        result = this.executeAction(command.action, argsResult.args!, ctx);
      } else {
        result = { success: false, message: 'Command has no implementation' };
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      result = { success: false, message: `Error: ${error}` };
    }

    // Handle special data (like clear console)
    if (result.data && (result.data as { clearConsole?: boolean }).clearConsole) {
      this.clearHistory();
      return result;
    }

    // Add output
    if (result.message) {
      this.addEntry(result.success ? 'success' : 'error', result.message);
    }

    return result;
  }

  private parseCommand(input: string): { commandName: string; args: string[] } | null {
    // Handle quoted strings
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      tokens.push(current);
    }

    if (tokens.length === 0) return null;

    return {
      commandName: tokens[0],
      args: tokens.slice(1),
    };
  }

  private parseArgs(
    command: ConsoleCommand,
    rawArgs: string[]
  ): { success: boolean; message: string; args?: ParsedArgs } {
    const args: ParsedArgs = {};
    const cmdArgs = command.args || [];

    for (let i = 0; i < cmdArgs.length; i++) {
      const argDef = cmdArgs[i];
      const rawValue = rawArgs[i];

      if (rawValue === undefined) {
        if (argDef.required) {
          return {
            success: false,
            message: `Missing required argument: ${argDef.name}\nUsage: ${command.usage || command.name}`,
          };
        }
        args[argDef.name] = argDef.default;
        continue;
      }

      // Parse based on type
      switch (argDef.type) {
        case 'number': {
          const num = parseFloat(rawValue);
          if (isNaN(num)) {
            return {
              success: false,
              message: `Invalid number for ${argDef.name}: ${rawValue}`,
            };
          }
          args[argDef.name] = num;
          break;
        }
        case 'boolean': {
          const lower = rawValue.toLowerCase();
          if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') {
            args[argDef.name] = true;
          } else if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') {
            args[argDef.name] = false;
          } else {
            return {
              success: false,
              message: `Invalid boolean for ${argDef.name}: ${rawValue}`,
            };
          }
          break;
        }
        case 'enum': {
          if (argDef.options && !argDef.options.includes(rawValue)) {
            return {
              success: false,
              message: `Invalid value for ${argDef.name}: ${rawValue}. Options: ${argDef.options.join(', ')}`,
            };
          }
          args[argDef.name] = rawValue;
          break;
        }
        default:
          args[argDef.name] = rawValue;
      }
    }

    return { success: true, message: '', args };
  }

  private buildContext(): GameContext | null {
    // Try to get game from singleton if not set
    let game = this.game;
    if (!game) {
      try {
        // Game.getInstance() returns existing instance or creates new one
        // We only want the existing instance, so we check if one exists first
        game = Game.getInstance();
      } catch {
        // Game not initialized yet
      }
    }

    if (!game) return null;

    const playerId = getLocalPlayerId() || 'player1';

    return {
      game,
      camera: this.camera,
      playerId,
      cursorWorldPos: this.cursorWorldPos,
      getFlag: (flag) => this.getFlag(flag),
      setFlag: (flag, value) => this.setFlag(flag, value),
      toggleFlag: (flag) => this.toggleFlag(flag),
    };
  }

  private executeActions(
    actions: CommandAction[],
    args: ParsedArgs,
    ctx: GameContext
  ): CommandResult {
    const results: string[] = [];

    for (const action of actions) {
      const result = this.executeAction(action, args, ctx);
      if (!result.success) {
        return result;
      }
      if (result.message) {
        results.push(result.message);
      }
    }

    return { success: true, message: results.join('\n') };
  }

  private executeAction(
    action: CommandAction,
    args: ParsedArgs,
    ctx: GameContext
  ): CommandResult {
    switch (action.type) {
      case 'toggleFlag': {
        const flag = action.flag as ConsoleFlag;
        const newValue = ctx.toggleFlag(flag);

        // Apply side effects for certain flags
        if (flag === 'godMode') {
          this.applyGodMode(ctx.game, ctx.playerId, newValue);
        }

        return {
          success: true,
          message: `${flag} ${newValue ? 'enabled' : 'disabled'}`,
        };
      }

      case 'setFlag': {
        const flag = action.flag as ConsoleFlag;
        const value = action.value as boolean;
        ctx.setFlag(flag, value);

        // Apply side effects for certain flags
        if (flag === 'godMode') {
          this.applyGodMode(ctx.game, ctx.playerId, value);
        }

        return {
          success: true,
          message: `${flag} ${value ? 'enabled' : 'disabled'}`,
        };
      }

      case 'addResources': {
        const minerals = (args.minerals as number) ?? (action.minerals as number) ?? 0;
        const vespene = (args.vespene as number) ?? (action.vespene as number) ?? 0;
        ctx.game.statePort.addResources(minerals, vespene);
        return {
          success: true,
          message: `Added ${minerals} minerals, ${vespene} vespene`,
        };
      }

      case 'setResources': {
        const minerals = args.minerals as number;
        const vespene = args.vespene as number;
        ctx.game.statePort.setResources(minerals, vespene);
        return {
          success: true,
          message: `Set resources to ${minerals} minerals, ${vespene} vespene`,
        };
      }

      case 'spawnUnit': {
        const unitType = args.unitType as string;
        const count = (args.count as number) || 1;
        let x = args.x as number | undefined;
        let y = args.y as number | undefined;
        const player = (args.player as string) || ctx.playerId;

        // Use cursor position if not specified
        if (x === undefined || y === undefined) {
          if (ctx.cursorWorldPos) {
            x = x ?? ctx.cursorWorldPos.x;
            y = y ?? ctx.cursorWorldPos.y;
          } else {
            // Default to center of map
            x = x ?? ctx.game.config.mapWidth / 2;
            y = y ?? ctx.game.config.mapHeight / 2;
          }
        }

        // Validate unit type
        const unitDef = DefinitionRegistry.getUnit(unitType);
        if (!unitDef) {
          return {
            success: false,
            message: `Unknown unit type: ${unitType}. Use "units" command to list available types.`,
          };
        }

        // Spawn units
        for (let i = 0; i < count; i++) {
          // Offset slightly to avoid stacking
          const offsetX = x! + (i % 5) * 1.5;
          const offsetY = y! + Math.floor(i / 5) * 1.5;

          ctx.game.eventBus.emit('unit:spawn', {
            unitType,
            x: offsetX,
            y: offsetY,
            playerId: player,
          });
        }

        return {
          success: true,
          message: `Spawned ${count} ${unitType}(s) at (${x!.toFixed(1)}, ${y!.toFixed(1)})`,
        };
      }

      case 'spawnBuilding': {
        const buildingType = args.buildingType as string;
        let x = args.x as number | undefined;
        let y = args.y as number | undefined;
        const player = (args.player as string) || ctx.playerId;

        // Use cursor position if not specified
        if (x === undefined || y === undefined) {
          if (ctx.cursorWorldPos) {
            x = x ?? ctx.cursorWorldPos.x;
            y = y ?? ctx.cursorWorldPos.y;
          } else {
            x = x ?? ctx.game.config.mapWidth / 2;
            y = y ?? ctx.game.config.mapHeight / 2;
          }
        }

        // Validate building type
        const buildingDef = DefinitionRegistry.getBuilding(buildingType);
        if (!buildingDef) {
          return {
            success: false,
            message: `Unknown building type: ${buildingType}. Use "buildings" command to list available types.`,
          };
        }

        // Spawn building (completed)
        ctx.game.eventBus.emit('building:spawn', {
          buildingType,
          x: x!,
          y: y!,
          playerId: player,
          completed: true,
        });

        return {
          success: true,
          message: `Spawned ${buildingType} at (${x!.toFixed(1)}, ${y!.toFixed(1)})`,
        };
      }

      case 'killUnits': {
        const targetPlayer = args.player as string | undefined;
        const worldAdapter = RenderStateWorldAdapter.getInstance();
        if (!worldAdapter) {
          return { success: false, message: 'Game not initialized' };
        }

        const units = worldAdapter.getEntitiesWith('Unit', 'Health', 'Selectable');
        const entityIds: number[] = [];

        for (const entity of units) {
          const selectable = entity.get<{ playerId: string }>('Selectable');
          const health = entity.get<{ isDead: () => boolean }>('Health');
          if (targetPlayer && selectable?.playerId !== targetPlayer) continue;
          if (health && !health.isDead()) {
            entityIds.push(entity.id);
          }
        }

        // Emit debug event - worker will handle the actual killing
        for (const entityId of entityIds) {
          ctx.game.eventBus.emit('debug:killEntity', { entityId });
        }

        return {
          success: true,
          message: `Killing ${entityIds.length} units${targetPlayer ? ` belonging to ${targetPlayer}` : ''}`,
        };
      }

      case 'killBuildings': {
        const targetPlayer = args.player as string | undefined;
        const worldAdapter = RenderStateWorldAdapter.getInstance();
        if (!worldAdapter) {
          return { success: false, message: 'Game not initialized' };
        }

        const buildings = worldAdapter.getEntitiesWith('Building', 'Health', 'Selectable');
        const entityIds: number[] = [];

        for (const entity of buildings) {
          const selectable = entity.get<{ playerId: string }>('Selectable');
          const health = entity.get<{ isDead: () => boolean }>('Health');
          if (targetPlayer && selectable?.playerId !== targetPlayer) continue;
          if (health && !health.isDead()) {
            entityIds.push(entity.id);
          }
        }

        // Emit debug event - worker will handle the actual destruction
        for (const entityId of entityIds) {
          ctx.game.eventBus.emit('debug:killEntity', { entityId });
        }

        return {
          success: true,
          message: `Destroying ${entityIds.length} buildings${targetPlayer ? ` belonging to ${targetPlayer}` : ''}`,
        };
      }

      case 'damageEntity': {
        const entityId = args.entityId as number;
        const amount = args.amount as number;

        const worldAdapter = RenderStateWorldAdapter.getInstance();
        if (!worldAdapter) {
          return { success: false, message: 'Game not initialized' };
        }

        const entity = worldAdapter.getEntity(entityId);
        if (!entity) {
          return { success: false, message: `Entity ${entityId} not found` };
        }

        // Emit debug event - worker will handle the damage
        ctx.game.eventBus.emit('debug:damageEntity', { entityId, amount });

        return {
          success: true,
          message: `Dealing ${amount} damage to entity ${entityId}`,
        };
      }

      case 'healEntity': {
        const entityId = args.entityId as number;
        const amount = args.amount as number | undefined;

        const worldAdapter = RenderStateWorldAdapter.getInstance();
        if (!worldAdapter) {
          return { success: false, message: 'Game not initialized' };
        }

        const entity = worldAdapter.getEntity(entityId);
        if (!entity) {
          return { success: false, message: `Entity ${entityId} not found` };
        }

        // Emit debug event - worker will handle the healing
        ctx.game.eventBus.emit('debug:healEntity', { entityId, amount });

        return {
          success: true,
          message: `Healing entity ${entityId}${amount ? ` for ${amount} HP` : ' to full'}`,
        };
      }

      case 'teleportEntity': {
        const entityId = args.entityId as number;
        const x = args.x as number;
        const y = args.y as number;

        const worldAdapter = RenderStateWorldAdapter.getInstance();
        if (!worldAdapter) {
          return { success: false, message: 'Game not initialized' };
        }

        const entity = worldAdapter.getEntity(entityId);
        if (!entity) {
          return { success: false, message: `Entity ${entityId} not found` };
        }

        // Emit debug event - worker will handle the teleport
        ctx.game.eventBus.emit('debug:teleportEntity', { entityId, x, y });

        return {
          success: true,
          message: `Teleporting entity ${entityId} to (${x.toFixed(1)}, ${y.toFixed(1)})`,
        };
      }

      case 'selectEntity': {
        const entityId = args.entityId as number;

        const worldAdapter = RenderStateWorldAdapter.getInstance();
        if (!worldAdapter) {
          return { success: false, message: 'Game not initialized' };
        }

        const entity = worldAdapter.getEntity(entityId);
        if (!entity) {
          return { success: false, message: `Entity ${entityId} not found` };
        }

        useGameStore.getState().selectUnits([entityId]);

        // Sync selection to worker
        const bridge = getWorkerBridge();
        if (bridge) {
          bridge.setSelection([entityId], ctx.playerId);
        }

        return {
          success: true,
          message: `Selected entity ${entityId}`,
        };
      }

      case 'setGameSpeed': {
        const multiplier = args.multiplier as number | undefined;
        const store = useGameStore.getState();

        if (multiplier === undefined) {
          return {
            success: true,
            message: `Current game speed: ${store.gameSpeed}x`,
          };
        }

        if (multiplier <= 0 || multiplier > 10) {
          return { success: false, message: 'Speed must be between 0.1 and 10' };
        }

        store.setGameSpeed(multiplier);
        return {
          success: true,
          message: `Game speed set to ${multiplier}x`,
        };
      }

      case 'pauseGame': {
        const store = useGameStore.getState();
        if (!store.isPaused) {
          store.togglePause();
        }
        return { success: true, message: 'Game paused' };
      }

      case 'resumeGame': {
        const store = useGameStore.getState();
        if (store.isPaused) {
          store.togglePause();
        }
        return { success: true, message: 'Game resumed' };
      }

      case 'endGame': {
        const result = action.result as 'victory' | 'defeat';
        const duration = ctx.game.getGameTime();

        // Get opponent player ID from render state
        const worldAdapter = RenderStateWorldAdapter.getInstance();
        const allPlayers = new Set<string>();
        if (worldAdapter) {
          const allEntities = worldAdapter.getEntitiesWith('Selectable');
          for (const entity of allEntities) {
            const selectable = entity.get<{ playerId: string }>('Selectable');
            if (selectable) allPlayers.add(selectable.playerId);
          }
        }
        const otherPlayers = [...allPlayers].filter(p => p !== ctx.playerId);
        const opponent = otherPlayers[0] || 'opponent';

        // Emit with correct structure: winner is local player for 'victory', opponent for 'defeat'
        const winner = result === 'victory' ? ctx.playerId : opponent;
        const loser = result === 'victory' ? opponent : ctx.playerId;

        ctx.game.eventBus.emit('game:victory', {
          winner,
          loser,
          reason: 'console',
          duration,
        });

        return { success: true, message: `Triggered ${result} for ${ctx.playerId}` };
      }

      default:
        return { success: false, message: `Unknown action type: ${action.type}` };
    }
  }

  // ---------------------------------------------------------------------------
  // Flag Side Effects
  // ---------------------------------------------------------------------------

  /**
   * Apply god mode to all units and buildings owned by the player.
   * Emits debug event for worker to handle the actual state change.
   */
  private applyGodMode(game: Game, playerId: string, enabled: boolean): void {
    // Emit debug event - worker will handle setting invincibility on entities
    game.eventBus.emit('debug:setGodMode', { playerId, enabled });
  }

  // ---------------------------------------------------------------------------
  // Autocomplete
  // ---------------------------------------------------------------------------

  public getSuggestions(partial: string): string[] {
    const lower = partial.toLowerCase();

    // If empty, return all command names
    if (!lower) {
      return getAllCommandNames().slice(0, 10);
    }

    // Get matching commands
    const matches = getAllCommandNames().filter(name => name.startsWith(lower));
    return matches.slice(0, 10);
  }

  public getCommands(): ConsoleCommand[] {
    return [...CONSOLE_COMMANDS];
  }

  public getCommand(name: string): ConsoleCommand | undefined {
    return COMMAND_MAP.get(name.toLowerCase());
  }
}

// Convenience functions
export async function getConsoleEngine(): Promise<ConsoleEngine> {
  return ConsoleEngine.getInstance();
}

export function getConsoleEngineSync(): ConsoleEngine | null {
  return ConsoleEngine.getInstanceSync();
}

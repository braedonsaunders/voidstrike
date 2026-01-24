/**
 * Console Commands Configuration
 *
 * Declarative command definitions for the debug console.
 * Commands use a hybrid approach: simple commands use action types,
 * complex commands can provide custom execute functions.
 */

import type { Game } from '@/engine/core/Game';
import type { RTSCamera } from '@/rendering/Camera';

// =============================================================================
// Types
// =============================================================================

export type CommandCategory = 'cheats' | 'debug' | 'info' | 'game';

export type ArgType = 'string' | 'number' | 'boolean' | 'enum';

export interface CommandArg {
  name: string;
  type: ArgType;
  required?: boolean;
  default?: unknown;
  options?: string[]; // For enum types
  description: string;
}

export interface ParsedArgs {
  [key: string]: unknown;
}

export interface GameContext {
  game: Game;
  camera: RTSCamera | null;
  playerId: string;
  cursorWorldPos: { x: number; y: number } | null;
  // Console state flags
  getFlag: (flag: ConsoleFlag) => boolean;
  setFlag: (flag: ConsoleFlag, value: boolean) => void;
  toggleFlag: (flag: ConsoleFlag) => boolean;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// Action types for declarative commands
export type ActionType =
  | 'toggleFlag'
  | 'setFlag'
  | 'addResources'
  | 'setResources'
  | 'spawnUnit'
  | 'spawnBuilding'
  | 'killUnits'
  | 'killBuildings'
  | 'damageEntity'
  | 'healEntity'
  | 'teleportEntity'
  | 'setGameSpeed'
  | 'pauseGame'
  | 'resumeGame'
  | 'endGame'
  | 'selectEntity';

export interface CommandAction {
  type: ActionType;
  [key: string]: unknown;
}

export interface ConsoleCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  category: CommandCategory;
  args?: CommandArg[];
  // Declarative action (simple commands)
  action?: CommandAction;
  // Multiple actions in sequence
  actions?: CommandAction[];
  // Custom execute function (complex commands)
  execute?: (args: ParsedArgs, ctx: GameContext) => CommandResult;
}

// Console flags that can be toggled
export type ConsoleFlag =
  | 'godMode'
  | 'fogDisabled'
  | 'fastBuild'
  | 'noCost'
  | 'aiDisabled';

// =============================================================================
// Command Definitions
// =============================================================================

export const CONSOLE_COMMANDS: ConsoleCommand[] = [
  // ---------------------------------------------------------------------------
  // CHEATS
  // ---------------------------------------------------------------------------
  {
    name: 'god',
    aliases: ['godmode', 'invincible'],
    description: 'Toggle invincibility for your units',
    category: 'cheats',
    action: { type: 'toggleFlag', flag: 'godMode' },
  },
  {
    name: 'resources',
    aliases: ['res', 'money'],
    description: 'Add resources to your stockpile',
    usage: 'resources <minerals> [vespene]',
    category: 'cheats',
    args: [
      { name: 'minerals', type: 'number', required: true, description: 'Amount of minerals to add' },
      { name: 'vespene', type: 'number', required: false, default: 0, description: 'Amount of vespene to add' },
    ],
    action: { type: 'addResources' },
  },
  {
    name: 'setresources',
    aliases: ['setres'],
    description: 'Set exact resource amounts',
    usage: 'setresources <minerals> <vespene>',
    category: 'cheats',
    args: [
      { name: 'minerals', type: 'number', required: true, description: 'Exact mineral amount' },
      { name: 'vespene', type: 'number', required: true, description: 'Exact vespene amount' },
    ],
    action: { type: 'setResources' },
  },
  {
    name: 'spawn',
    aliases: ['create', 'summon'],
    description: 'Spawn units at cursor position or specified location',
    usage: 'spawn <unitType> [count] [x] [y] [player]',
    category: 'cheats',
    args: [
      { name: 'unitType', type: 'string', required: true, description: 'Unit type ID (e.g., trooper, fabricator)' },
      { name: 'count', type: 'number', required: false, default: 1, description: 'Number of units to spawn' },
      { name: 'x', type: 'number', required: false, description: 'X coordinate (uses cursor if omitted)' },
      { name: 'y', type: 'number', required: false, description: 'Y coordinate (uses cursor if omitted)' },
      { name: 'player', type: 'string', required: false, description: 'Player ID (uses local player if omitted)' },
    ],
    action: { type: 'spawnUnit' },
  },
  {
    name: 'spawnbuilding',
    aliases: ['build', 'createbuilding'],
    description: 'Spawn a completed building instantly',
    usage: 'spawnbuilding <buildingType> [x] [y] [player]',
    category: 'cheats',
    args: [
      { name: 'buildingType', type: 'string', required: true, description: 'Building type ID (e.g., command_center)' },
      { name: 'x', type: 'number', required: false, description: 'X coordinate (uses cursor if omitted)' },
      { name: 'y', type: 'number', required: false, description: 'Y coordinate (uses cursor if omitted)' },
      { name: 'player', type: 'string', required: false, description: 'Player ID (uses local player if omitted)' },
    ],
    action: { type: 'spawnBuilding' },
  },
  {
    name: 'reveal',
    aliases: ['maphack', 'showmap'],
    description: 'Reveal the entire map (disable fog of war)',
    category: 'cheats',
    action: { type: 'setFlag', flag: 'fogDisabled', value: true },
  },
  {
    name: 'fog',
    aliases: ['hidemap', 'unreveal'],
    description: 'Re-enable fog of war',
    category: 'cheats',
    action: { type: 'setFlag', flag: 'fogDisabled', value: false },
  },
  {
    name: 'killall',
    aliases: ['destroyall'],
    description: 'Kill all units (optionally for a specific player)',
    usage: 'killall [player]',
    category: 'cheats',
    args: [
      { name: 'player', type: 'string', required: false, description: 'Player ID to target (all if omitted)' },
    ],
    action: { type: 'killUnits' },
  },
  {
    name: 'killbuildings',
    aliases: ['destroybuildings'],
    description: 'Destroy all buildings (optionally for a specific player)',
    usage: 'killbuildings [player]',
    category: 'cheats',
    args: [
      { name: 'player', type: 'string', required: false, description: 'Player ID to target (all if omitted)' },
    ],
    action: { type: 'killBuildings' },
  },
  {
    name: 'win',
    aliases: ['victory'],
    description: 'Instant victory',
    category: 'cheats',
    action: { type: 'endGame', result: 'victory' },
  },
  {
    name: 'lose',
    aliases: ['defeat'],
    description: 'Instant defeat',
    category: 'cheats',
    action: { type: 'endGame', result: 'defeat' },
  },
  {
    name: 'fastbuild',
    aliases: ['instantbuild', 'quickbuild'],
    description: 'Toggle instant build/train times',
    category: 'cheats',
    action: { type: 'toggleFlag', flag: 'fastBuild' },
  },
  {
    name: 'nocost',
    aliases: ['free', 'freebuild'],
    description: 'Toggle free units/buildings (no resource cost)',
    category: 'cheats',
    action: { type: 'toggleFlag', flag: 'noCost' },
  },
  {
    name: 'maxout',
    aliases: ['max'],
    description: 'Max resources, reveal map, enable no cost',
    category: 'cheats',
    actions: [
      { type: 'addResources', minerals: 99999, vespene: 99999 },
      { type: 'setFlag', flag: 'fogDisabled', value: true },
      { type: 'setFlag', flag: 'noCost', value: true },
    ],
  },

  // ---------------------------------------------------------------------------
  // DEBUG
  // ---------------------------------------------------------------------------
  {
    name: 'speed',
    aliases: ['gamespeed', 'time'],
    description: 'Get or set game speed multiplier',
    usage: 'speed [multiplier]',
    category: 'debug',
    args: [
      { name: 'multiplier', type: 'number', required: false, description: 'Speed multiplier (0.5 = half, 2 = double)' },
    ],
    action: { type: 'setGameSpeed' },
  },
  {
    name: 'pause',
    description: 'Pause the game',
    category: 'debug',
    action: { type: 'pauseGame' },
  },
  {
    name: 'resume',
    aliases: ['unpause'],
    description: 'Resume the game',
    category: 'debug',
    action: { type: 'resumeGame' },
  },
  {
    name: 'damage',
    aliases: ['hurt'],
    description: 'Deal damage to an entity',
    usage: 'damage <entityId> <amount>',
    category: 'debug',
    args: [
      { name: 'entityId', type: 'number', required: true, description: 'Entity ID to damage' },
      { name: 'amount', type: 'number', required: true, description: 'Damage amount' },
    ],
    action: { type: 'damageEntity' },
  },
  {
    name: 'heal',
    aliases: ['repair'],
    description: 'Heal an entity (full health if amount omitted)',
    usage: 'heal <entityId> [amount]',
    category: 'debug',
    args: [
      { name: 'entityId', type: 'number', required: true, description: 'Entity ID to heal' },
      { name: 'amount', type: 'number', required: false, description: 'Heal amount (full if omitted)' },
    ],
    action: { type: 'healEntity' },
  },
  {
    name: 'teleport',
    aliases: ['tp', 'move'],
    description: 'Teleport an entity to a position',
    usage: 'teleport <entityId> <x> <y>',
    category: 'debug',
    args: [
      { name: 'entityId', type: 'number', required: true, description: 'Entity ID to teleport' },
      { name: 'x', type: 'number', required: true, description: 'Target X coordinate' },
      { name: 'y', type: 'number', required: true, description: 'Target Y coordinate' },
    ],
    action: { type: 'teleportEntity' },
  },
  {
    name: 'select',
    description: 'Select an entity by ID',
    usage: 'select <entityId>',
    category: 'debug',
    args: [
      { name: 'entityId', type: 'number', required: true, description: 'Entity ID to select' },
    ],
    action: { type: 'selectEntity' },
  },
  {
    name: 'ai',
    aliases: ['toggleai'],
    description: 'Toggle AI on/off',
    category: 'debug',
    action: { type: 'toggleFlag', flag: 'aiDisabled' },
  },

  // ---------------------------------------------------------------------------
  // INFO
  // ---------------------------------------------------------------------------
  {
    name: 'help',
    aliases: ['?', 'commands'],
    description: 'List all commands or get help for a specific command',
    usage: 'help [command]',
    category: 'info',
    args: [
      { name: 'command', type: 'string', required: false, description: 'Command to get help for' },
    ],
    execute: (args, _ctx) => {
      const cmdName = args.command as string | undefined;

      if (cmdName) {
        const cmd = CONSOLE_COMMANDS.find(
          c => c.name === cmdName || c.aliases?.includes(cmdName)
        );
        if (!cmd) {
          return { success: false, message: `Unknown command: ${cmdName}` };
        }

        let helpText = `${cmd.name}`;
        if (cmd.aliases?.length) {
          helpText += ` (aliases: ${cmd.aliases.join(', ')})`;
        }
        helpText += `\n  ${cmd.description}`;
        if (cmd.usage) {
          helpText += `\n  Usage: ${cmd.usage}`;
        }
        if (cmd.args?.length) {
          helpText += '\n  Arguments:';
          for (const arg of cmd.args) {
            const req = arg.required ? '(required)' : `(default: ${arg.default ?? 'none'})`;
            helpText += `\n    ${arg.name}: ${arg.description} ${req}`;
          }
        }
        return { success: true, message: helpText };
      }

      // List all commands grouped by category
      const categories: Record<CommandCategory, ConsoleCommand[]> = {
        cheats: [],
        debug: [],
        info: [],
        game: [],
      };

      for (const cmd of CONSOLE_COMMANDS) {
        categories[cmd.category].push(cmd);
      }

      let helpText = 'Available commands:\n';
      for (const [cat, cmds] of Object.entries(categories)) {
        if (cmds.length === 0) continue;
        helpText += `\n[${cat.toUpperCase()}]\n`;
        for (const cmd of cmds) {
          helpText += `  ${cmd.name.padEnd(16)} ${cmd.description}\n`;
        }
      }
      helpText += '\nType "help <command>" for detailed info.';

      return { success: true, message: helpText };
    },
  },
  {
    name: 'units',
    aliases: ['listunits', 'unittypes'],
    description: 'List all available unit types',
    category: 'info',
    execute: (_args, ctx) => {
      const { DefinitionRegistry } = require('@/engine/definitions');
      const unitsRecord = DefinitionRegistry.getAllUnits();
      const units = Object.values(unitsRecord) as Array<{ id: string; name: string; faction: string }>;

      if (units.length === 0) {
        return { success: true, message: 'No units registered.' };
      }

      let msg = 'Available unit types:\n';
      for (const unit of units) {
        msg += `  ${unit.id.padEnd(20)} ${unit.name} (${unit.faction})\n`;
      }
      return { success: true, message: msg };
    },
  },
  {
    name: 'buildings',
    aliases: ['listbuildings', 'buildingtypes'],
    description: 'List all available building types',
    category: 'info',
    execute: (_args, ctx) => {
      const { DefinitionRegistry } = require('@/engine/definitions');
      const buildingsRecord = DefinitionRegistry.getAllBuildings();
      const buildings = Object.values(buildingsRecord) as Array<{ id: string; name: string; faction: string }>;

      if (buildings.length === 0) {
        return { success: true, message: 'No buildings registered.' };
      }

      let msg = 'Available building types:\n';
      for (const b of buildings) {
        msg += `  ${b.id.padEnd(20)} ${b.name} (${b.faction})\n`;
      }
      return { success: true, message: msg };
    },
  },
  {
    name: 'players',
    aliases: ['listplayers'],
    description: 'Show player information',
    category: 'info',
    execute: (_args, ctx) => {
      const { useGameSetupStore, getLocalPlayerId } = require('@/store/gameSetupStore');
      const store = useGameSetupStore.getState();
      const localId = getLocalPlayerId();

      const slots = store.playerSlots;
      if (!slots || slots.length === 0) {
        return { success: true, message: 'No players configured.' };
      }

      let msg = 'Players:\n';
      for (const slot of slots) {
        if (slot.type === 'open' || slot.type === 'closed') continue;
        const isLocal = slot.id === localId ? ' (you)' : '';
        const type = slot.type === 'ai' ? 'AI' : 'Human';
        msg += `  ${slot.id}${isLocal}: ${slot.name} [${type}] - ${slot.faction}\n`;
      }
      return { success: true, message: msg };
    },
  },
  {
    name: 'stats',
    aliases: ['gamestats'],
    description: 'Show game statistics',
    category: 'info',
    execute: (_args, ctx) => {
      const game = ctx.game;
      const tick = game.getCurrentTick();
      const gameTime = game.getGameTime();
      const minutes = Math.floor(gameTime / 60);
      const seconds = Math.floor(gameTime % 60);

      let msg = `Game Statistics:\n`;
      msg += `  Tick: ${tick}\n`;
      msg += `  Time: ${minutes}:${seconds.toString().padStart(2, '0')}\n`;

      // Entity counts
      const units = game.world.getEntitiesWith('Unit');
      const buildings = game.world.getEntitiesWith('Building');
      msg += `  Units: ${units.length}\n`;
      msg += `  Buildings: ${buildings.length}\n`;

      // Player stats if available
      const allStats = game.gameStateSystem?.getAllStats?.();
      if (allStats) {
        msg += '\nPlayer Stats:\n';
        allStats.forEach((stats: unknown, playerId: string) => {
          const s = stats as { unitsProduced: number; buildingsConstructed: number };
          msg += `  ${playerId}: ${s.unitsProduced} units, ${s.buildingsConstructed} buildings\n`;
        });
      }

      return { success: true, message: msg };
    },
  },
  {
    name: 'pos',
    aliases: ['position', 'cursor'],
    description: 'Show camera and cursor position',
    category: 'info',
    execute: (_args, ctx) => {
      let msg = 'Position Info:\n';

      if (ctx.camera) {
        const camPos = ctx.camera.getPosition?.();
        if (camPos) {
          msg += `  Camera: (${camPos.x.toFixed(1)}, ${camPos.z.toFixed(1)})\n`;
        }
        const zoom = ctx.camera.getZoom?.();
        if (zoom !== undefined) {
          msg += `  Zoom: ${zoom.toFixed(2)}\n`;
        }
      }

      if (ctx.cursorWorldPos) {
        msg += `  Cursor: (${ctx.cursorWorldPos.x.toFixed(1)}, ${ctx.cursorWorldPos.y.toFixed(1)})\n`;
      } else {
        msg += '  Cursor: (unknown)\n';
      }

      return { success: true, message: msg };
    },
  },
  {
    name: 'entities',
    aliases: ['list', 'ents'],
    description: 'List entities (optionally filtered by type)',
    usage: 'entities [filter]',
    category: 'info',
    args: [
      { name: 'filter', type: 'string', required: false, description: 'Filter by component (Unit, Building, etc.)' },
    ],
    execute: (args, ctx) => {
      const filter = args.filter as string | undefined;
      const game = ctx.game;

      let entities;
      if (filter) {
        entities = game.world.getEntitiesWith(filter);
      } else {
        entities = game.world.getEntitiesWith('Transform');
      }

      if (entities.length === 0) {
        return { success: true, message: `No entities found${filter ? ` with ${filter}` : ''}.` };
      }

      // Limit output to first 20
      const maxShow = 20;
      let msg = `Entities${filter ? ` (${filter})` : ''}: ${entities.length} total\n`;

      for (let i = 0; i < Math.min(entities.length, maxShow); i++) {
        const entity = entities[i];
        const transform = entity.get('Transform') as { x: number; y: number } | undefined;
        const unit = entity.get('Unit') as { name: string } | undefined;
        const building = entity.get('Building') as { name: string } | undefined;
        const selectable = entity.get('Selectable') as { playerId: string } | undefined;

        const name = unit?.name || building?.name || 'Entity';
        const pos = transform ? `(${transform.x.toFixed(0)}, ${transform.y.toFixed(0)})` : '';
        const owner = selectable?.playerId || '';

        msg += `  [${entity.id}] ${name.padEnd(16)} ${pos.padEnd(12)} ${owner}\n`;
      }

      if (entities.length > maxShow) {
        msg += `  ... and ${entities.length - maxShow} more\n`;
      }

      return { success: true, message: msg };
    },
  },
  {
    name: 'clear',
    aliases: ['cls'],
    description: 'Clear the console output',
    category: 'info',
    execute: () => {
      return { success: true, message: '', data: { clearConsole: true } };
    },
  },

  // ---------------------------------------------------------------------------
  // GAME
  // ---------------------------------------------------------------------------
  {
    name: 'aiattack',
    description: 'Force AI to attack immediately',
    usage: 'aiattack [player]',
    category: 'game',
    args: [
      { name: 'player', type: 'string', required: false, description: 'AI player ID (first AI if omitted)' },
    ],
    execute: (args, ctx) => {
      const targetPlayer = args.player as string | undefined;

      // Emit event to trigger AI attack
      ctx.game.eventBus.emit('debug:forceAIAttack', { playerId: targetPlayer });
      return { success: true, message: `Forced AI attack${targetPlayer ? ` for ${targetPlayer}` : ''}` };
    },
  },
];

// Build command lookup map for fast access
export const COMMAND_MAP: Map<string, ConsoleCommand> = new Map();
for (const cmd of CONSOLE_COMMANDS) {
  COMMAND_MAP.set(cmd.name, cmd);
  if (cmd.aliases) {
    for (const alias of cmd.aliases) {
      COMMAND_MAP.set(alias, cmd);
    }
  }
}

/**
 * Get all command names and aliases for autocomplete
 */
export function getAllCommandNames(): string[] {
  const names: string[] = [];
  for (const cmd of CONSOLE_COMMANDS) {
    names.push(cmd.name);
    if (cmd.aliases) {
      names.push(...cmd.aliases);
    }
  }
  return names.sort();
}

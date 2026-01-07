'use client';

import { useGameStore } from '@/store/gameStore';
import { Game } from '@/engine/core/Game';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { useEffect, useState } from 'react';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { RESEARCH_DEFINITIONS } from '@/data/research/dominion';

// Icon mappings for commands and units
const COMMAND_ICONS: Record<string, string> = {
  // Basic commands
  move: '➤',
  stop: '■',
  hold: '⛊',
  attack: '⚔',
  patrol: '↻',
  gather: '⛏',
  rally: '⚑',
  // Units
  scv: '🔧',
  marine: '🎖',
  marauder: '💪',
  reaper: '💀',
  ghost: '👻',
  hellion: '🔥',
  siege_tank: '🎯',
  thor: '⚡',
  medivac: '✚',
  viking: '✈',
  banshee: '🦇',
  battlecruiser: '🚀',
  raven: '🦅',
  // Buildings
  command_center: '🏛',
  supply_depot: '📦',
  refinery: '⛽',
  barracks: '🏠',
  engineering_bay: '🔧',
  bunker: '🏰',
  factory: '🏭',
  armory: '⚙',
  starport: '🛫',
  fusion_core: '⚛',
  ghost_academy: '🎓',
  sensor_tower: '📡',
  missile_turret: '🗼',
  // Upgrades
  stim: '💉',
  combat: '🛡',
  infantry: '⚔',
  vehicle: '💥',
  ship: '🚀',
  siege: '🎯',
  cloak: '👁',
  default: '◆',
};

function getIcon(id: string): string {
  const lc = id.toLowerCase();
  // Check exact match
  if (COMMAND_ICONS[lc]) return COMMAND_ICONS[lc];

  // Check partial match
  for (const [key, icon] of Object.entries(COMMAND_ICONS)) {
    if (lc.includes(key)) return icon;
  }

  return COMMAND_ICONS.default;
}

interface CommandButton {
  id: string;
  label: string;
  shortcut: string;
  action: () => void;
  isDisabled?: boolean;
  tooltip?: string;
  cost?: { minerals: number; vespene: number };
}

export function CommandCard() {
  const { selectedUnits, minerals, vespene, supply, maxSupply } = useGameStore();
  const [commands, setCommands] = useState<CommandButton[]>([]);
  const [hoveredCmd, setHoveredCmd] = useState<string | null>(null);

  useEffect(() => {
    const game = Game.getInstance();
    if (!game || selectedUnits.length === 0) {
      setCommands([]);
      return;
    }

    const buttons: CommandButton[] = [];

    // Get the first selected entity to determine commands
    const entity = game.world.getEntity(selectedUnits[0]);
    if (!entity) {
      setCommands([]);
      return;
    }

    const unit = entity.get<Unit>('Unit');
    const building = entity.get<Building>('Building');

    if (unit) {
      // Basic unit commands
      buttons.push({
        id: 'move',
        label: 'Move',
        shortcut: 'M',
        action: () => {},
        tooltip: 'Move to location',
      });

      buttons.push({
        id: 'stop',
        label: 'Stop',
        shortcut: 'S',
        action: () => {
          game.processCommand({
            tick: game.getCurrentTick(),
            playerId: 'player1',
            type: 'STOP',
            entityIds: selectedUnits,
          });
        },
        tooltip: 'Stop current action',
      });

      buttons.push({
        id: 'hold',
        label: 'Hold',
        shortcut: 'H',
        action: () => {
          game.processCommand({
            tick: game.getCurrentTick(),
            playerId: 'player1',
            type: 'HOLD',
            entityIds: selectedUnits,
          });
        },
        tooltip: 'Hold position',
      });

      buttons.push({
        id: 'attack',
        label: 'Attack',
        shortcut: 'A',
        action: () => {},
        tooltip: 'Attack move',
      });

      buttons.push({
        id: 'patrol',
        label: 'Patrol',
        shortcut: 'P',
        action: () => {},
        tooltip: 'Patrol between points',
      });

      // Worker-specific commands
      if (unit.isWorker) {
        buttons.push({
          id: 'gather',
          label: 'Gather',
          shortcut: 'G',
          action: () => {},
          tooltip: 'Gather resources',
        });

        // Building commands - show all but limit display
        Object.entries(BUILDING_DEFINITIONS).forEach(([id, def]) => {
          buttons.push({
            id: `build_${id}`,
            label: def.name,
            shortcut: def.name.charAt(0).toUpperCase(),
            action: () => {
              useGameStore.getState().setBuildingMode(id);
            },
            isDisabled: minerals < def.mineralCost || vespene < def.vespeneCost,
            tooltip: `Build ${def.name}`,
            cost: { minerals: def.mineralCost, vespene: def.vespeneCost },
          });
        });
      }
    } else if (building && building.isComplete()) {
      // Building commands - train units
      building.canProduce.forEach((unitId) => {
        const unitDef = UNIT_DEFINITIONS[unitId];
        if (!unitDef) return;

        buttons.push({
          id: `train_${unitId}`,
          label: unitDef.name,
          shortcut: unitDef.name.charAt(0).toUpperCase(),
          action: () => {
            game.eventBus.emit('command:train', {
              entityIds: selectedUnits,
              unitType: unitId,
            });
          },
          isDisabled:
            minerals < unitDef.mineralCost ||
            vespene < unitDef.vespeneCost ||
            supply + unitDef.supplyCost > maxSupply,
          tooltip: `Train ${unitDef.name}`,
          cost: { minerals: unitDef.mineralCost, vespene: unitDef.vespeneCost },
        });
      });

      // Research commands
      const store = useGameStore.getState();
      const researchMap: Record<string, string[]> = {
        engineering_bay: ['infantry_weapons_1', 'infantry_armor_1'],
        armory: ['vehicle_weapons_1', 'vehicle_armor_1'],
        barracks: ['stim_pack', 'combat_shield'],
        factory: ['siege_tech'],
        starport: ['cloaking_field'],
      };

      const availableResearch = researchMap[building.buildingId] || [];
      availableResearch.forEach((upgradeId) => {
        const upgrade = RESEARCH_DEFINITIONS[upgradeId];
        if (!upgrade) return;

        const isResearched = store.hasResearch('player1', upgradeId);
        if (isResearched) return;

        let reqMet = true;
        if (upgrade.requirements) {
          for (const req of upgrade.requirements) {
            if (RESEARCH_DEFINITIONS[req] && !store.hasResearch('player1', req)) {
              reqMet = false;
              break;
            }
          }
        }

        const isResearching = building.productionQueue.some(
          (item) => item.type === 'upgrade' && item.id === upgradeId
        );

        buttons.push({
          id: `research_${upgradeId}`,
          label: upgrade.name,
          shortcut: upgrade.name.charAt(0).toUpperCase(),
          action: () => {
            game.eventBus.emit('command:research', {
              entityIds: selectedUnits,
              upgradeId,
            });
          },
          isDisabled: minerals < upgrade.mineralCost || vespene < upgrade.vespeneCost || !reqMet || isResearching,
          tooltip: upgrade.description,
          cost: { minerals: upgrade.mineralCost, vespene: upgrade.vespeneCost },
        });
      });

      // Rally point
      buttons.push({
        id: 'rally',
        label: 'Rally',
        shortcut: 'R',
        action: () => {
          useGameStore.getState().setRallyPointMode(true);
        },
        tooltip: 'Set rally point',
      });
    }

    setCommands(buttons.slice(0, 12)); // Max 4x3 grid
  }, [selectedUnits, minerals, vespene, supply, maxSupply]);

  if (commands.length === 0) {
    return (
      <div className="w-60 h-44 bg-black/80 border border-void-700/50 rounded-lg flex items-center justify-center backdrop-blur-sm">
        <span className="text-void-500 text-sm">Select units or buildings</span>
      </div>
    );
  }

  const hoveredCommand = commands.find(c => c.id === hoveredCmd);

  return (
    <div className="relative">
      {/* Command grid - 4 columns, 3 rows */}
      <div className="w-60 bg-black/80 border border-void-700/50 rounded-lg p-2 backdrop-blur-sm">
        <div className="grid grid-cols-4 gap-1.5">
          {commands.map((cmd) => (
            <button
              key={cmd.id}
              className={`
                relative w-[52px] h-[52px] flex flex-col items-center justify-center
                bg-gradient-to-b from-void-800/80 to-void-900/80
                border rounded
                transition-all duration-100
                ${cmd.isDisabled
                  ? 'opacity-40 cursor-not-allowed border-void-700/30'
                  : 'border-void-600/50 hover:from-void-700 hover:to-void-800 hover:border-blue-400/60 active:scale-95'
                }
              `}
              onClick={cmd.action}
              disabled={cmd.isDisabled}
              onMouseEnter={() => setHoveredCmd(cmd.id)}
              onMouseLeave={() => setHoveredCmd(null)}
            >
              {/* Icon */}
              <span className="text-lg leading-none mb-0.5">{getIcon(cmd.id)}</span>

              {/* Label */}
              <span className="text-[8px] text-void-300 truncate w-full text-center leading-tight">
                {cmd.label.length > 7 ? cmd.label.substring(0, 6) + '..' : cmd.label}
              </span>

              {/* Hotkey badge */}
              <span className="absolute bottom-0 right-0.5 text-[7px] text-void-500 font-mono">
                {cmd.shortcut}
              </span>

              {/* Can't afford indicator */}
              {cmd.cost && cmd.isDisabled && (
                <div className="absolute inset-0 border border-red-500/40 rounded pointer-events-none" />
              )}
            </button>
          ))}

          {/* Empty slots */}
          {Array.from({ length: Math.max(0, 12 - commands.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="w-[52px] h-[52px] bg-void-900/30 border border-void-800/20 rounded"
            />
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {hoveredCommand && (
        <div className="absolute bottom-full left-0 mb-2 z-50 pointer-events-none">
          <div className="bg-black/95 border border-void-600 rounded p-2 shadow-xl min-w-[200px] max-w-[280px]">
            {/* Header */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{getIcon(hoveredCommand.id)}</span>
              <span className="text-white font-medium text-sm">{hoveredCommand.label}</span>
              <span className="text-void-400 text-xs ml-auto">[ {hoveredCommand.shortcut} ]</span>
            </div>

            {/* Description */}
            {hoveredCommand.tooltip && (
              <p className="text-void-300 text-xs leading-relaxed">{hoveredCommand.tooltip}</p>
            )}

            {/* Cost */}
            {hoveredCommand.cost && (
              <div className="flex gap-4 text-xs mt-2 pt-2 border-t border-void-700/50">
                <span className={`flex items-center gap-1 ${minerals < hoveredCommand.cost.minerals ? 'text-red-400' : 'text-blue-300'}`}>
                  <span>💎</span>
                  {hoveredCommand.cost.minerals}
                </span>
                {hoveredCommand.cost.vespene > 0 && (
                  <span className={`flex items-center gap-1 ${vespene < hoveredCommand.cost.vespene ? 'text-red-400' : 'text-green-300'}`}>
                    <span>💚</span>
                    {hoveredCommand.cost.vespene}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useGameStore } from '@/store/gameStore';
import { Game } from '@/engine/core/Game';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { useEffect, useState } from 'react';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';

interface CommandButton {
  id: string;
  label: string;
  shortcut: string;
  action: () => void;
  isDisabled?: boolean;
  tooltip?: string;
}

export function CommandCard() {
  const { selectedUnits, minerals, vespene, supply, maxSupply } = useGameStore();
  const [commands, setCommands] = useState<CommandButton[]>([]);

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
        action: () => {
          // TODO: Enter move mode
        },
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
        action: () => {
          // TODO: Enter attack mode
        },
        tooltip: 'Attack move',
      });

      // Worker-specific commands
      if (unit.isWorker) {
        buttons.push({
          id: 'gather',
          label: 'Gather',
          shortcut: 'G',
          action: () => {
            // TODO: Enter gather mode
          },
          tooltip: 'Gather resources',
        });

        // Building commands
        Object.entries(BUILDING_DEFINITIONS).forEach(([id, def]) => {
          buttons.push({
            id: `build_${id}`,
            label: def.name.substring(0, 8),
            shortcut: id.charAt(0).toUpperCase(),
            action: () => {
              useGameStore.getState().setBuildingMode(id);
            },
            isDisabled: minerals < def.mineralCost || vespene < def.vespeneCost,
            tooltip: `Build ${def.name} (${def.mineralCost}/${def.vespeneCost})`,
          });
        });
      }
    } else if (building && building.isComplete()) {
      // Building commands
      building.canProduce.forEach((unitId) => {
        const unitDef = UNIT_DEFINITIONS[unitId];
        if (!unitDef) return;

        buttons.push({
          id: `train_${unitId}`,
          label: unitDef.name.substring(0, 8),
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
          tooltip: `Train ${unitDef.name} (${unitDef.mineralCost}/${unitDef.vespeneCost})`,
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
        tooltip: 'Set rally point (right-click to set)',
      });
    }

    setCommands(buttons.slice(0, 16)); // Max 4x4 grid
  }, [selectedUnits, minerals, vespene, supply, maxSupply]);

  if (commands.length === 0) {
    return (
      <div className="game-panel w-52 h-32 p-2 flex items-center justify-center">
        <span className="text-void-500 text-sm">No commands</span>
      </div>
    );
  }

  return (
    <div className="command-card w-52">
      {commands.map((cmd) => (
        <button
          key={cmd.id}
          className={`command-button ${cmd.isDisabled ? 'command-button-disabled' : ''}`}
          onClick={cmd.action}
          disabled={cmd.isDisabled}
          title={cmd.tooltip}
        >
          <span className="text-xs text-center leading-tight">{cmd.label}</span>
          <span className="absolute bottom-0 right-0 text-[8px] text-void-500 p-0.5">
            {cmd.shortcut}
          </span>
        </button>
      ))}
    </div>
  );
}

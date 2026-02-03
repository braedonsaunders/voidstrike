'use client';

import { memo, useCallback } from 'react';
import { getWorkerBridge } from '@/engine/workers';
import { CommandButton } from '@/components/ui/CommandButton';
import { EmptySlot } from '@/components/ui/EmptySlot';
import { getCommandIcon } from '@/utils/commandIcons';
import { CommandButtonData } from './types';

interface CommandGridProps {
  commands: CommandButtonData[];
  minerals: number;
  plasma: number;
  supply: number;
  maxSupply: number;
  hoveredCmd: string | null;
  setHoveredCmd: (id: string | null) => void;
}

/**
 * Grid layout for command buttons (4 columns, 3 rows).
 */
function CommandGridInner({
  commands,
  minerals,
  plasma,
  supply,
  maxSupply,
  hoveredCmd: _hoveredCmd,
  setHoveredCmd,
}: CommandGridProps) {
  // Handle clicks on disabled buttons to play resource alerts
  const handleDisabledClick = useCallback(
    (cmd: CommandButtonData) => {
      if (!cmd.isDisabled || !cmd.cost) return;

      const bridge = getWorkerBridge();
      if (!bridge) return;

      if (cmd.cost.minerals > 0 && minerals < cmd.cost.minerals) {
        bridge.eventBus.emit('alert:notEnoughMinerals', {});
      } else if (cmd.cost.plasma > 0 && plasma < cmd.cost.plasma) {
        bridge.eventBus.emit('alert:notEnoughPlasma', {});
      } else if (cmd.cost.supply && cmd.cost.supply > 0 && supply + cmd.cost.supply > maxSupply) {
        bridge.eventBus.emit('alert:supplyBlocked', {});
      }
    },
    [minerals, plasma, supply, maxSupply]
  );

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {commands.map((cmd) => (
        <div
          key={cmd.id}
          className="relative"
          onMouseEnter={() => setHoveredCmd(cmd.id)}
          onMouseLeave={() => setHoveredCmd(null)}
        >
          <CommandButton
            icon={getCommandIcon(cmd.id)}
            label={cmd.label}
            shortcut={cmd.shortcut}
            onClick={cmd.action}
            onDisabledClick={() => handleDisabledClick(cmd)}
            isDisabled={cmd.isDisabled}
            hasCost={!!cmd.cost}
            isBackButton={cmd.id === 'back'}
          />
        </div>
      ))}

      {/* Empty slots */}
      {Array.from({ length: Math.max(0, 12 - commands.length) }).map((_, i) => (
        <EmptySlot key={`empty-${i}`} />
      ))}
    </div>
  );
}

export const CommandGrid = memo(CommandGridInner);

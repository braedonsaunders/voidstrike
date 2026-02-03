'use client';

import { useEffect, useState, memo, useMemo } from 'react';
import { useGameStore } from '@/store/gameStore';
import { getWorkerBridge, getRenderStateAdapter } from '@/engine/workers';
import { CommandTooltip } from '@/components/ui/CommandTooltip';
import { getCommandIcon } from '@/utils/commandIcons';
import { CommandGrid } from './CommandGrid';
import { useUnitCommands, useBuildingCommands, useCommandKeyboard } from './hooks';
import { CommandButtonData, MenuMode } from './types';

/**
 * Command card displaying available actions for selected units/buildings.
 * Supports 4x3 grid of commands with submenus for building placement.
 */
function CommandCardInner() {
  const selectedUnits = useGameStore((state) => state.selectedUnits);
  const minerals = useGameStore((state) => state.minerals);
  const plasma = useGameStore((state) => state.plasma);
  const supply = useGameStore((state) => state.supply);
  const maxSupply = useGameStore((state) => state.maxSupply);

  const [hoveredCmd, setHoveredCmd] = useState<string | null>(null);
  const [menuMode, setMenuMode] = useState<MenuMode>('main');
  const [buildingStateVersion, setBuildingStateVersion] = useState(0);

  // Subscribe to building state change events
  useEffect(() => {
    const bridge = getWorkerBridge();
    if (!bridge) return;

    const handleBuildingStateChange = () => {
      setBuildingStateVersion((v) => v + 1);
    };

    const unsub1 = bridge.eventBus.on('building:liftOffStart', handleBuildingStateChange);
    const unsub2 = bridge.eventBus.on('building:liftOffComplete', handleBuildingStateChange);
    const unsub3 = bridge.eventBus.on('building:landingStart', handleBuildingStateChange);
    const unsub4 = bridge.eventBus.on('building:landingComplete', handleBuildingStateChange);

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, []);

  // Reset to main menu when selection changes
  useEffect(() => {
    setMenuMode('main');
  }, [selectedUnits]);

  // Determine if selection is a unit or building
  const selectionType = useMemo(() => {
    if (selectedUnits.length === 0) return null;
    const worldAdapter = getRenderStateAdapter();
    const entity = worldAdapter.getEntity(selectedUnits[0]);
    if (!entity) return null;
    if (entity.get('Unit')) return 'unit';
    if (entity.get('Building')) return 'building';
    return null;
  }, [selectedUnits, buildingStateVersion]);

  // Get commands from appropriate hook
  const unitCommands = useUnitCommands({
    selectedUnits,
    minerals,
    plasma,
    menuMode,
    setMenuMode,
  });

  const buildingCommands = useBuildingCommands({
    selectedUnits,
    minerals,
    plasma,
    supply,
    maxSupply,
  });

  // Merge commands: prefer unit commands if unit selected, otherwise building commands
  const commands: CommandButtonData[] = useMemo(() => {
    if (selectionType === 'unit') {
      return unitCommands.slice(0, 12);
    } else if (selectionType === 'building') {
      return buildingCommands.slice(0, 12);
    }
    return [];
  }, [selectionType, unitCommands, buildingCommands]);

  // Keyboard shortcuts
  useCommandKeyboard({
    menuMode,
    setMenuMode,
    selectedUnits,
    commands,
  });

  if (commands.length === 0) {
    return (
      <div className="w-80 h-52 bg-black/80 border border-void-700/50 rounded-lg flex items-center justify-center backdrop-blur-sm">
        <span className="text-void-500 text-sm">Select units or buildings</span>
      </div>
    );
  }

  const hoveredCommand = commands.find((c) => c.id === hoveredCmd);

  return (
    <div className="relative">
      {/* Menu title when in submenu */}
      {menuMode !== 'main' && (
        <div className="absolute -top-6 left-0 text-xs text-void-400">
          {menuMode === 'build_basic'
            ? '🏗 Basic Structures'
            : menuMode === 'build_advanced'
              ? '🏭 Advanced Structures'
              : '🧱 Walls & Gates'}
        </div>
      )}

      {/* Command grid */}
      <div className="w-80 h-52 bg-black/80 border border-void-700/50 rounded-lg p-2 backdrop-blur-sm">
        <CommandGrid
          commands={commands}
          minerals={minerals}
          plasma={plasma}
          supply={supply}
          maxSupply={maxSupply}
          hoveredCmd={hoveredCmd}
          setHoveredCmd={setHoveredCmd}
        />
      </div>

      {/* Tooltip */}
      {hoveredCommand && (
        <div className="absolute bottom-full left-0 mb-2 z-50 pointer-events-none">
          <CommandTooltip
            icon={getCommandIcon(hoveredCommand.id)}
            label={hoveredCommand.label}
            shortcut={hoveredCommand.shortcut}
            description={hoveredCommand.tooltip}
            cost={hoveredCommand.cost}
            currentMinerals={minerals}
            currentPlasma={plasma}
            currentSupply={supply}
            maxSupply={maxSupply}
          />
        </div>
      )}
    </div>
  );
}

export const CommandCard = memo(CommandCardInner);

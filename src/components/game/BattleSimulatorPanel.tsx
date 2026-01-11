'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import { Game } from '@/engine/core/Game';
import { UNIT_DEFINITIONS, DOMINION_UNITS } from '@/data/units/dominion';
import { useGameSetupStore, PLAYER_COLORS } from '@/store/gameSetupStore';

type SpawnTeam = 'player1' | 'player2';

export const BattleSimulatorPanel = memo(function BattleSimulatorPanel() {
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<SpawnTeam>('player1');
  const [isPaused, setIsPaused] = useState(false);
  const playerSlots = useGameSetupStore((state) => state.playerSlots);

  // Get player colors
  const team1Color = PLAYER_COLORS.find(c => c.id === playerSlots[0]?.colorId);
  const team2Color = PLAYER_COLORS.find(c => c.id === playerSlots[1]?.colorId);

  // Listen for map clicks when a unit is selected
  useEffect(() => {
    if (!selectedUnit) return;

    const game = Game.getInstance();

    const handleSpawnClick = (data: { worldX: number; worldY: number }) => {
      game.eventBus.emit('unit:spawn', {
        unitType: selectedUnit,
        x: data.worldX,
        y: data.worldY,
        playerId: selectedTeam,
      });
    };

    // eventBus.on returns an unsubscribe function
    const unsubscribe = game.eventBus.on('simulator:spawn', handleSpawnClick);

    return () => {
      unsubscribe();
    };
  }, [selectedUnit, selectedTeam]);

  const handlePauseToggle = useCallback(() => {
    const game = Game.getInstance();
    if (isPaused) {
      game.resume();
    } else {
      game.pause();
    }
    setIsPaused(!isPaused);
  }, [isPaused]);

  const handleClearAll = useCallback(() => {
    const game = Game.getInstance();
    // Get all unit entities and destroy them
    const entities = game.world.getEntitiesWith('Unit', 'Selectable');
    for (const entity of entities) {
      game.world.destroyEntity(entity.id);
    }
  }, []);

  // Filter out worker unit for cleaner list
  const combatUnits = DOMINION_UNITS.filter(u => !u.isWorker);

  return (
    <div className="absolute top-12 left-2 w-64 bg-void-950/95 border border-void-700 rounded-lg shadow-xl pointer-events-auto">
      {/* Header */}
      <div className="px-3 py-2 border-b border-void-800 flex items-center justify-between">
        <h3 className="font-display text-sm text-white">Battle Simulator</h3>
        <div className="flex gap-1">
          <button
            onClick={handlePauseToggle}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              isPaused
                ? 'bg-green-600 hover:bg-green-500 text-white'
                : 'bg-yellow-600 hover:bg-yellow-500 text-white'
            }`}
          >
            {isPaused ? 'Play' : 'Pause'}
          </button>
          <button
            onClick={handleClearAll}
            className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Team Selector */}
      <div className="px-3 py-2 border-b border-void-800">
        <div className="text-void-400 text-xs mb-1.5">Spawn for:</div>
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedTeam('player1')}
            className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-all ${
              selectedTeam === 'player1'
                ? 'ring-2 ring-white'
                : 'opacity-60 hover:opacity-80'
            }`}
            style={{
              backgroundColor: `#${(team1Color?.hex ?? 0x4080ff).toString(16).padStart(6, '0')}`,
            }}
          >
            Team 1
          </button>
          <button
            onClick={() => setSelectedTeam('player2')}
            className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-all ${
              selectedTeam === 'player2'
                ? 'ring-2 ring-white'
                : 'opacity-60 hover:opacity-80'
            }`}
            style={{
              backgroundColor: `#${(team2Color?.hex ?? 0xff4040).toString(16).padStart(6, '0')}`,
            }}
          >
            Team 2
          </button>
        </div>
      </div>

      {/* Unit List */}
      <div className="px-2 py-2 max-h-80 overflow-y-auto">
        <div className="text-void-400 text-xs mb-1.5 px-1">
          {selectedUnit ? `Click map to spawn ${UNIT_DEFINITIONS[selectedUnit]?.name}` : 'Select a unit:'}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {combatUnits.map((unit) => (
            <button
              key={unit.id}
              onClick={() => setSelectedUnit(selectedUnit === unit.id ? null : unit.id)}
              className={`px-2 py-1.5 text-left rounded text-xs transition-all ${
                selectedUnit === unit.id
                  ? 'bg-void-600 text-white ring-1 ring-void-400'
                  : 'bg-void-800/50 text-void-300 hover:bg-void-700 hover:text-white'
              }`}
            >
              <div className="font-medium truncate">{unit.name}</div>
              <div className="text-[10px] text-void-500">
                {unit.isFlying ? 'Air' : 'Ground'} • {unit.maxHealth}HP
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Instructions */}
      <div className="px-3 py-2 border-t border-void-800 text-void-500 text-[10px]">
        Select unit, then click on the map to spawn. Units auto-attack enemies.
      </div>
    </div>
  );
});

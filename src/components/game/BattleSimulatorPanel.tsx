'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import { Game } from '@/engine/core/Game';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { DefinitionRegistry } from '@/engine/definitions/DefinitionRegistry';
import { useGameSetupStore, PLAYER_COLORS } from '@/store/gameSetupStore';
import { useGameStore } from '@/store/gameStore';
import { RenderStateWorldAdapter } from '@/engine/workers/RenderStateAdapter';
import { getWorkerBridge } from '@/engine/workers';
import type { GameCommand } from '@/engine/core/GameCommand';

type SpawnTeam = 'player1' | 'player2';
type SpawnQuantity = 1 | 5 | 10 | 20;

const SPAWN_QUANTITIES: SpawnQuantity[] = [1, 5, 10, 20];

export const BattleSimulatorPanel = memo(function BattleSimulatorPanel() {
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<SpawnTeam>('player1');
  const [spawnQuantity, setSpawnQuantity] = useState<SpawnQuantity>(1);
  const [isPaused, setIsPaused] = useState(true);
  const playerSlots = useGameSetupStore((state) => state.playerSlots);

  const team1Color = PLAYER_COLORS.find((c) => c.id === playerSlots[0]?.colorId);
  const team2Color = PLAYER_COLORS.find((c) => c.id === playerSlots[1]?.colorId);

  // Pause game after countdown completes so user can place units
  // We need to wait for the countdown to complete before pausing,
  // otherwise the game start will override our pause
  useEffect(() => {
    const game = Game.getInstance();

    const handleCountdownComplete = () => {
      // Small delay to ensure start() has been processed
      setTimeout(() => {
        const bridge = getWorkerBridge();
        if (bridge) {
          bridge.pause();
        }
      }, 50);
    };

    const unsubscribe = game.eventBus.on('game:countdownComplete', handleCountdownComplete);
    return () => {
      unsubscribe();
    };
  }, []);

  // Listen for map clicks when a unit is selected
  useEffect(() => {
    if (!selectedUnit) return;

    const game = Game.getInstance();
    const bridge = getWorkerBridge();

    const handleSpawnClick = (data: { worldX: number; worldY: number }) => {
      if (!bridge) {
        console.warn('[BattleSimulator] No worker bridge available for spawning');
        return;
      }

      const spacing = 2;
      const cols = Math.ceil(Math.sqrt(spawnQuantity));
      const rows = Math.ceil(spawnQuantity / cols);
      const offsetX = ((cols - 1) * spacing) / 2;
      const offsetY = ((rows - 1) * spacing) / 2;

      let spawned = 0;
      for (let row = 0; row < rows && spawned < spawnQuantity; row++) {
        for (let col = 0; col < cols && spawned < spawnQuantity; col++) {
          const x = data.worldX - offsetX + col * spacing;
          const y = data.worldY - offsetY + row * spacing;

          // Send spawn request to worker via bridge
          bridge.spawnUnit(selectedUnit, x, y, selectedTeam);
          spawned++;
        }
      }
    };

    const unsubscribe = game.eventBus.on('simulator:spawn', handleSpawnClick);
    return () => {
      unsubscribe();
    };
  }, [selectedUnit, selectedTeam, spawnQuantity]);

  const handleFight = useCallback(() => {
    const bridge = getWorkerBridge();
    const worldAdapter = RenderStateWorldAdapter.getInstance();

    if (!worldAdapter || !bridge) {
      return;
    }

    // Register both players as AI-controlled so the AI takes over and fights
    const player1Faction = playerSlots[0]?.faction ?? 'dominion';
    const player2Faction = playerSlots[1]?.faction ?? 'dominion';
    bridge.registerAI('player1', player1Faction, 'medium');
    bridge.registerAI('player2', player2Faction, 'medium');

    const currentTick = bridge.currentTick;

    // Collect units by team and compute team center positions
    const player1Units: number[] = [];
    const player2Units: number[] = [];
    let p1SumX = 0,
      p1SumY = 0,
      p1Count = 0;
    let p2SumX = 0,
      p2SumY = 0,
      p2Count = 0;

    const entities = worldAdapter.getEntitiesWith('Unit', 'Selectable', 'Transform', 'Health');

    for (const entity of entities) {
      const selectable = entity.get<{ playerId: string }>('Selectable');
      const unit = entity.get<{ isWorker: boolean }>('Unit');
      const transform = entity.get<{ x: number; y: number }>('Transform');
      const health = entity.get<{ isDead: () => boolean }>('Health');

      if (!selectable || !unit || !transform || !health) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) continue;

      if (selectable.playerId === 'player1') {
        player1Units.push(entity.id);
        p1SumX += transform.x;
        p1SumY += transform.y;
        p1Count++;
      } else if (selectable.playerId === 'player2') {
        player2Units.push(entity.id);
        p2SumX += transform.x;
        p2SumY += transform.y;
        p2Count++;
      }
    }

    const player1Center = p1Count > 0 ? { x: p1SumX / p1Count, y: p1SumY / p1Count } : null;
    const player2Center = p2Count > 0 ? { x: p2SumX / p2Count, y: p2SumY / p2Count } : null;

    // Issue attack-move commands to each team toward the enemy center
    // ATTACK_MOVE routes to MovementOrchestrator which handles both pathfinding and combat
    if (player1Units.length > 0 && player2Center) {
      const command: GameCommand = {
        tick: currentTick,
        playerId: 'player1',
        type: 'ATTACK_MOVE',
        entityIds: player1Units,
        targetPosition: player2Center,
      };
      bridge.issueCommand(command);
    }

    if (player2Units.length > 0 && player1Center) {
      const command: GameCommand = {
        tick: currentTick,
        playerId: 'player2',
        type: 'ATTACK_MOVE',
        entityIds: player2Units,
        targetPosition: player1Center,
      };
      bridge.issueCommand(command);
    }

    bridge.resume();
    setIsPaused(false);
    setSelectedUnit(null);
  }, [playerSlots]);

  const handlePauseToggle = useCallback(() => {
    const bridge = getWorkerBridge();
    if (!bridge) {
      console.warn('[BattleSimulator] No worker bridge available');
      return;
    }

    if (isPaused) {
      bridge.resume();
    } else {
      bridge.pause();
    }
    setIsPaused(!isPaused);
  }, [isPaused]);

  const handleClearAll = useCallback(() => {
    const worldAdapter = RenderStateWorldAdapter.getInstance();
    const bridge = getWorkerBridge();

    // Clear selection first
    useGameStore.getState().selectUnits([]);
    if (bridge) {
      bridge.setSelection([], 'player1');
    }

    // Get all unit entity IDs and request worker to destroy them
    if (worldAdapter && bridge) {
      const entities = worldAdapter.getEntitiesWith('Unit', 'Selectable');

      // Send destroy command for each entity to worker
      for (const entity of entities) {
        bridge.destroyEntity(entity.id);
      }
    }
  }, []);

  const handleSelectTeam = useCallback((team: 'player1' | 'player2') => {
    const worldAdapter = RenderStateWorldAdapter.getInstance();
    if (!worldAdapter) return;

    const entities = worldAdapter.getEntitiesWith('Unit', 'Selectable');
    const teamUnits: number[] = [];

    for (const entity of entities) {
      const selectable = entity.get<{ playerId: string }>('Selectable');
      if (selectable?.playerId === team) {
        teamUnits.push(entity.id);
      }
    }

    useGameStore.getState().selectUnits(teamUnits);

    // Sync selection to worker
    const bridge = getWorkerBridge();
    if (bridge) {
      bridge.setSelection(teamUnits, team);
    }

    setSelectedUnit(null);
  }, []);

  const combatUnits = Object.values(DefinitionRegistry.getAllUnits()).filter((u) => !u.isWorker);

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

      {/* Fight Button */}
      <div className="px-3 py-2 border-b border-void-800">
        <button
          onClick={handleFight}
          className="w-full px-4 py-2 text-sm font-bold bg-orange-600 hover:bg-orange-500 text-white rounded transition-colors"
        >
          FIGHT!
        </button>
      </div>

      {/* Control Team Buttons */}
      <div className="px-3 py-2 border-b border-void-800">
        <div className="text-void-400 text-xs mb-1.5">Control team:</div>
        <div className="flex gap-2">
          <button
            onClick={() => handleSelectTeam('player1')}
            className="flex-1 px-2 py-1.5 rounded text-xs font-medium transition-all hover:opacity-80"
            style={{
              backgroundColor: `#${(team1Color?.hex ?? 0x4080ff).toString(16).padStart(6, '0')}`,
            }}
          >
            Select All
          </button>
          <button
            onClick={() => handleSelectTeam('player2')}
            className="flex-1 px-2 py-1.5 rounded text-xs font-medium transition-all hover:opacity-80"
            style={{
              backgroundColor: `#${(team2Color?.hex ?? 0xff4040).toString(16).padStart(6, '0')}`,
            }}
          >
            Select All
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
              selectedTeam === 'player1' ? 'ring-2 ring-white' : 'opacity-60 hover:opacity-80'
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
              selectedTeam === 'player2' ? 'ring-2 ring-white' : 'opacity-60 hover:opacity-80'
            }`}
            style={{
              backgroundColor: `#${(team2Color?.hex ?? 0xff4040).toString(16).padStart(6, '0')}`,
            }}
          >
            Team 2
          </button>
        </div>
      </div>

      {/* Quantity Selector */}
      <div className="px-3 py-2 border-b border-void-800">
        <div className="text-void-400 text-xs mb-1.5">Quantity:</div>
        <div className="flex gap-1">
          {SPAWN_QUANTITIES.map((qty) => (
            <button
              key={qty}
              onClick={() => setSpawnQuantity(qty)}
              className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-all ${
                spawnQuantity === qty
                  ? 'bg-void-600 text-white'
                  : 'bg-void-800/50 text-void-400 hover:bg-void-700 hover:text-white'
              }`}
            >
              {qty}
            </button>
          ))}
        </div>
      </div>

      {/* Unit List */}
      <div className="px-2 py-2 max-h-64 overflow-y-auto">
        <div className="text-void-400 text-xs mb-1.5 px-1 flex justify-between items-center">
          <span>
            {selectedUnit
              ? `Click map to spawn ${spawnQuantity}x ${UNIT_DEFINITIONS[selectedUnit]?.name}`
              : 'Select a unit:'}
          </span>
          {selectedUnit && (
            <button
              onClick={() => setSelectedUnit(null)}
              className="text-void-500 hover:text-white text-[10px] underline"
            >
              Deselect
            </button>
          )}
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
                {unit.isNaval ? 'Naval' : unit.isFlying ? 'Air' : 'Ground'} • {unit.maxHealth}HP
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Instructions */}
      <div className="px-3 py-2 border-t border-void-800 text-void-500 text-[10px]">
        Place units on each side, then click FIGHT!
      </div>
    </div>
  );
});

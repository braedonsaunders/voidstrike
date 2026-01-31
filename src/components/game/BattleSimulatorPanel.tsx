'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import { Game } from '@/engine/core/Game';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { DefinitionRegistry } from '@/engine/definitions/DefinitionRegistry';
import { useGameSetupStore, PLAYER_COLORS } from '@/store/gameSetupStore';
import { useGameStore } from '@/store/gameStore';
import { RenderStateWorldAdapter } from '@/engine/workers/RenderStateAdapter';
import { getWorkerBridge } from '@/engine/workers';

type SpawnTeam = 'player1' | 'player2';
type SpawnQuantity = 1 | 5 | 10 | 20;

const SPAWN_QUANTITIES: SpawnQuantity[] = [1, 5, 10, 20];

/**
 * Find the best enemy target for a unit, respecting targeting restrictions.
 * Uses RenderStateWorldAdapter for entity queries in worker mode.
 */
function findValidTarget(
  worldAdapter: RenderStateWorldAdapter,
  entityId: number,
  unitData: {
    sightRange: number;
    isNaval: boolean;
    isFlying: boolean;
    canAttackAir: boolean;
    canAttackGround: boolean;
  },
  transformData: { x: number; y: number },
  myPlayerId: string
): number | null {
  const searchRange = unitData.sightRange * 1.5;
  const isNavalUnit = unitData.isNaval;
  const isAirUnit = unitData.isFlying;

  const entities = worldAdapter.getEntitiesWith('Unit', 'Selectable', 'Transform', 'Health');
  let bestTarget: { entityId: number; score: number } | null = null;

  for (const entity of entities) {
    if (entity.id === entityId) continue;

    const targetUnit = entity.get<{ isFlying: boolean; isNaval: boolean }>('Unit');
    const targetTransform = entity.get<{ x: number; y: number }>('Transform');
    const targetSelectable = entity.get<{ playerId: string }>('Selectable');
    const targetHealth = entity.get<{ current: number; max: number; isDead: () => boolean }>(
      'Health'
    );

    if (!targetUnit || !targetTransform || !targetSelectable || !targetHealth) continue;
    if (targetSelectable.playerId === myPlayerId) continue;
    if (targetHealth.isDead()) continue;

    const targetIsFlying = targetUnit.isFlying;
    const targetIsNaval = targetUnit.isNaval;

    // Check if this unit can attack the target type
    const canAttack =
      (targetIsFlying && unitData.canAttackAir) || (!targetIsFlying && unitData.canAttackGround);
    if (!canAttack) continue;

    // Naval units should prefer naval targets
    if (isNavalUnit && !isAirUnit) {
      if (!targetIsNaval && !targetIsFlying) continue;
    } else if (!isNavalUnit && !isAirUnit) {
      if (targetIsNaval) continue;
    }

    const dx = targetTransform.x - transformData.x;
    const dy = targetTransform.y - transformData.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > searchRange) continue;

    const healthPercent = targetHealth.current / targetHealth.max;
    const score = (1 - distance / searchRange) * 50 + (1 - healthPercent) * 30;

    if (!bestTarget || score > bestTarget.score) {
      bestTarget = { entityId: entity.id, score };
    }
  }

  return bestTarget?.entityId ?? null;
}

/**
 * Find the average position of enemy units that this unit can attack.
 */
function findEnemyCenter(
  worldAdapter: RenderStateWorldAdapter,
  unitData: {
    isNaval: boolean;
    isFlying: boolean;
    canAttackAir: boolean;
    canAttackGround: boolean;
  },
  myPlayerId: string
): { x: number; y: number } | null {
  const entities = worldAdapter.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');

  let sumX = 0;
  let sumY = 0;
  let count = 0;

  const isNavalUnit = unitData.isNaval;
  const isAirUnit = unitData.isFlying;

  for (const entity of entities) {
    const targetUnit = entity.get<{ isFlying: boolean; isNaval: boolean }>('Unit');
    const targetTransform = entity.get<{ x: number; y: number }>('Transform');
    const targetSelectable = entity.get<{ playerId: string }>('Selectable');
    const targetHealth = entity.get<{ isDead: () => boolean }>('Health');

    if (!targetUnit || !targetTransform || !targetSelectable || !targetHealth) continue;
    if (targetSelectable.playerId === myPlayerId) continue;
    if (targetHealth.isDead()) continue;

    const targetIsFlying = targetUnit.isFlying;
    const targetIsNaval = targetUnit.isNaval;

    const canAttack =
      (targetIsFlying && unitData.canAttackAir) || (!targetIsFlying && unitData.canAttackGround);
    if (!canAttack) continue;

    if (isNavalUnit && !isAirUnit) {
      if (!targetIsNaval && !targetIsFlying) continue;
    } else if (!isNavalUnit && !isAirUnit) {
      if (targetIsNaval) continue;
    }

    sumX += targetTransform.x;
    sumY += targetTransform.y;
    count++;
  }

  if (count === 0) return null;
  return { x: sumX / count, y: sumY / count };
}

export const BattleSimulatorPanel = memo(function BattleSimulatorPanel() {
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<SpawnTeam>('player1');
  const [spawnQuantity, setSpawnQuantity] = useState<SpawnQuantity>(1);
  const [isPaused, setIsPaused] = useState(true);
  const playerSlots = useGameSetupStore((state) => state.playerSlots);

  const team1Color = PLAYER_COLORS.find((c) => c.id === playerSlots[0]?.colorId);
  const team2Color = PLAYER_COLORS.find((c) => c.id === playerSlots[1]?.colorId);

  // Pause game on mount so user can place units
  useEffect(() => {
    const game = Game.getInstance();
    game.pause();
  }, []);

  // Listen for map clicks when a unit is selected
  useEffect(() => {
    if (!selectedUnit) return;

    const game = Game.getInstance();

    const handleSpawnClick = (data: { worldX: number; worldY: number }) => {
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

          game.eventBus.emit('unit:spawn', {
            unitType: selectedUnit,
            x,
            y,
            playerId: selectedTeam,
          });
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
    const game = Game.getInstance();
    const worldAdapter = RenderStateWorldAdapter.getInstance();

    if (!worldAdapter) {
      console.warn('[BattleSimulator] No world adapter available');
      return;
    }

    // Register both players as AI-controlled
    game.eventBus.emit('ai:registered', { playerId: 'player1' });
    game.eventBus.emit('ai:registered', { playerId: 'player2' });

    // Get all units from render state adapter
    const entities = worldAdapter.getEntitiesWith('Unit', 'Selectable', 'Transform', 'Health');

    for (const entity of entities) {
      const selectable = entity.get<{ playerId: string }>('Selectable');
      const unit = entity.get<{
        unitId: string;
        isWorker: boolean;
        sightRange: number;
        isNaval: boolean;
        isFlying: boolean;
        canAttackAir: boolean;
        canAttackGround: boolean;
      }>('Unit');
      const transform = entity.get<{ x: number; y: number }>('Transform');
      const health = entity.get<{ isDead: () => boolean }>('Health');

      if (!selectable || !unit || !transform || !health) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) continue;

      const playerId = selectable.playerId;
      if (playerId !== 'player1' && playerId !== 'player2') continue;

      const targetId = findValidTarget(worldAdapter, entity.id, unit, transform, playerId);

      if (targetId !== null) {
        game.eventBus.emit('command:attack', {
          entityIds: [entity.id],
          targetEntityId: targetId,
        });
      } else {
        const enemyCenter = findEnemyCenter(worldAdapter, unit, playerId);
        if (enemyCenter) {
          game.eventBus.emit('command:move', {
            entityIds: [entity.id],
            targetPosition: enemyCenter,
          });
        }
      }
    }

    game.resume();
    setIsPaused(false);
    setSelectedUnit(null);
  }, []);

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
    const worldAdapter = RenderStateWorldAdapter.getInstance();

    // Clear selection first
    useGameStore.getState().selectUnits([]);
    game.eventBus.emit('selection:clear', {});

    // Get all unit entity IDs and request worker to destroy them
    if (worldAdapter) {
      const entities = worldAdapter.getEntitiesWith('Unit', 'Selectable');
      const entityIds = entities.map((e) => e.id);

      // Emit destroy command for each entity - worker will handle actual destruction
      for (const entityId of entityIds) {
        game.eventBus.emit('entity:destroy', { entityId });
      }
    }
  }, []);

  const handleSelectTeam = useCallback((team: 'player1' | 'player2') => {
    const _game = Game.getInstance();
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

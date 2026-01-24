'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import { Game } from '@/engine/core/Game';
import { UNIT_DEFINITIONS, DOMINION_UNITS } from '@/data/units/dominion';
import { useGameSetupStore, PLAYER_COLORS } from '@/store/gameSetupStore';
import { useGameStore } from '@/store/gameStore';
import { Selectable } from '@/engine/components/Selectable';
import { Unit } from '@/engine/components/Unit';
import { Transform } from '@/engine/components/Transform';
import { Health } from '@/engine/components/Health';

type SpawnTeam = 'player1' | 'player2';
type SpawnQuantity = 1 | 5 | 10 | 20;

const SPAWN_QUANTITIES: SpawnQuantity[] = [1, 5, 10, 20];

// Arena dimensions (must match battle_arena.json)
const ARENA_WIDTH = 256;
const ARENA_HEIGHT = 64;

/**
 * Find the best enemy target for a unit, respecting targeting restrictions.
 * Naval units find naval enemies, ground finds ground, air can attack based on capabilities.
 */
function findValidTarget(
  game: Game,
  entityId: number,
  unit: Unit,
  transform: Transform,
  myPlayerId: string
): number | null {
  const world = game.world;

  // Use sight range to find targets
  const searchRange = unit.sightRange * 1.5;

  // For naval units, only look for naval targets they can actually reach
  // For ground units, look for ground targets
  // For air units, they can go anywhere so use normal targeting
  const isNavalUnit = unit.isNaval;
  const isAirUnit = unit.isFlying;

  // Query nearby enemy units and filter by what this unit can actually attack
  const nearbyUnitIds = world.unitGrid.queryRadius(transform.x, transform.y, searchRange);

  let bestTarget: { entityId: number; score: number } | null = null;

  for (const targetId of nearbyUnitIds) {
    if (targetId === entityId) continue;

    const targetEntity = world.getEntity(targetId);
    if (!targetEntity) continue;

    const targetUnit = targetEntity.get<Unit>('Unit');
    const targetTransform = targetEntity.get<Transform>('Transform');
    const targetSelectable = targetEntity.get<Selectable>('Selectable');
    const targetHealth = targetEntity.get<Health>('Health');

    if (!targetUnit || !targetTransform || !targetSelectable || !targetHealth) continue;
    if (targetSelectable.playerId === myPlayerId) continue;
    if (targetHealth.isDead()) continue;

    // Check if this unit can attack the target type
    const targetIsFlying = targetUnit.isFlying;
    const targetIsNaval = targetUnit.isNaval;

    if (!unit.canAttackTarget(targetIsFlying, targetIsNaval)) continue;

    // Naval units should prefer naval targets (they can't path to land)
    // Ground units should prefer ground targets (they can't path to water)
    // Air units can attack anything they're capable of
    if (isNavalUnit && !isAirUnit) {
      // Naval unit - strongly prefer naval targets, can also attack air if capable
      if (!targetIsNaval && !targetIsFlying) continue;
    } else if (!isNavalUnit && !isAirUnit) {
      // Ground unit - strongly prefer ground/air targets, skip naval
      if (targetIsNaval) continue;
    }
    // Air units can attack anything they're capable of (already checked above)

    // Calculate score (simpler than full TargetAcquisition - just distance + health)
    const dx = targetTransform.x - transform.x;
    const dy = targetTransform.y - transform.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const healthPercent = targetHealth.current / targetHealth.max;

    // Score: closer is better, lower health is better
    const score = (1 - distance / searchRange) * 50 + (1 - healthPercent) * 30;

    if (!bestTarget || score > bestTarget.score) {
      bestTarget = { entityId: targetId, score };
    }
  }

  return bestTarget?.entityId ?? null;
}

/**
 * Find the average position of enemy units that this unit can attack.
 * Used as a fallback movement target when no direct target is found.
 */
function findEnemyCenter(
  game: Game,
  unit: Unit,
  myPlayerId: string
): { x: number; y: number } | null {
  const world = game.world;
  const entities = world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');

  let sumX = 0;
  let sumY = 0;
  let count = 0;

  const isNavalUnit = unit.isNaval;
  const isAirUnit = unit.isFlying;

  for (const entity of entities) {
    const targetUnit = entity.get<Unit>('Unit')!;
    const targetTransform = entity.get<Transform>('Transform')!;
    const targetSelectable = entity.get<Selectable>('Selectable')!;
    const targetHealth = entity.get<Health>('Health')!;

    if (targetSelectable.playerId === myPlayerId) continue;
    if (targetHealth.isDead()) continue;

    const targetIsFlying = targetUnit.isFlying;
    const targetIsNaval = targetUnit.isNaval;

    // Only consider enemies this unit can actually attack and reach
    if (!unit.canAttackTarget(targetIsFlying, targetIsNaval)) continue;

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
  const [isPaused, setIsPaused] = useState(true); // Start paused so user can place units
  const playerSlots = useGameSetupStore((state) => state.playerSlots);

  // Get player colors
  const team1Color = PLAYER_COLORS.find(c => c.id === playerSlots[0]?.colorId);
  const team2Color = PLAYER_COLORS.find(c => c.id === playerSlots[1]?.colorId);

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
      // Spawn units in a grid formation around the click point
      const spacing = 2; // Units apart
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

    // eventBus.on returns an unsubscribe function
    const unsubscribe = game.eventBus.on('simulator:spawn', handleSpawnClick);

    return () => {
      unsubscribe();
    };
  }, [selectedUnit, selectedTeam, spawnQuantity]);

  const handleFight = useCallback(() => {
    const game = Game.getInstance();

    // Get all units with required components
    const entities = game.world.getEntitiesWith('Unit', 'Selectable', 'Transform', 'Health');

    // Process each unit individually - find valid targets based on unit capabilities
    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable');
      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');

      if (!selectable || !unit || !transform || !health) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) continue; // Skip workers

      const playerId = selectable.playerId;
      if (playerId !== 'player1' && playerId !== 'player2') continue;

      // Find a valid target this unit can actually attack
      const targetId = findValidTarget(game, entity.id, unit, transform, playerId);

      if (targetId !== null) {
        // Direct attack command to specific enemy
        game.eventBus.emit('command:attack', {
          entityIds: [entity.id],
          targetEntityId: targetId,
        });
      } else {
        // No target in sight - move towards enemies this unit can attack
        const enemyCenter = findEnemyCenter(game, unit, playerId);
        if (enemyCenter) {
          game.eventBus.emit('command:attack', {
            entityIds: [entity.id],
            targetPosition: enemyCenter,
          });
        }
      }
    }

    // Unpause the game
    game.resume();
    setIsPaused(false);

    // Deselect unit so user isn't accidentally spawning more
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

    // Clear selection first (important: must happen before destroying entities)
    // This ensures selection rings are properly cleaned up even when game is paused
    useGameStore.getState().selectUnits([]);
    game.eventBus.emit('selection:clear', {});

    // Get all unit entities and destroy them
    const entities = game.world.getEntitiesWith('Unit', 'Selectable');
    for (const entity of entities) {
      game.world.destroyEntity(entity.id);
    }
  }, []);

  const handleSelectTeam = useCallback((team: 'player1' | 'player2') => {
    const game = Game.getInstance();
    const entities = game.world.getEntitiesWith('Unit', 'Selectable');
    const teamUnits: number[] = [];

    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable');
      if (selectable?.playerId === team) {
        teamUnits.push(entity.id);
      }
    }

    useGameStore.getState().selectUnits(teamUnits);
    // Deselect spawning so clicking doesn't place more units
    setSelectedUnit(null);
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

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Game } from '@/engine/core/Game';
import { Unit } from '@/engine/components/Unit';
import { Transform } from '@/engine/components/Transform';
import { Selectable } from '@/engine/components/Selectable';
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore } from '@/store/gameSetupStore';

export function IdleWorkerButton() {
  const [idleWorkerCount, setIdleWorkerCount] = useState(0);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(0);
  const { selectUnits, moveCameraTo, playerId } = useGameStore();
  const isSpectator = useGameSetupStore((state) => state.isSpectator());

  // Cache to avoid redundant scans
  const lastTickRef = useRef(-1);
  const cachedCountRef = useRef(0);

  // Don't render for spectators
  if (isSpectator) {
    return null;
  }

  // Update idle worker count via event-driven approach + throttled polling
  useEffect(() => {
    const game = Game.getInstance();
    if (!game) return;

    const computeIdleWorkers = () => {
      const currentTick = game.getCurrentTick();
      // Skip if already computed for this tick
      if (currentTick === lastTickRef.current) {
        return cachedCountRef.current;
      }

      const workers = game.world.getEntitiesWith('Unit', 'Transform', 'Selectable');
      let count = 0;

      for (const entity of workers) {
        const unit = entity.get<Unit>('Unit')!;
        const selectable = entity.get<Selectable>('Selectable')!;

        if (
          unit.isWorker &&
          unit.state === 'idle' &&
          selectable.playerId === playerId
        ) {
          count++;
        }
      }

      lastTickRef.current = currentTick;
      cachedCountRef.current = count;
      return count;
    };

    const updateCount = () => {
      const count = computeIdleWorkers();
      setIdleWorkerCount(count);
    };

    // Subscribe to events that could change idle worker count
    const eventBus = game.eventBus;
    const unsubSpawned = eventBus.on('unit:spawned', updateCount);
    const unsubDied = eventBus.on('unit:died', updateCount);

    // Also do an initial update
    updateCount();

    // Polling at reduced rate (1s) to catch state changes (idle<->working)
    // The tick-based cache prevents redundant computations within the same tick
    const interval = setInterval(updateCount, 1000);

    return () => {
      unsubSpawned();
      unsubDied();
      clearInterval(interval);
    };
  }, [playerId]);

  const handleClick = useCallback(() => {
    const game = Game.getInstance();
    if (!game) return;

    const workers = game.world.getEntitiesWith('Unit', 'Transform', 'Selectable');
    const idleWorkers: Array<{ id: number; x: number; y: number }> = [];

    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      if (
        unit.isWorker &&
        unit.state === 'idle' &&
        selectable.playerId === playerId
      ) {
        idleWorkers.push({
          id: entity.id,
          x: transform.x,
          y: transform.y,
        });
      }
    }

    if (idleWorkers.length === 0) return;

    // Cycle through idle workers
    const index = lastSelectedIndex % idleWorkers.length;
    const worker = idleWorkers[index];

    // Select the worker
    selectUnits([worker.id]);

    // Move camera to the worker
    moveCameraTo(worker.x, worker.y);

    // Move to next worker on next click
    setLastSelectedIndex((prev) => prev + 1);
  }, [playerId, selectUnits, moveCameraTo, lastSelectedIndex]);

  // Reset index when idle count changes significantly
  useEffect(() => {
    setLastSelectedIndex(0);
  }, [idleWorkerCount]);

  if (idleWorkerCount === 0) {
    return null; // Don't show button if no idle workers
  }

  return (
    <button
      onClick={handleClick}
      className="game-button text-sm flex items-center gap-1"
      title="Select idle worker (F1)"
    >
      <span className="text-yellow-400">!</span>
      <span>Idle ({idleWorkerCount})</span>
    </button>
  );
}

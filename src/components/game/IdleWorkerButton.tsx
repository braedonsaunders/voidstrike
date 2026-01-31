'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getRenderStateAdapter, getWorkerBridge } from '@/engine/workers';
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

  // Update idle worker count via event-driven approach + throttled polling
  // Note: Hooks must be called unconditionally, so spectator check is after all hooks
  useEffect(() => {
    // Skip for spectators and reset count
    if (isSpectator) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional reset for spectators
      setIdleWorkerCount(0);
      return;
    }
    const bridge = getWorkerBridge();
    if (!bridge) return;

    const computeIdleWorkers = () => {
      const currentTick = bridge.currentTick;
      // Skip if already computed for this tick
      if (currentTick === lastTickRef.current) {
        return cachedCountRef.current;
      }

      const worldAdapter = getRenderStateAdapter();
      const workers = worldAdapter.getEntitiesWith('Unit', 'Transform', 'Selectable');
      let count = 0;

      for (const entity of workers) {
        const unit = entity.get<{ isWorker: boolean; state: string }>('Unit');
        const selectable = entity.get<{ playerId: string }>('Selectable');

        if (
          unit?.isWorker &&
          unit.state === 'idle' &&
          selectable?.playerId === playerId
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

    // Subscribe to events via worker bridge event bus
    const eventBus = bridge.eventBus;
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
  }, [playerId, isSpectator]);

  const handleClick = useCallback(() => {
    const worldAdapter = getRenderStateAdapter();
    const workers = worldAdapter.getEntitiesWith('Unit', 'Transform', 'Selectable');
    const idleWorkers: Array<{ id: number; x: number; y: number }> = [];

    for (const entity of workers) {
      const unit = entity.get<{ isWorker: boolean; state: string }>('Unit');
      const transform = entity.get<{ x: number; y: number }>('Transform');
      const selectable = entity.get<{ playerId: string }>('Selectable');

      if (
        unit?.isWorker &&
        unit.state === 'idle' &&
        selectable?.playerId === playerId
      ) {
        idleWorkers.push({
          id: entity.id,
          x: transform?.x ?? 0,
          y: transform?.y ?? 0,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional reset when idle count changes
    setLastSelectedIndex(0);
  }, [idleWorkerCount]);

  // Don't render for spectators (check after all hooks to satisfy React rules)
  if (isSpectator) {
    return null;
  }

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

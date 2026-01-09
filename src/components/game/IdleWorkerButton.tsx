'use client';

import { useEffect, useState, useCallback } from 'react';
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

  // Don't render for spectators
  if (isSpectator) {
    return null;
  }

  // Update idle worker count periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const game = Game.getInstance();
      if (!game) {
        setIdleWorkerCount(0);
        return;
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

      setIdleWorkerCount(count);
    }, 500); // Update every 500ms

    return () => clearInterval(interval);
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

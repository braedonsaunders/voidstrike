'use client';

import { useEffect, useState, memo, useRef } from 'react';
import { useGameSetupStore, PLAYER_COLORS } from '@/store/gameSetupStore';
import { RenderStateWorldAdapter } from '@/engine/workers/RenderStateAdapter';
import { getWorkerBridge } from '@/engine/workers/WorkerBridge';

interface PlayerStatus {
  playerId: string;
  name: string;
  colorHex: number;
  isAlive: boolean;
  buildingCount: number;
  unitCount: number;
  workerCount: number;
  armySupply: number;
}

// PERF: Wrapped in memo to prevent unnecessary re-renders from parent state changes
export const PlayerStatusPanel = memo(function PlayerStatusPanel() {
  const playerSlots = useGameSetupStore(state => state.playerSlots);
  const isSpectator = useGameSetupStore(state => state.isSpectator());
  const [playerStatuses, setPlayerStatuses] = useState<PlayerStatus[]>([]);

  // Cache to avoid redundant scans within the same tick
  const lastTickRef = useRef(-1);
  const cachedStatusesRef = useRef<PlayerStatus[]>([]);

  // Update player statuses with tick-based caching
  useEffect(() => {
    const worldAdapter = RenderStateWorldAdapter.getInstance();
    const workerBridge = getWorkerBridge();
    if (!worldAdapter) return;

    // Get active player slots (human or AI) and sort by player ID for consistent ordering
    const activeSlots = playerSlots
      .filter(slot => slot.type === 'human' || slot.type === 'ai')
      .sort((a, b) => {
        // Extract player number from ID (e.g., "player1" -> 1)
        const numA = parseInt(a.id.replace('player', ''), 10) || 0;
        const numB = parseInt(b.id.replace('player', ''), 10) || 0;
        return numA - numB;
      });

    const computeStatuses = (): PlayerStatus[] => {
      const currentTick = worldAdapter.getTick();
      // Skip if already computed for this tick
      if (currentTick === lastTickRef.current) {
        return cachedStatusesRef.current;
      }

      const statuses: PlayerStatus[] = [];

      // PERF: Query entities once, then filter by player
      // RenderStateWorldAdapter provides entity data from the worker
      const buildings = worldAdapter.getEntitiesWith('Building');
      const units = worldAdapter.getEntitiesWith('Unit');

      for (const slot of activeSlots) {
        let buildingCount = 0;
        let unitCount = 0;
        let workerCount = 0;
        let armySupply = 0;

        // Count buildings for this player
        for (const entity of buildings) {
          const selectable = entity.get<{ playerId: string }>('Selectable');
          const health = entity.get<{ isDead: () => boolean }>('Health');
          if (selectable?.playerId === slot.id && !health?.isDead()) {
            buildingCount++;
          }
        }

        // Count units for this player
        for (const entity of units) {
          const selectable = entity.get<{ playerId: string }>('Selectable');
          const unit = entity.get<{ isWorker: boolean }>('Unit');
          const health = entity.get<{ isDead: () => boolean }>('Health');
          if (selectable?.playerId === slot.id && !health?.isDead()) {
            unitCount++;
            if (unit?.isWorker) {
              workerCount++;
            } else {
              armySupply += 1; // Could use unit.supplyCost if available
            }
          }
        }

        const color = PLAYER_COLORS.find(c => c.id === slot.colorId);

        statuses.push({
          playerId: slot.id,
          name: slot.name || slot.id,
          colorHex: color?.hex ?? 0x808080,
          isAlive: buildingCount > 0,
          buildingCount,
          unitCount,
          workerCount,
          armySupply,
        });
      }

      lastTickRef.current = currentTick;
      cachedStatusesRef.current = statuses;
      return statuses;
    };

    const updateStatuses = () => {
      const statuses = computeStatuses();
      setPlayerStatuses(statuses);
    };

    // Subscribe to events that could change player stats
    const eventBus = workerBridge?.eventBus;
    const unsubSpawned = eventBus?.on('unit:spawned', updateStatuses);
    const unsubDied = eventBus?.on('unit:died', updateStatuses);

    // Update immediately
    updateStatuses();

    // Update every 2 seconds (reduced from 1s since we have event-driven updates)
    const interval = setInterval(updateStatuses, 2000);

    return () => {
      unsubSpawned?.();
      unsubDied?.();
      clearInterval(interval);
    };
  }, [playerSlots]);

  // Only show if there are multiple players or spectating
  if (playerStatuses.length <= 1 && !isSpectator) {
    return null;
  }

  const hexToRgb = (hex: number) => {
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    return `rgb(${r}, ${g}, ${b})`;
  };

  return (
    <div className="bg-black/50 backdrop-blur-sm rounded px-2 py-1.5 text-xs">
      <div className="text-void-400 text-[10px] uppercase tracking-wider mb-1">
        Players
      </div>
      <div className="space-y-1">
        {playerStatuses.map(status => (
          <div
            key={status.playerId}
            className={`flex items-center gap-2 ${!status.isAlive ? 'opacity-50' : ''}`}
          >
            {/* Color indicator */}
            <div
              className="w-2 h-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: hexToRgb(status.colorHex) }}
            />

            {/* Player name */}
            <span
              className={`font-medium min-w-[60px] truncate ${!status.isAlive ? 'line-through' : ''}`}
              style={{ color: hexToRgb(status.colorHex) }}
            >
              {status.name}
            </span>

            {/* Status */}
            {!status.isAlive ? (
              <span className="text-red-400 text-[10px]">DEFEATED</span>
            ) : isSpectator ? (
              // Show detailed stats in spectator mode
              <div className="flex items-center gap-2 text-void-300">
                <span title="Workers">👷 {status.workerCount}</span>
                <span title="Army">⚔️ {status.armySupply}</span>
                <span title="Buildings">🏠 {status.buildingCount}</span>
              </div>
            ) : (
              // Just show alive indicator in normal mode
              <span className="text-green-400 text-[10px]">●</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

'use client';

import { useGameStore } from '@/store/gameStore';
import { Game } from '@/engine/core/Game';
import { Building, ProductionQueueItem } from '@/engine/components/Building';
import { useEffect, useState, useCallback } from 'react';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';

interface QueueItemDisplay {
  index: number;
  type: 'unit' | 'upgrade';
  id: string;
  name: string;
  progress: number;
  buildTime: number;
  isActive: boolean;
}

interface ProductionQueueInfo {
  buildingId: number;
  buildingName: string;
  queue: QueueItemDisplay[];
}

export function ProductionQueuePanel() {
  const { selectedUnits } = useGameStore();
  const [productionInfo, setProductionInfo] = useState<ProductionQueueInfo | null>(null);

  const updateProductionInfo = useCallback(() => {
    const game = Game.getInstance();
    if (!game || selectedUnits.length === 0) {
      setProductionInfo(null);
      return;
    }

    // Find first selected building with a production queue
    for (const entityId of selectedUnits) {
      const entity = game.world.getEntity(entityId);
      if (!entity) continue;

      const building = entity.get<Building>('Building');
      if (!building || !building.isComplete()) continue;

      if (building.productionQueue.length > 0 || building.canProduce.length > 0) {
        const queue: QueueItemDisplay[] = building.productionQueue.map((item, index) => {
          const unitDef = UNIT_DEFINITIONS[item.id];
          return {
            index,
            type: item.type,
            id: item.id,
            name: unitDef?.name ?? item.id,
            progress: item.progress,
            buildTime: item.buildTime,
            isActive: index === 0,
          };
        });

        setProductionInfo({
          buildingId: entityId,
          buildingName: building.name,
          queue,
        });
        return;
      }
    }

    setProductionInfo(null);
  }, [selectedUnits]);

  useEffect(() => {
    updateProductionInfo();
    const interval = setInterval(updateProductionInfo, 100);
    return () => clearInterval(interval);
  }, [updateProductionInfo]);

  const handleCancelItem = (buildingId: number, index: number) => {
    const game = Game.getInstance();
    if (!game) return;

    const entity = game.world.getEntity(buildingId);
    if (!entity) return;

    const building = entity.get<Building>('Building');
    if (!building) return;

    const cancelled = building.cancelProduction(index);
    if (cancelled) {
      // Refund resources
      const unitDef = UNIT_DEFINITIONS[cancelled.id];
      if (unitDef) {
        const store = useGameStore.getState();
        // Partial refund based on progress (full refund if cancelled early)
        const refundPercent = cancelled.progress < 0.5 ? 1 : 0.5;
        store.addResources(
          Math.floor(unitDef.mineralCost * refundPercent),
          Math.floor(unitDef.vespeneCost * refundPercent)
        );
        store.addSupply(-unitDef.supplyCost);
      }

      game.eventBus.emit('production:cancelled', {
        buildingId,
        itemId: cancelled.id,
        itemType: cancelled.type,
      });
    }
  };

  if (!productionInfo || productionInfo.queue.length === 0) {
    return null;
  }

  const activeItem = productionInfo.queue[0];
  const queuedItems = productionInfo.queue.slice(1);

  return (
    <div className="production-queue-panel mt-2">
      {/* Header */}
      <div className="text-xs text-void-400 mb-1 flex items-center justify-between">
        <span>Production Queue</span>
        <span className="text-void-500">{productionInfo.queue.length} item(s)</span>
      </div>

      {/* Active production item */}
      <div className="bg-void-900/80 border border-void-700 rounded p-2 mb-1">
        <div className="flex items-center gap-2">
          {/* Icon placeholder */}
          <div className="w-10 h-10 bg-void-800 border border-plasma-500/50 rounded flex items-center justify-center flex-shrink-0">
            <span className="text-lg">{getUnitIcon(activeItem.id)}</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm text-void-200 truncate">{activeItem.name}</span>
              <span className="text-xs text-void-400 ml-2">
                {Math.floor(activeItem.progress * 100)}%
              </span>
            </div>

            {/* Progress bar */}
            <div className="mt-1 h-2 bg-void-800 rounded overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-plasma-600 to-plasma-400 transition-all duration-100"
                style={{ width: `${activeItem.progress * 100}%` }}
              />
            </div>

            {/* Time remaining */}
            <div className="text-xs text-void-500 mt-0.5">
              {formatTimeRemaining(activeItem.buildTime * (1 - activeItem.progress))}
            </div>
          </div>

          {/* Cancel button */}
          <button
            onClick={() => handleCancelItem(productionInfo.buildingId, 0)}
            className="w-6 h-6 bg-red-900/50 hover:bg-red-800/70 border border-red-700/50 rounded flex items-center justify-center text-red-400 hover:text-red-300 transition-colors flex-shrink-0"
            title="Cancel production"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Queued items */}
      {queuedItems.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {queuedItems.map((item, displayIndex) => (
            <div
              key={`queue-${item.index}`}
              className="relative group"
            >
              <div className="w-8 h-8 bg-void-900/80 border border-void-600 rounded flex items-center justify-center cursor-pointer hover:border-void-500 transition-colors">
                <span className="text-xs">{getUnitIcon(item.id)}</span>
              </div>

              {/* Cancel button overlay on hover */}
              <button
                onClick={() => handleCancelItem(productionInfo.buildingId, item.index)}
                className="absolute inset-0 bg-red-900/80 opacity-0 group-hover:opacity-100 rounded flex items-center justify-center text-red-300 text-xs transition-opacity"
                title={`Cancel ${item.name}`}
              >
                ✕
              </button>

              {/* Queue position indicator */}
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-void-700 border border-void-500 rounded-full text-[8px] flex items-center justify-center text-void-300">
                {displayIndex + 2}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getUnitIcon(unitId: string): string {
  const icons: Record<string, string> = {
    scv: '⛏️',
    marine: '🎖️',
    marauder: '💪',
    reaper: '💀',
    ghost: '👻',
    hellion: '🔥',
    siege_tank: '🛡️',
    thor: '⚡',
    medivac: '➕',
    viking: '✈️',
    banshee: '🦇',
    battlecruiser: '🚀',
  };
  return icons[unitId] ?? '❓';
}

function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'Complete';
  if (seconds < 1) return '<1s';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins}m ${secs}s`;
}

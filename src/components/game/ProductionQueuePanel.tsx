'use client';

import { useGameStore } from '@/store/gameStore';
import { Game } from '@/engine/core/Game';
import { Building } from '@/engine/components/Building';
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
  buildingId: number;
}

interface BuildingProductionInfo {
  buildingId: number;
  buildingName: string;
  buildingType: string;
  queue: QueueItemDisplay[];
}

interface SharedProductionInfo {
  buildingType: string;
  buildingName: string;
  buildingCount: number;
  buildings: BuildingProductionInfo[];
  totalQueuedItems: number;
}

export function ProductionQueuePanel() {
  const { selectedUnits } = useGameStore();
  const [sharedProduction, setSharedProduction] = useState<SharedProductionInfo | null>(null);

  const updateProductionInfo = useCallback(() => {
    const game = Game.getInstance();
    if (!game || selectedUnits.length === 0) {
      setSharedProduction(null);
      return;
    }

    // Collect all production buildings grouped by type
    const buildingsByType: Map<string, BuildingProductionInfo[]> = new Map();

    for (const entityId of selectedUnits) {
      const entity = game.world.getEntity(entityId);
      if (!entity) continue;

      const building = entity.get<Building>('Building');
      if (!building || !building.isComplete()) continue;

      // Only include buildings that can produce
      if (building.canProduce.length === 0) continue;

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
          buildingId: entityId,
        };
      });

      const buildingInfo: BuildingProductionInfo = {
        buildingId: entityId,
        buildingName: building.name,
        buildingType: building.buildingId,
        queue,
      };

      const existing = buildingsByType.get(building.buildingId) || [];
      existing.push(buildingInfo);
      buildingsByType.set(building.buildingId, existing);
    }

    // If no production buildings found, show nothing
    if (buildingsByType.size === 0) {
      setSharedProduction(null);
      return;
    }

    // Get the first building type (or the one with most buildings selected)
    let selectedType = '';
    let maxCount = 0;
    for (const [type, buildings] of buildingsByType) {
      if (buildings.length > maxCount) {
        maxCount = buildings.length;
        selectedType = type;
      }
    }

    const buildings = buildingsByType.get(selectedType) || [];
    if (buildings.length === 0) {
      setSharedProduction(null);
      return;
    }

    const totalQueuedItems = buildings.reduce((sum, b) => sum + b.queue.length, 0);

    setSharedProduction({
      buildingType: selectedType,
      buildingName: buildings[0].buildingName,
      buildingCount: buildings.length,
      buildings,
      totalQueuedItems,
    });
  }, [selectedUnits]);

  useEffect(() => {
    updateProductionInfo();
    // PERFORMANCE: Reduced from 100ms to 200ms - production progress doesn't need 10 FPS updates
    const interval = setInterval(updateProductionInfo, 200);
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
      const unitDef = UNIT_DEFINITIONS[cancelled.id];
      if (unitDef) {
        const store = useGameStore.getState();
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

  if (!sharedProduction || sharedProduction.totalQueuedItems === 0) {
    return null;
  }

  // Single building mode - show detailed view
  if (sharedProduction.buildingCount === 1) {
    return (
      <SingleBuildingQueue
        building={sharedProduction.buildings[0]}
        onCancelItem={handleCancelItem}
      />
    );
  }

  // Multi-building mode - show shared queue view
  return (
    <MultiBuildingQueue
      production={sharedProduction}
      onCancelItem={handleCancelItem}
    />
  );
}

function SingleBuildingQueue({
  building,
  onCancelItem,
}: {
  building: BuildingProductionInfo;
  onCancelItem: (buildingId: number, index: number) => void;
}) {
  if (building.queue.length === 0) return null;

  const activeItem = building.queue[0];
  const queuedItems = building.queue.slice(1);

  return (
    <div className="production-queue-panel mt-2">
      <div className="text-xs text-void-400 mb-1 flex items-center justify-between">
        <span>Production Queue</span>
        <span className="text-void-500">{building.queue.length} item(s)</span>
      </div>

      {/* Active production item */}
      <div className="bg-void-900/80 border border-void-700 rounded p-2 mb-1">
        <div className="flex items-center gap-2">
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

            <div className="mt-1 h-2 bg-void-800 rounded overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-plasma-600 to-plasma-400 transition-all duration-100"
                style={{ width: `${activeItem.progress * 100}%` }}
              />
            </div>

            <div className="text-xs text-void-500 mt-0.5">
              {formatTimeRemaining(activeItem.buildTime * (1 - activeItem.progress))}
            </div>
          </div>

          <button
            onClick={() => onCancelItem(building.buildingId, 0)}
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
            <div key={`queue-${item.index}`} className="relative group">
              <div className="w-8 h-8 bg-void-900/80 border border-void-600 rounded flex items-center justify-center cursor-pointer hover:border-void-500 transition-colors">
                <span className="text-xs">{getUnitIcon(item.id)}</span>
              </div>

              <button
                onClick={() => onCancelItem(building.buildingId, item.index)}
                className="absolute inset-0 bg-red-900/80 opacity-0 group-hover:opacity-100 rounded flex items-center justify-center text-red-300 text-xs transition-opacity"
                title={`Cancel ${item.name}`}
              >
                ✕
              </button>

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

function MultiBuildingQueue({
  production,
  onCancelItem,
}: {
  production: SharedProductionInfo;
  onCancelItem: (buildingId: number, index: number) => void;
}) {
  // Collect all active items (first in each building's queue)
  const activeItems = production.buildings
    .filter(b => b.queue.length > 0)
    .map(b => b.queue[0]);

  // Sort by progress (most progressed first)
  activeItems.sort((a, b) => b.progress - a.progress);

  return (
    <div className="production-queue-panel mt-2">
      <div className="text-xs text-void-400 mb-1 flex items-center justify-between">
        <span>
          Shared Production ({production.buildingCount} {production.buildingName}
          {production.buildingCount > 1 ? 's' : ''})
        </span>
        <span className="text-void-500">{production.totalQueuedItems} item(s)</span>
      </div>

      {/* Active items from all buildings */}
      {activeItems.length > 0 && (
        <div className="space-y-1 mb-1">
          {activeItems.map((item, idx) => (
            <div
              key={`active-${item.buildingId}-${idx}`}
              className="bg-void-900/80 border border-void-700 rounded p-2"
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-void-800 border border-plasma-500/50 rounded flex items-center justify-center flex-shrink-0">
                  <span className="text-sm">{getUnitIcon(item.id)}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-void-200 truncate">{item.name}</span>
                    <span className="text-xs text-void-400 ml-2">
                      {Math.floor(item.progress * 100)}%
                    </span>
                  </div>

                  <div className="mt-1 h-1.5 bg-void-800 rounded overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-plasma-600 to-plasma-400 transition-all duration-100"
                      style={{ width: `${item.progress * 100}%` }}
                    />
                  </div>
                </div>

                <button
                  onClick={() => onCancelItem(item.buildingId, 0)}
                  className="w-5 h-5 bg-red-900/50 hover:bg-red-800/70 border border-red-700/50 rounded flex items-center justify-center text-red-400 hover:text-red-300 transition-colors flex-shrink-0 text-xs"
                  title="Cancel production"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Queued items summary */}
      {production.totalQueuedItems > activeItems.length && (
        <div className="flex flex-wrap gap-1">
          {production.buildings.flatMap(building =>
            building.queue.slice(1).map((item, idx) => (
              <div
                key={`queued-${building.buildingId}-${idx}`}
                className="relative group"
              >
                <div className="w-7 h-7 bg-void-900/80 border border-void-600 rounded flex items-center justify-center cursor-pointer hover:border-void-500 transition-colors">
                  <span className="text-[10px]">{getUnitIcon(item.id)}</span>
                </div>

                <button
                  onClick={() => onCancelItem(item.buildingId, item.index)}
                  className="absolute inset-0 bg-red-900/80 opacity-0 group-hover:opacity-100 rounded flex items-center justify-center text-red-300 text-[10px] transition-opacity"
                  title={`Cancel ${item.name}`}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Building status indicators */}
      <div className="mt-2 flex gap-1">
        {production.buildings.map(building => (
          <div
            key={building.buildingId}
            className={`w-3 h-3 rounded-full border ${
              building.queue.length > 0
                ? 'bg-plasma-500/50 border-plasma-400'
                : 'bg-void-800 border-void-600'
            }`}
            title={`${building.buildingName}: ${building.queue.length} in queue`}
          />
        ))}
      </div>
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

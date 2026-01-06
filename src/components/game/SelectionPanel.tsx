'use client';

import { useGameStore } from '@/store/gameStore';
import { Game } from '@/engine/core/Game';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Health } from '@/engine/components/Health';
import { useEffect, useState } from 'react';
import { ProductionQueuePanel } from './ProductionQueuePanel';

interface SelectedEntityInfo {
  id: number;
  name: string;
  type: 'unit' | 'building';
  health: number;
  maxHealth: number;
  shield?: number;
  maxShield?: number;
  state?: string;
}

export function SelectionPanel() {
  const { selectedUnits } = useGameStore();
  const [selectedInfo, setSelectedInfo] = useState<SelectedEntityInfo[]>([]);

  useEffect(() => {
    const updateSelection = () => {
      const game = Game.getInstance();
      if (!game) return;

      const info: SelectedEntityInfo[] = [];

      for (const entityId of selectedUnits) {
        const entity = game.world.getEntity(entityId);
        if (!entity) continue;

        const unit = entity.get<Unit>('Unit');
        const building = entity.get<Building>('Building');
        const health = entity.get<Health>('Health');

        if (unit && health) {
          info.push({
            id: entityId,
            name: unit.name,
            type: 'unit',
            health: health.current,
            maxHealth: health.max,
            shield: health.shield,
            maxShield: health.maxShield,
            state: unit.state,
          });
        } else if (building && health) {
          info.push({
            id: entityId,
            name: building.name,
            type: 'building',
            health: health.current,
            maxHealth: health.max,
            state: building.state,
          });
        }
      }

      setSelectedInfo(info);
    };

    updateSelection();
    const interval = setInterval(updateSelection, 100);
    return () => clearInterval(interval);
  }, [selectedUnits]);

  if (selectedInfo.length === 0) {
    return (
      <div className="game-panel p-4 h-32 flex items-center justify-center">
        <span className="text-void-500">No selection</span>
      </div>
    );
  }

  if (selectedInfo.length === 1) {
    const entity = selectedInfo[0];
    const healthPercent = (entity.health / entity.maxHealth) * 100;
    const shieldPercent = entity.maxShield
      ? ((entity.shield || 0) / entity.maxShield) * 100
      : 0;

    return (
      <div className="game-panel p-4 min-h-32">
        <div className="flex items-start gap-4">
          {/* Portrait placeholder */}
          <div className="w-16 h-16 bg-void-900 border border-void-700 flex items-center justify-center flex-shrink-0">
            <span className="text-2xl text-void-500">
              {entity.type === 'unit' ? '👤' : '🏠'}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-display text-lg text-void-200">{entity.name}</h3>
            <p className="text-sm text-void-500 capitalize">{entity.state}</p>

            {/* Health bar */}
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-void-400 w-12">HP</span>
                <div className="flex-1 h-2 bg-void-900 rounded overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${healthPercent}%`,
                      backgroundColor:
                        healthPercent > 60
                          ? '#22c55e'
                          : healthPercent > 30
                          ? '#eab308'
                          : '#ef4444',
                    }}
                  />
                </div>
                <span className="text-xs text-void-400 w-16 text-right">
                  {Math.ceil(entity.health)}/{entity.maxHealth}
                </span>
              </div>

              {/* Shield bar */}
              {entity.maxShield && entity.maxShield > 0 && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-void-400 w-12">Shield</span>
                  <div className="flex-1 h-2 bg-void-900 rounded overflow-hidden">
                    <div
                      className="h-full bg-blue-400 transition-all"
                      style={{ width: `${shieldPercent}%` }}
                    />
                  </div>
                  <span className="text-xs text-void-400 w-16 text-right">
                    {Math.ceil(entity.shield || 0)}/{entity.maxShield}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Production queue for buildings */}
        {entity.type === 'building' && <ProductionQueuePanel />}
      </div>
    );
  }

  // Multiple selection
  return (
    <div className="game-panel p-4 h-32 overflow-y-auto">
      <div className="grid grid-cols-8 gap-1">
        {selectedInfo.slice(0, 24).map((entity) => (
          <div
            key={entity.id}
            className="w-10 h-10 bg-void-900 border border-void-700 flex items-center justify-center relative"
            title={entity.name}
          >
            <span className="text-xs">
              {entity.type === 'unit' ? '👤' : '🏠'}
            </span>
            {/* Mini health bar */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-void-800">
              <div
                className="h-full bg-green-500"
                style={{ width: `${(entity.health / entity.maxHealth) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      {selectedInfo.length > 24 && (
        <p className="text-xs text-void-500 mt-2">
          +{selectedInfo.length - 24} more
        </p>
      )}
    </div>
  );
}

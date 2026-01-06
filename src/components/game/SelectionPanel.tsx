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
        <span className="text-void-500 text-sm">Select units or buildings</span>
      </div>
    );
  }

  if (selectedInfo.length === 1) {
    const entity = selectedInfo[0];
    const healthPercent = (entity.health / entity.maxHealth) * 100;
    const shieldPercent = entity.maxShield
      ? ((entity.shield || 0) / entity.maxShield) * 100
      : 0;

    // Health bar color based on percentage
    const healthColor = healthPercent > 60 ? 'from-green-600 to-green-400'
      : healthPercent > 30 ? 'from-yellow-600 to-yellow-400'
      : 'from-red-600 to-red-400';

    return (
      <div className="game-panel p-4 min-h-32">
        <div className="flex items-start gap-4">
          {/* Portrait - modern icon style */}
          <div className="w-16 h-16 bg-gradient-to-br from-void-800 to-void-900 border border-void-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-inner">
            <svg className="w-8 h-8 text-void-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              {entity.type === 'unit' ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
              )}
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-lg text-white">{entity.name}</h3>
            <p className="text-sm text-void-400 capitalize">{entity.state}</p>

            {/* Health bar */}
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-void-400 w-10 uppercase tracking-wide">HP</span>
                <div className="flex-1 h-2.5 bg-void-900 rounded-full overflow-hidden border border-void-700/50">
                  <div
                    className={`h-full bg-gradient-to-r ${healthColor} transition-all duration-300`}
                    style={{ width: `${healthPercent}%` }}
                  />
                </div>
                <span className="text-xs text-void-300 w-16 text-right font-mono">
                  {Math.ceil(entity.health)}/{entity.maxHealth}
                </span>
              </div>

              {/* Shield bar */}
              {entity.maxShield && entity.maxShield > 0 && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-void-400 w-10 uppercase tracking-wide">SH</span>
                  <div className="flex-1 h-2.5 bg-void-900 rounded-full overflow-hidden border border-void-700/50">
                    <div
                      className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300"
                      style={{ width: `${shieldPercent}%` }}
                    />
                  </div>
                  <span className="text-xs text-void-300 w-16 text-right font-mono">
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

  // Multiple selection - improved grid
  return (
    <div className="game-panel p-3 h-32 overflow-y-auto">
      <div className="grid grid-cols-8 gap-1.5">
        {selectedInfo.slice(0, 24).map((entity) => {
          const hp = (entity.health / entity.maxHealth) * 100;
          return (
            <div
              key={entity.id}
              className="w-10 h-10 bg-gradient-to-b from-void-800 to-void-900 border border-void-600/50 rounded flex items-center justify-center relative hover:border-blue-500/50 transition-colors cursor-pointer"
              title={`${entity.name} (${Math.ceil(entity.health)}/${entity.maxHealth})`}
            >
              <svg className="w-5 h-5 text-void-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {entity.type === 'unit' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75" />
                )}
              </svg>
              {/* Mini health bar */}
              <div className="absolute bottom-0 left-0.5 right-0.5 h-1 bg-void-900 rounded-full overflow-hidden">
                <div
                  className={`h-full ${hp > 60 ? 'bg-green-500' : hp > 30 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${hp}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {selectedInfo.length > 24 && (
        <p className="text-xs text-void-400 mt-2 text-center">
          +{selectedInfo.length - 24} more units
        </p>
      )}
    </div>
  );
}

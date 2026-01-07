'use client';

import { useGameStore } from '@/store/gameStore';
import { Game } from '@/engine/core/Game';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Health } from '@/engine/components/Health';
import { useEffect, useState } from 'react';
import { ProductionQueuePanel } from './ProductionQueuePanel';
import { Tooltip } from '@/components/ui/Tooltip';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';

interface SelectedEntityInfo {
  id: number;
  name: string;
  type: 'unit' | 'building';
  health: number;
  maxHealth: number;
  shield?: number;
  maxShield?: number;
  state?: string;
  unitId?: string;
  buildingId?: string;
  // Combat stats for units
  attackDamage?: number;
  attackSpeed?: number;
  attackRange?: number;
  armor?: number;
  speed?: number;
  sightRange?: number;
  damageType?: string;
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
            unitId: unit.unitId,
            attackDamage: unit.attackDamage,
            attackSpeed: unit.attackSpeed,
            attackRange: unit.attackRange,
            armor: health.armor,
            speed: unit.speed,
            sightRange: unit.sightRange,
            damageType: unit.damageType,
          });
        } else if (building && health) {
          info.push({
            id: entityId,
            name: building.name,
            type: 'building',
            health: health.current,
            maxHealth: health.max,
            state: building.state,
            buildingId: building.buildingId,
            armor: health.armor,
          });
        }
      }

      setSelectedInfo(info);
    };

    updateSelection();
    // PERFORMANCE: Reduced from 100ms to 250ms - 4 FPS is plenty for health bar updates
    const interval = setInterval(updateSelection, 250);
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
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-3">
                <span className="text-xs text-void-400 w-10 uppercase tracking-wide">HP</span>
                <div className="flex-1 h-2 bg-void-900 rounded-full overflow-hidden border border-void-700/50">
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
                  <div className="flex-1 h-2 bg-void-900 rounded-full overflow-hidden border border-void-700/50">
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

            {/* Combat Stats for units */}
            {entity.type === 'unit' && entity.attackDamage !== undefined && (
              <div className="mt-2 grid grid-cols-4 gap-x-2 gap-y-1 text-xs">
                <StatItem label="DMG" value={entity.attackDamage} color="text-red-400" />
                <StatItem label="SPD" value={entity.speed?.toFixed(1)} color="text-yellow-400" />
                <StatItem label="RNG" value={entity.attackRange} color="text-blue-400" />
                <StatItem label="ARM" value={entity.armor} color="text-green-400" />
              </div>
            )}
          </div>
        </div>

        {/* Production queue for buildings */}
        {entity.type === 'building' && <ProductionQueuePanel />}
      </div>
    );
  }

  // Multiple selection - improved grid with tooltips
  return (
    <div className="game-panel p-3 h-32 overflow-y-auto">
      <div className="grid grid-cols-8 gap-1.5">
        {selectedInfo.slice(0, 24).map((entity) => {
          const hp = (entity.health / entity.maxHealth) * 100;
          return (
            <Tooltip
              key={entity.id}
              content={<EntityTooltipContent entity={entity} />}
              delay={300}
            >
              <div
                className="w-10 h-10 bg-gradient-to-b from-void-800 to-void-900 border border-void-600/50 rounded flex items-center justify-center relative hover:border-blue-500/50 transition-colors cursor-pointer"
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
            </Tooltip>
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

// Helper component for stat display
function StatItem({ label, value, color }: { label: string; value: number | string | undefined; color: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-void-500">{label}:</span>
      <span className={color}>{value ?? '-'}</span>
    </div>
  );
}

// Tooltip content for entities in multi-selection
function EntityTooltipContent({ entity }: { entity: SelectedEntityInfo }) {
  const healthPercent = Math.floor((entity.health / entity.maxHealth) * 100);

  return (
    <div className="min-w-[180px]">
      <div className="font-medium text-white mb-1">{entity.name}</div>
      <div className="text-xs text-void-400 capitalize mb-2">{entity.state}</div>

      {/* Health */}
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-void-400">Health:</span>
        <span className={healthPercent > 60 ? 'text-green-400' : healthPercent > 30 ? 'text-yellow-400' : 'text-red-400'}>
          {Math.ceil(entity.health)}/{entity.maxHealth} ({healthPercent}%)
        </span>
      </div>

      {/* Shield if applicable */}
      {entity.maxShield && entity.maxShield > 0 && (
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-void-400">Shield:</span>
          <span className="text-blue-400">
            {Math.ceil(entity.shield || 0)}/{entity.maxShield}
          </span>
        </div>
      )}

      {/* Combat stats for units */}
      {entity.type === 'unit' && entity.attackDamage !== undefined && (
        <>
          <div className="border-t border-void-700 my-2" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-void-400">Damage:</span>
              <span className="text-red-400">{entity.attackDamage}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-void-400">Armor:</span>
              <span className="text-green-400">{entity.armor}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-void-400">Speed:</span>
              <span className="text-yellow-400">{entity.speed?.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-void-400">Range:</span>
              <span className="text-blue-400">{entity.attackRange}</span>
            </div>
            <div className="flex justify-between col-span-2">
              <span className="text-void-400">Damage Type:</span>
              <span className="text-purple-400 capitalize">{entity.damageType}</span>
            </div>
          </div>
        </>
      )}

      {/* Building specific info */}
      {entity.type === 'building' && entity.armor !== undefined && (
        <>
          <div className="border-t border-void-700 my-2" />
          <div className="flex justify-between text-xs">
            <span className="text-void-400">Armor:</span>
            <span className="text-green-400">{entity.armor}</span>
          </div>
        </>
      )}
    </div>
  );
}

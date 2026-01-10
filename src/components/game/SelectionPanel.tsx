'use client';

import { memo, useCallback, useMemo } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Game } from '@/engine/core/Game';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Health } from '@/engine/components/Health';
import { Resource } from '@/engine/components/Resource';
import { useEffect, useState } from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { getUnitIcon, getBuildingIcon } from './icons';

interface ProductionQueueItem {
  id: string;
  name: string;
  progress: number;
  buildTime: number;
}

interface SelectedEntityInfo {
  id: number;
  name: string;
  type: 'unit' | 'building' | 'resource';
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
  // Resource stats
  resourceType?: 'minerals' | 'vespene';
  resourceAmount?: number;
  resourceMaxAmount?: number;
  currentGatherers?: number;
  maxGatherers?: number;
  // Building production stats
  productionQueue?: ProductionQueueItem[];
  isComplete?: boolean;
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
        const resource = entity.get<Resource>('Resource');

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
          // Get production queue info
          const queue: ProductionQueueItem[] = building.productionQueue.map((item) => {
            const unitDef = UNIT_DEFINITIONS[item.id];
            return {
              id: item.id,
              name: unitDef?.name ?? item.id,
              progress: item.progress,
              buildTime: item.buildTime,
            };
          });

          info.push({
            id: entityId,
            name: building.name,
            type: 'building',
            health: health.current,
            maxHealth: health.max,
            state: building.state,
            buildingId: building.buildingId,
            armor: health.armor,
            productionQueue: queue,
            isComplete: building.isComplete(),
          });
        } else if (resource) {
          // Resource (mineral patch or vespene geyser)
          const resourceName = resource.resourceType === 'minerals' ? 'Mineral Field' : 'Vespene Geyser';
          info.push({
            id: entityId,
            name: resourceName,
            type: 'resource',
            health: resource.amount,
            maxHealth: resource.maxAmount,
            resourceType: resource.resourceType,
            resourceAmount: resource.amount,
            resourceMaxAmount: resource.maxAmount,
            currentGatherers: resource.getCurrentGatherers(),
            maxGatherers: resource.maxGatherers,
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
      <div className="game-panel p-4 h-44 flex items-center justify-center">
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

    // Health bar color based on percentage (resources use different colors)
    const isResource = entity.type === 'resource';
    const isBuilding = entity.type === 'building';
    const healthColor = isResource
      ? (entity.resourceType === 'minerals' ? 'from-blue-600 to-blue-400' : 'from-green-600 to-green-400')
      : (healthPercent > 60 ? 'from-green-600 to-green-400'
        : healthPercent > 30 ? 'from-yellow-600 to-yellow-400'
        : 'from-red-600 to-red-400');

    // Get icon for entity type - use shared icons
    const getEntityIconEmoji = () => {
      if (entity.type === 'unit' && entity.unitId) {
        return getUnitIcon(entity.unitId);
      } else if (entity.type === 'building' && entity.buildingId) {
        return getBuildingIcon(entity.buildingId);
      } else if (entity.type === 'resource') {
        return entity.resourceType === 'minerals' ? '💎' : '💚';
      }
      return '◆';
    };

    // Get production queue info for buildings
    const productionQueue = entity.productionQueue || [];
    const activeItem = productionQueue[0];
    const queuedItems = productionQueue.slice(1);

    return (
      <div className="game-panel p-3 h-44 overflow-hidden">
        <div className="flex gap-3 h-full">
          {/* Left side: Portrait and entity info */}
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-start gap-3">
              {/* Portrait - emoji icon style */}
              <div className="w-12 h-12 bg-gradient-to-br from-void-800 to-void-900 border border-void-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-inner">
                <span className="text-2xl">{getEntityIconEmoji()}</span>
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-base text-white truncate">{entity.name}</h3>
                {!isResource && !isBuilding && <p className="text-xs text-void-400 capitalize">{entity.state}</p>}
                {isBuilding && <p className="text-xs text-void-400 capitalize">{entity.isComplete ? entity.state : 'Constructing...'}</p>}
                {isResource && (
                  <p className="text-xs text-void-400">
                    Gatherers: {entity.currentGatherers}/{entity.maxGatherers}
                  </p>
                )}
              </div>
            </div>

            {/* Health/Amount bar */}
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-void-400 w-6 uppercase tracking-wide">
                  {isResource ? 'AMT' : 'HP'}
                </span>
                <div className="flex-1 h-1.5 bg-void-900 rounded-full overflow-hidden border border-void-700/50">
                  <div
                    className={`h-full bg-gradient-to-r ${healthColor} transition-all duration-300`}
                    style={{ width: `${healthPercent}%` }}
                  />
                </div>
                <span className="text-[10px] text-void-300 w-16 text-right font-mono">
                  {Math.ceil(entity.health)}/{entity.maxHealth}
                </span>
              </div>

              {/* Shield bar */}
              {entity.maxShield && entity.maxShield > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-void-400 w-6 uppercase tracking-wide">SH</span>
                  <div className="flex-1 h-1.5 bg-void-900 rounded-full overflow-hidden border border-void-700/50">
                    <div
                      className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300"
                      style={{ width: `${shieldPercent}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-void-300 w-16 text-right font-mono">
                    {Math.ceil(entity.shield || 0)}/{entity.maxShield}
                  </span>
                </div>
              )}
            </div>

            {/* Combat Stats for units - compact */}
            {entity.type === 'unit' && entity.attackDamage !== undefined && (
              <div className="mt-2 flex gap-3 text-[10px]">
                <StatItem label="DMG" value={entity.attackDamage} color="text-red-400" />
                <StatItem label="SPD" value={entity.speed?.toFixed(1)} color="text-yellow-400" />
                <StatItem label="RNG" value={entity.attackRange} color="text-blue-400" />
                <StatItem label="ARM" value={entity.armor} color="text-green-400" />
              </div>
            )}

            {/* Building armor */}
            {isBuilding && entity.armor !== undefined && (
              <div className="mt-2 flex gap-3 text-[10px]">
                <StatItem label="ARM" value={entity.armor} color="text-green-400" />
              </div>
            )}

            {/* Resource info */}
            {isResource && (
              <div className="mt-2 text-[10px] text-void-400">
                <span className={entity.resourceType === 'minerals' ? 'text-blue-400' : 'text-green-400'}>
                  {Math.floor(healthPercent)}% remaining
                </span>
              </div>
            )}
          </div>

          {/* Right side: Production queue for buildings (compact inline version) */}
          {isBuilding && entity.isComplete && productionQueue.length > 0 && (
            <div className="w-32 flex-shrink-0 border-l border-void-700/50 pl-3">
              <div className="text-[10px] text-void-400 mb-1">Production</div>

              {/* Active item */}
              {activeItem && (
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 bg-void-800 border border-plasma-500/50 rounded flex items-center justify-center flex-shrink-0">
                    <span className="text-sm">{getUnitIcon(activeItem.id)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-void-200 truncate">{activeItem.name}</div>
                    <div className="h-1 bg-void-800 rounded overflow-hidden mt-0.5">
                      <div
                        className="h-full bg-gradient-to-r from-plasma-600 to-plasma-400"
                        style={{ width: `${activeItem.progress * 100}%` }}
                      />
                    </div>
                    <div className="text-[9px] text-void-500 mt-0.5">
                      {Math.floor(activeItem.progress * 100)}%
                    </div>
                  </div>
                </div>
              )}

              {/* Queued items */}
              {queuedItems.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {queuedItems.slice(0, 6).map((item, idx) => (
                    <div
                      key={`queue-${idx}`}
                      className="w-6 h-6 bg-void-900/80 border border-void-600 rounded flex items-center justify-center"
                      title={item.name}
                    >
                      <span className="text-[10px]">{getUnitIcon(item.id)}</span>
                    </div>
                  ))}
                  {queuedItems.length > 6 && (
                    <div className="w-6 h-6 bg-void-900/80 border border-void-600 rounded flex items-center justify-center text-[9px] text-void-400">
                      +{queuedItems.length - 6}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Multiple selection - improved grid with tooltips
  return (
    <div className="game-panel p-3 h-44 overflow-y-auto">
      <div className="grid grid-cols-8 gap-1.5">
        {selectedInfo.slice(0, 24).map((entity) => {
          const hp = (entity.health / entity.maxHealth) * 100;
          const isResource = entity.type === 'resource';
          const barColor = isResource
            ? (entity.resourceType === 'minerals' ? 'bg-blue-500' : 'bg-green-500')
            : (hp > 60 ? 'bg-green-500' : hp > 30 ? 'bg-yellow-500' : 'bg-red-500');

          // Get icon for entity type - use shared icons
          const getMultiSelectIcon = () => {
            if (entity.type === 'unit' && entity.unitId) {
              return getUnitIcon(entity.unitId);
            } else if (entity.type === 'building' && entity.buildingId) {
              return getBuildingIcon(entity.buildingId);
            } else if (entity.type === 'resource') {
              return entity.resourceType === 'minerals' ? '💎' : '💚';
            }
            return '◆';
          };

          return (
            <Tooltip
              key={entity.id}
              content={<EntityTooltipContent entity={entity} />}
              delay={300}
            >
              <div
                className="w-10 h-10 bg-gradient-to-b from-void-800 to-void-900 border border-void-600/50 rounded flex items-center justify-center relative hover:border-blue-500/50 transition-colors cursor-pointer"
              >
                <span className="text-base">{getMultiSelectIcon()}</span>
                {/* Mini health/amount bar */}
                <div className="absolute bottom-0 left-0.5 right-0.5 h-1 bg-void-900 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${barColor}`}
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

// PERFORMANCE: Memoized helper component for stat display
const StatItem = memo(function StatItem({ label, value, color }: { label: string; value: number | string | undefined; color: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-void-500">{label}:</span>
      <span className={color}>{value ?? '-'}</span>
    </div>
  );
});

// PERFORMANCE: Memoized tooltip content for entities in multi-selection
const EntityTooltipContent = memo(function EntityTooltipContent({ entity }: { entity: SelectedEntityInfo }) {
  const healthPercent = Math.floor((entity.health / entity.maxHealth) * 100);
  const isResource = entity.type === 'resource';

  return (
    <div className="min-w-[180px]">
      <div className="font-medium text-white mb-1">{entity.name}</div>
      {!isResource && <div className="text-xs text-void-400 capitalize mb-2">{entity.state}</div>}

      {/* Health/Amount */}
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-void-400">{isResource ? 'Amount:' : 'Health:'}</span>
        <span className={
          isResource
            ? (entity.resourceType === 'minerals' ? 'text-blue-400' : 'text-green-400')
            : (healthPercent > 60 ? 'text-green-400' : healthPercent > 30 ? 'text-yellow-400' : 'text-red-400')
        }>
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

      {/* Resource specific info */}
      {isResource && (
        <>
          <div className="border-t border-void-700 my-2" />
          <div className="flex justify-between text-xs">
            <span className="text-void-400">Gatherers:</span>
            <span className="text-yellow-400">{entity.currentGatherers}/{entity.maxGatherers}</span>
          </div>
        </>
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
});

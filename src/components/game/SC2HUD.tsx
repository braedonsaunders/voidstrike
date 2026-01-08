'use client';

import { useEffect, useState, useCallback } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Game } from '@/engine/core/Game';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { Transform } from '@/engine/components/Transform';
import { SC2Minimap } from './SC2Minimap';

interface SC2HUDProps {
  game: Game;
  mapWidth: number;
  mapHeight: number;
}

// Format time as MM:SS
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function SC2HUD({ game, mapWidth, mapHeight }: SC2HUDProps) {
  const {
    minerals,
    vespene,
    supply,
    maxSupply,
    selectedUnits,
    gameTime,
  } = useGameStore();

  const [selectedInfo, setSelectedInfo] = useState<{
    type: 'unit' | 'building' | 'mixed' | 'none';
    name: string;
    health: number;
    maxHealth: number;
    shield: number;
    maxShield: number;
    count: number;
    abilities: string[];
    isBuilding: boolean;
    buildProgress?: number;
  }>({
    type: 'none',
    name: '',
    health: 0,
    maxHealth: 0,
    shield: 0,
    maxShield: 0,
    count: 0,
    abilities: [],
    isBuilding: false,
  });

  // Update selection info
  useEffect(() => {
    if (selectedUnits.length === 0) {
      setSelectedInfo({
        type: 'none',
        name: '',
        health: 0,
        maxHealth: 0,
        shield: 0,
        maxShield: 0,
        count: 0,
        abilities: [],
        isBuilding: false,
      });
      return;
    }

    // Get first selected entity's info
    const firstEntity = game.world.getEntity(selectedUnits[0]);
    if (!firstEntity) return;

    const unit = firstEntity.get<Unit>('Unit');
    const building = firstEntity.get<Building>('Building');
    const health = firstEntity.get<Health>('Health');

    if (unit) {
      setSelectedInfo({
        type: selectedUnits.length > 1 ? 'mixed' : 'unit',
        name: unit.name || unit.unitId,
        health: health?.current ?? 0,
        maxHealth: health?.max ?? 0,
        shield: health?.shield ?? 0,
        maxShield: health?.maxShield ?? 0,
        count: selectedUnits.length,
        abilities: [], // Abilities can be added later if needed
        isBuilding: false,
      });
    } else if (building) {
      setSelectedInfo({
        type: 'building',
        name: building.name || building.buildingId,
        health: health?.current ?? 0,
        maxHealth: health?.max ?? 0,
        shield: health?.shield ?? 0,
        maxShield: health?.maxShield ?? 0,
        count: 1,
        abilities: [],
        isBuilding: true,
        buildProgress: building.isComplete() ? undefined : building.buildProgress,
      });
    }
  }, [selectedUnits, game.world]);

  // Handle ability click
  const handleAbilityClick = useCallback((abilityId: string) => {
    if (selectedUnits.length === 0) return;

    game.eventBus.emit('command:ability', {
      entityIds: selectedUnits,
      abilityId,
    });
  }, [game.eventBus, selectedUnits]);

  return (
    <div className="fixed inset-0 pointer-events-none">
      {/* Top Bar - Resources and Game Time */}
      <div className="absolute top-0 left-0 right-0 pointer-events-auto">
        <div className="flex justify-between items-center px-4 py-2 bg-gradient-to-b from-black/80 to-transparent">
          {/* Resources */}
          <div className="flex items-center gap-6">
            {/* Minerals */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-cyan-400 rounded-sm shadow-lg shadow-cyan-400/50" />
              <span className="text-cyan-300 font-bold text-lg tabular-nums">
                {minerals}
              </span>
            </div>

            {/* Vespene */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-green-400 rounded-sm shadow-lg shadow-green-400/50" />
              <span className="text-green-300 font-bold text-lg tabular-nums">
                {vespene}
              </span>
            </div>

            {/* Supply */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 border-2 border-yellow-400 rounded-sm" />
              <span className={`font-bold text-lg tabular-nums ${supply >= maxSupply ? 'text-red-400' : 'text-yellow-300'}`}>
                {supply}/{maxSupply}
              </span>
            </div>
          </div>

          {/* Game Time */}
          <div className="flex items-center gap-4">
            <span className="text-gray-300 font-mono text-lg">
              {formatTime(gameTime)}
            </span>
          </div>

          {/* Menu Button */}
          <div>
            <button className="px-4 py-1 bg-gray-800/80 hover:bg-gray-700/80 text-gray-300 rounded border border-gray-600 transition-colors pointer-events-auto">
              Menu
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Bar - Minimap, Selection, Command Card */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-auto">
        <div className="flex items-end bg-gradient-to-t from-black/90 via-black/80 to-transparent pt-8">
          {/* Minimap */}
          <div className="p-2">
            <div className="bg-black/60 p-1 rounded border border-gray-700">
              <SC2Minimap
                game={game}
                mapWidth={mapWidth}
                mapHeight={mapHeight}
                size={200}
              />
            </div>
          </div>

          {/* Selection Panel */}
          <div className="flex-1 px-4 pb-2">
            <div className="bg-black/60 rounded border border-gray-700 p-3 min-h-[120px]">
              {selectedInfo.type === 'none' ? (
                <div className="text-gray-500 text-center py-8">
                  No selection
                </div>
              ) : (
                <div className="flex gap-4">
                  {/* Unit/Building Portrait */}
                  <div className="w-24 h-24 bg-gray-800 rounded border-2 border-gray-600 flex items-center justify-center overflow-hidden">
                    <div className="text-4xl text-gray-400">
                      {selectedInfo.isBuilding ? '🏠' : '⚔️'}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-white font-bold text-lg">
                        {selectedInfo.name}
                      </span>
                      {selectedInfo.count > 1 && (
                        <span className="text-gray-400 text-sm">
                          x{selectedInfo.count}
                        </span>
                      )}
                    </div>

                    {/* Health Bar */}
                    <div className="mb-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-4 bg-gray-800 rounded overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-200"
                            style={{
                              width: `${(selectedInfo.health / Math.max(selectedInfo.maxHealth, 1)) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-green-300 text-sm tabular-nums w-20 text-right">
                          {Math.floor(selectedInfo.health)}/{selectedInfo.maxHealth}
                        </span>
                      </div>
                    </div>

                    {/* Shield Bar (if applicable) */}
                    {selectedInfo.maxShield > 0 && (
                      <div className="mb-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-200"
                              style={{
                                width: `${(selectedInfo.shield / Math.max(selectedInfo.maxShield, 1)) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-blue-300 text-sm tabular-nums w-20 text-right">
                            {Math.floor(selectedInfo.shield)}/{selectedInfo.maxShield}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Build Progress (if building under construction) */}
                    {selectedInfo.buildProgress !== undefined && (
                      <div className="mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-yellow-400 text-sm">Building:</span>
                          <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 transition-all duration-200"
                              style={{
                                width: `${selectedInfo.buildProgress * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-yellow-300 text-sm tabular-nums w-12 text-right">
                            {Math.floor(selectedInfo.buildProgress * 100)}%
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Command Card */}
          <div className="p-2">
            <div className="bg-black/60 rounded border border-gray-700 p-2 w-[200px] min-h-[120px]">
              <div className="grid grid-cols-4 gap-1">
                {/* Ability buttons would go here */}
                {selectedInfo.abilities.slice(0, 12).map((ability, idx) => (
                  <button
                    key={ability}
                    onClick={() => handleAbilityClick(ability)}
                    className="w-10 h-10 bg-gray-800 hover:bg-gray-700 rounded border border-gray-600 flex items-center justify-center text-xs text-gray-400 transition-colors"
                    title={ability}
                  >
                    {ability.charAt(0).toUpperCase()}
                  </button>
                ))}

                {/* Placeholder slots */}
                {Array.from({ length: Math.max(0, 12 - selectedInfo.abilities.length) }).map((_, idx) => (
                  <div
                    key={`empty-${idx}`}
                    className="w-10 h-10 bg-gray-900/50 rounded border border-gray-800"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Idle Worker Button */}
      <IdleWorkerButton game={game} />

      {/* Alert Notifications */}
      <AlertNotifications />
    </div>
  );
}

// Idle Worker Button Component
function IdleWorkerButton({ game }: { game: Game }) {
  const [idleWorkerCount, setIdleWorkerCount] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const workers = game.world.getEntitiesWith('Unit', 'Selectable');
      let count = 0;

      for (const entity of workers) {
        const unit = entity.get<Unit>('Unit')!;
        const selectable = entity.get<Selectable>('Selectable')!;

        if (unit.isWorker && unit.state === 'idle' && selectable.playerId === 'player1') {
          count++;
        }
      }

      setIdleWorkerCount(count);
    }, 500);

    return () => clearInterval(interval);
  }, [game.world]);

  const handleClick = useCallback(() => {
    const workers = game.world.getEntitiesWith('Unit', 'Transform', 'Selectable');

    for (const entity of workers) {
      const unit = entity.get<Unit>('Unit')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      if (unit.isWorker && unit.state === 'idle' && selectable.playerId === 'player1') {
        useGameStore.getState().selectUnits([entity.id]);

        const transform = entity.get<Transform>('Transform');
        if (transform) {
          useGameStore.getState().setPendingCameraMove(transform.x, transform.y);
        }
        break;
      }
    }
  }, [game.world]);

  if (idleWorkerCount === 0) return null;

  return (
    <button
      onClick={handleClick}
      className="absolute left-[220px] bottom-[140px] pointer-events-auto"
    >
      <div className="relative">
        <div className="w-12 h-12 bg-yellow-600 hover:bg-yellow-500 rounded-lg border-2 border-yellow-400 flex items-center justify-center transition-colors shadow-lg">
          <span className="text-2xl">⚒️</span>
        </div>
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold text-white">
          {idleWorkerCount}
        </div>
      </div>
    </button>
  );
}

// Alert Notifications Component
function AlertNotifications() {
  const { pendingAlerts } = useGameStore();
  const [visibleAlerts, setVisibleAlerts] = useState<Array<{ id: string; x: number; y: number; type: string; time: number }>>([]);

  useEffect(() => {
    // Filter to recent alerts (last 5 seconds)
    const now = Date.now();
    const recent = pendingAlerts
      .filter(a => now - a.time < 5000)
      .slice(-3); // Show max 3

    setVisibleAlerts(recent.map((a, i) => ({
      id: `${a.x}-${a.y}-${a.time}`,
      x: a.x,
      y: a.y,
      type: a.type,
      time: a.time,
    })));
  }, [pendingAlerts]);

  if (visibleAlerts.length === 0) return null;

  return (
    <div className="absolute top-20 right-4 flex flex-col gap-2 pointer-events-auto">
      {visibleAlerts.map((alert) => (
        <div
          key={alert.id}
          className="px-4 py-2 bg-red-900/90 border border-red-600 rounded text-red-200 text-sm animate-pulse"
          onClick={() => {
            useGameStore.getState().setPendingCameraMove(alert.x, alert.y);
          }}
          style={{ cursor: 'pointer' }}
        >
          ⚠️ Under Attack!
        </div>
      ))}
    </div>
  );
}

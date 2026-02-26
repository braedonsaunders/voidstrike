import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeDefinitions } from '@/engine/definitions/bootstrap';
import { WorkerGame } from '@/engine/workers/GameWorker';
import { EnhancedAISystem } from '@/engine/systems/EnhancedAISystem';
import { Unit } from '@/engine/components/Unit';
import { Selectable } from '@/engine/components/Selectable';
import { TERRAIN_FEATURE_CONFIG, type MapData } from '@/data/maps/MapTypes';
import { getMapById } from '@/data/maps/json';
import { ELEVATION_TO_HEIGHT_FACTOR } from '@/data/pathfinding.config';
import type { SpawnMapData } from '@/engine/workers/types';

interface WalkableGeometry {
  positions: Float32Array;
  indices: Uint32Array;
}

function buildWalkableGeometry(map: MapData): WalkableGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  let vertexIndex = 0;

  const isCellWalkable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const cell = map.terrain[y][x];
    if (cell.terrain === 'unwalkable') return false;
    const feature = cell.feature ?? 'none';
    return TERRAIN_FEATURE_CONFIG[feature].walkable;
  };

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isCellWalkable(x, y)) continue;

      const h = map.terrain[y][x].elevation * ELEVATION_TO_HEIGHT_FACTOR;
      const base = vertexIndex;

      vertices.push(x, h, y);
      vertices.push(x + 1, h, y);
      vertices.push(x, h, y + 1);
      vertices.push(x + 1, h, y + 1);
      vertexIndex += 4;

      indices.push(base, base + 2, base + 1);
      indices.push(base + 1, base + 2, base + 3);
    }
  }

  return {
    positions: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  };
}

function buildSpawnMapData(map: MapData): SpawnMapData {
  const resources = map.expansions.flatMap((expansion) => [
    ...expansion.minerals.map((mineral) => ({
      type: 'mineral' as const,
      x: mineral.x,
      y: mineral.y,
      amount: mineral.amount,
    })),
    ...expansion.plasma.map((plasma) => ({
      type: 'plasma' as const,
      x: plasma.x,
      y: plasma.y,
      amount: plasma.amount,
    })),
  ]);

  return {
    width: map.width,
    height: map.height,
    name: map.name,
    spawns: map.spawns.map((spawn) => ({
      playerSlot: spawn.playerSlot,
      x: spawn.x,
      y: spawn.y,
    })),
    watchTowers: map.watchTowers,
    resources,
    playerSlots: map.spawns.map((spawn) => ({
      id: `player${spawn.playerSlot}`,
      type: 'ai',
      faction: 'dominion',
      aiDifficulty: 'medium',
      team: 0,
    })),
  };
}

describe('AI smoke test on flat 6-player map', () => {
  beforeAll(async () => {
    await initializeDefinitions();
  });

  it('keeps all AI players active without pathfinding backlog collapse', async () => {
    const map = getMapById('test_6p_flat');
    expect(map).toBeDefined();

    const originalPostMessage = globalThis.postMessage;
    globalThis.postMessage = vi.fn();

    const game = new WorkerGame({
      mapWidth: map!.width,
      mapHeight: map!.height,
      tickRate: 20,
      isMultiplayer: false,
      playerId: 'observer',
      aiEnabled: true,
      aiDifficulty: 'medium',
      fogOfWar: false,
    });

    try {
      game.setTerrainGrid(map!.terrain);

      const geometry = buildWalkableGeometry(map!);
      const navMeshReady = await game.initializeNavMesh(geometry.positions, geometry.indices);
      expect(navMeshReady).toBe(true);

      const spawnData = buildSpawnMapData(map!);
      game.spawnInitialEntities(spawnData);

      const aiSystem = game.world.getSystem(EnhancedAISystem);
      expect(aiSystem).toBeDefined();

      const aiPlayers = aiSystem!.getAllAIPlayers();
      expect(aiPlayers.length).toBe(6);

      const aiActionUpdates = new Map<string, number>();
      const previousLastActionTick = new Map<string, number>();
      for (const ai of aiPlayers) {
        aiActionUpdates.set(ai.playerId, 0);
        previousLastActionTick.set(ai.playerId, ai.lastActionTick);
      }

      const simulateTick = (game as unknown as { update: (deltaMs: number) => void }).update.bind(
        game
      );
      const tickDeltaMs = 1000 / game.config.tickRate;
      const totalTicks = 300; // 15 seconds

      for (let i = 0; i < totalTicks; i++) {
        simulateTick(tickDeltaMs);

        for (const ai of aiSystem!.getAllAIPlayers()) {
          const previousTick = previousLastActionTick.get(ai.playerId) ?? 0;
          if (ai.lastActionTick !== previousTick) {
            aiActionUpdates.set(ai.playerId, (aiActionUpdates.get(ai.playerId) ?? 0) + 1);
            previousLastActionTick.set(ai.playerId, ai.lastActionTick);
          }
        }
      }

      const aiPlayersAfterSimulation = aiSystem!.getAllAIPlayers();
      for (const ai of aiPlayersAfterSimulation) {
        expect(aiActionUpdates.get(ai.playerId) ?? 0).toBeGreaterThan(4);
        expect(ai.lastActionTick).toBeGreaterThan(240);
      }

      const allAIUnits = game.world.getEntitiesWith('Unit', 'Selectable').filter((entity) => {
        const selectable = entity.get<Selectable>('Selectable');
        return (
          selectable !== undefined &&
          aiPlayersAfterSimulation.some((ai) => ai.playerId === selectable.playerId)
        );
      });

      expect(allAIUnits.length).toBeGreaterThanOrEqual(36); // 6 workers x 6 AI players

      const activelyTaskedUnits = allAIUnits.filter((entity) => {
        const unit = entity.get<Unit>('Unit');
        if (!unit) return false;
        return (
          unit.state === 'gathering' ||
          unit.state === 'moving' ||
          unit.state === 'attackmoving' ||
          unit.state === 'building' ||
          unit.targetX !== null ||
          unit.targetEntityId !== null ||
          unit.gatherTargetId !== null
        );
      });

      expect(activelyTaskedUnits.length).toBeGreaterThanOrEqual(24);

      const workersWithGatherTargets = allAIUnits.filter((entity) => {
        const unit = entity.get<Unit>('Unit');
        return unit !== undefined && unit.isWorker && unit.gatherTargetId !== null;
      });
      expect(workersWithGatherTargets.length).toBeGreaterThanOrEqual(18);

      const pathfindingSystem = game.pathfindingSystem as unknown as {
        pendingRequests: { length: number };
        failedPathCache: Map<string, unknown>;
      };

      expect(pathfindingSystem.pendingRequests.length).toBeLessThan(20);
      expect(pathfindingSystem.failedPathCache.size).toBeLessThan(10);
    } finally {
      game.stop();
      globalThis.postMessage = originalPostMessage;
    }
  });
});

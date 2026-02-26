import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { init, NavMeshQuery } from 'recast-navigation';
import { generateSoloNavMesh, generateTileCache } from '@recast-navigation/generators';
import type { MapData } from '@/data/maps/MapTypes';
import { TERRAIN_FEATURE_CONFIG } from '@/data/maps/MapTypes';
import {
  ELEVATION_TO_HEIGHT_FACTOR,
  NAVMESH_CONFIG,
  SOLO_NAVMESH_CONFIG,
} from '@/data/pathfinding.config';
import { jsonToMapData } from '@/data/maps/serialization/deserialize';
import { validateMapJson } from '@/data/maps/schema/MapJsonSchema';

const MAP_JSON_DIRECTORY = path.resolve(process.cwd(), 'src/data/maps/json');
const WORKER_SPAWN_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-4, -4],
  [0, -4],
  [4, -4],
  [-4, 0],
  [4, 0],
  [0, 4],
];

const EXPECTED_SOLO_FALLBACK_MAPS = new Set(['titans_colosseum']);

interface WalkableGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  vertexHeights: Float32Array;
}

interface NavMeshBuildResult {
  mode: 'tilecache' | 'solo';
  query: NavMeshQuery;
}

function getGeneratorError(result: unknown): string {
  if (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    typeof (result as { error?: unknown }).error === 'string'
  ) {
    return (result as { error: string }).error;
  }
  return 'unknown';
}

function buildWalkableGeometry(map: MapData): WalkableGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  let vertexIndex = 0;
  const { width, height, terrain } = map;
  const vertexHeights = new Float32Array((width + 1) * (height + 1));

  const isWalkableCell = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const cell = terrain[y][x];
    if (cell.terrain === 'unwalkable') return false;
    const feature = cell.feature ?? 'none';
    return TERRAIN_FEATURE_CONFIG[feature].walkable;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isWalkableCell(x, y)) continue;

      const cellHeight = terrain[y][x].elevation * ELEVATION_TO_HEIGHT_FACTOR;
      vertexHeights[y * (width + 1) + x] = cellHeight;
      vertexHeights[y * (width + 1) + (x + 1)] = cellHeight;
      vertexHeights[(y + 1) * (width + 1) + x] = cellHeight;
      vertexHeights[(y + 1) * (width + 1) + (x + 1)] = cellHeight;

      const base = vertexIndex;
      vertices.push(x, cellHeight, y);
      vertices.push(x + 1, cellHeight, y);
      vertices.push(x, cellHeight, y + 1);
      vertices.push(x + 1, cellHeight, y + 1);
      vertexIndex += 4;

      indices.push(base, base + 2, base + 1);
      indices.push(base + 1, base + 2, base + 3);
    }
  }

  return {
    positions: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    vertexHeights,
  };
}

function buildNavMesh(geometry: WalkableGeometry): NavMeshBuildResult {
  const tileResult = generateTileCache(geometry.positions, geometry.indices, NAVMESH_CONFIG);

  if (tileResult.success && tileResult.navMesh) {
    return {
      mode: 'tilecache',
      query: new NavMeshQuery(tileResult.navMesh),
    };
  }

  const soloResult = generateSoloNavMesh(geometry.positions, geometry.indices, SOLO_NAVMESH_CONFIG);
  if (!soloResult.success || !soloResult.navMesh) {
    throw new Error(
      `NavMesh generation failed: tilecache="${getGeneratorError(tileResult)}", solo="${getGeneratorError(soloResult)}"`
    );
  }

  return {
    mode: 'solo',
    query: new NavMeshQuery(soloResult.navMesh),
  };
}

function sampleNavmeshHeight(
  heights: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width);
  const y1 = Math.min(y0 + 1, height);
  const fx = x - x0;
  const fy = y - y0;

  const h00 = heights[y0 * (width + 1) + x0];
  const h10 = heights[y0 * (width + 1) + x1];
  const h01 = heights[y1 * (width + 1) + x0];
  const h11 = heights[y1 * (width + 1) + x1];

  return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
}

function projectPoint(query: NavMeshQuery, x: number, y: number, queryHeight: number) {
  return query.findClosestPoint(
    { x, y: queryHeight, z: y },
    {
      halfExtents: {
        x: 2,
        y: NAVMESH_CONFIG.walkableClimb * 3,
        z: 2,
      },
    }
  );
}

function selectPrimaryPathTarget(map: MapData, spawn: MapData['spawns'][number]) {
  const naturalTargets = map.expansions.filter((expansion) => expansion.isNatural);
  if (naturalTargets.length > 0) {
    return naturalTargets.reduce((best, candidate) => {
      const bestDistSq = (best.x - spawn.x) ** 2 + (best.y - spawn.y) ** 2;
      const candidateDistSq = (candidate.x - spawn.x) ** 2 + (candidate.y - spawn.y) ** 2;
      return candidateDistSq < bestDistSq ? candidate : best;
    });
  }

  const otherSpawns = map.spawns.filter((candidate) => candidate.playerSlot !== spawn.playerSlot);
  if (otherSpawns.length > 0) {
    return otherSpawns[0];
  }

  return { x: map.width / 2, y: map.height / 2 };
}

describe('Bundled map navmesh regression', () => {
  beforeAll(async () => {
    await init();
  });

  it('builds navmesh and resolves spawn/worker critical paths', () => {
    const mapFiles = fs
      .readdirSync(MAP_JSON_DIRECTORY)
      .filter((file) => file.endsWith('.json'))
      .sort();

    expect(mapFiles.length).toBeGreaterThan(0);

    const summaries: string[] = [];

    for (const fileName of mapFiles) {
      const filePath = path.join(MAP_JSON_DIRECTORY, fileName);
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      expect(validateMapJson(parsed)).toBe(true);

      const mapData = jsonToMapData(parsed as Parameters<typeof jsonToMapData>[0]);
      const geometry = buildWalkableGeometry(mapData);
      const navMesh = buildNavMesh(geometry);

      if (EXPECTED_SOLO_FALLBACK_MAPS.has(mapData.id)) {
        expect(navMesh.mode).toBe('solo');
      } else {
        expect(navMesh.mode).toBe('tilecache');
      }

      expect(mapData.spawns.length).toBeGreaterThan(0);

      let workerPathChecks = 0;
      for (const spawn of mapData.spawns) {
        const spawnHeight = sampleNavmeshHeight(
          geometry.vertexHeights,
          mapData.width,
          mapData.height,
          spawn.x,
          spawn.y
        );
        const projectedSpawn = projectPoint(navMesh.query, spawn.x, spawn.y, spawnHeight);
        expect(projectedSpawn.success).toBe(true);
        expect(projectedSpawn.point).toBeDefined();

        const pathTarget = selectPrimaryPathTarget(mapData, spawn);
        const targetHeight = sampleNavmeshHeight(
          geometry.vertexHeights,
          mapData.width,
          mapData.height,
          pathTarget.x,
          pathTarget.y
        );
        const projectedTarget = projectPoint(
          navMesh.query,
          pathTarget.x,
          pathTarget.y,
          targetHeight
        );
        expect(projectedTarget.success).toBe(true);
        expect(projectedTarget.point).toBeDefined();

        const spawnPath = navMesh.query.computePath(projectedSpawn.point!, projectedTarget.point!, {
          halfExtents: { x: 2, y: NAVMESH_CONFIG.walkableClimb * 3, z: 2 },
        });
        expect(spawnPath.success).toBe(true);
        expect((spawnPath.path?.length ?? 0) > 0).toBe(true);

        for (const [offsetX, offsetY] of WORKER_SPAWN_OFFSETS) {
          const workerX = Math.min(Math.max(spawn.x + offsetX, 1), mapData.width - 2);
          const workerY = Math.min(Math.max(spawn.y + offsetY, 1), mapData.height - 2);
          const workerHeight = sampleNavmeshHeight(
            geometry.vertexHeights,
            mapData.width,
            mapData.height,
            workerX,
            workerY
          );
          const projectedWorker = projectPoint(navMesh.query, workerX, workerY, workerHeight);
          expect(projectedWorker.success).toBe(true);
          expect(projectedWorker.point).toBeDefined();

          const workerPath = navMesh.query.computePath(
            projectedWorker.point!,
            projectedTarget.point!,
            {
              halfExtents: { x: 2, y: NAVMESH_CONFIG.walkableClimb * 3, z: 2 },
            }
          );
          expect(workerPath.success).toBe(true);
          expect((workerPath.path?.length ?? 0) > 0).toBe(true);
          workerPathChecks++;
        }
      }

      summaries.push(
        `${mapData.id}: mode=${navMesh.mode}, spawns=${mapData.spawns.length}, workerPaths=${workerPathChecks}`
      );
    }

    expect(summaries.length).toBeGreaterThan(0);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { init, NavMeshQuery, statusDetail, Detour } from 'recast-navigation';
import { generateSoloNavMesh } from '@recast-navigation/generators';

import { getMapById, type MapCell } from '@/data/maps';
import type { Ramp } from '@/data/maps/MapTypes';
import {
  generateWalkableNavmeshGeometry,
  sampleNavMeshHeightMap,
} from '@/data/maps/navmesh/generateWalkableNavmeshGeometry';
import { SOLO_NAVMESH_CONFIG } from '@/data/pathfinding.config';

beforeAll(async () => {
  await init();
});

function buildQuery(
  terrain: MapCell[][],
  width: number,
  height: number,
  ramps?: Ramp[]
): { query: NavMeshQuery; navMeshHeightMap: Float32Array } {
  const geometry = generateWalkableNavmeshGeometry({ terrain, width, height, ramps });
  const navMeshResult = generateSoloNavMesh(
    geometry.positions,
    geometry.indices,
    SOLO_NAVMESH_CONFIG
  );

  expect(navMeshResult.success).toBe(true);
  expect(navMeshResult.navMesh).toBeDefined();

  return {
    query: new NavMeshQuery(navMeshResult.navMesh!),
    navMeshHeightMap: geometry.navMeshHeightMap,
  };
}

function expectCompletePath(
  terrain: MapCell[][],
  width: number,
  height: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
  ramps?: Ramp[]
): void {
  const { query, navMeshHeightMap } = buildQuery(terrain, width, height, ramps);
  const halfExtents = { x: 4, y: 20, z: 4 };

  const startPoint = {
    x: start.x,
    y: sampleNavMeshHeightMap(navMeshHeightMap, width, height, start.x, start.y),
    z: start.y,
  };
  const endPoint = {
    x: end.x,
    y: sampleNavMeshHeightMap(navMeshHeightMap, width, height, end.x, end.y),
    z: end.y,
  };

  const startOnMesh = query.findClosestPoint(startPoint, { halfExtents });
  const endOnMesh = query.findClosestPoint(endPoint, { halfExtents });

  expect(startOnMesh.success).toBe(true);
  expect(endOnMesh.success).toBe(true);

  const path = query.findPath(
    startOnMesh.polyRef,
    endOnMesh.polyRef,
    startOnMesh.point,
    endOnMesh.point
  );
  expect(path.success).toBe(true);
  expect(statusDetail(path.status, Detour.DT_PARTIAL_RESULT)).toBe(false);

  const straight = query.findStraightPath(startOnMesh.point, endOnMesh.point, path.polys);
  expect(straight.success).toBe(true);
  expect(straight.straightPathCount).toBeGreaterThan(0);

  const lastIndex = (straight.straightPathCount - 1) * 3;
  const lastPoint = {
    x: straight.straightPath.get(lastIndex),
    y: straight.straightPath.get(lastIndex + 2),
  };
  expect(Math.hypot(lastPoint.x - end.x, lastPoint.y - end.y)).toBeLessThanOrEqual(1);

  straight.straightPath.destroy();
  straight.straightPathFlags.destroy();
  straight.straightPathRefs.destroy();
  path.polys.destroy();
}

function createFlatEditorRampTerrain(): { terrain: MapCell[][]; width: number; height: number } {
  const width = 12;
  const height = 12;
  const terrain: MapCell[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({
      terrain: 'ground' as const,
      elevation: 140,
      feature: 'none' as const,
      textureId: 0,
    }))
  );

  for (let y = 3; y <= 8; y++) {
    for (let x = 0; x <= 4; x++) {
      terrain[y][x] = { ...terrain[y][x], elevation: 220 };
    }
    for (let x = 5; x <= 7; x++) {
      terrain[y][x] = { ...terrain[y][x], terrain: 'ramp', elevation: 140 };
    }
  }

  return { terrain, width, height };
}

describe('Recast ramp connectivity', () => {
  it('keeps editor-style flat ramp terrain connected without explicit ramp metadata', () => {
    const synthetic = createFlatEditorRampTerrain();
    expectCompletePath(
      synthetic.terrain,
      synthetic.width,
      synthetic.height,
      { x: 2.5, y: 5.5 },
      { x: 9.5, y: 5.5 }
    );
  });

  it('keeps contested frontier base exits connected across degenerate bundled ramps', () => {
    const map = getMapById('contested_frontier');
    expect(map).toBeDefined();
    expectCompletePath(
      map!.terrain,
      map!.width,
      map!.height,
      { x: 55, y: 50 },
      { x: 75, y: 50 },
      map!.ramps
    );
  });

  it('keeps crystal caverns and titans colosseum spawn-to-spawn routes complete', () => {
    const map = getMapById('crystal_caverns');
    const titans = getMapById('titans_colosseum');
    expect(map).toBeDefined();
    expect(titans).toBeDefined();
    expectCompletePath(
      map!.terrain,
      map!.width,
      map!.height,
      { x: map!.spawns[0].x, y: map!.spawns[0].y },
      { x: map!.spawns[1].x, y: map!.spawns[1].y },
      map!.ramps
    );
    expectCompletePath(
      titans!.terrain,
      titans!.width,
      titans!.height,
      { x: titans!.spawns[0].x, y: titans!.spawns[0].y },
      { x: titans!.spawns[1].x, y: titans!.spawns[1].y },
      titans!.ramps
    );
  });

  it('keeps local elevated moves complete on scorched basin and void assault', () => {
    const scorched = getMapById('scorched_basin');
    const voidAssault = getMapById('void_assault');
    expect(scorched).toBeDefined();
    expect(voidAssault).toBeDefined();

    expectCompletePath(
      scorched!.terrain,
      scorched!.width,
      scorched!.height,
      { x: scorched!.spawns[0].x, y: scorched!.spawns[0].y },
      { x: scorched!.spawns[0].x + 15, y: scorched!.spawns[0].y + 15 },
      scorched!.ramps
    );

    expectCompletePath(
      voidAssault!.terrain,
      voidAssault!.width,
      voidAssault!.height,
      { x: voidAssault!.spawns[0].x, y: voidAssault!.spawns[0].y },
      { x: voidAssault!.spawns[0].x + 15, y: voidAssault!.spawns[0].y + 15 },
      voidAssault!.ramps
    );
  });
});

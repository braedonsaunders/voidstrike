import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getMapById } from '@/data/maps';
import {
  generateWalkableNavmeshGeometry,
  sampleNavMeshHeightMap,
} from '@/data/maps/navmesh/generateWalkableNavmeshGeometry';
import { RecastNavigation } from '@/engine/pathfinding/RecastNavigation';

function maxLateralDeviation(path: Array<{ x: number; y: number }>, expectedY: number): number {
  return path.reduce((maxDeviation, point) => {
    return Math.max(maxDeviation, Math.abs(point.y - expectedY));
  }, 0);
}

describe('Recast dynamic obstacle elevation', () => {
  beforeAll(async () => {
    await RecastNavigation.initWasm();
  });

  afterEach(() => {
    RecastNavigation.resetInstance();
  });

  it('reroutes around elevated building obstacles on crystal caverns', async () => {
    const map = getMapById('crystal_caverns');
    expect(map).toBeDefined();

    const geometry = generateWalkableNavmeshGeometry({
      terrain: map!.terrain,
      width: map!.width,
      height: map!.height,
      ramps: map!.ramps,
    });

    const recast = RecastNavigation.getInstance();
    recast.setTerrainHeightProvider((x, z) => {
      return sampleNavMeshHeightMap(geometry.navMeshHeightMap, map!.width, map!.height, x, z);
    });

    const generated = await recast.generateFromGeometry(
      geometry.positions,
      geometry.indices,
      map!.width,
      map!.height
    );
    expect(generated).toBe(true);

    const start = { x: 39, y: 39 };
    const end = { x: 59, y: 39 };

    const directPath = recast.findPath(start.x, start.y, end.x, end.y);
    expect(directPath.found).toBe(true);

    recast.addObstacle(1, 43, 39, 5, 5);

    const reroutedPath = recast.findPath(start.x, start.y, end.x, end.y);
    expect(reroutedPath.found).toBe(true);
    expect(reroutedPath.path.length).toBeGreaterThan(directPath.path.length);
    expect(maxLateralDeviation(reroutedPath.path, end.y)).toBeGreaterThan(
      maxLateralDeviation(directPath.path, end.y) + 1
    );
  });
});

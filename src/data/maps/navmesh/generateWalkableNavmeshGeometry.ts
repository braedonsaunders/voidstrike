import { clamp } from '@/utils/math';
import {
  elevationToHeight,
  RAMP_SMOOTHING_MAX_CARDINAL,
  RAMP_SMOOTHING_PASSES,
  WALKABLE_CLIMB_ELEVATION,
} from '@/data/pathfinding.config';
import { TERRAIN_FEATURE_CONFIG, type MapCell, type Ramp } from '../MapTypes';

const CLIFF_WALL_HEIGHT = 4.0;
const PLATFORM_WALL_THRESHOLD_ELEVATION = 20;
const WALKABLE_WALL_BOTTOM_PADDING = 0.5;
const RAMP_ZONE_RADIUS = 8;
const EXTENDED_RAMP_AREA_RADIUS = 2;

export interface WalkableNavmeshGeometryOptions {
  terrain: MapCell[][];
  width: number;
  height: number;
  ramps?: Ramp[];
  baseHeightMap?: Float32Array;
  baseGridWidth?: number;
  baseGridHeight?: number;
}

export interface WalkableNavmeshGeometryResult {
  positions: Float32Array;
  indices: Uint32Array;
  navMeshHeightMap: Float32Array;
}

function isCellWalkable(
  terrain: MapCell[][],
  width: number,
  height: number,
  x: number,
  y: number
): boolean {
  if (x < 0 || x >= width || y < 0 || y >= height) return false;
  const cell = terrain[y][x];
  if (cell.terrain === 'unwalkable') return false;
  const feature = cell.feature || 'none';
  return TERRAIN_FEATURE_CONFIG[feature].walkable;
}

function inferRamps(terrain: MapCell[][], width: number, height: number): Ramp[] {
  const ramps: Ramp[] = [];
  const visited = new Set<string>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (terrain[y][x].terrain !== 'ramp' || visited.has(`${x},${y}`)) continue;

      const cells: Array<{ x: number; y: number }> = [];
      const queue: Array<{ x: number; y: number }> = [{ x, y }];
      visited.add(`${x},${y}`);

      while (queue.length > 0) {
        const cell = queue.shift()!;
        cells.push(cell);

        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const nx = cell.x + dx;
          const ny = cell.y + dy;
          const key = `${nx},${ny}`;

          if (
            nx >= 0 &&
            nx < width &&
            ny >= 0 &&
            ny < height &&
            terrain[ny][nx].terrain === 'ramp' &&
            !visited.has(key)
          ) {
            visited.add(key);
            queue.push({ x: nx, y: ny });
          }
        }
      }

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let minElev = Infinity;
      let maxElev = -Infinity;

      for (const cell of cells) {
        minX = Math.min(minX, cell.x);
        maxX = Math.max(maxX, cell.x);
        minY = Math.min(minY, cell.y);
        maxY = Math.max(maxY, cell.y);
        const elevation = terrain[cell.y][cell.x].elevation;
        minElev = Math.min(minElev, elevation);
        maxElev = Math.max(maxElev, elevation);
      }

      const rampWidth = maxX - minX + 1;
      const rampHeight = maxY - minY + 1;
      let direction: Ramp['direction'] = 'south';

      if (rampWidth > rampHeight) {
        const sampleY = Math.floor((minY + maxY) / 2);
        const leftElev = terrain[sampleY][minX].elevation;
        const rightElev = terrain[sampleY][maxX].elevation;
        direction = leftElev < rightElev ? 'east' : 'west';
      } else {
        const sampleX = Math.floor((minX + maxX) / 2);
        const topElev = terrain[minY][sampleX].elevation;
        const bottomElev = terrain[maxY][sampleX].elevation;
        direction = topElev < bottomElev ? 'south' : 'north';
      }

      ramps.push({
        x: minX,
        y: minY,
        width: rampWidth,
        height: rampHeight,
        direction,
        fromElevation: minElev,
        toElevation: maxElev,
      });
    }
  }

  return ramps;
}

function getRampCells(
  terrain: MapCell[][],
  width: number,
  height: number,
  ramp: Ramp
): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];

  for (let y = ramp.y; y < ramp.y + ramp.height; y++) {
    for (let x = ramp.x; x < ramp.x + ramp.width; x++) {
      if (x >= 0 && x < width && y >= 0 && y < height && terrain[y][x].terrain === 'ramp') {
        cells.push({ x, y });
      }
    }
  }

  return cells;
}

interface RampNeighborSample {
  cellX: number;
  cellY: number;
  elevation: number;
}

function getRampNeighborSamples(
  terrain: MapCell[][],
  width: number,
  height: number,
  cells: Array<{ x: number; y: number }>
): RampNeighborSample[] {
  const samples: RampNeighborSample[] = [];

  for (const cell of cells) {
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const neighbor = terrain[ny][nx];
      if (neighbor.terrain === 'ramp' || !isCellWalkable(terrain, width, height, nx, ny)) {
        continue;
      }

      samples.push({
        cellX: cell.x,
        cellY: cell.y,
        elevation: neighbor.elevation,
      });
    }
  }

  return samples;
}

function getRepresentativeElevation(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizeRampMetadata(
  terrain: MapCell[][],
  width: number,
  height: number,
  ramp: Ramp
): Ramp {
  const cells = getRampCells(terrain, width, height, ramp);
  if (cells.length === 0) return ramp;

  const adjacentSamples = getRampNeighborSamples(terrain, width, height, cells);
  if (adjacentSamples.length === 0) return ramp;

  const adjacentElevations = adjacentSamples.map((sample) => sample.elevation);
  const lowElevation = Math.min(...adjacentElevations);
  const highElevation = Math.max(...adjacentElevations);

  if (highElevation <= lowElevation) {
    return {
      ...ramp,
      fromElevation: lowElevation,
      toElevation: highElevation,
    };
  }

  const midpoint = (lowElevation + highElevation) / 2;
  const lowBoundary = adjacentSamples.filter((sample) => sample.elevation < midpoint);
  const highBoundary = adjacentSamples.filter((sample) => sample.elevation >= midpoint);

  if (lowBoundary.length === 0 || highBoundary.length === 0) {
    return {
      ...ramp,
      fromElevation: lowElevation,
      toElevation: highElevation,
    };
  }

  const computeCentroid = (samples: RampNeighborSample[]): { x: number; y: number } => ({
    x: samples.reduce((sum, sample) => sum + sample.cellX, 0) / samples.length,
    y: samples.reduce((sum, sample) => sum + sample.cellY, 0) / samples.length,
  });
  const lowCentroid = computeCentroid(lowBoundary);
  const highCentroid = computeCentroid(highBoundary);
  const deltaX = highCentroid.x - lowCentroid.x;
  const deltaY = highCentroid.y - lowCentroid.y;

  let direction = ramp.direction;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    direction = deltaX >= 0 ? 'east' : 'west';
  } else {
    direction = deltaY >= 0 ? 'south' : 'north';
  }

  return {
    ...ramp,
    direction,
    fromElevation: lowElevation,
    toElevation: highElevation,
  };
}

function normalizeRamps(
  terrain: MapCell[][],
  width: number,
  height: number,
  ramps: Ramp[]
): Ramp[] {
  return ramps.map((ramp) => normalizeRampMetadata(terrain, width, height, ramp));
}

function getRampEdgeCells(
  cells: Array<{ x: number; y: number }>,
  width: number,
  direction: Ramp['direction'],
  side: 'low' | 'high'
): number[] {
  if (cells.length === 0) return [];

  let target = side === 'high' ? -Infinity : Infinity;

  for (const cell of cells) {
    const axisValue = direction === 'east' || direction === 'west' ? cell.x : cell.y;
    if (side === 'high') {
      target = Math.max(target, axisValue);
    } else {
      target = Math.min(target, axisValue);
    }
  }

  return cells
    .filter((cell) => {
      const axisValue = direction === 'east' || direction === 'west' ? cell.x : cell.y;
      return axisValue === target;
    })
    .map((cell) => cell.y * width + cell.x);
}

function buildRampCellElevationMap(
  terrain: MapCell[][],
  width: number,
  height: number,
  ramps: Ramp[]
): Float32Array {
  const rampCellElevations = new Float32Array(width * height);
  rampCellElevations.fill(Number.NaN);

  const neighborOffsets = [
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
  ] as const;

  const encodeCell = (x: number, y: number): number => y * width + x;
  const decodeCell = (encoded: number): { x: number; y: number } => ({
    x: encoded % width,
    y: Math.floor(encoded / width),
  });

  const computeDistances = (cellSet: Set<number>, sources: number[]): Map<number, number> => {
    const distances = new Map<number, number>();
    const queue = [...sources];

    for (const source of sources) {
      if (cellSet.has(source) && !distances.has(source)) {
        distances.set(source, 0);
      }
    }

    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      const currentDistance = distances.get(current);
      if (currentDistance === undefined) continue;

      const { x, y } = decodeCell(current);
      for (const { dx, dy } of neighborOffsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const neighbor = encodeCell(nx, ny);
        if (!cellSet.has(neighbor) || distances.has(neighbor)) continue;

        distances.set(neighbor, currentDistance + 1);
        queue.push(neighbor);
      }
    }

    return distances;
  };

  for (const ramp of ramps) {
    const cells = getRampCells(terrain, width, height, ramp);
    if (cells.length === 0) continue;

    const cellIds = cells.map((cell) => encodeCell(cell.x, cell.y));
    const cellSet = new Set<number>(cellIds);
    const adjacentElevations: number[] = [];
    const highBoundary = new Set<number>();
    const lowBoundary = new Set<number>();

    for (const cell of cells) {
      for (const { dx, dy } of neighborOffsets) {
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const neighbor = terrain[ny][nx];
        if (neighbor.terrain === 'ramp' || !isCellWalkable(terrain, width, height, nx, ny)) {
          continue;
        }

        adjacentElevations.push(neighbor.elevation);
      }
    }

    const metadataLowElevation = Math.min(ramp.fromElevation, ramp.toElevation);
    const metadataHighElevation = Math.max(ramp.fromElevation, ramp.toElevation);
    const rampCellElevationsRaw = cells.map((cell) => terrain[cell.y][cell.x].elevation);

    let lowElevation = getRepresentativeElevation(adjacentElevations) ?? metadataLowElevation;
    let highElevation = lowElevation;

    if (adjacentElevations.length > 0) {
      lowElevation = Math.min(...adjacentElevations);
      highElevation = Math.max(...adjacentElevations);
    } else {
      lowElevation = Math.min(metadataLowElevation, ...rampCellElevationsRaw);
      highElevation = Math.max(metadataHighElevation, ...rampCellElevationsRaw);
    }

    if (highElevation > lowElevation) {
      const midpoint = (lowElevation + highElevation) / 2;

      for (const cell of cells) {
        const cellId = encodeCell(cell.x, cell.y);

        for (const { dx, dy } of neighborOffsets) {
          const nx = cell.x + dx;
          const ny = cell.y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

          const neighbor = terrain[ny][nx];
          if (neighbor.terrain === 'ramp' || !isCellWalkable(terrain, width, height, nx, ny)) {
            continue;
          }

          if (neighbor.elevation >= midpoint) {
            highBoundary.add(cellId);
          } else {
            lowBoundary.add(cellId);
          }
        }
      }
    }

    if (highBoundary.size === 0 || lowBoundary.size === 0) {
      const fallbackHigh = getRampEdgeCells(cells, width, ramp.direction, 'high');
      const fallbackLow = getRampEdgeCells(cells, width, ramp.direction, 'low');
      for (const cellId of fallbackHigh) {
        highBoundary.add(cellId);
      }
      for (const cellId of fallbackLow) {
        lowBoundary.add(cellId);
      }
    }

    if (highElevation <= lowElevation || highBoundary.size === 0 || lowBoundary.size === 0) {
      const fallbackElevation =
        highElevation > lowElevation
          ? (highElevation + lowElevation) / 2
          : (metadataHighElevation + metadataLowElevation) / 2 || rampCellElevationsRaw[0];

      for (const cellId of cellIds) {
        rampCellElevations[cellId] = fallbackElevation;
      }
      continue;
    }

    const highDistances = computeDistances(cellSet, [...highBoundary]);
    const lowDistances = computeDistances(cellSet, [...lowBoundary]);

    for (const cellId of cellIds) {
      const highDistance = highDistances.get(cellId);
      const lowDistance = lowDistances.get(cellId);

      if (highDistance === undefined && lowDistance === undefined) {
        rampCellElevations[cellId] = (highElevation + lowElevation) / 2;
        continue;
      }
      if (highDistance === undefined) {
        rampCellElevations[cellId] = lowElevation;
        continue;
      }
      if (lowDistance === undefined) {
        rampCellElevations[cellId] = highElevation;
        continue;
      }

      const totalDistance = highDistance + lowDistance;
      if (totalDistance === 0) {
        rampCellElevations[cellId] = (highElevation + lowElevation) / 2;
        continue;
      }

      const t = clamp(lowDistance / totalDistance, 0, 1);
      rampCellElevations[cellId] = lowElevation + (highElevation - lowElevation) * t;
    }
  }

  return rampCellElevations;
}

function sampleVertexHeight(
  terrain: MapCell[][],
  width: number,
  height: number,
  rampCellElevations: Float32Array,
  x: number,
  y: number
): number {
  const values: number[] = [];

  for (const [cx, cy] of [
    [x - 1, y - 1],
    [x, y - 1],
    [x - 1, y],
    [x, y],
  ] as const) {
    if (!isCellWalkable(terrain, width, height, cx, cy)) continue;

    const cell = terrain[cy][cx];
    if (cell.terrain === 'ramp') {
      const rampElevation = rampCellElevations[cy * width + cx];
      if (Number.isFinite(rampElevation)) {
        values.push(elevationToHeight(rampElevation));
        continue;
      }
    }

    values.push(elevationToHeight(cell.elevation));
  }

  if (values.length === 0) return 0;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildDeterministicBaseHeightMap(
  terrain: MapCell[][],
  width: number,
  height: number,
  rampCellElevations: Float32Array
): Float32Array {
  const baseHeightMap = new Float32Array((width + 1) * (height + 1));

  for (let y = 0; y <= height; y++) {
    for (let x = 0; x <= width; x++) {
      baseHeightMap[y * (width + 1) + x] = sampleVertexHeight(
        terrain,
        width,
        height,
        rampCellElevations,
        x,
        y
      );
    }
  }

  const temp = new Float32Array(baseHeightMap.length);
  const isRampOrPlatformOrAdjacentVertex = (vertexX: number, vertexY: number): boolean => {
    for (let dy = -2; dy <= 1; dy++) {
      for (let dx = -2; dx <= 1; dx++) {
        const cellX = vertexX + dx;
        const cellY = vertexY + dy;
        if (cellX >= 0 && cellX < width && cellY >= 0 && cellY < height) {
          const terrainType = terrain[cellY][cellX].terrain;
          if (terrainType === 'ramp' || terrainType === 'platform') {
            return true;
          }
        }
      }
    }

    return false;
  };
  const isPlateauEdgeVertex = (vertexX: number, vertexY: number): boolean => {
    let hasGround = false;
    let hasUnwalkable = false;
    let hasRamp = false;

    for (const { cx, cy } of [
      { cx: vertexX - 1, cy: vertexY - 1 },
      { cx: vertexX, cy: vertexY - 1 },
      { cx: vertexX - 1, cy: vertexY },
      { cx: vertexX, cy: vertexY },
    ]) {
      if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;

      const terrainType = terrain[cy][cx].terrain;
      if (terrainType === 'ground' || terrainType === 'unbuildable' || terrainType === 'platform') {
        hasGround = true;
      }
      if (terrainType === 'unwalkable') {
        hasUnwalkable = true;
      }
      if (terrainType === 'ramp') {
        hasRamp = true;
      }
    }

    return hasGround && hasUnwalkable && !hasRamp;
  };

  for (let iteration = 0; iteration < 2; iteration++) {
    for (let y = 0; y <= height; y++) {
      for (let x = 0; x <= width; x++) {
        const index = y * (width + 1) + x;

        if (isRampOrPlatformOrAdjacentVertex(x, y) || isPlateauEdgeVertex(x, y)) {
          temp[index] = baseHeightMap[index];
          continue;
        }

        let sum = baseHeightMap[index] * 4;
        let weight = 4;

        for (const { dx, dy, weight: sampleWeight } of [
          { dx: -1, dy: 0, weight: 2 },
          { dx: 1, dy: 0, weight: 2 },
          { dx: 0, dy: -1, weight: 2 },
          { dx: 0, dy: 1, weight: 2 },
          { dx: -1, dy: -1, weight: 1 },
          { dx: 1, dy: -1, weight: 1 },
          { dx: -1, dy: 1, weight: 1 },
          { dx: 1, dy: 1, weight: 1 },
        ]) {
          const neighborX = x + dx;
          const neighborY = y + dy;
          if (neighborX >= 0 && neighborX <= width && neighborY >= 0 && neighborY <= height) {
            sum += baseHeightMap[neighborY * (width + 1) + neighborX] * sampleWeight;
            weight += sampleWeight;
          }
        }

        temp[index] = sum / weight;
      }
    }

    baseHeightMap.set(temp);
  }

  return baseHeightMap;
}

function applyRampHeightOverrides(
  sourceHeightMap: Float32Array,
  sourceGridWidth: number,
  sourceGridHeight: number,
  terrain: MapCell[][],
  width: number,
  height: number,
  rampCellElevations: Float32Array
): Float32Array {
  const heightMap = new Float32Array((width + 1) * (height + 1));

  for (let y = 0; y <= height; y++) {
    for (let x = 0; x <= width; x++) {
      const index = y * (width + 1) + x;
      const values: number[] = [];
      let touchesRamp = false;

      for (const [cx, cy] of [
        [x - 1, y - 1],
        [x, y - 1],
        [x - 1, y],
        [x, y],
      ] as const) {
        if (!isCellWalkable(terrain, width, height, cx, cy)) continue;

        const cell = terrain[cy][cx];
        if (cell.terrain === 'ramp') {
          const rampElevation = rampCellElevations[cy * width + cx];
          if (Number.isFinite(rampElevation)) {
            values.push(elevationToHeight(rampElevation));
            touchesRamp = true;
            continue;
          }
        }

        values.push(getSourceHeight(sourceHeightMap, sourceGridWidth, sourceGridHeight, x, y));
      }

      if (touchesRamp && values.length > 0) {
        heightMap[index] = values.reduce((sum, value) => sum + value, 0) / values.length;
      } else {
        heightMap[index] = getSourceHeight(
          sourceHeightMap,
          sourceGridWidth,
          sourceGridHeight,
          x,
          y
        );
      }
    }
  }

  return heightMap;
}

function getSourceHeight(
  sourceHeightMap: Float32Array,
  sourceGridWidth: number,
  sourceGridHeight: number,
  x: number,
  y: number
): number {
  const clampedX = clamp(x, 0, sourceGridWidth - 1);
  const clampedY = clamp(y, 0, sourceGridHeight - 1);
  return sourceHeightMap[clampedY * sourceGridWidth + clampedX];
}

export function sampleNavMeshHeightMap(
  navMeshHeightMap: Float32Array,
  width: number,
  height: number,
  worldX: number,
  worldY: number
): number {
  if (worldX < 0 || worldX >= width || worldY < 0 || worldY >= height) {
    return 0;
  }

  const gridWidth = width + 1;
  const x0 = Math.floor(worldX);
  const y0 = Math.floor(worldY);
  const x1 = Math.min(x0 + 1, width);
  const y1 = Math.min(y0 + 1, height);

  const fx = worldX - x0;
  const fy = worldY - y0;

  const h00 = navMeshHeightMap[y0 * gridWidth + x0];
  const h10 = navMeshHeightMap[y0 * gridWidth + x1];
  const h01 = navMeshHeightMap[y1 * gridWidth + x0];
  const h11 = navMeshHeightMap[y1 * gridWidth + x1];

  return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
}

export function generateWalkableNavmeshGeometry(
  options: WalkableNavmeshGeometryOptions
): WalkableNavmeshGeometryResult {
  const { terrain, width, height } = options;
  const ramps = normalizeRamps(
    terrain,
    width,
    height,
    options.ramps ?? inferRamps(terrain, width, height)
  );
  const hasDegenerateRampMetadata = ramps.some((ramp) => ramp.fromElevation === ramp.toElevation);
  const rampCellElevations = buildRampCellElevationMap(terrain, width, height, ramps);

  const baseHeightMap =
    options.baseHeightMap ??
    buildDeterministicBaseHeightMap(terrain, width, height, rampCellElevations);
  const sourceGridWidth = options.baseGridWidth ?? width + 1;
  const sourceGridHeight = options.baseGridHeight ?? height + 1;
  const sourceHeightMap = applyRampHeightOverrides(
    baseHeightMap,
    sourceGridWidth,
    sourceGridHeight,
    terrain,
    width,
    height,
    rampCellElevations
  );

  const vertices: number[] = [];
  const indices: number[] = [];
  let vertexIndex = 0;

  const rampZone = new Set<string>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (terrain[y][x].terrain !== 'ramp') continue;

      for (let dy = -RAMP_ZONE_RADIUS; dy <= RAMP_ZONE_RADIUS; dy++) {
        for (let dx = -RAMP_ZONE_RADIUS; dx <= RAMP_ZONE_RADIUS; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            rampZone.add(`${nx},${ny}`);
          }
        }
      }
    }
  }

  const adjacentToRampZone = new Set<string>();
  for (const key of rampZone) {
    const [x, y] = key.split(',').map(Number);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const neighborKey = `${nx},${ny}`;
          if (!rampZone.has(neighborKey)) {
            adjacentToRampZone.add(neighborKey);
          }
        }
      }
    }
  }

  const extendedRampArea = new Set<string>(adjacentToRampZone);
  for (const key of adjacentToRampZone) {
    const [x, y] = key.split(',').map(Number);
    for (let dy = -EXTENDED_RAMP_AREA_RADIUS; dy <= EXTENDED_RAMP_AREA_RADIUS; dy++) {
      for (let dx = -EXTENDED_RAMP_AREA_RADIUS; dx <= EXTENDED_RAMP_AREA_RADIUS; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const neighborKey = `${nx},${ny}`;
          if (!rampZone.has(neighborKey) && !adjacentToRampZone.has(neighborKey)) {
            extendedRampArea.add(neighborKey);
          }
        }
      }
    }
  }

  const cliffEdgeCells = new Set<string>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = terrain[y][x];
      const key = `${x},${y}`;

      if (cell.terrain === 'unwalkable' || cell.terrain === 'ramp') continue;
      if (rampZone.has(key) || adjacentToRampZone.has(key) || extendedRampArea.has(key)) continue;

      let isCliffEdge = false;
      for (let dy = -1; dy <= 1 && !isCliffEdge; dy++) {
        for (let dx = -1; dx <= 1 && !isCliffEdge; dx++) {
          if (dx === 0 && dy === 0) continue;

          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

          const neighbor = terrain[ny][nx];
          const neighborKey = `${nx},${ny}`;

          if (neighbor.terrain === 'unwalkable') {
            isCliffEdge = true;
            continue;
          }

          if (
            neighbor.terrain !== 'ramp' &&
            !rampZone.has(neighborKey) &&
            !adjacentToRampZone.has(neighborKey) &&
            !extendedRampArea.has(neighborKey) &&
            Math.abs(neighbor.elevation - cell.elevation) > WALKABLE_CLIMB_ELEVATION
          ) {
            isCliffEdge = true;
          }
        }
      }

      if (isCliffEdge) {
        cliffEdgeCells.add(key);
      }
    }
  }

  const expandedCliffEdgeCells = new Set<string>(cliffEdgeCells);
  for (const key of cliffEdgeCells) {
    const [x, y] = key.split(',').map(Number);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const neighbor = terrain[ny][nx];
        const neighborKey = `${nx},${ny}`;
        if (
          neighbor.terrain !== 'unwalkable' &&
          neighbor.terrain !== 'ramp' &&
          !rampZone.has(neighborKey) &&
          !adjacentToRampZone.has(neighborKey) &&
          !extendedRampArea.has(neighborKey)
        ) {
          expandedCliffEdgeCells.add(neighborKey);
        }
      }
    }
  }

  const navMeshHeightMap = new Float32Array((width + 1) * (height + 1));
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x <= width; x++) {
      let touchesRampArea = false;
      let allCliffEdge = true;
      let cliffElevation = 0;

      for (const { cx, cy } of [
        { cx: x - 1, cy: y - 1 },
        { cx: x, cy: y - 1 },
        { cx: x - 1, cy: y },
        { cx: x, cy: y },
      ]) {
        if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;

        const cellKey = `${cx},${cy}`;
        if (
          rampZone.has(cellKey) ||
          adjacentToRampZone.has(cellKey) ||
          extendedRampArea.has(cellKey)
        ) {
          touchesRampArea = true;
        }

        if (!expandedCliffEdgeCells.has(cellKey)) {
          allCliffEdge = false;
          continue;
        }

        cliffElevation = Math.max(cliffElevation, terrain[cy][cx].elevation);
      }

      if (touchesRampArea || !allCliffEdge) {
        navMeshHeightMap[y * (width + 1) + x] = getSourceHeight(
          sourceHeightMap,
          sourceGridWidth,
          sourceGridHeight,
          x,
          y
        );
      } else {
        navMeshHeightMap[y * (width + 1) + x] = elevationToHeight(cliffElevation);
      }
    }
  }

  const rampVertices = new Set<string>();
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x <= width; x++) {
      let touchesActualRamp = false;

      for (const { cx, cy } of [
        { cx: x - 1, cy: y - 1 },
        { cx: x, cy: y - 1 },
        { cx: x - 1, cy: y },
        { cx: x, cy: y },
      ]) {
        if (cx >= 0 && cx < width && cy >= 0 && cy < height && terrain[cy][cx].terrain === 'ramp') {
          touchesActualRamp = true;
          break;
        }
      }

      if (touchesActualRamp) {
        rampVertices.add(`${x},${y}`);
      }
    }
  }

  const maxHeightChangePerCell = Math.min(RAMP_SMOOTHING_MAX_CARDINAL, 1.0);
  for (let pass = 0; pass < Math.max(1, RAMP_SMOOTHING_PASSES); pass++) {
    let changed = false;

    for (let y = 0; y <= height; y++) {
      for (let x = 0; x <= width; x++) {
        const vertexKey = `${x},${y}`;
        if (rampVertices.has(vertexKey)) continue;

        let nearRamp = false;
        for (const { cx, cy } of [
          { cx: x - 1, cy: y - 1 },
          { cx: x, cy: y - 1 },
          { cx: x - 1, cy: y },
          { cx: x, cy: y },
        ]) {
          if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;

          const cellKey = `${cx},${cy}`;
          if (
            rampZone.has(cellKey) ||
            adjacentToRampZone.has(cellKey) ||
            extendedRampArea.has(cellKey)
          ) {
            nearRamp = true;
            break;
          }
        }
        if (!nearRamp) continue;

        const index = y * (width + 1) + x;
        const currentHeight = navMeshHeightMap[index];
        let targetHeight = currentHeight;

        for (const [dx, dy] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx > width || ny < 0 || ny > height) continue;

          const neighborHeight = navMeshHeightMap[ny * (width + 1) + nx];
          const heightDiff = currentHeight - neighborHeight;

          if (heightDiff > maxHeightChangePerCell) {
            targetHeight = Math.min(targetHeight, neighborHeight + maxHeightChangePerCell);
          } else if (heightDiff < -maxHeightChangePerCell) {
            targetHeight = Math.max(targetHeight, neighborHeight - maxHeightChangePerCell);
          }
        }

        if (Math.abs(targetHeight - currentHeight) > 0.01) {
          navMeshHeightMap[index] = targetHeight;
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  const geometryHeightMap = hasDegenerateRampMetadata
    ? (() => {
        const relaxed = new Float32Array(navMeshHeightMap);
        const temp = new Float32Array(relaxed.length);
        const touchesRampSmoothingArea = (vertexX: number, vertexY: number): boolean => {
          for (let dy = -3; dy <= 2; dy++) {
            for (let dx = -3; dx <= 2; dx++) {
              const cellX = vertexX + dx;
              const cellY = vertexY + dy;
              if (
                cellX >= 0 &&
                cellX < width &&
                cellY >= 0 &&
                cellY < height &&
                terrain[cellY][cellX].terrain === 'ramp'
              ) {
                return true;
              }
            }
          }

          return false;
        };

        for (let pass = 0; pass < 40; pass++) {
          temp.set(relaxed);

          for (let y = 0; y <= height; y++) {
            for (let x = 0; x <= width; x++) {
              if (!touchesRampSmoothingArea(x, y)) continue;

              const index = y * (width + 1) + x;
              let targetHeight = relaxed[index];

              for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ] as const) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx > width || ny < 0 || ny > height) continue;

                const neighborHeight = relaxed[ny * (width + 1) + nx];
                if (targetHeight - neighborHeight > 0.5) {
                  targetHeight = Math.min(targetHeight, neighborHeight + 0.5);
                } else if (neighborHeight - targetHeight > 0.5) {
                  targetHeight = Math.max(targetHeight, neighborHeight - 0.5);
                }
              }

              temp[index] = targetHeight;
            }
          }

          relaxed.set(temp);
        }

        return relaxed;
      })()
    : navMeshHeightMap;

  const getVertexHeight = (x: number, y: number): number => {
    const clampedX = clamp(x, 0, width);
    const clampedY = clamp(y, 0, height);
    return geometryHeightMap[clampedY * (width + 1) + clampedX];
  };

  const needsCliffWall = (
    x: number,
    y: number,
    neighborX: number,
    neighborY: number
  ): { needed: boolean; topHeight: number; bottomHeight: number } => {
    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      return { needed: false, topHeight: 0, bottomHeight: 0 };
    }

    const key = `${x},${y}`;
    const neighborKey = `${neighborX},${neighborY}`;
    if (rampZone.has(key) || rampZone.has(neighborKey)) {
      return { needed: false, topHeight: 0, bottomHeight: 0 };
    }

    const cell = terrain[y][x];
    const neighbor = terrain[neighborY][neighborX];

    if (neighbor.terrain === 'unwalkable') {
      const cellHeight = elevationToHeight(cell.elevation);
      return {
        needed: true,
        topHeight: cellHeight,
        bottomHeight: cellHeight - CLIFF_WALL_HEIGHT,
      };
    }

    if (cell.terrain === 'platform' && neighbor.terrain !== 'ramp') {
      const elevationDiff = cell.elevation - neighbor.elevation;
      if (elevationDiff > PLATFORM_WALL_THRESHOLD_ELEVATION) {
        return {
          needed: true,
          topHeight: elevationToHeight(cell.elevation),
          bottomHeight: elevationToHeight(neighbor.elevation),
        };
      }
    }

    if (cell.terrain !== 'ramp' && neighbor.terrain !== 'ramp') {
      const elevationDiff = Math.abs(cell.elevation - neighbor.elevation);
      if (elevationDiff > WALKABLE_CLIMB_ELEVATION) {
        const cellHeight = elevationToHeight(cell.elevation);
        const neighborHeight = elevationToHeight(neighbor.elevation);
        return {
          needed: true,
          topHeight: Math.max(cellHeight, neighborHeight),
          bottomHeight: Math.min(cellHeight, neighborHeight) - WALKABLE_WALL_BOTTOM_PADDING,
        };
      }
    }

    return { needed: false, topHeight: 0, bottomHeight: 0 };
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isCellWalkable(terrain, width, height, x, y)) continue;

      const h00 = getVertexHeight(x, y);
      const h10 = getVertexHeight(x + 1, y);
      const h01 = getVertexHeight(x, y + 1);
      const h11 = getVertexHeight(x + 1, y + 1);

      vertices.push(x, h00, y);
      vertices.push(x, h01, y + 1);
      vertices.push(x + 1, h10, y);
      indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
      vertexIndex += 3;

      vertices.push(x + 1, h10, y);
      vertices.push(x, h01, y + 1);
      vertices.push(x + 1, h11, y + 1);
      indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
      vertexIndex += 3;
    }
  }

  if (!hasDegenerateRampMetadata) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = terrain[y][x];
        const key = `${x},${y}`;
        if (!isCellWalkable(terrain, width, height, x, y)) continue;
        if (cell.terrain === 'ramp' || rampZone.has(key)) continue;

        for (const edge of [
          { neighborX: x + 1, neighborY: y, edgeX: x + 1, y1: y, y2: y + 1 },
          { neighborX: x - 1, neighborY: y, edgeX: x, y1: y, y2: y + 1 },
        ] as const) {
          const wall = needsCliffWall(x, y, edge.neighborX, edge.neighborY);
          if (!wall.needed) continue;

          vertices.push(
            edge.edgeX,
            wall.topHeight,
            edge.y1,
            edge.edgeX,
            wall.topHeight,
            edge.y2,
            edge.edgeX,
            wall.bottomHeight,
            edge.y1,
            edge.edgeX,
            wall.bottomHeight,
            edge.y2
          );
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
          indices.push(vertexIndex + 1, vertexIndex + 3, vertexIndex + 2);
          indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 1);
          indices.push(vertexIndex + 1, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }

        for (const edge of [
          { neighborX: x, neighborY: y + 1, edgeY: y + 1, x1: x, x2: x + 1 },
          { neighborX: x, neighborY: y - 1, edgeY: y, x1: x, x2: x + 1 },
        ] as const) {
          const wall = needsCliffWall(x, y, edge.neighborX, edge.neighborY);
          if (!wall.needed) continue;

          vertices.push(
            edge.x1,
            wall.topHeight,
            edge.edgeY,
            edge.x2,
            wall.topHeight,
            edge.edgeY,
            edge.x1,
            wall.bottomHeight,
            edge.edgeY,
            edge.x2,
            wall.bottomHeight,
            edge.edgeY
          );
          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
          indices.push(vertexIndex + 1, vertexIndex + 3, vertexIndex + 2);
          indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 1);
          indices.push(vertexIndex + 1, vertexIndex + 2, vertexIndex + 3);
          vertexIndex += 4;
        }
      }
    }
  }

  return {
    positions: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    navMeshHeightMap: geometryHeightMap,
  };
}

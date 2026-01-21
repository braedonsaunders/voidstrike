/**
 * Fix Map Ramps - Clean up artifact ramps and regenerate from terrain types
 *
 * The ramps in some map JSONs have artifacts from old generation:
 * - Diamond/diagonal patterns that aren't proper corridors
 * - Massive ramps covering the entire map
 * - 1x1 dummy ramps with same from/to elevation
 *
 * This script fixes maps by:
 * 1. Identifying valid vs artifact ramp regions based on shape
 * 2. Converting artifact 'r' cells back to 'g' (ground)
 * 3. Regenerating the ramps array from cleaned terrain
 */

import * as fs from 'fs';
import * as path from 'path';

interface RampJson {
  x: number;
  y: number;
  width: number;
  height: number;
  direction: 'north' | 'south' | 'east' | 'west';
  fromElevation: 0 | 1 | 2;
  toElevation: 0 | 1 | 2;
}

interface MapJson {
  id: string;
  name: string;
  width: number;
  height: number;
  terrain: {
    elevation: number[];
    types: string;
    features: Array<{ x: number; y: number; f: string }>;
  };
  ramps: RampJson[];
  [key: string]: unknown;
}

const MAPS_DIR = path.join(__dirname, '../src/data/maps/json');

// Minimum ramp size to be considered valid (filters out noise)
const MIN_RAMP_CELLS = 4;

// Thresholds for identifying artifact ramps
// Ramps are artifacts if they're BOTH sparse AND large
const ARTIFACT_MAX_FILL_RATIO = 0.15; // Diamond/diagonal patterns have very low fill
const ARTIFACT_MIN_MAP_RATIO = 0.5; // Artifacts typically span >50% of the map

/**
 * Find all connected components of 'r' cells using flood fill
 */
function findRampRegions(
  types: string,
  width: number,
  height: number
): Array<Array<{ x: number; y: number }>> {
  const visited = new Set<string>();
  const regions: Array<Array<{ x: number; y: number }>> = [];

  const getIndex = (x: number, y: number) => y * width + x;
  const isRamp = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    return types[getIndex(x, y)] === 'r';
  };

  // Flood fill to find connected region
  const floodFill = (startX: number, startY: number): Array<{ x: number; y: number }> => {
    const region: Array<{ x: number; y: number }> = [];
    const stack: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];

    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      if (!isRamp(x, y)) continue;

      visited.add(key);
      region.push({ x, y });

      // Check 4-connected neighbors (not diagonals for ramps)
      stack.push({ x: x - 1, y });
      stack.push({ x: x + 1, y });
      stack.push({ x, y: y - 1 });
      stack.push({ x, y: y + 1 });
    }

    return region;
  };

  // Scan entire map for ramp cells
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = `${x},${y}`;
      if (!visited.has(key) && isRamp(x, y)) {
        const region = floodFill(x, y);
        if (region.length >= MIN_RAMP_CELLS) {
          regions.push(region);
        }
      }
    }
  }

  return regions;
}

/**
 * Convert elevation (0-255) to legacy level (0-2)
 */
function elevationToLevel(elev: number): 0 | 1 | 2 {
  if (elev <= 85) return 0;
  if (elev <= 170) return 1;
  return 2;
}

/**
 * Create RampJson from a connected region of ramp cells
 */
function regionToRamp(
  region: Array<{ x: number; y: number }>,
  elevation: number[],
  width: number
): RampJson {
  // Find bounding box
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  let minElev = 255,
    maxElev = 0;

  for (const { x, y } of region) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    const elev = elevation[y * width + x];
    minElev = Math.min(minElev, elev);
    maxElev = Math.max(maxElev, elev);
  }

  const rampWidth = maxX - minX + 1;
  const rampHeight = maxY - minY + 1;

  // Determine direction based on elevation gradient
  let direction: RampJson['direction'] = 'south';

  if (rampWidth > rampHeight) {
    // Horizontal ramp
    const midY = Math.floor((minY + maxY) / 2);
    const leftElev = elevation[midY * width + minX];
    const rightElev = elevation[midY * width + maxX];
    direction = leftElev < rightElev ? 'east' : 'west';
  } else {
    // Vertical ramp
    const midX = Math.floor((minX + maxX) / 2);
    const topElev = elevation[minY * width + midX];
    const bottomElev = elevation[maxY * width + midX];
    direction = topElev < bottomElev ? 'south' : 'north';
  }

  return {
    x: minX,
    y: minY,
    width: rampWidth,
    height: rampHeight,
    direction,
    fromElevation: elevationToLevel(minElev),
    toElevation: elevationToLevel(maxElev),
  };
}

interface RegionStats {
  cells: Array<{ x: number; y: number }>;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  area: number;
  fillRatio: number;
  mapRatio: number;
}

/**
 * Compute statistics for a ramp region
 */
function computeRegionStats(
  cells: Array<{ x: number; y: number }>,
  mapWidth: number,
  mapHeight: number
): RegionStats {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  for (const { x, y } of cells) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const area = width * height;
  const fillRatio = cells.length / area;
  const mapRatio = Math.max(width / mapWidth, height / mapHeight);

  return { cells, minX, maxX, minY, maxY, width, height, area, fillRatio, mapRatio };
}

/**
 * Check if a ramp region is an artifact that should be removed
 *
 * Artifact patterns are BOTH:
 * 1. Sparse (low fill ratio) - diamond/diagonal patterns don't fill their bbox
 * 2. Large (high map ratio) - they span a huge portion of the map
 */
function isArtifactRamp(stats: RegionStats): boolean {
  return stats.fillRatio < ARTIFACT_MAX_FILL_RATIO && stats.mapRatio > ARTIFACT_MIN_MAP_RATIO;
}

/**
 * Process a single map file
 */
function processMap(filePath: string): {
  changed: boolean;
  oldCount: number;
  newCount: number;
  removedCells: number;
} {
  const content = fs.readFileSync(filePath, 'utf-8');
  const map: MapJson = JSON.parse(content);

  const oldRamps = map.ramps;
  const oldCount = oldRamps.length;
  const oldRCells = (map.terrain.types.match(/r/g) || []).length;

  // Find connected ramp regions
  const regions = findRampRegions(map.terrain.types, map.width, map.height);

  // Analyze each region
  const regionStats = regions.map((cells) => computeRegionStats(cells, map.width, map.height));

  // Separate valid from artifact regions
  const validRegions: RegionStats[] = [];
  const artifactCells: Array<{ x: number; y: number }> = [];

  for (const stats of regionStats) {
    if (isArtifactRamp(stats)) {
      artifactCells.push(...stats.cells);
    } else {
      validRegions.push(stats);
    }
  }

  // Convert artifact 'r' cells to 'g' in terrain.types
  if (artifactCells.length > 0) {
    const types = map.terrain.types.split('');
    for (const { x, y } of artifactCells) {
      const idx = y * map.width + x;
      types[idx] = 'g';
    }
    map.terrain.types = types.join('');
  }

  // Convert valid regions to RampJson
  const newRamps = validRegions.map((stats) =>
    regionToRamp(stats.cells, map.terrain.elevation, map.width)
  );

  // Sort ramps by position for consistent output
  newRamps.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  // Check if actually changed
  const newRCells = (map.terrain.types.match(/r/g) || []).length;
  const rampsChanged = JSON.stringify(oldRamps) !== JSON.stringify(newRamps);
  const terrainChanged = artifactCells.length > 0;
  const changed = rampsChanged || terrainChanged;

  if (changed) {
    map.ramps = newRamps;
    fs.writeFileSync(filePath, JSON.stringify(map, null, 2) + '\n');
  }

  return {
    changed,
    oldCount,
    newCount: newRamps.length,
    removedCells: oldRCells - newRCells,
  };
}

/**
 * Main entry point
 */
function main() {
  console.log('=== Fix Map Ramps ===\n');

  const files = fs.readdirSync(MAPS_DIR).filter((f) => f.endsWith('.json'));

  let totalChanged = 0;
  let totalRemovedCells = 0;

  for (const file of files) {
    const filePath = path.join(MAPS_DIR, file);
    const result = processMap(filePath);

    const status = result.changed ? '✓ FIXED' : '○ OK';
    const cellInfo = result.removedCells > 0 ? ` (removed ${result.removedCells} artifact 'r' cells)` : '';
    console.log(`${status} ${file}: ${result.oldCount} → ${result.newCount} ramps${cellInfo}`);

    if (result.changed) totalChanged++;
    totalRemovedCells += result.removedCells;
  }

  console.log(`\n${totalChanged} file(s) modified`);
  if (totalRemovedCells > 0) {
    console.log(`${totalRemovedCells} artifact 'r' cells converted to 'g'`);
  }
}

main();

/**
 * MapGenerator.ts - Terrain Generation from Map Definition
 *
 * Converts a MapDefinition into a fully-realized MapData object.
 * The key innovation: terrain is generated FROM the connectivity graph,
 * ensuring walkability is guaranteed by construction.
 */

import {
  MapData,
  MapCell,
  SpawnPoint,
  Expansion,
  WatchTower,
  Ramp,
  DestructibleRock,
  MapDecoration,
  ResourceNode,
  TerrainType,
  TerrainFeature,
  legacyElevationTo256,
  createBaseResources,
  MINERAL_NORMAL,
  GAS_NORMAL,
} from '../MapTypes';

import {
  MapDefinition,
  RegionDefinition,
  ConnectionDefinition,
  BiomeType,
  DecorationType as DefDecorationType,
} from './MapDefinition';

import {
  ConnectivityGraph,
  ConnectivityNode,
  ConnectivityEdge,
  getEdgesByType,
  validateConnectivity,
} from './MapConnectivity';

import { definitionToGraph } from './MapDefinition';

// ============================================================================
// TERRAIN GENERATION
// ============================================================================

/**
 * Generate the terrain grid from a map definition
 */
export function generateTerrain(
  definition: MapDefinition,
  graph: ConnectivityGraph
): MapCell[][] {
  const { width, height } = definition.canvas;
  const baseElevation = legacyElevationTo256((definition.canvas.baseElevation ?? 1) as 0 | 1 | 2);

  // Initialize grid with base terrain
  const grid: MapCell[][] = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = {
        terrain: 'ground',
        elevation: baseElevation,
        feature: 'none',
        textureId: Math.floor(Math.random() * 4),
      };
    }
  }

  // Step 1: Mark map border as void
  markMapBorder(grid, width, height, 3);

  // Step 2: Apply terrain features (voids, obstacles, water, etc.)
  if (definition.terrain) {
    applyTerrainFeatures(grid, definition, width, height);
  }

  // Step 3: Generate regions (elevated platforms, etc.)
  generateRegions(grid, definition.regions, width, height);

  // Step 4: Generate connections (ramps, bridges, etc.)
  generateConnections(grid, definition.connections, graph, width, height);

  // Step 5: Ensure connectivity - carve paths if needed
  ensureConnectivity(grid, graph, width, height);

  return grid;
}

/**
 * Mark map border as void/unwalkable
 */
function markMapBorder(
  grid: MapCell[][],
  width: number,
  height: number,
  borderWidth: number
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isNearEdge =
        x < borderWidth ||
        x >= width - borderWidth ||
        y < borderWidth ||
        y >= height - borderWidth;

      if (isNearEdge) {
        grid[y][x] = {
          terrain: 'unwalkable',
          elevation: 0,
          feature: 'void',
          textureId: 0,
        };
      }
    }
  }
}

/**
 * Apply terrain features from definition
 */
function applyTerrainFeatures(
  grid: MapCell[][],
  definition: MapDefinition,
  width: number,
  height: number
): void {
  const terrain = definition.terrain!;

  // Apply voids
  if (terrain.voids) {
    for (const voidDef of terrain.voids) {
      applyShape(grid, voidDef, width, height, (cell) => {
        cell.terrain = 'unwalkable';
        cell.feature = 'void';
        cell.elevation = 0;
      });
    }
  }

  // Apply obstacles (cliffs, walls, rocks)
  if (terrain.obstacles) {
    for (const obs of terrain.obstacles) {
      applyShape(grid, obs, width, height, (cell) => {
        cell.terrain = 'unwalkable';
        cell.feature = obs.type === 'cliff' ? 'cliff' : 'none';
      });
    }
  }

  // Apply water
  if (terrain.water) {
    for (const water of terrain.water) {
      applyShape(grid, water, width, height, (cell) => {
        cell.terrain = 'unwalkable';
        cell.feature = 'water_deep';
      });
    }
  }

  // Apply terrain modifiers (mud, etc.)
  if (terrain.modifiers) {
    for (const mod of terrain.modifiers) {
      const feature: TerrainFeature =
        mod.type === 'mud'
          ? 'mud'
          : mod.type === 'ice'
            ? 'water_shallow'
            : 'none';

      applyShape(grid, mod, width, height, (cell) => {
        if (cell.terrain !== 'unwalkable' && cell.terrain !== 'ramp') {
          cell.feature = feature;
          cell.terrain = 'unbuildable';
        }
      });
    }
  }

  // Apply forests
  if (terrain.forests) {
    for (const forest of terrain.forests) {
      const feature: TerrainFeature =
        forest.density === 'dense' ? 'forest_dense' : 'forest_light';

      applyShape(grid, forest, width, height, (cell) => {
        if (cell.terrain !== 'unwalkable' && cell.terrain !== 'ramp') {
          cell.feature = feature;
          cell.terrain = 'unbuildable';
        }
      });
    }
  }

  // Apply roads
  if (terrain.roads) {
    for (const road of terrain.roads) {
      applyRoad(grid, road, width, height);
    }
  }
}

/**
 * Apply a shape to the grid
 */
function applyShape(
  grid: MapCell[][],
  shape: { shape: string; position: { x: number; y: number }; size?: { width: number; height: number }; radius?: number; innerRadius?: number; points?: Array<{ x: number; y: number }> },
  width: number,
  height: number,
  modifier: (cell: MapCell) => void
): void {
  const { position } = shape;

  if (shape.shape === 'rect' && shape.size) {
    for (let dy = 0; dy < shape.size.height; dy++) {
      for (let dx = 0; dx < shape.size.width; dx++) {
        const x = Math.floor(position.x + dx);
        const y = Math.floor(position.y + dy);
        if (x >= 0 && x < width && y >= 0 && y < height) {
          modifier(grid[y][x]);
        }
      }
    }
  } else if (shape.shape === 'circle' && shape.radius) {
    const r = shape.radius;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          const x = Math.floor(position.x + dx);
          const y = Math.floor(position.y + dy);
          if (x >= 0 && x < width && y >= 0 && y < height) {
            modifier(grid[y][x]);
          }
        }
      }
    }
  } else if (shape.shape === 'ring' && shape.radius && shape.innerRadius !== undefined) {
    const outer = shape.radius;
    const inner = shape.innerRadius;
    for (let dy = -outer; dy <= outer; dy++) {
      for (let dx = -outer; dx <= outer; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= outer && dist >= inner) {
          const x = Math.floor(position.x + dx);
          const y = Math.floor(position.y + dy);
          if (x >= 0 && x < width && y >= 0 && y < height) {
            modifier(grid[y][x]);
          }
        }
      }
    }
  } else if (shape.shape === 'polygon' && shape.points) {
    // Simple polygon fill using point-in-polygon test
    const points = shape.points;
    const minX = Math.floor(Math.min(...points.map((p) => p.x)));
    const maxX = Math.ceil(Math.max(...points.map((p) => p.x)));
    const minY = Math.floor(Math.min(...points.map((p) => p.y)));
    const maxY = Math.ceil(Math.max(...points.map((p) => p.y)));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (pointInPolygon({ x, y }, points) && x >= 0 && x < width && y >= 0 && y < height) {
          modifier(grid[y][x]);
        }
      }
    }
  }
}

/**
 * Point-in-polygon test using ray casting
 */
function pointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;

    if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Apply a road to the grid
 */
function applyRoad(
  grid: MapCell[][],
  road: { from: { x: number; y: number }; to: { x: number; y: number }; width: number; waypoints?: Array<{ x: number; y: number }> },
  width: number,
  height: number
): void {
  const points = [road.from, ...(road.waypoints || []), road.to];

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(length);

    const perpX = -dy / length;
    const perpY = dx / length;

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = from.x + dx * t;
      const cy = from.y + dy * t;

      for (let w = -road.width / 2; w <= road.width / 2; w++) {
        const x = Math.floor(cx + perpX * w);
        const y = Math.floor(cy + perpY * w);

        if (x >= 0 && x < width && y >= 0 && y < height) {
          const cell = grid[y][x];
          if (cell.terrain !== 'unwalkable' && cell.terrain !== 'ramp') {
            cell.feature = 'road';
            cell.terrain = 'unbuildable';
          }
        }
      }
    }
  }
}

/**
 * Generate elevated regions from definitions
 */
function generateRegions(
  grid: MapCell[][],
  regions: RegionDefinition[],
  width: number,
  height: number
): void {
  for (const region of regions) {
    const elev256 = legacyElevationTo256(region.elevation as 0 | 1 | 2);
    const { x, y } = region.position;
    const radius = region.radius;
    const cliffWidth = 3;
    const outerRadius = radius + cliffWidth;

    // Only create cliff rings for elevated regions
    const createCliffs = region.elevation > 0;

    for (let dy = -outerRadius; dy <= outerRadius; dy++) {
      for (let dx = -outerRadius; dx <= outerRadius; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        const px = Math.floor(x + dx);
        const py = Math.floor(y + dy);

        if (px >= 0 && px < width && py >= 0 && py < height) {
          // Skip existing ramps
          if (grid[py][px].terrain === 'ramp') {
            continue;
          }

          if (dist <= radius) {
            // Inner buildable area
            grid[py][px] = {
              terrain: 'ground',
              elevation: elev256,
              feature: 'none',
              textureId: Math.floor(Math.random() * 4),
            };
          } else if (createCliffs && dist <= outerRadius) {
            // Cliff ring - only if not near a ramp
            if (!isNearRamp(grid, px, py, cliffWidth + 1, width, height)) {
              grid[py][px] = {
                terrain: 'unwalkable',
                elevation: elev256,
                feature: 'cliff',
                textureId: Math.floor(Math.random() * 4),
              };
            }
          }
        }
      }
    }
  }
}

/**
 * Check if a cell is near a ramp
 */
function isNearRamp(
  grid: MapCell[][],
  x: number,
  y: number,
  buffer: number,
  width: number,
  height: number
): boolean {
  for (let dy = -buffer; dy <= buffer; dy++) {
    for (let dx = -buffer; dx <= buffer; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px >= 0 && px < width && py >= 0 && py < height) {
        if (grid[py][px].terrain === 'ramp') {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Generate connections (ramps, paths) from definitions
 */
function generateConnections(
  grid: MapCell[][],
  connections: ConnectionDefinition[],
  graph: ConnectivityGraph,
  width: number,
  height: number
): void {
  for (const conn of connections) {
    const fromNode = graph.nodes.get(conn.from);
    const toNode = graph.nodes.get(conn.to);

    if (!fromNode || !toNode) continue;

    if (conn.type === 'ramp') {
      generateRamp(grid, fromNode, toNode, conn, width, height);
    } else {
      // Ground/bridge/narrow/wide connections - just ensure walkable path
      generateGroundPath(grid, fromNode, toNode, conn, width, height);
    }
  }
}

/**
 * Generate a ramp between two regions
 */
function generateRamp(
  grid: MapCell[][],
  fromNode: ConnectivityNode,
  toNode: ConnectivityNode,
  conn: ConnectionDefinition,
  width: number,
  height: number
): void {
  const fromElev = legacyElevationTo256(fromNode.elevation as 0 | 1 | 2);
  const toElev = legacyElevationTo256(toNode.elevation as 0 | 1 | 2);

  // Calculate path between nodes
  const points = conn.waypoints
    ? [fromNode.center, ...conn.waypoints, toNode.center]
    : [fromNode.center, toNode.center];

  // Draw ramp along path
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(length);

    const perpX = -dy / length;
    const perpY = dx / length;

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // Calculate elevation along the ramp
      const segmentT = (i + t) / (points.length - 1);
      const elevation = Math.round(fromElev + (toElev - fromElev) * segmentT);

      const cx = from.x + dx * t;
      const cy = from.y + dy * t;

      for (let w = -conn.width / 2; w <= conn.width / 2; w++) {
        const x = Math.floor(cx + perpX * w);
        const y = Math.floor(cy + perpY * w);

        if (x >= 0 && x < width && y >= 0 && y < height) {
          grid[y][x] = {
            terrain: 'ramp',
            elevation,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        }
      }
    }
  }

  // Clear cliffs around ramp endpoints
  const rampEndpoints = [fromNode.center, toNode.center];
  for (const endpoint of rampEndpoints) {
    const clearRadius = Math.ceil(conn.width / 2) + 2;
    for (let dy = -clearRadius; dy <= clearRadius; dy++) {
      for (let dx = -clearRadius; dx <= clearRadius; dx++) {
        const x = Math.floor(endpoint.x + dx);
        const y = Math.floor(endpoint.y + dy);
        if (x >= 0 && x < width && y >= 0 && y < height) {
          if (grid[y][x].feature === 'cliff' && grid[y][x].terrain === 'unwalkable') {
            // Convert cliff to walkable at ramp endpoint
            grid[y][x].terrain = 'ground';
            grid[y][x].feature = 'none';
          }
        }
      }
    }
  }
}

/**
 * Generate a ground path between two regions
 */
function generateGroundPath(
  grid: MapCell[][],
  fromNode: ConnectivityNode,
  toNode: ConnectivityNode,
  conn: ConnectionDefinition,
  width: number,
  height: number
): void {
  const elevation = legacyElevationTo256(Math.min(fromNode.elevation, toNode.elevation) as 0 | 1 | 2);

  const points = conn.waypoints
    ? [fromNode.center, ...conn.waypoints, toNode.center]
    : [fromNode.center, toNode.center];

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(length);

    const perpX = -dy / length;
    const perpY = dx / length;

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = from.x + dx * t;
      const cy = from.y + dy * t;

      for (let w = -conn.width / 2; w <= conn.width / 2; w++) {
        const x = Math.floor(cx + perpX * w);
        const y = Math.floor(cy + perpY * w);

        if (x >= 0 && x < width && y >= 0 && y < height) {
          const cell = grid[y][x];
          // Only modify unwalkable terrain that isn't void
          if (cell.terrain === 'unwalkable' && cell.feature !== 'void') {
            grid[y][x] = {
              terrain: 'ground',
              elevation,
              feature: 'none',
              textureId: Math.floor(Math.random() * 4),
            };
          }
        }
      }
    }
  }
}

/**
 * Ensure connectivity by carving paths if needed
 */
function ensureConnectivity(
  grid: MapCell[][],
  graph: ConnectivityGraph,
  width: number,
  height: number
): void {
  // For each edge in the graph, ensure a walkable path exists
  for (const [nodeId] of graph.nodes) {
    const edges = graph.edges.get(nodeId) || [];
    for (const edge of edges) {
      const fromNode = graph.nodes.get(edge.from);
      const toNode = graph.nodes.get(edge.to);

      if (!fromNode || !toNode) continue;

      // Check if path exists
      if (!pathExists(grid, fromNode.center, toNode.center, width, height)) {
        // Carve a path
        carvePath(grid, fromNode, toNode, edge, width, height);
      }
    }
  }
}

/**
 * Check if a walkable path exists between two points
 */
function pathExists(
  grid: MapCell[][],
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
  height: number
): boolean {
  // Simple BFS pathfinding
  const startX = Math.floor(from.x);
  const startY = Math.floor(from.y);
  const endX = Math.floor(to.x);
  const endY = Math.floor(to.y);

  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return false;
  if (endX < 0 || endX >= width || endY < 0 || endY >= height) return false;

  const visited = new Set<string>();
  const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  visited.add(`${startX},${startY}`);

  const directions = [
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (Math.abs(current.x - endX) <= 2 && Math.abs(current.y - endY) <= 2) {
      return true;
    }

    for (const { dx, dy } of directions) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const key = `${nx},${ny}`;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited.has(key)) {
        const cell = grid[ny][nx];
        if (cell.terrain !== 'unwalkable') {
          visited.add(key);
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }

  return false;
}

/**
 * Carve a walkable path between two nodes
 */
function carvePath(
  grid: MapCell[][],
  fromNode: ConnectivityNode,
  toNode: ConnectivityNode,
  edge: { width: number; type: string },
  width: number,
  height: number
): void {
  const from = fromNode.center;
  const to = toNode.center;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(length);

  const perpX = -dy / length;
  const perpY = dx / length;

  const fromElev = legacyElevationTo256(fromNode.elevation as 0 | 1 | 2);
  const toElev = legacyElevationTo256(toNode.elevation as 0 | 1 | 2);
  const isRamp = edge.type === 'ramp';

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = from.x + dx * t;
    const cy = from.y + dy * t;
    const elevation = isRamp ? Math.round(fromElev + (toElev - fromElev) * t) : fromElev;

    for (let w = -edge.width / 2; w <= edge.width / 2; w++) {
      const x = Math.floor(cx + perpX * w);
      const y = Math.floor(cy + perpY * w);

      if (x >= 0 && x < width && y >= 0 && y < height) {
        if (grid[y][x].feature !== 'void') {
          grid[y][x] = {
            terrain: isRamp ? 'ramp' : 'ground',
            elevation,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        }
      }
    }
  }
}

// ============================================================================
// MAP DATA GENERATION
// ============================================================================

/**
 * Generate spawn points from regions
 */
function generateSpawns(regions: RegionDefinition[]): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];

  for (const region of regions) {
    if (region.playerSlot !== undefined && region.type === 'main_base') {
      // Calculate rotation to face center of map
      // For now, use simple rotations based on player slot
      const rotation = (region.playerSlot - 1) * (Math.PI / 2);

      spawns.push({
        x: region.position.x,
        y: region.position.y,
        playerSlot: region.playerSlot,
        rotation,
      });
    }
  }

  return spawns.sort((a, b) => a.playerSlot - b.playerSlot);
}

/**
 * Generate expansions from regions
 */
function generateExpansions(regions: RegionDefinition[]): Expansion[] {
  const expansions: Expansion[] = [];

  for (const region of regions) {
    if (region.resources && (region.resources.minerals || region.resources.vespene || region.resources.richMinerals)) {
      // Determine direction for resources (away from center for mains/naturals)
      const direction = Math.random() * Math.PI * 2;

      const resources = createBaseResources(
        region.position.x,
        region.position.y,
        direction,
        MINERAL_NORMAL,
        GAS_NORMAL,
        (region.resources.richMinerals ?? 0) > 0,
        region.type === 'natural' ? 10 : 7
      );

      // Adjust mineral count if needed
      const mineralCount = region.resources.minerals ?? 8;
      if (mineralCount < 8) {
        resources.minerals = resources.minerals.slice(0, mineralCount);
      }

      // Adjust vespene count if needed
      const vespeneCount = region.resources.vespene ?? 2;
      if (vespeneCount < 2) {
        resources.vespene = resources.vespene.slice(0, vespeneCount);
      } else if (vespeneCount === 0) {
        resources.vespene = [];
      }

      expansions.push({
        name: region.name || region.id,
        x: region.position.x,
        y: region.position.y,
        minerals: resources.minerals,
        vespene: resources.vespene,
        isMain: region.type === 'main_base',
        isNatural: region.type === 'natural',
      });
    }
  }

  return expansions;
}

/**
 * Generate watch towers from features
 */
function generateWatchTowers(definition: MapDefinition): WatchTower[] {
  if (!definition.features?.watchTowers) {
    return [];
  }

  return definition.features.watchTowers.map((tower) => ({
    x: tower.position.x,
    y: tower.position.y,
    radius: tower.visionRadius,
  }));
}

/**
 * Generate ramps data from connections
 */
function generateRamps(
  connections: ConnectionDefinition[],
  graph: ConnectivityGraph
): Ramp[] {
  const ramps: Ramp[] = [];

  for (const conn of connections) {
    if (conn.type !== 'ramp') continue;

    const fromNode = graph.nodes.get(conn.from);
    const toNode = graph.nodes.get(conn.to);

    if (!fromNode || !toNode) continue;

    const dx = toNode.center.x - fromNode.center.x;
    const dy = toNode.center.y - fromNode.center.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    // Determine direction
    let direction: 'north' | 'south' | 'east' | 'west' = 'north';
    if (Math.abs(dx) > Math.abs(dy)) {
      direction = dx > 0 ? 'east' : 'west';
    } else {
      direction = dy > 0 ? 'south' : 'north';
    }

    const centerX = (fromNode.center.x + toNode.center.x) / 2;
    const centerY = (fromNode.center.y + toNode.center.y) / 2;

    ramps.push({
      x: centerX - conn.width / 2,
      y: centerY - length / 4,
      width: conn.width,
      height: length / 2,
      direction,
      fromElevation: fromNode.elevation as 0 | 1 | 2,
      toElevation: toNode.elevation as 0 | 1 | 2,
    });
  }

  return ramps;
}

/**
 * Generate destructibles from features
 */
function generateDestructibles(definition: MapDefinition): DestructibleRock[] {
  if (!definition.features?.destructibles) {
    return [];
  }

  return definition.features.destructibles.map((d) => ({
    x: d.position.x,
    y: d.position.y,
    health: d.health,
  }));
}

/**
 * Convert definition decoration type to MapDecoration type
 */
function convertDecorationType(type: DefDecorationType): MapDecoration['type'] {
  // Map from definition types to MapTypes decoration types
  const mapping: Record<string, MapDecoration['type']> = {
    rocks_small: 'rocks_small',
    rocks_medium: 'rocks_large', // Map medium to large for now
    rocks_large: 'rocks_large',
    rocks_cluster: 'rocks_large',
    crystal_small: 'crystal_formation',
    crystal_medium: 'crystal_formation',
    crystal_large: 'crystal_formation',
    crystal_cluster: 'crystal_formation',
    tree_dead: 'tree_dead',
    tree_jungle: 'tree_alien',
    tree_pine: 'tree_pine_tall',
    tree_palm: 'tree_palm',
    bush_small: 'bush',
    bush_large: 'bush',
    grass_patch: 'grass_clump',
    debris: 'debris',
    ruined_wall: 'ruined_wall',
    escape_pod: 'escape_pod',
  };

  return mapping[type] || 'rocks_small';
}

/**
 * Generate decorations from definition
 */
function generateDecorations(definition: MapDefinition): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const config = definition.decorations;

  if (!config) return decorations;

  // Add explicit decorations
  if (config.explicit) {
    for (const dec of config.explicit) {
      decorations.push({
        type: convertDecorationType(dec.type),
        x: dec.position.x,
        y: dec.position.y,
        scale: dec.scale,
        rotation: dec.rotation,
      });
    }
  }

  // Add border wall decorations
  if (config.borderWalls?.enabled) {
    const width = definition.canvas.width;
    const height = definition.canvas.height;
    const bw = config.borderWalls;

    // Inner ring
    if (bw.innerRing) {
      const spacing = 1 / bw.innerRing.density;
      const offset = bw.innerRing.offset;

      for (let x = offset; x < width - offset; x += spacing * 20) {
        decorations.push({
          type: convertDecorationType(bw.innerRing.types[Math.floor(Math.random() * bw.innerRing.types.length)]),
          x,
          y: offset,
          scale: bw.innerRing.scale.min + Math.random() * (bw.innerRing.scale.max - bw.innerRing.scale.min),
        });
        decorations.push({
          type: convertDecorationType(bw.innerRing.types[Math.floor(Math.random() * bw.innerRing.types.length)]),
          x,
          y: height - offset,
          scale: bw.innerRing.scale.min + Math.random() * (bw.innerRing.scale.max - bw.innerRing.scale.min),
        });
      }

      for (let y = offset; y < height - offset; y += spacing * 20) {
        decorations.push({
          type: convertDecorationType(bw.innerRing.types[Math.floor(Math.random() * bw.innerRing.types.length)]),
          x: offset,
          y,
          scale: bw.innerRing.scale.min + Math.random() * (bw.innerRing.scale.max - bw.innerRing.scale.min),
        });
        decorations.push({
          type: convertDecorationType(bw.innerRing.types[Math.floor(Math.random() * bw.innerRing.types.length)]),
          x: width - offset,
          y,
          scale: bw.innerRing.scale.min + Math.random() * (bw.innerRing.scale.max - bw.innerRing.scale.min),
        });
      }
    }

    // Outer ring (massive rocks)
    if (bw.outerRing) {
      const spacing = 1 / bw.outerRing.density;
      const offset = bw.outerRing.offset;

      for (let x = offset; x < width - offset; x += spacing * 15) {
        decorations.push({
          type: convertDecorationType(bw.outerRing.types[Math.floor(Math.random() * bw.outerRing.types.length)]),
          x,
          y: offset,
          scale: bw.outerRing.scale.min + Math.random() * (bw.outerRing.scale.max - bw.outerRing.scale.min),
        });
        decorations.push({
          type: convertDecorationType(bw.outerRing.types[Math.floor(Math.random() * bw.outerRing.types.length)]),
          x,
          y: height - offset,
          scale: bw.outerRing.scale.min + Math.random() * (bw.outerRing.scale.max - bw.outerRing.scale.min),
        });
      }

      for (let y = offset; y < height - offset; y += spacing * 15) {
        decorations.push({
          type: convertDecorationType(bw.outerRing.types[Math.floor(Math.random() * bw.outerRing.types.length)]),
          x: offset,
          y,
          scale: bw.outerRing.scale.min + Math.random() * (bw.outerRing.scale.max - bw.outerRing.scale.min),
        });
        decorations.push({
          type: convertDecorationType(bw.outerRing.types[Math.floor(Math.random() * bw.outerRing.types.length)]),
          x: width - offset,
          y,
          scale: bw.outerRing.scale.min + Math.random() * (bw.outerRing.scale.max - bw.outerRing.scale.min),
        });
      }
    }
  }

  // Add clusters
  if (config.clusters) {
    for (const cluster of config.clusters) {
      const count = cluster.count.min + Math.floor(Math.random() * (cluster.count.max - cluster.count.min + 1));
      const types = cluster.decorationTypes || getDefaultClusterTypes(cluster.type);

      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * cluster.radius;
        const x = cluster.position.x + Math.cos(angle) * dist;
        const y = cluster.position.y + Math.sin(angle) * dist;
        const scale = cluster.scale.min + Math.random() * (cluster.scale.max - cluster.scale.min);

        decorations.push({
          type: convertDecorationType(types[Math.floor(Math.random() * types.length)]),
          x,
          y,
          scale,
        });
      }
    }
  }

  return decorations;
}

/**
 * Get default decoration types for a cluster type
 */
function getDefaultClusterTypes(type: string): DefDecorationType[] {
  switch (type) {
    case 'crystal':
      return ['crystal_small', 'crystal_medium', 'crystal_large'];
    case 'rock':
      return ['rocks_small', 'rocks_medium', 'rocks_large'];
    case 'tree':
      return ['tree_pine', 'tree_dead'];
    case 'debris':
      return ['debris', 'ruined_wall'];
    default:
      return ['rocks_small'];
  }
}

// ============================================================================
// RAMP CLEARANCE ZONES (for decoration placement)
// ============================================================================

/**
 * Generated connection data (matches old TerrainTopology interface)
 */
export interface GeneratedConnection {
  ramp: Ramp;
  fromAreaId: string;
  toAreaId: string;
  entryPoint: { x: number; y: number };
  exitPoint: { x: number; y: number };
  width: number;
}

/**
 * Result of terrain generation (matches old TopologyGenerationResult)
 * Use this when you need post-processing of terrain with custom features
 */
export interface TerrainGenerationResult {
  terrain: MapCell[][];
  ramps: Ramp[];
  connections: GeneratedConnection[];
}

/**
 * Generate terrain with ramps and connections for post-processing.
 * This is the equivalent of the old generateTerrainFromTopology() function.
 * Use this when maps need to apply custom terrain features after base generation.
 */
export function generateTerrainWithConnections(
  definition: MapDefinition
): TerrainGenerationResult {
  const graph = definitionToGraph(definition);
  const terrain = generateTerrain(definition, graph);

  // Generate ramp and connection data
  const ramps = generateRamps(definition.connections, graph);
  const connections = generateConnectionData(definition.connections, graph);

  return { terrain, ramps, connections };
}

/**
 * Generate connection data for ramp clearance zones
 */
function generateConnectionData(
  connections: ConnectionDefinition[],
  graph: ConnectivityGraph
): GeneratedConnection[] {
  const result: GeneratedConnection[] = [];

  for (const conn of connections) {
    const fromNode = graph.nodes.get(conn.from);
    const toNode = graph.nodes.get(conn.to);

    if (!fromNode || !toNode) continue;

    const dx = toNode.center.x - fromNode.center.x;
    const dy = toNode.center.y - fromNode.center.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    // Calculate entry and exit points
    const dirX = length > 0 ? dx / length : 0;
    const dirY = length > 0 ? dy / length : 1;

    const fromRadius = fromNode.radius + 3; // Account for cliff width
    const toRadius = toNode.radius + 3;

    const entryPoint = {
      x: fromNode.center.x + dirX * fromRadius,
      y: fromNode.center.y + dirY * fromRadius,
    };

    const exitPoint = {
      x: toNode.center.x - dirX * toRadius,
      y: toNode.center.y - dirY * toRadius,
    };

    // Determine direction
    let direction: 'north' | 'south' | 'east' | 'west' = 'north';
    if (Math.abs(dx) > Math.abs(dy)) {
      direction = dx > 0 ? 'east' : 'west';
    } else {
      direction = dy > 0 ? 'south' : 'north';
    }

    const centerX = (fromNode.center.x + toNode.center.x) / 2;
    const centerY = (fromNode.center.y + toNode.center.y) / 2;

    result.push({
      ramp: {
        x: centerX - conn.width / 2,
        y: centerY - length / 4,
        width: conn.width,
        height: length / 2,
        direction,
        fromElevation: fromNode.elevation as 0 | 1 | 2,
        toElevation: toNode.elevation as 0 | 1 | 2,
      },
      fromAreaId: conn.from,
      toAreaId: conn.to,
      entryPoint,
      exitPoint,
      width: conn.width,
    });
  }

  return result;
}

/**
 * Get ramp clearance zones for decoration placement.
 * Returns a Set of cell keys that should not have decorations.
 */
export function getRampClearanceZones(connections: GeneratedConnection[]): Set<string> {
  const clearance = new Set<string>();
  const CLEARANCE_BUFFER = 6;
  const EXIT_EXTENSION = 18;

  for (const conn of connections) {
    const { ramp, entryPoint, exitPoint, width } = conn;

    // Calculate the actual vector from entry to exit
    const dx = exitPoint.x - entryPoint.x;
    const dy = exitPoint.y - entryPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    // Normalized direction along the ramp
    const dirX = length > 0 ? dx / length : 0;
    const dirY = length > 0 ? dy / length : 1;

    // Perpendicular vector for width
    const perpX = -dirY;
    const perpY = dirX;

    const halfWidth = width / 2 + CLEARANCE_BUFFER;

    // Clear along the entire ramp path
    const steps = Math.ceil(length) + 1;
    for (let step = 0; step <= steps; step++) {
      const t = step / Math.max(1, steps);
      const centerX = entryPoint.x + dx * t;
      const centerY = entryPoint.y + dy * t;

      for (let w = -halfWidth; w <= halfWidth; w++) {
        const px = Math.floor(centerX + perpX * w);
        const py = Math.floor(centerY + perpY * w);
        clearance.add(`${px},${py}`);
      }
    }

    // Extended clearance into source area (entry side)
    for (let d = 0; d < EXIT_EXTENSION; d++) {
      const cx = entryPoint.x - dirX * d;
      const cy = entryPoint.y - dirY * d;
      for (let w = -halfWidth; w <= halfWidth; w++) {
        const px = Math.floor(cx + perpX * w);
        const py = Math.floor(cy + perpY * w);
        clearance.add(`${px},${py}`);
      }
    }

    // Extended clearance into destination area (exit side)
    for (let d = 0; d < EXIT_EXTENSION; d++) {
      const cx = exitPoint.x + dirX * d;
      const cy = exitPoint.y + dirY * d;
      for (let w = -halfWidth; w <= halfWidth; w++) {
        const px = Math.floor(cx + perpX * w);
        const py = Math.floor(cy + perpY * w);
        clearance.add(`${px},${py}`);
      }
    }

    // Also clear the bounding box of the ramp
    for (let ry = -CLEARANCE_BUFFER; ry < ramp.height + CLEARANCE_BUFFER; ry++) {
      for (let rx = -CLEARANCE_BUFFER; rx < ramp.width + CLEARANCE_BUFFER; rx++) {
        clearance.add(`${ramp.x + rx},${ramp.y + ry}`);
      }
    }
  }

  return clearance;
}

/**
 * Check if a point is within ramp clearance zones
 */
export function isInRampClearance(
  x: number,
  y: number,
  clearanceZones: Set<string>
): boolean {
  return clearanceZones.has(`${Math.floor(x)},${Math.floor(y)}`);
}

// ============================================================================
// MAIN GENERATION FUNCTION
// ============================================================================

/**
 * Generate complete MapData from a MapDefinition
 */
export function generateMapFromDefinition(definition: MapDefinition): MapData {
  // Build connectivity graph
  const graph = definitionToGraph(definition);

  // Validate connectivity
  const validation = validateConnectivity(graph);
  if (!validation.valid) {
    console.warn('Map connectivity validation failed:', validation.errors);
  }
  if (validation.warnings.length > 0) {
    console.warn('Map connectivity warnings:', validation.warnings);
  }

  // Generate terrain
  const terrain = generateTerrain(definition, graph);

  // Generate game elements
  const spawns = generateSpawns(definition.regions);
  const expansions = generateExpansions(definition.regions);
  const watchTowers = generateWatchTowers(definition);
  const ramps = generateRamps(definition.connections, graph);
  const destructibles = generateDestructibles(definition);
  const decorations = generateDecorations(definition);

  // Determine player count from spawn points
  const playerCount = spawns.length as 2 | 4 | 6 | 8;

  return {
    id: definition.meta.id,
    name: definition.meta.name,
    author: definition.meta.author,
    description: definition.meta.description,

    width: definition.canvas.width,
    height: definition.canvas.height,

    terrain,
    spawns,
    expansions,
    watchTowers,
    ramps,
    destructibles,
    decorations,

    playerCount,
    maxPlayers: playerCount,
    isRanked: true,

    biome: definition.canvas.biome,
  };
}

/**
 * Export graph to debug JSON
 */
export function exportGraphDebug(definition: MapDefinition): string {
  const graph = definitionToGraph(definition);
  const nodes = Array.from(graph.nodes.values());
  const edges: Array<{ from: string; to: string; type: string }> = [];

  for (const [nodeId] of graph.nodes) {
    for (const edge of graph.edges.get(nodeId) || []) {
      // Only add each edge once
      if (edge.from < edge.to || (edge.bidirectional === false)) {
        edges.push({
          from: edge.from,
          to: edge.to,
          type: edge.type,
        });
      }
    }
  }

  return JSON.stringify({ nodes, edges }, null, 2);
}

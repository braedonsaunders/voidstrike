/**
 * TerrainTopology.ts - Graph-First Terrain Generation System
 *
 * This module implements a topology-based approach to terrain generation where:
 * 1. Areas (bases, expansions) are defined first as nodes
 * 2. Connections (ramps) are defined as edges between areas
 * 3. Terrain is generated FROM this topology, guaranteeing walkability
 *
 * Key benefits:
 * - Connectivity is guaranteed by graph structure
 * - Ramp positioning is automatic based on area geometry
 * - Cliffs are derived from elevation changes, respecting connections
 * - Much easier to author and maintain maps
 */

import {
  MapCell,
  TerrainType,
  TerrainFeature,
  Elevation,
  ElevationLevel,
  legacyElevationTo256,
  Ramp,
} from './MapTypes';

// ============================================
// CORE TYPES
// ============================================

/**
 * An area in the map topology (base, expansion, open ground)
 */
export interface TopologyArea {
  id: string;
  type: 'main' | 'natural' | 'third' | 'fourth' | 'gold' | 'center' | 'open_ground';
  center: { x: number; y: number };
  radius: number;           // Buildable area radius
  elevation: ElevationLevel; // 0, 1, or 2
  cliffWidth?: number;      // Width of cliff ring (default 4 for mains, 3 for naturals)
  shape?: 'circle' | 'rect'; // Default circle
  rectSize?: { width: number; height: number }; // For rect shapes
}

/**
 * A connection between two areas (becomes a ramp)
 */
export interface TopologyConnection {
  from: string;              // Area ID
  to: string;                // Area ID
  width: number;             // Ramp width
  direction?: 'north' | 'south' | 'east' | 'west' | 'auto'; // Auto calculates from positions
  // Advanced options
  style?: 'straight' | 'diagonal';  // Default straight
  entryOffset?: number;      // Offset from area edge for ramp start
}

/**
 * Complete topology definition for a map
 */
export interface MapTopology {
  areas: TopologyArea[];
  connections: TopologyConnection[];
}

/**
 * Result of connection point calculation
 */
interface ConnectionPoints {
  entryPoint: { x: number; y: number };
  exitPoint: { x: number; y: number };
  direction: 'north' | 'south' | 'east' | 'west';
  fromElevation: ElevationLevel;
  toElevation: ElevationLevel;
}

/**
 * Generated connection data (used by rendering for smoothing/clearance)
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
 * Result of terrain generation
 */
export interface TopologyGenerationResult {
  terrain: MapCell[][];
  ramps: Ramp[];
  connections: GeneratedConnection[];
}

// ============================================
// GEOMETRY HELPERS
// ============================================

/**
 * Calculate distance between two points
 */
function distance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Normalize a vector
 */
function normalize(v: { x: number; y: number }): { x: number; y: number } {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * Linear interpolation
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Get the cardinal direction from one point to another
 */
function getCardinalDirection(
  from: { x: number; y: number },
  to: { x: number; y: number }
): 'north' | 'south' | 'east' | 'west' {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Determine primary direction
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'east' : 'west';
  } else {
    return dy > 0 ? 'south' : 'north';
  }
}

/**
 * Get direction vector for a cardinal direction
 */
function getDirectionVector(direction: 'north' | 'south' | 'east' | 'west'): { x: number; y: number } {
  switch (direction) {
    case 'north': return { x: 0, y: -1 };
    case 'south': return { x: 0, y: 1 };
    case 'east': return { x: 1, y: 0 };
    case 'west': return { x: -1, y: 0 };
  }
}

/**
 * Get perpendicular vector (90 degrees clockwise)
 */
function getPerpendicular(v: { x: number; y: number }): { x: number; y: number } {
  return { x: -v.y, y: v.x };
}

// ============================================
// CONNECTION POINT CALCULATION
// ============================================

/**
 * Calculate where a ramp should connect two areas.
 * Uses TRUE VECTOR GEOMETRY - finds the actual closest points between circles.
 *
 * IMPORTANT: Connection points are at the INNER (buildable) edge of each area,
 * not the outer cliff edge. This ensures ramps connect the buildable spaces
 * and the protected zones properly clear the cliff ring between them.
 */
export function calculateConnectionPoints(
  fromArea: TopologyArea,
  toArea: TopologyArea,
  connection: TopologyConnection
): ConnectionPoints {
  const fromCenter = fromArea.center;
  const toCenter = toArea.center;

  // Calculate the ACTUAL vector from one center to the other
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Normalized direction vector (actual geometric direction, not cardinal)
  const dirX = dist > 0 ? dx / dist : 0;
  const dirY = dist > 0 ? dy / dist : 1;

  // Use INNER edge (buildable area boundary) for connection points
  // This ensures ramps connect the playable spaces, not punch through cliffs
  const fromInnerRadius = fromArea.radius;
  const toInnerRadius = toArea.radius;

  // Entry point: on fromArea's buildable edge, facing toward toArea
  const entryPoint = {
    x: fromCenter.x + dirX * fromInnerRadius,
    y: fromCenter.y + dirY * fromInnerRadius,
  };

  // Exit point: on toArea's buildable edge, facing toward fromArea
  const exitPoint = {
    x: toCenter.x - dirX * toInnerRadius,
    y: toCenter.y - dirY * toInnerRadius,
  };

  // Verify the points make sense (entry should be closer to fromCenter than exit)
  // If they're crossed, the areas overlap - use midpoint
  const entryToExitDist = Math.sqrt(
    Math.pow(exitPoint.x - entryPoint.x, 2) +
    Math.pow(exitPoint.y - entryPoint.y, 2)
  );

  // Check if direction from entry to exit matches overall direction (sanity check)
  const entryExitDx = exitPoint.x - entryPoint.x;
  const entryExitDy = exitPoint.y - entryPoint.y;
  const dotProduct = entryExitDx * dirX + entryExitDy * dirY;

  // If dot product is negative, the points are reversed (areas overlap)
  if (dotProduct < 0 || entryToExitDist < 2) {
    // Areas are overlapping or very close - use midpoint for both
    const midX = (fromCenter.x + toCenter.x) / 2;
    const midY = (fromCenter.y + toCenter.y) / 2;
    entryPoint.x = midX;
    entryPoint.y = midY;
    exitPoint.x = midX;
    exitPoint.y = midY;
  }

  // Determine cardinal direction for legacy Ramp object (best approximation)
  const direction = getCardinalDirection(fromCenter, toCenter);

  const fromElevation = fromArea.elevation;
  const toElevation = toArea.elevation;

  return {
    entryPoint,
    exitPoint,
    direction,
    fromElevation,
    toElevation,
  };
}

// ============================================
// RAMP PATH GENERATION
// ============================================

/**
 * Generate a ramp path between two points with proper elevation interpolation.
 * SUPPORTS DIAGONAL RAMPS - uses vector-based corridor generation.
 * Returns cells to mark as ramp terrain.
 */
function generateRampPath(
  grid: MapCell[][],
  entry: { x: number; y: number },
  exit: { x: number; y: number },
  width: number,
  fromElevation: ElevationLevel,
  toElevation: ElevationLevel,
  _direction: 'north' | 'south' | 'east' | 'west' // Legacy param, not used for geometry
): { x: number; y: number; width: number; height: number; direction: 'north' | 'south' | 'east' | 'west' } {
  const fromElev256 = legacyElevationTo256(fromElevation);
  const toElev256 = legacyElevationTo256(toElevation);

  // Calculate the actual vector from entry to exit
  const dx = exit.x - entry.x;
  const dy = exit.y - entry.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  // Normalized direction along the ramp
  const dirX = length > 0 ? dx / length : 0;
  const dirY = length > 0 ? dy / length : 1;

  // Perpendicular vector for ramp width
  const perpX = -dirY;
  const perpY = dirX;

  // Track bounding box for the ramp
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  // PHASE 1: Identify all cells that will be part of the ramp
  // Store each cell with its position parameter (t) along the ramp
  const rampCells = new Map<string, { px: number; py: number; t: number }>();

  const steps = Math.ceil(length * 2) + 1; // More steps for better coverage
  const halfWidth = width / 2;

  for (let step = 0; step <= steps; step++) {
    const t = step / Math.max(1, steps);
    const centerX = entry.x + dx * t;
    const centerY = entry.y + dy * t;

    for (let w = -halfWidth; w <= halfWidth; w++) {
      const px = Math.floor(centerX + perpX * w);
      const py = Math.floor(centerY + perpY * w);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        const key = `${px},${py}`;

        // For each cell, calculate its ACTUAL position parameter based on projection
        // onto the ramp centerline, not the step that happened to hit it
        const cellCenterX = px + 0.5;
        const cellCenterY = py + 0.5;

        // Project cell center onto the ramp line
        const toCell_x = cellCenterX - entry.x;
        const toCell_y = cellCenterY - entry.y;
        const projectedT = length > 0
          ? Math.max(0, Math.min(1, (toCell_x * dirX + toCell_y * dirY) / length))
          : 0;

        // Only update if this is a new cell or if this t value is more accurate
        // (closer to the cell's actual projected position)
        if (!rampCells.has(key)) {
          rampCells.set(key, { px, py, t: projectedT });
        }
      }
    }
  }

  // PHASE 2: Fill all identified cells with properly interpolated elevations
  for (const { px, py, t } of rampCells.values()) {
    // Calculate elevation based on the cell's actual position along the ramp
    const elevation = Math.round(fromElev256 + (toElev256 - fromElev256) * t);

    grid[py][px] = {
      terrain: 'ramp',
      elevation,
      feature: 'none',
      textureId: Math.floor(Math.random() * 4),
    };

    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }

  // Determine cardinal direction for the Ramp object
  const direction = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'east' : 'west')
    : (dy > 0 ? 'south' : 'north');

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    direction: direction as 'north' | 'south' | 'east' | 'west',
  };
}

// ============================================
// AREA GENERATION
// ============================================

/**
 * Generate a circular platform area with cliff edges
 */
function generateCircularPlatform(
  grid: MapCell[][],
  area: TopologyArea,
  protectedZones: Set<string>
): void {
  const { center, radius, elevation } = area;
  const cliffWidth = area.cliffWidth ?? (area.type === 'main' ? 4 : 3);
  const elevation256 = legacyElevationTo256(elevation);
  const outerRadius = radius + cliffWidth;

  for (let dy = -outerRadius; dy <= outerRadius; dy++) {
    for (let dx = -outerRadius; dx <= outerRadius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      const px = Math.floor(center.x + dx);
      const py = Math.floor(center.y + dy);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // Skip if already a ramp - ramps take priority
        if (grid[py][px].terrain === 'ramp') {
          continue;
        }

        if (dist <= radius) {
          // Inner buildable area - ALWAYS set this, regardless of protected zones
          // This ensures the platform has a complete flat surface
          grid[py][px] = {
            terrain: 'ground',
            elevation: elevation256,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        } else if (dist <= outerRadius) {
          // Cliff ring - only generate cliffs if NOT in/near protected zones
          // Protected zones are where ramps connect, so no cliffs there
          const key = `${px},${py}`;
          if (!protectedZones.has(key) && !isNearProtectedZone(px, py, protectedZones, 2)) {
            grid[py][px] = {
              terrain: 'unwalkable',
              elevation: elevation256,
              feature: 'cliff',
              textureId: Math.floor(Math.random() * 4),
            };
          } else {
            // In protected zone cliff area - check for adjacent ramp to get appropriate elevation
            // This ensures smooth height transition at ramp boundaries
            let useElevation = elevation256;

            // Look for adjacent ramp cells and use their elevation if found
            // This creates a smooth walkable transition at the cliff ring edge
            for (const [rdx, rdy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
              const rx = px + rdx;
              const ry = py + rdy;
              if (ry >= 0 && ry < grid.length && rx >= 0 && rx < grid[0].length) {
                if (grid[ry][rx].terrain === 'ramp') {
                  useElevation = grid[ry][rx].elevation;
                  break;
                }
              }
            }

            grid[py][px] = {
              terrain: 'ground',
              elevation: useElevation,
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
 * Generate a rectangular platform area with cliff edges
 */
function generateRectangularPlatform(
  grid: MapCell[][],
  area: TopologyArea,
  protectedZones: Set<string>
): void {
  if (!area.rectSize) return;

  const { center, elevation, rectSize } = area;
  const cliffWidth = area.cliffWidth ?? 3;
  const elevation256 = legacyElevationTo256(elevation);

  const halfW = rectSize.width / 2;
  const halfH = rectSize.height / 2;

  for (let dy = -halfH - cliffWidth; dy <= halfH + cliffWidth; dy++) {
    for (let dx = -halfW - cliffWidth; dx <= halfW + cliffWidth; dx++) {
      const px = Math.floor(center.x + dx);
      const py = Math.floor(center.y + dy);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // Skip if already a ramp - ramps take priority
        if (grid[py][px].terrain === 'ramp') {
          continue;
        }

        const isInner = Math.abs(dx) <= halfW && Math.abs(dy) <= halfH;

        if (isInner) {
          // Inner buildable area - ALWAYS set this
          grid[py][px] = {
            terrain: 'ground',
            elevation: elevation256,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        } else {
          // Cliff ring - only generate if not in protected zone
          const key = `${px},${py}`;
          if (!protectedZones.has(key) && !isNearProtectedZone(px, py, protectedZones, 2)) {
            grid[py][px] = {
              terrain: 'unwalkable',
              elevation: elevation256,
              feature: 'cliff',
              textureId: Math.floor(Math.random() * 4),
            };
          } else {
            // In protected zone - check for adjacent ramp to get appropriate elevation
            let useElevation = elevation256;

            // Look for adjacent ramp cells and use their elevation if found
            for (const [rdx, rdy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
              const rx = px + rdx;
              const ry = py + rdy;
              if (ry >= 0 && ry < grid.length && rx >= 0 && rx < grid[0].length) {
                if (grid[ry][rx].terrain === 'ramp') {
                  useElevation = grid[ry][rx].elevation;
                  break;
                }
              }
            }

            grid[py][px] = {
              terrain: 'ground',
              elevation: useElevation,
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
 * Check if a position is near a protected zone
 */
function isNearProtectedZone(
  x: number,
  y: number,
  protectedZones: Set<string>,
  buffer: number
): boolean {
  for (let dy = -buffer; dy <= buffer; dy++) {
    for (let dx = -buffer; dx <= buffer; dx++) {
      const key = `${x + dx},${y + dy}`;
      if (protectedZones.has(key)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Generate a simple ground area (no cliffs)
 */
function generateGroundArea(
  grid: MapCell[][],
  area: TopologyArea
): void {
  const { center, radius, elevation } = area;
  const elevation256 = legacyElevationTo256(elevation);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      const px = Math.floor(center.x + dx);
      const py = Math.floor(center.y + dy);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        if (dist <= radius) {
          // Skip if already a ramp
          if (grid[py][px].terrain === 'ramp') {
            continue;
          }

          grid[py][px] = {
            terrain: 'ground',
            elevation: elevation256,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        }
      }
    }
  }
}

// ============================================
// MAIN TERRAIN GENERATION
// ============================================

/**
 * Build protected zones around ramp paths.
 * These zones prevent cliff generation from blocking ramps.
 * Uses TRUE VECTOR geometry matching the diagonal ramp generation.
 */
function buildProtectedZones(
  generatedConnections: GeneratedConnection[],
  extraBuffer: number = 4
): Set<string> {
  const zones = new Set<string>();

  for (const conn of generatedConnections) {
    const { ramp, entryPoint, exitPoint, width } = conn;

    // Calculate the actual vector from entry to exit (matches ramp generation)
    const dx = exitPoint.x - entryPoint.x;
    const dy = exitPoint.y - entryPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    // Normalized direction along the ramp
    const dirX = length > 0 ? dx / length : 0;
    const dirY = length > 0 ? dy / length : 1;

    // Perpendicular vector for width
    const perpX = -dirY;
    const perpY = dirX;

    // Protect along the entire ramp path with extra buffer
    const halfWidth = width / 2 + extraBuffer;
    const steps = Math.ceil(length) + 1;

    for (let step = 0; step <= steps; step++) {
      const t = step / Math.max(1, steps);
      const centerX = entryPoint.x + dx * t;
      const centerY = entryPoint.y + dy * t;

      // Fill cells across the width with buffer
      for (let w = -halfWidth; w <= halfWidth; w++) {
        const px = Math.floor(centerX + perpX * w);
        const py = Math.floor(centerY + perpY * w);
        zones.add(`${px},${py}`);
      }
    }

    // Extended protection into the source area (entry side)
    const entryExtension = 12;
    for (let i = 0; i < entryExtension; i++) {
      const cx = entryPoint.x - dirX * i;
      const cy = entryPoint.y - dirY * i;
      for (let w = -halfWidth; w <= halfWidth; w++) {
        const px = Math.floor(cx + perpX * w);
        const py = Math.floor(cy + perpY * w);
        zones.add(`${px},${py}`);
      }
    }

    // Extended protection into the destination area (exit side)
    const exitExtension = 12;
    for (let i = 0; i < exitExtension; i++) {
      const cx = exitPoint.x + dirX * i;
      const cy = exitPoint.y + dirY * i;
      for (let w = -halfWidth; w <= halfWidth; w++) {
        const px = Math.floor(cx + perpX * w);
        const py = Math.floor(cy + perpY * w);
        zones.add(`${px},${py}`);
      }
    }

    // Also protect the bounding box of the ramp itself
    for (let dy = -extraBuffer; dy < ramp.height + extraBuffer; dy++) {
      for (let dx = -extraBuffer; dx < ramp.width + extraBuffer; dx++) {
        const px = ramp.x + dx;
        const py = ramp.y + dy;
        zones.add(`${px},${py}`);
      }
    }
  }

  return zones;
}

/**
 * Generate terrain from a topology definition.
 * This is the main entry point for the topology-based terrain system.
 *
 * Process:
 * 1. Create empty grid
 * 2. Generate all ramps first (to establish protected zones)
 * 3. Generate platform areas (respecting protected zones)
 * 4. Generate simple ground areas
 * 5. Return terrain grid and ramp data
 */
export function generateTerrainFromTopology(
  width: number,
  height: number,
  topology: MapTopology,
  defaultElevation: ElevationLevel = 0
): TopologyGenerationResult {
  // Create empty grid at default elevation
  const defaultElev256 = legacyElevationTo256(defaultElevation);
  const grid: MapCell[][] = [];

  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = {
        terrain: 'ground',
        elevation: defaultElev256,
        feature: 'none',
        textureId: Math.floor(Math.random() * 4),
      };
    }
  }

  // Build area lookup map
  const areaMap = new Map<string, TopologyArea>();
  for (const area of topology.areas) {
    areaMap.set(area.id, area);
  }

  // Step 1: Calculate all connection points and generate ramps
  const generatedConnections: GeneratedConnection[] = [];
  const ramps: Ramp[] = [];

  for (const connection of topology.connections) {
    const fromArea = areaMap.get(connection.from);
    const toArea = areaMap.get(connection.to);

    if (!fromArea || !toArea) {
      console.warn(`[TerrainTopology] Connection references unknown area: ${connection.from} -> ${connection.to}`);
      continue;
    }

    // Calculate connection points
    const points = calculateConnectionPoints(fromArea, toArea, connection);

    // Generate ramp path
    const rampBounds = generateRampPath(
      grid,
      points.entryPoint,
      points.exitPoint,
      connection.width,
      points.fromElevation,
      points.toElevation,
      points.direction
    );

    // Create Ramp object for MapData (use direction computed by rampBounds)
    const ramp: Ramp = {
      x: rampBounds.x,
      y: rampBounds.y,
      width: rampBounds.width,
      height: rampBounds.height,
      direction: rampBounds.direction,
      fromElevation: points.fromElevation,
      toElevation: points.toElevation,
    };

    ramps.push(ramp);

    generatedConnections.push({
      ramp,
      fromAreaId: connection.from,
      toAreaId: connection.to,
      entryPoint: points.entryPoint,
      exitPoint: points.exitPoint,
      width: connection.width,
    });
  }

  // Step 2: Build protected zones around ramps
  const protectedZones = buildProtectedZones(generatedConnections);

  // Step 3: Generate platform areas (areas with cliffs)
  const platformTypes = ['main', 'natural'];
  for (const area of topology.areas) {
    if (platformTypes.includes(area.type)) {
      if (area.shape === 'rect' && area.rectSize) {
        generateRectangularPlatform(grid, area, protectedZones);
      } else {
        generateCircularPlatform(grid, area, protectedZones);
      }
    }
  }

  // Step 4: Generate simple ground areas (areas without cliffs)
  const groundTypes = ['third', 'fourth', 'gold', 'center', 'open_ground'];
  for (const area of topology.areas) {
    if (groundTypes.includes(area.type)) {
      generateGroundArea(grid, area);
    }
  }

  return {
    terrain: grid,
    ramps,
    connections: generatedConnections,
  };
}

// ============================================
// HELPER FUNCTIONS FOR MAP AUTHORS
// ============================================

/**
 * Create a main base area definition
 */
export function mainBase(
  id: string,
  x: number,
  y: number,
  radius: number = 25,
  elevation: ElevationLevel = 2,
  cliffWidth: number = 4
): TopologyArea {
  return {
    id,
    type: 'main',
    center: { x, y },
    radius,
    elevation,
    cliffWidth,
  };
}

/**
 * Create a natural expansion area definition
 */
export function naturalExpansion(
  id: string,
  x: number,
  y: number,
  radius: number = 16,
  elevation: ElevationLevel = 1,
  cliffWidth: number = 3
): TopologyArea {
  return {
    id,
    type: 'natural',
    center: { x, y },
    radius,
    elevation,
    cliffWidth,
  };
}

/**
 * Create a third/fourth expansion area definition (no cliffs)
 */
export function expansion(
  id: string,
  type: 'third' | 'fourth' | 'gold' | 'center',
  x: number,
  y: number,
  radius: number = 16,
  elevation: ElevationLevel = 0
): TopologyArea {
  return {
    id,
    type,
    center: { x, y },
    radius,
    elevation,
  };
}

/**
 * Create a connection between two areas
 */
export function connect(
  from: string,
  to: string,
  width: number = 10,
  direction: 'north' | 'south' | 'east' | 'west' | 'auto' = 'auto'
): TopologyConnection {
  return {
    from,
    to,
    width,
    direction,
  };
}

/**
 * Get ramp clearance zones for decoration placement.
 * Returns a Set of cell keys that should not have decorations.
 * Uses TRUE VECTOR geometry for diagonal ramps.
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

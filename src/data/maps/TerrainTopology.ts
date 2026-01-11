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
 * This finds the closest points between two circular areas
 * and determines the appropriate ramp geometry.
 */
export function calculateConnectionPoints(
  fromArea: TopologyArea,
  toArea: TopologyArea,
  connection: TopologyConnection
): ConnectionPoints {
  const fromCenter = fromArea.center;
  const toCenter = toArea.center;

  // Calculate direction from fromArea to toArea
  const direction = connection.direction === 'auto' || !connection.direction
    ? getCardinalDirection(fromCenter, toCenter)
    : connection.direction;

  const dirVec = getDirectionVector(direction);
  const fromCliffWidth = fromArea.cliffWidth ?? (fromArea.type === 'main' ? 4 : 3);
  const toCliffWidth = toArea.cliffWidth ?? (toArea.type === 'main' ? 4 : 3);

  // Calculate ramp entry/exit points on the edges of the areas
  // Entry point: on the edge of fromArea's cliff ring, facing toward toArea
  // Exit point: on the edge of toArea's cliff ring, facing toward fromArea

  // For fromArea: entry point is at the outer edge of cliff ring
  const fromOuterRadius = fromArea.radius + fromCliffWidth;
  const entryPoint = {
    x: fromCenter.x + dirVec.x * fromOuterRadius,
    y: fromCenter.y + dirVec.y * fromOuterRadius,
  };

  // For toArea: exit point is at the outer edge of cliff ring, facing back
  const toOuterRadius = toArea.radius + toCliffWidth;
  const exitPoint = {
    x: toCenter.x - dirVec.x * toOuterRadius,
    y: toCenter.y - dirVec.y * toOuterRadius,
  };

  // Determine which area is higher (ramp goes from high to low)
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
 * Returns cells to mark as ramp terrain.
 */
function generateRampPath(
  grid: MapCell[][],
  entry: { x: number; y: number },
  exit: { x: number; y: number },
  width: number,
  fromElevation: ElevationLevel,
  toElevation: ElevationLevel,
  direction: 'north' | 'south' | 'east' | 'west'
): { x: number; y: number; width: number; height: number } {
  // Calculate ramp dimensions based on direction
  const isVertical = direction === 'north' || direction === 'south';

  // Determine ramp bounds
  let rampX: number, rampY: number, rampWidth: number, rampHeight: number;

  if (isVertical) {
    // Vertical ramp: entry and exit differ in Y
    const minY = Math.min(entry.y, exit.y);
    const maxY = Math.max(entry.y, exit.y);
    rampX = Math.floor(entry.x - width / 2);
    rampY = Math.floor(minY);
    rampWidth = width;
    rampHeight = Math.ceil(maxY - minY) + 1;
  } else {
    // Horizontal ramp: entry and exit differ in X
    const minX = Math.min(entry.x, exit.x);
    const maxX = Math.max(entry.x, exit.x);
    rampX = Math.floor(minX);
    rampY = Math.floor(entry.y - width / 2);
    rampWidth = Math.ceil(maxX - minX) + 1;
    rampHeight = width;
  }

  // Ensure minimum ramp size
  rampWidth = Math.max(rampWidth, width);
  rampHeight = Math.max(rampHeight, width);

  const fromElev256 = legacyElevationTo256(fromElevation);
  const toElev256 = legacyElevationTo256(toElevation);

  // Fill ramp cells
  for (let dy = 0; dy < rampHeight; dy++) {
    for (let dx = 0; dx < rampWidth; dx++) {
      const px = rampX + dx;
      const py = rampY + dy;

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // Calculate elevation gradient
        let t = 0;
        switch (direction) {
          case 'north':
            t = 1 - dy / Math.max(1, rampHeight - 1);
            break;
          case 'south':
            t = dy / Math.max(1, rampHeight - 1);
            break;
          case 'east':
            t = 1 - dx / Math.max(1, rampWidth - 1);
            break;
          case 'west':
            t = dx / Math.max(1, rampWidth - 1);
            break;
        }

        const elevation = Math.round(fromElev256 + (toElev256 - fromElev256) * t);

        grid[py][px] = {
          terrain: 'ramp',
          elevation,
          feature: 'none',
          textureId: Math.floor(Math.random() * 4),
        };
      }
    }
  }

  return { x: rampX, y: rampY, width: rampWidth, height: rampHeight };
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
        const key = `${px},${py}`;

        // Skip protected zones (ramps)
        if (protectedZones.has(key)) {
          continue;
        }

        // Skip if already a ramp
        if (grid[py][px].terrain === 'ramp') {
          continue;
        }

        if (dist <= radius) {
          // Inner buildable area
          grid[py][px] = {
            terrain: 'ground',
            elevation: elevation256,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        } else if (dist <= outerRadius) {
          // Cliff ring - but check if near a protected zone
          if (!isNearProtectedZone(px, py, protectedZones, cliffWidth + 2)) {
            grid[py][px] = {
              terrain: 'unwalkable',
              elevation: elevation256,
              feature: 'cliff',
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
        const key = `${px},${py}`;

        // Skip protected zones
        if (protectedZones.has(key)) {
          continue;
        }

        // Skip if already a ramp
        if (grid[py][px].terrain === 'ramp') {
          continue;
        }

        const isInner = Math.abs(dx) <= halfW && Math.abs(dy) <= halfH;

        if (isInner) {
          // Inner buildable area
          grid[py][px] = {
            terrain: 'ground',
            elevation: elevation256,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        } else if (!isNearProtectedZone(px, py, protectedZones, cliffWidth + 2)) {
          // Cliff ring
          grid[py][px] = {
            terrain: 'unwalkable',
            elevation: elevation256,
            feature: 'cliff',
            textureId: Math.floor(Math.random() * 4),
          };
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
 */
function buildProtectedZones(
  generatedConnections: GeneratedConnection[],
  extraBuffer: number = 3
): Set<string> {
  const zones = new Set<string>();

  for (const conn of generatedConnections) {
    const { ramp } = conn;

    // Mark all cells in and around the ramp as protected
    for (let dy = -extraBuffer; dy < ramp.height + extraBuffer; dy++) {
      for (let dx = -extraBuffer; dx < ramp.width + extraBuffer; dx++) {
        const px = ramp.x + dx;
        const py = ramp.y + dy;
        zones.add(`${px},${py}`);
      }
    }

    // Also protect extended entry/exit areas in the ramp direction
    const dirVec = getDirectionVector(ramp.direction);
    const extensionLength = 8;

    // Entry extension
    for (let i = 0; i < extensionLength; i++) {
      const cx = Math.floor(conn.entryPoint.x - dirVec.x * i);
      const cy = Math.floor(conn.entryPoint.y - dirVec.y * i);
      for (let w = -Math.ceil(conn.width / 2) - 2; w <= Math.ceil(conn.width / 2) + 2; w++) {
        const perpVec = getPerpendicular(dirVec);
        const px = cx + Math.floor(perpVec.x * w);
        const py = cy + Math.floor(perpVec.y * w);
        zones.add(`${px},${py}`);
      }
    }

    // Exit extension
    for (let i = 0; i < extensionLength; i++) {
      const cx = Math.floor(conn.exitPoint.x + dirVec.x * i);
      const cy = Math.floor(conn.exitPoint.y + dirVec.y * i);
      for (let w = -Math.ceil(conn.width / 2) - 2; w <= Math.ceil(conn.width / 2) + 2; w++) {
        const perpVec = getPerpendicular(dirVec);
        const px = cx + Math.floor(perpVec.x * w);
        const py = cy + Math.floor(perpVec.y * w);
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

    // Create Ramp object for MapData
    const ramp: Ramp = {
      x: rampBounds.x,
      y: rampBounds.y,
      width: rampBounds.width,
      height: rampBounds.height,
      direction: points.direction,
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
 */
export function getRampClearanceZones(connections: GeneratedConnection[]): Set<string> {
  const clearance = new Set<string>();
  const CLEARANCE_RADIUS = 10;
  const EXIT_EXTENSION = 18;

  for (const conn of connections) {
    const { ramp } = conn;

    // Circular clearance around ramp
    const centerX = ramp.x + ramp.width / 2;
    const centerY = ramp.y + ramp.height / 2;

    for (let dy = -CLEARANCE_RADIUS; dy <= CLEARANCE_RADIUS; dy++) {
      for (let dx = -CLEARANCE_RADIUS; dx <= CLEARANCE_RADIUS; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= CLEARANCE_RADIUS) {
          clearance.add(`${Math.floor(centerX + dx)},${Math.floor(centerY + dy)}`);
        }
      }
    }

    // Extended clearance in entry/exit direction
    const dirVec = getDirectionVector(ramp.direction);
    const halfWidth = Math.max(ramp.width, ramp.height) / 2 + 4;

    // Entry direction
    for (let d = 0; d < EXIT_EXTENSION; d++) {
      const cx = Math.floor(conn.entryPoint.x - dirVec.x * d);
      const cy = Math.floor(conn.entryPoint.y - dirVec.y * d);
      const perpVec = getPerpendicular(dirVec);
      for (let w = -halfWidth; w <= halfWidth; w++) {
        clearance.add(`${cx + Math.floor(perpVec.x * w)},${cy + Math.floor(perpVec.y * w)}`);
      }
    }

    // Exit direction
    for (let d = 0; d < EXIT_EXTENSION; d++) {
      const cx = Math.floor(conn.exitPoint.x + dirVec.x * d);
      const cy = Math.floor(conn.exitPoint.y + dirVec.y * d);
      const perpVec = getPerpendicular(dirVec);
      for (let w = -halfWidth; w <= halfWidth; w++) {
        clearance.add(`${cx + Math.floor(perpVec.x * w)},${cy + Math.floor(perpVec.y * w)}`);
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

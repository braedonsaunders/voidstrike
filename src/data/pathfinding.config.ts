/**
 * PathfindingConfig - Centralized pathfinding configuration
 *
 * SINGLE SOURCE OF TRUTH for all pathfinding parameters.
 * Both the game's Recast Navigation and the editor's validation
 * use these values to ensure consistency.
 *
 * IMPORTANT: If you change these values, both game pathfinding
 * and editor validation will update automatically.
 */

// =============================================================================
// CORE PATHFINDING PARAMETERS
// =============================================================================

/**
 * Maximum height a unit can step up in a single movement.
 * Units of: world height (not elevation)
 *
 * This controls:
 * - Whether units can walk between adjacent terrain cells
 * - Ramp traversability (ramps must have slope < this per cell)
 * - Cliff blocking (cliffs have height difference >> this)
 *
 * SC2-style value: 0.8 allows typical ramps (~0.5 per cell)
 * while blocking cliffs (3.2+ height jumps)
 */
export const WALKABLE_CLIMB = 0.8;

/**
 * Maximum slope angle units can walk on (degrees).
 * Recast uses this to reject near-vertical surfaces.
 *
 * SC2-style value: 50° allows most ramps while rejecting cliff faces
 */
export const WALKABLE_SLOPE_ANGLE = 50;

/**
 * Minimum clearance height required for units to pass.
 * Units of: world height
 */
export const WALKABLE_HEIGHT = 2.0;

/**
 * Agent collision radius for pathfinding.
 * Paths maintain this clearance from obstacles.
 * Units of: world units
 */
export const WALKABLE_RADIUS = 0.6;

/**
 * Cell size for navmesh generation.
 * Smaller = more precise but more memory.
 * Units of: world units
 */
export const NAVMESH_CELL_SIZE = 0.5;

/**
 * Cell height for navmesh generation.
 * Finer vertical precision for better cliff edge detection.
 * Units of: world height
 */
export const NAVMESH_CELL_HEIGHT = 0.2;

/**
 * Maximum error allowed when simplifying navmesh edges.
 * Tighter = more accurate cliff edges
 */
export const MAX_SIMPLIFICATION_ERROR = 0.5;

/**
 * Tile size for tiled navmesh generation.
 * Larger = fewer tiles = less memory
 */
export const TILE_SIZE = 32;

/**
 * Expected layers per tile for multi-level terrain.
 */
export const EXPECTED_LAYERS_PER_TILE = 4;

/**
 * Maximum dynamic obstacles (buildings) supported.
 */
export const MAX_OBSTACLES = 512;

// =============================================================================
// TERRAIN CONVERSION
// =============================================================================

/**
 * Conversion factor from terrain elevation (0-255) to world height.
 * elevation * ELEVATION_TO_HEIGHT_FACTOR = world height
 *
 * With this factor:
 * - Elevation 0 = height 0
 * - Elevation 255 = height 10.2
 */
export const ELEVATION_TO_HEIGHT_FACTOR = 0.04;

/**
 * Convert terrain elevation (0-255) to world height.
 */
export function elevationToHeight(elevation: number): number {
  return elevation * ELEVATION_TO_HEIGHT_FACTOR;
}

/**
 * Convert world height to terrain elevation (0-255).
 */
export function heightToElevation(height: number): number {
  return Math.round(height / ELEVATION_TO_HEIGHT_FACTOR);
}

// =============================================================================
// DERIVED VALUES (for validation and terrain analysis)
// =============================================================================

/**
 * Maximum elevation difference for walkable traversal (without ramp).
 * Derived from: WALKABLE_CLIMB / ELEVATION_TO_HEIGHT_FACTOR
 *
 * Using slightly conservative value (-2) to account for
 * navmesh cell sampling and floating-point precision.
 */
export const WALKABLE_CLIMB_ELEVATION = Math.floor(WALKABLE_CLIMB / ELEVATION_TO_HEIGHT_FACTOR) - 2;

/**
 * Elevation difference that triggers cliff wall generation in terrain.
 * This is higher than WALKABLE_CLIMB_ELEVATION because we want walls
 * generated at real cliff boundaries, not every small step.
 *
 * Set to 2x the walkable climb to ensure walls exist where needed.
 */
export const CLIFF_WALL_THRESHOLD_ELEVATION = 40;

// =============================================================================
// CROWD SIMULATION
// =============================================================================

/**
 * Maximum number of agents in crowd simulation.
 * Set high enough for 8-player RTS (200 supply per player × 8 = 1600 supply).
 * With small units at 0.5 supply, this could mean ~3200 units total.
 */
export const CROWD_MAX_AGENTS = 2000;

/**
 * Maximum agent radius for crowd simulation.
 */
export const CROWD_MAX_AGENT_RADIUS = 2.0;

/**
 * Default agent radius.
 */
export const DEFAULT_AGENT_RADIUS = 0.5;

// =============================================================================
// CONFIG OBJECTS (for libraries that need object format)
// =============================================================================

/**
 * Recast Navigation TileCache config.
 * Use this when calling generateTileCache() or threeToTileCache().
 */
export const NAVMESH_CONFIG = {
  cs: NAVMESH_CELL_SIZE,
  ch: NAVMESH_CELL_HEIGHT,
  walkableSlopeAngle: WALKABLE_SLOPE_ANGLE,
  walkableHeight: WALKABLE_HEIGHT,
  walkableClimb: WALKABLE_CLIMB,
  walkableRadius: WALKABLE_RADIUS,
  maxSimplificationError: MAX_SIMPLIFICATION_ERROR,
  tileSize: TILE_SIZE,
  expectedLayersPerTile: EXPECTED_LAYERS_PER_TILE,
  maxObstacles: MAX_OBSTACLES,
} as const;

/**
 * Recast Navigation Solo NavMesh config (fallback without dynamic obstacles).
 */
export const SOLO_NAVMESH_CONFIG = {
  cs: NAVMESH_CELL_SIZE,
  ch: NAVMESH_CELL_HEIGHT,
  walkableSlopeAngle: WALKABLE_SLOPE_ANGLE,
  walkableHeight: WALKABLE_HEIGHT,
  walkableClimb: WALKABLE_CLIMB,
  walkableRadius: WALKABLE_RADIUS,
  maxSimplificationError: MAX_SIMPLIFICATION_ERROR,
} as const;

/**
 * Crowd simulation config.
 */
export const CROWD_CONFIG = {
  maxAgents: CROWD_MAX_AGENTS,
  maxAgentRadius: CROWD_MAX_AGENT_RADIUS,
} as const;

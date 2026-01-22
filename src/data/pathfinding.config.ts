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
 * Value: 0.8 allows typical ramps (~0.5 per cell)
 * while blocking cliffs (3.2+ height jumps)
 */
export const WALKABLE_CLIMB = 0.8;

/**
 * Maximum slope angle units can walk on (degrees).
 * Recast uses this to reject near-vertical surfaces.
 *
 * Value: 50° allows most ramps while rejecting cliff faces
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

/**
 * Elevation threshold for ramp-terrain boundary height calculation.
 * When ramp and non-ramp cells at a vertex differ by less than this,
 * use MAX elevation to ensure smooth connection. When greater,
 * the boundary is treated as a cliff edge.
 *
 * Set to WALKABLE_CLIMB / ELEVATION_TO_HEIGHT_FACTOR = 20 elevation units = 0.8 height
 */
export const RAMP_BOUNDARY_ELEVATION_THRESHOLD = Math.floor(WALKABLE_CLIMB / ELEVATION_TO_HEIGHT_FACTOR);

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

// =============================================================================
// RAMP CONSTRAINT VALIDATION
// =============================================================================

/**
 * Maximum elevation change per cell for a traversable ramp.
 * Derived from WALKABLE_CLIMB with margin for navmesh cell sampling.
 *
 * With WALKABLE_CLIMB = 0.8 and ELEVATION_TO_HEIGHT_FACTOR = 0.04:
 * - 0.8 / 0.04 = 20 elevation units theoretical max
 * - Using 16 to provide safety margin for interpolation/quantization
 */
export const MAX_RAMP_ELEVATION_PER_CELL = 16;

/**
 * Result of ramp constraint validation.
 */
export interface RampConstraintResult {
  /** Whether the ramp is valid without modifications */
  isValid: boolean;
  /** Minimum length required for a valid ramp (in cells) */
  minRequiredLength: number;
  /** Actual length of the ramp (in cells) */
  actualLength: number;
  /** Maximum per-cell elevation delta with current length */
  maxElevationPerCell: number;
  /** Warning message if ramp is invalid */
  warning?: string;
}

/**
 * Calculate the minimum ramp length required for a given elevation delta.
 * Ensures per-cell height step stays within WALKABLE_CLIMB.
 *
 * @param elevationDelta - Absolute difference in elevation (0-255 scale)
 * @returns Minimum length in grid cells
 */
export function calculateMinRampLength(elevationDelta: number): number {
  if (elevationDelta === 0) return 1;
  // minLength = elevationDelta / maxElevationPerCell, rounded up
  return Math.ceil(Math.abs(elevationDelta) / MAX_RAMP_ELEVATION_PER_CELL);
}

/**
 * Validate a ramp's dimensions against walkable climb constraints.
 *
 * @param fromElevation - Starting elevation (0-255)
 * @param toElevation - Ending elevation (0-255)
 * @param length - Ramp length in grid cells
 * @returns Constraint validation result
 */
export function validateRampConstraints(
  fromElevation: number,
  toElevation: number,
  length: number
): RampConstraintResult {
  const elevationDelta = Math.abs(toElevation - fromElevation);
  const minRequiredLength = calculateMinRampLength(elevationDelta);
  const maxElevationPerCell = length > 0 ? elevationDelta / length : elevationDelta;
  const isValid = length >= minRequiredLength;

  let warning: string | undefined;
  if (!isValid) {
    const heightDelta = (elevationDelta * ELEVATION_TO_HEIGHT_FACTOR).toFixed(2);
    const heightPerCell = (maxElevationPerCell * ELEVATION_TO_HEIGHT_FACTOR).toFixed(2);
    warning =
      `Ramp too steep: ${heightPerCell} height/cell exceeds walkableClimb (${WALKABLE_CLIMB}). ` +
      `Elevation delta: ${elevationDelta} (${heightDelta} height). ` +
      `Minimum length: ${minRequiredLength} cells, actual: ${Math.ceil(length)} cells.`;
  }

  return {
    isValid,
    minRequiredLength,
    actualLength: length,
    maxElevationPerCell,
    warning,
  };
}

/**
 * Calculate extended ramp endpoint to satisfy walkable climb constraints.
 * Extends the ramp in the same direction until the slope is valid.
 *
 * @param fromX - Start X coordinate
 * @param fromY - Start Y coordinate
 * @param toX - End X coordinate
 * @param toY - End Y coordinate
 * @param fromElevation - Starting elevation (0-255)
 * @param toElevation - Ending elevation (0-255)
 * @returns Extended endpoint { x, y } and validation info
 */
export function calculateExtendedRampEndpoint(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  fromElevation: number,
  toElevation: number
): { x: number; y: number; wasExtended: boolean; validation: RampConstraintResult } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const currentLength = Math.sqrt(dx * dx + dy * dy);

  const validation = validateRampConstraints(fromElevation, toElevation, currentLength);

  if (validation.isValid || currentLength === 0) {
    return { x: toX, y: toY, wasExtended: false, validation };
  }

  // Extend the ramp in the same direction
  const minLength = validation.minRequiredLength;
  const scale = minLength / currentLength;
  const extendedX = fromX + dx * scale;
  const extendedY = fromY + dy * scale;

  // Recalculate validation for extended ramp
  const extendedValidation = validateRampConstraints(fromElevation, toElevation, minLength);

  return {
    x: extendedX,
    y: extendedY,
    wasExtended: true,
    validation: extendedValidation,
  };
}

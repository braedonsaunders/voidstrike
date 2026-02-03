/**
 * Vision Coordinate System
 *
 * Shared coordinate mapping utilities for fog of war / vision system.
 * Ensures GPU and CPU paths use identical coordinate transformations.
 *
 * COORDINATE CONVENTION (non-standard for Three.js):
 * - transform.x = horizontal (east-west)
 * - transform.y = depth (north-south) ← Used for vision grid Y
 * - transform.z = altitude (up-down)
 *
 * The vision grid is a 2D array where:
 * - grid[y][x] corresponds to world position (x * cellSize, y * cellSize)
 * - gridY maps to worldY (depth), NOT worldZ (altitude)
 */

export interface VisionGridConfig {
  mapWidth: number;
  mapHeight: number;
  cellSize: number;
}

export interface GridDimensions {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
}

/**
 * Calculate grid dimensions from map config
 */
export function calculateGridDimensions(config: VisionGridConfig): GridDimensions {
  return {
    gridWidth: Math.ceil(config.mapWidth / config.cellSize),
    gridHeight: Math.ceil(config.mapHeight / config.cellSize),
    cellSize: config.cellSize,
  };
}

/**
 * Convert world position to grid cell coordinates
 * @param worldX - World X coordinate (horizontal)
 * @param worldY - World Y coordinate (depth/north-south, NOT altitude)
 * @param cellSize - Size of each grid cell
 * @returns Grid cell coordinates {cellX, cellY}
 */
export function worldToGrid(
  worldX: number,
  worldY: number,
  cellSize: number
): { cellX: number; cellY: number } {
  return {
    cellX: Math.floor(worldX / cellSize),
    cellY: Math.floor(worldY / cellSize),
  };
}

/**
 * Convert grid cell to world position (cell center)
 * @param cellX - Grid cell X coordinate
 * @param cellY - Grid cell Y coordinate
 * @param cellSize - Size of each grid cell
 * @returns World position at cell center {worldX, worldY}
 */
export function gridToWorld(
  cellX: number,
  cellY: number,
  cellSize: number
): { worldX: number; worldY: number } {
  return {
    worldX: cellX * cellSize + cellSize * 0.5,
    worldY: cellY * cellSize + cellSize * 0.5,
  };
}

/**
 * Convert grid cell to texture index (1D array index)
 * NO Y-FLIP - grid (0,0) maps to texture index 0
 *
 * This must match the GPU path (VisionCompute) which writes
 * directly to textureStore(tex, vec2(cellX, cellY), ...)
 *
 * @param cellX - Grid cell X coordinate
 * @param cellY - Grid cell Y coordinate
 * @param gridWidth - Width of the grid
 * @returns 1D texture array index
 */
export function gridToTextureIndex(cellX: number, cellY: number, gridWidth: number): number {
  // NO Y-FLIP: grid row y maps directly to texture row y
  return cellY * gridWidth + cellX;
}

/**
 * Convert world position to vision texture UV coordinates
 * Used by the fog of war shader to sample the vision texture
 *
 * @param worldX - World X coordinate (horizontal)
 * @param worldY - World Y coordinate (depth, NOT altitude)
 * @param mapWidth - Total map width
 * @param mapHeight - Total map height
 * @returns UV coordinates {u, v} in range [0, 1]
 */
export function worldToVisionUV(
  worldX: number,
  worldY: number,
  mapWidth: number,
  mapHeight: number
): { u: number; v: number } {
  return {
    u: worldX / mapWidth,
    v: worldY / mapHeight, // worldY (depth), NOT worldZ (altitude)
  };
}

/**
 * Check if a grid cell is within bounds
 */
export function isValidGridCell(
  cellX: number,
  cellY: number,
  gridWidth: number,
  gridHeight: number
): boolean {
  return cellX >= 0 && cellX < gridWidth && cellY >= 0 && cellY < gridHeight;
}

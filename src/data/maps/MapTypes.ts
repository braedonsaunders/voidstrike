// Map data structures for RTS-style maps
// Enhanced terrain system with 256 height levels and terrain features

import { BiomeType } from '@/rendering/Biomes';
import { distance, clamp } from '@/utils/math';

export type TerrainType =
  | 'ground'      // Normal walkable terrain (natural, smooth heightmap)
  | 'platform'    // Geometric platform (flat surface, vertical cliff edges)
  | 'unwalkable'  // Cliffs, deep water, void - completely impassable
  | 'ramp'        // Connects different elevations
  | 'unbuildable' // Walkable but can't place buildings
  | 'creep';      // Swarm creep (later)

/**
 * Edge style for platform cells.
 * Controls how the edge between this cell and a lower neighbor is rendered.
 */
export type PlatformEdgeStyle = 'cliff' | 'natural' | 'ramp';

/**
 * Per-edge style configuration for platform cells.
 * If undefined, edge style is auto-detected based on neighbor elevation.
 */
export interface PlatformEdges {
  north?: PlatformEdgeStyle;
  south?: PlatformEdgeStyle;
  east?: PlatformEdgeStyle;
  west?: PlatformEdgeStyle;
}

/**
 * Terrain features overlay terrain type and add gameplay modifiers.
 * A cell can have a terrain type AND a feature.
 */
export type TerrainFeature =
  | 'none'           // No special feature
  | 'water_shallow'  // Walkable (0.6x speed), unbuildable, no vision block
  | 'water_deep'     // Impassable, unbuildable (rendered as lakes/ocean)
  | 'forest_light'   // Walkable (0.85x speed), unbuildable, partial vision block
  | 'forest_dense'   // Walkable (0.5x speed), unbuildable, full vision block, hides units
  | 'mud'            // Walkable (0.4x speed), unbuildable
  | 'road'           // Walkable (1.25x speed), unbuildable (faster movement corridors)
  | 'void'           // Impassable (map edges, chasms)
  | 'cliff';         // Impassable (sheer drops, no ramps possible)

/**
 * Feature configuration for movement and gameplay
 */
export interface TerrainFeatureConfig {
  walkable: boolean;
  buildable: boolean;
  speedModifier: number;  // 1.0 = normal, <1 = slower, >1 = faster
  blocksVision: boolean;  // Units inside are hidden from enemies outside
  partialVision: boolean; // Reduces vision range (like tall grass)
  flyingIgnores: boolean; // Flying units ignore this feature
}

/**
 * Feature configurations - defines gameplay behavior
 */
export const TERRAIN_FEATURE_CONFIG: Record<TerrainFeature, TerrainFeatureConfig> = {
  none: { walkable: true, buildable: true, speedModifier: 1.0, blocksVision: false, partialVision: false, flyingIgnores: true },
  water_shallow: { walkable: true, buildable: false, speedModifier: 0.6, blocksVision: false, partialVision: false, flyingIgnores: true },
  water_deep: { walkable: false, buildable: false, speedModifier: 0, blocksVision: false, partialVision: false, flyingIgnores: true },
  forest_light: { walkable: true, buildable: false, speedModifier: 0.85, blocksVision: false, partialVision: true, flyingIgnores: true },
  forest_dense: { walkable: true, buildable: false, speedModifier: 0.5, blocksVision: true, partialVision: false, flyingIgnores: false },
  mud: { walkable: true, buildable: false, speedModifier: 0.4, blocksVision: false, partialVision: false, flyingIgnores: true },
  road: { walkable: true, buildable: false, speedModifier: 1.25, blocksVision: false, partialVision: false, flyingIgnores: true },
  void: { walkable: false, buildable: false, speedModifier: 0, blocksVision: false, partialVision: false, flyingIgnores: false },
  cliff: { walkable: false, buildable: false, speedModifier: 0, blocksVision: true, partialVision: false, flyingIgnores: true },
};

/**
 * Elevation now uses 0-255 range for smooth terrain.
 * Gameplay zones for high-ground advantage:
 * - Low ground: 0-85 (use ~60 for standard low)
 * - Mid ground: 86-170 (use ~140 for standard mid)
 * - High ground: 171-255 (use ~220 for standard high)
 */
export type Elevation = number; // 0-255

/** Standard elevation values for gameplay zones */
export const ELEVATION_LOW = 60;
export const ELEVATION_MID = 140;
export const ELEVATION_HIGH = 220;

/**
 * Convert 0-255 elevation to gameplay zone (low/mid/high)
 */
export function elevationToZone(elevation: Elevation): 'low' | 'mid' | 'high' {
  if (elevation <= 85) return 'low';
  if (elevation <= 170) return 'mid';
  return 'high';
}

/**
 * Get high-ground advantage multiplier based on elevation difference
 */
export function getHighGroundAdvantage(attackerElevation: Elevation, defenderElevation: Elevation): number {
  const attackerZone = elevationToZone(attackerElevation);
  const defenderZone = elevationToZone(defenderElevation);

  // Attacking from lower ground has miss chance
  if (attackerZone === 'low' && defenderZone === 'high') return 0.7; // 30% miss
  if (attackerZone === 'low' && defenderZone === 'mid') return 0.85; // 15% miss
  if (attackerZone === 'mid' && defenderZone === 'high') return 0.85; // 15% miss

  return 1.0; // No disadvantage
}

export interface MapCell {
  terrain: TerrainType;
  elevation: Elevation;        // 0-255 for smooth terrain
  feature: TerrainFeature;     // Overlay feature (forest, water, etc.)
  textureId: number;           // For visual variety
  /** Per-edge style for platform cells (optional, auto-detected if not set) */
  edges?: PlatformEdges;
}

export interface ResourceNode {
  x: number;
  y: number;
  type: 'minerals' | 'vespene';
  amount: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  playerSlot: number; // 1, 2, etc.
  rotation: number; // Camera starting rotation
}

export interface Expansion {
  name: string;
  x: number;
  y: number;
  minerals: ResourceNode[];
  vespene: ResourceNode[];
  isMain?: boolean;
  isNatural?: boolean;
}

export interface WatchTower {
  x: number;
  y: number;
  radius: number; // Vision radius
}

export interface Ramp {
  x: number;
  y: number;
  width: number;
  height: number;
  direction: 'north' | 'south' | 'east' | 'west';
  fromElevation: Elevation;  // 0-255 scale
  toElevation: Elevation;    // 0-255 scale
}

export interface DestructibleRock {
  x: number;
  y: number;
  health: number;
}

// Decoration types that can be placed on maps
export type DecorationType =
  | 'tree_pine_tall'
  | 'tree_pine_medium'
  | 'tree_dead'
  | 'tree_alien'
  | 'tree_palm'
  | 'tree_mushroom'
  | 'rocks_large'
  | 'rocks_small'
  | 'rock_single'
  | 'crystal_formation'
  | 'bush'
  | 'grass_clump'
  | 'debris'
  | 'escape_pod'
  | 'ruined_wall';

export interface MapDecoration {
  type: DecorationType;
  x: number;
  y: number;
  scale?: number;      // Default 1.0
  rotation?: number;   // Radians, default random
}

export interface MapData {
  id: string;
  name: string;
  author: string;
  description: string;

  // Dimensions
  width: number;
  height: number;

  // Terrain grid
  terrain: MapCell[][];

  // Game elements
  spawns: SpawnPoint[];
  expansions: Expansion[];
  watchTowers: WatchTower[];
  ramps: Ramp[];
  destructibles: DestructibleRock[];
  decorations?: MapDecoration[];  // Explicit decoration placements

  // Metadata
  playerCount: 2 | 4 | 6 | 8;  // Designed player count for this map
  maxPlayers: number;          // Maximum supported players
  isRanked: boolean;
  thumbnailUrl?: string;

  // Visual - biome determines colors, decorations, particles, etc.
  biome: BiomeType;

  // Skip procedural decoration generation (trees, rocks)
  // Set to true for custom/editor maps to prevent auto-generated clutter
  skipProceduralDecorations?: boolean;

  // Special mode maps (e.g., battle simulator) - hidden from lobby selection
  isSpecialMode?: boolean;

  // Fog settings (optional - biome provides defaults)
  fogNear?: number;
  fogFar?: number;
}

// Helper to create a blank terrain grid
export function createTerrainGrid(
  width: number,
  height: number,
  defaultTerrain: TerrainType = 'ground',
  defaultElevation: Elevation = ELEVATION_MID,
  defaultFeature: TerrainFeature = 'none'
): MapCell[][] {
  const grid: MapCell[][] = [];

  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = {
        terrain: defaultTerrain,
        elevation: defaultElevation,
        feature: defaultFeature,
        textureId: Math.floor(Math.random() * 4), // Random texture variation
      };
    }
  }

  return grid;
}

// Standard resource amounts
export const MINERAL_NORMAL = 1500;  // Standard mineral patches
export const MINERAL_CLOSE = 900;    // Close/small mineral patches (2 per base)
export const MINERAL_GOLD = 900;     // Gold/rich mineral patches
export const GAS_NORMAL = 2250;      // Standard vespene geyser

// Helper to create mineral arc (8 patches in a crescent shape)
// The arc faces toward the base center
// mineralCenterX/Y: center of the mineral arc (should be ~7 units from CC center)
// baseCenterX/Y: position of the command center
// isGold: if true, all patches have 900 minerals (gold base)
export function createMineralLine(
  mineralCenterX: number,
  mineralCenterY: number,
  baseCenterX: number,
  baseCenterY: number,
  amount: number = MINERAL_NORMAL,
  isGold: boolean = false
): ResourceNode[] {
  const minerals: ResourceNode[] = [];

  // 8 mineral patches in a tight arc formation
  const arcRadius = 3.5; // Distance from arc center to patches (tighter arc)
  const arcSpread = Math.PI * 0.65; // ~117 degrees total arc spread

  // Calculate angle from mineral center toward base center
  const dx = baseCenterX - mineralCenterX;
  const dy = baseCenterY - mineralCenterY;
  const angleToBase = Math.atan2(dy, dx);

  for (let i = 0; i < 8; i++) {
    // Distribute patches along the arc, facing the base
    const t = (i - 3.5) / 3.5; // -1 to 1, centered
    const angle = angleToBase + t * (arcSpread / 2);

    // Alternate rows for depth - closer patches are even indices
    const radiusVariation = (i % 2 === 0) ? 0 : 0.8;
    const r = arcRadius + radiusVariation;

    // Position relative to mineral center, patches curve AWAY from base
    const x = mineralCenterX - Math.cos(angle) * r;
    const y = mineralCenterY - Math.sin(angle) * r;

    // Gold bases have all 900, regular bases have 6x normal + 2x 900 (close patches)
    let patchAmount: number;
    if (isGold) {
      patchAmount = MINERAL_GOLD;
    } else {
      patchAmount = i < 6 ? amount : MINERAL_CLOSE;
    }

    minerals.push({
      x: Math.round(x * 2) / 2, // Snap to 0.5 grid
      y: Math.round(y * 2) / 2,
      type: 'minerals',
      amount: patchAmount,
    });
  }

  return minerals;
}

// Legacy helper with direction parameter (backwards compatibility)
export function createMineralLineOld(
  baseX: number,
  baseY: number,
  direction: 'horizontal' | 'vertical' = 'horizontal',
  amount: number = 1500
): ResourceNode[] {
  // Convert old API to new: assume base is ~10 units away in the direction
  const offsetX = direction === 'horizontal' ? -10 : 0;
  const offsetY = direction === 'vertical' ? -10 : 0;
  return createMineralLine(baseX, baseY, baseX + offsetX, baseY + offsetY, amount);
}

// Helper to create vespene geysers (typically 2 per base)
// Places geysers at the ends of the mineral arc, forming a continuous crescent
// mineralCenterX/Y: center of the mineral arc
// baseCenterX/Y: position of the command center
export function createVespeneGeysers(
  mineralCenterX: number,
  mineralCenterY: number,
  baseCenterX: number,
  baseCenterY: number,
  amount: number = 2250
): ResourceNode[] {
  // Calculate angle from mineral center toward base center
  const dx = baseCenterX - mineralCenterX;
  const dy = baseCenterY - mineralCenterY;
  const angleToBase = Math.atan2(dy, dx);

  // Match mineral arc parameters from createMineralLine
  const arcRadius = 3.5; // Same base radius as minerals
  const arcSpread = Math.PI * 0.65; // ~117 degrees total arc spread

  // Place geysers further from minerals for cleaner base layout
  // Mineral arc ends at ±(arcSpread/2) = ±58.5 degrees
  // Place geysers at ±75 degrees with more distance from mineral center
  const geyserAngleOffset = (arcSpread / 2) + Math.PI * 0.09; // ~75 degrees from center
  const geyserRadius = arcRadius + 3.0; // Significantly further out than minerals

  // Calculate geyser positions - at the ends of the mineral arc, curving away from base
  const geyser1Angle = angleToBase + geyserAngleOffset;
  const geyser2Angle = angleToBase - geyserAngleOffset;

  return [
    {
      x: Math.round((mineralCenterX - Math.cos(geyser1Angle) * geyserRadius) * 2) / 2,
      y: Math.round((mineralCenterY - Math.sin(geyser1Angle) * geyserRadius) * 2) / 2,
      type: 'vespene',
      amount,
    },
    {
      x: Math.round((mineralCenterX - Math.cos(geyser2Angle) * geyserRadius) * 2) / 2,
      y: Math.round((mineralCenterY - Math.sin(geyser2Angle) * geyserRadius) * 2) / 2,
      type: 'vespene',
      amount,
    },
  ];
}

// STANDARD mineral distance from CC
const MINERAL_DISTANCE = 7; // 7 units from CC center to mineral arc center
// Natural expansions place minerals further to keep ramp paths clear
export const MINERAL_DISTANCE_NATURAL = 10;

/**
 * Create minerals and geysers for a base at standardized distance.
 * This ensures uniform resource placement across all maps.
 *
 * @param baseX - X position of the command center
 * @param baseY - Y position of the command center
 * @param direction - Angle in radians where minerals face (0 = right, PI/2 = down, PI = left, -PI/2 = up)
 * @param mineralAmount - Amount per normal mineral patch (default 1500, close patches always 900)
 * @param gasAmount - Amount per geyser (default 2250)
 * @param isGold - If true, all mineral patches have 900 minerals (gold/rich base)
 * @param mineralDistance - Distance from base center to mineral arc center (default 7, use MINERAL_DISTANCE_NATURAL=10 for naturals)
 */
export function createBaseResources(
  baseX: number,
  baseY: number,
  direction: number,
  mineralAmount: number = MINERAL_NORMAL,
  gasAmount: number = GAS_NORMAL,
  isGold: boolean = false,
  mineralDistance: number = MINERAL_DISTANCE
): { minerals: ResourceNode[]; vespene: ResourceNode[] } {
  // Place mineral center at specified distance from base
  const mineralCenterX = baseX + Math.cos(direction) * mineralDistance;
  const mineralCenterY = baseY + Math.sin(direction) * mineralDistance;

  return {
    minerals: createMineralLine(mineralCenterX, mineralCenterY, baseX, baseY, mineralAmount, isGold),
    vespene: createVespeneGeysers(mineralCenterX, mineralCenterY, baseX, baseY, gasAmount),
  };
}

// Helper directions for createBaseResources
export const DIR = {
  UP: -Math.PI / 2,
  DOWN: Math.PI / 2,
  LEFT: Math.PI,
  RIGHT: 0,
  UP_LEFT: -Math.PI * 3 / 4,
  UP_RIGHT: -Math.PI / 4,
  DOWN_LEFT: Math.PI * 3 / 4,
  DOWN_RIGHT: Math.PI / 4,
};

// Helper to fill a rectangular area with a terrain type
// PROTECTED: Will not overwrite ramps (critical for navmesh connectivity)
export function fillTerrainRect(
  grid: MapCell[][],
  x: number,
  y: number,
  width: number,
  height: number,
  terrain: TerrainType,
  elevation?: Elevation,
  feature?: TerrainFeature
): void {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const px = Math.floor(x + dx);
      const py = Math.floor(y + dy);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // PROTECT ramps - never overwrite them as this breaks navmesh connectivity
        if (grid[py][px].terrain === 'ramp') {
          continue;
        }

        grid[py][px].terrain = terrain;
        if (elevation !== undefined) {
          grid[py][px].elevation = elevation;
        }
        if (feature !== undefined) {
          grid[py][px].feature = feature;
        }
      }
    }
  }
}

// Helper to create circular terrain area
// PROTECTED: Will not overwrite ramps (critical for navmesh connectivity)
export function fillTerrainCircle(
  grid: MapCell[][],
  centerX: number,
  centerY: number,
  radius: number,
  terrain: TerrainType,
  elevation?: Elevation,
  feature?: TerrainFeature
): void {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) {
        const px = Math.floor(centerX + x);
        const py = Math.floor(centerY + y);

        if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
          // PROTECT ramps - never overwrite them as this breaks navmesh connectivity
          if (grid[py][px].terrain === 'ramp') {
            continue;
          }

          grid[py][px].terrain = terrain;
          if (elevation !== undefined) {
            grid[py][px].elevation = elevation;
          }
          if (feature !== undefined) {
            grid[py][px].feature = feature;
          }
        }
      }
    }
  }
}

// Helper to create a ramp in the terrain with proper elevation gradient
export function createRampInTerrain(
  grid: MapCell[][],
  ramp: Ramp
): void {
  const { x, y, width, height, direction, fromElevation, toElevation } = ramp;

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const px = Math.floor(x + dx);
      const py = Math.floor(y + dy);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // Calculate elevation gradient based on direction
        // t=0 is fromElevation, t=1 is toElevation
        let t = 0;
        switch (direction) {
          case 'north':
            t = 1 - dy / (height - 1);
            break;
          case 'south':
            t = dy / (height - 1);
            break;
          case 'east':
            t = 1 - dx / (width - 1);
            break;
          case 'west':
            t = dx / (width - 1);
            break;
        }

        // Linear interpolation for straight ramps
        const elevationValue = fromElevation + (toElevation - fromElevation) * t;

        grid[py][px] = {
          terrain: 'ramp',
          elevation: Math.round(elevationValue),
          feature: 'none',
          textureId: Math.floor(Math.random() * 4),
        };
      }
    }
  }
}

/**
 * Create a raised platform (base/expansion) with cliff edges.
 * Units can't walk up the edges, only through ramps.
 *
 * @param grid - The terrain grid
 * @param centerX - Center X of the platform
 * @param centerY - Center Y of the platform
 * @param radius - Radius of the buildable area
 * @param elevation - Elevation value (0-255, use ELEVATION_LOW/MID/HIGH constants)
 * @param cliffWidth - Width of the cliff ring around the platform (default 3)
 */
export function createRaisedPlatform(
  grid: MapCell[][],
  centerX: number,
  centerY: number,
  radius: number,
  elevation: Elevation,
  cliffWidth: number = 3
): void {
  const outerRadius = radius + cliffWidth;

  for (let dy = -outerRadius; dy <= outerRadius; dy++) {
    for (let dx = -outerRadius; dx <= outerRadius; dx++) {
      const dist = distance(0, 0, dx, dy);
      const px = Math.floor(centerX + dx);
      const py = Math.floor(centerY + dy);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // Skip if this is already a ramp (ramps should be created first)
        if (grid[py][px].terrain === 'ramp') {
          continue;
        }

        if (dist <= radius) {
          // Inner buildable area
          grid[py][px] = {
            terrain: 'ground',
            elevation: elevation,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        } else if (dist <= outerRadius) {
          // Cliff ring - but skip near ramps (buffer must be >= cliff width to ensure gap)
          if (!isRampOrNearRamp(grid, px, py, cliffWidth + 1)) {
            grid[py][px] = {
              terrain: 'unwalkable',
              elevation: elevation,
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
 * Create a raised rectangular platform with cliff edges.
 * Useful for bases that need non-circular shapes.
 * @param elevation - Elevation value (0-255, use ELEVATION_LOW/MID/HIGH constants)
 */
export function createRaisedRect(
  grid: MapCell[][],
  x: number,
  y: number,
  width: number,
  height: number,
  elevation: Elevation,
  cliffWidth: number = 3
): void {

  // Create outer cliff ring first
  for (let dy = -cliffWidth; dy < height + cliffWidth; dy++) {
    for (let dx = -cliffWidth; dx < width + cliffWidth; dx++) {
      const px = Math.floor(x + dx);
      const py = Math.floor(y + dy);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // Skip if this is already a ramp
        if (grid[py][px].terrain === 'ramp') {
          continue;
        }

        const isInner = dx >= 0 && dx < width && dy >= 0 && dy < height;
        const isOuter = !isInner;

        if (isInner) {
          // Inner buildable area
          grid[py][px] = {
            terrain: 'ground',
            elevation: elevation,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        } else if (isOuter && !isRampOrNearRamp(grid, px, py, cliffWidth + 1)) {
          // Cliff edge - buffer must be >= cliff width to ensure gap for ramps
          grid[py][px] = {
            terrain: 'unwalkable',
            elevation: elevation,
            feature: 'cliff',
            textureId: Math.floor(Math.random() * 4),
          };
        }
      }
    }
  }
}

// ============================================
// NEW TERRAIN FEATURE HELPERS
// ============================================

/**
 * Check if a cell is a ramp or near a ramp (protected area)
 */
function isRampOrNearRamp(grid: MapCell[][], x: number, y: number, buffer: number = 2): boolean {
  for (let dy = -buffer; dy <= buffer; dy++) {
    for (let dx = -buffer; dx <= buffer; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        if (grid[py][px].terrain === 'ramp') {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Fill a rectangular area with a terrain feature (preserves terrain type and elevation)
 * PROTECTED: Will not overwrite ramps or areas near ramps
 */
export function fillFeatureRect(
  grid: MapCell[][],
  x: number,
  y: number,
  width: number,
  height: number,
  feature: TerrainFeature
): void {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const px = Math.floor(x + dx);
      const py = Math.floor(y + dy);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // PROTECT ramps and areas near ramps
        if (grid[py][px].terrain === 'ramp' || isRampOrNearRamp(grid, px, py, 3)) {
          continue;
        }

        grid[py][px].feature = feature;
        // Water and void features also affect terrain type
        if (feature === 'water_deep' || feature === 'void') {
          grid[py][px].terrain = 'unwalkable';
        } else if (feature !== 'none' && feature !== 'road') {
          grid[py][px].terrain = 'unbuildable';
        }
      }
    }
  }
}

/**
 * Fill a circular area with a terrain feature
 * PROTECTED: Will not overwrite ramps or areas near ramps
 */
export function fillFeatureCircle(
  grid: MapCell[][],
  centerX: number,
  centerY: number,
  radius: number,
  feature: TerrainFeature
): void {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) {
        const px = Math.floor(centerX + x);
        const py = Math.floor(centerY + y);

        if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
          // PROTECT ramps and areas near ramps
          if (grid[py][px].terrain === 'ramp' || isRampOrNearRamp(grid, px, py, 3)) {
            continue;
          }

          grid[py][px].feature = feature;
          // Water and void features also affect terrain type
          if (feature === 'water_deep' || feature === 'void') {
            grid[py][px].terrain = 'unwalkable';
          } else if (feature !== 'none' && feature !== 'road') {
            grid[py][px].terrain = 'unbuildable';
          }
        }
      }
    }
  }
}

/**
 * Minimum elevation difference to create a cliff edge (units 0-255)
 */
export const CLIFF_THRESHOLD = 40;

// ============================================
// TERRAIN CONNECTIVITY VALIDATION
// ============================================

/**
 * Result of terrain connectivity validation
 */
export interface ConnectivityValidation {
  isValid: boolean;
  connectedRegions: number;
  unreachableLocations: Array<{ name: string; x: number; y: number }>;
  warnings: string[];
}

/**
 * Check if a cell is walkable (considering terrain type and features)
 */
function isCellWalkable(cell: MapCell): boolean {
  if (cell.terrain === 'unwalkable') return false;
  // Platform terrain is walkable (flat surface with cliff edges)
  if (cell.terrain === 'platform') return true;

  const feature = cell.feature || 'none';
  const config = TERRAIN_FEATURE_CONFIG[feature];
  return config.walkable;
}

/**
 * Flood fill to find all cells connected to a starting point.
 * Returns a Set of cell indices (y * width + x) that are reachable.
 */
function floodFill(
  grid: MapCell[][],
  startX: number,
  startY: number,
  width: number,
  height: number
): Set<number> {
  const visited = new Set<number>();
  const queue: Array<{ x: number; y: number }> = [];

  // Clamp start position to grid
  const sx = clamp(Math.floor(startX), 0, width - 1);
  const sy = clamp(Math.floor(startY), 0, height - 1);

  // Check if start is walkable
  if (!isCellWalkable(grid[sy][sx])) {
    // Try to find a nearby walkable cell
    for (let r = 1; r <= 5; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = sx + dx;
          const ny = sy + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (isCellWalkable(grid[ny][nx])) {
              queue.push({ x: nx, y: ny });
              visited.add(ny * width + nx);
              break;
            }
          }
        }
        if (queue.length > 0) break;
      }
      if (queue.length > 0) break;
    }
  } else {
    queue.push({ x: sx, y: sy });
    visited.add(sy * width + sx);
  }

  // 8-directional flood fill
  const directions = [
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
    { dx: -1, dy: -1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const { dx, dy } of directions) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const idx = ny * width + nx;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited.has(idx)) {
        if (isCellWalkable(grid[ny][nx])) {
          visited.add(idx);
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }

  return visited;
}

/**
 * Validate that all important locations on a map are connected.
 * This includes spawn points, expansions, watch towers, and ramp endpoints.
 */
export function validateMapConnectivity(mapData: MapData): ConnectivityValidation {
  const { width, height, terrain, spawns, expansions, watchTowers, ramps } = mapData;
  const warnings: string[] = [];
  const unreachableLocations: Array<{ name: string; x: number; y: number }> = [];

  // Collect all important locations that should be reachable
  const locations: Array<{ name: string; x: number; y: number }> = [];

  // Add spawn points
  for (const spawn of spawns) {
    locations.push({ name: `Spawn ${spawn.playerSlot}`, x: spawn.x, y: spawn.y });
  }

  // Add expansion locations
  for (const exp of expansions) {
    locations.push({ name: exp.name, x: exp.x, y: exp.y });
  }

  // Add watch towers
  for (let i = 0; i < watchTowers.length; i++) {
    locations.push({ name: `Watch Tower ${i + 1}`, x: watchTowers[i].x, y: watchTowers[i].y });
  }

  // Add ramp endpoints
  for (let i = 0; i < ramps.length; i++) {
    const ramp = ramps[i];
    const cx = ramp.x + ramp.width / 2;
    const cy = ramp.y + ramp.height / 2;
    locations.push({ name: `Ramp ${i + 1}`, x: cx, y: cy });
  }

  if (locations.length === 0) {
    return {
      isValid: true,
      connectedRegions: 0,
      unreachableLocations: [],
      warnings: ['No locations to validate'],
    };
  }

  // Flood fill from the first spawn point
  const firstLocation = locations[0];
  const reachable = floodFill(terrain, firstLocation.x, firstLocation.y, width, height);

  if (reachable.size === 0) {
    warnings.push(`Starting location ${firstLocation.name} is not on walkable terrain`);
  }

  // Check which locations are reachable
  let _connectedCount = 0;
  for (const loc of locations) {
    const lx = clamp(Math.floor(loc.x), 0, width - 1);
    const ly = clamp(Math.floor(loc.y), 0, height - 1);
    const idx = ly * width + lx;

    // Check if location itself or nearby cells are reachable
    let isReachable = reachable.has(idx);

    // If not directly reachable, check nearby cells (radius 3)
    if (!isReachable) {
      outer: for (let r = 1; r <= 3; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = lx + dx;
            const ny = ly + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              if (reachable.has(ny * width + nx)) {
                isReachable = true;
                break outer;
              }
            }
          }
        }
      }
    }

    if (isReachable) {
      _connectedCount++;
    } else {
      unreachableLocations.push(loc);
    }
  }

  // Calculate number of separate connected regions
  const allWalkable = new Set<number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isCellWalkable(terrain[y][x])) {
        allWalkable.add(y * width + x);
      }
    }
  }

  let connectedRegions = 0;
  const counted = new Set<number>();
  for (const idx of allWalkable) {
    if (!counted.has(idx)) {
      const y = Math.floor(idx / width);
      const x = idx % width;
      const region = floodFill(terrain, x, y, width, height);
      if (region.size > 10) { // Only count regions larger than 10 cells
        connectedRegions++;
        for (const cellIdx of region) {
          counted.add(cellIdx);
        }
      }
    }
  }

  // Add warnings for issues found
  if (unreachableLocations.length > 0) {
    warnings.push(`${unreachableLocations.length} location(s) are not reachable from Spawn 1`);
    for (const loc of unreachableLocations) {
      warnings.push(`  - ${loc.name} at (${Math.floor(loc.x)}, ${Math.floor(loc.y)})`);
    }
  }

  if (connectedRegions > 1) {
    warnings.push(`Map has ${connectedRegions} separate walkable regions (only matters if important locations are affected)`);
  }

  // IMPORTANT: Map is valid if all important locations are reachable from each other.
  // Multiple disconnected walkable regions are OK as long as spawns/expansions/towers are connected.
  return {
    isValid: unreachableLocations.length === 0,
    connectedRegions,
    unreachableLocations,
    warnings,
  };
}

/**
 * Ensure a path exists between two points by carving a corridor if needed.
 * This is a last-resort fix for maps with connectivity issues.
 * PROTECTED: Will not overwrite ramps.
 */
export function ensurePathBetween(
  grid: MapCell[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  corridorWidth: number = 4,
  elevation: Elevation = 140
): boolean {
  const width = grid[0].length;
  const height = grid.length;

  // First check if path already exists
  const startReachable = floodFill(grid, x1, y1, width, height);
  const endX = clamp(Math.floor(x2), 0, width - 1);
  const endY = clamp(Math.floor(y2), 0, height - 1);
  const endIdx = endY * width + endX;

  if (startReachable.has(endIdx)) {
    return true; // Already connected
  }

  // Carve a straight corridor between points
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = distance(x1, y1, x2, y2);
  const steps = Math.ceil(dist);

  // Perpendicular direction for corridor width
  const perpX = -dy / dist;
  const perpY = dx / dist;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;

    for (let w = -corridorWidth / 2; w <= corridorWidth / 2; w++) {
      const px = Math.floor(cx + perpX * w);
      const py = Math.floor(cy + perpY * w);

      if (px >= 0 && px < width && py >= 0 && py < height) {
        // Don't overwrite ramps
        if (grid[py][px].terrain === 'ramp') continue;

        grid[py][px] = {
          terrain: 'ground',
          elevation: elevation,
          feature: 'none',
          textureId: Math.floor(Math.random() * 4),
        };
      }
    }
  }

  return true;
}

/**
 * Auto-fix connectivity issues by ensuring all spawns and expansions are connected.
 * Returns the number of corridors carved.
 */
export function autoFixConnectivity(mapData: MapData): number {
  const { terrain, spawns, expansions } = mapData;
  const width = terrain[0].length;
  const height = terrain.length;
  let corridorsCarved = 0;

  // Get all locations that should be connected
  const locations: Array<{ x: number; y: number }> = [];

  for (const spawn of spawns) {
    locations.push({ x: spawn.x, y: spawn.y });
  }
  for (const exp of expansions) {
    locations.push({ x: exp.x, y: exp.y });
  }

  if (locations.length < 2) return 0;

  // Ensure first spawn can reach all other locations
  const baseLocation = locations[0];

  for (let i = 1; i < locations.length; i++) {
    const target = locations[i];

    // Check if already reachable
    const reachable = floodFill(terrain, baseLocation.x, baseLocation.y, width, height);
    const tx = clamp(Math.floor(target.x), 0, width - 1);
    const ty = clamp(Math.floor(target.y), 0, height - 1);

    let isReachable = reachable.has(ty * width + tx);
    if (!isReachable) {
      // Check nearby cells
      for (let r = 1; r <= 5 && !isReachable; r++) {
        for (let dy = -r; dy <= r && !isReachable; dy++) {
          for (let dx = -r; dx <= r && !isReachable; dx++) {
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              if (reachable.has(ny * width + nx)) {
                isReachable = true;
              }
            }
          }
        }
      }
    }

    if (!isReachable) {
      // Find the closest reachable cell to the target
      let closestReachable: { x: number; y: number } | null = null;
      let closestDist = Infinity;

      for (const idx of reachable) {
        const ry = Math.floor(idx / width);
        const rx = idx % width;
        const d = distance(rx, ry, tx, ty);
        if (d < closestDist) {
          closestDist = d;
          closestReachable = { x: rx, y: ry };
        }
      }

      if (closestReachable) {
        ensurePathBetween(terrain, closestReachable.x, closestReachable.y, target.x, target.y);
        corridorsCarved++;
      }
    }
  }

  return corridorsCarved;
}


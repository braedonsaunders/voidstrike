// Map data structures for SC2-style maps
// Enhanced terrain system with 256 height levels and terrain features

import { BiomeType } from '@/rendering/Biomes';

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
 * Elevation now uses 0-255 range (like SC2) for smooth terrain.
 * Gameplay zones for high-ground advantage:
 * - Low ground: 0-85
 * - Mid ground: 86-170
 * - High ground: 171-255
 */
export type Elevation = number; // 0-255

/**
 * Legacy elevation levels for backwards compatibility with ramps
 */
export type ElevationLevel = 0 | 1 | 2;

/**
 * Convert legacy 0-2 elevation to 0-255 scale
 */
export function legacyElevationTo256(level: ElevationLevel): Elevation {
  const mapping: Record<ElevationLevel, Elevation> = {
    0: 60,   // Low ground
    1: 140,  // Mid ground
    2: 220,  // High ground
  };
  return mapping[level];
}

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

  // Attacking from lower ground has miss chance (like SC2)
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
  fromElevation: ElevationLevel;
  toElevation: ElevationLevel;
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

  // Legacy visual settings (deprecated - use biome instead)
  skyboxColor?: string;
  ambientColor?: string;
  sunColor?: string;
  fogColor?: string;
  fogNear?: number;
  fogFar?: number;
}

// Helper to create a blank terrain grid
export function createTerrainGrid(
  width: number,
  height: number,
  defaultTerrain: TerrainType = 'ground',
  defaultElevation: ElevationLevel | Elevation = 1,
  defaultFeature: TerrainFeature = 'none'
): MapCell[][] {
  const grid: MapCell[][] = [];

  // Convert legacy elevation if needed
  const elevation256 = typeof defaultElevation === 'number' && defaultElevation <= 2
    ? legacyElevationTo256(defaultElevation as ElevationLevel)
    : defaultElevation as Elevation;

  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = {
        terrain: defaultTerrain,
        elevation: elevation256,
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

    // Alternate rows for depth (like SC2) - closer patches are even indices
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

// STANDARD mineral distance from CC (SC2-style)
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
  elevation?: ElevationLevel | Elevation,
  feature?: TerrainFeature
): void {
  // Convert legacy elevation if provided
  const elevation256 = elevation !== undefined
    ? (elevation <= 2 ? legacyElevationTo256(elevation as ElevationLevel) : elevation)
    : undefined;

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
        if (elevation256 !== undefined) {
          grid[py][px].elevation = elevation256;
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
  elevation?: ElevationLevel | Elevation,
  feature?: TerrainFeature
): void {
  // Convert legacy elevation if provided
  const elevation256 = elevation !== undefined
    ? (elevation <= 2 ? legacyElevationTo256(elevation as ElevationLevel) : elevation)
    : undefined;

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
          if (elevation256 !== undefined) {
            grid[py][px].elevation = elevation256;
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

  // Convert legacy elevations to 256 scale
  const fromElev256 = legacyElevationTo256(fromElevation);
  const toElev256 = legacyElevationTo256(toElevation);

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

        // LINEAR interpolation for STRAIGHT ramps - no curves, just a clean slope
        // This creates a straight line from top to bottom
        const elevationValue = fromElev256 + (toElev256 - fromElev256) * t;

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
 * SC2-style: units can't walk up the edges, only through ramps.
 *
 * @param grid - The terrain grid
 * @param centerX - Center X of the platform
 * @param centerY - Center Y of the platform
 * @param radius - Radius of the buildable area
 * @param elevation - Elevation level (0, 1, or 2)
 * @param cliffWidth - Width of the cliff ring around the platform (default 3)
 */
export function createRaisedPlatform(
  grid: MapCell[][],
  centerX: number,
  centerY: number,
  radius: number,
  elevation: ElevationLevel,
  cliffWidth: number = 3
): void {
  const elevation256 = legacyElevationTo256(elevation);
  const outerRadius = radius + cliffWidth;

  for (let dy = -outerRadius; dy <= outerRadius; dy++) {
    for (let dx = -outerRadius; dx <= outerRadius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
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
            elevation: elevation256,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        } else if (dist <= outerRadius) {
          // Cliff ring - but skip near ramps (buffer must be >= cliff width to ensure gap)
          if (!isRampOrNearRamp(grid, px, py, cliffWidth + 1)) {
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
 * Create a raised rectangular platform with cliff edges.
 * Useful for bases that need non-circular shapes.
 */
export function createRaisedRect(
  grid: MapCell[][],
  x: number,
  y: number,
  width: number,
  height: number,
  elevation: ElevationLevel,
  cliffWidth: number = 3
): void {
  const elevation256 = legacyElevationTo256(elevation);

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
            elevation: elevation256,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        } else if (isOuter && !isRampOrNearRamp(grid, px, py, cliffWidth + 1)) {
          // Cliff edge - buffer must be >= cliff width to ensure gap for ramps
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
 * Create a forest corridor between two points
 * @param width - Total width of the corridor (path in center, trees on sides)
 * @param pathWidth - Width of the clear path in the middle
 * @param denseEdges - If true, outer edges are dense forest
 */
export function createForestCorridor(
  grid: MapCell[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number = 20,
  pathWidth: number = 8,
  denseEdges: boolean = true
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(length);

  // Perpendicular direction for width
  const perpX = -dy / length;
  const perpY = dx / length;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;

    for (let w = -width / 2; w <= width / 2; w++) {
      const px = Math.floor(cx + perpX * w);
      const py = Math.floor(cy + perpY * w);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // PROTECT ramps and areas near ramps
        if (grid[py][px].terrain === 'ramp' || isRampOrNearRamp(grid, px, py, 3)) {
          continue;
        }

        const absW = Math.abs(w);

        if (absW <= pathWidth / 2) {
          // Clear path in center - road for faster movement
          grid[py][px].feature = 'road';
          grid[py][px].terrain = 'unbuildable';
        } else if (denseEdges && absW > width / 2 - 3) {
          // Dense forest on outer edges
          grid[py][px].feature = 'forest_dense';
          grid[py][px].terrain = 'unbuildable';
        } else {
          // Light forest in between
          grid[py][px].feature = 'forest_light';
          grid[py][px].terrain = 'unbuildable';
        }
      }
    }
  }
}

/**
 * Create a river/water body with optional bridge crossing
 */
export function createRiver(
  grid: MapCell[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number = 8,
  bridgePosition?: number, // 0-1 position along river for bridge
  bridgeWidth: number = 6
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(length);

  const perpX = -dy / length;
  const perpY = dx / length;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;

    // Check if this is the bridge position
    const isBridge = bridgePosition !== undefined &&
      Math.abs(t - bridgePosition) < (bridgeWidth / 2) / length;

    for (let w = -width / 2; w <= width / 2; w++) {
      const px = Math.floor(cx + perpX * w);
      const py = Math.floor(cy + perpY * w);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // PROTECT ramps and areas near ramps
        if (grid[py][px].terrain === 'ramp' || isRampOrNearRamp(grid, px, py, 3)) {
          continue;
        }

        const absW = Math.abs(w);

        if (isBridge) {
          // Bridge crossing - walkable path
          grid[py][px].feature = 'road';
          grid[py][px].terrain = 'unbuildable';
        } else if (absW <= width / 4) {
          // Deep water in center
          grid[py][px].feature = 'water_deep';
          grid[py][px].terrain = 'unwalkable';
        } else {
          // Shallow water on edges
          grid[py][px].feature = 'water_shallow';
          grid[py][px].terrain = 'unbuildable';
        }
      }
    }
  }
}

/**
 * Create a lake (circular water body)
 */
export function createLake(
  grid: MapCell[][],
  centerX: number,
  centerY: number,
  radius: number,
  shallowEdgeWidth: number = 3
): void {
  for (let y = -radius - shallowEdgeWidth; y <= radius + shallowEdgeWidth; y++) {
    for (let x = -radius - shallowEdgeWidth; x <= radius + shallowEdgeWidth; x++) {
      const dist = Math.sqrt(x * x + y * y);
      const px = Math.floor(centerX + x);
      const py = Math.floor(centerY + y);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // PROTECT ramps and areas near ramps
        if (grid[py][px].terrain === 'ramp' || isRampOrNearRamp(grid, px, py, 3)) {
          continue;
        }

        if (dist <= radius) {
          // Deep water in center
          grid[py][px].feature = 'water_deep';
          grid[py][px].terrain = 'unwalkable';
        } else if (dist <= radius + shallowEdgeWidth) {
          // Shallow water around edges
          grid[py][px].feature = 'water_shallow';
          grid[py][px].terrain = 'unbuildable';
        }
      }
    }
  }
}

/**
 * Create a void chasm (impassable area at map edges or between terrain)
 * PROTECTED: Will not overwrite ramps or areas near ramps
 */
export function createVoidChasm(
  grid: MapCell[][],
  x: number,
  y: number,
  width: number,
  height: number,
  edgeWidth: number = 2
): void {
  for (let dy = -edgeWidth; dy < height + edgeWidth; dy++) {
    for (let dx = -edgeWidth; dx < width + edgeWidth; dx++) {
      const px = Math.floor(x + dx);
      const py = Math.floor(y + dy);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // PROTECT ramps and areas near ramps
        if (grid[py][px].terrain === 'ramp' || isRampOrNearRamp(grid, px, py, 3)) {
          continue;
        }

        const isEdge = dx < 0 || dx >= width || dy < 0 || dy >= height;

        if (isEdge) {
          // Cliff edges around void
          grid[py][px].feature = 'cliff';
          grid[py][px].terrain = 'unwalkable';
        } else {
          // Void in center
          grid[py][px].feature = 'void';
          grid[py][px].terrain = 'unwalkable';
          grid[py][px].elevation = 0; // Lowest point
        }
      }
    }
  }
}

/**
 * Create a mud/swamp area
 */
export function createMudArea(
  grid: MapCell[][],
  centerX: number,
  centerY: number,
  radius: number
): void {
  fillFeatureCircle(grid, centerX, centerY, radius, 'mud');
}

/**
 * Create a road path between two points
 * PROTECTED: Will not overwrite ramps or areas near ramps
 */
export function createRoad(
  grid: MapCell[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number = 4
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(length);

  const perpX = -dy / length;
  const perpY = dx / length;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;

    for (let w = -width / 2; w <= width / 2; w++) {
      const px = Math.floor(cx + perpX * w);
      const py = Math.floor(cy + perpY * w);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // PROTECT ramps and areas near ramps
        if (grid[py][px].terrain === 'ramp' || isRampOrNearRamp(grid, px, py, 3)) {
          continue;
        }

        // Only apply to walkable terrain (don't overwrite cliffs/water)
        if (grid[py][px].terrain === 'ground' || grid[py][px].terrain === 'unbuildable') {
          grid[py][px].feature = 'road';
          grid[py][px].terrain = 'unbuildable';
        }
      }
    }
  }
}

/**
 * Create forest patches around the map (avoids specified exclusion zones)
 */
export function scatterForests(
  grid: MapCell[][],
  mapWidth: number,
  mapHeight: number,
  count: number,
  minRadius: number,
  maxRadius: number,
  exclusionZones: Array<{ x: number; y: number; radius: number }>,
  seed: number = 42,
  denseChance: number = 0.3
): void {
  // Simple seeded random
  const seededRand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let i = 0; i < count; i++) {
    // Try multiple times to find a valid position
    for (let attempt = 0; attempt < 10; attempt++) {
      const x = 15 + seededRand() * (mapWidth - 30);
      const y = 15 + seededRand() * (mapHeight - 30);
      const radius = minRadius + seededRand() * (maxRadius - minRadius);

      // Check exclusion zones
      let valid = true;
      for (const zone of exclusionZones) {
        const dx = x - zone.x;
        const dy = y - zone.y;
        if (Math.sqrt(dx * dx + dy * dy) < zone.radius + radius) {
          valid = false;
          break;
        }
      }

      if (valid) {
        const feature = seededRand() < denseChance ? 'forest_dense' : 'forest_light';
        fillFeatureCircle(grid, x, y, radius, feature);
        break;
      }
    }
  }
}

// ============================================
// SC2-STYLE GEOMETRIC PLATFORM HELPERS
// ============================================

/**
 * Standard platform elevation levels (quantized for clean vertical cliffs).
 * These map to specific heights for consistent cliff faces.
 */
export const PLATFORM_ELEVATION = {
  LOW: 60,    // Low platform level
  MID: 140,   // Mid platform level
  HIGH: 220,  // High platform level
} as const;

/**
 * Minimum elevation difference to create a cliff edge (units 0-255)
 */
export const CLIFF_THRESHOLD = 40;

/**
 * Quantize an elevation value to the nearest platform level.
 * Used when converting natural terrain to platform.
 */
export function quantizeToPlatformElevation(elevation: Elevation): Elevation {
  if (elevation < 100) return PLATFORM_ELEVATION.LOW;
  if (elevation < 180) return PLATFORM_ELEVATION.MID;
  return PLATFORM_ELEVATION.HIGH;
}

/**
 * Create a geometric platform (SC2-style) with flat surface and vertical cliff edges.
 * Unlike createRaisedPlatform (natural terrain), this uses terrain: 'platform'
 * which renders with vertical cliff faces instead of smooth slopes.
 *
 * @param grid - The terrain grid
 * @param centerX - Center X of the platform
 * @param centerY - Center Y of the platform
 * @param radius - Radius of the platform
 * @param elevation - Platform elevation (will be quantized)
 */
export function createGeometricPlatform(
  grid: MapCell[][],
  centerX: number,
  centerY: number,
  radius: number,
  elevation: Elevation
): void {
  const quantizedElev = quantizeToPlatformElevation(elevation);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        const px = Math.floor(centerX + dx);
        const py = Math.floor(centerY + dy);

        if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
          // Don't overwrite ramps
          if (grid[py][px].terrain === 'ramp') continue;

          grid[py][px] = {
            terrain: 'platform',
            elevation: quantizedElev,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        }
      }
    }
  }
}

/**
 * Create a rectangular geometric platform (SC2-style).
 *
 * @param grid - The terrain grid
 * @param x - Top-left X
 * @param y - Top-left Y
 * @param width - Platform width
 * @param height - Platform height
 * @param elevation - Platform elevation (will be quantized)
 */
export function createGeometricPlatformRect(
  grid: MapCell[][],
  x: number,
  y: number,
  width: number,
  height: number,
  elevation: Elevation
): void {
  const quantizedElev = quantizeToPlatformElevation(elevation);

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const px = Math.floor(x + dx);
      const py = Math.floor(y + dy);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        // Don't overwrite ramps
        if (grid[py][px].terrain === 'ramp') continue;

        grid[py][px] = {
          terrain: 'platform',
          elevation: quantizedElev,
          feature: 'none',
          textureId: Math.floor(Math.random() * 4),
        };
      }
    }
  }
}

/**
 * Create a polygon-shaped geometric platform from vertices.
 * Vertices should be in clockwise or counter-clockwise order.
 * Uses scanline fill algorithm.
 *
 * @param grid - The terrain grid
 * @param vertices - Array of {x, y} vertices defining the polygon
 * @param elevation - Platform elevation (will be quantized)
 */
export function createGeometricPlatformPolygon(
  grid: MapCell[][],
  vertices: Array<{ x: number; y: number }>,
  elevation: Elevation
): void {
  if (vertices.length < 3) return;

  const quantizedElev = quantizeToPlatformElevation(elevation);

  // Find bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }

  // Scanline fill
  for (let py = Math.floor(minY); py <= Math.ceil(maxY); py++) {
    if (py < 0 || py >= grid.length) continue;

    // Find intersections with polygon edges
    const intersections: number[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];

      // Check if scanline crosses this edge
      if ((v1.y <= py && v2.y > py) || (v2.y <= py && v1.y > py)) {
        const t = (py - v1.y) / (v2.y - v1.y);
        intersections.push(v1.x + t * (v2.x - v1.x));
      }
    }

    // Sort intersections
    intersections.sort((a, b) => a - b);

    // Fill between pairs
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const startX = Math.floor(intersections[i]);
      const endX = Math.ceil(intersections[i + 1]);

      for (let px = startX; px <= endX; px++) {
        if (px < 0 || px >= grid[0].length) continue;

        // Don't overwrite ramps
        if (grid[py][px].terrain === 'ramp') continue;

        grid[py][px] = {
          terrain: 'platform',
          elevation: quantizedElev,
          feature: 'none',
          textureId: Math.floor(Math.random() * 4),
        };
      }
    }
  }
}

/**
 * Convert natural terrain cells to platform terrain.
 * Quantizes elevation and sets terrain type to 'platform'.
 *
 * @param grid - The terrain grid
 * @param cells - Array of {x, y} cells to convert
 */
export function convertToPlatform(
  grid: MapCell[][],
  cells: Array<{ x: number; y: number }>
): void {
  for (const { x, y } of cells) {
    if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) continue;
    if (grid[y][x].terrain === 'ramp') continue;

    const cell = grid[y][x];
    cell.terrain = 'platform';
    cell.elevation = quantizeToPlatformElevation(cell.elevation);
  }
}

/**
 * Set the edge style for a specific edge of a platform cell.
 *
 * @param grid - The terrain grid
 * @param x - Cell X
 * @param y - Cell Y
 * @param edge - Which edge to set
 * @param style - The edge style
 */
export function setPlatformEdgeStyle(
  grid: MapCell[][],
  x: number,
  y: number,
  edge: 'north' | 'south' | 'east' | 'west',
  style: PlatformEdgeStyle
): void {
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) return;

  const cell = grid[y][x];
  if (cell.terrain !== 'platform') return;

  if (!cell.edges) {
    cell.edges = {};
  }
  cell.edges[edge] = style;
}

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
  const sx = Math.max(0, Math.min(width - 1, Math.floor(startX)));
  const sy = Math.max(0, Math.min(height - 1, Math.floor(startY)));

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
  let connectedCount = 0;
  for (const loc of locations) {
    const lx = Math.max(0, Math.min(width - 1, Math.floor(loc.x)));
    const ly = Math.max(0, Math.min(height - 1, Math.floor(loc.y)));
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
      connectedCount++;
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
  const endX = Math.max(0, Math.min(width - 1, Math.floor(x2)));
  const endY = Math.max(0, Math.min(height - 1, Math.floor(y2)));
  const endIdx = endY * width + endX;

  if (startReachable.has(endIdx)) {
    return true; // Already connected
  }

  // Carve a straight corridor between points
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
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
    const tx = Math.max(0, Math.min(width - 1, Math.floor(target.x)));
    const ty = Math.max(0, Math.min(height - 1, Math.floor(target.y)));

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
        const d = Math.sqrt((rx - tx) * (rx - tx) + (ry - ty) * (ry - ty));
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


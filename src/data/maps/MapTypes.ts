// Map data structures for SC2-style maps
// Enhanced terrain system with 256 height levels and terrain features

import { BiomeType } from '@/rendering/Biomes';

export type TerrainType =
  | 'ground'      // Normal walkable terrain
  | 'unwalkable'  // Cliffs, deep water, void - completely impassable
  | 'ramp'        // Connects different elevations
  | 'unbuildable' // Walkable but can't place buildings
  | 'creep';      // Swarm creep (later)

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
 */
export function createBaseResources(
  baseX: number,
  baseY: number,
  direction: number,
  mineralAmount: number = MINERAL_NORMAL,
  gasAmount: number = GAS_NORMAL,
  isGold: boolean = false
): { minerals: ResourceNode[]; vespene: ResourceNode[] } {
  // Place mineral center at standard distance from base
  const mineralCenterX = baseX + Math.cos(direction) * MINERAL_DISTANCE;
  const mineralCenterY = baseY + Math.sin(direction) * MINERAL_DISTANCE;

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
        let t = 0;
        switch (direction) {
          case 'north':
            t = dy / (height - 1);
            break;
          case 'south':
            t = 1 - dy / (height - 1);
            break;
          case 'east':
            t = dx / (width - 1);
            break;
          case 'west':
            t = 1 - dx / (width - 1);
            break;
        }

        // Smooth interpolation using ease function for natural slope
        const smoothT = t * t * (3 - 2 * t); // smoothstep
        const elevationValue = fromElev256 + (toElev256 - fromElev256) * smoothT;

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

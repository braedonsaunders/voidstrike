// Map data structures for SC2-style maps

import { BiomeType } from '@/rendering/Biomes';

export type TerrainType =
  | 'ground'      // Normal walkable terrain
  | 'unwalkable'  // Cliffs, water, etc.
  | 'ramp'        // Connects different elevations
  | 'unbuildable' // Walkable but can't place buildings
  | 'creep';      // Swarm creep (later)

export type ElevationLevel = 0 | 1 | 2; // Low, medium, high ground

export interface MapCell {
  terrain: TerrainType;
  elevation: ElevationLevel;
  textureId: number; // For visual variety
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
  defaultElevation: ElevationLevel = 1
): MapCell[][] {
  const grid: MapCell[][] = [];

  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = {
        terrain: defaultTerrain,
        elevation: defaultElevation,
        textureId: Math.floor(Math.random() * 4), // Random texture variation
      };
    }
  }

  return grid;
}

// Helper to create SC2-style mineral arc (8 patches in a crescent shape)
// The arc faces toward the base center
// mineralCenterX/Y: center of the mineral arc (should be ~7 units from CC center)
// baseCenterX/Y: position of the command center
export function createMineralLine(
  mineralCenterX: number,
  mineralCenterY: number,
  baseCenterX: number,
  baseCenterY: number,
  amount: number = 1500
): ResourceNode[] {
  const minerals: ResourceNode[] = [];

  // SC2 has 8 mineral patches in a tight arc formation
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

    minerals.push({
      x: Math.round(x * 2) / 2, // Snap to 0.5 grid
      y: Math.round(y * 2) / 2,
      type: 'minerals',
      amount: i < 6 ? amount : amount * 0.5, // Last 2 patches are half (SC2 style)
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

// Helper to fill a rectangular area with a terrain type
export function fillTerrainRect(
  grid: MapCell[][],
  x: number,
  y: number,
  width: number,
  height: number,
  terrain: TerrainType,
  elevation?: ElevationLevel
): void {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const px = Math.floor(x + dx);
      const py = Math.floor(y + dy);

      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        grid[py][px].terrain = terrain;
        if (elevation !== undefined) {
          grid[py][px].elevation = elevation;
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
  elevation?: ElevationLevel
): void {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) {
        const px = Math.floor(centerX + x);
        const py = Math.floor(centerY + y);

        if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
          grid[py][px].terrain = terrain;
          if (elevation !== undefined) {
            grid[py][px].elevation = elevation;
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

        // Interpolate elevation and round to nearest valid level
        const elevationValue = fromElevation + (toElevation - fromElevation) * t;
        const roundedElevation = Math.round(elevationValue) as ElevationLevel;

        grid[py][px] = {
          terrain: 'ramp',
          elevation: roundedElevation,
          textureId: Math.floor(Math.random() * 4),
        };
      }
    }
  }
}

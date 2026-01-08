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

  // Metadata
  maxPlayers: number;
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
export function createMineralLine(
  baseX: number,
  baseY: number,
  direction: 'horizontal' | 'vertical' = 'horizontal',
  amount: number = 1500
): ResourceNode[] {
  const minerals: ResourceNode[] = [];

  // SC2 has 8 mineral patches in an arc formation
  // Patches are spaced about 2 units apart along the arc
  const arcRadius = 6; // Distance from arc center
  const arcSpread = Math.PI * 0.6; // ~108 degrees total arc spread

  // Determine arc center angle based on direction
  // Arc should face toward where the command center would be
  const centerAngle = direction === 'horizontal' ? Math.PI : Math.PI / 2;

  for (let i = 0; i < 8; i++) {
    // Distribute patches along the arc
    const t = (i - 3.5) / 3.5; // -1 to 1, centered
    const angle = centerAngle + t * (arcSpread / 2);

    // Add slight variation to make it look more natural
    const radiusVariation = (i % 2 === 0) ? 0 : 0.8; // Alternate rows
    const r = arcRadius + radiusVariation;

    const x = baseX + Math.cos(angle) * r;
    const y = baseY + Math.sin(angle) * r;

    minerals.push({
      x: Math.round(x * 2) / 2, // Snap to 0.5 grid
      y: Math.round(y * 2) / 2,
      type: 'minerals',
      amount: i < 6 ? amount : amount * 0.5, // Last 2 patches are gold
    });
  }

  return minerals;
}

// Legacy helper - creates straight line (kept for backwards compatibility)
export function createMineralLineOld(
  baseX: number,
  baseY: number,
  direction: 'horizontal' | 'vertical' = 'horizontal',
  amount: number = 1500
): ResourceNode[] {
  const minerals: ResourceNode[] = [];

  for (let i = 0; i < 8; i++) {
    const offset = (i % 4) * 2 + Math.floor(i / 4) * 1.5;
    minerals.push({
      x: direction === 'horizontal' ? baseX + offset : baseX + Math.floor(i / 4) * 1.5,
      y: direction === 'horizontal' ? baseY + Math.floor(i / 4) * 1.5 : baseY + offset,
      type: 'minerals',
      amount: i < 6 ? amount : amount * 0.5,
    });
  }

  return minerals;
}

// Helper to create vespene geysers (typically 2 per base)
export function createVespeneGeysers(
  baseX: number,
  baseY: number,
  spread: number = 8,
  amount: number = 2250
): ResourceNode[] {
  return [
    { x: baseX - spread / 2, y: baseY + spread / 2, type: 'vespene', amount },
    { x: baseX + spread / 2, y: baseY + spread / 2, type: 'vespene', amount },
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

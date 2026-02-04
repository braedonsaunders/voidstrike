/**
 * ElevationMap.ts - Paint-Based Elevation Map System
 *
 * A simple, powerful map system where:
 * - Elevation grid IS the terrain (cliffs emerge at height differences)
 * - Paint commands build the map (like Photoshop layers)
 * - Decoration rules create beauty automatically
 *
 * Mental model: Canvas + Paint Commands + Objects + Decoration Rules
 */

// ============================================================================
// BIOME TYPES
// ============================================================================

export type BiomeType =
  | 'grassland'
  | 'desert'
  | 'frozen'
  | 'volcanic'
  | 'void'
  | 'jungle'
  | 'ocean';

export interface BiomeTheme {
  biome: BiomeType;
  skyboxColor: string;
  ambientColor: string;
  sunColor: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
}

export const BIOME_THEMES: Record<BiomeType, BiomeTheme> = {
  grassland: {
    biome: 'grassland',
    skyboxColor: '#87CEEB',
    ambientColor: '#404060',
    sunColor: '#FFFAF0',
    fogColor: '#C8D8E8',
    fogNear: 120,
    fogFar: 300,
  },
  desert: {
    biome: 'desert',
    skyboxColor: '#E8D4A8',
    ambientColor: '#504030',
    sunColor: '#FFE4B0',
    fogColor: '#D4C4A0',
    fogNear: 100,
    fogFar: 280,
  },
  frozen: {
    biome: 'frozen',
    skyboxColor: '#0e1428',
    ambientColor: '#2a3050',
    sunColor: '#80b0ff',
    fogColor: '#1a2040',
    fogNear: 80,
    fogFar: 220,
  },
  volcanic: {
    biome: 'volcanic',
    skyboxColor: '#2A1A1A',
    ambientColor: '#401010',
    sunColor: '#FF6030',
    fogColor: '#301010',
    fogNear: 60,
    fogFar: 200,
  },
  void: {
    biome: 'void',
    skyboxColor: '#0a0a1e',
    ambientColor: '#303050',
    sunColor: '#ffe0b0',
    fogColor: '#1a1a2e',
    fogNear: 90,
    fogFar: 250,
  },
  jungle: {
    biome: 'jungle',
    skyboxColor: '#4A6A4A',
    ambientColor: '#203020',
    sunColor: '#FFE8C0',
    fogColor: '#304030',
    fogNear: 70,
    fogFar: 220,
  },
  ocean: {
    biome: 'ocean',
    skyboxColor: '#70B0D8',
    ambientColor: '#4060A0',
    sunColor: '#FFF8E8',
    fogColor: '#B0D0E8',
    fogNear: 100,
    fogFar: 350,
  },
};

// ============================================================================
// ELEVATION CONSTANTS
// ============================================================================

/** Standard elevation levels mapped to 0-255 range */
export const ELEVATION = {
  VOID: 0,        // Below terrain (chasms)
  WATER_DEEP: 10, // Deep water level (impassable)
  WATER_SHALLOW: 30, // Shallow water level (walkable but slow)
  LOW: 60,        // Ground level
  MID: 140,       // Natural expansion level
  HIGH: 220,      // Main base level
} as const;

/**
 * Quantize an elevation value to the nearest platform level.
 * Used for platform tools to ensure clean cliff boundaries.
 *
 * @param elevation Raw elevation value (0-255)
 * @returns Quantized elevation (60, 140, or 220)
 */
export function quantizeElevation(elevation: number): number {
  if (elevation < 100) return ELEVATION.LOW;
  if (elevation < 180) return ELEVATION.MID;
  return ELEVATION.HIGH;
}

/**
 * Minimum elevation difference to create a cliff (for terrain generation).
 * Re-exported from central pathfinding config for backwards compatibility.
 * @see src/data/pathfinding.config.ts
 */
export { CLIFF_WALL_THRESHOLD_ELEVATION as CLIFF_THRESHOLD } from '@/data/pathfinding.config';

// ============================================================================
// PAINT COMMANDS
// ============================================================================

export type Point = { x: number; y: number } | [number, number];

/** Helper to normalize point format */
export function toXY(p: Point): { x: number; y: number } {
  if (Array.isArray(p)) return { x: p[0], y: p[1] };
  return p;
}

/** Fill entire canvas with elevation */
export interface FillCommand {
  cmd: 'fill';
  elevation: number;
}

/** Paint a circular plateau */
export interface PlateauCommand {
  cmd: 'plateau';
  x: number;
  y: number;
  radius: number;
  elevation: number;
}

/** Paint a rectangular area */
export interface RectCommand {
  cmd: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  elevation: number;
}

/** Paint a ramp (walkable slope between two points) */
export interface RampCommand {
  cmd: 'ramp';
  from: Point;
  to: Point;
  width: number;
}

/** Paint an elevation gradient */
export interface GradientCommand {
  cmd: 'gradient';
  from: Point;
  to: Point;
  width: number;
  fromElevation: number;
  toElevation: number;
}

/** Paint water area */
export interface WaterCommand {
  cmd: 'water';
  x: number;
  y: number;
  radius?: number;
  width?: number;
  height?: number;
  depth?: 'shallow' | 'deep';
}

/** Paint forest area */
export interface ForestCommand {
  cmd: 'forest';
  x: number;
  y: number;
  radius?: number;
  width?: number;
  height?: number;
  density: 'sparse' | 'light' | 'medium' | 'dense';
}

/** Paint void/chasm area */
export interface VoidCommand {
  cmd: 'void';
  x: number;
  y: number;
  radius?: number;
  width?: number;
  height?: number;
}

/** Paint road (fast movement) */
export interface RoadCommand {
  cmd: 'road';
  from: Point;
  to: Point;
  width: number;
}

/** Paint unwalkable obstacle */
export interface UnwalkableCommand {
  cmd: 'unwalkable';
  x: number;
  y: number;
  radius?: number;
  width?: number;
  height?: number;
}

/** Paint map border (unwalkable edge) */
export interface BorderCommand {
  cmd: 'border';
  thickness: number;
}

/** Paint mud/slow area */
export interface MudCommand {
  cmd: 'mud';
  x: number;
  y: number;
  radius: number;
}

export type PaintCommand =
  | FillCommand
  | PlateauCommand
  | RectCommand
  | RampCommand
  | GradientCommand
  | WaterCommand
  | ForestCommand
  | VoidCommand
  | RoadCommand
  | UnwalkableCommand
  | BorderCommand
  | MudCommand;

// ============================================================================
// BASE & RESOURCE TYPES
// ============================================================================

export type BaseType = 'main' | 'natural' | 'third' | 'fourth' | 'fifth' | 'gold' | 'pocket';

export type ResourceDirection =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'up_left'
  | 'up_right'
  | 'down_left'
  | 'down_right';

export interface BaseLocation {
  x: number;
  y: number;
  type: BaseType;
  playerSlot?: number; // 1-8 for spawn points
  mineralDirection?: ResourceDirection;
  isGold?: boolean;
}

export interface WatchTowerDef {
  x: number;
  y: number;
  vision: number;
}

export interface DestructibleDef {
  x: number;
  y: number;
  health: number;
  size?: 'small' | 'medium' | 'large';
}

// ============================================================================
// DECORATION RULES
// ============================================================================

export type DecorationStyle = 'rocks' | 'crystals' | 'trees' | 'mixed' | 'alien' | 'dead_trees';

export interface BorderDecorationRule {
  style: DecorationStyle;
  density: number; // 0-1
  scale: [number, number]; // [min, max] scale
  innerOffset?: number; // Distance from edge for inner ring
  outerOffset?: number; // Distance from edge for outer ring
}

export interface CliffEdgeDecorationRule {
  enabled: boolean;
  rocks?: boolean;
  crystals?: boolean;
  trees?: boolean;
  density?: number;
}

export interface ScatterDecorationRule {
  rocks?: number; // 0-1 density
  crystals?: number;
  trees?: number;
  deadTrees?: number;
  alienTrees?: number;
  grass?: number;
  debris?: number;
}

export interface BaseRingDecorationRule {
  rocks?: number; // count per base
  trees?: number;
  crystals?: number;
}

export interface DecorationRules {
  border?: BorderDecorationRule;
  cliffEdges?: CliffEdgeDecorationRule;
  scatter?: ScatterDecorationRule;
  baseRings?: BaseRingDecorationRule;
  seed?: number; // Random seed for reproducibility
}

// ============================================================================
// EXPLICIT DECORATION
// ============================================================================

export type DecorationTypeString =
  | 'rocks_small'
  | 'rocks_large'
  | 'rock_single'
  | 'crystal_formation'
  | 'tree_dead'
  | 'tree_alien'
  | 'tree_pine_tall'
  | 'tree_palm'
  | 'tree_mushroom'
  | 'bush'
  | 'grass_clump'
  | 'debris'
  | 'ruined_wall'
  | 'escape_pod';

export interface ExplicitDecoration {
  type: DecorationTypeString;
  x: number;
  y: number;
  scale?: number;
  rotation?: number;
}

// ============================================================================
// MAP BLUEPRINT (The complete map definition)
// ============================================================================

export interface MapMeta {
  id: string;
  name: string;
  author?: string;
  description?: string;
  players: number;
}

export interface MapCanvas {
  width: number;
  height: number;
  biome: BiomeType;
}

export interface MapBlueprint {
  meta: MapMeta;
  canvas: MapCanvas;

  /** Paint commands executed in order to build terrain */
  paint: PaintCommand[];

  /** Base locations (spawns + expansions) */
  bases: BaseLocation[];

  /** Watch towers */
  watchTowers?: WatchTowerDef[];

  /** Destructible rocks */
  destructibles?: DestructibleDef[];

  /** Decoration rules (procedural) */
  decorationRules?: DecorationRules;

  /** Explicit decorations (manual placement) */
  explicitDecorations?: ExplicitDecoration[];
}

// ============================================================================
// HELPER FUNCTIONS FOR BUILDING MAPS
// ============================================================================

/** Create a main base with standard resources */
export function mainBase(x: number, y: number, playerSlot: number, mineralDir: ResourceDirection = 'down'): BaseLocation {
  return { x, y, type: 'main', playerSlot, mineralDirection: mineralDir };
}

/** Create a natural expansion */
export function naturalBase(x: number, y: number, mineralDir: ResourceDirection = 'down'): BaseLocation {
  return { x, y, type: 'natural', mineralDirection: mineralDir };
}

/** Create a third expansion */
export function thirdBase(x: number, y: number, mineralDir: ResourceDirection = 'down'): BaseLocation {
  return { x, y, type: 'third', mineralDirection: mineralDir };
}

/** Create a fourth expansion */
export function fourthBase(x: number, y: number, mineralDir: ResourceDirection = 'down'): BaseLocation {
  return { x, y, type: 'fourth', mineralDirection: mineralDir };
}

/** Create a gold expansion */
export function goldBase(x: number, y: number, mineralDir: ResourceDirection = 'down'): BaseLocation {
  return { x, y, type: 'gold', mineralDirection: mineralDir, isGold: true };
}

// ============================================================================
// PAINT COMMAND SHORTCUTS
// ============================================================================

/** Fill entire canvas */
export function fill(elevation: number): FillCommand {
  return { cmd: 'fill', elevation };
}

/** Paint a circular plateau */
export function plateau(x: number, y: number, radius: number, elevation: number): PlateauCommand {
  return { cmd: 'plateau', x, y, radius, elevation };
}

/** Paint a rectangular area */
export function rect(x: number, y: number, width: number, height: number, elevation: number): RectCommand {
  return { cmd: 'rect', x, y, width, height, elevation };
}

/** Paint a ramp between two points */
export function ramp(from: Point, to: Point, width: number): RampCommand {
  return { cmd: 'ramp', from, to, width };
}

/** Paint a water area (circle) */
export function water(x: number, y: number, radius: number, depth: 'shallow' | 'deep' = 'shallow'): WaterCommand {
  return { cmd: 'water', x, y, radius, depth };
}

/** Paint a water rectangle */
export function waterRect(x: number, y: number, width: number, height: number, depth: 'shallow' | 'deep' = 'shallow'): WaterCommand {
  return { cmd: 'water', x, y, width, height, depth };
}

/** Paint a forest area (circle) */
export function forest(x: number, y: number, radius: number, density: ForestCommand['density'] = 'medium'): ForestCommand {
  return { cmd: 'forest', x, y, radius, density };
}

/** Paint a forest rectangle */
export function forestRect(x: number, y: number, width: number, height: number, density: ForestCommand['density'] = 'medium'): ForestCommand {
  return { cmd: 'forest', x, y, width, height, density };
}

/** Paint a void/chasm (circle) */
export function voidArea(x: number, y: number, radius: number): VoidCommand {
  return { cmd: 'void', x, y, radius };
}

/** Paint a void rectangle */
export function voidRect(x: number, y: number, width: number, height: number): VoidCommand {
  return { cmd: 'void', x, y, width, height };
}

/** Paint a road between two points */
export function road(from: Point, to: Point, width: number): RoadCommand {
  return { cmd: 'road', from, to, width };
}

/** Paint an unwalkable obstacle (circle) */
export function unwalkable(x: number, y: number, radius: number): UnwalkableCommand {
  return { cmd: 'unwalkable', x, y, radius };
}

/** Paint an unwalkable rectangle */
export function unwalkableRect(x: number, y: number, width: number, height: number): UnwalkableCommand {
  return { cmd: 'unwalkable', x, y, width, height };
}

/** Paint map border */
export function border(thickness: number): BorderCommand {
  return { cmd: 'border', thickness };
}

/** Paint mud/slow area */
export function mud(x: number, y: number, radius: number): MudCommand {
  return { cmd: 'mud', x, y, radius };
}

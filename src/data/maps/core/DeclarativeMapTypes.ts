/**
 * DeclarativeMapTypes.ts - Fully Declarative Map Definition System
 *
 * This extends the basic MapDefinition to support 100% declarative map authoring.
 * No imperative code needed - everything is defined in JSON-serializable structures.
 *
 * Design Goals:
 * - UI-friendly: Every field can be edited in a visual tool
 * - LLM-friendly: Simple JSON structure that AI can generate
 * - Human-friendly: Clear, self-documenting schema
 */

// ============================================================================
// GEOMETRY PRIMITIVES
// ============================================================================

export interface Point2D {
  x: number;
  y: number;
}

export interface Size2D {
  width: number;
  height: number;
}

export interface Bounds2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ShapeType = 'circle' | 'rect' | 'polygon' | 'ellipse';

export interface CircleShape {
  type: 'circle';
  center: Point2D;
  radius: number;
}

export interface RectShape {
  type: 'rect';
  position: Point2D;
  size: Size2D;
  rotation?: number; // degrees
}

export interface EllipseShape {
  type: 'ellipse';
  center: Point2D;
  radiusX: number;
  radiusY: number;
  rotation?: number;
}

export interface PolygonShape {
  type: 'polygon';
  points: Point2D[];
}

export interface LineShape {
  type: 'line';
  from: Point2D;
  to: Point2D;
  width: number;
}

export interface PathShape {
  type: 'path';
  points: Point2D[];
  width: number;
  smooth?: boolean; // Bezier smoothing
}

export type Shape = CircleShape | RectShape | EllipseShape | PolygonShape | LineShape | PathShape;

// ============================================================================
// BIOME & VISUAL THEME
// ============================================================================

export type BiomeType =
  | 'grassland'
  | 'desert'
  | 'frozen'
  | 'volcanic'
  | 'void'
  | 'jungle'
  | 'twilight'
  | 'crystal'
  | 'industrial';

export interface BiomeTheme {
  biome: BiomeType;

  // Sky and lighting
  skyboxColor: string;      // Hex color
  ambientColor: string;     // Ambient light color
  sunColor: string;         // Directional light color
  sunIntensity?: number;    // 0-2, default 1
  sunAngle?: number;        // Degrees from vertical

  // Fog
  fogEnabled?: boolean;
  fogColor?: string;
  fogNear?: number;
  fogFar?: number;
  fogDensity?: number;      // For exponential fog

  // Ground texture theme
  groundPrimary?: string;   // Primary ground texture
  groundSecondary?: string; // Secondary/accent texture
  cliffTexture?: string;    // Cliff face texture
  rampTexture?: string;     // Ramp surface texture
}

// Default themes per biome
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
    sunIntensity: 1.3,
    fogColor: '#D4C4A0',
    fogNear: 100,
    fogFar: 280,
  },
  frozen: {
    biome: 'frozen',
    skyboxColor: '#A8C8E8',
    ambientColor: '#304050',
    sunColor: '#E8F0FF',
    fogColor: '#D0E0F0',
    fogNear: 80,
    fogFar: 250,
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
    skyboxColor: '#0A0A1E',
    ambientColor: '#303050',
    sunColor: '#FFE0B0',
    fogColor: '#1A1A2E',
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
  twilight: {
    biome: 'twilight',
    skyboxColor: '#2A1A3A',
    ambientColor: '#201030',
    sunColor: '#FFA080',
    fogColor: '#1A1028',
    fogNear: 80,
    fogFar: 240,
  },
  crystal: {
    biome: 'crystal',
    skyboxColor: '#1A2A3A',
    ambientColor: '#203040',
    sunColor: '#80E0FF',
    fogColor: '#102030',
    fogNear: 100,
    fogFar: 280,
  },
  industrial: {
    biome: 'industrial',
    skyboxColor: '#3A3A3A',
    ambientColor: '#303030',
    sunColor: '#FFF0E0',
    fogColor: '#282828',
    fogNear: 90,
    fogFar: 260,
  },
};

// ============================================================================
// REGION DEFINITIONS
// ============================================================================

export type RegionType =
  | 'main_base'
  | 'natural'
  | 'third'
  | 'fourth'
  | 'fifth'
  | 'gold'
  | 'pocket'
  | 'island'
  | 'center'
  | 'choke'
  | 'high_ground'
  | 'low_ground'
  | 'watchtower'
  | 'pathway'
  | 'open';

export interface RegionDef {
  id: string;
  name: string;
  type: RegionType;
  position: Point2D;
  elevation: 0 | 1 | 2;
  radius: number;
  playerSlot?: number;        // 1-8 for spawn regions
  buildable?: boolean;        // Can place buildings (default true for bases)
  resourceTemplate?: ResourceTemplateName;  // Auto-generate resources
  customResources?: ResourcePlacement[];    // Or specify manually
}

// ============================================================================
// CONNECTION DEFINITIONS
// ============================================================================

export type ConnectionType =
  | 'ramp'           // Elevation change (generates sloped terrain)
  | 'ground'         // Same-elevation path (clears obstacles)
  | 'bridge'         // Over void/water (generates bridge structure)
  | 'narrow'         // Tight passage (choke point)
  | 'wide'           // Open connection
  | 'destructible';  // Blocked until rocks destroyed

export interface ConnectionDef {
  id?: string;
  from: string;          // Region ID
  to: string;            // Region ID
  type: ConnectionType;
  width: number;
  waypoints?: Point2D[]; // Path control points
  blockable?: boolean;   // Can be blocked by destructibles
}

// ============================================================================
// TERRAIN FEATURES
// ============================================================================

export interface VoidArea {
  id?: string;
  shape: Shape;
  style?: 'chasm' | 'space' | 'lava' | 'acid';
  edgeWidth?: number;    // Transition edge width
  glow?: boolean;        // Glowing effect
}

export interface WaterArea {
  id?: string;
  shape: Shape;
  depth?: 'shallow' | 'deep';
  style?: 'lake' | 'river' | 'swamp' | 'toxic';
  wavesEnabled?: boolean;
}

export interface CliffWall {
  id?: string;
  shape: LineShape | PathShape;
  height?: number;       // Cliff height (elevation units)
  style?: 'natural' | 'artificial' | 'crystal' | 'volcanic';
}

export interface UnwalkableArea {
  id?: string;
  shape: Shape;
  style?: 'rocks' | 'debris' | 'structure' | 'void';
  visualOnly?: boolean;  // Just visual, doesn't block movement
}

export interface RoadPath {
  id?: string;
  shape: LineShape | PathShape;
  style?: 'dirt' | 'stone' | 'metal' | 'ancient';
  speedBonus?: number;   // Movement speed multiplier (1.0 = normal)
}

export interface SlowArea {
  id?: string;
  shape: Shape;
  slowFactor: number;    // 0.5 = 50% speed
  style?: 'mud' | 'snow' | 'sand' | 'creep';
}

export interface TerrainFeatures {
  voids?: VoidArea[];
  water?: WaterArea[];
  cliffs?: CliffWall[];
  unwalkable?: UnwalkableArea[];
  roads?: RoadPath[];
  slowAreas?: SlowArea[];
}

// ============================================================================
// FORESTS & VEGETATION
// ============================================================================

export type ForestDensity = 'sparse' | 'light' | 'medium' | 'dense' | 'thick';
export type VegetationType =
  | 'deciduous'
  | 'conifer'
  | 'palm'
  | 'alien'
  | 'dead'
  | 'crystal'
  | 'mushroom'
  | 'jungle';

export interface ForestArea {
  id?: string;
  shape: Shape;
  density: ForestDensity;
  vegetationType: VegetationType;
  blocksVision?: boolean;     // Default true for dense+
  providesCover?: boolean;    // Reduces incoming damage
  treeScale?: { min: number; max: number };
}

export interface BushCluster {
  id?: string;
  position: Point2D;
  radius: number;
  count: { min: number; max: number };
  type?: 'bush' | 'grass' | 'fern' | 'flower';
}

export interface VegetationScatter {
  regions?: string[];         // Limit to specific regions, or whole map
  density: number;            // 0-1
  types: VegetationType[];
  avoidRadius: number;        // Distance from bases/resources
  scale?: { min: number; max: number };
}

export interface VegetationConfig {
  forests?: ForestArea[];
  bushClusters?: BushCluster[];
  scatter?: VegetationScatter;
}

// ============================================================================
// DECORATIONS
// ============================================================================

export type DecorationCategory =
  | 'rocks'
  | 'crystals'
  | 'trees'
  | 'debris'
  | 'structures'
  | 'props'
  | 'effects';

export type RockType =
  | 'boulder_small'
  | 'boulder_medium'
  | 'boulder_large'
  | 'boulder_massive'
  | 'rock_cluster'
  | 'rock_spire'
  | 'rock_flat';

export type CrystalType =
  | 'crystal_small'
  | 'crystal_medium'
  | 'crystal_large'
  | 'crystal_cluster'
  | 'crystal_spire';

export type DebrisType =
  | 'debris_small'
  | 'debris_medium'
  | 'debris_large'
  | 'wreckage'
  | 'ruined_wall'
  | 'ruined_pillar'
  | 'escape_pod'
  | 'cargo_crate';

export type StructureType =
  | 'pillar'
  | 'arch'
  | 'statue'
  | 'obelisk'
  | 'altar'
  | 'beacon'
  | 'antenna';

export interface DecorationCluster {
  id?: string;
  position: Point2D;
  radius: number;
  category: DecorationCategory;
  types: string[];            // Specific types within category
  count: { min: number; max: number };
  scale: { min: number; max: number };
  rotationRandom?: boolean;   // Random rotation (default true)
  avoidRamps?: boolean;       // Don't place on ramps (default true)
}

export interface DecorationLine {
  id?: string;
  from: Point2D;
  to: Point2D;
  category: DecorationCategory;
  types: string[];
  density: number;            // Items per unit length
  scale: { min: number; max: number };
  jitter?: number;            // Random offset from line
}

export interface ExplicitDecoration {
  type: string;
  position: Point2D;
  scale?: number;
  rotation?: number;          // Radians
}

export interface BorderDecorations {
  enabled: boolean;
  style?: 'rocks' | 'crystals' | 'mixed' | 'cliffs';
  innerRing?: {
    offset: number;           // Distance from map edge
    types: string[];
    scale: { min: number; max: number };
    density: number;
  };
  outerRing?: {
    offset: number;
    types: string[];
    scale: { min: number; max: number };
    density: number;
  };
}

export interface BaseEdgeDecorations {
  enabled: boolean;
  rockRing?: {
    types: string[];
    scale: { min: number; max: number };
    count: number;            // Per base
  };
  treeRing?: {
    types: string[];
    scale: { min: number; max: number };
    count: number;
  };
}

export interface DecorationConfig {
  clusters?: DecorationCluster[];
  lines?: DecorationLine[];
  explicit?: ExplicitDecoration[];
  border?: BorderDecorations;
  baseEdges?: BaseEdgeDecorations;
  seed?: number;              // Random seed for reproducibility
}

// ============================================================================
// RESOURCES
// ============================================================================

export type ResourceTemplateName =
  | 'standard'        // 6x1500 + 2x900 minerals, 2x2250 gas
  | 'rich'            // 8x1500 minerals, 2x2250 gas
  | 'gold'            // 8x900 gold minerals, 2x2250 gas
  | 'poor'            // 4x1500 minerals, 1x2250 gas
  | 'gas_only'        // 2x2250 gas, no minerals
  | 'mineral_only'    // 8x1500 minerals, no gas
  | 'custom';         // Use customResources

export interface ResourcePlacement {
  type: 'mineral' | 'mineral_gold' | 'vespene';
  position: Point2D;
  amount: number;
  depleted?: boolean;         // Start depleted
}

export interface ResourceConfig {
  // Global resource settings
  mineralAmount?: number;     // Override default amounts
  goldAmount?: number;
  gasAmount?: number;

  // Templates apply to regions with resourceTemplate set
  // This is for additional standalone resources
  additional?: ResourcePlacement[];
}

// ============================================================================
// GAME FEATURES
// ============================================================================

export interface WatchTowerDef {
  id?: string;
  position: Point2D;
  visionRadius: number;
  activationRadius?: number;  // Distance to activate (default = visionRadius)
  style?: 'xelnaga' | 'terran' | 'protoss' | 'zerg' | 'neutral';
}

export interface DestructibleRockDef {
  id?: string;
  position: Point2D;
  health: number;
  size?: 'small' | 'medium' | 'large';
  blocksPath?: string;        // Connection ID this blocks
  respawns?: boolean;         // Respawns after destruction
  respawnTime?: number;       // Seconds
}

export interface NeutralUnitDef {
  id?: string;
  type: string;               // Unit type
  position: Point2D;
  facing?: number;            // Rotation in radians
  aggressive?: boolean;       // Attacks players
}

export interface GameFeatures {
  watchTowers?: WatchTowerDef[];
  destructibles?: DestructibleRockDef[];
  neutralUnits?: NeutralUnitDef[];
}

// ============================================================================
// MAP SYMMETRY
// ============================================================================

export type SymmetryType =
  | 'none'
  | 'mirror_x'        // Left-right mirror
  | 'mirror_y'        // Top-bottom mirror
  | 'mirror_diagonal' // Diagonal mirror
  | 'rotational_2'    // 180° rotation (2 players)
  | 'rotational_4'    // 90° rotation (4 players)
  | 'rotational_6'    // 60° rotation (6 players)
  | 'rotational_8';   // 45° rotation (8 players)

export interface SymmetryConfig {
  type: SymmetryType;
  playerCount: 2 | 4 | 6 | 8;
  center?: Point2D;           // Symmetry center (default: map center)
  axis?: number;              // Rotation of symmetry axis (degrees)
  flexible?: boolean;         // Allow minor asymmetry for variety
}

// ============================================================================
// MAP META
// ============================================================================

export interface MapMeta {
  id: string;
  name: string;
  author: string;
  description: string;
  version?: string;
  tags?: string[];
  thumbnail?: string;         // Path to thumbnail image
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  gameModes?: ('1v1' | '2v2' | '3v3' | '4v4' | 'ffa')[];
  isRanked?: boolean;
}

export interface MapCanvas {
  width: number;
  height: number;
  baseElevation?: 0 | 1 | 2;  // Default ground elevation
  borderWidth?: number;       // Unwalkable border (default 8)
}

// ============================================================================
// COMPLETE MAP DEFINITION
// ============================================================================

export interface DeclarativeMapDef {
  meta: MapMeta;
  canvas: MapCanvas;
  theme: BiomeTheme | BiomeType;  // Full theme or just biome name (uses default)
  symmetry: SymmetryConfig;

  // Core structure
  regions: RegionDef[];
  connections: ConnectionDef[];

  // Terrain
  terrain?: TerrainFeatures;

  // Vegetation
  vegetation?: VegetationConfig;

  // Decorations
  decorations?: DecorationConfig;

  // Resources (beyond region templates)
  resources?: ResourceConfig;

  // Game features
  features?: GameFeatures;

  // Generation options
  options?: {
    seed?: number;            // Master seed for all randomness
    validateConnectivity?: boolean;  // Run connectivity check (default true)
    autoFixConnectivity?: boolean;   // Auto-carve corridors if needed
    debugMode?: boolean;      // Extra logging
  };
}

// ============================================================================
// HELPER FUNCTIONS FOR BUILDING DEFINITIONS
// ============================================================================

/**
 * Create a circular shape
 */
export function circle(x: number, y: number, radius: number): CircleShape {
  return { type: 'circle', center: { x, y }, radius };
}

/**
 * Create a rectangular shape
 */
export function rect(x: number, y: number, width: number, height: number, rotation = 0): RectShape {
  return { type: 'rect', position: { x, y }, size: { width, height }, rotation };
}

/**
 * Create a line shape
 */
export function line(x1: number, y1: number, x2: number, y2: number, width: number): LineShape {
  return { type: 'line', from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, width };
}

/**
 * Create a path shape
 */
export function path(points: [number, number][], width: number, smooth = false): PathShape {
  return {
    type: 'path',
    points: points.map(([x, y]) => ({ x, y })),
    width,
    smooth,
  };
}

/**
 * Create a main base region
 */
export function mainBase(
  id: string,
  x: number,
  y: number,
  playerSlot: number,
  options?: Partial<RegionDef>
): RegionDef {
  return {
    id,
    name: `Player ${playerSlot} Main`,
    type: 'main_base',
    position: { x, y },
    elevation: 2,
    radius: 22,
    playerSlot,
    buildable: true,
    resourceTemplate: 'standard',
    ...options,
  };
}

/**
 * Create a natural expansion region
 */
export function natural(
  id: string,
  x: number,
  y: number,
  options?: Partial<RegionDef>
): RegionDef {
  return {
    id,
    name: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    type: 'natural',
    position: { x, y },
    elevation: 1,
    radius: 16,
    buildable: true,
    resourceTemplate: 'standard',
    ...options,
  };
}

/**
 * Create a third/fourth expansion
 */
export function expansion(
  id: string,
  x: number,
  y: number,
  type: 'third' | 'fourth' | 'fifth' | 'gold' = 'third',
  options?: Partial<RegionDef>
): RegionDef {
  return {
    id,
    name: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    type,
    position: { x, y },
    elevation: 0,
    radius: type === 'gold' ? 14 : 16,
    buildable: true,
    resourceTemplate: type === 'gold' ? 'gold' : 'standard',
    ...options,
  };
}

/**
 * Create a center/contested region
 */
export function center(
  id: string,
  x: number,
  y: number,
  radius = 24,
  options?: Partial<RegionDef>
): RegionDef {
  return {
    id,
    name: 'Center',
    type: 'center',
    position: { x, y },
    elevation: 0,
    radius,
    buildable: false,
    ...options,
  };
}

/**
 * Create a ramp connection
 */
export function ramp(from: string, to: string, width = 10): ConnectionDef {
  return { from, to, type: 'ramp', width };
}

/**
 * Create a ground connection
 */
export function ground(from: string, to: string, width = 12): ConnectionDef {
  return { from, to, type: 'ground', width };
}

/**
 * Create a narrow choke connection
 */
export function choke(from: string, to: string, width = 6): ConnectionDef {
  return { from, to, type: 'narrow', width };
}

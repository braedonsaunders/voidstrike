/**
 * MapDefinition.ts - Declarative Map Definition DSL
 *
 * Provides a powerful, declarative API for defining RTS maps.
 * Maps are defined as connectivity graphs with terrain features,
 * ensuring walkability is explicit rather than inferred.
 */

import {
  ConnectivityGraph,
  ConnectivityNode,
  ConnectivityEdge,
  NodeId,
  RegionType,
  ConnectionType,
  createConnectivityGraph,
  addNode,
  addEdge,
} from './MapConnectivity';

// ============================================================================
// BIOME & TERRAIN TYPES
// ============================================================================

/**
 * Available biome types
 */
// Matches BiomeType from rendering/Biomes.ts
export type BiomeType = 'grassland' | 'desert' | 'frozen' | 'volcanic' | 'void' | 'jungle';

/**
 * Terrain surface types
 */
export type TerrainSurface = 'ground' | 'dirt' | 'sand' | 'rock' | 'grass' | 'mud' | 'snow' | 'void' | 'water';

/**
 * Decoration types available in the game
 */
export type DecorationType =
  | 'rocks_small'
  | 'rocks_medium'
  | 'rocks_large'
  | 'rocks_cluster'
  | 'crystal_small'
  | 'crystal_medium'
  | 'crystal_large'
  | 'crystal_cluster'
  | 'tree_dead'
  | 'tree_jungle'
  | 'tree_pine'
  | 'tree_palm'
  | 'bush_small'
  | 'bush_large'
  | 'grass_patch'
  | 'flowers'
  | 'mushrooms'
  | 'bones'
  | 'debris'
  | 'ruined_wall'
  | 'escape_pod'
  | 'crater'
  | 'lava_rock'
  | 'ice_spike'
  | 'coral'
  | 'vines'
  | 'moss_patch';

// ============================================================================
// MAP DEFINITION TYPES
// ============================================================================

/**
 * Map metadata
 */
export interface MapMeta {
  id: string;
  name: string;
  author: string;
  description: string;
  version?: string;
  tags?: string[];
}

/**
 * Map canvas (size and base properties)
 */
export interface MapCanvas {
  width: number;
  height: number;
  biome: BiomeType;
  baseElevation?: number;
  baseSurface?: TerrainSurface;
}

/**
 * Symmetry configuration
 */
export interface MapSymmetry {
  type: 'none' | 'rotational' | 'mirror_x' | 'mirror_y' | 'mirror_diagonal' | 'quad';
  center?: { x: number; y: number };
  playerCount: 2 | 3 | 4 | 6 | 8;
  /** When true, validates but doesn't enforce perfect symmetry */
  flexible?: boolean;
}

/**
 * Region definition (becomes a ConnectivityNode)
 */
export interface RegionDefinition {
  id: NodeId;
  name?: string;
  type: RegionType;
  position: { x: number; y: number };
  elevation: number;
  radius: number;
  playerSlot?: number;
  resources?: {
    minerals?: number;
    vespene?: number;
    richMinerals?: number;
  };
  surface?: TerrainSurface;
  /** Additional metadata for special region types */
  metadata?: Record<string, unknown>;
}

/**
 * Connection definition (becomes a ConnectivityEdge)
 */
export interface ConnectionDefinition {
  from: NodeId;
  to: NodeId;
  type: ConnectionType;
  width: number;
  waypoints?: Array<{ x: number; y: number }>;
  blockedBy?: string;
}

/**
 * Terrain obstacle (blocks movement and/or LOS)
 */
export interface ObstacleDefinition {
  id?: string;
  type: 'cliff' | 'wall' | 'rocks' | 'structure';
  shape: 'rect' | 'circle' | 'polygon';
  position: { x: number; y: number };
  size?: { width: number; height: number };
  radius?: number;
  points?: Array<{ x: number; y: number }>;
  blocksLOS?: boolean;
}

/**
 * Void area (unwalkable, typically map edges)
 */
export interface VoidDefinition {
  shape: 'rect' | 'circle' | 'ring' | 'polygon';
  position: { x: number; y: number };
  size?: { width: number; height: number };
  radius?: number;
  innerRadius?: number;
  points?: Array<{ x: number; y: number }>;
}

/**
 * Water body
 */
export interface WaterDefinition {
  id?: string;
  shape: 'rect' | 'circle' | 'polygon';
  position: { x: number; y: number };
  size?: { width: number; height: number };
  radius?: number;
  points?: Array<{ x: number; y: number }>;
  depth?: number;
  /** If true, creates a bridge across */
  bridged?: boolean;
}

/**
 * Road/path that improves movement speed
 */
export interface RoadDefinition {
  from: { x: number; y: number };
  to: { x: number; y: number };
  width: number;
  waypoints?: Array<{ x: number; y: number }>;
  surface?: 'paved' | 'dirt' | 'gravel';
  speedBonus?: number;
}

/**
 * Terrain modifier (mud, etc.)
 */
export interface TerrainModifierDefinition {
  type: 'mud' | 'creep' | 'ice' | 'lava';
  shape: 'rect' | 'circle' | 'polygon';
  position: { x: number; y: number };
  size?: { width: number; height: number };
  radius?: number;
  points?: Array<{ x: number; y: number }>;
  speedModifier?: number;
}

/**
 * Forest area that blocks vision but allows movement
 */
export interface ForestDefinition {
  shape: 'rect' | 'circle' | 'polygon';
  position: { x: number; y: number };
  size?: { width: number; height: number };
  radius?: number;
  points?: Array<{ x: number; y: number }>;
  density?: 'sparse' | 'medium' | 'dense';
  treeType?: 'dead' | 'jungle' | 'pine' | 'palm';
}

/**
 * Watch tower (provides vision bonus)
 */
export interface WatchTowerDefinition {
  id: string;
  position: { x: number; y: number };
  visionRadius: number;
  elevation?: number;
}

/**
 * Destructible object (rocks, barriers)
 */
export interface DestructibleDefinition {
  id: string;
  type: 'rocks' | 'barrier' | 'debris';
  position: { x: number; y: number };
  health: number;
  size?: 'small' | 'medium' | 'large';
  /** If true, blocks connection until destroyed */
  blocksPath?: boolean;
  /** Connection ID this blocks */
  blocksConnection?: string;
}

// ============================================================================
// DECORATION DEFINITIONS
// ============================================================================

/**
 * Border wall configuration (map edge decoration)
 */
export interface BorderWallConfig {
  enabled: boolean;
  innerRing?: {
    types: DecorationType[];
    scale: { min: number; max: number };
    density: number;
    offset: number;
  };
  outerRing?: {
    types: DecorationType[];
    scale: { min: number; max: number };
    density: number;
    offset: number;
  };
}

/**
 * Base edge decoration (around elevated bases)
 */
export interface BaseEdgeConfig {
  enabled: boolean;
  types: DecorationType[];
  scale: { min: number; max: number };
  spacing: number;
  offset: number;
}

/**
 * Cliff line decoration
 */
export interface CliffLineConfig {
  elevation: number;
  types: DecorationType[];
  scale: { min: number; max: number };
  spacing: number;
}

/**
 * Decoration cluster
 */
export interface DecorationCluster {
  type: 'crystal' | 'rock' | 'tree' | 'debris';
  position: { x: number; y: number };
  radius: number;
  count: { min: number; max: number };
  scale: { min: number; max: number };
  decorationTypes?: DecorationType[];
}

/**
 * Vegetation scatter config
 */
export interface VegetationConfig {
  enabled: boolean;
  types: DecorationType[];
  density: number;
  scale: { min: number; max: number };
  avoidRadius?: number;
}

/**
 * Explicit decoration placement
 */
export interface ExplicitDecoration {
  type: DecorationType;
  position: { x: number; y: number };
  scale?: number;
  rotation?: number;
}

/**
 * Complete decoration configuration
 */
export interface DecorationConfig {
  borderWalls?: BorderWallConfig;
  baseEdges?: BaseEdgeConfig;
  cliffLines?: CliffLineConfig[];
  clusters?: DecorationCluster[];
  vegetation?: VegetationConfig;
  explicit?: ExplicitDecoration[];
}

// ============================================================================
// COMPLETE MAP DEFINITION
// ============================================================================

/**
 * Complete map definition
 */
export interface MapDefinition {
  meta: MapMeta;
  canvas: MapCanvas;
  symmetry: MapSymmetry;
  regions: RegionDefinition[];
  connections: ConnectionDefinition[];
  terrain?: {
    obstacles?: ObstacleDefinition[];
    voids?: VoidDefinition[];
    water?: WaterDefinition[];
    roads?: RoadDefinition[];
    modifiers?: TerrainModifierDefinition[];
    forests?: ForestDefinition[];
  };
  features?: {
    watchTowers?: WatchTowerDefinition[];
    destructibles?: DestructibleDefinition[];
  };
  decorations?: DecorationConfig;
}

// ============================================================================
// BUILDER API
// ============================================================================

/**
 * Builder class for creating maps with a fluent API
 */
export class MapBuilder {
  private definition: Partial<MapDefinition> = {};
  private _regions: RegionDefinition[] = [];
  private _connections: ConnectionDefinition[] = [];
  private _obstacles: ObstacleDefinition[] = [];
  private _voids: VoidDefinition[] = [];
  private _watchTowers: WatchTowerDefinition[] = [];
  private _destructibles: DestructibleDefinition[] = [];
  private _clusters: DecorationCluster[] = [];
  private _explicitDecorations: ExplicitDecoration[] = [];

  /**
   * Set map metadata
   */
  meta(meta: MapMeta): this {
    this.definition.meta = meta;
    return this;
  }

  /**
   * Set map canvas
   */
  canvas(canvas: MapCanvas): this {
    this.definition.canvas = canvas;
    return this;
  }

  /**
   * Set symmetry configuration
   */
  symmetry(symmetry: MapSymmetry): this {
    this.definition.symmetry = symmetry;
    return this;
  }

  /**
   * Add a region
   */
  region(region: RegionDefinition): this {
    this._regions.push(region);
    return this;
  }

  /**
   * Add multiple regions
   */
  regions(regions: RegionDefinition[]): this {
    this._regions.push(...regions);
    return this;
  }

  /**
   * Add a connection
   */
  connect(from: NodeId, to: NodeId, type: ConnectionType, width: number, waypoints?: Array<{ x: number; y: number }>): this {
    this._connections.push({ from, to, type, width, waypoints });
    return this;
  }

  /**
   * Add an obstacle
   */
  obstacle(obstacle: ObstacleDefinition): this {
    this._obstacles.push(obstacle);
    return this;
  }

  /**
   * Add a void area
   */
  void(voidDef: VoidDefinition): this {
    this._voids.push(voidDef);
    return this;
  }

  /**
   * Add a watch tower
   */
  watchTower(tower: WatchTowerDefinition): this {
    this._watchTowers.push(tower);
    return this;
  }

  /**
   * Add a destructible
   */
  destructible(destructible: DestructibleDefinition): this {
    this._destructibles.push(destructible);
    return this;
  }

  /**
   * Add a decoration cluster
   */
  cluster(cluster: DecorationCluster): this {
    this._clusters.push(cluster);
    return this;
  }

  /**
   * Add an explicit decoration
   */
  decoration(decoration: ExplicitDecoration): this {
    this._explicitDecorations.push(decoration);
    return this;
  }

  /**
   * Set border wall configuration
   */
  borderWalls(config: BorderWallConfig): this {
    if (!this.definition.decorations) {
      this.definition.decorations = {};
    }
    this.definition.decorations.borderWalls = config;
    return this;
  }

  /**
   * Set base edge configuration
   */
  baseEdges(config: BaseEdgeConfig): this {
    if (!this.definition.decorations) {
      this.definition.decorations = {};
    }
    this.definition.decorations.baseEdges = config;
    return this;
  }

  /**
   * Set vegetation configuration
   */
  vegetation(config: VegetationConfig): this {
    if (!this.definition.decorations) {
      this.definition.decorations = {};
    }
    this.definition.decorations.vegetation = config;
    return this;
  }

  /**
   * Build the final map definition
   */
  build(): MapDefinition {
    if (!this.definition.meta) {
      throw new Error('Map meta is required');
    }
    if (!this.definition.canvas) {
      throw new Error('Map canvas is required');
    }
    if (!this.definition.symmetry) {
      throw new Error('Map symmetry is required');
    }

    return {
      meta: this.definition.meta,
      canvas: this.definition.canvas,
      symmetry: this.definition.symmetry,
      regions: this._regions,
      connections: this._connections,
      terrain: {
        obstacles: this._obstacles.length > 0 ? this._obstacles : undefined,
        voids: this._voids.length > 0 ? this._voids : undefined,
      },
      features: {
        watchTowers: this._watchTowers.length > 0 ? this._watchTowers : undefined,
        destructibles: this._destructibles.length > 0 ? this._destructibles : undefined,
      },
      decorations: {
        ...this.definition.decorations,
        clusters: this._clusters.length > 0 ? this._clusters : undefined,
        explicit: this._explicitDecorations.length > 0 ? this._explicitDecorations : undefined,
      },
    };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a new map builder
 */
export function createMapBuilder(): MapBuilder {
  return new MapBuilder();
}

/**
 * Define a map directly from a definition object
 */
export function defineMap(definition: MapDefinition): MapDefinition {
  return definition;
}

/**
 * Convert map definition to connectivity graph
 */
export function definitionToGraph(definition: MapDefinition): ConnectivityGraph {
  const graph = createConnectivityGraph();

  // Add all regions as nodes
  for (const region of definition.regions) {
    const node: ConnectivityNode = {
      id: region.id,
      name: region.name || region.id,
      type: region.type,
      center: region.position,
      elevation: region.elevation,
      radius: region.radius,
      playerSlot: region.playerSlot,
      resources: region.resources
        ? {
            minerals: region.resources.minerals || 0,
            vespene: region.resources.vespene || 0,
            richMinerals: region.resources.richMinerals,
          }
        : undefined,
    };
    addNode(graph, node);
  }

  // Add all connections as edges
  for (const conn of definition.connections) {
    const edge: ConnectivityEdge = {
      from: conn.from,
      to: conn.to,
      type: conn.type,
      width: conn.width,
      waypoints: conn.waypoints,
      blockedBy: conn.blockedBy,
    };
    addEdge(graph, edge);
  }

  return graph;
}

/**
 * Apply symmetry to regions (duplicate for other players)
 */
export function applySymmetryToRegions(
  regions: RegionDefinition[],
  symmetry: MapSymmetry,
  canvasWidth: number,
  canvasHeight: number
): RegionDefinition[] {
  if (symmetry.type === 'none') {
    return regions;
  }

  const centerX = symmetry.center?.x ?? canvasWidth / 2;
  const centerY = symmetry.center?.y ?? canvasHeight / 2;
  const result: RegionDefinition[] = [...regions];

  // Find base regions (those with playerSlot === 1)
  const baseRegions = regions.filter((r) => r.playerSlot === 1);

  if (symmetry.type === 'rotational') {
    const angleStep = (2 * Math.PI) / symmetry.playerCount;

    for (let p = 2; p <= symmetry.playerCount; p++) {
      const angle = angleStep * (p - 1);

      for (const base of baseRegions) {
        // Rotate position around center
        const dx = base.position.x - centerX;
        const dy = base.position.y - centerY;
        const newX = centerX + dx * Math.cos(angle) - dy * Math.sin(angle);
        const newY = centerY + dx * Math.sin(angle) + dy * Math.cos(angle);

        result.push({
          ...base,
          id: `${base.id}_p${p}`,
          playerSlot: p,
          position: { x: newX, y: newY },
        });
      }
    }
  } else if (symmetry.type === 'mirror_x') {
    for (const base of baseRegions) {
      result.push({
        ...base,
        id: `${base.id}_p2`,
        playerSlot: 2,
        position: { x: canvasWidth - base.position.x, y: base.position.y },
      });
    }
  } else if (symmetry.type === 'mirror_y') {
    for (const base of baseRegions) {
      result.push({
        ...base,
        id: `${base.id}_p2`,
        playerSlot: 2,
        position: { x: base.position.x, y: canvasHeight - base.position.y },
      });
    }
  }

  return result;
}

/**
 * Generate mirrored connections based on symmetry
 */
export function applySymmetryToConnections(
  connections: ConnectionDefinition[],
  regions: RegionDefinition[],
  symmetry: MapSymmetry
): ConnectionDefinition[] {
  if (symmetry.type === 'none') {
    return connections;
  }

  const result: ConnectionDefinition[] = [...connections];

  // For each original connection, create mirrored versions
  for (const conn of connections) {
    for (let p = 2; p <= symmetry.playerCount; p++) {
      const fromRegion = regions.find((r) => r.id === conn.from);
      const toRegion = regions.find((r) => r.id === conn.to);

      // Only mirror connections involving player 1 bases
      if (fromRegion?.playerSlot === 1 || toRegion?.playerSlot === 1) {
        result.push({
          ...conn,
          from: fromRegion?.playerSlot === 1 ? `${conn.from}_p${p}` : conn.from,
          to: toRegion?.playerSlot === 1 ? `${conn.to}_p${p}` : conn.to,
        });
      }
    }
  }

  return result;
}

// ============================================================================
// PRESET REGION TEMPLATES
// ============================================================================

/**
 * Create a standard main base region
 */
export function mainBase(
  id: NodeId,
  position: { x: number; y: number },
  playerSlot: number,
  options?: {
    radius?: number;
    elevation?: number;
    minerals?: number;
    vespene?: number;
  }
): RegionDefinition {
  return {
    id,
    name: `Player ${playerSlot} Main`,
    type: 'main_base',
    position,
    elevation: options?.elevation ?? 2,
    radius: options?.radius ?? 25,
    playerSlot,
    resources: {
      minerals: options?.minerals ?? 8,
      vespene: options?.vespene ?? 2,
    },
  };
}

/**
 * Create a natural expansion region
 */
export function naturalExpansion(
  id: NodeId,
  position: { x: number; y: number },
  playerSlot: number,
  options?: {
    radius?: number;
    elevation?: number;
    minerals?: number;
    vespene?: number;
  }
): RegionDefinition {
  return {
    id,
    name: `Player ${playerSlot} Natural`,
    type: 'natural',
    position,
    elevation: options?.elevation ?? 1,
    radius: options?.radius ?? 20,
    playerSlot,
    resources: {
      minerals: options?.minerals ?? 8,
      vespene: options?.vespene ?? 2,
    },
  };
}

/**
 * Create a third expansion region
 */
export function thirdExpansion(
  id: NodeId,
  position: { x: number; y: number },
  playerSlot?: number,
  options?: {
    radius?: number;
    elevation?: number;
    minerals?: number;
    vespene?: number;
  }
): RegionDefinition {
  return {
    id,
    name: playerSlot ? `Player ${playerSlot} Third` : 'Third Expansion',
    type: 'third',
    position,
    elevation: options?.elevation ?? 1,
    radius: options?.radius ?? 18,
    playerSlot,
    resources: {
      minerals: options?.minerals ?? 8,
      vespene: options?.vespene ?? 1,
    },
  };
}

/**
 * Create a gold/rich expansion region
 */
export function goldExpansion(
  id: NodeId,
  position: { x: number; y: number },
  options?: {
    radius?: number;
    elevation?: number;
    richMinerals?: number;
    vespene?: number;
  }
): RegionDefinition {
  return {
    id,
    name: 'Gold Expansion',
    type: 'gold',
    position,
    elevation: options?.elevation ?? 1,
    radius: options?.radius ?? 18,
    resources: {
      minerals: 0,
      vespene: options?.vespene ?? 2,
      richMinerals: options?.richMinerals ?? 6,
    },
  };
}

/**
 * Create a map center region
 */
export function mapCenter(
  id: NodeId,
  position: { x: number; y: number },
  options?: {
    radius?: number;
    elevation?: number;
  }
): RegionDefinition {
  return {
    id,
    name: 'Map Center',
    type: 'center',
    position,
    elevation: options?.elevation ?? 1,
    radius: options?.radius ?? 30,
  };
}

/**
 * Create a choke point region
 */
export function chokePoint(
  id: NodeId,
  position: { x: number; y: number },
  options?: {
    radius?: number;
    elevation?: number;
  }
): RegionDefinition {
  return {
    id,
    name: 'Choke Point',
    type: 'choke',
    position,
    elevation: options?.elevation ?? 1,
    radius: options?.radius ?? 8,
  };
}

/**
 * Create a watch tower region
 */
export function watchTowerRegion(
  id: NodeId,
  position: { x: number; y: number },
  options?: {
    radius?: number;
    elevation?: number;
    visionRadius?: number;
  }
): RegionDefinition {
  return {
    id,
    name: 'Watch Tower',
    type: 'watchtower',
    position,
    elevation: options?.elevation ?? 2,
    radius: options?.radius ?? 6,
    metadata: {
      visionRadius: options?.visionRadius ?? 22,
    },
  };
}

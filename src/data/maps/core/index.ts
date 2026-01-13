/**
 * Core Map System
 *
 * This module provides a connectivity-first map architecture that guarantees
 * walkability by construction. Maps are defined as connectivity graphs where
 * explicit connections define all walkable paths.
 *
 * Key exports:
 * - defineMap() - Define a map using the declarative DSL
 * - generateMapFromDefinition() - Convert definition to MapData
 * - validateMapDefinition() - Validate before generation
 * - MapBuilder - Fluent API for building maps
 */

// Connectivity Graph
export {
  // Types
  type NodeId,
  type RegionType,
  type ConnectionType,
  type ConnectivityNode,
  type ConnectivityEdge,
  type ConnectivityGraph,
  type ConnectivityValidation,
  // Functions
  createConnectivityGraph,
  addNode,
  addEdge,
  getConnectedNodes,
  getEdgesFrom,
  getEdgesTo,
  areConnected,
  findPath,
  getReachableNodes,
  validateConnectivity,
  generateConnectionGeometry,
  getConnectionBounds,
  getNodesByType,
  getPlayerNodes,
  getEdgesByType,
  graphToJSON,
  graphFromJSON,
} from './MapConnectivity';

// Map Definition DSL
export {
  // Types
  type BiomeType,
  type TerrainSurface,
  type DecorationType,
  type MapMeta,
  type MapCanvas,
  type MapSymmetry,
  type RegionDefinition,
  type ConnectionDefinition,
  type ObstacleDefinition,
  type VoidDefinition,
  type WaterDefinition,
  type RoadDefinition,
  type TerrainModifierDefinition,
  type ForestDefinition,
  type WatchTowerDefinition,
  type DestructibleDefinition,
  type BorderWallConfig,
  type BaseEdgeConfig,
  type CliffLineConfig,
  type DecorationCluster,
  type VegetationConfig,
  type ExplicitDecoration,
  type DecorationConfig,
  type MapDefinition,
  // Functions
  defineMap,
  definitionToGraph,
  createMapBuilder,
  applySymmetryToRegions,
  applySymmetryToConnections,
  // Region Templates
  mainBase,
  naturalExpansion,
  thirdExpansion,
  goldExpansion,
  mapCenter,
  chokePoint,
  watchTowerRegion,
  // Builder
  MapBuilder,
} from './MapDefinition';

// Map Generator
export {
  // Types for post-processing
  type GeneratedConnection,
  type TerrainGenerationResult,
  // Main functions
  generateMapFromDefinition,
  generateTerrain,
  generateTerrainWithConnections,
  // Ramp clearance utilities
  getRampClearanceZones,
  isInRampClearance,
  // Debug
  exportGraphDebug,
} from './MapGenerator';

// Map Validator
export {
  type ValidationSeverity,
  type ValidationIssue,
  type ValidationResult,
  validateMapDefinition,
  formatValidationResult,
  assertValidMapDefinition,
} from './MapValidator';

// Declarative Map System (100% JSON-serializable)
export {
  // Geometry primitives
  type Point2D,
  type Size2D,
  type Bounds2D,
  type ShapeType,
  type CircleShape,
  type RectShape,
  type EllipseShape,
  type PolygonShape,
  type LineShape,
  type PathShape,
  type Shape,
  // Biome & Theme
  type BiomeTheme,
  BIOME_THEMES,
  // Region & Connection definitions
  type RegionDef,
  type ConnectionDef,
  // Terrain features
  type VoidArea,
  type WaterArea,
  type CliffWall,
  type UnwalkableArea,
  type RoadPath,
  type SlowArea,
  type ElevationArea,
  type ElevationGradient,
  type TerrainFeatures,
  // Vegetation
  type ForestDensity,
  type VegetationType,
  type ForestArea,
  type BushCluster,
  type VegetationScatter,
  type VegetationConfig as DeclarativeVegetationConfig,
  // Decorations
  type DecorationCategory,
  type RockType,
  type CrystalType,
  type DebrisType,
  type StructureType,
  type DecorationCluster as DeclarativeDecorationCluster,
  type DecorationLine,
  type ExplicitDecoration as DeclarativeExplicitDecoration,
  type BorderDecorations,
  type BaseEdgeDecorations,
  type DecorationConfig as DeclarativeDecorationConfig,
  // Resources
  type ResourceTemplateName,
  type ResourcePlacement,
  type ResourceConfig,
  // Game features
  type WatchTowerDef,
  type DestructibleRockDef,
  type NeutralUnitDef,
  type GameFeatures,
  // Symmetry
  type SymmetryType,
  type SymmetryConfig,
  // Map structure
  type MapMeta as DeclarativeMapMeta,
  type MapCanvas as DeclarativeMapCanvas,
  type DeclarativeMapDef,
  // Helper functions
  circle,
  rect,
  line,
  path,
  mainBase as declarativeMainBase,
  natural,
  expansion,
  center,
  ramp,
  ground,
  choke,
} from './DeclarativeMapTypes';

// Declarative Generator
export {
  generateFromDeclarative,
  validateDeclarativeMap,
  declarativeToMapDefinition,
} from './DeclarativeMapGenerator';

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
  generateMapFromDefinition,
  generateTerrain,
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

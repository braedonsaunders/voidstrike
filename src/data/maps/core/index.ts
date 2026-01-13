/**
 * Core Map System - Paint-Based Elevation Maps with Connectivity
 *
 * A simple, powerful map system where:
 * - Elevation grid IS the terrain (cliffs emerge at height differences)
 * - Paint commands build the map (like Photoshop layers)
 * - Decoration rules create beauty automatically
 * - Connectivity is validated and auto-fixed
 *
 * Key exports:
 * - MapBlueprint - The complete map definition type
 * - generateMap() - Convert blueprint to MapData
 * - Paint command helpers (plateau, ramp, water, etc.)
 * - scaffoldMap() - Auto-generate maps from base positions
 * - Connectivity analysis and validation
 */

// ============================================================================
// ELEVATION MAP TYPES
// ============================================================================

export {
  // Biome types
  type BiomeType,
  type BiomeTheme,
  BIOME_THEMES,

  // Elevation constants
  ELEVATION,
  CLIFF_THRESHOLD,

  // Point helpers
  type Point,
  toXY,

  // Paint command types
  type FillCommand,
  type PlateauCommand,
  type RectCommand,
  type RampCommand,
  type GradientCommand,
  type WaterCommand,
  type ForestCommand,
  type VoidCommand,
  type RoadCommand,
  type UnwalkableCommand,
  type BorderCommand,
  type MudCommand,
  type PaintCommand,

  // Base & resource types
  type BaseType,
  type ResourceDirection,
  type BaseLocation,
  type WatchTowerDef,
  type DestructibleDef,

  // Decoration rules
  type DecorationStyle,
  type BorderDecorationRule,
  type CliffEdgeDecorationRule,
  type ScatterDecorationRule,
  type BaseRingDecorationRule,
  type DecorationRules,

  // Explicit decoration
  type DecorationTypeString,
  type ExplicitDecoration,

  // Map blueprint (the main type)
  type MapMeta,
  type MapCanvas,
  type MapBlueprint,

  // Helper functions for building bases
  mainBase,
  naturalBase,
  thirdBase,
  fourthBase,
  goldBase,

  // Paint command shortcuts
  fill,
  plateau,
  rect,
  ramp,
  water,
  waterRect,
  forest,
  forestRect,
  voidArea,
  voidRect,
  road,
  unwalkable,
  unwalkableRect,
  border,
  mud,
} from './ElevationMap';

// ============================================================================
// MAP GENERATOR
// ============================================================================

export {
  generateMap,
  generateMapWithResult,
  type GenerateMapOptions,
  type GenerateMapResult,
} from './ElevationMapGenerator';

// ============================================================================
// CONNECTIVITY SYSTEM
// ============================================================================

// Graph types
export {
  type NodeType,
  type EdgeType,
  type ConnectivityNode,
  type ConnectivityEdge,
  type ConnectivityGraph,
  type IssueSeverity,
  type ConnectivityIssue,
  type SuggestedFix,
  type ConnectivityResult,
  nodeId,
  parseNodeId,
  edgeKey,
  distance,
  createEmptyGraph,
  createNode,
  createEdge,
} from './ConnectivityGraph';

// Analyzer
export {
  analyzeConnectivity,
  getConnectivitySummary,
} from './ConnectivityAnalyzer';

// Validator
export {
  validateConnectivity,
  getSuggestedFixes,
  formatValidationResult,
} from './ConnectivityValidator';

// Fixer
export {
  type FixResult,
  applyFixes,
  autoFixConnectivity,
  getRequiredRamps,
  needsConnectivityFixes,
  formatFixResult,
} from './ConnectivityFixer';

// ============================================================================
// MAP SCAFFOLDER
// ============================================================================

export {
  type MapScaffold,
  type DesiredConnection,
  type ScaffoldConfig,
  scaffoldMap,
  scaffold1v1Diagonal,
  scaffold1v1Horizontal,
  scaffold4Player,
  addTerrain,
} from './MapScaffolder';

// Map exports - base types and utilities
export * from './MapTypes';

// NEW: Paint-Based Elevation Map System with Connectivity
// This is the recommended way to create new maps
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
  type PaintCommand,
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

  // Generator
  generateMap,
  generateMapWithResult,
  type GenerateMapOptions,
  type GenerateMapResult,

  // Connectivity system
  type ConnectivityGraph,
  type ConnectivityNode,
  type ConnectivityEdge,
  type ConnectivityResult,
  type ConnectivityIssue,
  type SuggestedFix,
  analyzeConnectivity,
  validateConnectivity,
  autoFixConnectivity,
  getConnectivitySummary,
  formatValidationResult,

  // Map scaffolder
  type MapScaffold,
  type ScaffoldConfig,
  scaffoldMap,
  scaffold1v1Diagonal,
  scaffold1v1Horizontal,
  scaffold4Player,
  addTerrain,
} from './core';

// JSON-based map exports (primary source of truth)
// Maps are auto-discovered from src/data/maps/json/*.json
// Just drop a new .json file in that folder to add a map
export {
  ALL_MAPS,
  MAPS_BY_PLAYER_COUNT,
  RANKED_MAPS,
  getMapById,
  getMapsForPlayerCount,
  getAllMaps,
  DEFAULT_MAP,
} from './json';

// Serialization utilities for map export/import
export * from './serialization';
export * from './schema';

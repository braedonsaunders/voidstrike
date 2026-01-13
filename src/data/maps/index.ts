// Map exports - base types and utilities
export * from './MapTypes';

// NEW: Connectivity-First Map System
// This is the recommended way to create new maps
// Re-export with explicit names to avoid conflicts with MapTypes
export {
  // Connectivity Graph (from MapConnectivity)
  type NodeId,
  type RegionType,
  type ConnectionType,
  type ConnectivityNode,
  type ConnectivityEdge,
  type ConnectivityGraph,
  type ConnectivityValidation as GraphValidation, // Renamed to avoid conflict with MapTypes.ConnectivityValidation
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
  // Map Definition DSL (from MapDefinition) - DecorationType omitted, use MapTypes version
  type BiomeType,
  type TerrainSurface,
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
  defineMap,
  definitionToGraph,
  createMapBuilder,
  applySymmetryToRegions,
  applySymmetryToConnections,
  mainBase,
  naturalExpansion,
  thirdExpansion,
  goldExpansion,
  mapCenter,
  chokePoint,
  watchTowerRegion,
  MapBuilder,
  // Map Generator (from MapGenerator)
  type GeneratedConnection,
  type TerrainGenerationResult,
  generateMapFromDefinition,
  generateTerrain,
  generateTerrainWithConnections,
  getRampClearanceZones,
  isInRampClearance,
  exportGraphDebug,
  // Map Validator (from MapValidator)
  type ValidationSeverity,
  type ValidationIssue,
  type ValidationResult,
  validateMapDefinition,
  formatValidationResult,
  assertValidMapDefinition,
} from './core';

// Map exports (all using connectivity-first system)
export { VOID_ASSAULT } from './VoidAssault';
export { CRYSTAL_CAVERNS } from './CrystalCaverns';
export { SCORCHED_BASIN } from './ScorchedBasin';
export { CONTESTED_FRONTIER } from './ContestedFrontier';
export { TITANS_COLOSSEUM } from './TitansColosseum';
export { BATTLE_ARENA } from './BattleArena';

import { MapData } from './MapTypes';
import { VOID_ASSAULT } from './VoidAssault';
import { CRYSTAL_CAVERNS } from './CrystalCaverns';
import { SCORCHED_BASIN } from './ScorchedBasin';
import { CONTESTED_FRONTIER } from './ContestedFrontier';
import { TITANS_COLOSSEUM } from './TitansColosseum';
import { BATTLE_ARENA } from './BattleArena';

// All available maps
export const ALL_MAPS: Record<string, MapData> = {
  [VOID_ASSAULT.id]: VOID_ASSAULT,
  [CRYSTAL_CAVERNS.id]: CRYSTAL_CAVERNS,
  [SCORCHED_BASIN.id]: SCORCHED_BASIN,
  [CONTESTED_FRONTIER.id]: CONTESTED_FRONTIER,
  [TITANS_COLOSSEUM.id]: TITANS_COLOSSEUM,
  [BATTLE_ARENA.id]: BATTLE_ARENA,
};

// Maps by player count
export const MAPS_BY_PLAYER_COUNT: Record<2 | 4 | 6 | 8, MapData[]> = {
  2: [CRYSTAL_CAVERNS, VOID_ASSAULT],
  4: [SCORCHED_BASIN],
  6: [CONTESTED_FRONTIER],
  8: [TITANS_COLOSSEUM],
};

// Maps available for ranked play
export const RANKED_MAPS: MapData[] = Object.values(ALL_MAPS).filter(m => m.isRanked);

// Get map by ID
export function getMapById(id: string): MapData | undefined {
  return ALL_MAPS[id];
}

// Get maps for a specific player count
export function getMapsForPlayerCount(count: 2 | 4 | 6 | 8): MapData[] {
  return MAPS_BY_PLAYER_COUNT[count] || [];
}

// Default map for quick play (2-player 1v1)
export const DEFAULT_MAP = CRYSTAL_CAVERNS;

// Map exports - base types and utilities
export * from './MapTypes';

// NEW: Paint-Based Elevation Map System
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
} from './core';

// Map exports (all using paint-based elevation system)
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
  2: [CRYSTAL_CAVERNS, VOID_ASSAULT, BATTLE_ARENA],
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

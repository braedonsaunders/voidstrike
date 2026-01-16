/**
 * JSON Map Imports
 *
 * This file imports all map JSON files and converts them to MapData.
 * Add new maps by placing .json files in this directory and adding an import here.
 */

import type { MapData } from '../MapTypes';
import type { MapJson } from '../schema/MapJsonSchema';
import { jsonToMapData } from '../serialization/deserialize';

// Import JSON map files
import crystalCavernsJson from './crystal_caverns.json';
import voidAssaultJson from './void_assault.json';
import scorchedBasinJson from './scorched_basin.json';
import contestedFrontierJson from './contested_frontier.json';
import titansColosseumJson from './titans_colosseum.json';
import battleArenaJson from './battle_arena.json';

// Convert JSON to MapData
export const CRYSTAL_CAVERNS: MapData = jsonToMapData(crystalCavernsJson as MapJson);
export const VOID_ASSAULT: MapData = jsonToMapData(voidAssaultJson as MapJson);
export const SCORCHED_BASIN: MapData = jsonToMapData(scorchedBasinJson as MapJson);
export const CONTESTED_FRONTIER: MapData = jsonToMapData(contestedFrontierJson as MapJson);
export const TITANS_COLOSSEUM: MapData = jsonToMapData(titansColosseumJson as MapJson);
export const BATTLE_ARENA: MapData = jsonToMapData(battleArenaJson as MapJson);

// All maps registry
export const ALL_MAPS: Record<string, MapData> = {
  [CRYSTAL_CAVERNS.id]: CRYSTAL_CAVERNS,
  [VOID_ASSAULT.id]: VOID_ASSAULT,
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

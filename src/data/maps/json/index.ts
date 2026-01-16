/**
 * JSON Map Registry
 *
 * To add a new map:
 * 1. Drop your .json map file into this folder (src/data/maps/json/)
 * 2. Add an entry to registry.json with the filename and player count
 *
 * Example registry.json entry:
 * { "file": "my_custom_map.json", "playerCount": 2 }
 */

import type { MapData } from '../MapTypes';
import type { MapJson } from '../schema/MapJsonSchema';
import { jsonToMapData } from '../serialization/deserialize';

// Import registry and all map files
import registryData from './registry.json';
import crystalCavernsJson from './crystal_caverns.json';
import voidAssaultJson from './void_assault.json';
import scorchedBasinJson from './scorched_basin.json';
import contestedFrontierJson from './contested_frontier.json';
import titansColosseumJson from './titans_colosseum.json';
import battleArenaJson from './battle_arena.json';

// Map file name to imported JSON (add new maps here)
const mapFiles: Record<string, unknown> = {
  'crystal_caverns.json': crystalCavernsJson,
  'void_assault.json': voidAssaultJson,
  'scorched_basin.json': scorchedBasinJson,
  'contested_frontier.json': contestedFrontierJson,
  'titans_colosseum.json': titansColosseumJson,
  'battle_arena.json': battleArenaJson,
};

// Registry type
interface MapRegistry {
  maps: Array<{
    file: string;
    playerCount: 2 | 4 | 6 | 8;
  }>;
}

const registry = registryData as MapRegistry;

// Load all maps from registry
const loadedMaps: MapData[] = [];
for (const entry of registry.maps) {
  const json = mapFiles[entry.file];
  if (json) {
    const mapData = jsonToMapData(json as MapJson);
    loadedMaps.push(mapData);
  } else {
    console.warn(`Map file not found: ${entry.file} - Add import above`);
  }
}

// All maps registry (by ID)
export const ALL_MAPS: Record<string, MapData> = {};
for (const map of loadedMaps) {
  ALL_MAPS[map.id] = map;
}

// Maps by player count (from registry)
export const MAPS_BY_PLAYER_COUNT: Record<2 | 4 | 6 | 8, MapData[]> = {
  2: [],
  4: [],
  6: [],
  8: [],
};

for (const entry of registry.maps) {
  const json = mapFiles[entry.file];
  if (json) {
    const mapData = jsonToMapData(json as MapJson);
    MAPS_BY_PLAYER_COUNT[entry.playerCount].push(mapData);
  }
}

// Export individual maps for direct access
export const CRYSTAL_CAVERNS = ALL_MAPS['crystal-caverns'];
export const VOID_ASSAULT = ALL_MAPS['void-assault'];
export const SCORCHED_BASIN = ALL_MAPS['scorched-basin'];
export const CONTESTED_FRONTIER = ALL_MAPS['contested-frontier'];
export const TITANS_COLOSSEUM = ALL_MAPS['titans-colosseum'];
export const BATTLE_ARENA = ALL_MAPS['battle-arena'];

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
export const DEFAULT_MAP = CRYSTAL_CAVERNS || loadedMaps[0];

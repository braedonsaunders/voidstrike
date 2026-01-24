/**
 * JSON Map Registry
 *
 * Maps are explicitly imported to ensure reliable bundling across all bundlers
 * (webpack, Turbopack, etc.). require.context is webpack-specific and may not
 * work consistently with Next.js 16+ Turbopack.
 *
 * To add a new map:
 * 1. Add your .json map file to this folder (src/data/maps/json/)
 * 2. Add an import statement below
 * 3. Add it to the MAP_JSON_FILES array
 */

import type { MapData } from '../MapTypes';
import type { MapJson } from '../schema/MapJsonSchema';
import { jsonToMapData } from '../serialization/deserialize';
import { debugAssets } from '@/utils/debugLogger';

// Explicit imports for reliable bundling
import battleArenaJson from './battle_arena.json';
import contestedFrontierJson from './contested_frontier.json';
import crystalCavernsJson from './crystal_caverns.json';
import scorchedBasinJson from './scorched_basin.json';
import test6pFlatJson from './test_6p_flat.json';
import titansColosseumJson from './titans_colosseum.json';
import voidAssaultJson from './void_assault.json';

// All map JSON files - add new maps here
const MAP_JSON_FILES: MapJson[] = [
  battleArenaJson as MapJson,
  contestedFrontierJson as MapJson,
  crystalCavernsJson as MapJson,
  scorchedBasinJson as MapJson,
  test6pFlatJson as MapJson,
  titansColosseumJson as MapJson,
  voidAssaultJson as MapJson,
];

// Load all maps
const loadedMaps: MapData[] = [];
const loadErrors: string[] = [];

for (const json of MAP_JSON_FILES) {
  try {
    // Validate required fields exist
    if (!json.id || typeof json.id !== 'string') {
      loadErrors.push(`Map missing or invalid 'id' field`);
      continue;
    }
    if (!json.playerCount || ![2, 4, 6, 8].includes(json.playerCount)) {
      loadErrors.push(`${json.id}: Missing or invalid 'playerCount' (must be 2, 4, 6, or 8)`);
      continue;
    }

    const mapData = jsonToMapData(json);
    loadedMaps.push(mapData);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const mapId = json?.id || 'unknown';
    loadErrors.push(`${mapId}: ${message}`);
  }
}

// Log any load errors
if (loadErrors.length > 0) {
  debugAssets.warn('[Maps] Load errors:', loadErrors);
}

// Log loaded maps
debugAssets.log(`[Maps] Loaded ${loadedMaps.length} maps:`, loadedMaps.map(m => m.id).join(', '));

// All maps registry (by ID) - includes special mode maps
export const ALL_MAPS: Record<string, MapData> = {};
for (const map of loadedMaps) {
  ALL_MAPS[map.id] = map;
}

// Maps by player count (extracted from map JSON)
export const MAPS_BY_PLAYER_COUNT: Record<2 | 4 | 6 | 8, MapData[]> = {
  2: [],
  4: [],
  6: [],
  8: [],
};

for (const map of loadedMaps) {
  const count = map.playerCount as 2 | 4 | 6 | 8;
  if (MAPS_BY_PLAYER_COUNT[count]) {
    MAPS_BY_PLAYER_COUNT[count].push(map);
  }
}

// Maps available for ranked play
export const RANKED_MAPS: MapData[] = loadedMaps.filter(m => m.isRanked);

// Get map by ID
export function getMapById(id: string): MapData | undefined {
  return ALL_MAPS[id];
}

// Get maps for a specific player count
export function getMapsForPlayerCount(count: 2 | 4 | 6 | 8): MapData[] {
  return MAPS_BY_PLAYER_COUNT[count] || [];
}

// Get all loaded maps
export function getAllMaps(): MapData[] {
  return [...loadedMaps];
}

// Default map for quick play (prefer ranked 2-player map)
export const DEFAULT_MAP =
  RANKED_MAPS.find(m => m.playerCount === 2) ||
  MAPS_BY_PLAYER_COUNT[2][0] ||
  loadedMaps[0];

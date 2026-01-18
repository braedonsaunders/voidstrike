/**
 * JSON Map Auto-Discovery
 *
 * To add a new map:
 * Simply drop your .json map file into this folder (src/data/maps/json/)
 * It will be automatically discovered and loaded at build time.
 *
 * Requirements for map JSON:
 * - Must have a valid "id" field (string)
 * - Must have "playerCount" field (2, 4, 6, or 8)
 * - Must follow the MapJson schema (see schema/MapJsonSchema.ts)
 */

import type { MapData } from '../MapTypes';
import type { MapJson } from '../schema/MapJsonSchema';
import { jsonToMapData } from '../serialization/deserialize';
import { debugTerrain } from '@/utils/debugLogger';

// Webpack require.context to auto-discover all JSON files in this folder
// This runs at build time and bundles all matching files
const mapContext = require.context('./', false, /^\.\/(?!registry).*\.json$/);

// Load all discovered maps
const loadedMaps: MapData[] = [];
const loadErrors: string[] = [];

for (const key of mapContext.keys()) {
  try {
    const json = mapContext(key) as MapJson;

    // Validate required fields exist
    if (!json.id || typeof json.id !== 'string') {
      loadErrors.push(`${key}: Missing or invalid 'id' field`);
      continue;
    }
    if (!json.playerCount || ![2, 4, 6, 8].includes(json.playerCount)) {
      loadErrors.push(`${key}: Missing or invalid 'playerCount' (must be 2, 4, 6, or 8)`);
      continue;
    }

    const mapData = jsonToMapData(json);
    loadedMaps.push(mapData);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loadErrors.push(`${key}: ${message}`);
  }
}

// Log any load errors in development
if (loadErrors.length > 0 && process.env.NODE_ENV === 'development') {
  debugTerrain.warn('Map loading errors:', loadErrors);
}

// All maps registry (by ID)
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

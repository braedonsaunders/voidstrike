/**
 * Map Loader
 *
 * Loads map data from JSON files in public/data/maps/
 * Supports both client-side (fetch) and pre-loaded modes.
 */

import type { MapData } from './MapTypes';
import type { MapJson } from './schema/MapJsonSchema';
import { validateMapJson } from './schema/MapJsonSchema';
import { jsonToMapData } from './serialization/deserialize';

/** Cache of loaded maps */
const mapCache: Map<string, MapData> = new Map();

/** Registry of all available map IDs */
let mapRegistry: string[] | null = null;

/**
 * Base URL for map JSON files
 * In Next.js, public/ files are served from root
 */
const MAP_BASE_URL = '/data/maps';

/**
 * Fetch and parse a single map JSON file
 * @param id Map identifier (filename without .json)
 */
export async function fetchMap(id: string): Promise<MapData> {
  // Check cache first
  const cached = mapCache.get(id);
  if (cached) return cached;

  const url = `${MAP_BASE_URL}/${id}.json`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load map '${id}': ${response.statusText}`);
  }

  const json = await response.json();

  if (!validateMapJson(json)) {
    throw new Error(`Invalid map format for '${id}'`);
  }

  const mapData = jsonToMapData(json as MapJson);

  // Cache the result
  mapCache.set(id, mapData);

  return mapData;
}

/**
 * Load a map by ID (async)
 * Alias for fetchMap for API consistency
 */
export const loadMap = fetchMap;

/**
 * Fetch the map registry (list of available map IDs)
 */
export async function fetchMapRegistry(): Promise<string[]> {
  if (mapRegistry) return mapRegistry;

  const url = `${MAP_BASE_URL}/registry.json`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load map registry: ${response.statusText}`);
  }

  const json = await response.json();

  if (!Array.isArray(json) || !json.every((id) => typeof id === 'string')) {
    throw new Error('Invalid map registry format');
  }

  mapRegistry = json;
  return json;
}

/**
 * Fetch all maps from registry
 */
export async function fetchAllMaps(): Promise<Record<string, MapData>> {
  const registry = await fetchMapRegistry();
  const maps: Record<string, MapData> = {};

  await Promise.all(
    registry.map(async (id) => {
      try {
        maps[id] = await fetchMap(id);
      } catch (error) {
        console.error(`Failed to load map '${id}':`, error);
      }
    })
  );

  return maps;
}

/**
 * Get maps by player count
 */
export async function fetchMapsByPlayerCount(
  count: 2 | 4 | 6 | 8
): Promise<MapData[]> {
  const allMaps = await fetchAllMaps();
  return Object.values(allMaps).filter((map) => map.playerCount === count);
}

/**
 * Get ranked maps only
 */
export async function fetchRankedMaps(): Promise<MapData[]> {
  const allMaps = await fetchAllMaps();
  return Object.values(allMaps).filter((map) => map.isRanked);
}

/**
 * Clear the map cache (useful for development/hot reload)
 */
export function clearMapCache(): void {
  mapCache.clear();
  mapRegistry = null;
}

/**
 * Pre-load maps into cache from static JSON objects
 * Used when maps are bundled at build time
 */
export function registerMaps(maps: Record<string, MapJson>): void {
  for (const [id, json] of Object.entries(maps)) {
    if (validateMapJson(json)) {
      const mapData = jsonToMapData(json);
      mapCache.set(id, mapData);
    }
  }

  // Update registry with cached map IDs
  mapRegistry = Array.from(mapCache.keys());
}

/**
 * Register a single map from JSON object
 */
export function registerMap(json: MapJson): MapData {
  if (!validateMapJson(json)) {
    throw new Error(`Invalid map format for '${(json as { id?: string }).id || 'unknown'}'`);
  }

  const mapData = jsonToMapData(json);
  mapCache.set(mapData.id, mapData);

  // Update registry
  if (mapRegistry && !mapRegistry.includes(mapData.id)) {
    mapRegistry.push(mapData.id);
  }

  return mapData;
}

/**
 * Check if a map is loaded in cache
 */
export function isMapLoaded(id: string): boolean {
  return mapCache.has(id);
}

/**
 * Get a map from cache (returns undefined if not loaded)
 */
export function getMapFromCache(id: string): MapData | undefined {
  return mapCache.get(id);
}

/**
 * Get all cached maps
 */
export function getAllCachedMaps(): Record<string, MapData> {
  const result: Record<string, MapData> = {};
  for (const [id, map] of mapCache) {
    result[id] = map;
  }
  return result;
}

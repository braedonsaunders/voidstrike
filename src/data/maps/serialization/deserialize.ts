/**
 * Map Deserialization - Convert JSON format to MapData
 */

import type {
  MapData,
  MapCell,
  TerrainType,
  TerrainFeature,
  SpawnPoint,
  Expansion,
  WatchTower,
  Ramp,
  DestructibleRock,
  MapDecoration,
  ResourceNode,
} from '../MapTypes';
import type { MapJson, TerrainJson, SparseFeature } from '../schema/MapJsonSchema';
import { TERRAIN_CHAR_MAP, validateMapJson } from '../schema/MapJsonSchema';

/**
 * Deserialize terrain types from compact string
 */
export function deserializeTerrainTypes(
  types: string,
  width: number,
  height: number
): TerrainType[][] {
  const result: TerrainType[][] = [];

  for (let y = 0; y < height; y++) {
    result[y] = [];
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const char = types[index] || 'g';
      result[y][x] = (TERRAIN_CHAR_MAP[char as keyof typeof TERRAIN_CHAR_MAP] || 'ground') as TerrainType;
    }
  }

  return result;
}

/**
 * Deserialize elevation from flat array to 2D grid
 */
export function deserializeElevation(
  elevation: number[],
  width: number,
  height: number
): number[][] {
  const result: number[][] = [];

  for (let y = 0; y < height; y++) {
    result[y] = [];
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      result[y][x] = elevation[index] ?? 140;
    }
  }

  return result;
}

/**
 * Apply sparse features to a feature grid
 */
export function applySparseFeatures(
  width: number,
  height: number,
  features: SparseFeature[]
): TerrainFeature[][] {
  // Initialize with 'none'
  const result: TerrainFeature[][] = [];
  for (let y = 0; y < height; y++) {
    result[y] = [];
    for (let x = 0; x < width; x++) {
      result[y][x] = 'none';
    }
  }

  // Apply sparse features
  for (const { x, y, f } of features) {
    if (y >= 0 && y < height && x >= 0 && x < width) {
      result[y][x] = f;
    }
  }

  return result;
}

/**
 * Deserialize terrain JSON to MapCell grid
 */
export function deserializeTerrain(
  terrain: TerrainJson,
  width: number,
  height: number
): MapCell[][] {
  const types = deserializeTerrainTypes(terrain.types, width, height);
  const elevation = deserializeElevation(terrain.elevation, width, height);
  const features = applySparseFeatures(width, height, terrain.features);

  const result: MapCell[][] = [];

  for (let y = 0; y < height; y++) {
    result[y] = [];
    for (let x = 0; x < width; x++) {
      result[y][x] = {
        terrain: types[y][x],
        elevation: elevation[y][x],
        feature: features[y][x],
        textureId: Math.floor(Math.random() * 4), // Randomize visual variety
      };
    }
  }

  return result;
}

/**
 * Convert JSON format to runtime MapData
 */
export function jsonToMapData(json: MapJson): MapData {
  const terrain = deserializeTerrain(json.terrain, json.width, json.height);

  return {
    id: json.id,
    name: json.name,
    author: json.author,
    description: json.description,
    width: json.width,
    height: json.height,
    biome: json.biome,
    playerCount: json.playerCount,
    maxPlayers: json.maxPlayers,
    isRanked: json.isRanked,
    thumbnailUrl: json.thumbnailUrl,

    terrain,

    spawns: json.spawns.map((s): SpawnPoint => ({
      x: s.x,
      y: s.y,
      playerSlot: s.playerSlot,
      rotation: s.rotation,
    })),

    expansions: json.expansions.map((e): Expansion => ({
      name: e.name,
      x: e.x,
      y: e.y,
      minerals: e.minerals.map((m): ResourceNode => ({
        x: m.x,
        y: m.y,
        type: m.type,
        amount: m.amount,
      })),
      vespene: e.vespene.map((v): ResourceNode => ({
        x: v.x,
        y: v.y,
        type: v.type,
        amount: v.amount,
      })),
      isMain: e.isMain,
      isNatural: e.isNatural,
    })),

    watchTowers: json.watchTowers.map((w): WatchTower => ({
      x: w.x,
      y: w.y,
      radius: w.radius,
    })),

    ramps: json.ramps.map((r): Ramp => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      direction: r.direction,
      fromElevation: r.fromElevation,
      toElevation: r.toElevation,
    })),

    destructibles: json.destructibles.map((d): DestructibleRock => ({
      x: d.x,
      y: d.y,
      health: d.health,
    })),

    decorations: json.decorations?.map((d): MapDecoration => ({
      type: d.type,
      x: d.x,
      y: d.y,
      scale: d.scale,
      rotation: d.rotation,
    })),
  };
}

/**
 * Parse and deserialize a JSON string to MapData
 * @throws Error if JSON is invalid or doesn't match schema
 */
export function parseMapJson(jsonString: string): MapData {
  const parsed = JSON.parse(jsonString);

  if (!validateMapJson(parsed)) {
    throw new Error('Invalid map JSON format');
  }

  return jsonToMapData(parsed);
}

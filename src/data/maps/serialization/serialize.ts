/**
 * Map Serialization - Convert MapData to JSON format
 */

import type { MapData, MapCell } from '../MapTypes';
import type {
  MapJson,
  TerrainJson,
  SparseFeature,
  SpawnPointJson,
  ExpansionJson,
  WatchTowerJson,
  RampJson,
  DestructibleJson,
  DecorationJson,
  ResourceNodeJson,
} from '../schema/MapJsonSchema';
import { TERRAIN_TO_CHAR } from '../schema/MapJsonSchema';

/**
 * Serialize terrain types to a compact single-character string
 * Row-major order: (0,0), (1,0), (2,0), ... (width-1,0), (0,1), ...
 */
export function serializeTerrainTypes(terrain: MapCell[][]): string {
  const height = terrain.length;
  const width = terrain[0]?.length ?? 0;
  let result = '';

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = terrain[y][x];
      result += TERRAIN_TO_CHAR[cell.terrain] || 'g';
    }
  }

  return result;
}

/**
 * Serialize elevation grid to flat number array
 * Row-major order
 */
export function serializeElevation(terrain: MapCell[][]): number[] {
  const height = terrain.length;
  const width = terrain[0]?.length ?? 0;
  const result: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      result.push(terrain[y][x].elevation);
    }
  }

  return result;
}

/**
 * Serialize terrain features to sparse array
 * Only includes cells with non-'none' features
 */
export function serializeSparseFeatures(terrain: MapCell[][]): SparseFeature[] {
  const height = terrain.length;
  const width = terrain[0]?.length ?? 0;
  const result: SparseFeature[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const feature = terrain[y][x].feature;
      if (feature && feature !== 'none') {
        result.push({ x, y, f: feature });
      }
    }
  }

  return result;
}

/**
 * Serialize complete terrain grid to compact JSON format
 */
export function serializeTerrain(terrain: MapCell[][]): TerrainJson {
  return {
    elevation: serializeElevation(terrain),
    types: serializeTerrainTypes(terrain),
    features: serializeSparseFeatures(terrain),
  };
}

/**
 * Convert MapData to JSON format for storage/export
 */
export function mapDataToJson(map: MapData): MapJson {
  return {
    id: map.id,
    name: map.name,
    author: map.author,
    description: map.description,
    width: map.width,
    height: map.height,
    biome: map.biome,
    playerCount: map.playerCount,
    maxPlayers: map.maxPlayers,
    isRanked: map.isRanked,
    thumbnailUrl: map.thumbnailUrl,

    terrain: serializeTerrain(map.terrain),

    spawns: map.spawns.map((s): SpawnPointJson => ({
      x: s.x,
      y: s.y,
      playerSlot: s.playerSlot,
      rotation: s.rotation,
    })),

    expansions: map.expansions.map((e): ExpansionJson => ({
      name: e.name,
      x: e.x,
      y: e.y,
      minerals: e.minerals.map((m): ResourceNodeJson => ({
        x: m.x,
        y: m.y,
        type: m.type,
        amount: m.amount,
      })),
      plasma: e.plasma.map((v): ResourceNodeJson => ({
        x: v.x,
        y: v.y,
        type: v.type,
        amount: v.amount,
      })),
      isMain: e.isMain,
      isNatural: e.isNatural,
    })),

    watchTowers: map.watchTowers.map((w): WatchTowerJson => ({
      x: w.x,
      y: w.y,
      radius: w.radius,
    })),

    ramps: map.ramps.map((r): RampJson => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      direction: r.direction,
      fromElevation: r.fromElevation,
      toElevation: r.toElevation,
    })),

    destructibles: map.destructibles.map((d): DestructibleJson => ({
      x: d.x,
      y: d.y,
      health: d.health,
    })),

    decorations: map.decorations?.map((d): DecorationJson => ({
      type: d.type,
      x: d.x,
      y: d.y,
      scale: d.scale,
      rotation: d.rotation,
    })),
  };
}

/**
 * Serialize MapData to JSON string
 * @param map The map data to serialize
 * @param pretty If true, format with indentation for readability
 */
export function serializeMapToJsonString(map: MapData, pretty = true): string {
  const json = mapDataToJson(map);
  return pretty ? JSON.stringify(json, null, 2) : JSON.stringify(json);
}

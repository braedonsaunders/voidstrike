/**
 * JSON Schema for Map Files
 *
 * Maps are stored as JSON files in public/data/maps/
 * This schema defines the compact storage format.
 */

import type { BiomeType } from '@/rendering/Biomes';
import type {
  TerrainFeature,
  DecorationType,
} from '../MapTypes';

/**
 * Terrain type character mappings for compact storage
 * Single character per cell reduces file size by ~20x
 */
export const TERRAIN_CHAR_MAP = {
  'g': 'ground',
  'p': 'platform',
  'u': 'unwalkable',
  'r': 'ramp',
  'b': 'unbuildable',
  'c': 'creep',
} as const;

export const TERRAIN_TO_CHAR: Record<string, string> = {
  'ground': 'g',
  'platform': 'p',
  'unwalkable': 'u',
  'ramp': 'r',
  'unbuildable': 'b',
  'creep': 'c',
};

export type TerrainChar = keyof typeof TERRAIN_CHAR_MAP;

/**
 * Sparse feature entry - only stores non-'none' features
 */
export interface SparseFeature {
  x: number;
  y: number;
  f: TerrainFeature;
}

/**
 * Compact terrain storage format
 */
export interface TerrainJson {
  /** Flat array of elevation values (0-255), row-major order */
  elevation: number[];

  /** Single character per cell string (g=ground, p=platform, u=unwalkable, r=ramp, b=unbuildable, c=creep) */
  types: string;

  /** Sparse array of non-'none' terrain features */
  features: SparseFeature[];
}

/**
 * Resource node in JSON format
 */
export interface ResourceNodeJson {
  x: number;
  y: number;
  type: 'minerals' | 'vespene';
  amount: number;
}

/**
 * Spawn point in JSON format
 */
export interface SpawnPointJson {
  x: number;
  y: number;
  playerSlot: number;
  rotation: number;
}

/**
 * Expansion in JSON format
 */
export interface ExpansionJson {
  name: string;
  x: number;
  y: number;
  minerals: ResourceNodeJson[];
  vespene: ResourceNodeJson[];
  isMain?: boolean;
  isNatural?: boolean;
}

/**
 * Watch tower in JSON format
 */
export interface WatchTowerJson {
  x: number;
  y: number;
  radius: number;
}

/**
 * Ramp in JSON format
 */
export interface RampJson {
  x: number;
  y: number;
  width: number;
  height: number;
  direction: 'north' | 'south' | 'east' | 'west';
  fromElevation: number;  // 0-255 scale
  toElevation: number;    // 0-255 scale
}

/**
 * Destructible rock in JSON format
 */
export interface DestructibleJson {
  x: number;
  y: number;
  health: number;
}

/**
 * Map decoration in JSON format
 */
export interface DecorationJson {
  type: DecorationType;
  x: number;
  y: number;
  scale?: number;
  rotation?: number;
}

/**
 * Complete map JSON format
 * This is the structure stored in public/data/maps/*.json
 */
export interface MapJson {
  /** Unique map identifier */
  id: string;

  /** Display name */
  name: string;

  /** Map author */
  author: string;

  /** Map description */
  description: string;

  /** Map dimensions */
  width: number;
  height: number;

  /** Visual biome theme */
  biome: BiomeType;

  /** Designed player count */
  playerCount: 2 | 4 | 6 | 8;

  /** Maximum supported players */
  maxPlayers: number;

  /** Available in ranked matchmaking */
  isRanked: boolean;

  /** Special mode map (hidden from lobby selection, e.g., battle simulator) */
  isSpecialMode?: boolean;

  /** Optional thumbnail URL */
  thumbnailUrl?: string;

  /** Compact terrain data */
  terrain: TerrainJson;

  /** Player spawn points */
  spawns: SpawnPointJson[];

  /** Base/expansion locations with resources */
  expansions: ExpansionJson[];

  /** Vision-granting towers */
  watchTowers: WatchTowerJson[];

  /** Ramp definitions for pathfinding */
  ramps: RampJson[];

  /** Destructible obstacles */
  destructibles: DestructibleJson[];

  /** Decorative objects */
  decorations?: DecorationJson[];
}

/**
 * Validate a map JSON object has required fields
 */
export function validateMapJson(json: unknown): json is MapJson {
  if (typeof json !== 'object' || json === null) return false;

  const map = json as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ['id', 'name', 'author', 'description', 'biome'];
  for (const field of requiredStrings) {
    if (typeof map[field] !== 'string') return false;
  }

  // Required number fields
  const requiredNumbers = ['width', 'height', 'playerCount', 'maxPlayers'];
  for (const field of requiredNumbers) {
    if (typeof map[field] !== 'number') return false;
  }

  // Required boolean
  if (typeof map.isRanked !== 'boolean') return false;

  // Required terrain object
  if (typeof map.terrain !== 'object' || map.terrain === null) return false;
  const terrain = map.terrain as Record<string, unknown>;
  if (!Array.isArray(terrain.elevation)) return false;
  if (typeof terrain.types !== 'string') return false;
  if (!Array.isArray(terrain.features)) return false;

  // Required arrays
  const requiredArrays = ['spawns', 'expansions', 'watchTowers', 'ramps', 'destructibles'];
  for (const field of requiredArrays) {
    if (!Array.isArray(map[field])) return false;
  }

  return true;
}

import { MapData, createTerrainGrid } from './MapTypes';

/**
 * BATTLE ARENA - Simple flat map for Battle Simulator mode
 *
 * A minimal 64x64 flat arena with no resources or bases.
 * Designed for spawning and testing unit combat.
 */

const MAP_WIDTH = 64;
const MAP_HEIGHT = 64;

// Create flat terrain
const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 1, 'none');

export const BATTLE_ARENA: MapData = {
  id: 'battle_arena',
  name: 'Battle Arena',
  author: 'System',
  description: 'Simple flat arena for Battle Simulator mode',

  width: MAP_WIDTH,
  height: MAP_HEIGHT,

  terrain,

  // No spawns needed - simulator handles spawning
  spawns: [],

  // No expansions or resources
  expansions: [],

  // No towers, ramps, or destructibles
  watchTowers: [],
  ramps: [],
  destructibles: [],

  // No decorations - keep it clean
  decorations: [],

  playerCount: 2,
  maxPlayers: 2,
  isRanked: false,

  // Desert biome for clear visibility
  biome: 'desert',
};

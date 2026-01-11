import { MapData, MapDecoration, createTerrainGrid } from './MapTypes';

/**
 * BATTLE ARENA - Long horizontal bridge map for Battle Simulator mode
 *
 * A 128x48 rectangular arena shaped like a bridge where two armies
 * face each other from opposite ends.
 * Designed for spawning and testing unit combat.
 */

const MAP_WIDTH = 128;
const MAP_HEIGHT = 48;

// Create flat terrain
const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 1, 'none');

// Sparse decorations along the edges (like pillars on a bridge)
const decorations: MapDecoration[] = [];

// Add rock pillars along the top and bottom edges
for (let x = 16; x < MAP_WIDTH - 16; x += 24) {
  // Top edge
  decorations.push({
    type: 'rocks_large',
    x: x,
    y: 4,
    scale: 0.8,
  });
  // Bottom edge
  decorations.push({
    type: 'rocks_large',
    x: x,
    y: MAP_HEIGHT - 4,
    scale: 0.8,
  });
}

export const BATTLE_ARENA: MapData = {
  id: 'battle_arena',
  name: 'Battle Arena',
  author: 'System',
  description: 'Long bridge arena for Battle Simulator mode',

  width: MAP_WIDTH,
  height: MAP_HEIGHT,

  terrain,

  // Spawns for camera positioning (placed on opposite ends)
  spawns: [
    { x: 20, y: MAP_HEIGHT / 2, playerSlot: 1, rotation: 0 },
    { x: MAP_WIDTH - 20, y: MAP_HEIGHT / 2, playerSlot: 2, rotation: Math.PI },
  ],

  // No expansions or resources
  expansions: [],

  // No towers, ramps, or destructibles
  watchTowers: [],
  ramps: [],
  destructibles: [],

  // Sparse decorations
  decorations,

  playerCount: 2,
  maxPlayers: 2,
  isRanked: false,

  // Desert biome for clear visibility
  biome: 'desert',
};

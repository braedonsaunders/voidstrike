/**
 * BATTLE ARENA - Long horizontal bridge map for Battle Simulator mode
 *
 * A 128x48 rectangular arena shaped like a bridge where two armies
 * face each other from opposite ends.
 * Designed for spawning and testing unit combat.
 */

import {
  defineMap,
  generateMapFromDefinition,
  type MapDefinition,
} from './core';

const MAP_WIDTH = 128;
const MAP_HEIGHT = 48;

// Generate explicit decorations (rock pillars along edges)
const explicitDecorations: Array<{ type: 'rocks_large'; position: { x: number; y: number }; scale: number }> = [];
for (let x = 16; x < MAP_WIDTH - 16; x += 24) {
  // Top edge
  explicitDecorations.push({
    type: 'rocks_large',
    position: { x, y: 4 },
    scale: 0.8,
  });
  // Bottom edge
  explicitDecorations.push({
    type: 'rocks_large',
    position: { x, y: MAP_HEIGHT - 4 },
    scale: 0.8,
  });
}

const BATTLE_ARENA_DEF: MapDefinition = defineMap({
  meta: {
    id: 'battle_arena',
    name: 'Battle Arena',
    author: 'System',
    description: 'Long bridge arena for Battle Simulator mode',
  },

  canvas: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    biome: 'desert',
    baseElevation: 1,
  },

  symmetry: {
    type: 'mirror_x',
    playerCount: 2,
  },

  // Simple flat arena - just two spawn regions connected by ground
  regions: [
    {
      id: 'p1_spawn',
      name: 'Player 1 Spawn',
      type: 'main_base',
      position: { x: 20, y: MAP_HEIGHT / 2 },
      elevation: 1,
      radius: 15,
      playerSlot: 1,
    },
    {
      id: 'p2_spawn',
      name: 'Player 2 Spawn',
      type: 'main_base',
      position: { x: MAP_WIDTH - 20, y: MAP_HEIGHT / 2 },
      elevation: 1,
      radius: 15,
      playerSlot: 2,
    },
    {
      id: 'center',
      name: 'Arena Center',
      type: 'center',
      position: { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 },
      elevation: 1,
      radius: 20,
    },
  ],

  // All same elevation - ground connections
  connections: [
    { from: 'p1_spawn', to: 'center', type: 'wide', width: 30 },
    { from: 'center', to: 'p2_spawn', type: 'wide', width: 30 },
  ],

  // No terrain features - flat arena
  terrain: {},

  // No watch towers or destructibles
  features: {},

  // Sparse decorations - rock pillars
  decorations: {
    explicit: explicitDecorations,
  },
});

// Generate and export the map
export const BATTLE_ARENA = generateMapFromDefinition(BATTLE_ARENA_DEF);

// Mark as not ranked (battle simulator only)
BATTLE_ARENA.isRanked = false;

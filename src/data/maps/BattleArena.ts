/**
 * BATTLE ARENA - Long horizontal bridge map for Battle Simulator mode
 *
 * A 128x48 rectangular arena shaped like a bridge where two armies
 * face each other from opposite ends.
 * Designed for spawning and testing unit combat.
 */

import {
  type MapBlueprint,
  generateMap,
  fill,
  plateau,
  border,
  mainBase,
  ELEVATION,
} from './core';

const MAP_WIDTH = 128;
const MAP_HEIGHT = 48;

// Generate explicit decorations (rock pillars along edges)
const explicitDecorations: MapBlueprint['explicitDecorations'] = [];
for (let x = 16; x < MAP_WIDTH - 16; x += 24) {
  explicitDecorations.push({
    type: 'rocks_large',
    x,
    y: 6,
    scale: 1.2,
  });
  explicitDecorations.push({
    type: 'rocks_large',
    x,
    y: MAP_HEIGHT - 6,
    scale: 1.2,
  });
}

/**
 * Battle Arena - Paint-based map definition
 */
const BATTLE_ARENA_BLUEPRINT: MapBlueprint = {
  meta: {
    id: 'battle_arena',
    name: 'Battle Arena',
    author: 'System',
    description: 'Long bridge arena for Battle Simulator mode',
    players: 2,
  },

  canvas: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    biome: 'desert',
  },

  // Paint commands executed in order
  paint: [
    // 1. Fill with mid-level ground (flat arena)
    fill(ELEVATION.MID),

    // 2. Player spawn plateaus (same elevation, just for clarity)
    plateau(20, MAP_HEIGHT / 2, 15, ELEVATION.MID),
    plateau(MAP_WIDTH - 20, MAP_HEIGHT / 2, 15, ELEVATION.MID),

    // 3. Center area
    plateau(MAP_WIDTH / 2, MAP_HEIGHT / 2, 20, ELEVATION.MID),

    // 4. Map border (unwalkable edges)
    border(6),
  ],

  // Base locations
  bases: [
    mainBase(20, MAP_HEIGHT / 2, 1, 'right'),
    mainBase(MAP_WIDTH - 20, MAP_HEIGHT / 2, 2, 'left'),
  ],

  // No watch towers or destructibles for battle arena
  watchTowers: [],
  destructibles: [],

  // Decoration rules
  decorationRules: {
    border: {
      style: 'rocks',
      density: 0.6,
      scale: [1.5, 2.5],
      innerOffset: 8,
      outerOffset: 3,
    },
    scatter: {
      rocks: 0.1,
      debris: 0.05,
    },
    seed: 42,
  },

  // Explicit decorations (rock pillars)
  explicitDecorations,
};

// Generate and export the map
export const BATTLE_ARENA = generateMap(BATTLE_ARENA_BLUEPRINT);

// Mark as not ranked (battle simulator only)
BATTLE_ARENA.isRanked = false;

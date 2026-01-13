/**
 * CRYSTAL CAVERNS - 2 Player (1v1) Map
 *
 * A competitive 1v1 map with horizontal spawns and frozen biome.
 *
 * Key Features:
 * - Protected main bases with single ramp entrance
 * - Natural expansions with defensible chokepoints
 * - Multiple expansion locations for late game
 * - Central contested area with watch tower
 * - Ice/crystal themed environment
 */

import {
  type MapBlueprint,
  generateMap,
  fill,
  plateau,
  ramp,
  border,
  water,
  forest,
  forestRect,
  unwalkable,
  unwalkableRect,
  mud,
  voidArea,
  mainBase,
  naturalBase,
  thirdBase,
  fourthBase,
  goldBase,
  ELEVATION,
} from './core';

const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;

/**
 * Crystal Caverns - Paint-based map definition
 */
const CRYSTAL_CAVERNS_BLUEPRINT: MapBlueprint = {
  meta: {
    id: 'crystal_caverns',
    name: 'Crystal Caverns',
    author: 'VOIDSTRIKE Team',
    description: 'A competitive 1v1 map with horizontal spawns. Protected main bases with single ramp entry. Control the center gold expansion for economic advantage.',
    players: 2,
  },

  canvas: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    biome: 'frozen',
  },

  paint: [
    // 1. Base ground level
    fill(ELEVATION.LOW),

    // 2. Main bases - HIGH plateaus (protected)
    plateau(30, 90, 22, ELEVATION.HIGH),   // P1 Main
    plateau(170, 90, 22, ELEVATION.HIGH),  // P2 Main

    // 3. Natural expansions - MID plateaus
    plateau(55, 55, 16, ELEVATION.MID),    // P1 Natural
    plateau(145, 125, 16, ELEVATION.MID),  // P2 Natural

    // 4. Third expansions - ground level (already LOW)
    plateau(30, 30, 16, ELEVATION.LOW),    // P1 Third
    plateau(170, 150, 16, ELEVATION.LOW),  // P2 Third

    // 5. Fourth expansions - ground level
    plateau(30, 150, 14, ELEVATION.LOW),   // P1 Fourth
    plateau(170, 30, 14, ELEVATION.LOW),   // P2 Fourth

    // 6. Center gold expansion
    plateau(100, 90, 18, ELEVATION.LOW),

    // 7. Ramps connecting elevations
    // Main to Natural (HIGH -> MID)
    ramp([30, 90], [55, 55], 10),
    ramp([170, 90], [145, 125], 10),

    // Natural to Third (MID -> LOW)
    ramp([55, 55], [30, 30], 10),
    ramp([145, 125], [170, 150], 10),

    // 8. Map border
    border(10),

    // 9. Central chokepoints (unwalkable obstacles)
    unwalkableRect(92, 75, 16, 10),
    unwalkableRect(92, 95, 16, 10),
    unwalkable(70, 130, 12),
    unwalkable(130, 50, 12),
    unwalkable(60, 90, 8),
    unwalkable(140, 90, 8),

    // 10. Void chasms at corners
    voidArea(9, 9, 12),
    voidArea(MAP_WIDTH - 9, 9, 12),
    voidArea(9, MAP_HEIGHT - 9, 12),
    voidArea(MAP_WIDTH - 9, MAP_HEIGHT - 9, 12),

    // 11. Frozen lakes
    water(100, 50, 10),
    water(100, 130, 10),

    // 12. Forests for cover
    forest(20, 45, 6, 'dense'),
    forest(180, 135, 6, 'dense'),
    forestRect(75, 15, 8, 30, 'dense'),
    forestRect(75, 135, 8, 35, 'dense'),
    forestRect(115, 15, 8, 30, 'dense'),
    forestRect(115, 135, 8, 35, 'dense'),
    forest(45, 35, 8, 'dense'),
    forest(155, 145, 8, 'dense'),
    forest(45, 130, 7, 'dense'),
    forest(155, 50, 7, 'dense'),
    forest(85, 45, 6, 'dense'),
    forest(115, 135, 6, 'dense'),
    forest(65, 75, 6, 'dense'),
    forest(135, 105, 6, 'dense'),

    // Light forests
    forest(75, 65, 7, 'light'),
    forest(125, 115, 7, 'light'),
    forest(50, 100, 6, 'light'),
    forest(150, 80, 6, 'light'),
    forest(95, 40, 5, 'light'),
    forest(105, 140, 5, 'light'),
    forest(30, 65, 5, 'light'),
    forest(170, 115, 5, 'light'),

    // 13. Mud/ice in center
    mud(100, 90, 10),
  ],

  // Base locations with resource directions
  bases: [
    mainBase(30, 90, 1, 'left'),
    mainBase(170, 90, 2, 'right'),
    naturalBase(55, 55, 'down_right'),
    naturalBase(145, 125, 'up_left'),
    thirdBase(30, 30, 'left'),
    thirdBase(170, 150, 'right'),
    fourthBase(30, 150, 'left'),
    fourthBase(170, 30, 'right'),
    goldBase(100, 90, 'up'),
  ],

  watchTowers: [
    { x: 100, y: 40, vision: 20 },
    { x: 100, y: 140, vision: 20 },
    { x: 70, y: 90, vision: 16 },
    { x: 130, y: 90, vision: 16 },
  ],

  destructibles: [
    { x: 15, y: 48, health: 2000 },
    { x: 185, y: 132, health: 2000 },
    { x: 85, y: 90, health: 1500 },
    { x: 115, y: 90, health: 1500 },
  ],

  decorationRules: {
    border: {
      style: 'mixed',
      density: 0.8,
      scale: [1.5, 3.0],
      innerOffset: 14,
      outerOffset: 5,
    },
    baseRings: {
      rocks: 20,
      trees: 14,
      crystals: 8,
    },
    scatter: {
      crystals: 0.3,
      deadTrees: 0.2,
      rocks: 0.15,
    },
    seed: 123,
  },

  explicitDecorations: [
    { type: 'debris', x: 90, y: 85, scale: 0.8 },
    { type: 'debris', x: 110, y: 95, scale: 0.8 },
    { type: 'ruined_wall', x: 100, y: 90, scale: 1.0 },
  ],
};

// Generate and export
export const CRYSTAL_CAVERNS = generateMap(CRYSTAL_CAVERNS_BLUEPRINT);

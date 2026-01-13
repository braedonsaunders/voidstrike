/**
 * SCORCHED BASIN - 4 Player (2v2 / FFA) Map
 *
 * A balanced 4-player map with desert biome.
 * Designed for 2v2 team games or Free-For-All.
 *
 * Key Features:
 * - Symmetrical 4-corner spawn positions
 * - Protected main bases with single ramp
 * - Natural expansions near each main
 * - Shared third expansions between adjacent players
 * - Central contested area with watch tower
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
  road,
  mainBase,
  naturalBase,
  thirdBase,
  goldBase,
  ELEVATION,
} from './core';

const MAP_WIDTH = 280;
const MAP_HEIGHT = 280;

/**
 * Scorched Basin - Paint-based map definition
 */
const SCORCHED_BASIN_BLUEPRINT: MapBlueprint = {
  meta: {
    id: 'scorched_basin',
    name: 'Scorched Basin',
    author: 'VOIDSTRIKE Team',
    description: 'A balanced 4-player map with symmetrical corner spawns. Teams fight for control of shared expansions and the central watch tower.',
    players: 4,
  },

  canvas: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    biome: 'desert',
  },

  paint: [
    // 1. Base ground level
    fill(ELEVATION.LOW),

    // 2. Main bases - HIGH plateaus (4 corners)
    plateau(40, 40, 24, ELEVATION.HIGH),     // P1 (top-left)
    plateau(240, 40, 24, ELEVATION.HIGH),    // P2 (top-right)
    plateau(40, 240, 24, ELEVATION.HIGH),    // P3 (bottom-left)
    plateau(240, 240, 24, ELEVATION.HIGH),   // P4 (bottom-right)

    // 3. Natural expansions - MID plateaus
    plateau(75, 75, 18, ELEVATION.MID),      // P1 Natural
    plateau(205, 75, 18, ELEVATION.MID),     // P2 Natural
    plateau(75, 205, 18, ELEVATION.MID),     // P3 Natural
    plateau(205, 205, 18, ELEVATION.MID),    // P4 Natural

    // 4. Shared third expansions (between adjacent players)
    plateau(40, 140, 16, ELEVATION.LOW),     // Left third
    plateau(240, 140, 16, ELEVATION.LOW),    // Right third
    plateau(140, 40, 16, ELEVATION.LOW),     // Top third
    plateau(140, 240, 16, ELEVATION.LOW),    // Bottom third

    // 5. Gold expansions (inner ring)
    plateau(90, 90, 14, ELEVATION.LOW),
    plateau(190, 90, 14, ELEVATION.LOW),
    plateau(90, 190, 14, ELEVATION.LOW),
    plateau(190, 190, 14, ELEVATION.LOW),

    // 6. Center plateau
    plateau(140, 140, 24, ELEVATION.LOW),

    // 7. Ramps connecting elevations
    // Main to Natural (HIGH -> MID)
    ramp([40, 40], [75, 75], 10),
    ramp([240, 40], [205, 75], 10),
    ramp([40, 240], [75, 205], 10),
    ramp([240, 240], [205, 205], 10),

    // Natural to center area (MID -> LOW)
    ramp([75, 75], [140, 140], 8),
    ramp([205, 75], [140, 140], 8),
    ramp([75, 205], [140, 140], 8),
    ramp([205, 205], [140, 140], 8),

    // 8. Map border
    border(12),

    // 9. Chokepoint obstacles
    unwalkable(110, 50, 10),
    unwalkable(170, 50, 10),
    unwalkable(50, 110, 10),
    unwalkable(50, 170, 10),
    unwalkable(230, 110, 10),
    unwalkable(230, 170, 10),
    unwalkable(110, 230, 10),
    unwalkable(170, 230, 10),

    // 10. Center obstacles (forces splitting)
    unwalkableRect(130, 110, 20, 15),
    unwalkableRect(130, 155, 20, 15),
    unwalkableRect(110, 130, 15, 20),
    unwalkableRect(155, 130, 15, 20),

    // 11. Corner voids
    voidArea(12, 12, 10),
    voidArea(MAP_WIDTH - 12, 12, 10),
    voidArea(12, MAP_HEIGHT - 12, 10),
    voidArea(MAP_WIDTH - 12, MAP_HEIGHT - 12, 10),

    // 12. Oasis lakes
    water(60, 140, 8),
    water(220, 140, 8),
    water(140, 60, 8),
    water(140, 220, 8),

    // 13. Desert forests/scrub
    forest(55, 55, 6, 'light'),
    forest(225, 55, 6, 'light'),
    forest(55, 225, 6, 'light'),
    forest(225, 225, 6, 'light'),

    // Strategic forest cover
    forestRect(100, 100, 10, 10, 'dense'),
    forestRect(170, 100, 10, 10, 'dense'),
    forestRect(100, 170, 10, 10, 'dense'),
    forestRect(170, 170, 10, 10, 'dense'),

    forest(70, 140, 5, 'light'),
    forest(210, 140, 5, 'light'),
    forest(140, 70, 5, 'light'),
    forest(140, 210, 5, 'light'),

    // 14. Mud/slow areas
    mud(140, 140, 8),
    mud(90, 90, 5),
    mud(190, 90, 5),
    mud(90, 190, 5),
    mud(190, 190, 5),

    // 15. Roads between bases
    road([75, 75], [140, 140], 3),
    road([205, 75], [140, 140], 3),
    road([75, 205], [140, 140], 3),
    road([205, 205], [140, 140], 3),
  ],

  // Base locations
  bases: [
    mainBase(40, 40, 1, 'up_left'),
    mainBase(240, 40, 2, 'up_right'),
    mainBase(40, 240, 3, 'down_left'),
    mainBase(240, 240, 4, 'down_right'),
    naturalBase(75, 75, 'down_right'),
    naturalBase(205, 75, 'down_left'),
    naturalBase(75, 205, 'up_right'),
    naturalBase(205, 205, 'up_left'),
    thirdBase(40, 140, 'left'),
    thirdBase(240, 140, 'right'),
    thirdBase(140, 40, 'up'),
    thirdBase(140, 240, 'down'),
    goldBase(90, 90, 'down_right'),
    goldBase(190, 90, 'down_left'),
    goldBase(90, 190, 'up_right'),
    goldBase(190, 190, 'up_left'),
  ],

  watchTowers: [
    { x: 140, y: 140, vision: 26 },
    { x: 90, y: 140, vision: 18 },
    { x: 190, y: 140, vision: 18 },
    { x: 140, y: 90, vision: 18 },
    { x: 140, y: 190, vision: 18 },
  ],

  destructibles: [
    { x: 60, y: 100, health: 2000 },
    { x: 220, y: 100, health: 2000 },
    { x: 60, y: 180, health: 2000 },
    { x: 220, y: 180, health: 2000 },
    { x: 100, y: 60, health: 2000 },
    { x: 180, y: 60, health: 2000 },
    { x: 100, y: 220, health: 2000 },
    { x: 180, y: 220, health: 2000 },
  ],

  decorationRules: {
    border: {
      style: 'rocks',
      density: 0.7,
      scale: [1.5, 3.0],
      innerOffset: 16,
      outerOffset: 5,
    },
    baseRings: {
      rocks: 18,
      trees: 10,
    },
    scatter: {
      rocks: 0.25,
      deadTrees: 0.15,
      debris: 0.1,
    },
    seed: 789,
  },

  explicitDecorations: [
    { type: 'ruined_wall', x: 140, y: 140, scale: 1.5 },
    { type: 'debris', x: 135, y: 145, scale: 1.0 },
    { type: 'debris', x: 145, y: 135, scale: 1.0 },
  ],
};

// Generate and export
export const SCORCHED_BASIN = generateMap(SCORCHED_BASIN_BLUEPRINT);

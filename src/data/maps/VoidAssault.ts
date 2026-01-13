/**
 * VOID ASSAULT - 2 Player (1v1) Map
 *
 * A competitive 1v1 map with diagonal spawns and void biome.
 * Inspired by classic SC2 maps like Metalopolis.
 *
 * Key Features:
 * - Diagonal spawn positions (bottom-left vs top-right)
 * - Protected main bases with single narrow ramp
 * - Natural expansion close to main with chokepoint
 * - Multiple attack paths and elevation changes
 * - Central watch tower for map control
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
  voidRect,
  road,
  mainBase,
  naturalBase,
  thirdBase,
  fourthBase,
  goldBase,
  ELEVATION,
} from './core';

const MAP_WIDTH = 220;
const MAP_HEIGHT = 220;

/**
 * Void Assault - Paint-based map definition
 */
const VOID_ASSAULT_BLUEPRINT: MapBlueprint = {
  meta: {
    id: 'void_assault',
    name: 'Void Assault',
    author: 'VOIDSTRIKE Team',
    description: 'A competitive 1v1 map with diagonal spawns. Protected main bases lead to natural expansions through narrow ramps. Control the center and gold bases for map dominance.',
    players: 2,
  },

  canvas: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    biome: 'void',
  },

  paint: [
    // 1. Base ground level
    fill(ELEVATION.LOW),

    // 2. Main bases - HIGH plateaus (diagonal corners)
    plateau(35, 185, 24, ELEVATION.HIGH),   // P1 Main (bottom-left)
    plateau(185, 35, 24, ELEVATION.HIGH),   // P2 Main (top-right)

    // 3. Natural expansions - MID plateaus
    plateau(60, 145, 16, ELEVATION.MID),    // P1 Natural
    plateau(160, 75, 16, ELEVATION.MID),    // P2 Natural

    // 4. Third expansions - ground level
    plateau(35, 35, 18, ELEVATION.LOW),     // P1 Third
    plateau(185, 185, 18, ELEVATION.LOW),   // P2 Third

    // 5. Fourth expansions - ground level
    plateau(35, 110, 16, ELEVATION.LOW),    // P1 Fourth
    plateau(185, 110, 16, ELEVATION.LOW),   // P2 Fourth

    // 6. Gold expansions
    plateau(80, 60, 14, ELEVATION.LOW),     // Gold North (P1 side)
    plateau(140, 160, 14, ELEVATION.LOW),   // Gold South (P2 side)

    // 7. Center contested area
    plateau(110, 110, 22, ELEVATION.LOW),

    // 8. Ramps connecting elevations
    // Main to Natural (HIGH -> MID)
    ramp([35, 185], [60, 145], 10),
    ramp([185, 35], [160, 75], 10),

    // Natural to low ground (MID -> LOW)
    ramp([60, 145], [110, 110], 8),
    ramp([160, 75], [110, 110], 8),

    // 9. Map border
    border(12),

    // 10. Natural chokepoint walls
    unwalkableRect(40, 120, 12, 18),
    unwalkableRect(72, 120, 15, 18),
    unwalkableRect(133, 82, 15, 18),
    unwalkableRect(168, 82, 12, 18),

    // 11. Third expansion protection
    unwalkableRect(12, 20, 15, 30),
    unwalkableRect(20, 12, 30, 15),
    unwalkableRect(193, 170, 15, 30),
    unwalkableRect(170, 193, 30, 15),

    // 12. Central obstacle
    unwalkableRect(100, 100, 20, 20),

    // 13. Diagonal cliff barriers
    unwalkable(70, 70, 14),
    unwalkable(150, 150, 14),

    // 14. Side path cliffs
    unwalkable(30, 75, 10),
    unwalkable(190, 145, 10),

    // 15. Additional chokepoints
    unwalkable(85, 140, 10),
    unwalkable(135, 80, 10),

    // 16. Void chasms at edges
    voidRect(0, 0, 22, 22),
    voidRect(MAP_WIDTH - 22, MAP_HEIGHT - 22, 22, 22),
    voidRect(0, 130, 14, 30),
    voidRect(MAP_WIDTH - 14, 60, 14, 30),

    // 17. Void lakes (alien energy pools)
    water(55, 130, 10),
    water(165, 90, 10),
    water(110, 55, 8),
    water(110, 165, 8),

    // 18. Dense forests (void vegetation)
    forest(45, 75, 7, 'dense'),
    forest(175, 145, 7, 'dense'),
    forest(95, 55, 6, 'dense'),
    forest(125, 165, 6, 'dense'),

    // Void forest walls
    forestRect(60, 25, 8, 30, 'dense'),
    forestRect(155, 165, 8, 30, 'dense'),
    forestRect(25, 60, 30, 8, 'dense'),
    forestRect(165, 155, 30, 8, 'dense'),

    // Cross-map forest corridors
    forestRect(85, 15, 10, 25, 'dense'),
    forestRect(130, 180, 10, 25, 'dense'),
    forestRect(15, 85, 25, 10, 'dense'),
    forestRect(180, 130, 25, 10, 'dense'),

    // Strategic clusters
    forest(65, 100, 8, 'dense'),
    forest(155, 120, 8, 'dense'),
    forest(100, 65, 7, 'dense'),
    forest(120, 155, 7, 'dense'),
    forest(50, 50, 7, 'dense'),
    forest(170, 170, 7, 'dense'),

    // Mid-map clusters
    forest(90, 90, 6, 'dense'),
    forest(130, 130, 6, 'dense'),
    forest(80, 130, 5, 'dense'),
    forest(140, 90, 5, 'dense'),

    // Light forests
    forest(55, 125, 6, 'light'),
    forest(165, 95, 6, 'light'),
    forest(110, 80, 5, 'light'),
    forest(110, 140, 5, 'light'),
    forest(35, 65, 5, 'light'),
    forest(185, 155, 5, 'light'),
    forest(75, 45, 5, 'light'),
    forest(145, 175, 5, 'light'),
    forest(20, 130, 4, 'light'),
    forest(200, 90, 4, 'light'),
    forest(130, 20, 4, 'light'),
    forest(90, 200, 4, 'light'),
    forest(60, 165, 4, 'light'),
    forest(160, 55, 4, 'light'),

    // 19. Mud areas (void-corrupted ground)
    mud(110, 110, 12),
    mud(70, 70, 6),
    mud(150, 150, 6),

    // 20. Roads (fast movement)
    road([35, 185], [60, 145], 4),
    road([185, 35], [160, 75], 4),
    road([75, 135], [145, 85], 3),
  ],

  // Base locations
  bases: [
    mainBase(35, 185, 1, 'down_left'),
    mainBase(185, 35, 2, 'up_right'),
    naturalBase(60, 145, 'down_left'),
    naturalBase(160, 75, 'up_right'),
    thirdBase(35, 35, 'up_left'),
    thirdBase(185, 185, 'down_right'),
    fourthBase(35, 110, 'left'),
    fourthBase(185, 110, 'right'),
    goldBase(80, 60, 'up'),
    goldBase(140, 160, 'down'),
  ],

  watchTowers: [
    { x: 110, y: 110, vision: 24 },
    { x: 70, y: 100, vision: 18 },
    { x: 150, y: 120, vision: 18 },
    { x: 110, y: 55, vision: 16 },
    { x: 110, y: 165, vision: 16 },
  ],

  destructibles: [
    { x: 48, y: 50, health: 2000 },
    { x: 172, y: 170, health: 2000 },
    { x: 70, y: 70, health: 1500 },
    { x: 150, y: 150, health: 1500 },
    { x: 55, y: 100, health: 1500 },
    { x: 165, y: 120, health: 1500 },
  ],

  decorationRules: {
    border: {
      style: 'mixed',
      density: 0.9,
      scale: [1.5, 3.5],
      innerOffset: 16,
      outerOffset: 5,
    },
    baseRings: {
      rocks: 24,
      trees: 16,
      crystals: 10,
    },
    scatter: {
      crystals: 0.35,
      alienTrees: 0.2,
      rocks: 0.15,
      debris: 0.05,
    },
    seed: 456,
  },

  explicitDecorations: [
    { type: 'debris', x: 100, y: 100, scale: 1.0 },
    { type: 'debris', x: 120, y: 120, scale: 1.0 },
    { type: 'ruined_wall', x: 105, y: 115, scale: 1.2 },
    { type: 'ruined_wall', x: 115, y: 105, scale: 1.2 },
    { type: 'escape_pod', x: 15, y: 205, scale: 1.0 },
    { type: 'escape_pod', x: 205, y: 15, scale: 1.0 },
  ],
};

// Generate and export
export const VOID_ASSAULT = generateMap(VOID_ASSAULT_BLUEPRINT);

/**
 * CONTESTED FRONTIER - 6 Player (3v3) Map
 *
 * A large-scale team map with jungle biome.
 * Designed for 3v3 battles with team positions on opposite sides.
 *
 * Key Features:
 * - 6 spawn positions (3 per side, top vs bottom)
 * - Protected main bases with single ramp
 * - Natural expansions near each main
 * - Shared resources in the contested center
 * - Rivers creating strategic chokepoints
 */

import {
  type MapBlueprint,
  generateMap,
  fill,
  plateau,
  ramp,
  border,
  water,
  waterRect,
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

const MAP_WIDTH = 360;
const MAP_HEIGHT = 320;

/**
 * Contested Frontier - Paint-based map definition
 */
const CONTESTED_FRONTIER_BLUEPRINT: MapBlueprint = {
  meta: {
    id: 'contested_frontier',
    name: 'Contested Frontier',
    author: 'VOIDSTRIKE Team',
    description: 'A large 6-player map for 3v3 team battles. Team positions on opposite sides with shared strategic resources in the center.',
    players: 6,
  },

  canvas: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    biome: 'jungle',
  },

  paint: [
    // 1. Base ground level
    fill(ELEVATION.LOW),

    // 2. Top team main bases - HIGH plateaus
    plateau(50, 45, 22, ELEVATION.HIGH),     // P1
    plateau(180, 45, 22, ELEVATION.HIGH),    // P2
    plateau(310, 45, 22, ELEVATION.HIGH),    // P3

    // 3. Bottom team main bases - HIGH plateaus
    plateau(50, 275, 22, ELEVATION.HIGH),    // P4
    plateau(180, 275, 22, ELEVATION.HIGH),   // P5
    plateau(310, 275, 22, ELEVATION.HIGH),   // P6

    // 4. Top natural expansions - MID plateaus
    plateau(70, 85, 16, ELEVATION.MID),      // P1 Natural
    plateau(180, 85, 16, ELEVATION.MID),     // P2 Natural
    plateau(290, 85, 16, ELEVATION.MID),     // P3 Natural

    // 5. Bottom natural expansions - MID plateaus
    plateau(70, 235, 16, ELEVATION.MID),     // P4 Natural
    plateau(180, 235, 16, ELEVATION.MID),    // P5 Natural
    plateau(290, 235, 16, ELEVATION.MID),    // P6 Natural

    // 6. Third expansions (sides)
    plateau(35, 160, 14, ELEVATION.LOW),     // Left third
    plateau(325, 160, 14, ELEVATION.LOW),    // Right third

    // 7. Gold expansions (inner contested)
    plateau(100, 130, 14, ELEVATION.LOW),    // Top-left gold
    plateau(260, 130, 14, ELEVATION.LOW),    // Top-right gold
    plateau(100, 190, 14, ELEVATION.LOW),    // Bottom-left gold
    plateau(260, 190, 14, ELEVATION.LOW),    // Bottom-right gold

    // 8. Center area
    plateau(180, 160, 26, ELEVATION.LOW),

    // 9. Ramps - Main to Natural (HIGH -> MID)
    ramp([50, 45], [70, 85], 10),
    ramp([180, 45], [180, 85], 10),
    ramp([310, 45], [290, 85], 10),
    ramp([50, 275], [70, 235], 10),
    ramp([180, 275], [180, 235], 10),
    ramp([310, 275], [290, 235], 10),

    // Natural to center (MID -> LOW)
    ramp([70, 85], [100, 130], 8),
    ramp([180, 85], [180, 130], 8),
    ramp([290, 85], [260, 130], 8),
    ramp([70, 235], [100, 190], 8),
    ramp([180, 235], [180, 190], 8),
    ramp([290, 235], [260, 190], 8),

    // 10. Map border
    border(12),

    // 11. River (horizontal through center)
    waterRect(60, 155, 80, 10, 'deep'),
    waterRect(220, 155, 80, 10, 'deep'),
    // Bridge gaps in center
    water(120, 160, 8, 'shallow'),
    water(240, 160, 8, 'shallow'),

    // 12. Chokepoint obstacles
    unwalkable(130, 100, 12),
    unwalkable(230, 100, 12),
    unwalkable(130, 220, 12),
    unwalkable(230, 220, 12),

    // Center obstacles
    unwalkableRect(165, 140, 30, 10),
    unwalkableRect(165, 170, 30, 10),

    // Side barriers
    unwalkableRect(15, 120, 15, 80),
    unwalkableRect(330, 120, 15, 80),

    // 13. Jungle forests
    forest(50, 120, 8, 'dense'),
    forest(310, 120, 8, 'dense'),
    forest(50, 200, 8, 'dense'),
    forest(310, 200, 8, 'dense'),

    forestRect(90, 60, 20, 15, 'dense'),
    forestRect(250, 60, 20, 15, 'dense'),
    forestRect(90, 245, 20, 15, 'dense'),
    forestRect(250, 245, 20, 15, 'dense'),

    forest(140, 160, 6, 'light'),
    forest(220, 160, 6, 'light'),

    // Edge forests
    forestRect(15, 45, 20, 20, 'dense'),
    forestRect(325, 45, 20, 20, 'dense'),
    forestRect(15, 255, 20, 20, 'dense'),
    forestRect(325, 255, 20, 20, 'dense'),

    // 14. Mud areas
    mud(180, 160, 10),
    mud(100, 160, 6),
    mud(260, 160, 6),

    // 15. Roads
    road([180, 85], [180, 160], 4),
    road([180, 235], [180, 160], 4),
    road([100, 130], [180, 160], 3),
    road([260, 130], [180, 160], 3),
    road([100, 190], [180, 160], 3),
    road([260, 190], [180, 160], 3),
  ],

  // Base locations
  bases: [
    // Top team
    mainBase(50, 45, 1, 'up'),
    mainBase(180, 45, 2, 'up'),
    mainBase(310, 45, 3, 'up'),
    // Bottom team
    mainBase(50, 275, 4, 'down'),
    mainBase(180, 275, 5, 'down'),
    mainBase(310, 275, 6, 'down'),
    // Naturals
    naturalBase(70, 85, 'down'),
    naturalBase(180, 85, 'down'),
    naturalBase(290, 85, 'down'),
    naturalBase(70, 235, 'up'),
    naturalBase(180, 235, 'up'),
    naturalBase(290, 235, 'up'),
    // Thirds
    thirdBase(35, 160, 'left'),
    thirdBase(325, 160, 'right'),
    // Golds
    goldBase(100, 130, 'down'),
    goldBase(260, 130, 'down'),
    goldBase(100, 190, 'up'),
    goldBase(260, 190, 'up'),
  ],

  watchTowers: [
    { x: 180, y: 160, vision: 28 },
    { x: 100, y: 160, vision: 20 },
    { x: 260, y: 160, vision: 20 },
    { x: 180, y: 110, vision: 18 },
    { x: 180, y: 210, vision: 18 },
  ],

  destructibles: [
    { x: 140, y: 160, health: 2000 },
    { x: 220, y: 160, health: 2000 },
    { x: 180, y: 130, health: 1500 },
    { x: 180, y: 190, health: 1500 },
  ],

  decorationRules: {
    border: {
      style: 'trees',
      density: 0.8,
      scale: [1.0, 2.5],
      innerOffset: 18,
      outerOffset: 6,
    },
    baseRings: {
      rocks: 16,
      trees: 20,
    },
    scatter: {
      trees: 0.3,
      rocks: 0.15,
      debris: 0.05,
    },
    seed: 321,
  },
};

// Generate and export
export const CONTESTED_FRONTIER = generateMap(CONTESTED_FRONTIER_BLUEPRINT);

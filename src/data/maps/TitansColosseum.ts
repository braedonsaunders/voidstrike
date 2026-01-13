/**
 * TITAN'S COLOSSEUM - 8 Player Map (4v4 or FFA)
 *
 * A massive 8-player map with octagonal spawn layout.
 * Designed for epic 4v4 team battles or chaotic FFA matches.
 *
 * Key Features:
 * - 8 protected main bases around the perimeter
 * - Central colosseum arena for major engagements
 * - Multiple expansion tiers for economic scaling
 * - Volcanic biome with dramatic terrain
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

const MAP_WIDTH = 400;
const MAP_HEIGHT = 400;
const CENTER = MAP_WIDTH / 2; // 200

/**
 * Titan's Colosseum - Paint-based map definition
 */
const TITANS_COLOSSEUM_BLUEPRINT: MapBlueprint = {
  meta: {
    id: 'titans_colosseum',
    name: "Titan's Colosseum",
    author: 'VOIDSTRIKE Team',
    description: 'A massive 8-player map for epic 4v4 battles or chaotic FFA. Eight protected bases surround a central colosseum where armies clash for supremacy.',
    players: 8,
  },

  canvas: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    biome: 'volcanic',
  },

  paint: [
    // 1. Base ground level
    fill(ELEVATION.LOW),

    // 2. Main bases - HIGH plateaus (octagonal arrangement)
    plateau(80, 45, 25, ELEVATION.HIGH),     // P1 (top-left-ish)
    plateau(320, 45, 25, ELEVATION.HIGH),    // P2 (top-right-ish)
    plateau(355, 130, 25, ELEVATION.HIGH),   // P3 (right-top)
    plateau(355, 270, 25, ELEVATION.HIGH),   // P4 (right-bottom)
    plateau(320, 355, 25, ELEVATION.HIGH),   // P5 (bottom-right-ish)
    plateau(80, 355, 25, ELEVATION.HIGH),    // P6 (bottom-left-ish)
    plateau(45, 270, 25, ELEVATION.HIGH),    // P7 (left-bottom)
    plateau(45, 130, 25, ELEVATION.HIGH),    // P8 (left-top)

    // 3. Natural expansions - MID plateaus
    plateau(115, 80, 18, ELEVATION.MID),     // P1 Natural
    plateau(285, 80, 18, ELEVATION.MID),     // P2 Natural
    plateau(320, 150, 18, ELEVATION.MID),    // P3 Natural
    plateau(320, 250, 18, ELEVATION.MID),    // P4 Natural
    plateau(285, 320, 18, ELEVATION.MID),    // P5 Natural
    plateau(115, 320, 18, ELEVATION.MID),    // P6 Natural
    plateau(80, 250, 18, ELEVATION.MID),     // P7 Natural
    plateau(80, 150, 18, ELEVATION.MID),     // P8 Natural

    // 4. Third expansions - ground level (ring around center)
    plateau(160, 100, 14, ELEVATION.LOW),    // Top-left third
    plateau(240, 100, 14, ELEVATION.LOW),    // Top-right third
    plateau(300, 160, 14, ELEVATION.LOW),    // Right-top third
    plateau(300, 240, 14, ELEVATION.LOW),    // Right-bottom third
    plateau(240, 300, 14, ELEVATION.LOW),    // Bottom-right third
    plateau(160, 300, 14, ELEVATION.LOW),    // Bottom-left third
    plateau(100, 240, 14, ELEVATION.LOW),    // Left-bottom third
    plateau(100, 160, 14, ELEVATION.LOW),    // Left-top third

    // 5. Gold expansions (inner ring)
    plateau(150, 150, 12, ELEVATION.LOW),
    plateau(250, 150, 12, ELEVATION.LOW),
    plateau(250, 250, 12, ELEVATION.LOW),
    plateau(150, 250, 12, ELEVATION.LOW),

    // 6. Central colosseum
    plateau(CENTER, CENTER, 35, ELEVATION.LOW),

    // 7. Ramps - Main to Natural (HIGH -> MID)
    ramp([80, 45], [115, 80], 10),
    ramp([320, 45], [285, 80], 10),
    ramp([355, 130], [320, 150], 10),
    ramp([355, 270], [320, 250], 10),
    ramp([320, 355], [285, 320], 10),
    ramp([80, 355], [115, 320], 10),
    ramp([45, 270], [80, 250], 10),
    ramp([45, 130], [80, 150], 10),

    // Natural to third (MID -> LOW)
    ramp([115, 80], [160, 100], 8),
    ramp([285, 80], [240, 100], 8),
    ramp([320, 150], [300, 160], 8),
    ramp([320, 250], [300, 240], 8),
    ramp([285, 320], [240, 300], 8),
    ramp([115, 320], [160, 300], 8),
    ramp([80, 250], [100, 240], 8),
    ramp([80, 150], [100, 160], 8),

    // 8. Map border
    border(15),

    // 9. Colosseum inner obstacles (pillars)
    unwalkable(CENTER - 20, CENTER, 8),
    unwalkable(CENTER + 20, CENTER, 8),
    unwalkable(CENTER, CENTER - 20, 8),
    unwalkable(CENTER, CENTER + 20, 8),

    // Outer ring obstacles
    unwalkable(CENTER - 35, CENTER - 35, 10),
    unwalkable(CENTER + 35, CENTER - 35, 10),
    unwalkable(CENTER + 35, CENTER + 35, 10),
    unwalkable(CENTER - 35, CENTER + 35, 10),

    // Edge barriers
    unwalkableRect(15, 80, 20, 40),
    unwalkableRect(15, 280, 20, 40),
    unwalkableRect(365, 80, 20, 40),
    unwalkableRect(365, 280, 20, 40),
    unwalkableRect(80, 15, 40, 20),
    unwalkableRect(280, 15, 40, 20),
    unwalkableRect(80, 365, 40, 20),
    unwalkableRect(280, 365, 40, 20),

    // 10. Lava/water pools (volcanic theme)
    water(60, 60, 12),
    water(340, 60, 12),
    water(60, 340, 12),
    water(340, 340, 12),
    water(CENTER, 60, 10),
    water(CENTER, 340, 10),
    water(60, CENTER, 10),
    water(340, CENTER, 10),

    // 11. Forests (sparse volcanic vegetation)
    forest(130, 60, 6, 'dense'),
    forest(270, 60, 6, 'dense'),
    forest(130, 340, 6, 'dense'),
    forest(270, 340, 6, 'dense'),
    forest(60, 130, 6, 'dense'),
    forest(60, 270, 6, 'dense'),
    forest(340, 130, 6, 'dense'),
    forest(340, 270, 6, 'dense'),

    // Light cover around thirds
    forest(160, 130, 5, 'light'),
    forest(240, 130, 5, 'light'),
    forest(160, 270, 5, 'light'),
    forest(240, 270, 5, 'light'),
    forest(130, 160, 5, 'light'),
    forest(270, 160, 5, 'light'),
    forest(130, 240, 5, 'light'),
    forest(270, 240, 5, 'light'),

    // 12. Mud areas (volcanic ash)
    mud(CENTER, CENTER, 15),
    mud(150, 150, 6),
    mud(250, 150, 6),
    mud(150, 250, 6),
    mud(250, 250, 6),

    // 13. Roads to center
    road([160, 100], [CENTER, CENTER], 3),
    road([240, 100], [CENTER, CENTER], 3),
    road([300, 160], [CENTER, CENTER], 3),
    road([300, 240], [CENTER, CENTER], 3),
    road([240, 300], [CENTER, CENTER], 3),
    road([160, 300], [CENTER, CENTER], 3),
    road([100, 240], [CENTER, CENTER], 3),
    road([100, 160], [CENTER, CENTER], 3),
  ],

  // Base locations
  bases: [
    // 8 Main bases
    mainBase(80, 45, 1, 'up'),
    mainBase(320, 45, 2, 'up'),
    mainBase(355, 130, 3, 'right'),
    mainBase(355, 270, 4, 'right'),
    mainBase(320, 355, 5, 'down'),
    mainBase(80, 355, 6, 'down'),
    mainBase(45, 270, 7, 'left'),
    mainBase(45, 130, 8, 'left'),
    // 8 Naturals
    naturalBase(115, 80, 'down_right'),
    naturalBase(285, 80, 'down_left'),
    naturalBase(320, 150, 'down_left'),
    naturalBase(320, 250, 'up_left'),
    naturalBase(285, 320, 'up_left'),
    naturalBase(115, 320, 'up_right'),
    naturalBase(80, 250, 'up_right'),
    naturalBase(80, 150, 'down_right'),
    // 8 Thirds
    thirdBase(160, 100, 'down'),
    thirdBase(240, 100, 'down'),
    thirdBase(300, 160, 'left'),
    thirdBase(300, 240, 'left'),
    thirdBase(240, 300, 'up'),
    thirdBase(160, 300, 'up'),
    thirdBase(100, 240, 'right'),
    thirdBase(100, 160, 'right'),
    // 4 Golds
    goldBase(150, 150, 'down_right'),
    goldBase(250, 150, 'down_left'),
    goldBase(250, 250, 'up_left'),
    goldBase(150, 250, 'up_right'),
  ],

  watchTowers: [
    { x: CENTER, y: CENTER, vision: 30 },
    { x: 150, y: CENTER, vision: 20 },
    { x: 250, y: CENTER, vision: 20 },
    { x: CENTER, y: 150, vision: 20 },
    { x: CENTER, y: 250, vision: 20 },
  ],

  destructibles: [
    // Colosseum entrance rocks
    { x: CENTER - 40, y: CENTER, health: 3000 },
    { x: CENTER + 40, y: CENTER, health: 3000 },
    { x: CENTER, y: CENTER - 40, health: 3000 },
    { x: CENTER, y: CENTER + 40, health: 3000 },
    // Gold access rocks
    { x: 150, y: 180, health: 2000 },
    { x: 250, y: 180, health: 2000 },
    { x: 150, y: 220, health: 2000 },
    { x: 250, y: 220, health: 2000 },
  ],

  decorationRules: {
    border: {
      style: 'rocks',
      density: 0.9,
      scale: [2.0, 4.0],
      innerOffset: 20,
      outerOffset: 6,
    },
    baseRings: {
      rocks: 22,
      crystals: 8,
    },
    scatter: {
      rocks: 0.3,
      crystals: 0.2,
      debris: 0.1,
    },
    seed: 654,
  },

  explicitDecorations: [
    // Colosseum center ruins
    { type: 'ruined_wall', x: CENTER - 10, y: CENTER - 10, scale: 1.5 },
    { type: 'ruined_wall', x: CENTER + 10, y: CENTER + 10, scale: 1.5 },
    { type: 'debris', x: CENTER, y: CENTER, scale: 2.0 },
    // Corner escape pods
    { type: 'escape_pod', x: 25, y: 25, scale: 1.0 },
    { type: 'escape_pod', x: 375, y: 25, scale: 1.0 },
    { type: 'escape_pod', x: 25, y: 375, scale: 1.0 },
    { type: 'escape_pod', x: 375, y: 375, scale: 1.0 },
  ],
};

// Generate and export
export const TITANS_COLOSSEUM = generateMap(TITANS_COLOSSEUM_BLUEPRINT);

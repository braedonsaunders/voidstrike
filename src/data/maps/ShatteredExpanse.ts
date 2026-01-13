/**
 * SHATTERED EXPANSE
 *
 * A high-quality 1v1 map inspired by StarCraft 2's best competitive maps.
 * Features a central void chasm that splits the map, forcing players through
 * defined attack paths. Rich in terrain variety and strategic options.
 *
 * Key Features:
 * - Rotational symmetry (180°)
 * - Protected main with single ramp
 * - Open natural with two attack paths
 * - Contested third on low ground
 * - Pocket fourth for late-game
 * - High-risk gold expansion near center
 * - Watch towers controlling key sightlines
 * - Destructible rocks for strategic options
 * - Central void chasm with bridges
 */

import {
  DeclarativeMapDef,
  declarativeMainBase as mainBase,
  natural,
  expansion,
  center,
  ramp,
  ground,
  choke,
  circle,
  rect,
  line,
  path,
  BIOME_THEMES,
  generateFromDeclarative,
} from './core';

// Map dimensions
const WIDTH = 160;
const HEIGHT = 160;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

// Player positions (opposite corners)
const P1_X = 28;
const P1_Y = 28;
const P2_X = WIDTH - 28;
const P2_Y = HEIGHT - 28;

/**
 * Shattered Expanse - Declarative Map Definition
 */
export const SHATTERED_EXPANSE_DEF: DeclarativeMapDef = {
  meta: {
    id: 'shattered_expanse',
    name: 'Shattered Expanse',
    author: 'VOIDSTRIKE',
    description: 'A competitive 1v1 map with a central void chasm. Strategic destructible rocks and watch towers create multiple attack paths and control points.',
    version: '1.0.0',
    tags: ['1v1', 'competitive', 'void', 'twilight'],
    difficulty: 'intermediate',
    gameModes: ['1v1'],
    isRanked: true,
  },

  canvas: {
    width: WIDTH,
    height: HEIGHT,
    baseElevation: 0,
    borderWidth: 6,
  },

  theme: 'twilight',

  symmetry: {
    type: 'rotational_2',
    playerCount: 2,
    center: { x: CENTER_X, y: CENTER_Y },
  },

  // =========================================================================
  // REGIONS
  // =========================================================================
  regions: [
    // PLAYER 1 REGIONS
    mainBase('p1_main', P1_X, P1_Y, 1, {
      name: 'Player 1 Main',
      elevation: 2,
      radius: 22,
      resourceTemplate: 'standard',
    }),

    natural('p1_nat', P1_X + 28, P1_Y + 18, {
      name: 'Player 1 Natural',
      elevation: 1,
      radius: 16,
      resourceTemplate: 'standard',
    }),

    expansion('p1_third', 45, 70, 'third', {
      name: 'Player 1 Third',
      elevation: 0,
      radius: 16,
      resourceTemplate: 'standard',
    }),

    expansion('p1_fourth', P1_X - 5, P1_Y + 35, 'fourth', {
      name: 'Player 1 Fourth (Pocket)',
      elevation: 0,
      radius: 14,
      resourceTemplate: 'poor',
    }),

    expansion('gold_p1_side', 70, 45, 'gold', {
      name: 'Gold Expansion (P1 Side)',
      elevation: 0,
      radius: 14,
      resourceTemplate: 'gold',
    }),

    // PLAYER 2 REGIONS (Rotational symmetry)
    mainBase('p2_main', P2_X, P2_Y, 2, {
      name: 'Player 2 Main',
      elevation: 2,
      radius: 22,
      resourceTemplate: 'standard',
    }),

    natural('p2_nat', P2_X - 28, P2_Y - 18, {
      name: 'Player 2 Natural',
      elevation: 1,
      radius: 16,
      resourceTemplate: 'standard',
    }),

    expansion('p2_third', WIDTH - 45, HEIGHT - 70, 'third', {
      name: 'Player 2 Third',
      elevation: 0,
      radius: 16,
      resourceTemplate: 'standard',
    }),

    expansion('p2_fourth', P2_X + 5, P2_Y - 35, 'fourth', {
      name: 'Player 2 Fourth (Pocket)',
      elevation: 0,
      radius: 14,
      resourceTemplate: 'poor',
    }),

    expansion('gold_p2_side', WIDTH - 70, HEIGHT - 45, 'gold', {
      name: 'Gold Expansion (P2 Side)',
      elevation: 0,
      radius: 14,
      resourceTemplate: 'gold',
    }),

    // NEUTRAL REGIONS
    center('map_center', CENTER_X, CENTER_Y, 20, {
      name: 'Central Void',
      elevation: 0,
    }),

    // North bridge area
    {
      id: 'north_bridge',
      name: 'North Bridge',
      type: 'pathway',
      position: { x: CENTER_X - 30, y: CENTER_Y - 30 },
      elevation: 0,
      radius: 12,
    },

    // South bridge area
    {
      id: 'south_bridge',
      name: 'South Bridge',
      type: 'pathway',
      position: { x: CENTER_X + 30, y: CENTER_Y + 30 },
      elevation: 0,
      radius: 12,
    },

    // Watch tower regions
    {
      id: 'tower_p1',
      name: 'P1 Watch Tower',
      type: 'watchtower',
      position: { x: 55, y: 55 },
      elevation: 1,
      radius: 8,
    },

    {
      id: 'tower_p2',
      name: 'P2 Watch Tower',
      type: 'watchtower',
      position: { x: WIDTH - 55, y: HEIGHT - 55 },
      elevation: 1,
      radius: 8,
    },

    {
      id: 'tower_center',
      name: 'Center Watch Tower',
      type: 'watchtower',
      position: { x: CENTER_X, y: CENTER_Y + 25 },
      elevation: 0,
      radius: 8,
    },
  ],

  // =========================================================================
  // CONNECTIONS
  // =========================================================================
  connections: [
    // Main to Natural ramps
    ramp('p1_main', 'p1_nat', 10),
    ramp('p2_main', 'p2_nat', 10),

    // Natural to ground level
    ramp('p1_nat', 'p1_third', 8),
    ramp('p2_nat', 'p2_third', 8),

    // Natural to watch tower (alternative path)
    ramp('p1_nat', 'tower_p1', 6),
    ramp('p2_nat', 'tower_p2', 6),

    // Ground level connections
    ground('p1_third', 'gold_p1_side', 10),
    ground('p2_third', 'gold_p2_side', 10),

    // Fourth expansion access
    ground('p1_fourth', 'p1_third', 8),
    ground('p2_fourth', 'p2_third', 8),

    // Tower to ground connections
    ramp('tower_p1', 'gold_p1_side', 6),
    ramp('tower_p2', 'gold_p2_side', 6),

    // Bridge connections (across the void)
    ground('p1_third', 'north_bridge', 10),
    ground('north_bridge', 'p2_third', 10),
    ground('p1_third', 'south_bridge', 10),
    ground('south_bridge', 'p2_third', 10),

    // Gold to bridge/center access
    ground('gold_p1_side', 'north_bridge', 8),
    ground('gold_p2_side', 'south_bridge', 8),

    // Center connections
    ground('north_bridge', 'map_center', 8),
    ground('south_bridge', 'map_center', 8),
    ground('map_center', 'tower_center', 6),

    // Choke points (narrow passages)
    choke('north_bridge', 'south_bridge', 6),
  ],

  // =========================================================================
  // TERRAIN FEATURES
  // =========================================================================
  terrain: {
    // Central void chasm
    voids: [
      {
        id: 'central_void',
        shape: rect(CENTER_X - 25, CENTER_Y - 25, 50, 50),
        style: 'chasm',
        edgeWidth: 3,
        glow: true,
      },
      // Corner voids (map boundaries feel)
      {
        id: 'void_nw',
        shape: circle(15, 15, 12),
        style: 'space',
      },
      {
        id: 'void_se',
        shape: circle(WIDTH - 15, HEIGHT - 15, 12),
        style: 'space',
      },
    ],

    // Water pools (decorative + slow terrain)
    water: [
      {
        id: 'pool_p1',
        shape: circle(35, 90, 8),
        depth: 'shallow',
        style: 'lake',
      },
      {
        id: 'pool_p2',
        shape: circle(WIDTH - 35, HEIGHT - 90, 8),
        depth: 'shallow',
        style: 'lake',
      },
    ],

    // Cliff walls defining the elevated areas
    cliffs: [
      {
        id: 'cliff_p1_main',
        shape: path([[P1_X + 30, P1_Y - 10], [P1_X + 35, P1_Y + 25], [P1_X + 10, P1_Y + 35]], 4),
        height: 2,
        style: 'natural',
      },
      {
        id: 'cliff_p2_main',
        shape: path([[P2_X - 30, P2_Y + 10], [P2_X - 35, P2_Y - 25], [P2_X - 10, P2_Y - 35]], 4),
        height: 2,
        style: 'natural',
      },
    ],

    // Unwalkable rock formations
    unwalkable: [
      {
        id: 'rocks_center_n',
        shape: circle(CENTER_X - 8, CENTER_Y - 35, 6),
        style: 'rocks',
      },
      {
        id: 'rocks_center_s',
        shape: circle(CENTER_X + 8, CENTER_Y + 35, 6),
        style: 'rocks',
      },
    ],
  },

  // =========================================================================
  // VEGETATION
  // =========================================================================
  vegetation: {
    forests: [
      // Forest near P1 third
      {
        id: 'forest_p1',
        shape: circle(60, 85, 10),
        density: 'medium',
        vegetationType: 'dead',
        blocksVision: true,
      },
      // Forest near P2 third
      {
        id: 'forest_p2',
        shape: circle(WIDTH - 60, HEIGHT - 85, 10),
        density: 'medium',
        vegetationType: 'dead',
        blocksVision: true,
      },
      // Smaller patches
      {
        id: 'brush_p1_nat',
        shape: circle(P1_X + 45, P1_Y + 30, 6),
        density: 'sparse',
        vegetationType: 'dead',
        blocksVision: false,
      },
      {
        id: 'brush_p2_nat',
        shape: circle(P2_X - 45, P2_Y - 30, 6),
        density: 'sparse',
        vegetationType: 'dead',
        blocksVision: false,
      },
    ],

    bushClusters: [
      { position: { x: 40, y: 50 }, radius: 5, count: { min: 3, max: 5 }, type: 'bush' },
      { position: { x: WIDTH - 40, y: HEIGHT - 50 }, radius: 5, count: { min: 3, max: 5 }, type: 'bush' },
    ],
  },

  // =========================================================================
  // DECORATIONS
  // =========================================================================
  decorations: {
    // Decoration clusters
    clusters: [
      // Crystal formations near void
      {
        position: { x: CENTER_X - 30, y: CENTER_Y - 15 },
        radius: 8,
        category: 'crystals',
        types: ['crystal_small', 'crystal_medium', 'crystal_large'],
        count: { min: 4, max: 8 },
        scale: { min: 0.6, max: 1.2 },
      },
      {
        position: { x: CENTER_X + 30, y: CENTER_Y + 15 },
        radius: 8,
        category: 'crystals',
        types: ['crystal_small', 'crystal_medium', 'crystal_large'],
        count: { min: 4, max: 8 },
        scale: { min: 0.6, max: 1.2 },
      },

      // Rock formations near bases
      {
        position: { x: P1_X + 40, y: P1_Y - 5 },
        radius: 6,
        category: 'rocks',
        types: ['boulder_small', 'boulder_medium'],
        count: { min: 3, max: 6 },
        scale: { min: 0.5, max: 1.0 },
      },
      {
        position: { x: P2_X - 40, y: P2_Y + 5 },
        radius: 6,
        category: 'rocks',
        types: ['boulder_small', 'boulder_medium'],
        count: { min: 3, max: 6 },
        scale: { min: 0.5, max: 1.0 },
      },

      // Debris near bridges
      {
        position: { x: CENTER_X - 30, y: CENTER_Y - 30 },
        radius: 5,
        category: 'debris',
        types: ['debris_small', 'debris_medium'],
        count: { min: 2, max: 4 },
        scale: { min: 0.4, max: 0.8 },
      },
      {
        position: { x: CENTER_X + 30, y: CENTER_Y + 30 },
        radius: 5,
        category: 'debris',
        types: ['debris_small', 'debris_medium'],
        count: { min: 2, max: 4 },
        scale: { min: 0.4, max: 0.8 },
      },
    ],

    // Decoration lines along terrain features
    lines: [
      // Rocks along void edge
      {
        from: { x: CENTER_X - 25, y: CENTER_Y - 25 },
        to: { x: CENTER_X + 25, y: CENTER_Y - 25 },
        category: 'rocks',
        types: ['boulder_small', 'rock_flat'],
        density: 0.3,
        scale: { min: 0.4, max: 0.7 },
        jitter: 2,
      },
      {
        from: { x: CENTER_X - 25, y: CENTER_Y + 25 },
        to: { x: CENTER_X + 25, y: CENTER_Y + 25 },
        category: 'rocks',
        types: ['boulder_small', 'rock_flat'],
        density: 0.3,
        scale: { min: 0.4, max: 0.7 },
        jitter: 2,
      },
    ],

    // Map border decorations
    border: {
      enabled: true,
      style: 'rocks',
      innerRing: {
        offset: 10,
        types: ['boulder_medium', 'boulder_large'],
        scale: { min: 0.8, max: 1.5 },
        density: 0.15,
      },
      outerRing: {
        offset: 4,
        types: ['boulder_large', 'boulder_massive'],
        scale: { min: 1.2, max: 2.0 },
        density: 0.1,
      },
    },

    // Base edge decorations
    baseEdges: {
      enabled: true,
      rockRing: {
        types: ['boulder_small', 'boulder_medium'],
        scale: { min: 0.5, max: 0.9 },
        count: 8,
      },
    },

    seed: 12345,
  },

  // =========================================================================
  // GAME FEATURES
  // =========================================================================
  features: {
    watchTowers: [
      {
        id: 'tower_p1',
        position: { x: 55, y: 55 },
        visionRadius: 18,
        style: 'xelnaga',
      },
      {
        id: 'tower_p2',
        position: { x: WIDTH - 55, y: HEIGHT - 55 },
        visionRadius: 18,
        style: 'xelnaga',
      },
      {
        id: 'tower_center',
        position: { x: CENTER_X, y: CENTER_Y + 25 },
        visionRadius: 22,
        style: 'xelnaga',
      },
    ],

    destructibles: [
      // Rocks blocking shortcut to natural
      {
        id: 'rocks_p1_nat_back',
        position: { x: P1_X + 20, y: P1_Y + 30 },
        health: 2000,
        size: 'large',
      },
      {
        id: 'rocks_p2_nat_back',
        position: { x: P2_X - 20, y: P2_Y - 30 },
        health: 2000,
        size: 'large',
      },
      // Rocks blocking direct center path
      {
        id: 'rocks_center_path',
        position: { x: CENTER_X, y: CENTER_Y - 15 },
        health: 1500,
        size: 'medium',
      },
      {
        id: 'rocks_center_path_2',
        position: { x: CENTER_X, y: CENTER_Y + 15 },
        health: 1500,
        size: 'medium',
      },
    ],
  },

  // =========================================================================
  // OPTIONS
  // =========================================================================
  options: {
    seed: 12345,
    validateConnectivity: true,
    autoFixConnectivity: true,
    debugMode: false,
  },
};

/**
 * Generate the final MapData
 */
export const SHATTERED_EXPANSE = generateFromDeclarative(SHATTERED_EXPANSE_DEF);

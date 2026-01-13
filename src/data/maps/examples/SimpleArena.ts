/**
 * SimpleArena.ts - Example Map Using Connectivity-First System
 *
 * This is a simple 2-player map demonstrating the new defineMap() API.
 * It shows how to:
 * - Define regions (bases, expansions)
 * - Define connections (ramps, ground paths)
 * - Add terrain features
 * - Configure decorations
 *
 * The key innovation: walkability is GUARANTEED because it's defined
 * as an explicit graph, not inferred from terrain.
 */

import {
  defineMap,
  generateMapFromDefinition,
  validateMapDefinition,
  formatValidationResult,
  mainBase,
  naturalExpansion,
  thirdExpansion,
  mapCenter,
  chokePoint,
  type MapDefinition,
} from '../core';

import { MapData } from '../MapTypes';

/**
 * Define the map using the declarative API
 */
const SIMPLE_ARENA_DEFINITION: MapDefinition = defineMap({
  meta: {
    id: 'simple_arena',
    name: 'Simple Arena',
    author: 'VOIDSTRIKE Team',
    description: 'A simple 2-player map demonstrating the connectivity-first map system.',
    version: '1.0.0',
    tags: ['1v1', 'example', 'connectivity'],
  },

  canvas: {
    width: 160,
    height: 160,
    biome: 'grassland',
    baseElevation: 1,
  },

  symmetry: {
    type: 'mirror_x',
    playerCount: 2,
    flexible: true,
  },

  // Define all regions in the map
  // Each region is a node in the connectivity graph
  regions: [
    // Player 1 Main Base (left side, elevated)
    mainBase('p1_main', { x: 35, y: 80 }, 1, {
      elevation: 2,
      radius: 20,
      minerals: 8,
      vespene: 2,
    }),

    // Player 1 Natural (below main, mid elevation)
    naturalExpansion('p1_natural', { x: 55, y: 80 }, 1, {
      elevation: 1,
      radius: 16,
      minerals: 8,
      vespene: 2,
    }),

    // Player 2 Main Base (right side, elevated)
    mainBase('p2_main', { x: 125, y: 80 }, 2, {
      elevation: 2,
      radius: 20,
      minerals: 8,
      vespene: 2,
    }),

    // Player 2 Natural (below main, mid elevation)
    naturalExpansion('p2_natural', { x: 105, y: 80 }, 2, {
      elevation: 1,
      radius: 16,
      minerals: 8,
      vespene: 2,
    }),

    // Map Center (contested area, low ground)
    mapCenter('center', { x: 80, y: 80 }, {
      elevation: 0,
      radius: 25,
    }),

    // Third expansions (low ground)
    thirdExpansion('third_top', { x: 80, y: 40 }, undefined, {
      elevation: 0,
      radius: 14,
      minerals: 6,
      vespene: 1,
    }),
    thirdExpansion('third_bottom', { x: 80, y: 120 }, undefined, {
      elevation: 0,
      radius: 14,
      minerals: 6,
      vespene: 1,
    }),
  ],

  // Define all connections between regions
  // Each connection creates a walkable path between two regions
  connections: [
    // Player 1 main to natural (ramp - elevation change)
    { from: 'p1_main', to: 'p1_natural', type: 'ramp', width: 8 },

    // Player 2 main to natural (ramp - elevation change)
    { from: 'p2_main', to: 'p2_natural', type: 'ramp', width: 8 },

    // Naturals to center (ground - same elevation)
    { from: 'p1_natural', to: 'center', type: 'ground', width: 12 },
    { from: 'p2_natural', to: 'center', type: 'ground', width: 12 },

    // Center to thirds (ground connections)
    { from: 'center', to: 'third_top', type: 'ground', width: 10 },
    { from: 'center', to: 'third_bottom', type: 'ground', width: 10 },
  ],

  // Terrain features
  terrain: {
    // Obstacles blocking direct paths
    obstacles: [
      {
        type: 'rocks',
        shape: 'circle',
        position: { x: 80, y: 60 },
        radius: 6,
      },
      {
        type: 'rocks',
        shape: 'circle',
        position: { x: 80, y: 100 },
        radius: 6,
      },
    ],

    // Void at map corners
    voids: [
      { shape: 'circle', position: { x: 0, y: 0 }, radius: 20 },
      { shape: 'circle', position: { x: 160, y: 0 }, radius: 20 },
      { shape: 'circle', position: { x: 0, y: 160 }, radius: 20 },
      { shape: 'circle', position: { x: 160, y: 160 }, radius: 20 },
    ],
  },

  // Game features
  features: {
    watchTowers: [
      { id: 'tower_center', position: { x: 80, y: 80 }, visionRadius: 22 },
    ],

    destructibles: [
      { id: 'rocks_top', type: 'rocks', position: { x: 80, y: 55 }, health: 1500 },
      { id: 'rocks_bottom', type: 'rocks', position: { x: 80, y: 105 }, health: 1500 },
    ],
  },

  // Decoration configuration
  decorations: {
    // Border wall rocks
    borderWalls: {
      enabled: true,
      innerRing: {
        types: ['rocks_medium', 'rocks_small'],
        scale: { min: 0.8, max: 1.2 },
        density: 0.8,
        offset: 12,
      },
      outerRing: {
        types: ['rocks_large'],
        scale: { min: 2.0, max: 3.5 },
        density: 0.6,
        offset: 5,
      },
    },

    // Decoration clusters
    clusters: [
      {
        type: 'rock',
        position: { x: 40, y: 40 },
        radius: 8,
        count: { min: 4, max: 8 },
        scale: { min: 0.5, max: 1.0 },
      },
      {
        type: 'rock',
        position: { x: 120, y: 40 },
        radius: 8,
        count: { min: 4, max: 8 },
        scale: { min: 0.5, max: 1.0 },
      },
      {
        type: 'rock',
        position: { x: 40, y: 120 },
        radius: 8,
        count: { min: 4, max: 8 },
        scale: { min: 0.5, max: 1.0 },
      },
      {
        type: 'rock',
        position: { x: 120, y: 120 },
        radius: 8,
        count: { min: 4, max: 8 },
        scale: { min: 0.5, max: 1.0 },
      },
    ],

    // Vegetation scatter
    vegetation: {
      enabled: true,
      types: ['bush_small', 'grass_patch'],
      density: 0.3,
      scale: { min: 0.4, max: 0.8 },
      avoidRadius: 15,
    },
  },
});

/**
 * Validate the map definition
 */
function validateDefinition(): void {
  const result = validateMapDefinition(SIMPLE_ARENA_DEFINITION);
  if (!result.valid) {
    console.error('[SimpleArena] Map definition validation failed:');
    console.error(formatValidationResult(result));
  } else {
    console.log('[SimpleArena] Map definition validated successfully');
    if (result.issues.length > 0) {
      console.log(formatValidationResult(result));
    }
  }
}

/**
 * Generate the MapData from the definition
 */
function generateMap(): MapData {
  validateDefinition();
  return generateMapFromDefinition(SIMPLE_ARENA_DEFINITION);
}

// Export the generated map
export const SIMPLE_ARENA = generateMap();

// Also export the definition for inspection
export const SIMPLE_ARENA_DEF = SIMPLE_ARENA_DEFINITION;

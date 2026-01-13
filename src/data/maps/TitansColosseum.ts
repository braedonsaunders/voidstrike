import {
  MapData,
  MapDecoration,
  DIR,
  createBaseResources,
  fillTerrainRect,
  fillTerrainCircle,
  createForestCorridor,
  createRiver,
  createLake,
  createRoad,
  createVoidChasm,
  fillFeatureCircle,
  fillFeatureRect,
  scatterForests,
  createMudArea,
  autoFixConnectivity,
  validateMapConnectivity,
} from './MapTypes';

import {
  defineMap,
  generateTerrainWithConnections,
  getRampClearanceZones,
  type MapDefinition,
} from './core';

/**
 * TITAN'S COLOSSEUM - 8 Player Map (4v4 or FFA)
 *
 * A massive 8-player map with octagonal spawn layout.
 * Designed for epic 4v4 team battles or chaotic FFA matches.
 * MIGRATED TO NEW CONNECTIVITY-FIRST SYSTEM
 *
 * Key Features:
 * - 8 protected main bases around the perimeter
 * - Central colosseum arena for major engagements
 * - Multiple expansion tiers for economic scaling
 * - Volcanic biome with dramatic terrain
 *
 * Layout (400x400):
 *
 *   ┌────────────────────────────────────────────────────────────────────────────┐
 *   │         █P1█            █P2█                                              │
 *   │           ↘              ↙                                                │
 *   │  █P8█                         █P3█                                        │
 *   │     ↓                           ↓                                         │
 *   │              ████████████████                                             │
 *   │             ██  COLOSSEUM  ██                                             │
 *   │             ██   CENTER    ██                                             │
 *   │              ████████████████                                             │
 *   │     ↑                           ↑                                         │
 *   │  █P7█                         █P4█                                        │
 *   │           ↗              ↖                                                │
 *   │         █P6█            █P5█                                              │
 *   └────────────────────────────────────────────────────────────────────────────┘
 */

const MAP_WIDTH = 400;
const MAP_HEIGHT = 400;

// ============================================
// MAP DEFINITION - Connectivity-First Architecture
// ============================================

const TITANS_COLOSSEUM_DEF: MapDefinition = defineMap({
  meta: {
    id: 'titans_colosseum',
    name: "Titan's Colosseum",
    author: 'VOIDSTRIKE Team',
    description: 'A massive 8-player map for epic 4v4 battles or chaotic FFA. Eight protected bases surround a central colosseum where armies clash for supremacy.',
  },

  canvas: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    biome: 'volcanic',
    baseElevation: 0,
  },

  symmetry: {
    type: 'rotational',
    playerCount: 8,
  },

  regions: [
    // 8 Main bases (elevation 2) - octagonal arrangement
    {
      id: 'p1_main',
      name: 'P1 Main',
      type: 'main_base',
      position: { x: 80, y: 45 },
      elevation: 2,
      radius: 25,
      playerSlot: 1,
    },
    {
      id: 'p2_main',
      name: 'P2 Main',
      type: 'main_base',
      position: { x: 320, y: 45 },
      elevation: 2,
      radius: 25,
      playerSlot: 2,
    },
    {
      id: 'p3_main',
      name: 'P3 Main',
      type: 'main_base',
      position: { x: 355, y: 130 },
      elevation: 2,
      radius: 25,
      playerSlot: 3,
    },
    {
      id: 'p4_main',
      name: 'P4 Main',
      type: 'main_base',
      position: { x: 355, y: 270 },
      elevation: 2,
      radius: 25,
      playerSlot: 4,
    },
    {
      id: 'p5_main',
      name: 'P5 Main',
      type: 'main_base',
      position: { x: 320, y: 355 },
      elevation: 2,
      radius: 25,
      playerSlot: 5,
    },
    {
      id: 'p6_main',
      name: 'P6 Main',
      type: 'main_base',
      position: { x: 80, y: 355 },
      elevation: 2,
      radius: 25,
      playerSlot: 6,
    },
    {
      id: 'p7_main',
      name: 'P7 Main',
      type: 'main_base',
      position: { x: 45, y: 270 },
      elevation: 2,
      radius: 25,
      playerSlot: 7,
    },
    {
      id: 'p8_main',
      name: 'P8 Main',
      type: 'main_base',
      position: { x: 45, y: 130 },
      elevation: 2,
      radius: 25,
      playerSlot: 8,
    },

    // 8 Natural expansions (elevation 1) - offset toward center
    {
      id: 'p1_nat',
      name: 'P1 Natural',
      type: 'natural',
      position: { x: 110, y: 75 },
      elevation: 1,
      radius: 16,
    },
    {
      id: 'p2_nat',
      name: 'P2 Natural',
      type: 'natural',
      position: { x: 290, y: 75 },
      elevation: 1,
      radius: 16,
    },
    {
      id: 'p3_nat',
      name: 'P3 Natural',
      type: 'natural',
      position: { x: 325, y: 160 },
      elevation: 1,
      radius: 16,
    },
    {
      id: 'p4_nat',
      name: 'P4 Natural',
      type: 'natural',
      position: { x: 325, y: 240 },
      elevation: 1,
      radius: 16,
    },
    {
      id: 'p5_nat',
      name: 'P5 Natural',
      type: 'natural',
      position: { x: 290, y: 325 },
      elevation: 1,
      radius: 16,
    },
    {
      id: 'p6_nat',
      name: 'P6 Natural',
      type: 'natural',
      position: { x: 110, y: 325 },
      elevation: 1,
      radius: 16,
    },
    {
      id: 'p7_nat',
      name: 'P7 Natural',
      type: 'natural',
      position: { x: 75, y: 240 },
      elevation: 1,
      radius: 16,
    },
    {
      id: 'p8_nat',
      name: 'P8 Natural',
      type: 'natural',
      position: { x: 75, y: 160 },
      elevation: 1,
      radius: 16,
    },

    // 8 Mid-ground transition areas for natural exits (elevation 0)
    // These connect naturals to the low ground
    {
      id: 'p1_ground',
      name: 'P1 Ground',
      type: 'open_ground' as any,
      position: { x: 110, y: 115 },
      elevation: 0,
      radius: 12,
    },
    {
      id: 'p2_ground',
      name: 'P2 Ground',
      type: 'open_ground' as any,
      position: { x: 290, y: 115 },
      elevation: 0,
      radius: 12,
    },
    {
      id: 'p3_ground',
      name: 'P3 Ground',
      type: 'open_ground' as any,
      position: { x: 290, y: 160 },
      elevation: 0,
      radius: 12,
    },
    {
      id: 'p4_ground',
      name: 'P4 Ground',
      type: 'open_ground' as any,
      position: { x: 290, y: 240 },
      elevation: 0,
      radius: 12,
    },
    {
      id: 'p5_ground',
      name: 'P5 Ground',
      type: 'open_ground' as any,
      position: { x: 290, y: 285 },
      elevation: 0,
      radius: 12,
    },
    {
      id: 'p6_ground',
      name: 'P6 Ground',
      type: 'open_ground' as any,
      position: { x: 110, y: 285 },
      elevation: 0,
      radius: 12,
    },
    {
      id: 'p7_ground',
      name: 'P7 Ground',
      type: 'open_ground' as any,
      position: { x: 110, y: 240 },
      elevation: 0,
      radius: 12,
    },
    {
      id: 'p8_ground',
      name: 'P8 Ground',
      type: 'open_ground' as any,
      position: { x: 110, y: 160 },
      elevation: 0,
      radius: 12,
    },

    // 4 Gold expansions (inner ring, elevation 0)
    {
      id: 'gold_nw',
      name: 'Gold NW',
      type: 'gold',
      position: { x: 140, y: 140 },
      elevation: 0,
      radius: 16,
    },
    {
      id: 'gold_ne',
      name: 'Gold NE',
      type: 'gold',
      position: { x: 260, y: 140 },
      elevation: 0,
      radius: 16,
    },
    {
      id: 'gold_se',
      name: 'Gold SE',
      type: 'gold',
      position: { x: 260, y: 260 },
      elevation: 0,
      radius: 16,
    },
    {
      id: 'gold_sw',
      name: 'Gold SW',
      type: 'gold',
      position: { x: 140, y: 260 },
      elevation: 0,
      radius: 16,
    },

    // 4 Edge thirds (elevation 0)
    {
      id: 'north_third',
      name: 'North Third',
      type: 'third',
      position: { x: 200, y: 60 },
      elevation: 0,
      radius: 16,
    },
    {
      id: 'south_third',
      name: 'South Third',
      type: 'third',
      position: { x: 200, y: 340 },
      elevation: 0,
      radius: 16,
    },
    {
      id: 'west_third',
      name: 'West Third',
      type: 'third',
      position: { x: 60, y: 200 },
      elevation: 0,
      radius: 16,
    },
    {
      id: 'east_third',
      name: 'East Third',
      type: 'third',
      position: { x: 340, y: 200 },
      elevation: 0,
      radius: 16,
    },

    // Center colosseum (elevation 0)
    {
      id: 'center',
      name: 'Colosseum Center',
      type: 'center',
      position: { x: 200, y: 200 },
      elevation: 0,
      radius: 40,
    },
  ],

  connections: [
    // Main to Natural connections (elevation 2 -> 1)
    { from: 'p1_main', to: 'p1_nat', type: 'ramp', width: 10 },
    { from: 'p2_main', to: 'p2_nat', type: 'ramp', width: 10 },
    { from: 'p3_main', to: 'p3_nat', type: 'ramp', width: 10 },
    { from: 'p4_main', to: 'p4_nat', type: 'ramp', width: 10 },
    { from: 'p5_main', to: 'p5_nat', type: 'ramp', width: 10 },
    { from: 'p6_main', to: 'p6_nat', type: 'ramp', width: 10 },
    { from: 'p7_main', to: 'p7_nat', type: 'ramp', width: 10 },
    { from: 'p8_main', to: 'p8_nat', type: 'ramp', width: 10 },

    // Natural to low ground connections (elevation 1 -> 0)
    { from: 'p1_nat', to: 'p1_ground', type: 'ramp', width: 10 },
    { from: 'p2_nat', to: 'p2_ground', type: 'ramp', width: 10 },
    { from: 'p3_nat', to: 'p3_ground', type: 'ramp', width: 10 },
    { from: 'p4_nat', to: 'p4_ground', type: 'ramp', width: 10 },
    { from: 'p5_nat', to: 'p5_ground', type: 'ramp', width: 10 },
    { from: 'p6_nat', to: 'p6_ground', type: 'ramp', width: 10 },
    { from: 'p7_nat', to: 'p7_ground', type: 'ramp', width: 10 },
    { from: 'p8_nat', to: 'p8_ground', type: 'ramp', width: 10 },

    // Ground level connections (elevation 0) - connect player grounds to center
    { from: 'p1_ground', to: 'center', type: 'ground', width: 12 },
    { from: 'p2_ground', to: 'center', type: 'ground', width: 12 },
    { from: 'p3_ground', to: 'center', type: 'ground', width: 12 },
    { from: 'p4_ground', to: 'center', type: 'ground', width: 12 },
    { from: 'p5_ground', to: 'center', type: 'ground', width: 12 },
    { from: 'p6_ground', to: 'center', type: 'ground', width: 12 },
    { from: 'p7_ground', to: 'center', type: 'ground', width: 12 },
    { from: 'p8_ground', to: 'center', type: 'ground', width: 12 },

    // Gold expansions to center
    { from: 'gold_nw', to: 'center', type: 'ground', width: 10 },
    { from: 'gold_ne', to: 'center', type: 'ground', width: 10 },
    { from: 'gold_se', to: 'center', type: 'ground', width: 10 },
    { from: 'gold_sw', to: 'center', type: 'ground', width: 10 },

    // Third expansions to center
    { from: 'north_third', to: 'center', type: 'ground', width: 10 },
    { from: 'south_third', to: 'center', type: 'ground', width: 10 },
    { from: 'west_third', to: 'center', type: 'ground', width: 10 },
    { from: 'east_third', to: 'center', type: 'ground', width: 10 },
  ],

  // Terrain features handled in post-processing for exact visual matching
  terrain: {},
  features: {},
  decorations: {},
});

function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// Base exclusion zones (used by decoration placement)
const BASE_EXCLUSION_ZONES = [
  // Mains
  { x: 80, y: 45, radius: 28 },
  { x: 320, y: 45, radius: 28 },
  { x: 355, y: 130, radius: 28 },
  { x: 355, y: 270, radius: 28 },
  { x: 320, y: 355, radius: 28 },
  { x: 80, y: 355, radius: 28 },
  { x: 45, y: 270, radius: 28 },
  { x: 45, y: 130, radius: 28 },
  // Naturals
  { x: 110, y: 75, radius: 18 },
  { x: 290, y: 75, radius: 18 },
  { x: 325, y: 160, radius: 18 },
  { x: 325, y: 240, radius: 18 },
  { x: 290, y: 325, radius: 18 },
  { x: 110, y: 325, radius: 18 },
  { x: 75, y: 240, radius: 18 },
  { x: 75, y: 160, radius: 18 },
  // Center
  { x: 200, y: 200, radius: 35 },
  // Gold expansions
  { x: 140, y: 140, radius: 14 },
  { x: 260, y: 140, radius: 14 },
  { x: 260, y: 260, radius: 14 },
  { x: 140, y: 260, radius: 14 },
];

function isInBaseArea(x: number, y: number): boolean {
  for (const zone of BASE_EXCLUSION_ZONES) {
    const dx = x - zone.x;
    const dy = y - zone.y;
    if (dx * dx + dy * dy < zone.radius * zone.radius) {
      return true;
    }
  }
  return false;
}

function isInRampClearanceZone(x: number, y: number, clearanceZones: Set<string>): boolean {
  return clearanceZones.has(`${Math.floor(x)},${Math.floor(y)}`);
}

function generateVolcanicDecorations(rampClearance: Set<string>): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(1234);

  const addRockCluster = (cx: number, cy: number, count: number, spread: number) => {
    const rockTypes: Array<'rocks_large' | 'rocks_small' | 'rock_single'> = [
      'rocks_large', 'rocks_small', 'rock_single'
    ];
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearanceZone(x, y, rampClearance)) continue;
      decorations.push({
        type: rockTypes[Math.floor(rand() * rockTypes.length)],
        x, y,
        scale: 0.5 + rand() * 0.9,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  const addCrystalCluster = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearanceZone(x, y, rampClearance)) continue;
      decorations.push({
        type: 'crystal_formation',
        x, y,
        scale: 0.6 + rand() * 0.8,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  const addDeadTrees = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearanceZone(x, y, rampClearance)) continue;
      decorations.push({
        type: 'tree_dead',
        x, y,
        scale: 0.6 + rand() * 0.6,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  const addRockCliffLine = (x1: number, y1: number, x2: number, y2: number, density: number = 2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(length / density);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t + (rand() - 0.5) * 2;
      const y = y1 + dy * t + (rand() - 0.5) * 2;
      if (isInBaseArea(x, y) || isInRampClearanceZone(x, y, rampClearance)) continue;
      const rockType = rand() < 0.4 ? 'rocks_large' : (rand() < 0.7 ? 'rocks_small' : 'rock_single');
      decorations.push({
        type: rockType,
        x, y,
        scale: 0.6 + rand() * 0.6,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  const addMassiveBorderRocks = (x1: number, y1: number, x2: number, y2: number, density: number = 5) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(length / density);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t + (rand() - 0.5) * 3;
      const y = y1 + dy * t + (rand() - 0.5) * 3;
      const rockType = rand() < 0.6 ? 'rocks_large' : 'rocks_small';
      decorations.push({
        type: rockType,
        x, y,
        scale: 2.0 + rand() * 2.0,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  const addBaseEdgeRocks = (cx: number, cy: number, radius: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.3;
      const dist = radius + 2 + rand() * 4;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearanceZone(x, y, rampClearance)) continue;
      const rockType = rand() < 0.3 ? 'rocks_large' : (rand() < 0.6 ? 'rocks_small' : 'rock_single');
      decorations.push({
        type: rockType,
        x, y,
        scale: 0.5 + rand() * 0.6,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  const addBaseEdgeTrees = (cx: number, cy: number, radius: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.4;
      const dist = radius + 4 + rand() * 6;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearanceZone(x, y, rampClearance)) continue;
      decorations.push({
        type: 'tree_dead',
        x, y,
        scale: 0.6 + rand() * 0.5,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Main base positions for edge decorations
  const mainPositions = [
    { x: 80, y: 45 },
    { x: 320, y: 45 },
    { x: 355, y: 130 },
    { x: 355, y: 270 },
    { x: 320, y: 355 },
    { x: 80, y: 355 },
    { x: 45, y: 270 },
    { x: 45, y: 130 },
  ];

  // MAIN BASE EDGE DECORATIONS
  for (const pos of mainPositions) {
    addBaseEdgeRocks(pos.x, pos.y, 29, 24);
    addBaseEdgeTrees(pos.x, pos.y, 32, 16);
  }

  // NATURAL EXPANSION EDGE DECORATIONS
  addBaseEdgeRocks(110, 75, 21, 16);
  addBaseEdgeTrees(110, 75, 24, 12);
  addBaseEdgeRocks(290, 75, 21, 16);
  addBaseEdgeTrees(290, 75, 24, 12);
  addBaseEdgeRocks(325, 160, 21, 16);
  addBaseEdgeTrees(325, 160, 24, 12);
  addBaseEdgeRocks(325, 240, 21, 16);
  addBaseEdgeTrees(325, 240, 24, 12);
  addBaseEdgeRocks(290, 325, 21, 16);
  addBaseEdgeTrees(290, 325, 24, 12);
  addBaseEdgeRocks(110, 325, 21, 16);
  addBaseEdgeTrees(110, 325, 24, 12);
  addBaseEdgeRocks(75, 240, 21, 16);
  addBaseEdgeTrees(75, 240, 24, 12);
  addBaseEdgeRocks(75, 160, 21, 16);
  addBaseEdgeTrees(75, 160, 24, 12);

  // CONTINUOUS ROCK CLIFF WALLS
  // Map border cliffs
  addRockCliffLine(16, 16, 16, 384, 3);
  addRockCliffLine(384, 16, 384, 384, 3);
  addRockCliffLine(16, 16, 384, 16, 3);
  addRockCliffLine(16, 384, 384, 384, 3);

  // Massive outer border rocks
  addMassiveBorderRocks(6, 6, 6, 394, 6);
  addMassiveBorderRocks(394, 6, 394, 394, 6);
  addMassiveBorderRocks(6, 6, 394, 6, 6);
  addMassiveBorderRocks(6, 394, 394, 394, 6);

  // Central colosseum walls
  addRockCliffLine(170, 170, 230, 170, 2);
  addRockCliffLine(170, 230, 230, 230, 2);
  addRockCliffLine(170, 170, 170, 230, 2);
  addRockCliffLine(230, 170, 230, 230, 2);

  // Diagonal connections between bases
  addRockCliffLine(100, 65, 130, 95, 2);
  addRockCliffLine(270, 65, 300, 95, 2);
  addRockCliffLine(335, 150, 305, 180, 2);
  addRockCliffLine(335, 250, 305, 220, 2);
  addRockCliffLine(300, 305, 270, 335, 2);
  addRockCliffLine(130, 305, 100, 335, 2);
  addRockCliffLine(65, 250, 95, 220, 2);
  addRockCliffLine(65, 150, 95, 180, 2);

  // ORIGINAL DECORATIONS (enhanced)
  // Map borders - volcanic rocks
  for (let i = 15; i < MAP_WIDTH - 15; i += 18) {
    addRockCluster(i, 12, 6, 7);
    addRockCluster(i, MAP_HEIGHT - 12, 6, 7);
  }
  for (let i = 15; i < MAP_HEIGHT - 15; i += 18) {
    addRockCluster(12, i, 6, 7);
    addRockCluster(MAP_WIDTH - 12, i, 6, 7);
  }

  // Main base surroundings - enhanced
  for (const pos of mainPositions) {
    addRockCluster(pos.x - 25, pos.y + 25, 12, 8);
    addRockCluster(pos.x + 25, pos.y - 25, 12, 8);
    addDeadTrees(pos.x - 30, pos.y - 30, 8, 6);
    addDeadTrees(pos.x + 30, pos.y + 30, 8, 6);
  }

  // Central colosseum - heavy decoration
  addCrystalCluster(200, 170, 28, 20);
  addCrystalCluster(200, 230, 28, 20);
  addRockCluster(170, 200, 25, 18);
  addRockCluster(230, 200, 25, 18);

  // Gold expansion surroundings - enhanced
  addCrystalCluster(140, 140, 14, 10);
  addCrystalCluster(260, 140, 14, 10);
  addCrystalCluster(140, 260, 14, 10);
  addCrystalCluster(260, 260, 14, 10);
  addRockCluster(150, 150, 8, 6);
  addRockCluster(250, 150, 8, 6);
  addRockCluster(150, 250, 8, 6);
  addRockCluster(250, 250, 8, 6);

  // Path decorations - enhanced
  addDeadTrees(200, 100, 16, 12);
  addDeadTrees(200, 300, 16, 12);
  addDeadTrees(100, 200, 16, 12);
  addDeadTrees(300, 200, 16, 12);

  // Corner decorations - enhanced
  addDeadTrees(50, 50, 12, 8);
  addDeadTrees(350, 50, 12, 8);
  addDeadTrees(50, 350, 12, 8);
  addDeadTrees(350, 350, 12, 8);
  addRockCluster(55, 55, 8, 6);
  addRockCluster(345, 55, 8, 6);
  addRockCluster(55, 345, 8, 6);
  addRockCluster(345, 345, 8, 6);

  // Scattered vegetation
  for (let i = 0; i < 250; i++) {
    const x = 20 + rand() * (MAP_WIDTH - 40);
    const y = 20 + rand() * (MAP_HEIGHT - 40);
    if (isInBaseArea(x, y)) continue;
    decorations.push({
      type: rand() > 0.5 ? 'bush' : 'grass_clump',
      x, y,
      scale: 0.4 + rand() * 0.5,
      rotation: rand() * Math.PI * 2,
    });
  }

  // Debris and ruins
  decorations.push({ type: 'debris', x: 185, y: 185, scale: 1.2 });
  decorations.push({ type: 'debris', x: 215, y: 215, scale: 1.2 });
  decorations.push({ type: 'debris', x: 185, y: 215, scale: 1.0 });
  decorations.push({ type: 'debris', x: 215, y: 185, scale: 1.0 });
  decorations.push({ type: 'ruined_wall', x: 200, y: 200, scale: 1.5 });
  decorations.push({ type: 'ruined_wall', x: 190, y: 210, scale: 1.2 });
  decorations.push({ type: 'ruined_wall', x: 210, y: 190, scale: 1.2 });

  // Escape pods scattered around edges
  decorations.push({ type: 'escape_pod', x: 20, y: 200, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 380, y: 200, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 200, y: 20, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 200, y: 380, scale: 0.9 });

  return decorations;
}

function generateTitansColosseum(): MapData {
  // Generate terrain from connectivity-first definition
  const { terrain, ramps, connections } = generateTerrainWithConnections(TITANS_COLOSSEUM_DEF);

  // Get ramp clearance zones to prevent decorations on ramps
  const rampClearance = getRampClearanceZones(connections);

  // ========================================
  // MAP BORDERS
  // ========================================
  fillTerrainRect(terrain, 0, 0, 14, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 14, 0, 14, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 14, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 14, MAP_WIDTH, 14, 'unwalkable');

  // ========================================
  // CENTER COLOSSEUM - Major contested area
  // ========================================
  fillTerrainRect(terrain, 185, 185, 30, 30, 'unwalkable');

  // ========================================
  // TERRAIN FEATURES - Chokepoints
  // ========================================
  // Inner ring cliffs
  fillTerrainCircle(terrain, 160, 160, 12, 'unwalkable');
  fillTerrainCircle(terrain, 240, 160, 12, 'unwalkable');
  fillTerrainCircle(terrain, 240, 240, 12, 'unwalkable');
  fillTerrainCircle(terrain, 160, 240, 12, 'unwalkable');

  // Path-narrowing cliffs
  fillTerrainCircle(terrain, 120, 200, 10, 'unwalkable');
  fillTerrainCircle(terrain, 280, 200, 10, 'unwalkable');
  fillTerrainCircle(terrain, 200, 120, 10, 'unwalkable');
  fillTerrainCircle(terrain, 200, 280, 10, 'unwalkable');

  // ========================================
  // NEW TERRAIN FEATURES - Epic volcanic arena
  // ========================================
  // LAVA MOAT around center colosseum - Ring of fire
  createRiver(terrain, 160, 160, 160, 240, 10, undefined, 0);
  createRiver(terrain, 240, 160, 240, 240, 10, undefined, 0);

  // Corner void chasms - Volcanic pits
  createVoidChasm(terrain, 0, 0, 30, 30, 3);
  createVoidChasm(terrain, MAP_WIDTH - 30, 0, 30, 30, 3);
  createVoidChasm(terrain, 0, MAP_HEIGHT - 30, 30, 30, 3);
  createVoidChasm(terrain, MAP_WIDTH - 30, MAP_HEIGHT - 30, 30, 30, 3);

  // LAKES - Tactical water hazards
  createLake(terrain, 100, 100, 12, 3);
  createLake(terrain, 300, 100, 12, 3);
  createLake(terrain, 100, 300, 12, 3);
  createLake(terrain, 300, 300, 12, 3);

  // FOREST CORRIDORS
  createForestCorridor(terrain, 80, 80, 120, 80, 18, 6, true);
  createForestCorridor(terrain, 280, 80, 320, 80, 18, 6, true);
  createForestCorridor(terrain, 80, 320, 120, 320, 18, 6, true);
  createForestCorridor(terrain, 280, 320, 320, 320, 18, 6, true);
  createForestCorridor(terrain, 60, 180, 60, 220, 16, 5, true);
  createForestCorridor(terrain, 340, 180, 340, 220, 16, 5, true);

  // ROADS - Highway system
  createRoad(terrain, 80, 45, 320, 45, 4);
  createRoad(terrain, 80, 355, 320, 355, 4);
  createRoad(terrain, 45, 130, 45, 270, 4);
  createRoad(terrain, 355, 130, 355, 270, 4);
  createRoad(terrain, 100, 100, 160, 160, 3);
  createRoad(terrain, 300, 100, 240, 160, 3);
  createRoad(terrain, 100, 300, 160, 240, 3);
  createRoad(terrain, 300, 300, 240, 240, 3);

  // SCATTERED FORESTS
  scatterForests(terrain, MAP_WIDTH, MAP_HEIGHT, 160, 5, 14, BASE_EXCLUSION_ZONES, 1234, 0.3);

  // DENSE FORESTS at gold expansions
  fillFeatureCircle(terrain, 140, 140, 10, 'forest_dense');
  fillFeatureCircle(terrain, 260, 140, 10, 'forest_dense');
  fillFeatureCircle(terrain, 140, 260, 10, 'forest_dense');
  fillFeatureCircle(terrain, 260, 260, 10, 'forest_dense');

  // VOLCANIC ASH FOREST WALLS
  fillFeatureRect(terrain, 140, 20, 12, 35, 'forest_dense');
  fillFeatureRect(terrain, 248, 20, 12, 35, 'forest_dense');
  fillFeatureRect(terrain, 140, 345, 12, 35, 'forest_dense');
  fillFeatureRect(terrain, 248, 345, 12, 35, 'forest_dense');
  fillFeatureRect(terrain, 20, 140, 35, 12, 'forest_dense');
  fillFeatureRect(terrain, 20, 248, 35, 12, 'forest_dense');
  fillFeatureRect(terrain, 345, 140, 35, 12, 'forest_dense');
  fillFeatureRect(terrain, 345, 248, 35, 12, 'forest_dense');

  // Diagonal forest walls
  fillFeatureCircle(terrain, 120, 120, 12, 'forest_dense');
  fillFeatureCircle(terrain, 280, 120, 12, 'forest_dense');
  fillFeatureCircle(terrain, 120, 280, 12, 'forest_dense');
  fillFeatureCircle(terrain, 280, 280, 12, 'forest_dense');

  // Mid-ring ash forest clusters
  fillFeatureCircle(terrain, 170, 90, 9, 'forest_dense');
  fillFeatureCircle(terrain, 230, 90, 9, 'forest_dense');
  fillFeatureCircle(terrain, 90, 170, 9, 'forest_dense');
  fillFeatureCircle(terrain, 90, 230, 9, 'forest_dense');
  fillFeatureCircle(terrain, 170, 310, 9, 'forest_dense');
  fillFeatureCircle(terrain, 230, 310, 9, 'forest_dense');
  fillFeatureCircle(terrain, 310, 170, 9, 'forest_dense');
  fillFeatureCircle(terrain, 310, 230, 9, 'forest_dense');

  // Inner ring clusters
  fillFeatureCircle(terrain, 180, 150, 7, 'forest_dense');
  fillFeatureCircle(terrain, 220, 150, 7, 'forest_dense');
  fillFeatureCircle(terrain, 180, 250, 7, 'forest_dense');
  fillFeatureCircle(terrain, 220, 250, 7, 'forest_dense');
  fillFeatureCircle(terrain, 150, 180, 7, 'forest_dense');
  fillFeatureCircle(terrain, 150, 220, 7, 'forest_dense');
  fillFeatureCircle(terrain, 250, 180, 7, 'forest_dense');
  fillFeatureCircle(terrain, 250, 220, 7, 'forest_dense');

  // MUD areas
  createMudArea(terrain, 200, 200, 20);
  createMudArea(terrain, 200, 100, 8);
  createMudArea(terrain, 200, 300, 8);
  createMudArea(terrain, 100, 200, 8);
  createMudArea(terrain, 300, 200, 8);

  // Light forests
  fillFeatureCircle(terrain, 150, 100, 8, 'forest_light');
  fillFeatureCircle(terrain, 250, 100, 8, 'forest_light');
  fillFeatureCircle(terrain, 150, 300, 8, 'forest_light');
  fillFeatureCircle(terrain, 250, 300, 8, 'forest_light');
  fillFeatureCircle(terrain, 100, 150, 8, 'forest_light');
  fillFeatureCircle(terrain, 100, 250, 8, 'forest_light');
  fillFeatureCircle(terrain, 300, 150, 8, 'forest_light');
  fillFeatureCircle(terrain, 300, 250, 8, 'forest_light');
  fillFeatureCircle(terrain, 60, 100, 6, 'forest_light');
  fillFeatureCircle(terrain, 100, 60, 6, 'forest_light');
  fillFeatureCircle(terrain, 340, 100, 6, 'forest_light');
  fillFeatureCircle(terrain, 300, 60, 6, 'forest_light');
  fillFeatureCircle(terrain, 60, 300, 6, 'forest_light');
  fillFeatureCircle(terrain, 100, 340, 6, 'forest_light');
  fillFeatureCircle(terrain, 340, 300, 6, 'forest_light');
  fillFeatureCircle(terrain, 300, 340, 6, 'forest_light');
  fillFeatureCircle(terrain, 200, 150, 5, 'forest_light');
  fillFeatureCircle(terrain, 200, 250, 5, 'forest_light');
  fillFeatureCircle(terrain, 150, 200, 5, 'forest_light');
  fillFeatureCircle(terrain, 250, 200, 5, 'forest_light');

  // ========================================
  // EXPANSIONS WITH RESOURCES
  // ========================================
  const p1Main = createBaseResources(80, 45, DIR.UP_LEFT);
  const p2Main = createBaseResources(320, 45, DIR.UP_RIGHT);
  const p3Main = createBaseResources(355, 130, DIR.RIGHT);
  const p4Main = createBaseResources(355, 270, DIR.RIGHT);
  const p5Main = createBaseResources(320, 355, DIR.DOWN_RIGHT);
  const p6Main = createBaseResources(80, 355, DIR.DOWN_LEFT);
  const p7Main = createBaseResources(45, 270, DIR.LEFT);
  const p8Main = createBaseResources(45, 130, DIR.LEFT);

  const p1Nat = createBaseResources(110, 75, DIR.LEFT, 1500, 2250, false, 10);   // Perpendicular to N-S ramp
  const p2Nat = createBaseResources(290, 75, DIR.RIGHT, 1500, 2250, false, 10);  // Perpendicular to N-S ramp
  const p3Nat = createBaseResources(325, 160, DIR.UP, 1500, 2250, false, 10);    // Perpendicular to E-W ramp
  const p4Nat = createBaseResources(325, 240, DIR.DOWN, 1500, 2250, false, 10);  // Perpendicular to E-W ramp
  const p5Nat = createBaseResources(290, 325, DIR.RIGHT, 1500, 2250, false, 10); // Perpendicular to N-S ramp
  const p6Nat = createBaseResources(110, 325, DIR.LEFT, 1500, 2250, false, 10);  // Perpendicular to N-S ramp
  const p7Nat = createBaseResources(75, 240, DIR.DOWN, 1500, 2250, false, 10);   // Perpendicular to E-W ramp
  const p8Nat = createBaseResources(75, 160, DIR.UP, 1500, 2250, false, 10);     // Perpendicular to E-W ramp

  const goldNW = createBaseResources(140, 140, DIR.UP_LEFT, 1500, 2250, true);
  const goldNE = createBaseResources(260, 140, DIR.UP_RIGHT, 1500, 2250, true);
  const goldSE = createBaseResources(260, 260, DIR.DOWN_RIGHT, 1500, 2250, true);
  const goldSW = createBaseResources(140, 260, DIR.DOWN_LEFT, 1500, 2250, true);

  const northThird = createBaseResources(200, 60, DIR.UP);
  const southThird = createBaseResources(200, 340, DIR.DOWN);
  const westThird = createBaseResources(60, 200, DIR.LEFT);
  const eastThird = createBaseResources(340, 200, DIR.RIGHT);

  const center = createBaseResources(200, 200, DIR.DOWN, 1500, 2250, true);

  const expansions = [
    { name: 'P1 Main', x: 80, y: 45, isMain: true, ...p1Main },
    { name: 'P2 Main', x: 320, y: 45, isMain: true, ...p2Main },
    { name: 'P3 Main', x: 355, y: 130, isMain: true, ...p3Main },
    { name: 'P4 Main', x: 355, y: 270, isMain: true, ...p4Main },
    { name: 'P5 Main', x: 320, y: 355, isMain: true, ...p5Main },
    { name: 'P6 Main', x: 80, y: 355, isMain: true, ...p6Main },
    { name: 'P7 Main', x: 45, y: 270, isMain: true, ...p7Main },
    { name: 'P8 Main', x: 45, y: 130, isMain: true, ...p8Main },
    { name: 'P1 Natural', x: 110, y: 75, isNatural: true, ...p1Nat },
    { name: 'P2 Natural', x: 290, y: 75, isNatural: true, ...p2Nat },
    { name: 'P3 Natural', x: 325, y: 160, isNatural: true, ...p3Nat },
    { name: 'P4 Natural', x: 325, y: 240, isNatural: true, ...p4Nat },
    { name: 'P5 Natural', x: 290, y: 325, isNatural: true, ...p5Nat },
    { name: 'P6 Natural', x: 110, y: 325, isNatural: true, ...p6Nat },
    { name: 'P7 Natural', x: 75, y: 240, isNatural: true, ...p7Nat },
    { name: 'P8 Natural', x: 75, y: 160, isNatural: true, ...p8Nat },
    { name: 'Gold NW', x: 140, y: 140, ...goldNW },
    { name: 'Gold NE', x: 260, y: 140, ...goldNE },
    { name: 'Gold SE', x: 260, y: 260, ...goldSE },
    { name: 'Gold SW', x: 140, y: 260, ...goldSW },
    { name: 'North Third', x: 200, y: 60, ...northThird },
    { name: 'South Third', x: 200, y: 340, ...southThird },
    { name: 'West Third', x: 60, y: 200, ...westThird },
    { name: 'East Third', x: 340, y: 200, ...eastThird },
    { name: 'Colosseum Center', x: 200, y: 200, ...center },
  ];

  const mapData: MapData = {
    id: 'titans_colosseum',
    name: "Titan's Colosseum",
    author: 'VOIDSTRIKE Team',
    description: 'A massive 8-player map for epic 4v4 battles or chaotic FFA. Eight protected bases surround a central colosseum where armies clash for supremacy.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    spawns: [
      { x: 80, y: 45, playerSlot: 1, rotation: Math.PI / 2 },
      { x: 320, y: 45, playerSlot: 2, rotation: Math.PI / 2 },
      { x: 355, y: 130, playerSlot: 3, rotation: 0 },
      { x: 355, y: 270, playerSlot: 4, rotation: 0 },
      { x: 320, y: 355, playerSlot: 5, rotation: -Math.PI / 2 },
      { x: 80, y: 355, playerSlot: 6, rotation: -Math.PI / 2 },
      { x: 45, y: 270, playerSlot: 7, rotation: Math.PI },
      { x: 45, y: 130, playerSlot: 8, rotation: Math.PI },
    ],

    expansions,

    watchTowers: [
      { x: 200, y: 200, radius: 32 },
      { x: 140, y: 200, radius: 20 },
      { x: 260, y: 200, radius: 20 },
      { x: 200, y: 140, radius: 20 },
      { x: 200, y: 260, radius: 20 },
    ],

    ramps,

    destructibles: [
      { x: 160, y: 160, health: 2000 },
      { x: 240, y: 160, health: 2000 },
      { x: 240, y: 240, health: 2000 },
      { x: 160, y: 240, health: 2000 },
      { x: 120, y: 200, health: 1500 },
      { x: 280, y: 200, health: 1500 },
      { x: 200, y: 120, health: 1500 },
      { x: 200, y: 280, health: 1500 },
    ],

    decorations: generateVolcanicDecorations(rampClearance),

    playerCount: 8,
    maxPlayers: 8,
    isRanked: true,

    biome: 'volcanic',
    fogNear: 120,
    fogFar: 400,
  };

  // Validate and fix connectivity
  const validation = validateMapConnectivity(mapData);
  if (!validation.isValid) {
    console.warn('[TitansColosseum] Map has connectivity issues, attempting auto-fix...');
    console.warn('[TitansColosseum] Unreachable locations:', validation.unreachableLocations);
    const corridorsCarved = autoFixConnectivity(mapData);
    console.log(`[TitansColosseum] Auto-fix carved ${corridorsCarved} corridors`);

    const postFixValidation = validateMapConnectivity(mapData);
    if (!postFixValidation.isValid) {
      console.error('[TitansColosseum] CRITICAL: Map still has unreachable areas after auto-fix!');
      console.error('[TitansColosseum] Still unreachable:', postFixValidation.unreachableLocations);
    } else {
      console.log('[TitansColosseum] Connectivity fixed successfully');
    }
  } else {
    console.log('[TitansColosseum] Map connectivity validated - all areas reachable');
  }

  return mapData;
}

export const TITANS_COLOSSEUM = generateTitansColosseum();

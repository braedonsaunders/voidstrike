/**
 * CRYSTAL CAVERNS - 2 Player (1v1) Map
 *
 * A competitive 1v1 map with horizontal spawns and frozen biome.
 * MIGRATED TO NEW CONNECTIVITY-FIRST SYSTEM
 *
 * Key Features:
 * - Protected main bases with single ramp entrance
 * - Natural expansions with defensible chokepoints
 * - Multiple expansion locations for late game
 * - Central contested area with watch tower
 * - Ice/crystal themed environment
 */

import {
  MapData,
  MapDecoration,
  createBaseResources,
  DIR,
  fillTerrainRect,
  fillTerrainCircle,
  createForestCorridor,
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

const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;

// ============================================
// MAP DEFINITION - Connectivity-First Architecture
// ============================================

const CRYSTAL_CAVERNS_DEF: MapDefinition = defineMap({
  meta: {
    id: 'crystal_caverns',
    name: 'Crystal Caverns',
    author: 'VOIDSTRIKE Team',
    description: 'A competitive 1v1 map with horizontal spawns. Protected main bases with single ramp entry.',
  },

  canvas: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    biome: 'frozen',
    baseElevation: 0,
  },

  symmetry: {
    type: 'mirror_x',
    playerCount: 2,
  },

  regions: [
    // Main bases - elevated platforms with cliff rings
    {
      id: 'p1_main',
      name: 'P1 Main',
      type: 'main_base',
      position: { x: 30, y: 90 },
      elevation: 2,
      radius: 20,
      playerSlot: 1,
    },
    {
      id: 'p2_main',
      name: 'P2 Main',
      type: 'main_base',
      position: { x: 170, y: 90 },
      elevation: 2,
      radius: 20,
      playerSlot: 2,
    },

    // Natural expansions - mid-elevation platforms
    {
      id: 'p1_nat',
      name: 'P1 Natural',
      type: 'natural',
      position: { x: 55, y: 55 },
      elevation: 1,
      radius: 14,
    },
    {
      id: 'p2_nat',
      name: 'P2 Natural',
      type: 'natural',
      position: { x: 145, y: 125 },
      elevation: 1,
      radius: 14,
    },

    // Third expansions - ground level
    {
      id: 'p1_third',
      name: 'P1 Third',
      type: 'third',
      position: { x: 30, y: 30 },
      elevation: 0,
      radius: 16,
    },
    {
      id: 'p2_third',
      name: 'P2 Third',
      type: 'third',
      position: { x: 170, y: 150 },
      elevation: 0,
      radius: 16,
    },

    // Fourth expansions - ground level
    {
      id: 'p1_fourth',
      name: 'P1 Fourth',
      type: 'fourth',
      position: { x: 30, y: 150 },
      elevation: 0,
      radius: 14,
    },
    {
      id: 'p2_fourth',
      name: 'P2 Fourth',
      type: 'fourth',
      position: { x: 170, y: 30 },
      elevation: 0,
      radius: 14,
    },

    // Center gold expansion
    {
      id: 'center_gold',
      name: 'Center Gold',
      type: 'gold',
      position: { x: 100, y: 90 },
      elevation: 0,
      radius: 18,
    },
  ],

  connections: [
    // Main to Natural connections (elevation 2 -> 1)
    { from: 'p1_main', to: 'p1_nat', type: 'ramp', width: 10 },
    { from: 'p2_main', to: 'p2_nat', type: 'ramp', width: 10 },

    // Natural to Third connections (elevation 1 -> 0)
    { from: 'p1_nat', to: 'p1_third', type: 'ramp', width: 10 },
    { from: 'p2_nat', to: 'p2_third', type: 'ramp', width: 10 },

    // Ground level connections (elevation 0)
    { from: 'p1_third', to: 'center_gold', type: 'ground', width: 12 },
    { from: 'p2_third', to: 'center_gold', type: 'ground', width: 12 },
    { from: 'p1_fourth', to: 'center_gold', type: 'ground', width: 10 },
    { from: 'p2_fourth', to: 'center_gold', type: 'ground', width: 10 },
  ],

  // Terrain features handled in post-processing for exact visual matching
  terrain: {},
  features: {},
  decorations: {},
});

// ============================================
// DECORATION GENERATION
// ============================================

// Seeded random for consistent decorations
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// Base exclusion zones - no decorations here
const BASE_EXCLUSION_ZONES = [
  { x: 30, y: 90, radius: 22 },   // P1 main
  { x: 170, y: 90, radius: 22 },  // P2 main
  { x: 55, y: 55, radius: 16 },   // P1 natural
  { x: 145, y: 125, radius: 16 }, // P2 natural
  { x: 30, y: 30, radius: 14 },   // P1 third
  { x: 170, y: 150, radius: 14 }, // P2 third
  { x: 100, y: 90, radius: 16 },  // Center gold
  { x: 30, y: 150, radius: 14 },  // P1 fourth
  { x: 170, y: 30, radius: 14 },  // P2 fourth
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

function generateFrozenDecorations(rampClearance: Set<string>): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(123);

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
        scale: 0.5 + rand() * 0.7,
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
        scale: 0.7 + rand() * 0.5,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

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
        scale: 0.4 + rand() * 0.6,
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

  const addMassiveBorderCrystals = (x1: number, y1: number, x2: number, y2: number, density: number = 8) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(length / density);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t + (rand() - 0.5) * 4;
      const y = y1 + dy * t + (rand() - 0.5) * 4;
      decorations.push({
        type: 'crystal_formation',
        x, y,
        scale: 1.8 + rand() * 1.5,
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

  // MAIN BASE EDGE DECORATIONS
  addBaseEdgeRocks(30, 90, 24, 20);
  addBaseEdgeTrees(30, 90, 27, 14);
  addBaseEdgeRocks(170, 90, 24, 20);
  addBaseEdgeTrees(170, 90, 27, 14);

  // NATURAL EXPANSION EDGE DECORATIONS
  addBaseEdgeRocks(55, 55, 19, 14);
  addBaseEdgeTrees(55, 55, 22, 10);
  addBaseEdgeRocks(145, 125, 19, 14);
  addBaseEdgeTrees(145, 125, 22, 10);

  // CONTINUOUS ROCK CLIFF WALLS
  addRockCliffLine(12, 12, 12, 168, 3);
  addRockCliffLine(188, 12, 188, 168, 3);
  addRockCliffLine(12, 12, 188, 12, 3);
  addRockCliffLine(12, 168, 188, 168, 3);

  // Massive outer border rocks
  addMassiveBorderRocks(5, 5, 5, 175, 5);
  addMassiveBorderRocks(195, 5, 195, 175, 5);
  addMassiveBorderRocks(5, 5, 195, 5, 5);
  addMassiveBorderRocks(5, 175, 195, 175, 5);

  // Massive outer border crystals (frozen biome)
  addMassiveBorderCrystals(3, 3, 3, 177, 10);
  addMassiveBorderCrystals(197, 3, 197, 177, 10);
  addMassiveBorderCrystals(3, 3, 197, 3, 10);
  addMassiveBorderCrystals(3, 177, 197, 177, 10);

  // Main base cliff edges
  addRockCliffLine(10, 68, 20, 68, 2);
  addRockCliffLine(10, 112, 20, 112, 2);
  addRockCliffLine(180, 68, 190, 68, 2);
  addRockCliffLine(180, 112, 190, 112, 2);

  // Natural chokepoints
  addRockCliffLine(45, 40, 65, 40, 2);
  addRockCliffLine(45, 70, 65, 70, 2);
  addRockCliffLine(135, 110, 155, 110, 2);
  addRockCliffLine(135, 140, 155, 140, 2);

  // Center area cliffs
  addRockCliffLine(85, 75, 115, 75, 2);
  addRockCliffLine(85, 105, 115, 105, 2);

  // Map border decorations
  for (let x = 15; x < MAP_WIDTH - 15; x += 8) {
    addCrystalCluster(x, 12, 4, 5);
    addDeadTrees(x, 168, 4, 5);
  }
  for (let y = 15; y < MAP_HEIGHT - 15; y += 8) {
    addCrystalCluster(12, y, 4, 5);
    addDeadTrees(188, y, 4, 5);
  }

  // Cliff edge decorations around main bases
  addCrystalCluster(15, 70, 12, 8);
  addCrystalCluster(15, 110, 12, 8);
  addCrystalCluster(185, 70, 12, 8);
  addCrystalCluster(185, 110, 12, 8);

  // Natural expansion surroundings
  addDeadTrees(70, 45, 14, 10);
  addDeadTrees(130, 135, 14, 10);
  addRockCluster(65, 60, 10, 7);
  addRockCluster(135, 120, 10, 7);

  // Center area
  addCrystalCluster(100, 75, 15, 12);
  addCrystalCluster(100, 105, 15, 12);
  addRockCluster(85, 90, 12, 8);
  addRockCluster(115, 90, 12, 8);

  // Chokepoint decorations
  addRockCluster(75, 90, 10, 6);
  addRockCluster(125, 90, 10, 6);

  // Third/fourth expansion surroundings
  addDeadTrees(20, 25, 10, 7);
  addDeadTrees(180, 155, 10, 7);
  addDeadTrees(20, 155, 10, 7);
  addDeadTrees(180, 25, 10, 7);
  addRockCluster(25, 30, 6, 5);
  addRockCluster(175, 150, 6, 5);
  addRockCluster(25, 150, 6, 5);
  addRockCluster(175, 30, 6, 5);

  // Debris
  decorations.push({ type: 'debris', x: 90, y: 85, scale: 0.8 });
  decorations.push({ type: 'debris', x: 110, y: 95, scale: 0.8 });
  decorations.push({ type: 'ruined_wall', x: 100, y: 90, scale: 1.0 });

  return decorations;
}

// ============================================
// MAP GENERATION
// ============================================

function generateCrystalCaverns(): MapData {
  // Generate base terrain from connectivity-first definition
  const { terrain, ramps, connections } = generateTerrainWithConnections(CRYSTAL_CAVERNS_DEF);

  // Get ramp clearance zones to prevent decorations on ramps
  const rampClearance = getRampClearanceZones(connections);

  // ========================================
  // MAP BORDERS - Thick unwalkable cliffs
  // ========================================
  fillTerrainRect(terrain, 0, 0, 10, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 10, 0, 10, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 10, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 10, MAP_WIDTH, 10, 'unwalkable');

  // ========================================
  // CENTRAL TERRAIN FEATURES - Chokepoints
  // ========================================
  fillTerrainRect(terrain, 92, 75, 16, 10, 'unwalkable');
  fillTerrainRect(terrain, 92, 95, 16, 10, 'unwalkable');
  fillTerrainCircle(terrain, 70, 130, 12, 'unwalkable');
  fillTerrainCircle(terrain, 130, 50, 12, 'unwalkable');
  fillTerrainCircle(terrain, 60, 90, 8, 'unwalkable');
  fillTerrainCircle(terrain, 140, 90, 8, 'unwalkable');

  // ========================================
  // TERRAIN FEATURES - Frozen theme
  // ========================================

  // VOID CHASMS at map corners
  createVoidChasm(terrain, 0, 0, 18, 18, 2);
  createVoidChasm(terrain, MAP_WIDTH - 18, 0, 18, 18, 2);
  createVoidChasm(terrain, 0, MAP_HEIGHT - 18, 18, 18, 2);
  createVoidChasm(terrain, MAP_WIDTH - 18, MAP_HEIGHT - 18, 18, 18, 2);

  // FROZEN LAKES
  createLake(terrain, 100, 50, 10, 2);
  createLake(terrain, 100, 130, 10, 2);

  // FOREST CORRIDORS
  createForestCorridor(terrain, 55, 68, 35, 35, 16, 5, true);
  createForestCorridor(terrain, 145, 112, 165, 145, 16, 5, true);
  createForestCorridor(terrain, 15, 55, 15, 125, 12, 4, true);
  createForestCorridor(terrain, 185, 55, 185, 125, 12, 4, true);

  // ROADS
  createRoad(terrain, 30, 90, 55, 90, 4);
  createRoad(terrain, 170, 90, 145, 90, 4);
  createRoad(terrain, 55, 90, 145, 90, 3);

  // SCATTERED FORESTS
  scatterForests(terrain, MAP_WIDTH, MAP_HEIGHT, 70, 4, 10, BASE_EXCLUSION_ZONES, 456, 0.35);

  // DENSE FOREST positions
  fillFeatureCircle(terrain, 20, 45, 6, 'forest_dense');
  fillFeatureCircle(terrain, 180, 135, 6, 'forest_dense');
  fillFeatureRect(terrain, 75, 15, 8, 30, 'forest_dense');
  fillFeatureRect(terrain, 75, 135, 8, 35, 'forest_dense');
  fillFeatureRect(terrain, 115, 15, 8, 30, 'forest_dense');
  fillFeatureRect(terrain, 115, 135, 8, 35, 'forest_dense');
  fillFeatureCircle(terrain, 45, 35, 8, 'forest_dense');
  fillFeatureCircle(terrain, 155, 145, 8, 'forest_dense');
  fillFeatureCircle(terrain, 45, 130, 7, 'forest_dense');
  fillFeatureCircle(terrain, 155, 50, 7, 'forest_dense');
  fillFeatureCircle(terrain, 85, 45, 6, 'forest_dense');
  fillFeatureCircle(terrain, 115, 135, 6, 'forest_dense');
  fillFeatureCircle(terrain, 65, 75, 6, 'forest_dense');
  fillFeatureCircle(terrain, 135, 105, 6, 'forest_dense');

  // MUD/ICE SLICK
  createMudArea(terrain, 100, 90, 10);

  // Light forests
  fillFeatureCircle(terrain, 75, 65, 7, 'forest_light');
  fillFeatureCircle(terrain, 125, 115, 7, 'forest_light');
  fillFeatureCircle(terrain, 50, 100, 6, 'forest_light');
  fillFeatureCircle(terrain, 150, 80, 6, 'forest_light');
  fillFeatureCircle(terrain, 95, 40, 5, 'forest_light');
  fillFeatureCircle(terrain, 105, 140, 5, 'forest_light');
  fillFeatureCircle(terrain, 30, 65, 5, 'forest_light');
  fillFeatureCircle(terrain, 170, 115, 5, 'forest_light');

  // ========================================
  // EXPANSIONS WITH RESOURCES
  // ========================================
  const p1Main = createBaseResources(30, 90, DIR.LEFT);
  const p1Nat = createBaseResources(55, 55, DIR.DOWN_RIGHT, 1500, 2250, false, 10);
  const p1Third = createBaseResources(30, 30, DIR.LEFT);
  const p1Fourth = createBaseResources(30, 150, DIR.LEFT);
  const p2Main = createBaseResources(170, 90, DIR.RIGHT);
  const p2Nat = createBaseResources(145, 125, DIR.UP_LEFT, 1500, 2250, false, 10);
  const p2Third = createBaseResources(170, 150, DIR.RIGHT);
  const p2Fourth = createBaseResources(170, 30, DIR.RIGHT);
  const centerGold = createBaseResources(100, 90, DIR.UP, 1500, 2250, true);

  const expansions = [
    { name: 'P1 Main', x: 30, y: 90, isMain: true, ...p1Main },
    { name: 'P1 Natural', x: 55, y: 55, isNatural: true, ...p1Nat },
    { name: 'P1 Third', x: 30, y: 30, ...p1Third },
    { name: 'P1 Fourth', x: 30, y: 150, ...p1Fourth },
    { name: 'P2 Main', x: 170, y: 90, isMain: true, ...p2Main },
    { name: 'P2 Natural', x: 145, y: 125, isNatural: true, ...p2Nat },
    { name: 'P2 Third', x: 170, y: 150, ...p2Third },
    { name: 'P2 Fourth', x: 170, y: 30, ...p2Fourth },
    { name: 'Center Gold', x: 100, y: 90, ...centerGold },
  ];

  const mapData: MapData = {
    id: 'crystal_caverns',
    name: 'Crystal Caverns',
    author: 'VOIDSTRIKE Team',
    description: 'A competitive 1v1 map with horizontal spawns. Protected main bases with single ramp entry. Control the center gold expansion for economic advantage.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    spawns: [
      { x: 30, y: 90, playerSlot: 1, rotation: 0 },
      { x: 170, y: 90, playerSlot: 2, rotation: Math.PI },
    ],

    expansions,

    watchTowers: [
      { x: 100, y: 40, radius: 20 },
      { x: 100, y: 140, radius: 20 },
      { x: 70, y: 90, radius: 16 },
      { x: 130, y: 90, radius: 16 },
    ],

    ramps,

    destructibles: [
      { x: 15, y: 48, health: 2000 },
      { x: 185, y: 132, health: 2000 },
      { x: 85, y: 90, health: 1500 },
      { x: 115, y: 90, health: 1500 },
    ],

    decorations: generateFrozenDecorations(rampClearance),

    playerCount: 2,
    maxPlayers: 2,
    isRanked: true,

    biome: 'frozen',
    skyboxColor: '#0e1428',
    ambientColor: '#2a3050',
    sunColor: '#80b0ff',
    fogColor: '#1a2040',
    fogNear: 80,
    fogFar: 220,
  };

  // Validate and fix connectivity
  const validation = validateMapConnectivity(mapData);
  if (!validation.isValid) {
    console.warn('[CrystalCaverns] Map has connectivity issues, attempting auto-fix...');
    console.warn('[CrystalCaverns] Unreachable locations:', validation.unreachableLocations);
    const corridorsCarved = autoFixConnectivity(mapData);
    console.log(`[CrystalCaverns] Auto-fix carved ${corridorsCarved} corridors`);

    const postFixValidation = validateMapConnectivity(mapData);
    if (!postFixValidation.isValid) {
      console.error('[CrystalCaverns] CRITICAL: Map still has unreachable areas after auto-fix!');
      console.error('[CrystalCaverns] Still unreachable:', postFixValidation.unreachableLocations);
    } else {
      console.log('[CrystalCaverns] Connectivity fixed successfully');
    }
  } else {
    console.log('[CrystalCaverns] Map connectivity validated - all areas reachable');
  }

  return mapData;
}

export const CRYSTAL_CAVERNS = generateCrystalCaverns();

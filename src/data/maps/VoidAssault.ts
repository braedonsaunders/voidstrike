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
 *
 * Layout (220x220):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ ████████████████████         [Fourth]     ████████████████│
 *   │ ███                 ███         │        █ P2 MAIN ███████│
 *   │ ██  [Third]          ██      [Gold]      █  [CC]   ███████│
 *   │ ██                   ██         │        █████↓████████████│
 *   │ ███                 ███     [TOWER]      [P2 NAT]         │
 *   │ █████████████████████           │             ↓           │
 *   │           [Gold]          ██████████        [Third]       │
 *   │              │           ██████████                       │
 *   │         [P1 NAT]        ██████████                       │
 *   │ ████████████↑█████      ██████████       ███████████████ │
 *   │ ███████  [CC]   █           │           ██  [Fourth]  ██ │
 *   │ ███████ P1 MAIN █       [Fourth]        █████████████████ │
 *   │ █████████████████                                         │
 *   └────────────────────────────────────────────────────────────┘
 *
 * USES CONNECTIVITY-FIRST SYSTEM - Ramp connectivity guaranteed by design
 */

const MAP_WIDTH = 220;
const MAP_HEIGHT = 220;

// Seeded random for consistent decorations
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// Base exclusion zones - no decorations here
const BASE_EXCLUSION_ZONES = [
  { x: 35, y: 185, radius: 24 },   // P1 main
  { x: 185, y: 35, radius: 24 },   // P2 main
  { x: 60, y: 145, radius: 18 },   // P1 natural
  { x: 160, y: 75, radius: 18 },   // P2 natural
  { x: 35, y: 35, radius: 16 },    // P1 third
  { x: 185, y: 185, radius: 16 },  // P2 third
  { x: 110, y: 110, radius: 20 },  // Center
  { x: 35, y: 110, radius: 14 },   // P1 fourth
  { x: 185, y: 110, radius: 14 },  // P2 fourth
  { x: 80, y: 60, radius: 14 },    // Gold 1
  { x: 140, y: 160, radius: 14 },  // Gold 2
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

function generateVoidDecorations(rampClearance: Set<string>): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(456);

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

  const addAlienTrees = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearanceZone(x, y, rampClearance)) continue;
      decorations.push({
        type: 'tree_alien',
        x, y,
        scale: 0.8 + rand() * 0.5,
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
        scale: 0.5 + rand() * 0.7,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Helper to create continuous rock cliff wall
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

  // Helper for massive outer border rocks (2-4x scale) to hide terrain edges
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

  // Helper for massive outer border crystals (2-3x scale) for void biome
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

  // Helper to add rocks around a circular base edge
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

  // Helper to add trees around a circular base edge
  const addBaseEdgeTrees = (cx: number, cy: number, radius: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.4;
      const dist = radius + 4 + rand() * 6;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearanceZone(x, y, rampClearance)) continue;
      decorations.push({
        type: 'tree_alien',
        x, y,
        scale: 0.7 + rand() * 0.5,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // ========================================
  // MAIN BASE EDGE DECORATIONS - Heavy rocks and trees
  // ========================================

  // P1 Main (35, 185) - radius 25, cliff width 4
  addBaseEdgeRocks(35, 185, 29, 24);  // Dense rock ring
  addBaseEdgeTrees(35, 185, 32, 16);  // Tree ring further out

  // P2 Main (185, 35) - radius 25, cliff width 4
  addBaseEdgeRocks(185, 35, 29, 24);
  addBaseEdgeTrees(185, 35, 32, 16);

  // ========================================
  // NATURAL EXPANSION EDGE DECORATIONS
  // ========================================

  // P1 Natural (60, 145)
  addBaseEdgeRocks(60, 145, 19, 16);
  addBaseEdgeTrees(60, 145, 22, 12);

  // P2 Natural (160, 75)
  addBaseEdgeRocks(160, 75, 19, 16);
  addBaseEdgeTrees(160, 75, 22, 12);

  // ========================================
  // CONTINUOUS ROCK CLIFF WALLS
  // ========================================

  // Map border cliffs - continuous rock walls
  addRockCliffLine(15, 15, 15, 205, 3);    // West border
  addRockCliffLine(205, 15, 205, 205, 3);  // East border
  addRockCliffLine(15, 15, 205, 15, 3);    // North border
  addRockCliffLine(15, 205, 205, 205, 3);  // South border

  // Massive outer border rocks (2-4x scale) to hide terrain edges
  addMassiveBorderRocks(5, 5, 5, 215, 5);      // Left edge (outer)
  addMassiveBorderRocks(215, 5, 215, 215, 5);  // Right edge (outer)
  addMassiveBorderRocks(5, 5, 215, 5, 5);      // Top edge (outer)
  addMassiveBorderRocks(5, 215, 215, 215, 5);  // Bottom edge (outer)

  // Massive outer border crystals (void biome)
  addMassiveBorderCrystals(3, 3, 3, 217, 9);     // Left edge crystals
  addMassiveBorderCrystals(217, 3, 217, 217, 9); // Right edge crystals
  addMassiveBorderCrystals(3, 3, 217, 3, 9);     // Top edge crystals
  addMassiveBorderCrystals(3, 217, 217, 217, 9); // Bottom edge crystals

  // Natural chokepoint walls - dense rock formations
  addRockCliffLine(40, 120, 52, 138, 2);   // P1 natural west wall
  addRockCliffLine(72, 120, 87, 138, 2);   // P1 natural east wall
  addRockCliffLine(133, 82, 148, 100, 2);  // P2 natural west wall
  addRockCliffLine(168, 82, 180, 100, 2);  // P2 natural east wall

  // Third expansion protection walls
  addRockCliffLine(12, 20, 27, 50, 2);     // P1 third west
  addRockCliffLine(20, 12, 50, 27, 2);     // P1 third north
  addRockCliffLine(193, 170, 208, 200, 2); // P2 third east
  addRockCliffLine(170, 193, 200, 208, 2); // P2 third south

  // Central obstacle cliff faces
  addRockCliffLine(100, 100, 100, 120, 2);
  addRockCliffLine(120, 100, 120, 120, 2);
  addRockCliffLine(100, 100, 120, 100, 2);
  addRockCliffLine(100, 120, 120, 120, 2);

  // Diagonal cliff barriers - rock edges
  addRockCliffLine(56, 56, 84, 84, 2);     // NW diagonal
  addRockCliffLine(136, 136, 164, 164, 2); // SE diagonal

  // ========================================
  // MAP BORDER DECORATIONS (original + enhanced)
  // ========================================
  for (let x = 15; x < MAP_WIDTH - 15; x += 10) {
    addCrystalCluster(x, 12, 4, 5);
    addCrystalCluster(x, MAP_HEIGHT - 12, 4, 5);
  }
  for (let y = 15; y < MAP_HEIGHT - 15; y += 10) {
    addAlienTrees(12, y, 4, 5);
    addAlienTrees(MAP_WIDTH - 12, y, 4, 5);
  }

  // Central area - heavy crystals
  addCrystalCluster(110, 90, 15, 12);
  addCrystalCluster(110, 130, 15, 12);
  addRockCluster(95, 110, 12, 8);
  addRockCluster(125, 110, 12, 8);

  // Main base cliff edges - additional crystals
  addCrystalCluster(20, 165, 12, 8);
  addCrystalCluster(20, 205, 12, 8);
  addCrystalCluster(50, 175, 8, 6);
  addCrystalCluster(200, 15, 12, 8);
  addCrystalCluster(200, 55, 12, 8);
  addCrystalCluster(170, 45, 8, 6);

  // Natural surroundings - more trees and rocks
  addAlienTrees(45, 130, 12, 8);
  addAlienTrees(175, 90, 12, 8);
  addRockCluster(70, 155, 10, 6);
  addRockCluster(150, 65, 10, 6);

  // Third expansion surroundings
  addAlienTrees(25, 50, 12, 8);
  addAlienTrees(195, 170, 12, 8);
  addRockCluster(45, 45, 10, 5);
  addRockCluster(175, 175, 10, 5);

  // Gold expansion surroundings
  addCrystalCluster(90, 50, 10, 7);
  addCrystalCluster(130, 170, 10, 7);
  addRockCluster(70, 60, 8, 5);
  addRockCluster(150, 160, 8, 5);

  // Debris and special objects
  decorations.push({ type: 'debris', x: 100, y: 100, scale: 1.0 });
  decorations.push({ type: 'debris', x: 120, y: 120, scale: 1.0 });
  decorations.push({ type: 'ruined_wall', x: 105, y: 115, scale: 1.2 });
  decorations.push({ type: 'ruined_wall', x: 115, y: 105, scale: 1.2 });

  // Escape pods
  decorations.push({ type: 'escape_pod', x: 15, y: 205, scale: 1.0 });
  decorations.push({ type: 'escape_pod', x: 205, y: 15, scale: 1.0 });

  return decorations;
}

// ========================================
// MAP DEFINITION - Connectivity-first terrain generation
// ========================================
const VOID_ASSAULT_DEF: MapDefinition = defineMap({
  meta: {
    id: 'void_assault',
    name: 'Void Assault',
    author: 'VOIDSTRIKE Team',
    description: 'A competitive 1v1 map with diagonal spawns. Protected main bases lead to natural expansions through narrow ramps. Control the center and gold bases for map dominance.',
  },

  canvas: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    biome: 'void',
    baseElevation: 0,
  },

  symmetry: {
    type: 'rotational',
    playerCount: 2,
  },

  regions: [
    // Main bases - elevated platforms with cliff rings
    { id: 'p1_main', name: 'P1 Main', type: 'main_base', position: { x: 35, y: 185 }, elevation: 2, radius: 22, playerSlot: 1 },
    { id: 'p2_main', name: 'P2 Main', type: 'main_base', position: { x: 185, y: 35 }, elevation: 2, radius: 22, playerSlot: 2 },

    // Natural expansions - mid-elevation platforms
    { id: 'p1_nat', name: 'P1 Natural', type: 'natural', position: { x: 60, y: 145 }, elevation: 1, radius: 14 },
    { id: 'p2_nat', name: 'P2 Natural', type: 'natural', position: { x: 160, y: 75 }, elevation: 1, radius: 14 },

    // Third expansions - ground level, no cliffs
    { id: 'p1_third', name: 'P1 Third', type: 'third', position: { x: 35, y: 35 }, elevation: 0, radius: 18 },
    { id: 'p2_third', name: 'P2 Third', type: 'third', position: { x: 185, y: 185 }, elevation: 0, radius: 18 },

    // Fourth expansions - ground level, no cliffs
    { id: 'p1_fourth', name: 'P1 Fourth', type: 'fourth', position: { x: 35, y: 110 }, elevation: 0, radius: 16 },
    { id: 'p2_fourth', name: 'P2 Fourth', type: 'fourth', position: { x: 185, y: 110 }, elevation: 0, radius: 16 },

    // Gold expansions
    { id: 'gold_north', name: 'Gold North', type: 'gold', position: { x: 80, y: 60 }, elevation: 0, radius: 14 },
    { id: 'gold_south', name: 'Gold South', type: 'gold', position: { x: 140, y: 160 }, elevation: 0, radius: 14 },

    // Center contested area
    { id: 'center', name: 'Center', type: 'center', position: { x: 110, y: 110 }, elevation: 0, radius: 22 },
  ],

  connections: [
    // Main to natural connections (elevation 2 -> 1)
    { from: 'p1_main', to: 'p1_nat', type: 'ramp', width: 10 },
    { from: 'p2_main', to: 'p2_nat', type: 'ramp', width: 10 },

    // Natural to low ground connections (elevation 1 -> 0)
    { from: 'p1_nat', to: 'center', type: 'ramp', width: 8 },
    { from: 'p2_nat', to: 'center', type: 'ramp', width: 8 },

    // Third expansions to nearby areas (ground level)
    { from: 'p1_third', to: 'gold_north', type: 'ground', width: 10 },
    { from: 'p2_third', to: 'gold_south', type: 'ground', width: 10 },

    // Fourth expansions to center (ground level)
    { from: 'p1_fourth', to: 'center', type: 'ground', width: 10 },
    { from: 'p2_fourth', to: 'center', type: 'ground', width: 10 },

    // Gold expansions to center
    { from: 'gold_north', to: 'center', type: 'ground', width: 8 },
    { from: 'gold_south', to: 'center', type: 'ground', width: 8 },
  ],

  terrain: {},

  features: {},

  decorations: {},
});

function generateVoidAssault(): MapData {
  // Generate base terrain from definition
  const { terrain, ramps, connections } = generateTerrainWithConnections(VOID_ASSAULT_DEF);

  // Get ramp clearance zones to prevent decorations on ramps
  const rampClearance = getRampClearanceZones(connections);

  // ========================================
  // MAP BORDERS - Thick unwalkable cliffs
  // ========================================
  fillTerrainRect(terrain, 0, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 12, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 12, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 12, MAP_WIDTH, 12, 'unwalkable');

  // ========================================
  // NATURAL CHOKEPOINT WALLS
  // ========================================
  // Natural chokepoint walls
  fillTerrainRect(terrain, 40, 120, 12, 18, 'unwalkable');
  fillTerrainRect(terrain, 72, 120, 15, 18, 'unwalkable');

  // P2 Natural chokepoint walls
  fillTerrainRect(terrain, 133, 82, 15, 18, 'unwalkable');
  fillTerrainRect(terrain, 168, 82, 12, 18, 'unwalkable');

  // ========================================
  // THIRD EXPANSION PROTECTION
  // ========================================

  // P1 Third (top-left corner) - Partial protection
  fillTerrainRect(terrain, 12, 20, 15, 30, 'unwalkable');
  fillTerrainRect(terrain, 20, 12, 30, 15, 'unwalkable');

  // P2 Third (bottom-right corner) - Partial protection
  fillTerrainRect(terrain, 193, 170, 15, 30, 'unwalkable');
  fillTerrainRect(terrain, 170, 193, 30, 15, 'unwalkable');

  // ========================================
  // TERRAIN FEATURES - Chokepoints and paths
  // ========================================

  // Central obstacle (forces army splits)
  fillTerrainRect(terrain, 100, 100, 20, 20, 'unwalkable');

  // Diagonal cliff barriers
  fillTerrainCircle(terrain, 70, 70, 14, 'unwalkable');
  fillTerrainCircle(terrain, 150, 150, 14, 'unwalkable');

  // Side path cliffs
  fillTerrainCircle(terrain, 30, 75, 10, 'unwalkable');
  fillTerrainCircle(terrain, 190, 145, 10, 'unwalkable');

  // Additional chokepoint creators
  fillTerrainCircle(terrain, 85, 140, 10, 'unwalkable');
  fillTerrainCircle(terrain, 135, 80, 10, 'unwalkable');

  // ========================================
  // NEW TERRAIN FEATURES - Void/Alien theme
  // ========================================

  // VOID CHASMS - Massive void areas at edges (alien dimension tears)
  createVoidChasm(terrain, 0, 0, 22, 22, 3);          // Top-left
  createVoidChasm(terrain, MAP_WIDTH - 22, MAP_HEIGHT - 22, 22, 22, 3);  // Bottom-right
  // Side void areas (reduced to not block fourth expansions)
  createVoidChasm(terrain, 0, 130, 14, 30, 2);       // West void (moved south, smaller)
  createVoidChasm(terrain, MAP_WIDTH - 14, 60, 14, 30, 2);  // East void (moved north, smaller)

  // VOID LAKES - Alien energy pools (positioned to not block fourth expansions)
  createLake(terrain, 55, 130, 10, 2);   // P1 side (moved south to not block fourth)
  createLake(terrain, 165, 90, 10, 2);   // P2 side (moved north to not block fourth)
  createLake(terrain, 110, 55, 8, 2);    // North
  createLake(terrain, 110, 165, 8, 2);   // South

  // FOREST CORRIDORS (alien vegetation) - Strategic paths
  // Main attack routes
  createForestCorridor(terrain, 35, 160, 85, 110, 16, 5, true);   // P1 to center
  createForestCorridor(terrain, 185, 60, 135, 110, 16, 5, true);  // P2 to center

  // Flanking corridors
  createForestCorridor(terrain, 35, 50, 75, 90, 14, 4, true);     // P1 third route
  createForestCorridor(terrain, 185, 170, 145, 130, 14, 4, true); // P2 third route

  // FOURTH EXPANSION ACCESS PATHS - ensure connectivity
  createForestCorridor(terrain, 35, 110, 70, 110, 12, 5, true);   // P1 fourth to center area
  createForestCorridor(terrain, 185, 110, 150, 110, 12, 5, true); // P2 fourth to center area

  // Side forests for cover
  createForestCorridor(terrain, 18, 100, 18, 150, 12, 4, true);
  createForestCorridor(terrain, 202, 70, 202, 120, 12, 4, true);

  // ROADS - Fast movement paths (void-touched roads)
  // Main routes from bases
  createRoad(terrain, 35, 185, 60, 145, 4);  // P1 main to nat
  createRoad(terrain, 185, 35, 160, 75, 4);  // P2 main to nat
  // Cross-map diagonal
  createRoad(terrain, 75, 135, 145, 85, 3);

  // SCATTERED FORESTS - Alien flora/void growths (3x more)
  scatterForests(terrain, MAP_WIDTH, MAP_HEIGHT, 80, 4, 10, BASE_EXCLUSION_ZONES, 789, 0.35);

  // DENSE FOREST ambush points - original
  fillFeatureCircle(terrain, 45, 75, 7, 'forest_dense');   // P1 flank
  fillFeatureCircle(terrain, 175, 145, 7, 'forest_dense'); // P2 flank
  fillFeatureCircle(terrain, 95, 55, 6, 'forest_dense');   // Gold approach
  fillFeatureCircle(terrain, 125, 165, 6, 'forest_dense'); // Gold approach

  // VOID FOREST WALLS - Alien flora creating tactical chokepoints
  // Diagonal void forest barriers (matches diagonal spawn layout)
  fillFeatureRect(terrain, 60, 25, 8, 30, 'forest_dense');    // Top P1 side wall
  fillFeatureRect(terrain, 155, 165, 8, 30, 'forest_dense');  // Bottom P2 side wall
  fillFeatureRect(terrain, 25, 60, 30, 8, 'forest_dense');    // Left P1 side wall
  fillFeatureRect(terrain, 165, 155, 30, 8, 'forest_dense');  // Right P2 side wall

  // Cross-map forest corridors with gaps for paths
  fillFeatureRect(terrain, 85, 15, 10, 25, 'forest_dense');   // Top corridor section
  fillFeatureRect(terrain, 130, 180, 10, 25, 'forest_dense'); // Bottom corridor section
  fillFeatureRect(terrain, 15, 85, 25, 10, 'forest_dense');   // Left corridor section
  fillFeatureRect(terrain, 180, 130, 25, 10, 'forest_dense'); // Right corridor section

  // Alien growth clusters at strategic points
  fillFeatureCircle(terrain, 65, 100, 8, 'forest_dense');     // P1 expansion approach
  fillFeatureCircle(terrain, 155, 120, 8, 'forest_dense');    // P2 expansion approach
  fillFeatureCircle(terrain, 100, 65, 7, 'forest_dense');     // Gold 1 defense
  fillFeatureCircle(terrain, 120, 155, 7, 'forest_dense');    // Gold 2 defense
  fillFeatureCircle(terrain, 50, 50, 7, 'forest_dense');      // P1 third region
  fillFeatureCircle(terrain, 170, 170, 7, 'forest_dense');    // P2 third region

  // Mid-map void forest clusters for army positioning
  fillFeatureCircle(terrain, 90, 90, 6, 'forest_dense');      // Center NW
  fillFeatureCircle(terrain, 130, 130, 6, 'forest_dense');    // Center SE
  fillFeatureCircle(terrain, 80, 130, 5, 'forest_dense');     // P1 side center
  fillFeatureCircle(terrain, 140, 90, 5, 'forest_dense');     // P2 side center

  // MUD areas (void-corrupted ground)
  createMudArea(terrain, 110, 110, 12);  // Center
  createMudArea(terrain, 70, 70, 6);     // P1 side
  createMudArea(terrain, 150, 150, 6);   // P2 side

  // Light forests for cover - expanded
  fillFeatureCircle(terrain, 55, 125, 6, 'forest_light');
  fillFeatureCircle(terrain, 165, 95, 6, 'forest_light');
  fillFeatureCircle(terrain, 110, 80, 5, 'forest_light');
  fillFeatureCircle(terrain, 110, 140, 5, 'forest_light');
  // Additional void flora patches
  fillFeatureCircle(terrain, 35, 65, 5, 'forest_light');      // P1 main area
  fillFeatureCircle(terrain, 185, 155, 5, 'forest_light');    // P2 main area
  fillFeatureCircle(terrain, 75, 45, 5, 'forest_light');      // P1 third approach
  fillFeatureCircle(terrain, 145, 175, 5, 'forest_light');    // P2 third approach
  fillFeatureCircle(terrain, 20, 130, 4, 'forest_light');     // West edge
  fillFeatureCircle(terrain, 200, 90, 4, 'forest_light');     // East edge
  fillFeatureCircle(terrain, 130, 20, 4, 'forest_light');     // North edge
  fillFeatureCircle(terrain, 90, 200, 4, 'forest_light');     // South edge
  fillFeatureCircle(terrain, 60, 165, 4, 'forest_light');     // P1 natural area
  fillFeatureCircle(terrain, 160, 55, 4, 'forest_light');     // P2 natural area

  // ========================================
  // EXPANSIONS WITH RESOURCES
  // Standard: 6x 1500 + 2x 900 minerals per base, 2250 gas per geyser
  // Gold: all 8 patches at 900 minerals
  // ========================================
  const p1Main = createBaseResources(35, 185, DIR.DOWN_LEFT);     // Standard: 6x1500 + 2x900
  const p1Nat = createBaseResources(60, 145, DIR.DOWN_LEFT, 1500, 2250, false, 10);  // Natural: minerals further from ramp
  const p1Third = createBaseResources(35, 35, DIR.UP_LEFT);       // Standard
  const p1Fourth = createBaseResources(35, 110, DIR.LEFT);        // Standard
  const p2Main = createBaseResources(185, 35, DIR.UP_RIGHT);      // Standard
  const p2Nat = createBaseResources(160, 75, DIR.UP_RIGHT, 1500, 2250, false, 10);  // Natural: minerals further from ramp
  const p2Third = createBaseResources(185, 185, DIR.DOWN_RIGHT);  // Standard
  const p2Fourth = createBaseResources(185, 110, DIR.RIGHT);      // Standard
  const goldNorth = createBaseResources(80, 60, DIR.UP, 1500, 2250, true);   // Gold: all 8x900
  const goldSouth = createBaseResources(140, 160, DIR.DOWN, 1500, 2250, true); // Gold: all 8x900

  const expansions = [
    { name: 'P1 Main', x: 35, y: 185, isMain: true, ...p1Main },
    { name: 'P1 Natural', x: 60, y: 145, isNatural: true, ...p1Nat },
    { name: 'P1 Third', x: 35, y: 35, ...p1Third },
    { name: 'P1 Fourth', x: 35, y: 110, ...p1Fourth },
    { name: 'P2 Main', x: 185, y: 35, isMain: true, ...p2Main },
    { name: 'P2 Natural', x: 160, y: 75, isNatural: true, ...p2Nat },
    { name: 'P2 Third', x: 185, y: 185, ...p2Third },
    { name: 'P2 Fourth', x: 185, y: 110, ...p2Fourth },
    { name: 'Gold North', x: 80, y: 60, ...goldNorth },
    { name: 'Gold South', x: 140, y: 160, ...goldSouth },
  ];

  const mapData: MapData = {
    id: 'void_assault',
    name: 'Void Assault',
    author: 'VOIDSTRIKE Team',
    description: 'A competitive 1v1 map with diagonal spawns. Protected main bases lead to natural expansions through narrow ramps. Control the center and gold bases for map dominance.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    // ONLY main base spawn points - critical fix!
    spawns: [
      { x: 35, y: 185, playerSlot: 1, rotation: Math.PI / 4 },          // P1 Main
      { x: 185, y: 35, playerSlot: 2, rotation: -Math.PI * 3 / 4 },     // P2 Main
    ],

    expansions,

    watchTowers: [
      { x: 110, y: 110, radius: 24 },  // Center - primary control
      { x: 70, y: 100, radius: 18 },   // P1 side
      { x: 150, y: 120, radius: 18 },  // P2 side
      { x: 110, y: 55, radius: 16 },   // Top mid
      { x: 110, y: 165, radius: 16 },  // Bottom mid
    ],

    ramps,

    destructibles: [
      // Backdoor rocks to third
      { x: 48, y: 50, health: 2000 },
      { x: 172, y: 170, health: 2000 },
      // Gold expansion access
      { x: 70, y: 70, health: 1500 },
      { x: 150, y: 150, health: 1500 },
      // Side path rocks
      { x: 55, y: 100, health: 1500 },
      { x: 165, y: 120, health: 1500 },
    ],

    decorations: generateVoidDecorations(rampClearance),

    playerCount: 2,
    maxPlayers: 2,
    isRanked: true,

    biome: 'void',
    skyboxColor: '#0a0a1e',
    ambientColor: '#303050',
    sunColor: '#ffe0b0',
    fogColor: '#1a1a2e',
    fogNear: 90,
    fogFar: 250,
  };

  // CRITICAL: Validate and fix connectivity to ensure all areas are reachable
  const validation = validateMapConnectivity(mapData);
  if (!validation.isValid) {
    console.warn('[VoidAssault] Map has connectivity issues, attempting auto-fix...');
    console.warn('[VoidAssault] Unreachable locations:', validation.unreachableLocations);
    const corridorsCarved = autoFixConnectivity(mapData);
    console.log(`[VoidAssault] Auto-fix carved ${corridorsCarved} corridors`);

    const postFixValidation = validateMapConnectivity(mapData);
    if (!postFixValidation.isValid) {
      console.error('[VoidAssault] CRITICAL: Map still has unreachable areas after auto-fix!');
      console.error('[VoidAssault] Still unreachable:', postFixValidation.unreachableLocations);
    } else {
      console.log('[VoidAssault] Connectivity fixed successfully');
    }
  } else {
    console.log('[VoidAssault] Map connectivity validated - all areas reachable');
  }

  return mapData;
}

export const VOID_ASSAULT = generateVoidAssault();

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
  // New topology system
  generateTerrainFromTopology,
  mainBase,
  naturalExpansion,
  expansion,
  connect,
  getRampClearanceZones,
  type MapTopology,
} from './MapTypes';

/**
 * SCORCHED BASIN - 4 Player (2v2 / FFA) Map
 *
 * A balanced 4-player map with desert/volcanic biome.
 * Designed for 2v2 team games or Free-For-All.
 *
 * Key Features:
 * - Symmetrical 4-corner spawn positions
 * - Protected main bases with single ramp
 * - Natural expansions near each main
 * - Shared third expansions between adjacent players
 * - Central contested area with watch tower
 *
 * Layout (280x280):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ ██P1 MAIN██         [Third]         ██P2 MAIN██            │
 *   │ ████↘████           (shared)          ████↙████            │
 *   │  [NAT]↘        [Gold]      [Gold]        ↙[NAT]            │
 *   │       ↘                                 ↙                   │
 *   │ [Third]        ████████████████████        [Third]         │
 *   │ (shared)       ██    CENTER    ██          (shared)        │
 *   │                ██   [TOWER]    ██                          │
 *   │ [Gold]         ████████████████████         [Gold]         │
 *   │       ↗                                 ↖                   │
 *   │  [NAT]↗        [Gold]      [Gold]        ↖[NAT]            │
 *   │ ████↗████           (shared)          ████↖████            │
 *   │ ██P3 MAIN██         [Third]         ██P4 MAIN██            │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * USES NEW TOPOLOGY SYSTEM - Ramp connectivity guaranteed by design
 */

const MAP_WIDTH = 280;
const MAP_HEIGHT = 280;

// Seeded random for consistent decorations
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// Base exclusion zones - no decorations here
const BASE_EXCLUSION_ZONES = [
  { x: 40, y: 40, radius: 24 },    // P1 main
  { x: 240, y: 40, radius: 24 },   // P2 main
  { x: 40, y: 240, radius: 24 },   // P3 main
  { x: 240, y: 240, radius: 24 },  // P4 main
  { x: 75, y: 75, radius: 18 },    // P1 natural
  { x: 205, y: 75, radius: 18 },   // P2 natural
  { x: 75, y: 205, radius: 18 },   // P3 natural
  { x: 205, y: 205, radius: 18 },  // P4 natural
  { x: 40, y: 140, radius: 16 },   // Left third
  { x: 240, y: 140, radius: 16 },  // Right third
  { x: 140, y: 40, radius: 16 },   // Top third
  { x: 140, y: 240, radius: 16 },  // Bottom third
  { x: 140, y: 140, radius: 22 },  // Center
  { x: 90, y: 90, radius: 14 },    // Gold 1
  { x: 190, y: 90, radius: 14 },   // Gold 2
  { x: 90, y: 190, radius: 14 },   // Gold 3
  { x: 190, y: 190, radius: 14 },  // Gold 4
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

function isInRampClearance(x: number, y: number, clearanceZones: Set<string>): boolean {
  return clearanceZones.has(`${Math.floor(x)},${Math.floor(y)}`);
}

function generateDesertDecorations(rampClearance: Set<string>): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(789);

  const addCrystalCluster = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearance(x, y, rampClearance)) continue;
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
      if (isInBaseArea(x, y) || isInRampClearance(x, y, rampClearance)) continue;
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
      if (isInBaseArea(x, y) || isInRampClearance(x, y, rampClearance)) continue;
      decorations.push({
        type: rockTypes[Math.floor(rand() * rockTypes.length)],
        x, y,
        scale: 0.4 + rand() * 0.6,
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
      if (isInBaseArea(x, y) || isInRampClearance(x, y, rampClearance)) continue;
      const rockType = rand() < 0.4 ? 'rocks_large' : (rand() < 0.7 ? 'rocks_small' : 'rock_single');
      decorations.push({
        type: rockType,
        x, y,
        scale: 0.6 + rand() * 0.6,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Helper for massive outer border rocks
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

  // Helper to add rocks around a circular base edge
  const addBaseEdgeRocks = (cx: number, cy: number, radius: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.3;
      const dist = radius + 2 + rand() * 4;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearance(x, y, rampClearance)) continue;
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
      if (isInBaseArea(x, y) || isInRampClearance(x, y, rampClearance)) continue;
      decorations.push({
        type: 'tree_dead',
        x, y,
        scale: 0.6 + rand() * 0.5,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // ========================================
  // MAIN BASE EDGE DECORATIONS
  // ========================================

  // All 4 main bases
  addBaseEdgeRocks(40, 40, 29, 22);
  addBaseEdgeTrees(40, 40, 32, 14);
  addBaseEdgeRocks(240, 40, 29, 22);
  addBaseEdgeTrees(240, 40, 32, 14);
  addBaseEdgeRocks(40, 240, 29, 22);
  addBaseEdgeTrees(40, 240, 32, 14);
  addBaseEdgeRocks(240, 240, 29, 22);
  addBaseEdgeTrees(240, 240, 32, 14);

  // ========================================
  // NATURAL EXPANSION EDGE DECORATIONS
  // ========================================

  addBaseEdgeRocks(75, 75, 19, 14);
  addBaseEdgeTrees(75, 75, 22, 10);
  addBaseEdgeRocks(205, 75, 19, 14);
  addBaseEdgeTrees(205, 75, 22, 10);
  addBaseEdgeRocks(75, 205, 19, 14);
  addBaseEdgeTrees(75, 205, 22, 10);
  addBaseEdgeRocks(205, 205, 19, 14);
  addBaseEdgeTrees(205, 205, 22, 10);

  // ========================================
  // CONTINUOUS ROCK CLIFF WALLS
  // ========================================

  // Map border cliffs
  addRockCliffLine(15, 15, 15, 265, 3);
  addRockCliffLine(265, 15, 265, 265, 3);
  addRockCliffLine(15, 15, 265, 15, 3);
  addRockCliffLine(15, 265, 265, 265, 3);

  // Massive outer border rocks
  addMassiveBorderRocks(5, 5, 5, 275, 6);
  addMassiveBorderRocks(275, 5, 275, 275, 6);
  addMassiveBorderRocks(5, 5, 275, 5, 6);
  addMassiveBorderRocks(5, 275, 275, 275, 6);

  // Corner rock clusters
  addRockCliffLine(12, 55, 27, 70, 2);
  addRockCliffLine(55, 12, 70, 27, 2);
  addRockCliffLine(253, 55, 268, 70, 2);
  addRockCliffLine(210, 12, 225, 27, 2);
  addRockCliffLine(12, 210, 27, 225, 2);
  addRockCliffLine(55, 253, 70, 268, 2);
  addRockCliffLine(253, 210, 268, 225, 2);
  addRockCliffLine(210, 253, 225, 268, 2);

  // ========================================
  // ORIGINAL DECORATIONS (enhanced)
  // ========================================

  // Map border decorations
  for (let i = 15; i < MAP_WIDTH - 15; i += 12) {
    addRockCluster(i, 12, 4, 5);
    addRockCluster(i, MAP_HEIGHT - 12, 4, 5);
    addRockCluster(12, i, 4, 5);
    addRockCluster(MAP_WIDTH - 12, i, 4, 5);
  }

  // Main base cliff edges - additional clusters
  addRockCluster(25, 60, 12, 8);
  addRockCluster(55, 25, 12, 8);
  addRockCluster(225, 25, 12, 8);
  addRockCluster(255, 60, 12, 8);
  addRockCluster(25, 220, 12, 8);
  addRockCluster(55, 255, 12, 8);
  addRockCluster(225, 255, 12, 8);
  addRockCluster(255, 220, 12, 8);

  // Natural expansion surroundings - more trees
  addDeadTrees(60, 90, 12, 8);
  addDeadTrees(220, 90, 12, 8);
  addDeadTrees(60, 190, 12, 8);
  addDeadTrees(220, 190, 12, 8);

  // Central area - heavy rocks and crystals
  addCrystalCluster(140, 120, 18, 12);
  addCrystalCluster(140, 160, 18, 12);
  addRockCluster(120, 140, 15, 10);
  addRockCluster(160, 140, 15, 10);

  // Chokepoint decorations - more rocks
  addRockCluster(100, 140, 12, 8);
  addRockCluster(180, 140, 12, 8);
  addRockCluster(140, 100, 12, 8);
  addRockCluster(140, 180, 12, 8);

  // Gold expansion decorations
  addCrystalCluster(90, 90, 8, 6);
  addCrystalCluster(190, 90, 8, 6);
  addCrystalCluster(90, 190, 8, 6);
  addCrystalCluster(190, 190, 8, 6);
  addRockCluster(100, 100, 6, 5);
  addRockCluster(180, 100, 6, 5);
  addRockCluster(100, 180, 6, 5);
  addRockCluster(180, 180, 6, 5);

  // Third expansion decorations - more trees
  addDeadTrees(35, 125, 10, 7);
  addDeadTrees(35, 155, 10, 7);
  addDeadTrees(245, 125, 10, 7);
  addDeadTrees(245, 155, 10, 7);
  addDeadTrees(125, 35, 10, 7);
  addDeadTrees(155, 35, 10, 7);
  addDeadTrees(125, 245, 10, 7);
  addDeadTrees(155, 245, 10, 7);

  // Scattered vegetation
  for (let i = 0; i < 150; i++) {
    const x = 20 + rand() * (MAP_WIDTH - 40);
    const y = 20 + rand() * (MAP_HEIGHT - 40);
    if (isInBaseArea(x, y)) continue;

    const type = rand() > 0.6 ? 'bush' : 'grass_clump';
    decorations.push({
      type,
      x, y,
      scale: 0.4 + rand() * 0.5,
      rotation: rand() * Math.PI * 2,
    });
  }

  // Debris
  decorations.push({ type: 'debris', x: 130, y: 130, scale: 1.0 });
  decorations.push({ type: 'debris', x: 150, y: 150, scale: 1.0 });
  decorations.push({ type: 'ruined_wall', x: 140, y: 140, scale: 1.2 });

  // Escape pods in corners
  decorations.push({ type: 'escape_pod', x: 15, y: 15, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 265, y: 15, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 15, y: 265, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 265, y: 265, scale: 0.9 });

  return decorations;
}

function generateScorchedBasin(): MapData {
  // ========================================
  // TOPOLOGY DEFINITION - Graph-first terrain generation
  // ========================================
  const topology: MapTopology = {
    areas: [
      // Main bases - elevated platforms with cliff rings (4 corners)
      mainBase('p1_main', 40, 40, 22, 2, 4),
      mainBase('p2_main', 240, 40, 22, 2, 4),
      mainBase('p3_main', 40, 240, 22, 2, 4),
      mainBase('p4_main', 240, 240, 22, 2, 4),

      // Natural expansions - mid-elevation platforms
      naturalExpansion('p1_nat', 75, 75, 14, 1, 3),
      naturalExpansion('p2_nat', 205, 75, 14, 1, 3),
      naturalExpansion('p3_nat', 75, 205, 14, 1, 3),
      naturalExpansion('p4_nat', 205, 205, 14, 1, 3),

      // Third expansions - ground level, shared between adjacent players
      expansion('third_left', 'third', 40, 140, 18, 0),
      expansion('third_right', 'third', 240, 140, 18, 0),
      expansion('third_top', 'third', 140, 40, 18, 0),
      expansion('third_bottom', 'third', 140, 240, 18, 0),

      // Gold expansions - inner quadrants
      expansion('gold_nw', 'gold', 90, 90, 14, 0),
      expansion('gold_ne', 'gold', 190, 90, 14, 0),
      expansion('gold_sw', 'gold', 90, 190, 14, 0),
      expansion('gold_se', 'gold', 190, 190, 14, 0),

      // Center contested area
      expansion('center', 'center', 140, 140, 24, 0),
    ],

    connections: [
      // Main to natural connections (elevation 2 -> 1)
      connect('p1_main', 'p1_nat', 10, 'east'),   // P1 exits southeast
      connect('p2_main', 'p2_nat', 10, 'west'),   // P2 exits southwest
      connect('p3_main', 'p3_nat', 10, 'east'),   // P3 exits northeast
      connect('p4_main', 'p4_nat', 10, 'west'),   // P4 exits northwest

      // Natural to low ground connections (elevation 1 -> 0)
      connect('p1_nat', 'gold_nw', 8, 'east'),
      connect('p2_nat', 'gold_ne', 8, 'west'),
      connect('p3_nat', 'gold_sw', 8, 'east'),
      connect('p4_nat', 'gold_se', 8, 'west'),
    ],
  };

  // Generate base terrain from topology
  const { terrain, ramps, connections } = generateTerrainFromTopology(
    MAP_WIDTH,
    MAP_HEIGHT,
    topology,
    0 // Default elevation (low ground)
  );

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
  // TERRAIN FEATURES - Chokepoints
  // ========================================

  // Central obstacle
  fillTerrainRect(terrain, 130, 130, 20, 20, 'unwalkable');

  // Inner ring cliffs (create 4-way symmetry chokepoints)
  fillTerrainCircle(terrain, 100, 100, 12, 'unwalkable');
  fillTerrainCircle(terrain, 180, 100, 12, 'unwalkable');
  fillTerrainCircle(terrain, 100, 180, 12, 'unwalkable');
  fillTerrainCircle(terrain, 180, 180, 12, 'unwalkable');

  // Side cliffs
  fillTerrainCircle(terrain, 70, 140, 10, 'unwalkable');
  fillTerrainCircle(terrain, 210, 140, 10, 'unwalkable');
  fillTerrainCircle(terrain, 140, 70, 10, 'unwalkable');
  fillTerrainCircle(terrain, 140, 210, 10, 'unwalkable');

  // ========================================
  // NEW TERRAIN FEATURES - Desert/Volcanic theme
  // ========================================

  // LAVA LAKES (void) - Impassable volcanic hazards
  createLake(terrain, 60, 60, 8, 2);     // NW corner
  createLake(terrain, 220, 60, 8, 2);    // NE corner
  createLake(terrain, 60, 220, 8, 2);    // SW corner
  createLake(terrain, 220, 220, 8, 2);   // SE corner

  // VOID CHASMS at edges
  createVoidChasm(terrain, 0, 0, 18, 18, 2);
  createVoidChasm(terrain, MAP_WIDTH - 18, 0, 18, 18, 2);
  createVoidChasm(terrain, 0, MAP_HEIGHT - 18, 18, 18, 2);
  createVoidChasm(terrain, MAP_WIDTH - 18, MAP_HEIGHT - 18, 18, 18, 2);

  // FOREST CORRIDORS - Strategic paths
  createForestCorridor(terrain, 40, 75, 75, 105, 14, 4, true);    // P1 nat route
  createForestCorridor(terrain, 240, 75, 205, 105, 14, 4, true);  // P2 nat route
  createForestCorridor(terrain, 40, 205, 75, 175, 14, 4, true);   // P3 nat route
  createForestCorridor(terrain, 240, 205, 205, 175, 14, 4, true); // P4 nat route

  // Cross-map corridors
  createForestCorridor(terrain, 100, 140, 180, 140, 12, 3, true);
  createForestCorridor(terrain, 140, 100, 140, 180, 12, 3, true);

  // ROADS - Fast movement paths
  createRoad(terrain, 40, 40, 75, 75, 4);    // P1 main to nat
  createRoad(terrain, 240, 40, 205, 75, 4);  // P2 main to nat
  createRoad(terrain, 40, 240, 75, 205, 4);  // P3 main to nat
  createRoad(terrain, 240, 240, 205, 205, 4); // P4 main to nat

  // SCATTERED FORESTS
  scatterForests(terrain, MAP_WIDTH, MAP_HEIGHT, 100, 4, 10, BASE_EXCLUSION_ZONES, 321, 0.30);

  // DENSE FOREST ambush points
  fillFeatureCircle(terrain, 60, 110, 7, 'forest_dense');
  fillFeatureCircle(terrain, 220, 110, 7, 'forest_dense');
  fillFeatureCircle(terrain, 60, 170, 7, 'forest_dense');
  fillFeatureCircle(terrain, 220, 170, 7, 'forest_dense');
  fillFeatureCircle(terrain, 110, 60, 7, 'forest_dense');
  fillFeatureCircle(terrain, 170, 60, 7, 'forest_dense');
  fillFeatureCircle(terrain, 110, 220, 7, 'forest_dense');
  fillFeatureCircle(terrain, 170, 220, 7, 'forest_dense');

  // MUD areas
  createMudArea(terrain, 140, 140, 14);  // Center
  createMudArea(terrain, 90, 140, 6);
  createMudArea(terrain, 190, 140, 6);
  createMudArea(terrain, 140, 90, 6);
  createMudArea(terrain, 140, 190, 6);

  // Light forests for cover
  fillFeatureCircle(terrain, 115, 115, 6, 'forest_light');
  fillFeatureCircle(terrain, 165, 115, 6, 'forest_light');
  fillFeatureCircle(terrain, 115, 165, 6, 'forest_light');
  fillFeatureCircle(terrain, 165, 165, 6, 'forest_light');

  // ========================================
  // EXPANSIONS WITH RESOURCES
  // ========================================
  const p1Main = createBaseResources(40, 40, DIR.UP_LEFT);
  const p1Nat = createBaseResources(75, 75, DIR.UP_LEFT, 1500, 2250, false, 10);
  const p2Main = createBaseResources(240, 40, DIR.UP_RIGHT);
  const p2Nat = createBaseResources(205, 75, DIR.UP_RIGHT, 1500, 2250, false, 10);
  const p3Main = createBaseResources(40, 240, DIR.DOWN_LEFT);
  const p3Nat = createBaseResources(75, 205, DIR.DOWN_LEFT, 1500, 2250, false, 10);
  const p4Main = createBaseResources(240, 240, DIR.DOWN_RIGHT);
  const p4Nat = createBaseResources(205, 205, DIR.DOWN_RIGHT, 1500, 2250, false, 10);

  const thirdLeft = createBaseResources(40, 140, DIR.LEFT);
  const thirdRight = createBaseResources(240, 140, DIR.RIGHT);
  const thirdTop = createBaseResources(140, 40, DIR.UP);
  const thirdBottom = createBaseResources(140, 240, DIR.DOWN);

  const goldNW = createBaseResources(90, 90, DIR.UP_LEFT, 1500, 2250, true);
  const goldNE = createBaseResources(190, 90, DIR.UP_RIGHT, 1500, 2250, true);
  const goldSW = createBaseResources(90, 190, DIR.DOWN_LEFT, 1500, 2250, true);
  const goldSE = createBaseResources(190, 190, DIR.DOWN_RIGHT, 1500, 2250, true);

  const centerRes = createBaseResources(140, 140, DIR.UP, 1500, 2250, true);

  const expansions = [
    { name: 'P1 Main', x: 40, y: 40, isMain: true, ...p1Main },
    { name: 'P1 Natural', x: 75, y: 75, isNatural: true, ...p1Nat },
    { name: 'P2 Main', x: 240, y: 40, isMain: true, ...p2Main },
    { name: 'P2 Natural', x: 205, y: 75, isNatural: true, ...p2Nat },
    { name: 'P3 Main', x: 40, y: 240, isMain: true, ...p3Main },
    { name: 'P3 Natural', x: 75, y: 205, isNatural: true, ...p3Nat },
    { name: 'P4 Main', x: 240, y: 240, isMain: true, ...p4Main },
    { name: 'P4 Natural', x: 205, y: 205, isNatural: true, ...p4Nat },
    { name: 'Third Left', x: 40, y: 140, ...thirdLeft },
    { name: 'Third Right', x: 240, y: 140, ...thirdRight },
    { name: 'Third Top', x: 140, y: 40, ...thirdTop },
    { name: 'Third Bottom', x: 140, y: 240, ...thirdBottom },
    { name: 'Gold NW', x: 90, y: 90, ...goldNW },
    { name: 'Gold NE', x: 190, y: 90, ...goldNE },
    { name: 'Gold SW', x: 90, y: 190, ...goldSW },
    { name: 'Gold SE', x: 190, y: 190, ...goldSE },
    { name: 'Center', x: 140, y: 140, ...centerRes },
  ];

  const mapData: MapData = {
    id: 'scorched_basin',
    name: 'Scorched Basin',
    author: 'VOIDSTRIKE Team',
    description: 'A balanced 4-player map designed for 2v2 team games or Free-For-All. Symmetrical corner spawns with shared third expansions between adjacent players.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    spawns: [
      { x: 40, y: 40, playerSlot: 1, rotation: Math.PI / 4 },
      { x: 240, y: 40, playerSlot: 2, rotation: -Math.PI / 4 },
      { x: 40, y: 240, playerSlot: 3, rotation: Math.PI * 3 / 4 },
      { x: 240, y: 240, playerSlot: 4, rotation: -Math.PI * 3 / 4 },
    ],

    expansions,

    watchTowers: [
      { x: 140, y: 140, radius: 24 },  // Center
      { x: 90, y: 140, radius: 18 },   // Left
      { x: 190, y: 140, radius: 18 },  // Right
      { x: 140, y: 90, radius: 18 },   // Top
      { x: 140, y: 190, radius: 18 },  // Bottom
    ],

    ramps,

    destructibles: [
      { x: 110, y: 110, health: 1500 },
      { x: 170, y: 110, health: 1500 },
      { x: 110, y: 170, health: 1500 },
      { x: 170, y: 170, health: 1500 },
    ],

    decorations: generateDesertDecorations(rampClearance),

    playerCount: 4,
    maxPlayers: 4,
    isRanked: true,

    biome: 'desert',
    skyboxColor: '#2a1a0a',
    ambientColor: '#504030',
    sunColor: '#ffd080',
    fogColor: '#3a2a1a',
    fogNear: 100,
    fogFar: 280,
  };

  // Validate connectivity
  const validation = validateMapConnectivity(mapData);
  if (!validation.isValid) {
    console.warn('[ScorchedBasin] Map has connectivity issues, attempting auto-fix...');
    const corridorsCarved = autoFixConnectivity(mapData);
    console.log(`[ScorchedBasin] Auto-fix carved ${corridorsCarved} corridors`);
  } else {
    console.log('[ScorchedBasin] Map connectivity validated - all areas reachable');
  }

  return mapData;
}

export const SCORCHED_BASIN = generateScorchedBasin();

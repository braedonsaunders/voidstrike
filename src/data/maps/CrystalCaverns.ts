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
  type GeneratedConnection,
} from './MapTypes';

/**
 * CRYSTAL CAVERNS - 2 Player (1v1) Map
 *
 * A competitive 1v1 map with horizontal spawns and frozen biome.
 *
 * Key Features:
 * - Protected main bases with single ramp entrance
 * - Natural expansions with defensible chokepoints
 * - Multiple expansion locations for late game
 * - Central contested area with watch tower
 * - Ice/crystal themed environment
 *
 * Layout (200x180):
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ ██████████           [Fourth]           ██████████████ │
 *   │ █ P1 MAIN █             │             █ P2 MAIN ██████ │
 *   │ █  [CC]   █          [Third]          █   [CC]  ██████ │
 *   │ █████↓████              │              ████↓█████████ │
 *   │    [NAT]     ────[WATCH TOWER]────     [NAT]          │
 *   │       ↓                 │                 ↓            │
 *   │    [Third]         [CENTER]          [Third]          │
 *   │                    [GOLD]                              │
 *   │ █████████████           │           ██████████████████ │
 *   │ █ [Fourth] █                        █  [Fourth]  █████ │
 *   │ █████████████                       ██████████████████ │
 *   └─────────────────────────────────────────────────────────┘
 *
 * USES NEW TOPOLOGY SYSTEM - Ramp connectivity guaranteed by design
 */

const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;

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

function isInRampClearance(x: number, y: number, clearanceZones: Set<string>): boolean {
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

  // Helper for massive outer border crystals (2-3x scale) for frozen biome
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

  // P1 Main (30, 90) - radius 20
  addBaseEdgeRocks(30, 90, 24, 20);
  addBaseEdgeTrees(30, 90, 27, 14);

  // P2 Main (170, 90)
  addBaseEdgeRocks(170, 90, 24, 20);
  addBaseEdgeTrees(170, 90, 27, 14);

  // ========================================
  // NATURAL EXPANSION EDGE DECORATIONS
  // ========================================

  addBaseEdgeRocks(55, 55, 19, 14);
  addBaseEdgeTrees(55, 55, 22, 10);
  addBaseEdgeRocks(145, 125, 19, 14);
  addBaseEdgeTrees(145, 125, 22, 10);

  // ========================================
  // CONTINUOUS ROCK CLIFF WALLS
  // ========================================

  // Map border cliffs
  addRockCliffLine(12, 12, 12, 168, 3);
  addRockCliffLine(188, 12, 188, 168, 3);
  addRockCliffLine(12, 12, 188, 12, 3);
  addRockCliffLine(12, 168, 188, 168, 3);

  // Massive outer border rocks (2-4x scale) to hide terrain edges
  addMassiveBorderRocks(5, 5, 5, 175, 5);      // Left edge (outer)
  addMassiveBorderRocks(195, 5, 195, 175, 5);  // Right edge (outer)
  addMassiveBorderRocks(5, 5, 195, 5, 5);      // Top edge (outer)
  addMassiveBorderRocks(5, 175, 195, 175, 5);  // Bottom edge (outer)

  // Massive outer border crystals (frozen biome)
  addMassiveBorderCrystals(3, 3, 3, 177, 10);     // Left edge crystals
  addMassiveBorderCrystals(197, 3, 197, 177, 10); // Right edge crystals
  addMassiveBorderCrystals(3, 3, 197, 3, 10);     // Top edge crystals
  addMassiveBorderCrystals(3, 177, 197, 177, 10); // Bottom edge crystals

  // Main base cliff edges - forming walls
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

  // ========================================
  // ORIGINAL DECORATIONS (enhanced)
  // ========================================

  // Map border decorations
  for (let x = 15; x < MAP_WIDTH - 15; x += 8) {
    addCrystalCluster(x, 12, 4, 5);
    addDeadTrees(x, 168, 4, 5);
  }
  for (let y = 15; y < MAP_HEIGHT - 15; y += 8) {
    addCrystalCluster(12, y, 4, 5);
    addDeadTrees(188, y, 4, 5);
  }

  // Cliff edge decorations around main bases - enhanced
  addCrystalCluster(15, 70, 12, 8);
  addCrystalCluster(15, 110, 12, 8);
  addCrystalCluster(185, 70, 12, 8);
  addCrystalCluster(185, 110, 12, 8);

  // Natural expansion surroundings - more decorations
  addDeadTrees(70, 45, 14, 10);
  addDeadTrees(130, 135, 14, 10);
  addRockCluster(65, 60, 10, 7);
  addRockCluster(135, 120, 10, 7);

  // Center area - contested (enhanced)
  addCrystalCluster(100, 75, 15, 12);
  addCrystalCluster(100, 105, 15, 12);
  addRockCluster(85, 90, 12, 8);
  addRockCluster(115, 90, 12, 8);

  // Chokepoint decorations - more rocks
  addRockCluster(75, 90, 10, 6);
  addRockCluster(125, 90, 10, 6);

  // Third/fourth expansion surroundings - enhanced
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

function generateCrystalCaverns(): MapData {
  // ========================================
  // TOPOLOGY DEFINITION - Graph-first terrain generation
  // ========================================
  const topology: MapTopology = {
    areas: [
      // Main bases - elevated platforms with cliff rings
      mainBase('p1_main', 30, 90, 20, 2, 4),
      mainBase('p2_main', 170, 90, 20, 2, 4),

      // Natural expansions - mid-elevation platforms
      naturalExpansion('p1_nat', 55, 55, 14, 1, 3),
      naturalExpansion('p2_nat', 145, 125, 14, 1, 3),

      // Third expansions - ground level, no cliffs
      expansion('p1_third', 'third', 30, 30, 16, 0),
      expansion('p2_third', 'third', 170, 150, 16, 0),

      // Fourth expansions - ground level, no cliffs
      expansion('p1_fourth', 'fourth', 30, 150, 14, 0),
      expansion('p2_fourth', 'fourth', 170, 30, 14, 0),

      // Center gold expansion
      expansion('center_gold', 'gold', 100, 90, 18, 0),
    ],

    connections: [
      // Main to Natural connections (elevation 2 -> 1)
      // P1 main connects to P1 natural
      connect('p1_main', 'p1_nat', 10, 'auto'),
      // P2 main connects to P2 natural
      connect('p2_main', 'p2_nat', 10, 'auto'),

      // Natural to Third (ground) connections (elevation 1 -> 0)
      // CRITICAL: Use same width as upper ramps (10) for consistent navmesh generation
      // P1 natural exits toward P1 third
      connect('p1_nat', 'p1_third', 10, 'auto'),
      // P2 natural exits toward P2 third
      connect('p2_nat', 'p2_third', 10, 'auto'),
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
  fillTerrainRect(terrain, 0, 0, 10, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 10, 0, 10, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 10, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 10, MAP_WIDTH, 10, 'unwalkable');

  // ========================================
  // CENTRAL TERRAIN FEATURES - Chokepoints
  // ========================================

  // Central cliff obstacle
  fillTerrainRect(terrain, 92, 75, 16, 10, 'unwalkable');
  fillTerrainRect(terrain, 92, 95, 16, 10, 'unwalkable');

  // Side passage cliffs
  fillTerrainCircle(terrain, 70, 130, 12, 'unwalkable');
  fillTerrainCircle(terrain, 130, 50, 12, 'unwalkable');

  // Additional chokepoint cliffs
  fillTerrainCircle(terrain, 60, 90, 8, 'unwalkable');
  fillTerrainCircle(terrain, 140, 90, 8, 'unwalkable');

  // ========================================
  // NEW TERRAIN FEATURES - Frozen theme
  // ========================================

  // VOID CHASMS at map corners - icy abysses
  createVoidChasm(terrain, 0, 0, 18, 18, 2);
  createVoidChasm(terrain, MAP_WIDTH - 18, 0, 18, 18, 2);
  createVoidChasm(terrain, 0, MAP_HEIGHT - 18, 18, 18, 2);
  createVoidChasm(terrain, MAP_WIDTH - 18, MAP_HEIGHT - 18, 18, 18, 2);

  // FROZEN LAKES - Impassable ice crevasses
  createLake(terrain, 100, 50, 10, 2);   // Top center lake
  createLake(terrain, 100, 130, 10, 2);  // Bottom center lake

  // FOREST CORRIDORS (frozen dead trees) - Strategic paths
  // P1 side corridor from natural to third
  createForestCorridor(terrain, 55, 68, 35, 35, 16, 5, true);
  // P2 side corridor from natural to third
  createForestCorridor(terrain, 145, 112, 165, 145, 16, 5, true);

  // Side forest walls creating chokepoints
  createForestCorridor(terrain, 15, 55, 15, 125, 12, 4, true);   // P1 west flank
  createForestCorridor(terrain, 185, 55, 185, 125, 12, 4, true); // P2 east flank

  // ROADS - Fast movement paths
  // Main routes from bases
  createRoad(terrain, 30, 90, 55, 90, 4);   // P1 main to ramp area
  createRoad(terrain, 170, 90, 145, 90, 4); // P2 main to ramp area
  // Cross map highway
  createRoad(terrain, 55, 90, 145, 90, 3);

  // SCATTERED FORESTS - Frozen forest cover (3x more trees)
  scatterForests(terrain, MAP_WIDTH, MAP_HEIGHT, 70, 4, 10, BASE_EXCLUSION_ZONES, 456, 0.35);

  // DENSE FOREST ambush positions near thirds
  fillFeatureCircle(terrain, 20, 45, 6, 'forest_dense');   // Near P1 third
  fillFeatureCircle(terrain, 180, 135, 6, 'forest_dense'); // Near P2 third

  // FOREST WALLS creating chokepoints and tactical paths
  // North-south forest wall with gap in middle (frozen tree barrier)
  fillFeatureRect(terrain, 75, 15, 8, 30, 'forest_dense');    // Top section
  fillFeatureRect(terrain, 75, 135, 8, 35, 'forest_dense');   // Bottom section
  fillFeatureRect(terrain, 115, 15, 8, 30, 'forest_dense');   // Top section (P2 side)
  fillFeatureRect(terrain, 115, 135, 8, 35, 'forest_dense');  // Bottom section (P2 side)

  // Diagonal forest walls for flanking cover
  fillFeatureCircle(terrain, 45, 35, 8, 'forest_dense');     // P1 third approach
  fillFeatureCircle(terrain, 155, 145, 8, 'forest_dense');   // P2 third approach

  // Additional dense forest clusters at strategic points
  fillFeatureCircle(terrain, 45, 130, 7, 'forest_dense');    // P1 natural flank
  fillFeatureCircle(terrain, 155, 50, 7, 'forest_dense');    // P2 natural flank
  fillFeatureCircle(terrain, 85, 45, 6, 'forest_dense');     // Near P1 third approach
  fillFeatureCircle(terrain, 115, 135, 6, 'forest_dense');   // Near P2 third approach

  // Mid-map forest patches for army positioning
  fillFeatureCircle(terrain, 65, 75, 6, 'forest_dense');     // P1 mid
  fillFeatureCircle(terrain, 135, 105, 6, 'forest_dense');   // P2 mid

  // MUD/ICE SLICK areas in contested zones (slippery slow zones)
  createMudArea(terrain, 100, 90, 10);  // Center contested

  // Light forests for cover - expanded
  fillFeatureCircle(terrain, 75, 65, 7, 'forest_light');
  fillFeatureCircle(terrain, 125, 115, 7, 'forest_light');
  fillFeatureCircle(terrain, 50, 100, 6, 'forest_light');    // P1 approach
  fillFeatureCircle(terrain, 150, 80, 6, 'forest_light');    // P2 approach
  fillFeatureCircle(terrain, 95, 40, 5, 'forest_light');     // North mid
  fillFeatureCircle(terrain, 105, 140, 5, 'forest_light');   // South mid
  fillFeatureCircle(terrain, 30, 65, 5, 'forest_light');     // P1 flank
  fillFeatureCircle(terrain, 170, 115, 5, 'forest_light');   // P2 flank

  // ========================================
  // EXPANSIONS WITH RESOURCES
  // Standard: 6x 1500 + 2x 900 minerals per base, 2250 gas per geyser
  // Gold: all 8 patches at 900 minerals
  // ========================================
  const p1Main = createBaseResources(30, 90, DIR.LEFT);          // Standard
  const p1Nat = createBaseResources(55, 55, DIR.DOWN_RIGHT, 1500, 2250, false, 10);  // Natural: minerals opposite of ramp to third
  const p1Third = createBaseResources(30, 30, DIR.LEFT);         // Standard
  const p1Fourth = createBaseResources(30, 150, DIR.LEFT);       // Standard
  const p2Main = createBaseResources(170, 90, DIR.RIGHT);        // Standard
  const p2Nat = createBaseResources(145, 125, DIR.UP_LEFT, 1500, 2250, false, 10); // Natural: minerals opposite of ramp to third
  const p2Third = createBaseResources(170, 150, DIR.RIGHT);      // Standard
  const p2Fourth = createBaseResources(170, 30, DIR.RIGHT);      // Standard
  const centerGold = createBaseResources(100, 90, DIR.UP, 1500, 2250, true);  // Gold

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

    // ONLY main base spawn points - critical fix!
    spawns: [
      { x: 30, y: 90, playerSlot: 1, rotation: 0 },           // P1 Main
      { x: 170, y: 90, playerSlot: 2, rotation: Math.PI },    // P2 Main
    ],

    expansions,

    watchTowers: [
      { x: 100, y: 40, radius: 20 },   // Top center (moved north to avoid natural ramp areas)
      { x: 100, y: 140, radius: 20 },  // Bottom center (moved south to avoid natural ramp areas)
      { x: 70, y: 90, radius: 16 },    // Left mid
      { x: 130, y: 90, radius: 16 },   // Right mid
    ],

    ramps,

    destructibles: [
      // Backdoor rocks to third bases (positioned away from natural-to-third ramps)
      { x: 15, y: 48, health: 2000 },   // P1 backdoor - west side of third
      { x: 185, y: 132, health: 2000 }, // P2 backdoor - east side of third
      // Center path rocks
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

  // CRITICAL: Validate and fix connectivity to ensure all areas are reachable
  const validation = validateMapConnectivity(mapData);
  if (!validation.isValid) {
    console.warn('[CrystalCaverns] Map has connectivity issues, attempting auto-fix...');
    console.warn('[CrystalCaverns] Unreachable locations:', validation.unreachableLocations);
    const corridorsCarved = autoFixConnectivity(mapData);
    console.log(`[CrystalCaverns] Auto-fix carved ${corridorsCarved} corridors`);

    // Validate again after fix
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

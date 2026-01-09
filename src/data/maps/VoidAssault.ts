import {
  MapData,
  MapDecoration,
  createTerrainGrid,
  createBaseResources,
  DIR,
  fillTerrainRect,
  fillTerrainCircle,
  createRampInTerrain,
} from './MapTypes';

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

function generateVoidDecorations(): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(456);

  const addCrystalCluster = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y)) continue;
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
      if (isInBaseArea(x, y)) continue;
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
      if (isInBaseArea(x, y)) continue;
      decorations.push({
        type: rockTypes[Math.floor(rand() * rockTypes.length)],
        x, y,
        scale: 0.5 + rand() * 0.7,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Map border decorations
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
  addRockCluster(95, 110, 10, 8);
  addRockCluster(125, 110, 10, 8);

  // Main base cliff edges
  addCrystalCluster(20, 165, 10, 8);
  addCrystalCluster(20, 205, 10, 8);
  addCrystalCluster(200, 15, 10, 8);
  addCrystalCluster(200, 55, 10, 8);

  // Natural surroundings
  addAlienTrees(45, 130, 8, 6);
  addAlienTrees(175, 90, 8, 6);
  addRockCluster(70, 155, 6, 5);
  addRockCluster(150, 65, 6, 5);

  // Third expansion surroundings
  addAlienTrees(25, 50, 8, 6);
  addAlienTrees(195, 170, 8, 6);
  addRockCluster(45, 45, 6, 4);
  addRockCluster(175, 175, 6, 4);

  // Gold expansion surroundings
  addCrystalCluster(90, 50, 8, 6);
  addCrystalCluster(130, 170, 8, 6);

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

function generateVoidAssault(): MapData {
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // ========================================
  // MAP BORDERS - Thick unwalkable cliffs
  // ========================================
  fillTerrainRect(terrain, 0, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 12, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 12, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 12, MAP_WIDTH, 12, 'unwalkable');

  // ========================================
  // PLAYER 1 MAIN BASE (Bottom-left) - Elevation 2
  // Protected by cliffs with single ramp exit
  // ========================================
  fillTerrainCircle(terrain, 35, 185, 28, 'ground', 2);

  // P1 Main cliff walls - ~90% enclosed
  fillTerrainRect(terrain, 12, 155, 15, 53, 'unwalkable');    // West wall
  fillTerrainRect(terrain, 12, 155, 50, 15, 'unwalkable');    // North wall
  fillTerrainRect(terrain, 12, 195, 50, 13, 'unwalkable');    // South wall (partial)
  // Leave ramp opening on north side (toward natural)
  fillTerrainRect(terrain, 55, 155, 12, 15, 'unwalkable');    // East side upper
  fillTerrainRect(terrain, 55, 185, 12, 23, 'unwalkable');    // East side lower

  // ========================================
  // PLAYER 2 MAIN BASE (Top-right) - Elevation 2
  // ========================================
  fillTerrainCircle(terrain, 185, 35, 28, 'ground', 2);

  // P2 Main cliff walls - ~90% enclosed
  fillTerrainRect(terrain, 193, 12, 15, 53, 'unwalkable');    // East wall
  fillTerrainRect(terrain, 158, 12, 50, 15, 'unwalkable');    // North wall (partial)
  fillTerrainRect(terrain, 158, 50, 50, 15, 'unwalkable');    // South wall
  // Leave ramp opening on south side (toward natural)
  fillTerrainRect(terrain, 153, 12, 12, 20, 'unwalkable');    // West side upper
  fillTerrainRect(terrain, 153, 47, 12, 18, 'unwalkable');    // West side lower

  // ========================================
  // NATURAL EXPANSIONS - Elevation 1
  // ========================================

  // P1 Natural (north of main)
  fillTerrainCircle(terrain, 60, 145, 20, 'ground', 1);
  // Natural chokepoint walls
  fillTerrainRect(terrain, 40, 120, 12, 18, 'unwalkable');
  fillTerrainRect(terrain, 72, 120, 15, 18, 'unwalkable');

  // P2 Natural (south of main)
  fillTerrainCircle(terrain, 160, 75, 20, 'ground', 1);
  // Natural chokepoint walls
  fillTerrainRect(terrain, 133, 82, 15, 18, 'unwalkable');
  fillTerrainRect(terrain, 168, 82, 12, 18, 'unwalkable');

  // ========================================
  // THIRD EXPANSIONS - Elevation 0
  // ========================================

  // P1 Third (top-left corner)
  fillTerrainCircle(terrain, 35, 35, 18, 'ground', 0);
  // Partial protection
  fillTerrainRect(terrain, 12, 20, 15, 30, 'unwalkable');
  fillTerrainRect(terrain, 20, 12, 30, 15, 'unwalkable');

  // P2 Third (bottom-right corner)
  fillTerrainCircle(terrain, 185, 185, 18, 'ground', 0);
  // Partial protection
  fillTerrainRect(terrain, 193, 170, 15, 30, 'unwalkable');
  fillTerrainRect(terrain, 170, 193, 30, 15, 'unwalkable');

  // ========================================
  // FOURTH EXPANSIONS - Side positions
  // ========================================

  // P1 Fourth (left side, middle)
  fillTerrainCircle(terrain, 35, 110, 16, 'ground', 0);

  // P2 Fourth (right side, middle)
  fillTerrainCircle(terrain, 185, 110, 16, 'ground', 0);

  // ========================================
  // GOLD EXPANSIONS - High risk, high reward
  // ========================================

  // Gold 1 (top-center, closer to P2)
  fillTerrainCircle(terrain, 80, 60, 14, 'ground', 0);

  // Gold 2 (bottom-center, closer to P1)
  fillTerrainCircle(terrain, 140, 160, 14, 'ground', 0);

  // ========================================
  // CENTER - Major contested area
  // ========================================
  fillTerrainCircle(terrain, 110, 110, 22, 'ground', 0);

  // Central obstacle (forces army splits)
  fillTerrainRect(terrain, 100, 100, 20, 20, 'unwalkable');

  // ========================================
  // TERRAIN FEATURES - Chokepoints and paths
  // ========================================

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
  // RAMPS - Narrow for defensibility (6-8 tiles)
  // ========================================
  const ramps = [
    // P1 Main ramp (north exit toward natural)
    { x: 55, y: 168, width: 8, height: 12, direction: 'north' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // P2 Main ramp (south exit toward natural)
    { x: 157, y: 40, width: 8, height: 12, direction: 'south' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // P1 Natural to low ground
    { x: 72, y: 135, width: 8, height: 8, direction: 'east' as const, fromElevation: 1 as const, toElevation: 0 as const },
    // P2 Natural to low ground
    { x: 140, y: 77, width: 8, height: 8, direction: 'west' as const, fromElevation: 1 as const, toElevation: 0 as const },
  ];

  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // ========================================
  // EXPANSIONS WITH RESOURCES (uniform 7-unit mineral distance)
  // ========================================
  const p1Main = createBaseResources(35, 185, DIR.DOWN_LEFT, 1800, 2500);
  const p1Nat = createBaseResources(60, 145, DIR.DOWN_LEFT, 1500, 2500);
  const p1Third = createBaseResources(35, 35, DIR.UP_LEFT, 1500, 2500);
  const p1Fourth = createBaseResources(35, 110, DIR.LEFT, 1200, 2500);
  const p2Main = createBaseResources(185, 35, DIR.UP_RIGHT, 1800, 2500);
  const p2Nat = createBaseResources(160, 75, DIR.UP_RIGHT, 1500, 2500);
  const p2Third = createBaseResources(185, 185, DIR.DOWN_RIGHT, 1500, 2500);
  const p2Fourth = createBaseResources(185, 110, DIR.RIGHT, 1200, 2500);
  const goldNorth = createBaseResources(80, 60, DIR.UP, 1000, 2500);
  const goldSouth = createBaseResources(140, 160, DIR.DOWN, 1000, 2500);

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

  return {
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

    decorations: generateVoidDecorations(),

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
}

export const VOID_ASSAULT = generateVoidAssault();

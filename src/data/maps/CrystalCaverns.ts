import {
  MapData,
  MapDecoration,
  createTerrainGrid,
  createMineralLine,
  createVespeneGeysers,
  fillTerrainRect,
  fillTerrainCircle,
  createRampInTerrain,
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

function generateFrozenDecorations(): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(123);

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
      if (isInBaseArea(x, y)) continue;
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
      if (isInBaseArea(x, y)) continue;
      decorations.push({
        type: rockTypes[Math.floor(rand() * rockTypes.length)],
        x, y,
        scale: 0.4 + rand() * 0.6,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Map border decorations
  for (let x = 15; x < MAP_WIDTH - 15; x += 8) {
    addCrystalCluster(x, 12, 3, 4);
    addDeadTrees(x, 168, 3, 4);
  }
  for (let y = 15; y < MAP_HEIGHT - 15; y += 8) {
    addCrystalCluster(12, y, 3, 4);
    addDeadTrees(188, y, 3, 4);
  }

  // Cliff edge decorations around main bases
  addCrystalCluster(15, 70, 8, 6);
  addCrystalCluster(15, 110, 8, 6);
  addCrystalCluster(185, 70, 8, 6);
  addCrystalCluster(185, 110, 8, 6);

  // Natural expansion surroundings
  addDeadTrees(70, 45, 10, 8);
  addDeadTrees(130, 135, 10, 8);
  addRockCluster(65, 60, 6, 5);
  addRockCluster(135, 120, 6, 5);

  // Center area - contested
  addCrystalCluster(100, 75, 12, 10);
  addCrystalCluster(100, 105, 12, 10);
  addRockCluster(85, 90, 8, 6);
  addRockCluster(115, 90, 8, 6);

  // Chokepoint decorations
  addRockCluster(75, 90, 6, 4);
  addRockCluster(125, 90, 6, 4);

  // Third/fourth expansion surroundings
  addDeadTrees(20, 25, 6, 5);
  addDeadTrees(180, 155, 6, 5);
  addDeadTrees(20, 155, 6, 5);
  addDeadTrees(180, 25, 6, 5);

  // Debris
  decorations.push({ type: 'debris', x: 90, y: 85, scale: 0.8 });
  decorations.push({ type: 'debris', x: 110, y: 95, scale: 0.8 });
  decorations.push({ type: 'ruined_wall', x: 100, y: 90, scale: 1.0 });

  return decorations;
}

function generateCrystalCaverns(): MapData {
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // ========================================
  // MAP BORDERS - Thick unwalkable cliffs
  // ========================================
  fillTerrainRect(terrain, 0, 0, 10, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 10, 0, 10, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 10, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 10, MAP_WIDTH, 10, 'unwalkable');

  // ========================================
  // PLAYER 1 MAIN BASE (Left side) - Elevation 2
  // Almost fully enclosed by cliffs, single ramp exit
  // ========================================
  fillTerrainCircle(terrain, 30, 90, 25, 'ground', 2);

  // P1 Main cliff walls - surround ~85% of base
  fillTerrainRect(terrain, 10, 60, 15, 60, 'unwalkable');    // West wall
  fillTerrainRect(terrain, 10, 60, 45, 12, 'unwalkable');    // North wall
  fillTerrainRect(terrain, 10, 108, 45, 12, 'unwalkable');   // South wall
  // Leave opening for ramp on east side (around y=85-95)
  fillTerrainRect(terrain, 45, 60, 10, 22, 'unwalkable');    // North-east corner
  fillTerrainRect(terrain, 45, 98, 10, 22, 'unwalkable');    // South-east corner

  // ========================================
  // PLAYER 2 MAIN BASE (Right side) - Elevation 2
  // ========================================
  fillTerrainCircle(terrain, 170, 90, 25, 'ground', 2);

  // P2 Main cliff walls
  fillTerrainRect(terrain, 175, 60, 15, 60, 'unwalkable');   // East wall
  fillTerrainRect(terrain, 145, 60, 45, 12, 'unwalkable');   // North wall
  fillTerrainRect(terrain, 145, 108, 45, 12, 'unwalkable');  // South wall
  // Leave opening for ramp on west side
  fillTerrainRect(terrain, 145, 60, 10, 22, 'unwalkable');   // North-west corner
  fillTerrainRect(terrain, 145, 98, 10, 22, 'unwalkable');   // South-west corner

  // ========================================
  // NATURAL EXPANSIONS - Elevation 1
  // ========================================

  // P1 Natural (northeast of main)
  fillTerrainCircle(terrain, 55, 55, 18, 'ground', 1);
  // Natural chokepoint walls
  fillTerrainRect(terrain, 35, 35, 15, 12, 'unwalkable');
  fillTerrainRect(terrain, 65, 35, 15, 12, 'unwalkable');

  // P2 Natural (southwest of main)
  fillTerrainCircle(terrain, 145, 125, 18, 'ground', 1);
  // Natural chokepoint walls
  fillTerrainRect(terrain, 120, 133, 15, 12, 'unwalkable');
  fillTerrainRect(terrain, 150, 133, 15, 12, 'unwalkable');

  // ========================================
  // THIRD EXPANSIONS - Elevation 0
  // ========================================

  // P1 Third (top-left corner)
  fillTerrainCircle(terrain, 30, 30, 16, 'ground', 0);

  // P2 Third (bottom-right corner)
  fillTerrainCircle(terrain, 170, 150, 16, 'ground', 0);

  // ========================================
  // FOURTH EXPANSIONS - Edge locations
  // ========================================

  // P1 Fourth (bottom-left)
  fillTerrainCircle(terrain, 30, 150, 14, 'ground', 0);

  // P2 Fourth (top-right)
  fillTerrainCircle(terrain, 170, 30, 14, 'ground', 0);

  // ========================================
  // CENTER GOLD EXPANSION - Highly contested
  // ========================================
  fillTerrainCircle(terrain, 100, 90, 18, 'ground', 0);

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
  // RAMPS - Narrow for defensibility (6-8 tiles)
  // ========================================
  const ramps = [
    // P1 Main ramp (east exit)
    { x: 48, y: 85, width: 8, height: 10, direction: 'east' as const, fromElevation: 2 as const, toElevation: 0 as const },
    // P2 Main ramp (west exit)
    { x: 144, y: 85, width: 8, height: 10, direction: 'west' as const, fromElevation: 2 as const, toElevation: 0 as const },
    // P1 Natural ramp
    { x: 55, y: 68, width: 6, height: 8, direction: 'south' as const, fromElevation: 1 as const, toElevation: 0 as const },
    // P2 Natural ramp
    { x: 145, y: 108, width: 6, height: 8, direction: 'north' as const, fromElevation: 1 as const, toElevation: 0 as const },
  ];

  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // ========================================
  // EXPANSIONS WITH RESOURCES
  // ========================================
  const expansions = [
    // P1 Main - minerals against west cliff
    {
      name: 'P1 Main',
      x: 30,
      y: 90,
      isMain: true,
      minerals: createMineralLine(18, 90, 30, 90, 1800),
      vespene: createVespeneGeysers(18, 90, 30, 90, 2500),
    },
    // P1 Natural
    {
      name: 'P1 Natural',
      x: 55,
      y: 55,
      isNatural: true,
      minerals: createMineralLine(45, 45, 55, 55, 1500),
      vespene: createVespeneGeysers(45, 45, 55, 55, 2500),
    },
    // P1 Third
    {
      name: 'P1 Third',
      x: 30,
      y: 30,
      minerals: createMineralLine(18, 25, 30, 30, 1500),
      vespene: createVespeneGeysers(18, 25, 30, 30, 2500),
    },
    // P1 Fourth
    {
      name: 'P1 Fourth',
      x: 30,
      y: 150,
      minerals: createMineralLine(18, 155, 30, 150, 1200),
      vespene: createVespeneGeysers(18, 155, 30, 150, 2500),
    },
    // P2 Main - minerals against east cliff
    {
      name: 'P2 Main',
      x: 170,
      y: 90,
      isMain: true,
      minerals: createMineralLine(182, 90, 170, 90, 1800),
      vespene: createVespeneGeysers(182, 90, 170, 90, 2500),
    },
    // P2 Natural
    {
      name: 'P2 Natural',
      x: 145,
      y: 125,
      isNatural: true,
      minerals: createMineralLine(155, 135, 145, 125, 1500),
      vespene: createVespeneGeysers(155, 135, 145, 125, 2500),
    },
    // P2 Third
    {
      name: 'P2 Third',
      x: 170,
      y: 150,
      minerals: createMineralLine(182, 155, 170, 150, 1500),
      vespene: createVespeneGeysers(182, 155, 170, 150, 2500),
    },
    // P2 Fourth
    {
      name: 'P2 Fourth',
      x: 170,
      y: 30,
      minerals: createMineralLine(182, 25, 170, 30, 1200),
      vespene: createVespeneGeysers(182, 25, 170, 30, 2500),
    },
    // Center Gold (contested)
    {
      name: 'Center Gold',
      x: 100,
      y: 90,
      minerals: createMineralLine(100, 80, 100, 90, 1000),
      vespene: createVespeneGeysers(100, 80, 100, 90, 2500),
    },
  ];

  return {
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
      { x: 100, y: 55, radius: 20 },   // Top center
      { x: 100, y: 125, radius: 20 },  // Bottom center
      { x: 70, y: 90, radius: 16 },    // Left mid
      { x: 130, y: 90, radius: 16 },   // Right mid
    ],

    ramps,

    destructibles: [
      // Backdoor rocks to third bases
      { x: 40, y: 42, health: 2000 },
      { x: 160, y: 138, health: 2000 },
      // Center path rocks
      { x: 85, y: 90, health: 1500 },
      { x: 115, y: 90, health: 1500 },
    ],

    decorations: generateFrozenDecorations(),

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
}

export const CRYSTAL_CAVERNS = generateCrystalCaverns();

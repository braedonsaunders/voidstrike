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
 * SCORCHED BASIN - 4 Player Map
 *
 * A large 4-player map with corner spawns and desert/volcanic biome.
 * Each player has a protected main base with natural expansion nearby.
 *
 * Key Features:
 * - 4 corner spawn positions with protected mains
 * - Each main has single ramp exit toward natural
 * - Multiple expansion locations for economic development
 * - Central contested area with watch tower
 * - Multiple attack paths between players
 *
 * Layout (280x280):
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ █ P1 MAIN █                                         █ P2 MAIN █ │
 *   │ █████↓█████     [Third]         [Third]           █████↓█████ │
 *   │   [P1 NAT]         │               │              [P2 NAT]     │
 *   │       ↓                                                ↓       │
 *   │   [Third]                                          [Third]     │
 *   │                        ████████████                            │
 *   │        [Gold]          ██ CENTER ██          [Gold]            │
 *   │                        ██ TOWER  ██                            │
 *   │                        ████████████                            │
 *   │   [Third]                                          [Third]     │
 *   │       ↑                                                ↑       │
 *   │   [P3 NAT]                                         [P4 NAT]    │
 *   │ █████↑█████     [Third]         [Third]           █████↑█████ │
 *   │ █ P3 MAIN █                                         █ P4 MAIN █ │
 *   └──────────────────────────────────────────────────────────────────┘
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
  // Main bases
  { x: 40, y: 40, radius: 26 },     // P1 main (top-left)
  { x: 240, y: 40, radius: 26 },    // P2 main (top-right)
  { x: 40, y: 240, radius: 26 },    // P3 main (bottom-left)
  { x: 240, y: 240, radius: 26 },   // P4 main (bottom-right)
  // Natural expansions
  { x: 75, y: 75, radius: 18 },     // P1 natural
  { x: 205, y: 75, radius: 18 },    // P2 natural
  { x: 75, y: 205, radius: 18 },    // P3 natural
  { x: 205, y: 205, radius: 18 },   // P4 natural
  // Third expansions
  { x: 40, y: 140, radius: 16 },    // P1/P3 shared third (left)
  { x: 240, y: 140, radius: 16 },   // P2/P4 shared third (right)
  { x: 140, y: 40, radius: 16 },    // P1/P2 shared third (top)
  { x: 140, y: 240, radius: 16 },   // P3/P4 shared third (bottom)
  // Center
  { x: 140, y: 140, radius: 22 },   // Center contested
  // Gold expansions
  { x: 90, y: 190, radius: 14 },    // Gold 1
  { x: 190, y: 90, radius: 14 },    // Gold 2
  { x: 90, y: 90, radius: 14 },     // Gold 3
  { x: 190, y: 190, radius: 14 },   // Gold 4
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

function generateDesertDecorations(): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(789);

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
        scale: 0.4 + rand() * 0.8,
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
      if (isInBaseArea(x, y)) continue;
      decorations.push({
        type: 'crystal_formation',
        x, y,
        scale: 0.5 + rand() * 0.6,
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
        scale: 0.6 + rand() * 0.5,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Map border decorations
  for (let i = 15; i < MAP_WIDTH - 15; i += 12) {
    addRockCluster(i, 12, 4, 5);
    addRockCluster(i, MAP_HEIGHT - 12, 4, 5);
    addRockCluster(12, i, 4, 5);
    addRockCluster(MAP_WIDTH - 12, i, 4, 5);
  }

  // Main base cliff edges
  addRockCluster(25, 60, 10, 8);
  addRockCluster(55, 25, 10, 8);
  addRockCluster(225, 25, 10, 8);
  addRockCluster(255, 60, 10, 8);
  addRockCluster(25, 220, 10, 8);
  addRockCluster(55, 255, 10, 8);
  addRockCluster(225, 255, 10, 8);
  addRockCluster(255, 220, 10, 8);

  // Natural expansion surroundings
  addDeadTrees(60, 90, 8, 6);
  addDeadTrees(220, 90, 8, 6);
  addDeadTrees(60, 190, 8, 6);
  addDeadTrees(220, 190, 8, 6);

  // Central area - heavy rocks and crystals
  addCrystalCluster(140, 120, 15, 12);
  addCrystalCluster(140, 160, 15, 12);
  addRockCluster(120, 140, 12, 10);
  addRockCluster(160, 140, 12, 10);

  // Chokepoint decorations
  addRockCluster(100, 140, 8, 6);
  addRockCluster(180, 140, 8, 6);
  addRockCluster(140, 100, 8, 6);
  addRockCluster(140, 180, 8, 6);

  // Gold expansion decorations
  addCrystalCluster(90, 90, 6, 5);
  addCrystalCluster(190, 90, 6, 5);
  addCrystalCluster(90, 190, 6, 5);
  addCrystalCluster(190, 190, 6, 5);

  // Third expansion decorations
  addDeadTrees(35, 125, 6, 5);
  addDeadTrees(35, 155, 6, 5);
  addDeadTrees(245, 125, 6, 5);
  addDeadTrees(245, 155, 6, 5);
  addDeadTrees(125, 35, 6, 5);
  addDeadTrees(155, 35, 6, 5);
  addDeadTrees(125, 245, 6, 5);
  addDeadTrees(155, 245, 6, 5);

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
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // ========================================
  // MAP BORDERS - Thick unwalkable cliffs
  // ========================================
  fillTerrainRect(terrain, 0, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 12, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 12, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 12, MAP_WIDTH, 12, 'unwalkable');

  // ========================================
  // PLAYER 1 MAIN BASE (Top-left) - Elevation 2
  // ========================================
  fillTerrainCircle(terrain, 40, 40, 28, 'ground', 2);

  // P1 Main cliff walls - ~90% enclosed
  fillTerrainRect(terrain, 12, 12, 20, 55, 'unwalkable');     // West wall
  fillTerrainRect(terrain, 12, 12, 55, 20, 'unwalkable');     // North wall
  // Leave ramp opening toward natural (southeast)
  fillTerrainRect(terrain, 60, 12, 15, 35, 'unwalkable');     // East upper
  fillTerrainRect(terrain, 12, 60, 35, 15, 'unwalkable');     // South left

  // ========================================
  // PLAYER 2 MAIN BASE (Top-right) - Elevation 2
  // ========================================
  fillTerrainCircle(terrain, 240, 40, 28, 'ground', 2);

  // P2 Main cliff walls
  fillTerrainRect(terrain, 248, 12, 20, 55, 'unwalkable');    // East wall
  fillTerrainRect(terrain, 213, 12, 55, 20, 'unwalkable');    // North wall
  // Leave ramp opening toward natural (southwest)
  fillTerrainRect(terrain, 205, 12, 15, 35, 'unwalkable');    // West upper
  fillTerrainRect(terrain, 233, 60, 35, 15, 'unwalkable');    // South right

  // ========================================
  // PLAYER 3 MAIN BASE (Bottom-left) - Elevation 2
  // ========================================
  fillTerrainCircle(terrain, 40, 240, 28, 'ground', 2);

  // P3 Main cliff walls
  fillTerrainRect(terrain, 12, 213, 20, 55, 'unwalkable');    // West wall
  fillTerrainRect(terrain, 12, 248, 55, 20, 'unwalkable');    // South wall
  // Leave ramp opening toward natural (northeast)
  fillTerrainRect(terrain, 60, 233, 15, 35, 'unwalkable');    // East lower
  fillTerrainRect(terrain, 12, 205, 35, 15, 'unwalkable');    // North left

  // ========================================
  // PLAYER 4 MAIN BASE (Bottom-right) - Elevation 2
  // ========================================
  fillTerrainCircle(terrain, 240, 240, 28, 'ground', 2);

  // P4 Main cliff walls
  fillTerrainRect(terrain, 248, 213, 20, 55, 'unwalkable');   // East wall
  fillTerrainRect(terrain, 213, 248, 55, 20, 'unwalkable');   // South wall
  // Leave ramp opening toward natural (northwest)
  fillTerrainRect(terrain, 205, 233, 15, 35, 'unwalkable');   // West lower
  fillTerrainRect(terrain, 233, 205, 35, 15, 'unwalkable');   // North right

  // ========================================
  // NATURAL EXPANSIONS - Elevation 1
  // ========================================

  // P1 Natural (southeast of P1 main)
  fillTerrainCircle(terrain, 75, 75, 20, 'ground', 1);
  fillTerrainRect(terrain, 55, 85, 12, 15, 'unwalkable');
  fillTerrainRect(terrain, 85, 55, 15, 12, 'unwalkable');

  // P2 Natural (southwest of P2 main)
  fillTerrainCircle(terrain, 205, 75, 20, 'ground', 1);
  fillTerrainRect(terrain, 213, 85, 12, 15, 'unwalkable');
  fillTerrainRect(terrain, 180, 55, 15, 12, 'unwalkable');

  // P3 Natural (northeast of P3 main)
  fillTerrainCircle(terrain, 75, 205, 20, 'ground', 1);
  fillTerrainRect(terrain, 55, 180, 12, 15, 'unwalkable');
  fillTerrainRect(terrain, 85, 213, 15, 12, 'unwalkable');

  // P4 Natural (northwest of P4 main)
  fillTerrainCircle(terrain, 205, 205, 20, 'ground', 1);
  fillTerrainRect(terrain, 213, 180, 12, 15, 'unwalkable');
  fillTerrainRect(terrain, 180, 213, 15, 12, 'unwalkable');

  // ========================================
  // THIRD EXPANSIONS - Elevation 0 (shared sides)
  // ========================================

  // Left side third (between P1 and P3)
  fillTerrainCircle(terrain, 40, 140, 18, 'ground', 0);
  // Right side third (between P2 and P4)
  fillTerrainCircle(terrain, 240, 140, 18, 'ground', 0);
  // Top third (between P1 and P2)
  fillTerrainCircle(terrain, 140, 40, 18, 'ground', 0);
  // Bottom third (between P3 and P4)
  fillTerrainCircle(terrain, 140, 240, 18, 'ground', 0);

  // ========================================
  // GOLD EXPANSIONS - High risk, high reward
  // ========================================

  // Gold 1 (P1-P3 diagonal)
  fillTerrainCircle(terrain, 90, 190, 14, 'ground', 0);
  // Gold 2 (P2-P4 diagonal)
  fillTerrainCircle(terrain, 190, 90, 14, 'ground', 0);
  // Gold 3 (P1-P2 inner)
  fillTerrainCircle(terrain, 90, 90, 14, 'ground', 0);
  // Gold 4 (P3-P4 inner)
  fillTerrainCircle(terrain, 190, 190, 14, 'ground', 0);

  // ========================================
  // CENTER - Major contested area
  // ========================================
  fillTerrainCircle(terrain, 140, 140, 24, 'ground', 0);

  // Central obstacle
  fillTerrainRect(terrain, 130, 130, 20, 20, 'unwalkable');

  // ========================================
  // TERRAIN FEATURES - Chokepoints
  // ========================================

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
  // RAMPS - Narrow (8 tiles)
  // ========================================
  const ramps = [
    // P1 Main ramp (southeast)
    { x: 55, y: 55, width: 10, height: 10, direction: 'east' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // P2 Main ramp (southwest)
    { x: 215, y: 55, width: 10, height: 10, direction: 'west' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // P3 Main ramp (northeast)
    { x: 55, y: 215, width: 10, height: 10, direction: 'east' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // P4 Main ramp (northwest)
    { x: 215, y: 215, width: 10, height: 10, direction: 'west' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // Natural to low ground ramps
    { x: 88, y: 75, width: 8, height: 8, direction: 'east' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 184, y: 75, width: 8, height: 8, direction: 'west' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 88, y: 197, width: 8, height: 8, direction: 'east' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 184, y: 197, width: 8, height: 8, direction: 'west' as const, fromElevation: 1 as const, toElevation: 0 as const },
  ];

  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // ========================================
  // EXPANSIONS WITH RESOURCES (SC2-accurate amounts)
  // SC2 values: 6x 1500 + 2x 900 minerals per base, 2250 gas per geyser
  // Gold bases: all 8 patches at 900 minerals
  // ========================================
  const p1Main = createBaseResources(40, 40, DIR.UP_LEFT);       // Standard
  const p1Nat = createBaseResources(75, 75, DIR.UP_LEFT);        // Standard
  const p2Main = createBaseResources(240, 40, DIR.UP_RIGHT);     // Standard
  const p2Nat = createBaseResources(205, 75, DIR.UP_RIGHT);      // Standard
  const p3Main = createBaseResources(40, 240, DIR.DOWN_LEFT);    // Standard
  const p3Nat = createBaseResources(75, 205, DIR.DOWN_LEFT);     // Standard
  const p4Main = createBaseResources(240, 240, DIR.DOWN_RIGHT);  // Standard
  const p4Nat = createBaseResources(205, 205, DIR.DOWN_RIGHT);   // Standard
  const westThird = createBaseResources(40, 140, DIR.LEFT);      // Standard
  const eastThird = createBaseResources(240, 140, DIR.RIGHT);    // Standard
  const northThird = createBaseResources(140, 40, DIR.UP);       // Standard
  const southThird = createBaseResources(140, 240, DIR.DOWN);    // Standard
  const goldSW = createBaseResources(90, 190, DIR.DOWN_LEFT, 1500, 2250, true);   // Gold
  const goldNE = createBaseResources(190, 90, DIR.UP_RIGHT, 1500, 2250, true);    // Gold
  const goldNW = createBaseResources(90, 90, DIR.UP_LEFT, 1500, 2250, true);      // Gold
  const goldSE = createBaseResources(190, 190, DIR.DOWN_RIGHT, 1500, 2250, true); // Gold
  const center = createBaseResources(140, 140, DIR.DOWN, 1500, 2250, true);       // Gold (contested)

  const expansions = [
    { name: 'P1 Main', x: 40, y: 40, isMain: true, ...p1Main },
    { name: 'P1 Natural', x: 75, y: 75, isNatural: true, ...p1Nat },
    { name: 'P2 Main', x: 240, y: 40, isMain: true, ...p2Main },
    { name: 'P2 Natural', x: 205, y: 75, isNatural: true, ...p2Nat },
    { name: 'P3 Main', x: 40, y: 240, isMain: true, ...p3Main },
    { name: 'P3 Natural', x: 75, y: 205, isNatural: true, ...p3Nat },
    { name: 'P4 Main', x: 240, y: 240, isMain: true, ...p4Main },
    { name: 'P4 Natural', x: 205, y: 205, isNatural: true, ...p4Nat },
    { name: 'West Third', x: 40, y: 140, ...westThird },
    { name: 'East Third', x: 240, y: 140, ...eastThird },
    { name: 'North Third', x: 140, y: 40, ...northThird },
    { name: 'South Third', x: 140, y: 240, ...southThird },
    { name: 'Gold Southwest', x: 90, y: 190, ...goldSW },
    { name: 'Gold Northeast', x: 190, y: 90, ...goldNE },
    { name: 'Gold Northwest', x: 90, y: 90, ...goldNW },
    { name: 'Gold Southeast', x: 190, y: 190, ...goldSE },
    { name: 'Center', x: 140, y: 140, ...center },
  ];

  return {
    id: 'scorched_basin',
    name: 'Scorched Basin',
    author: 'VOIDSTRIKE Team',
    description: 'A 4-player map with protected corner bases. Each player has a secure main with natural expansion nearby. Multiple attack paths and shared expansions create dynamic gameplay.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    // ONLY main base spawn points - 4 players
    spawns: [
      { x: 40, y: 40, playerSlot: 1, rotation: Math.PI / 4 },            // P1 Main (top-left)
      { x: 240, y: 40, playerSlot: 2, rotation: Math.PI * 3 / 4 },       // P2 Main (top-right)
      { x: 40, y: 240, playerSlot: 3, rotation: -Math.PI / 4 },          // P3 Main (bottom-left)
      { x: 240, y: 240, playerSlot: 4, rotation: -Math.PI * 3 / 4 },     // P4 Main (bottom-right)
    ],

    expansions,

    watchTowers: [
      { x: 140, y: 140, radius: 26 },  // Center - primary control
      { x: 100, y: 140, radius: 18 },  // West mid
      { x: 180, y: 140, radius: 18 },  // East mid
      { x: 140, y: 100, radius: 18 },  // North mid
      { x: 140, y: 180, radius: 18 },  // South mid
    ],

    ramps,

    destructibles: [
      // Rocks blocking gold bases
      { x: 100, y: 100, health: 2000 },
      { x: 180, y: 100, health: 2000 },
      { x: 100, y: 180, health: 2000 },
      { x: 180, y: 180, health: 2000 },
      // Center rocks
      { x: 130, y: 115, health: 1500 },
      { x: 150, y: 165, health: 1500 },
      // Side passage rocks
      { x: 60, y: 140, health: 1500 },
      { x: 220, y: 140, health: 1500 },
    ],

    decorations: generateDesertDecorations(),

    playerCount: 4,
    maxPlayers: 4,
    isRanked: true,

    biome: 'desert',
    fogNear: 100,
    fogFar: 300,
  };
}

export const SCORCHED_BASIN = generateScorchedBasin();

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
 * CONTESTED FRONTIER - 6 Player Map (3v3)
 *
 * A massive 6-player map designed for team games.
 * Players spawn in two rows of 3, facing each other across a contested center.
 *
 * Key Features:
 * - 6 protected main bases (3 top, 3 bottom)
 * - Team-oriented layout for 3v3 matches
 * - Large central contested area with multiple watch towers
 * - Multiple expansion paths for economic development
 * - Jungle biome with dense vegetation
 *
 * Layout (360x320):
 *
 *   ┌────────────────────────────────────────────────────────────────────────┐
 *   │ █P1 MAIN█           █P2 MAIN█           █P3 MAIN█                     │
 *   │ ███↓████             ███↓████             ███↓████                     │
 *   │  [NAT]                [NAT]                [NAT]                       │
 *   │                                                                        │
 *   │   [Third]    [Gold]     [Third]    [Gold]     [Third]                 │
 *   │                         ████████                                       │
 *   │                        ██TOWER██                                       │
 *   │                         ████████                                       │
 *   │   [Third]    [Gold]     [Third]    [Gold]     [Third]                 │
 *   │                                                                        │
 *   │  [NAT]                [NAT]                [NAT]                       │
 *   │ ███↑████             ███↑████             ███↑████                     │
 *   │ █P4 MAIN█           █P5 MAIN█           █P6 MAIN█                     │
 *   └────────────────────────────────────────────────────────────────────────┘
 */

const MAP_WIDTH = 360;
const MAP_HEIGHT = 320;

function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// Base exclusion zones
const BASE_EXCLUSION_ZONES = [
  // Top row mains (P1, P2, P3)
  { x: 50, y: 45, radius: 26 },
  { x: 180, y: 45, radius: 26 },
  { x: 310, y: 45, radius: 26 },
  // Bottom row mains (P4, P5, P6)
  { x: 50, y: 275, radius: 26 },
  { x: 180, y: 275, radius: 26 },
  { x: 310, y: 275, radius: 26 },
  // Naturals
  { x: 70, y: 85, radius: 18 },
  { x: 180, y: 85, radius: 18 },
  { x: 290, y: 85, radius: 18 },
  { x: 70, y: 235, radius: 18 },
  { x: 180, y: 235, radius: 18 },
  { x: 290, y: 235, radius: 18 },
  // Center
  { x: 180, y: 160, radius: 24 },
  // Gold bases
  { x: 100, y: 130, radius: 14 },
  { x: 260, y: 130, radius: 14 },
  { x: 100, y: 190, radius: 14 },
  { x: 260, y: 190, radius: 14 },
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

function generateJungleDecorations(): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(999);

  const addTreeCluster = (cx: number, cy: number, count: number, spread: number) => {
    const treeTypes: Array<'tree_pine_tall' | 'tree_pine_medium' | 'tree_palm' | 'tree_mushroom'> = [
      'tree_pine_tall', 'tree_pine_medium', 'tree_palm', 'tree_mushroom'
    ];
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y)) continue;
      decorations.push({
        type: treeTypes[Math.floor(rand() * treeTypes.length)],
        x, y,
        scale: 0.6 + rand() * 0.7,
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
        scale: 0.4 + rand() * 0.7,
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

  // Map borders - dense jungle
  for (let i = 15; i < MAP_WIDTH - 15; i += 15) {
    addTreeCluster(i, 12, 6, 6);
    addTreeCluster(i, MAP_HEIGHT - 12, 6, 6);
  }
  for (let i = 15; i < MAP_HEIGHT - 15; i += 15) {
    addTreeCluster(12, i, 6, 6);
    addTreeCluster(MAP_WIDTH - 12, i, 6, 6);
  }

  // Main base surroundings (cliff edges)
  addRockCluster(35, 65, 10, 8);
  addRockCluster(65, 30, 10, 8);
  addRockCluster(165, 30, 10, 8);
  addRockCluster(195, 65, 10, 8);
  addRockCluster(295, 30, 10, 8);
  addRockCluster(325, 65, 10, 8);
  addRockCluster(35, 255, 10, 8);
  addRockCluster(65, 290, 10, 8);
  addRockCluster(165, 290, 10, 8);
  addRockCluster(195, 255, 10, 8);
  addRockCluster(295, 290, 10, 8);
  addRockCluster(325, 255, 10, 8);

  // Central area - heavy decoration
  addCrystalCluster(180, 140, 20, 15);
  addCrystalCluster(180, 180, 20, 15);
  addRockCluster(160, 160, 15, 12);
  addRockCluster(200, 160, 15, 12);

  // Between-base paths
  addTreeCluster(115, 45, 8, 6);
  addTreeCluster(245, 45, 8, 6);
  addTreeCluster(115, 275, 8, 6);
  addTreeCluster(245, 275, 8, 6);

  // Gold expansion surroundings
  addCrystalCluster(100, 130, 8, 6);
  addCrystalCluster(260, 130, 8, 6);
  addCrystalCluster(100, 190, 8, 6);
  addCrystalCluster(260, 190, 8, 6);

  // Third expansion surroundings
  addTreeCluster(50, 130, 10, 8);
  addTreeCluster(310, 130, 10, 8);
  addTreeCluster(50, 190, 10, 8);
  addTreeCluster(310, 190, 10, 8);
  addTreeCluster(180, 120, 8, 6);
  addTreeCluster(180, 200, 8, 6);

  // Scattered bushes
  for (let i = 0; i < 200; i++) {
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

  // Debris and special objects
  decorations.push({ type: 'debris', x: 170, y: 155, scale: 1.0 });
  decorations.push({ type: 'debris', x: 190, y: 165, scale: 1.0 });
  decorations.push({ type: 'ruined_wall', x: 180, y: 160, scale: 1.3 });
  decorations.push({ type: 'escape_pod', x: 15, y: 15, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 345, y: 15, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 15, y: 305, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 345, y: 305, scale: 0.9 });

  return decorations;
}

function generateContestedFrontier(): MapData {
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // ========================================
  // MAP BORDERS
  // ========================================
  fillTerrainRect(terrain, 0, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 12, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 12, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 12, MAP_WIDTH, 12, 'unwalkable');

  // ========================================
  // TOP ROW MAIN BASES (P1, P2, P3) - Elevation 2
  // ========================================

  // P1 Main (top-left)
  fillTerrainCircle(terrain, 50, 45, 28, 'ground', 2);
  fillTerrainRect(terrain, 12, 12, 25, 55, 'unwalkable');
  fillTerrainRect(terrain, 12, 12, 60, 20, 'unwalkable');
  fillTerrainRect(terrain, 70, 12, 15, 35, 'unwalkable');
  fillTerrainRect(terrain, 12, 60, 40, 12, 'unwalkable');

  // P2 Main (top-center)
  fillTerrainCircle(terrain, 180, 45, 28, 'ground', 2);
  fillTerrainRect(terrain, 150, 12, 60, 20, 'unwalkable');
  fillTerrainRect(terrain, 145, 12, 15, 35, 'unwalkable');
  fillTerrainRect(terrain, 200, 12, 15, 35, 'unwalkable');
  fillTerrainRect(terrain, 145, 60, 25, 12, 'unwalkable');
  fillTerrainRect(terrain, 190, 60, 25, 12, 'unwalkable');

  // P3 Main (top-right)
  fillTerrainCircle(terrain, 310, 45, 28, 'ground', 2);
  fillTerrainRect(terrain, 323, 12, 25, 55, 'unwalkable');
  fillTerrainRect(terrain, 288, 12, 60, 20, 'unwalkable');
  fillTerrainRect(terrain, 275, 12, 15, 35, 'unwalkable');
  fillTerrainRect(terrain, 308, 60, 40, 12, 'unwalkable');

  // ========================================
  // BOTTOM ROW MAIN BASES (P4, P5, P6) - Elevation 2
  // ========================================

  // P4 Main (bottom-left)
  fillTerrainCircle(terrain, 50, 275, 28, 'ground', 2);
  fillTerrainRect(terrain, 12, 253, 25, 55, 'unwalkable');
  fillTerrainRect(terrain, 12, 288, 60, 20, 'unwalkable');
  fillTerrainRect(terrain, 70, 273, 15, 35, 'unwalkable');
  fillTerrainRect(terrain, 12, 248, 40, 12, 'unwalkable');

  // P5 Main (bottom-center)
  fillTerrainCircle(terrain, 180, 275, 28, 'ground', 2);
  fillTerrainRect(terrain, 150, 288, 60, 20, 'unwalkable');
  fillTerrainRect(terrain, 145, 273, 15, 35, 'unwalkable');
  fillTerrainRect(terrain, 200, 273, 15, 35, 'unwalkable');
  fillTerrainRect(terrain, 145, 248, 25, 12, 'unwalkable');
  fillTerrainRect(terrain, 190, 248, 25, 12, 'unwalkable');

  // P6 Main (bottom-right)
  fillTerrainCircle(terrain, 310, 275, 28, 'ground', 2);
  fillTerrainRect(terrain, 323, 253, 25, 55, 'unwalkable');
  fillTerrainRect(terrain, 288, 288, 60, 20, 'unwalkable');
  fillTerrainRect(terrain, 275, 273, 15, 35, 'unwalkable');
  fillTerrainRect(terrain, 308, 248, 40, 12, 'unwalkable');

  // ========================================
  // NATURAL EXPANSIONS - Elevation 1
  // ========================================

  // Top naturals
  fillTerrainCircle(terrain, 70, 85, 18, 'ground', 1);
  fillTerrainCircle(terrain, 180, 85, 18, 'ground', 1);
  fillTerrainCircle(terrain, 290, 85, 18, 'ground', 1);

  // Bottom naturals
  fillTerrainCircle(terrain, 70, 235, 18, 'ground', 1);
  fillTerrainCircle(terrain, 180, 235, 18, 'ground', 1);
  fillTerrainCircle(terrain, 290, 235, 18, 'ground', 1);

  // Natural chokepoint walls
  fillTerrainRect(terrain, 50, 98, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 82, 98, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 160, 98, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 192, 98, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 270, 98, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 302, 98, 12, 12, 'unwalkable');

  fillTerrainRect(terrain, 50, 210, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 82, 210, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 160, 210, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 192, 210, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 270, 210, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 302, 210, 12, 12, 'unwalkable');

  // ========================================
  // THIRD EXPANSIONS - Elevation 0
  // ========================================

  // Side thirds
  fillTerrainCircle(terrain, 40, 160, 16, 'ground', 0);
  fillTerrainCircle(terrain, 320, 160, 16, 'ground', 0);

  // Mid thirds (between center and naturals)
  fillTerrainCircle(terrain, 120, 130, 14, 'ground', 0);
  fillTerrainCircle(terrain, 240, 130, 14, 'ground', 0);
  fillTerrainCircle(terrain, 120, 190, 14, 'ground', 0);
  fillTerrainCircle(terrain, 240, 190, 14, 'ground', 0);

  // ========================================
  // GOLD EXPANSIONS
  // ========================================
  fillTerrainCircle(terrain, 100, 130, 14, 'ground', 0);
  fillTerrainCircle(terrain, 260, 130, 14, 'ground', 0);
  fillTerrainCircle(terrain, 100, 190, 14, 'ground', 0);
  fillTerrainCircle(terrain, 260, 190, 14, 'ground', 0);

  // ========================================
  // CENTER - Major contested area
  // ========================================
  fillTerrainCircle(terrain, 180, 160, 26, 'ground', 0);
  fillTerrainRect(terrain, 168, 148, 24, 24, 'unwalkable');

  // ========================================
  // TERRAIN FEATURES - Chokepoints
  // ========================================

  // Side cliffs
  fillTerrainCircle(terrain, 70, 160, 12, 'unwalkable');
  fillTerrainCircle(terrain, 290, 160, 12, 'unwalkable');

  // Inner chokepoint cliffs
  fillTerrainCircle(terrain, 130, 160, 10, 'unwalkable');
  fillTerrainCircle(terrain, 230, 160, 10, 'unwalkable');

  // ========================================
  // RAMPS
  // ========================================
  const ramps = [
    // Top row main ramps
    { x: 58, y: 65, width: 10, height: 10, direction: 'south' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 175, y: 65, width: 10, height: 10, direction: 'south' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 302, y: 65, width: 10, height: 10, direction: 'south' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // Bottom row main ramps
    { x: 58, y: 245, width: 10, height: 10, direction: 'north' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 175, y: 245, width: 10, height: 10, direction: 'north' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 302, y: 245, width: 10, height: 10, direction: 'north' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // Natural to low ground ramps
    { x: 70, y: 100, width: 8, height: 8, direction: 'south' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 180, y: 100, width: 8, height: 8, direction: 'south' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 290, y: 100, width: 8, height: 8, direction: 'south' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 70, y: 212, width: 8, height: 8, direction: 'north' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 180, y: 212, width: 8, height: 8, direction: 'north' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 290, y: 212, width: 8, height: 8, direction: 'north' as const, fromElevation: 1 as const, toElevation: 0 as const },
  ];

  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // ========================================
  // EXPANSIONS WITH RESOURCES (uniform 7-unit mineral distance)
  // ========================================
  // Top row mains & naturals (minerals face up/away from center)
  const p1Main = createBaseResources(50, 45, DIR.UP_LEFT, 1800, 2500);
  const p1Nat = createBaseResources(70, 85, DIR.UP_LEFT, 1500, 2500);
  const p2Main = createBaseResources(180, 45, DIR.UP, 1800, 2500);
  const p2Nat = createBaseResources(180, 85, DIR.UP, 1500, 2500);
  const p3Main = createBaseResources(310, 45, DIR.UP_RIGHT, 1800, 2500);
  const p3Nat = createBaseResources(290, 85, DIR.UP_RIGHT, 1500, 2500);
  // Bottom row mains & naturals (minerals face down/away from center)
  const p4Main = createBaseResources(50, 275, DIR.DOWN_LEFT, 1800, 2500);
  const p4Nat = createBaseResources(70, 235, DIR.DOWN_LEFT, 1500, 2500);
  const p5Main = createBaseResources(180, 275, DIR.DOWN, 1800, 2500);
  const p5Nat = createBaseResources(180, 235, DIR.DOWN, 1500, 2500);
  const p6Main = createBaseResources(310, 275, DIR.DOWN_RIGHT, 1800, 2500);
  const p6Nat = createBaseResources(290, 235, DIR.DOWN_RIGHT, 1500, 2500);
  // Third expansions
  const westThird = createBaseResources(40, 160, DIR.LEFT, 1500, 2500);
  const eastThird = createBaseResources(320, 160, DIR.RIGHT, 1500, 2500);
  const midThirdNW = createBaseResources(120, 130, DIR.UP_LEFT, 1500, 2500);
  const midThirdNE = createBaseResources(240, 130, DIR.UP_RIGHT, 1500, 2500);
  const midThirdSW = createBaseResources(120, 190, DIR.DOWN_LEFT, 1500, 2500);
  const midThirdSE = createBaseResources(240, 190, DIR.DOWN_RIGHT, 1500, 2500);
  // Gold expansions
  const goldNW = createBaseResources(100, 130, DIR.UP_LEFT, 1000, 2500);
  const goldNE = createBaseResources(260, 130, DIR.UP_RIGHT, 1000, 2500);
  const goldSW = createBaseResources(100, 190, DIR.DOWN_LEFT, 1000, 2500);
  const goldSE = createBaseResources(260, 190, DIR.DOWN_RIGHT, 1000, 2500);
  // Center
  const center = createBaseResources(180, 160, DIR.DOWN, 750, 2500);

  const expansions = [
    { name: 'P1 Main', x: 50, y: 45, isMain: true, ...p1Main },
    { name: 'P1 Natural', x: 70, y: 85, isNatural: true, ...p1Nat },
    { name: 'P2 Main', x: 180, y: 45, isMain: true, ...p2Main },
    { name: 'P2 Natural', x: 180, y: 85, isNatural: true, ...p2Nat },
    { name: 'P3 Main', x: 310, y: 45, isMain: true, ...p3Main },
    { name: 'P3 Natural', x: 290, y: 85, isNatural: true, ...p3Nat },
    { name: 'P4 Main', x: 50, y: 275, isMain: true, ...p4Main },
    { name: 'P4 Natural', x: 70, y: 235, isNatural: true, ...p4Nat },
    { name: 'P5 Main', x: 180, y: 275, isMain: true, ...p5Main },
    { name: 'P5 Natural', x: 180, y: 235, isNatural: true, ...p5Nat },
    { name: 'P6 Main', x: 310, y: 275, isMain: true, ...p6Main },
    { name: 'P6 Natural', x: 290, y: 235, isNatural: true, ...p6Nat },
    { name: 'West Third', x: 40, y: 160, ...westThird },
    { name: 'East Third', x: 320, y: 160, ...eastThird },
    { name: 'Mid Third NW', x: 120, y: 130, ...midThirdNW },
    { name: 'Mid Third NE', x: 240, y: 130, ...midThirdNE },
    { name: 'Mid Third SW', x: 120, y: 190, ...midThirdSW },
    { name: 'Mid Third SE', x: 240, y: 190, ...midThirdSE },
    { name: 'Gold NW', x: 100, y: 130, ...goldNW },
    { name: 'Gold NE', x: 260, y: 130, ...goldNE },
    { name: 'Gold SW', x: 100, y: 190, ...goldSW },
    { name: 'Gold SE', x: 260, y: 190, ...goldSE },
    { name: 'Center', x: 180, y: 160, ...center },
  ];

  return {
    id: 'contested_frontier',
    name: 'Contested Frontier',
    author: 'VOIDSTRIKE Team',
    description: 'A 6-player map designed for 3v3 team games. Two rows of players face off across a contested center with multiple expansion paths.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    spawns: [
      { x: 50, y: 45, playerSlot: 1, rotation: Math.PI / 2 },
      { x: 180, y: 45, playerSlot: 2, rotation: Math.PI / 2 },
      { x: 310, y: 45, playerSlot: 3, rotation: Math.PI / 2 },
      { x: 50, y: 275, playerSlot: 4, rotation: -Math.PI / 2 },
      { x: 180, y: 275, playerSlot: 5, rotation: -Math.PI / 2 },
      { x: 310, y: 275, playerSlot: 6, rotation: -Math.PI / 2 },
    ],

    expansions,

    watchTowers: [
      { x: 180, y: 160, radius: 28 },
      { x: 100, y: 160, radius: 20 },
      { x: 260, y: 160, radius: 20 },
      { x: 180, y: 115, radius: 18 },
      { x: 180, y: 205, radius: 18 },
    ],

    ramps,

    destructibles: [
      { x: 130, y: 160, health: 2000 },
      { x: 230, y: 160, health: 2000 },
      { x: 115, y: 130, health: 1500 },
      { x: 245, y: 130, health: 1500 },
      { x: 115, y: 190, health: 1500 },
      { x: 245, y: 190, health: 1500 },
    ],

    decorations: generateJungleDecorations(),

    playerCount: 6,
    maxPlayers: 6,
    isRanked: true,

    biome: 'jungle',
    fogNear: 110,
    fogFar: 350,
  };
}

export const CONTESTED_FRONTIER = generateContestedFrontier();

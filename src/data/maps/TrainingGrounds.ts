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
 * TRAINING GROUNDS - SC2-Style Professional Map
 *
 * A high-quality 1v1 map featuring:
 * - Elevated main bases with cliff edges and wide ramps
 * - Natural expansions with choke points
 * - Strategic third/fourth expansion locations
 * - Central contested gold base
 * - Water features blocking certain paths
 * - Dense forest and rock decorations
 * - Multiple elevation levels creating depth
 * - Watch towers at key control points
 */

const MAP_WIDTH = 200;
const MAP_HEIGHT = 200;

// Seeded random for consistent map generation
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// Base/spawn locations with exclusion radius - NO decorations in these areas
const BASE_EXCLUSION_ZONES = [
  { x: 165, y: 165, radius: 20 }, // P1 main
  { x: 35, y: 35, radius: 20 },   // P2 main
  { x: 112, y: 162, radius: 16 }, // P1 natural
  { x: 88, y: 38, radius: 16 },   // P2 natural
  { x: 48, y: 115, radius: 14 },  // P1 third
  { x: 152, y: 85, radius: 14 },  // P2 third
  { x: 48, y: 178, radius: 14 },  // P1 fourth
  { x: 152, y: 22, radius: 14 },  // P2 fourth
  { x: 100, y: 100, radius: 14 }, // Gold base center
];

// Check if a position is inside any base area
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

// Generate massively enhanced decorations (2x density)
function generateDecorations(): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(42);

  // Helper to add tree cluster with DOUBLED density - skips base areas
  const addTreeCluster = (cx: number, cy: number, count: number, spread: number, density = 2) => {
    const treeTypes: Array<'tree_pine_tall' | 'tree_pine_medium' | 'tree_dead'> = [
      'tree_pine_tall', 'tree_pine_medium', 'tree_dead'
    ];
    for (let i = 0; i < count * density; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;

      // Skip decorations in base areas
      if (isInBaseArea(x, y)) continue;

      decorations.push({
        type: treeTypes[Math.floor(rand() * treeTypes.length)],
        x, y,
        scale: 0.5 + rand() * 0.9,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Helper to add rock cluster with DOUBLED density - skips base areas
  const addRockCluster = (cx: number, cy: number, count: number, spread: number) => {
    const rockTypes: Array<'rocks_large' | 'rocks_small' | 'rock_single'> = [
      'rocks_large', 'rocks_small', 'rock_single'
    ];
    for (let i = 0; i < count * 2; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;

      // Skip decorations in base areas
      if (isInBaseArea(x, y)) continue;

      decorations.push({
        type: rockTypes[Math.floor(rand() * rockTypes.length)],
        x, y,
        scale: 0.3 + rand() * 1.2,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Helper to add mixed vegetation line - skips base areas
  const addVegetationLine = (x1: number, y1: number, x2: number, y2: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = x1 + (x2 - x1) * t + (rand() - 0.5) * 6;
      const y = y1 + (y2 - y1) * t + (rand() - 0.5) * 6;

      // Skip decorations in base areas
      if (isInBaseArea(x, y)) continue;

      if (rand() > 0.3) {
        decorations.push({
          type: rand() > 0.5 ? 'tree_pine_tall' : 'tree_pine_medium',
          x, y,
          scale: 0.5 + rand() * 0.8,
          rotation: rand() * Math.PI * 2,
        });
      } else {
        decorations.push({
          type: rand() > 0.5 ? 'rocks_large' : 'rocks_small',
          x, y,
          scale: 0.4 + rand() * 0.8,
          rotation: rand() * Math.PI * 2,
        });
      }
    }
  };

  // Helper to add crystal formations - skips base areas
  const addCrystalCluster = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;

      // Skip decorations in base areas
      if (isInBaseArea(x, y)) continue;

      decorations.push({
        type: 'crystal_formation',
        x, y,
        scale: 0.4 + rand() * 0.8,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // ========================================
  // MAP BORDER DECORATIONS (VERY DENSE)
  // ========================================

  // Top border - triple density trees and rocks
  for (let x = 14; x < 186; x += 6) {
    addTreeCluster(x, 13, 6, 5, 2.5);
    addRockCluster(x + 3, 11, 4, 4);
  }

  // Bottom border
  for (let x = 14; x < 186; x += 6) {
    addTreeCluster(x, 187, 6, 5, 2.5);
    addRockCluster(x + 3, 189, 4, 4);
  }

  // Left border
  for (let y = 14; y < 186; y += 6) {
    addTreeCluster(13, y, 6, 5, 2.5);
    addRockCluster(11, y + 3, 4, 4);
  }

  // Right border
  for (let y = 14; y < 186; y += 6) {
    addTreeCluster(187, y, 6, 5, 2.5);
    addRockCluster(189, y + 3, 4, 4);
  }

  // ========================================
  // MAIN BASE CLIFF DECORATIONS
  // ========================================

  // P1 main (bottom-right) - dense cliff edge coverage
  addVegetationLine(145, 185, 185, 145, 30);
  addTreeCluster(150, 178, 12, 8);
  addTreeCluster(178, 150, 12, 8);
  addTreeCluster(160, 168, 10, 6);
  addTreeCluster(168, 160, 10, 6);
  addRockCluster(155, 172, 8, 5);
  addRockCluster(172, 155, 8, 5);

  // P2 main (top-left) - dense cliff edge coverage
  addVegetationLine(15, 55, 55, 15, 30);
  addTreeCluster(22, 50, 12, 8);
  addTreeCluster(50, 22, 12, 8);
  addTreeCluster(32, 40, 10, 6);
  addTreeCluster(40, 32, 10, 6);
  addRockCluster(28, 45, 8, 5);
  addRockCluster(45, 28, 8, 5);

  // ========================================
  // CENTRAL CLIFF WALLS (CHOKEPOINTS)
  // ========================================

  // Central diagonal cliffs - heavy decoration
  addTreeCluster(65, 65, 18, 10);
  addRockCluster(70, 60, 10, 7);
  addRockCluster(60, 70, 10, 7);
  addCrystalCluster(65, 65, 6, 6);

  addTreeCluster(135, 135, 18, 10);
  addRockCluster(130, 140, 10, 7);
  addRockCluster(140, 130, 10, 7);
  addCrystalCluster(135, 135, 6, 6);

  // Side chokepoint cliffs
  addTreeCluster(38, 88, 14, 8);
  addRockCluster(42, 82, 8, 6);
  addTreeCluster(162, 112, 14, 8);
  addRockCluster(158, 118, 8, 6);

  // Additional path-narrowing cliffs
  addTreeCluster(78, 138, 10, 6);
  addRockCluster(72, 132, 6, 5);
  addTreeCluster(122, 62, 10, 6);
  addRockCluster(128, 68, 6, 5);

  // ========================================
  // WATER EDGE DECORATIONS
  // ========================================

  // Water areas get special crystal/rock treatment
  addCrystalCluster(22, 178, 10, 8);
  addRockCluster(28, 172, 8, 6);
  addTreeCluster(18, 168, 8, 6);

  addCrystalCluster(178, 22, 10, 8);
  addRockCluster(172, 28, 8, 6);
  addTreeCluster(182, 32, 8, 6);

  // ========================================
  // EXPANSION AREA DECORATIONS
  // ========================================

  // Natural expansion surroundings
  addTreeCluster(92, 168, 10, 6);
  addTreeCluster(108, 32, 10, 6);
  addRockCluster(128, 152, 6, 5);
  addRockCluster(72, 48, 6, 5);

  // Third expansion surroundings - heavy coverage
  addTreeCluster(38, 108, 12, 7);
  addTreeCluster(38, 122, 12, 7);
  addRockCluster(45, 115, 8, 6);
  addTreeCluster(162, 78, 12, 7);
  addTreeCluster(162, 92, 12, 7);
  addRockCluster(155, 85, 8, 6);

  // Fourth expansion surroundings
  addTreeCluster(38, 178, 10, 6);
  addTreeCluster(162, 22, 10, 6);
  addRockCluster(45, 172, 6, 4);
  addRockCluster(155, 28, 6, 4);

  // ========================================
  // PATH DECORATIONS (SCATTERED)
  // ========================================

  // Main paths - scattered rocks and occasional trees
  addRockCluster(100, 75, 5, 6);
  addRockCluster(100, 125, 5, 6);
  addRockCluster(75, 100, 5, 6);
  addRockCluster(125, 100, 5, 6);

  // Diagonal paths
  addRockCluster(85, 85, 4, 5);
  addRockCluster(115, 115, 4, 5);
  addRockCluster(85, 115, 4, 5);
  addRockCluster(115, 85, 4, 5);

  // ========================================
  // CHOKE POINT SPECIAL DECORATIONS
  // ========================================

  // Ramp approaches - rocks for cover
  addRockCluster(132, 158, 8, 5);
  addRockCluster(68, 42, 8, 5);

  // Natural choke points
  addRockCluster(98, 148, 6, 4);
  addRockCluster(102, 52, 6, 4);

  // Center control area
  addCrystalCluster(100, 100, 8, 6);
  addRockCluster(92, 108, 5, 4);
  addRockCluster(108, 92, 5, 4);

  // ========================================
  // GRASS AND BUSHES (FILL - VERY DENSE)
  // ========================================

  // Scatter vegetation across entire map - uses base exclusion check
  for (let i = 0; i < 200; i++) {
    const x = 20 + rand() * 160;
    const y = 20 + rand() * 160;

    // Skip all base areas using the unified check
    if (isInBaseArea(x, y)) continue;

    const type = rand() > 0.4 ? 'bush' : 'grass_clump';
    decorations.push({
      type,
      x, y,
      scale: 0.5 + rand() * 0.6,
      rotation: rand() * Math.PI * 2,
    });
  }

  // ========================================
  // DEBRIS AND SPECIAL OBJECTS
  // ========================================

  // Debris near destructible rocks
  decorations.push({ type: 'debris', x: 58, y: 142, scale: 1.3 });
  decorations.push({ type: 'debris', x: 62, y: 138, scale: 1.0 });
  decorations.push({ type: 'debris', x: 142, y: 58, scale: 1.3 });
  decorations.push({ type: 'debris', x: 138, y: 62, scale: 1.0 });

  // Center debris
  decorations.push({ type: 'debris', x: 88, y: 78, scale: 0.9 });
  decorations.push({ type: 'debris', x: 112, y: 122, scale: 0.9 });

  // Escape pods in corners (easter eggs)
  decorations.push({ type: 'escape_pod', x: 14, y: 186, scale: 1.1, rotation: 0.5 });
  decorations.push({ type: 'escape_pod', x: 186, y: 14, scale: 1.1, rotation: 2.5 });

  // Additional escape pods near water
  decorations.push({ type: 'escape_pod', x: 26, y: 174, scale: 0.9, rotation: 1.2 });
  decorations.push({ type: 'escape_pod', x: 174, y: 26, scale: 0.9, rotation: 4.0 });

  return decorations;
}

function generateTrainingGrounds(): MapData {
  // Start with low ground (elevation 0)
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // ========================================
  // MAP BORDERS - Thick unwalkable cliffs
  // ========================================
  fillTerrainRect(terrain, 0, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 12, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 12, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 12, MAP_WIDTH, 12, 'unwalkable');

  // ========================================
  // MAIN BASES - Elevated plateaus (elevation 2)
  // ========================================

  // P1 Main (bottom-right) - Large plateau
  fillTerrainRect(terrain, 138, 138, 50, 50, 'ground', 2);
  // Cliff walls around P1 main (leave ramp opening)
  fillTerrainRect(terrain, 138, 138, 10, 42, 'unwalkable');
  fillTerrainRect(terrain, 138, 138, 42, 10, 'unwalkable');
  // Ramp approach area
  fillTerrainRect(terrain, 138, 152, 10, 24, 'ground', 2);

  // P2 Main (top-left) - Large plateau
  fillTerrainRect(terrain, 12, 12, 50, 50, 'ground', 2);
  // Cliff walls around P2 main (leave ramp opening)
  fillTerrainRect(terrain, 52, 12, 10, 42, 'unwalkable');
  fillTerrainRect(terrain, 12, 52, 42, 10, 'unwalkable');
  // Ramp approach area
  fillTerrainRect(terrain, 52, 24, 10, 24, 'ground', 2);

  // ========================================
  // NATURAL EXPANSIONS - Medium elevation (1)
  // ========================================

  // P1 Natural (west of main)
  fillTerrainCircle(terrain, 112, 162, 24, 'ground', 1);
  fillTerrainRect(terrain, 88, 152, 18, 22, 'ground', 1);

  // P2 Natural (east of main)
  fillTerrainCircle(terrain, 88, 38, 24, 'ground', 1);
  fillTerrainRect(terrain, 94, 26, 18, 22, 'ground', 1);

  // ========================================
  // THIRD EXPANSIONS - Low ground with cover
  // ========================================

  // P1 Third (west side)
  fillTerrainCircle(terrain, 48, 115, 20, 'ground', 0);

  // P2 Third (east side)
  fillTerrainCircle(terrain, 152, 85, 20, 'ground', 0);

  // ========================================
  // FOURTH EXPANSIONS - Edge locations
  // ========================================

  // P1 Fourth (bottom-left corner area)
  fillTerrainCircle(terrain, 48, 178, 16, 'ground', 0);

  // P2 Fourth (top-right corner area)
  fillTerrainCircle(terrain, 152, 22, 16, 'ground', 0);

  // ========================================
  // GOLD EXPANSION - Center contested
  // ========================================
  fillTerrainCircle(terrain, 100, 100, 18, 'ground', 0);

  // ========================================
  // CLIFF WALLS - Create chokepoints and paths
  // ========================================

  // Central diagonal cliffs (major path dividers)
  fillTerrainCircle(terrain, 62, 62, 16, 'unwalkable');
  fillTerrainCircle(terrain, 138, 138, 16, 'unwalkable');

  // Side chokepoint cliffs
  fillTerrainCircle(terrain, 38, 90, 12, 'unwalkable');
  fillTerrainCircle(terrain, 162, 110, 12, 'unwalkable');

  // Additional path-narrowing cliffs
  fillTerrainCircle(terrain, 75, 140, 10, 'unwalkable');
  fillTerrainCircle(terrain, 125, 60, 10, 'unwalkable');

  // Corner blocking cliffs
  fillTerrainCircle(terrain, 22, 178, 14, 'unwalkable');
  fillTerrainCircle(terrain, 178, 22, 14, 'unwalkable');

  // Medium elevation ridge for path variety (elevation 1)
  fillTerrainRect(terrain, 70, 90, 12, 20, 'ground', 1);
  fillTerrainRect(terrain, 118, 90, 12, 20, 'ground', 1);

  // ========================================
  // WATER FEATURES - Impassable decorative areas
  // ========================================

  // Water ponds in corners (using unwalkable terrain)
  // These create natural barriers and visual interest
  fillTerrainCircle(terrain, 20, 180, 8, 'unbuildable');
  fillTerrainCircle(terrain, 180, 20, 8, 'unbuildable');

  // ========================================
  // RAMPS - Wide natural transitions
  // ========================================
  const ramps = [
    // P1 main ramp (wide entry)
    {
      x: 134,
      y: 155,
      width: 16,
      height: 12,
      direction: 'west' as const,
      fromElevation: 2 as const,
      toElevation: 1 as const,
    },
    // P1 natural to low ground
    {
      x: 85,
      y: 158,
      width: 14,
      height: 10,
      direction: 'west' as const,
      fromElevation: 1 as const,
      toElevation: 0 as const,
    },
    // P2 main ramp (wide entry)
    {
      x: 50,
      y: 33,
      width: 16,
      height: 12,
      direction: 'east' as const,
      fromElevation: 2 as const,
      toElevation: 1 as const,
    },
    // P2 natural to low ground
    {
      x: 101,
      y: 32,
      width: 14,
      height: 10,
      direction: 'east' as const,
      fromElevation: 1 as const,
      toElevation: 0 as const,
    },
    // Side ridges ramps
    {
      x: 70,
      y: 88,
      width: 10,
      height: 8,
      direction: 'north' as const,
      fromElevation: 1 as const,
      toElevation: 0 as const,
    },
    {
      x: 120,
      y: 104,
      width: 10,
      height: 8,
      direction: 'south' as const,
      fromElevation: 1 as const,
      toElevation: 0 as const,
    },
  ];

  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // ========================================
  // EXPANSIONS WITH RESOURCES
  // ========================================
  const expansions = [
    // P1 Main
    {
      name: 'P1 Main',
      x: 165,
      y: 165,
      isMain: true,
      minerals: createMineralLine(175, 175, 165, 165, 1800),
      vespene: createVespeneGeysers(175, 175, 165, 165, 2500),
    },
    // P1 Natural
    {
      name: 'P1 Natural',
      x: 112,
      y: 162,
      isNatural: true,
      minerals: createMineralLine(112, 175, 112, 162, 1500),
      vespene: createVespeneGeysers(112, 175, 112, 162, 2500),
    },
    // P1 Third
    {
      name: 'P1 Third',
      x: 48,
      y: 115,
      minerals: createMineralLine(35, 115, 48, 115, 1500),
      vespene: createVespeneGeysers(35, 115, 48, 115, 2500),
    },
    // P1 Fourth
    {
      name: 'P1 Fourth',
      x: 48,
      y: 178,
      minerals: createMineralLine(35, 178, 48, 178, 1200),
      vespene: createVespeneGeysers(35, 178, 48, 178, 2500),
    },

    // P2 Main
    {
      name: 'P2 Main',
      x: 35,
      y: 35,
      isMain: true,
      minerals: createMineralLine(25, 25, 35, 35, 1800),
      vespene: createVespeneGeysers(25, 25, 35, 35, 2500),
    },
    // P2 Natural
    {
      name: 'P2 Natural',
      x: 88,
      y: 38,
      isNatural: true,
      minerals: createMineralLine(88, 25, 88, 38, 1500),
      vespene: createVespeneGeysers(88, 25, 88, 38, 2500),
    },
    // P2 Third
    {
      name: 'P2 Third',
      x: 152,
      y: 85,
      minerals: createMineralLine(165, 85, 152, 85, 1500),
      vespene: createVespeneGeysers(165, 85, 152, 85, 2500),
    },
    // P2 Fourth
    {
      name: 'P2 Fourth',
      x: 152,
      y: 22,
      minerals: createMineralLine(165, 22, 152, 22, 1200),
      vespene: createVespeneGeysers(165, 22, 152, 22, 2500),
    },

    // Gold base (center)
    {
      name: 'Gold Base',
      x: 100,
      y: 100,
      minerals: createMineralLine(86, 100, 100, 100, 1000),
      vespene: createVespeneGeysers(86, 100, 100, 100, 2500),
    },
  ];

  return {
    id: 'training_grounds',
    name: 'Training Grounds',
    author: 'VOIDSTRIKE Team',
    description: 'A professional 1v1 map with elevated bases, natural chokes, water features, and strategic expansion options.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    spawns: [
      { x: 165, y: 165, playerSlot: 1, rotation: Math.PI * 5 / 4 },
      { x: 35, y: 35, playerSlot: 2, rotation: Math.PI / 4 },
      { x: 112, y: 162, playerSlot: 3, rotation: Math.PI * 3 / 2 },
      { x: 88, y: 38, playerSlot: 4, rotation: Math.PI / 2 },
      { x: 48, y: 115, playerSlot: 5, rotation: Math.PI },
      { x: 152, y: 85, playerSlot: 6, rotation: 0 },
      { x: 48, y: 178, playerSlot: 7, rotation: Math.PI * 3 / 2 },
      { x: 152, y: 22, playerSlot: 8, rotation: Math.PI / 2 },
    ],

    expansions,

    watchTowers: [
      { x: 100, y: 100, radius: 22 },  // Center - primary control
      { x: 62, y: 138, radius: 16 },   // P1 side
      { x: 138, y: 62, radius: 16 },   // P2 side
      { x: 78, y: 78, radius: 14 },    // Mid-diagonal
      { x: 122, y: 122, radius: 14 },  // Mid-diagonal
    ],

    ramps,

    destructibles: [
      // Backdoor rocks
      { x: 58, y: 142, health: 2000 },
      { x: 142, y: 58, health: 2000 },
      // Center control rocks
      { x: 88, y: 78, health: 1500 },
      { x: 112, y: 122, health: 1500 },
      // Side path rocks
      { x: 55, y: 100, health: 1200 },
      { x: 145, y: 100, health: 1200 },
    ],

    decorations: generateDecorations(),

    maxPlayers: 8,
    isRanked: true,

    biome: 'grassland',
    fogNear: 100,
    fogFar: 280,
  };
}

export const TRAINING_GROUNDS = generateTrainingGrounds();

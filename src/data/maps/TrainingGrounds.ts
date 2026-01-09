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
 * TRAINING GROUNDS - SC2-Style Map
 *
 * A professional-quality 1v1 map with:
 * - Elevated main bases with cliff edges and single ramp entry
 * - Natural expansions at medium elevation with choke points
 * - Third/fourth expansions in contested areas
 * - Strategic watch towers and destructible rocks
 * - Dense decorations creating atmosphere
 * - Clear pathing corridors with cliff walls
 *
 * Layout (200x200):
 *
 *        [Cliff Wall]──────────────────────[Cliff Wall]
 *              │                                  │
 *         [P2 Main]                          [P2 4th]
 *           ║ ramp                              │
 *      [P2 Natural]──[Choke]──[Center]──[Choke]─┘
 *              │         │        │
 *         [3rd Exp]  [Watchtower] [3rd Exp]
 *              │         │        │
 *      ┌─[Choke]──[Center]──[Choke]──[P1 Natural]
 *      │                              ║ ramp
 *   [P1 4th]                      [P1 Main]
 *      │                                  │
 *   [Cliff Wall]──────────────────────[Cliff Wall]
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

// Generate comprehensive decorations
function generateDecorations(): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(42); // Consistent seed

  // Helper to add tree cluster
  const addTreeCluster = (cx: number, cy: number, count: number, spread: number, density = 1) => {
    const treeTypes: Array<'tree_pine_tall' | 'tree_pine_medium' | 'tree_dead'> = [
      'tree_pine_tall', 'tree_pine_medium', 'tree_dead'
    ];
    for (let i = 0; i < count * density; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      decorations.push({
        type: treeTypes[Math.floor(rand() * treeTypes.length)],
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        scale: 0.6 + rand() * 0.8,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Helper to add rock cluster
  const addRockCluster = (cx: number, cy: number, count: number, spread: number) => {
    const rockTypes: Array<'rocks_large' | 'rocks_small' | 'rock_single'> = [
      'rocks_large', 'rocks_small', 'rock_single'
    ];
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      decorations.push({
        type: rockTypes[Math.floor(rand() * rockTypes.length)],
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        scale: 0.4 + rand() * 1.0,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Helper to add rocks along cliff edge
  const addCliffEdgeRocks = (x1: number, y1: number, x2: number, y2: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const t = rand();
      const x = x1 + (x2 - x1) * t + (rand() - 0.5) * 4;
      const y = y1 + (y2 - y1) * t + (rand() - 0.5) * 4;
      decorations.push({
        type: rand() > 0.7 ? 'rocks_large' : 'rocks_small',
        x, y,
        scale: 0.5 + rand() * 0.8,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // === DENSE CLIFF EDGE DECORATIONS ===

  // Map border cliffs - heavy tree/rock coverage
  // Top border
  for (let x = 15; x < 185; x += 12) {
    addTreeCluster(x, 14, 5, 4, 1.5);
    addRockCluster(x + 6, 12, 3, 3);
  }

  // Bottom border
  for (let x = 15; x < 185; x += 12) {
    addTreeCluster(x, 186, 5, 4, 1.5);
    addRockCluster(x + 6, 188, 3, 3);
  }

  // Left border
  for (let y = 15; y < 185; y += 12) {
    addTreeCluster(14, y, 5, 4, 1.5);
    addRockCluster(12, y + 6, 3, 3);
  }

  // Right border
  for (let y = 15; y < 185; y += 12) {
    addTreeCluster(186, y, 5, 4, 1.5);
    addRockCluster(188, y + 6, 3, 3);
  }

  // === CLIFF WALLS BETWEEN AREAS ===

  // P1 main cliff edges (bottom-right elevated area)
  addCliffEdgeRocks(145, 180, 180, 145, 15);
  addTreeCluster(150, 175, 8, 6);
  addTreeCluster(175, 150, 8, 6);
  addTreeCluster(185, 165, 6, 4);
  addTreeCluster(165, 185, 6, 4);

  // P2 main cliff edges (top-left elevated area)
  addCliffEdgeRocks(20, 55, 55, 20, 15);
  addTreeCluster(25, 50, 8, 6);
  addTreeCluster(50, 25, 8, 6);
  addTreeCluster(15, 35, 6, 4);
  addTreeCluster(35, 15, 6, 4);

  // Central dividing cliffs
  addTreeCluster(70, 70, 12, 8);
  addRockCluster(65, 75, 6, 5);
  addTreeCluster(130, 130, 12, 8);
  addRockCluster(135, 125, 6, 5);

  // Cliff walls creating main corridors
  addTreeCluster(45, 90, 10, 6);
  addRockCluster(40, 95, 5, 4);
  addTreeCluster(155, 110, 10, 6);
  addRockCluster(160, 105, 5, 4);

  // === EXPANSION AREA DECORATIONS ===

  // Natural expansion edges
  addTreeCluster(95, 165, 6, 4);
  addTreeCluster(105, 35, 6, 4);
  addRockCluster(130, 150, 4, 3);
  addRockCluster(70, 50, 4, 3);

  // Third expansion surroundings
  addTreeCluster(45, 100, 8, 5);
  addTreeCluster(155, 100, 8, 5);
  addRockCluster(50, 110, 4, 3);
  addRockCluster(150, 90, 4, 3);

  // Fourth expansion surroundings
  addTreeCluster(95, 180, 6, 4);
  addTreeCluster(105, 20, 6, 4);

  // === PATH DECORATIONS ===

  // Scattered rocks along main paths
  addRockCluster(100, 80, 3, 4);
  addRockCluster(100, 120, 3, 4);
  addRockCluster(80, 100, 3, 4);
  addRockCluster(120, 100, 3, 4);

  // === CHOKE POINT DECORATIONS ===

  // Chokes near naturals
  addRockCluster(105, 145, 5, 4);
  addRockCluster(95, 55, 5, 4);

  // Central chokes
  addRockCluster(85, 85, 4, 3);
  addRockCluster(115, 115, 4, 3);

  // === GRASS AND BUSHES IN OPEN AREAS ===

  // Scattered vegetation
  for (let i = 0; i < 80; i++) {
    const x = 25 + rand() * 150;
    const y = 25 + rand() * 150;

    // Skip base areas
    if ((x > 145 && y > 145) || (x < 55 && y < 55)) continue;
    // Skip mineral lines
    if (Math.abs(x - 170) < 15 && Math.abs(y - 170) < 15) continue;
    if (Math.abs(x - 30) < 15 && Math.abs(y - 30) < 15) continue;

    decorations.push({
      type: rand() > 0.5 ? 'bush' : 'grass_clump',
      x, y,
      scale: 0.6 + rand() * 0.5,
      rotation: rand() * Math.PI * 2,
    });
  }

  // === DEBRIS AND SPECIAL ===

  // Debris near destructible rocks
  decorations.push({ type: 'debris', x: 62, y: 138, scale: 1.2 });
  decorations.push({ type: 'debris', x: 138, y: 62, scale: 1.2 });
  decorations.push({ type: 'debris', x: 85, y: 75, scale: 0.9 });
  decorations.push({ type: 'debris', x: 115, y: 125, scale: 0.9 });

  // Escape pod easter eggs
  decorations.push({ type: 'escape_pod', x: 15, y: 185, scale: 1, rotation: 0.5 });
  decorations.push({ type: 'escape_pod', x: 185, y: 15, scale: 1, rotation: 2.5 });

  return decorations;
}

function generateTrainingGrounds(): MapData {
  // Start with low ground (elevation 0)
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // === MAP BORDER - Thick unwalkable cliffs ===
  fillTerrainRect(terrain, 0, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 12, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 12, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 12, MAP_WIDTH, 12, 'unwalkable');

  // === MAIN BASES - Large elevated plateaus (elevation 2) ===

  // P1 Main (bottom-right) - Large plateau with cliff edges
  fillTerrainRect(terrain, 140, 140, 48, 48, 'ground', 2);
  // Cliff edges around P1 main
  fillTerrainRect(terrain, 140, 140, 8, 48, 'unwalkable'); // West cliff wall
  fillTerrainRect(terrain, 140, 140, 48, 8, 'unwalkable'); // North cliff wall
  // Leave opening for ramp area
  fillTerrainRect(terrain, 140, 155, 8, 20, 'ground', 2); // Ramp approach

  // P2 Main (top-left) - Large plateau with cliff edges
  fillTerrainRect(terrain, 12, 12, 48, 48, 'ground', 2);
  // Cliff edges around P2 main
  fillTerrainRect(terrain, 52, 12, 8, 48, 'unwalkable'); // East cliff wall
  fillTerrainRect(terrain, 12, 52, 48, 8, 'unwalkable'); // South cliff wall
  // Leave opening for ramp area
  fillTerrainRect(terrain, 52, 25, 8, 20, 'ground', 2); // Ramp approach

  // === NATURAL EXPANSIONS - Medium elevation plateaus ===

  // P1 Natural (west of main, elevation 1)
  fillTerrainCircle(terrain, 115, 160, 22, 'ground', 1);
  // Connect to low ground path
  fillTerrainRect(terrain, 90, 150, 15, 20, 'ground', 1);

  // P2 Natural (east of main, elevation 1)
  fillTerrainCircle(terrain, 85, 40, 22, 'ground', 1);
  // Connect to low ground path
  fillTerrainRect(terrain, 95, 30, 15, 20, 'ground', 1);

  // === THIRD EXPANSIONS - Low ground with some cover ===

  // P1 Third (west side)
  fillTerrainCircle(terrain, 50, 115, 18, 'ground', 0);

  // P2 Third (east side)
  fillTerrainCircle(terrain, 150, 85, 18, 'ground', 0);

  // === FOURTH EXPANSIONS - Contested edges ===

  // P1 Fourth (bottom-left area)
  fillTerrainCircle(terrain, 50, 175, 15, 'ground', 0);

  // P2 Fourth (top-right area)
  fillTerrainCircle(terrain, 150, 25, 15, 'ground', 0);

  // === GOLD EXPANSION - Center, heavily contested ===
  fillTerrainCircle(terrain, 100, 100, 16, 'ground', 0);

  // === CLIFF WALLS - Create paths and choke points ===

  // Central diagonal cliffs - create winding paths
  fillTerrainCircle(terrain, 65, 65, 14, 'unwalkable');
  fillTerrainCircle(terrain, 135, 135, 14, 'unwalkable');

  // Side cliffs - narrow the map paths
  fillTerrainCircle(terrain, 40, 85, 10, 'unwalkable');
  fillTerrainCircle(terrain, 160, 115, 10, 'unwalkable');

  // Additional cliffs for path variety
  fillTerrainCircle(terrain, 75, 135, 8, 'unwalkable');
  fillTerrainCircle(terrain, 125, 65, 8, 'unwalkable');

  // Corner blocking cliffs
  fillTerrainCircle(terrain, 25, 175, 12, 'unwalkable');
  fillTerrainCircle(terrain, 175, 25, 12, 'unwalkable');

  // === RAMPS - Wide, natural-looking transitions ===
  const ramps = [
    // P1 main ramp (from main down to natural area) - wider for better gameplay
    {
      x: 138,
      y: 155,
      width: 14,
      height: 10,
      direction: 'west' as const,
      fromElevation: 2 as const,
      toElevation: 1 as const,
    },
    // P1 natural to low ground
    {
      x: 88,
      y: 155,
      width: 12,
      height: 10,
      direction: 'west' as const,
      fromElevation: 1 as const,
      toElevation: 0 as const,
    },
    // P2 main ramp (from main down to natural area)
    {
      x: 48,
      y: 35,
      width: 14,
      height: 10,
      direction: 'east' as const,
      fromElevation: 2 as const,
      toElevation: 1 as const,
    },
    // P2 natural to low ground
    {
      x: 100,
      y: 35,
      width: 12,
      height: 10,
      direction: 'east' as const,
      fromElevation: 1 as const,
      toElevation: 0 as const,
    },
  ];

  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // === EXPANSIONS WITH RESOURCES ===
  const expansions = [
    // P1 Main (CC at 165, 165)
    {
      name: 'P1 Main',
      x: 165,
      y: 165,
      isMain: true,
      minerals: createMineralLine(175, 175, 165, 165, 1800),
      vespene: createVespeneGeysers(175, 175, 165, 165, 2500),
    },
    // P1 Natural (CC at 115, 160)
    {
      name: 'P1 Natural',
      x: 115,
      y: 160,
      isNatural: true,
      minerals: createMineralLine(115, 172, 115, 160, 1500),
      vespene: createVespeneGeysers(115, 172, 115, 160, 2500),
    },
    // P1 Third (CC at 50, 115)
    {
      name: 'P1 Third',
      x: 50,
      y: 115,
      minerals: createMineralLine(38, 115, 50, 115, 1500),
      vespene: createVespeneGeysers(38, 115, 50, 115, 2500),
    },
    // P1 Fourth (CC at 50, 175)
    {
      name: 'P1 Fourth',
      x: 50,
      y: 175,
      minerals: createMineralLine(38, 175, 50, 175, 1200),
      vespene: createVespeneGeysers(38, 175, 50, 175, 2500),
    },

    // P2 Main (CC at 35, 35)
    {
      name: 'P2 Main',
      x: 35,
      y: 35,
      isMain: true,
      minerals: createMineralLine(25, 25, 35, 35, 1800),
      vespene: createVespeneGeysers(25, 25, 35, 35, 2500),
    },
    // P2 Natural (CC at 85, 40)
    {
      name: 'P2 Natural',
      x: 85,
      y: 40,
      isNatural: true,
      minerals: createMineralLine(85, 28, 85, 40, 1500),
      vespene: createVespeneGeysers(85, 28, 85, 40, 2500),
    },
    // P2 Third (CC at 150, 85)
    {
      name: 'P2 Third',
      x: 150,
      y: 85,
      minerals: createMineralLine(162, 85, 150, 85, 1500),
      vespene: createVespeneGeysers(162, 85, 150, 85, 2500),
    },
    // P2 Fourth (CC at 150, 25)
    {
      name: 'P2 Fourth',
      x: 150,
      y: 25,
      minerals: createMineralLine(162, 25, 150, 25, 1200),
      vespene: createVespeneGeysers(162, 25, 150, 25, 2500),
    },

    // Gold base (center)
    {
      name: 'Gold Base',
      x: 100,
      y: 100,
      minerals: createMineralLine(88, 100, 100, 100, 1000),
      vespene: createVespeneGeysers(88, 100, 100, 100, 2500),
    },
  ];

  return {
    id: 'training_grounds',
    name: 'Training Grounds',
    author: 'VOIDSTRIKE Team',
    description: 'A balanced 1v1 map with elevated main bases, defensible naturals, and strategic expansion options.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    spawns: [
      { x: 165, y: 165, playerSlot: 1, rotation: Math.PI * 5 / 4 },  // P1 Main
      { x: 35, y: 35, playerSlot: 2, rotation: Math.PI / 4 },        // P2 Main
      { x: 115, y: 160, playerSlot: 3, rotation: Math.PI * 3 / 2 },  // P1 Natural
      { x: 85, y: 40, playerSlot: 4, rotation: Math.PI / 2 },        // P2 Natural
      { x: 50, y: 115, playerSlot: 5, rotation: Math.PI },           // P1 Third
      { x: 150, y: 85, playerSlot: 6, rotation: 0 },                 // P2 Third
      { x: 50, y: 175, playerSlot: 7, rotation: Math.PI * 3 / 2 },   // P1 Fourth
      { x: 150, y: 25, playerSlot: 8, rotation: Math.PI / 2 },       // P2 Fourth
    ],

    expansions,

    watchTowers: [
      { x: 100, y: 100, radius: 20 },  // Center - primary control point
      { x: 65, y: 135, radius: 16 },   // P1 side - watch natural approach
      { x: 135, y: 65, radius: 16 },   // P2 side - watch natural approach
      { x: 80, y: 80, radius: 14 },    // Mid-path tower
      { x: 120, y: 120, radius: 14 },  // Mid-path tower
    ],

    ramps,

    destructibles: [
      // Backdoor rocks - break for alternate routes
      { x: 60, y: 140, health: 2000 },  // P1 backdoor
      { x: 140, y: 60, health: 2000 },  // P2 backdoor
      // Center rocks - control access
      { x: 85, y: 75, health: 1500 },
      { x: 115, y: 125, health: 1500 },
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

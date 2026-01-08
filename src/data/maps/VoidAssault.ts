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
 * VOID ASSAULT
 * A competitive 1v1 map inspired by classic StarCraft 2 maps like Metalopolis.
 *
 * Features:
 * - Two spawn positions (bottom-left, top-right)
 * - Natural expansion close to main with single ramp
 * - Third expansion in corners
 * - Central contested area with watch tower
 * - Multiple attack paths
 *
 * Layout (176x176):
 *
 *    [Third]                    [P2 Natural]  [P2 Main]
 *         \                          |            /
 *          \                        Ramp        Ramp
 *           \                        |          /
 *            +--- Choke ---[Center Tower]--- Choke ---+
 *           /                        |          \
 *         Ramp                      Ramp        \
 *        /                          |            \
 *   [P1 Main]  [P1 Natural]                    [Third]
 */

const MAP_WIDTH = 176;
const MAP_HEIGHT = 176;

// Generate void-themed decorations
function generateVoidDecorations(): MapDecoration[] {
  const decorations: MapDecoration[] = [];

  // Helper to add crystal formations
  const addCrystalCluster = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * spread;
      decorations.push({
        type: 'crystal_formation',
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        scale: 0.6 + Math.random() * 0.8,
        rotation: Math.random() * Math.PI * 2,
      });
    }
  };

  // Helper to add alien trees
  const addAlienTrees = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * spread;
      decorations.push({
        type: 'tree_alien',
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        scale: 0.8 + Math.random() * 0.5,
        rotation: Math.random() * Math.PI * 2,
      });
    }
  };

  // Helper to add rocks
  const addRockCluster = (cx: number, cy: number, count: number, spread: number) => {
    const rockTypes: Array<'rocks_large' | 'rocks_small' | 'rock_single'> = [
      'rocks_large', 'rocks_small', 'rock_single'
    ];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * spread;
      decorations.push({
        type: rockTypes[Math.floor(Math.random() * rockTypes.length)],
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        scale: 0.5 + Math.random() * 0.7,
        rotation: Math.random() * Math.PI * 2,
      });
    }
  };

  // Crystal formations near center and obstacles
  addCrystalCluster(88, 88, 8, 12); // Center
  addCrystalCluster(40, 40, 5, 8);  // Top-left obstacle
  addCrystalCluster(136, 136, 5, 8); // Bottom-right obstacle

  // Crystal lines along edges
  addCrystalCluster(88, 10, 4, 6);
  addCrystalCluster(88, 166, 4, 6);
  addCrystalCluster(10, 88, 3, 5);
  addCrystalCluster(166, 88, 3, 5);

  // Alien trees near cliffs
  addAlienTrees(10, 135, 5, 8);
  addAlienTrees(166, 41, 5, 8);
  addAlienTrees(115, 10, 4, 6);
  addAlienTrees(61, 166, 4, 6);

  // Rock formations near destructibles
  addRockCluster(22, 45, 4, 5);
  addRockCluster(154, 131, 4, 5);
  addRockCluster(60, 88, 3, 4);
  addRockCluster(116, 88, 3, 4);

  // Scattered rocks along borders
  addRockCluster(20, 80, 2, 3);
  addRockCluster(156, 96, 2, 3);

  // Debris near battles areas
  decorations.push({ type: 'debris', x: 70, y: 70, scale: 0.8 });
  decorations.push({ type: 'debris', x: 106, y: 106, scale: 0.8 });
  decorations.push({ type: 'ruined_wall', x: 85, y: 75, scale: 1 });
  decorations.push({ type: 'ruined_wall', x: 91, y: 101, scale: 1 });

  return decorations;
}

function generateVoidAssault(): MapData {
  // Create base terrain (low ground)
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // === Create high ground areas for bases ===

  // Player 1 main base (bottom-left, high ground)
  fillTerrainCircle(terrain, 28, 148, 22, 'ground', 2);

  // Player 1 natural (low ground plateau)
  fillTerrainCircle(terrain, 48, 118, 16, 'ground', 1);

  // Player 2 main base (top-right, high ground)
  fillTerrainCircle(terrain, 148, 28, 22, 'ground', 2);

  // Player 2 natural (low ground plateau)
  fillTerrainCircle(terrain, 128, 58, 16, 'ground', 1);

  // === Create cliffs and unwalkable areas ===

  // Cliff edges around P1 main
  fillTerrainRect(terrain, 0, 120, 10, 56, 'unwalkable');
  fillTerrainRect(terrain, 50, 160, 20, 16, 'unwalkable');

  // Cliff edges around P2 main
  fillTerrainRect(terrain, 166, 0, 10, 56, 'unwalkable');
  fillTerrainRect(terrain, 106, 0, 20, 16, 'unwalkable');

  // Central obstacles
  fillTerrainRect(terrain, 80, 80, 16, 16, 'unwalkable'); // Center cliff
  fillTerrainCircle(terrain, 40, 40, 10, 'unwalkable'); // Top-left obstacle
  fillTerrainCircle(terrain, 136, 136, 10, 'unwalkable'); // Bottom-right obstacle

  // === Create ramps ===

  const ramps = [
    // P1 main to natural ramp
    { x: 38, y: 130, width: 6, height: 10, direction: 'south' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // P1 natural to low ground ramp
    { x: 58, y: 105, width: 8, height: 6, direction: 'east' as const, fromElevation: 1 as const, toElevation: 0 as const },
    // P2 main to natural ramp
    { x: 132, y: 36, width: 6, height: 10, direction: 'north' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // P2 natural to low ground ramp
    { x: 110, y: 65, width: 8, height: 6, direction: 'west' as const, fromElevation: 1 as const, toElevation: 0 as const },
  ];

  // Apply ramps to terrain
  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // === Third expansion areas ===

  // P1 third (top-left corner)
  fillTerrainCircle(terrain, 28, 28, 14, 'ground', 1);

  // P2 third (bottom-right corner)
  fillTerrainCircle(terrain, 148, 148, 14, 'ground', 1);

  // Fourth expansions (center edges)
  fillTerrainCircle(terrain, 88, 20, 12, 'ground', 1);
  fillTerrainCircle(terrain, 88, 156, 12, 'ground', 1);

  // === Define expansions ===
  // createMineralLine(mineralCenterX, mineralCenterY, baseCenterX, baseCenterY, amount)

  const expansions = [
    // Player 1 Main (bottom-left) - minerals toward map edge (left/bottom)
    {
      name: 'P1 Main',
      x: 28,
      y: 148,
      isMain: true,
      minerals: createMineralLine(21, 155, 28, 148, 1800), // ~7 units away, toward corner
      vespene: createVespeneGeysers(35, 155, 6, 2250),
    },
    // Player 1 Natural - minerals away from ramp
    {
      name: 'P1 Natural',
      x: 48,
      y: 118,
      isNatural: true,
      minerals: createMineralLine(41, 124, 48, 118, 1500), // ~7 units away
      vespene: createVespeneGeysers(55, 124, 6, 2250),
    },
    // Player 1 Third (top-left corner)
    {
      name: 'P1 Third',
      x: 28,
      y: 28,
      minerals: createMineralLine(21, 21, 28, 28, 1500), // toward corner
      vespene: createVespeneGeysers(35, 21, 6, 2250),
    },
    // Player 2 Main (top-right) - minerals toward map edge (right/top)
    {
      name: 'P2 Main',
      x: 148,
      y: 28,
      isMain: true,
      minerals: createMineralLine(155, 21, 148, 28, 1800), // ~7 units away, toward corner
      vespene: createVespeneGeysers(141, 21, 6, 2250),
    },
    // Player 2 Natural - minerals away from ramp
    {
      name: 'P2 Natural',
      x: 128,
      y: 58,
      isNatural: true,
      minerals: createMineralLine(135, 52, 128, 58, 1500), // ~7 units away
      vespene: createVespeneGeysers(121, 52, 6, 2250),
    },
    // Player 2 Third (bottom-right corner)
    {
      name: 'P2 Third',
      x: 148,
      y: 148,
      minerals: createMineralLine(155, 155, 148, 148, 1500), // toward corner
      vespene: createVespeneGeysers(141, 155, 6, 2250),
    },
    // Center expansions (high-yield/contested)
    {
      name: 'Top Center',
      x: 88,
      y: 20,
      minerals: createMineralLine(88, 13, 88, 20, 900), // Gold minerals
      vespene: [{ x: 95, y: 20, type: 'vespene' as const, amount: 2250 }],
    },
    {
      name: 'Bottom Center',
      x: 88,
      y: 156,
      minerals: createMineralLine(88, 163, 88, 156, 900), // Gold minerals
      vespene: [{ x: 95, y: 156, type: 'vespene' as const, amount: 2250 }],
    },
  ];

  return {
    id: 'void_assault',
    name: 'Void Assault',
    author: 'VOIDSTRIKE Team',
    description: 'A competitive 1v1 map with natural expansions and multiple attack paths. Control the center watchtower for vision advantage.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    spawns: [
      { x: 28, y: 148, playerSlot: 1, rotation: Math.PI / 4 },       // P1 Main
      { x: 148, y: 28, playerSlot: 2, rotation: -Math.PI * 3 / 4 },  // P2 Main
      { x: 48, y: 118, playerSlot: 3, rotation: 0 },                 // P1 Natural
      { x: 128, y: 58, playerSlot: 4, rotation: Math.PI },           // P2 Natural
      { x: 28, y: 28, playerSlot: 5, rotation: Math.PI / 4 },        // P1 Third
      { x: 148, y: 148, playerSlot: 6, rotation: -Math.PI * 3 / 4 }, // P2 Third
      { x: 88, y: 20, playerSlot: 7, rotation: Math.PI / 2 },        // Top Center
      { x: 88, y: 156, playerSlot: 8, rotation: -Math.PI / 2 },      // Bottom Center
    ],

    expansions,

    watchTowers: [
      { x: 88, y: 88, radius: 22 }, // Center tower
    ],

    ramps,

    destructibles: [
      // Rocks blocking third base access
      { x: 22, y: 45, health: 2000 },
      { x: 154, y: 131, health: 2000 },
      // Optional center path rocks
      { x: 60, y: 88, health: 1500 },
      { x: 116, y: 88, health: 1500 },
    ],

    // Void-themed decorations with crystals and alien trees
    decorations: generateVoidDecorations(),

    maxPlayers: 8,
    isRanked: true,

    biome: 'void',
    skyboxColor: '#0a0a1e',
    ambientColor: '#303050',
    sunColor: '#ffe0b0',
    fogColor: '#1a1a2e',
    fogNear: 80,
    fogFar: 200,
  };
}

export const VOID_ASSAULT = generateVoidAssault();

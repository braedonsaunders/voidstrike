import {
  MapData,
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

  const expansions = [
    // Player 1 Main
    {
      name: 'P1 Main',
      x: 28,
      y: 148,
      isMain: true,
      minerals: createMineralLine(16, 156, 'horizontal', 1800),
      vespene: createVespeneGeysers(20, 140, 10, 2250),
    },
    // Player 1 Natural
    {
      name: 'P1 Natural',
      x: 48,
      y: 118,
      isNatural: true,
      minerals: createMineralLine(36, 124, 'horizontal', 1500),
      vespene: createVespeneGeysers(42, 110, 8, 2250),
    },
    // Player 1 Third
    {
      name: 'P1 Third',
      x: 28,
      y: 28,
      minerals: createMineralLine(16, 34, 'horizontal', 1500),
      vespene: createVespeneGeysers(22, 20, 8, 2250),
    },
    // Player 2 Main
    {
      name: 'P2 Main',
      x: 148,
      y: 28,
      isMain: true,
      minerals: createMineralLine(144, 12, 'horizontal', 1800),
      vespene: createVespeneGeysers(150, 36, 10, 2250),
    },
    // Player 2 Natural
    {
      name: 'P2 Natural',
      x: 128,
      y: 58,
      isNatural: true,
      minerals: createMineralLine(124, 48, 'horizontal', 1500),
      vespene: createVespeneGeysers(130, 66, 8, 2250),
    },
    // Player 2 Third
    {
      name: 'P2 Third',
      x: 148,
      y: 148,
      minerals: createMineralLine(144, 140, 'horizontal', 1500),
      vespene: createVespeneGeysers(150, 156, 8, 2250),
    },
    // Center expansions (high-yield/contested)
    {
      name: 'Top Center',
      x: 88,
      y: 20,
      minerals: createMineralLine(78, 14, 'horizontal', 900), // Gold minerals
      vespene: [{ x: 98, y: 24, type: 'vespene' as const, amount: 2250 }],
    },
    {
      name: 'Bottom Center',
      x: 88,
      y: 156,
      minerals: createMineralLine(78, 162, 'horizontal', 900), // Gold minerals
      vespene: [{ x: 98, y: 152, type: 'vespene' as const, amount: 2250 }],
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
      { x: 28, y: 148, playerSlot: 1, rotation: Math.PI / 4 },
      { x: 148, y: 28, playerSlot: 2, rotation: -Math.PI * 3 / 4 },
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

    maxPlayers: 2,
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

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
 * CRYSTAL CAVERNS
 * A medium-sized 1v1 map with horizontal spawns and a contested center.
 *
 * Features:
 * - Horizontal spawn positions (left vs right)
 * - Open middle area for large engagements
 * - Multiple paths between bases
 * - Natural expansions that are easy to take but harder to defend
 *
 * Layout (160x144):
 *
 *   [Third]                [Center Top]                [Third]
 *      |                       |                          |
 *   [P1 Nat]    Path    [Watch Tower]    Path      [P2 Nat]
 *      |          \           |           /           |
 *   [P1 Main]      ----[Open Center]----        [P2 Main]
 *      |          /           |           \           |
 *   [Third]     Path    [Watch Tower]     Path    [Third]
 */

const MAP_WIDTH = 160;
const MAP_HEIGHT = 144;

function generateCrystalCaverns(): MapData {
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // === Player 1 area (left side) ===

  // P1 Main base (elevated)
  fillTerrainCircle(terrain, 24, 72, 20, 'ground', 2);

  // P1 Natural (slightly lower, north)
  fillTerrainCircle(terrain, 40, 36, 15, 'ground', 1);

  // P1 Third (south)
  fillTerrainCircle(terrain, 40, 108, 15, 'ground', 1);

  // === Player 2 area (right side) ===

  // P2 Main base (elevated)
  fillTerrainCircle(terrain, 136, 72, 20, 'ground', 2);

  // P2 Natural (slightly lower, north)
  fillTerrainCircle(terrain, 120, 36, 15, 'ground', 1);

  // P2 Third (south)
  fillTerrainCircle(terrain, 120, 108, 15, 'ground', 1);

  // === Central area ===

  // Center plateau (low ground, open for fights)
  fillTerrainRect(terrain, 55, 52, 50, 40, 'ground', 0);

  // Top and bottom watch tower areas
  fillTerrainCircle(terrain, 80, 24, 10, 'ground', 1);
  fillTerrainCircle(terrain, 80, 120, 10, 'ground', 1);

  // === Cliffs and obstacles ===

  // Map edges
  fillTerrainRect(terrain, 0, 0, 6, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 6, 0, 6, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 6, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 6, MAP_WIDTH, 6, 'unwalkable');

  // Center dividers (create choke points)
  fillTerrainRect(terrain, 70, 40, 20, 6, 'unwalkable');
  fillTerrainRect(terrain, 70, 98, 20, 6, 'unwalkable');

  // Side cliffs
  fillTerrainCircle(terrain, 24, 24, 8, 'unwalkable');
  fillTerrainCircle(terrain, 24, 120, 8, 'unwalkable');
  fillTerrainCircle(terrain, 136, 24, 8, 'unwalkable');
  fillTerrainCircle(terrain, 136, 120, 8, 'unwalkable');

  // === Ramps ===

  const ramps = [
    // P1 main ramps
    { x: 36, y: 60, width: 8, height: 6, direction: 'east' as const, fromElevation: 2 as const, toElevation: 0 as const },
    { x: 36, y: 78, width: 8, height: 6, direction: 'east' as const, fromElevation: 2 as const, toElevation: 0 as const },
    // P1 natural ramp
    { x: 50, y: 42, width: 6, height: 6, direction: 'east' as const, fromElevation: 1 as const, toElevation: 0 as const },
    // P1 third ramp
    { x: 50, y: 96, width: 6, height: 6, direction: 'east' as const, fromElevation: 1 as const, toElevation: 0 as const },
    // P2 main ramps
    { x: 116, y: 60, width: 8, height: 6, direction: 'west' as const, fromElevation: 2 as const, toElevation: 0 as const },
    { x: 116, y: 78, width: 8, height: 6, direction: 'west' as const, fromElevation: 2 as const, toElevation: 0 as const },
    // P2 natural ramp
    { x: 104, y: 42, width: 6, height: 6, direction: 'west' as const, fromElevation: 1 as const, toElevation: 0 as const },
    // P2 third ramp
    { x: 104, y: 96, width: 6, height: 6, direction: 'west' as const, fromElevation: 1 as const, toElevation: 0 as const },
  ];

  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // === Expansions ===

  const expansions = [
    // Player 1
    {
      name: 'P1 Main',
      x: 24,
      y: 72,
      isMain: true,
      minerals: createMineralLine(10, 64, 'vertical', 1800),
      vespene: createVespeneGeysers(16, 80, 8, 2250),
    },
    {
      name: 'P1 Natural',
      x: 40,
      y: 36,
      isNatural: true,
      minerals: createMineralLine(30, 24, 'horizontal', 1500),
      vespene: createVespeneGeysers(36, 44, 6, 2250),
    },
    {
      name: 'P1 Third',
      x: 40,
      y: 108,
      minerals: createMineralLine(30, 114, 'horizontal', 1500),
      vespene: createVespeneGeysers(36, 100, 6, 2250),
    },
    // Player 2
    {
      name: 'P2 Main',
      x: 136,
      y: 72,
      isMain: true,
      minerals: createMineralLine(142, 64, 'vertical', 1800),
      vespene: createVespeneGeysers(144, 80, 8, 2250),
    },
    {
      name: 'P2 Natural',
      x: 120,
      y: 36,
      isNatural: true,
      minerals: createMineralLine(114, 24, 'horizontal', 1500),
      vespene: createVespeneGeysers(124, 44, 6, 2250),
    },
    {
      name: 'P2 Third',
      x: 120,
      y: 108,
      minerals: createMineralLine(114, 114, 'horizontal', 1500),
      vespene: createVespeneGeysers(124, 100, 6, 2250),
    },
    // Center contested expansion
    {
      name: 'Center',
      x: 80,
      y: 72,
      minerals: createMineralLine(70, 68, 'horizontal', 750), // Rich minerals
      vespene: [{ x: 90, y: 76, type: 'vespene' as const, amount: 2250 }],
    },
  ];

  return {
    id: 'crystal_caverns',
    name: 'Crystal Caverns',
    author: 'VOIDSTRIKE Team',
    description: 'Horizontal spawn positions with an open center. Multiple ramps allow for dynamic engagements. Secure your natural quickly!',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    spawns: [
      { x: 24, y: 72, playerSlot: 1, rotation: 0 },
      { x: 136, y: 72, playerSlot: 2, rotation: Math.PI },
    ],

    expansions,

    watchTowers: [
      { x: 80, y: 24, radius: 18 },  // Top tower
      { x: 80, y: 120, radius: 18 }, // Bottom tower
    ],

    ramps,

    destructibles: [
      // Rocks blocking side paths
      { x: 56, y: 24, health: 1500 },
      { x: 104, y: 24, health: 1500 },
      { x: 56, y: 120, health: 1500 },
      { x: 104, y: 120, health: 1500 },
    ],

    maxPlayers: 2,
    isRanked: true,

    skyboxColor: '#0e1428',
    ambientColor: '#2a3050',
    sunColor: '#80b0ff',
    fogColor: '#1a2040',
    fogNear: 70,
    fogFar: 180,
  };
}

export const CRYSTAL_CAVERNS = generateCrystalCaverns();

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
 * TRAINING GROUNDS
 * A larger map with multiple expansion areas and clear base locations.
 *
 * Features:
 * - Main bases on high ground with defensible ramps
 * - Natural expansion with ramp
 * - Third and fourth expansion options
 * - Center control area
 * - Watch towers for vision control
 *
 * Layout (200x200):
 *
 *   [Cliff]    [P2 3rd]    [Center]    [P1 3rd]    [Cliff]
 *       \          |           |           |          /
 *   [P2 Natural]--Ramp--[Open Area]--Ramp--[P1 Natural]
 *       |                   |                   |
 *   [P2 Main]          [Watch Tower]       [P1 Main]
 *       |                   |                   |
 *   [Cliff]    [P2 4th]    [Gold]    [P1 4th]    [Cliff]
 */

const MAP_WIDTH = 200;
const MAP_HEIGHT = 200;

function generateTrainingGrounds(): MapData {
  // Start with low ground (elevation 0)
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // === Main Bases (high ground - elevation 2) ===

  // P1 Main (bottom-right)
  fillTerrainCircle(terrain, 170, 170, 22, 'ground', 2);

  // P2 Main (top-left)
  fillTerrainCircle(terrain, 30, 30, 22, 'ground', 2);

  // === Natural Expansions (medium ground - elevation 1) ===

  // P1 Natural (west of P1 main)
  fillTerrainCircle(terrain, 120, 160, 18, 'ground', 1);

  // P2 Natural (east of P2 main)
  fillTerrainCircle(terrain, 80, 40, 18, 'ground', 1);

  // === Third Expansions (low ground) ===

  // P1 Third (north-west area)
  fillTerrainCircle(terrain, 60, 100, 14, 'ground', 0);

  // P2 Third (south-east area)
  fillTerrainCircle(terrain, 140, 100, 14, 'ground', 0);

  // === Fourth Expansions (outer edges) ===

  // P1 Fourth (bottom edge)
  fillTerrainCircle(terrain, 100, 185, 12, 'ground', 0);

  // P2 Fourth (top edge)
  fillTerrainCircle(terrain, 100, 15, 12, 'ground', 0);

  // === Gold Expansion (center, contested) ===
  fillTerrainCircle(terrain, 100, 100, 12, 'ground', 0);

  // === Map border cliffs ===
  fillTerrainRect(terrain, 0, 0, 10, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 10, 0, 10, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 10, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 10, MAP_WIDTH, 10, 'unwalkable');

  // === Corner cliffs (blocking direct pathing) ===
  fillTerrainCircle(terrain, 30, 170, 15, 'unwalkable'); // Bottom-left
  fillTerrainCircle(terrain, 170, 30, 15, 'unwalkable'); // Top-right

  // === Interior cliffs (create chokepoints) ===
  // Cliffs near center
  fillTerrainCircle(terrain, 60, 60, 10, 'unwalkable');
  fillTerrainCircle(terrain, 140, 140, 10, 'unwalkable');

  // === Ramps ===
  const ramps = [
    // P1 main ramp (from main down to natural)
    {
      x: 148,
      y: 160,
      width: 10,
      height: 8,
      direction: 'west' as const,
      fromElevation: 2 as const,
      toElevation: 1 as const,
    },
    // P1 natural ramp (from natural down to low ground)
    {
      x: 100,
      y: 150,
      width: 10,
      height: 8,
      direction: 'west' as const,
      fromElevation: 1 as const,
      toElevation: 0 as const,
    },
    // P2 main ramp (from main down to natural)
    {
      x: 42,
      y: 32,
      width: 10,
      height: 8,
      direction: 'east' as const,
      fromElevation: 2 as const,
      toElevation: 1 as const,
    },
    // P2 natural ramp (from natural down to low ground)
    {
      x: 90,
      y: 42,
      width: 10,
      height: 8,
      direction: 'east' as const,
      fromElevation: 1 as const,
      toElevation: 0 as const,
    },
  ];

  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // === Expansions with Resources ===
  // createMineralLine(mineralCenterX, mineralCenterY, baseCenterX, baseCenterY, amount)
  const expansions = [
    // P1 Main (CC at 170, 170) - minerals toward bottom-right corner
    {
      name: 'P1 Main',
      x: 170,
      y: 170,
      isMain: true,
      minerals: createMineralLine(177, 177, 170, 170, 1800), // ~7 units toward corner
      vespene: createVespeneGeysers(163, 177, 6, 2250),
    },
    // P1 Natural (CC at 120, 160) - minerals toward bottom edge
    {
      name: 'P1 Natural',
      x: 120,
      y: 160,
      isNatural: true,
      minerals: createMineralLine(120, 167, 120, 160, 1500), // ~7 units south
      vespene: createVespeneGeysers(127, 153, 6, 2250),
    },
    // P1 Third (CC at 60, 100) - minerals to the left
    {
      name: 'P1 Third',
      x: 60,
      y: 100,
      minerals: createMineralLine(53, 100, 60, 100, 1500), // ~7 units west
      vespene: createVespeneGeysers(67, 107, 6, 2250),
    },
    // P1 Fourth (CC at 100, 185) - minerals toward edge
    {
      name: 'P1 Fourth',
      x: 100,
      y: 185,
      minerals: createMineralLine(100, 192, 100, 185, 1200), // ~7 units south
      vespene: createVespeneGeysers(107, 178, 4, 2250),
    },

    // P2 Main (CC at 30, 30) - minerals toward top-left corner
    {
      name: 'P2 Main',
      x: 30,
      y: 30,
      isMain: true,
      minerals: createMineralLine(23, 23, 30, 30, 1800), // ~7 units toward corner
      vespene: createVespeneGeysers(37, 23, 6, 2250),
    },
    // P2 Natural (CC at 80, 40) - minerals toward top edge
    {
      name: 'P2 Natural',
      x: 80,
      y: 40,
      isNatural: true,
      minerals: createMineralLine(80, 33, 80, 40, 1500), // ~7 units north
      vespene: createVespeneGeysers(73, 47, 6, 2250),
    },
    // P2 Third (CC at 140, 100) - minerals to the right
    {
      name: 'P2 Third',
      x: 140,
      y: 100,
      minerals: createMineralLine(147, 100, 140, 100, 1500), // ~7 units east
      vespene: createVespeneGeysers(133, 93, 6, 2250),
    },
    // P2 Fourth (CC at 100, 15) - minerals toward edge
    {
      name: 'P2 Fourth',
      x: 100,
      y: 15,
      minerals: createMineralLine(100, 11, 100, 15, 1200), // ~4 units north (near edge)
      vespene: createVespeneGeysers(93, 22, 4, 2250),
    },

    // Gold base (center - high yield)
    {
      name: 'Gold Base',
      x: 100,
      y: 100,
      minerals: createMineralLine(93, 93, 100, 100, 900), // ~7 units toward center
      vespene: createVespeneGeysers(107, 93, 6, 2250),
    },
  ];

  return {
    id: 'training_grounds',
    name: 'Training Grounds',
    author: 'VOIDSTRIKE Team',
    description: 'A larger map with multiple expansions, strategic ramps, and control points.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    spawns: [
      { x: 170, y: 170, playerSlot: 1, rotation: Math.PI * 5 / 4 },
      { x: 30, y: 30, playerSlot: 2, rotation: Math.PI / 4 },
    ],

    expansions,

    watchTowers: [
      { x: 100, y: 100, radius: 18 }, // Center tower
      { x: 60, y: 140, radius: 15 },  // P1 side tower
      { x: 140, y: 60, radius: 15 },  // P2 side tower
    ],

    ramps,

    destructibles: [
      // Destructible rocks blocking backdoor paths
      { x: 45, y: 145, health: 2000 },
      { x: 155, y: 55, health: 2000 },
    ],

    maxPlayers: 2,
    isRanked: false,

    biome: 'grassland',
    skyboxColor: '#0f1520',
    ambientColor: '#405060',
    sunColor: '#ffffff',
    fogColor: '#1a2530',
    fogNear: 80,
    fogFar: 250,
  };
}

export const TRAINING_GROUNDS = generateTrainingGrounds();

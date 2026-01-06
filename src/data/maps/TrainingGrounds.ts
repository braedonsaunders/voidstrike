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
  const expansions = [
    // P1 Main
    {
      name: 'P1 Main',
      x: 170,
      y: 170,
      isMain: true,
      minerals: createMineralLine(180, 178, 'vertical', 1800),
      vespene: createVespeneGeysers(162, 180, 8, 2250),
    },
    // P1 Natural
    {
      name: 'P1 Natural',
      x: 120,
      y: 160,
      isNatural: true,
      minerals: createMineralLine(130, 168, 'vertical', 1500),
      vespene: createVespeneGeysers(112, 168, 8, 2250),
    },
    // P1 Third
    {
      name: 'P1 Third',
      x: 60,
      y: 100,
      minerals: createMineralLine(48, 92, 'horizontal', 1500),
      vespene: createVespeneGeysers(68, 108, 6, 2250),
    },
    // P1 Fourth
    {
      name: 'P1 Fourth',
      x: 100,
      y: 185,
      minerals: createMineralLine(88, 188, 'horizontal', 1200),
      vespene: createVespeneGeysers(108, 182, 4, 2250),
    },

    // P2 Main
    {
      name: 'P2 Main',
      x: 30,
      y: 30,
      isMain: true,
      minerals: createMineralLine(12, 22, 'vertical', 1800),
      vespene: createVespeneGeysers(38, 12, 8, 2250),
    },
    // P2 Natural
    {
      name: 'P2 Natural',
      x: 80,
      y: 40,
      isNatural: true,
      minerals: createMineralLine(62, 32, 'vertical', 1500),
      vespene: createVespeneGeysers(88, 32, 8, 2250),
    },
    // P2 Third
    {
      name: 'P2 Third',
      x: 140,
      y: 100,
      minerals: createMineralLine(148, 108, 'horizontal', 1500),
      vespene: createVespeneGeysers(132, 92, 6, 2250),
    },
    // P2 Fourth
    {
      name: 'P2 Fourth',
      x: 100,
      y: 15,
      minerals: createMineralLine(88, 12, 'horizontal', 1200),
      vespene: createVespeneGeysers(108, 18, 4, 2250),
    },

    // Gold base (center - high yield)
    {
      name: 'Gold Base',
      x: 100,
      y: 100,
      minerals: createMineralLine(90, 95, 'horizontal', 900), // Gold minerals - less but faster
      vespene: createVespeneGeysers(105, 108, 6, 2250),
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

    skyboxColor: '#0f1520',
    ambientColor: '#405060',
    sunColor: '#ffffff',
    fogColor: '#1a2530',
    fogNear: 80,
    fogFar: 250,
  };
}

export const TRAINING_GROUNDS = generateTrainingGrounds();

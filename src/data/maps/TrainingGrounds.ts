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
 * A simple, small map designed for learning the game.
 *
 * Features:
 * - Simple layout with clear objectives
 * - Short rush distance
 * - Single expansion per player
 * - Minimal cliffs/obstacles
 *
 * Layout (120x120):
 *
 *   [P1 Main]----Ramp----[Open Area]----Ramp----[P2 Main]
 *       |                     |                     |
 *   [P1 Exp]              [Center]              [P2 Exp]
 */

const MAP_WIDTH = 120;
const MAP_HEIGHT = 120;

function generateTrainingGrounds(): MapData {
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // === Player bases on high ground ===

  // P1 Main (bottom-left corner)
  fillTerrainCircle(terrain, 24, 96, 18, 'ground', 2);

  // P2 Main (top-right corner)
  fillTerrainCircle(terrain, 96, 24, 18, 'ground', 2);

  // === Natural expansions (low ground) ===

  // P1 Natural
  fillTerrainCircle(terrain, 24, 60, 14, 'ground', 0);

  // P2 Natural
  fillTerrainCircle(terrain, 96, 60, 14, 'ground', 0);

  // === Open center area ===

  fillTerrainRect(terrain, 40, 40, 40, 40, 'ground', 0);

  // === Map border cliffs ===

  fillTerrainRect(terrain, 0, 0, 8, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 8, 0, 8, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 8, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 8, MAP_WIDTH, 8, 'unwalkable');

  // === Corner cliffs ===

  fillTerrainCircle(terrain, 96, 96, 12, 'unwalkable');
  fillTerrainCircle(terrain, 24, 24, 12, 'unwalkable');

  // === Ramps ===

  const ramps = [
    // P1 main to center
    { x: 36, y: 86, width: 8, height: 6, direction: 'east' as const, fromElevation: 2 as const, toElevation: 0 as const },
    // P2 main to center
    { x: 76, y: 28, width: 8, height: 6, direction: 'west' as const, fromElevation: 2 as const, toElevation: 0 as const },
  ];

  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // === Expansions ===

  const expansions = [
    {
      name: 'P1 Main',
      x: 24,
      y: 96,
      isMain: true,
      minerals: createMineralLine(12, 102, 'horizontal', 1800),
      vespene: createVespeneGeysers(18, 88, 8, 2250),
    },
    {
      name: 'P1 Natural',
      x: 24,
      y: 60,
      isNatural: true,
      minerals: createMineralLine(12, 52, 'horizontal', 1500),
      vespene: createVespeneGeysers(18, 66, 6, 2250),
    },
    {
      name: 'P2 Main',
      x: 96,
      y: 24,
      isMain: true,
      minerals: createMineralLine(92, 10, 'horizontal', 1800),
      vespene: createVespeneGeysers(102, 32, 8, 2250),
    },
    {
      name: 'P2 Natural',
      x: 96,
      y: 60,
      isNatural: true,
      minerals: createMineralLine(92, 66, 'horizontal', 1500),
      vespene: createVespeneGeysers(102, 54, 6, 2250),
    },
  ];

  return {
    id: 'training_grounds',
    name: 'Training Grounds',
    author: 'VOIDSTRIKE Team',
    description: 'A simple map for learning the basics. Short distances and straightforward layout.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    spawns: [
      { x: 24, y: 96, playerSlot: 1, rotation: Math.PI / 4 },
      { x: 96, y: 24, playerSlot: 2, rotation: -Math.PI * 3 / 4 },
    ],

    expansions,

    watchTowers: [
      { x: 60, y: 60, radius: 20 }, // Center tower
    ],

    ramps,

    destructibles: [], // No destructibles - keep it simple

    maxPlayers: 2,
    isRanked: false, // Unranked training map

    skyboxColor: '#0f1520',
    ambientColor: '#405060',
    sunColor: '#ffffff',
    fogColor: '#1a2530',
    fogNear: 60,
    fogFar: 150,
  };
}

export const TRAINING_GROUNDS = generateTrainingGrounds();

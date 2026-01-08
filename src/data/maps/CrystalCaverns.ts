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

// Generate frozen/crystal themed decorations
function generateFrozenDecorations(): MapDecoration[] {
  const decorations: MapDecoration[] = [];

  // Helper to add crystal formations (ice crystals)
  const addCrystalCluster = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * spread;
      decorations.push({
        type: 'crystal_formation',
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        scale: 0.5 + Math.random() * 0.7,
        rotation: Math.random() * Math.PI * 2,
      });
    }
  };

  // Helper to add dead/frozen trees
  const addDeadTrees = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * spread;
      decorations.push({
        type: 'tree_dead',
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        scale: 0.7 + Math.random() * 0.5,
        rotation: Math.random() * Math.PI * 2,
      });
    }
  };

  // Helper to add rocks (ice-covered)
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
        scale: 0.4 + Math.random() * 0.6,
        rotation: Math.random() * Math.PI * 2,
      });
    }
  };

  // Crystal formations along the center dividers
  addCrystalCluster(80, 43, 6, 8);  // Top divider
  addCrystalCluster(80, 101, 6, 8); // Bottom divider

  // Crystal clusters near watch towers
  addCrystalCluster(80, 24, 5, 6);
  addCrystalCluster(80, 120, 5, 6);

  // Ice crystals in corners
  addCrystalCluster(24, 24, 4, 5);
  addCrystalCluster(24, 120, 4, 5);
  addCrystalCluster(136, 24, 4, 5);
  addCrystalCluster(136, 120, 4, 5);

  // Dead trees along edges
  addDeadTrees(10, 50, 4, 6);
  addDeadTrees(10, 94, 4, 6);
  addDeadTrees(150, 50, 4, 6);
  addDeadTrees(150, 94, 4, 6);

  // Dead trees near bases (but not blocking)
  addDeadTrees(12, 72, 3, 5);
  addDeadTrees(148, 72, 3, 5);

  // Rock formations near cliffs
  addRockCluster(24, 24, 3, 4);
  addRockCluster(24, 120, 3, 4);
  addRockCluster(136, 24, 3, 4);
  addRockCluster(136, 120, 3, 4);

  // Rocks near destructibles
  addRockCluster(56, 24, 2, 3);
  addRockCluster(104, 24, 2, 3);
  addRockCluster(56, 120, 2, 3);
  addRockCluster(104, 120, 2, 3);

  // Debris in center battle area
  decorations.push({ type: 'debris', x: 75, y: 72, scale: 0.7 });
  decorations.push({ type: 'debris', x: 85, y: 72, scale: 0.7 });

  return decorations;
}

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
  // createMineralLine(mineralCenterX, mineralCenterY, baseCenterX, baseCenterY, amount)

  const expansions = [
    // Player 1 (left side) - minerals toward left edge
    {
      name: 'P1 Main',
      x: 24,
      y: 72,
      isMain: true,
      minerals: createMineralLine(17, 72, 24, 72, 1800), // ~7 units left of CC
      vespene: createVespeneGeysers(24, 80, 6, 2250),
    },
    {
      name: 'P1 Natural',
      x: 40,
      y: 36,
      isNatural: true,
      minerals: createMineralLine(33, 30, 40, 36, 1500), // ~7 units away toward top-left
      vespene: createVespeneGeysers(47, 30, 6, 2250),
    },
    {
      name: 'P1 Third',
      x: 40,
      y: 108,
      minerals: createMineralLine(33, 114, 40, 108, 1500), // ~7 units away toward bottom-left
      vespene: createVespeneGeysers(47, 114, 6, 2250),
    },
    // Player 2 (right side) - minerals toward right edge
    {
      name: 'P2 Main',
      x: 136,
      y: 72,
      isMain: true,
      minerals: createMineralLine(143, 72, 136, 72, 1800), // ~7 units right of CC
      vespene: createVespeneGeysers(136, 80, 6, 2250),
    },
    {
      name: 'P2 Natural',
      x: 120,
      y: 36,
      isNatural: true,
      minerals: createMineralLine(127, 30, 120, 36, 1500), // ~7 units away toward top-right
      vespene: createVespeneGeysers(113, 30, 6, 2250),
    },
    {
      name: 'P2 Third',
      x: 120,
      y: 108,
      minerals: createMineralLine(127, 114, 120, 108, 1500), // ~7 units away toward bottom-right
      vespene: createVespeneGeysers(113, 114, 6, 2250),
    },
    // Center contested expansion
    {
      name: 'Center',
      x: 80,
      y: 72,
      minerals: createMineralLine(80, 65, 80, 72, 750), // Rich minerals, 7 units north
      vespene: [{ x: 87, y: 72, type: 'vespene' as const, amount: 2250 }],
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

    // Frozen/crystal themed decorations
    decorations: generateFrozenDecorations(),

    maxPlayers: 2,
    isRanked: true,

    biome: 'frozen',
    skyboxColor: '#0e1428',
    ambientColor: '#2a3050',
    sunColor: '#80b0ff',
    fogColor: '#1a2040',
    fogNear: 70,
    fogFar: 180,
  };
}

export const CRYSTAL_CAVERNS = generateCrystalCaverns();

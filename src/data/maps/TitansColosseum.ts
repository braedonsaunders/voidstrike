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
 * TITAN'S COLOSSEUM - 8 Player Map (4v4 or FFA)
 *
 * A massive 8-player map with octagonal spawn layout.
 * Designed for epic 4v4 team battles or chaotic FFA matches.
 *
 * Key Features:
 * - 8 protected main bases around the perimeter
 * - Central colosseum arena for major engagements
 * - Multiple expansion tiers for economic scaling
 * - Volcanic biome with dramatic terrain
 *
 * Layout (400x400):
 *
 *   ┌────────────────────────────────────────────────────────────────────────────┐
 *   │         █P1█            █P2█                                              │
 *   │           ↘              ↙                                                │
 *   │  █P8█                         █P3█                                        │
 *   │     ↓                           ↓                                         │
 *   │              ████████████████                                             │
 *   │             ██  COLOSSEUM  ██                                             │
 *   │             ██   CENTER    ██                                             │
 *   │              ████████████████                                             │
 *   │     ↑                           ↑                                         │
 *   │  █P7█                         █P4█                                        │
 *   │           ↗              ↖                                                │
 *   │         █P6█            █P5█                                              │
 *   └────────────────────────────────────────────────────────────────────────────┘
 */

const MAP_WIDTH = 400;
const MAP_HEIGHT = 400;

function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// 8 main base positions in octagonal arrangement
const MAIN_POSITIONS = [
  { x: 80, y: 45, angle: -Math.PI / 2 },     // P1 - top-left
  { x: 320, y: 45, angle: -Math.PI / 2 },    // P2 - top-right
  { x: 355, y: 130, angle: 0 },              // P3 - right-top
  { x: 355, y: 270, angle: 0 },              // P4 - right-bottom
  { x: 320, y: 355, angle: Math.PI / 2 },    // P5 - bottom-right
  { x: 80, y: 355, angle: Math.PI / 2 },     // P6 - bottom-left
  { x: 45, y: 270, angle: Math.PI },         // P7 - left-bottom
  { x: 45, y: 130, angle: Math.PI },         // P8 - left-top
];

// Base exclusion zones
const BASE_EXCLUSION_ZONES = [
  // Mains
  ...MAIN_POSITIONS.map(p => ({ x: p.x, y: p.y, radius: 28 })),
  // Naturals (offset from mains toward center)
  { x: 110, y: 75, radius: 18 },
  { x: 290, y: 75, radius: 18 },
  { x: 325, y: 160, radius: 18 },
  { x: 325, y: 240, radius: 18 },
  { x: 290, y: 325, radius: 18 },
  { x: 110, y: 325, radius: 18 },
  { x: 75, y: 240, radius: 18 },
  { x: 75, y: 160, radius: 18 },
  // Center
  { x: 200, y: 200, radius: 35 },
  // Gold expansions
  { x: 140, y: 140, radius: 14 },
  { x: 260, y: 140, radius: 14 },
  { x: 260, y: 260, radius: 14 },
  { x: 140, y: 260, radius: 14 },
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

function generateVolcanicDecorations(): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(1234);

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
        scale: 0.5 + rand() * 0.9,
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
        scale: 0.6 + rand() * 0.8,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  const addDeadTrees = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y)) continue;
      decorations.push({
        type: 'tree_dead',
        x, y,
        scale: 0.6 + rand() * 0.6,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Map borders - volcanic rocks
  for (let i = 15; i < MAP_WIDTH - 15; i += 18) {
    addRockCluster(i, 12, 5, 6);
    addRockCluster(i, MAP_HEIGHT - 12, 5, 6);
  }
  for (let i = 15; i < MAP_HEIGHT - 15; i += 18) {
    addRockCluster(12, i, 5, 6);
    addRockCluster(MAP_WIDTH - 12, i, 5, 6);
  }

  // Main base surroundings
  for (const pos of MAIN_POSITIONS) {
    addRockCluster(pos.x - 20, pos.y + 20, 8, 6);
    addRockCluster(pos.x + 20, pos.y - 20, 8, 6);
  }

  // Central colosseum - heavy decoration
  addCrystalCluster(200, 170, 25, 18);
  addCrystalCluster(200, 230, 25, 18);
  addRockCluster(170, 200, 20, 15);
  addRockCluster(230, 200, 20, 15);

  // Gold expansion surroundings
  addCrystalCluster(140, 140, 10, 8);
  addCrystalCluster(260, 140, 10, 8);
  addCrystalCluster(140, 260, 10, 8);
  addCrystalCluster(260, 260, 10, 8);

  // Path decorations
  addDeadTrees(200, 100, 12, 10);
  addDeadTrees(200, 300, 12, 10);
  addDeadTrees(100, 200, 12, 10);
  addDeadTrees(300, 200, 12, 10);

  // Corner decorations
  addDeadTrees(50, 50, 8, 6);
  addDeadTrees(350, 50, 8, 6);
  addDeadTrees(50, 350, 8, 6);
  addDeadTrees(350, 350, 8, 6);

  // Scattered vegetation
  for (let i = 0; i < 250; i++) {
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

  // Debris and ruins
  decorations.push({ type: 'debris', x: 185, y: 185, scale: 1.2 });
  decorations.push({ type: 'debris', x: 215, y: 215, scale: 1.2 });
  decorations.push({ type: 'debris', x: 185, y: 215, scale: 1.0 });
  decorations.push({ type: 'debris', x: 215, y: 185, scale: 1.0 });
  decorations.push({ type: 'ruined_wall', x: 200, y: 200, scale: 1.5 });
  decorations.push({ type: 'ruined_wall', x: 190, y: 210, scale: 1.2 });
  decorations.push({ type: 'ruined_wall', x: 210, y: 190, scale: 1.2 });

  // Escape pods scattered around edges
  decorations.push({ type: 'escape_pod', x: 20, y: 200, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 380, y: 200, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 200, y: 20, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 200, y: 380, scale: 0.9 });

  return decorations;
}

function generateTitansColosseum(): MapData {
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // ========================================
  // MAP BORDERS
  // ========================================
  fillTerrainRect(terrain, 0, 0, 14, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 14, 0, 14, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 14, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 14, MAP_WIDTH, 14, 'unwalkable');

  // ========================================
  // MAIN BASES - Elevation 2, protected
  // ========================================

  // P1 (top-left)
  fillTerrainCircle(terrain, 80, 45, 30, 'ground', 2);
  fillTerrainRect(terrain, 50, 14, 25, 50, 'unwalkable');
  fillTerrainRect(terrain, 50, 14, 55, 20, 'unwalkable');
  fillTerrainRect(terrain, 95, 14, 20, 40, 'unwalkable');
  fillTerrainRect(terrain, 50, 60, 30, 15, 'unwalkable');

  // P2 (top-right)
  fillTerrainCircle(terrain, 320, 45, 30, 'ground', 2);
  fillTerrainRect(terrain, 325, 14, 25, 50, 'unwalkable');
  fillTerrainRect(terrain, 295, 14, 55, 20, 'unwalkable');
  fillTerrainRect(terrain, 285, 14, 20, 40, 'unwalkable');
  fillTerrainRect(terrain, 320, 60, 30, 15, 'unwalkable');

  // P3 (right-top)
  fillTerrainCircle(terrain, 355, 130, 30, 'ground', 2);
  fillTerrainRect(terrain, 356, 100, 30, 25, 'unwalkable');
  fillTerrainRect(terrain, 366, 100, 20, 55, 'unwalkable');
  fillTerrainRect(terrain, 356, 145, 30, 20, 'unwalkable');
  fillTerrainRect(terrain, 330, 100, 15, 30, 'unwalkable');

  // P4 (right-bottom)
  fillTerrainCircle(terrain, 355, 270, 30, 'ground', 2);
  fillTerrainRect(terrain, 356, 255, 30, 25, 'unwalkable');
  fillTerrainRect(terrain, 366, 255, 20, 55, 'unwalkable');
  fillTerrainRect(terrain, 356, 235, 30, 20, 'unwalkable');
  fillTerrainRect(terrain, 330, 270, 15, 30, 'unwalkable');

  // P5 (bottom-right)
  fillTerrainCircle(terrain, 320, 355, 30, 'ground', 2);
  fillTerrainRect(terrain, 325, 336, 25, 50, 'unwalkable');
  fillTerrainRect(terrain, 295, 366, 55, 20, 'unwalkable');
  fillTerrainRect(terrain, 285, 346, 20, 40, 'unwalkable');
  fillTerrainRect(terrain, 320, 325, 30, 15, 'unwalkable');

  // P6 (bottom-left)
  fillTerrainCircle(terrain, 80, 355, 30, 'ground', 2);
  fillTerrainRect(terrain, 50, 336, 25, 50, 'unwalkable');
  fillTerrainRect(terrain, 50, 366, 55, 20, 'unwalkable');
  fillTerrainRect(terrain, 95, 346, 20, 40, 'unwalkable');
  fillTerrainRect(terrain, 50, 325, 30, 15, 'unwalkable');

  // P7 (left-bottom)
  fillTerrainCircle(terrain, 45, 270, 30, 'ground', 2);
  fillTerrainRect(terrain, 14, 255, 30, 25, 'unwalkable');
  fillTerrainRect(terrain, 14, 255, 20, 55, 'unwalkable');
  fillTerrainRect(terrain, 14, 235, 30, 20, 'unwalkable');
  fillTerrainRect(terrain, 55, 270, 15, 30, 'unwalkable');

  // P8 (left-top)
  fillTerrainCircle(terrain, 45, 130, 30, 'ground', 2);
  fillTerrainRect(terrain, 14, 100, 30, 25, 'unwalkable');
  fillTerrainRect(terrain, 14, 100, 20, 55, 'unwalkable');
  fillTerrainRect(terrain, 14, 145, 30, 20, 'unwalkable');
  fillTerrainRect(terrain, 55, 100, 15, 30, 'unwalkable');

  // ========================================
  // NATURAL EXPANSIONS - Elevation 1
  // ========================================

  fillTerrainCircle(terrain, 110, 75, 18, 'ground', 1);
  fillTerrainCircle(terrain, 290, 75, 18, 'ground', 1);
  fillTerrainCircle(terrain, 325, 160, 18, 'ground', 1);
  fillTerrainCircle(terrain, 325, 240, 18, 'ground', 1);
  fillTerrainCircle(terrain, 290, 325, 18, 'ground', 1);
  fillTerrainCircle(terrain, 110, 325, 18, 'ground', 1);
  fillTerrainCircle(terrain, 75, 240, 18, 'ground', 1);
  fillTerrainCircle(terrain, 75, 160, 18, 'ground', 1);

  // Natural protection
  fillTerrainRect(terrain, 95, 88, 10, 12, 'unwalkable');
  fillTerrainRect(terrain, 120, 88, 10, 12, 'unwalkable');
  fillTerrainRect(terrain, 275, 88, 10, 12, 'unwalkable');
  fillTerrainRect(terrain, 300, 88, 10, 12, 'unwalkable');

  fillTerrainRect(terrain, 310, 148, 12, 10, 'unwalkable');
  fillTerrainRect(terrain, 310, 168, 12, 10, 'unwalkable');
  fillTerrainRect(terrain, 310, 228, 12, 10, 'unwalkable');
  fillTerrainRect(terrain, 310, 248, 12, 10, 'unwalkable');

  fillTerrainRect(terrain, 95, 300, 10, 12, 'unwalkable');
  fillTerrainRect(terrain, 120, 300, 10, 12, 'unwalkable');
  fillTerrainRect(terrain, 275, 300, 10, 12, 'unwalkable');
  fillTerrainRect(terrain, 300, 300, 10, 12, 'unwalkable');

  fillTerrainRect(terrain, 78, 148, 12, 10, 'unwalkable');
  fillTerrainRect(terrain, 78, 168, 12, 10, 'unwalkable');
  fillTerrainRect(terrain, 78, 228, 12, 10, 'unwalkable');
  fillTerrainRect(terrain, 78, 248, 12, 10, 'unwalkable');

  // ========================================
  // THIRD/GOLD EXPANSIONS - Elevation 0
  // ========================================

  fillTerrainCircle(terrain, 140, 140, 16, 'ground', 0);
  fillTerrainCircle(terrain, 260, 140, 16, 'ground', 0);
  fillTerrainCircle(terrain, 260, 260, 16, 'ground', 0);
  fillTerrainCircle(terrain, 140, 260, 16, 'ground', 0);

  // Edge thirds
  fillTerrainCircle(terrain, 200, 60, 16, 'ground', 0);
  fillTerrainCircle(terrain, 200, 340, 16, 'ground', 0);
  fillTerrainCircle(terrain, 60, 200, 16, 'ground', 0);
  fillTerrainCircle(terrain, 340, 200, 16, 'ground', 0);

  // ========================================
  // CENTER COLOSSEUM - Major contested area
  // ========================================
  fillTerrainCircle(terrain, 200, 200, 40, 'ground', 0);
  fillTerrainRect(terrain, 185, 185, 30, 30, 'unwalkable');

  // ========================================
  // TERRAIN FEATURES - Chokepoints
  // ========================================

  // Inner ring cliffs
  fillTerrainCircle(terrain, 160, 160, 12, 'unwalkable');
  fillTerrainCircle(terrain, 240, 160, 12, 'unwalkable');
  fillTerrainCircle(terrain, 240, 240, 12, 'unwalkable');
  fillTerrainCircle(terrain, 160, 240, 12, 'unwalkable');

  // Path-narrowing cliffs
  fillTerrainCircle(terrain, 120, 200, 10, 'unwalkable');
  fillTerrainCircle(terrain, 280, 200, 10, 'unwalkable');
  fillTerrainCircle(terrain, 200, 120, 10, 'unwalkable');
  fillTerrainCircle(terrain, 200, 280, 10, 'unwalkable');

  // ========================================
  // RAMPS
  // ========================================
  const ramps = [
    // Main ramps (8 total)
    { x: 95, y: 55, width: 10, height: 10, direction: 'south' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 295, y: 55, width: 10, height: 10, direction: 'south' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 340, y: 140, width: 10, height: 10, direction: 'west' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 340, y: 260, width: 10, height: 10, direction: 'west' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 295, y: 335, width: 10, height: 10, direction: 'north' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 95, y: 335, width: 10, height: 10, direction: 'north' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 50, y: 260, width: 10, height: 10, direction: 'east' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 50, y: 140, width: 10, height: 10, direction: 'east' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // Natural to low ground ramps
    { x: 110, y: 90, width: 8, height: 8, direction: 'south' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 290, y: 90, width: 8, height: 8, direction: 'south' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 308, y: 160, width: 8, height: 8, direction: 'west' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 308, y: 240, width: 8, height: 8, direction: 'west' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 290, y: 302, width: 8, height: 8, direction: 'north' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 110, y: 302, width: 8, height: 8, direction: 'north' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 84, y: 240, width: 8, height: 8, direction: 'east' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 84, y: 160, width: 8, height: 8, direction: 'east' as const, fromElevation: 1 as const, toElevation: 0 as const },
  ];

  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // ========================================
  // EXPANSIONS WITH RESOURCES
  // ========================================
  const expansions = [
    // 8 Main bases
    { name: 'P1 Main', x: 80, y: 45, isMain: true, minerals: createMineralLine(60, 30, 80, 45, 1800), vespene: createVespeneGeysers(60, 30, 80, 45, 2500) },
    { name: 'P2 Main', x: 320, y: 45, isMain: true, minerals: createMineralLine(340, 30, 320, 45, 1800), vespene: createVespeneGeysers(340, 30, 320, 45, 2500) },
    { name: 'P3 Main', x: 355, y: 130, isMain: true, minerals: createMineralLine(370, 115, 355, 130, 1800), vespene: createVespeneGeysers(370, 115, 355, 130, 2500) },
    { name: 'P4 Main', x: 355, y: 270, isMain: true, minerals: createMineralLine(370, 285, 355, 270, 1800), vespene: createVespeneGeysers(370, 285, 355, 270, 2500) },
    { name: 'P5 Main', x: 320, y: 355, isMain: true, minerals: createMineralLine(340, 370, 320, 355, 1800), vespene: createVespeneGeysers(340, 370, 320, 355, 2500) },
    { name: 'P6 Main', x: 80, y: 355, isMain: true, minerals: createMineralLine(60, 370, 80, 355, 1800), vespene: createVespeneGeysers(60, 370, 80, 355, 2500) },
    { name: 'P7 Main', x: 45, y: 270, isMain: true, minerals: createMineralLine(30, 285, 45, 270, 1800), vespene: createVespeneGeysers(30, 285, 45, 270, 2500) },
    { name: 'P8 Main', x: 45, y: 130, isMain: true, minerals: createMineralLine(30, 115, 45, 130, 1800), vespene: createVespeneGeysers(30, 115, 45, 130, 2500) },
    // 8 Natural expansions
    { name: 'P1 Natural', x: 110, y: 75, isNatural: true, minerals: createMineralLine(98, 60, 110, 75, 1500), vespene: createVespeneGeysers(98, 60, 110, 75, 2500) },
    { name: 'P2 Natural', x: 290, y: 75, isNatural: true, minerals: createMineralLine(302, 60, 290, 75, 1500), vespene: createVespeneGeysers(302, 60, 290, 75, 2500) },
    { name: 'P3 Natural', x: 325, y: 160, isNatural: true, minerals: createMineralLine(340, 148, 325, 160, 1500), vespene: createVespeneGeysers(340, 148, 325, 160, 2500) },
    { name: 'P4 Natural', x: 325, y: 240, isNatural: true, minerals: createMineralLine(340, 252, 325, 240, 1500), vespene: createVespeneGeysers(340, 252, 325, 240, 2500) },
    { name: 'P5 Natural', x: 290, y: 325, isNatural: true, minerals: createMineralLine(302, 340, 290, 325, 1500), vespene: createVespeneGeysers(302, 340, 290, 325, 2500) },
    { name: 'P6 Natural', x: 110, y: 325, isNatural: true, minerals: createMineralLine(98, 340, 110, 325, 1500), vespene: createVespeneGeysers(98, 340, 110, 325, 2500) },
    { name: 'P7 Natural', x: 75, y: 240, isNatural: true, minerals: createMineralLine(60, 252, 75, 240, 1500), vespene: createVespeneGeysers(60, 252, 75, 240, 2500) },
    { name: 'P8 Natural', x: 75, y: 160, isNatural: true, minerals: createMineralLine(60, 148, 75, 160, 1500), vespene: createVespeneGeysers(60, 148, 75, 160, 2500) },
    // Gold expansions (inner ring)
    { name: 'Gold NW', x: 140, y: 140, minerals: createMineralLine(128, 128, 140, 140, 1000), vespene: createVespeneGeysers(128, 128, 140, 140, 2500) },
    { name: 'Gold NE', x: 260, y: 140, minerals: createMineralLine(272, 128, 260, 140, 1000), vespene: createVespeneGeysers(272, 128, 260, 140, 2500) },
    { name: 'Gold SE', x: 260, y: 260, minerals: createMineralLine(272, 272, 260, 260, 1000), vespene: createVespeneGeysers(272, 272, 260, 260, 2500) },
    { name: 'Gold SW', x: 140, y: 260, minerals: createMineralLine(128, 272, 140, 260, 1000), vespene: createVespeneGeysers(128, 272, 140, 260, 2500) },
    // Edge thirds
    { name: 'North Third', x: 200, y: 60, minerals: createMineralLine(200, 45, 200, 60, 1500), vespene: createVespeneGeysers(200, 45, 200, 60, 2500) },
    { name: 'South Third', x: 200, y: 340, minerals: createMineralLine(200, 355, 200, 340, 1500), vespene: createVespeneGeysers(200, 355, 200, 340, 2500) },
    { name: 'West Third', x: 60, y: 200, minerals: createMineralLine(45, 200, 60, 200, 1500), vespene: createVespeneGeysers(45, 200, 60, 200, 2500) },
    { name: 'East Third', x: 340, y: 200, minerals: createMineralLine(355, 200, 340, 200, 1500), vespene: createVespeneGeysers(355, 200, 340, 200, 2500) },
    // Center
    { name: 'Colosseum Center', x: 200, y: 200, minerals: createMineralLine(200, 215, 200, 200, 750), vespene: createVespeneGeysers(200, 215, 200, 200, 2500) },
  ];

  return {
    id: 'titans_colosseum',
    name: "Titan's Colosseum",
    author: 'VOIDSTRIKE Team',
    description: 'A massive 8-player map for epic 4v4 battles or chaotic FFA. Eight protected bases surround a central colosseum where armies clash for supremacy.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    spawns: [
      { x: 80, y: 45, playerSlot: 1, rotation: Math.PI / 2 },
      { x: 320, y: 45, playerSlot: 2, rotation: Math.PI / 2 },
      { x: 355, y: 130, playerSlot: 3, rotation: 0 },
      { x: 355, y: 270, playerSlot: 4, rotation: 0 },
      { x: 320, y: 355, playerSlot: 5, rotation: -Math.PI / 2 },
      { x: 80, y: 355, playerSlot: 6, rotation: -Math.PI / 2 },
      { x: 45, y: 270, playerSlot: 7, rotation: Math.PI },
      { x: 45, y: 130, playerSlot: 8, rotation: Math.PI },
    ],

    expansions,

    watchTowers: [
      { x: 200, y: 200, radius: 32 },  // Center
      { x: 140, y: 200, radius: 20 },
      { x: 260, y: 200, radius: 20 },
      { x: 200, y: 140, radius: 20 },
      { x: 200, y: 260, radius: 20 },
    ],

    ramps,

    destructibles: [
      { x: 160, y: 160, health: 2000 },
      { x: 240, y: 160, health: 2000 },
      { x: 240, y: 240, health: 2000 },
      { x: 160, y: 240, health: 2000 },
      { x: 120, y: 200, health: 1500 },
      { x: 280, y: 200, health: 1500 },
      { x: 200, y: 120, health: 1500 },
      { x: 200, y: 280, health: 1500 },
    ],

    decorations: generateVolcanicDecorations(),

    playerCount: 8,
    maxPlayers: 8,
    isRanked: true,

    biome: 'volcanic',
    fogNear: 120,
    fogFar: 400,
  };
}

export const TITANS_COLOSSEUM = generateTitansColosseum();

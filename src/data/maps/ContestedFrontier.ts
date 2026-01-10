import {
  MapData,
  MapDecoration,
  createTerrainGrid,
  createBaseResources,
  DIR,
  fillTerrainRect,
  fillTerrainCircle,
  createRampInTerrain,
  createRaisedPlatform,
  createForestCorridor,
  createRiver,
  createLake,
  createRoad,
  createVoidChasm,
  fillFeatureCircle,
  fillFeatureRect,
  scatterForests,
} from './MapTypes';

/**
 * CONTESTED FRONTIER - 6 Player Map (3v3)
 *
 * A massive 6-player map designed for team games.
 * Players spawn in two rows of 3, facing each other across a contested center.
 *
 * Key Features:
 * - 6 protected main bases (3 top, 3 bottom)
 * - Team-oriented layout for 3v3 matches
 * - Large central contested area with multiple watch towers
 * - Multiple expansion paths for economic development
 * - Jungle biome with dense vegetation
 *
 * Layout (360x320):
 *
 *   ┌────────────────────────────────────────────────────────────────────────┐
 *   │ █P1 MAIN█           █P2 MAIN█           █P3 MAIN█                     │
 *   │ ███↓████             ███↓████             ███↓████                     │
 *   │  [NAT]                [NAT]                [NAT]                       │
 *   │                                                                        │
 *   │   [Third]    [Gold]     [Third]    [Gold]     [Third]                 │
 *   │                         ████████                                       │
 *   │                        ██TOWER██                                       │
 *   │                         ████████                                       │
 *   │   [Third]    [Gold]     [Third]    [Gold]     [Third]                 │
 *   │                                                                        │
 *   │  [NAT]                [NAT]                [NAT]                       │
 *   │ ███↑████             ███↑████             ███↑████                     │
 *   │ █P4 MAIN█           █P5 MAIN█           █P6 MAIN█                     │
 *   └────────────────────────────────────────────────────────────────────────┘
 */

const MAP_WIDTH = 360;
const MAP_HEIGHT = 320;

function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// Base exclusion zones
const BASE_EXCLUSION_ZONES = [
  // Top row mains (P1, P2, P3)
  { x: 50, y: 45, radius: 26 },
  { x: 180, y: 45, radius: 26 },
  { x: 310, y: 45, radius: 26 },
  // Bottom row mains (P4, P5, P6)
  { x: 50, y: 275, radius: 26 },
  { x: 180, y: 275, radius: 26 },
  { x: 310, y: 275, radius: 26 },
  // Naturals
  { x: 70, y: 85, radius: 18 },
  { x: 180, y: 85, radius: 18 },
  { x: 290, y: 85, radius: 18 },
  { x: 70, y: 235, radius: 18 },
  { x: 180, y: 235, radius: 18 },
  { x: 290, y: 235, radius: 18 },
  // Center
  { x: 180, y: 160, radius: 24 },
  // Gold bases
  { x: 100, y: 130, radius: 14 },
  { x: 260, y: 130, radius: 14 },
  { x: 100, y: 190, radius: 14 },
  { x: 260, y: 190, radius: 14 },
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

function generateJungleDecorations(): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(999);

  const addTreeCluster = (cx: number, cy: number, count: number, spread: number) => {
    const treeTypes: Array<'tree_pine_tall' | 'tree_pine_medium' | 'tree_palm' | 'tree_mushroom'> = [
      'tree_pine_tall', 'tree_pine_medium', 'tree_palm', 'tree_mushroom'
    ];
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y)) continue;
      decorations.push({
        type: treeTypes[Math.floor(rand() * treeTypes.length)],
        x, y,
        scale: 0.6 + rand() * 0.7,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

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
        scale: 0.4 + rand() * 0.7,
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
        scale: 0.5 + rand() * 0.6,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Helper to create continuous rock cliff wall
  const addRockCliffLine = (x1: number, y1: number, x2: number, y2: number, density: number = 2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(length / density);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t + (rand() - 0.5) * 2;
      const y = y1 + dy * t + (rand() - 0.5) * 2;
      if (isInBaseArea(x, y)) continue;
      const rockType = rand() < 0.4 ? 'rocks_large' : (rand() < 0.7 ? 'rocks_small' : 'rock_single');
      decorations.push({
        type: rockType,
        x, y,
        scale: 0.6 + rand() * 0.6,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Helper to add rocks around a circular base edge
  const addBaseEdgeRocks = (cx: number, cy: number, radius: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.3;
      const dist = radius + 2 + rand() * 4;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y)) continue;
      const rockType = rand() < 0.3 ? 'rocks_large' : (rand() < 0.6 ? 'rocks_small' : 'rock_single');
      decorations.push({
        type: rockType,
        x, y,
        scale: 0.5 + rand() * 0.6,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Helper to add trees around a circular base edge
  const addBaseEdgeTrees = (cx: number, cy: number, radius: number, count: number) => {
    const treeTypes: Array<'tree_pine_tall' | 'tree_pine_medium' | 'tree_palm' | 'tree_mushroom'> = [
      'tree_pine_tall', 'tree_pine_medium', 'tree_palm', 'tree_mushroom'
    ];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.4;
      const dist = radius + 4 + rand() * 6;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y)) continue;
      decorations.push({
        type: treeTypes[Math.floor(rand() * treeTypes.length)],
        x, y,
        scale: 0.6 + rand() * 0.5,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // ========================================
  // MAIN BASE EDGE DECORATIONS - 6 bases
  // ========================================

  // Top row mains
  addBaseEdgeRocks(50, 45, 30, 24);
  addBaseEdgeTrees(50, 45, 33, 16);
  addBaseEdgeRocks(180, 45, 30, 24);
  addBaseEdgeTrees(180, 45, 33, 16);
  addBaseEdgeRocks(310, 45, 30, 24);
  addBaseEdgeTrees(310, 45, 33, 16);

  // Bottom row mains
  addBaseEdgeRocks(50, 275, 30, 24);
  addBaseEdgeTrees(50, 275, 33, 16);
  addBaseEdgeRocks(180, 275, 30, 24);
  addBaseEdgeTrees(180, 275, 33, 16);
  addBaseEdgeRocks(310, 275, 30, 24);
  addBaseEdgeTrees(310, 275, 33, 16);

  // ========================================
  // NATURAL EXPANSION EDGE DECORATIONS
  // ========================================

  // Top naturals
  addBaseEdgeRocks(70, 85, 21, 16);
  addBaseEdgeTrees(70, 85, 24, 12);
  addBaseEdgeRocks(180, 85, 21, 16);
  addBaseEdgeTrees(180, 85, 24, 12);
  addBaseEdgeRocks(290, 85, 21, 16);
  addBaseEdgeTrees(290, 85, 24, 12);

  // Bottom naturals
  addBaseEdgeRocks(70, 235, 21, 16);
  addBaseEdgeTrees(70, 235, 24, 12);
  addBaseEdgeRocks(180, 235, 21, 16);
  addBaseEdgeTrees(180, 235, 24, 12);
  addBaseEdgeRocks(290, 235, 21, 16);
  addBaseEdgeTrees(290, 235, 24, 12);

  // ========================================
  // CONTINUOUS ROCK CLIFF WALLS
  // ========================================

  // Map border cliffs
  addRockCliffLine(14, 14, 14, 306, 3);
  addRockCliffLine(346, 14, 346, 306, 3);
  addRockCliffLine(14, 14, 346, 14, 3);
  addRockCliffLine(14, 306, 346, 306, 3);

  // Natural chokepoint walls - top
  addRockCliffLine(50, 98, 62, 110, 2);
  addRockCliffLine(82, 98, 94, 110, 2);
  addRockCliffLine(160, 98, 172, 110, 2);
  addRockCliffLine(192, 98, 204, 110, 2);
  addRockCliffLine(270, 98, 282, 110, 2);
  addRockCliffLine(302, 98, 314, 110, 2);

  // Natural chokepoint walls - bottom
  addRockCliffLine(50, 210, 62, 222, 2);
  addRockCliffLine(82, 210, 94, 222, 2);
  addRockCliffLine(160, 210, 172, 222, 2);
  addRockCliffLine(192, 210, 204, 222, 2);
  addRockCliffLine(270, 210, 282, 222, 2);
  addRockCliffLine(302, 210, 314, 222, 2);

  // Central obstacle cliff faces
  addRockCliffLine(168, 148, 192, 148, 2);
  addRockCliffLine(168, 172, 192, 172, 2);
  addRockCliffLine(168, 148, 168, 172, 2);
  addRockCliffLine(192, 148, 192, 172, 2);

  // Side cliff walls
  addRockCliffLine(58, 145, 82, 145, 2);
  addRockCliffLine(58, 175, 82, 175, 2);
  addRockCliffLine(278, 145, 302, 145, 2);
  addRockCliffLine(278, 175, 302, 175, 2);

  // ========================================
  // ORIGINAL DECORATIONS (enhanced)
  // ========================================

  // Map borders - dense jungle
  for (let i = 15; i < MAP_WIDTH - 15; i += 15) {
    addTreeCluster(i, 12, 8, 7);
    addTreeCluster(i, MAP_HEIGHT - 12, 8, 7);
  }
  for (let i = 15; i < MAP_HEIGHT - 15; i += 15) {
    addTreeCluster(12, i, 8, 7);
    addTreeCluster(MAP_WIDTH - 12, i, 8, 7);
  }

  // Main base surroundings (cliff edges) - enhanced
  addRockCluster(35, 65, 14, 10);
  addRockCluster(65, 30, 14, 10);
  addRockCluster(165, 30, 14, 10);
  addRockCluster(195, 65, 14, 10);
  addRockCluster(295, 30, 14, 10);
  addRockCluster(325, 65, 14, 10);
  addRockCluster(35, 255, 14, 10);
  addRockCluster(65, 290, 14, 10);
  addRockCluster(165, 290, 14, 10);
  addRockCluster(195, 255, 14, 10);
  addRockCluster(295, 290, 14, 10);
  addRockCluster(325, 255, 14, 10);

  // Central area - heavy decoration
  addCrystalCluster(180, 140, 24, 18);
  addCrystalCluster(180, 180, 24, 18);
  addRockCluster(160, 160, 20, 15);
  addRockCluster(200, 160, 20, 15);

  // Between-base paths - enhanced
  addTreeCluster(115, 45, 12, 8);
  addTreeCluster(245, 45, 12, 8);
  addTreeCluster(115, 275, 12, 8);
  addTreeCluster(245, 275, 12, 8);

  // Gold expansion surroundings - enhanced
  addCrystalCluster(100, 130, 12, 8);
  addCrystalCluster(260, 130, 12, 8);
  addCrystalCluster(100, 190, 12, 8);
  addCrystalCluster(260, 190, 12, 8);
  addRockCluster(110, 140, 8, 6);
  addRockCluster(250, 140, 8, 6);
  addRockCluster(110, 180, 8, 6);
  addRockCluster(250, 180, 8, 6);

  // Third expansion surroundings - enhanced
  addTreeCluster(50, 130, 14, 10);
  addTreeCluster(310, 130, 14, 10);
  addTreeCluster(50, 190, 14, 10);
  addTreeCluster(310, 190, 14, 10);
  addTreeCluster(180, 120, 12, 8);
  addTreeCluster(180, 200, 12, 8);

  // Scattered bushes
  for (let i = 0; i < 200; i++) {
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

  // Debris and special objects
  decorations.push({ type: 'debris', x: 170, y: 155, scale: 1.0 });
  decorations.push({ type: 'debris', x: 190, y: 165, scale: 1.0 });
  decorations.push({ type: 'ruined_wall', x: 180, y: 160, scale: 1.3 });
  decorations.push({ type: 'escape_pod', x: 15, y: 15, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 345, y: 15, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 15, y: 305, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 345, y: 305, scale: 0.9 });

  return decorations;
}

function generateContestedFrontier(): MapData {
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // ========================================
  // MAP BORDERS
  // ========================================
  fillTerrainRect(terrain, 0, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 12, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 12, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 12, MAP_WIDTH, 12, 'unwalkable');

  // ========================================
  // RAMPS - Must be created BEFORE raised platforms
  // ========================================
  const ramps = [
    // Top row main ramps (main base to natural)
    { x: 58, y: 65, width: 10, height: 10, direction: 'south' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 175, y: 65, width: 10, height: 10, direction: 'south' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 302, y: 65, width: 10, height: 10, direction: 'south' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // Bottom row main ramps (main base to natural)
    { x: 58, y: 245, width: 10, height: 10, direction: 'north' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 175, y: 245, width: 10, height: 10, direction: 'north' as const, fromElevation: 2 as const, toElevation: 1 as const },
    { x: 302, y: 245, width: 10, height: 10, direction: 'north' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // Natural to low ground ramps
    { x: 70, y: 100, width: 8, height: 8, direction: 'south' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 180, y: 100, width: 8, height: 8, direction: 'south' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 290, y: 100, width: 8, height: 8, direction: 'south' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 70, y: 212, width: 8, height: 8, direction: 'north' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 180, y: 212, width: 8, height: 8, direction: 'north' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 290, y: 212, width: 8, height: 8, direction: 'north' as const, fromElevation: 1 as const, toElevation: 0 as const },
  ];
  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // ========================================
  // MAIN BASES - Raised platforms with cliff edges (Elevation 2)
  // Units must use ramps to access
  // ========================================

  // Top row mains
  createRaisedPlatform(terrain, 50, 45, 25, 2, 4);   // P1 Main (top-left)
  createRaisedPlatform(terrain, 180, 45, 25, 2, 4); // P2 Main (top-center)
  createRaisedPlatform(terrain, 310, 45, 25, 2, 4); // P3 Main (top-right)

  // Bottom row mains
  createRaisedPlatform(terrain, 50, 275, 25, 2, 4);  // P4 Main (bottom-left)
  createRaisedPlatform(terrain, 180, 275, 25, 2, 4); // P5 Main (bottom-center)
  createRaisedPlatform(terrain, 310, 275, 25, 2, 4); // P6 Main (bottom-right)

  // ========================================
  // NATURAL EXPANSIONS - Raised platforms (Elevation 1)
  // ========================================

  // Top naturals
  createRaisedPlatform(terrain, 70, 85, 16, 1, 3);
  createRaisedPlatform(terrain, 180, 85, 16, 1, 3);
  createRaisedPlatform(terrain, 290, 85, 16, 1, 3);

  // Bottom naturals
  createRaisedPlatform(terrain, 70, 235, 16, 1, 3);
  createRaisedPlatform(terrain, 180, 235, 16, 1, 3);
  createRaisedPlatform(terrain, 290, 235, 16, 1, 3);

  // Natural chokepoint walls (additional cliffs to create defensive positions)
  fillTerrainRect(terrain, 50, 98, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 82, 98, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 160, 98, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 192, 98, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 270, 98, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 302, 98, 12, 12, 'unwalkable');

  fillTerrainRect(terrain, 50, 210, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 82, 210, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 160, 210, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 192, 210, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 270, 210, 12, 12, 'unwalkable');
  fillTerrainRect(terrain, 302, 210, 12, 12, 'unwalkable');

  // ========================================
  // THIRD EXPANSIONS - Elevation 0
  // ========================================

  // Side thirds
  fillTerrainCircle(terrain, 40, 160, 16, 'ground', 0);
  fillTerrainCircle(terrain, 320, 160, 16, 'ground', 0);

  // Mid thirds (between center and naturals)
  fillTerrainCircle(terrain, 120, 130, 14, 'ground', 0);
  fillTerrainCircle(terrain, 240, 130, 14, 'ground', 0);
  fillTerrainCircle(terrain, 120, 190, 14, 'ground', 0);
  fillTerrainCircle(terrain, 240, 190, 14, 'ground', 0);

  // ========================================
  // GOLD EXPANSIONS
  // ========================================
  fillTerrainCircle(terrain, 100, 130, 14, 'ground', 0);
  fillTerrainCircle(terrain, 260, 130, 14, 'ground', 0);
  fillTerrainCircle(terrain, 100, 190, 14, 'ground', 0);
  fillTerrainCircle(terrain, 260, 190, 14, 'ground', 0);

  // ========================================
  // CENTER - Major contested area
  // ========================================
  fillTerrainCircle(terrain, 180, 160, 26, 'ground', 0);
  fillTerrainRect(terrain, 168, 148, 24, 24, 'unwalkable');

  // ========================================
  // TERRAIN FEATURES - Chokepoints & Cliffs
  // ========================================

  // Side cliffs
  fillTerrainCircle(terrain, 70, 160, 12, 'unwalkable');
  fillTerrainCircle(terrain, 290, 160, 12, 'unwalkable');

  // Inner chokepoint cliffs
  fillTerrainCircle(terrain, 130, 160, 10, 'unwalkable');
  fillTerrainCircle(terrain, 230, 160, 10, 'unwalkable');

  // ========================================
  // NEW TERRAIN FEATURES - Strategic variety
  // ========================================

  // VOID CHASMS at map corners - impassable areas
  createVoidChasm(terrain, 0, 0, 25, 25, 3);      // Top-left corner
  createVoidChasm(terrain, MAP_WIDTH - 25, 0, 25, 25, 3);  // Top-right corner
  createVoidChasm(terrain, 0, MAP_HEIGHT - 25, 25, 25, 3); // Bottom-left corner
  createVoidChasm(terrain, MAP_WIDTH - 25, MAP_HEIGHT - 25, 25, 25, 3); // Bottom-right corner

  // RIVERS - Force routing decisions, create chokepoints
  // Central east-west river with two bridge crossings
  createRiver(terrain, 90, 160, 145, 160, 10, 0.5, 8);   // Left section with bridge
  createRiver(terrain, 215, 160, 270, 160, 10, 0.5, 8);  // Right section with bridge

  // LAKES - Block direct paths, force detours
  createLake(terrain, 85, 55, 12, 3);   // Between P1 and P2
  createLake(terrain, 250, 55, 12, 3);  // Between P2 and P3
  createLake(terrain, 85, 265, 12, 3);  // Between P4 and P5
  createLake(terrain, 250, 265, 12, 3); // Between P5 and P6

  // FOREST CORRIDORS - Dense forests with paths through them
  // Connect naturals to mid-map through forest corridors
  createForestCorridor(terrain, 70, 110, 100, 145, 18, 6, true);   // P1 nat to center
  createForestCorridor(terrain, 290, 110, 260, 145, 18, 6, true);  // P3 nat to center
  createForestCorridor(terrain, 70, 210, 100, 175, 18, 6, true);   // P4 nat to center
  createForestCorridor(terrain, 290, 210, 260, 175, 18, 6, true);  // P6 nat to center

  // Side forest corridors
  createForestCorridor(terrain, 25, 90, 25, 130, 14, 5, true);     // West upper
  createForestCorridor(terrain, 25, 190, 25, 230, 14, 5, true);    // West lower
  createForestCorridor(terrain, 335, 90, 335, 130, 14, 5, true);   // East upper
  createForestCorridor(terrain, 335, 190, 335, 230, 14, 5, true);  // East lower

  // ROADS - Fast movement corridors connecting key areas
  // Main highways
  createRoad(terrain, 50, 45, 50, 90, 5);    // P1 to nat
  createRoad(terrain, 180, 45, 180, 90, 5);  // P2 to nat
  createRoad(terrain, 310, 45, 310, 90, 5);  // P3 to nat
  createRoad(terrain, 50, 275, 50, 230, 5);  // P4 to nat
  createRoad(terrain, 180, 275, 180, 230, 5);// P5 to nat
  createRoad(terrain, 310, 275, 310, 230, 5);// P6 to nat

  // Cross roads connecting thirds
  createRoad(terrain, 40, 160, 130, 160, 4);   // West third to center-ish
  createRoad(terrain, 230, 160, 320, 160, 4);  // Center-ish to east third

  // SCATTERED FORESTS - Fill open areas with strategic cover (3x more trees)
  scatterForests(terrain, MAP_WIDTH, MAP_HEIGHT, 120, 4, 10, BASE_EXCLUSION_ZONES, 777, 0.35);

  // DENSE FOREST WALLS - Major terrain obstacles with paths through them
  // West forest wall (with gap for path)
  fillFeatureCircle(terrain, 30, 115, 12, 'forest_dense');
  fillFeatureCircle(terrain, 35, 135, 10, 'forest_dense');
  fillFeatureCircle(terrain, 30, 185, 10, 'forest_dense');
  fillFeatureCircle(terrain, 35, 205, 12, 'forest_dense');
  // East forest wall (with gap for path)
  fillFeatureCircle(terrain, 330, 115, 12, 'forest_dense');
  fillFeatureCircle(terrain, 325, 135, 10, 'forest_dense');
  fillFeatureCircle(terrain, 330, 185, 10, 'forest_dense');
  fillFeatureCircle(terrain, 325, 205, 12, 'forest_dense');

  // CENTRAL FOREST ZONES - Cover for engagements
  fillFeatureCircle(terrain, 100, 145, 14, 'forest_dense');
  fillFeatureCircle(terrain, 260, 145, 14, 'forest_dense');
  fillFeatureCircle(terrain, 100, 175, 14, 'forest_dense');
  fillFeatureCircle(terrain, 260, 175, 14, 'forest_dense');
  fillFeatureCircle(terrain, 140, 130, 10, 'forest_light');
  fillFeatureCircle(terrain, 220, 130, 10, 'forest_light');
  fillFeatureCircle(terrain, 140, 190, 10, 'forest_light');
  fillFeatureCircle(terrain, 220, 190, 10, 'forest_light');

  // APPROACH FORESTS - Cover near naturals
  fillFeatureCircle(terrain, 45, 110, 8, 'forest_light');
  fillFeatureCircle(terrain, 95, 110, 8, 'forest_light');
  fillFeatureCircle(terrain, 155, 110, 8, 'forest_light');
  fillFeatureCircle(terrain, 205, 110, 8, 'forest_light');
  fillFeatureCircle(terrain, 265, 110, 8, 'forest_light');
  fillFeatureCircle(terrain, 315, 110, 8, 'forest_light');
  fillFeatureCircle(terrain, 45, 210, 8, 'forest_light');
  fillFeatureCircle(terrain, 95, 210, 8, 'forest_light');
  fillFeatureCircle(terrain, 155, 210, 8, 'forest_light');
  fillFeatureCircle(terrain, 205, 210, 8, 'forest_light');
  fillFeatureCircle(terrain, 265, 210, 8, 'forest_light');
  fillFeatureCircle(terrain, 315, 210, 8, 'forest_light');

  // FLANKING FORESTS - Additional cover on map edges
  fillFeatureCircle(terrain, 20, 160, 10, 'forest_dense');
  fillFeatureCircle(terrain, 340, 160, 10, 'forest_dense');

  // MUD areas in contested center (slow down engagement)
  fillFeatureCircle(terrain, 180, 140, 8, 'mud');
  fillFeatureCircle(terrain, 180, 180, 8, 'mud');

  // ========================================
  // EXPANSIONS WITH RESOURCES
  // Standard: 6x 1500 + 2x 900 minerals per base, 2250 gas per geyser
  // Gold: all 8 patches at 900 minerals
  // ========================================
  // Top row mains & naturals (minerals face up/away from center)
  const p1Main = createBaseResources(50, 45, DIR.UP_LEFT);       // Standard
  const p1Nat = createBaseResources(70, 85, DIR.UP_LEFT);        // Standard
  const p2Main = createBaseResources(180, 45, DIR.UP);           // Standard
  const p2Nat = createBaseResources(180, 85, DIR.UP);            // Standard
  const p3Main = createBaseResources(310, 45, DIR.UP_RIGHT);     // Standard
  const p3Nat = createBaseResources(290, 85, DIR.UP_RIGHT);      // Standard
  // Bottom row mains & naturals (minerals face down/away from center)
  const p4Main = createBaseResources(50, 275, DIR.DOWN_LEFT);    // Standard
  const p4Nat = createBaseResources(70, 235, DIR.DOWN_LEFT);     // Standard
  const p5Main = createBaseResources(180, 275, DIR.DOWN);        // Standard
  const p5Nat = createBaseResources(180, 235, DIR.DOWN);         // Standard
  const p6Main = createBaseResources(310, 275, DIR.DOWN_RIGHT);  // Standard
  const p6Nat = createBaseResources(290, 235, DIR.DOWN_RIGHT);   // Standard
  // Third expansions
  const westThird = createBaseResources(40, 160, DIR.LEFT);      // Standard
  const eastThird = createBaseResources(320, 160, DIR.RIGHT);    // Standard
  const midThirdNW = createBaseResources(120, 130, DIR.UP_LEFT); // Standard
  const midThirdNE = createBaseResources(240, 130, DIR.UP_RIGHT);// Standard
  const midThirdSW = createBaseResources(120, 190, DIR.DOWN_LEFT);// Standard
  const midThirdSE = createBaseResources(240, 190, DIR.DOWN_RIGHT);// Standard
  // Gold expansions
  const goldNW = createBaseResources(100, 130, DIR.UP_LEFT, 1500, 2250, true);   // Gold
  const goldNE = createBaseResources(260, 130, DIR.UP_RIGHT, 1500, 2250, true);  // Gold
  const goldSW = createBaseResources(100, 190, DIR.DOWN_LEFT, 1500, 2250, true); // Gold
  const goldSE = createBaseResources(260, 190, DIR.DOWN_RIGHT, 1500, 2250, true);// Gold
  // Center
  const center = createBaseResources(180, 160, DIR.DOWN, 1500, 2250, true);      // Gold (contested)

  const expansions = [
    { name: 'P1 Main', x: 50, y: 45, isMain: true, ...p1Main },
    { name: 'P1 Natural', x: 70, y: 85, isNatural: true, ...p1Nat },
    { name: 'P2 Main', x: 180, y: 45, isMain: true, ...p2Main },
    { name: 'P2 Natural', x: 180, y: 85, isNatural: true, ...p2Nat },
    { name: 'P3 Main', x: 310, y: 45, isMain: true, ...p3Main },
    { name: 'P3 Natural', x: 290, y: 85, isNatural: true, ...p3Nat },
    { name: 'P4 Main', x: 50, y: 275, isMain: true, ...p4Main },
    { name: 'P4 Natural', x: 70, y: 235, isNatural: true, ...p4Nat },
    { name: 'P5 Main', x: 180, y: 275, isMain: true, ...p5Main },
    { name: 'P5 Natural', x: 180, y: 235, isNatural: true, ...p5Nat },
    { name: 'P6 Main', x: 310, y: 275, isMain: true, ...p6Main },
    { name: 'P6 Natural', x: 290, y: 235, isNatural: true, ...p6Nat },
    { name: 'West Third', x: 40, y: 160, ...westThird },
    { name: 'East Third', x: 320, y: 160, ...eastThird },
    { name: 'Mid Third NW', x: 120, y: 130, ...midThirdNW },
    { name: 'Mid Third NE', x: 240, y: 130, ...midThirdNE },
    { name: 'Mid Third SW', x: 120, y: 190, ...midThirdSW },
    { name: 'Mid Third SE', x: 240, y: 190, ...midThirdSE },
    { name: 'Gold NW', x: 100, y: 130, ...goldNW },
    { name: 'Gold NE', x: 260, y: 130, ...goldNE },
    { name: 'Gold SW', x: 100, y: 190, ...goldSW },
    { name: 'Gold SE', x: 260, y: 190, ...goldSE },
    { name: 'Center', x: 180, y: 160, ...center },
  ];

  return {
    id: 'contested_frontier',
    name: 'Contested Frontier',
    author: 'VOIDSTRIKE Team',
    description: 'A 6-player map designed for 3v3 team games. Two rows of players face off across a contested center with multiple expansion paths.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    spawns: [
      { x: 50, y: 45, playerSlot: 1, rotation: Math.PI / 2 },
      { x: 180, y: 45, playerSlot: 2, rotation: Math.PI / 2 },
      { x: 310, y: 45, playerSlot: 3, rotation: Math.PI / 2 },
      { x: 50, y: 275, playerSlot: 4, rotation: -Math.PI / 2 },
      { x: 180, y: 275, playerSlot: 5, rotation: -Math.PI / 2 },
      { x: 310, y: 275, playerSlot: 6, rotation: -Math.PI / 2 },
    ],

    expansions,

    watchTowers: [
      { x: 180, y: 160, radius: 28 },
      { x: 100, y: 160, radius: 20 },
      { x: 260, y: 160, radius: 20 },
      { x: 180, y: 115, radius: 18 },
      { x: 180, y: 205, radius: 18 },
    ],

    ramps,

    destructibles: [
      { x: 130, y: 160, health: 2000 },
      { x: 230, y: 160, health: 2000 },
      { x: 115, y: 130, health: 1500 },
      { x: 245, y: 130, health: 1500 },
      { x: 115, y: 190, health: 1500 },
      { x: 245, y: 190, health: 1500 },
    ],

    decorations: generateJungleDecorations(),

    playerCount: 6,
    maxPlayers: 6,
    isRanked: true,

    biome: 'jungle',
    fogNear: 110,
    fogFar: 350,
  };
}

export const CONTESTED_FRONTIER = generateContestedFrontier();

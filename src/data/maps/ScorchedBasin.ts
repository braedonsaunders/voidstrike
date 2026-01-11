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
  createMudArea,
  autoFixConnectivity,
  validateMapConnectivity,
} from './MapTypes';

/**
 * SCORCHED BASIN - 4 Player Map
 *
 * A large 4-player map with corner spawns and desert/volcanic biome.
 * Each player has a protected main base with natural expansion nearby.
 *
 * Key Features:
 * - 4 corner spawn positions with protected mains
 * - Each main has single ramp exit toward natural
 * - Multiple expansion locations for economic development
 * - Central contested area with watch tower
 * - Multiple attack paths between players
 *
 * Layout (280x280):
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ █ P1 MAIN █                                         █ P2 MAIN █ │
 *   │ █████↓█████     [Third]         [Third]           █████↓█████ │
 *   │   [P1 NAT]         │               │              [P2 NAT]     │
 *   │       ↓                                                ↓       │
 *   │   [Third]                                          [Third]     │
 *   │                        ████████████                            │
 *   │        [Gold]          ██ CENTER ██          [Gold]            │
 *   │                        ██ TOWER  ██                            │
 *   │                        ████████████                            │
 *   │   [Third]                                          [Third]     │
 *   │       ↑                                                ↑       │
 *   │   [P3 NAT]                                         [P4 NAT]    │
 *   │ █████↑█████     [Third]         [Third]           █████↑█████ │
 *   │ █ P3 MAIN █                                         █ P4 MAIN █ │
 *   └──────────────────────────────────────────────────────────────────┘
 */

const MAP_WIDTH = 280;
const MAP_HEIGHT = 280;

// Seeded random for consistent decorations
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// Base exclusion zones - no decorations here
const BASE_EXCLUSION_ZONES = [
  // Main bases
  { x: 40, y: 40, radius: 26 },     // P1 main (top-left)
  { x: 240, y: 40, radius: 26 },    // P2 main (top-right)
  { x: 40, y: 240, radius: 26 },    // P3 main (bottom-left)
  { x: 240, y: 240, radius: 26 },   // P4 main (bottom-right)
  // Natural expansions
  { x: 75, y: 75, radius: 18 },     // P1 natural
  { x: 205, y: 75, radius: 18 },    // P2 natural
  { x: 75, y: 205, radius: 18 },    // P3 natural
  { x: 205, y: 205, radius: 18 },   // P4 natural
  // Third expansions
  { x: 40, y: 140, radius: 16 },    // P1/P3 shared third (left)
  { x: 240, y: 140, radius: 16 },   // P2/P4 shared third (right)
  { x: 140, y: 40, radius: 16 },    // P1/P2 shared third (top)
  { x: 140, y: 240, radius: 16 },   // P3/P4 shared third (bottom)
  // Center
  { x: 140, y: 140, radius: 22 },   // Center contested
  // Gold expansions
  { x: 90, y: 190, radius: 14 },    // Gold 1
  { x: 190, y: 90, radius: 14 },    // Gold 2
  { x: 90, y: 90, radius: 14 },     // Gold 3
  { x: 190, y: 190, radius: 14 },   // Gold 4
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

function generateDesertDecorations(): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(789);

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
        scale: 0.4 + rand() * 0.8,
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
        scale: 0.6 + rand() * 0.5,
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

  // Helper for massive outer border rocks (2-4x scale) to hide terrain edges
  const addMassiveBorderRocks = (x1: number, y1: number, x2: number, y2: number, density: number = 5) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(length / density);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t + (rand() - 0.5) * 3;
      const y = y1 + dy * t + (rand() - 0.5) * 3;
      const rockType = rand() < 0.6 ? 'rocks_large' : 'rocks_small';
      decorations.push({
        type: rockType,
        x, y,
        scale: 2.0 + rand() * 2.0,
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
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.4;
      const dist = radius + 4 + rand() * 6;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y)) continue;
      decorations.push({
        type: 'tree_dead',
        x, y,
        scale: 0.6 + rand() * 0.5,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // ========================================
  // MAIN BASE EDGE DECORATIONS - Heavy rocks and trees
  // ========================================

  // P1 Main (40, 40) - radius 25, cliff width 4
  addBaseEdgeRocks(40, 40, 29, 24);
  addBaseEdgeTrees(40, 40, 32, 16);

  // P2 Main (240, 40)
  addBaseEdgeRocks(240, 40, 29, 24);
  addBaseEdgeTrees(240, 40, 32, 16);

  // P3 Main (40, 240)
  addBaseEdgeRocks(40, 240, 29, 24);
  addBaseEdgeTrees(40, 240, 32, 16);

  // P4 Main (240, 240)
  addBaseEdgeRocks(240, 240, 29, 24);
  addBaseEdgeTrees(240, 240, 32, 16);

  // ========================================
  // NATURAL EXPANSION EDGE DECORATIONS
  // ========================================

  addBaseEdgeRocks(75, 75, 19, 16);
  addBaseEdgeTrees(75, 75, 22, 12);
  addBaseEdgeRocks(205, 75, 19, 16);
  addBaseEdgeTrees(205, 75, 22, 12);
  addBaseEdgeRocks(75, 205, 19, 16);
  addBaseEdgeTrees(75, 205, 22, 12);
  addBaseEdgeRocks(205, 205, 19, 16);
  addBaseEdgeTrees(205, 205, 22, 12);

  // ========================================
  // CONTINUOUS ROCK CLIFF WALLS
  // ========================================

  // Map border cliffs - continuous rock walls
  addRockCliffLine(15, 15, 15, 265, 3);
  addRockCliffLine(265, 15, 265, 265, 3);
  addRockCliffLine(15, 15, 265, 15, 3);
  addRockCliffLine(15, 265, 265, 265, 3);

  // Massive outer border rocks (2-4x scale) to hide terrain edges
  addMassiveBorderRocks(6, 6, 6, 274, 5);      // Left edge (outer)
  addMassiveBorderRocks(274, 6, 274, 274, 5);  // Right edge (outer)
  addMassiveBorderRocks(6, 6, 274, 6, 5);      // Top edge (outer)
  addMassiveBorderRocks(6, 274, 274, 274, 5);  // Bottom edge (outer)

  // Natural chokepoint walls
  addRockCliffLine(88, 60, 100, 90, 2);
  addRockCliffLine(180, 60, 192, 90, 2);
  addRockCliffLine(88, 190, 100, 220, 2);
  addRockCliffLine(180, 190, 192, 220, 2);

  // Central obstacle cliff faces
  addRockCliffLine(120, 120, 160, 120, 2);
  addRockCliffLine(120, 160, 160, 160, 2);
  addRockCliffLine(120, 120, 120, 160, 2);
  addRockCliffLine(160, 120, 160, 160, 2);

  // Corner cliff extensions from main bases
  addRockCliffLine(12, 55, 27, 70, 2);
  addRockCliffLine(55, 12, 70, 27, 2);
  addRockCliffLine(253, 55, 268, 70, 2);
  addRockCliffLine(210, 12, 225, 27, 2);
  addRockCliffLine(12, 210, 27, 225, 2);
  addRockCliffLine(55, 253, 70, 268, 2);
  addRockCliffLine(253, 210, 268, 225, 2);
  addRockCliffLine(210, 253, 225, 268, 2);

  // ========================================
  // ORIGINAL DECORATIONS (enhanced)
  // ========================================

  // Map border decorations
  for (let i = 15; i < MAP_WIDTH - 15; i += 12) {
    addRockCluster(i, 12, 4, 5);
    addRockCluster(i, MAP_HEIGHT - 12, 4, 5);
    addRockCluster(12, i, 4, 5);
    addRockCluster(MAP_WIDTH - 12, i, 4, 5);
  }

  // Main base cliff edges - additional clusters
  addRockCluster(25, 60, 12, 8);
  addRockCluster(55, 25, 12, 8);
  addRockCluster(225, 25, 12, 8);
  addRockCluster(255, 60, 12, 8);
  addRockCluster(25, 220, 12, 8);
  addRockCluster(55, 255, 12, 8);
  addRockCluster(225, 255, 12, 8);
  addRockCluster(255, 220, 12, 8);

  // Natural expansion surroundings - more trees
  addDeadTrees(60, 90, 12, 8);
  addDeadTrees(220, 90, 12, 8);
  addDeadTrees(60, 190, 12, 8);
  addDeadTrees(220, 190, 12, 8);

  // Central area - heavy rocks and crystals
  addCrystalCluster(140, 120, 18, 12);
  addCrystalCluster(140, 160, 18, 12);
  addRockCluster(120, 140, 15, 10);
  addRockCluster(160, 140, 15, 10);

  // Chokepoint decorations - more rocks
  addRockCluster(100, 140, 12, 8);
  addRockCluster(180, 140, 12, 8);
  addRockCluster(140, 100, 12, 8);
  addRockCluster(140, 180, 12, 8);

  // Gold expansion decorations
  addCrystalCluster(90, 90, 8, 6);
  addCrystalCluster(190, 90, 8, 6);
  addCrystalCluster(90, 190, 8, 6);
  addCrystalCluster(190, 190, 8, 6);
  addRockCluster(100, 100, 6, 5);
  addRockCluster(180, 100, 6, 5);
  addRockCluster(100, 180, 6, 5);
  addRockCluster(180, 180, 6, 5);

  // Third expansion decorations - more trees
  addDeadTrees(35, 125, 10, 7);
  addDeadTrees(35, 155, 10, 7);
  addDeadTrees(245, 125, 10, 7);
  addDeadTrees(245, 155, 10, 7);
  addDeadTrees(125, 35, 10, 7);
  addDeadTrees(155, 35, 10, 7);
  addDeadTrees(125, 245, 10, 7);
  addDeadTrees(155, 245, 10, 7);

  // Scattered vegetation
  for (let i = 0; i < 150; i++) {
    const x = 20 + rand() * (MAP_WIDTH - 40);
    const y = 20 + rand() * (MAP_HEIGHT - 40);
    if (isInBaseArea(x, y)) continue;

    const type = rand() > 0.6 ? 'bush' : 'grass_clump';
    decorations.push({
      type,
      x, y,
      scale: 0.4 + rand() * 0.5,
      rotation: rand() * Math.PI * 2,
    });
  }

  // Debris
  decorations.push({ type: 'debris', x: 130, y: 130, scale: 1.0 });
  decorations.push({ type: 'debris', x: 150, y: 150, scale: 1.0 });
  decorations.push({ type: 'ruined_wall', x: 140, y: 140, scale: 1.2 });

  // Escape pods in corners
  decorations.push({ type: 'escape_pod', x: 15, y: 15, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 265, y: 15, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 15, y: 265, scale: 0.9 });
  decorations.push({ type: 'escape_pod', x: 265, y: 265, scale: 0.9 });

  return decorations;
}

function generateScorchedBasin(): MapData {
  const terrain = createTerrainGrid(MAP_WIDTH, MAP_HEIGHT, 'ground', 0);

  // ========================================
  // MAP BORDERS - Thick unwalkable cliffs
  // ========================================
  fillTerrainRect(terrain, 0, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 12, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 12, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 12, MAP_WIDTH, 12, 'unwalkable');

  // ========================================
  // RAMPS - Must be created BEFORE raised platforms
  // ========================================
  const ramps = [
    // P1 Main ramp (southeast)
    { x: 55, y: 55, width: 10, height: 10, direction: 'east' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // P2 Main ramp (southwest)
    { x: 215, y: 55, width: 10, height: 10, direction: 'west' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // P3 Main ramp (northeast)
    { x: 55, y: 215, width: 10, height: 10, direction: 'east' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // P4 Main ramp (northwest)
    { x: 215, y: 215, width: 10, height: 10, direction: 'west' as const, fromElevation: 2 as const, toElevation: 1 as const },
    // Natural to low ground ramps
    { x: 88, y: 75, width: 8, height: 8, direction: 'east' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 184, y: 75, width: 8, height: 8, direction: 'west' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 88, y: 197, width: 8, height: 8, direction: 'east' as const, fromElevation: 1 as const, toElevation: 0 as const },
    { x: 184, y: 197, width: 8, height: 8, direction: 'west' as const, fromElevation: 1 as const, toElevation: 0 as const },
  ];
  ramps.forEach(ramp => createRampInTerrain(terrain, ramp));

  // ========================================
  // MAIN BASES - Raised platforms with cliff edges (Elevation 2)
  // ========================================
  createRaisedPlatform(terrain, 40, 40, 25, 2, 4);     // P1 Main (top-left)
  createRaisedPlatform(terrain, 240, 40, 25, 2, 4);    // P2 Main (top-right)
  createRaisedPlatform(terrain, 40, 240, 25, 2, 4);    // P3 Main (bottom-left)
  createRaisedPlatform(terrain, 240, 240, 25, 2, 4);   // P4 Main (bottom-right)

  // ========================================
  // NATURAL EXPANSIONS - Raised platforms (Elevation 1)
  // ========================================
  createRaisedPlatform(terrain, 75, 75, 16, 1, 3);     // P1 Natural
  createRaisedPlatform(terrain, 205, 75, 16, 1, 3);    // P2 Natural
  createRaisedPlatform(terrain, 75, 205, 16, 1, 3);    // P3 Natural
  createRaisedPlatform(terrain, 205, 205, 16, 1, 3);   // P4 Natural

  // ========================================
  // THIRD EXPANSIONS - Elevation 0 (shared sides)
  // ========================================

  // Left side third (between P1 and P3)
  fillTerrainCircle(terrain, 40, 140, 18, 'ground', 0);
  // Right side third (between P2 and P4)
  fillTerrainCircle(terrain, 240, 140, 18, 'ground', 0);
  // Top third (between P1 and P2)
  fillTerrainCircle(terrain, 140, 40, 18, 'ground', 0);
  // Bottom third (between P3 and P4)
  fillTerrainCircle(terrain, 140, 240, 18, 'ground', 0);

  // ========================================
  // GOLD EXPANSIONS - High risk, high reward
  // ========================================

  // Gold 1 (P1-P3 diagonal)
  fillTerrainCircle(terrain, 90, 190, 14, 'ground', 0);
  // Gold 2 (P2-P4 diagonal)
  fillTerrainCircle(terrain, 190, 90, 14, 'ground', 0);
  // Gold 3 (P1-P2 inner)
  fillTerrainCircle(terrain, 90, 90, 14, 'ground', 0);
  // Gold 4 (P3-P4 inner)
  fillTerrainCircle(terrain, 190, 190, 14, 'ground', 0);

  // ========================================
  // CENTER - Major contested area
  // ========================================
  fillTerrainCircle(terrain, 140, 140, 24, 'ground', 0);

  // Central obstacle
  fillTerrainRect(terrain, 130, 130, 20, 20, 'unwalkable');

  // ========================================
  // TERRAIN FEATURES - Chokepoints
  // ========================================

  // Inner ring cliffs (create 4-way symmetry chokepoints)
  fillTerrainCircle(terrain, 100, 100, 12, 'unwalkable');
  fillTerrainCircle(terrain, 180, 100, 12, 'unwalkable');
  fillTerrainCircle(terrain, 100, 180, 12, 'unwalkable');
  fillTerrainCircle(terrain, 180, 180, 12, 'unwalkable');

  // Side cliffs
  fillTerrainCircle(terrain, 70, 140, 10, 'unwalkable');
  fillTerrainCircle(terrain, 210, 140, 10, 'unwalkable');
  fillTerrainCircle(terrain, 140, 70, 10, 'unwalkable');
  fillTerrainCircle(terrain, 140, 210, 10, 'unwalkable');

  // ========================================
  // NEW TERRAIN FEATURES - Desert/Volcanic theme
  // ========================================

  // LAVA LAKES (void) - Impassable volcanic hazards
  createLake(terrain, 60, 60, 8, 2);     // NW corner
  createLake(terrain, 220, 60, 8, 2);    // NE corner
  createLake(terrain, 60, 220, 8, 2);    // SW corner
  createLake(terrain, 220, 220, 8, 2);   // SE corner

  // RIVERS of lava - Cross map barriers with bridges
  createRiver(terrain, 140, 40, 140, 100, 8, 0.5, 6);   // North river
  createRiver(terrain, 140, 180, 140, 240, 8, 0.5, 6);  // South river
  createRiver(terrain, 40, 140, 100, 140, 8, 0.5, 6);   // West river
  createRiver(terrain, 180, 140, 240, 140, 8, 0.5, 6);  // East river

  // FOREST CORRIDORS (dead scorched trees) - Flanking routes
  // Diagonal corridors between player bases
  createForestCorridor(terrain, 60, 100, 100, 60, 14, 5, true);   // P1-P2 diagonal
  createForestCorridor(terrain, 180, 60, 220, 100, 14, 5, true);  // P2-P4 diagonal
  createForestCorridor(terrain, 60, 180, 100, 220, 14, 5, true);  // P1-P3 diagonal
  createForestCorridor(terrain, 180, 220, 220, 180, 14, 5, true); // P3-P4 diagonal

  // ROADS - Fast movement main paths
  // Cross roads through center
  createRoad(terrain, 40, 140, 100, 140, 4);
  createRoad(terrain, 180, 140, 240, 140, 4);
  createRoad(terrain, 140, 40, 140, 100, 4);
  createRoad(terrain, 140, 180, 140, 240, 4);
  // Diagonal express routes
  createRoad(terrain, 75, 75, 90, 90, 3);
  createRoad(terrain, 205, 75, 190, 90, 3);
  createRoad(terrain, 75, 205, 90, 190, 3);
  createRoad(terrain, 205, 205, 190, 190, 3);

  // SCATTERED FORESTS - Sparse desert scrub (3x more - strategic clusters)
  scatterForests(terrain, MAP_WIDTH, MAP_HEIGHT, 85, 4, 10, BASE_EXCLUSION_ZONES, 333, 0.25);

  // DENSE FORESTS - Oasis-like cover points near gold bases
  fillFeatureCircle(terrain, 90, 90, 8, 'forest_dense');
  fillFeatureCircle(terrain, 190, 90, 8, 'forest_dense');
  fillFeatureCircle(terrain, 90, 190, 8, 'forest_dense');
  fillFeatureCircle(terrain, 190, 190, 8, 'forest_dense');

  // STRATEGIC OASIS CLUSTERS - Desert map has fewer but larger strategic patches
  // Cross-map oasis walls creating lanes
  fillFeatureRect(terrain, 120, 60, 10, 25, 'forest_dense');   // North-center oasis wall
  fillFeatureRect(terrain, 150, 195, 10, 25, 'forest_dense');  // South-center oasis wall
  fillFeatureRect(terrain, 60, 120, 25, 10, 'forest_dense');   // West-center oasis wall
  fillFeatureRect(terrain, 195, 150, 25, 10, 'forest_dense');  // East-center oasis wall

  // Corner oasis clusters for flanking routes
  fillFeatureCircle(terrain, 60, 60, 9, 'forest_dense');       // NW corner oasis
  fillFeatureCircle(terrain, 220, 60, 9, 'forest_dense');      // NE corner oasis
  fillFeatureCircle(terrain, 60, 220, 9, 'forest_dense');      // SW corner oasis
  fillFeatureCircle(terrain, 220, 220, 9, 'forest_dense');     // SE corner oasis

  // Mid-map strategic oasis points
  fillFeatureCircle(terrain, 110, 90, 6, 'forest_dense');      // P1-P2 approach
  fillFeatureCircle(terrain, 170, 90, 6, 'forest_dense');      // P2-P4 approach
  fillFeatureCircle(terrain, 90, 110, 6, 'forest_dense');      // P1-P3 approach
  fillFeatureCircle(terrain, 110, 170, 6, 'forest_dense');     // P3-P4 approach
  fillFeatureCircle(terrain, 170, 190, 6, 'forest_dense');     // South cross
  fillFeatureCircle(terrain, 190, 170, 6, 'forest_dense');     // East cross

  // MUD/SAND areas - Scorched earth slow zones
  createMudArea(terrain, 140, 140, 15);  // Center contested
  createMudArea(terrain, 110, 110, 6);
  createMudArea(terrain, 170, 110, 6);
  createMudArea(terrain, 110, 170, 6);
  createMudArea(terrain, 170, 170, 6);

  // Light forest cover along edges - expanded
  fillFeatureCircle(terrain, 40, 100, 6, 'forest_light');
  fillFeatureCircle(terrain, 40, 180, 6, 'forest_light');
  fillFeatureCircle(terrain, 240, 100, 6, 'forest_light');
  fillFeatureCircle(terrain, 240, 180, 6, 'forest_light');
  // Additional light forest clusters
  fillFeatureCircle(terrain, 100, 40, 6, 'forest_light');      // North edge
  fillFeatureCircle(terrain, 180, 40, 6, 'forest_light');      // North edge
  fillFeatureCircle(terrain, 100, 240, 6, 'forest_light');     // South edge
  fillFeatureCircle(terrain, 180, 240, 6, 'forest_light');     // South edge
  fillFeatureCircle(terrain, 80, 140, 5, 'forest_light');      // West mid
  fillFeatureCircle(terrain, 200, 140, 5, 'forest_light');     // East mid
  fillFeatureCircle(terrain, 140, 80, 5, 'forest_light');      // North mid
  fillFeatureCircle(terrain, 140, 200, 5, 'forest_light');     // South mid

  // ========================================
  // EXPANSIONS WITH RESOURCES
  // Standard: 6x 1500 + 2x 900 minerals per base, 2250 gas per geyser
  // Gold: all 8 patches at 900 minerals
  // ========================================
  const p1Main = createBaseResources(40, 40, DIR.UP_LEFT);       // Standard
  const p1Nat = createBaseResources(75, 75, DIR.UP_LEFT, 1500, 2250, false, 10);    // Natural: minerals further from ramp
  const p2Main = createBaseResources(240, 40, DIR.UP_RIGHT);     // Standard
  const p2Nat = createBaseResources(205, 75, DIR.UP_RIGHT, 1500, 2250, false, 10); // Natural: minerals further from ramp
  const p3Main = createBaseResources(40, 240, DIR.DOWN_LEFT);    // Standard
  const p3Nat = createBaseResources(75, 205, DIR.DOWN_LEFT, 1500, 2250, false, 10); // Natural: minerals further from ramp
  const p4Main = createBaseResources(240, 240, DIR.DOWN_RIGHT);  // Standard
  const p4Nat = createBaseResources(205, 205, DIR.DOWN_RIGHT, 1500, 2250, false, 10); // Natural: minerals further from ramp
  const westThird = createBaseResources(40, 140, DIR.LEFT);      // Standard
  const eastThird = createBaseResources(240, 140, DIR.RIGHT);    // Standard
  const northThird = createBaseResources(140, 40, DIR.UP);       // Standard
  const southThird = createBaseResources(140, 240, DIR.DOWN);    // Standard
  const goldSW = createBaseResources(90, 190, DIR.DOWN_LEFT, 1500, 2250, true);   // Gold
  const goldNE = createBaseResources(190, 90, DIR.UP_RIGHT, 1500, 2250, true);    // Gold
  const goldNW = createBaseResources(90, 90, DIR.UP_LEFT, 1500, 2250, true);      // Gold
  const goldSE = createBaseResources(190, 190, DIR.DOWN_RIGHT, 1500, 2250, true); // Gold
  const center = createBaseResources(140, 140, DIR.DOWN, 1500, 2250, true);       // Gold (contested)

  const expansions = [
    { name: 'P1 Main', x: 40, y: 40, isMain: true, ...p1Main },
    { name: 'P1 Natural', x: 75, y: 75, isNatural: true, ...p1Nat },
    { name: 'P2 Main', x: 240, y: 40, isMain: true, ...p2Main },
    { name: 'P2 Natural', x: 205, y: 75, isNatural: true, ...p2Nat },
    { name: 'P3 Main', x: 40, y: 240, isMain: true, ...p3Main },
    { name: 'P3 Natural', x: 75, y: 205, isNatural: true, ...p3Nat },
    { name: 'P4 Main', x: 240, y: 240, isMain: true, ...p4Main },
    { name: 'P4 Natural', x: 205, y: 205, isNatural: true, ...p4Nat },
    { name: 'West Third', x: 40, y: 140, ...westThird },
    { name: 'East Third', x: 240, y: 140, ...eastThird },
    { name: 'North Third', x: 140, y: 40, ...northThird },
    { name: 'South Third', x: 140, y: 240, ...southThird },
    { name: 'Gold Southwest', x: 90, y: 190, ...goldSW },
    { name: 'Gold Northeast', x: 190, y: 90, ...goldNE },
    { name: 'Gold Northwest', x: 90, y: 90, ...goldNW },
    { name: 'Gold Southeast', x: 190, y: 190, ...goldSE },
    { name: 'Center', x: 140, y: 140, ...center },
  ];

  const mapData: MapData = {
    id: 'scorched_basin',
    name: 'Scorched Basin',
    author: 'VOIDSTRIKE Team',
    description: 'A 4-player map with protected corner bases. Each player has a secure main with natural expansion nearby. Multiple attack paths and shared expansions create dynamic gameplay.',

    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    terrain,

    // ONLY main base spawn points - 4 players
    spawns: [
      { x: 40, y: 40, playerSlot: 1, rotation: Math.PI / 4 },            // P1 Main (top-left)
      { x: 240, y: 40, playerSlot: 2, rotation: Math.PI * 3 / 4 },       // P2 Main (top-right)
      { x: 40, y: 240, playerSlot: 3, rotation: -Math.PI / 4 },          // P3 Main (bottom-left)
      { x: 240, y: 240, playerSlot: 4, rotation: -Math.PI * 3 / 4 },     // P4 Main (bottom-right)
    ],

    expansions,

    watchTowers: [
      { x: 140, y: 140, radius: 26 },  // Center - primary control
      { x: 100, y: 140, radius: 18 },  // West mid
      { x: 180, y: 140, radius: 18 },  // East mid
      { x: 140, y: 100, radius: 18 },  // North mid
      { x: 140, y: 180, radius: 18 },  // South mid
    ],

    ramps,

    destructibles: [
      // Rocks blocking gold bases
      { x: 100, y: 100, health: 2000 },
      { x: 180, y: 100, health: 2000 },
      { x: 100, y: 180, health: 2000 },
      { x: 180, y: 180, health: 2000 },
      // Center rocks
      { x: 130, y: 115, health: 1500 },
      { x: 150, y: 165, health: 1500 },
      // Side passage rocks
      { x: 60, y: 140, health: 1500 },
      { x: 220, y: 140, health: 1500 },
    ],

    decorations: generateDesertDecorations(),

    playerCount: 4,
    maxPlayers: 4,
    isRanked: true,

    biome: 'desert',
    fogNear: 100,
    fogFar: 300,
  };

  // CRITICAL: Validate and fix connectivity to ensure all areas are reachable
  const validation = validateMapConnectivity(mapData);
  if (!validation.isValid) {
    console.warn('[ScorchedBasin] Map has connectivity issues, attempting auto-fix...');
    console.warn('[ScorchedBasin] Unreachable locations:', validation.unreachableLocations);
    const corridorsCarved = autoFixConnectivity(mapData);
    console.log(`[ScorchedBasin] Auto-fix carved ${corridorsCarved} corridors`);

    const postFixValidation = validateMapConnectivity(mapData);
    if (!postFixValidation.isValid) {
      console.error('[ScorchedBasin] CRITICAL: Map still has unreachable areas after auto-fix!');
      console.error('[ScorchedBasin] Still unreachable:', postFixValidation.unreachableLocations);
    } else {
      console.log('[ScorchedBasin] Connectivity fixed successfully');
    }
  } else {
    console.log('[ScorchedBasin] Map connectivity validated - all areas reachable');
  }

  return mapData;
}

export const SCORCHED_BASIN = generateScorchedBasin();

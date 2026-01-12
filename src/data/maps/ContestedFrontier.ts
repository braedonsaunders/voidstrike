import {
  MapData,
  MapDecoration,
  createBaseResources,
  DIR,
  fillTerrainRect,
  fillTerrainCircle,
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
  // New topology system
  generateTerrainFromTopology,
  mainBase,
  naturalExpansion,
  expansion,
  connect,
  getRampClearanceZones,
  type MapTopology,
} from './MapTypes';

/**
 * CONTESTED FRONTIER - 6 Player (3v3) Map
 *
 * A large-scale team map with jungle biome.
 * Designed for 3v3 battles with team positions on opposite sides.
 *
 * Key Features:
 * - 6 spawn positions (3 per side, top vs bottom)
 * - Protected main bases with single ramp
 * - Natural expansions near each main
 * - Shared resources in the contested center
 * - Rivers creating strategic chokepoints
 *
 * Layout (360x320):
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ ██P1██         ██P2██         ██P3██                              │
 *   │ ███↓███        ███↓███        ███↓███                              │
 *   │  [NAT]          [NAT]          [NAT]                               │
 *   │    ↓              ↓              ↓                                 │
 *   │ [Third]  [Gold] ════════ [Gold]  [Third]                          │
 *   │          ════ [CENTER] ════                                        │
 *   │ [Third]  [Gold] ════════ [Gold]  [Third]                          │
 *   │    ↑              ↑              ↑                                 │
 *   │  [NAT]          [NAT]          [NAT]                               │
 *   │ ███↑███        ███↑███        ███↑███                              │
 *   │ ██P4██         ██P5██         ██P6██                              │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * USES NEW TOPOLOGY SYSTEM - Ramp connectivity guaranteed by design
 */

const MAP_WIDTH = 360;
const MAP_HEIGHT = 320;

// Seeded random for consistent decorations
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// Base exclusion zones - no decorations here
const BASE_EXCLUSION_ZONES = [
  // Top row
  { x: 50, y: 45, radius: 24 },
  { x: 180, y: 45, radius: 24 },
  { x: 310, y: 45, radius: 24 },
  // Bottom row
  { x: 50, y: 275, radius: 24 },
  { x: 180, y: 275, radius: 24 },
  { x: 310, y: 275, radius: 24 },
  // Naturals top
  { x: 70, y: 85, radius: 18 },
  { x: 180, y: 85, radius: 18 },
  { x: 290, y: 85, radius: 18 },
  // Naturals bottom
  { x: 70, y: 235, radius: 18 },
  { x: 180, y: 235, radius: 18 },
  { x: 290, y: 235, radius: 18 },
  // Center
  { x: 180, y: 160, radius: 24 },
  // Thirds
  { x: 40, y: 160, radius: 16 },
  { x: 320, y: 160, radius: 16 },
  // Golds
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

function isInRampClearance(x: number, y: number, clearanceZones: Set<string>): boolean {
  return clearanceZones.has(`${Math.floor(x)},${Math.floor(y)}`);
}

function generateJungleDecorations(rampClearance: Set<string>): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const rand = seededRandom(654);

  const addTreeCluster = (cx: number, cy: number, count: number, spread: number) => {
    const treeTypes: Array<'tree_pine_tall' | 'tree_pine_medium' | 'tree_alien'> = ['tree_pine_tall', 'tree_pine_medium', 'tree_alien'];
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearance(x, y, rampClearance)) continue;
      decorations.push({
        type: treeTypes[Math.floor(rand() * treeTypes.length)],
        x, y,
        scale: 0.7 + rand() * 0.5,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  const addRockCluster = (cx: number, cy: number, count: number, spread: number) => {
    const rockTypes: Array<'rocks_large' | 'rocks_small' | 'rock_single'> = ['rocks_large', 'rocks_small', 'rock_single'];
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * spread;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearance(x, y, rampClearance)) continue;
      decorations.push({
        type: rockTypes[Math.floor(rand() * rockTypes.length)],
        x, y,
        scale: 0.4 + rand() * 0.6,
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
      if (isInBaseArea(x, y) || isInRampClearance(x, y, rampClearance)) continue;
      decorations.push({
        type: 'crystal_formation',
        x, y,
        scale: 0.5 + rand() * 0.7,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  const addRockCliffLine = (x1: number, y1: number, x2: number, y2: number, density: number = 2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(length / density);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t + (rand() - 0.5) * 2;
      const y = y1 + dy * t + (rand() - 0.5) * 2;
      if (isInBaseArea(x, y) || isInRampClearance(x, y, rampClearance)) continue;
      const rockType = rand() < 0.4 ? 'rocks_large' : (rand() < 0.7 ? 'rocks_small' : 'rock_single');
      decorations.push({
        type: rockType,
        x, y,
        scale: 0.6 + rand() * 0.6,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

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

  const addBaseEdgeRocks = (cx: number, cy: number, radius: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.3;
      const dist = radius + 2 + rand() * 4;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearance(x, y, rampClearance)) continue;
      const rockType = rand() < 0.3 ? 'rocks_large' : (rand() < 0.6 ? 'rocks_small' : 'rock_single');
      decorations.push({
        type: rockType,
        x, y,
        scale: 0.5 + rand() * 0.6,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  const addBaseEdgeTrees = (cx: number, cy: number, radius: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.4;
      const dist = radius + 4 + rand() * 6;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (isInBaseArea(x, y) || isInRampClearance(x, y, rampClearance)) continue;
      const treeTypes: Array<'tree_pine_tall' | 'tree_pine_medium'> = ['tree_pine_tall', 'tree_pine_medium'];
      decorations.push({
        type: treeTypes[Math.floor(rand() * treeTypes.length)],
        x, y,
        scale: 0.6 + rand() * 0.5,
        rotation: rand() * Math.PI * 2,
      });
    }
  };

  // Main base edges
  [
    { x: 50, y: 45 }, { x: 180, y: 45 }, { x: 310, y: 45 },
    { x: 50, y: 275 }, { x: 180, y: 275 }, { x: 310, y: 275 }
  ].forEach(pos => {
    addBaseEdgeRocks(pos.x, pos.y, 29, 20);
    addBaseEdgeTrees(pos.x, pos.y, 32, 14);
  });

  // Natural edges
  [
    { x: 70, y: 85 }, { x: 180, y: 85 }, { x: 290, y: 85 },
    { x: 70, y: 235 }, { x: 180, y: 235 }, { x: 290, y: 235 }
  ].forEach(pos => {
    addBaseEdgeRocks(pos.x, pos.y, 19, 14);
    addBaseEdgeTrees(pos.x, pos.y, 22, 10);
  });

  // Map borders
  addRockCliffLine(15, 15, 15, 305, 4);
  addRockCliffLine(345, 15, 345, 305, 4);
  addRockCliffLine(15, 15, 345, 15, 4);
  addRockCliffLine(15, 305, 345, 305, 4);

  addMassiveBorderRocks(5, 5, 5, 315, 6);
  addMassiveBorderRocks(355, 5, 355, 315, 6);
  addMassiveBorderRocks(5, 5, 355, 5, 6);
  addMassiveBorderRocks(5, 315, 355, 315, 6);

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

  // Map borders - dense jungle
  for (let i = 15; i < MAP_WIDTH - 15; i += 15) {
    addTreeCluster(i, 12, 8, 7);
    addTreeCluster(i, MAP_HEIGHT - 12, 8, 7);
  }
  for (let i = 15; i < MAP_HEIGHT - 15; i += 15) {
    addTreeCluster(12, i, 8, 7);
    addTreeCluster(MAP_WIDTH - 12, i, 8, 7);
  }

  // Main base surroundings
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

  // Central area
  addCrystalCluster(180, 140, 24, 18);
  addCrystalCluster(180, 180, 24, 18);
  addRockCluster(160, 160, 20, 15);
  addRockCluster(200, 160, 20, 15);

  // Between-base paths
  addTreeCluster(115, 45, 12, 8);
  addTreeCluster(245, 45, 12, 8);
  addTreeCluster(115, 275, 12, 8);
  addTreeCluster(245, 275, 12, 8);

  // Gold expansion surroundings
  addCrystalCluster(100, 130, 12, 8);
  addCrystalCluster(260, 130, 12, 8);
  addCrystalCluster(100, 190, 12, 8);
  addCrystalCluster(260, 190, 12, 8);
  addRockCluster(110, 140, 8, 6);
  addRockCluster(250, 140, 8, 6);
  addRockCluster(110, 180, 8, 6);
  addRockCluster(250, 180, 8, 6);

  // Third expansion surroundings
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
  // ========================================
  // TOPOLOGY DEFINITION - Graph-first terrain generation
  // ========================================
  const topology: MapTopology = {
    areas: [
      // Top row main bases
      mainBase('p1_main', 50, 45, 22, 2, 4),
      mainBase('p2_main', 180, 45, 22, 2, 4),
      mainBase('p3_main', 310, 45, 22, 2, 4),

      // Bottom row main bases
      mainBase('p4_main', 50, 275, 22, 2, 4),
      mainBase('p5_main', 180, 275, 22, 2, 4),
      mainBase('p6_main', 310, 275, 22, 2, 4),

      // Top naturals
      naturalExpansion('p1_nat', 70, 85, 14, 1, 3),
      naturalExpansion('p2_nat', 180, 85, 14, 1, 3),
      naturalExpansion('p3_nat', 290, 85, 14, 1, 3),

      // Bottom naturals
      naturalExpansion('p4_nat', 70, 235, 14, 1, 3),
      naturalExpansion('p5_nat', 180, 235, 14, 1, 3),
      naturalExpansion('p6_nat', 290, 235, 14, 1, 3),

      // Side thirds
      expansion('third_left', 'third', 40, 160, 16, 0),
      expansion('third_right', 'third', 320, 160, 16, 0),

      // Mid thirds
      expansion('mid_tl', 'third', 120, 130, 14, 0),
      expansion('mid_tr', 'third', 240, 130, 14, 0),
      expansion('mid_bl', 'third', 120, 190, 14, 0),
      expansion('mid_br', 'third', 240, 190, 14, 0),

      // Gold expansions
      expansion('gold_tl', 'gold', 100, 130, 14, 0),
      expansion('gold_tr', 'gold', 260, 130, 14, 0),
      expansion('gold_bl', 'gold', 100, 190, 14, 0),
      expansion('gold_br', 'gold', 260, 190, 14, 0),

      // Center
      expansion('center', 'center', 180, 160, 26, 0),
    ],

    connections: [
      // Top row: Main to natural (elevation 2 -> 1)
      connect('p1_main', 'p1_nat', 10, 'south'),
      connect('p2_main', 'p2_nat', 10, 'south'),
      connect('p3_main', 'p3_nat', 10, 'south'),

      // Bottom row: Main to natural (elevation 2 -> 1)
      connect('p4_main', 'p4_nat', 10, 'north'),
      connect('p5_main', 'p5_nat', 10, 'north'),
      connect('p6_main', 'p6_nat', 10, 'north'),

      // Natural to low ground (elevation 1 -> 0)
      connect('p1_nat', 'gold_tl', 8, 'south'),
      connect('p2_nat', 'center', 8, 'south'),
      connect('p3_nat', 'gold_tr', 8, 'south'),
      connect('p4_nat', 'gold_bl', 8, 'north'),
      connect('p5_nat', 'center', 8, 'north'),
      connect('p6_nat', 'gold_br', 8, 'north'),
    ],
  };

  // Generate base terrain from topology
  const { terrain, ramps, connections } = generateTerrainFromTopology(
    MAP_WIDTH,
    MAP_HEIGHT,
    topology,
    0 // Default elevation (low ground)
  );

  // Get ramp clearance zones to prevent decorations on ramps
  const rampClearance = getRampClearanceZones(connections);

  // ========================================
  // MAP BORDERS
  // ========================================
  fillTerrainRect(terrain, 0, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, MAP_WIDTH - 12, 0, 12, MAP_HEIGHT, 'unwalkable');
  fillTerrainRect(terrain, 0, 0, MAP_WIDTH, 12, 'unwalkable');
  fillTerrainRect(terrain, 0, MAP_HEIGHT - 12, MAP_WIDTH, 12, 'unwalkable');

  // Natural chokepoint walls
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

  // Central obstacle
  fillTerrainRect(terrain, 168, 148, 24, 24, 'unwalkable');

  // Side cliffs
  fillTerrainCircle(terrain, 70, 160, 12, 'unwalkable');
  fillTerrainCircle(terrain, 290, 160, 12, 'unwalkable');

  // Inner chokepoint cliffs
  fillTerrainCircle(terrain, 130, 160, 10, 'unwalkable');
  fillTerrainCircle(terrain, 230, 160, 10, 'unwalkable');

  // ========================================
  // TERRAIN FEATURES
  // ========================================

  // VOID CHASMS at corners
  createVoidChasm(terrain, 0, 0, 25, 25, 3);
  createVoidChasm(terrain, MAP_WIDTH - 25, 0, 25, 25, 3);
  createVoidChasm(terrain, 0, MAP_HEIGHT - 25, 25, 25, 3);
  createVoidChasm(terrain, MAP_WIDTH - 25, MAP_HEIGHT - 25, 25, 25, 3);

  // RIVERS
  createRiver(terrain, 90, 160, 145, 160, 10, 0.5, 8);
  createRiver(terrain, 215, 160, 270, 160, 10, 0.5, 8);

  // LAKES
  createLake(terrain, 85, 55, 12, 3);
  createLake(terrain, 250, 55, 12, 3);
  createLake(terrain, 85, 265, 12, 3);
  createLake(terrain, 250, 265, 12, 3);

  // FOREST CORRIDORS
  createForestCorridor(terrain, 70, 110, 100, 145, 18, 6, true);
  createForestCorridor(terrain, 290, 110, 260, 145, 18, 6, true);
  createForestCorridor(terrain, 70, 210, 100, 175, 18, 6, true);
  createForestCorridor(terrain, 290, 210, 260, 175, 18, 6, true);

  // Center corridors
  createForestCorridor(terrain, 180, 110, 180, 145, 16, 5, true);
  createForestCorridor(terrain, 180, 175, 180, 210, 16, 5, true);

  // ROADS
  createRoad(terrain, 50, 45, 70, 85, 4);
  createRoad(terrain, 180, 45, 180, 85, 4);
  createRoad(terrain, 310, 45, 290, 85, 4);
  createRoad(terrain, 50, 275, 70, 235, 4);
  createRoad(terrain, 180, 275, 180, 235, 4);
  createRoad(terrain, 310, 275, 290, 235, 4);

  // SCATTERED FORESTS
  scatterForests(terrain, MAP_WIDTH, MAP_HEIGHT, 120, 4, 10, BASE_EXCLUSION_ZONES, 234, 0.30);

  // Dense forest ambush points
  fillFeatureCircle(terrain, 50, 120, 8, 'forest_dense');
  fillFeatureCircle(terrain, 310, 120, 8, 'forest_dense');
  fillFeatureCircle(terrain, 50, 200, 8, 'forest_dense');
  fillFeatureCircle(terrain, 310, 200, 8, 'forest_dense');

  // Mid-map forests
  fillFeatureCircle(terrain, 140, 160, 6, 'forest_dense');
  fillFeatureCircle(terrain, 220, 160, 6, 'forest_dense');

  // MUD areas
  createMudArea(terrain, 180, 160, 14);
  createMudArea(terrain, 100, 160, 6);
  createMudArea(terrain, 260, 160, 6);

  // Light forests
  fillFeatureCircle(terrain, 115, 70, 7, 'forest_light');
  fillFeatureCircle(terrain, 245, 70, 7, 'forest_light');
  fillFeatureCircle(terrain, 115, 250, 7, 'forest_light');
  fillFeatureCircle(terrain, 245, 250, 7, 'forest_light');

  // ========================================
  // RESOURCES
  // ========================================
  const p1Main = createBaseResources(50, 45, DIR.UP);
  const p2Main = createBaseResources(180, 45, DIR.UP);
  const p3Main = createBaseResources(310, 45, DIR.UP);
  const p4Main = createBaseResources(50, 275, DIR.DOWN);
  const p5Main = createBaseResources(180, 275, DIR.DOWN);
  const p6Main = createBaseResources(310, 275, DIR.DOWN);

  const p1Nat = createBaseResources(70, 85, DIR.LEFT, 1500, 2250, false, 10);    // Perpendicular to main-nat ramp
  const p2Nat = createBaseResources(180, 85, DIR.LEFT, 1500, 2250, false, 10);   // Perpendicular to main-nat ramp
  const p3Nat = createBaseResources(290, 85, DIR.RIGHT, 1500, 2250, false, 10);  // Perpendicular to main-nat ramp
  const p4Nat = createBaseResources(70, 235, DIR.LEFT, 1500, 2250, false, 10);   // Perpendicular to main-nat ramp
  const p5Nat = createBaseResources(180, 235, DIR.RIGHT, 1500, 2250, false, 10); // Perpendicular to main-nat ramp
  const p6Nat = createBaseResources(290, 235, DIR.RIGHT, 1500, 2250, false, 10); // Perpendicular to main-nat ramp

  const thirdLeft = createBaseResources(40, 160, DIR.LEFT);
  const thirdRight = createBaseResources(320, 160, DIR.RIGHT);

  const goldTL = createBaseResources(100, 130, DIR.UP_LEFT, 1500, 2250, true);
  const goldTR = createBaseResources(260, 130, DIR.UP_RIGHT, 1500, 2250, true);
  const goldBL = createBaseResources(100, 190, DIR.DOWN_LEFT, 1500, 2250, true);
  const goldBR = createBaseResources(260, 190, DIR.DOWN_RIGHT, 1500, 2250, true);

  const centerRes = createBaseResources(180, 160, DIR.UP, 1500, 2250, true);

  const expansions = [
    { name: 'P1 Main', x: 50, y: 45, isMain: true, ...p1Main },
    { name: 'P2 Main', x: 180, y: 45, isMain: true, ...p2Main },
    { name: 'P3 Main', x: 310, y: 45, isMain: true, ...p3Main },
    { name: 'P4 Main', x: 50, y: 275, isMain: true, ...p4Main },
    { name: 'P5 Main', x: 180, y: 275, isMain: true, ...p5Main },
    { name: 'P6 Main', x: 310, y: 275, isMain: true, ...p6Main },
    { name: 'P1 Natural', x: 70, y: 85, isNatural: true, ...p1Nat },
    { name: 'P2 Natural', x: 180, y: 85, isNatural: true, ...p2Nat },
    { name: 'P3 Natural', x: 290, y: 85, isNatural: true, ...p3Nat },
    { name: 'P4 Natural', x: 70, y: 235, isNatural: true, ...p4Nat },
    { name: 'P5 Natural', x: 180, y: 235, isNatural: true, ...p5Nat },
    { name: 'P6 Natural', x: 290, y: 235, isNatural: true, ...p6Nat },
    { name: 'Third Left', x: 40, y: 160, ...thirdLeft },
    { name: 'Third Right', x: 320, y: 160, ...thirdRight },
    { name: 'Gold TL', x: 100, y: 130, ...goldTL },
    { name: 'Gold TR', x: 260, y: 130, ...goldTR },
    { name: 'Gold BL', x: 100, y: 190, ...goldBL },
    { name: 'Gold BR', x: 260, y: 190, ...goldBR },
    { name: 'Center', x: 180, y: 160, ...centerRes },
  ];

  const mapData: MapData = {
    id: 'contested_frontier',
    name: 'Contested Frontier',
    author: 'VOIDSTRIKE Team',
    description: 'A large 6-player map for 3v3 team battles. Team positions on opposite sides with shared strategic resources in the center.',

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
      { x: 180, y: 160, radius: 26 },
      { x: 100, y: 160, radius: 18 },
      { x: 260, y: 160, radius: 18 },
      { x: 180, y: 110, radius: 16 },
      { x: 180, y: 210, radius: 16 },
    ],

    ramps,

    destructibles: [
      { x: 120, y: 160, health: 1500 },
      { x: 240, y: 160, health: 1500 },
      { x: 155, y: 135, health: 1500 },
      { x: 205, y: 135, health: 1500 },
      { x: 155, y: 185, health: 1500 },
      { x: 205, y: 185, health: 1500 },
    ],

    decorations: generateJungleDecorations(rampClearance),

    playerCount: 6,
    maxPlayers: 6,
    isRanked: true,

    biome: 'jungle',
    skyboxColor: '#1a2a1a',
    ambientColor: '#304030',
    sunColor: '#90c090',
    fogColor: '#2a3a2a',
    fogNear: 100,
    fogFar: 320,
  };

  // Validate connectivity
  const validation = validateMapConnectivity(mapData);
  if (!validation.isValid) {
    console.warn('[ContestedFrontier] Map has connectivity issues, attempting auto-fix...');
    const corridorsCarved = autoFixConnectivity(mapData);
    console.log(`[ContestedFrontier] Auto-fix carved ${corridorsCarved} corridors`);
  } else {
    console.log('[ContestedFrontier] Map connectivity validated - all areas reachable');
  }

  return mapData;
}

export const CONTESTED_FRONTIER = generateContestedFrontier();

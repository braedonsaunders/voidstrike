/**
 * Shattered Prism - World-Class Competitive 2v2 Map
 *
 * Design Philosophy:
 * - 180° rotational symmetry for perfect balance
 * - Team-based spawning (players 1+2 vs 3+4)
 * - Multiple attack paths for strategic depth
 * - Contested center with high-value objectives
 * - Defensible mains with strategic naturals
 * - Gold bases as high-risk/high-reward objectives
 */

import type { MapData, MapCell, Ramp, SpawnPoint, Expansion, WatchTower, DestructibleRock, MapDecoration } from '../MapTypes';
import {
  createTerrainGrid,
  createBaseResources,
  createRaisedPlatform,
  createRaisedRect,
  createRampInTerrain,
  fillTerrainRect,
  fillTerrainCircle,
  fillFeatureCircle,
  fillFeatureRect,
  createForestCorridor,
  createRoad,
  createLake,
  createVoidChasm,
  DIR,
  MINERAL_DISTANCE_NATURAL,
} from '../MapTypes';

// Map dimensions - 256x256 is perfect for 2v2
const WIDTH = 256;
const HEIGHT = 256;
const CENTER = WIDTH / 2; // 128

// Elevation levels (mapped to 0-255 scale internally)
const LOW = 0;   // 60 in 256-scale
const MID = 1;   // 140 in 256-scale
const HIGH = 2;  // 220 in 256-scale

/**
 * Generate the Shattered Prism map
 */
export function generateShatteredPrism(): MapData {
  // Initialize terrain grid with low ground
  const terrain = createTerrainGrid(WIDTH, HEIGHT, 'ground', LOW, 'none');

  // ============================================
  // RAMPS - Create these FIRST so platforms preserve them
  // ============================================
  const ramps: Ramp[] = [];

  // Player 1 (top-left) main ramp - facing right/down toward natural
  const p1MainRamp: Ramp = {
    x: 58, y: 30,
    width: 8, height: 12,
    direction: 'south',
    fromElevation: HIGH,
    toElevation: MID,
  };
  ramps.push(p1MainRamp);
  createRampInTerrain(terrain, p1MainRamp);

  // Player 2 (top-right area) main ramp - facing left/down
  const p2MainRamp: Ramp = {
    x: 30, y: 58,
    width: 12, height: 8,
    direction: 'east',
    fromElevation: HIGH,
    toElevation: MID,
  };
  ramps.push(p2MainRamp);
  createRampInTerrain(terrain, p2MainRamp);

  // Player 3 (bottom-right) main ramp - mirror of P1
  const p3MainRamp: Ramp = {
    x: WIDTH - 66, y: HEIGHT - 42,
    width: 8, height: 12,
    direction: 'north',
    fromElevation: HIGH,
    toElevation: MID,
  };
  ramps.push(p3MainRamp);
  createRampInTerrain(terrain, p3MainRamp);

  // Player 4 (bottom-left area) main ramp - mirror of P2
  const p4MainRamp: Ramp = {
    x: WIDTH - 42, y: HEIGHT - 66,
    width: 12, height: 8,
    direction: 'west',
    fromElevation: HIGH,
    toElevation: MID,
  };
  ramps.push(p4MainRamp);
  createRampInTerrain(terrain, p4MainRamp);

  // Natural ramps - from mid to low ground
  // P1 Natural ramp
  const p1NatRamp: Ramp = {
    x: 70, y: 60,
    width: 8, height: 10,
    direction: 'south',
    fromElevation: MID,
    toElevation: LOW,
  };
  ramps.push(p1NatRamp);
  createRampInTerrain(terrain, p1NatRamp);

  // P2 Natural ramp
  const p2NatRamp: Ramp = {
    x: 60, y: 70,
    width: 10, height: 8,
    direction: 'east',
    fromElevation: MID,
    toElevation: LOW,
  };
  ramps.push(p2NatRamp);
  createRampInTerrain(terrain, p2NatRamp);

  // P3 Natural ramp - mirror
  const p3NatRamp: Ramp = {
    x: WIDTH - 78, y: HEIGHT - 70,
    width: 8, height: 10,
    direction: 'north',
    fromElevation: MID,
    toElevation: LOW,
  };
  ramps.push(p3NatRamp);
  createRampInTerrain(terrain, p3NatRamp);

  // P4 Natural ramp - mirror
  const p4NatRamp: Ramp = {
    x: WIDTH - 70, y: HEIGHT - 78,
    width: 10, height: 8,
    direction: 'west',
    fromElevation: MID,
    toElevation: LOW,
  };
  ramps.push(p4NatRamp);
  createRampInTerrain(terrain, p4NatRamp);

  // Center high ground ramps (4 entry points to center plateau)
  const centerNorthRamp: Ramp = {
    x: CENTER - 4, y: CENTER - 32,
    width: 8, height: 10,
    direction: 'south',
    fromElevation: LOW,
    toElevation: MID,
  };
  ramps.push(centerNorthRamp);
  createRampInTerrain(terrain, centerNorthRamp);

  const centerSouthRamp: Ramp = {
    x: CENTER - 4, y: CENTER + 22,
    width: 8, height: 10,
    direction: 'north',
    fromElevation: LOW,
    toElevation: MID,
  };
  ramps.push(centerSouthRamp);
  createRampInTerrain(terrain, centerSouthRamp);

  const centerWestRamp: Ramp = {
    x: CENTER - 32, y: CENTER - 4,
    width: 10, height: 8,
    direction: 'east',
    fromElevation: LOW,
    toElevation: MID,
  };
  ramps.push(centerWestRamp);
  createRampInTerrain(terrain, centerWestRamp);

  const centerEastRamp: Ramp = {
    x: CENTER + 22, y: CENTER - 4,
    width: 10, height: 8,
    direction: 'west',
    fromElevation: LOW,
    toElevation: MID,
  };
  ramps.push(centerEastRamp);
  createRampInTerrain(terrain, centerEastRamp);

  // Third base ramps (high ground pockets)
  // Team 1 third location ramp
  const third1Ramp: Ramp = {
    x: 95, y: 115,
    width: 8, height: 10,
    direction: 'north',
    fromElevation: LOW,
    toElevation: MID,
  };
  ramps.push(third1Ramp);
  createRampInTerrain(terrain, third1Ramp);

  // Team 2 third location ramp - mirror
  const third2Ramp: Ramp = {
    x: WIDTH - 103, y: HEIGHT - 125,
    width: 8, height: 10,
    direction: 'south',
    fromElevation: LOW,
    toElevation: MID,
  };
  ramps.push(third2Ramp);
  createRampInTerrain(terrain, third2Ramp);

  // ============================================
  // MAIN BASES - High ground platforms
  // ============================================

  // Player 1 main (top-left corner)
  createRaisedPlatform(terrain, 40, 40, 28, HIGH, 4);

  // Player 2 main (adjacent to P1, toward center)
  createRaisedPlatform(terrain, 40, 40, 28, HIGH, 4); // Shared corner area
  createRaisedRect(terrain, 15, 55, 35, 35, HIGH, 4);

  // Actually, let's redesign - P1 and P2 should be separate but close
  // P1: Top-left corner
  createRaisedRect(terrain, 12, 12, 50, 40, HIGH, 3);

  // P2: Below and right of P1
  createRaisedRect(terrain, 12, 60, 40, 45, HIGH, 3);

  // Player 3 main - mirror of P1 (bottom-right corner)
  createRaisedRect(terrain, WIDTH - 62, HEIGHT - 52, 50, 40, HIGH, 3);

  // Player 4 main - mirror of P2
  createRaisedRect(terrain, WIDTH - 52, HEIGHT - 105, 40, 45, HIGH, 3);

  // ============================================
  // NATURAL EXPANSIONS - Mid-ground platforms
  // ============================================

  // P1 Natural - below main ramp
  createRaisedRect(terrain, 50, 42, 32, 28, MID, 3);

  // P2 Natural - right of main ramp
  createRaisedRect(terrain, 42, 50, 28, 32, MID, 3);

  // P3 Natural - mirror
  createRaisedRect(terrain, WIDTH - 82, HEIGHT - 70, 32, 28, MID, 3);

  // P4 Natural - mirror
  createRaisedRect(terrain, WIDTH - 70, HEIGHT - 82, 28, 32, MID, 3);

  // ============================================
  // CENTER PLATEAU - Key strategic area
  // ============================================

  // Central elevated area with gold base
  createRaisedPlatform(terrain, CENTER, CENTER, 22, MID, 3);

  // ============================================
  // THIRD BASES - Contested high-ground pockets
  // ============================================

  // Team 1 shared third area
  createRaisedRect(terrain, 88, 88, 25, 25, MID, 3);

  // Team 2 shared third area - mirror
  createRaisedRect(terrain, WIDTH - 113, HEIGHT - 113, 25, 25, MID, 3);

  // ============================================
  // MAP BORDER - Void edges
  // ============================================

  // Create void border around entire map
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const distFromEdge = Math.min(x, y, WIDTH - 1 - x, HEIGHT - 1 - y);
      if (distFromEdge < 8) {
        if (terrain[y][x].terrain !== 'ramp') {
          terrain[y][x].terrain = 'unwalkable';
          terrain[y][x].feature = 'void';
          terrain[y][x].elevation = 0;
        }
      }
    }
  }

  // ============================================
  // DECORATIVE TERRAIN FEATURES
  // ============================================

  // Void chasms dividing the map into lanes
  // Left side chasm (separates left lane from center)
  createVoidChasm(terrain, 20, 105, 50, 45, 2);
  createVoidChasm(terrain, WIDTH - 70, HEIGHT - 150, 50, 45, 2); // Mirror

  // Forest corridors for flanking routes
  // Top lane forest
  createForestCorridor(terrain, 90, 20, 166, 20, 15, 6, true);
  // Bottom lane forest - mirror
  createForestCorridor(terrain, 90, HEIGHT - 20, 166, HEIGHT - 20, 15, 6, true);

  // Side forests for ambush positions
  fillFeatureCircle(terrain, 85, 150, 10, 'forest_dense');
  fillFeatureCircle(terrain, WIDTH - 85, HEIGHT - 150, 10, 'forest_dense'); // Mirror

  // Light forests near thirds
  fillFeatureCircle(terrain, 115, 95, 6, 'forest_light');
  fillFeatureCircle(terrain, WIDTH - 115, HEIGHT - 95, 6, 'forest_light');

  // Small lakes for visual interest (impassable)
  createLake(terrain, 150, 50, 8, 2);
  createLake(terrain, WIDTH - 150, HEIGHT - 50, 8, 2);

  // Road network connecting key areas
  createRoad(terrain, 80, 80, CENTER - 30, CENTER - 30, 4);
  createRoad(terrain, WIDTH - 80, HEIGHT - 80, CENTER + 30, CENTER + 30, 4);

  // ============================================
  // SPAWN POINTS
  // ============================================

  const spawns: SpawnPoint[] = [
    // Team 1
    { x: 35, y: 28, playerSlot: 1, rotation: Math.PI / 4 },      // P1: top-left
    { x: 28, y: 80, playerSlot: 2, rotation: Math.PI / 4 },      // P2: left side

    // Team 2
    { x: WIDTH - 35, y: HEIGHT - 28, playerSlot: 3, rotation: -Math.PI * 3 / 4 }, // P3: bottom-right
    { x: WIDTH - 28, y: HEIGHT - 80, playerSlot: 4, rotation: -Math.PI * 3 / 4 }, // P4: right side
  ];

  // ============================================
  // EXPANSIONS WITH RESOURCES
  // ============================================

  const expansions: Expansion[] = [];

  // Player 1 Main
  const p1MainRes = createBaseResources(35, 28, DIR.UP_LEFT);
  expansions.push({
    name: 'P1 Main',
    x: 35, y: 28,
    minerals: p1MainRes.minerals,
    vespene: p1MainRes.vespene,
    isMain: true,
    isNatural: false,
  });

  // Player 1 Natural
  const p1NatRes = createBaseResources(65, 52, DIR.DOWN, 1500, 2250, false, MINERAL_DISTANCE_NATURAL);
  expansions.push({
    name: 'P1 Natural',
    x: 65, y: 52,
    minerals: p1NatRes.minerals,
    vespene: p1NatRes.vespene,
    isMain: false,
    isNatural: true,
  });

  // Player 2 Main
  const p2MainRes = createBaseResources(28, 80, DIR.UP_LEFT);
  expansions.push({
    name: 'P2 Main',
    x: 28, y: 80,
    minerals: p2MainRes.minerals,
    vespene: p2MainRes.vespene,
    isMain: true,
    isNatural: false,
  });

  // Player 2 Natural
  const p2NatRes = createBaseResources(52, 65, DIR.LEFT, 1500, 2250, false, MINERAL_DISTANCE_NATURAL);
  expansions.push({
    name: 'P2 Natural',
    x: 52, y: 65,
    minerals: p2NatRes.minerals,
    vespene: p2NatRes.vespene,
    isMain: false,
    isNatural: true,
  });

  // Player 3 Main - mirror of P1
  const p3MainRes = createBaseResources(WIDTH - 35, HEIGHT - 28, DIR.DOWN_RIGHT);
  expansions.push({
    name: 'P3 Main',
    x: WIDTH - 35, y: HEIGHT - 28,
    minerals: p3MainRes.minerals,
    vespene: p3MainRes.vespene,
    isMain: true,
    isNatural: false,
  });

  // Player 3 Natural
  const p3NatRes = createBaseResources(WIDTH - 65, HEIGHT - 52, DIR.UP, 1500, 2250, false, MINERAL_DISTANCE_NATURAL);
  expansions.push({
    name: 'P3 Natural',
    x: WIDTH - 65, y: HEIGHT - 52,
    minerals: p3NatRes.minerals,
    vespene: p3NatRes.vespene,
    isMain: false,
    isNatural: true,
  });

  // Player 4 Main - mirror of P2
  const p4MainRes = createBaseResources(WIDTH - 28, HEIGHT - 80, DIR.DOWN_RIGHT);
  expansions.push({
    name: 'P4 Main',
    x: WIDTH - 28, y: HEIGHT - 80,
    minerals: p4MainRes.minerals,
    vespene: p4MainRes.vespene,
    isMain: true,
    isNatural: false,
  });

  // Player 4 Natural
  const p4NatRes = createBaseResources(WIDTH - 52, HEIGHT - 65, DIR.RIGHT, 1500, 2250, false, MINERAL_DISTANCE_NATURAL);
  expansions.push({
    name: 'P4 Natural',
    x: WIDTH - 52, y: HEIGHT - 65,
    minerals: p4NatRes.minerals,
    vespene: p4NatRes.vespene,
    isMain: false,
    isNatural: true,
  });

  // Team 1 Third (shared/contested)
  const team1ThirdRes = createBaseResources(100, 100, DIR.DOWN_RIGHT);
  expansions.push({
    name: 'Team 1 Third',
    x: 100, y: 100,
    minerals: team1ThirdRes.minerals,
    vespene: team1ThirdRes.vespene,
    isMain: false,
    isNatural: false,
  });

  // Team 2 Third (shared/contested) - mirror
  const team2ThirdRes = createBaseResources(WIDTH - 100, HEIGHT - 100, DIR.UP_LEFT);
  expansions.push({
    name: 'Team 2 Third',
    x: WIDTH - 100, y: HEIGHT - 100,
    minerals: team2ThirdRes.minerals,
    vespene: team2ThirdRes.vespene,
    isMain: false,
    isNatural: false,
  });

  // Center Gold Base - high risk, high reward
  const centerGoldRes = createBaseResources(CENTER, CENTER, DIR.UP, 900, 2250, true);
  expansions.push({
    name: 'Center Gold',
    x: CENTER, y: CENTER,
    minerals: centerGoldRes.minerals,
    vespene: centerGoldRes.vespene,
    isMain: false,
    isNatural: false,
  });

  // Side pocket expansions (4th bases)
  // Top-right pocket
  const topRightRes = createBaseResources(180, 45, DIR.UP);
  expansions.push({
    name: 'Top Pocket',
    x: 180, y: 45,
    minerals: topRightRes.minerals,
    vespene: topRightRes.vespene,
    isMain: false,
    isNatural: false,
  });

  // Bottom-left pocket - mirror
  const bottomLeftRes = createBaseResources(WIDTH - 180, HEIGHT - 45, DIR.DOWN);
  expansions.push({
    name: 'Bottom Pocket',
    x: WIDTH - 180, y: HEIGHT - 45,
    minerals: bottomLeftRes.minerals,
    vespene: bottomLeftRes.vespene,
    isMain: false,
    isNatural: false,
  });

  // ============================================
  // WATCH TOWERS - Vision control
  // ============================================

  const watchTowers: WatchTower[] = [
    // Center tower - critical vision
    { x: CENTER, y: CENTER - 35, radius: 25 },

    // Side towers
    { x: 85, y: CENTER, radius: 20 },
    { x: WIDTH - 85, y: CENTER, radius: 20 },

    // Corner approach towers
    { x: 110, y: 110, radius: 18 },
    { x: WIDTH - 110, y: HEIGHT - 110, radius: 18 },
  ];

  // ============================================
  // DESTRUCTIBLE ROCKS - Optional paths
  // ============================================

  const destructibles: DestructibleRock[] = [
    // Rocks blocking direct center approach
    { x: CENTER - 40, y: CENTER - 40, health: 2000 },
    { x: CENTER + 40, y: CENTER + 40, health: 2000 },

    // Rocks blocking third base backdoor
    { x: 75, y: 120, health: 1500 },
    { x: WIDTH - 75, y: HEIGHT - 120, health: 1500 },

    // Side lane rocks
    { x: 50, y: CENTER, health: 1500 },
    { x: WIDTH - 50, y: CENTER, health: 1500 },
  ];

  // ============================================
  // DECORATIONS
  // ============================================

  const decorations: MapDecoration[] = [];

  // Crystal formations near gold base
  decorations.push(
    { type: 'crystal_formation', x: CENTER - 15, y: CENTER - 15, scale: 1.2 },
    { type: 'crystal_formation', x: CENTER + 15, y: CENTER + 15, scale: 1.2 },
    { type: 'crystal_formation', x: CENTER - 20, y: CENTER + 10, scale: 0.9 },
    { type: 'crystal_formation', x: CENTER + 20, y: CENTER - 10, scale: 0.9 },
  );

  // Rock formations along edges
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const r = 100 + Math.sin(i * 3) * 20;
    decorations.push({
      type: 'rocks_large',
      x: CENTER + Math.cos(angle) * r,
      y: CENTER + Math.sin(angle) * r,
      scale: 0.8 + Math.random() * 0.4,
      rotation: Math.random() * Math.PI * 2,
    });
  }

  // Dead trees in void areas
  decorations.push(
    { type: 'tree_dead', x: 35, y: 130, scale: 1.0 },
    { type: 'tree_dead', x: WIDTH - 35, y: HEIGHT - 130, scale: 1.0 },
    { type: 'tree_dead', x: 45, y: 145, scale: 0.8 },
    { type: 'tree_dead', x: WIDTH - 45, y: HEIGHT - 145, scale: 0.8 },
  );

  // Debris near watch towers
  watchTowers.forEach((tower) => {
    decorations.push({
      type: 'debris',
      x: tower.x + 5,
      y: tower.y - 5,
      scale: 0.7,
    });
  });

  // Alien trees in forest areas
  decorations.push(
    { type: 'tree_alien', x: 90, y: 18, scale: 1.1 },
    { type: 'tree_alien', x: 166, y: 18, scale: 1.1 },
    { type: 'tree_alien', x: 90, y: HEIGHT - 18, scale: 1.1 },
    { type: 'tree_alien', x: 166, y: HEIGHT - 18, scale: 1.1 },
  );

  // ============================================
  // ASSEMBLE MAP DATA
  // ============================================

  return {
    id: 'shattered_prism',
    name: 'Shattered Prism',
    author: 'VOIDSTRIKE Team',
    description: 'A world-class competitive 2v2 map featuring team-based spawning, multiple attack paths, and a contested central gold base. Teams must coordinate to control key positions while defending their interconnected bases.',
    width: WIDTH,
    height: HEIGHT,
    terrain,
    spawns,
    expansions,
    watchTowers,
    ramps,
    destructibles,
    decorations,
    playerCount: 4,
    maxPlayers: 4,
    isRanked: true,
    biome: 'void',
  };
}

// Export the generated map
export const SHATTERED_PRISM = generateShatteredPrism();

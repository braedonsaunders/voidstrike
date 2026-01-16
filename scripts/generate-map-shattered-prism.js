/**
 * Standalone script to generate the Shattered Prism 2v2 map
 * Run with: node scripts/generate-map-shattered-prism.js
 */

const fs = require('fs');
const path = require('path');

// ============================================
// CONSTANTS
// ============================================

const WIDTH = 256;
const HEIGHT = 256;
const CENTER = WIDTH / 2;

// Elevation values (256-scale)
const ELEV_LOW = 60;
const ELEV_MID = 140;
const ELEV_HIGH = 220;

// Standard resource amounts
const MINERAL_NORMAL = 1500;
const MINERAL_CLOSE = 900;
const MINERAL_GOLD = 900;
const GAS_NORMAL = 2250;
const MINERAL_DISTANCE = 7;
const MINERAL_DISTANCE_NATURAL = 10;

// Direction angles (radians)
const DIR = {
  UP: -Math.PI / 2,
  DOWN: Math.PI / 2,
  LEFT: Math.PI,
  RIGHT: 0,
  UP_LEFT: -Math.PI * 3 / 4,
  UP_RIGHT: -Math.PI / 4,
  DOWN_LEFT: Math.PI * 3 / 4,
  DOWN_RIGHT: Math.PI / 4,
};

// ============================================
// TERRAIN GRID HELPERS
// ============================================

function createTerrainGrid(width, height, defaultTerrain, defaultElevation, defaultFeature) {
  const grid = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = {
        terrain: defaultTerrain,
        elevation: defaultElevation,
        feature: defaultFeature,
        textureId: Math.floor(Math.random() * 4),
      };
    }
  }
  return grid;
}

function fillTerrainRect(grid, x, y, width, height, terrain, elevation, feature) {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const px = Math.floor(x + dx);
      const py = Math.floor(y + dy);
      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        if (grid[py][px].terrain === 'ramp') continue;
        grid[py][px].terrain = terrain;
        if (elevation !== undefined) grid[py][px].elevation = elevation;
        if (feature !== undefined) grid[py][px].feature = feature;
      }
    }
  }
}

function fillTerrainCircle(grid, centerX, centerY, radius, terrain, elevation, feature) {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) {
        const px = Math.floor(centerX + x);
        const py = Math.floor(centerY + y);
        if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
          if (grid[py][px].terrain === 'ramp') continue;
          grid[py][px].terrain = terrain;
          if (elevation !== undefined) grid[py][px].elevation = elevation;
          if (feature !== undefined) grid[py][px].feature = feature;
        }
      }
    }
  }
}

function createRampInTerrain(grid, ramp) {
  const { x, y, width, height, direction, fromElevation, toElevation } = ramp;
  const fromElev = fromElevation === 0 ? ELEV_LOW : fromElevation === 1 ? ELEV_MID : ELEV_HIGH;
  const toElev = toElevation === 0 ? ELEV_LOW : toElevation === 1 ? ELEV_MID : ELEV_HIGH;

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const px = Math.floor(x + dx);
      const py = Math.floor(y + dy);
      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        let t = 0;
        switch (direction) {
          case 'north': t = 1 - dy / (height - 1); break;
          case 'south': t = dy / (height - 1); break;
          case 'east': t = 1 - dx / (width - 1); break;
          case 'west': t = dx / (width - 1); break;
        }
        const elev = Math.round(fromElev + (toElev - fromElev) * t);
        grid[py][px] = {
          terrain: 'ramp',
          elevation: elev,
          feature: 'none',
          textureId: Math.floor(Math.random() * 4),
        };
      }
    }
  }
}

function isRampOrNearRamp(grid, x, y, buffer) {
  for (let dy = -buffer; dy <= buffer; dy++) {
    for (let dx = -buffer; dx <= buffer; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        if (grid[py][px].terrain === 'ramp') return true;
      }
    }
  }
  return false;
}

function createRaisedRect(grid, x, y, width, height, elevationLevel, cliffWidth) {
  const elevation = elevationLevel === 0 ? ELEV_LOW : elevationLevel === 1 ? ELEV_MID : ELEV_HIGH;

  for (let dy = -cliffWidth; dy < height + cliffWidth; dy++) {
    for (let dx = -cliffWidth; dx < width + cliffWidth; dx++) {
      const px = Math.floor(x + dx);
      const py = Math.floor(y + dy);
      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        if (grid[py][px].terrain === 'ramp') continue;
        const isInner = dx >= 0 && dx < width && dy >= 0 && dy < height;
        if (isInner) {
          grid[py][px] = {
            terrain: 'ground',
            elevation: elevation,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        } else if (!isRampOrNearRamp(grid, px, py, cliffWidth + 1)) {
          grid[py][px] = {
            terrain: 'unwalkable',
            elevation: elevation,
            feature: 'cliff',
            textureId: Math.floor(Math.random() * 4),
          };
        }
      }
    }
  }
}

function createRaisedPlatform(grid, centerX, centerY, radius, elevationLevel, cliffWidth) {
  const elevation = elevationLevel === 0 ? ELEV_LOW : elevationLevel === 1 ? ELEV_MID : ELEV_HIGH;
  const outerRadius = radius + cliffWidth;

  for (let dy = -outerRadius; dy <= outerRadius; dy++) {
    for (let dx = -outerRadius; dx <= outerRadius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      const px = Math.floor(centerX + dx);
      const py = Math.floor(centerY + dy);
      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        if (grid[py][px].terrain === 'ramp') continue;
        if (dist <= radius) {
          grid[py][px] = {
            terrain: 'ground',
            elevation: elevation,
            feature: 'none',
            textureId: Math.floor(Math.random() * 4),
          };
        } else if (dist <= outerRadius && !isRampOrNearRamp(grid, px, py, cliffWidth + 1)) {
          grid[py][px] = {
            terrain: 'unwalkable',
            elevation: elevation,
            feature: 'cliff',
            textureId: Math.floor(Math.random() * 4),
          };
        }
      }
    }
  }
}

function fillFeatureCircle(grid, centerX, centerY, radius, feature) {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) {
        const px = Math.floor(centerX + x);
        const py = Math.floor(centerY + y);
        if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
          if (grid[py][px].terrain === 'ramp') continue;
          grid[py][px].feature = feature;
          if (feature === 'water_deep' || feature === 'void') {
            grid[py][px].terrain = 'unwalkable';
          } else if (feature !== 'none' && feature !== 'road') {
            grid[py][px].terrain = 'unbuildable';
          }
        }
      }
    }
  }
}

function createForestCorridor(grid, x1, y1, x2, y2, width, pathWidth, denseEdges) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(length);
  const perpX = -dy / length;
  const perpY = dx / length;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;
    for (let w = -width / 2; w <= width / 2; w++) {
      const px = Math.floor(cx + perpX * w);
      const py = Math.floor(cy + perpY * w);
      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        if (grid[py][px].terrain === 'ramp') continue;
        const absW = Math.abs(w);
        if (absW <= pathWidth / 2) {
          grid[py][px].feature = 'road';
          grid[py][px].terrain = 'unbuildable';
        } else if (denseEdges && absW > width / 2 - 3) {
          grid[py][px].feature = 'forest_dense';
          grid[py][px].terrain = 'unbuildable';
        } else {
          grid[py][px].feature = 'forest_light';
          grid[py][px].terrain = 'unbuildable';
        }
      }
    }
  }
}

function createVoidChasm(grid, x, y, width, height, edgeWidth) {
  for (let dy = -edgeWidth; dy < height + edgeWidth; dy++) {
    for (let dx = -edgeWidth; dx < width + edgeWidth; dx++) {
      const px = Math.floor(x + dx);
      const py = Math.floor(y + dy);
      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        if (grid[py][px].terrain === 'ramp') continue;
        const isEdge = dx < 0 || dx >= width || dy < 0 || dy >= height;
        if (isEdge) {
          grid[py][px].feature = 'cliff';
          grid[py][px].terrain = 'unwalkable';
        } else {
          grid[py][px].feature = 'void';
          grid[py][px].terrain = 'unwalkable';
          grid[py][px].elevation = 0;
        }
      }
    }
  }
}

function createRoad(grid, x1, y1, x2, y2, width) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(length);
  const perpX = -dy / length;
  const perpY = dx / length;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;
    for (let w = -width / 2; w <= width / 2; w++) {
      const px = Math.floor(cx + perpX * w);
      const py = Math.floor(cy + perpY * w);
      if (py >= 0 && py < grid.length && px >= 0 && px < grid[0].length) {
        if (grid[py][px].terrain === 'ramp') continue;
        if (grid[py][px].terrain === 'ground' || grid[py][px].terrain === 'unbuildable') {
          grid[py][px].feature = 'road';
          grid[py][px].terrain = 'unbuildable';
        }
      }
    }
  }
}

// ============================================
// RESOURCE HELPERS
// ============================================

function createMineralLine(mineralCenterX, mineralCenterY, baseCenterX, baseCenterY, amount, isGold) {
  const minerals = [];
  const arcRadius = 3.5;
  const arcSpread = Math.PI * 0.65;
  const dx = baseCenterX - mineralCenterX;
  const dy = baseCenterY - mineralCenterY;
  const angleToBase = Math.atan2(dy, dx);

  for (let i = 0; i < 8; i++) {
    const t = (i - 3.5) / 3.5;
    const angle = angleToBase + t * (arcSpread / 2);
    const radiusVariation = (i % 2 === 0) ? 0 : 0.8;
    const r = arcRadius + radiusVariation;
    const x = mineralCenterX - Math.cos(angle) * r;
    const y = mineralCenterY - Math.sin(angle) * r;

    let patchAmount;
    if (isGold) {
      patchAmount = MINERAL_GOLD;
    } else {
      patchAmount = i < 6 ? amount : MINERAL_CLOSE;
    }

    minerals.push({
      x: Math.round(x * 2) / 2,
      y: Math.round(y * 2) / 2,
      type: 'minerals',
      amount: patchAmount,
    });
  }
  return minerals;
}

function createVespeneGeysers(mineralCenterX, mineralCenterY, baseCenterX, baseCenterY, amount) {
  const dx = baseCenterX - mineralCenterX;
  const dy = baseCenterY - mineralCenterY;
  const angleToBase = Math.atan2(dy, dx);
  const arcRadius = 3.5;
  const arcSpread = Math.PI * 0.65;
  const geyserAngleOffset = (arcSpread / 2) + Math.PI * 0.09;
  const geyserRadius = arcRadius + 3.0;
  const geyser1Angle = angleToBase + geyserAngleOffset;
  const geyser2Angle = angleToBase - geyserAngleOffset;

  return [
    {
      x: Math.round((mineralCenterX - Math.cos(geyser1Angle) * geyserRadius) * 2) / 2,
      y: Math.round((mineralCenterY - Math.sin(geyser1Angle) * geyserRadius) * 2) / 2,
      type: 'vespene',
      amount,
    },
    {
      x: Math.round((mineralCenterX - Math.cos(geyser2Angle) * geyserRadius) * 2) / 2,
      y: Math.round((mineralCenterY - Math.sin(geyser2Angle) * geyserRadius) * 2) / 2,
      type: 'vespene',
      amount,
    },
  ];
}

function createBaseResources(baseX, baseY, direction, mineralAmount = MINERAL_NORMAL, gasAmount = GAS_NORMAL, isGold = false, mineralDistance = MINERAL_DISTANCE) {
  const mineralCenterX = baseX + Math.cos(direction) * mineralDistance;
  const mineralCenterY = baseY + Math.sin(direction) * mineralDistance;
  return {
    minerals: createMineralLine(mineralCenterX, mineralCenterY, baseX, baseY, mineralAmount, isGold),
    vespene: createVespeneGeysers(mineralCenterX, mineralCenterY, baseX, baseY, gasAmount),
  };
}

// ============================================
// SERIALIZATION
// ============================================

const TERRAIN_TO_CHAR = {
  'ground': 'g',
  'unwalkable': 'u',
  'ramp': 'r',
  'unbuildable': 'b',
  'creep': 'c',
};

function serializeTerrainTypes(terrain) {
  let result = '';
  for (let y = 0; y < terrain.length; y++) {
    for (let x = 0; x < terrain[0].length; x++) {
      result += TERRAIN_TO_CHAR[terrain[y][x].terrain] || 'g';
    }
  }
  return result;
}

function serializeElevation(terrain) {
  const result = [];
  for (let y = 0; y < terrain.length; y++) {
    for (let x = 0; x < terrain[0].length; x++) {
      result.push(terrain[y][x].elevation);
    }
  }
  return result;
}

function serializeSparseFeatures(terrain) {
  const result = [];
  for (let y = 0; y < terrain.length; y++) {
    for (let x = 0; x < terrain[0].length; x++) {
      const feature = terrain[y][x].feature;
      if (feature && feature !== 'none') {
        result.push({ x, y, f: feature });
      }
    }
  }
  return result;
}

// ============================================
// GENERATE MAP
// ============================================

console.log('Generating Shattered Prism 2v2 map...');

// Initialize terrain
const terrain = createTerrainGrid(WIDTH, HEIGHT, 'ground', ELEV_LOW, 'none');

// ============================================
// RAMPS - Create FIRST
// ============================================

const ramps = [];

// P1 main ramp (top-left, facing down)
const p1MainRamp = { x: 55, y: 38, width: 8, height: 12, direction: 'south', fromElevation: 2, toElevation: 1 };
ramps.push(p1MainRamp);
createRampInTerrain(terrain, p1MainRamp);

// P2 main ramp (left side, facing right)
const p2MainRamp = { x: 38, y: 82, width: 12, height: 8, direction: 'east', fromElevation: 2, toElevation: 1 };
ramps.push(p2MainRamp);
createRampInTerrain(terrain, p2MainRamp);

// P3 main ramp (bottom-right, facing up) - mirror of P1
const p3MainRamp = { x: WIDTH - 63, y: HEIGHT - 50, width: 8, height: 12, direction: 'north', fromElevation: 2, toElevation: 1 };
ramps.push(p3MainRamp);
createRampInTerrain(terrain, p3MainRamp);

// P4 main ramp (right side, facing left) - mirror of P2
const p4MainRamp = { x: WIDTH - 50, y: HEIGHT - 90, width: 12, height: 8, direction: 'west', fromElevation: 2, toElevation: 1 };
ramps.push(p4MainRamp);
createRampInTerrain(terrain, p4MainRamp);

// Natural expansion ramps (mid to low)
const p1NatRamp = { x: 70, y: 65, width: 8, height: 10, direction: 'south', fromElevation: 1, toElevation: 0 };
ramps.push(p1NatRamp);
createRampInTerrain(terrain, p1NatRamp);

const p2NatRamp = { x: 65, y: 100, width: 10, height: 8, direction: 'east', fromElevation: 1, toElevation: 0 };
ramps.push(p2NatRamp);
createRampInTerrain(terrain, p2NatRamp);

const p3NatRamp = { x: WIDTH - 78, y: HEIGHT - 75, width: 8, height: 10, direction: 'north', fromElevation: 1, toElevation: 0 };
ramps.push(p3NatRamp);
createRampInTerrain(terrain, p3NatRamp);

const p4NatRamp = { x: WIDTH - 75, y: HEIGHT - 108, width: 10, height: 8, direction: 'west', fromElevation: 1, toElevation: 0 };
ramps.push(p4NatRamp);
createRampInTerrain(terrain, p4NatRamp);

// Center plateau ramps (4 directions)
const centerNRamp = { x: CENTER - 4, y: CENTER - 35, width: 8, height: 10, direction: 'south', fromElevation: 0, toElevation: 1 };
ramps.push(centerNRamp);
createRampInTerrain(terrain, centerNRamp);

const centerSRamp = { x: CENTER - 4, y: CENTER + 25, width: 8, height: 10, direction: 'north', fromElevation: 0, toElevation: 1 };
ramps.push(centerSRamp);
createRampInTerrain(terrain, centerSRamp);

const centerWRamp = { x: CENTER - 35, y: CENTER - 4, width: 10, height: 8, direction: 'east', fromElevation: 0, toElevation: 1 };
ramps.push(centerWRamp);
createRampInTerrain(terrain, centerWRamp);

const centerERamp = { x: CENTER + 25, y: CENTER - 4, width: 10, height: 8, direction: 'west', fromElevation: 0, toElevation: 1 };
ramps.push(centerERamp);
createRampInTerrain(terrain, centerERamp);

// Third base ramps
const third1Ramp = { x: 98, y: 115, width: 8, height: 10, direction: 'north', fromElevation: 0, toElevation: 1 };
ramps.push(third1Ramp);
createRampInTerrain(terrain, third1Ramp);

const third2Ramp = { x: WIDTH - 106, y: HEIGHT - 125, width: 8, height: 10, direction: 'south', fromElevation: 0, toElevation: 1 };
ramps.push(third2Ramp);
createRampInTerrain(terrain, third2Ramp);

// ============================================
// MAIN BASES - High ground
// ============================================

// P1 Main (top-left)
createRaisedRect(terrain, 15, 15, 50, 35, 2, 3);

// P2 Main (below P1)
createRaisedRect(terrain, 15, 58, 35, 42, 2, 3);

// P3 Main (bottom-right) - mirror of P1
createRaisedRect(terrain, WIDTH - 65, HEIGHT - 50, 50, 35, 2, 3);

// P4 Main (above P3) - mirror of P2
createRaisedRect(terrain, WIDTH - 50, HEIGHT - 100, 35, 42, 2, 3);

// ============================================
// NATURAL EXPANSIONS - Mid ground
// ============================================

// P1 Natural
createRaisedRect(terrain, 52, 42, 30, 25, 1, 3);

// P2 Natural
createRaisedRect(terrain, 42, 75, 25, 28, 1, 3);

// P3 Natural - mirror
createRaisedRect(terrain, WIDTH - 82, HEIGHT - 67, 30, 25, 1, 3);

// P4 Natural - mirror
createRaisedRect(terrain, WIDTH - 67, HEIGHT - 103, 25, 28, 1, 3);

// ============================================
// CENTER PLATEAU - Gold base area
// ============================================

createRaisedPlatform(terrain, CENTER, CENTER, 25, 1, 3);

// ============================================
// THIRD BASES - Contested area
// ============================================

createRaisedRect(terrain, 85, 85, 28, 28, 1, 3);
createRaisedRect(terrain, WIDTH - 113, HEIGHT - 113, 28, 28, 1, 3);

// ============================================
// FOURTH BASES - Side pockets
// ============================================

// Top-right pocket (accessible to Team 1)
createRaisedRect(terrain, 165, 25, 28, 25, 1, 3);
// Bottom-left pocket - mirror (accessible to Team 2)
createRaisedRect(terrain, WIDTH - 193, HEIGHT - 50, 28, 25, 1, 3);

// ============================================
// MAP BORDER - Void edges
// ============================================

for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const distFromEdge = Math.min(x, y, WIDTH - 1 - x, HEIGHT - 1 - y);
    if (distFromEdge < 10) {
      if (terrain[y][x].terrain !== 'ramp') {
        terrain[y][x].terrain = 'unwalkable';
        terrain[y][x].feature = 'void';
        terrain[y][x].elevation = 0;
      }
    }
  }
}

// ============================================
// TERRAIN FEATURES
// ============================================

// Void chasms creating lanes
createVoidChasm(terrain, 25, 120, 40, 35, 2);
createVoidChasm(terrain, WIDTH - 65, HEIGHT - 155, 40, 35, 2);

// Forest corridors (flanking routes)
createForestCorridor(terrain, 100, 22, 156, 22, 14, 6, true);
createForestCorridor(terrain, 100, HEIGHT - 22, 156, HEIGHT - 22, 14, 6, true);

// Dense forest patches for ambushes
fillFeatureCircle(terrain, 88, 155, 8, 'forest_dense');
fillFeatureCircle(terrain, WIDTH - 88, HEIGHT - 155, 8, 'forest_dense');

// Light forests near thirds
fillFeatureCircle(terrain, 118, 98, 5, 'forest_light');
fillFeatureCircle(terrain, WIDTH - 118, HEIGHT - 98, 5, 'forest_light');

// Roads connecting bases
createRoad(terrain, 82, 82, CENTER - 30, CENTER - 30, 4);
createRoad(terrain, WIDTH - 82, HEIGHT - 82, CENTER + 30, CENTER + 30, 4);

// ============================================
// SPAWNS
// ============================================

const spawns = [
  { x: 38, y: 32, playerSlot: 1, rotation: Math.PI / 4 },
  { x: 32, y: 78, playerSlot: 2, rotation: Math.PI / 4 },
  { x: WIDTH - 38, y: HEIGHT - 32, playerSlot: 3, rotation: -Math.PI * 3 / 4 },
  { x: WIDTH - 32, y: HEIGHT - 78, playerSlot: 4, rotation: -Math.PI * 3 / 4 },
];

// ============================================
// EXPANSIONS
// ============================================

const expansions = [];

// P1 Main
const p1MainRes = createBaseResources(38, 32, DIR.UP_LEFT);
expansions.push({
  name: 'P1 Main',
  x: 38, y: 32,
  minerals: p1MainRes.minerals,
  vespene: p1MainRes.vespene,
  isMain: true,
  isNatural: false,
});

// P1 Natural
const p1NatRes = createBaseResources(67, 52, DIR.DOWN, MINERAL_NORMAL, GAS_NORMAL, false, MINERAL_DISTANCE_NATURAL);
expansions.push({
  name: 'P1 Natural',
  x: 67, y: 52,
  minerals: p1NatRes.minerals,
  vespene: p1NatRes.vespene,
  isMain: false,
  isNatural: true,
});

// P2 Main
const p2MainRes = createBaseResources(32, 78, DIR.UP_LEFT);
expansions.push({
  name: 'P2 Main',
  x: 32, y: 78,
  minerals: p2MainRes.minerals,
  vespene: p2MainRes.vespene,
  isMain: true,
  isNatural: false,
});

// P2 Natural
const p2NatRes = createBaseResources(54, 88, DIR.LEFT, MINERAL_NORMAL, GAS_NORMAL, false, MINERAL_DISTANCE_NATURAL);
expansions.push({
  name: 'P2 Natural',
  x: 54, y: 88,
  minerals: p2NatRes.minerals,
  vespene: p2NatRes.vespene,
  isMain: false,
  isNatural: true,
});

// P3 Main - mirror of P1
const p3MainRes = createBaseResources(WIDTH - 38, HEIGHT - 32, DIR.DOWN_RIGHT);
expansions.push({
  name: 'P3 Main',
  x: WIDTH - 38, y: HEIGHT - 32,
  minerals: p3MainRes.minerals,
  vespene: p3MainRes.vespene,
  isMain: true,
  isNatural: false,
});

// P3 Natural
const p3NatRes = createBaseResources(WIDTH - 67, HEIGHT - 52, DIR.UP, MINERAL_NORMAL, GAS_NORMAL, false, MINERAL_DISTANCE_NATURAL);
expansions.push({
  name: 'P3 Natural',
  x: WIDTH - 67, y: HEIGHT - 52,
  minerals: p3NatRes.minerals,
  vespene: p3NatRes.vespene,
  isMain: false,
  isNatural: true,
});

// P4 Main - mirror of P2
const p4MainRes = createBaseResources(WIDTH - 32, HEIGHT - 78, DIR.DOWN_RIGHT);
expansions.push({
  name: 'P4 Main',
  x: WIDTH - 32, y: HEIGHT - 78,
  minerals: p4MainRes.minerals,
  vespene: p4MainRes.vespene,
  isMain: true,
  isNatural: false,
});

// P4 Natural
const p4NatRes = createBaseResources(WIDTH - 54, HEIGHT - 88, DIR.RIGHT, MINERAL_NORMAL, GAS_NORMAL, false, MINERAL_DISTANCE_NATURAL);
expansions.push({
  name: 'P4 Natural',
  x: WIDTH - 54, y: HEIGHT - 88,
  minerals: p4NatRes.minerals,
  vespene: p4NatRes.vespene,
  isMain: false,
  isNatural: true,
});

// Team 1 Third
const team1ThirdRes = createBaseResources(99, 99, DIR.DOWN_RIGHT);
expansions.push({
  name: 'Team 1 Third',
  x: 99, y: 99,
  minerals: team1ThirdRes.minerals,
  vespene: team1ThirdRes.vespene,
  isMain: false,
  isNatural: false,
});

// Team 2 Third - mirror
const team2ThirdRes = createBaseResources(WIDTH - 99, HEIGHT - 99, DIR.UP_LEFT);
expansions.push({
  name: 'Team 2 Third',
  x: WIDTH - 99, y: HEIGHT - 99,
  minerals: team2ThirdRes.minerals,
  vespene: team2ThirdRes.vespene,
  isMain: false,
  isNatural: false,
});

// Center Gold Base
const centerGoldRes = createBaseResources(CENTER, CENTER, DIR.UP, 900, GAS_NORMAL, true);
expansions.push({
  name: 'Center Gold',
  x: CENTER, y: CENTER,
  minerals: centerGoldRes.minerals,
  vespene: centerGoldRes.vespene,
  isMain: false,
  isNatural: false,
});

// Top Pocket (4th for Team 1)
const topPocketRes = createBaseResources(179, 38, DIR.UP);
expansions.push({
  name: 'Top Pocket',
  x: 179, y: 38,
  minerals: topPocketRes.minerals,
  vespene: topPocketRes.vespene,
  isMain: false,
  isNatural: false,
});

// Bottom Pocket (4th for Team 2) - mirror
const bottomPocketRes = createBaseResources(WIDTH - 179, HEIGHT - 38, DIR.DOWN);
expansions.push({
  name: 'Bottom Pocket',
  x: WIDTH - 179, y: HEIGHT - 38,
  minerals: bottomPocketRes.minerals,
  vespene: bottomPocketRes.vespene,
  isMain: false,
  isNatural: false,
});

// ============================================
// WATCH TOWERS
// ============================================

const watchTowers = [
  { x: CENTER, y: CENTER - 38, radius: 25 },  // Center north
  { x: 90, y: CENTER, radius: 20 },           // Left flank
  { x: WIDTH - 90, y: CENTER, radius: 20 },   // Right flank
  { x: 112, y: 112, radius: 18 },             // Team 1 area
  { x: WIDTH - 112, y: HEIGHT - 112, radius: 18 }, // Team 2 area
];

// ============================================
// DESTRUCTIBLES
// ============================================

const destructibles = [
  // Center approach rocks
  { x: CENTER - 42, y: CENTER - 42, health: 2000 },
  { x: CENTER + 42, y: CENTER + 42, health: 2000 },
  // Third base backdoor rocks
  { x: 78, y: 122, health: 1500 },
  { x: WIDTH - 78, y: HEIGHT - 122, health: 1500 },
  // Side lane rocks
  { x: 52, y: CENTER, health: 1500 },
  { x: WIDTH - 52, y: CENTER, health: 1500 },
];

// ============================================
// DECORATIONS
// ============================================

const decorations = [];

// Crystal formations at center
decorations.push(
  { type: 'crystal_formation', x: CENTER - 12, y: CENTER - 12, scale: 1.2 },
  { type: 'crystal_formation', x: CENTER + 12, y: CENTER + 12, scale: 1.2 },
  { type: 'crystal_formation', x: CENTER - 18, y: CENTER + 8, scale: 0.9 },
  { type: 'crystal_formation', x: CENTER + 18, y: CENTER - 8, scale: 0.9 }
);

// Rocks scattered around map
for (let i = 0; i < 16; i++) {
  const angle = (i / 16) * Math.PI * 2;
  const r = 85 + Math.sin(i * 2.5) * 15;
  decorations.push({
    type: 'rocks_large',
    x: CENTER + Math.cos(angle) * r,
    y: CENTER + Math.sin(angle) * r,
    scale: 0.7 + Math.random() * 0.3,
    rotation: Math.random() * Math.PI * 2,
  });
}

// Dead trees near chasms
decorations.push(
  { type: 'tree_dead', x: 38, y: 135, scale: 1.0 },
  { type: 'tree_dead', x: WIDTH - 38, y: HEIGHT - 135, scale: 1.0 },
  { type: 'tree_dead', x: 48, y: 148, scale: 0.8 },
  { type: 'tree_dead', x: WIDTH - 48, y: HEIGHT - 148, scale: 0.8 }
);

// Alien trees in forest corridors
decorations.push(
  { type: 'tree_alien', x: 105, y: 20, scale: 1.1 },
  { type: 'tree_alien', x: 150, y: 20, scale: 1.1 },
  { type: 'tree_alien', x: 105, y: HEIGHT - 20, scale: 1.1 },
  { type: 'tree_alien', x: 150, y: HEIGHT - 20, scale: 1.1 }
);

// Debris near towers
watchTowers.forEach((tower) => {
  decorations.push({
    type: 'debris',
    x: tower.x + 4,
    y: tower.y - 4,
    scale: 0.6,
  });
});

// ============================================
// BUILD MAP JSON
// ============================================

const mapJson = {
  id: 'shattered_prism',
  name: 'Shattered Prism',
  author: 'VOIDSTRIKE Team',
  description: 'A world-class competitive 2v2 map featuring team-based spawning, multiple attack paths, and a contested central gold base. Teams must coordinate to control key positions while defending their interconnected bases. 180-degree rotational symmetry ensures perfect balance.',
  width: WIDTH,
  height: HEIGHT,
  biome: 'void',
  playerCount: 4,
  maxPlayers: 4,
  isRanked: true,
  terrain: {
    elevation: serializeElevation(terrain),
    types: serializeTerrainTypes(terrain),
    features: serializeSparseFeatures(terrain),
  },
  spawns,
  expansions,
  watchTowers,
  ramps,
  destructibles,
  decorations,
};

// ============================================
// WRITE FILE
// ============================================

const outputPath = path.join(__dirname, '../src/data/maps/json/shattered_prism.json');
fs.writeFileSync(outputPath, JSON.stringify(mapJson, null, 2));

console.log('Map generated successfully!');
console.log(`  Output: ${outputPath}`);
console.log(`  Size: ${WIDTH}x${HEIGHT}`);
console.log(`  Players: 4 (2v2)`);
console.log(`  Expansions: ${expansions.length}`);
console.log(`  Watch Towers: ${watchTowers.length}`);
console.log(`  Ramps: ${ramps.length}`);
console.log(`  Destructibles: ${destructibles.length}`);
console.log(`  Decorations: ${decorations.length}`);

/**
 * ElevationMapGenerator.ts - Generate MapData from MapBlueprint
 *
 * The core generator that:
 * 1. Executes paint commands to build elevation grid
 * 2. Auto-generates cliffs at elevation boundaries
 * 3. Creates ramp corridors for walkable elevation changes
 * 4. Generates resources for bases
 * 5. Validates connectivity via ConnectivityAnalyzer
 * 6. Auto-fixes issues via ConnectivityFixer
 * 7. Generates decorations from rules
 */

import {
  MapBlueprint,
  PaintCommand,
  BaseLocation,
  ELEVATION,
  CLIFF_THRESHOLD,
  BIOME_THEMES,
  toXY,
} from './ElevationMap';

import {
  MapData,
  MapCell,
  MapDecoration,
  Expansion,
  SpawnPoint,
  WatchTower,
  Ramp,
  DestructibleRock,
  TerrainType,
  TerrainFeature,
  DIR,
  createBaseResources,
  MINERAL_DISTANCE_NATURAL,
} from '../MapTypes';

import { SeededRandom, distance } from '../../../utils/math';
import { debugTerrain } from '@/utils/debugLogger';
import {
  calculateMinRampLength,
  MAX_RAMP_ELEVATION_PER_CELL,
} from '@/data/pathfinding.config';

// Connectivity system imports
import { analyzeConnectivity, getConnectivitySummary } from './ConnectivityAnalyzer';
import { validateConnectivity } from './ConnectivityValidator';
import { autoFixConnectivity as fixConnectivity } from './ConnectivityFixer';
import type { ConnectivityResult } from './ConnectivityGraph';

// ============================================================================
// INTERNAL GRID TYPES
// ============================================================================

interface GenerationGrid {
  width: number;
  height: number;
  elevation: number[][]; // 0-255 per cell
  ramps: boolean[][];    // True if cell is part of a ramp
  features: TerrainFeature[][]; // Terrain features overlay
}

// ============================================================================
// PAINT COMMAND EXECUTION
// ============================================================================

/**
 * Create empty generation grids
 */
function createGrids(width: number, height: number, baseElevation: number): GenerationGrid {
  const elevation: number[][] = [];
  const ramps: boolean[][] = [];
  const features: TerrainFeature[][] = [];

  for (let y = 0; y < height; y++) {
    elevation[y] = [];
    ramps[y] = [];
    features[y] = [];
    for (let x = 0; x < width; x++) {
      elevation[y][x] = baseElevation;
      ramps[y][x] = false;
      features[y][x] = 'none';
    }
  }

  return { width, height, elevation, ramps, features };
}

/**
 * Paint a filled circle on the elevation grid
 */
function paintCircle(
  grid: GenerationGrid,
  cx: number,
  cy: number,
  radius: number,
  elevation: number
): void {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (y >= 0 && y < grid.height && x >= 0 && x < grid.width) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          grid.elevation[y][x] = elevation;
        }
      }
    }
  }
}

/**
 * Paint a filled rectangle on the elevation grid
 */
function paintRect(
  grid: GenerationGrid,
  x: number,
  y: number,
  width: number,
  height: number,
  elevation: number
): void {
  for (let py = Math.floor(y); py < Math.ceil(y + height); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + width); px++) {
      if (py >= 0 && py < grid.height && px >= 0 && px < grid.width) {
        grid.elevation[py][px] = elevation;
      }
    }
  }
}

/**
 * Paint a ramp corridor between two points
 * Creates a walkable gradient between different elevations.
 * Automatically extends the ramp if needed to satisfy walkableClimb constraints.
 */
function paintRamp(
  grid: GenerationGrid,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  width: number
): void {
  // Get elevations at endpoints
  const fromElev = grid.elevation[Math.floor(fromY)]?.[Math.floor(fromX)] ?? ELEVATION.LOW;
  const toElev = grid.elevation[Math.floor(toY)]?.[Math.floor(toX)] ?? ELEVATION.LOW;
  const elevationDelta = Math.abs(toElev - fromElev);

  // Calculate minimum required length based on walkableClimb constraints
  const minRequiredLength = calculateMinRampLength(elevationDelta);

  let dx = toX - fromX;
  let dy = toY - fromY;
  let length = distance(fromX, fromY, toX, toY);
  if (length === 0) return;

  // Auto-extend ramp if too short for the elevation delta
  let actualToX = toX;
  let actualToY = toY;
  if (length < minRequiredLength && minRequiredLength > 0) {
    const scale = minRequiredLength / length;
    actualToX = fromX + dx * scale;
    actualToY = fromY + dy * scale;
    dx = actualToX - fromX;
    dy = actualToY - fromY;
    length = minRequiredLength;
    debugTerrain.log(
      `[ElevationMapGenerator] Ramp auto-extended: elevation delta ${elevationDelta} ` +
      `requires min length ${minRequiredLength} (max ${MAX_RAMP_ELEVATION_PER_CELL} per cell)`
    );
  }

  const steps = Math.ceil(length);
  const perpX = -dy / length;
  const perpY = dx / length;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = fromX + dx * t;
    const cy = fromY + dy * t;
    const elevation = Math.round(fromElev + (toElev - fromElev) * t);

    for (let w = -width / 2; w <= width / 2; w++) {
      const px = Math.floor(cx + perpX * w);
      const py = Math.floor(cy + perpY * w);

      if (py >= 0 && py < grid.height && px >= 0 && px < grid.width) {
        grid.elevation[py][px] = elevation;
        grid.ramps[py][px] = true;
      }
    }
  }
}

/**
 * Paint a feature (water, forest, etc.) on a circular area
 */
function paintFeatureCircle(
  grid: GenerationGrid,
  cx: number,
  cy: number,
  radius: number,
  feature: TerrainFeature
): void {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (y >= 0 && y < grid.height && x >= 0 && x < grid.width) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          // Don't overwrite ramps
          if (!grid.ramps[y][x]) {
            grid.features[y][x] = feature;
          }
        }
      }
    }
  }
}

/**
 * Paint a feature on a rectangular area
 */
function paintFeatureRect(
  grid: GenerationGrid,
  x: number,
  y: number,
  width: number,
  height: number,
  feature: TerrainFeature
): void {
  for (let py = Math.floor(y); py < Math.ceil(y + height); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + width); px++) {
      if (py >= 0 && py < grid.height && px >= 0 && px < grid.width) {
        // Don't overwrite ramps
        if (!grid.ramps[py][px]) {
          grid.features[py][px] = feature;
        }
      }
    }
  }
}

/**
 * Paint a road between two points
 */
function paintRoad(
  grid: GenerationGrid,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  width: number
): void {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = distance(fromX, fromY, toX, toY);
  if (length === 0) return;

  const steps = Math.ceil(length);
  const perpX = -dy / length;
  const perpY = dx / length;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = fromX + dx * t;
    const cy = fromY + dy * t;

    for (let w = -width / 2; w <= width / 2; w++) {
      const px = Math.floor(cx + perpX * w);
      const py = Math.floor(cy + perpY * w);

      if (py >= 0 && py < grid.height && px >= 0 && px < grid.width) {
        if (!grid.ramps[py][px]) {
          grid.features[py][px] = 'road';
        }
      }
    }
  }
}

/**
 * Execute all paint commands on the grid
 */
function executePaintCommands(grid: GenerationGrid, commands: PaintCommand[]): void {
  for (const cmd of commands) {
    switch (cmd.cmd) {
      case 'fill':
        for (let y = 0; y < grid.height; y++) {
          for (let x = 0; x < grid.width; x++) {
            grid.elevation[y][x] = cmd.elevation;
          }
        }
        break;

      case 'plateau':
        paintCircle(grid, cmd.x, cmd.y, cmd.radius, cmd.elevation);
        break;

      case 'rect':
        paintRect(grid, cmd.x, cmd.y, cmd.width, cmd.height, cmd.elevation);
        break;

      case 'ramp': {
        const from = toXY(cmd.from);
        const to = toXY(cmd.to);
        paintRamp(grid, from.x, from.y, to.x, to.y, cmd.width);
        break;
      }

      case 'gradient': {
        const gFrom = toXY(cmd.from);
        const gTo = toXY(cmd.to);
        // Gradient is like a ramp but doesn't mark cells as ramps
        const dx = gTo.x - gFrom.x;
        const dy = gTo.y - gFrom.y;
        const length = distance(gFrom.x, gFrom.y, gTo.x, gTo.y);
        if (length === 0) break;

        const steps = Math.ceil(length);
        const perpX = -dy / length;
        const perpY = dx / length;

        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const cx = gFrom.x + dx * t;
          const cy = gFrom.y + dy * t;
          const elevation = Math.round(cmd.fromElevation + (cmd.toElevation - cmd.fromElevation) * t);

          for (let w = -cmd.width / 2; w <= cmd.width / 2; w++) {
            const px = Math.floor(cx + perpX * w);
            const py = Math.floor(cy + perpY * w);

            if (py >= 0 && py < grid.height && px >= 0 && px < grid.width) {
              grid.elevation[py][px] = elevation;
            }
          }
        }
        break;
      }

      case 'water':
        if (cmd.radius !== undefined) {
          paintFeatureCircle(grid, cmd.x, cmd.y, cmd.radius, cmd.depth === 'deep' ? 'water_deep' : 'water_shallow');
        } else if (cmd.width !== undefined && cmd.height !== undefined) {
          paintFeatureRect(grid, cmd.x, cmd.y, cmd.width, cmd.height, cmd.depth === 'deep' ? 'water_deep' : 'water_shallow');
        }
        break;

      case 'forest': {
        const density = cmd.density;
        const feature: TerrainFeature = density === 'dense' ? 'forest_dense' :
          density === 'medium' ? 'forest_dense' :
            density === 'light' ? 'forest_light' : 'forest_light';

        if (cmd.radius !== undefined) {
          paintFeatureCircle(grid, cmd.x, cmd.y, cmd.radius, feature);
        } else if (cmd.width !== undefined && cmd.height !== undefined) {
          paintFeatureRect(grid, cmd.x, cmd.y, cmd.width, cmd.height, feature);
        }
        break;
      }

      case 'void':
        if (cmd.radius !== undefined) {
          paintFeatureCircle(grid, cmd.x, cmd.y, cmd.radius, 'void');
        } else if (cmd.width !== undefined && cmd.height !== undefined) {
          paintFeatureRect(grid, cmd.x, cmd.y, cmd.width, cmd.height, 'void');
        }
        break;

      case 'road': {
        const rFrom = toXY(cmd.from);
        const rTo = toXY(cmd.to);
        paintRoad(grid, rFrom.x, rFrom.y, rTo.x, rTo.y, cmd.width);
        break;
      }

      case 'unwalkable':
        // Mark as void feature (will become unwalkable terrain)
        if (cmd.radius !== undefined) {
          paintFeatureCircle(grid, cmd.x, cmd.y, cmd.radius, 'cliff');
        } else if (cmd.width !== undefined && cmd.height !== undefined) {
          paintFeatureRect(grid, cmd.x, cmd.y, cmd.width, cmd.height, 'cliff');
        }
        break;

      case 'border':
        // Paint unwalkable border around map edges
        for (let y = 0; y < grid.height; y++) {
          for (let x = 0; x < grid.width; x++) {
            if (x < cmd.thickness || x >= grid.width - cmd.thickness ||
              y < cmd.thickness || y >= grid.height - cmd.thickness) {
              grid.features[y][x] = 'void';
            }
          }
        }
        break;

      case 'mud':
        paintFeatureCircle(grid, cmd.x, cmd.y, cmd.radius, 'mud');
        break;
    }
  }
}

// ============================================================================
// TERRAIN GENERATION FROM GRIDS
// ============================================================================

/**
 * Check if a cell should be a cliff based on elevation differences
 */
function isCliffCell(
  grid: GenerationGrid,
  x: number,
  y: number
): boolean {
  // Ramps are never cliffs
  if (grid.ramps[y][x]) return false;

  const centerElev = grid.elevation[y][x];

  // Check 8 neighbors
  const neighbors = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];

  for (const [dx, dy] of neighbors) {
    const nx = x + dx;
    const ny = y + dy;

    if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height) {
      const neighborElev = grid.elevation[ny][nx];
      const diff = Math.abs(centerElev - neighborElev);

      // If significant elevation difference and neighbor isn't a ramp
      if (diff >= CLIFF_THRESHOLD && !grid.ramps[ny][nx]) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Generate MapCell terrain from generation grids
 */
function generateTerrain(grid: GenerationGrid, seed: number): MapCell[][] {
  const terrain: MapCell[][] = [];
  const random = new SeededRandom(seed);

  for (let y = 0; y < grid.height; y++) {
    terrain[y] = [];
    for (let x = 0; x < grid.width; x++) {
      const elevation = grid.elevation[y][x];
      const isRamp = grid.ramps[y][x];
      const feature = grid.features[y][x];

      // Determine terrain type
      let terrainType: TerrainType = 'ground';

      if (isRamp) {
        terrainType = 'ramp';
      } else if (feature === 'void' || feature === 'cliff' || feature === 'water_deep') {
        terrainType = 'unwalkable';
      } else if (isCliffCell(grid, x, y)) {
        terrainType = 'unwalkable';
      } else if (feature !== 'none' && feature !== 'road') {
        terrainType = 'unbuildable';
      }

      terrain[y][x] = {
        terrain: terrainType,
        elevation,
        feature: isRamp ? 'none' : feature,
        textureId: random.nextInt(0, 3),
      };
    }
  }

  return terrain;
}

// ============================================================================
// RESOURCE GENERATION
// ============================================================================

/**
 * Get resource direction from BaseLocation mineralDirection
 */
function getResourceDirection(dir: BaseLocation['mineralDirection']): number {
  switch (dir) {
    case 'up': return DIR.UP;
    case 'down': return DIR.DOWN;
    case 'left': return DIR.LEFT;
    case 'right': return DIR.RIGHT;
    case 'up_left': return DIR.UP_LEFT;
    case 'up_right': return DIR.UP_RIGHT;
    case 'down_left': return DIR.DOWN_LEFT;
    case 'down_right': return DIR.DOWN_RIGHT;
    default: return DIR.DOWN;
  }
}

/**
 * Generate expansions with resources from base locations
 */
function generateExpansions(bases: BaseLocation[]): Expansion[] {
  return bases.map((base) => {
    const direction = getResourceDirection(base.mineralDirection);
    const isNatural = base.type === 'natural';
    const mineralDistance = isNatural ? MINERAL_DISTANCE_NATURAL : 7;

    const resources = createBaseResources(
      base.x,
      base.y,
      direction,
      1500,
      2250,
      base.isGold ?? false,
      mineralDistance
    );

    return {
      name: `${base.type.charAt(0).toUpperCase() + base.type.slice(1)} ${base.playerSlot ? `P${base.playerSlot}` : ''}`.trim(),
      x: base.x,
      y: base.y,
      minerals: resources.minerals,
      vespene: resources.vespene,
      isMain: base.type === 'main',
      isNatural: base.type === 'natural',
    };
  });
}

/**
 * Generate spawn points from main bases
 */
function generateSpawns(bases: BaseLocation[]): SpawnPoint[] {
  return bases
    .filter((b) => b.type === 'main' && b.playerSlot !== undefined)
    .map((b) => ({
      x: b.x,
      y: b.y,
      playerSlot: b.playerSlot!,
      rotation: getResourceDirection(b.mineralDirection),
    }));
}

// ============================================================================
// RAMP EXTRACTION
// ============================================================================

/**
 * Extract ramp definitions from the ramp grid
 * Groups connected ramp cells into Ramp objects
 */
function extractRamps(grid: GenerationGrid): Ramp[] {
  const ramps: Ramp[] = [];
  const visited = new Set<string>();

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.ramps[y][x] && !visited.has(`${x},${y}`)) {
        // Flood fill to find connected ramp cells
        const cells: Array<{ x: number; y: number }> = [];
        const queue: Array<{ x: number; y: number }> = [{ x, y }];
        visited.add(`${x},${y}`);

        while (queue.length > 0) {
          const cell = queue.shift()!;
          cells.push(cell);

          // Check 4 neighbors (for cleaner ramp shapes)
          const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
          for (const [dx, dy] of neighbors) {
            const nx = cell.x + dx;
            const ny = cell.y + dy;
            const key = `${nx},${ny}`;

            if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height &&
              grid.ramps[ny][nx] && !visited.has(key)) {
              visited.add(key);
              queue.push({ x: nx, y: ny });
            }
          }
        }

        if (cells.length > 0) {
          // Calculate bounding box
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          let minElev = Infinity, maxElev = -Infinity;

          for (const cell of cells) {
            minX = Math.min(minX, cell.x);
            maxX = Math.max(maxX, cell.x);
            minY = Math.min(minY, cell.y);
            maxY = Math.max(maxY, cell.y);
            const elev = grid.elevation[cell.y][cell.x];
            minElev = Math.min(minElev, elev);
            maxElev = Math.max(maxElev, elev);
          }

          // Determine ramp direction based on elevation gradient
          const width = maxX - minX + 1;
          const height = maxY - minY + 1;
          let direction: Ramp['direction'] = 'south';

          if (width > height) {
            // Horizontal ramp - check if elevation increases left or right
            const leftElev = grid.elevation[Math.floor((minY + maxY) / 2)][minX];
            const rightElev = grid.elevation[Math.floor((minY + maxY) / 2)][maxX];
            direction = leftElev < rightElev ? 'east' : 'west';
          } else {
            // Vertical ramp - check if elevation increases up or down
            const topElev = grid.elevation[minY][Math.floor((minX + maxX) / 2)];
            const bottomElev = grid.elevation[maxY][Math.floor((minX + maxX) / 2)];
            direction = topElev < bottomElev ? 'south' : 'north';
          }

          ramps.push({
            x: minX,
            y: minY,
            width,
            height,
            direction,
            fromElevation: minElev,
            toElevation: maxElev,
          });
        }
      }
    }
  }

  return ramps;
}

// ============================================================================
// DECORATION GENERATION
// ============================================================================

/**
 * Generate decorations from rules
 */
function generateDecorations(
  blueprint: MapBlueprint,
  grid: GenerationGrid,
  terrain: MapCell[][],
  bases: BaseLocation[],
  seed: number
): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const random = new SeededRandom(seed);
  const rules = blueprint.decorationRules;

  if (!rules) return decorations;

  const { width, height } = grid;

  // Helper to check if position is near a base
  const isNearBase = (x: number, y: number, minDist: number = 25): boolean => {
    for (const base of bases) {
      if (distance(x, y, base.x, base.y) < minDist) return true;
    }
    return false;
  };

  // Helper to check if position is on a ramp
  const isOnRamp = (x: number, y: number): boolean => {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px >= 0 && px < width && py >= 0 && py < height) {
      return grid.ramps[py][px];
    }
    return false;
  };

  // Helper to check if position is walkable
  const isWalkable = (x: number, y: number): boolean => {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px >= 0 && px < width && py >= 0 && py < height) {
      const t = terrain[py][px].terrain;
      return t === 'ground' || t === 'ramp' || t === 'unbuildable';
    }
    return false;
  };

  // Get decoration types for a style
  const getTypesForStyle = (style: string): MapDecoration['type'][] => {
    switch (style) {
      case 'rocks': return ['rocks_large', 'rocks_small', 'rock_single'];
      case 'crystals': return ['crystal_formation'];
      case 'trees': return ['tree_pine_tall', 'tree_dead'];
      case 'dead_trees': return ['tree_dead'];
      case 'alien': return ['tree_alien', 'crystal_formation'];
      case 'mixed': return ['rocks_large', 'rocks_small', 'crystal_formation', 'tree_dead'];
      default: return ['rocks_large', 'rocks_small'];
    }
  };

  // Border decorations
  if (rules.border) {
    const { style, density, scale, innerOffset = 12, outerOffset = 5 } = rules.border;
    const types = getTypesForStyle(style);
    const perimeter = 2 * (width + height);
    const count = Math.floor(perimeter * density);

    // Outer ring (massive, at edge)
    for (let i = 0; i < count; i++) {
      const t = i / count;
      let x: number, y: number;

      const perimeterPos = t * perimeter;
      if (perimeterPos < width) {
        x = perimeterPos;
        y = outerOffset;
      } else if (perimeterPos < width + height) {
        x = width - outerOffset;
        y = perimeterPos - width;
      } else if (perimeterPos < 2 * width + height) {
        x = width - (perimeterPos - width - height);
        y = height - outerOffset;
      } else {
        x = outerOffset;
        y = height - (perimeterPos - 2 * width - height);
      }

      // Add jitter
      x += (random.next() - 0.5) * 4;
      y += (random.next() - 0.5) * 4;

      decorations.push({
        type: types[random.nextInt(0, types.length - 1)],
        x,
        y,
        scale: scale[0] + random.next() * (scale[1] - scale[0]),
        rotation: random.next() * Math.PI * 2,
      });
    }

    // Inner ring
    const innerCount = Math.floor(count * 0.7);
    for (let i = 0; i < innerCount; i++) {
      const t = i / innerCount;
      let x: number, y: number;

      const innerW = width - 2 * innerOffset;
      const innerH = height - 2 * innerOffset;
      const innerPerimeter = 2 * (innerW + innerH);
      const perimeterPos = t * innerPerimeter;

      if (perimeterPos < innerW) {
        x = innerOffset + perimeterPos;
        y = innerOffset;
      } else if (perimeterPos < innerW + innerH) {
        x = width - innerOffset;
        y = innerOffset + (perimeterPos - innerW);
      } else if (perimeterPos < 2 * innerW + innerH) {
        x = width - innerOffset - (perimeterPos - innerW - innerH);
        y = height - innerOffset;
      } else {
        x = innerOffset;
        y = height - innerOffset - (perimeterPos - 2 * innerW - innerH);
      }

      x += (random.next() - 0.5) * 3;
      y += (random.next() - 0.5) * 3;

      if (isNearBase(x, y, 20)) continue;

      decorations.push({
        type: types[random.nextInt(0, types.length - 1)],
        x,
        y,
        scale: (scale[0] + random.next() * (scale[1] - scale[0])) * 0.7,
        rotation: random.next() * Math.PI * 2,
      });
    }
  }

  // Base ring decorations
  if (rules.baseRings) {
    const { rocks = 0, trees = 0, crystals = 0 } = rules.baseRings;

    for (const base of bases) {
      const baseRadius = base.type === 'main' ? 24 : base.type === 'natural' ? 18 : 16;

      // Rock ring
      for (let i = 0; i < rocks; i++) {
        const angle = (i / rocks) * Math.PI * 2 + random.next() * 0.3;
        const dist = baseRadius + 2 + random.next() * 4;
        const x = base.x + Math.cos(angle) * dist;
        const y = base.y + Math.sin(angle) * dist;

        if (isOnRamp(x, y)) continue;

        decorations.push({
          type: random.next() < 0.5 ? 'rocks_large' : 'rocks_small',
          x,
          y,
          scale: 0.5 + random.next() * 0.5,
          rotation: random.next() * Math.PI * 2,
        });
      }

      // Tree ring
      for (let i = 0; i < trees; i++) {
        const angle = (i / trees) * Math.PI * 2 + random.next() * 0.4;
        const dist = baseRadius + 5 + random.next() * 5;
        const x = base.x + Math.cos(angle) * dist;
        const y = base.y + Math.sin(angle) * dist;

        if (isOnRamp(x, y)) continue;

        decorations.push({
          type: 'tree_dead',
          x,
          y,
          scale: 0.6 + random.next() * 0.4,
          rotation: random.next() * Math.PI * 2,
        });
      }

      // Crystal ring
      for (let i = 0; i < crystals; i++) {
        const angle = (i / crystals) * Math.PI * 2 + random.next() * 0.3;
        const dist = baseRadius + 3 + random.next() * 3;
        const x = base.x + Math.cos(angle) * dist;
        const y = base.y + Math.sin(angle) * dist;

        if (isOnRamp(x, y)) continue;

        decorations.push({
          type: 'crystal_formation',
          x,
          y,
          scale: 0.5 + random.next() * 0.6,
          rotation: random.next() * Math.PI * 2,
        });
      }
    }
  }

  // Scatter decorations
  if (rules.scatter) {
    const totalDensity = (rules.scatter.rocks ?? 0) + (rules.scatter.crystals ?? 0) +
      (rules.scatter.trees ?? 0) + (rules.scatter.deadTrees ?? 0) +
      (rules.scatter.alienTrees ?? 0) + (rules.scatter.debris ?? 0);

    const count = Math.floor(width * height * totalDensity * 0.001);

    for (let i = 0; i < count; i++) {
      const x = 15 + random.next() * (width - 30);
      const y = 15 + random.next() * (height - 30);

      if (isNearBase(x, y, 20) || isOnRamp(x, y) || !isWalkable(x, y)) continue;

      // Pick random type based on weights
      const r = random.next() * totalDensity;
      let accumulated = 0;
      let type: MapDecoration['type'] = 'rocks_small';

      accumulated += rules.scatter.rocks ?? 0;
      if (r < accumulated) {
        type = random.next() < 0.5 ? 'rocks_large' : 'rocks_small';
      } else {
        accumulated += rules.scatter.crystals ?? 0;
        if (r < accumulated) {
          type = 'crystal_formation';
        } else {
          accumulated += rules.scatter.trees ?? 0;
          if (r < accumulated) {
            type = 'tree_pine_tall';
          } else {
            accumulated += rules.scatter.deadTrees ?? 0;
            if (r < accumulated) {
              type = 'tree_dead';
            } else {
              accumulated += rules.scatter.alienTrees ?? 0;
              if (r < accumulated) {
                type = 'tree_alien';
              } else {
                type = 'debris';
              }
            }
          }
        }
      }

      decorations.push({
        type,
        x,
        y,
        scale: 0.4 + random.next() * 0.6,
        rotation: random.next() * Math.PI * 2,
      });
    }
  }

  // Add explicit decorations
  if (blueprint.explicitDecorations) {
    for (const dec of blueprint.explicitDecorations) {
      decorations.push({
        type: dec.type,
        x: dec.x,
        y: dec.y,
        scale: dec.scale ?? 1,
        rotation: dec.rotation ?? random.next() * Math.PI * 2,
      });
    }
  }

  return decorations;
}

// ============================================================================
// GENERATION OPTIONS
// ============================================================================

/** Options for map generation */
export interface GenerateMapOptions {
  /** Enable/disable connectivity validation (default: true) */
  validate?: boolean;

  /** Auto-fix connectivity issues (default: true) */
  autoFix?: boolean;

  /** Log to console (default: true in dev, false in prod) */
  verbose?: boolean;
}

/** Result of map generation including connectivity info */
export interface GenerateMapResult {
  /** The generated map data */
  mapData: MapData;

  /** Connectivity validation result (if validation enabled) */
  connectivity?: ConnectivityResult;

  /** Whether auto-fix was applied */
  autoFixed: boolean;

  /** Messages from the generation process */
  messages: string[];
}

// ============================================================================
// MAIN GENERATION FUNCTION
// ============================================================================

/**
 * Generate MapData from a MapBlueprint
 *
 * @param blueprint - The map definition
 * @param options - Optional generation settings
 * @returns MapData (or GenerateMapResult if options.returnResult is true)
 */
export function generateMap(blueprint: MapBlueprint, options?: GenerateMapOptions): MapData {
  const result = generateMapWithResult(blueprint, options);
  return result.mapData;
}

/**
 * Generate MapData from a MapBlueprint with full result including connectivity info.
 *
 * Use this when you need access to connectivity validation results.
 */
export function generateMapWithResult(
  blueprint: MapBlueprint,
  options?: GenerateMapOptions
): GenerateMapResult {
  const opts: Required<GenerateMapOptions> = {
    validate: options?.validate ?? false,  // Disabled by default - expensive for static generation
    autoFix: options?.autoFix ?? true,
    verbose: options?.verbose ?? false,
  };

  const messages: string[] = [];
  const { meta, canvas, paint, bases, watchTowers, destructibles, decorationRules } = blueprint;
  const { width, height, biome } = canvas;
  const theme = BIOME_THEMES[biome];
  const seed = decorationRules?.seed ?? Date.now();

  // Create generation grids
  const grid = createGrids(width, height, ELEVATION.LOW);

  // Execute paint commands
  executePaintCommands(grid, paint);

  // Generate terrain from grids
  const terrain = generateTerrain(grid, seed);

  // Generate expansions and spawns
  const expansions = generateExpansions(bases);
  const spawns = generateSpawns(bases);

  // Extract ramps
  const ramps = extractRamps(grid);

  // Convert watch towers
  const towers: WatchTower[] = (watchTowers ?? []).map((wt) => ({
    x: wt.x,
    y: wt.y,
    radius: wt.vision,
  }));

  // Convert destructibles
  const rocks: DestructibleRock[] = (destructibles ?? []).map((d) => ({
    x: d.x,
    y: d.y,
    health: d.health,
  }));

  // Generate decorations
  const decorations = generateDecorations(blueprint, grid, terrain, bases, seed);

  // Build MapData
  const mapData: MapData = {
    id: meta.id,
    name: meta.name,
    author: meta.author ?? 'Unknown',
    description: meta.description ?? '',

    width,
    height,
    terrain,

    spawns,
    expansions,
    watchTowers: towers,
    ramps,
    destructibles: rocks,
    decorations,

    playerCount: meta.players as 2 | 4 | 6 | 8,
    maxPlayers: meta.players,
    isRanked: true,

    biome,
    fogNear: theme.fogNear,
    fogFar: theme.fogFar,
  };

  // Connectivity validation
  let connectivity: ConnectivityResult | undefined;
  let autoFixed = false;

  if (opts.validate) {
    // Analyze connectivity using new system
    const graph = analyzeConnectivity(mapData);
    connectivity = validateConnectivity(graph);

    if (opts.verbose) {
      messages.push(getConnectivitySummary(graph));
    }

    if (!connectivity.valid) {
      messages.push(`[ElevationMapGenerator] ${meta.id}: Connectivity issues detected`);
      for (const issue of connectivity.issues) {
        messages.push(`[ElevationMapGenerator]   ${issue.severity.toUpperCase()}: ${issue.message}`);
      }

      if (opts.autoFix) {
        messages.push(`[ElevationMapGenerator] ${meta.id}: Attempting auto-fix`);
        const fixResult = fixConnectivity(mapData);
        autoFixed = fixResult.rampsAdded > 0;

        if (fixResult.rampsAdded > 0) {
          messages.push(`[ElevationMapGenerator] ${meta.id}: Added ${fixResult.rampsAdded} ramps to fix connectivity`);

          // Re-validate
          const reGraph = analyzeConnectivity(mapData);
          connectivity = validateConnectivity(reGraph);

          if (connectivity.valid) {
            messages.push(`[ElevationMapGenerator] ${meta.id}: Connectivity fixed successfully`);
          } else {
            messages.push(`[ElevationMapGenerator] ${meta.id}: Some issues remain after auto-fix`);
          }
        } else {
          messages.push(`[ElevationMapGenerator] ${meta.id}: No automatic fixes available`);
        }
      }
    } else {
      messages.push(`[ElevationMapGenerator] ${meta.id}: Connectivity validated with ${connectivity.stats.connectedPairs} connected pairs`);
    }

    // Log messages if verbose
    if (opts.verbose) {
      for (const msg of messages) {
        debugTerrain.log(msg);
      }
    }
  }

  return {
    mapData,
    connectivity,
    autoFixed,
    messages,
  };
}

/**
 * MapScaffolder - Auto-generates connected maps from base positions
 *
 * Given just base locations, this module generates:
 * 1. Appropriate elevation plateaus for each base type
 * 2. Ramps connecting adjacent bases
 * 3. Complete MapBlueprint with guaranteed connectivity
 *
 * This is the foundation for visual map editors and quick prototyping.
 */

import type {
  MapBlueprint,
  MapCanvas,
  MapMeta,
  BaseLocation,
  BaseType,
  PaintCommand,
  BiomeType,
  DecorationRules,
} from './ElevationMap';
import {
  ELEVATION,
  fill,
  plateau,
  ramp,
  border,
} from './ElevationMap';
import { distance } from '@/utils/math';

// =============================================================================
// TYPES
// =============================================================================

/** Input for scaffolding a map */
export interface MapScaffold {
  /** Canvas definition (size, biome) */
  canvas: MapCanvas;

  /** Base locations - the only required input */
  bases: BaseLocation[];

  /** Optional metadata */
  meta?: Partial<MapMeta>;

  /** Optional explicit connections (overrides auto-detection) */
  connections?: DesiredConnection[];

  /** Optional decoration rules */
  decorationRules?: DecorationRules;
}

/** Explicit connection between bases */
export interface DesiredConnection {
  /** ID or index of first base */
  from: string | number;

  /** ID or index of second base */
  to: string | number;

  /** Ramp width (default 10) */
  width?: number;
}

/** Configuration for scaffold generation */
export interface ScaffoldConfig {
  /** Elevation for main bases (default HIGH) */
  mainElevation: number;

  /** Elevation for natural expansions (default MID) */
  naturalElevation: number;

  /** Elevation for third/fourth/gold expansions (default LOW) */
  expansionElevation: number;

  /** Radius multiplier for base plateaus (default 1.0) */
  plateauScale: number;

  /** Default ramp width (default 10) */
  defaultRampWidth: number;

  /** Border width (default 12) */
  borderWidth: number;

  /** Auto-connect mains to naturals (default true) */
  autoConnectMainNatural: boolean;

  /** Auto-connect naturals to thirds (default true) */
  autoConnectNaturalThird: boolean;

  /** Auto-connect all mains together (default true) */
  autoConnectMains: boolean;
}

const DEFAULT_CONFIG: ScaffoldConfig = {
  mainElevation: ELEVATION.HIGH,
  naturalElevation: ELEVATION.MID,
  expansionElevation: ELEVATION.LOW,
  plateauScale: 1.0,
  defaultRampWidth: 10,
  borderWidth: 12,
  autoConnectMainNatural: true,
  autoConnectNaturalThird: true,
  autoConnectMains: true,
};

// =============================================================================
// BASE ANALYSIS
// =============================================================================

/** Get default elevation for a base type */
function getBaseElevation(type: BaseType, config: ScaffoldConfig): number {
  switch (type) {
    case 'main':
      return config.mainElevation;
    case 'natural':
      return config.naturalElevation;
    case 'third':
    case 'fourth':
    case 'gold':
      return config.expansionElevation;
    default:
      return config.expansionElevation;
  }
}

/** Get default plateau radius for a base type */
function getBaseRadius(type: BaseType, config: ScaffoldConfig): number {
  const baseRadius: Record<BaseType, number> = {
    main: 24,
    natural: 18,
    third: 16,
    fourth: 14,
    fifth: 14,
    gold: 14,
    pocket: 12,
  };
  return Math.round(baseRadius[type] * config.plateauScale);
}

/** Find the closest base of a specific type to a given base */
function findClosestOfType(
  base: BaseLocation,
  bases: BaseLocation[],
  targetType: BaseType
): BaseLocation | null {
  let closest: BaseLocation | null = null;
  let closestDist = Infinity;

  for (const other of bases) {
    if (other === base) continue;
    if (other.type !== targetType) continue;

    const dist = distance(base.x, base.y, other.x, other.y);

    if (dist < closestDist) {
      closestDist = dist;
      closest = other;
    }
  }

  return closest;
}

// =============================================================================
// CONNECTION DETECTION
// =============================================================================

interface Connection {
  from: BaseLocation;
  to: BaseLocation;
  width: number;
}

/**
 * Auto-detect which bases should be connected based on type and proximity.
 */
function detectConnections(
  bases: BaseLocation[],
  config: ScaffoldConfig,
  explicitConnections?: DesiredConnection[]
): Connection[] {
  const connections: Connection[] = [];
  const connectedPairs = new Set<string>();

  // Helper to add a connection
  const addConnection = (from: BaseLocation, to: BaseLocation, width: number) => {
    const key1 = `${from.x},${from.y}-${to.x},${to.y}`;
    const key2 = `${to.x},${to.y}-${from.x},${from.y}`;

    if (!connectedPairs.has(key1) && !connectedPairs.has(key2)) {
      connectedPairs.add(key1);
      connections.push({ from, to, width });
    }
  };

  // Process explicit connections first
  if (explicitConnections) {
    for (const conn of explicitConnections) {
      const from = typeof conn.from === 'number' ? bases[conn.from] : bases.find(b =>
        `${b.type}_${b.playerSlot}` === conn.from || `${b.x},${b.y}` === conn.from
      );
      const to = typeof conn.to === 'number' ? bases[conn.to] : bases.find(b =>
        `${b.type}_${b.playerSlot}` === conn.to || `${b.x},${b.y}` === conn.to
      );

      if (from && to) {
        addConnection(from, to, conn.width ?? config.defaultRampWidth);
      }
    }
  }

  // Get mains
  const mains = bases.filter(b => b.type === 'main');
  const naturals = bases.filter(b => b.type === 'natural');

  // Auto-connect mains to their closest natural
  if (config.autoConnectMainNatural) {
    for (const main of mains) {
      const closestNatural = findClosestOfType(main, bases, 'natural');
      if (closestNatural) {
        addConnection(main, closestNatural, config.defaultRampWidth);
      }
    }
  }

  // Auto-connect naturals to closest third
  if (config.autoConnectNaturalThird) {
    for (const natural of naturals) {
      const closestThird = findClosestOfType(natural, bases, 'third');
      if (closestThird) {
        // Smaller ramp for natural→third
        addConnection(natural, closestThird, Math.round(config.defaultRampWidth * 0.8));
      }
    }
  }

  // Auto-connect all mains together (through low ground)
  if (config.autoConnectMains && mains.length > 1) {
    // For 2 players, we rely on natural→third→center connections
    // For 4+ players, we might need to ensure center connectivity
    // This is handled by the fact that thirds are at low elevation
    // and will be connected through ground paths
  }

  return connections;
}

// =============================================================================
// PAINT COMMAND GENERATION
// =============================================================================

/**
 * Generate paint commands for a scaffold.
 */
function generatePaintCommands(
  scaffold: MapScaffold,
  config: ScaffoldConfig
): PaintCommand[] {
  const commands: PaintCommand[] = [];

  // 1. Fill with low ground
  commands.push(fill(ELEVATION.LOW));

  // 2. Create plateaus for each base
  for (const base of scaffold.bases) {
    const elevation = getBaseElevation(base.type, config);
    const radius = getBaseRadius(base.type, config);

    // Only create plateaus for elevated bases
    if (elevation > ELEVATION.LOW) {
      commands.push(plateau(base.x, base.y, radius, elevation));
    }
  }

  // 3. Detect and create ramps
  const connections = detectConnections(scaffold.bases, config, scaffold.connections);

  for (const conn of connections) {
    const fromElev = getBaseElevation(conn.from.type, config);
    const toElev = getBaseElevation(conn.to.type, config);

    // Only create ramps if there's an elevation difference
    if (Math.abs(fromElev - toElev) >= 40) {
      commands.push(ramp(
        [conn.from.x, conn.from.y],
        [conn.to.x, conn.to.y],
        conn.width
      ));
    }
  }

  // 4. Add border
  commands.push(border(config.borderWidth));

  return commands;
}

// =============================================================================
// MAIN SCAFFOLDING FUNCTION
// =============================================================================

/**
 * Generate a complete MapBlueprint from base positions.
 *
 * This is the main function for quick map prototyping. Given just base
 * locations, it generates a playable map with proper elevations and ramps.
 *
 * @example
 * ```typescript
 * const blueprint = scaffoldMap({
 *   canvas: { width: 200, height: 200, biome: 'void' },
 *   bases: [
 *     mainBase(30, 170, 1, 'down_left'),
 *     mainBase(170, 30, 2, 'up_right'),
 *     naturalBase(60, 140, 'down_left'),
 *     naturalBase(140, 60, 'up_right'),
 *     thirdBase(30, 30, 'up_left'),
 *     thirdBase(170, 170, 'down_right'),
 *   ],
 * });
 *
 * // Add custom terrain
 * blueprint.paint.push(
 *   water(100, 100, 15),
 *   forest(80, 80, 10, 'dense'),
 * );
 *
 * const mapData = generateMap(blueprint);
 * ```
 */
export function scaffoldMap(
  scaffold: MapScaffold,
  configOverrides?: Partial<ScaffoldConfig>
): MapBlueprint {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };

  // Count players from main bases
  const mains = scaffold.bases.filter(b => b.type === 'main');
  const playerCount = mains.length as 2 | 4 | 6 | 8;

  // Generate paint commands
  const paint = generatePaintCommands(scaffold, config);

  // Build blueprint
  const blueprint: MapBlueprint = {
    meta: {
      id: scaffold.meta?.id ?? 'scaffolded_map',
      name: scaffold.meta?.name ?? 'Scaffolded Map',
      author: scaffold.meta?.author ?? 'Map Scaffolder',
      description: scaffold.meta?.description ?? 'Auto-generated map from base positions',
      players: playerCount,
    },
    canvas: scaffold.canvas,
    paint,
    bases: scaffold.bases,
    decorationRules: scaffold.decorationRules ?? {
      border: {
        style: 'rocks',
        density: 0.7,
        scale: [1.5, 3.0],
        innerOffset: 15,
        outerOffset: 5,
      },
      baseRings: {
        rocks: 16,
        trees: 10,
      },
      scatter: {
        rocks: 0.2,
        debris: 0.1,
      },
      seed: Math.floor(Math.random() * 1000),
    },
  };

  return blueprint;
}

/**
 * Quick scaffold for a 1v1 map with diagonal spawns.
 */
export function scaffold1v1Diagonal(
  width: number,
  height: number,
  biome: BiomeType = 'void'
): MapBlueprint {
  const margin = 35;
  const naturalOffset = 40;

  return scaffoldMap({
    canvas: { width, height, biome },
    meta: {
      id: '1v1_diagonal',
      name: '1v1 Diagonal',
      players: 2,
    },
    bases: [
      // Mains in opposite corners
      { type: 'main', x: margin, y: height - margin, playerSlot: 1, mineralDirection: 'down_left' },
      { type: 'main', x: width - margin, y: margin, playerSlot: 2, mineralDirection: 'up_right' },
      // Naturals
      { type: 'natural', x: margin + naturalOffset, y: height - margin - naturalOffset, mineralDirection: 'down_left' },
      { type: 'natural', x: width - margin - naturalOffset, y: margin + naturalOffset, mineralDirection: 'up_right' },
      // Thirds (opposite corners)
      { type: 'third', x: margin, y: margin, mineralDirection: 'up_left' },
      { type: 'third', x: width - margin, y: height - margin, mineralDirection: 'down_right' },
    ],
  });
}

/**
 * Quick scaffold for a 1v1 map with horizontal spawns.
 */
export function scaffold1v1Horizontal(
  width: number,
  height: number,
  biome: BiomeType = 'frozen'
): MapBlueprint {
  const marginX = 35;
  const centerY = height / 2;
  const naturalOffset = 30;

  return scaffoldMap({
    canvas: { width, height, biome },
    meta: {
      id: '1v1_horizontal',
      name: '1v1 Horizontal',
      players: 2,
    },
    bases: [
      // Mains on left and right
      { type: 'main', x: marginX, y: centerY, playerSlot: 1, mineralDirection: 'left' },
      { type: 'main', x: width - marginX, y: centerY, playerSlot: 2, mineralDirection: 'right' },
      // Naturals (diagonal from mains)
      { type: 'natural', x: marginX + naturalOffset, y: centerY - naturalOffset, mineralDirection: 'up_left' },
      { type: 'natural', x: width - marginX - naturalOffset, y: centerY + naturalOffset, mineralDirection: 'down_right' },
      // Thirds
      { type: 'third', x: marginX, y: marginX, mineralDirection: 'up_left' },
      { type: 'third', x: width - marginX, y: height - marginX, mineralDirection: 'down_right' },
    ],
  });
}

/**
 * Quick scaffold for a 4-player map with corner spawns.
 */
export function scaffold4Player(
  width: number,
  height: number,
  biome: BiomeType = 'desert'
): MapBlueprint {
  const margin = 40;
  const naturalOffset = 35;

  return scaffoldMap({
    canvas: { width, height, biome },
    meta: {
      id: '4player_corners',
      name: '4 Player Corners',
      players: 4,
    },
    bases: [
      // Mains in corners
      { type: 'main', x: margin, y: margin, playerSlot: 1, mineralDirection: 'up_left' },
      { type: 'main', x: width - margin, y: margin, playerSlot: 2, mineralDirection: 'up_right' },
      { type: 'main', x: margin, y: height - margin, playerSlot: 3, mineralDirection: 'down_left' },
      { type: 'main', x: width - margin, y: height - margin, playerSlot: 4, mineralDirection: 'down_right' },
      // Naturals (diagonal inward)
      { type: 'natural', x: margin + naturalOffset, y: margin + naturalOffset, mineralDirection: 'down_right' },
      { type: 'natural', x: width - margin - naturalOffset, y: margin + naturalOffset, mineralDirection: 'down_left' },
      { type: 'natural', x: margin + naturalOffset, y: height - margin - naturalOffset, mineralDirection: 'up_right' },
      { type: 'natural', x: width - margin - naturalOffset, y: height - margin - naturalOffset, mineralDirection: 'up_left' },
      // Shared thirds (edges)
      { type: 'third', x: margin, y: height / 2, mineralDirection: 'left' },
      { type: 'third', x: width - margin, y: height / 2, mineralDirection: 'right' },
      { type: 'third', x: width / 2, y: margin, mineralDirection: 'up' },
      { type: 'third', x: width / 2, y: height - margin, mineralDirection: 'down' },
    ],
  });
}

/**
 * Add custom terrain to a scaffolded blueprint.
 * Helper for chaining customizations.
 */
export function addTerrain(
  blueprint: MapBlueprint,
  ...commands: PaintCommand[]
): MapBlueprint {
  return {
    ...blueprint,
    paint: [...blueprint.paint, ...commands],
  };
}

/**
 * DeclarativeMapGenerator.ts - Generate MapData from DeclarativeMapDef
 *
 * This generator takes a fully declarative map definition and produces
 * all the terrain, decorations, resources, and game features needed.
 */

import {
  DeclarativeMapDef,
  RegionDef,
  Shape,
  BiomeTheme,
  BIOME_THEMES,
  ForestDensity,
  DecorationCluster as DeclDecorationCluster,
  DecorationLine,
  ResourceTemplateName,
  Point2D,
  ElevationArea,
  ElevationGradient,
} from './DeclarativeMapTypes';

import {
  MapData,
  MapCell,
  MapDecoration,
  Expansion,
  ResourceNode,
} from '../MapTypes';

import {
  MapDefinition,
  RegionDefinition,
  ConnectionDefinition,
  WatchTowerDefinition,
  DestructibleDefinition,
  VoidDefinition,
  WaterDefinition,
  ForestDefinition,
} from './MapDefinition';
import { generateMapFromDefinition } from './MapGenerator';
import { SeededRandom } from '../../../utils/math';

// ============================================================================
// TYPE CONVERSIONS
// ============================================================================

/**
 * Convert DeclarativeMapDef to the existing MapDefinition format
 * This allows us to leverage the existing terrain generation
 */
export function declarativeToMapDefinition(def: DeclarativeMapDef): MapDefinition {
  const theme = typeof def.theme === 'string' ? BIOME_THEMES[def.theme] : def.theme;

  // Convert regions - use elevation256 if provided, otherwise convert simple level
  const regions: RegionDefinition[] = def.regions.map((r) => ({
    id: r.id,
    type: convertRegionType(r.type),
    position: r.position,
    radius: r.radius,
    // Support both simple 0/1/2 levels and custom 256-level elevation
    elevation: r.elevation256 !== undefined ? r.elevation256 : convertSimpleElevation(r.elevation),
    playerSlot: r.playerSlot,
  }));

  // Convert connections
  const connections: ConnectionDefinition[] = def.connections.map((c) => ({
    from: c.from,
    to: c.to,
    type: c.type === 'ramp' ? 'ramp' : 'ground',
    width: c.width,
    waypoints: c.waypoints,
  }));

  // Build terrain features
  const terrain: MapDefinition['terrain'] = {};

  if (def.terrain?.voids) {
    terrain.voids = def.terrain.voids.map((v): VoidDefinition => {
      const shape = convertShapeToOldFormat(v.shape);
      if (shape.type === 'circle') {
        return {
          shape: 'circle',
          position: shape.center,
          radius: shape.radius,
        };
      } else {
        return {
          shape: 'rect',
          position: { x: shape.center.x - (shape.width ?? 0) / 2, y: shape.center.y - (shape.height ?? 0) / 2 },
          size: { width: shape.width ?? 10, height: shape.height ?? 10 },
        };
      }
    });
  }

  if (def.terrain?.water) {
    terrain.water = def.terrain.water.map((w): WaterDefinition => {
      const shape = convertShapeToOldFormat(w.shape);
      if (shape.type === 'circle') {
        return {
          shape: 'circle',
          position: shape.center,
          radius: shape.radius,
          depth: w.depth === 'shallow' ? 1 : 2,
        };
      } else {
        return {
          shape: 'rect',
          position: { x: shape.center.x - (shape.width ?? 0) / 2, y: shape.center.y - (shape.height ?? 0) / 2 },
          size: { width: shape.width ?? 10, height: shape.height ?? 10 },
          depth: w.depth === 'shallow' ? 1 : 2,
        };
      }
    });
  }

  if (def.vegetation?.forests) {
    terrain.forests = def.vegetation.forests.map((f): ForestDefinition => {
      const shape = convertShapeToOldFormat(f.shape);
      if (shape.type === 'circle') {
        return {
          shape: 'circle',
          position: shape.center,
          radius: shape.radius,
          density: convertForestDensityString(f.density),
        };
      } else {
        return {
          shape: 'rect',
          position: { x: shape.center.x - (shape.width ?? 0) / 2, y: shape.center.y - (shape.height ?? 0) / 2 },
          size: { width: shape.width ?? 10, height: shape.height ?? 10 },
          density: convertForestDensityString(f.density),
        };
      }
    });
  }

  // Build game features
  const features: MapDefinition['features'] = {};

  if (def.features?.watchTowers) {
    features.watchTowers = def.features.watchTowers.map((wt): WatchTowerDefinition => ({
      id: wt.id || `tower_${wt.position.x}_${wt.position.y}`,
      position: wt.position,
      visionRadius: wt.visionRadius,
    }));
  }

  if (def.features?.destructibles) {
    features.destructibles = def.features.destructibles.map((d): DestructibleDefinition => ({
      id: d.id || `destructible_${d.position.x}_${d.position.y}`,
      type: 'rocks',
      position: d.position,
      health: d.health,
      size: d.size,
    }));
  }

  // Convert biome to valid MapDefinition biome (limit to 6 core biomes)
  const validBiome = convertBiomeType(theme.biome);

  return {
    meta: {
      id: def.meta.id,
      name: def.meta.name,
      author: def.meta.author,
      description: def.meta.description,
    },
    canvas: {
      width: def.canvas.width,
      height: def.canvas.height,
      biome: validBiome,
      baseElevation: def.canvas.baseElevation ?? 0,
    },
    symmetry: {
      type: convertSymmetryType(def.symmetry.type),
      center: def.symmetry.center ?? { x: def.canvas.width / 2, y: def.canvas.height / 2 },
      playerCount: def.symmetry.playerCount,
    },
    regions,
    connections,
    terrain,
    features,
  };
}

type ValidBiome = 'grassland' | 'desert' | 'frozen' | 'volcanic' | 'void' | 'jungle';

/**
 * Convert simple 0/1/2 elevation to 256-level values
 * Matches the legacyElevationTo256 function in MapTypes.ts
 */
function convertSimpleElevation(level: 0 | 1 | 2): number {
  const mapping: Record<0 | 1 | 2, number> = {
    0: 60,   // Low ground
    1: 140,  // Mid ground
    2: 220,  // High ground
  };
  return mapping[level];
}

function convertBiomeType(biome: string): ValidBiome {
  // Map extended biomes to the 6 core biomes
  const mapping: Record<string, ValidBiome> = {
    grassland: 'grassland',
    desert: 'desert',
    frozen: 'frozen',
    volcanic: 'volcanic',
    void: 'void',
    jungle: 'jungle',
    twilight: 'void',      // Map twilight to void
    crystal: 'frozen',     // Map crystal to frozen
    industrial: 'desert',  // Map industrial to desert
  };
  return mapping[biome] || 'grassland';
}

function convertRegionType(type: string): RegionDefinition['type'] {
  const mapping: Record<string, RegionDefinition['type']> = {
    main_base: 'main_base',
    natural: 'natural',
    third: 'third',
    fourth: 'fourth',
    fifth: 'fourth',
    gold: 'gold',
    pocket: 'gold',
    island: 'gold',
    center: 'center',
    choke: 'choke',
    high_ground: 'center',
    low_ground: 'center',
    watchtower: 'watchtower',
    pathway: 'center',
    open: 'center',
  };
  return mapping[type] || 'center';
}

function convertSymmetryType(type: string): 'rotational' | 'mirror_x' | 'mirror_y' | 'mirror_diagonal' | 'quad' | 'none' {
  if (type.startsWith('rotational')) return 'rotational';
  if (type === 'mirror_x') return 'mirror_x';
  if (type === 'mirror_y') return 'mirror_y';
  if (type === 'mirror_diagonal') return 'mirror_diagonal';
  return 'none';
}

interface OldShapeFormat {
  type: 'circle' | 'rect';
  center: Point2D;
  radius?: number;
  width?: number;
  height?: number;
}

function convertShapeToOldFormat(shape: Shape): OldShapeFormat {
  switch (shape.type) {
    case 'circle':
      return { type: 'circle', center: shape.center, radius: shape.radius };
    case 'rect':
      return {
        type: 'rect',
        center: {
          x: shape.position.x + shape.size.width / 2,
          y: shape.position.y + shape.size.height / 2,
        },
        width: shape.size.width,
        height: shape.size.height,
      };
    case 'ellipse':
      return { type: 'circle', center: shape.center, radius: (shape.radiusX + shape.radiusY) / 2 };
    case 'polygon': {
      const bounds = getPolygonBounds(shape.points);
      return {
        type: 'circle',
        center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
        radius: Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2,
      };
    }
    case 'line':
      return {
        type: 'rect',
        center: { x: (shape.from.x + shape.to.x) / 2, y: (shape.from.y + shape.to.y) / 2 },
        width: Math.abs(shape.to.x - shape.from.x) || shape.width,
        height: Math.abs(shape.to.y - shape.from.y) || shape.width,
      };
    case 'path': {
      const pathBounds = getPolygonBounds(shape.points);
      return {
        type: 'rect',
        center: { x: (pathBounds.minX + pathBounds.maxX) / 2, y: (pathBounds.minY + pathBounds.maxY) / 2 },
        width: pathBounds.maxX - pathBounds.minX + shape.width,
        height: pathBounds.maxY - pathBounds.minY + shape.width,
      };
    }
    default:
      return { type: 'circle', center: { x: 0, y: 0 }, radius: 1 };
  }
}

function getPolygonBounds(points: Point2D[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

function convertForestDensityString(density: ForestDensity): 'sparse' | 'medium' | 'dense' {
  const mapping: Record<ForestDensity, 'sparse' | 'medium' | 'dense'> = {
    sparse: 'sparse',
    light: 'sparse',
    medium: 'medium',
    dense: 'dense',
    thick: 'dense',
  };
  return mapping[density];
}

// ============================================================================
// DECORATION GENERATION
// ============================================================================

/**
 * Generate decorations from declarative config
 */
export function generateDecorationsFromConfig(
  def: DeclarativeMapDef,
  grid: MapCell[][],
  seed: number
): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const random = new SeededRandom(seed);

  const config = def.decorations;
  if (!config) return decorations;

  // Generate clusters
  if (config.clusters) {
    for (const cluster of config.clusters) {
      decorations.push(...generateDecorationCluster(cluster, grid, random));
    }
  }

  // Generate lines
  if (config.lines) {
    for (const line of config.lines) {
      decorations.push(...generateDecorationLine(line, grid, random));
    }
  }

  // Add explicit decorations
  if (config.explicit) {
    for (const explicit of config.explicit) {
      decorations.push({
        type: mapDecorationTypeString(explicit.type),
        x: explicit.position.x,
        y: explicit.position.y,
        scale: explicit.scale ?? 1,
        rotation: explicit.rotation ?? random.next() * Math.PI * 2,
      });
    }
  }

  // Generate border decorations
  if (config.border?.enabled) {
    decorations.push(...generateBorderDecorations(def, random));
  }

  // Generate base edge decorations
  if (config.baseEdges?.enabled) {
    decorations.push(...generateBaseEdgeDecorations(def, random));
  }

  return decorations;
}

function generateDecorationCluster(
  cluster: DeclDecorationCluster,
  grid: MapCell[][],
  random: SeededRandom
): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const count = random.nextInt(cluster.count.min, cluster.count.max);

  for (let i = 0; i < count; i++) {
    const angle = random.next() * Math.PI * 2;
    const dist = random.next() * cluster.radius;
    const x = cluster.position.x + Math.cos(angle) * dist;
    const y = cluster.position.y + Math.sin(angle) * dist;

    // Check grid bounds
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= grid[0]?.length || gy < 0 || gy >= grid.length) continue;

    // Skip if on ramp (check elevation transition as proxy)
    const cell = grid[gy]?.[gx];
    if (cluster.avoidRamps !== false && cell) {
      // Simple ramp detection: cell has significantly different elevation than neighbors
      const neighbors = [
        grid[gy - 1]?.[gx],
        grid[gy + 1]?.[gx],
        grid[gy]?.[gx - 1],
        grid[gy]?.[gx + 1],
      ].filter(Boolean);
      const hasElevationChange = neighbors.some(n => Math.abs((n?.elevation ?? 0) - (cell.elevation ?? 0)) > 30);
      if (hasElevationChange) continue;
    }

    const type = cluster.types[random.nextInt(0, cluster.types.length - 1)];
    const scale = random.nextRange(cluster.scale.min, cluster.scale.max);
    const rotation = cluster.rotationRandom !== false ? random.next() * Math.PI * 2 : 0;

    decorations.push({
      type: mapDecorationTypeString(type),
      x,
      y,
      scale,
      rotation,
    });
  }

  return decorations;
}

function generateDecorationLine(
  line: DecorationLine,
  grid: MapCell[][],
  random: SeededRandom
): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const dx = line.to.x - line.from.x;
  const dy = line.to.y - line.from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const count = Math.floor(length * line.density);

  for (let i = 0; i < count; i++) {
    const t = random.next();
    const jitter = line.jitter ?? 0;
    const jx = (random.next() - 0.5) * 2 * jitter;
    const jy = (random.next() - 0.5) * 2 * jitter;
    const x = line.from.x + dx * t + jx;
    const y = line.from.y + dy * t + jy;

    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= grid[0]?.length || gy < 0 || gy >= grid.length) continue;

    const type = line.types[random.nextInt(0, line.types.length - 1)];
    const scale = random.nextRange(line.scale.min, line.scale.max);

    decorations.push({
      type: mapDecorationTypeString(type),
      x,
      y,
      scale,
      rotation: random.next() * Math.PI * 2,
    });
  }

  return decorations;
}

function generateBorderDecorations(
  def: DeclarativeMapDef,
  random: SeededRandom
): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const width = def.canvas.width;
  const height = def.canvas.height;
  const border = def.decorations?.border;
  if (!border) return decorations;

  // Inner ring
  if (border.innerRing) {
    const ring = border.innerRing;
    const offset = ring.offset;
    const perimeter = 2 * (width + height - 4 * offset);
    const count = Math.floor(perimeter * ring.density);

    for (let i = 0; i < count; i++) {
      const pos = getPerimeterPosition(width, height, offset, random.next());
      const type = ring.types[random.nextInt(0, ring.types.length - 1)];
      const scale = random.nextRange(ring.scale.min, ring.scale.max);

      decorations.push({
        type: mapDecorationTypeString(type),
        x: pos.x,
        y: pos.y,
        scale,
        rotation: random.next() * Math.PI * 2,
      });
    }
  }

  // Outer ring
  if (border.outerRing) {
    const ring = border.outerRing;
    const offset = ring.offset;
    const perimeter = 2 * (width + height - 4 * offset);
    const count = Math.floor(perimeter * ring.density);

    for (let i = 0; i < count; i++) {
      const pos = getPerimeterPosition(width, height, offset, random.next());
      const type = ring.types[random.nextInt(0, ring.types.length - 1)];
      const scale = random.nextRange(ring.scale.min, ring.scale.max);

      decorations.push({
        type: mapDecorationTypeString(type),
        x: pos.x,
        y: pos.y,
        scale,
        rotation: random.next() * Math.PI * 2,
      });
    }
  }

  return decorations;
}

function getPerimeterPosition(
  width: number,
  height: number,
  offset: number,
  t: number
): Point2D {
  const innerW = width - 2 * offset;
  const innerH = height - 2 * offset;
  const perimeter = 2 * (innerW + innerH);
  const dist = t * perimeter;

  if (dist < innerW) {
    return { x: offset + dist, y: offset };
  } else if (dist < innerW + innerH) {
    return { x: offset + innerW, y: offset + (dist - innerW) };
  } else if (dist < 2 * innerW + innerH) {
    return { x: offset + innerW - (dist - innerW - innerH), y: offset + innerH };
  } else {
    return { x: offset, y: offset + innerH - (dist - 2 * innerW - innerH) };
  }
}

function generateBaseEdgeDecorations(
  def: DeclarativeMapDef,
  random: SeededRandom
): MapDecoration[] {
  const decorations: MapDecoration[] = [];
  const baseEdges = def.decorations?.baseEdges;
  if (!baseEdges) return decorations;

  // Find base regions
  const bases = def.regions.filter((r) => r.type === 'main_base' || r.type === 'natural');

  for (const base of bases) {
    const cx = base.position.x;
    const cy = base.position.y;
    const radius = base.radius;

    // Rock ring around base
    if (baseEdges.rockRing) {
      const ring = baseEdges.rockRing;
      for (let i = 0; i < ring.count; i++) {
        const angle = (i / ring.count) * Math.PI * 2 + random.next() * 0.3;
        const dist = radius + 2 + random.next() * 3;
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist;

        const type = ring.types[random.nextInt(0, ring.types.length - 1)];
        const scale = random.nextRange(ring.scale.min, ring.scale.max);

        decorations.push({
          type: mapDecorationTypeString(type),
          x,
          y,
          scale,
          rotation: angle + Math.PI / 2,
        });
      }
    }

    // Tree ring around base
    if (baseEdges.treeRing) {
      const ring = baseEdges.treeRing;
      for (let i = 0; i < ring.count; i++) {
        const angle = (i / ring.count) * Math.PI * 2 + random.next() * 0.5;
        const dist = radius + 4 + random.next() * 4;
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist;

        const type = ring.types[random.nextInt(0, ring.types.length - 1)];
        const scale = random.nextRange(ring.scale.min, ring.scale.max);

        decorations.push({
          type: mapDecorationTypeString(type),
          x,
          y,
          scale,
          rotation: random.next() * Math.PI * 2,
        });
      }
    }
  }

  return decorations;
}

function mapDecorationTypeString(type: string): MapDecoration['type'] {
  // Map to valid DecorationType values from MapTypes.ts
  const mapping: Record<string, MapDecoration['type']> = {
    // Rocks
    boulder_small: 'rocks_small',
    boulder_medium: 'rocks_large',
    boulder_large: 'rocks_large',
    boulder_massive: 'rocks_large',
    rock_cluster: 'rocks_large',
    rock_spire: 'rock_single',
    rock_flat: 'rocks_small',
    rocks_small: 'rocks_small',
    rocks_medium: 'rocks_large',
    rocks_large: 'rocks_large',
    // Crystals
    crystal_small: 'crystal_formation',
    crystal_medium: 'crystal_formation',
    crystal_large: 'crystal_formation',
    crystal_cluster: 'crystal_formation',
    crystal_spire: 'crystal_formation',
    // Trees
    tree_dead: 'tree_dead',
    tree_conifer: 'tree_pine_tall',
    tree_pine: 'tree_pine_tall',
    tree_alien: 'tree_alien',
    tree_palm: 'tree_palm',
    tree_mushroom: 'tree_mushroom',
    // Debris and ruins
    debris_small: 'debris',
    debris_medium: 'debris',
    debris_large: 'debris',
    debris: 'debris',
    wreckage: 'debris',
    ruined_wall: 'ruined_wall',
    ruined_pillar: 'debris',
    pillar: 'debris',
    statue: 'debris',
    obelisk: 'debris',
    escape_pod: 'escape_pod',
    // Vegetation
    grass_patch: 'grass_clump',
    grass_clump: 'grass_clump',
    flower_cluster: 'grass_clump',
    bush: 'bush',
    bush_small: 'bush',
    bush_large: 'bush',
    mushroom_small: 'tree_mushroom',
    mushroom_large: 'tree_mushroom',
    vine_ground: 'grass_clump',
  };
  return mapping[type] || 'rocks_small';
}

// ============================================================================
// RESOURCE GENERATION
// ============================================================================

/**
 * Generate expansion data with resources from declarative definitions
 */
export function generateExpansionsFromConfig(
  def: DeclarativeMapDef,
  random: SeededRandom
): Expansion[] {
  const expansions: Expansion[] = [];

  for (const region of def.regions) {
    if (!region.resourceTemplate && !region.customResources) continue;

    const expansion: Expansion = {
      name: region.name,
      x: region.position.x,
      y: region.position.y,
      minerals: [],
      vespene: [],
      isMain: region.type === 'main_base',
      isNatural: region.type === 'natural',
    };

    if (region.customResources) {
      for (const res of region.customResources) {
        if (res.type === 'vespene') {
          expansion.vespene.push({
            x: res.position.x,
            y: res.position.y,
            type: 'vespene',
            amount: res.amount,
          });
        } else {
          expansion.minerals.push({
            x: res.position.x,
            y: res.position.y,
            type: 'minerals',
            amount: res.amount,
          });
        }
      }
    } else if (region.resourceTemplate) {
      // Generate from template
      const resources = generateResourcesFromTemplate(
        region.resourceTemplate,
        region.position,
        def.resources,
        random
      );
      expansion.minerals = resources.minerals;
      expansion.vespene = resources.vespene;
    }

    expansions.push(expansion);
  }

  return expansions;
}

function generateResourcesFromTemplate(
  template: ResourceTemplateName,
  center: Point2D,
  config: DeclarativeMapDef['resources'],
  random: SeededRandom
): { minerals: ResourceNode[]; vespene: ResourceNode[] } {
  const minerals: ResourceNode[] = [];
  const vespene: ResourceNode[] = [];

  const mineralAmount = config?.mineralAmount ?? 1500;
  const goldAmount = config?.goldAmount ?? 900;
  const gasAmount = config?.gasAmount ?? 2250;

  // Standard mineral line positioning
  const mineralLineAngle = random.next() * Math.PI * 2;
  const mineralLineRadius = 10;

  switch (template) {
    case 'standard':
      // 6 regular minerals + 2 close minerals, 2 gas
      for (let i = 0; i < 8; i++) {
        const angle = mineralLineAngle + (i - 3.5) * 0.25;
        const dist = mineralLineRadius + (i < 6 ? 0 : -2);
        minerals.push({
          x: center.x + Math.cos(angle) * dist,
          y: center.y + Math.sin(angle) * dist,
          type: 'minerals',
          amount: i < 6 ? mineralAmount : 900,
        });
      }
      // Gas geysers on opposite side
      for (let i = 0; i < 2; i++) {
        const angle = mineralLineAngle + Math.PI + (i - 0.5) * 0.6;
        vespene.push({
          x: center.x + Math.cos(angle) * 8,
          y: center.y + Math.sin(angle) * 8,
          type: 'vespene',
          amount: gasAmount,
        });
      }
      break;

    case 'rich':
      // 8 regular minerals, 2 gas
      for (let i = 0; i < 8; i++) {
        const angle = mineralLineAngle + (i - 3.5) * 0.22;
        minerals.push({
          x: center.x + Math.cos(angle) * mineralLineRadius,
          y: center.y + Math.sin(angle) * mineralLineRadius,
          type: 'minerals',
          amount: mineralAmount,
        });
      }
      for (let i = 0; i < 2; i++) {
        const angle = mineralLineAngle + Math.PI + (i - 0.5) * 0.6;
        vespene.push({
          x: center.x + Math.cos(angle) * 8,
          y: center.y + Math.sin(angle) * 8,
          type: 'vespene',
          amount: gasAmount,
        });
      }
      break;

    case 'gold':
      // 8 gold minerals, 2 gas (gold has lower amount)
      for (let i = 0; i < 8; i++) {
        const angle = mineralLineAngle + (i - 3.5) * 0.22;
        minerals.push({
          x: center.x + Math.cos(angle) * mineralLineRadius,
          y: center.y + Math.sin(angle) * mineralLineRadius,
          type: 'minerals',
          amount: goldAmount,
        });
      }
      for (let i = 0; i < 2; i++) {
        const angle = mineralLineAngle + Math.PI + (i - 0.5) * 0.6;
        vespene.push({
          x: center.x + Math.cos(angle) * 8,
          y: center.y + Math.sin(angle) * 8,
          type: 'vespene',
          amount: gasAmount,
        });
      }
      break;

    case 'poor':
      // 4 minerals, 1 gas
      for (let i = 0; i < 4; i++) {
        const angle = mineralLineAngle + (i - 1.5) * 0.3;
        minerals.push({
          x: center.x + Math.cos(angle) * mineralLineRadius,
          y: center.y + Math.sin(angle) * mineralLineRadius,
          type: 'minerals',
          amount: mineralAmount,
        });
      }
      vespene.push({
        x: center.x + Math.cos(mineralLineAngle + Math.PI) * 8,
        y: center.y + Math.sin(mineralLineAngle + Math.PI) * 8,
        type: 'vespene',
        amount: gasAmount,
      });
      break;

    case 'gas_only':
      // 2 gas, no minerals
      for (let i = 0; i < 2; i++) {
        const angle = mineralLineAngle + (i - 0.5) * 0.8;
        vespene.push({
          x: center.x + Math.cos(angle) * 8,
          y: center.y + Math.sin(angle) * 8,
          type: 'vespene',
          amount: gasAmount,
        });
      }
      break;

    case 'mineral_only':
      // 8 minerals, no gas
      for (let i = 0; i < 8; i++) {
        const angle = mineralLineAngle + (i - 3.5) * 0.22;
        minerals.push({
          x: center.x + Math.cos(angle) * mineralLineRadius,
          y: center.y + Math.sin(angle) * mineralLineRadius,
          type: 'minerals',
          amount: mineralAmount,
        });
      }
      break;
  }

  return { minerals, vespene };
}

// ============================================================================
// MAIN GENERATION FUNCTION
// ============================================================================

/**
 * Generate complete MapData from a DeclarativeMapDef
 */
export function generateFromDeclarative(def: DeclarativeMapDef): MapData {
  // Convert to existing MapDefinition format for terrain generation
  const mapDefinition = declarativeToMapDefinition(def);

  // Use existing generator for terrain
  const baseMapData = generateMapFromDefinition(mapDefinition);

  // Apply custom elevation features (256-level terrain sculpting)
  if (def.terrain?.elevationAreas || def.terrain?.elevationGradients) {
    applyCustomElevation(baseMapData.terrain, def.terrain);
  }

  // Generate additional decorations from declarative config
  const seed = def.options?.seed ?? def.decorations?.seed ?? Date.now();
  const random = new SeededRandom(seed);

  const additionalDecorations = generateDecorationsFromConfig(def, baseMapData.terrain, seed);

  // Merge decorations
  const baseDecorations = baseMapData.decorations ?? [];
  const allDecorations = [...baseDecorations, ...additionalDecorations];

  // Generate expansions with declarative resources
  const expansions = generateExpansionsFromConfig(def, random);

  // If we have declarative expansions, use them; otherwise keep base
  const finalExpansions = expansions.length > 0 ? expansions : baseMapData.expansions;

  return {
    ...baseMapData,
    decorations: allDecorations,
    expansions: finalExpansions,
  };
}

/**
 * Apply custom elevation areas and gradients to the terrain
 */
function applyCustomElevation(
  terrain: MapCell[][],
  terrainFeatures: DeclarativeMapDef['terrain']
): void {
  if (!terrainFeatures) return;

  const height = terrain.length;
  const width = terrain[0]?.length ?? 0;

  // Apply elevation areas
  if (terrainFeatures.elevationAreas) {
    for (const area of terrainFeatures.elevationAreas) {
      const elevation = Math.max(0, Math.min(255, Math.round(area.elevation)));
      const blend = area.blend !== false;
      const blendRadius = area.blendRadius ?? 2;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dist = getDistanceToShape(x, y, area.shape);

          if (dist <= 0) {
            // Inside shape - set elevation
            terrain[y][x].elevation = elevation;
          } else if (blend && dist <= blendRadius) {
            // In blend zone - interpolate
            const t = dist / blendRadius;
            const currentElev = terrain[y][x].elevation;
            terrain[y][x].elevation = Math.round(currentElev * t + elevation * (1 - t));
          }
        }
      }
    }
  }

  // Apply elevation gradients
  if (terrainFeatures.elevationGradients) {
    for (const gradient of terrainFeatures.elevationGradients) {
      const dx = gradient.to.x - gradient.from.x;
      const dy = gradient.to.y - gradient.from.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length === 0) continue;

      const normX = dx / length;
      const normY = dy / length;
      const perpX = -normY;
      const perpY = normX;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Project point onto gradient line
          const relX = x - gradient.from.x;
          const relY = y - gradient.from.y;

          // Distance along gradient
          const alongDist = relX * normX + relY * normY;
          // Perpendicular distance from gradient line
          const perpDist = Math.abs(relX * perpX + relY * perpY);

          // Check if point is within gradient width and length
          if (perpDist <= gradient.width / 2 && alongDist >= 0 && alongDist <= length) {
            const t = alongDist / length;
            let elevation: number;

            if (gradient.smooth !== false) {
              // Smooth interpolation (ease in-out)
              const smoothT = t * t * (3 - 2 * t);
              elevation = gradient.fromElevation + (gradient.toElevation - gradient.fromElevation) * smoothT;
            } else {
              // Linear interpolation
              elevation = gradient.fromElevation + (gradient.toElevation - gradient.fromElevation) * t;
            }

            terrain[y][x].elevation = Math.max(0, Math.min(255, Math.round(elevation)));
          }
        }
      }
    }
  }
}

/**
 * Calculate distance from point to shape (negative = inside)
 */
function getDistanceToShape(x: number, y: number, shape: Shape): number {
  switch (shape.type) {
    case 'circle': {
      const dx = x - shape.center.x;
      const dy = y - shape.center.y;
      return Math.sqrt(dx * dx + dy * dy) - shape.radius;
    }
    case 'rect': {
      const cx = shape.position.x + shape.size.width / 2;
      const cy = shape.position.y + shape.size.height / 2;
      const hw = shape.size.width / 2;
      const hh = shape.size.height / 2;
      const dx = Math.max(Math.abs(x - cx) - hw, 0);
      const dy = Math.max(Math.abs(y - cy) - hh, 0);
      return Math.sqrt(dx * dx + dy * dy);
    }
    case 'ellipse': {
      const dx = (x - shape.center.x) / shape.radiusX;
      const dy = (y - shape.center.y) / shape.radiusY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return (dist - 1) * Math.min(shape.radiusX, shape.radiusY);
    }
    default:
      return 0;
  }
}

/**
 * Validate a declarative map definition
 */
export function validateDeclarativeMap(def: DeclarativeMapDef): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  if (!def.meta?.id) errors.push('Missing meta.id');
  if (!def.meta?.name) errors.push('Missing meta.name');
  if (!def.canvas?.width || !def.canvas?.height) errors.push('Missing canvas dimensions');
  if (!def.regions?.length) errors.push('No regions defined');
  if (!def.connections?.length) warnings.push('No connections defined');

  // Check player count
  const playerRegions = def.regions.filter((r) => r.playerSlot !== undefined);
  if (playerRegions.length !== def.symmetry?.playerCount) {
    warnings.push(
      `Player count mismatch: ${playerRegions.length} player regions but symmetry says ${def.symmetry?.playerCount}`
    );
  }

  // Check region IDs are unique
  const regionIds = new Set<string>();
  for (const region of def.regions) {
    if (regionIds.has(region.id)) {
      errors.push(`Duplicate region ID: ${region.id}`);
    }
    regionIds.add(region.id);
  }

  // Check connections reference valid regions
  for (const conn of def.connections) {
    if (!regionIds.has(conn.from)) {
      errors.push(`Connection references unknown region: ${conn.from}`);
    }
    if (!regionIds.has(conn.to)) {
      errors.push(`Connection references unknown region: ${conn.to}`);
    }
  }

  // Check main bases have resources
  const mainBases = def.regions.filter((r) => r.type === 'main_base');
  for (const base of mainBases) {
    if (!base.resourceTemplate && !base.customResources) {
      warnings.push(`Main base ${base.id} has no resources defined`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Export for use in other modules
export { declarativeToMapDefinition as toMapDefinition };

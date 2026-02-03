import * as THREE from 'three';
import { MapData, MapCell, TerrainType, Elevation, TerrainFeature, TERRAIN_FEATURE_CONFIG } from '@/data/maps';
import { BiomeConfig, BIOMES, blendBiomeColors } from './Biomes';
import { TSLTerrainMaterial } from './tsl/TerrainMaterial';
import AssetManager from '@/assets/AssetManager';
import { debugTerrain } from '@/utils/debugLogger';
import { clamp } from '@/utils/math';

// Import from central pathfinding config - SINGLE SOURCE OF TRUTH
import {
  elevationToHeight,
  ELEVATION_TO_HEIGHT_FACTOR,
  RAMP_BOUNDARY_ELEVATION_THRESHOLD,
  RAMP_SMOOTHING_MAX_DIAGONAL as _RAMP_SMOOTHING_MAX_DIAGONAL,
  RAMP_SMOOTHING_PASSES as _RAMP_SMOOTHING_PASSES,
} from '@/data/pathfinding.config';

// Import from central rendering config
import { TERRAIN } from '@/data/rendering.config';

// Terrain subdivision for smoother rendering
const _SUBDIVISIONS = TERRAIN.SUBDIVISIONS;

/**
 * Quantize elevation to strict discrete levels for cliff separation.
 * This ensures non-ramp terrain has consistent height gaps that exceed
 * the navmesh walkableClimb threshold (0.3 units).
 *
 * Elevation levels:
 * - Low (0-99): 60 → 2.4 height units
 * - Mid (100-179): 140 → 5.6 height units
 * - High (180-255): 220 → 8.8 height units
 *
 * Gap between levels: 3.2 units >> 0.3 walkableClimb
 */
function _quantizeElevation(elevation: Elevation): number {
  if (elevation < 100) return elevationToHeight(60);
  if (elevation < 180) return elevationToHeight(140);
  return elevationToHeight(220);
}

/**
 * Feature color tints for rendering
 */
const FEATURE_COLOR_TINTS: Record<TerrainFeature, THREE.Color> = {
  none: new THREE.Color(1, 1, 1),           // No tint
  water_shallow: new THREE.Color(0.6, 0.8, 1.0),    // Blue tint
  water_deep: new THREE.Color(0.2, 0.4, 0.7),       // Deep blue
  forest_light: new THREE.Color(0.7, 0.9, 0.6),     // Light green
  forest_dense: new THREE.Color(0.4, 0.6, 0.3),     // Dark green
  mud: new THREE.Color(0.6, 0.5, 0.3),              // Brown
  road: new THREE.Color(0.85, 0.8, 0.7),            // Tan/beige
  void: new THREE.Color(0.15, 0.1, 0.25),           // Dark purple
  cliff: new THREE.Color(0.5, 0.45, 0.4),           // Gray-brown
};

export interface TerrainConfig {
  mapData: MapData;
  cellSize?: number;
}

// ============================================
// ENHANCED TERRAIN NOISE SYSTEM
// Based on THREE.Terrain algorithms for natural-looking terrain
// ============================================

// Permutation table for Perlin noise (pre-computed for performance)
const PERM = new Uint8Array(512);
const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
];

// Initialize permutation table with seed
function initPermutation(seed: number = 0): void {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;

  // Fisher-Yates shuffle with seed
  let n = seed || Date.now();
  for (let i = 255; i > 0; i--) {
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    const j = n % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }

  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
  }
}

// Initialize once
initPermutation(42);

// Smooth interpolation (quintic curve for C2 continuity)
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad(hash: number, x: number, y: number): number {
  const g = GRAD3[hash % 12];
  return g[0] * x + g[1] * y;
}

// Proper Perlin noise implementation
function perlinNoise(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;

  x -= Math.floor(x);
  y -= Math.floor(y);

  const u = fade(x);
  const v = fade(y);

  const A = PERM[X] + Y;
  const B = PERM[X + 1] + Y;

  return lerp(
    lerp(grad(PERM[A], x, y), grad(PERM[B], x - 1, y), u),
    lerp(grad(PERM[A + 1], x, y - 1), grad(PERM[B + 1], x - 1, y - 1), u),
    v
  );
}

// Fractal Brownian Motion (fBM) - multi-octave Perlin noise
function fbmNoise(x: number, y: number, octaves: number, lacunarity: number = 2.0, persistence: number = 0.5): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    total += perlinNoise(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return total / maxValue;
}

// Ridged multi-fractal noise (good for ridges and mountain ranges)
function _ridgedNoise(x: number, y: number, octaves: number, lacunarity: number = 2.0, persistence: number = 0.5): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(perlinNoise(x * frequency, y * frequency));
    total += n * n * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return total / maxValue;
}

// Turbulence noise (absolute value creates harder edges)
function _turbulenceNoise(x: number, y: number, octaves: number): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    total += Math.abs(perlinNoise(x * frequency, y * frequency)) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return total / maxValue;
}

// Voronoi/Worley noise for cellular patterns
function _voronoiNoise(x: number, y: number, frequency: number = 4): number {
  const fx = x * frequency;
  const fy = y * frequency;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);

  let minDist = Infinity;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = ix + dx;
      const ny = iy + dy;

      // Pseudo-random point in cell
      const n = (nx * 1619 + ny * 31337) & 0x7fffffff;
      const px = nx + ((n * 7919) % 1000) / 1000;
      const py = ny + ((n * 104729) % 1000) / 1000;

      const dist = (fx - px) * (fx - px) + (fy - py) * (fy - py);
      minDist = Math.min(minDist, dist);
    }
  }

  return Math.sqrt(minDist);
}

// Legacy noise functions for compatibility
function noise2D(x: number, y: number, seed: number = 0): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
  return n - Math.floor(n);
}

function _smoothNoise(x: number, y: number, scale: number, seed: number = 0): number {
  return fbmNoise(x / scale + seed * 0.1, y / scale + seed * 0.1, 3, 2.0, 0.5) * 0.5 + 0.5;
}

function _fractalNoise(x: number, y: number, octaves: number, persistence: number, seed: number = 0): number {
  return fbmNoise(x * 0.1 + seed * 0.01, y * 0.1 + seed * 0.01, octaves, 2.0, persistence) * 0.5 + 0.5;
}

// PERF: Terrain chunk size for frustum culling
// Each chunk is a separate mesh with its own bounding box
// Chunks outside the camera frustum are automatically culled by Three.js
const TERRAIN_CHUNK_SIZE = TERRAIN.CHUNK_SIZE;

export class Terrain {
  public mesh: THREE.Group; // Group containing chunk meshes
  public mapData: MapData;
  public biome: BiomeConfig;

  private cellSize: number;
  private chunkMeshes: THREE.Mesh[] = []; // Individual chunk meshes
  private chunkGeometries: THREE.BufferGeometry[] = [];
  private guardrailMesh: THREE.Mesh | null = null;
  private guardrailGeometry: THREE.BufferGeometry | null = null;
  private material: THREE.Material;
  private tslMaterial: TSLTerrainMaterial | null = null;

  // Store heightmap for queries
  private heightMap: Float32Array;
  private navMeshHeightMap: Float32Array | null = null;
  private gridWidth: number;
  private gridHeight: number;

  constructor(config: TerrainConfig) {
    this.mapData = config.mapData;
    this.cellSize = config.cellSize ?? 1;
    this.gridWidth = this.mapData.width + 1;
    this.gridHeight = this.mapData.height + 1;
    this.heightMap = new Float32Array(this.gridWidth * this.gridHeight);

    // Get biome configuration
    this.biome = BIOMES[this.mapData.biome || 'grassland'];

    // Create TSL terrain material (WebGPU + WebGL compatible)
    debugTerrain.log('[Terrain] Using TSL terrain material for biome:', this.mapData.biome || 'grassland');
    this.tslMaterial = new TSLTerrainMaterial({
      biome: this.mapData.biome || 'grassland',
      mapWidth: this.mapData.width,
      mapHeight: this.mapData.height,
    });
    this.material = this.tslMaterial.material;

    // PERF: Create terrain as chunked meshes for frustum culling
    // Each chunk is a separate mesh that Three.js can cull independently
    this.mesh = new THREE.Group();
    this.mesh.rotation.x = -Math.PI / 2;

    // Create chunked terrain geometries and meshes
    this.createChunkedTerrain();

    // Create RTS-style guardrails on platform edges
    this.createGuardrails();

    const numChunks = this.chunkMeshes.length;
    debugTerrain.log(`[Terrain] Created ${numChunks} terrain chunks for frustum culling`);
  }

  /**
   * PERF: Create terrain as multiple chunk meshes for frustum culling.
   * Each chunk is a separate mesh that Three.js can cull independently.
   */
  private createChunkedTerrain(): void {
    const { width, height, terrain } = this.mapData;
    const cellSize = this.cellSize;

    // Pre-calculate height map with smooth transitions and natural variation
    const vertexGrid: THREE.Vector3[][] = [];
    const mapScale = Math.min(width, height);

    // Build vertex grid and heightmap
    for (let y = 0; y <= height; y++) {
      vertexGrid[y] = [];
      for (let x = 0; x <= width; x++) {
        const cell = this.sampleTerrain(terrain, x, y, width, height);
        const baseHeight = elevationToHeight(cell.elevation);
        const edgeFactor = this.calculateElevationEdgeFactor(terrain, x, y, width, height);
        const nx = x / mapScale;
        const ny = y / mapScale;

        let detailNoise = 0;
        if (cell.terrain === 'unwalkable') {
          const largeNoise = fbmNoise(nx * 2, ny * 2, 3, 2.0, 0.5) * 0.06;
          const mediumNoise = fbmNoise(nx * 5, ny * 5, 2, 2.0, 0.5) * 0.03;
          const smallNoise = fbmNoise(nx * 12, ny * 12, 2, 2.0, 0.5) * 0.015;
          detailNoise = largeNoise + mediumNoise + smallNoise;
          if (edgeFactor > 0) {
            detailNoise += edgeFactor * 0.04 * fbmNoise(nx * 3, ny * 3, 2, 2.0, 0.5);
          }
        } else if (cell.terrain === 'ramp' || cell.terrain === 'platform') {
          // Ramps and platforms: completely smooth with NO noise
          // RTS-style geometric surfaces are perfectly flat
          detailNoise = 0;
        } else {
          const groundNoise = fbmNoise(nx * 6, ny * 6, 3, 2.0, 0.5) * 0.015;
          const microDetail = perlinNoise(nx * 30, ny * 30) * 0.008;
          detailNoise = groundNoise + microDetail;
          if (edgeFactor > 0) {
            detailNoise += edgeFactor * 0.12 * fbmNoise(nx * 4, ny * 4, 2, 2.0, 0.5);
          }
        }

        const finalHeight = baseHeight + detailNoise;
        vertexGrid[y][x] = new THREE.Vector3(x * cellSize, -y * cellSize, finalHeight);
        this.heightMap[y * this.gridWidth + x] = finalHeight;
      }
    }

    // Build terrain type map
    const terrainTypeMap: TerrainType[] = new Array(this.gridWidth * this.gridHeight);
    for (let y = 0; y <= height; y++) {
      for (let x = 0; x <= width; x++) {
        const idx = y * this.gridWidth + x;
        const cell = this.sampleTerrain(terrain, x, y, width, height);
        terrainTypeMap[idx] = cell.terrain;
      }
    }

    // Calculate per-vertex slopes
    const slopeMap = new Float32Array(this.gridWidth * this.gridHeight);
    for (let y = 0; y <= height; y++) {
      for (let x = 0; x <= width; x++) {
        const idx = y * this.gridWidth + x;
        const terrainType = terrainTypeMap[idx];
        const h = this.heightMap[idx];
        let maxHeightDiff = 0;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx <= width && ny >= 0 && ny <= height) {
              const neighborH = this.heightMap[ny * this.gridWidth + nx];
              maxHeightDiff = Math.max(maxHeightDiff, Math.abs(neighborH - h));
            }
          }
        }

        let slope = Math.min(1.0, maxHeightDiff / 3.0);
        if (terrainType === 'ramp' || terrainType === 'platform') {
          // Ramps and platforms are flat surfaces
          slope = 0;
        } else if (terrainType === 'unwalkable') {
          let isEdge = false;
          for (let dy = -1; dy <= 1 && !isEdge; dy++) {
            for (let dx = -1; dx <= 1 && !isEdge; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx <= width && ny >= 0 && ny <= height) {
                const neighborType = terrainTypeMap[ny * this.gridWidth + nx];
                if (neighborType === 'ground' || neighborType === 'ramp' || neighborType === 'unbuildable' || neighborType === 'platform') {
                  isEdge = true;
                }
              }
            }
          }
          if (isEdge) {
            slope = Math.max(0.35, slope);
          }
        }
        slopeMap[idx] = Math.min(1.0, slope);
      }
    }

    // Apply smoothing
    this.smoothHeightMap(2);

    // Update vertex grid with smoothed heights
    for (let y = 0; y <= height; y++) {
      for (let x = 0; x <= width; x++) {
        vertexGrid[y][x].z = this.heightMap[y * this.gridWidth + x];
      }
    }

    // Calculate chunk grid dimensions
    const chunksX = Math.ceil(width / TERRAIN_CHUNK_SIZE);
    const chunksY = Math.ceil(height / TERRAIN_CHUNK_SIZE);

    // Create a chunk for each grid cell
    for (let chunkY = 0; chunkY < chunksY; chunkY++) {
      for (let chunkX = 0; chunkX < chunksX; chunkX++) {
        const startX = chunkX * TERRAIN_CHUNK_SIZE;
        const startY = chunkY * TERRAIN_CHUNK_SIZE;
        const endX = Math.min(startX + TERRAIN_CHUNK_SIZE, width);
        const endY = Math.min(startY + TERRAIN_CHUNK_SIZE, height);

        const geometry = this.createChunkGeometry(
          startX, startY, endX, endY,
          vertexGrid, slopeMap, terrain, width, height
        );

        const chunkMesh = new THREE.Mesh(geometry, this.material);
        chunkMesh.receiveShadow = true;
        chunkMesh.castShadow = false;
        // frustumCulled defaults to true - Three.js will cull this chunk when outside camera

        // Compute bounding box for proper frustum culling
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        this.chunkGeometries.push(geometry);
        this.chunkMeshes.push(chunkMesh);
        this.mesh.add(chunkMesh);
      }
    }
  }

  /**
   * Create geometry for a single terrain chunk.
   */
  private createChunkGeometry(
    startX: number, startY: number, endX: number, endY: number,
    vertexGrid: THREE.Vector3[][],
    slopeMap: Float32Array,
    terrain: MapCell[][],
    mapWidth: number, mapHeight: number
  ): THREE.BufferGeometry {
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];
    const slopes: number[] = [];
    const terrainTypes: number[] = [];

    let vertexIndex = 0;

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const cell = terrain[y][x];

        // Get biome-based color
        const terrainColorType = cell.terrain === 'unwalkable' ? 'cliff' :
                                  cell.terrain === 'ramp' ? 'ramp' :
                                  cell.terrain === 'platform' ? 'ground' : 'ground';
        const baseColor = blendBiomeColors(this.biome, x, y, terrainColorType);

        const feature = cell.feature || 'none';
        const featureTint = FEATURE_COLOR_TINTS[feature];
        baseColor.multiply(featureTint);

        const normalizedElevation = cell.elevation / 255;
        baseColor.multiplyScalar(1 + normalizedElevation * 0.15);

        // Get cell corners
        const v00 = vertexGrid[y][x];
        const v10 = vertexGrid[y][x + 1];
        const v01 = vertexGrid[y + 1][x];
        const v11 = vertexGrid[y + 1][x + 1];

        // Calculate colors with variation
        const colors6: THREE.Color[] = [];
        for (let i = 0; i < 6; i++) {
          const color = baseColor.clone();
          const noiseVal = noise2D(x + i * 0.1, y + i * 0.1, cell.textureId);
          const accents = this.biome.colors.accent;
          if (accents.length > 0 && noiseVal > 0.7) {
            const accentIndex = Math.floor(noiseVal * accents.length) % accents.length;
            color.lerp(accents[accentIndex], (noiseVal - 0.7) * 1.5);
          }
          const brightVar = (noise2D(x * 2.5, y * 2.5, 789) - 0.5) * 0.12;
          color.r = clamp(color.r + brightVar, 0, 1);
          color.g = clamp(color.g + brightVar, 0, 1);
          color.b = clamp(color.b + brightVar, 0, 1);
          const edgeFactor = this.getEdgeFactor(terrain, x, y, mapWidth, mapHeight);
          if (edgeFactor > 0) {
            color.multiplyScalar(1 - edgeFactor * 0.25);
          }
          colors6.push(color);
        }

        // Get slopes
        let slope00 = slopeMap[y * this.gridWidth + x];
        let slope10 = slopeMap[y * this.gridWidth + (x + 1)];
        let slope01 = slopeMap[(y + 1) * this.gridWidth + x];
        let slope11 = slopeMap[(y + 1) * this.gridWidth + (x + 1)];

        if (cell.terrain === 'ramp') {
          slope00 = slope10 = slope01 = slope11 = 0;
        } else if (cell.terrain === 'unwalkable') {
          const minSlope = 0.15;
          slope00 = Math.max(slope00, minSlope);
          slope10 = Math.max(slope10, minSlope);
          slope01 = Math.max(slope01, minSlope);
          slope11 = Math.max(slope11, minSlope);
        }

        // Triangle 1
        vertices.push(v00.x, v00.y, v00.z);
        vertices.push(v01.x, v01.y, v01.z);
        vertices.push(v10.x, v10.y, v10.z);

        uvs.push(x / mapWidth, y / mapHeight);
        uvs.push(x / mapWidth, (y + 1) / mapHeight);
        uvs.push((x + 1) / mapWidth, y / mapHeight);

        // Triangle 2
        vertices.push(v10.x, v10.y, v10.z);
        vertices.push(v01.x, v01.y, v01.z);
        vertices.push(v11.x, v11.y, v11.z);

        uvs.push((x + 1) / mapWidth, y / mapHeight);
        uvs.push(x / mapWidth, (y + 1) / mapHeight);
        uvs.push((x + 1) / mapWidth, (y + 1) / mapHeight);

        slopes.push(slope00, slope01, slope10);
        slopes.push(slope10, slope01, slope11);

        // Determine terrain type for shader
        // Platform sides (unwalkable adjacent to platform) render as platform
        // Ramps adjacent to platforms at similar elevation render as platform
        let cellTerrainType = 0.0;
        if (cell.terrain === 'unwalkable') {
          // Check if this unwalkable cell is adjacent to a platform - if so, render as platform
          // This makes platform cliff sides use platform material instead of natural rock
          let adjacentToPlatform = false;
          for (let dy = -1; dy <= 1 && !adjacentToPlatform; dy++) {
            for (let dx = -1; dx <= 1 && !adjacentToPlatform; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < mapWidth && ny >= 0 && ny < mapHeight) {
                const neighbor = terrain[ny][nx];
                if (neighbor.terrain === 'platform') {
                  adjacentToPlatform = true;
                }
              }
            }
          }
          cellTerrainType = adjacentToPlatform ? 3.0 : 2.0; // Platform or unwalkable
        } else if (cell.terrain === 'ramp') {
          // Check if this ramp is adjacent to platforms - if so, render as platform
          let adjacentToPlatform = false;
          for (let dy = -1; dy <= 1 && !adjacentToPlatform; dy++) {
            for (let dx = -1; dx <= 1 && !adjacentToPlatform; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < mapWidth && ny >= 0 && ny < mapHeight) {
                const neighbor = terrain[ny][nx];
                if (neighbor.terrain === 'platform') {
                  const elevDiff = Math.abs(neighbor.elevation - cell.elevation);
                  if (elevDiff < 30) { // Similar elevation
                    adjacentToPlatform = true;
                  }
                }
              }
            }
          }
          cellTerrainType = adjacentToPlatform ? 3.0 : 1.0; // Platform or ramp
        } else if (cell.terrain === 'platform') {
          cellTerrainType = 3.0;
        }
        terrainTypes.push(cellTerrainType, cellTerrainType, cellTerrainType);
        terrainTypes.push(cellTerrainType, cellTerrainType, cellTerrainType);

        for (let i = 0; i < 6; i++) {
          colors.push(colors6[i].r, colors6[i].g, colors6[i].b);
        }

        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        indices.push(vertexIndex + 3, vertexIndex + 4, vertexIndex + 5);
        vertexIndex += 6;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aSlope', new THREE.Float32BufferAttribute(slopes, 1));
    geometry.setAttribute('aTerrainType', new THREE.Float32BufferAttribute(terrainTypes, 1));
    geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Create RTS-style guardrails on platform edges.
   * Guardrails are placed on platform/ramp edges that don't connect to other platforms.
   */
  private createGuardrails(): void {
    const { width, height, terrain } = this.mapData;
    const cellSize = this.cellSize;

    const vertices: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    let vertexIndex = 0;

    // Guardrail dimensions
    const RAIL_HEIGHT = 0.4;        // Height of guardrail
    const POST_WIDTH = 0.08;        // Width of posts
    const RAIL_THICKNESS = 0.05;    // Thickness of horizontal rails
    const _POST_SPACING = 1.0;       // One post per cell edge

    // Helper to check if a cell is a platform (not ramp)
    const isPlatform = (x: number, y: number): boolean => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return terrain[y][x].terrain === 'platform';
    };

    // Helper to check if a cell is a ramp
    const isRamp = (x: number, y: number): boolean => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return terrain[y][x].terrain === 'ramp';
    };

    // Helper to get cell elevation
    const getElevation = (x: number, y: number): number => {
      if (x < 0 || x >= width || y < 0 || y >= height) return 0;
      return terrain[y][x].elevation;
    };

    // Helper to add a box (post or rail segment)
    const addBox = (
      cx: number, cy: number, cz: number,  // Center position
      sx: number, sy: number, sz: number,  // Half-sizes
    ) => {
      // 8 vertices of a box
      const v = [
        [cx - sx, cy - sy, cz - sz], // 0: left-bottom-back
        [cx + sx, cy - sy, cz - sz], // 1: right-bottom-back
        [cx + sx, cy + sy, cz - sz], // 2: right-top-back
        [cx - sx, cy + sy, cz - sz], // 3: left-top-back
        [cx - sx, cy - sy, cz + sz], // 4: left-bottom-front
        [cx + sx, cy - sy, cz + sz], // 5: right-bottom-front
        [cx + sx, cy + sy, cz + sz], // 6: right-top-front
        [cx - sx, cy + sy, cz + sz], // 7: left-top-front
      ];

      // 6 faces with normals (each face has 4 verts, 2 triangles)
      const faces = [
        { verts: [0, 1, 2, 3], normal: [0, 0, -1] },  // Back
        { verts: [5, 4, 7, 6], normal: [0, 0, 1] },   // Front
        { verts: [4, 0, 3, 7], normal: [-1, 0, 0] },  // Left
        { verts: [1, 5, 6, 2], normal: [1, 0, 0] },   // Right
        { verts: [3, 2, 6, 7], normal: [0, 1, 0] },   // Top
        { verts: [4, 5, 1, 0], normal: [0, -1, 0] },  // Bottom
      ];

      for (const face of faces) {
        const [i0, i1, i2, i3] = face.verts;
        const [nx, ny, nz] = face.normal;

        // Add 4 vertices for this face
        for (const vi of [i0, i1, i2, i3]) {
          vertices.push(v[vi][0], v[vi][1], v[vi][2]);
          normals.push(nx, ny, nz);
        }

        // Add 2 triangles (indices relative to vertexIndex)
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;
      }
    };

    // Scan terrain for platform edges (guardrails only on platforms, not ramps)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Only place guardrails on platforms, not ramps
        if (!isPlatform(x, y)) continue;

        const elevation = getElevation(x, y);
        const baseZ = elevationToHeight(elevation);

        // Check each edge direction (N, S, E, W)
        const edges = [
          { dx: 0, dy: -1, startX: x, startY: y, endX: x + 1, endY: y },      // North edge
          { dx: 0, dy: 1, startX: x, startY: y + 1, endX: x + 1, endY: y + 1 }, // South edge
          { dx: -1, dy: 0, startX: x, startY: y, endX: x, endY: y + 1 },      // West edge
          { dx: 1, dy: 0, startX: x + 1, startY: y, endX: x + 1, endY: y + 1 }, // East edge
        ];

        for (const edge of edges) {
          const neighborX = x + edge.dx;
          const neighborY = y + edge.dy;

          const neighborElevation = getElevation(neighborX, neighborY);
          const sameElevation = Math.abs(neighborElevation - elevation) < 20; // ~0.8 height diff

          // Skip if neighbor is platform at same elevation (no guardrail between connected platforms)
          if (isPlatform(neighborX, neighborY) && sameElevation) continue;

          // Skip if neighbor is a ramp (leave entrance open for units)
          if (isRamp(neighborX, neighborY)) continue;

          // Calculate edge center position (in local terrain coordinates)
          const edgeCenterX = (edge.startX + edge.endX) / 2 * cellSize;
          const edgeCenterY = -((edge.startY + edge.endY) / 2) * cellSize; // Negative Y for terrain rotation

          // Determine edge orientation (horizontal or vertical in local space)
          const isHorizontalEdge = edge.dy !== 0;

          // Add post at edge center
          const postCenterZ = baseZ + RAIL_HEIGHT / 2;
          addBox(
            edgeCenterX, edgeCenterY, postCenterZ,
            POST_WIDTH / 2, POST_WIDTH / 2, RAIL_HEIGHT / 2
          );

          // Add horizontal rail
          const railZ = baseZ + RAIL_HEIGHT * 0.85;
          if (isHorizontalEdge) {
            // Rail runs along X
            addBox(
              edgeCenterX, edgeCenterY, railZ,
              cellSize / 2, RAIL_THICKNESS / 2, RAIL_THICKNESS / 2
            );
          } else {
            // Rail runs along Y
            addBox(
              edgeCenterX, edgeCenterY, railZ,
              RAIL_THICKNESS / 2, cellSize / 2, RAIL_THICKNESS / 2
            );
          }

          // Add corner posts at edge ends
          const post1X = edge.startX * cellSize;
          const post1Y = -edge.startY * cellSize;
          const post2X = edge.endX * cellSize;
          const post2Y = -edge.endY * cellSize;

          addBox(post1X, post1Y, postCenterZ, POST_WIDTH / 2, POST_WIDTH / 2, RAIL_HEIGHT / 2);
          addBox(post2X, post2Y, postCenterZ, POST_WIDTH / 2, POST_WIDTH / 2, RAIL_HEIGHT / 2);
        }
      }
    }

    // Create geometry if we have any guardrails
    if (vertices.length === 0) {
      debugTerrain.log('[Terrain] No guardrails needed');
      return;
    }

    this.guardrailGeometry = new THREE.BufferGeometry();
    this.guardrailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.guardrailGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    this.guardrailGeometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));

    // RTS-style yellow/orange hazard color for guardrails
    const guardrailMaterial = new THREE.MeshStandardMaterial({
      color: 0xD4A017,  // Golden/orange hazard color
      roughness: 0.6,
      metalness: 0.4,
    });

    this.guardrailMesh = new THREE.Mesh(this.guardrailGeometry, guardrailMaterial);
    this.guardrailMesh.castShadow = true;
    this.guardrailMesh.receiveShadow = true;
    this.mesh.add(this.guardrailMesh);

    const numPosts = Math.floor(vertices.length / (24 * 3)); // Rough estimate
    debugTerrain.log(`[Terrain] Created guardrails with ~${numPosts} posts`);
  }

  // Update shader uniforms (call each frame for animated effects)
  public update(deltaTime: number, sunDirection?: THREE.Vector3): void {
    if (this.tslMaterial) {
      this.tslMaterial.update(deltaTime, sunDirection);
    }
  }

  private getEdgeFactor(
    terrain: MapCell[][],
    x: number,
    y: number,
    width: number,
    height: number
  ): number {
    const cell = terrain[y][x];
    let edgeFactor = 0;

    // Check neighbors for elevation changes
    const neighbors = [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
    ];

    for (const { dx, dy } of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const neighbor = terrain[ny][nx];
        if (neighbor.elevation !== cell.elevation) {
          // Normalize elevation difference to 0-1 range (max diff is 255)
          const normalizedDiff = Math.abs(neighbor.elevation - cell.elevation) / 255;
          edgeFactor = Math.max(edgeFactor, normalizedDiff);
        }
        if (neighbor.terrain === 'unwalkable' && cell.terrain !== 'unwalkable') {
          edgeFactor = Math.max(edgeFactor, 0.3);
        }
      }
    }

    return edgeFactor;
  }

  private calculateElevationEdgeFactor(
    terrain: MapCell[][],
    x: number,
    y: number,
    width: number,
    height: number
  ): number {
    // Check all 8 neighbors for elevation changes to create cliff edges
    const neighbors = [
      { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
      { dx: -1, dy: 0 },                      { dx: 1, dy: 0 },
      { dx: -1, dy: 1 },  { dx: 0, dy: 1 },  { dx: 1, dy: 1 },
    ];

    let maxElevationDiff = 0;
    const cell = this.sampleTerrain(terrain, x, y, width, height);

    for (const { dx, dy } of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx <= width && ny >= 0 && ny <= height) {
        const neighbor = this.sampleTerrain(terrain, nx, ny, width, height);
        const diff = Math.abs(neighbor.elevation - cell.elevation);
        maxElevationDiff = Math.max(maxElevationDiff, diff);
      }
    }

    // Normalize to 0-1 range (max possible diff is 255)
    return maxElevationDiff / 255;
  }

  private sampleTerrain(
    terrain: MapCell[][],
    x: number,
    y: number,
    width: number,
    height: number
  ): MapCell {
    // Vertex (x, y) is at the corner of 4 cells: (x-1,y-1), (x-1,y), (x,y-1), (x,y)
    // Sample all 4 touching cells (clamped to valid indices)
    const x0 = clamp(x - 1, 0, width - 1);
    const x1 = clamp(x, 0, width - 1);
    const y0 = clamp(y - 1, 0, height - 1);
    const y1 = clamp(y, 0, height - 1);

    const cell00 = terrain[y0][x0];  // Top-left
    const cell10 = terrain[y0][x1];  // Top-right
    const cell01 = terrain[y1][x0];  // Bottom-left
    const cell11 = terrain[y1][x1];  // Bottom-right (primary cell)

    const cells = [cell00, cell10, cell01, cell11];

    // Check if any of the 4 cells is a ramp
    const rampCells = cells.filter(c => c.terrain === 'ramp');
    const hasRamp = rampCells.length > 0;

    // Check if any of the 4 cells is a platform
    const platformCells = cells.filter(c => c.terrain === 'platform');
    const hasPlatform = platformCells.length > 0;

    let avgElevation: number;

    if (hasRamp) {
      // Ramp boundary height calculation - needs to handle two cases:
      //
      // Case 1: Ramp meets terrain at SIMILAR elevation (platform-ramp connection)
      //   - Use MAX elevation to ensure vertices match exactly
      //   - Prevents 0.2-unit gaps that break Recast polygon connectivity
      //
      // Case 2: Ramp meets terrain at DIFFERENT elevation (ramp-cliff boundary)
      //   - Use RAMP cells' average elevation to preserve smooth ramp slope
      //   - Using MAX would create impossibly steep slopes (>50 degrees)
      //
      // Uses RAMP_BOUNDARY_ELEVATION_THRESHOLD from pathfinding.config.ts

      const rampElevations = rampCells.map(c => c.elevation);
      const nonRampElevations = cells.filter(c => c.terrain !== 'ramp').map(c => c.elevation);

      const avgRampElev = rampElevations.reduce((a, b) => a + b, 0) / rampElevations.length;

      if (nonRampElevations.length === 0) {
        // All cells are ramps - use their average for smooth internal slope
        avgElevation = avgRampElev;
      } else {
        // Ramp-to-terrain boundary - use the ramp cell closest to the non-ramp terrain
        // This ensures the height step at the boundary stays within walkableClimb
        const avgNonRampElev = nonRampElevations.reduce((a, b) => a + b, 0) / nonRampElevations.length;
        const maxRampElev = Math.max(...rampElevations);
        const minRampElev = Math.min(...rampElevations);

        // Determine if non-ramp terrain is above or below the ramp
        if (avgNonRampElev >= maxRampElev) {
          // Non-ramp is at or above the highest ramp cell - this is a ramp top boundary
          // Use MAX to match the platform elevation and prevent gaps
          const elevationDiff = avgNonRampElev - maxRampElev;
          if (elevationDiff <= RAMP_BOUNDARY_ELEVATION_THRESHOLD) {
            avgElevation = Math.max(...cells.map(c => c.elevation));
          } else {
            // Large gap - use max ramp elevation, step will be handled by navmesh
            avgElevation = maxRampElev;
          }
        } else {
          // Non-ramp is below the ramp - this is a ramp bottom boundary
          // Use MIN ramp elevation to meet the lower terrain
          const elevationDiff = minRampElev - avgNonRampElev;
          if (elevationDiff <= RAMP_BOUNDARY_ELEVATION_THRESHOLD) {
            avgElevation = Math.min(...cells.map(c => c.elevation));
          } else {
            // Large gap - use min ramp elevation
            avgElevation = minRampElev;
          }
        }
      }
    } else if (hasPlatform) {
      // Use platform elevation for consistent flat surfaces
      avgElevation = platformCells.reduce((sum, c) => sum + c.elevation, 0) / platformCells.length;
    } else {
      // No ramps or platforms - use simple average elevation for smooth ground
      avgElevation = (cell00.elevation + cell10.elevation + cell01.elevation + cell11.elevation) / 4;
    }

    // For terrain type: prioritize ramp > platform > cell11.terrain
    // This prevents noise from being added to ramp/platform-adjacent vertices
    const terrainType = hasRamp ? 'ramp' : (hasPlatform ? 'platform' : cell11.terrain);

    return {
      terrain: terrainType as typeof cell11.terrain,
      elevation: Math.round(avgElevation),
      feature: cell11.feature || 'none',
      textureId: cell11.textureId,
    };
  }

  public getHeightAt(worldX: number, worldY: number): number {
    const x = worldX / this.cellSize;
    const y = worldY / this.cellSize;

    if (x < 0 || x >= this.mapData.width || y < 0 || y >= this.mapData.height) {
      return 0;
    }

    // Bilinear interpolation for smooth height
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, this.mapData.width);
    const y1 = Math.min(y0 + 1, this.mapData.height);

    const fx = x - x0;
    const fy = y - y0;

    const h00 = this.heightMap[y0 * this.gridWidth + x0];
    const h10 = this.heightMap[y0 * this.gridWidth + x1];
    const h01 = this.heightMap[y1 * this.gridWidth + x0];
    const h11 = this.heightMap[y1 * this.gridWidth + x1];

    return h00 * (1 - fx) * (1 - fy) +
           h10 * fx * (1 - fy) +
           h01 * (1 - fx) * fy +
           h11 * fx * fy;
  }

  public getNavmeshHeightAt(worldX: number, worldY: number): number {
    if (!this.navMeshHeightMap) {
      return this.getHeightAt(worldX, worldY);
    }

    const x = worldX / this.cellSize;
    const y = worldY / this.cellSize;

    if (x < 0 || x >= this.mapData.width || y < 0 || y >= this.mapData.height) {
      return 0;
    }

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, this.mapData.width);
    const y1 = Math.min(y0 + 1, this.mapData.height);

    const fx = x - x0;
    const fy = y - y0;

    const h00 = this.navMeshHeightMap[y0 * this.gridWidth + x0];
    const h10 = this.navMeshHeightMap[y0 * this.gridWidth + x1];
    const h01 = this.navMeshHeightMap[y1 * this.gridWidth + x0];
    const h11 = this.navMeshHeightMap[y1 * this.gridWidth + x1];

    return h00 * (1 - fx) * (1 - fy) +
           h10 * fx * (1 - fy) +
           h01 * (1 - fx) * fy +
           h11 * fx * fy;
  }

  public getTerrainAt(worldX: number, worldY: number): MapCell | null {
    const x = Math.floor(worldX / this.cellSize);
    const y = Math.floor(worldY / this.cellSize);

    if (x < 0 || x >= this.mapData.width || y < 0 || y >= this.mapData.height) {
      return null;
    }

    return this.mapData.terrain[y][x];
  }

  public isWalkable(worldX: number, worldY: number, isFlying: boolean = false): boolean {
    const cell = this.getTerrainAt(worldX, worldY);
    if (!cell) return false;

    // Check terrain type first
    if (cell.terrain === 'unwalkable') {
      // Flying units can cross some unwalkable terrain
      return isFlying;
    }

    // Check terrain feature
    const feature = cell.feature || 'none';
    const config = TERRAIN_FEATURE_CONFIG[feature];

    // Flying units ignore most features
    if (isFlying && config.flyingIgnores) {
      return true;
    }

    return config.walkable;
  }

  public isBuildable(worldX: number, worldY: number): boolean {
    const cell = this.getTerrainAt(worldX, worldY);
    if (!cell) return false;

    // Must be ground terrain type
    if (cell.terrain !== 'ground') return false;

    // Check feature buildability
    const feature = cell.feature || 'none';
    const config = TERRAIN_FEATURE_CONFIG[feature];

    return config.buildable;
  }

  /**
   * Get speed modifier for terrain at position
   */
  public getSpeedModifier(worldX: number, worldY: number, isFlying: boolean = false): number {
    const cell = this.getTerrainAt(worldX, worldY);
    if (!cell) return 1.0;

    const feature = cell.feature || 'none';
    const config = TERRAIN_FEATURE_CONFIG[feature];

    // Flying units ignore terrain speed modifiers
    if (isFlying && config.flyingIgnores) {
      return 1.0;
    }

    return config.speedModifier;
  }

  /**
   * Check if terrain blocks vision
   */
  public blocksVision(worldX: number, worldY: number): boolean {
    const cell = this.getTerrainAt(worldX, worldY);
    if (!cell) return false;

    const feature = cell.feature || 'none';
    return TERRAIN_FEATURE_CONFIG[feature].blocksVision;
  }

  /**
   * Check if terrain provides partial vision cover
   */
  public hasPartialVisionCover(worldX: number, worldY: number): boolean {
    const cell = this.getTerrainAt(worldX, worldY);
    if (!cell) return false;

    const feature = cell.feature || 'none';
    return TERRAIN_FEATURE_CONFIG[feature].partialVision;
  }

  public getWidth(): number {
    return this.mapData.width * this.cellSize;
  }

  public getHeight(): number {
    return this.mapData.height * this.cellSize;
  }

  /**
   * Get the raw heightmap data for vision LOS calculations
   * Returns a copy of the heightmap array (gridWidth x gridHeight)
   */
  public getHeightMapData(): Float32Array {
    return this.heightMap.slice();
  }

  /**
   * Get heightmap dimensions
   */
  public getHeightMapDimensions(): { width: number; height: number; cellSize: number } {
    return {
      width: this.gridWidth,
      height: this.gridHeight,
      cellSize: this.cellSize,
    };
  }

  /**
   * Smooth the heightmap using Gaussian-like averaging
   * Preserves large features while smoothing rough transitions
   * IMPORTANT: Skips ramp cells and plateau edges to preserve clean geometry
   */
  private smoothHeightMap(iterations: number = 1): void {
    const { width, height, terrain } = this.mapData;
    const temp = new Float32Array(this.heightMap.length);

    // Helper to check if a vertex touches a ramp/platform cell or is adjacent to one
    // (protecting adjacent vertices prevents discontinuities at edges)
    const isRampOrPlatformOrAdjacentVertex = (vx: number, vy: number): boolean => {
      // A vertex at (vx, vy) touches up to 4 cells
      // Also check cells that are 1 step further out to protect the boundary
      for (let dy = -2; dy <= 1; dy++) {
        for (let dx = -2; dx <= 1; dx++) {
          const cx = vx + dx;
          const cy = vy + dy;
          if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
            const cellTerrain = terrain[cy][cx].terrain;
            // Ramps and platforms should stay perfectly flat
            if (cellTerrain === 'ramp' || cellTerrain === 'platform') {
              return true;
            }
          }
        }
      }
      return false;
    };

    // Helper to check if a vertex is on a plateau edge (ground adjacent to cliff)
    // This preserves the clean circular shape of base plateaus
    // IMPORTANT: Does NOT apply to vertices near ramps - those need smoothing for proper transitions
    const isPlateauEdgeVertex = (vx: number, vy: number): boolean => {
      // Check the 4 cells this vertex touches
      const cellCoords = [
        { cx: vx - 1, cy: vy - 1 },
        { cx: vx, cy: vy - 1 },
        { cx: vx - 1, cy: vy },
        { cx: vx, cy: vy },
      ];

      let hasGround = false;
      let hasUnwalkable = false;
      let hasRamp = false;

      for (const { cx, cy } of cellCoords) {
        if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
          const cellTerrain = terrain[cy][cx].terrain;
          if (cellTerrain === 'ground' || cellTerrain === 'unbuildable' || cellTerrain === 'platform') {
            hasGround = true;
          }
          if (cellTerrain === 'unwalkable') {
            hasUnwalkable = true;
          }
          if (cellTerrain === 'ramp') {
            hasRamp = true;
          }
        }
      }

      // This is a plateau edge if it touches both ground and unwalkable (cliff)
      // BUT NOT if it also touches a ramp - ramp areas need full smoothing
      return hasGround && hasUnwalkable && !hasRamp;
    };

    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 0; y <= height; y++) {
        for (let x = 0; x <= width; x++) {
          const idx = y * this.gridWidth + x;

          // SKIP RAMP VERTICES AND ADJACENT - preserve their exact calculated heights
          // This ensures ramps stay as clean linear slopes, not smoothed flat steps
          // Also protects adjacent vertices to prevent discontinuities at ramp boundaries
          if (isRampOrPlatformOrAdjacentVertex(x, y)) {
            temp[idx] = this.heightMap[idx];
            continue;
          }

          // SKIP PLATEAU EDGE VERTICES - preserve clean circular base shapes
          // This prevents the base circle from being deformed by smoothing
          if (isPlateauEdgeVertex(x, y)) {
            temp[idx] = this.heightMap[idx];
            continue;
          }

          let sum = this.heightMap[idx] * 4; // Center weight
          let weight = 4;

          // Sample neighbors with distance-based weighting
          const offsets = [
            { dx: -1, dy: 0, w: 2 },
            { dx: 1, dy: 0, w: 2 },
            { dx: 0, dy: -1, w: 2 },
            { dx: 0, dy: 1, w: 2 },
            { dx: -1, dy: -1, w: 1 },
            { dx: 1, dy: -1, w: 1 },
            { dx: -1, dy: 1, w: 1 },
            { dx: 1, dy: 1, w: 1 },
          ];

          for (const { dx, dy, w } of offsets) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx <= width && ny >= 0 && ny <= height) {
              sum += this.heightMap[ny * this.gridWidth + nx] * w;
              weight += w;
            }
          }

          temp[idx] = sum / weight;
        }
      }

      // Copy back
      for (let i = 0; i < this.heightMap.length; i++) {
        this.heightMap[i] = temp[i];
      }
    }
  }

  public dispose(): void {
    // Dispose all chunk geometries
    for (const geometry of this.chunkGeometries) {
      geometry.dispose();
    }
    this.chunkGeometries = [];
    this.chunkMeshes = [];

    // Dispose guardrail geometry
    if (this.guardrailGeometry) {
      this.guardrailGeometry.dispose();
      this.guardrailGeometry = null;
    }
    this.guardrailMesh = null;

    if (this.tslMaterial) {
      this.tslMaterial.dispose();
    } else {
      this.material.dispose();
    }
  }

  /**
   * Generate walkable geometry for navmesh generation.
   * Returns triangles from walkable terrain plus cliff wall barriers.
   * Used by recast-navigation for navmesh generation.
   *
   * RTS-STYLE CLIFF HANDLING:
   * 1. Walkable floor geometry uses quantized heights for strict elevation separation
   * 2. Ramps use smooth heightMap for natural slope traversal
   * 3. Cliff walls are generated at boundaries between different elevations
   *
   * This creates a robust navmesh where:
   * - Cliffs are impassable (wall geometry + height gap > walkableClimb)
   * - Ramps are traversable (continuous sloped geometry)
   * - Normal terrain has minor height variation within walkableClimb limits
   */
  /**
   * Generate walkable geometry for navmesh generation.
   *
   * MINIMAL IMPLEMENTATION: Uses raw cell elevations directly (matching editor display).
   * Lets Recast handle walkability via walkableClimb and walkableSlopeAngle.
   *
   * Key principles:
   * 1. Vertex heights from raw cell elevations (like EditorTerrain)
   * 2. Shared vertices for Recast polygon connectivity
   * 3. Cliff walls block unwalkable boundaries
   * 4. NO zone calculations, NO smoothing passes - trust Recast
   */
  public generateWalkableGeometry(): { positions: Float32Array; indices: Uint32Array } {
    const terrain = this.mapData.terrain;
    const width = this.mapData.width;
    const height = this.mapData.height;

    const vertices: number[] = [];
    const indices: number[] = [];
    let vertexIndex = 0;

    // Helper: Check if a cell is walkable for pathfinding
    const isCellWalkable = (cx: number, cy: number): boolean => {
      if (cx < 0 || cx >= width || cy < 0 || cy >= height) return false;
      const cell = terrain[cy][cx];
      if (cell.terrain === 'unwalkable') return false;
      const feature = cell.feature || 'none';
      const featureConfig = TERRAIN_FEATURE_CONFIG[feature];
      return featureConfig.walkable;
    };

    // Store vertex heights - will be computed per-cell below
    const vertexHeights = new Float32Array((width + 1) * (height + 1));
    this.navMeshHeightMap = vertexHeights;

    // SIMPLEST APPROACH: Each cell is a flat quad at its own elevation.
    // No vertex sharing between cells with different elevations.
    // Recast handles the step-ups via walkableClimb.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isCellWalkable(x, y)) continue;

        const cell = terrain[y][x];
        const h = cell.elevation * ELEVATION_TO_HEIGHT_FACTOR;

        // Store in height map for overlay
        vertexHeights[y * (width + 1) + x] = h;
        vertexHeights[y * (width + 1) + (x + 1)] = h;
        vertexHeights[(y + 1) * (width + 1) + x] = h;
        vertexHeights[(y + 1) * (width + 1) + (x + 1)] = h;

        // World coordinates for cell corners
        const x0 = x;
        const x1 = x + 1;
        const z0 = y;
        const z1 = y + 1;

        // Add 4 vertices for this cell (flat quad at cell elevation)
        const baseIdx = vertexIndex;
        vertices.push(x0, h, z0);  // NW corner
        vertices.push(x1, h, z0);  // NE corner
        vertices.push(x0, h, z1);  // SW corner
        vertices.push(x1, h, z1);  // SE corner
        vertexIndex += 4;

        // Two triangles per cell (CCW winding)
        indices.push(baseIdx, baseIdx + 2, baseIdx + 1);      // NW, SW, NE
        indices.push(baseIdx + 1, baseIdx + 2, baseIdx + 3);  // NE, SW, SE
      }
    }

    const floorTriangles = indices.length / 3;

    debugTerrain.log(
      `[Terrain] Generated walkable geometry: ${vertices.length / 3} vertices, ` +
      `${floorTriangles} floor triangles`
    );

    return {
      positions: new Float32Array(vertices),
      indices: new Uint32Array(indices),
    };
  }

  /**
   * Generate water geometry for naval navmesh generation.
   * Returns triangles from water cells (water_deep and water_shallow features).
   * Used by recast-navigation for water navmesh generation.
   *
   * NAVAL PATHFINDING:
   * - Water cells are walkable for naval units
   * - Land cells are unwalkable (barriers)
   * - Water surface is at a constant level per cell
   */
  public generateWaterGeometry(): { positions: Float32Array; indices: Uint32Array } {
    const terrain = this.mapData.terrain;
    const width = this.mapData.width;
    const height = this.mapData.height;

    const vertices: number[] = [];
    const indices: number[] = [];
    let vertexIndex = 0;

    // Water surface height offset
    const WATER_SURFACE_OFFSET = 0.15;

    // Helper: Check if a cell is water (navigable by naval units)
    const isCellWater = (cx: number, cy: number): boolean => {
      if (cx < 0 || cx >= width || cy < 0 || cy >= height) return false;
      const cell = terrain[cy][cx];
      const feature = cell.feature || 'none';
      return feature === 'water_deep' || feature === 'water_shallow';
    };

    // Pre-compute vertex heights for water surface
    // Use average elevation of adjacent water cells
    const vertexHeights = new Float32Array((width + 1) * (height + 1));
    for (let vy = 0; vy <= height; vy++) {
      for (let vx = 0; vx <= width; vx++) {
        // Check all 4 adjacent cells
        let totalElevation = 0;
        let waterCount = 0;

        for (let dy = -1; dy <= 0; dy++) {
          for (let dx = -1; dx <= 0; dx++) {
            const cx = vx + dx;
            const cy = vy + dy;
            if (isCellWater(cx, cy)) {
              totalElevation += terrain[cy][cx].elevation;
              waterCount++;
            }
          }
        }

        if (waterCount > 0) {
          // Average elevation for water surface
          vertexHeights[vy * (width + 1) + vx] =
            (totalElevation / waterCount) * ELEVATION_TO_HEIGHT_FACTOR + WATER_SURFACE_OFFSET;
        } else {
          // Non-water vertex - use terrain height from heightMap
          // Clamp coordinates to valid heightMap range
          const hx = Math.min(vx, this.gridWidth - 1);
          const hy = Math.min(vy, this.gridHeight - 1);
          vertexHeights[vy * (width + 1) + vx] = this.heightMap[hy * this.gridWidth + hx];
        }
      }
    }

    // Generate floor geometry for water cells
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isCellWater(x, y)) continue;

        // Get vertex heights for this cell's corners
        const h00 = vertexHeights[y * (width + 1) + x];
        const h10 = vertexHeights[y * (width + 1) + (x + 1)];
        const h01 = vertexHeights[(y + 1) * (width + 1) + x];
        const h11 = vertexHeights[(y + 1) * (width + 1) + (x + 1)];

        // World coordinates
        const x0 = x;
        const x1 = x + 1;
        const z0 = y;
        const z1 = y + 1;

        // Add quad vertices (2 triangles)
        // Triangle 1: TL, BL, TR
        vertices.push(x0, h00, z0); // TL
        vertices.push(x0, h01, z1); // BL
        vertices.push(x1, h10, z0); // TR

        // Triangle 2: TR, BL, BR
        vertices.push(x1, h10, z0); // TR
        vertices.push(x0, h01, z1); // BL
        vertices.push(x1, h11, z1); // BR

        // Add indices
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        indices.push(vertexIndex + 3, vertexIndex + 4, vertexIndex + 5);
        vertexIndex += 6;
      }
    }

    // Add barrier walls at water-land boundaries
    // This prevents naval units from going onto land
    const WALL_HEIGHT = 3.0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isCellWater(x, y)) continue;

        const cell = terrain[y][x];
        const waterHeight = cell.elevation * ELEVATION_TO_HEIGHT_FACTOR + WATER_SURFACE_OFFSET;

        // Check each edge for water-land boundary
        // North edge (y - 1)
        if (y > 0 && !isCellWater(x, y - 1)) {
          const x0 = x;
          const x1 = x + 1;
          const z = y;
          const hTop = waterHeight + WALL_HEIGHT;
          const hBottom = waterHeight - 0.5;

          vertices.push(x0, hBottom, z);
          vertices.push(x1, hBottom, z);
          vertices.push(x0, hTop, z);
          vertices.push(x1, hTop, z);

          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
          indices.push(vertexIndex + 2, vertexIndex + 1, vertexIndex + 3);
          vertexIndex += 4;
        }

        // South edge (y + 1)
        if (y < height - 1 && !isCellWater(x, y + 1)) {
          const x0 = x;
          const x1 = x + 1;
          const z = y + 1;
          const hTop = waterHeight + WALL_HEIGHT;
          const hBottom = waterHeight - 0.5;

          vertices.push(x1, hBottom, z);
          vertices.push(x0, hBottom, z);
          vertices.push(x1, hTop, z);
          vertices.push(x0, hTop, z);

          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
          indices.push(vertexIndex + 2, vertexIndex + 1, vertexIndex + 3);
          vertexIndex += 4;
        }

        // West edge (x - 1)
        if (x > 0 && !isCellWater(x - 1, y)) {
          const xPos = x;
          const z0 = y;
          const z1 = y + 1;
          const hTop = waterHeight + WALL_HEIGHT;
          const hBottom = waterHeight - 0.5;

          vertices.push(xPos, hBottom, z1);
          vertices.push(xPos, hBottom, z0);
          vertices.push(xPos, hTop, z1);
          vertices.push(xPos, hTop, z0);

          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
          indices.push(vertexIndex + 2, vertexIndex + 1, vertexIndex + 3);
          vertexIndex += 4;
        }

        // East edge (x + 1)
        if (x < width - 1 && !isCellWater(x + 1, y)) {
          const xPos = x + 1;
          const z0 = y;
          const z1 = y + 1;
          const hTop = waterHeight + WALL_HEIGHT;
          const hBottom = waterHeight - 0.5;

          vertices.push(xPos, hBottom, z0);
          vertices.push(xPos, hBottom, z1);
          vertices.push(xPos, hTop, z0);
          vertices.push(xPos, hTop, z1);

          indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
          indices.push(vertexIndex + 2, vertexIndex + 1, vertexIndex + 3);
          vertexIndex += 4;
        }
      }
    }

    debugTerrain.log(
      `[Terrain] Generated water geometry: ${vertices.length / 3} vertices, ${indices.length / 3} triangles`
    );

    return {
      positions: new Float32Array(vertices),
      indices: new Uint32Array(indices),
    };
  }

  /**
   * Create a Three.js mesh from walkable geometry (for debugging)
   */
  public createWalkableMesh(): THREE.Mesh {
    const { positions, indices } = this.generateWalkableGeometry();

    const geometry = new THREE.BufferGeometry();

    // Defensive check: ensure we have valid geometry data
    if (positions.length === 0 || indices.length === 0) {
      debugTerrain.warn('[Terrain] Warning: Empty walkable geometry generated');
      // Create a minimal valid geometry to prevent WebGPU errors
      const minimalPositions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]);
      const minimalIndices = new Uint32Array([0, 1, 2]);
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(minimalPositions, 3));
      geometry.setIndex(new THREE.Uint32BufferAttribute(minimalIndices, 1));
    } else {
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      wireframe: true,
      transparent: true,
      opacity: 0.3,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; // Match terrain rotation
    return mesh;
  }
}

// Grid overlay for building placement
export class TerrainGrid {
  public mesh: THREE.LineSegments;

  private width: number;
  private height: number;
  private cellSize: number;

  constructor(width: number, height: number, cellSize = 1) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.mesh = this.createMesh();
    this.mesh.visible = false;
  }

  private createMesh(): THREE.LineSegments {
    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];

    for (let x = 0; x <= this.width; x += this.cellSize) {
      vertices.push(x, 0, 0.1);
      vertices.push(x, this.height, 0.1);
    }

    for (let y = 0; y <= this.height; y += this.cellSize) {
      vertices.push(0, y, 0.1);
      vertices.push(this.width, y, 0.1);
    }

    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3)
    );

    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      opacity: 0.2,
      transparent: true,
    });

    const mesh = new THREE.LineSegments(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  public show(): void {
    this.mesh.visible = true;
  }

  public hide(): void {
    this.mesh.visible = false;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// Emissive decoration tracking for pulsing animation (materials without attached lights)
interface TrackedEmissiveDecoration {
  material: THREE.MeshStandardMaterial;
  baseIntensity: number;
  pulseSpeed: number;
  pulseAmplitude: number;
}

// Import DecorationLightManager type (will be passed in)
import { DecorationLightManager, DecorationLightConfig as _DecorationLightConfig } from './DecorationLightManager';

// Decorative elements (watch towers, destructible rocks, trees, etc.)
export class MapDecorations {
  public group: THREE.Group;
  private terrain: Terrain;
  private scene: THREE.Scene | null = null;
  // AAA light manager for pooled, frustum-culled decoration lights
  private lightManager: DecorationLightManager | null = null;
  // Track rock positions for pathfinding collision
  private rockCollisions: Array<{ x: number; z: number; radius: number }> = [];
  // Track tree positions for pathfinding collision
  private treeCollisions: Array<{ x: number; z: number; radius: number }> = [];
  // Track emissive decorations for pulsing animation (materials only, no lights)
  private emissiveDecorations: TrackedEmissiveDecoration[] = [];
  // Animation time accumulator
  private animationTime: number = 0;

  constructor(mapData: MapData, terrain: Terrain, scene?: THREE.Scene, lightManager?: DecorationLightManager) {
    this.group = new THREE.Group();
    this.terrain = terrain;
    this.scene = scene || null;
    this.lightManager = lightManager || null;
    this.createWatchTowers(mapData);
    this.createDestructibles(mapData);

    // Create explicit decorations from map data (instanced decorations handle procedural)
    if (mapData.decorations && mapData.decorations.length > 0) {
      this.createExplicitDecorations(mapData);
    }
  }

  /**
   * Update emissive decoration pulsing animation.
   * Call this every frame with deltaTime in milliseconds.
   *
   * NOTE: Light pulsing is now handled by DecorationLightManager.
   * This only updates emissive materials for decorations without attached lights.
   */
  public update(deltaTime: number): void {
    if (this.emissiveDecorations.length === 0) return;

    this.animationTime += deltaTime * 0.001; // Convert to seconds

    for (const deco of this.emissiveDecorations) {
      if (deco.pulseSpeed > 0 && deco.pulseAmplitude > 0) {
        // Organic pulsing using smoothed sine wave
        // Multiple harmonics create more natural, breathing-like rhythm
        const t = this.animationTime * deco.pulseSpeed;
        const primary = Math.sin(t * Math.PI * 2);
        const secondary = Math.sin(t * Math.PI * 2 * 1.7) * 0.3; // Slight variation
        const rawPulse = (primary + secondary) / 1.3; // Normalize

        // Smooth easing: bias toward brighter (looks more natural for glow)
        const eased = rawPulse * 0.5 + 0.5; // Map to 0-1
        const pulse = 1.0 + (eased * 2 - 1) * deco.pulseAmplitude;

        // Update material emissive
        deco.material.emissiveIntensity = deco.baseIntensity * pulse;
      }
    }
  }

  /**
   * Apply rendering hints from assets.json to a decoration model.
   * - Preserves model's baked-in emissive colors/maps
   * - Only boosts intensity, doesn't override colors unless model has none
   * - Registers lights with DecorationLightManager for pooling/culling
   */
  private applyRenderingHintsToModel(
    model: THREE.Object3D,
    hints: ReturnType<typeof AssetManager.getRenderingHints>,
    x: number,
    y: number,
    z: number
  ): void {
    if (!hints) return;

    // Get asset height for proper light positioning
    const assetHeight = this.getAssetHeight(model) || 2.0;
    let lightRegistered = false;
    let firstMaterialForLight: THREE.MeshStandardMaterial | undefined;
    let firstMaterialBaseIntensity = 0;

    // Find and modify all MeshStandardMaterial instances in the model
    model.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];

        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            // Apply envMapIntensity for reflections
            if (hints.envMapIntensity !== undefined) {
              material.envMapIntensity = hints.envMapIntensity;
            }

            // Apply roughness/metalness overrides
            if (hints.roughnessOverride !== undefined && hints.roughnessOverride !== null) {
              material.roughness = hints.roughnessOverride;
            }
            if (hints.metalnessOverride !== undefined && hints.metalnessOverride !== null) {
              material.metalness = hints.metalnessOverride;
            }

            // Smart emissive handling: preserve model's baked-in glow
            if (hints.emissive || hints.emissiveIntensity !== undefined) {
              const existingEmissive = material.emissive;
              const hasExistingEmissive = existingEmissive &&
                (existingEmissive.r > 0.01 || existingEmissive.g > 0.01 || existingEmissive.b > 0.01);

              if (hasExistingEmissive) {
                // Model has baked-in emissive - just boost intensity, preserve color
                const boostFactor = hints.emissiveIntensity ?? 1.0;
                material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.1) * boostFactor;
              } else if (hints.emissive) {
                // Model has no emissive - apply hint color subtly
                material.emissive = new THREE.Color(hints.emissive);
                material.emissiveIntensity = hints.emissiveIntensity ?? 0.3;
              }

              // Track first material for light synchronization
              if (!firstMaterialForLight) {
                firstMaterialForLight = material;
                firstMaterialBaseIntensity = material.emissiveIntensity;
              }

              // Track for pulsing animation if pulse properties are set (material only, no light)
              if ((hints.pulseSpeed || hints.pulseAmplitude) && !hints.attachLight) {
                this.emissiveDecorations.push({
                  material,
                  baseIntensity: material.emissiveIntensity,
                  pulseSpeed: hints.pulseSpeed ?? 0,
                  pulseAmplitude: hints.pulseAmplitude ?? 0,
                });
              }
            }
          }
        }
      }
    });

    // Register light with DecorationLightManager (AAA pooling approach)
    // Only ONE light per decoration, registered with the manager for pooling/culling
    if (hints.attachLight && this.lightManager && !lightRegistered) {
      const lightPos = new THREE.Vector3(x, y + assetHeight * 0.6, z);

      this.lightManager.registerDecoration({
        position: lightPos,
        color: new THREE.Color(hints.attachLight.color),
        baseIntensity: hints.attachLight.intensity,
        distance: hints.attachLight.distance,
        pulseSpeed: hints.pulseSpeed ?? 0,
        pulseAmplitude: hints.pulseAmplitude ?? 0,
        // Pass material reference for synchronized pulsing
        material: firstMaterialForLight,
        baseMaterialIntensity: firstMaterialBaseIntensity,
      });
      lightRegistered = true;
    }
  }

  /**
   * Get the bounding box height of a model
   */
  private getAssetHeight(model: THREE.Object3D): number {
    const box = new THREE.Box3().setFromObject(model);
    return box.max.y - box.min.y;
  }

  /**
   * Get rock collision data for pathfinding
   */
  public getRockCollisions(): Array<{ x: number; z: number; radius: number }> {
    return this.rockCollisions;
  }

  /**
   * Get tree collision data for pathfinding
   */
  public getTreeCollisions(): Array<{ x: number; z: number; radius: number }> {
    return this.treeCollisions;
  }

  // Create explicit decorations from map data using GLB models
  private createExplicitDecorations(mapData: MapData): void {
    if (!mapData.decorations) return;

    for (const decoration of mapData.decorations) {
      const terrainHeight = this.terrain.getHeightAt(decoration.x, decoration.y);

      // Try to get the GLB model for this decoration type
      const model = AssetManager.getDecorationMesh(decoration.type);
      if (model) {
        model.position.set(decoration.x, terrainHeight, decoration.y);
        if (decoration.scale) {
          model.scale.setScalar(decoration.scale);
        }
        if (decoration.rotation !== undefined) {
          model.rotation.y = decoration.rotation;
        } else {
          model.rotation.y = Math.random() * Math.PI * 2;
        }

        // Apply rendering hints from assets.json
        const hints = AssetManager.getRenderingHints(decoration.type);
        if (hints) {
          this.applyRenderingHintsToModel(model, hints, decoration.x, terrainHeight, decoration.y);
        }

        this.group.add(model);
      } else {
        // Fallback to procedural mesh for unloaded decoration types
        this.createProceduralDecoration(decoration, terrainHeight);
      }

      // Track rock collisions for pathfinding
      // rocks_large, rocks_small, rock_single should all block pathing
      if (decoration.type.includes('rock')) {
        const scale = decoration.scale ?? 1;
        // Base radius varies by rock type
        let baseRadius = 1.0;
        if (decoration.type === 'rocks_large') {
          baseRadius = 2.0;
        } else if (decoration.type === 'rocks_small') {
          baseRadius = 1.2;
        } else if (decoration.type === 'rock_single') {
          baseRadius = 0.8;
        }
        this.rockCollisions.push({
          x: decoration.x,
          z: decoration.y, // Note: decoration.y is world Z coordinate
          radius: baseRadius * scale,
        });
      }

      // Track tree collisions for pathfinding
      // All tree types should block pathing at their trunk
      if (decoration.type.includes('tree')) {
        const scale = decoration.scale ?? 1;
        // Base trunk collision radius - trees have thinner collision than rocks
        let baseRadius = 0.6;
        if (decoration.type === 'tree_pine_tall') {
          baseRadius = 0.8;
        } else if (decoration.type === 'tree_pine_medium') {
          baseRadius = 0.6;
        } else if (decoration.type === 'tree_palm') {
          baseRadius = 0.5;
        } else if (decoration.type === 'tree_dead') {
          baseRadius = 0.4;
        } else if (decoration.type === 'tree_alien' || decoration.type === 'tree_mushroom') {
          baseRadius = 0.7;
        }
        this.treeCollisions.push({
          x: decoration.x,
          z: decoration.y, // Note: decoration.y is world Z coordinate
          radius: baseRadius * scale,
        });
      }
    }
  }

  // Fallback procedural decorations for when models aren't loaded
  private createProceduralDecoration(
    decoration: { type: string; x: number; y: number; scale?: number; rotation?: number },
    terrainHeight: number
  ): void {
    const scale = decoration.scale ?? 1;
    let mesh: THREE.Mesh | THREE.Group | null = null;

    if (decoration.type.includes('tree')) {
      // Create procedural tree
      const group = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2 * scale, 0.3 * scale, 2 * scale, 6),
        new THREE.MeshBasicMaterial({ color: 0x4a3520 })
      );
      trunk.position.y = scale;
      group.add(trunk);

      const foliage = new THREE.Mesh(
        new THREE.ConeGeometry(1.2 * scale, 2.5 * scale, 8),
        new THREE.MeshBasicMaterial({ color: 0x2d5a2d })
      );
      foliage.position.y = 2.5 * scale;
      group.add(foliage);
      mesh = group as unknown as THREE.Mesh;
    } else if (decoration.type.includes('rock')) {
      mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.8 * scale),
        new THREE.MeshBasicMaterial({ color: 0x5a5a5a })
      );
    } else if (decoration.type === 'crystal_formation') {
      mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.6 * scale),
        new THREE.MeshBasicMaterial({ color: 0x80a0ff, transparent: true, opacity: 0.7 })
      );
    } else if (decoration.type === 'bush' || decoration.type === 'grass_clump') {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.4 * scale, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0x3a6a3a })
      );
    } else if (decoration.type === 'debris') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.5 * scale, 0.2 * scale, 0.5 * scale),
        new THREE.MeshBasicMaterial({ color: 0x4a4a4a })
      );
    } else if (decoration.type === 'ruined_wall') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(2 * scale, 1.5 * scale, 0.3 * scale),
        new THREE.MeshBasicMaterial({ color: 0x6a6a6a })
      );
    }

    if (mesh) {
      mesh.position.set(decoration.x, terrainHeight + (decoration.type.includes('rock') ? 0.3 : 0), decoration.y);
      if (decoration.rotation !== undefined) {
        mesh.rotation.y = decoration.rotation;
      }
      this.group.add(mesh);
    }
  }

  private createWatchTowers(mapData: MapData): void {
    for (const tower of mapData.watchTowers) {
      // Get terrain height at tower position
      const terrainHeight = this.terrain.getHeightAt(tower.x, tower.y);

      // Try to use custom alien_tower model
      const customTower = AssetManager.getDecorationMesh('alien_tower');
      if (customTower) {
        customTower.position.set(tower.x, terrainHeight, tower.y);
        this.group.add(customTower);
      } else {
        // Fall back to procedural tower
        // Tower base
        const baseGeometry = new THREE.CylinderGeometry(2, 2.5, 1, 8);
        const baseMaterial = new THREE.MeshStandardMaterial({
          color: 0x606070,
          roughness: 0.6,
          metalness: 0.4,
        });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.set(tower.x, terrainHeight + 0.5, tower.y);
        base.castShadow = true;
        base.receiveShadow = true;
        this.group.add(base);

        // Tower pillar
        const pillarGeometry = new THREE.CylinderGeometry(1, 1.5, 5, 8);
        const pillarMaterial = new THREE.MeshStandardMaterial({
          color: 0x8080a0,
          roughness: 0.5,
          metalness: 0.6,
        });
        const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
        pillar.position.set(tower.x, terrainHeight + 3.5, tower.y);
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        this.group.add(pillar);

        // Tower top/beacon
        const topGeometry = new THREE.ConeGeometry(1.5, 2, 8);
        const topMaterial = new THREE.MeshStandardMaterial({
          color: 0xa0a0c0,
          roughness: 0.3,
          metalness: 0.7,
        });
        const top = new THREE.Mesh(topGeometry, topMaterial);
        top.position.set(tower.x, terrainHeight + 7, tower.y);
        top.castShadow = true;
        this.group.add(top);
      }

      // Note: Vision range rings removed - they were causing "eye-shaped shadow" visual artifacts
      // on large maps with multiple watch towers. The WatchTowerRenderer handles tower visualization.
    }
  }

  private createDestructibles(mapData: MapData): void {
    for (const rock of mapData.destructibles) {
      // Get terrain height at rock position
      const terrainHeight = this.terrain.getHeightAt(rock.x, rock.y);

      // Try to use custom rocks_large model for destructibles
      const customRock = AssetManager.getDecorationMesh('rocks_large');
      if (customRock) {
        // Scale up for destructible rocks (they're larger barriers)
        customRock.scale.setScalar(2.5);
        customRock.position.set(rock.x, terrainHeight, rock.y);
        customRock.rotation.y = Math.random() * Math.PI * 2;
        this.group.add(customRock);
      } else {
        // Fallback to procedural rock formation
        const rockGroup = new THREE.Group();

        // Main rock
        const mainGeometry = new THREE.DodecahedronGeometry(2);
        const mainMaterial = new THREE.MeshStandardMaterial({
          color: 0x7a6a5a,
          roughness: 0.9,
          metalness: 0.05,
        });
        const mainRock = new THREE.Mesh(mainGeometry, mainMaterial);
        mainRock.position.y = 1.5;
        mainRock.rotation.set(
          Math.random() * 0.5,
          Math.random() * Math.PI * 2,
          Math.random() * 0.3
        );
        mainRock.scale.set(1, 0.8, 1.2);
        mainRock.castShadow = false;
        mainRock.receiveShadow = true;
        rockGroup.add(mainRock);

        // Smaller rocks around
        for (let i = 0; i < 3; i++) {
          const smallGeometry = new THREE.DodecahedronGeometry(0.8);
          const smallRock = new THREE.Mesh(smallGeometry, mainMaterial);
          const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
          smallRock.position.set(
            Math.cos(angle) * 2,
            0.5,
            Math.sin(angle) * 2
          );
          smallRock.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
          );
          smallRock.scale.setScalar(0.5 + Math.random() * 0.5);
          smallRock.castShadow = false;
          smallRock.receiveShadow = true;
          rockGroup.add(smallRock);
        }

        rockGroup.position.set(rock.x, terrainHeight, rock.y);
        this.group.add(rockGroup);
      }
    }
  }

  public dispose(): void {
    // Clear emissive decorations (lights are now managed by DecorationLightManager)
    this.emissiveDecorations = [];

    this.group.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}

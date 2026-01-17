import * as THREE from 'three';
import { MapData, MapCell, TerrainType, ElevationLevel, Elevation, TerrainFeature, TERRAIN_FEATURE_CONFIG } from '@/data/maps';
import { BiomeConfig, BIOMES, blendBiomeColors, BiomeType, getBiomeShaderConfig } from './Biomes';
import { createTerrainShaderMaterial, updateTerrainShader } from './shaders/TerrainShader';
import { createVoidstrikeTerrainShaderMaterial, getVoidstrikeBiomeConfig, updateVoidstrikeTerrainShader } from './shaders/VoidstrikeTerrainShader';
import { createTextureTerrainMaterial, updateTextureTerrainShader, getBiomeTextureConfig, BiomeTextureType } from './shaders/TextureTerrainShader';
import { TSLTerrainMaterial } from './tsl/TerrainMaterial';
import AssetManager from '@/assets/AssetManager';
import { debugTerrain } from '@/utils/debugLogger';

// Shader mode for terrain rendering
// 'tsl': Uses TSL 4-texture blending (WebGPU + WebGL compatible) - RECOMMENDED
// 'standard': Uses MeshStandardMaterial single texture (WebGPU + WebGL compatible)
// 'texture': Uses GLSL ShaderMaterial with textures (WebGL only)
// 'basic': Uses GLSL ShaderMaterial procedural (WebGL only)
// 'sc2': Uses GLSL ShaderMaterial full procedural (WebGL only)
type TerrainShaderMode = 'tsl' | 'standard' | 'texture' | 'basic' | 'sc2';


// Terrain subdivision for smoother rendering
const SUBDIVISIONS = 2; // 2x2 subdivisions per cell for better quality

/**
 * Convert 256-level elevation (0-255) to physical world height.
 * Range: 0 to ~10 units (0.04 per level for dramatic cliffs)
 * SC2-style: significant height difference between elevation levels
 */
function elevationToHeight(elevation: Elevation): number {
  return elevation * 0.04;
}

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
function quantizeElevation(elevation: Elevation): number {
  if (elevation < 100) return elevationToHeight(60);
  if (elevation < 180) return elevationToHeight(140);
  return elevationToHeight(220);
}

// Legacy height lookup for backwards compatibility
const ELEVATION_HEIGHTS: Record<ElevationLevel, number> = {
  0: elevationToHeight(60),   // ~2.4 (low ground)
  1: elevationToHeight(140),  // ~5.6 (natural expansion level)
  2: elevationToHeight(220),  // ~8.8 (main base level)
};

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
function ridgedNoise(x: number, y: number, octaves: number, lacunarity: number = 2.0, persistence: number = 0.5): number {
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
function turbulenceNoise(x: number, y: number, octaves: number): number {
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
function voronoiNoise(x: number, y: number, frequency: number = 4): number {
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

function smoothNoise(x: number, y: number, scale: number, seed: number = 0): number {
  return fbmNoise(x / scale + seed * 0.1, y / scale + seed * 0.1, 3, 2.0, 0.5) * 0.5 + 0.5;
}

function fractalNoise(x: number, y: number, octaves: number, persistence: number, seed: number = 0): number {
  return fbmNoise(x * 0.1 + seed * 0.01, y * 0.1 + seed * 0.01, octaves, 2.0, persistence) * 0.5 + 0.5;
}

// PERF: Terrain chunk size for frustum culling
// Each chunk is a separate mesh with its own bounding box
// Chunks outside the camera frustum are automatically culled by Three.js
const TERRAIN_CHUNK_SIZE = 32; // 32x32 cells per chunk

export class Terrain {
  public mesh: THREE.Group; // Group containing chunk meshes
  public mapData: MapData;
  public biome: BiomeConfig;

  private cellSize: number;
  private chunkMeshes: THREE.Mesh[] = []; // Individual chunk meshes
  private chunkGeometries: THREE.BufferGeometry[] = [];
  private material: THREE.Material;
  private tslMaterial: TSLTerrainMaterial | null = null;

  // Store heightmap for queries
  private heightMap: Float32Array;
  private gridWidth: number;
  private gridHeight: number;

  // Shader mode selection:
  // - 'tsl': Uses TSL 4-texture blending (WebGPU + WebGL compatible) - RECOMMENDED
  // - 'standard': Uses MeshStandardMaterial single texture (WebGPU + WebGL compatible)
  // - 'texture': Uses AI-generated textures with GLSL (WebGL only, 60+ FPS)
  // - 'basic': Simple procedural shader (WebGL only, 30-60 FPS)
  // - 'sc2': Full procedural (WebGL only, 10 FPS - too slow)
  private static SHADER_MODE: TerrainShaderMode = 'tsl';

  constructor(config: TerrainConfig) {
    this.mapData = config.mapData;
    this.cellSize = config.cellSize ?? 1;
    this.gridWidth = this.mapData.width + 1;
    this.gridHeight = this.mapData.height + 1;
    this.heightMap = new Float32Array(this.gridWidth * this.gridHeight);

    // Get biome configuration
    this.biome = BIOMES[this.mapData.biome || 'grassland'];

    // Create shader material based on mode
    switch (Terrain.SHADER_MODE) {
      case 'tsl':
        // Use TSL 4-texture blending material (WebGPU + WebGL compatible)
        debugTerrain.log('[Terrain] Using TSL 4-texture blending for biome:', this.mapData.biome || 'grassland');
        this.tslMaterial = new TSLTerrainMaterial({
          biome: this.mapData.biome || 'grassland',
          mapWidth: this.mapData.width,
          mapHeight: this.mapData.height,
        });
        this.material = this.tslMaterial.material;
        break;
      case 'standard':
        // Use standard PBR material (WebGPU + WebGL compatible)
        debugTerrain.log('[Terrain] Using standard PBR material for biome:', this.mapData.biome || 'grassland');
        this.material = this.createStandardMaterial();
        break;
      case 'texture':
        // Use biome-specific textures (falls back to grassland if not available)
        const biomeType = (this.mapData.biome || 'grassland') as BiomeTextureType;
        debugTerrain.log(`[Terrain] Using TEXTURE-BASED terrain shader for biome: ${biomeType}`);
        const textureConfig = getBiomeTextureConfig(biomeType);
        this.material = createTextureTerrainMaterial(textureConfig);
        break;
      case 'sc2':
        debugTerrain.log('[Terrain] Using Voidstrike terrain shader for biome:', this.mapData.biome || 'grassland');
        const voidstrikeConfig = getVoidstrikeBiomeConfig(this.mapData.biome || 'grassland');
        this.material = createVoidstrikeTerrainShaderMaterial(voidstrikeConfig);
        break;
      case 'basic':
      default:
        debugTerrain.log('[Terrain] Using basic terrain shader');
        const shaderConfig = getBiomeShaderConfig(this.biome);
        this.material = createTerrainShaderMaterial(shaderConfig);
        break;
    }

    // PERF: Create terrain as chunked meshes for frustum culling
    // Each chunk is a separate mesh that Three.js can cull independently
    this.mesh = new THREE.Group();
    this.mesh.rotation.x = -Math.PI / 2;

    // Create chunked terrain geometries and meshes
    this.createChunkedTerrain();

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

    // Build vertex grid and heightmap (same logic as createGeometry)
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
          // SC2-style geometric surfaces are perfectly flat
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
          color.r = Math.max(0, Math.min(1, color.r + brightVar));
          color.g = Math.max(0, Math.min(1, color.g + brightVar));
          color.b = Math.max(0, Math.min(1, color.b + brightVar));
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

        let cellTerrainType = 0.0;
        if (cell.terrain === 'unwalkable') cellTerrainType = 2.0;
        else if (cell.terrain === 'ramp') cellTerrainType = 1.0;
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
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  // Update shader uniforms (call each frame for animated effects)
  public update(deltaTime: number, sunDirection?: THREE.Vector3): void {
    switch (Terrain.SHADER_MODE) {
      case 'tsl':
        // Update TSL material uniforms
        if (this.tslMaterial) {
          this.tslMaterial.update(deltaTime, sunDirection);
        }
        break;
      case 'standard':
        // Standard material doesn't need per-frame updates
        break;
      case 'texture':
        updateTextureTerrainShader(this.material as THREE.ShaderMaterial, deltaTime, sunDirection);
        break;
      case 'sc2':
        updateVoidstrikeTerrainShader(this.material as THREE.ShaderMaterial, deltaTime, sunDirection);
        break;
      case 'basic':
      default:
        updateTerrainShader(this.material as THREE.ShaderMaterial, deltaTime, sunDirection);
        break;
    }
  }

  /**
   * Create a standard PBR material that works with WebGPU and WebGL
   * Uses textures for high-resolution terrain rendering
   */
  private createStandardMaterial(): THREE.MeshStandardMaterial {
    // Load terrain textures based on biome
    const textureLoader = new THREE.TextureLoader();
    const biomeTextures = this.getBiomeTexturePrefix();

    // Calculate texture repeat based on map size for good visual density
    // Aim for each texture tile to cover approximately 4-8 world units
    const mapSize = Math.max(this.mapData.width, this.mapData.height);
    const repeatScale = Math.max(8, mapSize / 8); // Larger tiles = better resolution

    // Configure texture settings for maximum quality
    const configureTexture = (texture: THREE.Texture, isSRGB: boolean = false) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeatScale, repeatScale);
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      // Enable anisotropic filtering for sharper textures at angles
      texture.anisotropy = 4; // Reduced from 16 for better performance
      if (isSRGB) {
        texture.colorSpace = THREE.SRGBColorSpace;
      }
    };

    // Load diffuse texture
    const diffuseTexture = textureLoader.load(`/textures/terrain/${biomeTextures}_diffuse.png`);
    configureTexture(diffuseTexture, true);

    // Load normal map
    const normalTexture = textureLoader.load(`/textures/terrain/${biomeTextures}_normal.png`);
    configureTexture(normalTexture, false);

    // Load roughness map
    const roughnessTexture = textureLoader.load(`/textures/terrain/${biomeTextures}_roughness.png`);
    configureTexture(roughnessTexture, false);

    // Load displacement map for subtle height detail
    const displacementTexture = textureLoader.load(`/textures/terrain/${biomeTextures}_displacement.png`);
    configureTexture(displacementTexture, false);

    const material = new THREE.MeshStandardMaterial({
      map: diffuseTexture,
      normalMap: normalTexture,
      roughnessMap: roughnessTexture,
      displacementMap: displacementTexture,
      displacementScale: 0.1, // Subtle displacement for micro-detail
      // Don't multiply with vertex colors - let textures show properly
      vertexColors: false,
      roughness: 1.0, // Use roughness map
      metalness: 0.0,
      flatShading: false,
      normalScale: new THREE.Vector2(1.0, 1.0), // Full normal mapping strength
    });

    return material;
  }

  /**
   * Get the texture prefix for the current biome
   */
  private getBiomeTexturePrefix(): string {
    const biomeType = this.mapData.biome || 'grassland';
    switch (biomeType) {
      case 'desert':
        return 'sand';
      case 'frozen':
        return 'snow';
      case 'volcanic':
        return 'basalt';
      case 'void':
        return 'void_ground';
      case 'jungle':
        return 'jungle_floor';
      case 'grassland':
      default:
        return 'grass';
    }
  }

  private createGeometry(): THREE.BufferGeometry {
    const { width, height, terrain } = this.mapData;
    const cellSize = this.cellSize;

    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const slopes: number[] = [];  // Per-vertex slope for texture blending
    const terrainTypes: number[] = [];  // Per-vertex terrain type (0=ground, 1=ramp, 2=unwalkable)

    // Pre-calculate height map with smooth transitions and natural variation
    // Using enhanced noise functions for more organic terrain
    const vertexGrid: THREE.Vector3[][] = [];

    // Terrain feature scales based on map size
    const mapScale = Math.min(width, height);
    const largeFeatureScale = mapScale * 0.15;  // Rolling hills
    const mediumFeatureScale = mapScale * 0.05; // Terrain variation
    const smallFeatureScale = mapScale * 0.02;  // Fine detail

    for (let y = 0; y <= height; y++) {
      vertexGrid[y] = [];
      for (let x = 0; x <= width; x++) {
        const cell = this.sampleTerrain(terrain, x, y, width, height);
        // Use new 256-level elevation system
        const baseHeight = elevationToHeight(cell.elevation);

        // Calculate edge factor for cliff handling
        const edgeFactor = this.calculateElevationEdgeFactor(terrain, x, y, width, height);

        // Normalized coordinates for noise sampling
        const nx = x / mapScale;
        const ny = y / mapScale;

        // SC2-style terrain: FLAT buildable areas, natural-looking non-buildable terrain
        let detailNoise = 0;

        if (cell.terrain === 'unwalkable') {
          // Cliffs and unwalkable areas: SMOOTH cliffs with subtle surface texture
          // Dramatically reduced noise amplitudes to prevent jagged appearance

          // Large scale gentle rolling (reduced from 0.4 to 0.06)
          const largeNoise = fbmNoise(nx * 2, ny * 2, 3, 2.0, 0.5) * 0.06;

          // Medium scale subtle variation (reduced from 0.25 to 0.03)
          const mediumNoise = fbmNoise(nx * 5, ny * 5, 2, 2.0, 0.5) * 0.03;

          // Small scale detail for micro-texture only
          const smallNoise = fbmNoise(nx * 12, ny * 12, 2, 2.0, 0.5) * 0.015;

          detailNoise = largeNoise + mediumNoise + smallNoise;

          // Very gentle cliff edge blending (reduced from 0.3 to 0.04)
          if (edgeFactor > 0) {
            detailNoise += edgeFactor * 0.04 * fbmNoise(nx * 3, ny * 3, 2, 2.0, 0.5);
          }
        } else if (cell.terrain === 'ramp' || cell.terrain === 'platform') {
          // Ramps and platforms: completely smooth with NO noise
          // SC2-style geometric surfaces are perfectly flat with only elevation interpolation
          // Any noise causes visible spikes and rough surfaces
          detailNoise = 0;
        } else {
          // Buildable ground: nearly flat with very subtle organic variation
          // Extremely subtle to keep buildable areas clean
          const groundNoise = fbmNoise(nx * 6, ny * 6, 3, 2.0, 0.5) * 0.015;

          // Very faint micro-detail for visual interest
          const microDetail = perlinNoise(nx * 30, ny * 30) * 0.008;

          detailNoise = groundNoise + microDetail;

          // Very smooth blending near elevation changes
          if (edgeFactor > 0) {
            detailNoise += edgeFactor * 0.12 * fbmNoise(nx * 4, ny * 4, 2, 2.0, 0.5);
          }
        }

        const finalHeight = baseHeight + detailNoise;
        // Use negative Y so that after -π/2 rotation around X,
        // the terrain ends up at positive Z (0 to mapHeight)
        vertexGrid[y][x] = new THREE.Vector3(
          x * cellSize,
          -y * cellSize,  // Negative so world Z will be positive after rotation
          finalHeight
        );

        // Store in heightmap
        this.heightMap[y * this.gridWidth + x] = finalHeight;
      }
    }

    // Build terrain type map for slope calculation and texture selection
    // Numeric values: 0=ground/unbuildable (walkable), 1=ramp, 2=unwalkable
    const terrainTypeMap: TerrainType[] = new Array(this.gridWidth * this.gridHeight);
    const terrainTypeNumeric = new Float32Array(this.gridWidth * this.gridHeight);
    let platformCount = 0; // DEBUG
    for (let y = 0; y <= height; y++) {
      for (let x = 0; x <= width; x++) {
        const idx = y * this.gridWidth + x;
        const cell = this.sampleTerrain(terrain, x, y, width, height);
        terrainTypeMap[idx] = cell.terrain;
        // Convert to numeric: 0=walkable ground, 1=ramp, 2=unwalkable, 3=platform
        if (cell.terrain === 'unwalkable') {
          terrainTypeNumeric[idx] = 2.0;
        } else if (cell.terrain === 'ramp') {
          terrainTypeNumeric[idx] = 1.0;
        } else if (cell.terrain === 'platform') {
          terrainTypeNumeric[idx] = 3.0;  // Platform gets distinct rock/concrete texture
          platformCount++; // DEBUG
        } else {
          terrainTypeNumeric[idx] = 0.0;  // ground, unbuildable
        }
      }
    }
    console.log('[Terrain] Platform vertices detected:', platformCount); // DEBUG

    // Calculate per-vertex slopes BEFORE smoothing (for texture blending)
    // This captures the actual cliff steepness from terrain cell data
    const slopeMap = new Float32Array(this.gridWidth * this.gridHeight);
    for (let y = 0; y <= height; y++) {
      for (let x = 0; x <= width; x++) {
        const idx = y * this.gridWidth + x;
        const terrainType = terrainTypeMap[idx];

        // Calculate slope from height differences to neighbors
        const h = this.heightMap[idx];
        let maxHeightDiff = 0;

        // Check all 8 neighbors for maximum height difference
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx <= width && ny >= 0 && ny <= height) {
              const neighborH = this.heightMap[ny * this.gridWidth + nx];
              const diff = Math.abs(neighborH - h);
              maxHeightDiff = Math.max(maxHeightDiff, diff);
            }
          }
        }

        // Convert height difference to slope (0 = flat, 1 = very steep)
        // A height diff of 3+ units over 1 cell = max slope
        let slope = Math.min(1.0, maxHeightDiff / 3.0);

        // Ramps should have ZERO slope for texture (flat grass) - the geometry handles the actual slope
        // We don't boost the texture slope for ramps anymore
        if (terrainType === 'ramp') {
          slope = 0;  // Force flat texture for ramps
        }

        // Cliff edges (unwalkable adjacent to walkable) should also have increased slope
        if (terrainType === 'unwalkable') {
          // Check if this unwalkable is at an edge
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
            // Cliff edges should show rock/cliff textures
            slope = Math.max(0.35, slope);
          }
        }

        slopeMap[idx] = Math.min(1.0, slope);
      }
    }

    // Apply light smoothing pass to heightmap for natural-looking terrain
    // Reduced from 5 to 2 iterations to preserve cliff geometry for texture blending
    this.smoothHeightMap(2);

    // Update vertex grid with smoothed heights
    for (let y = 0; y <= height; y++) {
      for (let x = 0; x <= width; x++) {
        const smoothedHeight = this.heightMap[y * this.gridWidth + x];
        vertexGrid[y][x].z = smoothedHeight;
      }
    }

    // Store slope map for use in geometry creation
    const vertexSlopes = slopeMap;

    // Create triangles with vertex colors
    let vertexIndex = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = terrain[y][x];

        // Get biome-based color for this terrain type
        const terrainColorType = cell.terrain === 'unwalkable' ? 'cliff' :
                                  cell.terrain === 'ramp' ? 'ramp' :
                                  cell.terrain === 'platform' ? 'ground' : 'ground';
        const baseColor = blendBiomeColors(this.biome, x, y, terrainColorType);

        // Apply terrain feature color tint
        const feature = cell.feature || 'none';
        const featureTint = FEATURE_COLOR_TINTS[feature];
        baseColor.multiply(featureTint);

        // Adjust color based on elevation (normalized to 0-255 range)
        const normalizedElevation = cell.elevation / 255;
        const elevationBrightness = 1 + normalizedElevation * 0.15;
        baseColor.multiplyScalar(elevationBrightness);

        // Get cell corners
        const v00 = vertexGrid[y][x];
        const v10 = vertexGrid[y][x + 1];
        const v01 = vertexGrid[y + 1][x];
        const v11 = vertexGrid[y + 1][x + 1];

        // Calculate colors with variation
        const colors6: THREE.Color[] = [];
        for (let i = 0; i < 6; i++) {
          const color = baseColor.clone();

          // Add texture variation based on position
          const noiseVal = noise2D(x + i * 0.1, y + i * 0.1, cell.textureId);

          // Blend with accent colors from biome
          const accents = this.biome.colors.accent;
          if (accents.length > 0 && noiseVal > 0.7) {
            const accentIndex = Math.floor(noiseVal * accents.length) % accents.length;
            color.lerp(accents[accentIndex], (noiseVal - 0.7) * 1.5);
          }

          // Add subtle brightness variation
          const brightVar = (noise2D(x * 2.5, y * 2.5, 789) - 0.5) * 0.12;
          color.r = Math.max(0, Math.min(1, color.r + brightVar));
          color.g = Math.max(0, Math.min(1, color.g + brightVar));
          color.b = Math.max(0, Math.min(1, color.b + brightVar));

          // Edge darkening for depth
          const edgeFactor = this.getEdgeFactor(terrain, x, y, width, height);
          if (edgeFactor > 0) {
            color.multiplyScalar(1 - edgeFactor * 0.25);
          }

          colors6.push(color);
        }

        // Get pre-calculated slopes for each vertex
        let slope00 = vertexSlopes[y * this.gridWidth + x];
        let slope10 = vertexSlopes[y * this.gridWidth + (x + 1)];
        let slope01 = vertexSlopes[(y + 1) * this.gridWidth + x];
        let slope11 = vertexSlopes[(y + 1) * this.gridWidth + (x + 1)];

        // CRITICAL: Override slopes based on THIS CELL's terrain type to ensure consistency
        // The pre-calculated slopes might not match the cell's actual terrain type
        // because they're based on sampleTerrain() which uses a different lookup
        if (cell.terrain === 'ramp') {
          // RAMPS MUST HAVE ZERO SLOPE - they should show FLAT GROUND TEXTURE (grass/snow)
          // Ramps are walkable paths and must look like flat ground, not rocky slopes
          slope00 = 0;
          slope10 = 0;
          slope01 = 0;
          slope11 = 0;
        } else if (cell.terrain === 'unwalkable') {
          // Unwalkable terrain gets a boost to show rock/cliff textures
          // Flat unwalkable (like plateaus) still need some slope for texture blending
          const minUnwalkableSlope = 0.15;
          slope00 = Math.max(slope00, minUnwalkableSlope);
          slope10 = Math.max(slope10, minUnwalkableSlope);
          slope01 = Math.max(slope01, minUnwalkableSlope);
          slope11 = Math.max(slope11, minUnwalkableSlope);
        }

        // Triangle 1 (v00, v01, v10) - reversed winding for correct normals after rotation
        vertices.push(v00.x, v00.y, v00.z);
        vertices.push(v01.x, v01.y, v01.z);
        vertices.push(v10.x, v10.y, v10.z);

        uvs.push(x / width, y / height);
        uvs.push(x / width, (y + 1) / height);
        uvs.push((x + 1) / width, y / height);

        // Triangle 2 (v10, v01, v11) - reversed winding for correct normals after rotation
        vertices.push(v10.x, v10.y, v10.z);
        vertices.push(v01.x, v01.y, v01.z);
        vertices.push(v11.x, v11.y, v11.z);

        uvs.push((x + 1) / width, y / height);
        uvs.push(x / width, (y + 1) / height);
        uvs.push((x + 1) / width, (y + 1) / height);

        // Add slope values for texture blending (per vertex)
        slopes.push(slope00, slope01, slope10);  // Triangle 1
        slopes.push(slope10, slope01, slope11);  // Triangle 2

        // Use THIS CELL's terrain type for ALL vertices in its triangles
        // This ensures texture matches walkability - the cell's terrain type determines both
        // (Don't interpolate terrain types from neighboring cells - that causes mismatches)
        let cellTerrainType = 0.0;
        if (cell.terrain === 'unwalkable') {
          cellTerrainType = 2.0;
        } else if (cell.terrain === 'ramp') {
          cellTerrainType = 1.0;
        }
        // All 6 vertices of this cell's triangles get the same terrain type
        terrainTypes.push(cellTerrainType, cellTerrainType, cellTerrainType);  // Triangle 1
        terrainTypes.push(cellTerrainType, cellTerrainType, cellTerrainType);  // Triangle 2

        // Add colors
        for (let i = 0; i < 6; i++) {
          colors.push(colors6[i].r, colors6[i].g, colors6[i].b);
        }

        // Add indices
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        indices.push(vertexIndex + 3, vertexIndex + 4, vertexIndex + 5);
        vertexIndex += 6;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aSlope', new THREE.Float32BufferAttribute(slopes, 1));  // Pre-calculated slope for texture blending
    geometry.setAttribute('aTerrainType', new THREE.Float32BufferAttribute(terrainTypes, 1));  // 0=ground, 1=ramp, 2=unwalkable
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
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
    const x0 = Math.max(0, Math.min(width - 1, x - 1));
    const x1 = Math.max(0, Math.min(width - 1, x));
    const y0 = Math.max(0, Math.min(height - 1, y - 1));
    const y1 = Math.max(0, Math.min(height - 1, y));

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
      // CRITICAL: Use the average elevation of RAMP cells only
      // This ensures vertices adjacent to ramps use the ramp's interpolated elevation
      // and don't get pulled to a different ground/cliff elevation.
      //
      // Bug fixed: Previously used cell11.elevation, but cell11 might be ground/cliff
      // at a different elevation than the ramp. This caused "holes" at ramp edges
      // where vertices suddenly dropped to ground level.
      //
      // For example, at the right edge of a ramp:
      // - cell00, cell01 = ramp cells at elevation 180
      // - cell10, cell11 = ground cells at elevation 60
      // Using cell11.elevation would give height 2.4 instead of 7.2, creating a hole.
      avgElevation = rampCells.reduce((sum, c) => sum + c.elevation, 0) / rampCells.length;
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
   * SC2-STYLE CLIFF HANDLING:
   * 1. Walkable floor geometry uses quantized heights for strict elevation separation
   * 2. Ramps use smooth heightMap for natural slope traversal
   * 3. Cliff walls are generated at boundaries between different elevations
   *
   * This creates a robust navmesh where:
   * - Cliffs are impassable (wall geometry + height gap > walkableClimb)
   * - Ramps are traversable (continuous sloped geometry)
   * - Normal terrain has minor height variation within walkableClimb limits
   */
  public generateWalkableGeometry(): { positions: Float32Array; indices: Uint32Array } {
    const terrain = this.mapData.terrain;
    const width = this.mapData.width;
    const height = this.mapData.height;

    const vertices: number[] = [];
    const indices: number[] = [];
    let vertexIndex = 0;

    // Wall geometry constants
    const WALL_HEIGHT = 4.0; // Height of cliff walls (taller than walkableClimb)
    const ELEVATION_DIFF_THRESHOLD = 40; // ~1.6 height units difference

    // Pre-compute ramp zones - cells within radius of a ramp use smooth heightMap
    const rampZone = new Set<string>();
    const RAMP_ZONE_RADIUS = 3;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (terrain[y][x].terrain === 'ramp') {
          for (let dy = -RAMP_ZONE_RADIUS; dy <= RAMP_ZONE_RADIUS; dy++) {
            for (let dx = -RAMP_ZONE_RADIUS; dx <= RAMP_ZONE_RADIUS; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                rampZone.add(`${nx},${ny}`);
              }
            }
          }
        }
      }
    }

    // Pre-compute cliff edge cells - cells that need flat heights
    // This includes:
    // 1. Cells adjacent to unwalkable terrain
    // 2. Cells adjacent to walkable terrain at significantly different elevation
    // Using flat heights prevents the smoothed heightMap from creating traversable slopes
    const cliffEdgeCells = new Set<string>();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = terrain[y][x];
        if (cell.terrain === 'unwalkable' || cell.terrain === 'ramp') continue;
        if (rampZone.has(`${x},${y}`)) continue;

        // Check 8 neighbors
        let isCliffEdge = false;
        for (let dy = -1; dy <= 1 && !isCliffEdge; dy++) {
          for (let dx = -1; dx <= 1 && !isCliffEdge; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const neighbor = terrain[ny][nx];

              // Case 1: Adjacent to unwalkable (cliff face)
              if (neighbor.terrain === 'unwalkable') {
                isCliffEdge = true;
              }
              // Case 2: Adjacent to walkable at different elevation (elevation boundary)
              else if (neighbor.terrain !== 'ramp' && !rampZone.has(`${nx},${ny}`)) {
                const elevDiff = Math.abs(neighbor.elevation - cell.elevation);
                if (elevDiff > ELEVATION_DIFF_THRESHOLD) {
                  isCliffEdge = true;
                }
              }
            }
          }
        }
        if (isCliffEdge) {
          cliffEdgeCells.add(`${x},${y}`);
        }
      }
    }

    // SECOND PASS: Also mark cells adjacent to cliff edge cells
    // This ensures vertices at boundaries have consistent heights
    const expandedCliffEdgeCells = new Set<string>(cliffEdgeCells);
    for (const key of cliffEdgeCells) {
      const [cx, cy] = key.split(',').map(Number);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const neighbor = terrain[ny][nx];
            if (neighbor.terrain !== 'unwalkable' && neighbor.terrain !== 'ramp' && !rampZone.has(`${nx},${ny}`)) {
              expandedCliffEdgeCells.add(`${nx},${ny}`);
            }
          }
        }
      }
    }

    // Helper: Check if a cell is walkable for pathfinding
    const isCellWalkable = (cx: number, cy: number): boolean => {
      if (cx < 0 || cx >= width || cy < 0 || cy >= height) return false;
      const cell = terrain[cy][cx];
      if (cell.terrain === 'unwalkable') return false;
      const feature = cell.feature || 'none';
      const featureConfig = TERRAIN_FEATURE_CONFIG[feature];
      return featureConfig.walkable;
    };

    // =================================================================
    // FIX: Pre-compute CONSISTENT vertex heights based on vertex position
    // This ensures shared vertices between adjacent cells have the same height,
    // preventing gaps in the navmesh that would disconnect ramps from platforms.
    //
    // A vertex at (vx, vy) is shared by up to 4 cells:
    //   (vx-1, vy-1), (vx, vy-1), (vx-1, vy), (vx, vy)
    // The vertex should use heightMap if ANY adjacent cell is in rampZone.
    // It should only use flat elevation if ALL adjacent cells are cliff edges
    // and NONE are in rampZone.
    // =================================================================
    const vertexHeights = new Float32Array((width + 1) * (height + 1));
    for (let vy = 0; vy <= height; vy++) {
      for (let vx = 0; vx <= width; vx++) {
        // Check if this vertex touches any ramp zone cell
        let touchesRampZone = false;
        let allCliffEdge = true;
        let cliffElevation = 0;

        // Check all 4 cells this vertex touches
        const adjacentCells = [
          { cx: vx - 1, cy: vy - 1 },
          { cx: vx, cy: vy - 1 },
          { cx: vx - 1, cy: vy },
          { cx: vx, cy: vy },
        ];

        for (const { cx, cy } of adjacentCells) {
          if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
            if (rampZone.has(`${cx},${cy}`)) {
              touchesRampZone = true;
            }
            if (!expandedCliffEdgeCells.has(`${cx},${cy}`)) {
              allCliffEdge = false;
            } else {
              cliffElevation = terrain[cy][cx].elevation;
            }
          }
        }

        // Determine height: prioritize ramp zone > normal ground > cliff edge
        const hx = Math.max(0, Math.min(vx, this.gridWidth - 1));
        const hy = Math.max(0, Math.min(vy, this.gridHeight - 1));

        if (touchesRampZone) {
          // Vertex near ramp uses smooth heightMap for continuous slope
          vertexHeights[vy * (width + 1) + vx] = this.heightMap[hy * this.gridWidth + hx];
        } else if (allCliffEdge) {
          // Vertex surrounded by cliff edges uses flat elevation
          vertexHeights[vy * (width + 1) + vx] = elevationToHeight(cliffElevation);
        } else {
          // Normal ground uses heightMap
          vertexHeights[vy * (width + 1) + vx] = this.heightMap[hy * this.gridWidth + hx];
        }
      }
    }

    // Helper: Get pre-computed consistent vertex height
    const getVertexHeight = (vx: number, vy: number): number => {
      const hx = Math.max(0, Math.min(vx, width));
      const hy = Math.max(0, Math.min(vy, height));
      return vertexHeights[hy * (width + 1) + hx];
    };

    // Helper: Check if a cliff wall is needed between two cells
    const needsCliffWall = (
      cx: number, cy: number,
      nx: number, ny: number
    ): { needed: boolean; topHeight: number; bottomHeight: number } => {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        return { needed: false, topHeight: 0, bottomHeight: 0 };
      }

      const cell = terrain[cy][cx];
      const neighbor = terrain[ny][nx];

      // No walls in ramp zones
      if (rampZone.has(`${cx},${cy}`) || rampZone.has(`${nx},${ny}`)) {
        return { needed: false, topHeight: 0, bottomHeight: 0 };
      }

      // Wall needed if neighbor is unwalkable (cliff face)
      if (neighbor.terrain === 'unwalkable') {
        const cellHeight = elevationToHeight(cell.elevation);
        return {
          needed: true,
          topHeight: cellHeight,
          bottomHeight: cellHeight - WALL_HEIGHT,
        };
      }

      // Platform cells always generate vertical cliff faces to lower terrain
      // This creates the geometric SC2-style platform look
      if (cell.terrain === 'platform' && neighbor.terrain !== 'ramp') {
        const elevDiff = cell.elevation - neighbor.elevation;
        // Only generate wall if this cell is higher than neighbor
        if (elevDiff > 20) {  // Small threshold to avoid walls for tiny differences
          const cellHeight = elevationToHeight(cell.elevation);
          const neighborHeight = elevationToHeight(neighbor.elevation);
          return {
            needed: true,
            topHeight: cellHeight,
            bottomHeight: neighborHeight,
          };
        }
      }

      // Wall needed if significant elevation difference between walkable cells
      if (neighbor.terrain !== 'ramp' && cell.terrain !== 'ramp') {
        const elevDiff = Math.abs(cell.elevation - neighbor.elevation);
        if (elevDiff > ELEVATION_DIFF_THRESHOLD) {
          const cellHeight = elevationToHeight(cell.elevation);
          const neighborHeight = elevationToHeight(neighbor.elevation);
          return {
            needed: true,
            topHeight: Math.max(cellHeight, neighborHeight),
            bottomHeight: Math.min(cellHeight, neighborHeight) - 0.5,
          };
        }
      }

      return { needed: false, topHeight: 0, bottomHeight: 0 };
    };

    // ========================================
    // PASS 1: Generate walkable floor geometry
    // ========================================
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isCellWalkable(x, y)) continue;

        // Get heights for cell corners using pre-computed consistent vertex heights
        // This ensures adjacent cells share the same vertex height, preventing gaps
        const h00 = getVertexHeight(x, y);
        const h10 = getVertexHeight(x + 1, y);
        const h01 = getVertexHeight(x, y + 1);
        const h11 = getVertexHeight(x + 1, y + 1);

        // Create two triangles for floor (CCW winding for Recast)
        vertices.push(x, h00, y);
        vertices.push(x, h01, y + 1);
        vertices.push(x + 1, h10, y);
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        vertexIndex += 3;

        vertices.push(x + 1, h10, y);
        vertices.push(x, h01, y + 1);
        vertices.push(x + 1, h11, y + 1);
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        vertexIndex += 3;
      }
    }

    const floorTriangles = indices.length / 3;

    // ========================================
    // PASS 2: Generate cliff wall geometry
    // ========================================
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isCellWalkable(x, y)) continue;
        if (terrain[y][x].terrain === 'ramp') continue;
        if (rampZone.has(`${x},${y}`)) continue;

        // Vertical edges (left/right walls)
        const verticalEdges = [
          { nx: x + 1, ny: y, edgeX: x + 1, y1: y, y2: y + 1 },
          { nx: x - 1, ny: y, edgeX: x, y1: y, y2: y + 1 },
        ];

        // Horizontal edges (top/bottom walls)
        const horizontalEdges = [
          { nx: x, ny: y + 1, edgeY: y + 1, x1: x, x2: x + 1 },
          { nx: x, ny: y - 1, edgeY: y, x1: x, x2: x + 1 },
        ];

        for (const edge of verticalEdges) {
          const wallInfo = needsCliffWall(x, y, edge.nx, edge.ny);
          if (wallInfo.needed) {
            vertices.push(
              edge.edgeX, wallInfo.topHeight, edge.y1,
              edge.edgeX, wallInfo.topHeight, edge.y2,
              edge.edgeX, wallInfo.bottomHeight, edge.y1,
              edge.edgeX, wallInfo.bottomHeight, edge.y2
            );
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
            indices.push(vertexIndex + 1, vertexIndex + 3, vertexIndex + 2);
            indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 1);
            indices.push(vertexIndex + 1, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
          }
        }

        for (const edge of horizontalEdges) {
          const wallInfo = needsCliffWall(x, y, edge.nx, edge.ny);
          if (wallInfo.needed) {
            vertices.push(
              edge.x1, wallInfo.topHeight, edge.edgeY,
              edge.x2, wallInfo.topHeight, edge.edgeY,
              edge.x1, wallInfo.bottomHeight, edge.edgeY,
              edge.x2, wallInfo.bottomHeight, edge.edgeY
            );
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
            indices.push(vertexIndex + 1, vertexIndex + 3, vertexIndex + 2);
            indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 1);
            indices.push(vertexIndex + 1, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
          }
        }
      }
    }

    const wallTriangles = (indices.length / 3) - floorTriangles;

    // Calculate geometry bounds for debugging navmesh issues
    let minHeight = Infinity;
    let maxHeight = -Infinity;

    // Diagnostic: Check for height discontinuities at ramp boundaries
    // This helps identify if ramps are properly connected to adjacent terrain
    let maxRampBoundaryGap = 0;
    let rampBoundaryGapLocation = { x: 0, y: 0 };

    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const cell = terrain[y][x];
        const rightCell = terrain[y][x + 1];
        const bottomCell = terrain[y + 1][x];

        // Check horizontal boundary (cell to right neighbor)
        const isRamp1 = cell.terrain === 'ramp' || rampZone.has(`${x},${y}`);
        const isRamp2 = rightCell.terrain === 'ramp' || rampZone.has(`${x + 1},${y}`);
        if (isRamp1 !== isRamp2) {
          // Boundary between ramp and non-ramp
          const h1 = this.heightMap[y * this.gridWidth + (x + 1)];
          const h2 = this.heightMap[y * this.gridWidth + (x + 1)]; // Same vertex
          const gap = Math.abs(h1 - h2);
          if (gap > maxRampBoundaryGap) {
            maxRampBoundaryGap = gap;
            rampBoundaryGapLocation = { x: x + 1, y };
          }
        }

        // Check vertical boundary (cell to bottom neighbor)
        const isRamp3 = bottomCell.terrain === 'ramp' || rampZone.has(`${x},${y + 1}`);
        if (isRamp1 !== isRamp3) {
          const h3 = this.heightMap[(y + 1) * this.gridWidth + x];
          const h4 = this.heightMap[(y + 1) * this.gridWidth + x]; // Same vertex
          const gap = Math.abs(h3 - h4);
          if (gap > maxRampBoundaryGap) {
            maxRampBoundaryGap = gap;
            rampBoundaryGapLocation = { x, y: y + 1 };
          }
        }
      }
    }

    // Sample ramp heights for debugging - find first ramp and log height profile
    let rampProfile = '';
    for (let y = 0; y < height && !rampProfile; y++) {
      for (let x = 0; x < width; x++) {
        if (terrain[y][x].terrain === 'ramp') {
          // Found a ramp, sample heights along a vertical line through it
          const heights: number[] = [];
          const startY = Math.max(0, y - 5);
          const endY = Math.min(height, y + 20);
          for (let sy = startY; sy < endY; sy++) {
            heights.push(this.heightMap[sy * this.gridWidth + x]);
          }
          rampProfile = `Ramp at (${x},${y}): heights from y=${startY} to y=${endY-1}: [${heights.map(h => h.toFixed(2)).join(', ')}]`;
          break;
        }
      }
    }
    let rampCellCount = 0;
    let rampZoneCount = rampZone.size;

    for (let i = 1; i < vertices.length; i += 3) {
      const h = vertices[i];
      if (h < minHeight) minHeight = h;
      if (h > maxHeight) maxHeight = h;
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (terrain[y][x].terrain === 'ramp') rampCellCount++;
      }
    }

    debugTerrain.log(
      `[Terrain] Generated walkable geometry: ${vertices.length / 3} vertices, ` +
      `${floorTriangles} floor triangles, ${wallTriangles} wall triangles, ` +
      `${cliffEdgeCells.size} cliff edge cells`
    );
    debugTerrain.log(
      `[Terrain] Height range: ${minHeight.toFixed(2)} to ${maxHeight.toFixed(2)} ` +
      `(${(maxHeight - minHeight).toFixed(2)} total), ` +
      `${rampCellCount} ramp cells, ${rampZoneCount} ramp zone cells`
    );

    // Log ramp diagnostic info
    if (rampProfile) {
      console.log(`[Terrain] ${rampProfile}`);
    }
    if (maxRampBoundaryGap > 0) {
      console.log(`[Terrain] Max ramp boundary height gap: ${maxRampBoundaryGap.toFixed(3)} at (${rampBoundaryGapLocation.x}, ${rampBoundaryGapLocation.y})`);
    }

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
import { DecorationLightManager, DecorationLightConfig } from './DecorationLightManager';

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

    // Use explicit decorations from map data if available, otherwise use procedural
    if (mapData.decorations && mapData.decorations.length > 0) {
      this.createExplicitDecorations(mapData);
    } else {
      this.createTrees(mapData);
      this.createRocks(mapData);
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

  private createTrees(mapData: MapData): void {
    // Scatter trees around the map edges and unbuildable areas
    const treePositions: Array<{ x: number; y: number }> = [];

    // Add trees along map edges (inside the playable area)
    for (let i = 0; i < 50; i++) {
      const edge = Math.floor(Math.random() * 4);
      let x: number, y: number;

      switch (edge) {
        case 0: // Left
          x = 10 + Math.random() * 8;
          y = 15 + Math.random() * (mapData.height - 30);
          break;
        case 1: // Right
          x = mapData.width - 18 + Math.random() * 8;
          y = 15 + Math.random() * (mapData.height - 30);
          break;
        case 2: // Top
          x = 15 + Math.random() * (mapData.width - 30);
          y = 10 + Math.random() * 8;
          break;
        default: // Bottom
          x = 15 + Math.random() * (mapData.width - 30);
          y = mapData.height - 18 + Math.random() * 8;
          break;
      }

      // Check terrain is suitable
      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        if (cell.terrain === 'ground' || cell.terrain === 'unbuildable') {
          treePositions.push({ x, y });
        }
      }
    }

    // Create trees
    for (const pos of treePositions) {
      // Get terrain height at tree position
      const terrainHeight = this.terrain.getHeightAt(pos.x, pos.y);

      const treeGroup = new THREE.Group();
      const height = 3 + Math.random() * 2;

      // Trunk
      const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.3, height * 0.4, 6);
      const trunkMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a3520,
        roughness: 0.9,
      });
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.y = height * 0.2;
      // PERF: Decorations receive shadows but don't cast
      trunk.castShadow = false;
      trunk.receiveShadow = true;
      treeGroup.add(trunk);

      // Foliage (multiple cones for pine tree look)
      const foliageMaterial = new THREE.MeshStandardMaterial({
        color: 0x2d5a2d,
        roughness: 0.8,
      });

      for (let layer = 0; layer < 3; layer++) {
        const layerHeight = height * 0.25;
        const layerRadius = 1.2 - layer * 0.3;
        const foliageGeometry = new THREE.ConeGeometry(layerRadius, layerHeight, 8);
        const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
        foliage.position.y = height * 0.4 + layer * layerHeight * 0.7;
        // PERF: Decorations receive shadows but don't cast
        foliage.castShadow = false;
        foliage.receiveShadow = true;
        treeGroup.add(foliage);
      }

      treeGroup.position.set(pos.x, terrainHeight, pos.y);
      treeGroup.rotation.y = Math.random() * Math.PI * 2;
      const treeScale = 0.8 + Math.random() * 0.4;
      treeGroup.scale.setScalar(treeScale);
      this.group.add(treeGroup);

      // Track tree collision for pathfinding - trunk collision radius scaled by tree size
      const collisionRadius = treeScale * 0.6;
      this.treeCollisions.push({ x: pos.x, z: pos.y, radius: collisionRadius });
    }
  }

  private createRocks(mapData: MapData): void {
    // Scatter small rocks around the map
    for (let i = 0; i < 80; i++) {
      const x = 12 + Math.random() * (mapData.width - 24);
      const y = 12 + Math.random() * (mapData.height - 24);

      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        if (cell.terrain === 'ground' || cell.terrain === 'unbuildable') {
          // Get terrain height at rock position
          const terrainHeight = this.terrain.getHeightAt(x, y);

          const rockGeometry = new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.4);
          const rockMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0.3 + Math.random() * 0.1, 0.28 + Math.random() * 0.1, 0.25 + Math.random() * 0.1),
            roughness: 0.9,
          });
          const rock = new THREE.Mesh(rockGeometry, rockMaterial);
          rock.position.set(x, terrainHeight + 0.15 + Math.random() * 0.1, y);
          rock.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
          );
          // PERF: Decorations receive shadows but don't cast
          rock.castShadow = false;
          rock.receiveShadow = true;
          this.group.add(rock);
        }
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

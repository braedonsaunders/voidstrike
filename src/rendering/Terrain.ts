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

export class Terrain {
  public mesh: THREE.Mesh;
  public mapData: MapData;
  public biome: BiomeConfig;

  private cellSize: number;
  private geometry: THREE.BufferGeometry;
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

    this.geometry = this.createGeometry();

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

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.rotation.x = -Math.PI / 2;
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
        } else if (cell.terrain === 'ramp') {
          // Ramps: very smooth gradient with minimal variation
          // Only subtle noise to make ramps feel natural
          const rampNoise = fbmNoise(nx * 4, ny * 4, 2, 2.0, 0.5) * 0.04;
          detailNoise = rampNoise;

          // Gentle edge blending to nearby elevations
          if (edgeFactor > 0) {
            detailNoise += edgeFactor * 0.2;
          }
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
    for (let y = 0; y <= height; y++) {
      for (let x = 0; x <= width; x++) {
        const idx = y * this.gridWidth + x;
        const cell = this.sampleTerrain(terrain, x, y, width, height);
        terrainTypeMap[idx] = cell.terrain;
        // Convert to numeric: 0=walkable ground, 1=ramp, 2=unwalkable
        if (cell.terrain === 'unwalkable') {
          terrainTypeNumeric[idx] = 2.0;
        } else if (cell.terrain === 'ramp') {
          terrainTypeNumeric[idx] = 1.0;
        } else {
          terrainTypeNumeric[idx] = 0.0;  // ground, unbuildable
        }
      }
    }

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
                if (neighborType === 'ground' || neighborType === 'ramp' || neighborType === 'unbuildable') {
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
                                  cell.terrain === 'ramp' ? 'ramp' : 'ground';
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

    let avgElevation: number;

    if (hasRamp) {
      // RAMP FIX: Use the PRIMARY CELL's elevation directly - DO NOT AVERAGE
      // Each ramp cell has its own elevation in the gradient (set by createRampInTerrain)
      // Averaging would flatten the slope into a flat step
      // The primary cell (cell11) is at position (x,y) which is where this vertex belongs
      avgElevation = cell11.elevation;
    } else {
      // No ramps - use simple average elevation
      avgElevation = (cell00.elevation + cell10.elevation + cell01.elevation + cell11.elevation) / 4;
    }

    // Use the PRIMARY CELL's terrain type directly - this ensures texture matches walkability
    // A vertex at (x,y) corresponds to cell at (x,y) for pathfinding, so use that cell's type
    // This prevents cliff textures from bleeding onto walkable ground at edges
    return {
      terrain: cell11.terrain,
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
   * IMPORTANT: Skips ramp cells to preserve their clean linear gradient
   */
  private smoothHeightMap(iterations: number = 1): void {
    const { width, height, terrain } = this.mapData;
    const temp = new Float32Array(this.heightMap.length);

    // Helper to check if a vertex touches a ramp cell
    const isRampVertex = (vx: number, vy: number): boolean => {
      // A vertex at (vx, vy) touches up to 4 cells
      const cellCoords = [
        { cx: vx - 1, cy: vy - 1 },
        { cx: vx, cy: vy - 1 },
        { cx: vx - 1, cy: vy },
        { cx: vx, cy: vy },
      ];
      for (const { cx, cy } of cellCoords) {
        if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
          if (terrain[cy][cx].terrain === 'ramp') {
            return true;
          }
        }
      }
      return false;
    };

    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 0; y <= height; y++) {
        for (let x = 0; x <= width; x++) {
          const idx = y * this.gridWidth + x;

          // SKIP RAMP VERTICES - preserve their exact calculated heights
          // This ensures ramps stay as clean linear slopes, not smoothed flat steps
          if (isRampVertex(x, y)) {
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
    this.geometry.dispose();
    if (this.tslMaterial) {
      this.tslMaterial.dispose();
    } else {
      this.material.dispose();
    }
  }

  /**
   * Generate walkable geometry for navmesh generation.
   * Returns only triangles from walkable terrain (ground and ramps).
   * Used by recast-navigation for navmesh generation.
   */
  public generateWalkableGeometry(): { positions: Float32Array; indices: Uint32Array } {
    const terrain = this.mapData.terrain;
    const width = this.mapData.width;
    const height = this.mapData.height;

    const walkableVertices: number[] = [];
    const walkableIndices: number[] = [];
    let vertexIndex = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = terrain[y][x];

        // Only include walkable terrain (ground and ramps)
        if (cell.terrain === 'unwalkable') continue;

        // Check terrain features that make cells unwalkable
        const feature = cell.feature || 'none';
        const featureConfig = TERRAIN_FEATURE_CONFIG[feature];
        if (!featureConfig.walkable) continue;

        // Get heights at the 4 corners of this cell
        const h00 = this.heightMap[y * this.gridWidth + x];
        const h10 = this.heightMap[y * this.gridWidth + (x + 1)];
        const h01 = this.heightMap[(y + 1) * this.gridWidth + x];
        const h11 = this.heightMap[(y + 1) * this.gridWidth + (x + 1)];

        // Create two triangles for this cell
        // Triangle 1: (x,y), (x+1,y), (x,y+1)
        walkableVertices.push(x, h00, y);        // Note: y becomes z for navmesh
        walkableVertices.push(x + 1, h10, y);
        walkableVertices.push(x, h01, y + 1);

        walkableIndices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        vertexIndex += 3;

        // Triangle 2: (x+1,y), (x+1,y+1), (x,y+1)
        walkableVertices.push(x + 1, h10, y);
        walkableVertices.push(x + 1, h11, y + 1);
        walkableVertices.push(x, h01, y + 1);

        walkableIndices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        vertexIndex += 3;
      }
    }

    debugTerrain.log(
      `[Terrain] Generated walkable geometry: ${walkableVertices.length / 3} vertices, ${walkableIndices.length / 3} triangles`
    );

    return {
      positions: new Float32Array(walkableVertices),
      indices: new Uint32Array(walkableIndices),
    };
  }

  /**
   * Create a Three.js mesh from walkable geometry (for debugging)
   */
  public createWalkableMesh(): THREE.Mesh {
    const { positions, indices } = this.generateWalkableGeometry();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
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

// Decorative elements (watch towers, destructible rocks, trees, etc.)
export class MapDecorations {
  public group: THREE.Group;
  private terrain: Terrain;
  // Track rock positions for pathfinding collision
  private rockCollisions: Array<{ x: number; z: number; radius: number }> = [];

  constructor(mapData: MapData, terrain: Terrain) {
    this.group = new THREE.Group();
    this.terrain = terrain;
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
   * Get rock collision data for pathfinding
   */
  public getRockCollisions(): Array<{ x: number; z: number; radius: number }> {
    return this.rockCollisions;
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

      // Create more detailed rock formation
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
      mainRock.castShadow = true;
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
        smallRock.castShadow = true;
        smallRock.receiveShadow = true;
        rockGroup.add(smallRock);
      }

      rockGroup.position.set(rock.x, terrainHeight, rock.y);
      this.group.add(rockGroup);
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
      trunk.castShadow = true;
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
        foliage.castShadow = true;
        foliage.receiveShadow = true;
        treeGroup.add(foliage);
      }

      treeGroup.position.set(pos.x, terrainHeight, pos.y);
      treeGroup.rotation.y = Math.random() * Math.PI * 2;
      treeGroup.scale.setScalar(0.8 + Math.random() * 0.4);
      this.group.add(treeGroup);
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
          rock.castShadow = true;
          rock.receiveShadow = true;
          this.group.add(rock);
        }
      }
    }
  }

  public dispose(): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}

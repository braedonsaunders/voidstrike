/**
 * TSL Terrain Material
 *
 * WebGPU-compatible terrain material with 4-texture blending.
 * Features:
 * - Slope-based texture blending with noise variation
 * - Dual-scale texture sampling to reduce tiling artifacts
 * - Height-based color variation
 * - Triplanar-inspired blending for cliffs
 * - Proper normal map blending
 */

import * as THREE from 'three';
import {
  Fn,
  vec4,
  float,
  uniform,
  texture,
  uv,
  smoothstep,
  normalize,
  clamp,
  attribute,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { BiomeType } from '@/rendering/Biomes';

export interface TSLTerrainConfig {
  biome: BiomeType;
  mapWidth: number;
  mapHeight: number;
  textureRepeat?: number;
}

/**
 * Get texture prefixes for a biome
 */
function getBiomeTextures(biome: BiomeType): {
  grass: string;
  dirt: string;
  rock: string;
  cliff: string;
  platform: string | null; // null = use procedural fallback
} {
  switch (biome) {
    case 'desert':
      return {
        grass: 'sand',
        dirt: 'desert_dirt',
        rock: 'rock',
        cliff: 'desert_cliff',
        platform: null, // Will use procedural concrete
      };
    case 'frozen':
      return {
        grass: 'snow',
        dirt: 'ice_rock',
        rock: 'ice_rock',
        cliff: 'ice_cliff',
        platform: null,
      };
    case 'volcanic':
      return {
        grass: 'ash',
        dirt: 'basalt',
        rock: 'basalt',
        cliff: 'volcanic_cliff',
        platform: null,
      };
    case 'void':
      return {
        grass: 'void_ground',
        dirt: 'void_rock',
        rock: 'void_rock',
        cliff: 'void_cliff',
        platform: null,
      };
    case 'jungle':
      return {
        grass: 'jungle_floor',
        dirt: 'dirt',
        rock: 'mossy_rock',
        cliff: 'jungle_cliff',
        platform: null,
      };
    case 'grassland':
    default:
      return {
        grass: 'grass',
        dirt: 'dirt',
        rock: 'rock',
        cliff: 'cliff',
        platform: null, // Will use procedural concrete
      };
  }
}

/**
 * Create a procedural concrete/metal texture for platforms
 * Returns a canvas-based texture with industrial appearance
 */
function createProceduralPlatformTexture(
  type: 'diffuse' | 'normal' | 'roughness',
  size: number = 512
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  if (type === 'diffuse') {
    // Concrete/metal gray base with subtle variation
    ctx.fillStyle = '#6a6a6a';
    ctx.fillRect(0, 0, size, size);

    // Add subtle noise/grain
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 20;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));     // R
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise)); // G
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise)); // B
    }
    ctx.putImageData(imageData, 0, 0);

    // Add grid lines (subtle panel seams)
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 2;
    const gridSize = size / 4;
    for (let x = gridSize; x < size; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let y = gridSize; y < size; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }

  } else if (type === 'normal') {
    // Flat normal map with subtle surface detail
    ctx.fillStyle = '#8080ff'; // Neutral normal (pointing up)
    ctx.fillRect(0, 0, size, size);

    // Add very subtle variation for surface interest
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noiseX = (Math.random() - 0.5) * 8;
      const noiseY = (Math.random() - 0.5) * 8;
      data[i] = Math.max(0, Math.min(255, 128 + noiseX));     // R (X normal)
      data[i + 1] = Math.max(0, Math.min(255, 128 + noiseY)); // G (Y normal)
      // B stays at 255 (Z normal, pointing up)
    }
    ctx.putImageData(imageData, 0, 0);

  } else if (type === 'roughness') {
    // Medium-high roughness for concrete (not shiny)
    ctx.fillStyle = '#b0b0b0'; // ~0.7 roughness
    ctx.fillRect(0, 0, size, size);

    // Add variation
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 30;
      const value = Math.max(128, Math.min(220, 176 + noise));
      data[i] = value;     // R
      data[i + 1] = value; // G
      data[i + 2] = value; // B
    }
    ctx.putImageData(imageData, 0, 0);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 16;
  if (type === 'diffuse') {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  return tex;
}

/**
 * Load a texture with proper settings for terrain tiling
 */
function loadTerrainTexture(
  loader: THREE.TextureLoader,
  path: string,
  isSRGB: boolean = false
): THREE.Texture {
  const tex = loader.load(path);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 16;
  if (isSRGB) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  return tex;
}

export class TSLTerrainMaterial {
  public material: MeshStandardNodeMaterial;

  private uTime = uniform(0);
  private uSunDirection = uniform(new THREE.Vector3(0.5, 0.8, 0.3).normalize());
  private uTextureRepeat: ReturnType<typeof uniform>;

  // Store textures for disposal
  private textures: THREE.Texture[] = [];

  constructor(config: TSLTerrainConfig) {
    const loader = new THREE.TextureLoader();
    const biomeTextures = getBiomeTextures(config.biome);

    // Calculate repeat - doubled texture size (halved repeat)
    // Each texture tile covers ~4-8 world units
    const mapSize = Math.max(config.mapWidth, config.mapHeight);
    const repeat = config.textureRepeat ?? Math.max(16, Math.floor(mapSize / 4));

    this.uTextureRepeat = uniform(repeat);

    // Load 3 texture layers per material (diffuse, normal, roughness)
    // Note: Displacement maps removed to stay under WebGPU's 16 texture limit
    // (MeshStandardNodeMaterial adds 1 internal texture for environment/IBL)
    const grassDiffuse = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.grass}_diffuse.png`, true);
    const grassNormal = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.grass}_normal.png`);
    const grassRoughness = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.grass}_roughness.png`);

    const dirtDiffuse = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.dirt}_diffuse.png`, true);
    const dirtNormal = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.dirt}_normal.png`);
    const dirtRoughness = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.dirt}_roughness.png`);

    const rockDiffuse = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.rock}_diffuse.png`, true);
    const rockNormal = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.rock}_normal.png`);
    const rockRoughness = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.rock}_roughness.png`);

    const cliffDiffuse = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.cliff}_diffuse.png`, true);
    const cliffNormal = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.cliff}_normal.png`);
    const cliffRoughness = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.cliff}_roughness.png`);

    // Platform textures - use file if exists, otherwise procedural concrete/metal
    let platformDiffuse: THREE.Texture;
    let platformNormal: THREE.Texture;
    let platformRoughness: THREE.Texture;

    if (biomeTextures.platform) {
      // Load from file (when user adds textures later)
      platformDiffuse = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.platform}_diffuse.png`, true);
      platformNormal = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.platform}_normal.png`);
      platformRoughness = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.platform}_roughness.png`);
    } else {
      // Use procedural concrete/metal fallback
      platformDiffuse = createProceduralPlatformTexture('diffuse');
      platformNormal = createProceduralPlatformTexture('normal');
      platformRoughness = createProceduralPlatformTexture('roughness');
    }

    this.textures = [
      grassDiffuse, grassNormal, grassRoughness,
      dirtDiffuse, dirtNormal, dirtRoughness,
      rockDiffuse, rockNormal, rockRoughness,
      cliffDiffuse, cliffNormal, cliffRoughness,
      platformDiffuse, platformNormal, platformRoughness,
    ];

    this.material = this.createMaterial(
      grassDiffuse, grassNormal, grassRoughness,
      dirtDiffuse, dirtNormal, dirtRoughness,
      rockDiffuse, rockNormal, rockRoughness,
      cliffDiffuse, cliffNormal, cliffRoughness,
      platformDiffuse, platformNormal, platformRoughness,
      repeat
    );
  }

  private createMaterial(
    grassDiffuse: THREE.Texture,
    grassNormal: THREE.Texture,
    grassRoughness: THREE.Texture,
    dirtDiffuse: THREE.Texture,
    dirtNormal: THREE.Texture,
    dirtRoughness: THREE.Texture,
    rockDiffuse: THREE.Texture,
    rockNormal: THREE.Texture,
    rockRoughness: THREE.Texture,
    cliffDiffuse: THREE.Texture,
    cliffNormal: THREE.Texture,
    cliffRoughness: THREE.Texture,
    platformDiffuse: THREE.Texture,
    platformNormal: THREE.Texture,
    platformRoughness: THREE.Texture,
    textureRepeat: number
  ): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();

    // 4-texture terrain blending based on slope AND terrain type
    // Terrain type ensures textures match walkability: ground=walkable, unwalkable=cliff
    const colorNode = Fn(() => {
      // Fixed UV scale (64x) - matches working GLSL shader
      const tiledUV = uv().mul(64.0);

      // Get pre-calculated slope from vertex attribute (0 = flat, 1 = very steep)
      // This is computed in Terrain.ts from actual height differences and terrain type
      const vertexSlope = attribute('aSlope', 'float');

      // Get terrain type: 0=ground (walkable), 1=ramp, 2=unwalkable
      const terrainType = attribute('aTerrainType', 'float');

      // Use the pre-computed vertex slope directly
      // Note: Previously we also calculated geometrySlope from normalWorld and took max(),
      // but normalWorld doesn't correctly account for the terrain mesh rotation at close
      // camera distances, causing all textures to appear as cliff when zoomed in.
      const slope = vertexSlope;

      // Sample all 5 diffuse textures (grass, dirt, rock, cliff, platform)
      const grassColor = texture(grassDiffuse, tiledUV).rgb;
      const dirtColor = texture(dirtDiffuse, tiledUV).rgb;
      const rockColor = texture(rockDiffuse, tiledUV).rgb;
      const cliffColor = texture(cliffDiffuse, tiledUV).rgb;
      const platformColor = texture(platformDiffuse, tiledUV).rgb;

      // Terrain type masks - ensure textures match walkability
      // Type values: 0=ground, 1=ramp, 2=unwalkable, 3=platform
      // isGround: 1.0 if ground (type=0), 0.0 otherwise
      const isGround = smoothstep(float(0.5), float(0.0), terrainType);
      // isRamp: 1.0 if ramp (type=1), 0.0 otherwise
      const isRamp = smoothstep(float(0.5), float(1.0), terrainType).mul(smoothstep(float(1.5), float(1.0), terrainType));
      // isUnwalkable: 1.0 if unwalkable (type=2), 0.0 otherwise
      const isUnwalkable = smoothstep(float(1.5), float(2.0), terrainType).mul(smoothstep(float(2.5), float(2.0), terrainType));
      // isPlatform: 1.0 if platform (type=3), 0.0 otherwise - SC2-style geometric platforms
      const isPlatform = smoothstep(float(2.5), float(3.0), terrainType);

      // Base slope-based weights - these provide texture regardless of terrain type
      const baseGrassWeight = smoothstep(float(0.25), float(0.1), slope);
      const baseDirtWeight = smoothstep(float(0.08), float(0.2), slope).mul(smoothstep(float(0.35), float(0.2), slope));
      const baseRockWeight = smoothstep(float(0.2), float(0.35), slope).mul(smoothstep(float(0.55), float(0.4), slope));
      const baseCliffWeight = smoothstep(float(0.4), float(0.55), slope);

      // UNIVERSAL STEEP SLOPE HANDLING - regardless of terrain type
      // Ensures steep areas ALWAYS get rock/cliff texture to avoid black
      const isSteep = smoothstep(float(0.3), float(0.6), slope);
      const isVerySteep = smoothstep(float(0.5), float(0.8), slope);

      // Apply terrain type constraints:
      // Ground: grass + dirt, rock only on steep areas
      // Ramp: ALWAYS flat ground texture (grass/snow) - they are walkable paths
      // Unwalkable: rock + cliff ONLY if steep, grass if flat (obstacles)

      // RAMP MASK - used to completely zero out non-grass textures on ramps
      // Use terrain type DIRECTLY - don't rely on slope for ramps/unwalkable overrides
      const notRamp = float(1.0).sub(isRamp);

      // Flat unwalkable: unwalkable terrain that ISN'T steep cliffs
      // BUT: boundary cells can have high slope from elevation differences
      // So we use a MORE AGGRESSIVE isSteep threshold for unwalkable override
      const isVerysteepForCliff = smoothstep(float(0.5), float(0.8), slope);  // Only very steep gets cliff
      const flatUnwalkable = isUnwalkable.mul(float(1.0).sub(isVerysteepForCliff));

      // Base grass from slope (for ground terrain)
      const baseGrass = baseGrassWeight.mul(isGround).mul(float(1.0).sub(isSteep));

      // RAMPS and FLAT UNWALKABLE: Override with very strong grass weight (10x)
      // These should ALWAYS be grass texture regardless of slope
      // Platforms should NOT get grass
      const notPlatform = float(1.0).sub(isPlatform);
      const grassWeight = baseGrass.mul(notPlatform)
        .add(isRamp.mul(float(10.0)))           // Ramps get 10x grass
        .add(flatUnwalkable.mul(float(10.0)));  // Flat unwalkable also gets 10x grass

      // Dirt - ONLY on ground terrain that's somewhat steep (not on platforms)
      const notFlatUnwalkable = float(1.0).sub(flatUnwalkable);
      const dirtWeight = baseDirtWeight.mul(isGround).mul(notRamp).mul(notFlatUnwalkable).mul(notPlatform)
        .add(isSteep.mul(isGround).mul(notPlatform).mul(float(0.2)));  // Only add steep dirt to GROUND

      // Rock - For steep terrain only (NOT platforms - they have dedicated texture)
      const steepUnwalkableRock = isUnwalkable.mul(isVerysteepForCliff).mul(float(0.8));
      const rockWeight = baseRockWeight.mul(notRamp).mul(notFlatUnwalkable).mul(notPlatform)
        .add(steepUnwalkableRock)
        .add(isSteep.mul(isGround).mul(notPlatform).mul(float(0.3)));

      // Cliff - ONLY on VERY STEEP unwalkable terrain (actual cliff faces)
      const cliffWeight = baseCliffWeight.mul(isUnwalkable).mul(isVerysteepForCliff)
        .add(isUnwalkable.mul(isVerySteep).mul(float(1.5)));

      // Platform - SC2-style concrete/metal platforms with dedicated texture
      const platformWeight = isPlatform.mul(float(10.0));

      // SAFETY: Guarantee minimum total weight to prevent black areas
      // But DON'T add fallback rock to ramps, flat unwalkable, or platforms - they have explicit textures
      const minTotalWeight = float(0.5);
      const rawTotal = grassWeight.add(dirtWeight).add(rockWeight).add(cliffWeight).add(platformWeight);
      const needsFallback = smoothstep(minTotalWeight, float(0.0), rawTotal);
      const fallbackRock = needsFallback.mul(notRamp).mul(notFlatUnwalkable).mul(notPlatform);

      // Final weights with fallback
      const finalRockWeight = rockWeight.add(fallbackRock);

      // Normalize weights so they sum to 1.0
      const totalWeight = grassWeight.add(dirtWeight).add(finalRockWeight).add(cliffWeight).add(platformWeight).add(float(0.001));
      const normGrass = grassWeight.div(totalWeight);
      const normDirt = dirtWeight.div(totalWeight);
      const normRock = finalRockWeight.div(totalWeight);
      const normCliff = cliffWeight.div(totalWeight);
      const normPlatform = platformWeight.div(totalWeight);

      // Blend colors using normalized weights (5 textures)
      const color = grassColor.mul(normGrass)
        .add(dirtColor.mul(normDirt))
        .add(rockColor.mul(normRock))
        .add(cliffColor.mul(normCliff))
        .add(platformColor.mul(normPlatform));

      return vec4(color, 1.0);
    })();

    // Roughness blending based on slope and terrain type
    const roughnessNode = Fn(() => {
      const tiledUV = uv().mul(64.0);

      // Use same slope calculation as color node (pre-computed vertex slope only)
      const vertexSlope = attribute('aSlope', 'float');
      const terrainType = attribute('aTerrainType', 'float');
      const slope = vertexSlope;

      const grassR = texture(grassRoughness, tiledUV).r;
      const dirtR = texture(dirtRoughness, tiledUV).r;
      const rockR = texture(rockRoughness, tiledUV).r;
      const cliffR = texture(cliffRoughness, tiledUV).r;
      const platformR = texture(platformRoughness, tiledUV).r;

      // Terrain type masks (same as color node)
      // Type values: 0=ground, 1=ramp, 2=unwalkable, 3=platform
      const isGround = smoothstep(float(0.5), float(0.0), terrainType);
      const isRamp = smoothstep(float(0.5), float(1.0), terrainType).mul(smoothstep(float(1.5), float(1.0), terrainType));
      const isUnwalkable = smoothstep(float(1.5), float(2.0), terrainType).mul(smoothstep(float(2.5), float(2.0), terrainType));
      const isPlatform = smoothstep(float(2.5), float(3.0), terrainType);

      // Base weights
      const baseGrassWeight = smoothstep(float(0.25), float(0.1), slope);
      const baseDirtWeight = smoothstep(float(0.08), float(0.2), slope).mul(smoothstep(float(0.35), float(0.2), slope));
      const baseRockWeight = smoothstep(float(0.2), float(0.35), slope).mul(smoothstep(float(0.55), float(0.4), slope));
      const baseCliffWeight = smoothstep(float(0.4), float(0.55), slope);

      // Universal steep slope handling (same as color node)
      const isSteep = smoothstep(float(0.3), float(0.6), slope);
      const isVerySteep = smoothstep(float(0.5), float(0.8), slope);

      // RAMP MASK, FLAT UNWALKABLE MASK, PLATFORM MASK - same logic as color node
      const notRamp = float(1.0).sub(isRamp);
      const notPlatform = float(1.0).sub(isPlatform);
      const isVerysteepForCliff = smoothstep(float(0.5), float(0.8), slope);
      const flatUnwalkable = isUnwalkable.mul(float(1.0).sub(isVerysteepForCliff));
      const notFlatUnwalkable = float(1.0).sub(flatUnwalkable);
      const baseGrass = baseGrassWeight.mul(isGround).mul(float(1.0).sub(isSteep));
      const grassWeight = baseGrass.mul(notPlatform).add(isRamp.mul(float(10.0))).add(flatUnwalkable.mul(float(10.0)));
      const dirtWeight = baseDirtWeight.mul(isGround).mul(notRamp).mul(notFlatUnwalkable).mul(notPlatform).add(isSteep.mul(isGround).mul(notPlatform).mul(float(0.2)));
      const steepUnwalkableRock = isUnwalkable.mul(isVerysteepForCliff).mul(float(0.8));
      const rockWeight = baseRockWeight.mul(notRamp).mul(notFlatUnwalkable).mul(notPlatform)
        .add(steepUnwalkableRock)
        .add(isSteep.mul(isGround).mul(notPlatform).mul(float(0.3)));
      const cliffWeight = baseCliffWeight.mul(isUnwalkable).mul(isVerysteepForCliff).add(isUnwalkable.mul(isVerySteep).mul(float(1.5)));
      const platformWeight = isPlatform.mul(float(10.0));

      // Safety fallback - but NOT on ramps, flat unwalkable, or platforms
      const rawTotal = grassWeight.add(dirtWeight).add(rockWeight).add(cliffWeight).add(platformWeight);
      const needsFallback = smoothstep(float(0.5), float(0.0), rawTotal);
      const finalRockWeight = rockWeight.add(needsFallback.mul(notRamp).mul(notFlatUnwalkable).mul(notPlatform));
      const totalWeight = grassWeight.add(dirtWeight).add(finalRockWeight).add(cliffWeight).add(platformWeight).add(float(0.001));

      const roughness = grassR.mul(grassWeight)
        .add(dirtR.mul(dirtWeight))
        .add(rockR.mul(finalRockWeight))
        .add(cliffR.mul(cliffWeight))
        .add(platformR.mul(platformWeight))
        .div(totalWeight);

      return clamp(roughness, 0.1, 0.95);
    })();

    // Normal map blending based on slope and terrain type
    const normalNode = Fn(() => {
      const tiledUV = uv().mul(64.0);

      // Use same slope calculation as color node (pre-computed vertex slope only)
      const vertexSlope = attribute('aSlope', 'float');
      const terrainType = attribute('aTerrainType', 'float');
      const slope = vertexSlope;

      // Sample and unpack normal maps (5 textures)
      const grassN = texture(grassNormal, tiledUV).rgb.mul(2.0).sub(1.0);
      const dirtN = texture(dirtNormal, tiledUV).rgb.mul(2.0).sub(1.0);
      const rockN = texture(rockNormal, tiledUV).rgb.mul(2.0).sub(1.0);
      const cliffN = texture(cliffNormal, tiledUV).rgb.mul(2.0).sub(1.0);
      const platformN = texture(platformNormal, tiledUV).rgb.mul(2.0).sub(1.0);

      // Terrain type masks (same as color node)
      // Type values: 0=ground, 1=ramp, 2=unwalkable, 3=platform
      const isGround = smoothstep(float(0.5), float(0.0), terrainType);
      const isRamp = smoothstep(float(0.5), float(1.0), terrainType).mul(smoothstep(float(1.5), float(1.0), terrainType));
      const isUnwalkable = smoothstep(float(1.5), float(2.0), terrainType).mul(smoothstep(float(2.5), float(2.0), terrainType));
      const isPlatform = smoothstep(float(2.5), float(3.0), terrainType);

      // Base weights
      const baseGrassWeight = smoothstep(float(0.25), float(0.1), slope);
      const baseDirtWeight = smoothstep(float(0.08), float(0.2), slope).mul(smoothstep(float(0.35), float(0.2), slope));
      const baseRockWeight = smoothstep(float(0.2), float(0.35), slope).mul(smoothstep(float(0.55), float(0.4), slope));
      const baseCliffWeight = smoothstep(float(0.4), float(0.55), slope);

      // Universal steep slope handling (same as color node)
      const isSteep = smoothstep(float(0.3), float(0.6), slope);
      const isVerySteep = smoothstep(float(0.5), float(0.8), slope);

      // RAMP MASK, FLAT UNWALKABLE MASK, PLATFORM MASK - same logic as color node
      const notRamp = float(1.0).sub(isRamp);
      const notPlatform = float(1.0).sub(isPlatform);
      const isVerysteepForCliff = smoothstep(float(0.5), float(0.8), slope);
      const flatUnwalkable = isUnwalkable.mul(float(1.0).sub(isVerysteepForCliff));
      const notFlatUnwalkable = float(1.0).sub(flatUnwalkable);
      const baseGrass = baseGrassWeight.mul(isGround).mul(float(1.0).sub(isSteep));
      const grassWeight = baseGrass.mul(notPlatform).add(isRamp.mul(float(10.0))).add(flatUnwalkable.mul(float(10.0)));
      const dirtWeight = baseDirtWeight.mul(isGround).mul(notRamp).mul(notFlatUnwalkable).mul(notPlatform).add(isSteep.mul(isGround).mul(notPlatform).mul(float(0.2)));
      const steepUnwalkableRock = isUnwalkable.mul(isVerysteepForCliff).mul(float(0.8));
      const rockWeight = baseRockWeight.mul(notRamp).mul(notFlatUnwalkable).mul(notPlatform)
        .add(steepUnwalkableRock)
        .add(isSteep.mul(isGround).mul(notPlatform).mul(float(0.3)));
      const cliffWeight = baseCliffWeight.mul(isUnwalkable).mul(isVerysteepForCliff).add(isUnwalkable.mul(isVerySteep).mul(float(1.5)));
      const platformWeight = isPlatform.mul(float(10.0));

      // Safety fallback - but NOT on ramps, flat unwalkable, or platforms
      const rawTotal = grassWeight.add(dirtWeight).add(rockWeight).add(cliffWeight).add(platformWeight);
      const needsFallback = smoothstep(float(0.5), float(0.0), rawTotal);
      const finalRockWeight = rockWeight.add(needsFallback.mul(notRamp).mul(notFlatUnwalkable).mul(notPlatform));
      const totalWeight = grassWeight.add(dirtWeight).add(finalRockWeight).add(cliffWeight).add(platformWeight).add(float(0.001));

      const blendedNormal = grassN.mul(grassWeight)
        .add(dirtN.mul(dirtWeight))
        .add(rockN.mul(finalRockWeight))
        .add(cliffN.mul(cliffWeight))
        .add(platformN.mul(platformWeight))
        .div(totalWeight);

      // Normalize and convert back to 0-1 range
      return normalize(blendedNormal).mul(0.5).add(0.5);
    })();

    material.colorNode = colorNode;
    material.roughnessNode = roughnessNode;
    material.normalNode = normalNode;
    material.metalnessNode = float(0.0);

    return material;
  }

  public update(deltaTime: number, sunDirection?: THREE.Vector3): void {
    this.uTime.value += deltaTime;
    if (sunDirection) {
      this.uSunDirection.value.copy(sunDirection);
    }
  }

  public dispose(): void {
    this.textures.forEach((tex) => tex.dispose());
    this.material.dispose();
  }
}

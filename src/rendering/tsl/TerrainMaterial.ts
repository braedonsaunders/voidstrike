/* eslint-disable @typescript-eslint/no-explicit-any -- TSL shader nodes use polymorphic types */
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
  vec3,
  vec4,
  float,
  uniform,
  texture,
  uv,
  smoothstep,
  normalize,
  clamp,
  attribute,
  fract,
  step,
  mix,
  abs,
  type ShaderNodeObject,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { BiomeType } from '@/rendering/Biomes';

// ============================================
// TERRAIN BLEND WEIGHT CALCULATION
// ============================================

interface TerrainBlendWeights {
  normGrass: ShaderNodeObject<any>;
  normDirt: ShaderNodeObject<any>;
  normRock: ShaderNodeObject<any>;
  normCliff: ShaderNodeObject<any>;
  normPlatform: ShaderNodeObject<any>;
  totalWeight: ShaderNodeObject<any>;
  isPlatform: ShaderNodeObject<any>;
  notPlatform: ShaderNodeObject<any>;
  notFlatUnwalkable: ShaderNodeObject<any>;
}

/**
 * Calculate terrain blend weights based on slope and terrain type.
 * Extracted to avoid duplicating ~40 lines across color/roughness/normal nodes.
 *
 * Note: This is a regular TypeScript function (not TSL Fn) that creates TSL nodes.
 * TSL Fn() expects a single node return value, but we need to return multiple weights.
 * Using a plain function allows the TSL nodes to be inlined into each calling Fn().
 */
function createTerrainBlendWeights(slope: ShaderNodeObject<any>, terrainType: ShaderNodeObject<any>): TerrainBlendWeights {
  // Terrain type masks
  // Type values: 0=ground, 1=ramp, 2=unwalkable, 3=platform
  const isGround = smoothstep(float(0.5), float(0.0), terrainType);
  const isRamp = smoothstep(float(0.5), float(1.0), terrainType).mul(smoothstep(float(1.5), float(1.0), terrainType));
  const isUnwalkable = smoothstep(float(1.5), float(2.0), terrainType).mul(smoothstep(float(2.5), float(2.0), terrainType));
  const isPlatform = smoothstep(float(2.5), float(3.0), terrainType);

  // Platforms use platform material, ramps use grass
  const notPlatform = float(1.0).sub(isPlatform);

  // Base slope-based weights - ONLY for non-platform terrain
  const baseGrassWeight = smoothstep(float(0.25), float(0.1), slope).mul(notPlatform);
  const baseDirtWeight = smoothstep(float(0.08), float(0.2), slope).mul(smoothstep(float(0.35), float(0.2), slope)).mul(notPlatform);
  const baseRockWeight = smoothstep(float(0.2), float(0.35), slope).mul(smoothstep(float(0.55), float(0.4), slope)).mul(notPlatform);
  const baseCliffWeight = smoothstep(float(0.4), float(0.55), slope).mul(notPlatform);

  // Universal steep slope handling - only for natural terrain
  const isSteep = smoothstep(float(0.3), float(0.6), slope).mul(notPlatform);
  const isVerySteep = smoothstep(float(0.5), float(0.8), slope).mul(notPlatform);

  // Flat unwalkable handling
  const isVerysteepForCliff = smoothstep(float(0.5), float(0.8), slope);
  const flatUnwalkable = isUnwalkable.mul(float(1.0).sub(isVerysteepForCliff));
  const notFlatUnwalkable = float(1.0).sub(flatUnwalkable);

  // Final weight calculations
  const baseGrass = baseGrassWeight.mul(isGround).mul(float(1.0).sub(isSteep));
  const grassWeight = baseGrass.add(flatUnwalkable.mul(float(10.0))).add(isRamp.mul(float(10.0)));
  const dirtWeight = baseDirtWeight.mul(isGround).mul(notFlatUnwalkable).add(isSteep.mul(isGround).mul(float(0.2)));
  const steepUnwalkableRock = isUnwalkable.mul(isVerysteepForCliff).mul(float(0.8)).mul(notPlatform);
  const rockWeight = baseRockWeight.mul(notFlatUnwalkable)
    .add(steepUnwalkableRock)
    .add(isSteep.mul(isGround).mul(float(0.3)));
  const cliffWeight = baseCliffWeight.mul(isUnwalkable).mul(isVerysteepForCliff)
    .add(isUnwalkable.mul(isVerySteep).mul(float(1.5)));
  const platformWeight = isPlatform.mul(float(10.0));

  // Safety fallback - but NOT on platforms
  const rawTotal = grassWeight.add(dirtWeight).add(rockWeight).add(cliffWeight).add(platformWeight);
  const needsFallback = smoothstep(float(0.5), float(0.0), rawTotal);
  const finalRockWeight = rockWeight.add(needsFallback.mul(notPlatform).mul(notFlatUnwalkable));

  // Normalize weights
  const totalWeight = grassWeight.add(dirtWeight).add(finalRockWeight).add(cliffWeight).add(platformWeight).add(float(0.001));
  const normGrass = grassWeight.div(totalWeight);
  const normDirt = dirtWeight.div(totalWeight);
  const normRock = finalRockWeight.div(totalWeight);
  const normCliff = cliffWeight.div(totalWeight);
  const normPlatform = platformWeight.div(totalWeight);

  return {
    normGrass,
    normDirt,
    normRock,
    normCliff,
    normPlatform,
    totalWeight,
    isPlatform,
    notPlatform,
    notFlatUnwalkable,
  };
}

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
} {
  switch (biome) {
    case 'desert':
      return {
        grass: 'sand',
        dirt: 'desert_dirt',
        rock: 'rock',
        cliff: 'desert_cliff',
      };
    case 'frozen':
      return {
        grass: 'snow',
        dirt: 'ice_rock',
        rock: 'ice_rock',
        cliff: 'ice_cliff',
      };
    case 'volcanic':
      return {
        grass: 'ash',
        dirt: 'basalt',
        rock: 'basalt',
        cliff: 'volcanic_cliff',
      };
    case 'void':
      return {
        grass: 'void_ground',
        dirt: 'void_rock',
        rock: 'void_rock',
        cliff: 'void_cliff',
      };
    case 'jungle':
      return {
        grass: 'jungle_floor',
        dirt: 'dirt',
        rock: 'mossy_rock',
        cliff: 'jungle_cliff',
      };
    case 'ocean':
      return {
        grass: 'sand',        // Sandy beach
        dirt: 'desert_dirt',  // Wet sand
        rock: 'rock',         // Coastal rock
        cliff: 'cliff',       // Cliff face
      };
    case 'grassland':
    default:
      return {
        grass: 'grass',
        dirt: 'dirt',
        rock: 'rock',
        cliff: 'cliff',
      };
  }
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

    // Platform textures are generated procedurally in the shader to stay under WebGPU's 16 texture limit
    // (4 terrain types × 3 textures = 12, plus MeshStandardNodeMaterial internal textures)

    this.textures = [
      grassDiffuse, grassNormal, grassRoughness,
      dirtDiffuse, dirtNormal, dirtRoughness,
      rockDiffuse, rockNormal, rockRoughness,
      cliffDiffuse, cliffNormal, cliffRoughness,
    ];

    this.material = this.createMaterial(
      grassDiffuse, grassNormal, grassRoughness,
      dirtDiffuse, dirtNormal, dirtRoughness,
      rockDiffuse, rockNormal, rockRoughness,
      cliffDiffuse, cliffNormal, cliffRoughness,
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
    _textureRepeat: number
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

      // Sample 4 diffuse textures (grass, dirt, rock, cliff)
      const grassColor = texture(grassDiffuse, tiledUV).rgb;
      const dirtColor = texture(dirtDiffuse, tiledUV).rgb;
      const rockColor = texture(rockDiffuse, tiledUV).rgb;
      const cliffColor = texture(cliffDiffuse, tiledUV).rgb;

      // PROCEDURAL PLATFORM MATERIAL
      // Sci-fi metal panels with beveled edges, subtle variation, and detail
      const platformUV = uv().mul(6.0); // Panel tile scale
      const panelUV = fract(platformUV);

      // Distance from panel edges (for bevel/border effect)
      const edgeDistX = abs(panelUV.x.sub(0.5)).mul(2.0); // 0 at center, 1 at edge
      const edgeDistY = abs(panelUV.y.sub(0.5)).mul(2.0);
      const edgeDist = clamp(edgeDistX.max(edgeDistY), 0.0, 1.0);

      // Panel border (dark seam between panels)
      const borderWidth = float(0.04);
      const isBorder = step(float(1.0).sub(borderWidth), edgeDist);

      // Beveled edge highlight (bright rim just inside border)
      const bevelStart = float(0.92);
      const bevelEnd = float(0.96);
      const bevelMask = smoothstep(bevelStart, bevelEnd, edgeDist).mul(float(1.0).sub(isBorder));

      // Inner panel detail - subtle cross pattern
      const innerUV = panelUV.mul(4.0);
      const innerGridX = smoothstep(float(0.48), float(0.5), abs(fract(innerUV.x).sub(0.5)));
      const innerGridY = smoothstep(float(0.48), float(0.5), abs(fract(innerUV.y).sub(0.5)));
      const innerDetail = clamp(innerGridX.add(innerGridY), 0.0, 1.0).mul(0.03);

      // Subtle noise variation using UV coordinates (pseudo-random)
      const noiseUV = uv().mul(32.0);
      const noise1 = fract(noiseUV.x.mul(12.9898).add(noiseUV.y.mul(78.233)).sin().mul(43758.5453));
      const colorVariation = noise1.sub(0.5).mul(0.04);

      // Color palette - metallic blue-gray with subtle warmth
      const panelBase = vec3(0.38, 0.40, 0.45);      // Blue-gray metal
      const panelHighlight = vec3(0.52, 0.54, 0.58); // Lighter highlight
      const borderColor = vec3(0.18, 0.19, 0.22);    // Dark seams
      const bevelColor = vec3(0.58, 0.60, 0.65);     // Bright bevel edge

      // Compose final platform color
      const panelWithDetail = panelBase.add(vec3(innerDetail, innerDetail, innerDetail));
      const panelWithVariation = panelWithDetail.add(vec3(colorVariation, colorVariation, colorVariation));
      const panelWithBevel = mix(panelWithVariation, bevelColor, bevelMask.mul(0.6));
      const platformColor = mix(panelWithBevel, borderColor, isBorder);

      // Calculate terrain blend weights using shared helper
      const weights = createTerrainBlendWeights(slope, terrainType);

      // Blend colors using normalized weights (5 textures)
      const color = grassColor.mul(weights.normGrass)
        .add(dirtColor.mul(weights.normDirt))
        .add(rockColor.mul(weights.normRock))
        .add(cliffColor.mul(weights.normCliff))
        .add(platformColor.mul(weights.normPlatform));

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

      // Procedural platform roughness - metallic panels with varied roughness
      const platformUV = uv().mul(6.0);
      const panelUV = fract(platformUV);
      const edgeDistX = abs(panelUV.x.sub(0.5)).mul(2.0);
      const edgeDistY = abs(panelUV.y.sub(0.5)).mul(2.0);
      const edgeDist = clamp(edgeDistX.max(edgeDistY), 0.0, 1.0);
      const isBorderR = step(float(0.96), edgeDist);
      // Bevels are smoother (lower roughness), borders are rougher
      const bevelMaskR = smoothstep(float(0.92), float(0.96), edgeDist).mul(float(1.0).sub(isBorderR));
      const baseRoughness = float(0.55);  // Metallic panel base
      const bevelRoughness = float(0.35); // Smooth bevel
      const borderRoughness = float(0.75); // Rough seams
      const platformR = mix(mix(baseRoughness, bevelRoughness, bevelMaskR), borderRoughness, isBorderR);

      // Calculate terrain blend weights using shared helper
      const weights = createTerrainBlendWeights(slope, terrainType);

      // Blend roughness using normalized weights
      const roughness = grassR.mul(weights.normGrass)
        .add(dirtR.mul(weights.normDirt))
        .add(rockR.mul(weights.normRock))
        .add(cliffR.mul(weights.normCliff))
        .add(platformR.mul(weights.normPlatform));

      return clamp(roughness, 0.1, 0.95);
    })();

    // Normal map blending based on slope and terrain type
    const normalNode = Fn(() => {
      const tiledUV = uv().mul(64.0);

      // Use same slope calculation as color node (pre-computed vertex slope only)
      const vertexSlope = attribute('aSlope', 'float');
      const terrainType = attribute('aTerrainType', 'float');
      const slope = vertexSlope;

      // Sample and unpack normal maps (4 textures)
      const grassN = texture(grassNormal, tiledUV).rgb.mul(2.0).sub(1.0);
      const dirtN = texture(dirtNormal, tiledUV).rgb.mul(2.0).sub(1.0);
      const rockN = texture(rockNormal, tiledUV).rgb.mul(2.0).sub(1.0);
      const cliffN = texture(cliffNormal, tiledUV).rgb.mul(2.0).sub(1.0);

      // Procedural platform normal - beveled panel edges
      const platformUV = uv().mul(6.0);
      const panelUV = fract(platformUV);
      // Calculate normal perturbation for beveled edges
      const centerOffset = panelUV.sub(0.5); // -0.5 to 0.5
      const edgeDistX = abs(centerOffset.x).mul(2.0);
      const edgeDistY = abs(centerOffset.y).mul(2.0);
      const edgeDist = clamp(edgeDistX.max(edgeDistY), 0.0, 1.0);
      // Bevel normal - points outward from panel center at edges
      const bevelStrength = smoothstep(float(0.85), float(0.95), edgeDist).mul(0.3);
      const bevelNormalX = centerOffset.x.sign().mul(bevelStrength).mul(step(edgeDistY, edgeDistX));
      const bevelNormalY = centerOffset.y.sign().mul(bevelStrength).mul(step(edgeDistX, edgeDistY));
      const platformN = normalize(vec3(bevelNormalX, bevelNormalY, float(1.0)));

      // Calculate terrain blend weights using shared helper
      const weights = createTerrainBlendWeights(slope, terrainType);

      // Blend normals using normalized weights (need totalWeight for proper blending)
      const blendedNormal = grassN.mul(weights.normGrass)
        .add(dirtN.mul(weights.normDirt))
        .add(rockN.mul(weights.normRock))
        .add(cliffN.mul(weights.normCliff))
        .add(platformN.mul(weights.normPlatform));

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

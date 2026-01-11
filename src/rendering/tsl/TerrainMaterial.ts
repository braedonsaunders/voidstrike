/**
 * TSL Terrain Material - World Class Quality
 *
 * WebGPU-compatible terrain material with advanced 4-texture blending.
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
  vec2,
  vec3,
  vec4,
  float,
  uniform,
  texture,
  uv,
  mix,
  smoothstep,
  normalize,
  dot,
  abs,
  normalWorld,
  positionWorld,
  fract,
  sin,
  floor,
  clamp,
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
        cliff: 'lava_cliff',
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
        dirt: 'jungle_dirt',
        rock: 'jungle_rock',
        cliff: 'jungle_cliff',
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
    textureRepeat: number
  ): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();

    // AAA-quality color node with all 4 texture layers
    const colorNode = Fn(() => {
      const worldPos = positionWorld;
      const worldNorm = normalWorld;

      // Primary UV scale
      const primaryScale = float(textureRepeat);
      const primaryUV = uv().mul(vec2(primaryScale, primaryScale));

      // Secondary UV at different scale to break up tiling (golden ratio offset)
      const detailScale = float(textureRepeat).mul(0.31);
      const detailUV = uv().mul(vec2(detailScale, detailScale)).add(vec2(0.17, 0.31));

      // Calculate slope (0 = flat, 1 = vertical)
      const upVector = vec3(0.0, 1.0, 0.0);
      const slope = float(1.0).sub(abs(dot(normalize(worldNorm), upVector)));

      // Smooth procedural noise for blend variation (no floor() to avoid checkerboard)
      const noiseScale = float(0.05);
      const nx = worldPos.x.mul(noiseScale);
      const nz = worldPos.z.mul(noiseScale);
      const blendNoise = fract(sin(nx.mul(12.9898).add(nz.mul(78.233))).mul(43758.5453));

      // Sample primary textures
      const grassPrimary = texture(grassDiffuse, primaryUV).rgb;
      const dirtPrimary = texture(dirtDiffuse, primaryUV).rgb;
      const rockPrimary = texture(rockDiffuse, primaryUV).rgb;
      const cliffPrimary = texture(cliffDiffuse, primaryUV).rgb;

      // Sample detail textures at different scale for subtle anti-tiling
      const grassDetail = texture(grassDiffuse, detailUV).rgb;
      const dirtDetail = texture(dirtDiffuse, detailUV).rgb;
      const rockDetail = texture(rockDiffuse, detailUV).rgb;
      const cliffDetail = texture(cliffDiffuse, detailUV).rgb;

      // Subtle detail blending (overlay style but less aggressive)
      const detailBlend = float(0.15);
      const grassColor = mix(grassPrimary, grassPrimary.mul(grassDetail.add(0.5)), detailBlend);
      const dirtColor = mix(dirtPrimary, dirtPrimary.mul(dirtDetail.add(0.5)), detailBlend);
      const rockColor = mix(rockPrimary, rockPrimary.mul(rockDetail.add(0.5)), detailBlend);
      const cliffColor = mix(cliffPrimary, cliffPrimary.mul(cliffDetail.add(0.5)), detailBlend);

      // Noise modulated blend thresholds for organic transitions (reduced influence)
      const noiseOffset = blendNoise.sub(0.5).mul(0.06);

      // Smooth blend factors based on slope
      const dirtBlend = smoothstep(float(0.05).add(noiseOffset), float(0.20).add(noiseOffset), slope);
      const rockBlend = smoothstep(float(0.18).add(noiseOffset), float(0.45).add(noiseOffset), slope);
      const cliffBlend = smoothstep(float(0.40).add(noiseOffset), float(0.70).add(noiseOffset), slope);

      // Cascade the blending
      let color = mix(grassColor, dirtColor, dirtBlend);
      color = mix(color, rockColor, rockBlend);
      color = mix(color, cliffColor, cliffBlend);

      // World height variation (subtle darkening in low areas)
      const heightFactor = clamp(worldPos.y.mul(0.02).add(0.95), 0.90, 1.05);
      color = color.mul(heightFactor);

      // === SUBTLE COLOR GRADING ===

      // Slight contrast boost
      const contrast = float(1.08);
      color = color.sub(0.5).mul(contrast).add(0.5);

      // Subtle saturation boost
      const saturation = float(1.1);
      const luma = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(luma), color, saturation);

      // Clamp to valid range
      color = clamp(color, 0.0, 1.0);

      return vec4(color, 1.0);
    })();

    // Roughness blending based on slope
    const roughnessNode = Fn(() => {
      const worldNorm = normalWorld;

      const primaryScale = float(textureRepeat);
      const primaryUV = uv().mul(vec2(primaryScale, primaryScale));

      const upVector = vec3(0.0, 1.0, 0.0);
      const slope = float(1.0).sub(abs(dot(normalize(worldNorm), upVector)));

      const grassR = texture(grassRoughness, primaryUV).r;
      const dirtR = texture(dirtRoughness, primaryUV).r;
      const rockR = texture(rockRoughness, primaryUV).r;
      const cliffR = texture(cliffRoughness, primaryUV).r;

      // Same blend thresholds as color (no noise offset for roughness)
      const dirtBlend = smoothstep(float(0.05), float(0.20), slope);
      const rockBlend = smoothstep(float(0.18), float(0.45), slope);
      const cliffBlend = smoothstep(float(0.40), float(0.70), slope);

      let roughness = mix(grassR, dirtR, dirtBlend);
      roughness = mix(roughness, rockR, rockBlend);
      roughness = mix(roughness, cliffR, cliffBlend);

      return clamp(roughness, 0.1, 0.95);
    })();

    // Normal map blending based on slope
    const normalNode = Fn(() => {
      const worldNorm = normalWorld;

      const primaryScale = float(textureRepeat);
      const primaryUV = uv().mul(vec2(primaryScale, primaryScale));

      const upVector = vec3(0.0, 1.0, 0.0);
      const slope = float(1.0).sub(abs(dot(normalize(worldNorm), upVector)));

      // Sample normal maps
      const grassN = texture(grassNormal, primaryUV).rgb.mul(2.0).sub(1.0);
      const dirtN = texture(dirtNormal, primaryUV).rgb.mul(2.0).sub(1.0);
      const rockN = texture(rockNormal, primaryUV).rgb.mul(2.0).sub(1.0);
      const cliffN = texture(cliffNormal, primaryUV).rgb.mul(2.0).sub(1.0);

      // Same blend thresholds as color
      const dirtBlend = smoothstep(float(0.05), float(0.20), slope);
      const rockBlend = smoothstep(float(0.18), float(0.45), slope);
      const cliffBlend = smoothstep(float(0.40), float(0.70), slope);

      let normal = mix(grassN, dirtN, dirtBlend);
      normal = mix(normal, rockN, rockBlend);
      normal = mix(normal, cliffN, cliffBlend);

      // Convert back to 0-1 range
      return normal.mul(0.5).add(0.5);
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

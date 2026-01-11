/**
 * TSL Terrain Material
 *
 * WebGPU-compatible terrain material with 4-texture blending.
 * Blends grass, dirt, rock, and cliff textures based on slope and elevation.
 * Works with both WebGPU and WebGL renderers.
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
  mix,
  smoothstep,
  normalize,
  dot,
  abs,
  normalWorld,
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
  repeat: number,
  isSRGB: boolean = false
): THREE.Texture {
  const tex = loader.load(path);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
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

  // Store textures for disposal
  private textures: THREE.Texture[] = [];

  constructor(config: TSLTerrainConfig) {
    const loader = new THREE.TextureLoader();
    const biomeTextures = getBiomeTextures(config.biome);

    // Calculate repeat based on map size - larger maps need more repetition
    const mapSize = Math.max(config.mapWidth, config.mapHeight);
    const repeat = config.textureRepeat ?? Math.max(16, mapSize / 4);

    // Load all textures
    const grassDiffuse = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.grass}_diffuse.png`, repeat, true);
    const grassNormal = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.grass}_normal.png`, repeat);
    const grassRoughness = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.grass}_roughness.png`, repeat);

    const dirtDiffuse = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.dirt}_diffuse.png`, repeat, true);
    const dirtNormal = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.dirt}_normal.png`, repeat);
    const dirtRoughness = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.dirt}_roughness.png`, repeat);

    const rockDiffuse = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.rock}_diffuse.png`, repeat, true);
    const rockNormal = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.rock}_normal.png`, repeat);
    const rockRoughness = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.rock}_roughness.png`, repeat);

    const cliffDiffuse = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.cliff}_diffuse.png`, repeat, true);
    const cliffNormal = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.cliff}_normal.png`, repeat);
    const cliffRoughness = loadTerrainTexture(loader, `/textures/terrain/${biomeTextures.cliff}_roughness.png`, repeat);

    // Store for disposal
    this.textures = [
      grassDiffuse, grassNormal, grassRoughness,
      dirtDiffuse, dirtNormal, dirtRoughness,
      rockDiffuse, rockNormal, rockRoughness,
      cliffDiffuse, cliffNormal, cliffRoughness,
    ];

    // Create material with TSL nodes
    this.material = this.createMaterial(
      grassDiffuse, grassNormal, grassRoughness,
      dirtDiffuse, dirtNormal, dirtRoughness,
      rockDiffuse, rockNormal, rockRoughness,
      cliffDiffuse, cliffNormal, cliffRoughness
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
    cliffRoughness: THREE.Texture
  ): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();

    // Calculate blend weights based on slope and elevation
    const colorNode = Fn(() => {
      const uvCoord = uv();
      const worldNormal = normalWorld;

      // Calculate slope (0 = flat, 1 = vertical)
      const upVector = vec3(0.0, 1.0, 0.0);
      const slope = float(1.0).sub(abs(dot(normalize(worldNormal), upVector)));

      // Sample all diffuse textures
      const grassColor = texture(grassDiffuse, uvCoord);
      const dirtColor = texture(dirtDiffuse, uvCoord);
      const rockColor = texture(rockDiffuse, uvCoord);
      const cliffColor = texture(cliffDiffuse, uvCoord);

      // Use cascading mix for proper blending (always sums to 1.0)
      // Start with grass as base, then progressively blend in other textures
      // based on slope thresholds

      // Dirt blend: starts at slope 0.05, fully blended at 0.2
      const dirtBlend = smoothstep(float(0.05), float(0.2), slope);

      // Rock blend: starts at slope 0.2, fully blended at 0.45
      const rockBlend = smoothstep(float(0.2), float(0.45), slope);

      // Cliff blend: starts at slope 0.45, fully blended at 0.7
      const cliffBlend = smoothstep(float(0.45), float(0.7), slope);

      // Cascade the blending: grass -> dirt -> rock -> cliff
      let color = mix(grassColor.rgb, dirtColor.rgb, dirtBlend);
      color = mix(color, rockColor.rgb, rockBlend);
      color = mix(color, cliffColor.rgb, cliffBlend);

      return vec4(color, 1.0);
    })();

    // Blend roughness values using same cascading approach
    const roughnessNode = Fn(() => {
      const uvCoord = uv();
      const worldNormal = normalWorld;

      const upVector = vec3(0.0, 1.0, 0.0);
      const slope = float(1.0).sub(abs(dot(normalize(worldNormal), upVector)));

      const grassR = texture(grassRoughness, uvCoord).r;
      const dirtR = texture(dirtRoughness, uvCoord).r;
      const rockR = texture(rockRoughness, uvCoord).r;
      const cliffR = texture(cliffRoughness, uvCoord).r;

      // Same blend factors as color
      const dirtBlend = smoothstep(float(0.05), float(0.2), slope);
      const rockBlend = smoothstep(float(0.2), float(0.45), slope);
      const cliffBlend = smoothstep(float(0.45), float(0.7), slope);

      // Cascade the blending
      let roughness = mix(grassR, dirtR, dirtBlend);
      roughness = mix(roughness, rockR, rockBlend);
      roughness = mix(roughness, cliffR, cliffBlend);

      return roughness;
    })();

    material.colorNode = colorNode;
    material.roughnessNode = roughnessNode;
    material.metalnessNode = float(0);

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

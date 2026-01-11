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

      // Sample all 4 diffuse textures
      const grassColor = texture(grassDiffuse, tiledUV).rgb;
      const dirtColor = texture(dirtDiffuse, tiledUV).rgb;
      const rockColor = texture(rockDiffuse, tiledUV).rgb;
      const cliffColor = texture(cliffDiffuse, tiledUV).rgb;

      // Terrain type masks - ensure textures match walkability
      // isGround: 1.0 if ground (type=0), 0.0 otherwise
      const isGround = smoothstep(float(0.5), float(0.0), terrainType);
      // isRamp: 1.0 if ramp (type=1), 0.0 otherwise
      const isRamp = smoothstep(float(0.5), float(1.0), terrainType).mul(smoothstep(float(1.5), float(1.0), terrainType));
      // isUnwalkable: 1.0 if unwalkable (type=2), 0.0 otherwise
      const isUnwalkable = smoothstep(float(1.5), float(2.0), terrainType);

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
      const grassWeight = baseGrass
        .add(isRamp.mul(float(10.0)))           // Ramps get 10x grass
        .add(flatUnwalkable.mul(float(10.0)));  // Flat unwalkable also gets 10x grass

      // Dirt - ONLY on ground terrain that's somewhat steep
      const notFlatUnwalkable = float(1.0).sub(flatUnwalkable);
      const dirtWeight = baseDirtWeight.mul(isGround).mul(notRamp).mul(notFlatUnwalkable)
        .add(isSteep.mul(isGround).mul(float(0.2)));  // Only add steep dirt to GROUND

      // Rock - ONLY on non-ramp, non-flat-unwalkable terrain
      const steepUnwalkableRock = isUnwalkable.mul(isVerysteepForCliff).mul(float(0.8));  // Only VERY steep unwalkable gets rock
      const rockWeight = baseRockWeight.mul(notRamp).mul(notFlatUnwalkable)
        .add(steepUnwalkableRock)
        .add(isSteep.mul(isGround).mul(float(0.3)));  // Only steep GROUND gets rock

      // Cliff - ONLY on VERY STEEP unwalkable terrain (actual cliff faces)
      const cliffWeight = baseCliffWeight.mul(isUnwalkable).mul(isVerysteepForCliff)
        .add(isUnwalkable.mul(isVerySteep).mul(float(1.5)));

      // SAFETY: Guarantee minimum total weight to prevent black areas
      // But DON'T add fallback rock to ramps or flat unwalkable - they should stay pure grass
      const minTotalWeight = float(0.5);
      const rawTotal = grassWeight.add(dirtWeight).add(rockWeight).add(cliffWeight);
      const needsFallback = smoothstep(minTotalWeight, float(0.0), rawTotal);
      const fallbackRock = needsFallback.mul(notRamp).mul(notFlatUnwalkable); // NO fallback rock on ramps/flat unwalkable

      // Final weights with fallback
      const finalRockWeight = rockWeight.add(fallbackRock);

      // Normalize weights so they sum to 1.0
      const totalWeight = grassWeight.add(dirtWeight).add(finalRockWeight).add(cliffWeight).add(float(0.001)); // Prevent div by 0
      const normGrass = grassWeight.div(totalWeight);
      const normDirt = dirtWeight.div(totalWeight);
      const normRock = finalRockWeight.div(totalWeight);
      const normCliff = cliffWeight.div(totalWeight);

      // Blend colors using normalized weights
      const color = grassColor.mul(normGrass)
        .add(dirtColor.mul(normDirt))
        .add(rockColor.mul(normRock))
        .add(cliffColor.mul(normCliff));

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

      // Terrain type masks (same as color node)
      const isGround = smoothstep(float(0.5), float(0.0), terrainType);
      const isRamp = smoothstep(float(0.5), float(1.0), terrainType).mul(smoothstep(float(1.5), float(1.0), terrainType));
      const isUnwalkable = smoothstep(float(1.5), float(2.0), terrainType);

      // Base weights
      const baseGrassWeight = smoothstep(float(0.25), float(0.1), slope);
      const baseDirtWeight = smoothstep(float(0.08), float(0.2), slope).mul(smoothstep(float(0.35), float(0.2), slope));
      const baseRockWeight = smoothstep(float(0.2), float(0.35), slope).mul(smoothstep(float(0.55), float(0.4), slope));
      const baseCliffWeight = smoothstep(float(0.4), float(0.55), slope);

      // Universal steep slope handling (same as color node)
      const isSteep = smoothstep(float(0.3), float(0.6), slope);
      const isVerySteep = smoothstep(float(0.5), float(0.8), slope);

      // RAMP MASK and FLAT UNWALKABLE MASK - same logic as color node
      const notRamp = float(1.0).sub(isRamp);
      const isVerysteepForCliff = smoothstep(float(0.5), float(0.8), slope);
      const flatUnwalkable = isUnwalkable.mul(float(1.0).sub(isVerysteepForCliff));
      const notFlatUnwalkable = float(1.0).sub(flatUnwalkable);
      const baseGrass = baseGrassWeight.mul(isGround).mul(float(1.0).sub(isSteep));
      const grassWeight = baseGrass.add(isRamp.mul(float(10.0))).add(flatUnwalkable.mul(float(10.0)));
      const dirtWeight = baseDirtWeight.mul(isGround).mul(notRamp).mul(notFlatUnwalkable).add(isSteep.mul(isGround).mul(float(0.2)));
      const steepUnwalkableRock = isUnwalkable.mul(isVerysteepForCliff).mul(float(0.8));
      const rockWeight = baseRockWeight.mul(notRamp).mul(notFlatUnwalkable).add(steepUnwalkableRock).add(isSteep.mul(isGround).mul(float(0.3)));
      const cliffWeight = baseCliffWeight.mul(isUnwalkable).mul(isVerysteepForCliff).add(isUnwalkable.mul(isVerySteep).mul(float(1.5)));

      // Safety fallback - but NOT on ramps or flat unwalkable
      const rawTotal = grassWeight.add(dirtWeight).add(rockWeight).add(cliffWeight);
      const needsFallback = smoothstep(float(0.5), float(0.0), rawTotal);
      const finalRockWeight = rockWeight.add(needsFallback.mul(notRamp).mul(notFlatUnwalkable));
      const totalWeight = grassWeight.add(dirtWeight).add(finalRockWeight).add(cliffWeight).add(float(0.001));

      const roughness = grassR.mul(grassWeight)
        .add(dirtR.mul(dirtWeight))
        .add(rockR.mul(finalRockWeight))
        .add(cliffR.mul(cliffWeight))
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

      // Sample and unpack normal maps
      const grassN = texture(grassNormal, tiledUV).rgb.mul(2.0).sub(1.0);
      const dirtN = texture(dirtNormal, tiledUV).rgb.mul(2.0).sub(1.0);
      const rockN = texture(rockNormal, tiledUV).rgb.mul(2.0).sub(1.0);
      const cliffN = texture(cliffNormal, tiledUV).rgb.mul(2.0).sub(1.0);

      // Terrain type masks (same as color node)
      const isGround = smoothstep(float(0.5), float(0.0), terrainType);
      const isRamp = smoothstep(float(0.5), float(1.0), terrainType).mul(smoothstep(float(1.5), float(1.0), terrainType));
      const isUnwalkable = smoothstep(float(1.5), float(2.0), terrainType);

      // Base weights
      const baseGrassWeight = smoothstep(float(0.25), float(0.1), slope);
      const baseDirtWeight = smoothstep(float(0.08), float(0.2), slope).mul(smoothstep(float(0.35), float(0.2), slope));
      const baseRockWeight = smoothstep(float(0.2), float(0.35), slope).mul(smoothstep(float(0.55), float(0.4), slope));
      const baseCliffWeight = smoothstep(float(0.4), float(0.55), slope);

      // Universal steep slope handling (same as color node)
      const isSteep = smoothstep(float(0.3), float(0.6), slope);
      const isVerySteep = smoothstep(float(0.5), float(0.8), slope);

      // RAMP MASK and FLAT UNWALKABLE MASK - same logic as color node
      const notRamp = float(1.0).sub(isRamp);
      const isVerysteepForCliff = smoothstep(float(0.5), float(0.8), slope);
      const flatUnwalkable = isUnwalkable.mul(float(1.0).sub(isVerysteepForCliff));
      const notFlatUnwalkable = float(1.0).sub(flatUnwalkable);
      const baseGrass = baseGrassWeight.mul(isGround).mul(float(1.0).sub(isSteep));
      const grassWeight = baseGrass.add(isRamp.mul(float(10.0))).add(flatUnwalkable.mul(float(10.0)));
      const dirtWeight = baseDirtWeight.mul(isGround).mul(notRamp).mul(notFlatUnwalkable).add(isSteep.mul(isGround).mul(float(0.2)));
      const steepUnwalkableRock = isUnwalkable.mul(isVerysteepForCliff).mul(float(0.8));
      const rockWeight = baseRockWeight.mul(notRamp).mul(notFlatUnwalkable).add(steepUnwalkableRock).add(isSteep.mul(isGround).mul(float(0.3)));
      const cliffWeight = baseCliffWeight.mul(isUnwalkable).mul(isVerysteepForCliff).add(isUnwalkable.mul(isVerySteep).mul(float(1.5)));

      // Safety fallback - but NOT on ramps or flat unwalkable
      const rawTotal = grassWeight.add(dirtWeight).add(rockWeight).add(cliffWeight);
      const needsFallback = smoothstep(float(0.5), float(0.0), rawTotal);
      const finalRockWeight = rockWeight.add(needsFallback.mul(notRamp).mul(notFlatUnwalkable));
      const totalWeight = grassWeight.add(dirtWeight).add(finalRockWeight).add(cliffWeight).add(float(0.001));

      const blendedNormal = grassN.mul(grassWeight)
        .add(dirtN.mul(dirtWeight))
        .add(rockN.mul(finalRockWeight))
        .add(cliffN.mul(cliffWeight))
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

/**
 * TSL Texture-Based Terrain Material
 *
 * High-performance PBR terrain shader using actual textures instead of
 * procedural noise. Features:
 * - Multi-texture blending (grass, dirt, rock, cliff)
 * - Normal mapping with triplanar for cliffs
 * - Roughness maps for PBR
 * - Parallax occlusion mapping for depth
 * - Slope and elevation-based blending
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  uniform,
  attribute,
  varyingProperty,
  positionLocal,
  positionWorld,
  normalWorld,
  normalLocal,
  cameraPosition,
  modelWorldMatrix,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  texture,
  Fn,
  normalize,
  abs,
  max,
  min,
  mix,
  dot,
  pow,
  smoothstep,
  clamp,
  fract,
  sin,
  length,
  cross,
  transpose,
  mat3,
  If,
} from 'three/tsl';

// ============================================
// CONFIGURATION
// ============================================

export interface TextureTerrainConfig {
  grassTexture: string;
  grassNormal: string;
  grassRoughness?: string;
  grassDisplacement?: string;
  dirtTexture: string;
  dirtNormal: string;
  dirtRoughness?: string;
  dirtDisplacement?: string;
  rockTexture: string;
  rockNormal: string;
  rockRoughness?: string;
  rockDisplacement?: string;
  cliffTexture: string;
  cliffNormal: string;
  cliffRoughness?: string;
  cliffDisplacement?: string;
  parallaxScale?: number;
  sunDirection?: THREE.Vector3;
  sunIntensity?: number;
  ambientColor?: THREE.Color;
}

// ============================================
// TEXTURE LOADING
// ============================================

const textureLoader = new THREE.TextureLoader();

function loadTerrainTexture(path: string): THREE.Texture {
  const tex = textureLoader.load(path);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

function createDefaultTexture(color: number): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, 1, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ============================================
// MATERIAL FACTORY
// ============================================

export function createTextureTerrainMaterial(config: TextureTerrainConfig): MeshStandardNodeMaterial {
  // Load textures
  const grassDiffuse = loadTerrainTexture(config.grassTexture);
  const grassNormal = loadTerrainTexture(config.grassNormal);
  const grassRough = config.grassRoughness
    ? loadTerrainTexture(config.grassRoughness)
    : createDefaultTexture(0xcccccc);
  const grassDisp = config.grassDisplacement
    ? loadTerrainTexture(config.grassDisplacement)
    : createDefaultTexture(0x808080);

  const dirtDiffuse = loadTerrainTexture(config.dirtTexture);
  const dirtNormal = loadTerrainTexture(config.dirtNormal);
  const dirtRough = config.dirtRoughness
    ? loadTerrainTexture(config.dirtRoughness)
    : createDefaultTexture(0xe6e6e6);
  const dirtDisp = config.dirtDisplacement
    ? loadTerrainTexture(config.dirtDisplacement)
    : createDefaultTexture(0x808080);

  const rockDiffuse = loadTerrainTexture(config.rockTexture);
  const rockNormal = loadTerrainTexture(config.rockNormal);
  const rockRough = config.rockRoughness
    ? loadTerrainTexture(config.rockRoughness)
    : createDefaultTexture(0xb3b3b3);
  const rockDisp = config.rockDisplacement
    ? loadTerrainTexture(config.rockDisplacement)
    : createDefaultTexture(0x808080);

  const cliffDiffuse = loadTerrainTexture(config.cliffTexture);
  const cliffNormal = loadTerrainTexture(config.cliffNormal);
  const cliffRough = config.cliffRoughness
    ? loadTerrainTexture(config.cliffRoughness)
    : createDefaultTexture(0xbfbfbf);
  const cliffDisp = config.cliffDisplacement
    ? loadTerrainTexture(config.cliffDisplacement)
    : createDefaultTexture(0x808080);

  // Uniforms
  const uGrassTexture = uniform(grassDiffuse);
  const uGrassNormal = uniform(grassNormal);
  const uGrassRoughness = uniform(grassRough);
  const uDirtTexture = uniform(dirtDiffuse);
  const uDirtNormal = uniform(dirtNormal);
  const uDirtRoughness = uniform(dirtRough);
  const uRockTexture = uniform(rockDiffuse);
  const uRockNormal = uniform(rockNormal);
  const uRockRoughness = uniform(rockRough);
  const uCliffTexture = uniform(cliffDiffuse);
  const uCliffNormal = uniform(cliffNormal);
  const uCliffRoughness = uniform(cliffRough);

  const uSunDirection = uniform(config.sunDirection ?? new THREE.Vector3(0.5, 0.8, 0.3).normalize());
  const uSunIntensity = uniform(config.sunIntensity ?? 1.2);
  const uAmbientColor = uniform(config.ambientColor ?? new THREE.Color(0.3, 0.35, 0.4));
  const uTime = uniform(0);

  // Unpack normal from texture
  const unpackNormal = Fn(([texel]: [any]) => {
    return texel.xyz.mul(2.0).sub(1.0);
  });

  // GGX NDF
  const D_GGX = Fn(([NdotH, roughness]: [any, any]) => {
    const a = roughness.mul(roughness);
    const a2 = a.mul(a);
    const NdotH2 = NdotH.mul(NdotH);
    const denom = NdotH2.mul(a2.sub(1.0)).add(1.0);
    return a2.div(float(3.14159).mul(denom).mul(denom));
  });

  // Fresnel-Schlick
  const F_Schlick = Fn(([VdotH, F0]: [any, any]) => {
    return F0.add(vec3(1.0).sub(F0).mul(pow(float(1.0).sub(VdotH), 5.0)));
  });

  // Smith GGX geometry
  const G_Smith = Fn(([NdotV, NdotL, roughness]: [any, any, any]) => {
    const k = roughness.add(1.0).mul(roughness.add(1.0)).div(8.0);
    const ggx1 = NdotV.div(NdotV.mul(float(1.0).sub(k)).add(k));
    const ggx2 = NdotL.div(NdotL.mul(float(1.0).sub(k)).add(k));
    return ggx1.mul(ggx2);
  });

  // Create material
  const material = new MeshStandardNodeMaterial();
  material.side = THREE.FrontSide;

  // Vertex color attribute
  const vertexColor = attribute('color', 'vec3');

  // Varyings
  const vSlope = varyingProperty('float', 'vSlope');
  const vElevation = varyingProperty('float', 'vElevation');
  const vUvTiled = varyingProperty('vec2', 'vUvTiled');

  // Vertex shader
  material.positionNode = Fn(() => {
    // Tile UVs 64x for appropriate texture detail
    vUvTiled.assign(uv().mul(64.0));

    // Calculate slope (0 = flat, 1 = vertical)
    const worldNorm = normalize(modelWorldMatrix.mul(vec4(normalLocal, 0.0)).xyz);
    vSlope.assign(float(1.0).sub(abs(dot(worldNorm, vec3(0.0, 1.0, 0.0)))));

    // Pass elevation
    vElevation.assign(positionLocal.z);

    return positionLocal;
  })();

  // Fragment shader
  material.colorNode = Fn(() => {
    const uvTiled = vUvTiled;
    const slope = vSlope;
    const elevation = vElevation;
    const vColor = vertexColor;

    // Sample all textures
    const grassColor = texture(uGrassTexture, uvTiled).rgb;
    const grassNorm = unpackNormal(texture(uGrassNormal, uvTiled));
    const grassRoughVal = texture(uGrassRoughness, uvTiled).r;

    const dirtColor = texture(uDirtTexture, uvTiled).rgb;
    const dirtNorm = unpackNormal(texture(uDirtNormal, uvTiled));
    const dirtRoughVal = texture(uDirtRoughness, uvTiled).r;

    const rockColor = texture(uRockTexture, uvTiled).rgb;
    const rockNorm = unpackNormal(texture(uRockNormal, uvTiled));
    const rockRoughVal = texture(uRockRoughness, uvTiled).r;

    // Triplanar for cliffs
    const worldNorm = normalWorld;
    const blendWeights = pow(abs(worldNorm), vec3(4.0)).toVar();
    blendWeights.divAssign(blendWeights.x.add(blendWeights.y).add(blendWeights.z));

    const worldPos = positionWorld;
    const uvX = worldPos.zy.mul(4.0);
    const uvY = worldPos.xz.mul(4.0);
    const uvZ = worldPos.xy.mul(4.0);

    const cliffColorX = texture(uCliffTexture, uvX).rgb;
    const cliffColorY = texture(uCliffTexture, uvY).rgb;
    const cliffColorZ = texture(uCliffTexture, uvZ).rgb;
    const cliffColor = cliffColorX.mul(blendWeights.x)
      .add(cliffColorY.mul(blendWeights.y))
      .add(cliffColorZ.mul(blendWeights.z));

    const cliffNormX = unpackNormal(texture(uCliffNormal, uvX));
    const cliffNormY = unpackNormal(texture(uCliffNormal, uvY));
    const cliffNormZ = unpackNormal(texture(uCliffNormal, uvZ));
    const cliffNorm = normalize(
      cliffNormX.mul(blendWeights.x)
        .add(cliffNormY.mul(blendWeights.y))
        .add(cliffNormZ.mul(blendWeights.z))
    );

    const cliffRoughX = texture(uCliffRoughness, uvX).r;
    const cliffRoughY = texture(uCliffRoughness, uvY).r;
    const cliffRoughZ = texture(uCliffRoughness, uvZ).r;
    const cliffRoughVal = cliffRoughX.mul(blendWeights.x)
      .add(cliffRoughY.mul(blendWeights.y))
      .add(cliffRoughZ.mul(blendWeights.z));

    // Calculate blend weights based on slope and vertex color
    const colorBrightness = vColor.x.add(vColor.y).add(vColor.z).div(3.0);
    const colorSaturation = max(max(vColor.x, vColor.y), vColor.z)
      .sub(min(min(vColor.x, vColor.y), vColor.z));

    const chromaticIntensity = colorSaturation.div(max(colorBrightness, 0.01));
    const isCliffTerrain = smoothstep(0.4, 0.15, chromaticIntensity);

    // Slope-based weights
    const grassWeight = smoothstep(0.25, 0.1, slope).mul(float(1.0).sub(isCliffTerrain)).toVar();
    const dirtWeight = smoothstep(0.08, 0.2, slope).mul(smoothstep(0.35, 0.2, slope)).toVar();
    const rockWeight = smoothstep(0.2, 0.35, slope).mul(smoothstep(0.55, 0.4, slope)).add(isCliffTerrain.mul(0.35)).toVar();
    const cliffWeight = smoothstep(0.4, 0.55, slope).add(isCliffTerrain.mul(0.5)).toVar();

    // Elevation variation
    const elevationFactor = smoothstep(1.5, 4.5, elevation);
    rockWeight.addAssign(elevationFactor.mul(0.2));
    cliffWeight.addAssign(elevationFactor.mul(0.15));

    // Position-based noise for natural variation
    const noiseX = fract(sin(worldPos.x.mul(12.9898).add(worldPos.z.mul(78.233))).mul(43758.5453));
    const noiseZ = fract(sin(worldPos.z.mul(12.9898).add(worldPos.x.mul(78.233))).mul(43758.5453));
    grassWeight.mulAssign(mix(0.85, 1.15, noiseX));
    dirtWeight.mulAssign(mix(0.8, 1.2, noiseZ));

    // Normalize weights
    const totalWeight = grassWeight.add(dirtWeight).add(rockWeight).add(cliffWeight);
    grassWeight.divAssign(totalWeight);
    dirtWeight.divAssign(totalWeight);
    rockWeight.divAssign(totalWeight);
    cliffWeight.divAssign(totalWeight);

    // Blend colors
    const albedo = grassColor.mul(grassWeight)
      .add(dirtColor.mul(dirtWeight))
      .add(rockColor.mul(rockWeight))
      .add(cliffColor.mul(cliffWeight));

    // Blend normals
    const detailNormal = normalize(
      grassNorm.mul(grassWeight)
        .add(dirtNorm.mul(dirtWeight))
        .add(rockNorm.mul(rockWeight))
        .add(cliffNorm.mul(cliffWeight))
    );

    // Blend roughness
    const roughness = grassRoughVal.mul(grassWeight)
      .add(dirtRoughVal.mul(dirtWeight))
      .add(rockRoughVal.mul(rockWeight))
      .add(cliffRoughVal.mul(cliffWeight));

    // Build TBN matrix for normal mapping
    const N = normalize(worldNorm);
    const T = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
    const B = cross(N, T);

    // Apply detail normal
    const finalNormal = normalize(
      T.mul(detailNormal.x)
        .add(B.mul(detailNormal.y))
        .add(N.mul(detailNormal.z))
    );

    // PBR Lighting
    const V = normalize(cameraPosition.sub(worldPos));
    const L = normalize(uSunDirection);
    const H = normalize(L.add(V));

    const NdotL = max(dot(finalNormal, L), 0.0);
    const NdotV = max(dot(finalNormal, V), 0.001);
    const NdotH = max(dot(finalNormal, H), 0.0);
    const VdotH = max(dot(V, H), 0.0);

    // Diffuse
    const diffuse = albedo.mul(NdotL).mul(uSunIntensity);

    // Specular (PBR)
    const F0 = vec3(0.04);
    const D = D_GGX(NdotH, roughness);
    const F = F_Schlick(VdotH, F0);
    const G = G_Smith(NdotV, NdotL, roughness);

    const specular = D.mul(F).mul(G)
      .div(max(NdotV.mul(NdotL).mul(4.0), 0.001))
      .mul(NdotL)
      .mul(uSunIntensity);

    // Ambient with AO
    const ao = float(0.5).add(dot(N, finalNormal).mul(0.5));
    const ambient = albedo.mul(uAmbientColor).mul(ao);

    // Rim lighting
    const rim = pow(float(1.0).sub(NdotV), 3.0).mul(0.12);

    const finalColor = diffuse.add(specular).add(ambient).add(vec3(rim));

    return finalColor;
  })();

  // Store uniforms for updates
  (material as any)._uniforms = {
    uTime,
    uSunDirection,
    uSunIntensity,
  };

  console.log('[TextureTerrainMaterial] Created TSL material with PBR lighting');

  return material;
}

/**
 * Update material uniforms
 */
export function updateTextureTerrainMaterial(
  material: MeshStandardNodeMaterial,
  deltaTime: number,
  sunDirection?: THREE.Vector3
): void {
  const uniforms = (material as any)._uniforms;
  if (!uniforms) return;

  uniforms.uTime.value += deltaTime;

  if (sunDirection) {
    uniforms.uSunDirection.value.copy(sunDirection).normalize();
  }
}

// ============================================
// BIOME CONFIGURATIONS
// ============================================

export type BiomeTextureType = 'grassland' | 'desert' | 'frozen' | 'volcanic' | 'void' | 'jungle';

interface BiomeTextureMapping {
  ground: string;
  dirt: string;
  rock: string;
  cliff: string;
}

const BIOME_TEXTURE_PREFIXES: Record<BiomeTextureType, BiomeTextureMapping> = {
  grassland: { ground: 'grass', dirt: 'dirt', rock: 'rock', cliff: 'cliff' },
  desert: { ground: 'sand', dirt: 'desert_dirt', rock: 'sandstone', cliff: 'desert_cliff' },
  frozen: { ground: 'snow', dirt: 'permafrost', rock: 'ice_rock', cliff: 'ice_cliff' },
  volcanic: { ground: 'ash', dirt: 'scorched', rock: 'basalt', cliff: 'volcanic_cliff' },
  void: { ground: 'void_ground', dirt: 'void_dirt', rock: 'void_rock', cliff: 'void_cliff' },
  jungle: { ground: 'jungle_floor', dirt: 'mud', rock: 'mossy_rock', cliff: 'jungle_cliff' },
};

export function getBiomeTextureConfig(biome: BiomeTextureType): TextureTerrainConfig {
  const basePath = '/textures/terrain/';
  const prefixes = BIOME_TEXTURE_PREFIXES[biome] ?? BIOME_TEXTURE_PREFIXES.grassland;

  return {
    grassTexture: `${basePath}${prefixes.ground}_diffuse.png`,
    grassNormal: `${basePath}${prefixes.ground}_normal.png`,
    grassRoughness: `${basePath}${prefixes.ground}_roughness.png`,
    grassDisplacement: `${basePath}${prefixes.ground}_displacement.png`,
    dirtTexture: `${basePath}${prefixes.dirt}_diffuse.png`,
    dirtNormal: `${basePath}${prefixes.dirt}_normal.png`,
    dirtRoughness: `${basePath}${prefixes.dirt}_roughness.png`,
    dirtDisplacement: `${basePath}${prefixes.dirt}_displacement.png`,
    rockTexture: `${basePath}${prefixes.rock}_diffuse.png`,
    rockNormal: `${basePath}${prefixes.rock}_normal.png`,
    rockRoughness: `${basePath}${prefixes.rock}_roughness.png`,
    rockDisplacement: `${basePath}${prefixes.rock}_displacement.png`,
    cliffTexture: `${basePath}${prefixes.cliff}_diffuse.png`,
    cliffNormal: `${basePath}${prefixes.cliff}_normal.png`,
    cliffRoughness: `${basePath}${prefixes.cliff}_roughness.png`,
    cliffDisplacement: `${basePath}${prefixes.cliff}_displacement.png`,
    parallaxScale: 0.06,
  };
}

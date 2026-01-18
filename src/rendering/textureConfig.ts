/**
 * Shared Texture Configuration
 *
 * Centralized texture configuration types and biome mappings
 * used by both WebGL (TextureTerrainShader) and WebGPU (TextureTerrainMaterial).
 */

import * as THREE from 'three';

// ============================================
// CONFIGURATION TYPES
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

// All biome textures are available
const AVAILABLE_BIOME_TEXTURES: Set<BiomeTextureType> = new Set([
  'grassland',
  'desert',
  'frozen',
  'volcanic',
  'void',
  'jungle',
]);

/**
 * Register a biome's textures as available.
 */
export function registerBiomeTextures(biome: BiomeTextureType): void {
  AVAILABLE_BIOME_TEXTURES.add(biome);
}

/**
 * Check if a biome has its textures available.
 */
export function hasBiomeTextures(biome: BiomeTextureType): boolean {
  return AVAILABLE_BIOME_TEXTURES.has(biome);
}

/**
 * Get texture configuration for a specific biome.
 * Falls back to grassland if biome textures aren't available.
 */
export function getBiomeTextureConfig(biome: BiomeTextureType): TextureTerrainConfig {
  const basePath = '/textures/terrain/';
  const effectiveBiome = AVAILABLE_BIOME_TEXTURES.has(biome) ? biome : 'grassland';
  const prefixes = BIOME_TEXTURE_PREFIXES[effectiveBiome];

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

/**
 * Get the list of texture files needed for a biome.
 */
export function getBiomeTextureFiles(biome: BiomeTextureType): string[] {
  const basePath = '/textures/terrain/';
  const prefixes = BIOME_TEXTURE_PREFIXES[biome];
  const types = ['diffuse', 'normal', 'roughness', 'displacement'];
  const files: string[] = [];

  for (const material of [prefixes.ground, prefixes.dirt, prefixes.rock, prefixes.cliff]) {
    for (const type of types) {
      files.push(`${basePath}${material}_${type}.png`);
    }
  }

  return files;
}

/**
 * Get default (grassland) texture configuration.
 */
export function getDefaultTextureConfig(): TextureTerrainConfig {
  return getBiomeTextureConfig('grassland');
}

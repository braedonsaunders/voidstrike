/**
 * TSL Water Material
 *
 * WebGPU-compatible water material using physically-based rendering.
 * Designed to work with UnifiedWaterMesh.
 *
 * Features:
 * - Animated multi-layer normal maps for wave detail
 * - Depth-based shallow/deep color blending
 * - Quality-scaled wave distortion
 * - PBR fresnel and specular via MeshStandardNodeMaterial
 *
 * Architecture:
 * - Uses MeshStandardNodeMaterial for consistent PBR rendering
 * - colorNode provides BASE color only (no manual lighting)
 * - normalNode provides normals in [0,1] encoded range (TSL convention)
 * - PBR pipeline handles fresnel, specular, environment reflections
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
  positionWorld,
  normalize,
  clamp,
  mix,
  sin,
  cos,
  attribute,
  time,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { WaterQuality } from '@/rendering/water/UnifiedWaterMesh';

/**
 * Configuration for creating a TSL water material
 */
export interface WaterMaterialConfig {
  /** Water quality tier - affects wave detail and animation */
  quality: WaterQuality;
  /** Sun/light direction (used for environment, not manual specular) */
  sunDirection: THREE.Vector3;
  /** Shallow water color */
  shallowColor: THREE.Color;
  /** Deep water color */
  deepColor: THREE.Color;
  /** Normal map texture for surface detail */
  normalMap?: THREE.Texture | null;
  /** Environment map for reflections */
  envMap?: THREE.CubeTexture | null;
  /** Optional reflection texture from PlanarReflection */
  reflectionTexture?: THREE.Texture | null;
  /** Time scale for animation speed (default: 1.0) */
  timeScale?: number;
}

/**
 * Quality-based configuration for water rendering
 *
 * Uses PBR properties - fresnel is handled automatically via IOR.
 * Water IOR = 1.33 gives physically-correct fresnel response:
 * - 0° (looking down): ~2% reflectance
 * - 90° (grazing): ~100% reflectance
 */
interface QualitySettings {
  /** Wave amplitude for vertex displacement (if used) */
  waveAmplitude: number;
  /** Wave animation speed multiplier */
  waveFrequency: number;
  /** Texture size - larger = coarser waves */
  textureSize: number;
  /** Normal distortion intensity (0.3-0.85) */
  distortionScale: number;
  /** Surface roughness (lower = sharper reflections) */
  roughness: number;
  /** Water opacity (0-1) */
  opacity: number;
}

const QUALITY_SETTINGS: Record<WaterQuality, QualitySettings> = {
  low: {
    waveAmplitude: 0.02,
    waveFrequency: 1.0,
    textureSize: 50.0,
    distortionScale: 0.3,
    roughness: 0.25,
    opacity: 0.85,
  },
  medium: {
    waveAmplitude: 0.04,
    waveFrequency: 1.5,
    textureSize: 40.0,
    distortionScale: 0.5,
    roughness: 0.18,
    opacity: 0.88,
  },
  high: {
    waveAmplitude: 0.06,
    waveFrequency: 2.0,
    textureSize: 30.0,
    distortionScale: 0.7,
    roughness: 0.12,
    opacity: 0.9,
  },
  ultra: {
    waveAmplitude: 0.08,
    waveFrequency: 2.5,
    textureSize: 25.0,
    distortionScale: 0.85,
    roughness: 0.08,
    opacity: 0.92,
  },
};

/**
 * TSL Water Material class
 * Provides animated water surface with physically-based rendering
 */
export class TSLWaterMaterial {
  public material: MeshStandardNodeMaterial;

  // Uniforms for runtime updates
  private uTimeScale = uniform(1.0);
  private uShallowColor = uniform(new THREE.Color(0x40a0c0));
  private uDeepColor = uniform(new THREE.Color(0x004488));
  private uDistortionScale = uniform(0.7);
  private uRoughness = uniform(0.12);
  private uOpacity = uniform(0.9);

  // Store textures for disposal
  private textures: THREE.Texture[] = [];
  private quality: WaterQuality;

  constructor(config: WaterMaterialConfig) {
    this.quality = config.quality;
    const settings = QUALITY_SETTINGS[config.quality];

    // Set initial uniform values
    this.uShallowColor.value.copy(config.shallowColor);
    this.uDeepColor.value.copy(config.deepColor);
    this.uDistortionScale.value = settings.distortionScale;
    this.uRoughness.value = settings.roughness;
    this.uOpacity.value = settings.opacity;
    this.uTimeScale.value = config.timeScale ?? 1.0;

    // Track textures for disposal
    if (config.normalMap) {
      this.textures.push(config.normalMap);
    }

    this.material = this.createMaterial(config, settings);
  }

  private createMaterial(
    config: WaterMaterialConfig,
    settings: QualitySettings
  ): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();

    // Scaled time for animation
    const scaledTime = time.mul(this.uTimeScale);

    // =========================================================================
    // COLOR NODE - Base water color with opacity, NO manual lighting
    // PBR pipeline handles fresnel, specular, environment reflections
    // =========================================================================
    const colorNode = Fn(() => {
      // Simple solid color test - if this doesn't render, the issue is elsewhere
      // TODO: Restore full color logic once basic rendering works
      return vec4(0.2, 0.5, 0.7, 0.9); // Solid blue-ish with 90% opacity
    })();

    // =========================================================================
    // NORMAL NODE - Simplified flat normal for testing
    // TSL normalNode expects [0,1] encoded normals (same as normal map textures)
    // =========================================================================
    const normalNode = Fn(() => {
      // Simple flat normal pointing up - encoded to [0,1] range
      // Normal (0, 0, 1) encodes to (0.5, 0.5, 1.0)
      return vec3(0.5, 0.5, 1.0);
    })();

    // =========================================================================
    // ROUGHNESS NODE - Simple constant for testing
    // =========================================================================
    const roughnessNode = float(0.15);

    // =========================================================================
    // MATERIAL CONFIGURATION
    // =========================================================================
    material.colorNode = colorNode;
    material.normalNode = normalNode;
    material.roughnessNode = roughnessNode;

    // Water is a dielectric (non-metallic)
    material.metalnessNode = float(0.0);

    // Transparent rendering with proper depth handling
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
    material.depthTest = true;

    return material;
  }

  /**
   * Update time-based animation (currently handled by TSL time node)
   */
  public update(_deltaTime: number): void {
    // Time is handled by the TSL `time` node automatically
    // This method kept for API compatibility
  }

  /**
   * Set sun direction for environment lighting
   */
  public setSunDirection(_direction: THREE.Vector3): void {
    // Sun direction affects scene lighting, not the material directly
    // PBR handles this via the scene's directional light
  }

  /**
   * Set water colors
   */
  public setColors(shallow: THREE.Color, deep: THREE.Color): void {
    this.uShallowColor.value.copy(shallow);
    this.uDeepColor.value.copy(deep);
  }

  /**
   * Set quality settings
   */
  public setQuality(quality: WaterQuality): void {
    this.quality = quality;
    const settings = QUALITY_SETTINGS[quality];
    this.uDistortionScale.value = settings.distortionScale;
    this.uRoughness.value = settings.roughness;
    this.uOpacity.value = settings.opacity;
  }

  /**
   * Set time scale for animation speed
   */
  public setTimeScale(scale: number): void {
    this.uTimeScale.value = scale;
  }

  /**
   * Get the underlying Three.js material
   */
  public getMaterial(): MeshStandardNodeMaterial {
    return this.material;
  }

  /**
   * Dispose all resources
   */
  public dispose(): void {
    this.textures.forEach((tex) => tex.dispose());
    this.material.dispose();
  }
}

/**
 * Create a TSL water material with the specified configuration
 */
export function createWaterMaterial(config: WaterMaterialConfig): TSLWaterMaterial {
  return new TSLWaterMaterial(config);
}

/**
 * Update the water material's time uniform
 */
export function updateWaterMaterial(material: TSLWaterMaterial, deltaTime: number): void {
  material.update(deltaTime);
}

/**
 * Load water normals texture
 * Caches the texture for reuse across multiple materials
 */
let cachedWaterNormalsTexture: THREE.Texture | null = null;
let textureLoadPromise: Promise<THREE.Texture> | null = null;

export async function loadWaterNormalsTexture(): Promise<THREE.Texture> {
  if (cachedWaterNormalsTexture) {
    return cachedWaterNormalsTexture;
  }

  if (textureLoadPromise) {
    return textureLoadPromise;
  }

  textureLoadPromise = new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      '/textures/waternormals.jpg',
      (loadedTexture: THREE.Texture) => {
        loadedTexture.wrapS = THREE.RepeatWrapping;
        loadedTexture.wrapT = THREE.RepeatWrapping;
        loadedTexture.minFilter = THREE.LinearMipmapLinearFilter;
        loadedTexture.magFilter = THREE.LinearFilter;
        loadedTexture.generateMipmaps = true;
        cachedWaterNormalsTexture = loadedTexture;
        resolve(loadedTexture);
      },
      undefined,
      () => {
        // On error, return a generated fallback texture
        const fallback = generateFallbackNormals();
        cachedWaterNormalsTexture = fallback;
        resolve(fallback);
      }
    );
  });

  return textureLoadPromise;
}

/**
 * Get the cached water normals texture synchronously
 */
export function getWaterNormalsTextureSync(): THREE.Texture | null {
  return cachedWaterNormalsTexture;
}

/**
 * Generate fallback water normals texture
 * Normals are stored in [0,1] texture encoding (shader decodes to [-1,1])
 */
function generateFallbackNormals(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size;
      const v = y / size;

      // Wave patterns
      let nx = Math.sin(u * 8 * Math.PI + v * 4 * Math.PI) * 0.3;
      nx += Math.sin(u * 16 * Math.PI - v * 12 * Math.PI) * 0.2;
      let ny = Math.cos(u * 6 * Math.PI + v * 8 * Math.PI) * 0.3;
      ny += Math.cos(u * 14 * Math.PI + v * 18 * Math.PI) * 0.2;

      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      // Encode to [0,1] for texture storage
      data[idx] = Math.floor(((nx / len) * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor(((ny / len) * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor(((nz / len) * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  const fallbackTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  fallbackTexture.wrapS = THREE.RepeatWrapping;
  fallbackTexture.wrapT = THREE.RepeatWrapping;
  fallbackTexture.needsUpdate = true;
  return fallbackTexture;
}

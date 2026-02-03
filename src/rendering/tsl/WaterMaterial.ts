/* eslint-disable @typescript-eslint/no-explicit-any -- TSL shader nodes use polymorphic types */
/**
 * TSL Water Material
 *
 * WebGPU-compatible water material using physically-based rendering.
 * Designed to work with UnifiedWaterMesh.
 *
 * Features:
 * - Physically-correct fresnel via IOR (no manual calculation)
 * - Animated multi-layer normal maps for wave detail
 * - Depth-based shallow/deep color blending
 * - Quality-scaled wave distortion
 *
 * Architecture:
 * - Uses MeshPhysicalNodeMaterial for proper PBR with IOR support
 * - colorNode provides BASE color only (no manual lighting)
 * - normalNode provides actual normals in [-1,1] range
 * - PBR pipeline handles fresnel, specular, environment reflections
 */

import * as THREE from 'three';
import {
  Fn,
  vec2,
  vec3,
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
  type ShaderNodeObject,
} from 'three/tsl';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
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
}

const QUALITY_SETTINGS: Record<WaterQuality, QualitySettings> = {
  low: {
    waveAmplitude: 0.02,
    waveFrequency: 1.0,
    textureSize: 50.0,
    distortionScale: 0.3,
    roughness: 0.25,
  },
  medium: {
    waveAmplitude: 0.04,
    waveFrequency: 1.5,
    textureSize: 40.0,
    distortionScale: 0.5,
    roughness: 0.18,
  },
  high: {
    waveAmplitude: 0.06,
    waveFrequency: 2.0,
    textureSize: 30.0,
    distortionScale: 0.7,
    roughness: 0.12,
  },
  ultra: {
    waveAmplitude: 0.08,
    waveFrequency: 2.5,
    textureSize: 25.0,
    distortionScale: 0.85,
    roughness: 0.08,
  },
};

// Water Index of Refraction - physically correct value
const WATER_IOR = 1.33;

/**
 * TSL Water Material class
 * Provides animated water surface with physically-based rendering
 */
export class TSLWaterMaterial {
  public material: MeshPhysicalNodeMaterial;

  // Uniforms for runtime updates
  private uTimeScale = uniform(1.0);
  private uShallowColor = uniform(new THREE.Color(0x40a0c0));
  private uDeepColor = uniform(new THREE.Color(0x004488));
  private uDistortionScale = uniform(0.7);
  private uRoughness = uniform(0.12);

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
  ): MeshPhysicalNodeMaterial {
    // Use MeshPhysicalNodeMaterial for IOR support (proper fresnel)
    const material = new MeshPhysicalNodeMaterial();

    // Scaled time for animation
    const scaledTime = time.mul(this.uTimeScale);

    // =========================================================================
    // COLOR NODE - Base water color only, NO manual lighting
    // PBR pipeline handles fresnel, specular, environment reflections
    // =========================================================================
    const colorNode = Fn(() => {
      // Get depth from vertex attribute (0 = shallow, 1 = deep)
      const waterData = attribute('aWaterData', 'vec3');
      const depthFactor = waterData.y;

      // Base color blend between shallow and deep
      const baseColor = mix(this.uShallowColor, this.uDeepColor, depthFactor);

      // Subtle procedural color variation for natural look
      const worldPos = positionWorld;
      const phase1 = worldPos.x.mul(0.08).add(worldPos.z.mul(0.12)).add(scaledTime.mul(0.25));
      const phase2 = worldPos.x.mul(0.15).sub(worldPos.z.mul(0.1)).add(scaledTime.mul(0.15));
      const variation = sin(phase1).mul(0.015).add(sin(phase2).mul(0.01)).add(1.0);

      return baseColor.mul(variation);
    })();

    // =========================================================================
    // NORMAL NODE - Returns actual normals in [-1,1] range
    // NO .mul(0.5).add(0.5) encoding - that's for textures, not normalNode
    // =========================================================================
    const normalNode = Fn(() => {
      const worldUV = uv();
      const distortion = this.uDistortionScale;

      if (!config.normalMap) {
        // Procedural multi-scale wave normals
        const uvScale = float(1.0 / settings.textureSize);
        const scaledX = worldUV.x.mul(uvScale);
        const scaledY = worldUV.y.mul(uvScale);

        // Three wave layers at different frequencies for natural look
        const wave1 = sin(scaledX.mul(50.0).add(scaledTime.mul(1.2))).mul(
          cos(scaledY.mul(40.0).add(scaledTime.mul(0.8)))
        );
        const wave2 = sin(scaledX.mul(100.0).sub(scaledTime.mul(0.9))).mul(
          cos(scaledY.mul(80.0).add(scaledTime.mul(1.1)))
        );
        const wave3 = sin(scaledX.mul(25.0).add(scaledY.mul(30.0)).add(scaledTime.mul(0.5)));

        // Combine waves with distortion scaling
        const nx = wave1.mul(0.025).add(wave2.mul(0.012)).mul(distortion);
        const ny = wave2.mul(0.025).add(wave3.mul(0.012)).mul(distortion);
        const nz = float(1.0);

        // Return actual normal vector in [-1,1] range
        return normalize(vec3(nx, ny, nz));
      }

      // Texture-based normals with two scrolling layers
      const texScale = float(1.0 / settings.textureSize);
      const scroll1 = scaledTime.mul(0.03);
      const scroll2 = scaledTime.mul(0.02);

      // Layer 1: Primary wave direction
      const uv1 = vec2(
        worldUV.x.mul(texScale).add(scroll1),
        worldUV.y.mul(texScale).add(scroll1.mul(0.8))
      );

      // Layer 2: Secondary wave at different angle and scale
      const texScale2 = texScale.mul(0.5);
      const uv2 = vec2(
        worldUV.x.mul(texScale2).sub(scroll2.mul(0.7)),
        worldUV.y.mul(texScale2).add(scroll2)
      );

      // Sample and decode normal maps (textures are [0,1] encoded)
      const normal1 = texture(config.normalMap!, uv1).rgb.mul(2.0).sub(1.0);
      const normal2 = texture(config.normalMap!, uv2).rgb.mul(2.0).sub(1.0);

      // Blend normals using partial derivative method
      const blendedXY = normal1.xy.add(normal2.xy);
      const blendedZ = normal1.z.mul(normal2.z);
      const blended = normalize(vec3(blendedXY.x, blendedXY.y, blendedZ));

      // Apply distortion scale
      const scaled = vec3(
        blended.x.mul(distortion),
        blended.y.mul(distortion),
        blended.z
      );

      // Return actual normal vector in [-1,1] range
      return normalize(scaled);
    })();

    // =========================================================================
    // ROUGHNESS NODE - Low for reflective water, with subtle sparkle
    // =========================================================================
    const roughnessNode = Fn(() => {
      const worldPos = positionWorld;
      // Subtle sparkle variation
      const sparkle = sin(worldPos.x.mul(8.0).add(scaledTime.mul(4.0)))
        .mul(sin(worldPos.z.mul(8.0).sub(scaledTime.mul(3.0))))
        .mul(0.03);

      return clamp(this.uRoughness.add(sparkle), 0.02, 0.35);
    })();

    // =========================================================================
    // MATERIAL CONFIGURATION
    // =========================================================================
    material.colorNode = colorNode;
    material.normalNode = normalNode;
    material.roughnessNode = roughnessNode;

    // Water is a dielectric (non-metallic)
    material.metalnessNode = float(0.0);

    // IOR for physically-correct fresnel (water = 1.33)
    // This replaces manual fresnel calculation entirely
    material.iorNode = float(WATER_IOR);

    // Optional: slight specular tint for ocean water
    material.specularColorNode = vec3(0.95, 0.97, 1.0);

    // Environment map for reflections (if provided)
    if (config.envMap) {
      material.envMap = config.envMap;
      material.envMapIntensity = 0.8;
    }

    // Opaque rendering for proper depth sorting with terrain
    material.transparent = false;
    material.side = THREE.FrontSide; // Water viewed from above
    material.depthWrite = true;
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
  public getMaterial(): MeshPhysicalNodeMaterial {
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

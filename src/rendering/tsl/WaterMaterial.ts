/* eslint-disable @typescript-eslint/no-explicit-any -- TSL shader nodes use polymorphic types */
/**
 * TSL Water Material
 *
 * WebGPU-compatible water material with procedural waves, depth-based coloring,
 * and optional reflections. Designed to work with UnifiedWaterMesh.
 *
 * Features:
 * - Procedural Gerstner wave animation
 * - Depth-based shallow/deep color blending (via vertex attribute)
 * - Normal map animation for surface detail
 * - Fresnel reflections with optional environment map
 * - Quality-based feature scaling
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
  type ShaderNodeObject,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { WaterQuality } from '@/rendering/water/UnifiedWaterMesh';

/**
 * Configuration for creating a TSL water material
 */
export interface WaterMaterialConfig {
  /** Water quality tier - affects wave detail and animation */
  quality: WaterQuality;
  /** Sun/light direction for specular highlights */
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
 * textureSize matches the original WaterMesh addon's `size` parameter:
 * - Higher values = larger/coarser waves (texture stretched more)
 * - Lower values = smaller/finer waves (texture repeated more)
 *
 * distortionScale controls the wave normal intensity
 */
interface QualitySettings {
  waveAmplitude: number;
  waveFrequency: number;
  /** Texture size - matches original WaterMesh 'size' (25-50 range) */
  textureSize: number;
  /** Distortion scale - matches original WaterMesh 'distortionScale' */
  distortionScale: number;
  fresnelPower: number;
  reflectionStrength: number;
  opacity: number;
}

const QUALITY_SETTINGS: Record<WaterQuality, QualitySettings> = {
  low: {
    waveAmplitude: 0.02,
    waveFrequency: 1.0,
    textureSize: 50.0,      // Coarser waves, calmer appearance
    distortionScale: 0.3,   // Reduced - prevents overly strong normal perturbation
    fresnelPower: 2.0,      // Not used (PBR handles fresnel)
    reflectionStrength: 0.2, // Not used (PBR handles reflections)
    opacity: 0.85,
  },
  medium: {
    waveAmplitude: 0.04,
    waveFrequency: 1.5,
    textureSize: 40.0,
    distortionScale: 0.4,   // Reduced
    fresnelPower: 3.0,      // Not used
    reflectionStrength: 0.3, // Not used
    opacity: 0.88,
  },
  high: {
    waveAmplitude: 0.06,
    waveFrequency: 2.0,
    textureSize: 30.0,
    distortionScale: 0.5,   // Reduced - was 1.0
    fresnelPower: 4.0,      // Not used
    reflectionStrength: 0.4, // Not used
    opacity: 0.9,
  },
  ultra: {
    waveAmplitude: 0.08,
    waveFrequency: 2.5,
    textureSize: 25.0,      // Finer waves, more visible detail
    distortionScale: 0.6,   // Reduced - was 1.25
    fresnelPower: 5.0,      // Not used
    reflectionStrength: 0.5, // Not used
    opacity: 0.92,
  },
};

/**
 * TSL Water Material class
 * Provides animated water surface with depth-based coloring and reflections
 */
export class TSLWaterMaterial {
  public material: MeshStandardNodeMaterial;

  // Uniforms for runtime updates
  private uTime = uniform(0);
  private uTimeScale = uniform(1.0);
  private uSunDirection = uniform(new THREE.Vector3(0.5, 0.8, 0.5).normalize());
  private uShallowColor = uniform(new THREE.Color(0x40a0c0));
  private uDeepColor = uniform(new THREE.Color(0x004488));
  private uWaveAmplitude = uniform(0.06);
  private uWaveFrequency = uniform(2.0);
  private uFresnelPower = uniform(4.0);
  private uReflectionStrength = uniform(0.3);
  private uOpacity = uniform(0.9);
  // Quality-dependent uniforms (must be uniforms to allow runtime quality changes)
  private uDistortionScale = uniform(0.5);
  private uTextureScale = uniform(1.0 / 30.0); // 1/textureSize
  private uBaseRoughness = uniform(0.3);

  // Store textures for disposal
  private textures: THREE.Texture[] = [];
  private quality: WaterQuality;

  constructor(config: WaterMaterialConfig) {
    this.quality = config.quality;
    const settings = QUALITY_SETTINGS[config.quality];

    // Set initial uniform values
    this.uSunDirection.value.copy(config.sunDirection);
    this.uShallowColor.value.copy(config.shallowColor);
    this.uDeepColor.value.copy(config.deepColor);
    this.uWaveAmplitude.value = settings.waveAmplitude;
    this.uWaveFrequency.value = settings.waveFrequency;
    this.uFresnelPower.value = settings.fresnelPower;
    this.uReflectionStrength.value = settings.reflectionStrength;
    this.uOpacity.value = settings.opacity;
    this.uTimeScale.value = config.timeScale ?? 1.0;
    // Quality-dependent uniforms
    this.uDistortionScale.value = settings.distortionScale;
    this.uTextureScale.value = 1.0 / settings.textureSize;
    this.uBaseRoughness.value = this.getBaseRoughness(config.quality);

    // Track textures for disposal
    if (config.normalMap) {
      this.textures.push(config.normalMap);
    }

    this.material = this.createMaterial(config, settings);
  }

  private createMaterial(
    config: WaterMaterialConfig,
    _settings: QualitySettings
  ): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();

    // Get scaled time for animations
    const scaledTime = time.mul(this.uTimeScale);

    // Water data attribute: vec3(regionId, isDeep, elevation)
    // isDeep: 0 = shallow, 1 = deep
    const hasWaterDataAttr = true; // UnifiedWaterMesh always provides this

    // Color node - depth-based color blending with procedural variation
    // Note: We intentionally do NOT add manual specular/fresnel here because
    // MeshStandardNodeMaterial already applies PBR lighting. Adding them manually
    // causes double-lighting and white-out at certain camera angles.
    const colorNode = Fn(() => {
      const worldPos = positionWorld;

      // Get depth from vertex attribute (0 = shallow, 1 = deep)
      let depthFactor: ShaderNodeObject<any>;
      if (hasWaterDataAttr) {
        const waterData = attribute('aWaterData', 'vec3');
        depthFactor = waterData.y; // isDeep component (0 or 1)
      } else {
        depthFactor = float(0.5); // Fallback to mid-blend
      }

      // Add noise-based edge softening to break up the harsh shallow/deep boundary
      // This creates a more natural, organic transition between water depths
      const noiseScale = 0.15; // Controls the scale of the noise pattern
      const noisePhase1 = worldPos.x.mul(noiseScale).add(worldPos.z.mul(noiseScale * 1.3));
      const noisePhase2 = worldPos.x.mul(noiseScale * 0.7).sub(worldPos.z.mul(noiseScale * 0.9));
      const edgeNoise = sin(noisePhase1.mul(8.0).add(scaledTime.mul(0.1)))
        .mul(cos(noisePhase2.mul(6.0).sub(scaledTime.mul(0.08))))
        .mul(0.3); // Noise amplitude

      // Blend the depth factor with noise to soften edges
      // Clamp to ensure we stay in 0-1 range
      const softDepthFactor = clamp(depthFactor.add(edgeNoise), 0.0, 1.0);

      // Base color blend between shallow and deep with softened transition
      const baseColor = mix(this.uShallowColor, this.uDeepColor, softDepthFactor);

      // Add subtle wave-based color variation (purely aesthetic, not lighting)
      const wavePhase = worldPos.x.mul(0.1).add(worldPos.z.mul(0.15)).add(scaledTime.mul(0.3));
      const colorWave = sin(wavePhase).mul(0.02).add(1.0);
      const variedColor = baseColor.mul(colorWave);

      // Let MeshStandardNodeMaterial handle all specular, fresnel, and reflections
      // via its built-in PBR lighting model (controlled by roughness/metalness)
      return vec4(variedColor, this.uOpacity);
    })();

    // Normal node - animated normal map for surface detail
    // Uses texture-based normals matching the original WaterMesh addon
    // IMPORTANT: normalNode expects normals in -1..1 range (NOT 0-1 texture encoding)
    const normalNode = Fn(() => {
      // Get world-space UV from geometry (1:1 world coordinates)
      const worldUV = uv();

      if (!config.normalMap) {
        // Procedural fallback - multi-scale wave normals
        // Use uniform for texture scale to support runtime quality changes
        const scaledX = worldUV.x.mul(this.uTextureScale);
        const scaledY = worldUV.y.mul(this.uTextureScale);

        // Multi-scale wave normals
        const wave1 = sin(scaledX.mul(50.0).add(scaledTime.mul(1.2)))
          .mul(cos(scaledY.mul(40.0).add(scaledTime.mul(0.8))));
        const wave2 = sin(scaledX.mul(100.0).sub(scaledTime.mul(0.9)))
          .mul(cos(scaledY.mul(80.0).add(scaledTime.mul(1.1))));
        const wave3 = sin(scaledX.mul(25.0).add(scaledY.mul(30.0)).add(scaledTime.mul(0.5)));

        // Use uniform for distortion to support runtime quality changes
        const nx = wave1.mul(0.03).add(wave2.mul(0.015)).mul(this.uDistortionScale);
        const ny = wave2.mul(0.03).add(wave3.mul(0.015)).mul(this.uDistortionScale);
        const nz = float(1.0);

        // Return normalized vector in -1..1 range (world-space normal)
        return normalize(vec3(nx, ny, nz));
      }

      // TEXTURE-BASED NORMALS - matches original WaterMesh addon
      // Use uniform for texture scale to support runtime quality changes
      const texScale = this.uTextureScale;

      // Two scrolling normal map layers at different scales and speeds
      // This creates the characteristic animated water surface
      const scroll1 = scaledTime.mul(0.03);  // Layer 1 scroll speed
      const scroll2 = scaledTime.mul(0.02);  // Layer 2 scroll speed (slower)

      // Layer 1: Primary wave direction
      const uv1 = vec2(
        worldUV.x.mul(texScale).add(scroll1),
        worldUV.y.mul(texScale).add(scroll1.mul(0.8))
      );

      // Layer 2: Secondary wave at different angle and scale
      const texScale2 = texScale.mul(0.5);  // Larger waves for layer 2
      const uv2 = vec2(
        worldUV.x.mul(texScale2).sub(scroll2.mul(0.7)),
        worldUV.y.mul(texScale2).add(scroll2)
      );

      // Sample normal map at both UVs (texture stores 0-1, convert to -1..1)
      const normal1 = texture(config.normalMap!, uv1).rgb.mul(2.0).sub(1.0);
      const normal2 = texture(config.normalMap!, uv2).rgb.mul(2.0).sub(1.0);

      // Blend normals using partial derivative blending (better than simple add)
      // This preserves detail from both layers
      const blendedXY = normal1.xy.add(normal2.xy);
      const blendedZ = normal1.z.mul(normal2.z);
      const blended = normalize(vec3(blendedXY.x, blendedXY.y, blendedZ));

      // Apply distortion scale to control wave intensity (use uniform)
      const scaledNormal = vec3(
        blended.x.mul(this.uDistortionScale),
        blended.y.mul(this.uDistortionScale),
        blended.z
      );

      // Return normalized vector in -1..1 range (world-space normal)
      return normalize(scaledNormal);
    })();

    // Roughness - moderate roughness to prevent over-bright specular highlights
    // Higher roughness = softer highlights = less white-out at grazing angles
    const roughnessNode = Fn(() => {
      // Vary roughness slightly with waves for subtle sparkle
      const worldPos = positionWorld;
      const sparkle = sin(worldPos.x.mul(10.0).add(scaledTime.mul(5.0)))
        .mul(sin(worldPos.z.mul(10.0).sub(scaledTime.mul(4.0))))
        .mul(0.03);

      // Base roughness from uniform - supports runtime quality changes
      // Water in reality has roughness ~0.3-0.5 due to micro-waves
      return clamp(this.uBaseRoughness.add(sparkle), 0.15, 0.5);
    })();

    // Metalness - very low to avoid excessive reflections
    // Water is a dielectric, not metallic (metalness should be near 0)
    const metalnessNode = float(0.0);

    material.colorNode = colorNode;
    material.normalNode = normalNode;
    material.roughnessNode = roughnessNode;
    material.metalnessNode = metalnessNode;

    // Enable transparency with depth writing for proper terrain occlusion
    // depthWrite = true ensures water is properly occluded by higher terrain
    // This is critical because without it, water can appear "on top of" mountains
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = true;
    material.depthTest = true;

    return material;
  }

  /**
   * Update time-based animation
   * Call this each frame with deltaTime
   */
  public update(deltaTime: number): void {
    this.uTime.value += deltaTime;
  }

  /**
   * Set sun direction for specular highlights
   */
  public setSunDirection(direction: THREE.Vector3): void {
    this.uSunDirection.value.copy(direction).normalize();
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
   * All quality-dependent values are now uniforms to support runtime changes
   */
  public setQuality(quality: WaterQuality): void {
    this.quality = quality;
    const settings = QUALITY_SETTINGS[quality];
    this.uWaveAmplitude.value = settings.waveAmplitude;
    this.uWaveFrequency.value = settings.waveFrequency;
    this.uFresnelPower.value = settings.fresnelPower;
    this.uReflectionStrength.value = settings.reflectionStrength;
    this.uOpacity.value = settings.opacity;
    // Update quality-dependent uniforms
    this.uDistortionScale.value = settings.distortionScale;
    this.uTextureScale.value = 1.0 / settings.textureSize;
    this.uBaseRoughness.value = this.getBaseRoughness(quality);
  }

  /**
   * Get base roughness value for a quality setting
   */
  private getBaseRoughness(quality: WaterQuality): number {
    switch (quality) {
      case 'ultra': return 0.25;
      case 'high': return 0.3;
      case 'medium': return 0.32;
      case 'low': return 0.35;
      default: return 0.3;
    }
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
 * Factory function for convenient material creation
 */
export function createWaterMaterial(config: WaterMaterialConfig): TSLWaterMaterial {
  return new TSLWaterMaterial(config);
}

/**
 * Update the water material's time uniform
 * Call this each frame for animation
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
      (texture: THREE.Texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        cachedWaterNormalsTexture = texture;
        resolve(texture);
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
 * Returns null if not yet loaded
 */
export function getWaterNormalsTextureSync(): THREE.Texture | null {
  return cachedWaterNormalsTexture;
}

/**
 * Generate fallback water normals texture
 * Used when the texture file cannot be loaded
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

      data[idx] = Math.floor(((nx / len) * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor(((ny / len) * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor(((nz / len) * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

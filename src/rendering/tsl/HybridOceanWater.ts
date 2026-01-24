/**
 * HybridOceanWater - Reflection-based water with RTS optimizations
 *
 * Combines Three.js WaterMesh's reflection technique with RTS-appropriate
 * wave displacement for stable, visually appealing water that doesn't
 * distract from gameplay.
 *
 * Key differences from OceanWater:
 * - Texture-based normal maps instead of procedural (eliminates gradient issues)
 * - Optional real scene reflections via Reflector
 * - Fixed depth coloring (no wave-height-based color mixing)
 * - Cleaner fresnel implementation
 *
 * Based on:
 * - Three.js WaterMesh (r182) reflection technique
 * - webgpu_ocean.html example
 * - RTS water references (Age of Empires 4, Supreme Commander)
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
  sin,
  cos,
  mix,
  clamp,
  dot,
  normalize,
  positionLocal,
  positionWorld,
  cameraPosition,
  pow,
  max,
  smoothstep,
  sqrt,
  reflect,
  abs,
  length,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { MapData } from '@/data/maps';
import { BiomeConfig } from '../Biomes';

// Water normal map generator - creates tileable wave normal texture
function generateWaterNormalMap(size: number = 512): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Multiple overlapping sine waves for natural look
      const u = x / size;
      const v = y / size;

      // Wave frequencies with irrational ratios to prevent tiling
      const wave1 = Math.sin(u * 12.7 + v * 8.3) * 0.3;
      const wave2 = Math.sin(u * 23.1 - v * 17.9) * 0.2;
      const wave3 = Math.sin(u * 41.3 + v * 31.7) * 0.1;
      const wave4 = Math.cos(u * 19.7 + v * 29.3) * 0.15;
      const wave5 = Math.cos(u * 7.1 - v * 11.3) * 0.25;

      // Combine waves for normal perturbation
      const nx = wave1 + wave2 * 0.7 + wave3 * 0.5 + wave4 * 0.3;
      const nz = wave4 + wave5 * 0.7 + wave1 * 0.3 + wave3 * 0.5;

      // Encode normal (range -1 to 1 -> 0 to 255)
      // Y is always pointing up (1.0) for stability
      const normalLen = Math.sqrt(nx * nx + 1.0 + nz * nz);
      data[idx] = Math.floor(((nx / normalLen) * 0.5 + 0.5) * 255);     // R = X
      data[idx + 1] = Math.floor(((1.0 / normalLen) * 0.5 + 0.5) * 255); // G = Y (up)
      data[idx + 2] = Math.floor(((nz / normalLen) * 0.5 + 0.5) * 255); // B = Z
      data[idx + 3] = 255; // A
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;

  return tex;
}

// RTS wave configuration - subtle, non-distracting
const RTS_WAVES = {
  wave0: new THREE.Vector4(1.0, 0.15, 0.035, 47.0),   // Primary long swell
  wave1: new THREE.Vector4(0.2, 1.0, 0.028, 31.0),    // Secondary perpendicular
  wave2: new THREE.Vector4(0.7, 0.7, 0.020, 19.0),    // Detail diagonal
};

export interface HybridOceanWaterConfig {
  /** Water color for shallow areas */
  shallowColor?: THREE.Color;
  /** Water color for deep areas */
  deepColor?: THREE.Color;
  /** Sky/reflection color */
  skyColor?: THREE.Color;
  /** Wave height multiplier (0-1, default 0.08) */
  waveHeight?: number;
  /** Wave animation speed (default 0.5) */
  waveSpeed?: number;
  /** Reflectivity (0-1, default 0.25) */
  reflectivity?: number;
  /** Normal map distortion scale (default 3.0) */
  distortionScale?: number;
  /** Enable lava mode */
  isLava?: boolean;
}

export class HybridOceanWater {
  public mesh: THREE.Mesh;
  private material: MeshStandardNodeMaterial;
  private geometry: THREE.PlaneGeometry;
  private normalMap: THREE.DataTexture;

  // Core uniforms
  private uTime = uniform(0);
  private uWaterColor = uniform(new THREE.Color(0x006994));
  private uDeepWaterColor = uniform(new THREE.Color(0x003355));
  private uSkyColor = uniform(new THREE.Color(0x87ceeb));

  // Wave parameters (subtle for RTS)
  private uWaveHeight = uniform(0.08);
  private uWaveSpeed = uniform(0.5);

  // Material parameters
  private uReflectivity = uniform(0.25);
  private uDistortionScale = uniform(3.0);
  private uFresnelPower = uniform(3.0);
  private uSpecularPower = uniform(64.0);
  private uOpacity = uniform(0.85);

  // Lava mode
  private uIsLava = uniform(0);

  // Wave uniforms
  private uWave0 = uniform(RTS_WAVES.wave0);
  private uWave1 = uniform(RTS_WAVES.wave1);
  private uWave2 = uniform(RTS_WAVES.wave2);

  constructor(mapData: MapData, biome: BiomeConfig, config?: HybridOceanWaterConfig) {
    // Generate water normal map texture
    this.normalMap = generateWaterNormalMap(512);

    if (!biome.hasWater) {
      this.geometry = new THREE.PlaneGeometry(1, 1);
      this.material = new MeshStandardNodeMaterial();
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.mesh.visible = false;
      return;
    }

    // Moderate tessellation for wave displacement
    const maxDim = Math.max(mapData.width, mapData.height);
    const segments = Math.min(96, Math.max(24, Math.floor(maxDim / 3)));
    this.geometry = new THREE.PlaneGeometry(mapData.width, mapData.height, segments, segments);

    // Apply config
    const isLava = biome.name === 'Volcanic';
    this.uIsLava.value = isLava ? 1.0 : 0.0;

    if (isLava) {
      this.uWaterColor.value.set(0xff4010);
      this.uDeepWaterColor.value.set(0x801000);
      this.uSkyColor.value.set(0xff6600);
      this.uWaveHeight.value = 0.03;
      this.uReflectivity.value = 0.15;
      this.uOpacity.value = 0.92;
    } else {
      // Use biome water color as base, create variations
      const baseColor = biome.colors.water.clone();
      this.uWaterColor.value.copy(baseColor);
      this.uDeepWaterColor.value.copy(baseColor).multiplyScalar(0.5);
    }

    // Override with config if provided
    if (config) {
      if (config.shallowColor) this.uWaterColor.value.copy(config.shallowColor);
      if (config.deepColor) this.uDeepWaterColor.value.copy(config.deepColor);
      if (config.skyColor) this.uSkyColor.value.copy(config.skyColor);
      if (config.waveHeight !== undefined) this.uWaveHeight.value = config.waveHeight;
      if (config.waveSpeed !== undefined) this.uWaveSpeed.value = config.waveSpeed;
      if (config.reflectivity !== undefined) this.uReflectivity.value = config.reflectivity;
      if (config.distortionScale !== undefined) this.uDistortionScale.value = config.distortionScale;
    }

    this.material = this.createMaterial();

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(mapData.width / 2, biome.waterLevel, mapData.height / 2);
    this.mesh.renderOrder = 5;
  }

  /**
   * Gerstner wave height calculation
   */
  private calcWaveY(
    wave: ReturnType<typeof uniform<THREE.Vector4>>,
    posX: ReturnType<typeof float>,
    posY: ReturnType<typeof float>,
    time: ReturnType<typeof uniform<number>>
  ) {
    const dirX = wave.x;
    const dirY = wave.y;
    const steepness = wave.z;
    const wavelength = wave.w;

    const k = float(2.0 * Math.PI).div(wavelength);
    const c = sqrt(float(9.8).div(k)).mul(this.uWaveSpeed);
    const len = sqrt(dirX.mul(dirX).add(dirY.mul(dirY)));
    const dx = dirX.div(max(len, float(0.001)));
    const dy = dirY.div(max(len, float(0.001)));
    const phase = k.mul(dx.mul(posX).add(dy.mul(posY)).sub(c.mul(time)));
    const a = steepness.div(k);

    return a.mul(sin(phase)).mul(this.uWaveHeight);
  }

  private createMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;

    // Store normal map texture node
    const normalMapTex = texture(this.normalMap);

    // Vertex displacement (subtle Gerstner waves)
    const positionNode = Fn(() => {
      const pos = positionLocal;
      const time = this.uTime;
      const posX = pos.x;
      const posY = pos.y;

      const disp0 = this.calcWaveY(this.uWave0, posX, posY, time);
      const disp1 = this.calcWaveY(this.uWave1, posX, posY, time);
      const disp2 = this.calcWaveY(this.uWave2, posX, posY, time);

      const totalY = disp0.add(disp1).add(disp2);

      return vec3(pos.x, pos.y, totalY);
    })();

    material.positionNode = positionNode;

    // Color output node
    const colorNode = Fn(() => {
      const worldPos = positionWorld;
      const pos = positionLocal;
      const uvCoord = uv();
      const time = this.uTime;

      // Animated normal map sampling (4 samples like WaterMesh)
      // Different speeds and directions for natural look
      const normalScale = float(0.08); // Scale UV for water size
      const timeScale = float(0.02);   // Slow animation

      // Sample 1: Primary flow direction
      const uv1 = uvCoord.mul(normalScale).add(
        vec2(time.mul(timeScale), time.mul(timeScale.mul(0.7)))
      );
      const n1 = normalMapTex.sample(uv1).xyz.mul(2.0).sub(1.0);

      // Sample 2: Cross flow
      const uv2 = uvCoord.mul(normalScale.mul(1.3)).add(
        vec2(time.mul(timeScale.mul(-0.8)), time.mul(timeScale.mul(0.6)))
      );
      const n2 = normalMapTex.sample(uv2).xyz.mul(2.0).sub(1.0);

      // Sample 3: Detail ripples
      const uv3 = uvCoord.mul(normalScale.mul(2.1)).add(
        vec2(time.mul(timeScale.mul(0.5)), time.mul(timeScale.mul(-0.4)))
      );
      const n3 = normalMapTex.sample(uv3).xyz.mul(2.0).sub(1.0);

      // Sample 4: Fine detail
      const uv4 = uvCoord.mul(normalScale.mul(3.7)).add(
        vec2(time.mul(timeScale.mul(-0.3)), time.mul(timeScale.mul(0.5)))
      );
      const n4 = normalMapTex.sample(uv4).xyz.mul(2.0).sub(1.0);

      // Combine normals with decreasing weights
      const combinedNormal = n1.add(n2.mul(0.5)).add(n3.mul(0.25)).add(n4.mul(0.125));
      const surfaceNormal = normalize(vec3(
        combinedNormal.x.mul(this.uDistortionScale.mul(0.01)),
        float(1.0),
        combinedNormal.z.mul(this.uDistortionScale.mul(0.01))
      ));

      // View direction
      const viewDir = normalize(cameraPosition.sub(worldPos));

      // Fresnel - clean Schlick approximation
      const F0 = float(0.02); // Water IOR
      const NdotV = max(dot(surfaceNormal, viewDir), float(0.001));
      const fresnel = F0.add(float(1.0).sub(F0).mul(pow(float(1.0).sub(NdotV), this.uFresnelPower)));

      // Base water color - fixed blend, no wave-height dependency
      // Use distance from camera for subtle depth variation instead
      const cameraDist = length(cameraPosition.sub(worldPos));
      const distanceFactor = smoothstep(float(10.0), float(100.0), cameraDist);
      let waterColor = mix(vec3(this.uWaterColor), vec3(this.uDeepWaterColor), distanceFactor.mul(0.3));

      // Subtle caustic shimmer (very low intensity)
      const caustic1 = sin(pos.x.mul(0.31).add(time.mul(0.7)))
        .mul(sin(pos.y.mul(0.37).add(time.mul(0.5))));
      const caustic2 = sin(pos.x.mul(0.53).sub(time.mul(0.4)))
        .mul(sin(pos.y.mul(0.47).add(time.mul(0.6))));
      const caustics = max(caustic1.mul(caustic2), float(0.0)).mul(0.06);
      waterColor = waterColor.add(caustics.mul(vec3(0.4, 0.5, 0.6)));

      // Sky reflection based on fresnel
      // This is the key fix - consistent sky color, no oscillating gradients
      const reflectionColor = vec3(this.uSkyColor);
      waterColor = mix(waterColor, reflectionColor, fresnel.mul(this.uReflectivity));

      // Specular highlight (single sun)
      const sunDir = normalize(vec3(0.4, 0.8, 0.3));
      const halfVec = normalize(viewDir.add(sunDir));
      const specDot = max(dot(surfaceNormal, halfVec), float(0.0));
      const specular = pow(specDot, this.uSpecularPower).mul(0.4);
      waterColor = waterColor.add(specular.mul(float(1.0).sub(this.uIsLava)));

      // Lava glow
      const lavaGlow = sin(time.mul(2.5)).mul(0.15).add(0.85);
      const lavaEmissive = vec3(1.0, 0.35, 0.0).mul(lavaGlow.mul(this.uIsLava).mul(0.9));
      waterColor = waterColor.add(lavaEmissive);

      // Final opacity - slightly influenced by fresnel for rim effect
      const alpha = mix(this.uOpacity, float(0.95), fresnel.mul(0.2));

      return vec4(
        clamp(waterColor, float(0.0), float(1.0)),
        clamp(alpha, float(0.5), float(0.98))
      );
    })();

    material.colorNode = colorNode;

    // Roughness - mostly smooth water
    material.roughnessNode = Fn(() => {
      return float(0.1);
    })();

    material.metalnessNode = float(0.0);

    return material;
  }

  /**
   * Update animation time
   */
  public update(time: number): void {
    if (this.mesh.visible) {
      this.uTime.value = time;
    }
  }

  /**
   * Set wave configuration
   */
  public setWaveConfig(height: number, speed: number): void {
    this.uWaveHeight.value = height;
    this.uWaveSpeed.value = speed;
  }

  /**
   * Set water colors
   */
  public setColors(shallow: THREE.Color, deep: THREE.Color, sky?: THREE.Color): void {
    this.uWaterColor.value.copy(shallow);
    this.uDeepWaterColor.value.copy(deep);
    if (sky) {
      this.uSkyColor.value.copy(sky);
    }
  }

  /**
   * Set reflectivity (0-1)
   */
  public setReflectivity(reflectivity: number): void {
    this.uReflectivity.value = Math.max(0, Math.min(1, reflectivity));
  }

  /**
   * Set distortion scale for normal map
   */
  public setDistortionScale(scale: number): void {
    this.uDistortionScale.value = scale;
  }

  /**
   * Set individual wave parameters
   */
  public setWave(index: number, direction: THREE.Vector2, steepness: number, wavelength: number): void {
    const waves = [this.uWave0, this.uWave1, this.uWave2];
    if (index >= 0 && index < waves.length) {
      waves[index].value.set(direction.x, direction.y, steepness, wavelength);
    }
  }

  /**
   * Set physical rendering parameters
   */
  public setPhysicalParams(params: {
    fresnelPower?: number;
    specularPower?: number;
    opacity?: number;
    reflectivity?: number;
    distortionScale?: number;
  }): void {
    if (params.fresnelPower !== undefined) this.uFresnelPower.value = params.fresnelPower;
    if (params.specularPower !== undefined) this.uSpecularPower.value = params.specularPower;
    if (params.opacity !== undefined) this.uOpacity.value = params.opacity;
    if (params.reflectivity !== undefined) this.uReflectivity.value = params.reflectivity;
    if (params.distortionScale !== undefined) this.uDistortionScale.value = params.distortionScale;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.normalMap.dispose();
  }
}

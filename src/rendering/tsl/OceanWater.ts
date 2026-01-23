/**
 * OceanWater - World-class animated water shader using TSL
 *
 * Features:
 * - Gerstner waves for realistic wave motion
 * - Fresnel effect for angle-dependent reflectivity
 * - Depth-based color and transparency
 * - Subsurface scattering simulation
 * - Animated foam at wave peaks
 * - Normal perturbation for surface detail
 * - Flow/current direction animation
 *
 * Based on GPU Gems and industry-standard ocean rendering techniques.
 */

import * as THREE from 'three';
import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  uniform,
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
  abs,
  max,
  min,
  fract,
  floor,
  smoothstep,
  length,
  transformNormalToView,
  varying,
  varyingProperty,
  attribute,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { MapData } from '@/data/maps';
import { BiomeConfig } from '../Biomes';

// Wave configuration for Gerstner waves
interface GerstnerWave {
  direction: THREE.Vector2;  // Normalized wave direction
  steepness: number;         // Wave steepness (0-1)
  wavelength: number;        // Wave length in world units
}

// Default wave set for realistic ocean
const DEFAULT_WAVES: GerstnerWave[] = [
  { direction: new THREE.Vector2(1.0, 0.0), steepness: 0.25, wavelength: 60.0 },
  { direction: new THREE.Vector2(0.7, 0.7), steepness: 0.20, wavelength: 31.0 },
  { direction: new THREE.Vector2(0.3, 0.9), steepness: 0.15, wavelength: 18.0 },
  { direction: new THREE.Vector2(-0.5, 0.5), steepness: 0.10, wavelength: 8.0 },
];

export class OceanWater {
  public mesh: THREE.Mesh;
  private material: MeshStandardNodeMaterial;
  private geometry: THREE.PlaneGeometry;

  // Uniforms
  private uTime = uniform(0);
  private uWaterColor = uniform(new THREE.Color(0x1060a0));
  private uDeepWaterColor = uniform(new THREE.Color(0x0a2040));
  private uFoamColor = uniform(new THREE.Color(0xffffff));
  private uWaveHeight = uniform(0.8);
  private uWaveSpeed = uniform(1.0);
  private uFresnelPower = uniform(2.5);
  private uSubsurfaceStrength = uniform(0.4);
  private uFoamThreshold = uniform(0.65);
  private uDepthScale = uniform(0.15);
  private uFlowDirection = uniform(new THREE.Vector2(1.0, 0.3));
  private uFlowSpeed = uniform(0.08);
  private uNormalStrength = uniform(1.5);
  private uReflectivity = uniform(0.4);
  private uIsLava = uniform(0);

  // Gerstner wave parameters (packed as vec4: dirX, dirY, steepness, wavelength)
  private uWave0 = uniform(new THREE.Vector4(1.0, 0.0, 0.25, 60.0));
  private uWave1 = uniform(new THREE.Vector4(0.7, 0.7, 0.20, 31.0));
  private uWave2 = uniform(new THREE.Vector4(0.3, 0.9, 0.15, 18.0));
  private uWave3 = uniform(new THREE.Vector4(-0.5, 0.5, 0.10, 8.0));

  constructor(mapData: MapData, biome: BiomeConfig) {
    if (!biome.hasWater) {
      // Create invisible placeholder
      this.geometry = new THREE.PlaneGeometry(1, 1);
      this.material = new MeshStandardNodeMaterial();
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.mesh.visible = false;
      return;
    }

    // Higher segment count for smoother wave displacement
    const segments = Math.min(256, Math.max(64, Math.floor(Math.max(mapData.width, mapData.height) * 0.5)));
    this.geometry = new THREE.PlaneGeometry(mapData.width, mapData.height, segments, segments);

    // Determine if lava
    const isLava = biome.name === 'Volcanic';

    // Configure colors based on biome
    if (isLava) {
      this.uWaterColor.value.set(0xff4010);
      this.uDeepWaterColor.value.set(0x801000);
      this.uFoamColor.value.set(0xffff00);
      this.uIsLava.value = 1.0;
      this.uWaveHeight.value = 0.3;
      this.uFoamThreshold.value = 0.4;
    } else {
      this.uWaterColor.value.copy(biome.colors.water);
      // Derive deep color from water color
      this.uDeepWaterColor.value.copy(biome.colors.water).multiplyScalar(0.4);
      this.uIsLava.value = 0.0;
    }

    // Create TSL material
    this.material = this.createTSLMaterial();

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(mapData.width / 2, biome.waterLevel, mapData.height / 2);

    // Ensure water renders after terrain but before transparent objects
    this.mesh.renderOrder = 5;
  }

  private createTSLMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;

    // Gerstner wave displacement function
    const gerstnerWave = Fn(([wave, position, time]: [
      ReturnType<typeof uniform<THREE.Vector4>>,
      ReturnType<typeof positionLocal>,
      ReturnType<typeof uniform<number>>
    ]) => {
      const dirX = wave.x;
      const dirY = wave.y;
      const steepness = wave.z;
      const wavelength = wave.w;

      const k = float(2.0 * Math.PI).div(wavelength);
      const c = float(9.8).div(k).sqrt().mul(this.uWaveSpeed);
      const d = vec2(dirX, dirY).normalize();
      const f = k.mul(d.dot(position.xz).sub(c.mul(time)));
      const a = steepness.div(k);

      // Gerstner displacement
      const dispX = d.x.mul(a.mul(cos(f)));
      const dispZ = d.y.mul(a.mul(cos(f)));
      const dispY = a.mul(sin(f));

      // Gerstner normal contribution
      const nx = d.x.mul(steepness.mul(sin(f)));
      const nz = d.y.mul(steepness.mul(sin(f)));
      const ny = steepness.mul(cos(f));

      return vec4(dispX, dispY, dispZ, vec3(nx, ny, nz).length());
    });

    // Position node with Gerstner wave displacement
    const positionNode = Fn(() => {
      const pos = positionLocal.toVar();
      const time = this.uTime;

      // Sum Gerstner waves
      const wave0 = gerstnerWave(this.uWave0, pos, time);
      const wave1 = gerstnerWave(this.uWave1, pos, time);
      const wave2 = gerstnerWave(this.uWave2, pos, time);
      const wave3 = gerstnerWave(this.uWave3, pos, time);

      const totalDisp = wave0.xyz.add(wave1.xyz).add(wave2.xyz).add(wave3.xyz);

      // Apply height scale
      const scaledDisp = vec3(
        totalDisp.x.mul(this.uWaveHeight),
        totalDisp.y.mul(this.uWaveHeight),
        totalDisp.z.mul(this.uWaveHeight)
      );

      return pos.add(scaledDisp);
    })();

    material.positionNode = positionNode;

    // Color/output node
    const outputNode = Fn(() => {
      const worldPos = positionWorld;
      const uvCoord = uv();
      const time = this.uTime;

      // Flow animation for surface detail
      const flowDir = this.uFlowDirection.normalize();
      const flowOffset = flowDir.mul(time.mul(this.uFlowSpeed));
      const flowUV = uvCoord.add(flowOffset);

      // Multi-octave noise for surface detail
      const noise1 = sin(flowUV.x.mul(20.0).add(time.mul(0.5)))
        .mul(sin(flowUV.y.mul(18.0).add(time.mul(0.4))))
        .mul(0.15);
      const noise2 = sin(flowUV.x.mul(40.0).add(time.mul(0.8)))
        .mul(sin(flowUV.y.mul(36.0).add(time.mul(0.6))))
        .mul(0.08);
      const noise3 = sin(flowUV.x.mul(80.0).add(time.mul(1.2)))
        .mul(sin(flowUV.y.mul(72.0).add(time.mul(0.9))))
        .mul(0.04);
      const surfaceNoise = noise1.add(noise2).add(noise3);

      // Gerstner wave height for foam calculation
      const waveSum = Fn(() => {
        const pos = positionLocal;
        const wave0 = sin(pos.x.mul(2.0 * Math.PI / 60.0).add(time));
        const wave1 = sin(pos.x.mul(2.0 * Math.PI / 31.0).add(pos.y.mul(2.0 * Math.PI / 31.0)).add(time.mul(0.9)));
        const wave2 = sin(pos.y.mul(2.0 * Math.PI / 18.0).add(time.mul(1.1)));
        return wave0.add(wave1).add(wave2).mul(0.33);
      })();

      // View direction for Fresnel
      const viewDir = cameraPosition.sub(worldPos).normalize();
      const upNormal = vec3(0, 1, 0);

      // Perturbed normal from surface noise
      const perturbedNormal = normalize(
        upNormal.add(vec3(surfaceNoise.mul(this.uNormalStrength), 0, surfaceNoise.mul(this.uNormalStrength).mul(0.7)))
      );

      // Fresnel effect - more reflective at grazing angles
      const NdotV = max(dot(perturbedNormal, viewDir), float(0.0));
      const fresnel = pow(float(1.0).sub(NdotV), this.uFresnelPower);

      // Depth-based coloring (simulated with vertical position relative to wave height)
      const depthFactor = clamp(waveSum.mul(this.uDepthScale).add(0.5), float(0.0), float(1.0));
      const baseColor = mix(this.uDeepWaterColor, this.uWaterColor, depthFactor);

      // Subsurface scattering simulation - light penetration effect
      const sssFactor = this.uSubsurfaceStrength.mul(max(dot(viewDir, vec3(0, -1, 0)), float(0.0)));
      const sssColor = vec3(0.0, 0.4, 0.3).mul(sssFactor);

      // Foam at wave peaks
      const foamMask = smoothstep(this.uFoamThreshold, float(1.0), waveSum.add(surfaceNoise.mul(0.3)));
      const foamAnimated = foamMask.mul(
        sin(flowUV.x.mul(100.0).add(time.mul(2.0))).mul(0.1).add(0.9)
      );

      // Combine colors
      let waterColor = baseColor.add(sssColor);
      waterColor = mix(waterColor, this.uFoamColor, foamAnimated.mul(float(1.0).sub(this.uIsLava)));

      // Apply fresnel for reflectivity
      const reflectionColor = vec3(0.8, 0.9, 1.0); // Sky reflection approximation
      waterColor = mix(waterColor, reflectionColor, fresnel.mul(this.uReflectivity));

      // Lava glow effect
      const lavaGlow = sin(time.mul(3.0)).mul(0.2).add(0.8);
      const lavaEmissive = vec3(1.0, 0.3, 0.0).mul(lavaGlow.mul(this.uIsLava));
      waterColor = waterColor.add(lavaEmissive);

      // Transparency - more opaque with depth, foam is opaque
      const baseAlpha = mix(float(0.6), float(0.9), depthFactor);
      const alpha = mix(baseAlpha, float(0.95), foamAnimated);
      const finalAlpha = mix(alpha, float(0.95), this.uIsLava);

      return vec4(waterColor, finalAlpha);
    })();

    material.colorNode = outputNode;

    // Roughness - water is smooth, foam is rougher
    material.roughnessNode = Fn(() => {
      const uvCoord = uv();
      const time = this.uTime;
      const flowOffset = this.uFlowDirection.normalize().mul(time.mul(this.uFlowSpeed));
      const flowUV = uvCoord.add(flowOffset);

      const waveHeight = sin(flowUV.x.mul(10.0).add(time)).mul(sin(flowUV.y.mul(8.0).add(time.mul(0.8))));
      const foamMask = smoothstep(float(0.5), float(1.0), waveHeight);

      return mix(float(0.05), float(0.4), foamMask);
    })();

    // Metalness - water has slight metalness for reflections
    material.metalnessNode = float(0.1);

    return material;
  }

  /**
   * Update water animation
   */
  public update(time: number): void {
    if (this.mesh.visible) {
      this.uTime.value = time;
    }
  }

  /**
   * Set wave parameters
   */
  public setWaveConfig(height: number, speed: number): void {
    this.uWaveHeight.value = height;
    this.uWaveSpeed.value = speed;
  }

  /**
   * Set water colors
   */
  public setColors(shallow: THREE.Color, deep: THREE.Color, foam?: THREE.Color): void {
    this.uWaterColor.value.copy(shallow);
    this.uDeepWaterColor.value.copy(deep);
    if (foam) {
      this.uFoamColor.value.copy(foam);
    }
  }

  /**
   * Set flow/current direction
   */
  public setFlowDirection(x: number, z: number, speed: number = 0.08): void {
    this.uFlowDirection.value.set(x, z);
    this.uFlowSpeed.value = speed;
  }

  /**
   * Configure Gerstner waves
   */
  public setWaves(waves: GerstnerWave[]): void {
    if (waves.length >= 1) {
      const w = waves[0];
      this.uWave0.value.set(w.direction.x, w.direction.y, w.steepness, w.wavelength);
    }
    if (waves.length >= 2) {
      const w = waves[1];
      this.uWave1.value.set(w.direction.x, w.direction.y, w.steepness, w.wavelength);
    }
    if (waves.length >= 3) {
      const w = waves[2];
      this.uWave2.value.set(w.direction.x, w.direction.y, w.steepness, w.wavelength);
    }
    if (waves.length >= 4) {
      const w = waves[3];
      this.uWave3.value.set(w.direction.x, w.direction.y, w.steepness, w.wavelength);
    }
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

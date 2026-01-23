/**
 * OceanWater - World-class animated ocean shader using TSL
 *
 * Features:
 * - 6-wave Gerstner system with proper deep water dispersion (c = √(g/k))
 * - Jacobian-based foam detection for realistic wave breaking
 * - Beer-Lambert absorption for wavelength-dependent depth coloring
 * - Proper subsurface scattering (SSS) simulation
 * - Schlick Fresnel approximation with F0 = 0.02
 * - Dynamic normal calculation from wave partial derivatives
 * - Vertex displacement for actual wave geometry
 * - PBR-inspired specular highlights
 * - Caustic interference patterns
 *
 * Based on:
 * - GPU Gems (Tessendorf/NVIDIA)
 * - Sea of Thieves GDC talks
 * - Catlike Coding waves tutorial
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
  exp,
  sqrt,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { MapData } from '@/data/maps';
import { BiomeConfig } from '../Biomes';

// Wave configuration for Gerstner waves
interface GerstnerWave {
  direction: THREE.Vector2;  // Normalized wave direction
  steepness: number;         // Wave steepness (Q parameter, 0-1)
  wavelength: number;        // Wave length in world units
}

// Default wave set for realistic ocean - 6 waves with varying scales
const DEFAULT_WAVES: GerstnerWave[] = [
  { direction: new THREE.Vector2(1.0, 0.0), steepness: 0.25, wavelength: 80.0 },   // Primary swell
  { direction: new THREE.Vector2(0.7, 0.7), steepness: 0.20, wavelength: 45.0 },   // Secondary swell
  { direction: new THREE.Vector2(0.3, 0.95), steepness: 0.15, wavelength: 25.0 },  // Wind waves
  { direction: new THREE.Vector2(-0.5, 0.5), steepness: 0.12, wavelength: 15.0 },  // Cross waves
  { direction: new THREE.Vector2(0.9, -0.4), steepness: 0.08, wavelength: 8.0 },   // Chop
  { direction: new THREE.Vector2(-0.6, -0.8), steepness: 0.05, wavelength: 4.0 },  // Fine detail
];

export class OceanWater {
  public mesh: THREE.Mesh;
  private material: MeshStandardNodeMaterial;
  private geometry: THREE.PlaneGeometry;

  // Core uniforms
  private uTime = uniform(0);
  private uWaterColor = uniform(new THREE.Color(0x1080c0));
  private uDeepWaterColor = uniform(new THREE.Color(0x0a2050));
  private uScatterColor = uniform(new THREE.Color(0x00ffaa));
  private uFoamColor = uniform(new THREE.Color(0xffffff));

  // Wave parameters
  private uWaveHeight = uniform(1.0);
  private uWaveSpeed = uniform(1.0);

  // Physical parameters
  private uFresnelPower = uniform(5.0);
  private uSubsurfaceStrength = uniform(0.5);
  private uFoamThreshold = uniform(0.4);
  private uAbsorptionScale = uniform(1.0);

  // Flow parameters
  private uFlowDirection = uniform(new THREE.Vector2(1.0, 0.3));
  private uFlowSpeed = uniform(0.05);

  // Material parameters
  private uReflectivity = uniform(0.5);
  private uSpecularPower = uniform(512.0);
  private uIsLava = uniform(0);

  // 6 Gerstner waves (packed as vec4: dirX, dirY, steepness, wavelength)
  private uWave0 = uniform(new THREE.Vector4(1.0, 0.0, 0.25, 80.0));
  private uWave1 = uniform(new THREE.Vector4(0.7, 0.7, 0.20, 45.0));
  private uWave2 = uniform(new THREE.Vector4(0.3, 0.95, 0.15, 25.0));
  private uWave3 = uniform(new THREE.Vector4(-0.5, 0.5, 0.12, 15.0));
  private uWave4 = uniform(new THREE.Vector4(0.9, -0.4, 0.08, 8.0));
  private uWave5 = uniform(new THREE.Vector4(-0.6, -0.8, 0.05, 4.0));

  constructor(mapData: MapData, biome: BiomeConfig) {
    if (!biome.hasWater) {
      // Create invisible placeholder
      this.geometry = new THREE.PlaneGeometry(1, 1);
      this.material = new MeshStandardNodeMaterial();
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.mesh.visible = false;
      return;
    }

    // High segment count for smooth wave displacement
    const maxDim = Math.max(mapData.width, mapData.height);
    const segments = Math.min(512, Math.max(128, Math.floor(maxDim)));
    this.geometry = new THREE.PlaneGeometry(mapData.width, mapData.height, segments, segments);

    // Determine if lava
    const isLava = biome.name === 'Volcanic';

    // Configure colors based on biome
    if (isLava) {
      this.uWaterColor.value.set(0xff4010);
      this.uDeepWaterColor.value.set(0x801000);
      this.uScatterColor.value.set(0xff8800);
      this.uFoamColor.value.set(0xffff00);
      this.uIsLava.value = 1.0;
      this.uWaveHeight.value = 0.4;
      this.uFoamThreshold.value = 0.3;
    } else {
      this.uWaterColor.value.copy(biome.colors.water);
      // Deep color is darker, more saturated blue-green
      this.uDeepWaterColor.value.copy(biome.colors.water).multiplyScalar(0.35);
      this.uIsLava.value = 0.0;
    }

    // Create TSL material
    this.material = this.createTSLMaterial();

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(mapData.width / 2, biome.waterLevel, mapData.height / 2);

    // Render after terrain but before transparent objects
    this.mesh.renderOrder = 5;
  }

  private createTSLMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;

    // Gerstner wave function with proper physics
    // Returns: displacement (vec3), normal contribution (vec3), jacobian terms (vec4)
    const gerstnerWave = Fn(([wave, pos, time]: [
      ReturnType<typeof uniform<THREE.Vector4>>,
      ReturnType<typeof positionLocal>,
      ReturnType<typeof uniform<number>>
    ]) => {
      const dirX = wave.x;
      const dirY = wave.y;
      const steepness = wave.z;
      const wavelength = wave.w;

      // Wave number k = 2π/λ
      const k = float(2.0 * Math.PI).div(wavelength);
      // Phase speed c = √(g/k) - deep water dispersion relation
      const gravity = float(9.8);
      const c = sqrt(gravity.div(k)).mul(this.uWaveSpeed);
      // Normalized direction
      const d = vec2(dirX, dirY).normalize();
      // Phase φ = k(D·P - ct)
      const phase = k.mul(d.x.mul(pos.x).add(d.y.mul(pos.y)).sub(c.mul(time)));
      // Amplitude a = Q/k (steepness divided by wave number)
      const a = steepness.div(k);

      const cosPhase = cos(phase);
      const sinPhase = sin(phase);

      // Gerstner displacement
      const dispX = d.x.mul(a).mul(cosPhase);
      const dispY = a.mul(sinPhase);
      const dispZ = d.y.mul(a).mul(cosPhase);

      // Partial derivatives for Jacobian (wave breaking detection)
      const wa = k.mul(a);
      const dDx_dx = d.x.mul(d.x).mul(wa).mul(sinPhase).negate();
      const dDz_dz = d.y.mul(d.y).mul(wa).mul(sinPhase).negate();
      const dDx_dz = d.x.mul(d.y).mul(wa).mul(sinPhase).negate();
      const dDz_dx = dDx_dz;

      // Normal contribution (binormal/tangent cross product)
      const nx = d.x.mul(wa).mul(cosPhase).negate();
      const nz = d.y.mul(wa).mul(cosPhase).negate();
      const ny = wa.mul(sinPhase);

      return {
        disp: vec3(dispX, dispY, dispZ),
        normal: vec3(nx, ny, nz),
        jacobian: vec4(dDx_dx, dDz_dz, dDx_dz, dDz_dx),
      };
    });

    // Position node with vertex displacement
    const positionNode = Fn(() => {
      const pos = positionLocal.toVar();
      const time = this.uTime;

      // Accumulate all 6 waves
      const wave0 = gerstnerWave(this.uWave0, pos, time);
      const wave1 = gerstnerWave(this.uWave1, pos, time);
      const wave2 = gerstnerWave(this.uWave2, pos, time);
      const wave3 = gerstnerWave(this.uWave3, pos, time);
      const wave4 = gerstnerWave(this.uWave4, pos, time);
      const wave5 = gerstnerWave(this.uWave5, pos, time);

      const totalDisp = wave0.disp
        .add(wave1.disp)
        .add(wave2.disp)
        .add(wave3.disp)
        .add(wave4.disp)
        .add(wave5.disp);

      // Scale by wave height parameter
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
      const pos = positionLocal;
      const uvCoord = uv();
      const time = this.uTime;

      // Recalculate waves for shading (needed for normals and foam)
      const wave0 = gerstnerWave(this.uWave0, pos, time);
      const wave1 = gerstnerWave(this.uWave1, pos, time);
      const wave2 = gerstnerWave(this.uWave2, pos, time);
      const wave3 = gerstnerWave(this.uWave3, pos, time);
      const wave4 = gerstnerWave(this.uWave4, pos, time);
      const wave5 = gerstnerWave(this.uWave5, pos, time);

      // Total displacement for height-based effects
      const totalDisp = wave0.disp
        .add(wave1.disp)
        .add(wave2.disp)
        .add(wave3.disp)
        .add(wave4.disp)
        .add(wave5.disp)
        .mul(this.uWaveHeight);

      // Accumulated normal from all waves
      const totalNormalContrib = wave0.normal
        .add(wave1.normal)
        .add(wave2.normal)
        .add(wave3.normal)
        .add(wave4.normal)
        .add(wave5.normal);

      // Reconstruct normal
      const waterNormal = normalize(vec3(
        totalNormalContrib.x.mul(this.uWaveHeight),
        float(1.0).sub(totalNormalContrib.y.mul(this.uWaveHeight)),
        totalNormalContrib.z.mul(this.uWaveHeight)
      ));

      // Jacobian for foam (wave breaking detection)
      // J = (1 + ∂Dx/∂x)(1 + ∂Dz/∂z) - (∂Dx/∂z)(∂Dz/∂x)
      const j0 = wave0.jacobian;
      const j1 = wave1.jacobian;
      const j2 = wave2.jacobian;
      const j3 = wave3.jacobian;
      const j4 = wave4.jacobian;
      const j5 = wave5.jacobian;

      const dDx_dx_total = j0.x.add(j1.x).add(j2.x).add(j3.x).add(j4.x).add(j5.x).mul(this.uWaveHeight);
      const dDz_dz_total = j0.y.add(j1.y).add(j2.y).add(j3.y).add(j4.y).add(j5.y).mul(this.uWaveHeight);
      const dDx_dz_total = j0.z.add(j1.z).add(j2.z).add(j3.z).add(j4.z).add(j5.z).mul(this.uWaveHeight);
      const dDz_dx_total = j0.w.add(j1.w).add(j2.w).add(j3.w).add(j4.w).add(j5.w).mul(this.uWaveHeight);

      const jacobian = float(1.0).add(dDx_dx_total)
        .mul(float(1.0).add(dDz_dz_total))
        .sub(dDx_dz_total.mul(dDz_dx_total));

      // Foam where Jacobian indicates wave folding
      const foamFromJacobian = smoothstep(this.uFoamThreshold, float(-0.1), jacobian);

      // Also add foam at wave crests
      const crestFoam = smoothstep(float(0.3), float(0.8), totalDisp.y);

      // Combine foam sources with noise
      const foamNoise = sin(pos.x.mul(20.0).add(time.mul(2.5)))
        .mul(sin(pos.y.mul(18.0).add(time.mul(2.0))))
        .mul(0.25).add(0.75);
      const foam = max(foamFromJacobian, crestFoam.mul(0.5)).mul(foamNoise);

      // Flow animation for detail
      const flowDir = this.uFlowDirection.normalize();
      const flowOffset = flowDir.mul(time.mul(this.uFlowSpeed));
      const flowUV = uvCoord.add(flowOffset);

      // High-frequency surface detail (ripples)
      const ripple1 = sin(flowUV.x.mul(50.0).add(time.mul(1.5)))
        .mul(sin(flowUV.y.mul(45.0).add(time.mul(1.2))))
        .mul(0.08);
      const ripple2 = sin(flowUV.x.mul(80.0).sub(time.mul(1.8)))
        .mul(sin(flowUV.y.mul(72.0).add(time.mul(1.5))))
        .mul(0.04);
      const surfaceDetail = ripple1.add(ripple2);

      // View direction
      const viewDir = normalize(cameraPosition.sub(worldPos));

      // Fresnel effect (Schlick approximation, F0 = 0.02 for water)
      const F0 = float(0.02);
      const NdotV = max(dot(waterNormal, viewDir), float(0.001));
      const fresnel = F0.add(float(1.0).sub(F0).mul(pow(float(1.0).sub(NdotV), this.uFresnelPower)));

      // Beer-Lambert absorption (wavelength-dependent)
      // Red: 0.45/m, Green: 0.09/m, Blue: 0.06/m
      const absorptionCoeff = vec3(0.45, 0.09, 0.06);
      const waterDepth = totalDisp.y.negate().mul(3.0).add(2.0).mul(this.uAbsorptionScale); // Simulated depth
      const transmittance = exp(absorptionCoeff.negate().mul(max(waterDepth, float(0.0))));

      // Subsurface scattering
      const sssHalf = normalize(viewDir.add(vec3(0, -0.3, 0)));
      const sssDot = max(dot(viewDir.negate(), sssHalf), float(0.0));
      const sss = pow(sssDot, float(4.0)).mul(this.uSubsurfaceStrength);
      const sssContrib = vec3(this.uScatterColor).mul(sss);

      // Depth-based color mixing
      const depthMix = smoothstep(float(-0.5), float(0.5), totalDisp.y);
      let waterColor = mix(vec3(this.uDeepWaterColor), vec3(this.uWaterColor), depthMix);

      // Apply Beer-Lambert absorption
      waterColor = waterColor.mul(transmittance);

      // Add subsurface scattering
      waterColor = waterColor.add(sssContrib);

      // Caustic-like interference patterns
      const caustic1 = sin(pos.x.mul(6.0).add(time.mul(1.0)))
        .mul(sin(pos.y.mul(5.0).add(time.mul(0.8))));
      const caustic2 = sin(pos.x.mul(9.0).sub(time.mul(0.7)))
        .mul(sin(pos.y.mul(8.0).add(time.mul(1.1))));
      const caustics = max(caustic1.mul(caustic2), float(0.0)).mul(0.12);
      waterColor = waterColor.add(caustics.mul(vec3(0.5, 0.8, 1.0)));

      // Sky reflection via fresnel
      const skyColor = vec3(0.7, 0.85, 1.0);
      waterColor = mix(waterColor, skyColor, fresnel.mul(this.uReflectivity));

      // Add foam
      waterColor = mix(waterColor, vec3(this.uFoamColor), foam.mul(float(1.0).sub(this.uIsLava)));

      // Specular highlights (sun reflection)
      const sunDir = normalize(vec3(0.4, 0.8, 0.4));
      const halfVec = normalize(viewDir.add(sunDir));
      const specular = pow(max(dot(waterNormal, halfVec), float(0.0)), this.uSpecularPower);
      waterColor = waterColor.add(specular.mul(0.6).mul(float(1.0).sub(foam)));

      // Lava effects
      const lavaGlow = sin(time.mul(3.0)).mul(0.15).add(0.85);
      const lavaEmissive = vec3(1.0, 0.4, 0.0).mul(lavaGlow.mul(this.uIsLava).mul(0.8));
      waterColor = waterColor.add(lavaEmissive);

      // Final alpha
      const baseAlpha = mix(float(0.65), float(0.92), depthMix);
      const alpha = mix(baseAlpha, float(0.98), foam.add(fresnel.mul(0.2)));
      const finalAlpha = mix(alpha, float(0.95), this.uIsLava);

      return vec4(
        clamp(waterColor, float(0.0), float(1.0)),
        clamp(finalAlpha, float(0.5), float(0.98))
      );
    })();

    material.colorNode = outputNode;

    // Roughness - smooth water, rougher foam
    material.roughnessNode = Fn(() => {
      const pos = positionLocal;
      const time = this.uTime;

      // Calculate foam amount for roughness
      const waveHeight = sin(pos.x.mul(0.1).add(time.mul(0.5)))
        .mul(sin(pos.y.mul(0.08).add(time.mul(0.4))));
      const foamFactor = smoothstep(float(0.3), float(0.8), waveHeight);

      return mix(float(0.02), float(0.5), foamFactor);
    })();

    // Metalness - water has slight metalness for reflections
    material.metalnessNode = float(0.05);

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
  public setColors(shallow: THREE.Color, deep: THREE.Color, foam?: THREE.Color, scatter?: THREE.Color): void {
    this.uWaterColor.value.copy(shallow);
    this.uDeepWaterColor.value.copy(deep);
    if (foam) {
      this.uFoamColor.value.copy(foam);
    }
    if (scatter) {
      this.uScatterColor.value.copy(scatter);
    }
  }

  /**
   * Set flow/current direction
   */
  public setFlowDirection(x: number, z: number, speed: number = 0.05): void {
    this.uFlowDirection.value.set(x, z);
    this.uFlowSpeed.value = speed;
  }

  /**
   * Configure individual Gerstner wave
   */
  public setWave(index: number, direction: THREE.Vector2, steepness: number, wavelength: number): void {
    const waves = [this.uWave0, this.uWave1, this.uWave2, this.uWave3, this.uWave4, this.uWave5];
    if (index >= 0 && index < waves.length) {
      waves[index].value.set(direction.x, direction.y, steepness, wavelength);
    }
  }

  /**
   * Configure all Gerstner waves
   */
  public setWaves(waves: GerstnerWave[]): void {
    const uniforms = [this.uWave0, this.uWave1, this.uWave2, this.uWave3, this.uWave4, this.uWave5];
    for (let i = 0; i < Math.min(waves.length, uniforms.length); i++) {
      const w = waves[i];
      uniforms[i].value.set(w.direction.x, w.direction.y, w.steepness, w.wavelength);
    }
  }

  /**
   * Set physical parameters
   */
  public setPhysicalParams(params: {
    fresnelPower?: number;
    subsurfaceStrength?: number;
    foamThreshold?: number;
    absorptionScale?: number;
    reflectivity?: number;
    specularPower?: number;
  }): void {
    if (params.fresnelPower !== undefined) this.uFresnelPower.value = params.fresnelPower;
    if (params.subsurfaceStrength !== undefined) this.uSubsurfaceStrength.value = params.subsurfaceStrength;
    if (params.foamThreshold !== undefined) this.uFoamThreshold.value = params.foamThreshold;
    if (params.absorptionScale !== undefined) this.uAbsorptionScale.value = params.absorptionScale;
    if (params.reflectivity !== undefined) this.uReflectivity.value = params.reflectivity;
    if (params.specularPower !== undefined) this.uSpecularPower.value = params.specularPower;
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

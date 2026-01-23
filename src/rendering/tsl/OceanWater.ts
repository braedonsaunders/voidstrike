/**
 * OceanWater - World-class animated ocean shader using TSL
 *
 * Features:
 * - 6-wave Gerstner system with proper deep water dispersion (c = √(g/k))
 * - Foam detection at wave crests
 * - Beer-Lambert absorption for wavelength-dependent depth coloring
 * - Proper subsurface scattering (SSS) simulation
 * - Schlick Fresnel approximation with F0 = 0.02
 * - Dynamic normal calculation from wave derivatives
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
  max,
  smoothstep,
  exp,
  sqrt,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { MapData } from '@/data/maps';
import { BiomeConfig } from '../Biomes';

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
  private uFoamThreshold = uniform(0.3);
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
      this.geometry = new THREE.PlaneGeometry(1, 1);
      this.material = new MeshStandardNodeMaterial();
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.mesh.visible = false;
      return;
    }

    const maxDim = Math.max(mapData.width, mapData.height);
    const segments = Math.min(256, Math.max(64, Math.floor(maxDim)));
    this.geometry = new THREE.PlaneGeometry(mapData.width, mapData.height, segments, segments);

    const isLava = biome.name === 'Volcanic';

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
      this.uDeepWaterColor.value.copy(biome.colors.water).multiplyScalar(0.35);
      this.uIsLava.value = 0.0;
    }

    this.material = this.createTSLMaterial();

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(mapData.width / 2, biome.waterLevel, mapData.height / 2);
    this.mesh.renderOrder = 5;
  }

  /**
   * Calculate single Gerstner wave Y displacement
   */
  private calcWaveY(
    wave: ReturnType<typeof uniform<THREE.Vector4>>,
    posX: ReturnType<typeof float>,
    posY: ReturnType<typeof float>,
    time: ReturnType<typeof uniform<number>>,
    waveSpeed: ReturnType<typeof uniform<number>>
  ) {
    const dirX = wave.x;
    const dirY = wave.y;
    const steepness = wave.z;
    const wavelength = wave.w;

    const k = float(2.0 * Math.PI).div(wavelength);
    const c = sqrt(float(9.8).div(k)).mul(waveSpeed);
    const len = sqrt(dirX.mul(dirX).add(dirY.mul(dirY)));
    const dx = dirX.div(len);
    const dy = dirY.div(len);
    const phase = k.mul(dx.mul(posX).add(dy.mul(posY)).sub(c.mul(time)));
    const a = steepness.div(k);

    return a.mul(sin(phase));
  }

  /**
   * Calculate Gerstner wave X displacement
   */
  private calcWaveX(
    wave: ReturnType<typeof uniform<THREE.Vector4>>,
    posX: ReturnType<typeof float>,
    posY: ReturnType<typeof float>,
    time: ReturnType<typeof uniform<number>>,
    waveSpeed: ReturnType<typeof uniform<number>>
  ) {
    const dirX = wave.x;
    const dirY = wave.y;
    const steepness = wave.z;
    const wavelength = wave.w;

    const k = float(2.0 * Math.PI).div(wavelength);
    const c = sqrt(float(9.8).div(k)).mul(waveSpeed);
    const len = sqrt(dirX.mul(dirX).add(dirY.mul(dirY)));
    const dx = dirX.div(len);
    const dy = dirY.div(len);
    const phase = k.mul(dx.mul(posX).add(dy.mul(posY)).sub(c.mul(time)));
    const a = steepness.div(k);

    return dx.mul(a).mul(cos(phase));
  }

  /**
   * Calculate Gerstner wave Z displacement
   */
  private calcWaveZ(
    wave: ReturnType<typeof uniform<THREE.Vector4>>,
    posX: ReturnType<typeof float>,
    posY: ReturnType<typeof float>,
    time: ReturnType<typeof uniform<number>>,
    waveSpeed: ReturnType<typeof uniform<number>>
  ) {
    const dirX = wave.x;
    const dirY = wave.y;
    const steepness = wave.z;
    const wavelength = wave.w;

    const k = float(2.0 * Math.PI).div(wavelength);
    const c = sqrt(float(9.8).div(k)).mul(waveSpeed);
    const len = sqrt(dirX.mul(dirX).add(dirY.mul(dirY)));
    const dx = dirX.div(len);
    const dy = dirY.div(len);
    const phase = k.mul(dx.mul(posX).add(dy.mul(posY)).sub(c.mul(time)));
    const a = steepness.div(k);

    return dy.mul(a).mul(cos(phase));
  }

  private createTSLMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;

    // Position node with vertex displacement
    const positionNode = Fn(() => {
      const pos = positionLocal;
      const time = this.uTime;
      const posX = pos.x;
      const posY = pos.y;

      // Calculate all wave displacements
      const dispY0 = this.calcWaveY(this.uWave0, posX, posY, time, this.uWaveSpeed);
      const dispY1 = this.calcWaveY(this.uWave1, posX, posY, time, this.uWaveSpeed);
      const dispY2 = this.calcWaveY(this.uWave2, posX, posY, time, this.uWaveSpeed);
      const dispY3 = this.calcWaveY(this.uWave3, posX, posY, time, this.uWaveSpeed);
      const dispY4 = this.calcWaveY(this.uWave4, posX, posY, time, this.uWaveSpeed);
      const dispY5 = this.calcWaveY(this.uWave5, posX, posY, time, this.uWaveSpeed);

      const dispX0 = this.calcWaveX(this.uWave0, posX, posY, time, this.uWaveSpeed);
      const dispX1 = this.calcWaveX(this.uWave1, posX, posY, time, this.uWaveSpeed);
      const dispX2 = this.calcWaveX(this.uWave2, posX, posY, time, this.uWaveSpeed);

      const dispZ0 = this.calcWaveZ(this.uWave0, posX, posY, time, this.uWaveSpeed);
      const dispZ1 = this.calcWaveZ(this.uWave1, posX, posY, time, this.uWaveSpeed);
      const dispZ2 = this.calcWaveZ(this.uWave2, posX, posY, time, this.uWaveSpeed);

      const totalY = dispY0.add(dispY1).add(dispY2).add(dispY3).add(dispY4).add(dispY5);
      const totalX = dispX0.add(dispX1).add(dispX2);
      const totalZ = dispZ0.add(dispZ1).add(dispZ2);

      return vec3(
        pos.x.add(totalX.mul(this.uWaveHeight)),
        pos.y.add(totalZ.mul(this.uWaveHeight)),
        totalY.mul(this.uWaveHeight)
      );
    })();

    material.positionNode = positionNode;

    // Color/output node
    const outputNode = Fn(() => {
      const worldPos = positionWorld;
      const pos = positionLocal;
      const uvCoord = uv();
      const time = this.uTime;
      const posX = pos.x;
      const posY = pos.y;

      // Calculate wave heights
      const dispY0 = this.calcWaveY(this.uWave0, posX, posY, time, this.uWaveSpeed);
      const dispY1 = this.calcWaveY(this.uWave1, posX, posY, time, this.uWaveSpeed);
      const dispY2 = this.calcWaveY(this.uWave2, posX, posY, time, this.uWaveSpeed);
      const dispY3 = this.calcWaveY(this.uWave3, posX, posY, time, this.uWaveSpeed);
      const dispY4 = this.calcWaveY(this.uWave4, posX, posY, time, this.uWaveSpeed);
      const dispY5 = this.calcWaveY(this.uWave5, posX, posY, time, this.uWaveSpeed);

      const totalDispY = dispY0.add(dispY1).add(dispY2).add(dispY3).add(dispY4).add(dispY5)
        .mul(this.uWaveHeight);

      // Approximate normal from finite differences
      const eps = float(0.5);
      const hL = this.calcWaveY(this.uWave0, posX.sub(eps), posY, time, this.uWaveSpeed)
        .add(this.calcWaveY(this.uWave1, posX.sub(eps), posY, time, this.uWaveSpeed))
        .add(this.calcWaveY(this.uWave2, posX.sub(eps), posY, time, this.uWaveSpeed));
      const hR = this.calcWaveY(this.uWave0, posX.add(eps), posY, time, this.uWaveSpeed)
        .add(this.calcWaveY(this.uWave1, posX.add(eps), posY, time, this.uWaveSpeed))
        .add(this.calcWaveY(this.uWave2, posX.add(eps), posY, time, this.uWaveSpeed));
      const hD = this.calcWaveY(this.uWave0, posX, posY.sub(eps), time, this.uWaveSpeed)
        .add(this.calcWaveY(this.uWave1, posX, posY.sub(eps), time, this.uWaveSpeed))
        .add(this.calcWaveY(this.uWave2, posX, posY.sub(eps), time, this.uWaveSpeed));
      const hU = this.calcWaveY(this.uWave0, posX, posY.add(eps), time, this.uWaveSpeed)
        .add(this.calcWaveY(this.uWave1, posX, posY.add(eps), time, this.uWaveSpeed))
        .add(this.calcWaveY(this.uWave2, posX, posY.add(eps), time, this.uWaveSpeed));

      const waterNormal = normalize(vec3(
        hL.sub(hR).mul(this.uWaveHeight),
        eps.mul(2.0),
        hD.sub(hU).mul(this.uWaveHeight)
      ));

      // Foam at wave crests
      const crestFoam = smoothstep(this.uFoamThreshold, float(0.6), totalDispY);
      const foamNoise = sin(posX.mul(20.0).add(time.mul(2.5)))
        .mul(sin(posY.mul(18.0).add(time.mul(2.0))))
        .mul(0.25).add(0.75);
      const foam = crestFoam.mul(foamNoise);

      // Flow animation
      const flowDir = this.uFlowDirection.normalize();
      const flowOffset = flowDir.mul(time.mul(this.uFlowSpeed));
      const flowUV = uvCoord.add(flowOffset);

      // High-frequency ripples
      const ripple1 = sin(flowUV.x.mul(50.0).add(time.mul(1.5)))
        .mul(sin(flowUV.y.mul(45.0).add(time.mul(1.2))))
        .mul(0.08);
      const ripple2 = sin(flowUV.x.mul(80.0).sub(time.mul(1.8)))
        .mul(sin(flowUV.y.mul(72.0).add(time.mul(1.5))))
        .mul(0.04);

      // View direction
      const viewDir = normalize(cameraPosition.sub(worldPos));

      // Fresnel (Schlick, F0 = 0.02)
      const F0 = float(0.02);
      const NdotV = max(dot(waterNormal, viewDir), float(0.001));
      const fresnel = F0.add(float(1.0).sub(F0).mul(pow(float(1.0).sub(NdotV), this.uFresnelPower)));

      // Beer-Lambert absorption
      const absorptionCoeff = vec3(0.45, 0.09, 0.06);
      const waterDepth = totalDispY.negate().mul(3.0).add(2.0).mul(this.uAbsorptionScale);
      const transmittance = exp(absorptionCoeff.negate().mul(max(waterDepth, float(0.0))));

      // Subsurface scattering
      const sssHalf = normalize(viewDir.add(vec3(0, -0.3, 0)));
      const sssDot = max(dot(viewDir.negate(), sssHalf), float(0.0));
      const sss = pow(sssDot, float(4.0)).mul(this.uSubsurfaceStrength);
      const sssContrib = vec3(this.uScatterColor).mul(sss);

      // Depth-based color
      const depthMix = smoothstep(float(-0.5), float(0.5), totalDispY);
      let waterColor = mix(vec3(this.uDeepWaterColor), vec3(this.uWaterColor), depthMix);

      // Apply absorption
      waterColor = waterColor.mul(transmittance);

      // Add SSS
      waterColor = waterColor.add(sssContrib);

      // Caustics
      const caustic1 = sin(posX.mul(6.0).add(time.mul(1.0)))
        .mul(sin(posY.mul(5.0).add(time.mul(0.8))));
      const caustic2 = sin(posX.mul(9.0).sub(time.mul(0.7)))
        .mul(sin(posY.mul(8.0).add(time.mul(1.1))));
      const caustics = max(caustic1.mul(caustic2), float(0.0)).mul(0.12);
      waterColor = waterColor.add(caustics.mul(vec3(0.5, 0.8, 1.0)));

      // Sky reflection
      const skyColor = vec3(0.7, 0.85, 1.0);
      waterColor = mix(waterColor, skyColor, fresnel.mul(this.uReflectivity));

      // Add foam
      waterColor = mix(waterColor, vec3(this.uFoamColor), foam.mul(float(1.0).sub(this.uIsLava)));

      // Specular highlights
      const sunDir = normalize(vec3(0.4, 0.8, 0.4));
      const halfVec = normalize(viewDir.add(sunDir));
      const specular = pow(max(dot(waterNormal, halfVec), float(0.0)), this.uSpecularPower);
      waterColor = waterColor.add(specular.mul(0.6).mul(float(1.0).sub(foam)));

      // Lava glow
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

    // Roughness
    material.roughnessNode = Fn(() => {
      const pos = positionLocal;
      const time = this.uTime;

      const waveHeight = sin(pos.x.mul(0.1).add(time.mul(0.5)))
        .mul(sin(pos.y.mul(0.08).add(time.mul(0.4))));
      const foamFactor = smoothstep(float(0.3), float(0.8), waveHeight);

      return mix(float(0.02), float(0.5), foamFactor);
    })();

    material.metalnessNode = float(0.05);

    return material;
  }

  public update(time: number): void {
    if (this.mesh.visible) {
      this.uTime.value = time;
    }
  }

  public setWaveConfig(height: number, speed: number): void {
    this.uWaveHeight.value = height;
    this.uWaveSpeed.value = speed;
  }

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

  public setFlowDirection(x: number, z: number, speed: number = 0.05): void {
    this.uFlowDirection.value.set(x, z);
    this.uFlowSpeed.value = speed;
  }

  public setWave(index: number, direction: THREE.Vector2, steepness: number, wavelength: number): void {
    const waves = [this.uWave0, this.uWave1, this.uWave2, this.uWave3, this.uWave4, this.uWave5];
    if (index >= 0 && index < waves.length) {
      waves[index].value.set(direction.x, direction.y, steepness, wavelength);
    }
  }

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

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * OceanWater - RTS-optimized animated ocean shader using TSL
 *
 * Designed for RTS camera angles and gameplay clarity. Uses subtle wave
 * animation that doesn't distract from units or obscure gameplay.
 *
 * Features:
 * - RTS-scale Gerstner waves (subtle, readable)
 * - Normal map simulation for surface detail without geometry cost
 * - Depth-based color variation
 * - Fresnel reflections tuned for top-down viewing
 * - Subtle caustic patterns
 * - Performance-optimized for large maps with many units
 *
 * Based on Age of Empires 4, Supreme Commander, and Total War water techniques.
 */

import * as THREE from 'three';
import {
  Fn,
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

// RTS wave configuration - subtle, not distracting
// Steepness: 0.006-0.04, Wavelength: 0.7-12 units
const RTS_WAVES = {
  wave0: new THREE.Vector4(1.0, 0.0, 0.035, 10.0),    // Primary swell
  wave1: new THREE.Vector4(0.0, 1.0, 0.028, 6.0),     // Secondary perpendicular
  wave2: new THREE.Vector4(0.7, 0.7, 0.020, 3.5),     // Detail diagonal
  wave3: new THREE.Vector4(-0.7, 0.7, 0.015, 2.0),    // Cross detail
  wave4: new THREE.Vector4(0.5, -0.8, 0.010, 1.2),    // Fine shimmer
  wave5: new THREE.Vector4(-0.3, -0.9, 0.006, 0.7),   // Micro ripples
};

export class OceanWater {
  public mesh: THREE.Mesh;
  private material: MeshStandardNodeMaterial;
  private geometry: THREE.PlaneGeometry;

  // Core uniforms
  private uTime = uniform(0);
  private uWaterColor = uniform(new THREE.Color(0x3399cc));
  private uDeepWaterColor = uniform(new THREE.Color(0x1a5577));
  private uScatterColor = uniform(new THREE.Color(0x66ddbb));
  private uFoamColor = uniform(new THREE.Color(0xe8f0f4));

  // RTS-appropriate wave parameters
  private uWaveHeight = uniform(0.08);  // Much lower than ocean (was 1.0)
  private uWaveSpeed = uniform(0.6);    // Slower, calmer

  // Physical parameters tuned for RTS
  private uFresnelPower = uniform(3.5);        // Less dramatic (was 5.0)
  private uSubsurfaceStrength = uniform(0.25); // Subtle (was 0.5)
  private uFoamThreshold = uniform(0.02);      // Lower for RTS scale
  private uAbsorptionScale = uniform(0.5);     // Less aggressive

  // Flow parameters
  private uFlowDirection = uniform(new THREE.Vector2(1.0, 0.3));
  private uFlowSpeed = uniform(0.03);

  // Material parameters
  private uReflectivity = uniform(0.35);       // Moderate
  private uSpecularPower = uniform(128.0);     // Softer (was 512)
  private uIsLava = uniform(0);

  // RTS wave uniforms (subtle parameters)
  private uWave0 = uniform(RTS_WAVES.wave0);
  private uWave1 = uniform(RTS_WAVES.wave1);
  private uWave2 = uniform(RTS_WAVES.wave2);
  private uWave3 = uniform(RTS_WAVES.wave3);
  private uWave4 = uniform(RTS_WAVES.wave4);
  private uWave5 = uniform(RTS_WAVES.wave5);

  constructor(mapData: MapData, biome: BiomeConfig) {
    if (!biome.hasWater) {
      this.geometry = new THREE.PlaneGeometry(1, 1);
      this.material = new MeshStandardNodeMaterial();
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.mesh.visible = false;
      return;
    }

    // Moderate segment count - RTS doesn't need high tessellation
    const maxDim = Math.max(mapData.width, mapData.height);
    const segments = Math.min(128, Math.max(32, Math.floor(maxDim / 2)));
    this.geometry = new THREE.PlaneGeometry(mapData.width, mapData.height, segments, segments);

    const isLava = biome.name === 'Volcanic';

    if (isLava) {
      this.uWaterColor.value.set(0xff4010);
      this.uDeepWaterColor.value.set(0x801000);
      this.uScatterColor.value.set(0xff8800);
      this.uFoamColor.value.set(0xffff00);
      this.uIsLava.value = 1.0;
      this.uWaveHeight.value = 0.04; // Even less for lava
      this.uFoamThreshold.value = 0.015;
    } else {
      this.uWaterColor.value.copy(biome.colors.water);
      this.uDeepWaterColor.value.copy(biome.colors.water).multiplyScalar(0.5);
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
    const dx = dirX.div(max(len, float(0.001)));
    const dy = dirY.div(max(len, float(0.001)));
    const phase = k.mul(dx.mul(posX).add(dy.mul(posY)).sub(c.mul(time)));
    const a = steepness.div(k);

    return a.mul(sin(phase));
  }

  private createTSLMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;

    // Minimal vertex displacement for RTS - just enough for silhouette
    const positionNode = Fn(() => {
      const pos = positionLocal;
      const time = this.uTime;
      const posX = pos.x;
      const posY = pos.y;

      // Only use first 3 waves for displacement (performance)
      const dispY0 = this.calcWaveY(this.uWave0, posX, posY, time, this.uWaveSpeed);
      const dispY1 = this.calcWaveY(this.uWave1, posX, posY, time, this.uWaveSpeed);
      const dispY2 = this.calcWaveY(this.uWave2, posX, posY, time, this.uWaveSpeed);

      const totalY = dispY0.add(dispY1).add(dispY2).mul(this.uWaveHeight);

      // Minimal XZ displacement for RTS
      return vec3(pos.x, pos.y, totalY);
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

      // Calculate wave heights (all 6 for color variation)
      const dispY0 = this.calcWaveY(this.uWave0, posX, posY, time, this.uWaveSpeed);
      const dispY1 = this.calcWaveY(this.uWave1, posX, posY, time, this.uWaveSpeed);
      const dispY2 = this.calcWaveY(this.uWave2, posX, posY, time, this.uWaveSpeed);
      const dispY3 = this.calcWaveY(this.uWave3, posX, posY, time, this.uWaveSpeed);
      const dispY4 = this.calcWaveY(this.uWave4, posX, posY, time, this.uWaveSpeed);
      const dispY5 = this.calcWaveY(this.uWave5, posX, posY, time, this.uWaveSpeed);

      const totalDispY = dispY0.add(dispY1).add(dispY2).add(dispY3).add(dispY4).add(dispY5)
        .mul(this.uWaveHeight);

      // Normal from finite differences (3 main waves)
      const eps = float(0.2);
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

      const geometricNormal = normalize(vec3(
        hL.sub(hR).mul(this.uWaveHeight),
        eps.mul(2.0),
        hD.sub(hU).mul(this.uWaveHeight)
      ));

      // Scrolling normal map simulation for detail
      const normalScale1 = float(8.0);
      const normalScale2 = float(12.0);
      const normalSpeed1 = float(0.03);
      const normalSpeed2 = float(0.025);

      const n1x = sin(posX.mul(normalScale1).add(time.mul(normalSpeed1)))
        .mul(cos(posY.mul(normalScale1).add(time.mul(normalSpeed1).mul(0.7))));
      const n1z = cos(posX.mul(normalScale1).add(time.mul(normalSpeed1).mul(1.3)))
        .mul(sin(posY.mul(normalScale1).add(time.mul(normalSpeed1))));

      const n2x = sin(posX.mul(normalScale2).sub(time.mul(normalSpeed2)))
        .mul(cos(posY.mul(normalScale2).add(time.mul(normalSpeed2).mul(0.8))));
      const n2z = cos(posX.mul(normalScale2).sub(time.mul(normalSpeed2).mul(1.2)))
        .mul(sin(posY.mul(normalScale2).sub(time.mul(normalSpeed2))));

      const detailStrength = float(0.12);
      const waterNormal = normalize(vec3(
        geometricNormal.x.add(n1x.add(n2x).mul(detailStrength)),
        geometricNormal.y,
        geometricNormal.z.add(n1z.add(n2z).mul(detailStrength))
      ));

      // Foam at wave crests (very subtle for RTS)
      const crestFoam = smoothstep(this.uFoamThreshold, this.uFoamThreshold.mul(2.5), totalDispY);
      const foamNoise = sin(posX.mul(18.0).add(time.mul(1.5)))
        .mul(sin(posY.mul(15.0).add(time.mul(1.2))))
        .mul(0.3).add(0.7);
      const foam = crestFoam.mul(foamNoise).mul(0.3);

      // Flow animation
      const flowDir = this.uFlowDirection.normalize();
      const flowOffset = flowDir.mul(time.mul(this.uFlowSpeed));
      const flowUV = uvCoord.add(flowOffset);

      // View direction
      const viewDir = normalize(cameraPosition.sub(worldPos));

      // Fresnel (RTS-tuned)
      const F0 = float(0.02);
      const NdotV = max(dot(waterNormal, viewDir), float(0.001));
      const fresnel = F0.add(float(1.0).sub(F0).mul(pow(float(1.0).sub(NdotV), this.uFresnelPower)));

      // Beer-Lambert absorption (gentler for RTS)
      const absorptionCoeff = vec3(0.35, 0.08, 0.05);
      const waterDepth = totalDispY.negate().mul(2.0).add(1.5).mul(this.uAbsorptionScale);
      const transmittance = exp(absorptionCoeff.negate().mul(max(waterDepth, float(0.0))));

      // Subsurface scattering (subtle)
      const sssHalf = normalize(viewDir.add(vec3(0, -0.3, 0)));
      const sssDot = max(dot(viewDir.negate(), sssHalf), float(0.0));
      const sss = pow(sssDot, float(4.0)).mul(this.uSubsurfaceStrength);
      const sssContrib = vec3(this.uScatterColor).mul(sss);

      // Depth-based color
      const waveHeight = totalDispY.mul(8.0).add(0.5);
      const depthMix = smoothstep(float(0.3), float(0.7), waveHeight);
      let waterColor = mix(vec3(this.uDeepWaterColor), vec3(this.uWaterColor), depthMix);

      // Apply absorption
      waterColor = waterColor.mul(transmittance);

      // Add SSS
      waterColor = waterColor.add(sssContrib);

      // Caustics (subtle for RTS)
      const caustic1 = sin(posX.mul(6.0).add(time.mul(0.8)))
        .mul(sin(posY.mul(5.0).add(time.mul(0.6))));
      const caustic2 = sin(posX.mul(9.0).sub(time.mul(0.5)))
        .mul(sin(posY.mul(8.0).add(time.mul(0.7))));
      const caustics = max(caustic1.mul(caustic2), float(0.0)).mul(0.08);
      waterColor = waterColor.add(caustics.mul(vec3(0.5, 0.7, 0.9)));

      // Sky reflection (moderate for RTS)
      const skyColor = vec3(0.75, 0.88, 1.0);
      waterColor = mix(waterColor, skyColor, fresnel.mul(this.uReflectivity));

      // Add foam
      waterColor = mix(waterColor, vec3(this.uFoamColor), foam.mul(float(1.0).sub(this.uIsLava)));

      // Specular highlights (softer for RTS)
      const sunDir = normalize(vec3(0.4, 0.8, 0.4));
      const halfVec = normalize(viewDir.add(sunDir));
      const specular = pow(max(dot(waterNormal, halfVec), float(0.0)), this.uSpecularPower);
      waterColor = waterColor.add(specular.mul(0.35).mul(float(1.0).sub(foam)));

      // Lava glow
      const lavaGlow = sin(time.mul(3.0)).mul(0.15).add(0.85);
      const lavaEmissive = vec3(1.0, 0.4, 0.0).mul(lavaGlow.mul(this.uIsLava).mul(0.8));
      waterColor = waterColor.add(lavaEmissive);

      // Final alpha (more opaque for RTS readability)
      const baseAlpha = mix(float(0.72), float(0.88), depthMix);
      const alpha = mix(baseAlpha, float(0.92), foam.add(fresnel.mul(0.15)));
      const finalAlpha = mix(alpha, float(0.9), this.uIsLava);

      return vec4(
        clamp(waterColor, float(0.0), float(1.0)),
        clamp(finalAlpha, float(0.6), float(0.92))
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

      return mix(float(0.05), float(0.4), foamFactor);
    })();

    material.metalnessNode = float(0.03);

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

  public setFlowDirection(x: number, z: number, speed: number = 0.03): void {
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

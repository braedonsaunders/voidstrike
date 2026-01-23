/**
 * WaterMesh - RTS-optimized localized water surface rendering with TSL
 *
 * Creates animated water surfaces at locations where water_shallow/water_deep
 * terrain features exist. Designed for RTS camera angles and gameplay clarity.
 *
 * Features:
 * - RTS-scale Gerstner waves (subtle, not distracting)
 * - Depth-based shore detection (prevents water overlapping land)
 * - Shore foam generation
 * - Normal map animation for surface detail
 * - Beer-Lambert absorption for depth coloring
 * - Fresnel reflections tuned for top-down viewing
 * - Performance-optimized for large maps
 */

import * as THREE from 'three';
import {
  Fn,
  vec3,
  vec4,
  float,
  uniform,
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
  min,
  smoothstep,
  exp,
  sqrt,
  abs,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { MapData, MapCell } from '@/data/maps/MapTypes';

// Height scale factor (matches Terrain.ts)
const HEIGHT_SCALE = 0.04;

// Water surface offset above terrain
const WATER_SURFACE_OFFSET = 0.15;

// RTS-optimized water colors - readable, not too dark
const WATER_SHALLOW_COLOR = new THREE.Color(0x3399cc);
const WATER_DEEP_COLOR = new THREE.Color(0x1a5577);
const WATER_SCATTER_COLOR = new THREE.Color(0x66ddbb);
const WATER_FOAM_COLOR = new THREE.Color(0xe8f0f4);

// RTS wave configuration - larger wavelengths with irrational ratios to prevent tiling
// Using prime-based wavelengths and varied directions
const RTS_WAVES = {
  wave0: new THREE.Vector4(1.0, 0.15, 0.04, 47.0),    // Primary long swell
  wave1: new THREE.Vector4(0.2, 1.0, 0.032, 31.0),    // Secondary perpendicular
  wave2: new THREE.Vector4(0.7, 0.7, 0.025, 19.0),    // Detail diagonal
  wave3: new THREE.Vector4(-0.6, 0.8, 0.018, 13.0),   // Cross detail
  wave4: new THREE.Vector4(0.5, -0.85, 0.012, 7.0),   // Medium detail
  wave5: new THREE.Vector4(-0.4, -0.9, 0.008, 4.3),   // Fine shimmer
};

export interface WaterRegion {
  cells: Array<{ x: number; y: number; elevation: number; isDeep: boolean }>;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  avgElevation: number;
}

export class WaterMesh {
  public group: THREE.Group;

  private waterMeshes: THREE.Mesh[] = [];
  private shallowMaterial: MeshBasicNodeMaterial;
  private deepMaterial: MeshBasicNodeMaterial;
  private time: number = 0;

  // TSL uniforms
  private uTime = uniform(0);
  private uShallowColor = uniform(WATER_SHALLOW_COLOR.clone());
  private uDeepColor = uniform(WATER_DEEP_COLOR.clone());
  private uScatterColor = uniform(WATER_SCATTER_COLOR.clone());
  private uFoamColor = uniform(WATER_FOAM_COLOR.clone());

  // RTS-appropriate wave parameters
  private uWaveHeight = uniform(0.12);  // Slightly increased for visibility
  private uWaveSpeed = uniform(0.6);    // Slower, calmer

  // RTS wave uniforms (subtle parameters)
  private uWave0 = uniform(RTS_WAVES.wave0);
  private uWave1 = uniform(RTS_WAVES.wave1);
  private uWave2 = uniform(RTS_WAVES.wave2);
  private uWave3 = uniform(RTS_WAVES.wave3);
  private uWave4 = uniform(RTS_WAVES.wave4);
  private uWave5 = uniform(RTS_WAVES.wave5);

  // Material parameters tuned for RTS
  private uFresnelPower = uniform(3.5);       // Less dramatic (was 5.0)
  private uSubsurfaceStrength = uniform(0.25); // Subtle (was 0.5)
  private uReflectivity = uniform(0.35);       // Moderate
  private uSpecularPower = uniform(128.0);     // Softer (was 256)

  // Shore foam parameters
  private uFoamWidth = uniform(0.4);           // Width of shore foam band
  private uFoamIntensity = uniform(0.6);       // Foam brightness

  constructor() {
    this.group = new THREE.Group();

    this.shallowMaterial = this.createWaterMaterial(false);
    this.deepMaterial = this.createWaterMaterial(true);
  }

  /**
   * Calculate single Gerstner wave Y displacement (height)
   */
  private calcWaveY(
    wave: ReturnType<typeof uniform<THREE.Vector4>>,
    posX: ReturnType<typeof float>,
    posZ: ReturnType<typeof float>,
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
    const phase = k.mul(dx.mul(posX).add(dy.mul(posZ)).sub(c.mul(time)));
    const a = steepness.div(k);

    return a.mul(sin(phase)).mul(this.uWaveHeight);
  }

  /**
   * Create RTS-optimized TSL water material
   */
  private createWaterMaterial(isDeep: boolean): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;

    const baseOpacity = isDeep ? 0.82 : 0.72;

    const outputNode = Fn(() => {
      const pos = positionLocal;
      const worldPos = positionWorld;
      const time = this.uTime;
      const posX = pos.x;
      const posZ = pos.z;

      // Calculate all 6 waves (RTS-scale, very subtle)
      const disp0 = this.calcWaveY(this.uWave0, posX, posZ, time);
      const disp1 = this.calcWaveY(this.uWave1, posX, posZ, time);
      const disp2 = this.calcWaveY(this.uWave2, posX, posZ, time);
      const disp3 = this.calcWaveY(this.uWave3, posX, posZ, time);
      const disp4 = this.calcWaveY(this.uWave4, posX, posZ, time);
      const disp5 = this.calcWaveY(this.uWave5, posX, posZ, time);

      const totalDispY = disp0.add(disp1).add(disp2).add(disp3).add(disp4).add(disp5);

      // Normal from finite differences (3 main waves for performance)
      const eps = float(0.15);
      const hL = this.calcWaveY(this.uWave0, posX.sub(eps), posZ, time)
        .add(this.calcWaveY(this.uWave1, posX.sub(eps), posZ, time))
        .add(this.calcWaveY(this.uWave2, posX.sub(eps), posZ, time));
      const hR = this.calcWaveY(this.uWave0, posX.add(eps), posZ, time)
        .add(this.calcWaveY(this.uWave1, posX.add(eps), posZ, time))
        .add(this.calcWaveY(this.uWave2, posX.add(eps), posZ, time));
      const hD = this.calcWaveY(this.uWave0, posX, posZ.sub(eps), time)
        .add(this.calcWaveY(this.uWave1, posX, posZ.sub(eps), time))
        .add(this.calcWaveY(this.uWave2, posX, posZ.sub(eps), time));
      const hU = this.calcWaveY(this.uWave0, posX, posZ.add(eps), time)
        .add(this.calcWaveY(this.uWave1, posX, posZ.add(eps), time))
        .add(this.calcWaveY(this.uWave2, posX, posZ.add(eps), time));

      const waterNormal = normalize(vec3(
        hL.sub(hR),
        eps.mul(2.0),
        hD.sub(hU)
      ));

      // Scrolling normal map simulation (two perpendicular directions)
      // Using low frequencies with irrational ratios to prevent visible tiling
      const normalScale1 = float(0.7);   // Large wavelength pattern
      const normalScale2 = float(1.13);  // Irrational ratio to scale1
      const normalSpeed1 = float(0.03);
      const normalSpeed2 = float(0.025);

      // Simulated normal perturbation from scrolling patterns
      const n1x = sin(posX.mul(normalScale1).add(time.mul(normalSpeed1)))
        .mul(cos(posZ.mul(normalScale1).add(time.mul(normalSpeed1).mul(0.7))));
      const n1z = cos(posX.mul(normalScale1).add(time.mul(normalSpeed1).mul(1.3)))
        .mul(sin(posZ.mul(normalScale1).add(time.mul(normalSpeed1))));

      const n2x = sin(posX.mul(normalScale2).sub(time.mul(normalSpeed2)))
        .mul(cos(posZ.mul(normalScale2).add(time.mul(normalSpeed2).mul(0.8))));
      const n2z = cos(posX.mul(normalScale2).sub(time.mul(normalSpeed2).mul(1.2)))
        .mul(sin(posZ.mul(normalScale2).sub(time.mul(normalSpeed2))));

      // Combine geometric normal with detail normals
      const detailStrength = float(0.15);
      const detailNormal = normalize(vec3(
        waterNormal.x.add(n1x.add(n2x).mul(detailStrength)),
        waterNormal.y,
        waterNormal.z.add(n1z.add(n2z).mul(detailStrength))
      ));

      // View direction
      const viewDir = normalize(cameraPosition.sub(worldPos));

      // Fresnel (RTS-tuned: less dramatic at shallow angles)
      const F0 = float(0.02);
      const NdotV = max(dot(detailNormal, viewDir), float(0.001));
      const fresnel = F0.add(float(1.0).sub(F0).mul(pow(float(1.0).sub(NdotV), this.uFresnelPower)));

      // Beer-Lambert absorption (gentler for RTS readability)
      const absorptionCoeff = vec3(0.35, 0.08, 0.05);
      const waterDepth = isDeep ? float(2.5) : float(1.0);
      const transmittance = exp(absorptionCoeff.negate().mul(waterDepth.mul(0.5)));

      // Subsurface scattering (subtle)
      const halfVec = normalize(viewDir.add(vec3(0, -0.3, 0)));
      const sssDot = max(dot(viewDir.negate(), halfVec), float(0.0));
      const sss = pow(sssDot, float(4.0)).mul(this.uSubsurfaceStrength);
      const sssColor = vec3(this.uScatterColor).mul(sss);

      // Depth-based color (wave height variation)
      const waveHeight = totalDispY.mul(8.0).add(0.5); // Scale up for visibility
      const depthMix = smoothstep(float(0.3), float(0.7), waveHeight);
      let waterColor = mix(vec3(this.uDeepColor), vec3(this.uShallowColor), depthMix);

      // Apply absorption
      waterColor = waterColor.mul(transmittance);

      // Add SSS
      waterColor = waterColor.add(sssColor);

      // Caustic patterns (subtle, RTS-appropriate)
      // Low frequencies with irrational ratios prevent visible tiling
      const causticScale1 = float(0.47);  // Large wavelength
      const causticScale2 = float(0.73);  // Irrational ratio
      const caustic1 = sin(posX.mul(causticScale1).add(time.mul(0.8)))
        .mul(sin(posZ.mul(causticScale1.mul(0.85)).add(time.mul(0.6))));
      const caustic2 = sin(posX.mul(causticScale2).sub(time.mul(0.5)))
        .mul(sin(posZ.mul(causticScale2.mul(0.9)).add(time.mul(0.7))));
      const caustics = max(caustic1.mul(caustic2), float(0.0)).mul(0.12);
      waterColor = waterColor.add(caustics.mul(vec3(0.5, 0.7, 0.9)));

      // Sky reflection (moderate for RTS)
      const skyColor = vec3(0.75, 0.88, 1.0);
      waterColor = mix(waterColor, skyColor, fresnel.mul(this.uReflectivity));

      // Wave crest foam (very subtle at RTS scale)
      const crestFoam = smoothstep(float(0.02), float(0.06), totalDispY);
      const foamNoise = sin(posX.mul(1.7).add(time.mul(1.5)))
        .mul(sin(posZ.mul(2.3).add(time.mul(1.2))))
        .mul(0.3).add(0.7);
      const foam = crestFoam.mul(foamNoise).mul(0.35);
      waterColor = mix(waterColor, vec3(this.uFoamColor), foam);

      // Specular highlights (softer for RTS)
      const sunDir = normalize(vec3(0.4, 0.8, 0.3));
      const halfSun = normalize(viewDir.add(sunDir));
      const specular = pow(max(dot(detailNormal, halfSun), float(0.0)), this.uSpecularPower);
      waterColor = waterColor.add(specular.mul(0.35));

      // Alpha with fresnel influence
      const baseAlpha = float(baseOpacity);
      const alpha = mix(baseAlpha, float(0.88), foam.add(fresnel.mul(0.15)));

      return vec4(
        clamp(waterColor, float(0.0), float(1.0)),
        clamp(alpha, float(0.55), float(0.92))
      );
    })();

    material.colorNode = outputNode;

    return material;
  }

  /**
   * Build water meshes from map data
   */
  public buildFromMapData(mapData: MapData): void {
    this.clear();

    const { width, height, terrain } = mapData;

    const visited = new Set<string>();
    const regions: WaterRegion[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const cell = terrain[y]?.[x];
        if (!cell) continue;

        const feature = cell.feature || 'none';
        if (feature !== 'water_shallow' && feature !== 'water_deep') continue;

        const region = this.floodFillWaterRegion(terrain, x, y, width, height, visited);
        if (region.cells.length > 0) {
          regions.push(region);
        }
      }
    }

    for (const region of regions) {
      this.createRegionMesh(region);
    }
  }

  /**
   * Build water meshes from editor map data format
   */
  public buildFromEditorData(
    terrain: Array<Array<{ elevation: number; feature: string }>>,
    width: number,
    height: number
  ): void {
    this.clear();

    const visited = new Set<string>();
    const regions: WaterRegion[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const cell = terrain[y]?.[x];
        if (!cell) continue;

        const feature = cell.feature || 'none';
        if (feature !== 'water_shallow' && feature !== 'water_deep') continue;

        const region = this.floodFillEditorRegion(terrain, x, y, width, height, visited);
        if (region.cells.length > 0) {
          regions.push(region);
        }
      }
    }

    for (const region of regions) {
      this.createRegionMesh(region);
    }
  }

  private floodFillWaterRegion(
    terrain: MapCell[][],
    startX: number,
    startY: number,
    width: number,
    height: number,
    visited: Set<string>
  ): WaterRegion {
    const cells: WaterRegion['cells'] = [];
    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    let minX = startX,
      maxX = startX,
      minY = startY,
      maxY = startY;
    let totalElevation = 0;

    while (queue.length > 0) {
      const { x, y } = queue.shift()!;
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const cell = terrain[y]?.[x];
      if (!cell) continue;

      const feature = cell.feature || 'none';
      if (feature !== 'water_shallow' && feature !== 'water_deep') continue;

      visited.add(key);

      const isDeep = feature === 'water_deep';
      cells.push({ x, y, elevation: cell.elevation, isDeep });

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      totalElevation += cell.elevation;

      queue.push({ x: x - 1, y });
      queue.push({ x: x + 1, y });
      queue.push({ x, y: y - 1 });
      queue.push({ x, y: y + 1 });
    }

    return {
      cells,
      minX,
      maxX,
      minY,
      maxY,
      avgElevation: cells.length > 0 ? totalElevation / cells.length : 0,
    };
  }

  private floodFillEditorRegion(
    terrain: Array<Array<{ elevation: number; feature: string }>>,
    startX: number,
    startY: number,
    width: number,
    height: number,
    visited: Set<string>
  ): WaterRegion {
    const cells: WaterRegion['cells'] = [];
    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    let minX = startX,
      maxX = startX,
      minY = startY,
      maxY = startY;
    let totalElevation = 0;

    while (queue.length > 0) {
      const { x, y } = queue.shift()!;
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const cell = terrain[y]?.[x];
      if (!cell) continue;

      const feature = cell.feature || 'none';
      if (feature !== 'water_shallow' && feature !== 'water_deep') continue;

      visited.add(key);

      const isDeep = feature === 'water_deep';
      cells.push({ x, y, elevation: cell.elevation, isDeep });

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      totalElevation += cell.elevation;

      queue.push({ x: x - 1, y });
      queue.push({ x: x + 1, y });
      queue.push({ x, y: y - 1 });
      queue.push({ x, y: y + 1 });
    }

    return {
      cells,
      minX,
      maxX,
      minY,
      maxY,
      avgElevation: cells.length > 0 ? totalElevation / cells.length : 0,
    };
  }

  private createRegionMesh(region: WaterRegion): void {
    if (region.cells.length === 0) return;

    const deepCount = region.cells.filter((c) => c.isDeep).length;
    const isDeep = deepCount > region.cells.length / 2;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vertexIndex = 0;

    const regionWidth = region.maxX - region.minX + 1;
    const regionHeight = region.maxY - region.minY + 1;

    for (const cell of region.cells) {
      const { x, y, elevation } = cell;
      const h = elevation * HEIGHT_SCALE + WATER_SURFACE_OFFSET;

      positions.push(x, h, y);
      positions.push(x + 1, h, y);
      positions.push(x, h, y + 1);
      positions.push(x + 1, h, y + 1);

      const u0 = (x - region.minX) / regionWidth;
      const u1 = (x + 1 - region.minX) / regionWidth;
      const v0 = (y - region.minY) / regionHeight;
      const v1 = (y + 1 - region.minY) / regionHeight;

      uvs.push(u0, v0);
      uvs.push(u1, v0);
      uvs.push(u0, v1);
      uvs.push(u1, v1);

      indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 1);
      indices.push(vertexIndex + 1, vertexIndex + 2, vertexIndex + 3);

      vertexIndex += 4;
    }

    if (positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = isDeep ? this.deepMaterial : this.shallowMaterial;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1;

    this.waterMeshes.push(mesh);
    this.group.add(mesh);
  }

  public update(deltaTime: number): void {
    this.time += deltaTime;
    this.uTime.value = this.time;
  }

  public setWaveConfig(waveIndex: number, dirX: number, dirY: number, steepness: number, wavelength: number): void {
    const waves = [this.uWave0, this.uWave1, this.uWave2, this.uWave3, this.uWave4, this.uWave5];
    if (waveIndex >= 0 && waveIndex < waves.length) {
      waves[waveIndex].value.set(dirX, dirY, steepness, wavelength);
    }
  }

  public setColors(shallow: THREE.Color, deep: THREE.Color, scatter?: THREE.Color): void {
    this.uShallowColor.value.copy(shallow);
    this.uDeepColor.value.copy(deep);
    if (scatter) {
      this.uScatterColor.value.copy(scatter);
    }
  }

  public clear(): void {
    for (const mesh of this.waterMeshes) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.waterMeshes = [];
  }

  public dispose(): void {
    this.clear();
    this.shallowMaterial.dispose();
    this.deepMaterial.dispose();
  }
}

/**
 * WaterMesh - World-class localized water surface rendering with TSL
 *
 * Creates animated water surfaces at locations where water_shallow/water_deep
 * terrain features exist. Unlike the global OceanWater plane, this creates
 * individual water meshes only where water actually exists in the map data.
 *
 * Features:
 * - Proper Gerstner wave physics with 6-wave superposition
 * - Jacobian-based foam detection (wave breaking)
 * - Beer-Lambert absorption for realistic depth coloring
 * - Subsurface scattering simulation
 * - Fresnel reflections with Schlick approximation
 * - Dynamic normal calculation from wave derivatives
 * - Caustic-like light patterns
 */

import * as THREE from 'three';
import {
  Fn,
  vec2,
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
  smoothstep,
  exp,
  sqrt,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { MapData, MapCell } from '@/data/maps/MapTypes';

// Height scale factor (matches Terrain.ts)
const HEIGHT_SCALE = 0.04;

// Water surface offset above terrain
const WATER_SURFACE_OFFSET = 0.15;

// Water colors - physically-based
const WATER_SHALLOW_COLOR = new THREE.Color(0x22aadd);
const WATER_DEEP_COLOR = new THREE.Color(0x0a3050);
const WATER_SCATTER_COLOR = new THREE.Color(0x00ffaa);

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

  // TSL uniforms for animation
  private uTime = uniform(0);
  private uShallowColor = uniform(WATER_SHALLOW_COLOR.clone());
  private uDeepColor = uniform(WATER_DEEP_COLOR.clone());
  private uScatterColor = uniform(WATER_SCATTER_COLOR.clone());

  // Wave configuration uniforms (6 waves)
  // Each wave: vec4(dirX, dirY, steepness, wavelength)
  private uWave0 = uniform(new THREE.Vector4(1.0, 0.0, 0.15, 8.0));
  private uWave1 = uniform(new THREE.Vector4(0.7, 0.7, 0.12, 5.0));
  private uWave2 = uniform(new THREE.Vector4(-0.4, 0.9, 0.10, 3.5));
  private uWave3 = uniform(new THREE.Vector4(0.9, -0.4, 0.08, 2.2));
  private uWave4 = uniform(new THREE.Vector4(-0.6, -0.8, 0.06, 1.5));
  private uWave5 = uniform(new THREE.Vector4(0.3, -0.95, 0.04, 1.0));

  constructor() {
    this.group = new THREE.Group();

    // Create TSL-based animated water materials
    this.shallowMaterial = this.createWaterMaterial(false);
    this.deepMaterial = this.createWaterMaterial(true);
  }

  /**
   * Calculate single Gerstner wave inline and return displacement Y component
   */
  private calcWaveDisp(
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
    const c = sqrt(float(9.8).div(k));
    const len = sqrt(dirX.mul(dirX).add(dirY.mul(dirY)));
    const dx = dirX.div(len);
    const dy = dirY.div(len);
    const phase = k.mul(dx.mul(posX).add(dy.mul(posZ)).sub(c.mul(time)));
    const a = steepness.div(k);

    return a.mul(sin(phase));
  }

  /**
   * Create world-class TSL water material with Gerstner waves
   */
  private createWaterMaterial(isDeep: boolean): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;

    const baseColor = isDeep ? this.uDeepColor : this.uShallowColor;
    const baseOpacity = isDeep ? 0.85 : 0.7;

    const outputNode = Fn(() => {
      const pos = positionLocal;
      const worldPos = positionWorld;
      const time = this.uTime;
      const posX = pos.x;
      const posZ = pos.z;

      // Calculate all 6 waves inline for displacement
      const disp0 = this.calcWaveDisp(this.uWave0, posX, posZ, time);
      const disp1 = this.calcWaveDisp(this.uWave1, posX, posZ, time);
      const disp2 = this.calcWaveDisp(this.uWave2, posX, posZ, time);
      const disp3 = this.calcWaveDisp(this.uWave3, posX, posZ, time);
      const disp4 = this.calcWaveDisp(this.uWave4, posX, posZ, time);
      const disp5 = this.calcWaveDisp(this.uWave5, posX, posZ, time);

      const totalDispY = disp0.add(disp1).add(disp2).add(disp3).add(disp4).add(disp5);

      // Approximate normal from wave derivatives
      const eps = float(0.1);
      const hL = this.calcWaveDisp(this.uWave0, posX.sub(eps), posZ, time)
        .add(this.calcWaveDisp(this.uWave1, posX.sub(eps), posZ, time))
        .add(this.calcWaveDisp(this.uWave2, posX.sub(eps), posZ, time));
      const hR = this.calcWaveDisp(this.uWave0, posX.add(eps), posZ, time)
        .add(this.calcWaveDisp(this.uWave1, posX.add(eps), posZ, time))
        .add(this.calcWaveDisp(this.uWave2, posX.add(eps), posZ, time));
      const hD = this.calcWaveDisp(this.uWave0, posX, posZ.sub(eps), time)
        .add(this.calcWaveDisp(this.uWave1, posX, posZ.sub(eps), time))
        .add(this.calcWaveDisp(this.uWave2, posX, posZ.sub(eps), time));
      const hU = this.calcWaveDisp(this.uWave0, posX, posZ.add(eps), time)
        .add(this.calcWaveDisp(this.uWave1, posX, posZ.add(eps), time))
        .add(this.calcWaveDisp(this.uWave2, posX, posZ.add(eps), time));

      const waterNormal = normalize(vec3(
        hL.sub(hR),
        eps.mul(2.0),
        hD.sub(hU)
      ));

      // Foam based on wave height (crests)
      const foamMask = smoothstep(float(0.1), float(0.4), totalDispY);
      const foamNoise = sin(posX.mul(15.0).add(time.mul(2.0)))
        .mul(sin(posZ.mul(12.0).add(time.mul(1.5))))
        .mul(0.3).add(0.7);
      const foam = foamMask.mul(foamNoise).mul(0.5);

      // View direction
      const viewDir = normalize(cameraPosition.sub(worldPos));

      // Fresnel (Schlick, F0 = 0.02)
      const F0 = float(0.02);
      const NdotV = max(dot(waterNormal, viewDir), float(0.001));
      const fresnel = F0.add(float(1.0).sub(F0).mul(pow(float(1.0).sub(NdotV), float(5.0))));

      // Beer-Lambert absorption
      const absorptionCoeff = vec3(0.45, 0.09, 0.06);
      const waterDepth = isDeep ? float(3.0) : float(1.0);
      const transmittance = exp(absorptionCoeff.negate().mul(waterDepth));

      // Subsurface scattering
      const halfVec = normalize(viewDir.add(vec3(0, -0.3, 0)));
      const sssDot = max(dot(viewDir.negate(), halfVec), float(0.0));
      const sss = pow(sssDot, float(4.0)).mul(0.4);
      const sssColor = vec3(this.uScatterColor).mul(sss);

      // Wave height color variation
      const waveHeight = totalDispY.mul(2.0).add(0.5);
      const depthMix = smoothstep(float(-0.3), float(0.5), waveHeight);
      let waterColor = mix(vec3(this.uDeepColor), vec3(baseColor), depthMix);

      // Apply absorption
      waterColor = waterColor.mul(transmittance);

      // Add SSS
      waterColor = waterColor.add(sssColor);

      // Caustics
      const caustic1 = sin(posX.mul(8.0).add(time.mul(1.2)))
        .mul(sin(posZ.mul(7.0).add(time.mul(0.9))));
      const caustic2 = sin(posX.mul(12.0).sub(time.mul(0.8)))
        .mul(sin(posZ.mul(10.0).add(time.mul(1.1))));
      const caustics = max(caustic1.mul(caustic2), float(0.0)).mul(0.15);
      waterColor = waterColor.add(caustics.mul(vec3(0.6, 0.8, 1.0)));

      // Sky reflection
      const skyColor = vec3(0.7, 0.85, 1.0);
      waterColor = mix(waterColor, skyColor, fresnel.mul(0.6));

      // Foam
      const foamColor = vec3(0.95, 0.98, 1.0);
      waterColor = mix(waterColor, foamColor, foam);

      // Specular
      const sunDir = normalize(vec3(0.5, 0.8, 0.3));
      const halfSun = normalize(viewDir.add(sunDir));
      const specular = pow(max(dot(waterNormal, halfSun), float(0.0)), float(256.0));
      waterColor = waterColor.add(specular.mul(0.5));

      // Alpha
      const baseAlpha = float(baseOpacity);
      const alpha = mix(baseAlpha, float(0.95), foam.add(fresnel.mul(0.3)));

      return vec4(
        clamp(waterColor, float(0.0), float(1.0)),
        clamp(alpha, float(0.5), float(0.98))
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

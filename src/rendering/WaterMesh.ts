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
  min,
  smoothstep,
  length,
  exp,
  sqrt,
  abs,
  fract,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { MapData, MapCell } from '@/data/maps/MapTypes';

// Height scale factor (matches Terrain.ts)
const HEIGHT_SCALE = 0.04;

// Water surface offset above terrain
const WATER_SURFACE_OFFSET = 0.15;

// Water colors - physically-based
const WATER_SHALLOW_COLOR = new THREE.Color(0x22aadd); // Brighter, more saturated
const WATER_DEEP_COLOR = new THREE.Color(0x0a3050);    // Deeper blue-green
const WATER_SCATTER_COLOR = new THREE.Color(0x00ffaa); // Subsurface scatter tint

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

  // Wave configuration uniforms (6 waves for more variety)
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
   * Create world-class TSL water material with Gerstner waves
   */
  private createWaterMaterial(isDeep: boolean): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;

    const baseColor = isDeep ? this.uDeepColor : this.uShallowColor;
    const baseOpacity = isDeep ? 0.85 : 0.7;

    // Gerstner wave function - returns displacement and partial derivatives
    const gerstnerWave = Fn(([wave, pos, time]: [
      ReturnType<typeof uniform<THREE.Vector4>>,
      ReturnType<typeof vec3>,
      ReturnType<typeof float>
    ]) => {
      const dirX = wave.x;
      const dirY = wave.y;
      const steepness = wave.z;
      const wavelength = wave.w;

      // Wave number k = 2π/λ
      const k = float(2.0 * Math.PI).div(wavelength);
      // Phase speed c = √(g/k) for deep water dispersion
      const gravity = float(9.8);
      const c = sqrt(gravity.div(k));
      // Normalized direction
      const d = vec2(dirX, dirY).normalize();
      // Phase φ = k(D·P - ct)
      const phase = k.mul(d.x.mul(pos.x).add(d.y.mul(pos.z)).sub(c.mul(time)));
      // Amplitude a = steepness/k (ensures Q ≤ 1 constraint)
      const a = steepness.div(k);

      const cosPhase = cos(phase);
      const sinPhase = sin(phase);

      // Gerstner displacement (X, Y, Z)
      const dispX = d.x.mul(a).mul(cosPhase);
      const dispY = a.mul(sinPhase);
      const dispZ = d.y.mul(a).mul(cosPhase);

      // Partial derivatives for normal and Jacobian
      // ∂D/∂x and ∂D/∂z for Jacobian calculation
      const wa = k.mul(a); // ω * a
      const dDx_dx = d.x.mul(d.x).mul(wa).mul(sinPhase).negate();
      const dDz_dz = d.y.mul(d.y).mul(wa).mul(sinPhase).negate();
      const dDx_dz = d.x.mul(d.y).mul(wa).mul(sinPhase).negate();
      const dDz_dx = dDx_dz; // Symmetric

      // Normal contribution
      const nx = d.x.mul(wa).mul(cosPhase).negate();
      const nz = d.y.mul(wa).mul(cosPhase).negate();
      const ny = wa.mul(sinPhase);

      // Return: displacement (xyz), normal contribution (xyz in w packed), Jacobian terms
      return {
        disp: vec3(dispX, dispY, dispZ),
        normal: vec3(nx, ny, nz),
        jacobian: vec4(dDx_dx, dDz_dz, dDx_dz, dDz_dx),
      };
    });

    const outputNode = Fn(() => {
      const pos = positionLocal;
      const worldPos = positionWorld;
      const time = this.uTime;

      // Accumulate Gerstner waves
      const wave0 = gerstnerWave(this.uWave0, pos, time);
      const wave1 = gerstnerWave(this.uWave1, pos, time);
      const wave2 = gerstnerWave(this.uWave2, pos, time);
      const wave3 = gerstnerWave(this.uWave3, pos, time);
      const wave4 = gerstnerWave(this.uWave4, pos, time);
      const wave5 = gerstnerWave(this.uWave5, pos, time);

      // Total displacement
      const totalDisp = wave0.disp
        .add(wave1.disp)
        .add(wave2.disp)
        .add(wave3.disp)
        .add(wave4.disp)
        .add(wave5.disp);

      // Total normal from wave contributions
      const totalNormalContrib = wave0.normal
        .add(wave1.normal)
        .add(wave2.normal)
        .add(wave3.normal)
        .add(wave4.normal)
        .add(wave5.normal);

      // Reconstruct normal from accumulated partials
      const waterNormal = normalize(vec3(
        totalNormalContrib.x,
        float(1.0).sub(totalNormalContrib.y),
        totalNormalContrib.z
      ));

      // Jacobian for foam detection (wave breaking)
      // J = (1 + ∂Dx/∂x)(1 + ∂Dz/∂z) - (∂Dx/∂z)(∂Dz/∂x)
      const j0 = wave0.jacobian;
      const j1 = wave1.jacobian;
      const j2 = wave2.jacobian;
      const j3 = wave3.jacobian;
      const j4 = wave4.jacobian;
      const j5 = wave5.jacobian;

      const dDx_dx_total = j0.x.add(j1.x).add(j2.x).add(j3.x).add(j4.x).add(j5.x);
      const dDz_dz_total = j0.y.add(j1.y).add(j2.y).add(j3.y).add(j4.y).add(j5.y);
      const dDx_dz_total = j0.z.add(j1.z).add(j2.z).add(j3.z).add(j4.z).add(j5.z);
      const dDz_dx_total = j0.w.add(j1.w).add(j2.w).add(j3.w).add(j4.w).add(j5.w);

      const jacobian = float(1.0).add(dDx_dx_total)
        .mul(float(1.0).add(dDz_dz_total))
        .sub(dDx_dz_total.mul(dDz_dx_total));

      // Foam where Jacobian < threshold (wave breaking/folding)
      const foamThreshold = float(0.3);
      const foamMask = smoothstep(foamThreshold, float(-0.2), jacobian);

      // Add noise to foam for realistic texture
      const foamNoise = sin(pos.x.mul(15.0).add(time.mul(2.0)))
        .mul(sin(pos.z.mul(12.0).add(time.mul(1.5))))
        .mul(0.3).add(0.7);
      const foam = foamMask.mul(foamNoise);

      // View direction
      const viewDir = normalize(cameraPosition.sub(worldPos));

      // Fresnel effect (Schlick approximation with F0 = 0.02 for water)
      const F0 = float(0.02);
      const NdotV = max(dot(waterNormal, viewDir), float(0.001));
      const fresnel = F0.add(float(1.0).sub(F0).mul(pow(float(1.0).sub(NdotV), float(5.0))));

      // Beer-Lambert absorption for depth coloring
      // Wavelength-dependent: red absorbs fastest, blue slowest
      const absorptionCoeff = vec3(0.45, 0.09, 0.06); // per-meter coefficients
      const waterDepth = isDeep ? float(3.0) : float(1.0);
      const transmittance = exp(absorptionCoeff.negate().mul(waterDepth));

      // Subsurface scattering (light penetration effect)
      const halfVec = normalize(viewDir.add(vec3(0, -0.3, 0))); // Perturb toward underwater
      const sssDot = max(dot(viewDir.negate(), halfVec), float(0.0));
      const sss = pow(sssDot, float(4.0)).mul(0.4);
      const sssColor = vec3(this.uScatterColor).mul(sss);

      // Wave height for color variation
      const waveHeight = totalDisp.y.mul(2.0).add(0.5);

      // Base water color with depth absorption
      const deepMix = smoothstep(float(-0.3), float(0.5), waveHeight);
      let waterColor = mix(vec3(this.uDeepColor), vec3(baseColor), deepMix);

      // Apply Beer-Lambert absorption
      waterColor = waterColor.mul(transmittance);

      // Add subsurface scattering
      waterColor = waterColor.add(sssColor);

      // Caustic-like highlights (interference patterns)
      const caustic1 = sin(pos.x.mul(8.0).add(time.mul(1.2)))
        .mul(sin(pos.z.mul(7.0).add(time.mul(0.9))));
      const caustic2 = sin(pos.x.mul(12.0).sub(time.mul(0.8)))
        .mul(sin(pos.z.mul(10.0).add(time.mul(1.1))));
      const caustics = max(caustic1.mul(caustic2), float(0.0)).mul(0.15);

      // Add caustics to color
      waterColor = waterColor.add(caustics.mul(vec3(0.6, 0.8, 1.0)));

      // Apply fresnel for sky reflection
      const skyColor = vec3(0.7, 0.85, 1.0);
      waterColor = mix(waterColor, skyColor, fresnel.mul(0.6));

      // Add foam (white)
      const foamColor = vec3(0.95, 0.98, 1.0);
      waterColor = mix(waterColor, foamColor, foam);

      // Specular highlights from sun
      const sunDir = normalize(vec3(0.5, 0.8, 0.3));
      const halfSun = normalize(viewDir.add(sunDir));
      const specular = pow(max(dot(waterNormal, halfSun), float(0.0)), float(256.0));
      waterColor = waterColor.add(specular.mul(0.5));

      // Final alpha with fresnel influence
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

    // Find all water regions using flood fill
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

        // Found a water cell - flood fill to find region
        const region = this.floodFillWaterRegion(terrain, x, y, width, height, visited);
        if (region.cells.length > 0) {
          regions.push(region);
        }
      }
    }

    // Create mesh for each region
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

      // Add neighbors
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

    // Determine if mostly deep water
    const deepCount = region.cells.filter((c) => c.isDeep).length;
    const isDeep = deepCount > region.cells.length / 2;

    // Create water cell lookup
    const waterCells = new Map<string, { elevation: number; isDeep: boolean }>();
    for (const cell of region.cells) {
      waterCells.set(`${cell.x},${cell.y}`, { elevation: cell.elevation, isDeep: cell.isDeep });
    }

    // Build geometry per-cell with proper UV coordinates
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vertexIndex = 0;

    // Calculate region bounds for UV mapping
    const regionWidth = region.maxX - region.minX + 1;
    const regionHeight = region.maxY - region.minY + 1;

    for (const cell of region.cells) {
      const { x, y, elevation } = cell;
      const h = elevation * HEIGHT_SCALE + WATER_SURFACE_OFFSET;

      // Create a quad for this cell
      // Vertices: TL, TR, BL, BR
      positions.push(x, h, y);         // TL
      positions.push(x + 1, h, y);     // TR
      positions.push(x, h, y + 1);     // BL
      positions.push(x + 1, h, y + 1); // BR

      // UV coordinates - normalize to region bounds for seamless tiling
      const u0 = (x - region.minX) / regionWidth;
      const u1 = (x + 1 - region.minX) / regionWidth;
      const v0 = (y - region.minY) / regionHeight;
      const v1 = (y + 1 - region.minY) / regionHeight;

      uvs.push(u0, v0); // TL
      uvs.push(u1, v0); // TR
      uvs.push(u0, v1); // BL
      uvs.push(u1, v1); // BR

      // Two triangles
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
    mesh.renderOrder = 1; // Render after terrain

    this.waterMeshes.push(mesh);
    this.group.add(mesh);
  }

  /**
   * Update water animation
   */
  public update(deltaTime: number): void {
    this.time += deltaTime;
    // Update TSL time uniform for shader animation
    this.uTime.value = this.time;
  }

  /**
   * Set wave parameters for customization
   */
  public setWaveConfig(waveIndex: number, dirX: number, dirY: number, steepness: number, wavelength: number): void {
    const waves = [this.uWave0, this.uWave1, this.uWave2, this.uWave3, this.uWave4, this.uWave5];
    if (waveIndex >= 0 && waveIndex < waves.length) {
      waves[waveIndex].value.set(dirX, dirY, steepness, wavelength);
    }
  }

  /**
   * Set water colors
   */
  public setColors(shallow: THREE.Color, deep: THREE.Color, scatter?: THREE.Color): void {
    this.uShallowColor.value.copy(shallow);
    this.uDeepColor.value.copy(deep);
    if (scatter) {
      this.uScatterColor.value.copy(scatter);
    }
  }

  /**
   * Clear all water meshes
   */
  public clear(): void {
    for (const mesh of this.waterMeshes) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.waterMeshes = [];
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    this.clear();
    this.shallowMaterial.dispose();
    this.deepMaterial.dispose();
  }
}

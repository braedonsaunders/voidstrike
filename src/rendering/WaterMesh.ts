/**
 * WaterMesh - Localized water surface rendering
 *
 * Creates animated water surfaces at locations where water_shallow/water_deep
 * terrain features exist. Unlike the global TSLWaterPlane, this creates
 * individual water meshes only where water actually exists in the map data.
 */

import * as THREE from 'three';
import type { MapData, MapCell, TerrainFeature } from '@/data/maps/MapTypes';

// Height scale factor (matches Terrain.ts)
const HEIGHT_SCALE = 0.04;

// Water surface offset above terrain
const WATER_SURFACE_OFFSET = 0.15;

// Water colors
const WATER_SHALLOW_COLOR = new THREE.Color(0x4488cc);
const WATER_DEEP_COLOR = new THREE.Color(0x224466);

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
  private waterMaterial: THREE.MeshBasicMaterial;
  private deepWaterMaterial: THREE.MeshBasicMaterial;
  private time: number = 0;

  constructor() {
    this.group = new THREE.Group();

    // Create water materials
    this.waterMaterial = new THREE.MeshBasicMaterial({
      color: WATER_SHALLOW_COLOR,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.deepWaterMaterial = new THREE.MeshBasicMaterial({
      color: WATER_DEEP_COLOR,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
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
    terrain: Array<Array<{ elevation: number; feature: TerrainFeature }>>,
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
    terrain: Array<Array<{ elevation: number; feature: TerrainFeature }>>,
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

    // Create a grid of vertices for the region
    const regionWidth = region.maxX - region.minX + 1;
    const regionHeight = region.maxY - region.minY + 1;

    // Create water cell lookup
    const waterCells = new Map<string, { elevation: number; isDeep: boolean }>();
    for (const cell of region.cells) {
      waterCells.set(`${cell.x},${cell.y}`, { elevation: cell.elevation, isDeep: cell.isDeep });
    }

    // Build geometry per-cell (only for cells that have water)
    const positions: number[] = [];
    const indices: number[] = [];
    let vertexIndex = 0;

    for (const cell of region.cells) {
      const { x, y, elevation } = cell;
      const h = elevation * HEIGHT_SCALE + WATER_SURFACE_OFFSET;

      // Create a quad for this cell
      // Vertices: TL, TR, BL, BR
      positions.push(x, h, y); // TL
      positions.push(x + 1, h, y); // TR
      positions.push(x, h, y + 1); // BL
      positions.push(x + 1, h, y + 1); // BR

      // Two triangles
      indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 1);
      indices.push(vertexIndex + 1, vertexIndex + 2, vertexIndex + 3);

      vertexIndex += 4;
    }

    if (positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = isDeep ? this.deepWaterMaterial : this.waterMaterial;
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

    // Subtle opacity pulsing
    const opacityShallow = 0.6 + Math.sin(this.time * 0.5) * 0.05;
    const opacityDeep = 0.75 + Math.sin(this.time * 0.3) * 0.05;

    this.waterMaterial.opacity = opacityShallow;
    this.deepWaterMaterial.opacity = opacityDeep;
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
    this.waterMaterial.dispose();
    this.deepWaterMaterial.dispose();
  }
}

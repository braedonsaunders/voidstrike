/**
 * EditorWater - Simple water rendering for the map editor
 *
 * Creates basic animated water planes for water features.
 * Uses simple materials instead of complex WaterMesh addon to ensure
 * reliable rendering in the editor environment.
 */

import * as THREE from 'three';
import type { EditorCell } from '../config/EditorConfig';

// Height scale factor (matches game terrain)
const HEIGHT_SCALE = 0.04;

// Water surface offset above terrain
const WATER_SURFACE_OFFSET = 0.2;

interface WaterRegion {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  avgElevation: number;
  isDeep: boolean;
}

export class EditorWater {
  public group: THREE.Group;

  private waterMeshes: THREE.Mesh[] = [];
  private time: number = 0;

  constructor() {
    this.group = new THREE.Group();
  }

  /**
   * Build water meshes from editor terrain data
   */
  public buildFromEditorData(
    terrain: EditorCell[][],
    width: number,
    height: number
  ): void {
    this.clear();

    const visited = new Set<string>();
    const regions: WaterRegion[] = [];

    // Find water regions via flood fill
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const cell = terrain[y]?.[x];
        if (!cell) continue;

        const feature = cell.feature || 'none';
        if (feature !== 'water_shallow' && feature !== 'water_deep') continue;

        const region = this.floodFillRegion(terrain, x, y, width, height, visited);
        if (region) {
          regions.push(region);
        }
      }
    }

    // Create mesh for each region
    for (const region of regions) {
      this.createRegionMesh(region);
    }
  }

  private floodFillRegion(
    terrain: EditorCell[][],
    startX: number,
    startY: number,
    width: number,
    height: number,
    visited: Set<string>
  ): WaterRegion | null {
    const startCell = terrain[startY]?.[startX];
    if (!startCell) return null;

    const startFeature = startCell.feature || 'none';
    const isDeep = startFeature === 'water_deep';
    const targetFeature = startFeature;

    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    let minX = startX,
      maxX = startX,
      minY = startY,
      maxY = startY;
    let totalElevation = 0;
    let count = 0;

    while (queue.length > 0) {
      const { x, y } = queue.shift()!;
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const cell = terrain[y]?.[x];
      if (!cell) continue;

      const feature = cell.feature || 'none';
      if (feature !== targetFeature) continue;

      visited.add(key);

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      totalElevation += cell.elevation;
      count++;

      queue.push({ x: x - 1, y });
      queue.push({ x: x + 1, y });
      queue.push({ x, y: y - 1 });
      queue.push({ x, y: y + 1 });
    }

    if (count === 0) return null;

    return {
      minX,
      maxX,
      minY,
      maxY,
      avgElevation: totalElevation / count,
      isDeep,
    };
  }

  private createRegionMesh(region: WaterRegion): void {
    const regionWidth = region.maxX - region.minX + 1;
    const regionHeight = region.maxY - region.minY + 1;

    // Create plane geometry
    const geometry = new THREE.PlaneGeometry(regionWidth, regionHeight, 1, 1);

    // Water color based on depth
    const color = region.isDeep ? 0x1565c0 : 0x42a5f5;
    const opacity = region.isDeep ? 0.85 : 0.6;

    const material = new THREE.MeshLambertMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Position in world space (Y = up in editor)
    const centerX = region.minX + regionWidth / 2;
    const centerZ = region.minY + regionHeight / 2;
    const waterHeight = region.avgElevation * HEIGHT_SCALE + WATER_SURFACE_OFFSET;

    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(centerX, waterHeight, centerZ);
    mesh.renderOrder = 1; // Render after terrain

    this.waterMeshes.push(mesh);
    this.group.add(mesh);
  }

  /**
   * Update water animation
   */
  public update(deltaTime: number): void {
    this.time += deltaTime;

    // Simple wave animation via slight position oscillation
    for (const mesh of this.waterMeshes) {
      mesh.position.y += Math.sin(this.time * 2) * 0.001;
    }
  }

  /**
   * Clear all water meshes
   */
  public clear(): void {
    for (const mesh of this.waterMeshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.group.remove(mesh);
    }
    this.waterMeshes = [];
  }

  /**
   * Dispose all resources
   */
  public dispose(): void {
    this.clear();
  }
}

export default EditorWater;

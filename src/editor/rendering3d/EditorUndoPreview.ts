/**
 * EditorUndoPreview - 3D visualization of undo changes
 *
 * Renders highlighted cells in the 3D scene to show what will change
 * when undo is applied. Uses colored planes positioned on the terrain.
 */

import * as THREE from 'three';
import type { TerrainDiff, TerrainDiffCell } from '../hooks/useEditorState';

export class EditorUndoPreview {
  public group: THREE.Group;

  private cellSize: number = 1;
  private highlightMaterial: THREE.MeshBasicMaterial;
  private restoredMaterial: THREE.MeshBasicMaterial;
  private cellMeshes: THREE.Mesh[] = [];
  private getTerrainHeight: ((x: number, z: number) => number) | null = null;

  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = 10; // Render on top of terrain

    // Material for cells being restored (green)
    this.restoredMaterial = new THREE.MeshBasicMaterial({
      color: 0x22c55e, // Green
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });

    // Material for general highlights
    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: 0xfbbf24, // Amber
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
  }

  /**
   * Set the cell size for positioning
   */
  public setCellSize(size: number): void {
    this.cellSize = size;
  }

  /**
   * Set terrain height function for positioning cells on terrain
   */
  public setTerrainHeightFn(fn: (x: number, z: number) => number): void {
    this.getTerrainHeight = fn;
  }

  /**
   * Update the preview with a new diff
   */
  public setDiff(diff: TerrainDiff | null): void {
    // Clear existing meshes
    this.clear();

    if (!diff || diff.cells.length === 0) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;

    // Create a mesh for each changed cell
    const geometry = new THREE.PlaneGeometry(this.cellSize * 0.95, this.cellSize * 0.95);

    for (const cell of diff.cells) {
      this.createCellHighlight(cell, geometry);
    }

    // Dispose the shared geometry (each mesh has its own copy)
    geometry.dispose();
  }

  /**
   * Create a highlight mesh for a single cell
   */
  private createCellHighlight(cell: TerrainDiffCell, sharedGeometry: THREE.PlaneGeometry): void {
    // Determine material based on change type
    const elevationChange = cell.newElevation - cell.oldElevation;
    const material =
      elevationChange !== 0 || cell.newType !== cell.oldType
        ? this.restoredMaterial
        : this.highlightMaterial;

    // Clone geometry for this mesh
    const geometry = sharedGeometry.clone();
    const mesh = new THREE.Mesh(geometry, material);

    // Position the mesh
    // Convert grid coordinates to world coordinates
    // Note: In Three.js, Y is up. The grid X/Y maps to world X/Z
    const worldX = cell.x * this.cellSize + this.cellSize / 2;
    const worldZ = cell.y * this.cellSize + this.cellSize / 2;
    const worldY = this.getTerrainHeight ? this.getTerrainHeight(worldX, worldZ) + 0.1 : 0.1;

    mesh.position.set(worldX, worldY, worldZ);
    mesh.rotation.x = -Math.PI / 2; // Lay flat on ground

    this.group.add(mesh);
    this.cellMeshes.push(mesh);
  }

  /**
   * Clear all cell highlights
   */
  public clear(): void {
    for (const mesh of this.cellMeshes) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.cellMeshes = [];
  }

  /**
   * Set visibility
   */
  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    this.clear();
    this.restoredMaterial.dispose();
    this.highlightMaterial.dispose();
  }
}

export default EditorUndoPreview;

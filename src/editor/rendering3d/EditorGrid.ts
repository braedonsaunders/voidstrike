/**
 * EditorGrid - Grid overlay for the 3D map editor
 *
 * Renders a grid on the terrain for precise placement.
 */

import * as THREE from 'three';

export interface EditorGridConfig {
  width: number;
  height: number;
  cellSize?: number;
  color?: number;
  opacity?: number;
}

export class EditorGrid {
  public mesh: THREE.LineSegments;

  private width: number;
  private height: number;
  private cellSize: number;
  private color: number;
  private opacity: number;
  private visible: boolean = true;

  constructor(config: EditorGridConfig) {
    this.width = config.width;
    this.height = config.height;
    this.cellSize = config.cellSize ?? 1;
    this.color = config.color ?? 0x843dff;
    this.opacity = config.opacity ?? 0.15;

    this.mesh = this.createGrid();
  }

  /**
   * Update grid dimensions
   */
  public setSize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;

    this.width = width;
    this.height = height;

    // Dispose old geometry
    this.mesh.geometry.dispose();

    // Create new grid
    const newMesh = this.createGrid();
    this.mesh.geometry = newMesh.geometry;
  }

  /**
   * Set grid visibility
   */
  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.mesh.visible = visible;
  }

  /**
   * Toggle visibility
   */
  public toggleVisible(): boolean {
    this.visible = !this.visible;
    this.mesh.visible = this.visible;
    return this.visible;
  }

  /**
   * Set grid color
   */
  public setColor(color: number): void {
    this.color = color;
    (this.mesh.material as THREE.LineBasicMaterial).color.setHex(color);
  }

  /**
   * Set grid opacity
   */
  public setOpacity(opacity: number): void {
    this.opacity = opacity;
    (this.mesh.material as THREE.LineBasicMaterial).opacity = opacity;
  }

  /**
   * Update grid to match terrain height
   */
  public updateHeights(getHeight: (x: number, z: number) => number): void {
    const positions = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const array = positions.array as Float32Array;

    for (let i = 0; i < array.length; i += 3) {
      const x = array[i];
      const z = array[i + 2];
      array[i + 1] = getHeight(x, z) + 0.05; // Slight offset above terrain
    }

    positions.needsUpdate = true;
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  /**
   * Create the grid geometry
   */
  private createGrid(): THREE.LineSegments {
    const points: number[] = [];

    // Vertical lines
    for (let x = 0; x <= this.width; x++) {
      points.push(x * this.cellSize, 0, 0);
      points.push(x * this.cellSize, 0, this.height * this.cellSize);
    }

    // Horizontal lines
    for (let z = 0; z <= this.height; z++) {
      points.push(0, 0, z * this.cellSize);
      points.push(this.width * this.cellSize, 0, z * this.cellSize);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));

    const material = new THREE.LineBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: this.opacity,
      depthWrite: false,
    });

    const mesh = new THREE.LineSegments(geometry, material);
    mesh.renderOrder = 1; // Render after terrain

    return mesh;
  }
}

export default EditorGrid;

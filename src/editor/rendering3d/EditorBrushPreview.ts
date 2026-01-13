/**
 * EditorBrushPreview - Visual brush preview for terrain painting
 *
 * Shows a circular brush indicator on the terrain.
 */

import * as THREE from 'three';

export class EditorBrushPreview {
  public mesh: THREE.Mesh;

  private radius: number = 5;
  private segments: number = 32;
  private color: THREE.Color = new THREE.Color(0x9f75ff);
  private getTerrainHeight: ((x: number, z: number) => number) | null = null;

  constructor() {
    const geometry = this.createRingGeometry(this.radius);
    const material = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
  }

  /**
   * Set terrain height function
   */
  public setTerrainHeightFn(fn: (x: number, z: number) => number): void {
    this.getTerrainHeight = fn;
  }

  /**
   * Update brush position
   */
  public setPosition(x: number, z: number): void {
    const height = this.getTerrainHeight ? this.getTerrainHeight(x, z) : 0;
    this.mesh.position.set(x, height + 0.15, z);
  }

  /**
   * Set brush radius
   */
  public setRadius(radius: number): void {
    if (this.radius === radius) return;
    this.radius = radius;

    // Dispose old geometry and create new
    this.mesh.geometry.dispose();
    this.mesh.geometry = this.createRingGeometry(radius);
  }

  /**
   * Set brush color
   */
  public setColor(color: number): void {
    this.color.setHex(color);
    (this.mesh.material as THREE.MeshBasicMaterial).color = this.color;
  }

  /**
   * Set visibility
   */
  public setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /**
   * Show brush for a specific tool
   */
  public showForTool(toolId: string, brushSize: number): void {
    const toolsWithBrush = ['brush', 'eraser', 'plateau', 'smooth', 'raise', 'lower'];

    if (toolsWithBrush.includes(toolId)) {
      this.setRadius(brushSize);
      this.setVisible(true);

      // Set color based on tool
      switch (toolId) {
        case 'eraser':
          this.setColor(0xff4444);
          break;
        case 'raise':
          this.setColor(0x44ff44);
          break;
        case 'lower':
          this.setColor(0xff8844);
          break;
        case 'smooth':
          this.setColor(0x44aaff);
          break;
        default:
          this.setColor(0x9f75ff);
      }
    } else {
      this.setVisible(false);
    }
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  /**
   * Create ring geometry for brush preview
   */
  private createRingGeometry(radius: number): THREE.BufferGeometry {
    // Create a filled circle with a ring outline effect
    const innerRadius = radius * 0.85;
    const outerRadius = radius;

    return new THREE.RingGeometry(innerRadius, outerRadius, this.segments);
  }
}

export default EditorBrushPreview;

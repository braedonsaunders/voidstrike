/**
 * EditorBrushPreview - Visual brush preview for terrain painting
 *
 * Shows a circular brush indicator on the terrain.
 * Also supports shape tool previews (line, rect, ellipse, ramp).
 */

import * as THREE from 'three';

export class EditorBrushPreview {
  public mesh: THREE.Mesh;
  public shapeMesh: THREE.Line;

  private radius: number = 5;
  private segments: number = 32;
  private color: THREE.Color = new THREE.Color(0x9f75ff);
  private getTerrainHeight: ((x: number, z: number) => number) | null = null;

  // Shape preview state
  private shapeType: 'line' | 'rect' | 'ellipse' | 'ramp' | null = null;
  private shapeStart: { x: number; y: number; z: number } | null = null;

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

    // Shape preview line
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.8,
      linewidth: 2,
    });
    const lineGeometry = new THREE.BufferGeometry();
    this.shapeMesh = new THREE.Line(lineGeometry, lineMaterial);
    this.shapeMesh.visible = false;
    this.shapeMesh.renderOrder = 3;
  }

  /**
   * Set terrain height function
   */
  public setTerrainHeightFn(fn: (x: number, z: number) => number): void {
    this.getTerrainHeight = fn;
  }

  /**
   * Update brush position
   * @param x World X coordinate
   * @param z World Z coordinate
   * @param y Optional Y coordinate from raycast - if provided, uses this instead of terrain lookup
   */
  public setPosition(x: number, z: number, y?: number): void {
    const height = y !== undefined ? y : (this.getTerrainHeight ? this.getTerrainHeight(x, z) : 0);
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
   * @param materialColor Optional hex color string (e.g., "#ff0000") to show when painting with a specific material
   */
  public showForTool(toolId: string, brushSize: number, materialColor?: string): void {
    const toolsWithBrush = ['brush', 'eraser', 'plateau', 'smooth', 'raise', 'lower', 'noise', 'line', 'ramp'];

    if (toolsWithBrush.includes(toolId)) {
      this.setRadius(brushSize);
      this.setVisible(true);

      // If material color is provided for brush tool, use it
      if (toolId === 'brush' && typeof materialColor === 'string' && materialColor.length > 0) {
        this.setColor(parseInt(materialColor.replace('#', ''), 16));
        return;
      }

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
        case 'noise':
          this.setColor(0xffaa44);
          break;
        case 'line':
        case 'ramp':
          this.setColor(0x44ffff);
          break;
        default:
          this.setColor(0x9f75ff);
      }
    } else {
      this.setVisible(false);
    }
  }

  /**
   * Start shape preview
   */
  public startShapePreview(type: 'line' | 'rect' | 'ellipse' | 'ramp', startX: number, startZ: number): void {
    this.shapeType = type;
    const y = this.getTerrainHeight ? this.getTerrainHeight(startX, startZ) : 0;
    this.shapeStart = { x: startX, y: y + 0.2, z: startZ };
    this.shapeMesh.visible = true;

    // Set color based on shape type
    const material = this.shapeMesh.material as THREE.LineBasicMaterial;
    switch (type) {
      case 'ramp':
        material.color.setHex(0x00ffff);
        break;
      case 'line':
        material.color.setHex(0xffff00);
        break;
      case 'rect':
        material.color.setHex(0x00ff00);
        break;
      case 'ellipse':
        material.color.setHex(0xff00ff);
        break;
    }
  }

  /**
   * Update shape preview as mouse moves
   */
  public updateShapePreview(endX: number, endZ: number): void {
    if (!this.shapeStart || !this.shapeType) return;

    const endY = this.getTerrainHeight ? this.getTerrainHeight(endX, endZ) + 0.2 : 0.2;
    const points: THREE.Vector3[] = [];

    switch (this.shapeType) {
      case 'line':
      case 'ramp':
        // Simple line from start to end
        points.push(new THREE.Vector3(this.shapeStart.x, this.shapeStart.y, this.shapeStart.z));
        points.push(new THREE.Vector3(endX, endY, endZ));
        break;

      case 'rect': {
        // Rectangle outline
        const sx = this.shapeStart.x;
        const sz = this.shapeStart.z;
        const sy = this.shapeStart.y;
        points.push(new THREE.Vector3(sx, sy, sz));
        points.push(new THREE.Vector3(endX, endY, sz));
        points.push(new THREE.Vector3(endX, endY, endZ));
        points.push(new THREE.Vector3(sx, sy, endZ));
        points.push(new THREE.Vector3(sx, sy, sz)); // Close the rect
        break;
      }

      case 'ellipse': {
        // Ellipse outline
        const centerX = (this.shapeStart.x + endX) / 2;
        const centerZ = (this.shapeStart.z + endZ) / 2;
        const radiusX = Math.abs(endX - this.shapeStart.x) / 2;
        const radiusZ = Math.abs(endZ - this.shapeStart.z) / 2;
        const centerY = (this.shapeStart.y + endY) / 2;

        const segments = 48;
        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          const x = centerX + Math.cos(angle) * radiusX;
          const z = centerZ + Math.sin(angle) * radiusZ;
          const y = this.getTerrainHeight ? this.getTerrainHeight(x, z) + 0.2 : centerY;
          points.push(new THREE.Vector3(x, y, z));
        }
        break;
      }
    }

    // Update geometry
    this.shapeMesh.geometry.dispose();
    this.shapeMesh.geometry = new THREE.BufferGeometry().setFromPoints(points);
  }

  /**
   * End shape preview
   */
  public endShapePreview(): void {
    this.shapeType = null;
    this.shapeStart = null;
    this.shapeMesh.visible = false;
  }

  /**
   * Check if currently showing shape preview
   */
  public isShowingShapePreview(): boolean {
    return this.shapeType !== null;
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.shapeMesh.geometry.dispose();
    (this.shapeMesh.material as THREE.Material).dispose();
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

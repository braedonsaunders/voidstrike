import * as THREE from 'three';
import { MapData } from '@/data/maps';
import { calculateWallLine, calculateWallLineCost } from '@/data/buildings/walls';

/**
 * WallPlacementPreview - Specialized preview for wall line placement
 *
 * Features:
 * - Click and drag to draw wall lines
 * - Shows all wall segments that will be placed
 * - Real-time cost calculation
 * - Valid/invalid placement visualization
 * - Snaps to grid with straight lines (horizontal, vertical, or 45° diagonal)
 */
export class WallPlacementPreview {
  public group: THREE.Group;

  private mapData: MapData;
  private currentBuildingType: string = 'wall_segment';
  private isDrawing: boolean = false;
  private startPosition: { x: number; y: number } = { x: 0, y: 0 };
  private endPosition: { x: number; y: number } = { x: 0, y: 0 };
  private wallPositions: Array<{ x: number; y: number; valid: boolean }> = [];

  // Meshes
  private segmentMeshes: THREE.Mesh[] = [];
  private lineMesh: THREE.Line | null = null;
  private costLabel: THREE.Sprite | null = null;

  // Callbacks
  private getTerrainHeight: ((x: number, y: number) => number) | null = null;
  private placementValidator: ((x: number, y: number, w: number, h: number) => boolean) | null = null;

  // Visual settings
  private static readonly GRID_OFFSET = 0.2;
  private static readonly VALID_COLOR = new THREE.Color(0x00ff00);
  private static readonly INVALID_COLOR = new THREE.Color(0xff0000);
  private static readonly SEGMENT_OPACITY = 0.5;

  // Materials (reused)
  private validMaterial: THREE.MeshBasicMaterial;
  private invalidMaterial: THREE.MeshBasicMaterial;
  private lineMaterial: THREE.LineBasicMaterial;
  private segmentGeometry: THREE.BoxGeometry;

  // PERF: Reusable wireframe materials and geometry (shared across all segments)
  private wireGeometry: THREE.EdgesGeometry;
  private validWireMaterial: THREE.LineBasicMaterial;
  private invalidWireMaterial: THREE.LineBasicMaterial;

  // PERF: Pool of reusable Vector3 for line points to avoid per-frame allocation
  private linePointsPool: THREE.Vector3[] = [];
  private static readonly LINE_POINTS_POOL_SIZE = 100;

  // Frame counter for quarantine timing
  private frameCount: number = 0;

  // Geometry disposal quarantine - prevents WebGPU "setIndexBuffer" crashes
  // by delaying geometry disposal until GPU has finished pending draw commands.
  private static readonly GEOMETRY_QUARANTINE_FRAMES = 4;
  private geometryQuarantine: Array<{
    geometry: THREE.BufferGeometry;
    materials: THREE.Material[];
    frameQueued: number;
  }> = [];

  constructor(mapData: MapData, getTerrainHeight?: (x: number, y: number) => number) {
    this.group = new THREE.Group();
    this.mapData = mapData;
    this.getTerrainHeight = getTerrainHeight ?? null;
    this.group.visible = false;

    // Create reusable materials
    this.validMaterial = new THREE.MeshBasicMaterial({
      color: WallPlacementPreview.VALID_COLOR,
      transparent: true,
      opacity: WallPlacementPreview.SEGMENT_OPACITY,
    });

    this.invalidMaterial = new THREE.MeshBasicMaterial({
      color: WallPlacementPreview.INVALID_COLOR,
      transparent: true,
      opacity: WallPlacementPreview.SEGMENT_OPACITY,
    });

    this.lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff88,
      linewidth: 2,
    });

    // Standard wall segment geometry (1x1) - half thickness for cleaner preview
    this.segmentGeometry = new THREE.BoxGeometry(0.45, 1.5, 0.45);

    // PERF: Pre-create wireframe geometry and materials (reused across all segments)
    this.wireGeometry = new THREE.EdgesGeometry(this.segmentGeometry);
    this.validWireMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
    this.invalidWireMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });

    // PERF: Pre-create pool of Vector3 for line points
    for (let i = 0; i < WallPlacementPreview.LINE_POINTS_POOL_SIZE; i++) {
      this.linePointsPool.push(new THREE.Vector3());
    }
  }

  /**
   * Set terrain height function
   */
  public setTerrainHeightFunction(fn: (x: number, y: number) => number): void {
    this.getTerrainHeight = fn;
  }

  /**
   * Set placement validator function
   */
  public setPlacementValidator(fn: (x: number, y: number, w: number, h: number) => boolean): void {
    this.placementValidator = fn;
  }

  /**
   * Start wall placement mode
   */
  public startPlacement(buildingType: string = 'wall_segment'): void {
    this.currentBuildingType = buildingType;
    this.group.visible = true;
    this.isDrawing = false;
    this.clearMeshes();
  }

  /**
   * Stop wall placement mode
   */
  public stopPlacement(): void {
    this.group.visible = false;
    this.isDrawing = false;
    this.clearMeshes();
  }

  /**
   * Start drawing a wall line (mouse down)
   */
  public startLine(worldX: number, worldY: number): void {
    const snappedX = Math.round(worldX);
    const snappedY = Math.round(worldY);

    this.isDrawing = true;
    this.startPosition = { x: snappedX, y: snappedY };
    this.endPosition = { x: snappedX, y: snappedY };

    this.updateWallPositions();
  }

  /**
   * Update wall line endpoint (mouse move while drawing)
   */
  public updateLine(worldX: number, worldY: number): void {
    this.frameCount++;
    this.processGeometryQuarantine();

    if (!this.isDrawing) {
      // Not drawing, just show single segment at cursor
      const snappedX = Math.round(worldX);
      const snappedY = Math.round(worldY);
      this.showSingleSegment(snappedX, snappedY);
      return;
    }

    const snappedX = Math.round(worldX);
    const snappedY = Math.round(worldY);

    if (snappedX !== this.endPosition.x || snappedY !== this.endPosition.y) {
      this.endPosition = { x: snappedX, y: snappedY };
      this.updateWallPositions();
    }
  }

  /**
   * Finish drawing wall line (mouse up)
   * Returns the positions and cost
   */
  public finishLine(): { positions: Array<{ x: number; y: number; valid: boolean }>; cost: { minerals: number; plasma: number } } {
    this.isDrawing = false;

    const positions = [...this.wallPositions];
    const validPositions = positions.filter(p => p.valid);
    const cost = calculateWallLineCost(validPositions, this.currentBuildingType);

    this.clearMeshes();

    return { positions, cost };
  }

  /**
   * Cancel current wall line
   */
  public cancelLine(): void {
    this.isDrawing = false;
    this.wallPositions = [];
    this.clearMeshes();
  }

  /**
   * Check if currently drawing
   */
  public isCurrentlyDrawing(): boolean {
    return this.isDrawing;
  }

  /**
   * Get current wall positions
   */
  public getWallPositions(): Array<{ x: number; y: number; valid: boolean }> {
    return this.wallPositions;
  }

  /**
   * Get current total cost
   */
  public getCurrentCost(): { minerals: number; plasma: number } {
    const validPositions = this.wallPositions.filter(p => p.valid);
    return calculateWallLineCost(validPositions, this.currentBuildingType);
  }

  /**
   * Show single segment at cursor position (when not drawing)
   */
  private showSingleSegment(x: number, y: number): void {
    this.clearMeshes();

    const valid = this.checkPositionValid(x, y);
    const height = this.getTerrainHeight ? this.getTerrainHeight(x, y) : 0;

    // PERF: Use pre-created materials instead of cloning
    const mesh = new THREE.Mesh(
      this.segmentGeometry,
      valid ? this.validMaterial : this.invalidMaterial
    );
    mesh.position.set(x, height + 0.75 + WallPlacementPreview.GRID_OFFSET, y);

    // PERF: Reuse pre-created wireframe geometry and materials
    const wireframe = new THREE.LineSegments(
      this.wireGeometry,
      valid ? this.validWireMaterial : this.invalidWireMaterial
    );
    mesh.add(wireframe);

    this.group.add(mesh);
    this.segmentMeshes.push(mesh);

    this.wallPositions = [{ x, y, valid }];
  }

  /**
   * Update wall positions based on start and end points
   */
  private updateWallPositions(): void {
    this.clearMeshes();

    // Calculate line positions
    const linePositions = calculateWallLine(
      this.startPosition.x,
      this.startPosition.y,
      this.endPosition.x,
      this.endPosition.y
    );

    // Check validity for each position
    this.wallPositions = linePositions.map(pos => ({
      x: pos.x,
      y: pos.y,
      valid: this.checkPositionValid(pos.x, pos.y),
    }));

    // Create meshes for each segment
    // PERF: Use pre-created materials instead of cloning per segment
    for (const pos of this.wallPositions) {
      const height = this.getTerrainHeight ? this.getTerrainHeight(pos.x, pos.y) : 0;

      const mesh = new THREE.Mesh(
        this.segmentGeometry,
        pos.valid ? this.validMaterial : this.invalidMaterial
      );
      mesh.position.set(pos.x, height + 0.75 + WallPlacementPreview.GRID_OFFSET, pos.y);

      // PERF: Reuse pre-created wireframe geometry and materials
      const wireframe = new THREE.LineSegments(
        this.wireGeometry,
        pos.valid ? this.validWireMaterial : this.invalidWireMaterial
      );
      mesh.add(wireframe);

      this.group.add(mesh);
      this.segmentMeshes.push(mesh);
    }

    // Create connecting line
    if (this.wallPositions.length > 1) {
      // PERF: Use pooled Vector3s instead of creating new ones
      const linePoints: THREE.Vector3[] = [];
      const posCount = Math.min(this.wallPositions.length, this.linePointsPool.length);
      for (let i = 0; i < posCount; i++) {
        const pos = this.wallPositions[i];
        const height = this.getTerrainHeight ? this.getTerrainHeight(pos.x, pos.y) : 0;
        this.linePointsPool[i].set(pos.x, height + 1.5 + WallPlacementPreview.GRID_OFFSET, pos.y);
        linePoints.push(this.linePointsPool[i]);
      }

      const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
      this.lineMesh = new THREE.Line(lineGeometry, this.lineMaterial);
      this.group.add(this.lineMesh);
    }

    // Create cost label
    this.updateCostLabel();
  }

  /**
   * Check if a position is valid for wall placement
   */
  private checkPositionValid(x: number, y: number): boolean {
    // Check map bounds
    if (x < 0 || x >= this.mapData.width || y < 0 || y >= this.mapData.height) {
      return false;
    }

    // Check terrain type
    const cell = this.mapData.terrain[Math.floor(y)]?.[Math.floor(x)];
    if (!cell || cell.terrain !== 'ground') {
      return false;
    }

    // Check with validator (buildings, units, resources)
    if (this.placementValidator && !this.placementValidator(x, y, 1, 1)) {
      return false;
    }

    return true;
  }

  /**
   * Update the cost label sprite
   */
  private updateCostLabel(): void {
    if (this.costLabel) {
      this.group.remove(this.costLabel);
      this.costLabel.material.dispose();
      (this.costLabel.material as THREE.SpriteMaterial).map?.dispose();
      this.costLabel = null;
    }

    if (this.wallPositions.length === 0) return;

    const cost = this.getCurrentCost();
    const validCount = this.wallPositions.filter(p => p.valid).length;
    const totalCount = this.wallPositions.length;

    // Create canvas for label
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.fill();

    // Text
    ctx.font = 'bold 24px Arial';
    ctx.fillStyle = validCount === totalCount ? '#00ff00' : '#ffff00';
    ctx.textAlign = 'center';
    ctx.fillText(`${validCount}/${totalCount} walls`, 128, 28);

    ctx.font = '18px Arial';
    ctx.fillStyle = '#88ccff';
    ctx.fillText(`💎 ${cost.minerals}`, 128, 52);

    // Create sprite
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    this.costLabel = new THREE.Sprite(material);
    this.costLabel.scale.set(8, 2, 1);

    // Position above the line
    const lastPos = this.wallPositions[this.wallPositions.length - 1];
    const height = this.getTerrainHeight ? this.getTerrainHeight(lastPos.x, lastPos.y) : 0;
    this.costLabel.position.set(lastPos.x, height + 4, lastPos.y);

    this.group.add(this.costLabel);
  }

  /**
   * Queue geometry for delayed disposal.
   * This prevents WebGPU "setIndexBuffer" crashes by ensuring the GPU
   * has finished all pending draw commands before buffers are freed.
   */
  private queueGeometryForDisposal(geometry: THREE.BufferGeometry): void {
    this.geometryQuarantine.push({
      geometry,
      materials: [],
      frameQueued: this.frameCount,
    });
  }

  /**
   * Process quarantined geometries and dispose those that are safe.
   */
  private processGeometryQuarantine(): void {
    let writeIndex = 0;
    for (let i = 0; i < this.geometryQuarantine.length; i++) {
      const entry = this.geometryQuarantine[i];
      const framesInQuarantine = this.frameCount - entry.frameQueued;

      if (framesInQuarantine >= WallPlacementPreview.GEOMETRY_QUARANTINE_FRAMES) {
        // Safe to dispose - GPU has finished with these buffers
        entry.geometry.dispose();
        for (const material of entry.materials) {
          material.dispose();
        }
      } else {
        // Keep in quarantine
        this.geometryQuarantine[writeIndex++] = entry;
      }
    }
    this.geometryQuarantine.length = writeIndex;
  }

  /**
   * Clear all meshes
   * PERF: Don't dispose shared materials/geometry - they are reused
   */
  private clearMeshes(): void {
    for (const mesh of this.segmentMeshes) {
      this.group.remove(mesh);
      // Note: Don't dispose segmentGeometry, wireGeometry, or materials
      // They are shared and will be disposed in dispose()
    }
    this.segmentMeshes = [];

    if (this.lineMesh) {
      this.group.remove(this.lineMesh);
      // Use quarantine to prevent WebGPU crashes
      this.queueGeometryForDisposal(this.lineMesh.geometry);
      this.lineMesh = null;
    }

    if (this.costLabel) {
      this.group.remove(this.costLabel);
      this.costLabel.material.dispose();
      (this.costLabel.material as THREE.SpriteMaterial).map?.dispose();
      this.costLabel = null;
    }
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    // Flush any pending quarantined geometries first
    for (const entry of this.geometryQuarantine) {
      entry.geometry.dispose();
      for (const material of entry.materials) {
        material.dispose();
      }
    }
    this.geometryQuarantine.length = 0;

    this.clearMeshes();
    this.validMaterial.dispose();
    this.invalidMaterial.dispose();
    this.lineMaterial.dispose();
    this.segmentGeometry.dispose();
    // PERF: Also dispose shared wireframe resources
    this.wireGeometry.dispose();
    this.validWireMaterial.dispose();
    this.invalidWireMaterial.dispose();

    // Flush any geometries queued during dispose
    for (const entry of this.geometryQuarantine) {
      entry.geometry.dispose();
      for (const material of entry.materials) {
        material.dispose();
      }
    }
    this.geometryQuarantine.length = 0;
  }
}

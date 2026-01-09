import * as THREE from 'three';
import { MapData } from '@/data/maps';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';

/**
 * Building placement preview system - SC2 style
 * Shows:
 * - Grid overlay when placing buildings
 * - Green/red tiles for valid/invalid placement
 * - Ghost preview of the building footprint
 */

export class BuildingPlacementPreview {
  public group: THREE.Group;

  private gridMesh: THREE.Mesh | null = null;
  private ghostMesh: THREE.Mesh | null = null;
  private mapData: MapData;
  private currentBuildingType: string | null = null;
  private currentPosition: { x: number; y: number } = { x: 0, y: 0 };
  private isValid: boolean = false;
  private getTerrainHeight: ((x: number, y: number) => number) | null = null;
  private checkVespeneGeyser: ((x: number, y: number) => boolean) | null = null;

  // Grid visualization settings
  private static readonly GRID_OFFSET = 0.15; // Offset above terrain
  private static readonly VALID_COLOR = new THREE.Color(0x00ff00);
  private static readonly INVALID_COLOR = new THREE.Color(0xff0000);
  private static readonly GRID_OPACITY = 0.4;

  constructor(mapData: MapData, getTerrainHeight?: (x: number, y: number) => number) {
    this.group = new THREE.Group();
    this.mapData = mapData;
    this.getTerrainHeight = getTerrainHeight ?? null;
    this.group.visible = false;
  }

  /**
   * Set callback to check if a position is on a vespene geyser
   */
  public setVespeneGeyserChecker(fn: (x: number, y: number) => boolean): void {
    this.checkVespeneGeyser = fn;
  }

  /**
   * Set terrain height function (for elevation support)
   */
  public setTerrainHeightFunction(fn: (x: number, y: number) => number): void {
    this.getTerrainHeight = fn;
  }

  /**
   * Start showing placement preview for a building type
   */
  public startPlacement(buildingType: string): void {
    this.currentBuildingType = buildingType;
    this.group.visible = true;
    this.updatePreview(this.currentPosition.x, this.currentPosition.y);
  }

  /**
   * Stop showing placement preview
   */
  public stopPlacement(): void {
    this.currentBuildingType = null;
    this.group.visible = false;
    this.clearMeshes();
  }

  /**
   * Update preview position (call on mouse move)
   */
  public updatePosition(worldX: number, worldY: number): void {
    // Snap to grid
    const snappedX = Math.round(worldX);
    const snappedY = Math.round(worldY);

    if (snappedX !== this.currentPosition.x || snappedY !== this.currentPosition.y) {
      this.currentPosition = { x: snappedX, y: snappedY };
      this.updatePreview(snappedX, snappedY);
    }
  }

  /**
   * Check if current placement position is valid
   */
  public isPlacementValid(): boolean {
    return this.isValid;
  }

  /**
   * Get current snapped position
   */
  public getSnappedPosition(): { x: number; y: number } {
    return { ...this.currentPosition };
  }

  private updatePreview(x: number, y: number): void {
    if (!this.currentBuildingType) return;

    const definition = BUILDING_DEFINITIONS[this.currentBuildingType];
    if (!definition) return;

    const width = definition.width;
    const height = definition.height;

    // Check validity of all tiles
    this.isValid = this.checkPlacementValidity(x, y, width, height);

    // Update or create grid mesh
    this.updateGridMesh(x, y, width, height);

    // Update or create ghost mesh
    this.updateGhostMesh(x, y, width, height);
  }

  private checkPlacementValidity(centerX: number, centerY: number, width: number, height: number): boolean {
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    // Special case: extractors MUST be placed on vespene geysers
    if (this.currentBuildingType === 'extractor') {
      if (!this.checkVespeneGeyser || !this.checkVespeneGeyser(centerX, centerY)) {
        return false;
      }
      // If on a geyser, it's valid (skip terrain checks for geysers)
      return true;
    }

    // Check all tiles the building would occupy
    for (let dy = -Math.floor(halfHeight); dy < Math.ceil(halfHeight); dy++) {
      for (let dx = -Math.floor(halfWidth); dx < Math.ceil(halfWidth); dx++) {
        const tileX = Math.floor(centerX + dx);
        const tileY = Math.floor(centerY + dy);

        // Check bounds
        if (tileX < 0 || tileX >= this.mapData.width || tileY < 0 || tileY >= this.mapData.height) {
          return false;
        }

        // Check terrain type
        const cell = this.mapData.terrain[tileY][tileX];
        if (cell.terrain !== 'ground') {
          return false;
        }
      }
    }

    return true;
  }

  private updateGridMesh(centerX: number, centerY: number, width: number, height: number): void {
    // Remove old mesh
    if (this.gridMesh) {
      this.group.remove(this.gridMesh);
      this.gridMesh.geometry.dispose();
      (this.gridMesh.material as THREE.Material).dispose();
    }

    // Create grid geometry with per-tile coloring
    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const halfWidth = width / 2;
    const halfHeight = height / 2;
    let vertexIndex = 0;

    for (let dy = -Math.floor(halfHeight); dy < Math.ceil(halfHeight); dy++) {
      for (let dx = -Math.floor(halfWidth); dx < Math.ceil(halfWidth); dx++) {
        const tileX = Math.floor(centerX + dx);
        const tileY = Math.floor(centerY + dy);

        // Check if this tile is valid
        let tileValid = true;
        if (tileX < 0 || tileX >= this.mapData.width || tileY < 0 || tileY >= this.mapData.height) {
          tileValid = false;
        } else {
          const cell = this.mapData.terrain[tileY][tileX];
          if (cell.terrain !== 'ground') {
            tileValid = false;
          }
        }

        const color = tileValid ? BuildingPlacementPreview.VALID_COLOR : BuildingPlacementPreview.INVALID_COLOR;

        // Create quad for this tile
        const x0 = centerX + dx - 0.5;
        const x1 = centerX + dx + 0.5;
        const y0 = centerY + dy - 0.5;
        const y1 = centerY + dy + 0.5;

        // Get terrain height for this tile (use center point)
        const tileHeight = this.getTerrainHeight
          ? this.getTerrainHeight(centerX + dx, centerY + dy) + BuildingPlacementPreview.GRID_OFFSET
          : BuildingPlacementPreview.GRID_OFFSET;

        // Four vertices for quad
        vertices.push(x0, tileHeight, y0);
        vertices.push(x1, tileHeight, y0);
        vertices.push(x1, tileHeight, y1);
        vertices.push(x0, tileHeight, y1);

        // Colors for all four vertices
        for (let i = 0; i < 4; i++) {
          colors.push(color.r, color.g, color.b);
        }

        // Two triangles for quad
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: BuildingPlacementPreview.GRID_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.gridMesh = new THREE.Mesh(geometry, material);
    this.group.add(this.gridMesh);
  }

  private updateGhostMesh(centerX: number, centerY: number, width: number, height: number): void {
    // Remove old mesh
    if (this.ghostMesh) {
      this.group.remove(this.ghostMesh);
      this.ghostMesh.geometry.dispose();
      (this.ghostMesh.material as THREE.Material).dispose();
    }

    // Create a simple box as ghost preview
    const geometry = new THREE.BoxGeometry(width * 0.9, 2, height * 0.9);
    const color = this.isValid ? 0x00ff88 : 0xff4444;

    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3,
      wireframe: false,
    });

    // Get terrain height at center
    const terrainHeight = this.getTerrainHeight
      ? this.getTerrainHeight(centerX, centerY)
      : 0;

    this.ghostMesh = new THREE.Mesh(geometry, material);
    this.ghostMesh.position.set(centerX, terrainHeight + 1 + BuildingPlacementPreview.GRID_OFFSET, centerY);
    this.group.add(this.ghostMesh);

    // Add wireframe outline
    const wireGeometry = new THREE.EdgesGeometry(geometry);
    const wireMaterial = new THREE.LineBasicMaterial({
      color: this.isValid ? 0x00ff00 : 0xff0000,
      linewidth: 2,
    });
    const wireframe = new THREE.LineSegments(wireGeometry, wireMaterial);
    wireframe.position.copy(this.ghostMesh.position);
    this.ghostMesh.add(wireframe);
  }

  private clearMeshes(): void {
    if (this.gridMesh) {
      this.group.remove(this.gridMesh);
      this.gridMesh.geometry.dispose();
      (this.gridMesh.material as THREE.Material).dispose();
      this.gridMesh = null;
    }

    if (this.ghostMesh) {
      this.group.remove(this.ghostMesh);
      this.ghostMesh.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
      this.ghostMesh = null;
    }
  }

  public dispose(): void {
    this.clearMeshes();
  }
}

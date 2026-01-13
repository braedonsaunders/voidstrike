/**
 * ObjectPlacer - Object placement tool for the 3D editor
 *
 * Handles placing, moving, and removing map objects.
 */

import type { EditorObject, ObjectTypeConfig, EditorMapData } from '../config/EditorConfig';

export interface PlacementPreview {
  type: string;
  x: number;
  y: number;
  radius: number;
  valid: boolean;
}

export class ObjectPlacer {
  private objectTypes: ObjectTypeConfig[] = [];
  private mapData: EditorMapData | null = null;
  private selectedType: string | null = null;
  private preview: PlacementPreview | null = null;

  /**
   * Set object type configurations
   */
  public setObjectTypes(types: ObjectTypeConfig[]): void {
    this.objectTypes = types;
  }

  /**
   * Set current map data
   */
  public setMapData(mapData: EditorMapData): void {
    this.mapData = mapData;
  }

  /**
   * Start placing an object type
   */
  public startPlacement(typeId: string): void {
    const objType = this.objectTypes.find((t) => t.id === typeId);
    if (!objType) return;

    this.selectedType = typeId;
    this.preview = {
      type: typeId,
      x: 0,
      y: 0,
      radius: objType.defaultRadius || 5,
      valid: false,
    };
  }

  /**
   * Update placement preview position
   */
  public updatePreviewPosition(x: number, y: number): PlacementPreview | null {
    if (!this.preview || !this.mapData) return null;

    this.preview.x = x;
    this.preview.y = y;
    this.preview.valid = this.isValidPlacement(x, y, this.preview.radius);

    return this.preview;
  }

  /**
   * Confirm placement and create object
   */
  public confirmPlacement(): Omit<EditorObject, 'id'> | null {
    if (!this.preview || !this.preview.valid || !this.selectedType) return null;

    const objType = this.objectTypes.find((t) => t.id === this.selectedType);
    const result: Omit<EditorObject, 'id'> = {
      type: this.selectedType,
      x: this.preview.x,
      y: this.preview.y,
      radius: objType?.defaultRadius,
      properties: {},
    };

    return result;
  }

  /**
   * Cancel placement mode
   */
  public cancelPlacement(): void {
    this.selectedType = null;
    this.preview = null;
  }

  /**
   * Get current preview state
   */
  public getPreview(): PlacementPreview | null {
    return this.preview;
  }

  /**
   * Check if placement is active
   */
  public isPlacing(): boolean {
    return this.selectedType !== null;
  }

  /**
   * Find object at position
   */
  public findObjectAt(x: number, y: number): EditorObject | null {
    if (!this.mapData) return null;

    for (const obj of this.mapData.objects) {
      const objType = this.objectTypes.find((t) => t.id === obj.type);
      const radius = obj.radius || objType?.defaultRadius || 5;
      const dx = obj.x - x;
      const dy = obj.y - y;

      if (dx * dx + dy * dy <= radius * radius) {
        return obj;
      }
    }

    return null;
  }

  /**
   * Check if position can receive object
   */
  public canPlaceAt(x: number, y: number, radius: number, excludeId?: string): boolean {
    return this.isValidPlacement(x, y, radius, excludeId);
  }

  /**
   * Validate placement position
   */
  private isValidPlacement(x: number, y: number, radius: number, excludeId?: string): boolean {
    if (!this.mapData) return false;

    // Check bounds
    if (x < radius || x >= this.mapData.width - radius) return false;
    if (y < radius || y >= this.mapData.height - radius) return false;

    // Check terrain walkability at center
    const centerCell = this.mapData.terrain[Math.floor(y)]?.[Math.floor(x)];
    if (!centerCell || !centerCell.walkable) return false;

    // Check for overlapping objects
    for (const obj of this.mapData.objects) {
      if (excludeId && obj.id === excludeId) continue;

      const objType = this.objectTypes.find((t) => t.id === obj.type);
      const objRadius = obj.radius || objType?.defaultRadius || 5;
      const minDist = radius + objRadius;

      const dx = obj.x - x;
      const dy = obj.y - y;
      const distSq = dx * dx + dy * dy;

      if (distSq < minDist * minDist * 0.5) {
        return false; // Too close to another object
      }
    }

    return true;
  }
}

export default ObjectPlacer;

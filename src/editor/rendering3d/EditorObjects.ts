/**
 * EditorObjects - 3D object rendering for the map editor
 *
 * Renders map objects (bases, towers, destructibles) as 3D representations.
 * Supports category-based visibility toggles.
 */

import * as THREE from 'three';
import type { EditorObject, ObjectTypeConfig } from '../config/EditorConfig';

// Object visual configurations
const OBJECT_VISUALS: Record<string, { color: number; height: number; shape: 'cylinder' | 'box' | 'sphere' }> = {
  main_base: { color: 0x00ff00, height: 3, shape: 'cylinder' },
  natural: { color: 0x00cc00, height: 2.5, shape: 'cylinder' },
  third: { color: 0x009900, height: 2, shape: 'cylinder' },
  gold: { color: 0xffd700, height: 2, shape: 'cylinder' },
  watch_tower: { color: 0x00aaff, height: 4, shape: 'box' },
  destructible_rock: { color: 0x8b4513, height: 1.5, shape: 'sphere' },
  mineral_patch: { color: 0x4169e1, height: 0.8, shape: 'box' },
  vespene_geyser: { color: 0x32cd32, height: 1.2, shape: 'cylinder' },
};

export interface EditorObjectInstance {
  id: string;
  type: string;
  category: string;
  mesh: THREE.Mesh;
  hitMesh: THREE.Mesh; // Larger invisible mesh for easier selection
  selectionRing: THREE.Mesh;
  label: THREE.Sprite;
  baseScale: number; // Original scale before user modifications
}

export class EditorObjects {
  public group: THREE.Group;

  private objects: Map<string, EditorObjectInstance> = new Map();
  private objectTypes: ObjectTypeConfig[] = [];
  private selectedIds: Set<string> = new Set();
  private getTerrainHeight: ((x: number, z: number) => number) | null = null;

  // Visibility by category
  private categoryVisibility: Map<string, boolean> = new Map();
  private labelsVisible: boolean = true;

  constructor() {
    this.group = new THREE.Group();
  }

  /**
   * Set object type configurations
   */
  public setObjectTypes(types: ObjectTypeConfig[]): void {
    this.objectTypes = types;
    // Initialize all categories as visible
    for (const type of types) {
      if (!this.categoryVisibility.has(type.category)) {
        this.categoryVisibility.set(type.category, true);
      }
    }
  }

  /**
   * Set terrain height function for accurate object placement
   */
  public setTerrainHeightFn(fn: (x: number, z: number) => number): void {
    this.getTerrainHeight = fn;
  }

  /**
   * Toggle visibility for a category
   */
  public setCategoryVisible(category: string, visible: boolean): void {
    this.categoryVisibility.set(category, visible);
    this.updateVisibility();
  }

  /**
   * Get category visibility
   */
  public isCategoryVisible(category: string): boolean {
    return this.categoryVisibility.get(category) ?? true;
  }

  /**
   * Get all categories
   */
  public getCategories(): string[] {
    return Array.from(this.categoryVisibility.keys());
  }

  /**
   * Toggle label visibility
   */
  public setLabelsVisible(visible: boolean): void {
    this.labelsVisible = visible;
    for (const instance of this.objects.values()) {
      instance.label.visible = visible && this.isCategoryVisible(instance.category);
    }
  }

  /**
   * Check if labels are visible
   */
  public areLabelsVisible(): boolean {
    return this.labelsVisible;
  }

  /**
   * Update visibility based on category settings
   */
  private updateVisibility(): void {
    for (const instance of this.objects.values()) {
      const visible = this.isCategoryVisible(instance.category);
      instance.mesh.visible = visible;
      instance.selectionRing.visible = visible && this.selectedIds.has(instance.id);
      instance.label.visible = visible && this.labelsVisible;
    }
  }

  /**
   * Load objects from map data
   */
  public loadObjects(objects: EditorObject[]): void {
    // Clear existing
    this.clearAll();

    // Add each object
    for (const obj of objects) {
      this.addObject(obj);
    }
  }

  /**
   * Add a single object
   */
  public addObject(obj: EditorObject): void {
    const objType = this.objectTypes.find((t) => t.id === obj.type);
    const visual = OBJECT_VISUALS[obj.type] || { color: 0xffffff, height: 1, shape: 'cylinder' as const };
    const radius = obj.radius || objType?.defaultRadius || 5;
    const category = objType?.category || 'objects';

    // Get scale from properties (default to 1)
    const scale = (obj.properties?.scale as number) || 1;

    // Get terrain height at position
    const terrainHeight = this.getTerrainHeight ? this.getTerrainHeight(obj.x, obj.y) : 0;

    // Create mesh based on shape
    let geometry: THREE.BufferGeometry;
    switch (visual.shape) {
      case 'box':
        geometry = new THREE.BoxGeometry(radius * 0.4, visual.height, radius * 0.4);
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry(radius * 0.3, 12, 8);
        break;
      case 'cylinder':
      default:
        geometry = new THREE.CylinderGeometry(radius * 0.3, radius * 0.4, visual.height, 12);
    }

    const material = new THREE.MeshLambertMaterial({
      color: objType?.color ? parseInt(objType.color.replace('#', ''), 16) : visual.color,
      transparent: true,
      opacity: 0.85,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(obj.x, terrainHeight + (visual.height * scale) / 2, obj.y);
    mesh.scale.set(scale, scale, scale);

    // Create slightly larger hit mesh for easier selection (fixed size, doesn't scale with object)
    const hitSize = Math.max(2, radius * 0.5); // Minimum 2 units, proportional to radius
    const hitGeometry = new THREE.CylinderGeometry(hitSize, hitSize, visual.height * 1.5, 8);
    const hitMaterial = new THREE.MeshBasicMaterial({
      visible: false,
    });
    const hitMesh = new THREE.Mesh(hitGeometry, hitMaterial);
    hitMesh.position.set(obj.x, terrainHeight + (visual.height * scale) / 2, obj.y);
    // Don't scale hitMesh - keep it fixed size for consistent selection

    // Create selection ring
    const ringGeometry = new THREE.RingGeometry(radius * 0.9, radius, 24);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    const selectionRing = new THREE.Mesh(ringGeometry, ringMaterial);
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.set(obj.x, terrainHeight + 0.1, obj.y);

    // Create label sprite (positioned above object, accounting for scale)
    const label = this.createLabel(objType?.name || obj.type, objType?.icon || '●');
    label.position.set(obj.x, terrainHeight + (visual.height * scale) + 2.5, obj.y);

    // Check category visibility
    const categoryVisible = this.isCategoryVisible(category);
    mesh.visible = categoryVisible;
    selectionRing.visible = false;
    label.visible = categoryVisible && this.labelsVisible;

    // Add to scene
    this.group.add(mesh);
    this.group.add(hitMesh);
    this.group.add(selectionRing);
    this.group.add(label);

    // Store reference
    this.objects.set(obj.id, {
      id: obj.id,
      type: obj.type,
      category,
      mesh,
      hitMesh,
      selectionRing,
      label,
      baseScale: 1, // Base scale before user modifications
    });
  }

  /**
   * Update an object's position
   */
  public updateObject(id: string, x: number, y: number): void {
    const instance = this.objects.get(id);
    if (!instance) return;

    const terrainHeight = this.getTerrainHeight ? this.getTerrainHeight(x, y) : 0;
    const scale = instance.mesh.scale.y; // Current scale
    const visual = OBJECT_VISUALS[instance.type] || { height: 1 };

    instance.mesh.position.set(x, terrainHeight + (visual.height * scale) / 2, y);
    instance.hitMesh.position.set(x, terrainHeight + (visual.height * scale) / 2, y);
    instance.selectionRing.position.set(x, terrainHeight + 0.1, y);
    instance.label.position.set(x, terrainHeight + (visual.height * scale) + 2.5, y);
  }

  /**
   * Update an object's scale
   */
  public updateObjectScale(id: string, scale: number): void {
    const instance = this.objects.get(id);
    if (!instance) return;

    const visual = OBJECT_VISUALS[instance.type] || { height: 1 };
    const x = instance.mesh.position.x;
    const z = instance.mesh.position.z;
    const terrainHeight = this.getTerrainHeight ? this.getTerrainHeight(x, z) : 0;

    // Update mesh scale and position
    instance.mesh.scale.set(scale, scale, scale);
    instance.mesh.position.y = terrainHeight + (visual.height * scale) / 2;

    // Update hit mesh position only (don't scale - keep fixed for consistent selection)
    instance.hitMesh.position.y = terrainHeight + (visual.height * scale) / 2;

    // Update label position
    instance.label.position.y = terrainHeight + (visual.height * scale) + 2.5;
  }

  /**
   * Remove an object
   */
  public removeObject(id: string): void {
    const instance = this.objects.get(id);
    if (!instance) return;

    this.group.remove(instance.mesh);
    this.group.remove(instance.hitMesh);
    this.group.remove(instance.selectionRing);
    this.group.remove(instance.label);

    (instance.mesh.geometry as THREE.BufferGeometry).dispose();
    (instance.mesh.material as THREE.Material).dispose();
    (instance.hitMesh.geometry as THREE.BufferGeometry).dispose();
    (instance.hitMesh.material as THREE.Material).dispose();
    (instance.selectionRing.geometry as THREE.BufferGeometry).dispose();
    (instance.selectionRing.material as THREE.Material).dispose();

    this.objects.delete(id);
    this.selectedIds.delete(id);
  }

  /**
   * Set selected objects
   */
  public setSelection(ids: string[]): void {
    // Clear previous selection
    for (const id of this.selectedIds) {
      const instance = this.objects.get(id);
      if (instance) {
        (instance.selectionRing.material as THREE.MeshBasicMaterial).opacity = 0;
        instance.selectionRing.visible = false;
        (instance.mesh.material as THREE.MeshLambertMaterial).emissive?.setHex(0x000000);
      }
    }

    // Set new selection
    this.selectedIds = new Set(ids);
    for (const id of this.selectedIds) {
      const instance = this.objects.get(id);
      if (instance && this.isCategoryVisible(instance.category)) {
        (instance.selectionRing.material as THREE.MeshBasicMaterial).opacity = 0.8;
        (instance.selectionRing.material as THREE.MeshBasicMaterial).color.setHex(0x00ffff);
        instance.selectionRing.visible = true;
        (instance.mesh.material as THREE.MeshLambertMaterial).emissive?.setHex(0x222222);
      }
    }
  }

  /**
   * Find object at screen position via raycasting
   * Uses hitMesh for selection, sorted by distance to pick closest object
   */
  public findObjectAt(raycaster: THREE.Raycaster): string | null {
    // Use hitMesh for easier selection
    const hitMeshes = Array.from(this.objects.values())
      .filter((o) => o.mesh.visible)
      .map((o) => o.hitMesh);
    const intersects = raycaster.intersectObjects(hitMeshes);

    if (intersects.length > 0) {
      // Intersects are already sorted by distance, pick the closest one
      for (const intersect of intersects) {
        for (const [id, instance] of this.objects) {
          if (instance.hitMesh === intersect.object) {
            return id;
          }
        }
      }
    }

    return null;
  }

  /**
   * Clear all objects
   */
  public clearAll(): void {
    for (const [id] of this.objects) {
      this.removeObject(id);
    }
    this.objects.clear();
    this.selectedIds.clear();
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.clearAll();
  }

  /**
   * Create a text label sprite with high-resolution text
   */
  private createLabel(text: string, icon: string): THREE.Sprite {
    // Use higher resolution for crisp text (2x scale)
    const scale = 2;
    const baseWidth = 256;
    const baseHeight = 80;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = baseWidth * scale;
    canvas.height = baseHeight * scale;

    // Scale context for high-DPI rendering
    ctx.scale(scale, scale);

    // Background with rounded corners
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.beginPath();
    ctx.roundRect(4, 4, baseWidth - 8, baseHeight - 8, 10);
    ctx.fill();

    // Icon
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(icon, 36, baseHeight / 2);

    // Full text (truncated if needed)
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'left';
    const displayText = text.length > 14 ? text.substring(0, 13) + '…' : text;
    ctx.fillText(displayText, 64, baseHeight / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(8, 2.5, 1); // Larger, readable size

    return sprite;
  }
}

export default EditorObjects;

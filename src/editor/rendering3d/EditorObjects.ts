/**
 * EditorObjects - 3D object rendering for the map editor
 *
 * Renders map objects (bases, towers, destructibles, decorations) as 3D models.
 * Uses real GLTF models for decorations with fallback to placeholder geometry.
 * Supports category-based visibility toggles, scale, and rotation.
 */

import * as THREE from 'three';
import type { EditorObject, ObjectTypeConfig } from '../config/EditorConfig';
import { EditorModelLoader } from './EditorModelLoader';
import { debugInitialization } from '@/utils/debugLogger';

// Object visual configurations (fallback when no model available)
const OBJECT_VISUALS: Record<
  string,
  { color: number; height: number; shape: 'cylinder' | 'box' | 'sphere' | 'cone' }
> = {
  main_base: { color: 0x00ff00, height: 3, shape: 'cylinder' },
  natural: { color: 0x00cc00, height: 2.5, shape: 'cylinder' },
  third: { color: 0x009900, height: 2, shape: 'cylinder' },
  fourth: { color: 0x008800, height: 2, shape: 'cylinder' },
  gold: { color: 0xffd700, height: 2, shape: 'cylinder' },
  watch_tower: { color: 0x00aaff, height: 4, shape: 'box' },
  destructible_rock: { color: 0x8b4513, height: 1.5, shape: 'sphere' },
  destructible_debris: { color: 0x606060, height: 1.2, shape: 'sphere' },
  mineral_patch: { color: 0x4169e1, height: 0.8, shape: 'box' },
  plasma_geyser: { color: 0x32cd32, height: 1.2, shape: 'cylinder' },
  // Decorations fallback (heights match base scale from assets.json)
  decoration_tree_pine_tall: { color: 0x2e7d32, height: 14, shape: 'cone' },
  decoration_tree_pine_medium: { color: 0x388e3c, height: 10, shape: 'cone' },
  decoration_tree_dead: { color: 0x5d4037, height: 9, shape: 'cone' },
  decoration_tree_alien: { color: 0x9c27b0, height: 11, shape: 'cone' },
  decoration_tree_palm: { color: 0x4caf50, height: 11, shape: 'cone' },
  decoration_tree_mushroom: { color: 0xe91e63, height: 8, shape: 'sphere' },
  decoration_rocks_large: { color: 0x757575, height: 3, shape: 'sphere' },
  decoration_rocks_small: { color: 0x616161, height: 2, shape: 'sphere' },
  decoration_rock_single: { color: 0x78909c, height: 2.5, shape: 'sphere' },
  decoration_crystal_formation: { color: 0x7c4dff, height: 4, shape: 'cone' },
  decoration_bush: { color: 0x66bb6a, height: 1.5, shape: 'sphere' },
  decoration_ruined_wall: { color: 0x8d6e63, height: 5, shape: 'box' },
  decoration_alien_tower: { color: 0xff5722, height: 14, shape: 'cylinder' },
  decoration_debris: { color: 0x546e7a, height: 1.5, shape: 'sphere' },
};

export interface EditorObjectInstance {
  id: string;
  type: string;
  category: string;
  mesh: THREE.Object3D;
  hitMesh: THREE.Mesh;
  selectionRing: THREE.Mesh;
  label: THREE.Sprite;
  baseScale: number;
  baseRotation: number; // Base rotation from model normalization (radians)
  isRealModel: boolean;
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

  // Model loading state
  private modelsInitialized: boolean = false;

  constructor() {
    this.group = new THREE.Group();
    this.initModels();
  }

  /**
   * Initialize model loader
   */
  private async initModels(): Promise<void> {
    try {
      await EditorModelLoader.initialize();
      this.modelsInitialized = true;
      // Refresh all objects to use real models
      this.refreshAllModels();
    } catch (error) {
      debugInitialization.warn('[EditorObjects] Failed to initialize models:', error);
    }
  }

  /**
   * Refresh all objects to use real models if available
   */
  private refreshAllModels(): void {
    // Store current object data
    const objectsData: Array<{
      obj: EditorObject;
      selected: boolean;
    }> = [];

    for (const [id, instance] of this.objects) {
      const objData: EditorObject = {
        id,
        type: instance.type,
        x: instance.mesh.position.x,
        y: instance.mesh.position.z,
        radius: 5,
        properties: {},
      };

      // Extract current scale and rotation from mesh
      if (instance.mesh instanceof THREE.Group && instance.mesh.children[0]) {
        const innerMesh = instance.mesh.children[0];
        objData.properties = {
          scale: innerMesh.scale.x / instance.baseScale,
          rotation: THREE.MathUtils.radToDeg(innerMesh.rotation.y),
        };
      }

      objectsData.push({
        obj: objData,
        selected: this.selectedIds.has(id),
      });
    }

    // Clear and reload
    this.clearAll();

    for (const { obj, selected } of objectsData) {
      this.addObject(obj);
      if (selected) {
        this.selectedIds.add(obj.id);
      }
    }

    // Restore selection visuals
    this.setSelection(Array.from(this.selectedIds));
  }

  /**
   * Set object type configurations
   */
  public setObjectTypes(types: ObjectTypeConfig[]): void {
    this.objectTypes = types;
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
    this.clearAll();
    for (const obj of objects) {
      this.addObject(obj);
    }
  }

  /**
   * Create placeholder geometry for objects without models
   */
  private createPlaceholderMesh(
    type: string,
    radius: number,
    color: number
  ): { mesh: THREE.Mesh; height: number } {
    const visual = OBJECT_VISUALS[type] || {
      color: 0xffffff,
      height: 1,
      shape: 'cylinder' as const,
    };

    let geometry: THREE.BufferGeometry;
    switch (visual.shape) {
      case 'box':
        geometry = new THREE.BoxGeometry(radius * 0.4, visual.height, radius * 0.4);
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry(radius * 0.3, 12, 8);
        break;
      case 'cone':
        geometry = new THREE.ConeGeometry(radius * 0.35, visual.height, 12);
        break;
      case 'cylinder':
      default:
        geometry = new THREE.CylinderGeometry(radius * 0.3, radius * 0.4, visual.height, 12);
    }

    const material = new THREE.MeshLambertMaterial({
      color: color || visual.color,
      transparent: true,
      opacity: 0.85,
    });

    return {
      mesh: new THREE.Mesh(geometry, material),
      height: visual.height,
    };
  }

  /**
   * Add a single object
   */
  public addObject(obj: EditorObject): void {
    const objType = this.objectTypes.find((t) => t.id === obj.type);
    const radius = obj.radius || objType?.defaultRadius || 5;
    const category = objType?.category || 'objects';

    // Get scale and rotation from properties
    const userScale = (obj.properties?.scale as number) || 1;
    const rotation = (obj.properties?.rotation as number) || 0;

    // Get terrain height at position
    const terrainHeight = this.getTerrainHeight ? this.getTerrainHeight(obj.x, obj.y) : 0;

    // Try to get real model first
    let mesh: THREE.Object3D;
    let isRealModel = false;
    let visualHeight = 2; // Default height for positioning
    let baseScale = 1; // Base scale from model normalization
    let baseRotation = 0; // Base rotation from model normalization (radians)

    const modelInstance = this.modelsInitialized
      ? EditorModelLoader.getModelInstance(obj.type)
      : null;

    if (modelInstance) {
      // Use real model - already normalized and grounded (bottom at y=0)
      mesh = new THREE.Group();
      mesh.add(modelInstance);
      isRealModel = true;

      // Store the base scale and rotation from model normalization
      baseScale = modelInstance.scale.x;
      baseRotation = modelInstance.rotation.y; // Already in radians from EditorModelLoader

      // Get model height from bounding box (after normalization, min.y=0 and max.y=height)
      const box = new THREE.Box3().setFromObject(modelInstance);
      visualHeight = box.max.y - box.min.y;
    } else {
      // Fallback to placeholder
      const colorStr = objType?.color;
      const colorValue =
        typeof colorStr === 'string' && colorStr.length > 0
          ? parseInt(colorStr.replace('#', ''), 16)
          : OBJECT_VISUALS[obj.type]?.color || 0xffffff;

      const placeholder = this.createPlaceholderMesh(obj.type, radius, colorValue);
      mesh = new THREE.Group();
      mesh.add(placeholder.mesh);
      visualHeight = placeholder.height;
      baseScale = 1; // Placeholders start at scale 1
    }

    // Apply user scale on top of base scale, and user rotation on top of base rotation
    // For real models, baseScale/baseRotation are from EditorModelLoader normalization
    // For placeholders, baseScale is 1 and baseRotation is 0
    if (mesh.children[0]) {
      mesh.children[0].scale.setScalar(baseScale * userScale);
      // Add user rotation to base rotation (user rotation is in degrees, base is in radians)
      mesh.children[0].rotation.y = baseRotation + THREE.MathUtils.degToRad(rotation);
    }

    // Calculate visual height with user scale applied
    const scaledHeight = visualHeight * userScale;

    // Position the mesh
    // Real models are grounded (bottom at y=0), so position at terrainHeight directly
    // Placeholder geometries are centered, so need to add height/2
    const yOffset = isRealModel ? 0 : scaledHeight / 2;
    mesh.position.set(obj.x, terrainHeight + yOffset, obj.y);

    // Create hit mesh for easier selection (always centered for raycast)
    const hitSize = Math.max(2, radius * 0.5);
    const hitGeometry = new THREE.CylinderGeometry(hitSize, hitSize, scaledHeight * 1.5, 8);
    const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeometry, hitMaterial);
    hitMesh.position.set(obj.x, terrainHeight + scaledHeight / 2, obj.y);

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

    // Create label sprite (above the model)
    const label = this.createLabel(objType?.name || obj.type, objType?.icon || '●');
    label.position.set(obj.x, terrainHeight + scaledHeight + 2.5, obj.y);

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

    // Store reference with base scale and rotation for later updates
    this.objects.set(obj.id, {
      id: obj.id,
      type: obj.type,
      category,
      mesh,
      hitMesh,
      selectionRing,
      label,
      baseScale,
      baseRotation,
      isRealModel,
    });
  }

  /**
   * Update an object's position
   */
  public updateObject(id: string, x: number, y: number): void {
    const instance = this.objects.get(id);
    if (!instance) return;

    const terrainHeight = this.getTerrainHeight ? this.getTerrainHeight(x, y) : 0;

    // Get visual height from bounding box (at current scale)
    let scaledHeight = 2;
    if (instance.mesh.children[0]) {
      const box = new THREE.Box3().setFromObject(instance.mesh.children[0]);
      scaledHeight = box.max.y - box.min.y;
    }

    // Real models are grounded, placeholders are centered
    const yOffset = instance.isRealModel ? 0 : scaledHeight / 2;

    instance.mesh.position.set(x, terrainHeight + yOffset, y);
    instance.hitMesh.position.set(x, terrainHeight + scaledHeight / 2, y);
    instance.selectionRing.position.set(x, terrainHeight + 0.1, y);
    instance.label.position.set(x, terrainHeight + scaledHeight + 2.5, y);
  }

  /**
   * Update an object's scale
   * @param userScale - The user-specified scale multiplier (1.0 = default size)
   */
  public updateObjectScale(id: string, userScale: number): void {
    const instance = this.objects.get(id);
    if (!instance) return;

    const x = instance.mesh.position.x;
    const z = instance.mesh.position.z;
    const terrainHeight = this.getTerrainHeight ? this.getTerrainHeight(x, z) : 0;

    // Apply user scale on top of base scale
    // baseScale contains the normalization scale from EditorModelLoader
    const totalScale = instance.baseScale * userScale;

    if (instance.mesh.children[0]) {
      instance.mesh.children[0].scale.setScalar(totalScale);
    }

    // Get visual height from bounding box (at current scale)
    let scaledHeight = 2;
    if (instance.mesh.children[0]) {
      const box = new THREE.Box3().setFromObject(instance.mesh.children[0]);
      scaledHeight = box.max.y - box.min.y;
    }

    // Real models are grounded, placeholders are centered
    const yOffset = instance.isRealModel ? 0 : scaledHeight / 2;

    // Update positions
    instance.mesh.position.y = terrainHeight + yOffset;
    instance.hitMesh.position.y = terrainHeight + scaledHeight / 2;
    instance.label.position.y = terrainHeight + scaledHeight + 2.5;
  }

  /**
   * Update an object's rotation
   */
  /**
   * Update an object's rotation
   * @param userRotation - The user-specified rotation in degrees (added to base rotation)
   */
  public updateObjectRotation(id: string, userRotation: number): void {
    const instance = this.objects.get(id);
    if (!instance) return;

    // Add user rotation to base rotation
    // baseRotation is in radians (from EditorModelLoader), userRotation is in degrees
    if (instance.mesh.children[0]) {
      instance.mesh.children[0].rotation.y =
        instance.baseRotation + THREE.MathUtils.degToRad(userRotation);
    }
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

    // Dispose meshes
    instance.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else if (child.material) {
          child.material.dispose();
        }
      }
    });

    instance.hitMesh.geometry.dispose();
    (instance.hitMesh.material as THREE.Material).dispose();
    instance.selectionRing.geometry.dispose();
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

        // Remove emissive highlight from model
        instance.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
            child.material.emissive?.setHex(0x000000);
          } else if (
            child instanceof THREE.Mesh &&
            child.material instanceof THREE.MeshLambertMaterial
          ) {
            child.material.emissive?.setHex(0x000000);
          }
        });
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

        // Add emissive highlight to model
        instance.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
            child.material.emissive?.setHex(0x222222);
          } else if (
            child instanceof THREE.Mesh &&
            child.material instanceof THREE.MeshLambertMaterial
          ) {
            child.material.emissive?.setHex(0x222222);
          }
        });
      }
    }
  }

  /**
   * Find object at screen position via raycasting
   */
  public findObjectAt(raycaster: THREE.Raycaster): string | null {
    const hitMeshes = Array.from(this.objects.values())
      .filter((o) => o.mesh.visible)
      .map((o) => o.hitMesh);
    const intersects = raycaster.intersectObjects(hitMeshes);

    if (intersects.length > 0) {
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
   * Create a text label sprite
   */
  private createLabel(text: string, icon: string): THREE.Sprite {
    const scale = 2;
    const baseWidth = 256;
    const baseHeight = 80;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = baseWidth * scale;
    canvas.height = baseHeight * scale;

    ctx.scale(scale, scale);

    // Background
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

    // Text
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
    sprite.scale.set(8, 2.5, 1);

    return sprite;
  }
}

export default EditorObjects;

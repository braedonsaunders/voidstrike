/**
 * EditorObjects - 3D object rendering for the map editor
 *
 * Renders map objects (bases, towers, destructibles) as 3D representations.
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
  mesh: THREE.Mesh;
  selectionRing: THREE.Mesh;
  label: THREE.Sprite;
}

export class EditorObjects {
  public group: THREE.Group;

  private objects: Map<string, EditorObjectInstance> = new Map();
  private objectTypes: ObjectTypeConfig[] = [];
  private selectedIds: Set<string> = new Set();
  private getTerrainHeight: ((x: number, z: number) => number) | null = null;

  constructor() {
    this.group = new THREE.Group();
  }

  /**
   * Set object type configurations
   */
  public setObjectTypes(types: ObjectTypeConfig[]): void {
    this.objectTypes = types;
  }

  /**
   * Set terrain height function for accurate object placement
   */
  public setTerrainHeightFn(fn: (x: number, z: number) => number): void {
    this.getTerrainHeight = fn;
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

    // Get terrain height at position
    const terrainHeight = this.getTerrainHeight ? this.getTerrainHeight(obj.x, obj.y) : 0;

    // Create mesh based on shape
    let geometry: THREE.BufferGeometry;
    switch (visual.shape) {
      case 'box':
        geometry = new THREE.BoxGeometry(radius * 0.4, visual.height, radius * 0.4);
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry(radius * 0.3, 16, 12);
        break;
      case 'cylinder':
      default:
        geometry = new THREE.CylinderGeometry(radius * 0.3, radius * 0.4, visual.height, 16);
    }

    const material = new THREE.MeshStandardMaterial({
      color: objType?.color ? parseInt(objType.color.replace('#', ''), 16) : visual.color,
      roughness: 0.6,
      metalness: 0.2,
      transparent: true,
      opacity: 0.85,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(obj.x, terrainHeight + visual.height / 2, obj.y);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Create selection ring
    const ringGeometry = new THREE.RingGeometry(radius * 0.9, radius, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    const selectionRing = new THREE.Mesh(ringGeometry, ringMaterial);
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.set(obj.x, terrainHeight + 0.1, obj.y);

    // Create label sprite
    const label = this.createLabel(objType?.name || obj.type, objType?.icon || '●');
    label.position.set(obj.x, terrainHeight + visual.height + 1, obj.y);

    // Add to scene
    this.group.add(mesh);
    this.group.add(selectionRing);
    this.group.add(label);

    // Store reference
    this.objects.set(obj.id, {
      id: obj.id,
      mesh,
      selectionRing,
      label,
    });
  }

  /**
   * Update an object's position
   */
  public updateObject(id: string, x: number, y: number): void {
    const instance = this.objects.get(id);
    if (!instance) return;

    const terrainHeight = this.getTerrainHeight ? this.getTerrainHeight(x, y) : 0;
    const currentHeight = instance.mesh.position.y - terrainHeight;

    instance.mesh.position.set(x, terrainHeight + currentHeight, y);
    instance.selectionRing.position.set(x, terrainHeight + 0.1, y);
    instance.label.position.set(x, instance.mesh.position.y + 1, y);
  }

  /**
   * Remove an object
   */
  public removeObject(id: string): void {
    const instance = this.objects.get(id);
    if (!instance) return;

    this.group.remove(instance.mesh);
    this.group.remove(instance.selectionRing);
    this.group.remove(instance.label);

    (instance.mesh.geometry as THREE.BufferGeometry).dispose();
    (instance.mesh.material as THREE.Material).dispose();
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
        (instance.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
      }
    }

    // Set new selection
    this.selectedIds = new Set(ids);
    for (const id of this.selectedIds) {
      const instance = this.objects.get(id);
      if (instance) {
        (instance.selectionRing.material as THREE.MeshBasicMaterial).opacity = 0.8;
        (instance.selectionRing.material as THREE.MeshBasicMaterial).color.setHex(0x00ffff);
        (instance.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x222222);
      }
    }
  }

  /**
   * Find object at screen position via raycasting
   */
  public findObjectAt(raycaster: THREE.Raycaster): string | null {
    const meshes = Array.from(this.objects.values()).map((o) => o.mesh);
    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      for (const [id, instance] of this.objects) {
        if (instance.mesh === intersects[0].object) {
          return id;
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
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 128;
    canvas.height = 64;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.roundRect(0, 0, canvas.width, canvas.height, 8);
    ctx.fill();

    // Icon
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(icon, 24, 32);

    // Text
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(text, 48, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(8, 4, 1);

    return sprite;
  }
}

export default EditorObjects;

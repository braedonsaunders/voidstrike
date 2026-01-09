import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Resource } from '@/engine/components/Resource';
import { Selectable } from '@/engine/components/Selectable';
import { Terrain } from './Terrain';
import AssetManager from '@/assets/AssetManager';

interface InstancedResourceGroup {
  mesh: THREE.InstancedMesh;
  resourceType: string;
  maxInstances: number;
  entityIds: number[];
  rotations: number[]; // Store random rotations per instance
  yOffset: number; // Y offset from model normalization (to ground the model)
  baseScale: number; // Base scale from model normalization
}

// Track per-resource rotation and selection ring
interface ResourceData {
  rotation: number;
  lastScale: number;
  selectionRing: THREE.Mesh | null;
}

const MAX_RESOURCES_PER_TYPE = 50;

export class ResourceRenderer {
  private scene: THREE.Scene;
  private world: World;
  private terrain: Terrain | null;

  // Instanced mesh groups: one per resource type
  private instancedGroups: Map<string, InstancedResourceGroup> = new Map();

  // Per-resource data
  private resourceData: Map<number, ResourceData> = new Map();

  // Selection ring resources
  private selectionGeometry: THREE.RingGeometry;
  private selectionMaterial: THREE.MeshBasicMaterial;

  // Reusable objects for matrix calculations
  private tempMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private tempPosition: THREE.Vector3 = new THREE.Vector3();
  private tempQuaternion: THREE.Quaternion = new THREE.Quaternion();
  private tempScale: THREE.Vector3 = new THREE.Vector3();
  private tempEuler: THREE.Euler = new THREE.Euler();

  // Debug tracking
  private _lastMineralCount: number = 0;

  constructor(scene: THREE.Scene, world: World, terrain?: Terrain) {
    this.scene = scene;
    this.world = world;
    this.terrain = terrain ?? null;

    // Selection ring for resources (yellow for neutral)
    this.selectionGeometry = new THREE.RingGeometry(1.2, 1.5, 16);
    this.selectionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
  }

  /**
   * Get or create an instanced mesh group for a resource type
   */
  private getOrCreateInstancedGroup(resourceType: string): InstancedResourceGroup {
    let group = this.instancedGroups.get(resourceType);

    if (!group) {
      // Get the base mesh from AssetManager
      const baseMesh = AssetManager.getResourceMesh(resourceType as 'minerals' | 'vespene');

      // Find the actual mesh geometry, material, and extract transforms from the model
      let geometry: THREE.BufferGeometry | null = null;
      let material: THREE.Material | THREE.Material[] | null = null;
      let yOffset = 0;
      let baseScale = 1;

      // Debug: count meshes in the model
      let meshCount = 0;
      baseMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          meshCount++;
        }
      });
      console.log(`[ResourceRenderer] ${resourceType} model has ${meshCount} meshes`);

      // baseMesh is a wrapper Group containing the normalized model
      // The inner model has position.y set for grounding and scale set for sizing
      baseMesh.traverse((child) => {
        if (child instanceof THREE.Mesh && !geometry) {
          geometry = child.geometry;
          material = child.material;
          console.log(`[ResourceRenderer] ${resourceType} using mesh: geometry vertices=${geometry?.attributes?.position?.count ?? 'unknown'}, material=${material ? 'present' : 'missing'}`);
          // Get the accumulated y-offset and scale from the transform chain
          // Walk up the parent chain to accumulate transforms
          let obj: THREE.Object3D | null = child;
          let depth = 0;
          while (obj && obj !== baseMesh) {
            console.log(`[ResourceRenderer] ${resourceType} transform chain[${depth}]: pos.y=${obj.position.y.toFixed(2)}, scale.y=${obj.scale.y.toFixed(4)}`);
            yOffset += obj.position.y * (obj.parent?.scale.y ?? 1);
            baseScale *= obj.scale.y;
            obj = obj.parent;
            depth++;
          }
        }
      });

      // Fallback to procedural geometry if model has no geometry or invalid geometry
      const geomToCheck = geometry as THREE.BufferGeometry | null;
      const vertexCount = geomToCheck?.attributes?.position?.count ?? 0;
      if (!geomToCheck || vertexCount < 3) {
        console.log(`[ResourceRenderer] ${resourceType}: Using procedural fallback (geometry ${geomToCheck ? 'has ' + vertexCount + ' vertices' : 'missing'})`);
        // Fallback: create a simple shape
        if (resourceType === 'minerals') {
          geometry = new THREE.ConeGeometry(0.4, 1.2, 6);
          material = new THREE.MeshStandardMaterial({
            color: 0x60a0ff,
            emissive: 0x4080ff,
            emissiveIntensity: 0.8,
          });
          yOffset = 0.6; // Half height of cone
          baseScale = 1;
        } else {
          geometry = new THREE.CylinderGeometry(0.5, 0.7, 0.6, 8);
          material = new THREE.MeshStandardMaterial({
            color: 0x40ff80,
            emissive: 0x20ff60,
            emissiveIntensity: 0.6,
          });
          yOffset = 0.3; // Half height of cylinder
          baseScale = 1;
        }
      }

      // Create instanced mesh (geometry is guaranteed non-null after fallback)
      const instancedMesh = new THREE.InstancedMesh(
        geometry!,
        material!,
        MAX_RESOURCES_PER_TYPE
      );
      instancedMesh.count = 0;
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;
      instancedMesh.frustumCulled = false;

      this.scene.add(instancedMesh);

      // Clamp values to reasonable ranges to prevent underground rendering or invisible scales
      if (yOffset < 0) {
        console.warn(`[ResourceRenderer] ${resourceType}: Negative yOffset ${yOffset.toFixed(2)} clamped to 0`);
        yOffset = 0;
      }
      // baseScale must be in a reasonable range - too small makes resources invisible
      // If model normalization resulted in tiny scale, use 1.0 instead
      if (baseScale <= 0.1 || baseScale > 10) {
        console.warn(`[ResourceRenderer] ${resourceType}: Invalid baseScale ${baseScale.toFixed(4)} clamped to 1.0`);
        baseScale = 1;
      }

      console.log(`[ResourceRenderer] Created instanced group for ${resourceType}: yOffset=${yOffset.toFixed(2)}, baseScale=${baseScale.toFixed(3)}, geometry=${!!geometry}, material=${!!material}`);

      group = {
        mesh: instancedMesh,
        resourceType,
        maxInstances: MAX_RESOURCES_PER_TYPE,
        entityIds: [],
        rotations: [],
        yOffset,
        baseScale,
      };

      this.instancedGroups.set(resourceType, group);
    }

    return group;
  }

  /**
   * Get or create per-resource data (rotation, selection ring)
   */
  private getOrCreateResourceData(entityId: number): ResourceData {
    let data = this.resourceData.get(entityId);
    if (!data) {
      // Create selection ring
      const selectionRing = new THREE.Mesh(this.selectionGeometry, this.selectionMaterial);
      selectionRing.rotation.x = -Math.PI / 2;
      selectionRing.visible = false;
      this.scene.add(selectionRing);

      data = {
        rotation: Math.random() * Math.PI * 2,
        lastScale: 1,
        selectionRing,
      };
      this.resourceData.set(entityId, data);
    }
    return data;
  }

  public update(): void {
    const entities = this.world.getEntitiesWith('Transform', 'Resource');
    const currentIds = new Set<number>();

    // Count resources by type for debugging
    let mineralCount = 0;
    let vespeneCount = 0;
    for (const entity of entities) {
      const resource = entity.get<Resource>('Resource');
      if (resource?.resourceType === 'minerals') mineralCount++;
      else if (resource?.resourceType === 'vespene') vespeneCount++;
    }
    // Only log once at startup or when counts change
    if (!this._lastMineralCount || this._lastMineralCount !== mineralCount) {
      console.log(`[ResourceRenderer] Found ${mineralCount} minerals, ${vespeneCount} vespene entities`);
      this._lastMineralCount = mineralCount;
    }

    // Reset instance counts
    for (const group of this.instancedGroups.values()) {
      group.mesh.count = 0;
      group.entityIds = [];
    }

    // Build instance data
    for (const entity of entities) {
      currentIds.add(entity.id);

      const transform = entity.get<Transform>('Transform');
      const resource = entity.get<Resource>('Resource');

      // Skip entities with missing required components (defensive check)
      if (!transform || !resource) continue;

      // Skip depleted resources
      if (resource.isDepleted()) {
        continue;
      }

      // Skip vespene geysers that have a refinery built on them
      if (resource.resourceType === 'vespene' && resource.hasRefinery()) {
        continue;
      }

      const group = this.getOrCreateInstancedGroup(resource.resourceType);
      const data = this.getOrCreateResourceData(entity.id);

      // Get terrain height
      const terrainHeight = this.terrain?.getHeightAt(transform.x, transform.y) ?? 0;

      // Update selection ring
      const selectable = entity.get<Selectable>('Selectable');
      if (data.selectionRing) {
        data.selectionRing.position.set(transform.x, terrainHeight + 0.05, transform.y);
        data.selectionRing.visible = selectable?.isSelected ?? false;
      }

      if (group.mesh.count < group.maxInstances) {
        const instanceIndex = group.mesh.count;
        group.entityIds[instanceIndex] = entity.id;

        // Scale based on remaining amount, including base scale from model
        const amountScale = 0.5 + resource.getPercentRemaining() * 0.5;
        const finalScale = amountScale * group.baseScale;

        // Set instance transform - apply yOffset scaled appropriately
        this.tempPosition.set(transform.x, terrainHeight + group.yOffset * amountScale, transform.y);
        this.tempEuler.set(0, data.rotation, 0);
        this.tempQuaternion.setFromEuler(this.tempEuler);
        this.tempScale.set(finalScale, finalScale, finalScale);
        this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
        group.mesh.setMatrixAt(instanceIndex, this.tempMatrix);

        group.mesh.count++;
      }
    }

    // Mark instance matrices as needing update and log counts
    for (const group of this.instancedGroups.values()) {
      if (group.mesh.count > 0) {
        group.mesh.instanceMatrix.needsUpdate = true;
      }
      // Log instance counts on first frame or when they change
      const key = `_last${group.resourceType}Count`;
      const self = this as unknown as Record<string, number>;
      if (self[key] !== group.mesh.count) {
        console.log(`[ResourceRenderer] ${group.resourceType} instance count: ${group.mesh.count}`);
        self[key] = group.mesh.count;
      }
    }

    // Clean up resource data for destroyed entities
    for (const [entityId, data] of this.resourceData) {
      if (!currentIds.has(entityId)) {
        if (data.selectionRing) {
          this.scene.remove(data.selectionRing);
        }
        this.resourceData.delete(entityId);
      }
    }
  }

  public dispose(): void {
    for (const group of this.instancedGroups.values()) {
      this.scene.remove(group.mesh);
      group.mesh.geometry.dispose();
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      }
    }
    this.instancedGroups.clear();

    // Clean up selection rings
    for (const data of this.resourceData.values()) {
      if (data.selectionRing) {
        this.scene.remove(data.selectionRing);
      }
    }
    this.resourceData.clear();

    this.selectionGeometry.dispose();
    this.selectionMaterial.dispose();
  }
}

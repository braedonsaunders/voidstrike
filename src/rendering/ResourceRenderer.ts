import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Resource } from '@/engine/components/Resource';
import { Terrain } from './Terrain';
import AssetManager from '@/assets/AssetManager';

interface InstancedResourceGroup {
  mesh: THREE.InstancedMesh;
  resourceType: string;
  maxInstances: number;
  entityIds: number[];
  rotations: number[]; // Store random rotations per instance
}

// Track per-resource rotation for visual variety
interface ResourceData {
  rotation: number;
  lastScale: number;
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

  // Reusable objects for matrix calculations
  private tempMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private tempPosition: THREE.Vector3 = new THREE.Vector3();
  private tempQuaternion: THREE.Quaternion = new THREE.Quaternion();
  private tempScale: THREE.Vector3 = new THREE.Vector3();
  private tempEuler: THREE.Euler = new THREE.Euler();

  constructor(scene: THREE.Scene, world: World, terrain?: Terrain) {
    this.scene = scene;
    this.world = world;
    this.terrain = terrain ?? null;
  }

  /**
   * Get or create an instanced mesh group for a resource type
   */
  private getOrCreateInstancedGroup(resourceType: string): InstancedResourceGroup {
    let group = this.instancedGroups.get(resourceType);

    if (!group) {
      // Get the base mesh from AssetManager
      const baseMesh = AssetManager.getResourceMesh(resourceType as 'minerals' | 'vespene');

      // Find the actual mesh geometry and material from the group
      let geometry: THREE.BufferGeometry | null = null;
      let material: THREE.Material | THREE.Material[] | null = null;

      baseMesh.traverse((child) => {
        if (child instanceof THREE.Mesh && !geometry) {
          geometry = child.geometry;
          material = child.material;
        }
      });

      if (!geometry) {
        // Fallback: create a simple shape
        if (resourceType === 'minerals') {
          geometry = new THREE.ConeGeometry(0.4, 1.2, 6);
          material = new THREE.MeshStandardMaterial({
            color: 0x60a0ff,
            emissive: 0x4080ff,
            emissiveIntensity: 0.8,
          });
        } else {
          geometry = new THREE.CylinderGeometry(0.5, 0.7, 0.6, 8);
          material = new THREE.MeshStandardMaterial({
            color: 0x40ff80,
            emissive: 0x20ff60,
            emissiveIntensity: 0.6,
          });
        }
      }

      // Create instanced mesh
      const instancedMesh = new THREE.InstancedMesh(
        geometry,
        material!,
        MAX_RESOURCES_PER_TYPE
      );
      instancedMesh.count = 0;
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;
      instancedMesh.frustumCulled = false;

      this.scene.add(instancedMesh);

      group = {
        mesh: instancedMesh,
        resourceType,
        maxInstances: MAX_RESOURCES_PER_TYPE,
        entityIds: [],
        rotations: [],
      };

      this.instancedGroups.set(resourceType, group);
    }

    return group;
  }

  /**
   * Get or create per-resource data (rotation)
   */
  private getOrCreateResourceData(entityId: number): ResourceData {
    let data = this.resourceData.get(entityId);
    if (!data) {
      data = {
        rotation: Math.random() * Math.PI * 2,
        lastScale: 1,
      };
      this.resourceData.set(entityId, data);
    }
    return data;
  }

  public update(): void {
    const entities = this.world.getEntitiesWith('Transform', 'Resource');
    const currentIds = new Set<number>();

    // Reset instance counts
    for (const group of this.instancedGroups.values()) {
      group.mesh.count = 0;
      group.entityIds = [];
    }

    // Build instance data
    for (const entity of entities) {
      currentIds.add(entity.id);

      const transform = entity.get<Transform>('Transform')!;
      const resource = entity.get<Resource>('Resource')!;

      // Skip depleted resources
      if (resource.isDepleted()) {
        continue;
      }

      const group = this.getOrCreateInstancedGroup(resource.resourceType);
      const data = this.getOrCreateResourceData(entity.id);

      if (group.mesh.count < group.maxInstances) {
        const instanceIndex = group.mesh.count;
        group.entityIds[instanceIndex] = entity.id;

        // Get terrain height
        const terrainHeight = this.terrain?.getHeightAt(transform.x, transform.y) ?? 0;

        // Scale based on remaining amount
        const scale = 0.5 + resource.getPercentRemaining() * 0.5;

        // Set instance transform
        this.tempPosition.set(transform.x, terrainHeight, transform.y);
        this.tempEuler.set(0, data.rotation, 0);
        this.tempQuaternion.setFromEuler(this.tempEuler);
        this.tempScale.set(scale, scale, scale);
        this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
        group.mesh.setMatrixAt(instanceIndex, this.tempMatrix);

        group.mesh.count++;
      }
    }

    // Mark instance matrices as needing update
    for (const group of this.instancedGroups.values()) {
      if (group.mesh.count > 0) {
        group.mesh.instanceMatrix.needsUpdate = true;
      }
    }

    // Clean up resource data for destroyed entities
    for (const entityId of this.resourceData.keys()) {
      if (!currentIds.has(entityId)) {
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
    this.resourceData.clear();
  }
}

import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Resource } from '@/engine/components/Resource';
import { Terrain } from './Terrain';
import AssetManager from '@/assets/AssetManager';

interface ResourceMeshData {
  mesh: THREE.Object3D;
}

export class ResourceRenderer {
  private scene: THREE.Scene;
  private world: World;
  private terrain: Terrain | null;
  private resourceMeshes: Map<number, ResourceMeshData> = new Map();

  constructor(scene: THREE.Scene, world: World, terrain?: Terrain) {
    this.scene = scene;
    this.world = world;
    this.terrain = terrain ?? null;
  }

  public update(): void {
    const entities = this.world.getEntitiesWith('Transform', 'Resource');
    const currentIds = new Set<number>();

    for (const entity of entities) {
      currentIds.add(entity.id);

      const transform = entity.get<Transform>('Transform')!;
      const resource = entity.get<Resource>('Resource')!;

      let meshData = this.resourceMeshes.get(entity.id);

      if (!meshData) {
        meshData = this.createResourceMesh(resource);
        this.resourceMeshes.set(entity.id, meshData);
        this.scene.add(meshData.mesh);
      }

      // Get terrain height at this position
      const terrainHeight = this.terrain?.getHeightAt(transform.x, transform.y) ?? 0;

      // Update position - place resource on top of terrain
      meshData.mesh.position.set(transform.x, terrainHeight, transform.y);

      // Scale based on remaining amount
      const scale = 0.5 + resource.getPercentRemaining() * 0.5;
      meshData.mesh.scale.setScalar(scale);

      // Hide if depleted
      if (resource.isDepleted()) {
        meshData.mesh.visible = false;
      }
    }

    // Remove meshes for destroyed entities
    for (const [entityId, meshData] of this.resourceMeshes) {
      if (!currentIds.has(entityId)) {
        this.scene.remove(meshData.mesh);
        this.resourceMeshes.delete(entityId);
      }
    }
  }

  private createResourceMesh(resource: Resource): ResourceMeshData {
    const resourceType = resource.resourceType as 'minerals' | 'vespene';
    const mesh = AssetManager.getResourceMesh(resourceType);

    // Set random rotation for visual variety
    mesh.rotation.y = Math.random() * Math.PI * 2;

    return { mesh };
  }

  public dispose(): void {
    for (const meshData of this.resourceMeshes.values()) {
      this.scene.remove(meshData.mesh);
    }
    this.resourceMeshes.clear();
  }
}

import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Resource } from '@/engine/components/Resource';
import { Terrain } from './Terrain';

interface ResourceMeshData {
  mesh: THREE.Mesh;
  glow: THREE.PointLight;
}

export class ResourceRenderer {
  private scene: THREE.Scene;
  private world: World;
  private terrain: Terrain | null;
  private resourceMeshes: Map<number, ResourceMeshData> = new Map();

  // Shared resources
  private mineralGeometry: THREE.OctahedronGeometry;
  private mineralMaterial: THREE.MeshStandardMaterial;
  private vespeneGeometry: THREE.SphereGeometry;
  private vespeneMaterial: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, world: World, terrain?: Terrain) {
    this.scene = scene;
    this.world = world;
    this.terrain = terrain ?? null;

    // Minerals - blue crystals
    this.mineralGeometry = new THREE.OctahedronGeometry(0.8);
    this.mineralMaterial = new THREE.MeshStandardMaterial({
      color: 0x00aaff,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0x003366,
      emissiveIntensity: 0.3,
    });

    // Vespene - green gas
    this.vespeneGeometry = new THREE.SphereGeometry(1, 16, 16);
    this.vespeneMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ff66,
      roughness: 0.1,
      metalness: 0.3,
      emissive: 0x006633,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.8,
    });
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
        this.scene.add(meshData.glow);
      }

      // Get terrain height at this position
      const terrainHeight = this.terrain?.getHeightAt(transform.x, transform.y) ?? 0;

      // Update position - place resource on top of terrain
      meshData.mesh.position.set(transform.x, terrainHeight + 0.8, transform.y);
      meshData.glow.position.set(transform.x, terrainHeight + 1, transform.y);

      // Scale based on remaining amount
      const scale = 0.5 + resource.getPercentRemaining() * 0.5;
      meshData.mesh.scale.setScalar(scale);

      // Rotate for visual effect
      meshData.mesh.rotation.y += 0.01;

      // Update glow intensity
      meshData.glow.intensity = resource.getPercentRemaining() * 0.5;

      // Hide if depleted
      if (resource.isDepleted()) {
        meshData.mesh.visible = false;
        meshData.glow.visible = false;
      }
    }

    // Remove meshes for destroyed entities
    for (const [entityId, meshData] of this.resourceMeshes) {
      if (!currentIds.has(entityId)) {
        this.scene.remove(meshData.mesh);
        this.scene.remove(meshData.glow);
        this.resourceMeshes.delete(entityId);
      }
    }
  }

  private createResourceMesh(resource: Resource): ResourceMeshData {
    const isMinerals = resource.resourceType === 'minerals';

    const geometry = isMinerals ? this.mineralGeometry : this.vespeneGeometry;
    const material = isMinerals ? this.mineralMaterial : this.vespeneMaterial;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;

    // Add glow light
    const glow = new THREE.PointLight(
      isMinerals ? 0x00aaff : 0x00ff66,
      0.5,
      5
    );

    return { mesh, glow };
  }

  public dispose(): void {
    this.mineralGeometry.dispose();
    this.mineralMaterial.dispose();
    this.vespeneGeometry.dispose();
    this.vespeneMaterial.dispose();

    for (const meshData of this.resourceMeshes.values()) {
      this.scene.remove(meshData.mesh);
      this.scene.remove(meshData.glow);
    }

    this.resourceMeshes.clear();
  }
}

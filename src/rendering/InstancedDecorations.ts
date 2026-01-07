import * as THREE from 'three';
import { BiomeConfig } from './Biomes';
import { MapData } from '@/data/maps';

/**
 * PERFORMANCE: Instanced rendering for decorations
 *
 * Instead of creating individual meshes (1000+ draw calls),
 * we use InstancedMesh to render all similar objects in a single draw call.
 * This can improve performance by 10-100x for decoration rendering.
 */

interface InstancedGroupConfig {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  maxCount: number;
}

/**
 * Instanced tree rendering - all trees of same type in one draw call
 */
export class InstancedTrees {
  public group: THREE.Group;
  private instancedMeshes: THREE.InstancedMesh[] = [];
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    if (biome.treeDensity <= 0) return;

    const treeCount = Math.floor(mapData.width * mapData.height * biome.treeDensity * 0.008);
    const maxTrees = Math.min(treeCount, 300);

    // Generate tree positions first
    const positions: Array<{ x: number; y: number; z: number; scale: number; rotation: number }> = [];

    for (let i = 0; i < maxTrees; i++) {
      let x: number, y: number;

      if (Math.random() < 0.6) {
        const edge = Math.floor(Math.random() * 4);
        switch (edge) {
          case 0: x = 8 + Math.random() * 15; y = 10 + Math.random() * (mapData.height - 20); break;
          case 1: x = mapData.width - 23 + Math.random() * 15; y = 10 + Math.random() * (mapData.height - 20); break;
          case 2: x = 10 + Math.random() * (mapData.width - 20); y = 8 + Math.random() * 15; break;
          default: x = 10 + Math.random() * (mapData.width - 20); y = mapData.height - 23 + Math.random() * 15; break;
        }
      } else {
        x = 15 + Math.random() * (mapData.width - 30);
        y = 15 + Math.random() * (mapData.height - 30);
      }

      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        if (cell.terrain === 'ground' || cell.terrain === 'unbuildable') {
          const height = getHeightAt(x, y);
          positions.push({
            x,
            y: height,
            z: y,
            scale: 0.7 + Math.random() * 0.6,
            rotation: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    if (positions.length === 0) return;

    // Create instanced meshes based on biome type
    this.createInstancedTrees(biome, positions);
  }

  private createInstancedTrees(
    biome: BiomeConfig,
    positions: Array<{ x: number; y: number; z: number; scale: number; rotation: number }>
  ): void {
    // Trunk material (shared)
    const trunkMaterial = new THREE.MeshBasicMaterial({ color: 0x4a3520 });
    this.materials.push(trunkMaterial);

    // Foliage material based on biome
    const foliageColor = this.getFoliageColor(biome);
    const foliageMaterial = new THREE.MeshBasicMaterial({ color: foliageColor });
    this.materials.push(foliageMaterial);

    // Create trunk geometry (cylinder)
    const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.25, 1.5, 6);
    this.geometries.push(trunkGeometry);

    // Create foliage geometry (cone for pine trees)
    const foliageGeometry = new THREE.ConeGeometry(1.2, 2, 6);
    this.geometries.push(foliageGeometry);

    // Create instanced meshes
    const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, positions.length);
    const foliageMesh = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, positions.length);

    // Set up instance matrices
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];

      // Trunk instance
      position.set(p.x, p.y + 0.75 * p.scale, p.z);
      quaternion.setFromEuler(new THREE.Euler(0, p.rotation, 0));
      scale.set(p.scale, p.scale, p.scale);
      matrix.compose(position, quaternion, scale);
      trunkMesh.setMatrixAt(i, matrix);

      // Foliage instance (offset above trunk)
      position.set(p.x, p.y + 2.5 * p.scale, p.z);
      matrix.compose(position, quaternion, scale);
      foliageMesh.setMatrixAt(i, matrix);
    }

    trunkMesh.instanceMatrix.needsUpdate = true;
    foliageMesh.instanceMatrix.needsUpdate = true;

    // Disable frustum culling for instanced meshes (they handle it internally)
    trunkMesh.frustumCulled = false;
    foliageMesh.frustumCulled = false;

    this.instancedMeshes.push(trunkMesh, foliageMesh);
    this.group.add(trunkMesh);
    this.group.add(foliageMesh);
  }

  private getFoliageColor(biome: BiomeConfig): number {
    switch (biome.name) {
      case 'Frozen Wastes': return 0x2a4a3a;
      case 'Desert': return 0x2a6a2a;
      case 'Volcanic': return 0x1a1a1a;
      case 'Void': return 0x4a2060;
      case 'Jungle': return 0x1a5a1a;
      default: return 0x2d5a2d;
    }
  }

  public dispose(): void {
    for (const mesh of this.instancedMeshes) {
      mesh.dispose();
    }
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
  }
}

/**
 * Instanced rock rendering - all rocks in one draw call
 */
export class InstancedRocks {
  public group: THREE.Group;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.Material | null = null;

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    const rockCount = Math.floor(mapData.width * mapData.height * biome.rockDensity * 0.006);
    const maxRocks = Math.min(rockCount, 200);

    // Generate rock positions
    const positions: Array<{ x: number; y: number; z: number; scale: number; rotation: THREE.Euler }> = [];

    for (let i = 0; i < maxRocks; i++) {
      const x = 8 + Math.random() * (mapData.width - 16);
      const y = 8 + Math.random() * (mapData.height - 16);

      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        if (cell.terrain !== 'ramp') {
          const height = getHeightAt(x, y);
          const size = 0.5 + Math.random() * 0.8;
          positions.push({
            x,
            y: height + size * 0.4,
            z: y,
            scale: size,
            rotation: new THREE.Euler(
              Math.random() * 0.4,
              Math.random() * Math.PI,
              Math.random() * 0.3
            ),
          });
        }
      }
    }

    if (positions.length === 0) return;

    // Rock material based on biome
    const rockColor = biome.colors.cliff[0];
    this.material = new THREE.MeshBasicMaterial({
      color: rockColor,
    });

    // Use dodecahedron for rocks
    this.geometry = new THREE.DodecahedronGeometry(1, 0);

    // Create instanced mesh
    this.instancedMesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      positions.length
    );

    // Set up instance matrices
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];

      position.set(p.x, p.y, p.z);
      quaternion.setFromEuler(p.rotation);
      scale.set(p.scale, p.scale * 0.7, p.scale * 1.1);
      matrix.compose(position, quaternion, scale);
      this.instancedMesh.setMatrixAt(i, matrix);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.frustumCulled = false;

    this.group.add(this.instancedMesh);
  }

  public dispose(): void {
    this.instancedMesh?.dispose();
    this.geometry?.dispose();
    this.material?.dispose();
  }
}

/**
 * Instanced grass/ground debris - thousands of small objects in one draw call
 */
export class InstancedGrass {
  public group: THREE.Group;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.Material | null = null;

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    // Skip grass for some biomes
    if (biome.name === 'Volcanic' || biome.name === 'Void' || biome.name === 'Desert') {
      return;
    }

    const grassCount = Math.min(2000, mapData.width * mapData.height * 0.15);

    // Generate grass positions
    const positions: Array<{ x: number; y: number; z: number; scale: number; rotation: number }> = [];

    for (let i = 0; i < grassCount; i++) {
      const x = 5 + Math.random() * (mapData.width - 10);
      const z = 5 + Math.random() * (mapData.height - 10);

      const cellX = Math.floor(x);
      const cellZ = Math.floor(z);
      if (cellX >= 0 && cellX < mapData.width && cellZ >= 0 && cellZ < mapData.height) {
        const cell = mapData.terrain[cellZ][cellX];
        if (cell.terrain === 'ground') {
          const height = getHeightAt(x, z);
          positions.push({
            x,
            y: height + 0.1,
            z,
            scale: 0.1 + Math.random() * 0.15,
            rotation: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    if (positions.length === 0) return;

    // Grass color based on biome
    const grassColor = biome.colors.ground[0].clone().multiplyScalar(0.8);
    this.material = new THREE.MeshBasicMaterial({
      color: grassColor,
      side: THREE.DoubleSide,
    });

    // Simple grass blade geometry (flat plane)
    this.geometry = new THREE.PlaneGeometry(0.3, 0.5);

    // Create instanced mesh
    this.instancedMesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      positions.length
    );

    // Set up instance matrices
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];

      position.set(p.x, p.y + p.scale * 2, p.z);
      quaternion.setFromEuler(new THREE.Euler(0, p.rotation, 0));
      scale.set(p.scale, p.scale, p.scale);
      matrix.compose(position, quaternion, scale);
      this.instancedMesh.setMatrixAt(i, matrix);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.frustumCulled = false;

    this.group.add(this.instancedMesh);
  }

  public dispose(): void {
    this.instancedMesh?.dispose();
    this.geometry?.dispose();
    this.material?.dispose();
  }
}

/**
 * Instanced small rocks/pebbles - many small objects in few draw calls
 */
export class InstancedPebbles {
  public group: THREE.Group;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.Material | null = null;

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    const pebbleCount = Math.min(500, mapData.width * mapData.height * 0.04);

    // Generate pebble positions
    const positions: Array<{ x: number; y: number; z: number; scale: number; rotation: THREE.Euler }> = [];

    for (let i = 0; i < pebbleCount; i++) {
      const x = 5 + Math.random() * (mapData.width - 10);
      const z = 5 + Math.random() * (mapData.height - 10);

      const cellX = Math.floor(x);
      const cellZ = Math.floor(z);
      if (cellX >= 0 && cellX < mapData.width && cellZ >= 0 && cellZ < mapData.height) {
        const cell = mapData.terrain[cellZ][cellX];
        if (cell.terrain === 'ground' || cell.terrain === 'unbuildable') {
          const height = getHeightAt(x, z);
          const size = 0.1 + Math.random() * 0.2;
          positions.push({
            x,
            y: height + size * 0.3,
            z,
            scale: size,
            rotation: new THREE.Euler(
              Math.random() * Math.PI,
              Math.random() * Math.PI,
              Math.random() * Math.PI
            ),
          });
        }
      }
    }

    if (positions.length === 0) return;

    // Pebble material
    const pebbleColor = biome.colors.cliff[0].clone().multiplyScalar(0.7);
    this.material = new THREE.MeshBasicMaterial({ color: pebbleColor });

    // Small icosahedron for pebbles
    this.geometry = new THREE.IcosahedronGeometry(1, 0);

    // Create instanced mesh
    this.instancedMesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      positions.length
    );

    // Set up instance matrices
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];

      position.set(p.x, p.y, p.z);
      quaternion.setFromEuler(p.rotation);
      scale.set(p.scale, p.scale, p.scale);
      matrix.compose(position, quaternion, scale);
      this.instancedMesh.setMatrixAt(i, matrix);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.frustumCulled = false;

    this.group.add(this.instancedMesh);
  }

  public dispose(): void {
    this.instancedMesh?.dispose();
    this.geometry?.dispose();
    this.material?.dispose();
  }
}

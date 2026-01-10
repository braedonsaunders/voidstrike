import * as THREE from 'three';
import { BiomeConfig } from './Biomes';
import { MapData } from '@/data/maps';
import AssetManager from '@/assets/AssetManager';

/**
 * PERFORMANCE: Instanced rendering for decorations
 *
 * Instead of creating individual meshes (1000+ draw calls),
 * we use InstancedMesh to render all similar objects in a single draw call.
 * This can improve performance by 10-100x for decoration rendering.
 *
 * When custom GLB models are available, we use individual meshes placed at
 * each position. When not available, we fall back to instanced procedural meshes.
 */

/**
 * Extract geometry from a loaded model for instancing
 */
function extractGeometry(object: THREE.Object3D): THREE.BufferGeometry | null {
  let geometry: THREE.BufferGeometry | null = null;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry && !geometry) {
      geometry = child.geometry.clone();
    }
  });
  return geometry;
}

/**
 * Extract material from a loaded model
 */
function extractMaterial(object: THREE.Object3D): THREE.Material | null {
  let material: THREE.Material | null = null;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material && !material) {
      if (Array.isArray(child.material)) {
        material = child.material[0];
      } else {
        material = child.material;
      }
    }
  });
  return material;
}

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
  private meshes: THREE.Object3D[] = [];

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    if (biome.treeDensity <= 0) return;

    // Tree count - focus on map edges, not cliff edges
    const treeCount = Math.floor(mapData.width * mapData.height * biome.treeDensity * 0.01);
    const maxTrees = Math.min(treeCount, 400);

    // Get tree model types based on biome
    const treeModelIds = this.getTreeModelsForBiome(biome);

    // Build a set of cells near ramps that should be avoided (pathways)
    const rampClearance = new Set<string>();
    const RAMP_CLEARANCE_RADIUS = 8; // Stay far from ramps

    for (let cy = 0; cy < mapData.height; cy++) {
      for (let cx = 0; cx < mapData.width; cx++) {
        const cell = mapData.terrain[cy][cx];
        if (cell.terrain === 'ramp') {
          // Mark all cells within clearance radius as blocked
          for (let dy = -RAMP_CLEARANCE_RADIUS; dy <= RAMP_CLEARANCE_RADIUS; dy++) {
            for (let dx = -RAMP_CLEARANCE_RADIUS; dx <= RAMP_CLEARANCE_RADIUS; dx++) {
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist <= RAMP_CLEARANCE_RADIUS) {
                rampClearance.add(`${cx + dx},${cy + dy}`);
              }
            }
          }
        }
      }
    }

    // Find elevated cliff edges (for placing some trees on base edges)
    const cliffEdgePositions: Array<{ x: number; y: number }> = [];
    for (let cy = 1; cy < mapData.height - 1; cy++) {
      for (let cx = 1; cx < mapData.width - 1; cx++) {
        // Skip if in ramp clearance zone
        if (rampClearance.has(`${cx},${cy}`)) continue;

        const cell = mapData.terrain[cy][cx];
        if (cell.terrain === 'unbuildable') {
          // Check if this is near a cliff edge (adjacent to ground)
          const neighbors = [
            mapData.terrain[cy - 1]?.[cx],
            mapData.terrain[cy + 1]?.[cx],
            mapData.terrain[cy]?.[cx - 1],
            mapData.terrain[cy]?.[cx + 1],
          ];
          const nearGround = neighbors.some(n => n && n.terrain === 'ground');
          if (nearGround) {
            cliffEdgePositions.push({ x: cx + Math.random() * 0.5, y: cy + Math.random() * 0.5 });
          }
        }
      }
    }

    let treesPlaced = 0;

    // Place some trees on cliff edges (20%) - gives bases some tree cover
    const cliffTreeCount = Math.min(Math.floor(maxTrees * 0.2), cliffEdgePositions.length);
    for (let i = 0; i < cliffTreeCount && treesPlaced < cliffTreeCount; i++) {
      const idx = Math.floor(Math.random() * cliffEdgePositions.length);
      const pos = cliffEdgePositions.splice(idx, 1)[0];
      if (this.placeTree(pos.x, pos.y, mapData, getHeightAt, treeModelIds, biome)) {
        treesPlaced++;
      }
    }

    // Place trees on the outer edges of the map (50%)
    const edgeTreeCount = Math.floor(maxTrees * 0.5);
    for (let i = 0; i < edgeTreeCount * 3 && treesPlaced < edgeTreeCount + cliffTreeCount; i++) {
      let x: number, y: number;
      const edge = Math.floor(Math.random() * 4);
      // Place in outer 12 cells of each edge
      switch (edge) {
        case 0: x = 2 + Math.random() * 10; y = 5 + Math.random() * (mapData.height - 10); break;
        case 1: x = mapData.width - 12 + Math.random() * 10; y = 5 + Math.random() * (mapData.height - 10); break;
        case 2: x = 5 + Math.random() * (mapData.width - 10); y = 2 + Math.random() * 10; break;
        default: x = 5 + Math.random() * (mapData.width - 10); y = mapData.height - 12 + Math.random() * 10; break;
      }

      // Check clearance
      if (rampClearance.has(`${Math.floor(x)},${Math.floor(y)}`)) continue;

      if (this.placeTree(x, y, mapData, getHeightAt, treeModelIds, biome)) {
        treesPlaced++;
      }
    }

    // Scatter remaining trees in corners (30%)
    for (let i = 0; i < maxTrees * 2 && treesPlaced < maxTrees; i++) {
      // Pick a corner
      const corner = Math.floor(Math.random() * 4);
      let x: number, y: number;
      switch (corner) {
        case 0: x = 3 + Math.random() * 18; y = 3 + Math.random() * 18; break;
        case 1: x = mapData.width - 21 + Math.random() * 18; y = 3 + Math.random() * 18; break;
        case 2: x = 3 + Math.random() * 18; y = mapData.height - 21 + Math.random() * 18; break;
        default: x = mapData.width - 21 + Math.random() * 18; y = mapData.height - 21 + Math.random() * 18; break;
      }

      // Check clearance
      if (rampClearance.has(`${Math.floor(x)},${Math.floor(y)}`)) continue;

      if (this.placeTree(x, y, mapData, getHeightAt, treeModelIds, biome)) {
        treesPlaced++;
      }
    }
  }

  private getTreeModelsForBiome(biome: BiomeConfig): string[] {
    switch (biome.name) {
      case 'Frozen Wastes': return ['tree_dead', 'tree_pine_tall'];
      case 'Desert': return ['tree_dead', 'tree_palm'];
      case 'Volcanic': return ['tree_dead'];
      case 'Void': return ['tree_alien', 'tree_mushroom'];
      case 'Jungle': return ['tree_palm', 'tree_pine_medium', 'tree_mushroom'];
      default: return ['tree_pine_tall', 'tree_pine_medium'];
    }
  }

  private placeTree(
    x: number,
    y: number,
    mapData: MapData,
    getHeightAt: (x: number, y: number) => number,
    treeModelIds: string[],
    biome: BiomeConfig
  ): boolean {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    if (cellX < 0 || cellX >= mapData.width || cellY < 0 || cellY >= mapData.height) {
      return false;
    }

    const cell = mapData.terrain[cellY][cellX];
    // Don't place trees on ramps (keep pathways clear)
    if (cell.terrain === 'ramp') {
      return false;
    }

    const height = getHeightAt(x, y);
    const modelId = treeModelIds[Math.floor(Math.random() * treeModelIds.length)];
    const treeMesh = AssetManager.getDecorationMesh(modelId);

    if (treeMesh) {
      const scale = 0.8 + Math.random() * 0.5;
      treeMesh.position.set(x, height, y);
      treeMesh.rotation.y = Math.random() * Math.PI * 2;
      treeMesh.scale.setScalar(scale);

      this.group.add(treeMesh);
      this.meshes.push(treeMesh);
      return true;
    }

    return false;
  }

  public dispose(): void {
    for (const mesh of this.meshes) {
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }
    this.meshes = [];
  }
}

/**
 * Rock rendering using GLB models with variety
 * Uses individual meshes for different rock types instead of instancing
 */
export class InstancedRocks {
  public group: THREE.Group;
  private meshes: THREE.Object3D[] = [];

  // Store rock positions for collision detection (x, z are world coords, radius is collision size)
  private rockCollisions: Array<{ x: number; z: number; radius: number }> = [];

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    // Rock count
    const rockCount = Math.floor(mapData.width * mapData.height * biome.rockDensity * 0.012);
    const maxRocks = Math.min(rockCount, 300);

    // Rock model types to use for variety
    const rockModelIds = ['rocks_large', 'rocks_small', 'rock_single'];

    // Build ramp clearance set to avoid blocking pathways
    const rampClearance = new Set<string>();
    const RAMP_CLEARANCE_RADIUS = 6;

    for (let cy = 0; cy < mapData.height; cy++) {
      for (let cx = 0; cx < mapData.width; cx++) {
        const cell = mapData.terrain[cy][cx];
        if (cell.terrain === 'ramp') {
          for (let dy = -RAMP_CLEARANCE_RADIUS; dy <= RAMP_CLEARANCE_RADIUS; dy++) {
            for (let dx = -RAMP_CLEARANCE_RADIUS; dx <= RAMP_CLEARANCE_RADIUS; dx++) {
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist <= RAMP_CLEARANCE_RADIUS) {
                rampClearance.add(`${cx + dx},${cy + dy}`);
              }
            }
          }
        }
      }
    }

    let rocksPlaced = 0;
    for (let i = 0; i < maxRocks * 3 && rocksPlaced < maxRocks; i++) {
      let x: number, y: number;

      // Place rocks primarily on map edges (60%) and scattered (40%)
      if (Math.random() < 0.6) {
        // Edge placement - outer 10 cells
        const edge = Math.floor(Math.random() * 4);
        switch (edge) {
          case 0: x = 3 + Math.random() * 10; y = 8 + Math.random() * (mapData.height - 16); break;
          case 1: x = mapData.width - 13 + Math.random() * 10; y = 8 + Math.random() * (mapData.height - 16); break;
          case 2: x = 8 + Math.random() * (mapData.width - 16); y = 3 + Math.random() * 10; break;
          default: x = 8 + Math.random() * (mapData.width - 16); y = mapData.height - 13 + Math.random() * 10; break;
        }
      } else {
        // Random scattered placement - avoid center
        x = 10 + Math.random() * (mapData.width - 20);
        y = 10 + Math.random() * (mapData.height - 20);
      }

      const cellX = Math.floor(x);
      const cellY = Math.floor(y);

      // Skip if in ramp clearance zone
      if (rampClearance.has(`${cellX},${cellY}`)) continue;

      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        // Only place on ground or unbuildable, NOT on cliff edges near ramps
        if (cell.terrain === 'ground' || cell.terrain === 'unbuildable') {
          const height = getHeightAt(x, y);

          // Choose random rock model type
          const modelId = rockModelIds[Math.floor(Math.random() * rockModelIds.length)];
          const rockMesh = AssetManager.getDecorationMesh(modelId);

          if (rockMesh) {
            // Random scale variation
            const baseScale = modelId === 'rocks_large' ? 1.0 : (modelId === 'rocks_small' ? 0.8 : 0.6);
            const scale = baseScale * (0.7 + Math.random() * 0.6);

            rockMesh.position.set(x, height, y);
            rockMesh.rotation.y = Math.random() * Math.PI * 2;
            rockMesh.scale.setScalar(scale);

            this.group.add(rockMesh);
            this.meshes.push(rockMesh);

            // Store collision data
            const collisionRadius = scale * 2.0;
            this.rockCollisions.push({ x, z: y, radius: collisionRadius });
            rocksPlaced++;
          }
        }
      }
    }
  }

  public dispose(): void {
    for (const mesh of this.meshes) {
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }
    this.meshes = [];
  }

  /**
   * Get rock collision data for building placement validation
   * Returns array of { x, z, radius } for each rock
   */
  public getRockCollisions(): Array<{ x: number; z: number; radius: number }> {
    return this.rockCollisions;
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

import * as THREE from 'three';
import { BiomeConfig } from './Biomes';
import { MapData } from '@/data/maps';
import AssetManager from '@/assets/AssetManager';

// PERF: Reusable Euler object for instanced decoration loops (avoids thousands of allocations)
const _tempEuler = new THREE.Euler();

// PERF: Shared frustum and distance culling utilities for all decoration classes
const _frustum = new THREE.Frustum();
const _frustumMatrix = new THREE.Matrix4();
const _tempVec3 = new THREE.Vector3();

// Camera position for distance culling - stored on frustum update
let _cameraX = 0;
let _cameraY = 0;
let _cameraZ = 0;
let _maxDistanceSq = 10000; // Squared distance for faster comparison

// Distance culling multiplier - decorations beyond (camera height * multiplier) are culled
// Lower = more aggressive culling = better performance, but decorations disappear sooner
const DISTANCE_CULL_MULTIPLIER = 1.2;

/**
 * Update the shared frustum from camera matrices.
 * Also stores camera position for distance-based culling.
 * Call once per frame before updating all decoration classes.
 */
export function updateDecorationFrustum(camera: THREE.Camera): void {
  camera.updateMatrixWorld();
  _frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_frustumMatrix);

  // Store camera position for distance culling
  _cameraX = camera.position.x;
  _cameraY = camera.position.y;
  _cameraZ = camera.position.z;

  // Calculate max distance based on camera height
  // Higher camera = see more = larger distance threshold
  // Using height * multiplier ensures close-up views still show decorations
  const maxDist = Math.max(40, _cameraY * DISTANCE_CULL_MULTIPLIER);
  _maxDistanceSq = maxDist * maxDist;
}

/**
 * Check if a point is within the frustum AND within distance range.
 * Distance check is faster (squared comparison) and runs first.
 */
function isInFrustum(x: number, y: number, z: number, margin: number = 2): boolean {
  // PERF: Distance check first (faster) - cull decorations far from camera
  const dx = x - _cameraX;
  const dz = z - _cameraZ;
  const distSq = dx * dx + dz * dz;
  if (distSq > _maxDistanceSq) {
    return false;
  }

  // Then frustum check (more expensive)
  _tempVec3.set(x, y, z);
  return _frustum.containsPoint(_tempVec3);
}

/**
 * Build a set of cells that should be cleared near ramps.
 * Uses circular clearance around ramp cells PLUS extended clearance
 * in the direction of ramp entry/exit to keep pathways clear.
 */
function buildRampClearanceSet(mapData: MapData): Set<string> {
  const clearance = new Set<string>();
  const RAMP_CLEARANCE_RADIUS = 10;
  const RAMP_EXIT_EXTENSION = 18; // Extra clearance in exit direction

  // First pass: circular clearance around all ramp cells
  for (let cy = 0; cy < mapData.height; cy++) {
    for (let cx = 0; cx < mapData.width; cx++) {
      const cell = mapData.terrain[cy][cx];
      if (cell.terrain === 'ramp') {
        for (let dy = -RAMP_CLEARANCE_RADIUS; dy <= RAMP_CLEARANCE_RADIUS; dy++) {
          for (let dx = -RAMP_CLEARANCE_RADIUS; dx <= RAMP_CLEARANCE_RADIUS; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= RAMP_CLEARANCE_RADIUS) {
              clearance.add(`${cx + dx},${cy + dy}`);
            }
          }
        }
      }
    }
  }

  // Second pass: extended clearance at ramp entry/exit based on ramp direction
  for (const ramp of mapData.ramps) {
    // Calculate ramp center
    const rampCenterX = ramp.x + ramp.width / 2;
    const rampCenterY = ramp.y + ramp.height / 2;

    // Determine exit direction vectors based on ramp direction
    let exitDx = 0, exitDy = 0;
    let perpDx = 0, perpDy = 0; // Perpendicular for width
    let exitStartX = rampCenterX, exitStartY = rampCenterY;
    let entryStartX = rampCenterX, entryStartY = rampCenterY;

    switch (ramp.direction) {
      case 'north':
        exitDy = -1; perpDx = 1;
        exitStartY = ramp.y; // Top of ramp
        entryStartY = ramp.y + ramp.height; // Bottom of ramp
        break;
      case 'south':
        exitDy = 1; perpDx = 1;
        exitStartY = ramp.y + ramp.height;
        entryStartY = ramp.y;
        break;
      case 'east':
        exitDx = 1; perpDy = 1;
        exitStartX = ramp.x + ramp.width;
        entryStartX = ramp.x;
        break;
      case 'west':
        exitDx = -1; perpDy = 1;
        exitStartX = ramp.x;
        entryStartX = ramp.x + ramp.width;
        break;
    }

    // Add extended clearance in exit direction (where units walk)
    const halfWidth = Math.max(ramp.width, ramp.height) / 2 + 4;
    for (let d = 0; d < RAMP_EXIT_EXTENSION; d++) {
      const cx = Math.floor(exitStartX + exitDx * d);
      const cy = Math.floor(exitStartY + exitDy * d);
      // Add width perpendicular to exit direction
      for (let w = -halfWidth; w <= halfWidth; w++) {
        clearance.add(`${cx + perpDx * w},${cy + perpDy * w}`);
      }
    }

    // Add extended clearance in entry direction too
    for (let d = 0; d < RAMP_EXIT_EXTENSION; d++) {
      const cx = Math.floor(entryStartX - exitDx * d);
      const cy = Math.floor(entryStartY - exitDy * d);
      for (let w = -halfWidth; w <= halfWidth; w++) {
        clearance.add(`${cx + perpDx * w},${cy + perpDy * w}`);
      }
    }
  }

  return clearance;
}

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
 * Applies rendering hints from assets.json if available
 * @param assetId - Asset ID to look up rendering hints
 */
function extractMaterial(object: THREE.Object3D, assetId?: string): THREE.Material | null {
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

  // Type guard for MeshStandardMaterial
  if (material && (material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    const stdMaterial = material as THREE.MeshStandardMaterial;
    // Check for rendering hints from assets.json
    const hints = assetId ? AssetManager.getRenderingHints(assetId) : null;

    if (hints) {
      // Apply envMapIntensity from hints (default was 0 for performance)
      stdMaterial.envMapIntensity = hints.envMapIntensity ?? 0;

      // Apply emissive properties
      if (hints.emissive) {
        stdMaterial.emissive = new THREE.Color(hints.emissive);
        stdMaterial.emissiveIntensity = hints.emissiveIntensity ?? 1.0;
      }

      // Apply roughness/metalness overrides
      if (hints.roughnessOverride !== null && hints.roughnessOverride !== undefined) {
        stdMaterial.roughness = hints.roughnessOverride;
      }
      if (hints.metalnessOverride !== null && hints.metalnessOverride !== undefined) {
        stdMaterial.metalness = hints.metalnessOverride;
      }

      // Apply exposure (brightness multiplier)
      // For exposure > 1: Add emissive contribution to brighten
      // For exposure < 1: Darken the base color
      const exposure = hints.exposure ?? 1.0;
      if (exposure !== 1.0) {
        if (exposure > 1.0) {
          // Brighten: add emissive contribution based on base color
          const baseColor = stdMaterial.color.clone();
          // If already has emissive, blend with it; otherwise set new emissive
          if (!hints.emissive) {
            stdMaterial.emissive = baseColor;
            stdMaterial.emissiveIntensity = exposure - 1.0;
          } else {
            // Already has emissive, boost its intensity
            stdMaterial.emissiveIntensity = (hints.emissiveIntensity ?? 1.0) * exposure;
          }
        } else {
          // Darken: multiply base color by exposure factor
          stdMaterial.color.multiplyScalar(exposure);
        }
      }
    } else {
      // Default: disable IBL on decoration materials for performance
      stdMaterial.envMapIntensity = 0;
    }
  }

  return material;
}

interface InstancedGroupConfig {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  maxCount: number;
}

// Instance data for frustum culling
interface InstanceData {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  yOffset: number;
}

// Mesh with associated instance data for frustum culling
interface CullableInstancedMesh {
  mesh: THREE.InstancedMesh;
  instances: InstanceData[];
  maxCount: number;
}

/**
 * PERFORMANCE: True instanced tree rendering - all trees of same type in ONE draw call
 * Previously each tree was a separate mesh causing 400+ draw calls.
 * Now we batch by model type for typically 2-6 draw calls total.
 *
 * Shadow optimization: Trees in playable area cast shadows, border trees don't.
 * Frustum culling: Only visible instances are rendered each frame.
 */
export class InstancedTrees {
  public group: THREE.Group;
  private instancedMeshes: CullableInstancedMesh[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  // Store tree positions for collision detection (x, z are world coords, radius is collision size)
  private treeCollisions: Array<{ x: number; z: number; radius: number }> = [];

  // Reusable objects for update loop
  private _tempMatrix = new THREE.Matrix4();
  private _tempPosition = new THREE.Vector3();
  private _tempQuaternion = new THREE.Quaternion();
  private _tempScale = new THREE.Vector3();

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    // Skip procedural generation for custom/editor maps
    if (mapData.skipProceduralDecorations) return;
    if (biome.treeDensity <= 0) return;

    // Tree count - focus on map edges, not cliff edges
    const treeCount = Math.floor(mapData.width * mapData.height * biome.treeDensity * 0.01);
    const maxTrees = Math.min(treeCount, 400);

    // Get tree model types based on biome
    const treeModelIds = this.getTreeModelsForBiome(biome);

    // Build ramp clearance set to avoid blocking pathways (uses extended directional clearance)
    const rampClearance = buildRampClearanceSet(mapData);

    // PERF: Separate trees into playable (cast shadows) vs border (no shadows)
    type TreePos = { x: number; y: number; height: number; scale: number; rotation: number };
    const playableTreesByModel = new Map<string, TreePos[]>();
    const borderTreesByModel = new Map<string, TreePos[]>();
    for (const modelId of treeModelIds) {
      playableTreesByModel.set(modelId, []);
      borderTreesByModel.set(modelId, []);
    }

    // Border zone is outer 15 cells of map
    const BORDER_MARGIN = 15;
    const isInBorder = (x: number, y: number) =>
      x < BORDER_MARGIN || x > mapData.width - BORDER_MARGIN ||
      y < BORDER_MARGIN || y > mapData.height - BORDER_MARGIN;

    // Find elevated cliff edges (for placing some trees on base edges)
    const cliffEdgePositions: Array<{ x: number; y: number }> = [];
    for (let cy = 1; cy < mapData.height - 1; cy++) {
      for (let cx = 1; cx < mapData.width - 1; cx++) {
        if (rampClearance.has(`${cx},${cy}`)) continue;
        const cell = mapData.terrain[cy][cx];
        if (cell.terrain === 'unbuildable') {
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

    // Helper to collect a tree position - adds to correct bucket based on position
    const collectTree = (x: number, y: number): boolean => {
      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX < 0 || cellX >= mapData.width || cellY < 0 || cellY >= mapData.height) return false;

      const cell = mapData.terrain[cellY][cellX];
      if (cell.terrain === 'ramp') return false;

      const modelId = treeModelIds[Math.floor(Math.random() * treeModelIds.length)];
      if (!AssetManager.hasDecorationModel(modelId)) return false;

      const height = getHeightAt(x, y);
      const scale = 0.8 + Math.random() * 0.5;
      const rotation = Math.random() * Math.PI * 2;

      const treePos = { x, y, height, scale, rotation };
      // Trees in border don't cast shadows, playable area trees do
      if (isInBorder(x, y)) {
        borderTreesByModel.get(modelId)!.push(treePos);
      } else {
        playableTreesByModel.get(modelId)!.push(treePos);
      }

      // Store collision data for pathfinding - trees have a trunk collision radius
      // Scale affects collision size: base radius of 0.8 units scaled by tree scale
      const collisionRadius = scale * 0.8;
      this.treeCollisions.push({ x, z: y, radius: collisionRadius });

      return true;
    };

    // Cliff edges (20%) - these are near bases, so important for shadows
    const cliffTreeCount = Math.min(Math.floor(maxTrees * 0.2), cliffEdgePositions.length);
    for (let i = 0; i < cliffTreeCount && treesPlaced < cliffTreeCount; i++) {
      const idx = Math.floor(Math.random() * cliffEdgePositions.length);
      const pos = cliffEdgePositions.splice(idx, 1)[0];
      if (collectTree(pos.x, pos.y)) treesPlaced++;
    }

    // Map edges (50%) - mostly border decorations
    const edgeTreeCount = Math.floor(maxTrees * 0.5);
    for (let i = 0; i < edgeTreeCount * 3 && treesPlaced < edgeTreeCount + cliffTreeCount; i++) {
      let x: number, y: number;
      const edge = Math.floor(Math.random() * 4);
      switch (edge) {
        case 0: x = 2 + Math.random() * 10; y = 5 + Math.random() * (mapData.height - 10); break;
        case 1: x = mapData.width - 12 + Math.random() * 10; y = 5 + Math.random() * (mapData.height - 10); break;
        case 2: x = 5 + Math.random() * (mapData.width - 10); y = 2 + Math.random() * 10; break;
        default: x = 5 + Math.random() * (mapData.width - 10); y = mapData.height - 12 + Math.random() * 10; break;
      }
      if (rampClearance.has(`${Math.floor(x)},${Math.floor(y)}`)) continue;
      if (collectTree(x, y)) treesPlaced++;
    }

    // Corners (30%) - border decorations
    for (let i = 0; i < maxTrees * 2 && treesPlaced < maxTrees; i++) {
      const corner = Math.floor(Math.random() * 4);
      let x: number, y: number;
      switch (corner) {
        case 0: x = 3 + Math.random() * 18; y = 3 + Math.random() * 18; break;
        case 1: x = mapData.width - 21 + Math.random() * 18; y = 3 + Math.random() * 18; break;
        case 2: x = 3 + Math.random() * 18; y = mapData.height - 21 + Math.random() * 18; break;
        default: x = mapData.width - 21 + Math.random() * 18; y = mapData.height - 21 + Math.random() * 18; break;
      }
      if (rampClearance.has(`${Math.floor(x)},${Math.floor(y)}`)) continue;
      if (collectTree(x, y)) treesPlaced++;
    }

    // Helper to create instanced mesh from positions with frustum culling support
    const createInstancedMesh = (
      modelId: string,
      positions: TreePos[],
      castShadow: boolean
    ) => {
      if (positions.length === 0) return;

      const original = AssetManager.getDecorationOriginal(modelId);
      if (!original) return;

      const geometry = extractGeometry(original);
      const material = extractMaterial(original, modelId);
      if (!geometry || !material) return;

      const instancedGeometry = geometry.clone();
      const instancedMaterial = material.clone();
      // Rendering hints (envMapIntensity, emissive, etc.) are applied in extractMaterial
      this.geometries.push(instancedGeometry);
      this.materials.push(instancedMaterial);

      const yOffset = AssetManager.getModelYOffset(modelId);

      const instancedMesh = new THREE.InstancedMesh(
        instancedGeometry,
        instancedMaterial,
        positions.length
      );

      // Store instance data for frustum culling
      const instances: InstanceData[] = positions.map(p => ({
        x: p.x,
        y: p.height + yOffset * p.scale,
        z: p.y, // Note: y in TreePos is z in world space
        scale: p.scale,
        rotation: p.rotation,
        yOffset,
      }));

      // Initialize with all instances visible (first frame)
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();

      for (let i = 0; i < positions.length; i++) {
        const inst = instances[i];
        position.set(inst.x, inst.y, inst.z);
        _tempEuler.set(0, inst.rotation, 0);
        quaternion.setFromEuler(_tempEuler);
        scale.set(inst.scale, inst.scale, inst.scale);
        matrix.compose(position, quaternion, scale);
        instancedMesh.setMatrixAt(i, matrix);
      }

      instancedMesh.instanceMatrix.needsUpdate = true;
      instancedMesh.frustumCulled = false; // We handle culling manually per-instance
      instancedMesh.castShadow = castShadow;
      instancedMesh.receiveShadow = true;

      this.instancedMeshes.push({
        mesh: instancedMesh,
        instances,
        maxCount: positions.length,
      });
      this.group.add(instancedMesh);
    };

    // Create instanced meshes - playable area trees cast shadows, border trees don't
    for (const modelId of treeModelIds) {
      createInstancedMesh(modelId, playableTreesByModel.get(modelId)!, true);  // Cast shadows
      createInstancedMesh(modelId, borderTreesByModel.get(modelId)!, false);   // No shadows
    }
  }

  /**
   * Update visible instances based on camera frustum.
   * Call this every frame after updateDecorationFrustum().
   */
  public update(): void {
    let totalVisible = 0;
    let totalInstances = 0;

    for (const { mesh, instances, maxCount } of this.instancedMeshes) {
      let visibleCount = 0;
      totalInstances += maxCount;

      for (let i = 0; i < maxCount; i++) {
        const inst = instances[i];

        // PERF: Skip instances outside camera frustum
        if (!isInFrustum(inst.x, inst.y, inst.z)) {
          continue;
        }

        // Set matrix for this visible instance
        this._tempPosition.set(inst.x, inst.y, inst.z);
        _tempEuler.set(0, inst.rotation, 0);
        this._tempQuaternion.setFromEuler(_tempEuler);
        this._tempScale.set(inst.scale, inst.scale, inst.scale);
        this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
        mesh.setMatrixAt(visibleCount, this._tempMatrix);

        visibleCount++;
      }

      mesh.count = visibleCount;
      mesh.instanceMatrix.needsUpdate = true;
      totalVisible += visibleCount;
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

  public dispose(): void {
    for (const { mesh } of this.instancedMeshes) {
      mesh.dispose();
    }
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    this.instancedMeshes = [];
    this.geometries = [];
    this.materials = [];
  }

  /**
   * Get tree collision data for building placement validation and pathfinding
   * Returns array of { x, z, radius } for each tree
   */
  public getTreeCollisions(): Array<{ x: number; z: number; radius: number }> {
    return this.treeCollisions;
  }
}

/**
 * PERFORMANCE: True instanced rock rendering - all rocks of same type in ONE draw call
 * Previously each rock was a separate mesh causing 300+ draw calls.
 * Now we batch by model type for typically 3 draw calls total.
 *
 * Shadow optimization: Rocks in playable area cast shadows, border rocks don't.
 * Frustum culling: Only visible instances are rendered each frame.
 */
export class InstancedRocks {
  public group: THREE.Group;
  private instancedMeshes: CullableInstancedMesh[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  // Store rock positions for collision detection (x, z are world coords, radius is collision size)
  private rockCollisions: Array<{ x: number; z: number; radius: number }> = [];

  // Reusable objects for update loop
  private _tempMatrix = new THREE.Matrix4();
  private _tempPosition = new THREE.Vector3();
  private _tempQuaternion = new THREE.Quaternion();
  private _tempScale = new THREE.Vector3();

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    // Skip procedural generation for custom/editor maps
    if (mapData.skipProceduralDecorations) return;

    // Rock count
    const rockCount = Math.floor(mapData.width * mapData.height * biome.rockDensity * 0.012);
    const maxRocks = Math.min(rockCount, 300);

    // Rock model types to use for variety
    const rockModelIds = ['rocks_large', 'rocks_small', 'rock_single'];

    // Build ramp clearance set to avoid blocking pathways (uses extended directional clearance)
    const rampClearance = buildRampClearanceSet(mapData);

    // PERF: Separate rocks into playable (cast shadows) vs border (no shadows)
    type RockPos = { x: number; y: number; height: number; scale: number; rotation: number };
    const playableRocksByModel = new Map<string, RockPos[]>();
    const borderRocksByModel = new Map<string, RockPos[]>();
    for (const modelId of rockModelIds) {
      playableRocksByModel.set(modelId, []);
      borderRocksByModel.set(modelId, []);
    }

    // Border zone is outer 15 cells of map
    const BORDER_MARGIN = 15;
    const isInBorder = (x: number, y: number) =>
      x < BORDER_MARGIN || x > mapData.width - BORDER_MARGIN ||
      y < BORDER_MARGIN || y > mapData.height - BORDER_MARGIN;

    let rocksPlaced = 0;
    for (let i = 0; i < maxRocks * 3 && rocksPlaced < maxRocks; i++) {
      let x: number, y: number;

      // Place rocks primarily on map edges (60%) and scattered (40%)
      if (Math.random() < 0.6) {
        const edge = Math.floor(Math.random() * 4);
        switch (edge) {
          case 0: x = 3 + Math.random() * 10; y = 8 + Math.random() * (mapData.height - 16); break;
          case 1: x = mapData.width - 13 + Math.random() * 10; y = 8 + Math.random() * (mapData.height - 16); break;
          case 2: x = 8 + Math.random() * (mapData.width - 16); y = 3 + Math.random() * 10; break;
          default: x = 8 + Math.random() * (mapData.width - 16); y = mapData.height - 13 + Math.random() * 10; break;
        }
      } else {
        x = 10 + Math.random() * (mapData.width - 20);
        y = 10 + Math.random() * (mapData.height - 20);
      }

      const cellX = Math.floor(x);
      const cellY = Math.floor(y);

      if (rampClearance.has(`${cellX},${cellY}`)) continue;

      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        if (cell.terrain === 'ground' || cell.terrain === 'unbuildable') {
          const modelId = rockModelIds[Math.floor(Math.random() * rockModelIds.length)];
          if (!AssetManager.hasDecorationModel(modelId)) continue;

          const height = getHeightAt(x, y);
          const baseScale = modelId === 'rocks_large' ? 1.0 : (modelId === 'rocks_small' ? 0.8 : 0.6);
          const scale = baseScale * (0.7 + Math.random() * 0.6);
          const rotation = Math.random() * Math.PI * 2;

          const rockPos = { x, y, height, scale, rotation };
          // Rocks in border don't cast shadows, playable area rocks do
          if (isInBorder(x, y)) {
            borderRocksByModel.get(modelId)!.push(rockPos);
          } else {
            playableRocksByModel.get(modelId)!.push(rockPos);
          }

          // Store collision data
          const collisionRadius = scale * 2.0;
          this.rockCollisions.push({ x, z: y, radius: collisionRadius });
          rocksPlaced++;
        }
      }
    }

    // Helper to create instanced mesh from positions with frustum culling support
    const createInstancedMesh = (
      modelId: string,
      positions: RockPos[],
      castShadow: boolean
    ) => {
      if (positions.length === 0) return;

      const original = AssetManager.getDecorationOriginal(modelId);
      if (!original) return;

      const geometry = extractGeometry(original);
      const material = extractMaterial(original, modelId);
      if (!geometry || !material) return;

      const instancedGeometry = geometry.clone();
      const instancedMaterial = material.clone();
      // Rendering hints (envMapIntensity, emissive, etc.) are applied in extractMaterial
      this.geometries.push(instancedGeometry);
      this.materials.push(instancedMaterial);

      const yOffset = AssetManager.getModelYOffset(modelId);

      const instancedMesh = new THREE.InstancedMesh(
        instancedGeometry,
        instancedMaterial,
        positions.length
      );

      // Store instance data for frustum culling
      const instances: InstanceData[] = positions.map(p => ({
        x: p.x,
        y: p.height + yOffset * p.scale,
        z: p.y, // Note: y in RockPos is z in world space
        scale: p.scale,
        rotation: p.rotation,
        yOffset,
      }));

      // Initialize with all instances visible (first frame)
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();

      for (let i = 0; i < positions.length; i++) {
        const inst = instances[i];
        position.set(inst.x, inst.y, inst.z);
        _tempEuler.set(0, inst.rotation, 0);
        quaternion.setFromEuler(_tempEuler);
        scale.set(inst.scale, inst.scale, inst.scale);
        matrix.compose(position, quaternion, scale);
        instancedMesh.setMatrixAt(i, matrix);
      }

      instancedMesh.instanceMatrix.needsUpdate = true;
      instancedMesh.frustumCulled = false; // We handle culling manually per-instance
      instancedMesh.castShadow = castShadow;
      instancedMesh.receiveShadow = true;

      this.instancedMeshes.push({
        mesh: instancedMesh,
        instances,
        maxCount: positions.length,
      });
      this.group.add(instancedMesh);
    };

    // Create instanced meshes - playable area rocks cast shadows, border rocks don't
    for (const modelId of rockModelIds) {
      createInstancedMesh(modelId, playableRocksByModel.get(modelId)!, true);  // Cast shadows
      createInstancedMesh(modelId, borderRocksByModel.get(modelId)!, false);   // No shadows
    }
  }

  /**
   * Update visible instances based on camera frustum.
   * Call this every frame after updateDecorationFrustum().
   */
  public update(): void {
    let totalVisible = 0;
    let totalInstances = 0;

    for (const { mesh, instances, maxCount } of this.instancedMeshes) {
      let visibleCount = 0;
      totalInstances += maxCount;

      for (let i = 0; i < maxCount; i++) {
        const inst = instances[i];

        // PERF: Skip instances outside camera frustum
        if (!isInFrustum(inst.x, inst.y, inst.z)) {
          continue;
        }

        // Set matrix for this visible instance
        this._tempPosition.set(inst.x, inst.y, inst.z);
        _tempEuler.set(0, inst.rotation, 0);
        this._tempQuaternion.setFromEuler(_tempEuler);
        this._tempScale.set(inst.scale, inst.scale, inst.scale);
        this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
        mesh.setMatrixAt(visibleCount, this._tempMatrix);

        visibleCount++;
      }

      mesh.count = visibleCount;
      mesh.instanceMatrix.needsUpdate = true;
      totalVisible += visibleCount;
    }
  }

  public dispose(): void {
    for (const { mesh } of this.instancedMeshes) {
      mesh.dispose();
    }
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    this.instancedMeshes = [];
    this.geometries = [];
    this.materials = [];
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
 * Frustum culling: Only visible instances are rendered each frame.
 */
export class InstancedGrass {
  public group: THREE.Group;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.Material | null = null;

  // Instance data for frustum culling
  private instances: Array<{ x: number; y: number; z: number; scale: number; rotation: number }> = [];
  private maxCount = 0;

  // Reusable objects for update loop
  private _tempMatrix = new THREE.Matrix4();
  private _tempPosition = new THREE.Vector3();
  private _tempQuaternion = new THREE.Quaternion();
  private _tempScale = new THREE.Vector3();

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
    for (let i = 0; i < grassCount; i++) {
      const x = 5 + Math.random() * (mapData.width - 10);
      const z = 5 + Math.random() * (mapData.height - 10);

      const cellX = Math.floor(x);
      const cellZ = Math.floor(z);
      if (cellX >= 0 && cellX < mapData.width && cellZ >= 0 && cellZ < mapData.height) {
        const cell = mapData.terrain[cellZ][cellX];
        if (cell.terrain === 'ground') {
          const height = getHeightAt(x, z);
          const scale = 0.1 + Math.random() * 0.15;
          this.instances.push({
            x,
            y: height + 0.1 + scale * 2, // Include vertical offset in stored position
            z,
            scale,
            rotation: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    if (this.instances.length === 0) return;
    this.maxCount = this.instances.length;

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
      this.maxCount
    );

    // Initialize with all instances visible (first frame)
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < this.maxCount; i++) {
      const inst = this.instances[i];
      position.set(inst.x, inst.y, inst.z);
      _tempEuler.set(0, inst.rotation, 0);
      quaternion.setFromEuler(_tempEuler);
      scale.set(inst.scale, inst.scale, inst.scale);
      matrix.compose(position, quaternion, scale);
      this.instancedMesh.setMatrixAt(i, matrix);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.frustumCulled = false; // We handle culling manually per-instance

    this.group.add(this.instancedMesh);
  }

  /**
   * Update visible instances based on camera frustum.
   * Call this every frame after updateDecorationFrustum().
   */
  public update(): void {
    if (!this.instancedMesh || this.maxCount === 0) return;

    let visibleCount = 0;

    for (let i = 0; i < this.maxCount; i++) {
      const inst = this.instances[i];

      // PERF: Skip instances outside camera frustum
      if (!isInFrustum(inst.x, inst.y, inst.z)) {
        continue;
      }

      // Set matrix for this visible instance
      this._tempPosition.set(inst.x, inst.y, inst.z);
      _tempEuler.set(0, inst.rotation, 0);
      this._tempQuaternion.setFromEuler(_tempEuler);
      this._tempScale.set(inst.scale, inst.scale, inst.scale);
      this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
      this.instancedMesh.setMatrixAt(visibleCount, this._tempMatrix);

      visibleCount++;
    }

    this.instancedMesh.count = visibleCount;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    this.instancedMesh?.dispose();
    this.geometry?.dispose();
    this.material?.dispose();
  }
}

/**
 * Instanced small rocks/pebbles - many small objects in few draw calls
 * Frustum culling: Only visible instances are rendered each frame.
 */
export class InstancedPebbles {
  public group: THREE.Group;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.Material | null = null;

  // Instance data for frustum culling (pebbles have 3D rotation)
  private instances: Array<{ x: number; y: number; z: number; scale: number; rotX: number; rotY: number; rotZ: number }> = [];
  private maxCount = 0;

  // Reusable objects for update loop
  private _tempMatrix = new THREE.Matrix4();
  private _tempPosition = new THREE.Vector3();
  private _tempQuaternion = new THREE.Quaternion();
  private _tempScale = new THREE.Vector3();

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    const pebbleCount = Math.min(500, mapData.width * mapData.height * 0.04);

    // Generate pebble positions
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
          this.instances.push({
            x,
            y: height + size * 0.3,
            z,
            scale: size,
            rotX: Math.random() * Math.PI,
            rotY: Math.random() * Math.PI,
            rotZ: Math.random() * Math.PI,
          });
        }
      }
    }

    if (this.instances.length === 0) return;
    this.maxCount = this.instances.length;

    // Pebble material
    const pebbleColor = biome.colors.cliff[0].clone().multiplyScalar(0.7);
    this.material = new THREE.MeshBasicMaterial({ color: pebbleColor });

    // Small icosahedron for pebbles
    this.geometry = new THREE.IcosahedronGeometry(1, 0);

    // Create instanced mesh
    this.instancedMesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      this.maxCount
    );

    // Initialize with all instances visible (first frame)
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < this.maxCount; i++) {
      const inst = this.instances[i];
      position.set(inst.x, inst.y, inst.z);
      _tempEuler.set(inst.rotX, inst.rotY, inst.rotZ);
      quaternion.setFromEuler(_tempEuler);
      scale.set(inst.scale, inst.scale, inst.scale);
      matrix.compose(position, quaternion, scale);
      this.instancedMesh.setMatrixAt(i, matrix);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.frustumCulled = false; // We handle culling manually per-instance

    this.group.add(this.instancedMesh);
  }

  /**
   * Update visible instances based on camera frustum.
   * Call this every frame after updateDecorationFrustum().
   */
  public update(): void {
    if (!this.instancedMesh || this.maxCount === 0) return;

    let visibleCount = 0;

    for (let i = 0; i < this.maxCount; i++) {
      const inst = this.instances[i];

      // PERF: Skip instances outside camera frustum
      if (!isInFrustum(inst.x, inst.y, inst.z)) {
        continue;
      }

      // Set matrix for this visible instance
      this._tempPosition.set(inst.x, inst.y, inst.z);
      _tempEuler.set(inst.rotX, inst.rotY, inst.rotZ);
      this._tempQuaternion.setFromEuler(_tempEuler);
      this._tempScale.set(inst.scale, inst.scale, inst.scale);
      this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
      this.instancedMesh.setMatrixAt(visibleCount, this._tempMatrix);

      visibleCount++;
    }

    this.instancedMesh.count = visibleCount;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    this.instancedMesh?.dispose();
    this.geometry?.dispose();
    this.material?.dispose();
  }
}

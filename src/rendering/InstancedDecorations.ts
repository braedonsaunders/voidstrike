import * as THREE from 'three';
import { BiomeConfig } from './Biomes';
import { MapData, MapDecoration } from '@/data/maps';
import AssetManager from '@/assets/AssetManager';
import { DECORATIONS } from '@/data/rendering.config';
import { TransformUtils } from './shared/InstancedMeshPool';

// PERF: Shared transform utilities for all decoration classes (avoids duplicate temp objects)
const _transformUtils = new TransformUtils();

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

// Distance culling multiplier from config
const DISTANCE_CULL_MULTIPLIER = DECORATIONS.DISTANCE_CULL_MULTIPLIER;

// Geometry disposal quarantine - prevents WebGPU "setIndexBuffer" crashes
// by delaying geometry disposal until GPU has finished pending draw commands.
// WebGPU typically has 2-3 frames in flight; 4 frames provides safety margin.
const GEOMETRY_QUARANTINE_FRAMES = 4;

// Shared frame counter for quarantine timing (updated by updateDecorationFrustum)
let _frameCount = 0;

/**
 * Clone geometry with completely fresh GPU buffers for WebGPU.
 * Creates new TypedArrays for all attributes and index to ensure zero shared state
 * with the source geometry. This prevents "setIndexBuffer" crashes when source
 * geometry is disposed while clones are still being rendered.
 * Also ensures required attributes (like UVs) exist to prevent "Vertex buffer slot" errors.
 */
function cloneGeometryForGPU(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const cloned = new THREE.BufferGeometry();

  // Copy all attributes with fresh TypedArrays (no shared references)
  for (const name of Object.keys(source.attributes)) {
    const srcAttr = source.attributes[name];
    // Create a completely new TypedArray by slicing (creates a copy)
    const newArray = srcAttr.array.slice(0);
    const newAttr = new THREE.BufferAttribute(newArray, srcAttr.itemSize, srcAttr.normalized);
    newAttr.needsUpdate = true;
    cloned.setAttribute(name, newAttr);
  }

  // Copy index with fresh TypedArray if present
  if (source.index) {
    const srcIndex = source.index;
    const newIndexArray = srcIndex.array.slice(0);
    const newIndex = new THREE.BufferAttribute(newIndexArray, srcIndex.itemSize, srcIndex.normalized);
    newIndex.needsUpdate = true;
    cloned.setIndex(newIndex);
  }

  // Copy morph attributes if present
  if (source.morphAttributes) {
    for (const name of Object.keys(source.morphAttributes)) {
      const srcMorphArray = source.morphAttributes[name];
      cloned.morphAttributes[name] = srcMorphArray.map(srcAttr => {
        const newArray = srcAttr.array.slice(0);
        const newAttr = new THREE.BufferAttribute(newArray, srcAttr.itemSize, srcAttr.normalized);
        newAttr.needsUpdate = true;
        return newAttr;
      });
    }
  }

  // Copy bounding volumes if computed
  if (source.boundingBox) {
    cloned.boundingBox = source.boundingBox.clone();
  }
  if (source.boundingSphere) {
    cloned.boundingSphere = source.boundingSphere.clone();
  }

  // Copy groups
  for (const group of source.groups) {
    cloned.addGroup(group.start, group.count, group.materialIndex);
  }

  // Ensure UV coordinates exist - required by many shaders (slot 1)
  // Some models from Tripo/Meshy AI lack UVs, causing "Vertex buffer slot 1" errors
  if (!cloned.attributes.uv && cloned.attributes.position) {
    const posCount = cloned.attributes.position.count;
    const uvArray = new Float32Array(posCount * 2);
    // Generate basic UV coords based on position (simple projection)
    const pos = cloned.attributes.position;
    for (let i = 0; i < posCount; i++) {
      uvArray[i * 2] = pos.getX(i) * 0.5 + 0.5;
      uvArray[i * 2 + 1] = pos.getZ(i) * 0.5 + 0.5;
    }
    cloned.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  }

  // Ensure normal coordinates exist - required for proper lighting and SSAO
  // Some models from Tripo/Meshy AI lack normals, causing GTAO to reconstruct
  // normals from depth gradients which creates visible triangular artifacts
  if (!cloned.attributes.normal && cloned.attributes.position) {
    cloned.computeVertexNormals();
  }

  return cloned;
}

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
  const maxDist = Math.max(DECORATIONS.MIN_CULL_DISTANCE, _cameraY * DISTANCE_CULL_MULTIPLIER);
  _maxDistanceSq = maxDist * maxDist;

  // Increment frame counter for quarantine timing
  _frameCount++;
}

/**
 * Check if a point is within the frustum AND within distance range.
 * Distance check is faster (squared comparison) and runs first.
 */
function isInFrustum(x: number, y: number, z: number): boolean {
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
 * Extract combined geometry from a loaded model
 */
function extractGeometry(object: THREE.Object3D): THREE.BufferGeometry | null {
  let geometry: THREE.BufferGeometry | null = null;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry && !geometry) {
      geometry = child.geometry;
    }
  });
  return geometry;
}

/**
 * Extract material from a loaded model
 * Returns a CLONE with rendering hints applied (doesn't modify original)
 */
function extractMaterial(object: THREE.Object3D, assetId?: string): THREE.Material | null {
  let originalMaterial: THREE.Material | null = null;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material && !originalMaterial) {
      if (Array.isArray(child.material)) {
        originalMaterial = child.material[0];
      } else {
        originalMaterial = child.material;
      }
    }
  });

  if (!originalMaterial) return null;

  // Clone the material to avoid modifying the original
  // Type assertion needed because TS doesn't track callback assignments
  const material = (originalMaterial as THREE.Material).clone();

  // Apply rendering hints for MeshStandardMaterial
  if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    const stdMaterial = material as THREE.MeshStandardMaterial;
    const hints = assetId ? AssetManager.getRenderingHints(assetId) : null;

    if (hints) {
      stdMaterial.envMapIntensity = hints.envMapIntensity ?? 0;

      if (hints.emissive) {
        stdMaterial.emissive = new THREE.Color(hints.emissive);
        stdMaterial.emissiveIntensity = hints.emissiveIntensity ?? 1.0;
      }

      if (hints.roughnessOverride !== null && hints.roughnessOverride !== undefined) {
        stdMaterial.roughness = hints.roughnessOverride;
      }
      if (hints.metalnessOverride !== null && hints.metalnessOverride !== undefined) {
        stdMaterial.metalness = hints.metalnessOverride;
      }

      const exposure = hints.exposure ?? 1.0;
      if (exposure !== 1.0) {
        if (exposure > 1.0) {
          const baseColor = stdMaterial.color.clone();
          if (!hints.emissive) {
            stdMaterial.emissive = baseColor;
            stdMaterial.emissiveIntensity = exposure - 1.0;
          } else {
            stdMaterial.emissiveIntensity = (hints.emissiveIntensity ?? 1.0) * exposure;
          }
        } else {
          stdMaterial.color.multiplyScalar(exposure);
        }
      }
    } else {
      stdMaterial.envMapIntensity = 0;
    }
  }

  return material;
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

// Tree decoration types
const TREE_TYPES = new Set([
  'tree_pine_tall',
  'tree_pine_medium',
  'tree_dead',
  'tree_alien',
  'tree_palm',
  'tree_mushroom',
]);

// Rock decoration types
const ROCK_TYPES = new Set([
  'rocks_large',
  'rocks_small',
  'rock_single',
]);

// Crystal decoration types
const CRYSTAL_TYPES = new Set([
  'crystal_formation',
]);

/**
 * Instanced tree rendering from explicit map data.
 * All trees of same model type rendered in ONE draw call.
 * Per-instance frustum culling for performance.
 */
export class InstancedTrees {
  public group: THREE.Group;
  private instancedMeshes: CullableInstancedMesh[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private treeCollisions: Array<{ x: number; z: number; radius: number }> = [];

  // Geometry disposal quarantine for WebGPU safety
  private geometryQuarantine: Array<{
    geometry: THREE.BufferGeometry;
    materials: THREE.Material[];
    frameQueued: number;
  }> = [];

  constructor(
    mapData: MapData,
    _biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    // Filter tree decorations from map data
    const treeDecorations = (mapData.decorations || []).filter(d => TREE_TYPES.has(d.type));
    if (treeDecorations.length === 0) return;

    // Group by model ID
    const treesByModel = new Map<string, MapDecoration[]>();
    for (const dec of treeDecorations) {
      if (!treesByModel.has(dec.type)) {
        treesByModel.set(dec.type, []);
      }
      treesByModel.get(dec.type)!.push(dec);
    }

    // Border zone check for shadow optimization
    const BORDER_MARGIN = DECORATIONS.BORDER_MARGIN;
    const isInBorder = (x: number, y: number) =>
      x < BORDER_MARGIN || x > mapData.width - BORDER_MARGIN ||
      y < BORDER_MARGIN || y > mapData.height - BORDER_MARGIN;

    // Create instanced meshes for each model type
    for (const [modelId, decorations] of treesByModel) {
      if (!AssetManager.hasDecorationModel(modelId)) continue;

      const original = AssetManager.getDecorationOriginal(modelId);
      if (!original) continue;

      const geometry = extractGeometry(original);
      if (!geometry) continue;

      // extractMaterial returns a clone, so we use it directly
      const playableMaterial = extractMaterial(original, modelId);
      const borderMaterial = extractMaterial(original, modelId);
      if (!playableMaterial || !borderMaterial) continue;

      // Clone geometries with proper GPU buffer initialization to prevent WebGPU crashes
      const playableGeometry = cloneGeometryForGPU(geometry);
      const borderGeometry = cloneGeometryForGPU(geometry);
      this.geometries.push(playableGeometry, borderGeometry);
      this.materials.push(playableMaterial, borderMaterial);

      const yOffset = AssetManager.getModelYOffset(modelId);

      // Separate into shadow-casting (playable area) and non-shadow (border)
      const playable: InstanceData[] = [];
      const border: InstanceData[] = [];

      for (const dec of decorations) {
        const scale = dec.scale ?? 1.0;
        const rotation = dec.rotation ?? Math.random() * Math.PI * 2;
        const height = getHeightAt(dec.x, dec.y);

        const inst: InstanceData = {
          x: dec.x,
          y: height + yOffset * scale,
          z: dec.y, // Note: decoration y is world z
          scale,
          rotation,
          yOffset,
        };

        if (isInBorder(dec.x, dec.y)) {
          border.push(inst);
        } else {
          playable.push(inst);
        }

        // Track collision data
        const collisionRadius = scale * DECORATIONS.TREE_COLLISION_RADIUS;
        this.treeCollisions.push({ x: dec.x, z: dec.y, radius: collisionRadius });
      }

      // Create instanced meshes (extractMaterial already returns clones)
      this.createInstancedMesh(playableGeometry, playableMaterial, playable, true);
      this.createInstancedMesh(borderGeometry, borderMaterial, border, false);
    }
  }

  private createInstancedMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    instances: InstanceData[],
    castShadow: boolean
  ): void {
    if (instances.length === 0) return;

    const instancedMesh = new THREE.InstancedMesh(geometry, material, instances.length);

    // Initialize matrices
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      position.set(inst.x, inst.y, inst.z);
      _tempEuler.set(0, inst.rotation, 0);
      quaternion.setFromEuler(_tempEuler);
      scale.set(inst.scale, inst.scale, inst.scale);
      matrix.compose(position, quaternion, scale);
      instancedMesh.setMatrixAt(i, matrix);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    instancedMesh.frustumCulled = false; // We handle culling manually
    instancedMesh.castShadow = castShadow;
    instancedMesh.receiveShadow = true;

    this.instancedMeshes.push({ mesh: instancedMesh, instances, maxCount: instances.length });
    this.group.add(instancedMesh);
  }

  public update(): void {
    // Process quarantine first
    this.processGeometryQuarantine();

    for (const { mesh, instances, maxCount } of this.instancedMeshes) {
      let visibleCount = 0;

      for (let i = 0; i < maxCount; i++) {
        const inst = instances[i];
        if (!isInFrustum(inst.x, inst.y, inst.z)) continue;

        _transformUtils.tempPosition.set(inst.x, inst.y, inst.z);
        _tempEuler.set(0, inst.rotation, 0);
        _transformUtils.tempQuaternion.setFromEuler(_tempEuler);
        _transformUtils.tempScale.set(inst.scale, inst.scale, inst.scale);
        _transformUtils.tempMatrix.compose(_transformUtils.tempPosition, _transformUtils.tempQuaternion, _transformUtils.tempScale);
        mesh.setMatrixAt(visibleCount, _transformUtils.tempMatrix);
        visibleCount++;
      }

      mesh.count = visibleCount;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private queueGeometryForDisposal(geometry: THREE.BufferGeometry, materials: THREE.Material[]): void {
    this.geometryQuarantine.push({
      geometry,
      materials,
      frameQueued: _frameCount,
    });
  }

  private processGeometryQuarantine(): void {
    let writeIndex = 0;
    for (let i = 0; i < this.geometryQuarantine.length; i++) {
      const entry = this.geometryQuarantine[i];
      const framesInQuarantine = _frameCount - entry.frameQueued;

      if (framesInQuarantine >= GEOMETRY_QUARANTINE_FRAMES) {
        // Safe to dispose now
        entry.geometry.dispose();
        for (const material of entry.materials) {
          material.dispose();
        }
      } else {
        // Keep in quarantine
        this.geometryQuarantine[writeIndex++] = entry;
      }
    }
    this.geometryQuarantine.length = writeIndex;
  }

  public getTreeCollisions(): Array<{ x: number; z: number; radius: number }> {
    return this.treeCollisions;
  }

  public dispose(): void {
    // Remove meshes from scene
    for (const { mesh } of this.instancedMeshes) {
      this.group.remove(mesh);
    }

    // Queue geometries and materials for delayed disposal (WebGPU safety)
    for (const geometry of this.geometries) {
      this.queueGeometryForDisposal(geometry, []);
    }
    for (const material of this.materials) {
      // Queue materials with empty geometry (they'll be disposed with the quarantine)
      this.geometryQuarantine.push({
        geometry: new THREE.BufferGeometry(), // Dummy geometry
        materials: [material],
        frameQueued: _frameCount,
      });
    }

    // Clear references
    this.instancedMeshes = [];
    this.geometries = [];
    this.materials = [];

    // Force process quarantine immediately if scene is being destroyed
    // This is safe because no more rendering will happen
    for (const entry of this.geometryQuarantine) {
      entry.geometry.dispose();
      for (const mat of entry.materials) {
        mat.dispose();
      }
    }
    this.geometryQuarantine = [];
  }
}

/**
 * Instanced rock rendering from explicit map data.
 * All rocks of same model type rendered in ONE draw call.
 * Per-instance frustum culling for performance.
 */
export class InstancedRocks {
  public group: THREE.Group;
  private instancedMeshes: CullableInstancedMesh[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private rockCollisions: Array<{ x: number; z: number; radius: number }> = [];

  // Geometry disposal quarantine for WebGPU safety
  private geometryQuarantine: Array<{
    geometry: THREE.BufferGeometry;
    materials: THREE.Material[];
    frameQueued: number;
  }> = [];

  constructor(
    mapData: MapData,
    _biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    // Filter rock decorations from map data
    const rockDecorations = (mapData.decorations || []).filter(d => ROCK_TYPES.has(d.type));
    if (rockDecorations.length === 0) return;

    // Group by model ID
    const rocksByModel = new Map<string, MapDecoration[]>();
    for (const dec of rockDecorations) {
      if (!rocksByModel.has(dec.type)) {
        rocksByModel.set(dec.type, []);
      }
      rocksByModel.get(dec.type)!.push(dec);
    }

    // Border zone check for shadow optimization
    const BORDER_MARGIN = DECORATIONS.BORDER_MARGIN;
    const isInBorder = (x: number, y: number) =>
      x < BORDER_MARGIN || x > mapData.width - BORDER_MARGIN ||
      y < BORDER_MARGIN || y > mapData.height - BORDER_MARGIN;

    // Create instanced meshes for each model type
    for (const [modelId, decorations] of rocksByModel) {
      if (!AssetManager.hasDecorationModel(modelId)) continue;

      const original = AssetManager.getDecorationOriginal(modelId);
      if (!original) continue;

      const geometry = extractGeometry(original);
      if (!geometry) continue;

      // extractMaterial returns clones, so we need one for each mesh (playable/border)
      const playableMaterial = extractMaterial(original, modelId);
      const borderMaterial = extractMaterial(original, modelId);
      if (!playableMaterial || !borderMaterial) continue;

      // Clone geometries with proper GPU buffer initialization to prevent WebGPU crashes
      const playableGeometry = cloneGeometryForGPU(geometry);
      const borderGeometry = cloneGeometryForGPU(geometry);
      this.geometries.push(playableGeometry, borderGeometry);
      this.materials.push(playableMaterial, borderMaterial);

      const yOffset = AssetManager.getModelYOffset(modelId);

      // Separate into shadow-casting (playable area) and non-shadow (border)
      const playable: InstanceData[] = [];
      const border: InstanceData[] = [];

      for (const dec of decorations) {
        const scale = dec.scale ?? 1.0;
        const rotation = dec.rotation ?? Math.random() * Math.PI * 2;
        const height = getHeightAt(dec.x, dec.y);

        const inst: InstanceData = {
          x: dec.x,
          y: height + yOffset * scale,
          z: dec.y,
          scale,
          rotation,
          yOffset,
        };

        if (isInBorder(dec.x, dec.y)) {
          border.push(inst);
        } else {
          playable.push(inst);
        }

        // Track collision data - base radius varies by rock type
        let baseRadius = 1.0;
        if (modelId === 'rocks_large') baseRadius = 2.0;
        else if (modelId === 'rocks_small') baseRadius = 1.2;
        else if (modelId === 'rock_single') baseRadius = 0.8;

        this.rockCollisions.push({ x: dec.x, z: dec.y, radius: baseRadius * scale });
      }

      // Create instanced meshes (extractMaterial already returns clones)
      this.createInstancedMesh(playableGeometry, playableMaterial, playable, true);
      this.createInstancedMesh(borderGeometry, borderMaterial, border, false);
    }
  }

  private createInstancedMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    instances: InstanceData[],
    castShadow: boolean
  ): void {
    if (instances.length === 0) return;

    const instancedMesh = new THREE.InstancedMesh(geometry, material, instances.length);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      position.set(inst.x, inst.y, inst.z);
      _tempEuler.set(0, inst.rotation, 0);
      quaternion.setFromEuler(_tempEuler);
      scale.set(inst.scale, inst.scale, inst.scale);
      matrix.compose(position, quaternion, scale);
      instancedMesh.setMatrixAt(i, matrix);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    instancedMesh.frustumCulled = false;
    instancedMesh.castShadow = castShadow;
    instancedMesh.receiveShadow = true;

    this.instancedMeshes.push({ mesh: instancedMesh, instances, maxCount: instances.length });
    this.group.add(instancedMesh);
  }

  public update(): void {
    // Process quarantine first
    this.processGeometryQuarantine();

    for (const { mesh, instances, maxCount } of this.instancedMeshes) {
      let visibleCount = 0;

      for (let i = 0; i < maxCount; i++) {
        const inst = instances[i];
        if (!isInFrustum(inst.x, inst.y, inst.z)) continue;

        _transformUtils.tempPosition.set(inst.x, inst.y, inst.z);
        _tempEuler.set(0, inst.rotation, 0);
        _transformUtils.tempQuaternion.setFromEuler(_tempEuler);
        _transformUtils.tempScale.set(inst.scale, inst.scale, inst.scale);
        _transformUtils.tempMatrix.compose(_transformUtils.tempPosition, _transformUtils.tempQuaternion, _transformUtils.tempScale);
        mesh.setMatrixAt(visibleCount, _transformUtils.tempMatrix);
        visibleCount++;
      }

      mesh.count = visibleCount;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private queueGeometryForDisposal(geometry: THREE.BufferGeometry, materials: THREE.Material[]): void {
    this.geometryQuarantine.push({
      geometry,
      materials,
      frameQueued: _frameCount,
    });
  }

  private processGeometryQuarantine(): void {
    let writeIndex = 0;
    for (let i = 0; i < this.geometryQuarantine.length; i++) {
      const entry = this.geometryQuarantine[i];
      const framesInQuarantine = _frameCount - entry.frameQueued;

      if (framesInQuarantine >= GEOMETRY_QUARANTINE_FRAMES) {
        entry.geometry.dispose();
        for (const material of entry.materials) {
          material.dispose();
        }
      } else {
        this.geometryQuarantine[writeIndex++] = entry;
      }
    }
    this.geometryQuarantine.length = writeIndex;
  }

  public getRockCollisions(): Array<{ x: number; z: number; radius: number }> {
    return this.rockCollisions;
  }

  public dispose(): void {
    for (const { mesh } of this.instancedMeshes) {
      this.group.remove(mesh);
    }

    for (const geometry of this.geometries) {
      this.queueGeometryForDisposal(geometry, []);
    }
    for (const material of this.materials) {
      this.geometryQuarantine.push({
        geometry: new THREE.BufferGeometry(),
        materials: [material],
        frameQueued: _frameCount,
      });
    }

    this.instancedMeshes = [];
    this.geometries = [];
    this.materials = [];

    // Force process quarantine immediately if scene is being destroyed
    for (const entry of this.geometryQuarantine) {
      entry.geometry.dispose();
      for (const mat of entry.materials) {
        mat.dispose();
      }
    }
    this.geometryQuarantine = [];
  }
}

/**
 * Instanced crystal rendering from explicit map data.
 * All crystals rendered in ONE draw call with emissive materials.
 * Per-instance frustum culling for performance.
 */
export class InstancedCrystals {
  public group: THREE.Group;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.Material | null = null;
  private instances: InstanceData[] = [];
  private maxCount = 0;

  // Geometry disposal quarantine for WebGPU safety
  private geometryQuarantine: Array<{
    geometry: THREE.BufferGeometry;
    materials: THREE.Material[];
    frameQueued: number;
  }> = [];

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    // Filter crystal decorations from map data
    const crystalDecorations = (mapData.decorations || []).filter(d => CRYSTAL_TYPES.has(d.type));
    if (crystalDecorations.length === 0) return;

    const modelId = 'crystal_formation';
    if (!AssetManager.hasDecorationModel(modelId)) return;

    const original = AssetManager.getDecorationOriginal(modelId);
    if (!original) return;

    const baseGeometry = extractGeometry(original);
    if (!baseGeometry) return;

    // Clone geometry with proper GPU buffer initialization to prevent WebGPU crashes
    this.geometry = cloneGeometryForGPU(baseGeometry);
    this.material = extractMaterial(original, modelId);
    if (!this.material) return;

    const yOffset = AssetManager.getModelYOffset(modelId);

    // Build instance data
    for (const dec of crystalDecorations) {
      const scale = dec.scale ?? 1.0;
      const rotation = dec.rotation ?? Math.random() * Math.PI * 2;
      const height = getHeightAt(dec.x, dec.y);

      this.instances.push({
        x: dec.x,
        y: height + yOffset * scale,
        z: dec.y,
        scale,
        rotation,
        yOffset,
      });
    }

    this.maxCount = this.instances.length;

    // Create instanced mesh
    this.instancedMesh = new THREE.InstancedMesh(this.geometry, this.material, this.maxCount);

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
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.castShadow = false; // Crystals don't cast shadows
    this.instancedMesh.receiveShadow = true;

    this.group.add(this.instancedMesh);
  }

  public update(): void {
    // Process quarantine first
    this.processGeometryQuarantine();

    if (!this.instancedMesh) return;

    let visibleCount = 0;
    for (let i = 0; i < this.maxCount; i++) {
      const inst = this.instances[i];
      if (!isInFrustum(inst.x, inst.y, inst.z)) continue;

      _transformUtils.tempPosition.set(inst.x, inst.y, inst.z);
      _tempEuler.set(0, inst.rotation, 0);
      _transformUtils.tempQuaternion.setFromEuler(_tempEuler);
      _transformUtils.tempScale.set(inst.scale, inst.scale, inst.scale);
      _transformUtils.tempMatrix.compose(_transformUtils.tempPosition, _transformUtils.tempQuaternion, _transformUtils.tempScale);
      this.instancedMesh.setMatrixAt(visibleCount, _transformUtils.tempMatrix);
      visibleCount++;
    }

    this.instancedMesh.count = visibleCount;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  private processGeometryQuarantine(): void {
    let writeIndex = 0;
    for (let i = 0; i < this.geometryQuarantine.length; i++) {
      const entry = this.geometryQuarantine[i];
      const framesInQuarantine = _frameCount - entry.frameQueued;

      if (framesInQuarantine >= GEOMETRY_QUARANTINE_FRAMES) {
        entry.geometry.dispose();
        for (const material of entry.materials) {
          material.dispose();
        }
      } else {
        this.geometryQuarantine[writeIndex++] = entry;
      }
    }
    this.geometryQuarantine.length = writeIndex;
  }

  public getInstancedMesh(): THREE.InstancedMesh | null {
    return this.instancedMesh;
  }

  public dispose(): void {
    if (this.instancedMesh) {
      this.group.remove(this.instancedMesh);
    }

    // Queue for delayed disposal
    if (this.geometry) {
      this.geometryQuarantine.push({
        geometry: this.geometry,
        materials: this.material ? [this.material] : [],
        frameQueued: _frameCount,
      });
    }

    this.instancedMesh = null;
    this.geometry = null;
    this.material = null;

    // Force process quarantine immediately if scene is being destroyed
    for (const entry of this.geometryQuarantine) {
      entry.geometry.dispose();
      for (const mat of entry.materials) {
        mat.dispose();
      }
    }
    this.geometryQuarantine = [];
  }
}

/**
 * Instanced grass - environmental ground detail (procedural).
 * Thousands of grass blades in one draw call.
 */
export class InstancedGrass {
  public group: THREE.Group;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.Material | null = null;
  private instances: Array<{ x: number; y: number; z: number; scale: number; rotation: number }> = [];
  private maxCount = 0;

  // Geometry disposal quarantine for WebGPU safety
  private geometryQuarantine: Array<{
    geometry: THREE.BufferGeometry;
    materials: THREE.Material[];
    frameQueued: number;
  }> = [];

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

    // Generate grass positions on ground terrain
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
            y: height + 0.1 + scale * 2,
            z,
            scale,
            rotation: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    if (this.instances.length === 0) return;
    this.maxCount = this.instances.length;

    const grassColor = biome.colors.ground[0].clone().multiplyScalar(0.8);
    this.material = new THREE.MeshBasicMaterial({
      color: grassColor,
      side: THREE.DoubleSide,
    });

    this.geometry = new THREE.PlaneGeometry(0.3, 0.5);

    this.instancedMesh = new THREE.InstancedMesh(this.geometry, this.material, this.maxCount);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < this.maxCount; i++) {
      const inst = this.instances[i];
      position.set(inst.x, inst.y, inst.z);
      _tempEuler.set(-Math.PI / 2, inst.rotation, 0);
      quaternion.setFromEuler(_tempEuler);
      scale.set(inst.scale, inst.scale, inst.scale);
      matrix.compose(position, quaternion, scale);
      this.instancedMesh.setMatrixAt(i, matrix);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.castShadow = false;
    this.instancedMesh.receiveShadow = false;

    this.group.add(this.instancedMesh);
  }

  public update(): void {
    // Process quarantine first
    this.processGeometryQuarantine();

    if (!this.instancedMesh) return;

    let visibleCount = 0;
    for (let i = 0; i < this.maxCount; i++) {
      const inst = this.instances[i];
      if (!isInFrustum(inst.x, inst.y, inst.z)) continue;

      _transformUtils.tempPosition.set(inst.x, inst.y, inst.z);
      _tempEuler.set(-Math.PI / 2, inst.rotation, 0);
      _transformUtils.tempQuaternion.setFromEuler(_tempEuler);
      _transformUtils.tempScale.set(inst.scale, inst.scale, inst.scale);
      _transformUtils.tempMatrix.compose(_transformUtils.tempPosition, _transformUtils.tempQuaternion, _transformUtils.tempScale);
      this.instancedMesh.setMatrixAt(visibleCount, _transformUtils.tempMatrix);
      visibleCount++;
    }

    this.instancedMesh.count = visibleCount;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  private processGeometryQuarantine(): void {
    let writeIndex = 0;
    for (let i = 0; i < this.geometryQuarantine.length; i++) {
      const entry = this.geometryQuarantine[i];
      const framesInQuarantine = _frameCount - entry.frameQueued;

      if (framesInQuarantine >= GEOMETRY_QUARANTINE_FRAMES) {
        entry.geometry.dispose();
        for (const material of entry.materials) {
          material.dispose();
        }
      } else {
        this.geometryQuarantine[writeIndex++] = entry;
      }
    }
    this.geometryQuarantine.length = writeIndex;
  }

  public dispose(): void {
    if (this.instancedMesh) {
      this.group.remove(this.instancedMesh);
    }

    if (this.geometry) {
      this.geometryQuarantine.push({
        geometry: this.geometry,
        materials: this.material ? [this.material] : [],
        frameQueued: _frameCount,
      });
    }

    this.instancedMesh = null;
    this.geometry = null;
    this.material = null;

    // Force process quarantine immediately if scene is being destroyed
    for (const entry of this.geometryQuarantine) {
      entry.geometry.dispose();
      for (const mat of entry.materials) {
        mat.dispose();
      }
    }
    this.geometryQuarantine = [];
  }
}

/**
 * Instanced pebbles - environmental ground detail (procedural).
 * Small stones scattered on the ground.
 */
export class InstancedPebbles {
  public group: THREE.Group;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.Material | null = null;
  private instances: Array<{ x: number; y: number; z: number; scale: number; rotation: number }> = [];
  private maxCount = 0;

  // Geometry disposal quarantine for WebGPU safety
  private geometryQuarantine: Array<{
    geometry: THREE.BufferGeometry;
    materials: THREE.Material[];
    frameQueued: number;
  }> = [];

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    const pebbleCount = Math.min(500, mapData.width * mapData.height * 0.03);

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
          const scale = 0.05 + Math.random() * 0.1;
          this.instances.push({
            x,
            y: height + scale * 0.5,
            z,
            scale,
            rotation: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    if (this.instances.length === 0) return;
    this.maxCount = this.instances.length;

    const pebbleColor = biome.colors.ground[0].clone().multiplyScalar(0.6);
    this.material = new THREE.MeshBasicMaterial({ color: pebbleColor });
    this.geometry = new THREE.DodecahedronGeometry(0.15);

    this.instancedMesh = new THREE.InstancedMesh(this.geometry, this.material, this.maxCount);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < this.maxCount; i++) {
      const inst = this.instances[i];
      position.set(inst.x, inst.y, inst.z);
      _tempEuler.set(Math.random() * Math.PI, inst.rotation, Math.random() * Math.PI);
      quaternion.setFromEuler(_tempEuler);
      scale.set(inst.scale, inst.scale, inst.scale);
      matrix.compose(position, quaternion, scale);
      this.instancedMesh.setMatrixAt(i, matrix);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.castShadow = false;
    this.instancedMesh.receiveShadow = true;

    this.group.add(this.instancedMesh);
  }

  public update(): void {
    // Process quarantine first
    this.processGeometryQuarantine();

    if (!this.instancedMesh) return;

    let visibleCount = 0;
    for (let i = 0; i < this.maxCount; i++) {
      const inst = this.instances[i];
      if (!isInFrustum(inst.x, inst.y, inst.z)) continue;

      _transformUtils.tempPosition.set(inst.x, inst.y, inst.z);
      _tempEuler.set(0, inst.rotation, 0);
      _transformUtils.tempQuaternion.setFromEuler(_tempEuler);
      _transformUtils.tempScale.set(inst.scale, inst.scale, inst.scale);
      _transformUtils.tempMatrix.compose(_transformUtils.tempPosition, _transformUtils.tempQuaternion, _transformUtils.tempScale);
      this.instancedMesh.setMatrixAt(visibleCount, _transformUtils.tempMatrix);
      visibleCount++;
    }

    this.instancedMesh.count = visibleCount;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  private processGeometryQuarantine(): void {
    let writeIndex = 0;
    for (let i = 0; i < this.geometryQuarantine.length; i++) {
      const entry = this.geometryQuarantine[i];
      const framesInQuarantine = _frameCount - entry.frameQueued;

      if (framesInQuarantine >= GEOMETRY_QUARANTINE_FRAMES) {
        entry.geometry.dispose();
        for (const material of entry.materials) {
          material.dispose();
        }
      } else {
        this.geometryQuarantine[writeIndex++] = entry;
      }
    }
    this.geometryQuarantine.length = writeIndex;
  }

  public dispose(): void {
    if (this.instancedMesh) {
      this.group.remove(this.instancedMesh);
    }

    if (this.geometry) {
      this.geometryQuarantine.push({
        geometry: this.geometry,
        materials: this.material ? [this.material] : [],
        frameQueued: _frameCount,
      });
    }

    this.instancedMesh = null;
    this.geometry = null;
    this.material = null;

    // Force process quarantine immediately if scene is being destroyed
    for (const entry of this.geometryQuarantine) {
      entry.geometry.dispose();
      for (const mat of entry.materials) {
        mat.dispose();
      }
    }
    this.geometryQuarantine = [];
  }
}

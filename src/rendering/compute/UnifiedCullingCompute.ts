/**
 * Unified Culling Compute
 *
 * GPU-accelerated frustum culling and LOD selection for all entities (units + buildings).
 * Uses proper sphere-frustum intersection for accurate culling.
 *
 * Architecture:
 * - Input: Entity transform buffer, metadata buffer, camera frustum planes
 * - Output: Visible indices buffer, indirect draw args with instance counts
 * - Supports category-aware culling (separate counts for units vs buildings)
 *
 * Critical fix: Uses sphere-frustum intersection instead of point-in-frustum,
 * preventing entities from disappearing when camera zooms in close.
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  storage,
  uniform,
  float,
  int,
  uint,
  vec4,
  If,
  instanceIndex,
  instancedArray,
  atomicAdd,
  atomicStore,
} from 'three/tsl';

import { StorageInstancedBufferAttribute } from 'three/webgpu';

import { GPUEntityBuffer, EntitySlot, EntityCategory, createIndirectArgsBuffer } from './GPUEntityBuffer';
import { debugShaders } from '@/utils/debugLogger';
import { DEFAULT_LOD_DISTANCES } from '@/assets/AssetManager';

// LOD distance thresholds
export interface LODConfig {
  LOD0_MAX: number; // Distance for highest detail
  LOD1_MAX: number; // Distance for medium detail
  // Beyond LOD1_MAX = LOD2 (lowest detail)
}

const DEFAULT_LOD_CONFIG: LODConfig = {
  LOD0_MAX: DEFAULT_LOD_DISTANCES.LOD0_MAX,
  LOD1_MAX: DEFAULT_LOD_DISTANCES.LOD1_MAX,
};

// Max entities for GPU culling
const MAX_GPU_ENTITIES = 8192;

// Workgroup size for culling compute
const CULLING_WORKGROUP_SIZE = 64;

/**
 * Result of culling operation (CPU fallback path)
 */
export interface CullingResult {
  visibleCount: number;
  visibleSlots: EntitySlot[];
  lodAssignments: Map<number, number>; // entityId -> LOD level
}

/**
 * Unified Culling Compute
 *
 * Performs frustum culling and LOD selection for all entity types.
 * GPU path for WebGPU, CPU fallback for WebGL/unsupported systems.
 */
export class UnifiedCullingCompute {
  private lodConfig: LODConfig;
  private renderer: WebGPURenderer | null = null;

  // CPU fallback structures
  private frustum: THREE.Frustum;
  private frustumMatrix: THREE.Matrix4;
  private tempSphere: THREE.Sphere;
  private cachedVisibleSlots: EntitySlot[] = [];
  private cachedLODAssignments: Map<number, number> = new Map();

  // GPU compute structures
  private gpuComputeAvailable = false;
  private useCPUFallback = true;

  // Performance metrics
  private lastGPUCullTime = 0;
  private gpuCullFrameCount = 0;

  // Uniforms for GPU compute
  private uCameraPosition = uniform(new THREE.Vector3());
  private uLOD0MaxSq = uniform(0);
  private uLOD1MaxSq = uniform(0);
  private uEntityCount = uniform(0);

  // Frustum planes storage buffer (6 vec4 planes)
  private frustumPlanesData = new Float32Array(24);
  private frustumPlanesAttribute: StorageInstancedBufferAttribute | null = null;
  private frustumPlanesStorage: ReturnType<typeof storage> | null = null;

  // GPU storage buffers
  private transformStorageAttribute: StorageInstancedBufferAttribute | null = null;
  private metadataStorageAttribute: StorageInstancedBufferAttribute | null = null;
  private transformStorageBuffer: ReturnType<typeof storage> | null = null;
  private metadataStorageBuffer: ReturnType<typeof storage> | null = null;

  // Visible indices output buffer
  private visibleIndicesStorage: ReturnType<typeof instancedArray> | null = null;

  // Indirect args buffers (atomic for instance count updates)
  // Separate buffers for units and buildings
  private unitIndirectArgsStorage: ReturnType<typeof instancedArray> | null = null;
  private buildingIndirectArgsStorage: ReturnType<typeof instancedArray> | null = null;

  // Visible count atomic counters (separate for units and buildings)
  private visibleCountStorage: ReturnType<typeof instancedArray> | null = null;

  // Compute shader nodes
  private resetComputeNode: ReturnType<typeof Fn> | null = null;
  private cullingComputeNode: ReturnType<typeof Fn> | null = null;

  // Layout constants
  private maxTypes = 128;
  private maxLODLevels = 3;
  private maxPlayers = 8;

  constructor(lodConfig: LODConfig = DEFAULT_LOD_CONFIG) {
    this.lodConfig = lodConfig;
    this.frustum = new THREE.Frustum();
    this.frustumMatrix = new THREE.Matrix4();
    this.tempSphere = new THREE.Sphere();

    // Update LOD uniform values (squared for faster GPU comparison)
    this.uLOD0MaxSq.value = lodConfig.LOD0_MAX * lodConfig.LOD0_MAX;
    this.uLOD1MaxSq.value = lodConfig.LOD1_MAX * lodConfig.LOD1_MAX;
  }

  /**
   * Initialize GPU compute resources
   */
  initializeGPUCompute(
    renderer: WebGPURenderer,
    transformData: Float32Array,
    metadataData: Float32Array
  ): void {
    try {
      this.renderer = renderer;

      // Validate TSL functions are available
      if (!instancedArray || typeof instancedArray !== 'function') {
        throw new Error('instancedArray not available in three/tsl');
      }

      // Create storage buffers for input data
      this.transformStorageAttribute = new StorageInstancedBufferAttribute(transformData, 16);
      this.transformStorageBuffer = storage(this.transformStorageAttribute, 'mat4', MAX_GPU_ENTITIES);

      this.metadataStorageAttribute = new StorageInstancedBufferAttribute(metadataData, 4);
      this.metadataStorageBuffer = storage(this.metadataStorageAttribute, 'vec4', MAX_GPU_ENTITIES);

      // Create frustum planes storage buffer
      this.frustumPlanesAttribute = new StorageInstancedBufferAttribute(this.frustumPlanesData, 4);
      this.frustumPlanesStorage = storage(this.frustumPlanesAttribute, 'vec4', 6);

      // Create visible indices buffer using instancedArray
      this.visibleIndicesStorage = instancedArray(MAX_GPU_ENTITIES, 'uint');

      // Indirect args: atomic buffers for compute shader writes (separate for units and buildings)
      const indirectEntryCount = this.maxTypes * this.maxLODLevels * this.maxPlayers;
      this.unitIndirectArgsStorage = instancedArray(indirectEntryCount * 5, 'uint').toAtomic();
      this.buildingIndirectArgsStorage = instancedArray(indirectEntryCount * 5, 'uint').toAtomic();

      // Visible count: atomic counters (index 0 = total, index 1 = units, index 2 = buildings)
      this.visibleCountStorage = instancedArray(3, 'uint').toAtomic();

      // Create compute shaders
      this.createResetComputeShader();
      this.createCullingComputeShader();

      this.gpuComputeAvailable = true;
      this.useCPUFallback = false;

      debugShaders.log('[UnifiedCullingCompute] GPU compute initialized');
      debugShaders.log(`  - Max entities: ${MAX_GPU_ENTITIES}`);
      debugShaders.log(`  - Indirect entries per category: ${indirectEntryCount}`);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      debugShaders.warn('[UnifiedCullingCompute] GPU compute init failed:', errorMsg);
      this.gpuComputeAvailable = false;
      this.useCPUFallback = true;
      console.warn('[GPU Culling] INIT FAILED:', errorMsg);
    }
  }

  /**
   * Create reset compute shader
   *
   * Clears all atomic counters before culling.
   */
  private createResetComputeShader(): void {
    const unitIndirectArgs = this.unitIndirectArgsStorage!;
    const buildingIndirectArgs = this.buildingIndirectArgsStorage!;
    const visibleCount = this.visibleCountStorage!;
    const maxLODs = this.maxLODLevels;
    const maxPlayers = this.maxPlayers;

    const resetFn = Fn(() => {
      const entryIndex = instanceIndex;

      // Calculate the offset for instanceCount in this entry
      const instanceCountOffset = entryIndex.mul(int(5)).add(int(1));

      // Reset instance counts for both categories
      atomicStore(unitIndirectArgs.element(instanceCountOffset), uint(0));
      atomicStore(buildingIndirectArgs.element(instanceCountOffset), uint(0));

      // First thread also resets the global visible counts
      If(entryIndex.equal(int(0)), () => {
        atomicStore(visibleCount.element(int(0)), uint(0)); // Total
        atomicStore(visibleCount.element(int(1)), uint(0)); // Units
        atomicStore(visibleCount.element(int(2)), uint(0)); // Buildings
      });
    });

    const totalEntries = this.maxTypes * maxLODs * maxPlayers;
    this.resetComputeNode = resetFn().compute(totalEntries);
  }

  /**
   * Create GPU culling compute shader
   *
   * Performs:
   * 1. Sphere-frustum intersection (not point-based!)
   * 2. LOD selection based on camera distance
   * 3. Category-aware atomic writes to separate indirect args buffers
   */
  private createCullingComputeShader(): void {
    const transformBuffer = this.transformStorageBuffer!;
    const metadataBuffer = this.metadataStorageBuffer!;
    const visibleIndices = this.visibleIndicesStorage!;
    const unitIndirectArgs = this.unitIndirectArgsStorage!;
    const buildingIndirectArgs = this.buildingIndirectArgsStorage!;
    const visibleCount = this.visibleCountStorage!;
    const cameraPos = this.uCameraPosition;
    const frustumPlanes = this.frustumPlanesStorage!;
    const lod0MaxSq = this.uLOD0MaxSq;
    const lod1MaxSq = this.uLOD1MaxSq;
    const entityCount = this.uEntityCount;

    const maxLODs = int(this.maxLODLevels);
    const maxPlayers = int(this.maxPlayers);
    const CATEGORY_UNIT = int(EntityCategory.Unit);

    const cullingFn = Fn(() => {
      const entityIndex = instanceIndex;

      // Early exit if out of bounds
      If(entityIndex.greaterThanEqual(entityCount), () => {
        return;
      });

      // Read transform matrix - extract position from column 3
      const transform = transformBuffer.element(entityIndex);
      const worldPos = transform.mul(vec4(0, 0, 0, 1));
      const posX = worldPos.x;
      const posY = worldPos.y;
      const posZ = worldPos.z;

      // Read metadata: vec4(entityId, packedTypeAndCategory, playerId, boundingRadius)
      const metadata = metadataBuffer.element(entityIndex);
      const packedTypeAndCategory = int(metadata.y);
      const typeIndex = packedTypeAndCategory.bitAnd(int(0xFFFF));
      const category = packedTypeAndCategory.shiftRight(int(16)).bitAnd(int(0xFFFF));
      const playerId = int(metadata.z);
      const radius = metadata.w;

      // SPHERE-FRUSTUM INTERSECTION (not point test!)
      // Entity is visible if its bounding sphere intersects all 6 frustum planes.
      // For each plane: if (distance_to_plane < -radius), sphere is fully outside.
      const visible = float(1).toVar();

      // Test each plane
      const p0 = frustumPlanes.element(int(0));
      const d0 = p0.x.mul(posX).add(p0.y.mul(posY)).add(p0.z.mul(posZ)).add(p0.w);
      If(d0.lessThan(radius.negate()), () => { visible.assign(0); });

      const p1 = frustumPlanes.element(int(1));
      const d1 = p1.x.mul(posX).add(p1.y.mul(posY)).add(p1.z.mul(posZ)).add(p1.w);
      If(d1.lessThan(radius.negate()), () => { visible.assign(0); });

      const p2 = frustumPlanes.element(int(2));
      const d2 = p2.x.mul(posX).add(p2.y.mul(posY)).add(p2.z.mul(posZ)).add(p2.w);
      If(d2.lessThan(radius.negate()), () => { visible.assign(0); });

      const p3 = frustumPlanes.element(int(3));
      const d3 = p3.x.mul(posX).add(p3.y.mul(posY)).add(p3.z.mul(posZ)).add(p3.w);
      If(d3.lessThan(radius.negate()), () => { visible.assign(0); });

      const p4 = frustumPlanes.element(int(4));
      const d4 = p4.x.mul(posX).add(p4.y.mul(posY)).add(p4.z.mul(posZ)).add(p4.w);
      If(d4.lessThan(radius.negate()), () => { visible.assign(0); });

      const p5 = frustumPlanes.element(int(5));
      const d5 = p5.x.mul(posX).add(p5.y.mul(posY)).add(p5.z.mul(posZ)).add(p5.w);
      If(d5.lessThan(radius.negate()), () => { visible.assign(0); });

      // If visible, calculate LOD and update output buffers
      If(visible.greaterThan(0), () => {
        // Calculate distance squared to camera
        const dx = posX.sub(cameraPos.x);
        const dy = posY.sub(cameraPos.y);
        const dz = posZ.sub(cameraPos.z);
        const distSq = dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz));

        // Determine LOD level
        const lod = int(2).toVar();
        If(distSq.lessThanEqual(lod0MaxSq), () => {
          lod.assign(0);
        }).Else(() => {
          If(distSq.lessThanEqual(lod1MaxSq), () => {
            lod.assign(1);
          });
        });

        // Calculate index into indirect args buffer
        const indirectIndex = typeIndex.mul(maxLODs).mul(maxPlayers)
          .add(lod.mul(maxPlayers))
          .add(playerId);
        const instanceCountOffset = indirectIndex.mul(int(5)).add(int(1));

        // Atomically increment instance count in the appropriate category buffer
        If(category.equal(CATEGORY_UNIT), () => {
          atomicAdd(unitIndirectArgs.element(instanceCountOffset), uint(1));
          atomicAdd(visibleCount.element(int(1)), uint(1)); // Unit count
        }).Else(() => {
          atomicAdd(buildingIndirectArgs.element(instanceCountOffset), uint(1));
          atomicAdd(visibleCount.element(int(2)), uint(1)); // Building count
        });

        // Write visible entity index to output buffer
        const globalIndex = atomicAdd(visibleCount.element(int(0)), uint(1));
        visibleIndices.element(globalIndex).assign(uint(entityIndex));
      });
    });

    this.cullingComputeNode = cullingFn().compute(MAX_GPU_ENTITIES, [CULLING_WORKGROUP_SIZE]);
  }

  /**
   * Update frustum from camera
   */
  updateFrustum(camera: THREE.Camera): void {
    this.frustumMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.frustumMatrix);

    // Update GPU uniforms
    this.uCameraPosition.value.copy(camera.position);

    // Pack frustum planes into storage buffer
    const planes = this.frustum.planes;
    for (let i = 0; i < 6; i++) {
      const offset = i * 4;
      this.frustumPlanesData[offset + 0] = planes[i].normal.x;
      this.frustumPlanesData[offset + 1] = planes[i].normal.y;
      this.frustumPlanesData[offset + 2] = planes[i].normal.z;
      this.frustumPlanesData[offset + 3] = planes[i].constant;
    }

    // Mark frustum planes buffer as needing update
    if (this.frustumPlanesAttribute) {
      this.frustumPlanesAttribute.needsUpdate = true;
    }
  }

  /**
   * Update LOD configuration
   */
  setLODConfig(config: LODConfig): void {
    this.lodConfig = config;
    this.uLOD0MaxSq.value = config.LOD0_MAX * config.LOD0_MAX;
    this.uLOD1MaxSq.value = config.LOD1_MAX * config.LOD1_MAX;
  }

  /**
   * Perform GPU culling
   *
   * Dispatches two compute passes:
   * 1. Reset: Clears all atomic counters
   * 2. Cull: Tests each entity with sphere-frustum intersection
   */
  cullGPU(entityBuffer: GPUEntityBuffer, camera: THREE.Camera): void {
    if (!this.renderer || !this.cullingComputeNode || !this.resetComputeNode || this.useCPUFallback) {
      return;
    }

    const cullStart = performance.now();

    // Update frustum and camera uniforms
    this.updateFrustum(camera);

    // Update entity count
    const activeCount = entityBuffer.getActiveCount();
    this.uEntityCount.value = activeCount;

    try {
      // Pass 1: Reset all counters on GPU
      this.renderer.compute(this.resetComputeNode);

      // Pass 2: Perform culling
      this.renderer.compute(this.cullingComputeNode);

      this.lastGPUCullTime = performance.now() - cullStart;
      this.gpuCullFrameCount++;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      debugShaders.warn('[UnifiedCullingCompute] GPU culling failed:', errorMsg);
      this.useCPUFallback = true;
      console.warn('[GPU Culling] Execution failed, switching to CPU:', errorMsg);
    }
  }

  /**
   * Perform culling on CPU (fallback path)
   *
   * Uses proper sphere-frustum intersection via THREE.Frustum.intersectsSphere()
   */
  cull(entityBuffer: GPUEntityBuffer, camera: THREE.Camera): CullingResult {
    this.updateFrustum(camera);

    const cameraPosition = camera.position;

    this.cachedVisibleSlots.length = 0;
    this.cachedLODAssignments.clear();

    const transformData = entityBuffer.getTransformData();

    for (const slot of entityBuffer.getAllocatedSlots()) {
      const index = slot.index;
      const transformOffset = index * 16;

      // Extract position from transform matrix (column 3)
      const x = transformData[transformOffset + 12];
      const y = transformData[transformOffset + 13];
      const z = transformData[transformOffset + 14];

      // SPHERE-FRUSTUM INTERSECTION with actual bounding radius
      this.tempSphere.center.set(x, y, z);
      this.tempSphere.radius = slot.boundingRadius;

      if (!this.frustum.intersectsSphere(this.tempSphere)) {
        continue;
      }

      // LOD selection
      const dx = x - cameraPosition.x;
      const dy = y - cameraPosition.y;
      const dz = z - cameraPosition.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;

      let lod: number;
      if (distanceSq <= this.lodConfig.LOD0_MAX * this.lodConfig.LOD0_MAX) {
        lod = 0;
      } else if (distanceSq <= this.lodConfig.LOD1_MAX * this.lodConfig.LOD1_MAX) {
        lod = 1;
      } else {
        lod = 2;
      }

      this.cachedVisibleSlots.push(slot);
      this.cachedLODAssignments.set(slot.entityId, lod);
    }

    return {
      visibleCount: this.cachedVisibleSlots.length,
      visibleSlots: this.cachedVisibleSlots,
      lodAssignments: this.cachedLODAssignments,
    };
  }

  /**
   * CPU path: Perform culling and update indirect draw arguments
   */
  cullAndUpdateIndirect(
    entityBuffer: GPUEntityBuffer,
    camera: THREE.Camera,
    unitIndirectArgs: ReturnType<typeof createIndirectArgsBuffer>,
    buildingIndirectArgs: ReturnType<typeof createIndirectArgsBuffer>
  ): CullingResult {
    unitIndirectArgs.resetInstanceCounts();
    buildingIndirectArgs.resetInstanceCounts();

    const result = this.cull(entityBuffer, camera);

    // Group by (type, LOD, player, category)
    const unitInstanceCounts = new Map<string, number>();
    const buildingInstanceCounts = new Map<string, number>();

    for (const slot of result.visibleSlots) {
      const lod = result.lodAssignments.get(slot.entityId) ?? 0;
      const key = `${slot.typeIndex}_${lod}_${slot.playerId}`;

      if (slot.category === EntityCategory.Unit) {
        const count = unitInstanceCounts.get(key) ?? 0;
        unitInstanceCounts.set(key, count + 1);
      } else {
        const count = buildingInstanceCounts.get(key) ?? 0;
        buildingInstanceCounts.set(key, count + 1);
      }
    }

    // Write counts to indirect buffers
    for (const [key, count] of unitInstanceCounts) {
      const [type, lod, player] = key.split('_').map(Number);
      const offset = unitIndirectArgs.getOffset(type, lod, player);
      unitIndirectArgs.buffer[offset + 1] = count;
    }

    for (const [key, count] of buildingInstanceCounts) {
      const [type, lod, player] = key.split('_').map(Number);
      const offset = buildingIndirectArgs.getOffset(type, lod, player);
      buildingIndirectArgs.buffer[offset + 1] = count;
    }

    return result;
  }

  /**
   * Check if a sphere intersects the frustum (CPU query for individual entities)
   */
  intersectsSphere(x: number, y: number, z: number, radius: number): boolean {
    this.tempSphere.center.set(x, y, z);
    this.tempSphere.radius = radius;
    return this.frustum.intersectsSphere(this.tempSphere);
  }

  /**
   * Get LOD level for a distance
   */
  getLODForDistance(distance: number): number {
    if (distance <= this.lodConfig.LOD0_MAX) return 0;
    if (distance <= this.lodConfig.LOD1_MAX) return 1;
    return 2;
  }

  /**
   * Get LOD config
   */
  getLODConfig(): LODConfig {
    return this.lodConfig;
  }

  /**
   * Get GPU culling performance stats
   */
  getGPUCullingStats(): {
    isUsingGPU: boolean;
    lastCullTimeMs: number;
    totalFramesCulled: number;
    activeEntityCount: number;
  } {
    return {
      isUsingGPU: this.gpuComputeAvailable && !this.useCPUFallback,
      lastCullTimeMs: this.lastGPUCullTime,
      totalFramesCulled: this.gpuCullFrameCount,
      activeEntityCount: this.uEntityCount.value,
    };
  }

  /**
   * Get unit indirect args storage for binding
   */
  getUnitIndirectArgsStorage(): ReturnType<typeof instancedArray> | null {
    return this.unitIndirectArgsStorage;
  }

  /**
   * Get building indirect args storage for binding
   */
  getBuildingIndirectArgsStorage(): ReturnType<typeof instancedArray> | null {
    return this.buildingIndirectArgsStorage;
  }

  /**
   * Get visible indices storage
   */
  getVisibleIndicesStorage(): ReturnType<typeof instancedArray> | null {
    return this.visibleIndicesStorage;
  }

  /**
   * Get transform storage for vertex shader binding
   */
  getTransformStorage(): ReturnType<typeof storage> | null {
    return this.transformStorageBuffer;
  }

  /**
   * Get metadata storage
   */
  getMetadataStorage(): ReturnType<typeof storage> | null {
    return this.metadataStorageBuffer;
  }

  /**
   * Check if using GPU compute
   */
  isUsingGPU(): boolean {
    return this.gpuComputeAvailable && !this.useCPUFallback;
  }

  /**
   * Force CPU fallback mode
   */
  forceCPUFallback(enable: boolean): void {
    this.useCPUFallback = enable;
  }

  /**
   * Get indirect offset for a (type, LOD, player) combination
   */
  getIndirectOffset(type: number, lod: number, player: number): number {
    return (type * this.maxLODLevels * this.maxPlayers + lod * this.maxPlayers + player) * 5;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.cachedVisibleSlots.length = 0;
    this.cachedLODAssignments.clear();
    this.resetComputeNode = null;
    this.cullingComputeNode = null;
    this.transformStorageAttribute = null;
    this.metadataStorageAttribute = null;
    this.frustumPlanesAttribute = null;
    this.visibleIndicesStorage = null;
    this.unitIndirectArgsStorage = null;
    this.buildingIndirectArgsStorage = null;
  }
}

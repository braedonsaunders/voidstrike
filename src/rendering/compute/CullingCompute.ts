/**
 * GPU Culling Compute
 *
 * Performs frustum culling and LOD selection on the GPU via compute shader.
 * Outputs visible unit indices and updates indirect draw arguments atomically.
 *
 * Architecture:
 * - Input: Unit transform buffer, metadata buffer, camera frustum planes
 * - Output: Visible indices buffer, indirect draw args with instance counts
 * - Two-pass compute: Reset pass clears counters, Cull pass populates results
 *
 * Three.js r182 GPU Compute Pattern:
 * - Fn().compute() for compute shader definition
 * - instancedArray().toAtomic() for atomic storage buffers
 * - atomicAdd() for thread-safe instance counting
 * - atomicStore() for resetting counters
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

import { GPUUnitBuffer, UnitSlot, createIndirectArgsBuffer } from './GPUUnitBuffer';
import { debugShaders } from '@/utils/debugLogger';

// LOD distance thresholds
export interface LODConfig {
  LOD0_MAX: number; // Distance for highest detail
  LOD1_MAX: number; // Distance for medium detail
  // Beyond LOD1_MAX = LOD2 (lowest detail)
}

const DEFAULT_LOD_CONFIG: LODConfig = {
  LOD0_MAX: 30,
  LOD1_MAX: 100,
};

// Max units for GPU culling
const MAX_GPU_UNITS = 4096;

// Workgroup size for culling compute
const CULLING_WORKGROUP_SIZE = 64;

/**
 * Result of culling operation
 */
export interface CullingResult {
  visibleCount: number;
  visibleSlots: UnitSlot[];
  lodAssignments: Map<number, number>; // entityId -> LOD level
}

/**
 * GPU Culling Compute
 *
 * Performs frustum culling and LOD selection on GPU.
 * Falls back to optimized CPU path when GPU compute isn't available.
 */
export class CullingCompute {
  private lodConfig: LODConfig;
  private renderer: WebGPURenderer | null = null;

  // CPU fallback structures
  private frustum: THREE.Frustum;
  private frustumMatrix: THREE.Matrix4;
  private tempSphere: THREE.Sphere;
  private cachedVisibleSlots: UnitSlot[] = [];
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
  private uUnitCount = uniform(0);

  // Frustum planes storage buffer (6 vec4 planes)
  private frustumPlanesData = new Float32Array(24);
  private frustumPlanesAttribute: StorageInstancedBufferAttribute | null = null;
  private frustumPlanesStorage: ReturnType<typeof storage> | null = null;

  // GPU storage buffers
  private transformStorageAttribute: StorageInstancedBufferAttribute | null = null;
  private metadataStorageAttribute: StorageInstancedBufferAttribute | null = null;
  private transformStorageBuffer: ReturnType<typeof storage> | null = null;
  private metadataStorageBuffer: ReturnType<typeof storage> | null = null;

  // Visible indices output buffer - uses instancedArray for both compute AND vertex shader access
  // instancedArray() is the correct pattern for buffers shared between compute and vertex shaders
  private visibleIndicesStorage: ReturnType<typeof instancedArray> | null = null;

  // Indirect args buffer (atomic for instance count updates)
  private indirectArgsStorage: ReturnType<typeof instancedArray> | null = null;
  private indirectArgsData: Uint32Array | null = null;

  // Visible count atomic counter
  private visibleCountStorage: ReturnType<typeof instancedArray> | null = null;

  // Compute shader nodes
  private resetComputeNode: any = null;
  private cullingComputeNode: any = null;

  // Layout constants
  private maxUnitTypes = 64;
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
      this.transformStorageBuffer = storage(this.transformStorageAttribute, 'mat4', MAX_GPU_UNITS);

      this.metadataStorageAttribute = new StorageInstancedBufferAttribute(metadataData, 4);
      this.metadataStorageBuffer = storage(this.metadataStorageAttribute, 'vec4', MAX_GPU_UNITS);

      // Create frustum planes storage buffer
      this.frustumPlanesAttribute = new StorageInstancedBufferAttribute(this.frustumPlanesData, 4);
      this.frustumPlanesStorage = storage(this.frustumPlanesAttribute, 'vec4', 6);

      // Create visible indices buffer using instancedArray
      // instancedArray() works in BOTH compute shaders AND vertex shaders via .element()
      // This is the correct Three.js r182 pattern for shared GPU buffers
      this.visibleIndicesStorage = instancedArray(MAX_GPU_UNITS, 'uint');

      // Indirect args: atomic buffer for compute shader writes
      const indirectEntryCount = this.maxUnitTypes * this.maxLODLevels * this.maxPlayers;
      this.indirectArgsData = new Uint32Array(indirectEntryCount * 5);
      this.indirectArgsStorage = instancedArray(indirectEntryCount * 5, 'uint').toAtomic();

      // Visible count: single atomic counter
      this.visibleCountStorage = instancedArray(1, 'uint').toAtomic();

      // Create compute shaders
      this.createResetComputeShader();
      this.createCullingComputeShader();

      this.gpuComputeAvailable = true;
      this.useCPUFallback = false;

      debugShaders.log('[CullingCompute] GPU compute initialized');
      debugShaders.log(`  - Max units: ${MAX_GPU_UNITS}`);
      debugShaders.log(`  - Indirect entries: ${indirectEntryCount}`);
      debugShaders.log('[GPU Culling] ✓ INITIALIZED');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      debugShaders.warn('[CullingCompute] GPU compute init failed:', errorMsg);
      this.gpuComputeAvailable = false;
      this.useCPUFallback = true;
      console.warn('[GPU Culling] ✗ INIT FAILED:', errorMsg);
    }
  }

  /**
   * Create reset compute shader
   *
   * Clears all atomic counters before culling. This must run before the culling pass
   * to ensure deterministic results.
   */
  private createResetComputeShader(): void {
    const indirectArgs = this.indirectArgsStorage!;
    const visibleCount = this.visibleCountStorage!;
    const maxLODs = this.maxLODLevels;
    const maxPlayers = this.maxPlayers;

    // Reset indirect args instance counts (offset 1 in each 5-uint entry)
    const resetFn = Fn(() => {
      const entryIndex = instanceIndex;

      // Calculate the offset for instanceCount in this entry
      // Each entry is 5 uints: [indexCount, instanceCount, firstIndex, baseVertex, firstInstance]
      const instanceCountOffset = entryIndex.mul(int(5)).add(int(1));

      // Reset instance count to 0
      atomicStore(indirectArgs.element(instanceCountOffset), uint(0));

      // First thread also resets the global visible count
      If(entryIndex.equal(int(0)), () => {
        atomicStore(visibleCount.element(int(0)), uint(0));
      });
    });

    const totalEntries = this.maxUnitTypes * maxLODs * maxPlayers;
    this.resetComputeNode = resetFn().compute(totalEntries);
  }

  /**
   * Create GPU culling compute shader
   *
   * Performs:
   * 1. Frustum culling against 6 planes
   * 2. LOD selection based on camera distance
   * 3. Atomic write to visible indices buffer
   * 4. Atomic increment of indirect draw args instance count
   */
  private createCullingComputeShader(): void {
    const transformBuffer = this.transformStorageBuffer!;
    const metadataBuffer = this.metadataStorageBuffer!;
    const visibleIndices = this.visibleIndicesStorage!;
    const indirectArgs = this.indirectArgsStorage!;
    const visibleCount = this.visibleCountStorage!;
    const cameraPos = this.uCameraPosition;
    const frustumPlanes = this.frustumPlanesStorage!;
    const lod0MaxSq = this.uLOD0MaxSq;
    const lod1MaxSq = this.uLOD1MaxSq;
    const unitCount = this.uUnitCount;

    const maxLODs = int(this.maxLODLevels);
    const maxPlayers = int(this.maxPlayers);

    const cullingFn = Fn(() => {
      const unitIndex = instanceIndex;

      // Early exit if out of bounds
      If(unitIndex.greaterThanEqual(unitCount), () => {
        return;
      });

      // Read transform matrix - extract position by multiplying by vec4(0,0,0,1)
      // In TSL, we can't use array indexing on mat4, so we extract translation this way
      const transform = transformBuffer.element(unitIndex);
      const worldPos = transform.mul(vec4(0, 0, 0, 1));
      const posX = worldPos.x;
      const posY = worldPos.y;
      const posZ = worldPos.z;

      // Read metadata: vec4(entityId, unitTypeIndex, playerId, boundingRadius)
      const metadata = metadataBuffer.element(unitIndex);
      const unitTypeIndex = int(metadata.y);
      const playerId = int(metadata.z);
      const radius = metadata.w;

      // Frustum culling against 6 planes
      const visible = float(1).toVar();

      // Test each plane: if distance < -radius, unit is outside frustum
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
        // Layout: [unitType][lod][player] * 5
        const indirectIndex = unitTypeIndex.mul(maxLODs).mul(maxPlayers)
          .add(lod.mul(maxPlayers))
          .add(playerId);
        const instanceCountOffset = indirectIndex.mul(int(5)).add(int(1));

        // Atomically increment instance count
        atomicAdd(indirectArgs.element(instanceCountOffset), uint(1));

        // Write visible unit index to output buffer
        const globalIndex = atomicAdd(visibleCount.element(int(0)), uint(1));
        visibleIndices.element(globalIndex).assign(uint(unitIndex));
      });
    });

    this.cullingComputeNode = cullingFn().compute(MAX_GPU_UNITS, [CULLING_WORKGROUP_SIZE]);
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
   * 2. Cull: Tests each unit and populates results
   */
  cullGPU(unitBuffer: GPUUnitBuffer, camera: THREE.Camera): void {
    if (!this.renderer || !this.cullingComputeNode || !this.resetComputeNode || this.useCPUFallback) {
      return;
    }

    const cullStart = performance.now();

    // Update frustum and camera uniforms
    this.updateFrustum(camera);

    // Update unit count
    const activeCount = unitBuffer.getActiveCount();
    this.uUnitCount.value = activeCount;

    try {
      // Pass 1: Reset all counters on GPU
      this.renderer.compute(this.resetComputeNode);

      // Pass 2: Perform culling
      this.renderer.compute(this.cullingComputeNode);

      this.lastGPUCullTime = performance.now() - cullStart;
      this.gpuCullFrameCount++;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      debugShaders.warn('[CullingCompute] GPU culling failed:', errorMsg);
      this.useCPUFallback = true;
      console.warn('[GPU Culling] Execution failed, switching to CPU:', errorMsg);
    }
  }

  /**
   * Get GPU culling performance stats
   */
  getGPUCullingStats(): {
    isUsingGPU: boolean;
    lastCullTimeMs: number;
    totalFramesCulled: number;
    activeUnitCount: number;
  } {
    return {
      isUsingGPU: this.gpuComputeAvailable && !this.useCPUFallback,
      lastCullTimeMs: this.lastGPUCullTime,
      totalFramesCulled: this.gpuCullFrameCount,
      activeUnitCount: this.uUnitCount.value,
    };
  }

  /**
   * Get indirect args storage for binding
   */
  getIndirectArgsStorage(): ReturnType<typeof instancedArray> | null {
    return this.indirectArgsStorage;
  }

  /**
   * Get visible indices storage for both compute and vertex shader access
   * instancedArray() works in both contexts via .element()
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
   * Perform culling on CPU (fallback path)
   */
  cull(unitBuffer: GPUUnitBuffer, camera: THREE.Camera): CullingResult {
    this.updateFrustum(camera);

    const cameraPosition = camera.position;

    this.cachedVisibleSlots.length = 0;
    this.cachedLODAssignments.clear();

    const transformData = unitBuffer.getTransformData();
    const metadataData = unitBuffer.getMetadataData();

    for (const slot of unitBuffer.getAllocatedSlots()) {
      const index = slot.index;
      const transformOffset = index * 16;
      const metadataOffset = index * 4;

      // Extract position from transform matrix (column 3)
      const x = transformData[transformOffset + 12];
      const y = transformData[transformOffset + 13];
      const z = transformData[transformOffset + 14];

      // Get bounding radius
      const radius = metadataData[metadataOffset + 3];

      // Frustum culling
      this.tempSphere.center.set(x, y, z);
      this.tempSphere.radius = radius;

      if (!this.frustum.intersectsSphere(this.tempSphere)) {
        continue;
      }

      // LOD selection
      const dx = x - cameraPosition.x;
      const dy = y - cameraPosition.y;
      const dz = z - cameraPosition.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      const distance = Math.sqrt(distanceSq);

      let lod: number;
      if (distance <= this.lodConfig.LOD0_MAX) {
        lod = 0;
      } else if (distance <= this.lodConfig.LOD1_MAX) {
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
    unitBuffer: GPUUnitBuffer,
    camera: THREE.Camera,
    indirectArgs: ReturnType<typeof createIndirectArgsBuffer>,
    _unitTypeCount: number
  ): CullingResult {
    indirectArgs.resetInstanceCounts();

    const result = this.cull(unitBuffer, camera);

    // Group by (unitType, LOD, player)
    const instanceCounts = new Map<string, number>();

    for (const slot of result.visibleSlots) {
      const lod = result.lodAssignments.get(slot.entityId) ?? 0;
      const key = `${slot.unitTypeIndex}_${lod}_${slot.playerId}`;
      const count = instanceCounts.get(key) ?? 0;
      instanceCounts.set(key, count + 1);
    }

    // Write counts to indirect buffer
    for (const [key, count] of instanceCounts) {
      const [unitType, lod, player] = key.split('_').map(Number);
      const offset = indirectArgs.getOffset(unitType, lod, player);
      indirectArgs.buffer[offset + 1] = count;
    }

    return result;
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
   * Get indirect offset for a (unitType, LOD, player) combination
   */
  getIndirectOffset(unitType: number, lod: number, player: number): number {
    return (unitType * this.maxLODLevels * this.maxPlayers + lod * this.maxPlayers + player) * 5;
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
  }
}

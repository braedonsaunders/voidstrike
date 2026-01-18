/**
 * GPU Culling Compute
 *
 * Performs frustum culling and LOD selection on the GPU via compute shader.
 * Outputs visible unit indices and updates indirect draw arguments.
 *
 * Architecture:
 * - Input: Unit transform buffer, metadata buffer, camera frustum planes
 * - Output: Visible indices buffer, indirect draw args with instance counts
 *
 * Three.js r182 GPU Compute Pattern:
 * - Fn().compute() for frustum culling shader
 * - IndirectStorageBufferAttribute for draw arguments
 * - atomicAdd() for thread-safe instance counting
 * - Storage buffers for visible instance indices
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  storage,
  uniform,
  vec4,
  float,
  int,
  If,
} from 'three/tsl';

// Access TSL exports that lack TypeScript declarations
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as TSL from 'three/tsl';
const uint = (TSL as any).uint;
const instanceIndex = (TSL as any).instanceIndex;
const atomicAdd = (TSL as any).atomicAdd;
const atomicStore = (TSL as any).atomicStore;

// StorageBufferAttribute and IndirectStorageBufferAttribute exist in three/webgpu
// but lack TypeScript declarations - access dynamically
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as THREE_WEBGPU from 'three/webgpu';
const StorageBufferAttribute = (THREE_WEBGPU as any).StorageBufferAttribute;
const IndirectStorageBufferAttribute = (THREE_WEBGPU as any).IndirectStorageBufferAttribute;

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
 * Frustum planes extracted from camera projection-view matrix
 */
export interface FrustumPlanes {
  planes: THREE.Plane[];
}

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
  private tempPosition: THREE.Vector3;
  private tempSphere: THREE.Sphere;
  private cachedVisibleSlots: UnitSlot[] = [];
  private cachedLODAssignments: Map<number, number> = new Map();

  // GPU compute structures
  private gpuComputeAvailable = false;
  private useCPUFallback = true;

  // Uniforms for GPU compute
  private uCameraPosition = uniform(new THREE.Vector3());
  private uLOD0MaxSq = uniform(0);
  private uLOD1MaxSq = uniform(0);
  private uUnitCount = uniform(0);

  // Frustum planes as storage buffer (6 vec4 planes = 24 floats backing array)
  // Cannot use uniform() for typed arrays - must use storage()
  private frustumPlanesData = new Float32Array(24); // 6 planes * 4 floats each
  private frustumPlanesStorage: ReturnType<typeof storage> | null = null;

  // GPU storage buffers
  private transformStorageBuffer: ReturnType<typeof storage> | null = null;
  private metadataStorageBuffer: ReturnType<typeof storage> | null = null;
  private visibleIndicesBuffer: any | null = null; // StorageBufferAttribute
  private visibleIndicesStorage: ReturnType<typeof storage> | null = null;
  private indirectArgsAttribute: any | null = null; // IndirectStorageBufferAttribute
  private indirectArgsStorage: ReturnType<typeof storage> | null = null;

  // Compute shader node
  private cullingComputeNode: any = null;

  // Counter for visible units (atomic) - one counter per (unitType, LOD, player) group
  // For simplicity, we use a single global counter and rebuild instance buffers
  private visibleCountBuffer: Uint32Array = new Uint32Array(1);
  private visibleCountStorageBuffer: ReturnType<typeof storage> | null = null;

  // Indirect args data (on CPU for setup, synced to GPU)
  private indirectArgsData: Uint32Array | null = null;

  // Max unit types * LODs * players for indirect indexing
  private maxUnitTypes = 64;
  private maxLODLevels = 3;
  private maxPlayers = 8;

  constructor(lodConfig: LODConfig = DEFAULT_LOD_CONFIG) {
    this.lodConfig = lodConfig;
    this.frustum = new THREE.Frustum();
    this.frustumMatrix = new THREE.Matrix4();
    this.tempPosition = new THREE.Vector3();
    this.tempSphere = new THREE.Sphere();

    // Update LOD uniform values
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

      // Create storage buffers from unit buffer data
      this.transformStorageBuffer = storage(transformData, 'mat4', MAX_GPU_UNITS);
      this.metadataStorageBuffer = storage(metadataData, 'vec4', MAX_GPU_UNITS);

      // Create visible indices output buffer (stores slot indices of visible units)
      const visibleIndicesData = new Uint32Array(MAX_GPU_UNITS);
      this.visibleIndicesBuffer = new StorageBufferAttribute(visibleIndicesData, 1);
      this.visibleIndicesStorage = storage(visibleIndicesData, 'uint', MAX_GPU_UNITS);

      // Create indirect args buffer for all unit/LOD/player combinations
      // DrawIndexedIndirect format: [indexCount, instanceCount, firstIndex, baseVertex, firstInstance]
      const indirectEntryCount = this.maxUnitTypes * this.maxLODLevels * this.maxPlayers;
      this.indirectArgsData = new Uint32Array(indirectEntryCount * 5);
      this.indirectArgsStorage = storage(this.indirectArgsData, 'uint', indirectEntryCount * 5);

      // Create visible count buffer (atomic counter)
      this.visibleCountStorageBuffer = storage(this.visibleCountBuffer, 'uint', 1);

      // Create frustum planes storage buffer (6 planes as vec4)
      this.frustumPlanesStorage = storage(this.frustumPlanesData, 'vec4', 6);

      // Create compute shader with proper output writing
      this.createCullingComputeShader();

      this.gpuComputeAvailable = true;
      this.useCPUFallback = false;

      debugShaders.log(`[CullingCompute] GPU compute initialized (${MAX_GPU_UNITS} units, ${indirectEntryCount} indirect entries)`);
    } catch (e) {
      debugShaders.warn('[CullingCompute] GPU compute init failed, using CPU fallback:', e);
      this.gpuComputeAvailable = false;
      this.useCPUFallback = true;
    }
  }

  /**
   * Create indirect args buffer with IndirectStorageBufferAttribute
   */
  createIndirectBuffer(
    unitTypeCount: number,
    lodCount: number = 3,
    playerCount: number = 8
  ): any {
    // DrawIndexedIndirect: 5 uint32 per entry
    // [indexCount, instanceCount, firstIndex, baseVertex, firstInstance]
    const entryCount = unitTypeCount * lodCount * playerCount;
    const data = new Uint32Array(entryCount * 5);

    this.indirectArgsAttribute = new IndirectStorageBufferAttribute(data, 5);
    return this.indirectArgsAttribute;
  }

  /**
   * Create GPU culling compute shader
   *
   * This shader performs:
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
    const visibleCount = this.visibleCountStorageBuffer!;
    const cameraPos = this.uCameraPosition;
    const frustumPlanes = this.frustumPlanesStorage!;
    const lod0MaxSq = this.uLOD0MaxSq;
    const lod1MaxSq = this.uLOD1MaxSq;
    const unitCount = this.uUnitCount;

    // Constants for indirect buffer indexing
    const maxLODs = int(this.maxLODLevels);
    const maxPlayers = int(this.maxPlayers);

    const cullingFn = Fn(() => {
      const unitIndex = instanceIndex;

      // Early exit if out of bounds
      If(unitIndex.greaterThanEqual(unitCount), () => {
        return;
      });

      // Read transform matrix - extract position from column 3
      const transform = transformBuffer.element(unitIndex);
      const posX = transform[12]; // Mat4 element access (column-major)
      const posY = transform[13];
      const posZ = transform[14];

      // Read metadata: vec4(entityId, unitTypeIndex, playerId, boundingRadius)
      const metadata = metadataBuffer.element(unitIndex);
      const unitTypeIndex = int(metadata.y);
      const playerId = int(metadata.z);
      const radius = metadata.w;

      // Frustum culling: test against 6 planes
      // Each plane is vec4(normal.xyz, distance) - stored as 6 vec4s in storage buffer
      const visible = float(1).toVar();

      // Test each frustum plane (storage contains 6 vec4 planes)
      // Plane 0
      const p0 = frustumPlanes.element(int(0));
      const d0 = p0.x.mul(posX).add(p0.y.mul(posY)).add(p0.z.mul(posZ)).add(p0.w);
      If(d0.lessThan(radius.negate()), () => {
        visible.assign(0);
      });

      // Plane 1
      const p1 = frustumPlanes.element(int(1));
      const d1 = p1.x.mul(posX).add(p1.y.mul(posY)).add(p1.z.mul(posZ)).add(p1.w);
      If(d1.lessThan(radius.negate()), () => {
        visible.assign(0);
      });

      // Plane 2
      const p2 = frustumPlanes.element(int(2));
      const d2 = p2.x.mul(posX).add(p2.y.mul(posY)).add(p2.z.mul(posZ)).add(p2.w);
      If(d2.lessThan(radius.negate()), () => {
        visible.assign(0);
      });

      // Plane 3
      const p3 = frustumPlanes.element(int(3));
      const d3 = p3.x.mul(posX).add(p3.y.mul(posY)).add(p3.z.mul(posZ)).add(p3.w);
      If(d3.lessThan(radius.negate()), () => {
        visible.assign(0);
      });

      // Plane 4
      const p4 = frustumPlanes.element(int(4));
      const d4 = p4.x.mul(posX).add(p4.y.mul(posY)).add(p4.z.mul(posZ)).add(p4.w);
      If(d4.lessThan(radius.negate()), () => {
        visible.assign(0);
      });

      // Plane 5
      const p5 = frustumPlanes.element(int(5));
      const d5 = p5.x.mul(posX).add(p5.y.mul(posY)).add(p5.z.mul(posZ)).add(p5.w);
      If(d5.lessThan(radius.negate()), () => {
        visible.assign(0);
      });

      // If visible, calculate LOD and write to output buffers
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
        // Layout: [unitType][lod][player] * 5 (DrawIndexedIndirect stride)
        // instanceCount is at offset 1 in each entry
        const indirectIndex = unitTypeIndex.mul(maxLODs).mul(maxPlayers)
          .add(lod.mul(maxPlayers))
          .add(playerId);
        const instanceCountOffset = indirectIndex.mul(int(5)).add(int(1));

        // Atomically increment instance count and get previous value
        // This gives us the index within this group to write our visible unit
        const writeIndex = atomicAdd(indirectArgs.element(instanceCountOffset), uint(1));

        // Write visible unit index to output buffer
        // Global visible index = atomicAdd on global counter
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

    // Pack frustum planes into storage buffer data
    const planes = this.frustum.planes;
    for (let i = 0; i < 6; i++) {
      const offset = i * 4;
      this.frustumPlanesData[offset + 0] = planes[i].normal.x;
      this.frustumPlanesData[offset + 1] = planes[i].normal.y;
      this.frustumPlanesData[offset + 2] = planes[i].normal.z;
      this.frustumPlanesData[offset + 3] = planes[i].constant;
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
   * Reset indirect args instance counts to 0
   * Call before culling each frame
   */
  resetIndirectArgs(): void {
    if (!this.indirectArgsData) return;

    // Reset all instance counts (offset 1 in each 5-uint entry)
    const entryCount = this.maxUnitTypes * this.maxLODLevels * this.maxPlayers;
    for (let i = 0; i < entryCount; i++) {
      this.indirectArgsData[i * 5 + 1] = 0; // instanceCount = 0
    }
  }

  /**
   * Perform GPU culling
   *
   * This dispatches the compute shader which:
   * 1. Tests each unit against frustum
   * 2. Calculates LOD based on distance
   * 3. Atomically writes to visible indices buffer
   * 4. Atomically increments indirect draw instance counts
   */
  cullGPU(unitBuffer: GPUUnitBuffer, camera: THREE.Camera): void {
    if (!this.renderer || !this.cullingComputeNode || this.useCPUFallback) {
      return;
    }

    // Update frustum
    this.updateFrustum(camera);

    // Update unit count
    this.uUnitCount.value = unitBuffer.getActiveCount();

    // Reset visible count and indirect args
    this.visibleCountBuffer[0] = 0;
    this.resetIndirectArgs();

    try {
      // Execute compute shader
      this.renderer.compute(this.cullingComputeNode);
    } catch (e) {
      debugShaders.warn('[CullingCompute] GPU culling failed:', e);
      this.useCPUFallback = true;
    }
  }

  /**
   * Get the visible count after GPU culling
   */
  getVisibleCount(): number {
    return this.visibleCountBuffer[0];
  }

  /**
   * Get indirect args storage for binding to instanced mesh
   */
  getIndirectArgsStorage(): ReturnType<typeof storage> | null {
    return this.indirectArgsStorage;
  }

  /**
   * Perform culling on all units in the buffer (CPU path)
   *
   * @param unitBuffer GPU unit buffer containing transforms
   * @param camera Camera for frustum and LOD calculations
   * @returns Culling result with visible units and LOD assignments
   */
  cull(unitBuffer: GPUUnitBuffer, camera: THREE.Camera): CullingResult {
    // Update frustum from camera
    this.updateFrustum(camera);

    const cameraPosition = camera.position;

    // Clear cached results
    this.cachedVisibleSlots.length = 0;
    this.cachedLODAssignments.clear();

    const transformData = unitBuffer.getTransformData();
    const metadataData = unitBuffer.getMetadataData();

    // Iterate all allocated slots
    for (const slot of unitBuffer.getAllocatedSlots()) {
      const index = slot.index;
      const transformOffset = index * 16;
      const metadataOffset = index * 4;

      // Extract position from transform matrix (column 3)
      const x = transformData[transformOffset + 12];
      const y = transformData[transformOffset + 13];
      const z = transformData[transformOffset + 14];

      // Get bounding radius from metadata
      const radius = metadataData[metadataOffset + 3];

      // Frustum culling with bounding sphere
      this.tempSphere.center.set(x, y, z);
      this.tempSphere.radius = radius;

      if (!this.frustum.intersectsSphere(this.tempSphere)) {
        continue; // Culled
      }

      // LOD selection based on distance
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

      // Add to visible list
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
   * Perform culling and update indirect draw arguments
   *
   * @param unitBuffer GPU unit buffer
   * @param camera Camera
   * @param indirectArgs Indirect args buffer to update
   * @param unitTypeCount Number of unit types
   */
  cullAndUpdateIndirect(
    unitBuffer: GPUUnitBuffer,
    camera: THREE.Camera,
    indirectArgs: ReturnType<typeof createIndirectArgsBuffer>,
    unitTypeCount: number
  ): CullingResult {
    // Reset instance counts
    indirectArgs.resetInstanceCounts();

    // Perform culling
    const result = this.cull(unitBuffer, camera);

    // Update indirect args instance counts
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
      indirectArgs.buffer[offset + 1] = count; // instanceCount
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
   * Get indirect storage buffer attribute
   */
  getIndirectAttribute(): any | null {
    return this.indirectArgsAttribute;
  }

  /**
   * Get visible indices buffer
   */
  getVisibleIndicesBuffer(): any | null {
    return this.visibleIndicesBuffer;
  }

  /**
   * Get transform storage node for vertex shader binding
   */
  getTransformStorage(): ReturnType<typeof storage> | null {
    return this.transformStorageBuffer;
  }

  /**
   * Get metadata storage node for vertex shader binding
   */
  getMetadataStorage(): ReturnType<typeof storage> | null {
    return this.metadataStorageBuffer;
  }

  /**
   * Get visible indices storage node for vertex shader binding
   */
  getVisibleIndicesStorage(): ReturnType<typeof storage> | null {
    return this.visibleIndicesStorage;
  }

  /**
   * Get indirect args data for CPU readback (debugging)
   */
  getIndirectArgsData(): Uint32Array | null {
    return this.indirectArgsData;
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
    this.visibleIndicesBuffer = null;
    this.indirectArgsAttribute = null;
    this.cullingComputeNode = null;
  }
}

/**
 * Visibility buffer for GPU-driven rendering
 *
 * Stores indices of visible units, grouped by (unitType, LOD, player).
 * Written by culling compute, read by vertex shader via instancing.
 */
export class VisibilityBuffer {
  private buffer: Uint32Array;
  private offsets: Map<string, number> = new Map(); // key -> start offset
  private counts: Map<string, number> = new Map();  // key -> count
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Uint32Array(capacity);
  }

  /**
   * Begin a new frame - reset all counts
   */
  beginFrame(): void {
    this.offsets.clear();
    this.counts.clear();
  }

  /**
   * Allocate space for a group and return the start offset
   */
  allocateGroup(unitType: number, lod: number, player: number, maxCount: number): number {
    const key = `${unitType}_${lod}_${player}`;

    // Calculate offset (after previous groups)
    let offset = 0;
    for (const [, existingOffset] of this.offsets) {
      const existingCount = this.counts.get(key) ?? 0;
      offset = Math.max(offset, existingOffset + existingCount);
    }

    this.offsets.set(key, offset);
    this.counts.set(key, 0);

    return offset;
  }

  /**
   * Add a visible index to a group
   */
  addVisible(unitType: number, lod: number, player: number, slotIndex: number): void {
    const key = `${unitType}_${lod}_${player}`;
    const offset = this.offsets.get(key);
    if (offset === undefined) return;

    const count = this.counts.get(key) ?? 0;
    if (offset + count >= this.capacity) return;

    this.buffer[offset + count] = slotIndex;
    this.counts.set(key, count + 1);
  }

  /**
   * Get the buffer
   */
  getBuffer(): Uint32Array {
    return this.buffer;
  }

  /**
   * Get count for a group
   */
  getCount(unitType: number, lod: number, player: number): number {
    return this.counts.get(`${unitType}_${lod}_${player}`) ?? 0;
  }

  /**
   * Get offset for a group
   */
  getOffset(unitType: number, lod: number, player: number): number {
    return this.offsets.get(`${unitType}_${lod}_${player}`) ?? 0;
  }
}

/**
 * Helper to extract frustum planes from camera
 * Returns 6 planes: left, right, bottom, top, near, far
 */
export function extractFrustumPlanes(camera: THREE.Camera): FrustumPlanes {
  const frustum = new THREE.Frustum();
  const matrix = new THREE.Matrix4();

  matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(matrix);

  return { planes: frustum.planes };
}

/**
 * Pack frustum planes into Float32Array for GPU upload
 * Each plane = vec4(normal.x, normal.y, normal.z, constant)
 */
export function packFrustumPlanes(planes: THREE.Plane[]): Float32Array {
  const data = new Float32Array(planes.length * 4);

  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i];
    data[i * 4 + 0] = plane.normal.x;
    data[i * 4 + 1] = plane.normal.y;
    data[i * 4 + 2] = plane.normal.z;
    data[i * 4 + 3] = plane.constant;
  }

  return data;
}

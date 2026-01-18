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
 * Currently uses optimized CPU fallback since Three.js TSL compute nodes
 * are still experimental. Structure is ready for GPU compute migration.
 */

import * as THREE from 'three';
import { GPUUnitBuffer, UnitSlot, createIndirectArgsBuffer } from './GPUUnitBuffer';

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
 * CPU-based culling compute
 *
 * Performs frustum culling and LOD selection on CPU.
 * Optimized with typed arrays and minimal allocations.
 */
export class CullingCompute {
  private lodConfig: LODConfig;
  private frustum: THREE.Frustum;
  private frustumMatrix: THREE.Matrix4;

  // Reusable vectors for culling tests
  private tempPosition: THREE.Vector3;
  private tempSphere: THREE.Sphere;

  // Cached results to avoid per-frame allocations
  private cachedVisibleSlots: UnitSlot[] = [];
  private cachedLODAssignments: Map<number, number> = new Map();

  constructor(lodConfig: LODConfig = DEFAULT_LOD_CONFIG) {
    this.lodConfig = lodConfig;
    this.frustum = new THREE.Frustum();
    this.frustumMatrix = new THREE.Matrix4();
    this.tempPosition = new THREE.Vector3();
    this.tempSphere = new THREE.Sphere();
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
  }

  /**
   * Update LOD configuration
   */
  setLODConfig(config: LODConfig): void {
    this.lodConfig = config;
  }

  /**
   * Perform culling on all units in the buffer
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
   * Dispose resources
   */
  dispose(): void {
    this.cachedVisibleSlots.length = 0;
    this.cachedLODAssignments.clear();
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

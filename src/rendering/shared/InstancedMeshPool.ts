/**
 * InstancedMeshPool - Shared utilities for instanced mesh management
 *
 * Provides reusable transform calculation objects and common instanced mesh operations.
 * Used by both UnitRenderer and BuildingRenderer to reduce code duplication.
 */

import * as THREE from 'three';

/**
 * Shared transform calculation utilities.
 * Pre-allocates reusable objects to avoid GC pressure during frame updates.
 */
export class TransformUtils {
  // Reusable objects for matrix calculations
  public readonly tempMatrix: THREE.Matrix4 = new THREE.Matrix4();
  public readonly tempPosition: THREE.Vector3 = new THREE.Vector3();
  public readonly tempQuaternion: THREE.Quaternion = new THREE.Quaternion();
  public readonly tempScale: THREE.Vector3 = new THREE.Vector3(1, 1, 1);
  public readonly tempEuler: THREE.Euler = new THREE.Euler();

  // Additional temp objects for complex calculations
  public readonly tempFacingQuat: THREE.Quaternion = new THREE.Quaternion();
  public readonly tempDirection: THREE.Vector3 = new THREE.Vector3();

  // Pre-computed rotation for flat ground overlays (rings, markers)
  public readonly groundOverlayRotation: THREE.Quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0)
  );

  /**
   * Compose a transform matrix from position, Y rotation, and uniform scale.
   */
  public composeYRotation(x: number, y: number, z: number, rotationY: number, scale: number): THREE.Matrix4 {
    this.tempPosition.set(x, y, z);
    this.tempEuler.set(0, rotationY, 0);
    this.tempQuaternion.setFromEuler(this.tempEuler);
    this.tempScale.setScalar(scale);
    return this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
  }

  /**
   * Compose a transform matrix from position, quaternion, and uniform scale.
   */
  public composeQuaternion(x: number, y: number, z: number, quaternion: THREE.Quaternion, scale: number): THREE.Matrix4 {
    this.tempPosition.set(x, y, z);
    this.tempScale.setScalar(scale);
    return this.tempMatrix.compose(this.tempPosition, quaternion, this.tempScale);
  }

  /**
   * Compose a transform matrix for a flat ground overlay (rotated to lie on XZ plane).
   */
  public composeGroundOverlay(x: number, y: number, z: number, scale: number): THREE.Matrix4 {
    this.tempPosition.set(x, y, z);
    this.tempScale.set(scale, scale, 1);
    return this.tempMatrix.compose(this.tempPosition, this.groundOverlayRotation, this.tempScale);
  }

  /**
   * Compose a transform matrix with full control over position, quaternion, and non-uniform scale.
   */
  public composeFull(
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    scale: THREE.Vector3
  ): THREE.Matrix4 {
    return this.tempMatrix.compose(position, quaternion, scale);
  }
}

/**
 * Utility functions for instanced mesh management
 */
export const InstancedMeshUtils = {
  /**
   * Reset an instanced mesh for a new frame.
   * Clears count and entity ID tracking array.
   */
  resetInstancedMesh(mesh: THREE.InstancedMesh, entityIds: number[]): void {
    mesh.count = 0;
    entityIds.length = 0;
  },

  /**
   * Mark instanced mesh matrices as needing update.
   * Should be called after setting all instance matrices for a frame.
   */
  markMatricesForUpdate(mesh: THREE.InstancedMesh): void {
    mesh.instanceMatrix.needsUpdate = true;
  },

  /**
   * Dispose an instanced mesh's materials (not geometry - may be shared).
   */
  disposeMaterialsOnly(mesh: THREE.InstancedMesh): void {
    if (mesh.material instanceof THREE.Material) {
      mesh.material.dispose();
    } else if (Array.isArray(mesh.material)) {
      mesh.material.forEach(m => m.dispose());
    }
  },

  /**
   * Dispose an instanced mesh completely (including geometry).
   * Only use when geometry is not shared with asset cache.
   */
  disposeCompletely(mesh: THREE.InstancedMesh): void {
    mesh.geometry.dispose();
    this.disposeMaterialsOnly(mesh);
  },

  /**
   * Create an instanced mesh with standard settings for entity rendering.
   */
  createStandardInstancedMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    maxInstances: number,
    options: {
      castShadow?: boolean;
      receiveShadow?: boolean;
      frustumCulled?: boolean;
      renderOrder?: number;
    } = {}
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
    mesh.count = 0;
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.frustumCulled = options.frustumCulled ?? false; // We handle culling ourselves
    if (options.renderOrder !== undefined) {
      mesh.renderOrder = options.renderOrder;
    }
    return mesh;
  },
};

/**
 * Cached terrain height tracker.
 * Avoids recalculating terrain height every frame for stationary or slowly moving entities.
 */
export class CachedTerrainHeight {
  private cachedHeight: number = 0;
  private lastX: number = -99999;
  private lastY: number = -99999;
  private readonly threshold: number;

  /**
   * @param threshold - Minimum position change to trigger recalculation
   */
  constructor(threshold: number = 0.5) {
    this.threshold = threshold;
  }

  /**
   * Get cached terrain height, recalculating if position changed significantly.
   * @param x - Current X position
   * @param y - Current Y position (world Z)
   * @param getHeightFn - Function to get terrain height at position
   */
  public getHeight(x: number, y: number, getHeightFn: (x: number, y: number) => number): number {
    const dx = Math.abs(x - this.lastX);
    const dy = Math.abs(y - this.lastY);

    if (dx > this.threshold || dy > this.threshold) {
      this.cachedHeight = getHeightFn(x, y);
      this.lastX = x;
      this.lastY = y;
    }

    return this.cachedHeight;
  }

  /**
   * Force update the cached height (useful when terrain changes).
   */
  public forceUpdate(x: number, y: number, height: number): void {
    this.cachedHeight = height;
    this.lastX = x;
    this.lastY = y;
  }

  /**
   * Reset the cache (forces recalculation on next getHeight call).
   */
  public reset(): void {
    this.lastX = -99999;
    this.lastY = -99999;
  }
}

/**
 * Smooth rotation interpolation utility.
 * Provides frame-rate independent smooth rotation with proper angle wrapping.
 */
export class SmoothRotation {
  private visualRotations: Map<number, number> = new Map();
  private readonly smoothFactor: number;

  /**
   * @param smoothFactor - Interpolation factor (0.1=slow, 0.3=fast)
   */
  constructor(smoothFactor: number = 0.15) {
    this.smoothFactor = smoothFactor;
  }

  /**
   * Get smoothly interpolated rotation for an entity.
   * @param entityId - Entity identifier
   * @param targetRotation - Target rotation in radians
   */
  public getSmoothRotation(entityId: number, targetRotation: number): number {
    let visualRotation = this.visualRotations.get(entityId);

    if (visualRotation === undefined) {
      // First time seeing this entity - snap to target
      this.visualRotations.set(entityId, targetRotation);
      return targetRotation;
    }

    // Calculate shortest angular distance (handling wrap-around at ±π)
    let diff = targetRotation - visualRotation;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    // If very close, snap to target to avoid jitter
    if (Math.abs(diff) < 0.01) {
      this.visualRotations.set(entityId, targetRotation);
      return targetRotation;
    }

    // Exponential smoothing toward target
    visualRotation += diff * this.smoothFactor;

    // Normalize to [-π, π]
    while (visualRotation > Math.PI) visualRotation -= Math.PI * 2;
    while (visualRotation < -Math.PI) visualRotation += Math.PI * 2;

    this.visualRotations.set(entityId, visualRotation);
    return visualRotation;
  }

  /**
   * Remove rotation tracking for an entity (cleanup when entity is destroyed).
   */
  public remove(entityId: number): void {
    this.visualRotations.delete(entityId);
  }

  /**
   * Clear all rotation tracking.
   */
  public clear(): void {
    this.visualRotations.clear();
  }

  /**
   * Check if an entity is being tracked.
   */
  public has(entityId: number): boolean {
    return this.visualRotations.has(entityId);
  }

  /**
   * Get all tracked entity IDs (for cleanup iteration).
   */
  public keys(): IterableIterator<number> {
    return this.visualRotations.keys();
  }
}

/**
 * Entity ID set tracker.
 * Pre-allocated Set for tracking current entity IDs to avoid per-frame allocation.
 */
export class EntityIdTracker {
  private readonly currentIds: Set<number> = new Set();

  /**
   * Clear the set for a new frame.
   */
  public reset(): void {
    this.currentIds.clear();
  }

  /**
   * Add an entity ID to the current frame's set.
   */
  public add(entityId: number): void {
    this.currentIds.add(entityId);
  }

  /**
   * Check if an entity ID is in the current frame's set.
   */
  public has(entityId: number): boolean {
    return this.currentIds.has(entityId);
  }

  /**
   * Get the underlying Set (for iteration).
   */
  public getSet(): Set<number> {
    return this.currentIds;
  }
}

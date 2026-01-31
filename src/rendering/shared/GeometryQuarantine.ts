import * as THREE from 'three';

/**
 * WebGPU Geometry Disposal Safety Utilities
 *
 * WebGPU maintains 2-3 frames of commands in flight before GPU execution.
 * If geometry is disposed while still in the GPU's pending command queue,
 * WebGPU crashes with "setIndexBuffer: parameter 1 is not of type 'GPUBuffer'".
 *
 * This module provides two patterns for safe geometry disposal:
 *
 * 1. GeometryQuarantine class - for use during normal operation
 *    Queue geometry for delayed disposal, process each frame
 *
 * 2. scheduleGeometryDisposal() - for use during teardown (dispose())
 *    Uses setTimeout to delay disposal when no update loop is running
 */

/**
 * Number of frames to wait before disposing geometry.
 * WebGPU typically has 2-3 frames in flight; 4 frames provides safety margin.
 */
export const GEOMETRY_QUARANTINE_FRAMES = 4;

/**
 * Milliseconds to delay disposal during teardown.
 * ~100ms = 6 frames at 60fps, provides margin for GPU to finish.
 */
const DISPOSAL_DELAY_MS = 100;

/**
 * Entry in the geometry quarantine queue
 */
interface QuarantineEntry {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  frameQueued: number;
}

/**
 * Manages delayed geometry disposal during normal operation.
 * Use this class when you have an update loop running.
 *
 * Usage:
 * 1. In constructor: this.quarantine = new GeometryQuarantine();
 * 2. When disposing: this.quarantine.queue(geometry, materials);
 * 3. In update(): this.quarantine.process(this.frameCount);
 * 4. In dispose(): this.quarantine.dispose(); // immediate flush
 */
export class GeometryQuarantine {
  private queue: QuarantineEntry[] = [];

  /**
   * Queue geometry and materials for delayed disposal.
   * @param geometry The geometry to dispose
   * @param materials Single material or array of materials to dispose
   * @param currentFrame Current frame number for timing
   */
  public queueForDisposal(
    geometry: THREE.BufferGeometry,
    materials: THREE.Material | THREE.Material[],
    currentFrame: number
  ): void {
    const materialArray = Array.isArray(materials) ? materials : [materials];
    this.queue.push({
      geometry,
      materials: materialArray,
      frameQueued: currentFrame,
    });
  }

  /**
   * Process quarantined geometries and dispose those that are safe.
   * Call this once per frame at the START of update().
   * @param currentFrame Current frame number
   */
  public process(currentFrame: number): void {
    let writeIndex = 0;
    for (let i = 0; i < this.queue.length; i++) {
      const entry = this.queue[i];
      const framesInQuarantine = currentFrame - entry.frameQueued;

      if (framesInQuarantine >= GEOMETRY_QUARANTINE_FRAMES) {
        // Safe to dispose - GPU has finished with these buffers
        entry.geometry.dispose();
        for (const material of entry.materials) {
          material.dispose();
        }
      } else {
        // Keep in quarantine
        this.queue[writeIndex++] = entry;
      }
    }
    this.queue.length = writeIndex;
  }

  /**
   * Get number of items currently in quarantine.
   * Useful for debugging and stats.
   */
  public getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Flush all pending geometries immediately.
   * Use during dispose() when no more updates will occur.
   * WARNING: This may cause WebGPU crashes if called while rendering.
   * Only use after removing all objects from scene.
   */
  public flushImmediate(): void {
    for (const entry of this.queue) {
      entry.geometry.dispose();
      for (const material of entry.materials) {
        material.dispose();
      }
    }
    this.queue.length = 0;
  }

  /**
   * Schedule all pending geometries for delayed disposal.
   * Use during dispose() to safely dispose without blocking.
   */
  public flushDelayed(): void {
    const entries = [...this.queue];
    this.queue.length = 0;

    setTimeout(() => {
      for (const entry of entries) {
        entry.geometry.dispose();
        for (const material of entry.materials) {
          material.dispose();
        }
      }
    }, DISPOSAL_DELAY_MS);
  }
}

/**
 * Schedule geometry for delayed disposal.
 * Use this during dispose() when there's no update loop running.
 *
 * This is safer than immediate disposal because WebGPU may still have
 * in-flight commands even after scene.remove(). The setTimeout ensures
 * the GPU has finished processing before we free the buffers.
 *
 * @param geometry The geometry to dispose
 * @param materials Optional materials to dispose with the geometry
 */
export function scheduleGeometryDisposal(
  geometry: THREE.BufferGeometry,
  materials?: THREE.Material | THREE.Material[]
): void {
  setTimeout(() => {
    geometry.dispose();
    if (materials) {
      const mats = Array.isArray(materials) ? materials : [materials];
      for (const mat of mats) {
        mat.dispose();
      }
    }
  }, DISPOSAL_DELAY_MS);
}

/**
 * Schedule multiple geometries for delayed disposal.
 * More efficient than calling scheduleGeometryDisposal multiple times.
 *
 * @param items Array of geometry/material pairs to dispose
 */
export function scheduleMultipleGeometryDisposal(
  items: Array<{
    geometry: THREE.BufferGeometry;
    materials?: THREE.Material | THREE.Material[];
  }>
): void {
  setTimeout(() => {
    for (const item of items) {
      item.geometry.dispose();
      if (item.materials) {
        const mats = Array.isArray(item.materials) ? item.materials : [item.materials];
        for (const mat of mats) {
          mat.dispose();
        }
      }
    }
  }, DISPOSAL_DELAY_MS);
}

/**
 * Dispose an Object3D hierarchy with delayed geometry disposal.
 * Removes from scene immediately but delays geometry/material disposal.
 *
 * @param object The Object3D to dispose
 * @param scene The scene to remove from (or null if already removed)
 */
export function disposeObject3DDelayed(
  object: THREE.Object3D,
  scene: THREE.Scene | null
): void {
  // Remove from scene immediately (stops rendering)
  if (scene) {
    scene.remove(object);
  }

  // Collect all geometries and materials
  const items: Array<{
    geometry: THREE.BufferGeometry;
    materials?: THREE.Material | THREE.Material[];
  }> = [];

  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
      items.push({
        geometry: child.geometry,
        materials: child.material,
      });
    } else if (child instanceof THREE.Points) {
      items.push({
        geometry: child.geometry,
        materials: child.material as THREE.Material,
      });
    } else if (child instanceof THREE.Line) {
      items.push({
        geometry: child.geometry,
        materials: child.material as THREE.Material,
      });
    }
  });

  // Schedule delayed disposal
  if (items.length > 0) {
    scheduleMultipleGeometryDisposal(items);
  }
}

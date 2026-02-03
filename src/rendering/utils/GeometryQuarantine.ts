import * as THREE from 'three';

/**
 * Geometry disposal quarantine for WebGPU safety.
 *
 * WebGPU may have 2-3 frames in flight at any time. Disposing geometry
 * while the GPU is still rendering it causes "setIndexBuffer" crashes.
 * This utility delays disposal until the GPU has finished pending draw commands.
 *
 * Usage:
 * ```ts
 * class MyRenderer {
 *   private quarantine = new GeometryQuarantine();
 *
 *   update() {
 *     this.quarantine.processFrame();
 *     // ... render logic
 *   }
 *
 *   replaceGeometry(oldGeom: THREE.BufferGeometry, oldMats: THREE.Material[]) {
 *     this.quarantine.queue(oldGeom, oldMats);
 *   }
 *
 *   dispose() {
 *     this.quarantine.disposeAll();
 *   }
 * }
 * ```
 */
export class GeometryQuarantine {
  private queue: Array<{
    geometry: THREE.BufferGeometry;
    materials: THREE.Material[];
    frameQueued: number;
  }> = [];

  private frameCount = 0;

  /** Number of frames to wait before disposing (default 4 for safety margin) */
  public quarantineFrames: number;

  constructor(quarantineFrames = 4) {
    this.quarantineFrames = quarantineFrames;
  }

  /**
   * Queue geometry and materials for delayed disposal.
   */
  public queueForDisposal(
    geometry: THREE.BufferGeometry,
    materials: THREE.Material[] = []
  ): void {
    this.queue.push({
      geometry,
      materials,
      frameQueued: this.frameCount,
    });
  }

  /**
   * Process the quarantine queue - call once per frame.
   * Disposes items that have been queued long enough.
   */
  public processFrame(): void {
    this.frameCount++;

    let writeIndex = 0;
    for (let i = 0; i < this.queue.length; i++) {
      const entry = this.queue[i];
      const framesInQuarantine = this.frameCount - entry.frameQueued;

      if (framesInQuarantine >= this.quarantineFrames) {
        // Safe to dispose now
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
   * Immediately dispose all queued items (for cleanup on destroy).
   */
  public disposeAll(): void {
    for (const entry of this.queue) {
      entry.geometry.dispose();
      for (const material of entry.materials) {
        material.dispose();
      }
    }
    this.queue = [];
  }

  /**
   * Get current queue size (for debugging).
   */
  public get queueSize(): number {
    return this.queue.length;
  }
}

// Shared frame counter for modules that use the global pattern
let _globalFrameCount = 0;

/**
 * Increment the global frame counter.
 * Call once per frame before processing any quarantine queues.
 */
export function incrementGlobalFrame(): void {
  _globalFrameCount++;
}

/**
 * Get the current global frame count.
 */
export function getGlobalFrameCount(): number {
  return _globalFrameCount;
}

/**
 * InstancedVelocity - TAA velocity for InstancedMesh
 *
 * Uses zero-velocity mode for optimal performance. TRAA's depth-based
 * reprojection handles camera motion, and temporal accumulation works
 * well for slow-moving RTS units.
 *
 * The setup/swap functions are no-ops but kept for API compatibility.
 */

import * as THREE from 'three';
import { Fn, vec2 } from 'three/tsl';

/**
 * No-op: Velocity attributes not needed in zero-velocity mode
 */
export function setupInstancedVelocity(_mesh: THREE.InstancedMesh): void {
  // No-op: zero velocity mode doesn't need attributes
}

/**
 * No-op: Matrix swapping not needed in zero-velocity mode
 */
export function swapInstanceMatrices(_mesh: THREE.InstancedMesh): void {
  // No-op: zero velocity mode doesn't track matrices
}

/**
 * No-op: Camera matrix tracking not needed in zero-velocity mode
 */
export function updateCameraMatrices(_camera: THREE.Camera): void {
  // No-op: zero velocity mode relies on depth reprojection
}

/**
 * No-op: Camera initialization not needed in zero-velocity mode
 */
export function initCameraMatrices(_camera: THREE.Camera): void {
  // No-op: zero velocity mode relies on depth reprojection
}

/**
 * No-op: Nothing to dispose in zero-velocity mode
 */
export function disposeInstancedVelocity(_mesh: THREE.InstancedMesh): void {
  // No-op: no attributes to clean up
}

/**
 * Create a TSL velocity node that returns zero velocity.
 *
 * TRAA's depth-based reprojection handles camera motion perfectly.
 * For RTS games with slow-moving units, temporal accumulation works
 * well without explicit velocity vectors.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createInstancedVelocityNode(): any {
  return Fn(() => vec2(0.0, 0.0))();
}

/**
 * InstancedVelocity - Proper per-instance velocity for TAA with InstancedMesh
 *
 * Three.js's built-in VelocityNode doesn't work for InstancedMesh because it only
 * tracks per-object transforms, not per-instance. This module provides correct
 * per-instance velocity by:
 *
 * 1. Storing BOTH current and previous instance matrices as attributes
 * 2. Using IDENTICAL code paths to read and transform both (eliminates precision issues)
 * 3. Only computing velocity for meshes with our attributes (static meshes get zero)
 *
 * The key insight: Floating-point precision differences between code paths caused
 * micro-jitter. By storing both matrices as attributes and reading them identically,
 * we eliminate any precision differences.
 *
 * Usage:
 * - setupInstancedVelocity(mesh) - Add matrix attributes after creating mesh
 * - swapInstanceMatrices(mesh) - Call at START of frame (prev = curr)
 * - commitInstanceMatrices(mesh) - Call AFTER updating matrices, BEFORE render (curr = mesh.instanceMatrix)
 */

import * as THREE from 'three';
import { Fn, vec2, vec4, mat4, attribute } from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as TSL from 'three/tsl';
const cameraProjectionMatrix = (TSL as any).cameraProjectionMatrix;
const cameraViewMatrix = (TSL as any).cameraViewMatrix;
const modelWorldMatrix = (TSL as any).modelWorldMatrix;
const positionGeometry = (TSL as any).positionGeometry;
const uniform = (TSL as any).uniform;

// Track which meshes have velocity setup
const velocitySetupMeshes = new WeakSet<THREE.InstancedMesh>();

// Camera matrix uniforms (shared across all meshes)
// These are set directly after each frame's render, to be used as "previous" in next frame
const uPrevProjectionMatrix = uniform(new THREE.Matrix4());
const uPrevViewMatrix = uniform(new THREE.Matrix4());

/**
 * Set up velocity attributes for an InstancedMesh.
 * Creates both current and previous instance matrix attributes.
 */
export function setupInstancedVelocity(mesh: THREE.InstancedMesh): void {
  if (velocitySetupMeshes.has(mesh)) {
    return;
  }

  const count = mesh.instanceMatrix.count;

  // Create current instance matrix attributes (4 vec4 columns)
  const currAttr0 = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const currAttr1 = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const currAttr2 = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const currAttr3 = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);

  // Create previous instance matrix attributes (4 vec4 columns)
  const prevAttr0 = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const prevAttr1 = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const prevAttr2 = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const prevAttr3 = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);

  // Initialize with identity matrices
  for (let i = 0; i < count; i++) {
    // Identity matrix columns
    currAttr0.setXYZW(i, 1, 0, 0, 0);
    currAttr1.setXYZW(i, 0, 1, 0, 0);
    currAttr2.setXYZW(i, 0, 0, 1, 0);
    currAttr3.setXYZW(i, 0, 0, 0, 1);
    prevAttr0.setXYZW(i, 1, 0, 0, 0);
    prevAttr1.setXYZW(i, 0, 1, 0, 0);
    prevAttr2.setXYZW(i, 0, 0, 1, 0);
    prevAttr3.setXYZW(i, 0, 0, 0, 1);
  }

  mesh.geometry.setAttribute('currInstanceMatrix0', currAttr0);
  mesh.geometry.setAttribute('currInstanceMatrix1', currAttr1);
  mesh.geometry.setAttribute('currInstanceMatrix2', currAttr2);
  mesh.geometry.setAttribute('currInstanceMatrix3', currAttr3);
  mesh.geometry.setAttribute('prevInstanceMatrix0', prevAttr0);
  mesh.geometry.setAttribute('prevInstanceMatrix1', prevAttr1);
  mesh.geometry.setAttribute('prevInstanceMatrix2', prevAttr2);
  mesh.geometry.setAttribute('prevInstanceMatrix3', prevAttr3);

  velocitySetupMeshes.add(mesh);
}

/**
 * Swap matrices: previous = current
 * Call at START of frame, BEFORE updating instance matrices.
 */
export function swapInstanceMatrices(mesh: THREE.InstancedMesh): void {
  if (!velocitySetupMeshes.has(mesh)) return;

  const count = mesh.count;
  const curr0 = mesh.geometry.getAttribute('currInstanceMatrix0') as THREE.InstancedBufferAttribute;
  const curr1 = mesh.geometry.getAttribute('currInstanceMatrix1') as THREE.InstancedBufferAttribute;
  const curr2 = mesh.geometry.getAttribute('currInstanceMatrix2') as THREE.InstancedBufferAttribute;
  const curr3 = mesh.geometry.getAttribute('currInstanceMatrix3') as THREE.InstancedBufferAttribute;
  const prev0 = mesh.geometry.getAttribute('prevInstanceMatrix0') as THREE.InstancedBufferAttribute;
  const prev1 = mesh.geometry.getAttribute('prevInstanceMatrix1') as THREE.InstancedBufferAttribute;
  const prev2 = mesh.geometry.getAttribute('prevInstanceMatrix2') as THREE.InstancedBufferAttribute;
  const prev3 = mesh.geometry.getAttribute('prevInstanceMatrix3') as THREE.InstancedBufferAttribute;

  // Copy current to previous
  for (let i = 0; i < count; i++) {
    prev0.setXYZW(i, curr0.getX(i), curr0.getY(i), curr0.getZ(i), curr0.getW(i));
    prev1.setXYZW(i, curr1.getX(i), curr1.getY(i), curr1.getZ(i), curr1.getW(i));
    prev2.setXYZW(i, curr2.getX(i), curr2.getY(i), curr2.getZ(i), curr2.getW(i));
    prev3.setXYZW(i, curr3.getX(i), curr3.getY(i), curr3.getZ(i), curr3.getW(i));
  }

  prev0.needsUpdate = true;
  prev1.needsUpdate = true;
  prev2.needsUpdate = true;
  prev3.needsUpdate = true;
}

/**
 * Commit current matrices: current attrs = mesh.instanceMatrix
 * Call AFTER updating instance matrices, BEFORE render.
 */
export function commitInstanceMatrices(mesh: THREE.InstancedMesh): void {
  if (!velocitySetupMeshes.has(mesh)) return;

  const instanceMatrix = mesh.instanceMatrix.array as Float32Array;
  const count = mesh.count;

  const curr0 = mesh.geometry.getAttribute('currInstanceMatrix0') as THREE.InstancedBufferAttribute;
  const curr1 = mesh.geometry.getAttribute('currInstanceMatrix1') as THREE.InstancedBufferAttribute;
  const curr2 = mesh.geometry.getAttribute('currInstanceMatrix2') as THREE.InstancedBufferAttribute;
  const curr3 = mesh.geometry.getAttribute('currInstanceMatrix3') as THREE.InstancedBufferAttribute;

  // Copy mesh.instanceMatrix to current attributes
  for (let i = 0; i < count; i++) {
    const offset = i * 16;
    // Matrix is column-major: 0-3 = col0, 4-7 = col1, 8-11 = col2, 12-15 = col3
    curr0.setXYZW(i, instanceMatrix[offset], instanceMatrix[offset + 1], instanceMatrix[offset + 2], instanceMatrix[offset + 3]);
    curr1.setXYZW(i, instanceMatrix[offset + 4], instanceMatrix[offset + 5], instanceMatrix[offset + 6], instanceMatrix[offset + 7]);
    curr2.setXYZW(i, instanceMatrix[offset + 8], instanceMatrix[offset + 9], instanceMatrix[offset + 10], instanceMatrix[offset + 11]);
    curr3.setXYZW(i, instanceMatrix[offset + 12], instanceMatrix[offset + 13], instanceMatrix[offset + 14], instanceMatrix[offset + 15]);
  }

  curr0.needsUpdate = true;
  curr1.needsUpdate = true;
  curr2.needsUpdate = true;
  curr3.needsUpdate = true;
}

/**
 * Update camera matrices for velocity calculation.
 * Call at END of frame, after render.
 *
 * Sets the uniforms directly to the current camera matrices.
 * Next frame will use these as "previous" camera position.
 */
export function updateCameraMatrices(camera: THREE.Camera): void {
  // Store current camera for next frame's "previous" calculation
  uPrevProjectionMatrix.value.copy(camera.projectionMatrix);
  uPrevViewMatrix.value.copy(camera.matrixWorldInverse);
}

/**
 * Initialize camera matrices. Call once at startup.
 * Sets "previous" to current so first frame has zero velocity.
 */
export function initCameraMatrices(camera: THREE.Camera): void {
  uPrevProjectionMatrix.value.copy(camera.projectionMatrix);
  uPrevViewMatrix.value.copy(camera.matrixWorldInverse);
}

/**
 * Clean up velocity attributes.
 */
export function disposeInstancedVelocity(mesh: THREE.InstancedMesh): void {
  velocitySetupMeshes.delete(mesh);
}

/**
 * Create velocity node for TAA.
 *
 * For meshes with velocity setup: Computes proper per-instance velocity using
 * identical code paths for current and previous (no precision issues).
 *
 * For meshes without velocity setup: Returns zero velocity (depth reprojection
 * handles camera motion).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createInstancedVelocityNode(): any {
  return Fn(() => {
    // Read current instance matrix from attributes
    const currCol0 = attribute('currInstanceMatrix0', 'vec4');
    const currCol1 = attribute('currInstanceMatrix1', 'vec4');
    const currCol2 = attribute('currInstanceMatrix2', 'vec4');
    const currCol3 = attribute('currInstanceMatrix3', 'vec4');
    const currInstanceMatrix = mat4(currCol0, currCol1, currCol2, currCol3);

    // Read previous instance matrix from attributes
    const prevCol0 = attribute('prevInstanceMatrix0', 'vec4');
    const prevCol1 = attribute('prevInstanceMatrix1', 'vec4');
    const prevCol2 = attribute('prevInstanceMatrix2', 'vec4');
    const prevCol3 = attribute('prevInstanceMatrix3', 'vec4');
    const prevInstanceMatrix = mat4(prevCol0, prevCol1, prevCol2, prevCol3);

    // Check if attributes exist (valid matrix has w=1 in last column)
    // If not, return zero velocity (non-instanced meshes, or meshes without setup)
    const hasVelocity = currCol3.w;

    // Get raw vertex position (before any instance transform)
    const rawPosition = positionGeometry;

    // === Current position (identical code path) ===
    const currInstancePos = currInstanceMatrix.mul(vec4(rawPosition, 1.0));
    const currWorldPos = modelWorldMatrix.mul(currInstancePos);
    const currViewPos = cameraViewMatrix.mul(currWorldPos);
    const currClipPos = cameraProjectionMatrix.mul(currViewPos);
    const currNDC = currClipPos.xy.div(currClipPos.w);

    // === Previous position (identical code path) ===
    const prevInstancePos = prevInstanceMatrix.mul(vec4(rawPosition, 1.0));
    const prevWorldPos = modelWorldMatrix.mul(prevInstancePos); // Assuming object doesn't move
    const prevViewPos = uPrevViewMatrix.mul(prevWorldPos);
    const prevClipPos = uPrevProjectionMatrix.mul(prevViewPos);
    const prevNDC = prevClipPos.xy.div(prevClipPos.w);

    // Velocity = current - previous
    const velocity = currNDC.sub(prevNDC);

    // Return velocity if we have valid attributes, zero otherwise
    // hasVelocity will be 1.0 for valid matrices, 0.0 for missing attributes
    return velocity.mul(hasVelocity);
  })();
}

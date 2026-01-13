/**
 * InstancedVelocity - Per-instance velocity for TAA with InstancedMesh
 *
 * Three.js's built-in velocity buffer calculates motion from matrixWorld,
 * but InstancedMesh stores per-instance transforms in instanceMatrix.
 * This module provides proper per-instance velocity by:
 *
 * 1. Storing previous frame's instance matrices
 * 2. Computing velocity per-instance in the vertex shader
 * 3. Outputting via MRT for TRAA to use
 *
 * Usage:
 * - Call setupInstancedVelocity(mesh) after creating an InstancedMesh
 * - Call swapInstanceMatrices(mesh) at the START of each frame before updating matrices
 * - Enable MRT in PostProcessing with velocity output
 */

import * as THREE from 'three';
import {
  Fn,
  vec2,
  vec4,
  mat4,
  attribute,
  positionLocal,
  uniform,
  float,
  abs,
  max,
} from 'three/tsl';

// Import TSL values not in @types/three
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as TSL from 'three/tsl';
const modelWorldMatrix = (TSL as any).modelWorldMatrix;
const modelViewMatrix = (TSL as any).modelViewMatrix;
const cameraProjectionMatrix = (TSL as any).cameraProjectionMatrix;
const cameraViewMatrix = (TSL as any).cameraViewMatrix;
const select = (TSL as any).select;

// WeakMap to track which meshes have velocity setup
const velocitySetupMeshes = new WeakSet<THREE.InstancedMesh>();

// Previous camera matrices (shared across all meshes)
let previousProjectionMatrix = new THREE.Matrix4();
let previousViewMatrix = new THREE.Matrix4();
let currentProjectionMatrix = new THREE.Matrix4();
let currentViewMatrix = new THREE.Matrix4();

// TSL uniforms for camera matrices (used by velocity node)
const uPreviousProjectionMatrix = uniform(previousProjectionMatrix);
const uPreviousViewMatrix = uniform(previousViewMatrix);

// Note: Previous instance matrix attributes are stored as:
// prevInstanceMatrix0, prevInstanceMatrix1, prevInstanceMatrix2, prevInstanceMatrix3
// Each is a vec4 representing one column of the 4x4 matrix

/**
 * Set up previous instance matrix attribute for an InstancedMesh
 * Must be called after creating the mesh, before first render
 */
export function setupInstancedVelocity(mesh: THREE.InstancedMesh): void {
  if (velocitySetupMeshes.has(mesh)) {
    return; // Already set up
  }

  const maxInstances = mesh.instanceMatrix.count;

  // Create 4 vec4 attributes for previous instance matrix columns
  // TSL will reconstruct mat4 from these 4 columns
  const prevMatrixAttr0 = new THREE.InstancedBufferAttribute(
    new Float32Array(maxInstances * 4), 4
  );
  const prevMatrixAttr1 = new THREE.InstancedBufferAttribute(
    new Float32Array(maxInstances * 4), 4
  );
  const prevMatrixAttr2 = new THREE.InstancedBufferAttribute(
    new Float32Array(maxInstances * 4), 4
  );
  const prevMatrixAttr3 = new THREE.InstancedBufferAttribute(
    new Float32Array(maxInstances * 4), 4
  );

  // Initialize with identity matrix columns
  for (let i = 0; i < maxInstances; i++) {
    prevMatrixAttr0.setXYZW(i, 1, 0, 0, 0); // Column 0
    prevMatrixAttr1.setXYZW(i, 0, 1, 0, 0); // Column 1
    prevMatrixAttr2.setXYZW(i, 0, 0, 1, 0); // Column 2
    prevMatrixAttr3.setXYZW(i, 0, 0, 0, 1); // Column 3
  }

  mesh.geometry.setAttribute('prevInstanceMatrix0', prevMatrixAttr0);
  mesh.geometry.setAttribute('prevInstanceMatrix1', prevMatrixAttr1);
  mesh.geometry.setAttribute('prevInstanceMatrix2', prevMatrixAttr2);
  mesh.geometry.setAttribute('prevInstanceMatrix3', prevMatrixAttr3);

  velocitySetupMeshes.add(mesh);
}

/**
 * Swap current instance matrices to previous
 * Must be called at the START of each frame, BEFORE updating instance matrices
 */
export function swapInstanceMatrices(mesh: THREE.InstancedMesh): void {
  if (!velocitySetupMeshes.has(mesh)) {
    console.warn('[InstancedVelocity] Mesh not set up for velocity. Call setupInstancedVelocity first.');
    return;
  }

  const currentMatrix = mesh.instanceMatrix.array as Float32Array;
  const count = mesh.count;

  const prevAttr0 = mesh.geometry.getAttribute('prevInstanceMatrix0') as THREE.InstancedBufferAttribute;
  const prevAttr1 = mesh.geometry.getAttribute('prevInstanceMatrix1') as THREE.InstancedBufferAttribute;
  const prevAttr2 = mesh.geometry.getAttribute('prevInstanceMatrix2') as THREE.InstancedBufferAttribute;
  const prevAttr3 = mesh.geometry.getAttribute('prevInstanceMatrix3') as THREE.InstancedBufferAttribute;

  // Copy current matrices to previous (column by column)
  for (let i = 0; i < count; i++) {
    const offset = i * 16;
    // Matrix is column-major: elements 0-3 are column 0, 4-7 are column 1, etc.
    prevAttr0.setXYZW(i, currentMatrix[offset], currentMatrix[offset + 1], currentMatrix[offset + 2], currentMatrix[offset + 3]);
    prevAttr1.setXYZW(i, currentMatrix[offset + 4], currentMatrix[offset + 5], currentMatrix[offset + 6], currentMatrix[offset + 7]);
    prevAttr2.setXYZW(i, currentMatrix[offset + 8], currentMatrix[offset + 9], currentMatrix[offset + 10], currentMatrix[offset + 11]);
    prevAttr3.setXYZW(i, currentMatrix[offset + 12], currentMatrix[offset + 13], currentMatrix[offset + 14], currentMatrix[offset + 15]);
  }

  prevAttr0.needsUpdate = true;
  prevAttr1.needsUpdate = true;
  prevAttr2.needsUpdate = true;
  prevAttr3.needsUpdate = true;
}

/**
 * Update camera matrices for velocity calculation
 * Call this at the END of each frame after rendering
 */
export function updateCameraMatrices(camera: THREE.Camera): void {
  // Store current as previous for next frame
  previousProjectionMatrix.copy(currentProjectionMatrix);
  previousViewMatrix.copy(currentViewMatrix);

  // Update current
  currentProjectionMatrix.copy(camera.projectionMatrix);
  currentViewMatrix.copy(camera.matrixWorldInverse);

  // Update TSL uniforms
  uPreviousProjectionMatrix.value.copy(previousProjectionMatrix);
  uPreviousViewMatrix.value.copy(previousViewMatrix);
}

/**
 * Get previous camera matrices (for uniform updates)
 */
export function getPreviousCameraMatrices(): { projection: THREE.Matrix4; view: THREE.Matrix4 } {
  return {
    projection: previousProjectionMatrix,
    view: previousViewMatrix,
  };
}

/**
 * Initialize camera matrices (call once at startup)
 */
export function initCameraMatrices(camera: THREE.Camera): void {
  currentProjectionMatrix.copy(camera.projectionMatrix);
  currentViewMatrix.copy(camera.matrixWorldInverse);
  previousProjectionMatrix.copy(currentProjectionMatrix);
  previousViewMatrix.copy(currentViewMatrix);

  // Initialize TSL uniforms
  uPreviousProjectionMatrix.value.copy(previousProjectionMatrix);
  uPreviousViewMatrix.value.copy(previousViewMatrix);
}

/**
 * Check if a mesh has velocity setup
 */
export function hasVelocitySetup(mesh: THREE.InstancedMesh): boolean {
  return velocitySetupMeshes.has(mesh);
}

/**
 * Clean up velocity attributes when disposing a mesh
 */
export function disposeInstancedVelocity(mesh: THREE.InstancedMesh): void {
  if (!velocitySetupMeshes.has(mesh)) {
    return;
  }

  // Attributes are disposed with the geometry, but we should remove from our tracking
  velocitySetupMeshes.delete(mesh);
}

// Velocity threshold to eliminate sub-pixel noise
// 0.00005 NDC ≈ 0.05 pixel at 1080p - imperceptible but eliminates floating point noise
const VELOCITY_THRESHOLD = 0.00005;

/**
 * Create a TSL velocity node for InstancedMesh objects.
 *
 * WORLD-CLASS VELOCITY CALCULATION:
 * The key insight is that floating point precision differences between computation
 * paths cause micro-jitter. We solve this by:
 *
 * 1. Reading BOTH current and previous instance matrices as attributes
 * 2. Computing BOTH positions through IDENTICAL code paths
 * 3. Using the SAME camera matrices for both
 * 4. Only the instance matrix differs between the two calculations
 *
 * This ensures that for static objects (where matrices are identical),
 * the velocity is EXACTLY zero due to identical floating point operations.
 *
 * For InstancedMesh, Three.js stores instance matrices as:
 * - instanceMatrix0, instanceMatrix1, instanceMatrix2, instanceMatrix3 (current frame)
 * - prevInstanceMatrix0-3 (our custom attributes for previous frame)
 *
 * Returns a vec2 node representing screen-space velocity in NDC space.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createInstancedVelocityNode(): any {
  return Fn(() => {
    // Read CURRENT instance matrix from Three.js built-in attributes
    const currCol0 = attribute('instanceMatrix0', 'vec4');
    const currCol1 = attribute('instanceMatrix1', 'vec4');
    const currCol2 = attribute('instanceMatrix2', 'vec4');
    const currCol3 = attribute('instanceMatrix3', 'vec4');

    // Read PREVIOUS instance matrix from our custom attributes
    const prevCol0 = attribute('prevInstanceMatrix0', 'vec4');
    const prevCol1 = attribute('prevInstanceMatrix1', 'vec4');
    const prevCol2 = attribute('prevInstanceMatrix2', 'vec4');
    const prevCol3 = attribute('prevInstanceMatrix3', 'vec4');

    // Check if this is a valid InstancedMesh with our velocity attributes
    // Valid matrices have w=1 in column 3; missing attributes return zeros (w=0)
    const hasCurrentMatrix = abs(currCol3.w.sub(float(1.0))).lessThan(float(0.5));
    const hasPrevMatrix = abs(prevCol3.w.sub(float(1.0))).lessThan(float(0.5));
    const hasValidMatrices = hasCurrentMatrix.and(hasPrevMatrix);

    // Reconstruct both matrices from columns
    const currentInstanceMatrix = mat4(currCol0, currCol1, currCol2, currCol3);
    const prevInstanceMatrix = mat4(prevCol0, prevCol1, prevCol2, prevCol3);

    // IDENTICAL computation path for both positions
    // This is crucial - same operations = same floating point rounding
    const localPos = vec4(positionLocal, 1.0);

    // Transform through instance matrix then world matrix
    const currentInstancePos = currentInstanceMatrix.mul(localPos);
    const prevInstancePos = prevInstanceMatrix.mul(localPos);

    const currentWorldPos = modelWorldMatrix.mul(currentInstancePos);
    const prevWorldPos = modelWorldMatrix.mul(prevInstancePos);

    // Project BOTH through identical camera path
    const currentViewPos = cameraViewMatrix.mul(currentWorldPos);
    const prevViewPos = cameraViewMatrix.mul(prevWorldPos);

    const currentClipPos = cameraProjectionMatrix.mul(currentViewPos);
    const prevClipPos = cameraProjectionMatrix.mul(prevViewPos);

    // Convert to NDC
    const currentNDC = currentClipPos.xy.div(currentClipPos.w);
    const prevNDC = prevClipPos.xy.div(prevClipPos.w);

    // Velocity is screen-space motion
    const rawVelocity = currentNDC.sub(prevNDC);

    // Apply threshold to eliminate floating point noise
    const velocityMagnitude = max(abs(rawVelocity.x), abs(rawVelocity.y));
    const aboveThreshold = velocityMagnitude.greaterThan(float(VELOCITY_THRESHOLD));
    const thresholdedVelocity = select(aboveThreshold, rawVelocity, vec2(0.0, 0.0));

    // Return velocity for valid InstancedMesh, zero otherwise
    return select(hasValidMatrices, thresholdedVelocity, vec2(0.0, 0.0));
  })();
}


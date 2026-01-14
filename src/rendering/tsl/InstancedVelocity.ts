/**
 * InstancedVelocity - Per-instance velocity for TAA with InstancedMesh
 *
 * Three.js's built-in velocity buffer calculates motion from matrixWorld,
 * but InstancedMesh stores per-instance transforms in instanceMatrix.
 * This module provides proper per-instance velocity by:
 *
 * 1. Storing previous frame's instance matrices
 * 2. Detecting movement CPU-side to avoid floating point precision issues
 * 3. Computing velocity only for moving instances (static = zero velocity)
 *
 * The key insight: Static objects jitter because different code paths for
 * current vs previous position calculations have floating point precision
 * differences. By detecting movement on CPU (exact comparison), static
 * objects get EXACTLY zero velocity with no shader computation.
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
 * Set up previous instance matrix and movement flag attributes for an InstancedMesh
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

  // Create movement flag attribute (0 = static, 1 = moved)
  // This allows us to skip velocity computation for static objects entirely,
  // avoiding floating point precision issues that cause micro-jitter
  const movedFlagAttr = new THREE.InstancedBufferAttribute(
    new Float32Array(maxInstances), 1
  );

  // Initialize with identity matrix columns
  for (let i = 0; i < maxInstances; i++) {
    prevMatrixAttr0.setXYZW(i, 1, 0, 0, 0); // Column 0
    prevMatrixAttr1.setXYZW(i, 0, 1, 0, 0); // Column 1
    prevMatrixAttr2.setXYZW(i, 0, 0, 1, 0); // Column 2
    prevMatrixAttr3.setXYZW(i, 0, 0, 0, 1); // Column 3
    movedFlagAttr.setX(i, 0); // Initially static
  }

  mesh.geometry.setAttribute('prevInstanceMatrix0', prevMatrixAttr0);
  mesh.geometry.setAttribute('prevInstanceMatrix1', prevMatrixAttr1);
  mesh.geometry.setAttribute('prevInstanceMatrix2', prevMatrixAttr2);
  mesh.geometry.setAttribute('prevInstanceMatrix3', prevMatrixAttr3);
  mesh.geometry.setAttribute('instanceMoved', movedFlagAttr);

  velocitySetupMeshes.add(mesh);
}

/**
 * Swap current instance matrices to previous and detect movement
 * Must be called at the START of each frame, BEFORE updating instance matrices
 *
 * This function compares current and previous matrices to set a moved flag.
 * Static instances (no matrix change) get moved=0 and will output zero velocity.
 * Moving instances get moved=1 and will have velocity computed in shader.
 *
 * The CPU comparison is exact, avoiding floating point precision issues
 * that cause micro-jitter when computing velocity in the shader.
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
  const movedAttr = mesh.geometry.getAttribute('instanceMoved') as THREE.InstancedBufferAttribute;

  const prevArray0 = prevAttr0.array as Float32Array;
  const prevArray1 = prevAttr1.array as Float32Array;
  const prevArray2 = prevAttr2.array as Float32Array;
  const prevArray3 = prevAttr3.array as Float32Array;

  // Compare matrices and set moved flag, then copy current to previous
  for (let i = 0; i < count; i++) {
    const offset = i * 16;
    const prevOffset = i * 4;

    // Check if matrix changed (exact comparison works on CPU)
    // Compare all 16 elements of the 4x4 matrix
    const moved =
      currentMatrix[offset] !== prevArray0[prevOffset] ||
      currentMatrix[offset + 1] !== prevArray0[prevOffset + 1] ||
      currentMatrix[offset + 2] !== prevArray0[prevOffset + 2] ||
      currentMatrix[offset + 3] !== prevArray0[prevOffset + 3] ||
      currentMatrix[offset + 4] !== prevArray1[prevOffset] ||
      currentMatrix[offset + 5] !== prevArray1[prevOffset + 1] ||
      currentMatrix[offset + 6] !== prevArray1[prevOffset + 2] ||
      currentMatrix[offset + 7] !== prevArray1[prevOffset + 3] ||
      currentMatrix[offset + 8] !== prevArray2[prevOffset] ||
      currentMatrix[offset + 9] !== prevArray2[prevOffset + 1] ||
      currentMatrix[offset + 10] !== prevArray2[prevOffset + 2] ||
      currentMatrix[offset + 11] !== prevArray2[prevOffset + 3] ||
      currentMatrix[offset + 12] !== prevArray3[prevOffset] ||
      currentMatrix[offset + 13] !== prevArray3[prevOffset + 1] ||
      currentMatrix[offset + 14] !== prevArray3[prevOffset + 2] ||
      currentMatrix[offset + 15] !== prevArray3[prevOffset + 3];

    movedAttr.setX(i, moved ? 1 : 0);

    // Copy current matrices to previous (column by column)
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
  movedAttr.needsUpdate = true;
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

/**
 * Create a TSL velocity node for InstancedMesh objects.
 *
 * Uses a CPU-computed movement flag to avoid floating point precision issues:
 * - Static instances (moved = 0): Returns exactly vec2(0,0) with no shader math
 * - Moving instances (moved = 1): Computes proper velocity from matrix transforms
 *
 * Why this approach works:
 * - CPU comparison of matrices is exact (no floating point precision issues)
 * - Static objects get EXACTLY zero velocity (no shader computation at all)
 * - Moving objects have actual motion that dominates any precision noise
 * - TRAA's depth reprojection still handles camera motion
 *
 * Velocity calculation for moving instances:
 * - Current position: modelViewMatrix (includes current instanceMatrix) → project
 * - Previous position: previousViewMatrix * previousInstanceMatrix → project
 * - Velocity = currentNDC - previousNDC
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createInstancedVelocityNode(): any {
  return Fn(() => {
    // Read movement flag from CPU-computed attribute
    // If the instance didn't move (flag = 0), return zero velocity immediately
    // This avoids any shader math that could introduce floating point noise
    const moved = attribute('instanceMoved', 'float');

    // For static objects, return zero velocity
    // The select function chooses between two values based on condition
    // select(condition, trueValue, falseValue) - returns trueValue if condition > 0

    // Read previous instance matrix from attributes
    const prevCol0 = attribute('prevInstanceMatrix0', 'vec4');
    const prevCol1 = attribute('prevInstanceMatrix1', 'vec4');
    const prevCol2 = attribute('prevInstanceMatrix2', 'vec4');
    const prevCol3 = attribute('prevInstanceMatrix3', 'vec4');

    // Reconstruct previous instance matrix from columns
    const prevInstanceMatrix = mat4(prevCol0, prevCol1, prevCol2, prevCol3);

    // === Current position calculation ===
    // modelViewMatrix already includes instanceMatrix via Three.js's internal handling
    // So: clipPos = projectionMatrix * modelViewMatrix * position
    const currentClipPos = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(positionLocal, 1.0)));
    const currentNDC = currentClipPos.xy.div(currentClipPos.w);

    // === Previous position calculation ===
    // Compute: prevProjection * prevView * prevInstanceMatrix * position
    const prevWorldPos = prevInstanceMatrix.mul(vec4(positionLocal, 1.0));
    const prevViewPos = uPreviousViewMatrix.mul(prevWorldPos);
    const prevClipPos = uPreviousProjectionMatrix.mul(prevViewPos);
    const prevNDC = prevClipPos.xy.div(prevClipPos.w);

    // === Velocity calculation ===
    // Velocity is the screen-space motion: current - previous
    const velocity = currentNDC.sub(prevNDC);

    // Use select to conditionally return velocity only for moving instances
    // For static instances (moved ≈ 0), return zero velocity
    // For moving instances (moved ≈ 1), return computed velocity
    return select(moved, velocity, vec2(0.0, 0.0));
  })();
}


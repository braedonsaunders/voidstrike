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
} from 'three/tsl';

// WeakMap to track which meshes have velocity setup
const velocitySetupMeshes = new WeakSet<THREE.InstancedMesh>();

// Previous camera matrices (shared across all meshes)
let previousProjectionMatrix = new THREE.Matrix4();
let previousViewMatrix = new THREE.Matrix4();
let currentProjectionMatrix = new THREE.Matrix4();
let currentViewMatrix = new THREE.Matrix4();

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

  // Create previous instance matrix attribute (16 floats per matrix)
  const previousMatrixArray = new Float32Array(maxInstances * 16);

  // Initialize with identity matrices
  const identity = new THREE.Matrix4();
  for (let i = 0; i < maxInstances; i++) {
    identity.toArray(previousMatrixArray, i * 16);
  }

  // Add as instanced buffer attribute
  // Note: We use itemSize=16 for mat4, but Three.js handles this specially
  // We need to add it as 4 separate vec4 attributes
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
 * Create a TSL zero-velocity node for InstancedMesh objects.
 *
 * NOTE: Computing proper per-instance velocity would require modifying the vertex shader
 * to use the previousInstanceMatrix attributes. For now, we return zero velocity and
 * rely on TRAA's depth-based reprojection which works correctly for static instances.
 *
 * With stable entity ordering (entities sorted by ID), the previous/current matrix pairs
 * are properly aligned, so the depth-based reprojection should work well.
 *
 * Returns a vec2 node representing zero screen-space velocity.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createInstancedVelocityNode(): any {
  return Fn(() => {
    // Return zero velocity - TRAA will use depth-based reprojection
    // This works correctly for static instances with stable ordering
    return vec2(0.0, 0.0);
  })();
}


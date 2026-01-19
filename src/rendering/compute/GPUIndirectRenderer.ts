/**
 * GPU Indirect Renderer
 *
 * Manages GPU-driven rendering with indirect draw calls using Three.js r182+ patterns.
 *
 * Architecture:
 * - One mesh per (unitType, LOD) pair with indirect drawing enabled
 * - CullingCompute shader populates indirect args buffer with visible counts
 * - Vertex shader reads transforms from storage buffer via visible indices
 * - Single drawIndexedIndirect call per unit type/LOD
 *
 * Three.js r182+ Pattern:
 * - geometry.setIndirect(IndirectStorageBufferAttribute) for indirect drawing
 * - NodeMaterial with storage buffer access in vertex shader
 * - instanceIndex used to look up visible unit transforms
 * - Shared IndirectStorageBufferAttribute between compute and render
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { storage } from 'three/tsl';

import {
  StorageInstancedBufferAttribute,
  IndirectStorageBufferAttribute,
  MeshStandardNodeMaterial,
} from 'three/webgpu';

import { GPUUnitBuffer } from './GPUUnitBuffer';
import { CullingCompute } from './CullingCompute';
import { debugShaders } from '@/utils/debugLogger';

// Constants
const MAX_UNITS = 4096;
const MAX_UNIT_TYPES = 64;
const MAX_LOD_LEVELS = 3;
const MAX_PLAYERS = 8;

/**
 * Per-unit-type mesh configuration
 */
export interface UnitTypeMeshConfig {
  geometry: THREE.BufferGeometry;
  indexCount: number;
  material?: THREE.Material;
  lodLevel: number;
}

/**
 * GPU indirect mesh wrapper
 * Uses InstancedMesh for efficient GPU-driven instancing
 */
interface IndirectMesh {
  mesh: THREE.InstancedMesh;
  unitTypeIndex: number;
  lodLevel: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  indexCount: number;
  indirectOffset: number; // uint32 offset into indirect args buffer
}

/**
 * GPU Indirect Renderer
 *
 * Manages GPU-driven rendering using indirect draw calls.
 * Works with CullingCompute to enable fully GPU-driven instance culling.
 */
export class GPUIndirectRenderer {
  private renderer: WebGPURenderer | null = null;
  private scene: THREE.Scene;

  // Indirect meshes per (unitType, LOD) - uses InstancedMesh for each
  private indirectMeshes: Map<string, IndirectMesh> = new Map();

  // Shared indirect args buffer - used by all meshes with different offsets
  private indirectArgsData: Uint32Array;
  private indirectArgsAttribute: IndirectStorageBufferAttribute | null = null;

  // GPU buffer references
  private gpuUnitBuffer: GPUUnitBuffer | null = null;
  private cullingCompute: CullingCompute | null = null;

  // Transform data for storage binding
  private transformData: Float32Array;

  // Registered unit types and their geometries
  private unitTypeGeometries: Map<number, Map<number, THREE.BufferGeometry>> = new Map();
  private unitTypeMaterials: Map<number, THREE.Material> = new Map();

  // Initialization state
  private initialized = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Pre-allocate buffers
    this.transformData = new Float32Array(MAX_UNITS * 16);

    // Indirect args: (unitType * LOD * players) entries × 5 uint32 per entry
    const indirectEntryCount = MAX_UNIT_TYPES * MAX_LOD_LEVELS * MAX_PLAYERS;
    this.indirectArgsData = new Uint32Array(indirectEntryCount * 5);
  }

  /**
   * Initialize GPU resources
   */
  initialize(
    renderer: WebGPURenderer,
    gpuUnitBuffer: GPUUnitBuffer,
    cullingCompute: CullingCompute
  ): void {
    if (this.initialized) return;

    this.renderer = renderer;
    this.gpuUnitBuffer = gpuUnitBuffer;
    this.cullingCompute = cullingCompute;

    // Get data arrays from GPU buffer
    this.transformData = gpuUnitBuffer.getTransformData();

    // Create shared indirect args attribute for all meshes
    this.indirectArgsAttribute = new IndirectStorageBufferAttribute(this.indirectArgsData, 5);

    this.initialized = true;
    debugShaders.log('[GPUIndirectRenderer] Initialized with indirect draw calls');
    debugShaders.log(`  - Max units: ${MAX_UNITS}`);
    debugShaders.log(`  - Indirect entries: ${MAX_UNIT_TYPES * MAX_LOD_LEVELS * MAX_PLAYERS}`);
  }

  /**
   * Register a unit type geometry at a specific LOD level
   */
  registerUnitType(
    unitTypeIndex: number,
    lodLevel: number,
    geometry: THREE.BufferGeometry,
    material?: THREE.Material
  ): void {
    // Store geometry per LOD
    if (!this.unitTypeGeometries.has(unitTypeIndex)) {
      this.unitTypeGeometries.set(unitTypeIndex, new Map());
    }
    this.unitTypeGeometries.get(unitTypeIndex)!.set(lodLevel, geometry);

    // Store material (shared across LODs)
    if (material && !this.unitTypeMaterials.has(unitTypeIndex)) {
      this.unitTypeMaterials.set(unitTypeIndex, material);
    }

    // Create indirect mesh for this (unitType, LOD) combination
    this.createIndirectMesh(unitTypeIndex, lodLevel, geometry, material);
  }

  /**
   * Create an indirect mesh for a unit type + LOD combination
   *
   * Uses InstancedMesh for efficient GPU-driven instancing:
   * - InstancedMesh handles per-instance transforms via instanceMatrix
   * - geometry.setIndirect() enables GPU-controlled instance counts
   * - CullingCompute sets instance counts in indirect args buffer
   */
  private createIndirectMesh(
    unitTypeIndex: number,
    lodLevel: number,
    geometry: THREE.BufferGeometry,
    baseMaterial?: THREE.Material
  ): void {
    const key = `${unitTypeIndex}_${lodLevel}`;

    if (this.indirectMeshes.has(key)) {
      return;
    }

    // Clone geometry to avoid modifying the original
    const meshGeometry = geometry.clone();

    // Create material for instanced rendering
    const material = this.createInstancedMaterial(baseMaterial);

    // Create InstancedMesh with MAX_UNITS capacity
    // The actual rendered count is controlled by indirect args
    const mesh = new THREE.InstancedMesh(meshGeometry, material, MAX_UNITS);
    mesh.frustumCulled = false; // GPU handles culling
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 50;

    // Initialize all instance matrices to identity
    const identity = new THREE.Matrix4();
    for (let i = 0; i < MAX_UNITS; i++) {
      mesh.setMatrixAt(i, identity);
    }
    mesh.instanceMatrix.needsUpdate = true;

    // Calculate indirect args offset for this unit type + LOD
    const indirectOffset = this.getIndirectOffset(unitTypeIndex, lodLevel, 0);
    const indexCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;

    // Initialize indirect args for this entry
    // DrawIndexedIndirect: [indexCount, instanceCount, firstIndex, baseVertex, firstInstance]
    this.indirectArgsData[indirectOffset + 0] = indexCount;
    this.indirectArgsData[indirectOffset + 1] = 0; // instanceCount (set by culling compute)
    this.indirectArgsData[indirectOffset + 2] = 0; // firstIndex
    this.indirectArgsData[indirectOffset + 3] = 0; // baseVertex
    this.indirectArgsData[indirectOffset + 4] = 0; // firstInstance

    // Enable indirect drawing using r182+ API
    if (this.indirectArgsAttribute) {
      meshGeometry.setIndirect(this.indirectArgsAttribute);
      meshGeometry.drawIndirectOffset = indirectOffset * 4; // Convert to bytes
    }

    this.scene.add(mesh);

    this.indirectMeshes.set(key, {
      mesh,
      unitTypeIndex,
      lodLevel,
      geometry: meshGeometry,
      material,
      indexCount,
      indirectOffset,
    });

    debugShaders.log(`[GPUIndirectRenderer] Created InstancedMesh: type=${unitTypeIndex} LOD=${lodLevel} capacity=${MAX_UNITS}`);
  }

  /**
   * Create material for instanced rendering
   *
   * Uses MeshStandardNodeMaterial which is compatible with WebGPU instancing.
   * InstancedMesh handles instance transforms via the built-in instanceMatrix attribute.
   */
  private createInstancedMaterial(baseMaterial?: THREE.Material): THREE.Material {
    const material = new MeshStandardNodeMaterial();

    // Copy properties from base material if provided
    if (baseMaterial && baseMaterial instanceof THREE.MeshStandardMaterial) {
      material.color = baseMaterial.color;
      material.metalness = baseMaterial.metalness;
      material.roughness = baseMaterial.roughness;
      material.map = baseMaterial.map;
      material.normalMap = baseMaterial.normalMap;
    } else {
      material.color = new THREE.Color(0x888888);
      material.metalness = 0.1;
      material.roughness = 0.8;
    }

    // MeshStandardNodeMaterial + InstancedMesh automatically handles:
    // - instanceMatrix attribute for per-instance transforms
    // - instanceIndex for accessing instance data
    // No custom positionNode needed - Three.js handles instancing

    return material;
  }

  /**
   * Get the uint32 offset into the indirect args buffer for a (unitType, LOD, player) combination
   */
  private getIndirectOffset(unitType: number, lod: number, player: number): number {
    // Layout: [unitType * (LOD_COUNT * PLAYER_COUNT) + lod * PLAYER_COUNT + player] * 5
    return (unitType * MAX_LOD_LEVELS * MAX_PLAYERS + lod * MAX_PLAYERS + player) * 5;
  }

  /**
   * Get byte offset for a (unitType, LOD, player) combination
   */
  getIndirectByteOffset(unitType: number, lod: number, player: number): number {
    return this.getIndirectOffset(unitType, lod, player) * 4;
  }

  /**
   * Reset all indirect args instance counts to 0
   * Called before culling each frame
   */
  resetIndirectArgs(): void {
    const entryCount = MAX_UNIT_TYPES * MAX_LOD_LEVELS * MAX_PLAYERS;
    for (let i = 0; i < entryCount; i++) {
      this.indirectArgsData[i * 5 + 1] = 0; // instanceCount = 0
    }

    // Mark attribute as needing update
    if (this.indirectArgsAttribute) {
      this.indirectArgsAttribute.needsUpdate = true;
    }
  }

  /**
   * Set the instance count for a specific (unitType, LOD, player) combination
   * Used by CPU fallback path
   */
  setInstanceCount(unitType: number, lod: number, player: number, count: number): void {
    const offset = this.getIndirectOffset(unitType, lod, player);
    this.indirectArgsData[offset + 1] = count;

    if (this.indirectArgsAttribute) {
      this.indirectArgsAttribute.needsUpdate = true;
    }
  }

  /**
   * Get the instance count for a specific (unitType, LOD, player) combination
   */
  getInstanceCount(unitType: number, lod: number, player: number): number {
    const offset = this.getIndirectOffset(unitType, lod, player);
    return this.indirectArgsData[offset + 1];
  }

  /**
   * Get the indirect args attribute for binding to CullingCompute
   */
  getIndirectArgsAttribute(): IndirectStorageBufferAttribute | null {
    return this.indirectArgsAttribute;
  }

  /**
   * Get the indirect args data buffer
   */
  getIndirectArgsData(): Uint32Array {
    return this.indirectArgsData;
  }

  /**
   * Update instance matrices for all meshes from the GPU unit buffer
   * Call this each frame before rendering
   */
  updateInstanceMatrices(): void {
    if (!this.gpuUnitBuffer) return;

    const transformData = this.gpuUnitBuffer.getTransformData();
    const tempMatrix = new THREE.Matrix4();

    // Update each InstancedMesh with transforms from GPUUnitBuffer
    for (const slot of this.gpuUnitBuffer.getAllocatedSlots()) {
      const offset = slot.index * 16;

      // Read transform from buffer (column-major)
      tempMatrix.fromArray(transformData, offset);

      // Update the instance matrix in the corresponding mesh
      // For now, use a simple mapping (this could be optimized)
      const key = `${slot.unitTypeIndex}_0`; // LOD 0 for simplicity
      const meshData = this.indirectMeshes.get(key);
      if (meshData) {
        meshData.mesh.setMatrixAt(slot.index, tempMatrix);
      }
    }

    // Mark all instance matrices as needing update
    for (const [, data] of this.indirectMeshes) {
      data.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Check if renderer is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get all registered indirect meshes
   */
  getIndirectMeshes(): Map<string, IndirectMesh> {
    return this.indirectMeshes;
  }

  /**
   * Get total visible count across all unit types
   */
  getTotalVisibleCount(): number {
    let total = 0;
    const entryCount = MAX_UNIT_TYPES * MAX_LOD_LEVELS * MAX_PLAYERS;
    for (let i = 0; i < entryCount; i++) {
      total += this.indirectArgsData[i * 5 + 1];
    }
    return total;
  }

  /**
   * Update mesh visibility based on instance counts
   * Hides meshes with 0 instances to avoid GPU overhead
   */
  updateMeshVisibility(): void {
    for (const [key, data] of this.indirectMeshes) {
      const count = this.indirectArgsData[data.indirectOffset + 1];
      data.mesh.visible = count > 0;
    }
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    for (const [, data] of this.indirectMeshes) {
      this.scene.remove(data.mesh);
      data.geometry.dispose();
      data.material.dispose();
    }
    this.indirectMeshes.clear();

    this.unitTypeGeometries.clear();
    this.unitTypeMaterials.clear();

    this.indirectArgsAttribute = null;

    this.renderer = null;
    this.gpuUnitBuffer = null;
    this.cullingCompute = null;
    this.initialized = false;

    debugShaders.log('[GPUIndirectRenderer] Disposed');
  }
}

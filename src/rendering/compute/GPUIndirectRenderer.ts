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
import {
  Fn,
  storage,
  uniform,
  float,
  vec3,
  vec4,
  mat4,
  positionLocal,
  normalLocal,
  instanceIndex,
} from 'three/tsl';

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
 */
interface IndirectMesh {
  mesh: THREE.Mesh;
  unitTypeIndex: number;
  lodLevel: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  indexCount: number;
  indirectOffset: number; // Byte offset into indirect args buffer
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

  // Storage buffers (shared with CullingCompute)
  private transformStorage: ReturnType<typeof storage> | null = null;
  private visibleIndicesStorage: ReturnType<typeof storage> | null = null;

  // Indirect meshes per (unitType, LOD)
  private indirectMeshes: Map<string, IndirectMesh> = new Map();

  // Shared indirect args buffer - used by all meshes with different offsets
  private indirectArgsData: Uint32Array;
  private indirectArgsAttribute: IndirectStorageBufferAttribute | null = null;

  // GPU buffer references
  private gpuUnitBuffer: GPUUnitBuffer | null = null;
  private cullingCompute: CullingCompute | null = null;

  // Transform data for storage binding
  private transformData: Float32Array;
  private visibleIndicesData: Uint32Array;

  // Registered unit types and their geometries
  private unitTypeGeometries: Map<number, Map<number, THREE.BufferGeometry>> = new Map();
  private unitTypeMaterials: Map<number, THREE.Material> = new Map();

  // Camera uniform for vertex shader
  private uCameraPosition = uniform(new THREE.Vector3());

  // Initialization state
  private initialized = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Pre-allocate buffers
    this.transformData = new Float32Array(MAX_UNITS * 16);
    this.visibleIndicesData = new Uint32Array(MAX_UNITS);

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

    // Create storage buffers for vertex shader access
    const transformStorageAttribute = new StorageInstancedBufferAttribute(this.transformData, 16);
    this.transformStorage = storage(transformStorageAttribute, 'mat4', MAX_UNITS);

    // Get visible indices storage from culling compute (shared buffer)
    this.visibleIndicesStorage = cullingCompute.getVisibleIndicesStorage();

    // Create shared indirect args attribute
    this.indirectArgsAttribute = new IndirectStorageBufferAttribute(this.indirectArgsData, 5);

    this.initialized = true;
    debugShaders.log('[GPUIndirectRenderer] Initialized with shared indirect buffer');
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

    // Create GPU-driven material
    const material = this.createGPUDrivenMaterial(baseMaterial);

    // Create mesh
    const mesh = new THREE.Mesh(meshGeometry, material);
    mesh.frustumCulled = false; // GPU handles culling
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 50;

    // Calculate indirect args offset for this unit type + LOD
    // We use player 0 as the primary offset - multi-player support would need per-player meshes
    const indirectOffset = this.getIndirectOffset(unitTypeIndex, lodLevel, 0);
    const indexCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;

    // Initialize indirect args for this entry
    this.indirectArgsData[indirectOffset + 0] = indexCount;  // indexCount/vertexCount
    this.indirectArgsData[indirectOffset + 1] = 0;           // instanceCount (set by compute)
    this.indirectArgsData[indirectOffset + 2] = 0;           // firstIndex/firstVertex
    this.indirectArgsData[indirectOffset + 3] = 0;           // baseVertex (indexed) or firstInstance (non-indexed)
    this.indirectArgsData[indirectOffset + 4] = 0;           // firstInstance (indexed only)

    // Enable indirect drawing using r182+ API: geometry.setIndirect()
    // The offset is in BYTES, and each entry is 5 uint32 = 20 bytes
    if (this.indirectArgsAttribute) {
      meshGeometry.setIndirect(this.indirectArgsAttribute);
      // Set the byte offset for this specific mesh's indirect args
      meshGeometry.drawIndirectOffset = indirectOffset * 4; // Convert uint32 offset to bytes
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

    debugShaders.log(`[GPUIndirectRenderer] Created indirect mesh: type=${unitTypeIndex} LOD=${lodLevel} offset=${indirectOffset}`);
  }

  /**
   * Create a GPU-driven material that reads transforms from storage buffers
   *
   * The vertex shader:
   * 1. Uses instanceIndex to look up the visible unit slot from culling results
   * 2. Reads transform matrix from storage buffer
   * 3. Applies transform to vertex position and normal
   */
  private createGPUDrivenMaterial(baseMaterial?: THREE.Material): THREE.Material {
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

    const transformBuffer = this.transformStorage;
    const visibleIndices = this.visibleIndicesStorage;

    if (transformBuffer && visibleIndices) {
      // Custom position node - reads transform from storage buffer
      const gpuPositionNode = Fn(() => {
        // Get the original unit slot index for this instance from culling results
        const visibleSlotIndex = visibleIndices.element(instanceIndex);

        // Read the transform matrix from storage buffer
        const modelMatrix = transformBuffer.element(visibleSlotIndex);

        // Transform local position: worldPos = modelMatrix * vec4(localPos, 1.0)
        const localPos4 = vec4(positionLocal, float(1.0));
        const worldPos4 = modelMatrix.mul(localPos4);

        return worldPos4.xyz;
      });

      // Custom normal node - transforms normal by the model matrix
      const gpuNormalNode = Fn(() => {
        const visibleSlotIndex = visibleIndices.element(instanceIndex);
        const modelMatrix = transformBuffer.element(visibleSlotIndex);

        // Extract rotation from model matrix (upper-left 3x3)
        // For uniform scaling, normal transform = modelMatrix rotation
        const col0 = modelMatrix[0].xyz;
        const col1 = modelMatrix[1].xyz;
        const col2 = modelMatrix[2].xyz;
        const rotationMatrix = mat4(
          vec4(col0, float(0)),
          vec4(col1, float(0)),
          vec4(col2, float(0)),
          vec4(vec3(0, 0, 0), float(1))
        );

        const transformedNormal = rotationMatrix.mul(vec4(normalLocal, float(0))).xyz;
        return transformedNormal;
      });

      material.positionNode = gpuPositionNode();
      material.normalNode = gpuNormalNode();
    }

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
   * Update camera position uniform
   */
  updateCamera(camera: THREE.Camera): void {
    this.uCameraPosition.value.copy(camera.position);
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
   * Get visible indices storage for binding in vertex shader
   */
  getVisibleIndicesStorage(): ReturnType<typeof storage> | null {
    return this.visibleIndicesStorage;
  }

  /**
   * Get transform storage for binding in vertex shader
   */
  getTransformStorage(): ReturnType<typeof storage> | null {
    return this.transformStorage;
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

    this.transformStorage = null;
    this.visibleIndicesStorage = null;
    this.indirectArgsAttribute = null;

    this.renderer = null;
    this.gpuUnitBuffer = null;
    this.cullingCompute = null;
    this.initialized = false;

    debugShaders.log('[GPUIndirectRenderer] Disposed');
  }
}

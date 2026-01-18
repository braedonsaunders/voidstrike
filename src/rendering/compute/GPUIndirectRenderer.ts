/**
 * GPU Indirect Renderer
 *
 * Manages GPU-driven rendering with indirect draw calls.
 * Uses compute shader culling results to drive instance counts via
 * IndirectStorageBufferAttribute, eliminating CPU-GPU roundtrips.
 *
 * Architecture:
 * - One IndirectMesh per (unitType, LOD) pair
 * - Compute shader populates indirect args buffer with visible counts
 * - Vertex shader reads transforms from storage buffer via visible indices
 * - Single drawIndexedIndirect call per unit type/LOD
 *
 * Three.js r182 Pattern:
 * - mesh.drawIndirect = IndirectStorageBufferAttribute
 * - NodeMaterial with storage buffer access in vertex shader
 * - instanceIndex used to look up visible unit transforms
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  storage,
  uniform,
  float,
  int,
  vec4,
  mat4,
  positionLocal,
  instanceIndex,
} from 'three/tsl';

// Access exports that may lack TypeScript declarations
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as TSL from 'three/tsl';
const uint = (TSL as any).uint;

// StorageBufferAttribute, IndirectStorageBufferAttribute, NodeMaterial exist in three/webgpu
// but lack TypeScript declarations - access dynamically
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as THREE_WEBGPU from 'three/webgpu';
const StorageBufferAttribute = (THREE_WEBGPU as any).StorageBufferAttribute;
const IndirectStorageBufferAttribute = (THREE_WEBGPU as any).IndirectStorageBufferAttribute;
const NodeMaterial = (THREE_WEBGPU as any).NodeMaterial || THREE.MeshStandardMaterial;

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
}

/**
 * GPU Indirect Renderer
 *
 * Manages GPU-driven rendering using indirect draw calls.
 */
export class GPUIndirectRenderer {
  private renderer: WebGPURenderer | null = null;
  private scene: THREE.Scene;

  // Storage buffers (shared with CullingCompute)
  private transformStorage: ReturnType<typeof storage> | null = null;
  private metadataStorage: ReturnType<typeof storage> | null = null;
  private visibleIndicesStorage: ReturnType<typeof storage> | null = null;

  // Indirect meshes per (unitType, LOD)
  private indirectMeshes: Map<string, IndirectMesh> = new Map();

  // Indirect args buffer
  private indirectArgsData: Uint32Array;
  private indirectArgsAttribute: any | null = null;

  // GPU buffer reference
  private gpuUnitBuffer: GPUUnitBuffer | null = null;
  private cullingCompute: CullingCompute | null = null;

  // Transform data for storage binding
  private transformData: Float32Array;
  private metadataData: Float32Array;
  private visibleIndicesData: Uint32Array;

  // Registered unit types and their geometries
  private unitTypeGeometries: Map<number, Map<number, THREE.BufferGeometry>> = new Map();
  private unitTypeMaterials: Map<number, THREE.Material> = new Map();

  // Camera uniforms for vertex shader
  private uCameraPosition = uniform(new THREE.Vector3());

  // Is initialized flag
  private initialized = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Pre-allocate buffers
    this.transformData = new Float32Array(MAX_UNITS * 16);
    this.metadataData = new Float32Array(MAX_UNITS * 4);
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
    this.metadataData = gpuUnitBuffer.getMetadataData();

    // Create storage buffer nodes for shader access
    this.transformStorage = storage(this.transformData, 'mat4', MAX_UNITS);
    this.metadataStorage = storage(this.metadataData, 'vec4', MAX_UNITS);
    this.visibleIndicesStorage = storage(this.visibleIndicesData, 'uint', MAX_UNITS);

    // Create indirect args attribute
    this.indirectArgsAttribute = new IndirectStorageBufferAttribute(this.indirectArgsData, 5);

    this.initialized = true;
    debugShaders.log('[GPUIndirectRenderer] Initialized');
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
      return; // Already created
    }

    // Create NodeMaterial that reads transforms from storage buffer
    const material = this.createGPUDrivenMaterial(baseMaterial);

    // Create mesh with indirect drawing enabled
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // GPU handles culling
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 50;

    // Enable indirect drawing
    if (this.indirectArgsAttribute) {
      (mesh as any).drawIndirect = this.indirectArgsAttribute;
    }

    // Calculate indirect args offset for this unit type + LOD
    // Layout: [unitType][lod][player] flattened
    const indexCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;

    // Initialize indirect args for all player slots
    for (let player = 0; player < MAX_PLAYERS; player++) {
      const offset = this.getIndirectOffset(unitTypeIndex, lodLevel, player);
      this.indirectArgsData[offset + 0] = indexCount;  // indexCount
      this.indirectArgsData[offset + 1] = 0;           // instanceCount (filled by compute)
      this.indirectArgsData[offset + 2] = 0;           // firstIndex
      this.indirectArgsData[offset + 3] = 0;           // baseVertex
      this.indirectArgsData[offset + 4] = 0;           // firstInstance
    }

    this.scene.add(mesh);

    this.indirectMeshes.set(key, {
      mesh,
      unitTypeIndex,
      lodLevel,
      geometry,
      material,
      indexCount,
    });

    debugShaders.log(`[GPUIndirectRenderer] Created indirect mesh for type ${unitTypeIndex} LOD${lodLevel}`);
  }

  /**
   * Create a GPU-driven material that reads transforms from storage buffers
   *
   * The vertex shader:
   * 1. Uses instanceIndex to look up the visible unit slot
   * 2. Reads transform matrix from storage buffer
   * 3. Applies transform to vertex position
   */
  private createGPUDrivenMaterial(baseMaterial?: THREE.Material): THREE.Material {
    // If NodeMaterial isn't available, fall back to standard material
    if (!NodeMaterial || typeof NodeMaterial !== 'function') {
      debugShaders.warn('[GPUIndirectRenderer] NodeMaterial not available, using standard material');
      return baseMaterial?.clone() || new THREE.MeshStandardMaterial({ color: 0x888888 });
    }

    const material = new NodeMaterial();

    // Copy properties from base material if provided
    if (baseMaterial && baseMaterial instanceof THREE.MeshStandardMaterial) {
      material.color = baseMaterial.color;
      material.metalness = baseMaterial.metalness;
      material.roughness = baseMaterial.roughness;
      material.map = baseMaterial.map;
      material.normalMap = baseMaterial.normalMap;
    }

    const transformBuffer = this.transformStorage;
    const visibleIndices = this.visibleIndicesStorage;

    if (transformBuffer && visibleIndices) {
      // Custom vertex position node that reads from storage buffer
      const gpuPositionNode = Fn(() => {
        // Get the visible unit slot index for this instance
        const visibleSlotIndex = visibleIndices.element(instanceIndex);

        // Read the transform matrix from storage buffer
        const transform = transformBuffer.element(visibleSlotIndex);

        // Extract matrix columns
        const col0 = vec4(
          transform.element(int(0)),
          transform.element(int(1)),
          transform.element(int(2)),
          transform.element(int(3))
        );
        const col1 = vec4(
          transform.element(int(4)),
          transform.element(int(5)),
          transform.element(int(6)),
          transform.element(int(7))
        );
        const col2 = vec4(
          transform.element(int(8)),
          transform.element(int(9)),
          transform.element(int(10)),
          transform.element(int(11))
        );
        const col3 = vec4(
          transform.element(int(12)),
          transform.element(int(13)),
          transform.element(int(14)),
          transform.element(int(15))
        );

        // Build model matrix
        const modelMatrix = mat4(col0, col1, col2, col3);

        // Transform local position to world position
        const worldPosition = modelMatrix.mul(vec4(positionLocal, float(1)));

        return worldPosition.xyz;
      });

      // Apply custom vertex position
      try {
        material.positionNode = gpuPositionNode();
      } catch (e) {
        debugShaders.warn('[GPUIndirectRenderer] Failed to set position node:', e);
      }
    }

    return material;
  }

  /**
   * Get the offset into the indirect args buffer for a (unitType, LOD, player) combination
   */
  private getIndirectOffset(unitType: number, lod: number, player: number): number {
    // Layout: [unitType * (LOD_COUNT * PLAYER_COUNT) + lod * PLAYER_COUNT + player] * 5
    return (unitType * MAX_LOD_LEVELS * MAX_PLAYERS + lod * MAX_PLAYERS + player) * 5;
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
  }

  /**
   * Set the instance count for a specific (unitType, LOD, player) combination
   * Called after culling to update indirect draw counts
   */
  setInstanceCount(unitType: number, lod: number, player: number, count: number): void {
    const offset = this.getIndirectOffset(unitType, lod, player);
    this.indirectArgsData[offset + 1] = count;
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
   * Sync visible indices from culling compute
   */
  syncVisibleIndices(visibleIndicesBuffer: Uint32Array): void {
    this.visibleIndicesData.set(visibleIndicesBuffer);
  }

  /**
   * Get the indirect args attribute for binding to CullingCompute
   */
  getIndirectArgsAttribute(): any | null {
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
   * Dispose all resources
   */
  dispose(): void {
    for (const [, data] of this.indirectMeshes) {
      this.scene.remove(data.mesh);
      data.material.dispose();
    }
    this.indirectMeshes.clear();

    this.unitTypeGeometries.clear();
    this.unitTypeMaterials.clear();

    this.renderer = null;
    this.gpuUnitBuffer = null;
    this.cullingCompute = null;
    this.initialized = false;

    debugShaders.log('[GPUIndirectRenderer] Disposed');
  }
}

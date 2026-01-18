/**
 * GPU Unit Buffer Manager
 *
 * Manages GPU storage buffers for unit transforms, enabling GPU-driven rendering.
 * Key features:
 * - All unit transforms stored in GPU buffer (no per-frame CPU upload)
 * - Slot allocation/deallocation for dynamic entity spawn/destroy
 * - Direct GPU writes for transform updates
 *
 * Architecture:
 * - Transform buffer: mat4 per unit (64 bytes)
 * - Metadata buffer: vec4(entityId, unitTypeIndex, playerId, boundingRadius)
 * - Visibility buffer: uint indices of visible units (written by culling compute)
 * - Indirect args buffer: DrawIndexedIndirect args per (unitType × LOD) combination
 */

import * as THREE from 'three';
import { debugShaders } from '@/utils/debugLogger';

// Maximum units supported (can be increased based on VRAM)
const MAX_UNITS = 4096;

// Bytes per unit transform (mat4 = 16 floats × 4 bytes)
const TRANSFORM_STRIDE = 64;

// Bytes per unit metadata (vec4 = 4 floats × 4 bytes)
const METADATA_STRIDE = 16;

// DrawIndexedIndirect struct size (5 uint32 = 20 bytes)
const INDIRECT_ARGS_STRIDE = 20;

export interface UnitSlot {
  index: number;
  entityId: number;
  unitTypeIndex: number;
  playerId: number;
}

export interface GPUUnitBufferConfig {
  maxUnits?: number;
  maxUnitTypes?: number;
  maxLODLevels?: number;
  maxPlayers?: number;
}

/**
 * GPU Unit Buffer Manager
 *
 * Handles GPU buffer allocation and updates for unit rendering.
 * Designed to work with compute shader culling and indirect drawing.
 */
export class GPUUnitBuffer {
  private config: Required<GPUUnitBufferConfig>;

  // CPU-side buffers (for upload to GPU)
  private transformData: Float32Array;
  private metadataData: Float32Array;
  private prevTransformData: Float32Array; // For velocity

  // Three.js buffer attributes
  private transformBuffer: THREE.InstancedBufferAttribute | null = null;
  private prevTransformBuffer: THREE.InstancedBufferAttribute | null = null;
  private metadataBuffer: THREE.InstancedBufferAttribute | null = null;

  // Slot management
  private allocatedSlots: Map<number, UnitSlot> = new Map(); // entityId -> slot
  private freeSlots: number[] = []; // Available slot indices
  private activeCount = 0;

  // Unit type registry
  private unitTypeToIndex: Map<string, number> = new Map();
  private indexToUnitType: Map<number, string> = new Map();
  private nextUnitTypeIndex = 0;

  // Player registry
  private playerIdToIndex: Map<string, number> = new Map();
  private nextPlayerIndex = 0;

  // Dirty tracking
  private dirtySlots: Set<number> = new Set();
  private needsFullUpdate = true;
  private isDirtyFlag = true; // Track if any changes need GPU upload

  // Reusable matrix for decomposition
  private tempMatrix = new THREE.Matrix4();

  constructor(config: GPUUnitBufferConfig = {}) {
    this.config = {
      maxUnits: config.maxUnits ?? MAX_UNITS,
      maxUnitTypes: config.maxUnitTypes ?? 64,
      maxLODLevels: config.maxLODLevels ?? 3,
      maxPlayers: config.maxPlayers ?? 8,
    };

    // Allocate CPU buffers
    this.transformData = new Float32Array(this.config.maxUnits * 16); // mat4
    this.prevTransformData = new Float32Array(this.config.maxUnits * 16);
    this.metadataData = new Float32Array(this.config.maxUnits * 4); // vec4

    // Initialize free slots (all available)
    for (let i = this.config.maxUnits - 1; i >= 0; i--) {
      this.freeSlots.push(i);
    }

    debugShaders.log(`[GPUUnitBuffer] Initialized with ${this.config.maxUnits} unit capacity`);
  }

  /**
   * Get or register a unit type index
   */
  getUnitTypeIndex(unitType: string): number {
    let index = this.unitTypeToIndex.get(unitType);
    if (index === undefined) {
      index = this.nextUnitTypeIndex++;
      this.unitTypeToIndex.set(unitType, index);
      this.indexToUnitType.set(index, unitType);
    }
    return index;
  }

  /**
   * Get unit type string from index
   */
  getUnitTypeFromIndex(index: number): string | undefined {
    return this.indexToUnitType.get(index);
  }

  /**
   * Get or register a player index
   */
  getPlayerIndex(playerId: string): number {
    let index = this.playerIdToIndex.get(playerId);
    if (index === undefined) {
      index = this.nextPlayerIndex++;
      this.playerIdToIndex.set(playerId, index);
    }
    return index;
  }

  /**
   * Allocate a slot for a new unit
   */
  allocateSlot(entityId: number, unitType: string, playerId: string): UnitSlot | null {
    // Check if already allocated
    const existing = this.allocatedSlots.get(entityId);
    if (existing) {
      return existing;
    }

    // Get free slot
    if (this.freeSlots.length === 0) {
      debugShaders.warn('[GPUUnitBuffer] No free slots available');
      return null;
    }

    const index = this.freeSlots.pop()!;
    const unitTypeIndex = this.getUnitTypeIndex(unitType);
    const playerIndex = this.getPlayerIndex(playerId);

    const slot: UnitSlot = {
      index,
      entityId,
      unitTypeIndex,
      playerId: playerIndex,
    };

    this.allocatedSlots.set(entityId, slot);
    this.activeCount++;

    // Initialize metadata
    const metaOffset = index * 4;
    this.metadataData[metaOffset + 0] = entityId;
    this.metadataData[metaOffset + 1] = unitTypeIndex;
    this.metadataData[metaOffset + 2] = playerIndex;
    this.metadataData[metaOffset + 3] = 1.0; // Bounding radius (default)

    // Initialize transform to identity
    this.setTransformIdentity(index);

    this.dirtySlots.add(index);
    this.isDirtyFlag = true;
    return slot;
  }

  /**
   * Free a slot when a unit is destroyed
   */
  freeSlot(entityId: number): void {
    const slot = this.allocatedSlots.get(entityId);
    if (!slot) return;

    this.allocatedSlots.delete(entityId);
    this.freeSlots.push(slot.index);
    this.activeCount--;

    // Clear transform to identity (not strictly necessary but clean)
    this.setTransformIdentity(slot.index);
    this.dirtySlots.add(slot.index);
    this.isDirtyFlag = true;
  }

  /**
   * Set transform to identity matrix
   */
  private setTransformIdentity(index: number): void {
    const offset = index * 16;
    // Column-major identity matrix
    this.transformData[offset + 0] = 1;
    this.transformData[offset + 1] = 0;
    this.transformData[offset + 2] = 0;
    this.transformData[offset + 3] = 0;
    this.transformData[offset + 4] = 0;
    this.transformData[offset + 5] = 1;
    this.transformData[offset + 6] = 0;
    this.transformData[offset + 7] = 0;
    this.transformData[offset + 8] = 0;
    this.transformData[offset + 9] = 0;
    this.transformData[offset + 10] = 1;
    this.transformData[offset + 11] = 0;
    this.transformData[offset + 12] = 0;
    this.transformData[offset + 13] = 0;
    this.transformData[offset + 14] = 0;
    this.transformData[offset + 15] = 1;
  }

  /**
   * Update a unit's transform
   */
  updateTransform(entityId: number, matrix: THREE.Matrix4): void {
    const slot = this.allocatedSlots.get(entityId);
    if (!slot) return;

    const offset = slot.index * 16;
    const elements = matrix.elements;

    // Copy matrix elements (already column-major)
    for (let i = 0; i < 16; i++) {
      this.transformData[offset + i] = elements[i];
    }

    this.dirtySlots.add(slot.index);
    this.isDirtyFlag = true;
  }

  /**
   * Update a unit's transform from position, rotation, scale
   */
  updateTransformComponents(
    entityId: number,
    x: number,
    y: number,
    z: number,
    rotationY: number,
    scale: number
  ): void {
    const slot = this.allocatedSlots.get(entityId);
    if (!slot) return;

    // Build transform matrix
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);

    const offset = slot.index * 16;

    // Column-major rotation around Y axis with scale and translation
    this.transformData[offset + 0] = cos * scale;
    this.transformData[offset + 1] = 0;
    this.transformData[offset + 2] = -sin * scale;
    this.transformData[offset + 3] = 0;

    this.transformData[offset + 4] = 0;
    this.transformData[offset + 5] = scale;
    this.transformData[offset + 6] = 0;
    this.transformData[offset + 7] = 0;

    this.transformData[offset + 8] = sin * scale;
    this.transformData[offset + 9] = 0;
    this.transformData[offset + 10] = cos * scale;
    this.transformData[offset + 11] = 0;

    this.transformData[offset + 12] = x;
    this.transformData[offset + 13] = y;
    this.transformData[offset + 14] = z;
    this.transformData[offset + 15] = 1;

    this.dirtySlots.add(slot.index);
    this.isDirtyFlag = true;
  }

  /**
   * Update bounding radius for a unit (used for culling)
   */
  updateBoundingRadius(entityId: number, radius: number): void {
    const slot = this.allocatedSlots.get(entityId);
    if (!slot) return;

    const metaOffset = slot.index * 4;
    this.metadataData[metaOffset + 3] = radius;
    this.dirtySlots.add(slot.index);
    this.isDirtyFlag = true;
  }

  /**
   * Swap previous and current transforms (for velocity buffer)
   * Call at START of frame before updating transforms
   */
  swapTransformBuffers(): void {
    // Copy current to previous
    this.prevTransformData.set(this.transformData);
  }

  /**
   * Create Three.js buffer attributes for GPU access
   */
  createBufferAttributes(): {
    transform: THREE.InstancedBufferAttribute;
    prevTransform: THREE.InstancedBufferAttribute;
    metadata: THREE.InstancedBufferAttribute;
  } {
    this.transformBuffer = new THREE.InstancedBufferAttribute(
      this.transformData,
      16 // mat4 = 16 floats
    );
    this.transformBuffer.setUsage(THREE.DynamicDrawUsage);

    this.prevTransformBuffer = new THREE.InstancedBufferAttribute(
      this.prevTransformData,
      16
    );
    this.prevTransformBuffer.setUsage(THREE.DynamicDrawUsage);

    this.metadataBuffer = new THREE.InstancedBufferAttribute(
      this.metadataData,
      4 // vec4 = 4 floats
    );
    this.metadataBuffer.setUsage(THREE.DynamicDrawUsage);

    return {
      transform: this.transformBuffer,
      prevTransform: this.prevTransformBuffer,
      metadata: this.metadataBuffer,
    };
  }

  /**
   * Commit dirty changes to GPU buffers
   * Call AFTER updating transforms, BEFORE render
   */
  commitChanges(): void {
    if (this.needsFullUpdate) {
      // Full buffer update
      if (this.transformBuffer) {
        this.transformBuffer.needsUpdate = true;
      }
      if (this.prevTransformBuffer) {
        this.prevTransformBuffer.needsUpdate = true;
      }
      if (this.metadataBuffer) {
        this.metadataBuffer.needsUpdate = true;
      }
      this.needsFullUpdate = false;
      this.dirtySlots.clear();
      this.isDirtyFlag = false;
      return;
    }

    // Partial update (mark whole buffer dirty for now)
    // True partial update would require WebGPU buffer.writeBuffer()
    if (this.dirtySlots.size > 0) {
      if (this.transformBuffer) {
        this.transformBuffer.needsUpdate = true;
      }
      if (this.metadataBuffer) {
        this.metadataBuffer.needsUpdate = true;
      }
      this.dirtySlots.clear();
      this.isDirtyFlag = false;
    }
  }

  /**
   * Check if buffer has uncommitted changes
   */
  isDirty(): boolean {
    return this.isDirtyFlag || this.needsFullUpdate || this.dirtySlots.size > 0;
  }

  /**
   * Mark buffer as needing full update
   */
  markDirty(): void {
    this.isDirtyFlag = true;
    this.needsFullUpdate = true;
  }

  /**
   * Get slot for an entity
   */
  getSlot(entityId: number): UnitSlot | undefined {
    return this.allocatedSlots.get(entityId);
  }

  /**
   * Get all allocated slots
   */
  getAllocatedSlots(): IterableIterator<UnitSlot> {
    return this.allocatedSlots.values();
  }

  /**
   * Get active unit count
   */
  getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * Get buffer capacity
   */
  getCapacity(): number {
    return this.config.maxUnits;
  }

  /**
   * Get transform data array (for direct access)
   */
  getTransformData(): Float32Array {
    return this.transformData;
  }

  /**
   * Get metadata data array (for direct access)
   */
  getMetadataData(): Float32Array {
    return this.metadataData;
  }

  /**
   * Get number of registered unit types
   */
  getUnitTypeCount(): number {
    return this.nextUnitTypeIndex;
  }

  /**
   * Clear all allocations
   */
  clear(): void {
    this.allocatedSlots.clear();
    this.freeSlots.length = 0;
    for (let i = this.config.maxUnits - 1; i >= 0; i--) {
      this.freeSlots.push(i);
    }
    this.activeCount = 0;
    this.needsFullUpdate = true;
    this.dirtySlots.clear();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.transformBuffer = null;
    this.prevTransformBuffer = null;
    this.metadataBuffer = null;
    this.allocatedSlots.clear();
    this.freeSlots.length = 0;
  }
}

/**
 * Indirect Draw Args structure for GPU-driven rendering
 *
 * Layout matches WebGPU's DrawIndexedIndirect:
 * - indexCount: u32
 * - instanceCount: u32 (written by culling compute)
 * - firstIndex: u32
 * - baseVertex: i32
 * - firstInstance: u32
 */
export interface IndirectDrawArgs {
  indexCount: number;
  instanceCount: number;
  firstIndex: number;
  baseVertex: number;
  firstInstance: number;
}

/**
 * Create indirect args buffer for GPU-driven drawing
 *
 * @param unitTypeCount Number of unique unit types
 * @param lodCount Number of LOD levels (typically 3)
 * @param playerCount Number of players
 */
export function createIndirectArgsBuffer(
  unitTypeCount: number,
  lodCount: number = 3,
  playerCount: number = 8
): {
  buffer: Uint32Array;
  getOffset: (unitType: number, lod: number, player: number) => number;
  setIndexCount: (unitType: number, lod: number, player: number, count: number) => void;
  resetInstanceCounts: () => void;
} {
  // One set of args per (unitType × LOD × player) combination
  const entryCount = unitTypeCount * lodCount * playerCount;
  const buffer = new Uint32Array(entryCount * 5); // 5 u32 per DrawIndexedIndirect

  const getOffset = (unitType: number, lod: number, player: number): number => {
    return (unitType * lodCount * playerCount + player * lodCount + lod) * 5;
  };

  const setIndexCount = (unitType: number, lod: number, player: number, count: number): void => {
    const offset = getOffset(unitType, lod, player);
    buffer[offset] = count; // indexCount
  };

  const resetInstanceCounts = (): void => {
    // Reset all instanceCount values to 0 (offset + 1)
    for (let i = 0; i < entryCount; i++) {
      buffer[i * 5 + 1] = 0; // instanceCount
    }
  };

  return { buffer, getOffset, setIndexCount, resetInstanceCounts };
}

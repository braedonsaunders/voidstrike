/**
 * GPU Entity Buffer Manager
 *
 * Unified GPU storage for all cullable entities (units and buildings).
 * Replaces the separate GPUUnitBuffer with a category-aware system.
 *
 * Key features:
 * - Single buffer for both units and buildings
 * - Category field distinguishes entity types for separate indirect args
 * - Proper bounding radius storage for accurate sphere-frustum culling
 * - Static entity optimization (buildings skip per-frame transform updates)
 *
 * Architecture:
 * - Transform buffer: mat4 per entity (64 bytes)
 * - Metadata buffer: vec4(entityId, packedTypeAndCategory, playerId, boundingRadius)
 *   - packedTypeAndCategory: typeIndex | (category << 16)
 * - Visibility buffer: uint indices of visible entities (written by culling compute)
 * - Indirect args buffer: DrawIndexedIndirect args per (type × LOD × player) combination
 */

import * as THREE from 'three';
import { debugShaders } from '@/utils/debugLogger';

// Maximum entities supported (units + buildings combined)
const MAX_ENTITIES = 8192;

// Bytes per entity transform (mat4 = 16 floats × 4 bytes)
const _TRANSFORM_STRIDE = 64;

// Bytes per entity metadata (vec4 = 4 floats × 4 bytes)
const _METADATA_STRIDE = 16;

// DrawIndexedIndirect struct size (5 uint32 = 20 bytes)
const _INDIRECT_ARGS_STRIDE = 20;

// Number of frames to quarantine freed slots before reclamation.
// WebGPU typically has 2-3 frames in flight; 3 frames provides safety margin.
const QUARANTINE_FRAMES = 3;

/**
 * Entity category for distinguishing units from buildings in the unified buffer.
 * Packed into high 16 bits of metadata.y alongside typeIndex.
 */
export enum EntityCategory {
  Unit = 0,
  Building = 1,
}

export interface EntitySlot {
  index: number;
  entityId: number;
  typeIndex: number;
  playerId: number;
  category: EntityCategory;
  boundingRadius: number;
  isStatic: boolean;
}

/**
 * Quarantined slot awaiting safe reclamation.
 * Slots are held for QUARANTINE_FRAMES to ensure GPU has finished
 * using the slot's buffer data before it can be reallocated.
 */
interface QuarantinedSlot {
  index: number;
  frameFreed: number;
}

export interface GPUEntityBufferConfig {
  maxEntities?: number;
  maxTypes?: number;
  maxLODLevels?: number;
  maxPlayers?: number;
}

/**
 * GPU Entity Buffer Manager
 *
 * Handles GPU buffer allocation and updates for all cullable entities.
 * Designed to work with UnifiedCullingCompute for GPU-accelerated culling.
 */
export class GPUEntityBuffer {
  private config: Required<GPUEntityBufferConfig>;

  // CPU-side buffers (for upload to GPU)
  private transformData: Float32Array;
  private metadataData: Float32Array;
  private prevTransformData: Float32Array; // For velocity

  // Three.js buffer attributes
  private transformBuffer: THREE.InstancedBufferAttribute | null = null;
  private prevTransformBuffer: THREE.InstancedBufferAttribute | null = null;
  private metadataBuffer: THREE.InstancedBufferAttribute | null = null;

  // Slot management
  private allocatedSlots: Map<number, EntitySlot> = new Map(); // entityId -> slot
  private freeSlots: number[] = []; // Available slot indices
  private activeCount = 0;
  private unitCount = 0;
  private buildingCount = 0;

  // Deferred slot reclamation - prevents GPU buffer race conditions
  private quarantinedSlots: QuarantinedSlot[] = [];
  private currentFrame = 0;

  // Type registry (shared for units and buildings, distinguished by category)
  private typeToIndex: Map<string, number> = new Map();
  private indexToType: Map<number, string> = new Map();
  private nextTypeIndex = 0;

  // Player registry
  private playerIdToIndex: Map<string, number> = new Map();
  private nextPlayerIndex = 0;

  // Static entities (buildings) - skip per-frame updates
  private staticEntities: Set<number> = new Set();

  // Dirty tracking
  private dirtySlots: Set<number> = new Set();
  private needsFullUpdate = true;
  private isDirtyFlag = true;

  // Reusable matrix for decomposition
  private tempMatrix = new THREE.Matrix4();

  constructor(config: GPUEntityBufferConfig = {}) {
    this.config = {
      maxEntities: config.maxEntities ?? MAX_ENTITIES,
      maxTypes: config.maxTypes ?? 128, // 64 unit types + 64 building types
      maxLODLevels: config.maxLODLevels ?? 3,
      maxPlayers: config.maxPlayers ?? 8,
    };

    // Allocate CPU buffers
    this.transformData = new Float32Array(this.config.maxEntities * 16); // mat4
    this.prevTransformData = new Float32Array(this.config.maxEntities * 16);
    this.metadataData = new Float32Array(this.config.maxEntities * 4); // vec4

    // Initialize free slots (all available)
    for (let i = this.config.maxEntities - 1; i >= 0; i--) {
      this.freeSlots.push(i);
    }

    debugShaders.log(`[GPUEntityBuffer] Initialized with ${this.config.maxEntities} entity capacity`);
  }

  /**
   * Get or register a type index (for both units and buildings)
   */
  getTypeIndex(typeId: string): number {
    let index = this.typeToIndex.get(typeId);
    if (index === undefined) {
      index = this.nextTypeIndex++;
      this.typeToIndex.set(typeId, index);
      this.indexToType.set(index, typeId);
    }
    return index;
  }

  /**
   * Get type string from index
   */
  getTypeFromIndex(index: number): string | undefined {
    return this.indexToType.get(index);
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
   * Allocate a slot for a new entity
   *
   * @param entityId Unique entity ID
   * @param typeId Type identifier (unit type or building type)
   * @param playerId Owner player ID
   * @param category Entity category (Unit or Building)
   * @param boundingRadius Actual bounding radius for culling (from model dimensions)
   */
  allocateSlot(
    entityId: number,
    typeId: string,
    playerId: string,
    category: EntityCategory,
    boundingRadius: number
  ): EntitySlot | null {
    // Check if already allocated
    const existing = this.allocatedSlots.get(entityId);
    if (existing) {
      return existing;
    }

    // Get free slot
    if (this.freeSlots.length === 0) {
      debugShaders.warn('[GPUEntityBuffer] No free slots available');
      return null;
    }

    const index = this.freeSlots.pop()!;
    const typeIndex = this.getTypeIndex(typeId);
    const playerIndex = this.getPlayerIndex(playerId);

    const slot: EntitySlot = {
      index,
      entityId,
      typeIndex,
      playerId: playerIndex,
      category,
      boundingRadius,
      isStatic: false,
    };

    this.allocatedSlots.set(entityId, slot);
    this.activeCount++;
    if (category === EntityCategory.Unit) {
      this.unitCount++;
    } else {
      this.buildingCount++;
    }

    // Initialize metadata with packed type and category
    const metaOffset = index * 4;
    const packedTypeAndCategory = typeIndex | (category << 16);
    this.metadataData[metaOffset + 0] = entityId;
    this.metadataData[metaOffset + 1] = packedTypeAndCategory;
    this.metadataData[metaOffset + 2] = playerIndex;
    this.metadataData[metaOffset + 3] = boundingRadius;

    // Initialize transform to identity
    this.setTransformIdentity(index);

    this.dirtySlots.add(index);
    this.isDirtyFlag = true;
    return slot;
  }

  /**
   * Free a slot when an entity is destroyed.
   *
   * Slots are quarantined for QUARANTINE_FRAMES to ensure the GPU has
   * finished using the slot's buffer data before it can be reallocated.
   */
  freeSlot(entityId: number): void {
    const slot = this.allocatedSlots.get(entityId);
    if (!slot) return;

    this.allocatedSlots.delete(entityId);
    this.staticEntities.delete(entityId);
    this.activeCount--;
    if (slot.category === EntityCategory.Unit) {
      this.unitCount--;
    } else {
      this.buildingCount--;
    }

    // Quarantine the slot
    this.quarantinedSlots.push({
      index: slot.index,
      frameFreed: this.currentFrame,
    });

    // Clear transform to identity
    this.setTransformIdentity(slot.index);
    this.dirtySlots.add(slot.index);
    this.isDirtyFlag = true;
  }

  /**
   * Process quarantined slots and reclaim those that are safe to reuse.
   * Call this ONCE per frame, at the START of the update loop.
   */
  processQuarantinedSlots(): void {
    this.currentFrame++;

    let writeIndex = 0;
    for (let i = 0; i < this.quarantinedSlots.length; i++) {
      const slot = this.quarantinedSlots[i];
      const framesInQuarantine = this.currentFrame - slot.frameFreed;

      if (framesInQuarantine >= QUARANTINE_FRAMES) {
        // Safe to reclaim
        this.freeSlots.push(slot.index);
      } else {
        // Keep in quarantine
        this.quarantinedSlots[writeIndex++] = slot;
      }
    }
    this.quarantinedSlots.length = writeIndex;
  }

  /**
   * Mark an entity as static (buildings). Static entities skip per-frame transform updates.
   */
  markStatic(entityId: number): void {
    const slot = this.allocatedSlots.get(entityId);
    if (slot) {
      slot.isStatic = true;
      this.staticEntities.add(entityId);
    }
  }

  /**
   * Check if an entity is static
   */
  isStatic(entityId: number): boolean {
    return this.staticEntities.has(entityId);
  }

  /**
   * Get the number of slots currently in quarantine
   */
  getQuarantinedCount(): number {
    return this.quarantinedSlots.length;
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
   * Update an entity's transform from a matrix
   */
  updateTransform(entityId: number, matrix: THREE.Matrix4): void {
    const slot = this.allocatedSlots.get(entityId);
    if (!slot) return;

    const offset = slot.index * 16;
    const elements = matrix.elements;

    for (let i = 0; i < 16; i++) {
      this.transformData[offset + i] = elements[i];
    }

    this.dirtySlots.add(slot.index);
    this.isDirtyFlag = true;
  }

  /**
   * Update an entity's transform from position, rotation, scale
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
   * Update bounding radius for an entity
   */
  updateBoundingRadius(entityId: number, radius: number): void {
    const slot = this.allocatedSlots.get(entityId);
    if (!slot) return;

    slot.boundingRadius = radius;
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
  getSlot(entityId: number): EntitySlot | undefined {
    return this.allocatedSlots.get(entityId);
  }

  /**
   * Check if entity is registered
   */
  hasEntity(entityId: number): boolean {
    return this.allocatedSlots.has(entityId);
  }

  /**
   * Get all allocated slots
   */
  getAllocatedSlots(): IterableIterator<EntitySlot> {
    return this.allocatedSlots.values();
  }

  /**
   * Get slots by category
   */
  *getSlotsByCategory(category: EntityCategory): IterableIterator<EntitySlot> {
    for (const slot of this.allocatedSlots.values()) {
      if (slot.category === category) {
        yield slot;
      }
    }
  }

  /**
   * Get active entity count
   */
  getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * Get unit count
   */
  getUnitCount(): number {
    return this.unitCount;
  }

  /**
   * Get building count
   */
  getBuildingCount(): number {
    return this.buildingCount;
  }

  /**
   * Get buffer capacity
   */
  getCapacity(): number {
    return this.config.maxEntities;
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
   * Get number of registered types
   */
  getTypeCount(): number {
    return this.nextTypeIndex;
  }

  /**
   * Get config
   */
  getConfig(): Required<GPUEntityBufferConfig> {
    return this.config;
  }

  /**
   * Clear all allocations
   */
  clear(): void {
    this.allocatedSlots.clear();
    this.staticEntities.clear();
    this.freeSlots.length = 0;
    for (let i = this.config.maxEntities - 1; i >= 0; i--) {
      this.freeSlots.push(i);
    }
    this.activeCount = 0;
    this.unitCount = 0;
    this.buildingCount = 0;
    this.needsFullUpdate = true;
    this.dirtySlots.clear();
    this.quarantinedSlots.length = 0;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.transformBuffer = null;
    this.prevTransformBuffer = null;
    this.metadataBuffer = null;
    this.allocatedSlots.clear();
    this.staticEntities.clear();
    this.freeSlots.length = 0;
    this.quarantinedSlots.length = 0;
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
 * @param typeCount Number of unique types (units + buildings)
 * @param lodCount Number of LOD levels (typically 3)
 * @param playerCount Number of players
 */
export function createIndirectArgsBuffer(
  typeCount: number,
  lodCount: number = 3,
  playerCount: number = 8
): {
  buffer: Uint32Array;
  getOffset: (type: number, lod: number, player: number) => number;
  setIndexCount: (type: number, lod: number, player: number, count: number) => void;
  resetInstanceCounts: () => void;
} {
  const entryCount = typeCount * lodCount * playerCount;
  const buffer = new Uint32Array(entryCount * 5); // 5 u32 per DrawIndexedIndirect

  const getOffset = (type: number, lod: number, player: number): number => {
    return (type * lodCount * playerCount + player * lodCount + lod) * 5;
  };

  const setIndexCount = (type: number, lod: number, player: number, count: number): void => {
    const offset = getOffset(type, lod, player);
    buffer[offset] = count; // indexCount
  };

  const resetInstanceCounts = (): void => {
    for (let i = 0; i < entryCount; i++) {
      buffer[i * 5 + 1] = 0; // instanceCount
    }
  };

  return { buffer, getOffset, setIndexCount, resetInstanceCounts };
}

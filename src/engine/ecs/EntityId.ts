/**
 * Generational Entity ID System
 *
 * Implements industry-standard generational indices for entity management.
 * Prevents stale reference bugs and allows bounded memory usage.
 *
 * Encoding (32-bit):
 * - Bits 0-19 (20 bits): Index → max 1,048,576 concurrent entities
 * - Bits 20-31 (12 bits): Generation → wraps at 4096
 *
 * When an entity is destroyed, its index is recycled. The generation
 * increments, so any stale references holding the old EntityId will
 * fail validation (generation mismatch).
 */

import { debugInitialization } from '@/utils/debugLogger';

/** Raw entity ID type - encodes both index and generation */
export type EntityId = number;

/** Sentinel value for invalid/null entity references */
export const INVALID_ENTITY_ID: EntityId = 0;

/** Maximum concurrent entities (20 bits = 1,048,576) */
export const MAX_ENTITY_INDEX = 0xFFFFF; // 1,048,575

/** Maximum generation before wrap (12 bits = 4096) */
export const MAX_GENERATION = 0xFFF; // 4095

/** Bit shift for generation (index uses lower 20 bits) */
const GENERATION_SHIFT = 20;

/** Mask for extracting index */
const INDEX_MASK = MAX_ENTITY_INDEX;

/**
 * Pack index and generation into an EntityId
 */
export function packEntityId(index: number, generation: number): EntityId {
  return ((generation & MAX_GENERATION) << GENERATION_SHIFT) | (index & INDEX_MASK);
}

/**
 * Extract the index portion from an EntityId
 * This is used for array indexing in spatial grids, etc.
 */
export function getEntityIndex(id: EntityId): number {
  return id & INDEX_MASK;
}

/**
 * Extract the generation portion from an EntityId
 */
export function getEntityGeneration(id: EntityId): number {
  return (id >>> GENERATION_SHIFT) & MAX_GENERATION;
}

/**
 * Check if an EntityId is the invalid sentinel
 */
export function isInvalidEntityId(id: EntityId): boolean {
  return id === INVALID_ENTITY_ID;
}

/**
 * EntityIdAllocator - Manages entity ID allocation with generational recycling
 *
 * Uses a free list to recycle indices. When an index is recycled,
 * its generation increments so stale references become invalid.
 */
export class EntityIdAllocator {
  /** Generation counter per index slot */
  private generations: Uint16Array;

  /** Free list of available indices (LIFO stack for cache locality) */
  private freeList: number[];

  /** Next fresh index (used when free list is empty) */
  private nextFreshIndex: number;

  /** Number of currently allocated entities */
  private allocatedCount: number;

  /** Maximum index capacity */
  private readonly maxIndex: number;

  constructor(maxEntities: number = MAX_ENTITY_INDEX + 1) {
    this.maxIndex = Math.min(maxEntities, MAX_ENTITY_INDEX + 1);
    this.generations = new Uint16Array(this.maxIndex);
    this.freeList = [];
    // Start at index 1 so that EntityId 0 remains invalid
    this.nextFreshIndex = 1;
    this.allocatedCount = 0;
  }

  /**
   * Allocate a new EntityId
   * Returns INVALID_ENTITY_ID if capacity is exceeded
   */
  public allocate(): EntityId {
    let index: number;

    if (this.freeList.length > 0) {
      // Reuse a recycled index
      index = this.freeList.pop()!;
    } else if (this.nextFreshIndex < this.maxIndex) {
      // Use a fresh index
      index = this.nextFreshIndex++;
    } else {
      // Out of capacity
      debugInitialization.error(`EntityIdAllocator: Exceeded max capacity of ${this.maxIndex} entities`);
      return INVALID_ENTITY_ID;
    }

    this.allocatedCount++;
    const generation = this.generations[index];
    return packEntityId(index, generation);
  }

  /**
   * Free an EntityId, returning its index to the pool
   * Increments generation to invalidate stale references
   */
  public free(id: EntityId): void {
    if (isInvalidEntityId(id)) return;

    const index = getEntityIndex(id);
    const generation = getEntityGeneration(id);

    // Validate this ID is currently valid
    if (index >= this.maxIndex || this.generations[index] !== generation) {
      debugInitialization.warn(`EntityIdAllocator: Attempted to free invalid EntityId ${id}`);
      return;
    }

    // Increment generation (wraps at MAX_GENERATION)
    this.generations[index] = (generation + 1) & MAX_GENERATION;

    // Add to free list for reuse
    this.freeList.push(index);
    this.allocatedCount--;
  }

  /**
   * Check if an EntityId is currently valid
   * Returns false if the generation doesn't match (stale reference)
   */
  public isValid(id: EntityId): boolean {
    if (isInvalidEntityId(id)) return false;

    const index = getEntityIndex(id);
    if (index >= this.maxIndex) return false;

    const generation = getEntityGeneration(id);
    return this.generations[index] === generation;
  }

  /**
   * Get the current generation for an index
   * Used internally for validation
   */
  public getGeneration(index: number): number {
    if (index >= this.maxIndex) return 0;
    return this.generations[index];
  }

  /**
   * Get number of currently allocated entities
   */
  public getAllocatedCount(): number {
    return this.allocatedCount;
  }

  /**
   * Get number of recycled indices available
   */
  public getFreeCount(): number {
    return this.freeList.length;
  }

  /**
   * Get maximum capacity
   */
  public getCapacity(): number {
    return this.maxIndex - 1; // -1 because index 0 is reserved
  }

  /**
   * Reset allocator to initial state
   */
  public clear(): void {
    this.generations.fill(0);
    this.freeList.length = 0;
    this.nextFreshIndex = 1;
    this.allocatedCount = 0;
  }

  /**
   * Get stats for debugging
   */
  public getStats(): {
    allocated: number;
    free: number;
    capacity: number;
    highWaterMark: number;
  } {
    return {
      allocated: this.allocatedCount,
      free: this.freeList.length,
      capacity: this.maxIndex - 1,
      highWaterMark: this.nextFreshIndex - 1,
    };
  }
}

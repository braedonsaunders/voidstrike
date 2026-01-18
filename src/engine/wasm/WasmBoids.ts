/**
 * WASM SIMD Boids Wrapper
 *
 * Provides a TypeScript interface to the WASM boids module.
 * Handles memory management, typed array views, and data synchronization
 * between the game's ECS entities and WASM's SoA buffers.
 *
 * Performance characteristics:
 * - 4x throughput from SIMD (f32x4 processing)
 * - Zero-copy data transfer via shared memory views
 * - Batch processing reduces per-unit overhead
 */

import type { Entity } from '../ecs/Entity';
import type { Transform } from '../components/Transform';
import type { Unit } from '../components/Unit';
import type { Velocity } from '../components/Velocity';
import type { SpatialGrid } from '../core/SpatialGrid';

// Unit state constants (must match lib.rs)
const STATE_ACTIVE = 0;
const STATE_DEAD = 1;
const STATE_FLYING = 2;
const STATE_GATHERING = 3;
const STATE_WORKER = 4;

/**
 * Interface for the WASM module exports
 */
interface BoidsWasmExports {
  memory: WebAssembly.Memory;
  simd_supported: () => boolean;
  BoidsEngine: new (maxUnits: number) => WasmBoidsEngine;
  STATE_ACTIVE: number;
  STATE_DEAD: number;
  STATE_FLYING: number;
  STATE_GATHERING: number;
  STATE_WORKER: number;
}

/**
 * Interface for the WASM BoidsEngine instance
 */
interface WasmBoidsEngine {
  capacity: number;
  unit_count: number;

  // Input buffer pointers
  positions_x_ptr(): number;
  positions_y_ptr(): number;
  velocities_x_ptr(): number;
  velocities_y_ptr(): number;
  radii_ptr(): number;
  states_ptr(): number;
  layers_ptr(): number;

  // Output buffer pointers
  force_sep_x_ptr(): number;
  force_sep_y_ptr(): number;
  force_coh_x_ptr(): number;
  force_coh_y_ptr(): number;
  force_align_x_ptr(): number;
  force_align_y_ptr(): number;

  // Neighbor list pointers
  neighbors_ptr(): number;
  neighbor_offsets_ptr(): number;
  neighbor_counts_ptr(): number;

  // Methods
  set_separation_params(radius: number, strength: number, maxForce: number): void;
  set_cohesion_params(radius: number, strength: number): void;
  set_alignment_params(radius: number, strength: number): void;
  set_min_moving_speed(speed: number): void;
  set_neighbor_total(count: number): void;
  compute_forces(): void;
  clear(): void;
}

/**
 * Boids computation result for a single unit
 */
export interface BoidsForces {
  separationX: number;
  separationY: number;
  cohesionX: number;
  cohesionY: number;
  alignmentX: number;
  alignmentY: number;
}

/**
 * Entity ID to WASM buffer index mapping
 */
interface EntityMapping {
  entityId: number;
  wasmIndex: number;
}

/**
 * High-level wrapper for WASM SIMD boids computation
 */
export class WasmBoids {
  private wasm: BoidsWasmExports | null = null;
  private engine: WasmBoidsEngine | null = null;
  private memory: WebAssembly.Memory | null = null;

  // Typed array views into WASM memory
  private positionsX: Float32Array | null = null;
  private positionsY: Float32Array | null = null;
  private velocitiesX: Float32Array | null = null;
  private velocitiesY: Float32Array | null = null;
  private radii: Float32Array | null = null;
  private states: Uint8Array | null = null;
  private layers: Uint8Array | null = null;

  // Output force views
  private forceSepX: Float32Array | null = null;
  private forceSepY: Float32Array | null = null;
  private forceCohX: Float32Array | null = null;
  private forceCohY: Float32Array | null = null;
  private forceAlignX: Float32Array | null = null;
  private forceAlignY: Float32Array | null = null;

  // Neighbor list views
  private neighbors: Uint32Array | null = null;
  private neighborOffsets: Uint32Array | null = null;
  private neighborCounts: Uint32Array | null = null;

  // Entity ID <-> WASM index mapping
  private entityToIndex: Map<number, number> = new Map();
  private indexToEntity: number[] = [];
  private currentCount: number = 0;

  // Pre-allocated neighbor query buffer
  private neighborQueryBuffer: number[] = [];

  // Initialization state
  private initialized: boolean = false;
  private initializationPromise: Promise<boolean> | null = null;
  private simdAvailable: boolean = false;

  // Capacity
  private readonly maxUnits: number;

  // Boids parameters (cached to avoid per-frame calls)
  private separationRadius: number = 1.0;
  private separationStrength: number = 1.5;
  private maxSeparationForce: number = 1.5;
  private cohesionRadius: number = 8.0;
  private cohesionStrength: number = 0.1;
  private alignmentRadius: number = 4.0;
  private alignmentStrength: number = 0.3;

  constructor(maxUnits: number = 2000) {
    this.maxUnits = maxUnits;
    this.neighborQueryBuffer = new Array(maxUnits * 8);
  }

  /**
   * Initialize the WASM module (async)
   * Returns true if SIMD is available and module loaded successfully
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return this.simdAvailable;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.doInitialize();
    return this.initializationPromise;
  }

  private async doInitialize(): Promise<boolean> {
    // Only run in browser context
    if (typeof window === 'undefined') {
      this.initialized = true;
      return false;
    }

    try {
      // Dynamic import of WASM module from public directory
      // Use Function constructor to prevent static analysis by bundler
      const wasmPath = '/wasm/boids_wasm.js';
      const wasmModule = await (Function('return import("' + wasmPath + '")')());
      await wasmModule.default();

      this.wasm = wasmModule as BoidsWasmExports;
      this.simdAvailable = this.wasm.simd_supported();

      if (!this.simdAvailable) {
        console.warn('[WasmBoids] SIMD not available, falling back to JS');
        this.initialized = true;
        return false;
      }

      // Create engine instance
      this.engine = new this.wasm.BoidsEngine(this.maxUnits);
      this.memory = this.wasm.memory;

      // Create typed array views
      this.createViews();

      // Set default parameters
      this.updateWasmParams();

      this.initialized = true;
      console.log(`[WasmBoids] Initialized with SIMD, capacity: ${this.maxUnits}`);
      return true;
    } catch (error) {
      console.warn('[WasmBoids] Failed to initialize:', error);
      this.initialized = true;
      this.simdAvailable = false;
      return false;
    }
  }

  /**
   * Create typed array views into WASM memory
   */
  private createViews(): void {
    if (!this.engine || !this.memory) return;

    const buffer = this.memory.buffer;
    const capacity = this.engine.capacity;

    // Input buffers
    this.positionsX = new Float32Array(buffer, this.engine.positions_x_ptr(), capacity);
    this.positionsY = new Float32Array(buffer, this.engine.positions_y_ptr(), capacity);
    this.velocitiesX = new Float32Array(buffer, this.engine.velocities_x_ptr(), capacity);
    this.velocitiesY = new Float32Array(buffer, this.engine.velocities_y_ptr(), capacity);
    this.radii = new Float32Array(buffer, this.engine.radii_ptr(), capacity);
    this.states = new Uint8Array(buffer, this.engine.states_ptr(), capacity);
    this.layers = new Uint8Array(buffer, this.engine.layers_ptr(), capacity);

    // Output buffers
    this.forceSepX = new Float32Array(buffer, this.engine.force_sep_x_ptr(), capacity);
    this.forceSepY = new Float32Array(buffer, this.engine.force_sep_y_ptr(), capacity);
    this.forceCohX = new Float32Array(buffer, this.engine.force_coh_x_ptr(), capacity);
    this.forceCohY = new Float32Array(buffer, this.engine.force_coh_y_ptr(), capacity);
    this.forceAlignX = new Float32Array(buffer, this.engine.force_align_x_ptr(), capacity);
    this.forceAlignY = new Float32Array(buffer, this.engine.force_align_y_ptr(), capacity);

    // Neighbor list buffers (max 8 neighbors per unit average)
    const maxNeighbors = capacity * 8;
    this.neighbors = new Uint32Array(buffer, this.engine.neighbors_ptr(), maxNeighbors);
    this.neighborOffsets = new Uint32Array(buffer, this.engine.neighbor_offsets_ptr(), capacity);
    this.neighborCounts = new Uint32Array(buffer, this.engine.neighbor_counts_ptr(), capacity);
  }

  /**
   * Check if WASM SIMD is available and buffers are initialized
   */
  isAvailable(): boolean {
    return (
      this.initialized &&
      this.simdAvailable &&
      this.engine !== null &&
      this.positionsX !== null &&
      this.positionsY !== null
    );
  }

  /**
   * Set separation force parameters
   */
  setSeparationParams(radius: number, strength: number, maxForce: number): void {
    this.separationRadius = radius;
    this.separationStrength = strength;
    this.maxSeparationForce = maxForce;
    this.updateWasmParams();
  }

  /**
   * Set cohesion force parameters
   */
  setCohesionParams(radius: number, strength: number): void {
    this.cohesionRadius = radius;
    this.cohesionStrength = strength;
    this.updateWasmParams();
  }

  /**
   * Set alignment force parameters
   */
  setAlignmentParams(radius: number, strength: number): void {
    this.alignmentRadius = radius;
    this.alignmentStrength = strength;
    this.updateWasmParams();
  }

  private updateWasmParams(): void {
    if (!this.engine) return;
    this.engine.set_separation_params(
      this.separationRadius,
      this.separationStrength,
      this.maxSeparationForce
    );
    this.engine.set_cohesion_params(this.cohesionRadius, this.cohesionStrength);
    this.engine.set_alignment_params(this.alignmentRadius, this.alignmentStrength);
    this.engine.set_min_moving_speed(0.1);
  }

  /**
   * Sync entity data to WASM buffers
   *
   * @param entities - Array of entities with Transform, Unit, Velocity components
   * @param unitGrid - Spatial grid for neighbor queries
   * @returns Number of units synced
   */
  syncEntities(
    entities: Entity[],
    unitGrid: SpatialGrid
  ): number {
    if (!this.isAvailable()) return 0;

    // Additional safety check - ensure all required buffers are initialized
    // This guards against race conditions where buffers might become null
    if (
      !this.positionsX ||
      !this.positionsY ||
      !this.velocitiesX ||
      !this.velocitiesY ||
      !this.radii ||
      !this.states ||
      !this.layers ||
      !this.neighbors ||
      !this.neighborOffsets ||
      !this.neighborCounts
    ) {
      console.warn('[WasmBoids] syncEntities called but buffers are not initialized');
      return 0;
    }

    // Clear mappings
    this.entityToIndex.clear();
    this.indexToEntity.length = 0;
    this.currentCount = 0;

    let neighborTotalCount = 0;

    for (const entity of entities) {
      if (this.currentCount >= this.maxUnits) break;

      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      const velocity = entity.get<Velocity>('Velocity');

      if (!transform || !unit || !velocity) continue;

      // Skip dead units
      if (unit.state === 'dead') continue;

      const idx = this.currentCount;

      // Map entity ID to WASM index
      this.entityToIndex.set(entity.id, idx);
      this.indexToEntity[idx] = entity.id;

      // Copy data to WASM buffers
      this.positionsX![idx] = transform.x;
      this.positionsY![idx] = transform.y;
      this.velocitiesX![idx] = velocity.x;
      this.velocitiesY![idx] = velocity.y;
      this.radii![idx] = unit.collisionRadius;

      // Determine state (dead units already filtered above)
      let state = STATE_ACTIVE;
      if (unit.isFlying) {
        state = STATE_FLYING;
      } else if (unit.state === 'gathering') {
        state = STATE_GATHERING;
      } else if (unit.isWorker) {
        state = STATE_WORKER;
      }
      this.states![idx] = state;

      // Layer: 0 = ground, 1 = flying
      this.layers![idx] = unit.isFlying ? 1 : 0;

      // Query neighbors using spatial grid
      const queryRadius = Math.max(
        this.separationRadius + unit.collisionRadius,
        this.cohesionRadius,
        this.alignmentRadius
      );

      const nearbyIds = unitGrid.queryRadius(
        transform.x,
        transform.y,
        queryRadius,
        this.neighborQueryBuffer
      );

      // Store neighbor offset
      this.neighborOffsets![idx] = neighborTotalCount;
      let neighborCount = 0;

      for (const neighborEntityId of nearbyIds) {
        // Skip self
        if (neighborEntityId === entity.id) continue;

        // Get neighbor's WASM index (if already processed)
        const neighborIdx = this.entityToIndex.get(neighborEntityId);
        if (neighborIdx !== undefined) {
          this.neighbors![neighborTotalCount] = neighborIdx;
          neighborTotalCount++;
          neighborCount++;
        }
        // Neighbors not yet processed will be handled in reverse pass
      }

      this.neighborCounts![idx] = neighborCount;
      this.currentCount++;
    }

    // Second pass: add reverse neighbor relationships
    // (if A has B as neighbor, B should have A)
    for (let i = 0; i < this.currentCount; i++) {
      const offset = this.neighborOffsets![i];
      const count = this.neighborCounts![i];

      for (let j = 0; j < count; j++) {
        const neighborIdx = this.neighbors![offset + j];

        // Add reverse relationship if not already present
        const neighborOffset = this.neighborOffsets![neighborIdx];
        const neighborCount = this.neighborCounts![neighborIdx];

        let found = false;
        for (let k = 0; k < neighborCount; k++) {
          if (this.neighbors![neighborOffset + k] === i) {
            found = true;
            break;
          }
        }

        if (!found && neighborCount < 32) {
          // Add this unit as neighbor of the other unit
          // Append to existing neighbors
          const newOffset = this.neighborOffsets![neighborIdx] + this.neighborCounts![neighborIdx];
          if (newOffset < neighborTotalCount + 1000) {
            // Safety check
            this.neighbors![newOffset] = i;
            this.neighborCounts![neighborIdx]++;
            neighborTotalCount++;
          }
        }
      }
    }

    // Update WASM with counts
    this.engine!.unit_count = this.currentCount;
    this.engine!.set_neighbor_total(neighborTotalCount);

    return this.currentCount;
  }

  /**
   * Compute all boids forces using SIMD
   * Must call syncEntities first
   */
  computeForces(): void {
    if (!this.isAvailable() || this.currentCount === 0) return;
    this.engine!.compute_forces();
  }

  /**
   * Get computed forces for an entity
   *
   * @param entityId - Entity ID to get forces for
   * @returns Forces or null if entity not in WASM buffer
   */
  getForces(entityId: number): BoidsForces | null {
    if (!this.isAvailable()) return null;

    const idx = this.entityToIndex.get(entityId);
    if (idx === undefined) return null;

    return {
      separationX: this.forceSepX![idx],
      separationY: this.forceSepY![idx],
      cohesionX: this.forceCohX![idx],
      cohesionY: this.forceCohY![idx],
      alignmentX: this.forceAlignX![idx],
      alignmentY: this.forceAlignY![idx],
    };
  }

  /**
   * Get forces by WASM buffer index (faster than by entity ID)
   */
  getForcesByIndex(index: number): BoidsForces | null {
    if (!this.isAvailable() || index >= this.currentCount) return null;

    return {
      separationX: this.forceSepX![index],
      separationY: this.forceSepY![index],
      cohesionX: this.forceCohX![index],
      cohesionY: this.forceCohY![index],
      alignmentX: this.forceAlignX![index],
      alignmentY: this.forceAlignY![index],
    };
  }

  /**
   * Get entity ID from WASM buffer index
   */
  getEntityId(index: number): number | undefined {
    return this.indexToEntity[index];
  }

  /**
   * Get current unit count in WASM buffer
   */
  getUnitCount(): number {
    return this.currentCount;
  }

  /**
   * Apply computed forces to a force accumulator
   *
   * @param entityId - Entity to apply forces for
   * @param outX - Reference to X force accumulator
   * @param outY - Reference to Y force accumulator
   * @returns true if forces were applied
   */
  applyForcesToAccumulator(
    entityId: number,
    out: { x: number; y: number }
  ): boolean {
    const forces = this.getForces(entityId);
    if (!forces) return false;

    out.x += forces.separationX + forces.cohesionX + forces.alignmentX;
    out.y += forces.separationY + forces.cohesionY + forces.alignmentY;

    return true;
  }

  /**
   * Clear all buffers and mappings
   */
  clear(): void {
    this.entityToIndex.clear();
    this.indexToEntity.length = 0;
    this.currentCount = 0;

    if (this.engine) {
      this.engine.clear();
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics(): {
    unitCount: number;
    simdEnabled: boolean;
    capacity: number;
  } {
    return {
      unitCount: this.currentCount,
      simdEnabled: this.simdAvailable,
      capacity: this.maxUnits,
    };
  }
}

// Singleton instance for global access
let wasmBoidsInstance: WasmBoids | null = null;

/**
 * Get the global WasmBoids instance
 * Creates and initializes on first call
 */
export async function getWasmBoids(maxUnits: number = 2000): Promise<WasmBoids> {
  if (!wasmBoidsInstance) {
    wasmBoidsInstance = new WasmBoids(maxUnits);
    await wasmBoidsInstance.initialize();
  }
  return wasmBoidsInstance;
}

/**
 * Get the global WasmBoids instance synchronously
 * Returns null if not yet initialized
 */
export function getWasmBoidsSync(): WasmBoids | null {
  return wasmBoidsInstance;
}

/**
 * CullingService - Unified Frustum Culling for All Entities
 *
 * High-level interface for frustum culling and LOD selection.
 * Abstracts GPU vs CPU culling implementation details from renderers.
 *
 * Key responsibilities:
 * - Register/unregister entities for culling
 * - Automatically derive bounding radii from AssetManager
 * - Perform per-frame culling (GPU or CPU fallback)
 * - Provide visibility and LOD queries
 *
 * Usage:
 *   const cullingService = new CullingService();
 *   cullingService.initialize(renderer, supportsCompute);
 *
 *   // Register entities
 *   cullingService.registerEntity(entityId, 'marine', playerId, EntityCategory.Unit);
 *   cullingService.updateTransform(entityId, x, y, z, rotation, scale);
 *
 *   // Per frame
 *   cullingService.performCulling(camera);
 *   if (cullingService.isVisible(entityId)) { ... }
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GPUEntityBuffer, EntityCategory, EntitySlot } from '../compute/GPUEntityBuffer';
import { UnifiedCullingCompute, LODConfig, CullingResult } from '../compute/UnifiedCullingCompute';
import { AssetManager, DEFAULT_LOD_DISTANCES } from '@/assets/AssetManager';
import { debugShaders } from '@/utils/debugLogger';

// Default minimum bounding radius
const MIN_BOUNDING_RADIUS = 0.5;

// Default bounding radius when model not available
const DEFAULT_BOUNDING_RADIUS = 1.5;

// Multiplier for building bounding radius (buildings tend to be taller/larger)
const BUILDING_RADIUS_MULTIPLIER = 1.2;

export interface CullingServiceConfig {
  maxEntities?: number;
  lodConfig?: LODConfig;
}

/**
 * CullingService - Single point of entry for all entity culling
 */
export class CullingService {
  private entityBuffer: GPUEntityBuffer;
  private cullingCompute: UnifiedCullingCompute;
  private isGPUAvailable = false;
  private isInitialized = false;

  // Cached visibility results (from last cull pass)
  private visibilityMap: Map<number, boolean> = new Map();
  private lodMap: Map<number, number> = new Map();

  // Last culling result for CPU path
  private lastCullingResult: CullingResult | null = null;

  // Reusable temp objects
  private tempSphere = new THREE.Sphere();

  constructor(config: CullingServiceConfig = {}) {
    this.entityBuffer = new GPUEntityBuffer({
      maxEntities: config.maxEntities ?? 8192,
      maxTypes: 128,
      maxLODLevels: 3,
      maxPlayers: 8,
    });

    this.cullingCompute = new UnifiedCullingCompute(
      config.lodConfig ?? {
        LOD0_MAX: DEFAULT_LOD_DISTANCES.LOD0_MAX,
        LOD1_MAX: DEFAULT_LOD_DISTANCES.LOD1_MAX,
      }
    );
  }

  /**
   * Initialize the culling service
   *
   * @param renderer WebGPU renderer (null for WebGL fallback)
   * @param supportsCompute Whether GPU compute is available
   */
  initialize(renderer: WebGPURenderer | null, supportsCompute: boolean): void {
    if (this.isInitialized) return;

    if (renderer && supportsCompute) {
      try {
        this.cullingCompute.initializeGPUCompute(
          renderer,
          this.entityBuffer.getTransformData(),
          this.entityBuffer.getMetadataData()
        );
        this.isGPUAvailable = this.cullingCompute.isUsingGPU();
        debugShaders.log(`[CullingService] Initialized with GPU: ${this.isGPUAvailable}`);
      } catch (e) {
        debugShaders.warn('[CullingService] GPU init failed, using CPU fallback');
        this.isGPUAvailable = false;
      }
    } else {
      debugShaders.log('[CullingService] Initialized with CPU fallback (no WebGPU)');
      this.isGPUAvailable = false;
    }

    this.isInitialized = true;
  }

  /**
   * Register an entity for culling
   *
   * Automatically fetches bounding radius from AssetManager based on model dimensions.
   *
   * @param entityId Unique entity ID
   * @param typeId Type identifier (unit type or building type)
   * @param playerId Owner player ID
   * @param category Entity category (Unit or Building)
   */
  registerEntity(
    entityId: number,
    typeId: string,
    playerId: string,
    category: EntityCategory
  ): EntitySlot | null {
    if (this.entityBuffer.hasEntity(entityId)) {
      return this.entityBuffer.getSlot(entityId) ?? null;
    }

    const boundingRadius = this.getBoundingRadius(typeId, category);

    const slot = this.entityBuffer.allocateSlot(
      entityId,
      typeId,
      playerId,
      category,
      boundingRadius
    );

    if (slot) {
      // Initialize visibility state
      this.visibilityMap.set(entityId, true); // Assume visible until culled
      this.lodMap.set(entityId, 0);
    }

    return slot;
  }

  /**
   * Unregister an entity from culling
   */
  unregisterEntity(entityId: number): void {
    this.entityBuffer.freeSlot(entityId);
    this.visibilityMap.delete(entityId);
    this.lodMap.delete(entityId);
  }

  /**
   * Check if an entity is registered
   */
  isRegistered(entityId: number): boolean {
    return this.entityBuffer.hasEntity(entityId);
  }

  /**
   * Update entity transform
   */
  updateTransform(
    entityId: number,
    x: number,
    y: number,
    z: number,
    rotationY: number,
    scale: number
  ): void {
    this.entityBuffer.updateTransformComponents(entityId, x, y, z, rotationY, scale);
  }

  /**
   * Update entity transform from matrix
   */
  updateTransformMatrix(entityId: number, matrix: THREE.Matrix4): void {
    this.entityBuffer.updateTransform(entityId, matrix);
  }

  /**
   * Mark an entity as static (buildings). Static entities skip per-frame transform updates.
   */
  markStatic(entityId: number): void {
    this.entityBuffer.markStatic(entityId);
  }

  /**
   * Update bounding radius for an entity (e.g., after model loads asynchronously)
   */
  updateBoundingRadius(entityId: number, radius: number): void {
    this.entityBuffer.updateBoundingRadius(entityId, Math.max(radius, MIN_BOUNDING_RADIUS));
  }

  /**
   * Recalculate bounding radius from AssetManager (call after model loads)
   */
  refreshBoundingRadius(entityId: number, typeId: string, category: EntityCategory): void {
    const radius = this.getBoundingRadius(typeId, category);
    this.entityBuffer.updateBoundingRadius(entityId, radius);
  }

  /**
   * Perform culling for all registered entities
   *
   * Call this ONCE per frame before querying visibility.
   */
  performCulling(camera: THREE.Camera): void {
    // Process quarantined slots at start of frame
    this.entityBuffer.processQuarantinedSlots();

    if (this.isGPUAvailable) {
      // GPU path - culling happens on GPU, results available via indirect args
      this.cullingCompute.cullGPU(this.entityBuffer, camera);

      // For GPU path, we still need to update CPU-side visibility map for queries
      // This is necessary because renderers need to query visibility per-entity
      this.updateVisibilityFromCPU(camera);
    } else {
      // CPU fallback path
      this.lastCullingResult = this.cullingCompute.cull(this.entityBuffer, camera);

      // Update visibility map from results
      this.visibilityMap.clear();
      this.lodMap.clear();

      for (const slot of this.lastCullingResult.visibleSlots) {
        this.visibilityMap.set(slot.entityId, true);
        const lod = this.lastCullingResult.lodAssignments.get(slot.entityId) ?? 0;
        this.lodMap.set(slot.entityId, lod);
      }
    }

    // Commit buffer changes to GPU
    this.entityBuffer.commitChanges();
  }

  /**
   * Update visibility map using CPU frustum test (for GPU path compatibility)
   */
  private updateVisibilityFromCPU(camera: THREE.Camera): void {
    this.cullingCompute.updateFrustum(camera);
    const cameraPosition = camera.position;
    const transformData = this.entityBuffer.getTransformData();
    const lodConfig = this.cullingCompute.getLODConfig();

    this.visibilityMap.clear();
    this.lodMap.clear();

    for (const slot of this.entityBuffer.getAllocatedSlots()) {
      const index = slot.index;
      const transformOffset = index * 16;

      const x = transformData[transformOffset + 12];
      const y = transformData[transformOffset + 13];
      const z = transformData[transformOffset + 14];

      // Sphere-frustum intersection
      const isVisible = this.cullingCompute.intersectsSphere(x, y, z, slot.boundingRadius);
      this.visibilityMap.set(slot.entityId, isVisible);

      if (isVisible) {
        // Calculate LOD
        const dx = x - cameraPosition.x;
        const dy = y - cameraPosition.y;
        const dz = z - cameraPosition.z;
        const distanceSq = dx * dx + dy * dy + dz * dz;

        let lod: number;
        if (distanceSq <= lodConfig.LOD0_MAX * lodConfig.LOD0_MAX) {
          lod = 0;
        } else if (distanceSq <= lodConfig.LOD1_MAX * lodConfig.LOD1_MAX) {
          lod = 1;
        } else {
          lod = 2;
        }
        this.lodMap.set(slot.entityId, lod);
      }
    }
  }

  /**
   * Check if an entity is visible (was inside frustum in last cull pass)
   */
  isVisible(entityId: number): boolean {
    return this.visibilityMap.get(entityId) ?? false;
  }

  /**
   * Get LOD level for an entity (from last cull pass)
   */
  getLOD(entityId: number): number {
    return this.lodMap.get(entityId) ?? 0;
  }

  /**
   * Get distance to camera for an entity
   */
  getDistanceToCamera(entityId: number, camera: THREE.Camera): number {
    const slot = this.entityBuffer.getSlot(entityId);
    if (!slot) return Infinity;

    const transformData = this.entityBuffer.getTransformData();
    const transformOffset = slot.index * 16;

    const x = transformData[transformOffset + 12];
    const y = transformData[transformOffset + 13];
    const z = transformData[transformOffset + 14];

    const dx = x - camera.position.x;
    const dy = y - camera.position.y;
    const dz = z - camera.position.z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Get visible entity count
   */
  getVisibleCount(): number {
    let count = 0;
    for (const visible of this.visibilityMap.values()) {
      if (visible) count++;
    }
    return count;
  }

  /**
   * Get visible count by category
   */
  getVisibleCountByCategory(category: EntityCategory): number {
    let count = 0;
    for (const slot of this.entityBuffer.getSlotsByCategory(category)) {
      if (this.visibilityMap.get(slot.entityId)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get total registered entity count
   */
  getTotalCount(): number {
    return this.entityBuffer.getActiveCount();
  }

  /**
   * Get entity slot
   */
  getSlot(entityId: number): EntitySlot | undefined {
    return this.entityBuffer.getSlot(entityId);
  }

  /**
   * Get all visible entities of a category
   */
  *getVisibleEntities(category?: EntityCategory): IterableIterator<EntitySlot> {
    const slots = category !== undefined
      ? this.entityBuffer.getSlotsByCategory(category)
      : this.entityBuffer.getAllocatedSlots();

    for (const slot of slots) {
      if (this.visibilityMap.get(slot.entityId)) {
        yield slot;
      }
    }
  }

  /**
   * Get bounding radius for a type ID
   */
  private getBoundingRadius(typeId: string, category: EntityCategory): number {
    // Try to get from cached model bounding box (most accurate)
    const visualRadius = AssetManager.getCachedVisualRadius(typeId, 0);
    if (visualRadius > MIN_BOUNDING_RADIUS) {
      // Apply multiplier for buildings
      const multiplier = category === EntityCategory.Building ? BUILDING_RADIUS_MULTIPLIER : 1.0;
      return Math.max(visualRadius * multiplier, MIN_BOUNDING_RADIUS);
    }

    // Fallback: Use configured model height as diameter estimate
    const modelHeight = AssetManager.getModelHeight(typeId);
    if (modelHeight > 0) {
      // Assume roughly cubic bounding box - radius = height * 0.6
      const baseRadius = modelHeight * 0.6;
      const multiplier = category === EntityCategory.Building ? BUILDING_RADIUS_MULTIPLIER : 1.0;
      return Math.max(baseRadius * multiplier, MIN_BOUNDING_RADIUS);
    }

    // Ultimate fallback
    return DEFAULT_BOUNDING_RADIUS;
  }

  /**
   * Swap transform buffers for velocity calculation (call at start of frame)
   */
  swapTransformBuffers(): void {
    this.entityBuffer.swapTransformBuffers();
  }

  /**
   * Check if GPU culling is active
   */
  isUsingGPU(): boolean {
    return this.isGPUAvailable;
  }

  /**
   * Force CPU fallback mode
   */
  forceCPUFallback(enable: boolean): void {
    this.cullingCompute.forceCPUFallback(enable);
    this.isGPUAvailable = !enable && this.cullingCompute.isUsingGPU();
  }

  /**
   * Get culling stats
   */
  getStats(): {
    totalEntities: number;
    visibleEntities: number;
    unitCount: number;
    buildingCount: number;
    isUsingGPU: boolean;
    quarantinedSlots: number;
  } {
    const gpuStats = this.cullingCompute.getGPUCullingStats();
    return {
      totalEntities: this.entityBuffer.getActiveCount(),
      visibleEntities: this.getVisibleCount(),
      unitCount: this.entityBuffer.getUnitCount(),
      buildingCount: this.entityBuffer.getBuildingCount(),
      isUsingGPU: gpuStats.isUsingGPU,
      quarantinedSlots: this.entityBuffer.getQuarantinedCount(),
    };
  }

  /**
   * Get the underlying entity buffer (for advanced usage)
   */
  getEntityBuffer(): GPUEntityBuffer {
    return this.entityBuffer;
  }

  /**
   * Get the underlying culling compute (for advanced usage)
   */
  getCullingCompute(): UnifiedCullingCompute {
    return this.cullingCompute;
  }

  /**
   * Clear all entities
   */
  clear(): void {
    this.entityBuffer.clear();
    this.visibilityMap.clear();
    this.lodMap.clear();
    this.lastCullingResult = null;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.entityBuffer.dispose();
    this.cullingCompute.dispose();
    this.visibilityMap.clear();
    this.lodMap.clear();
    this.lastCullingResult = null;
    this.isInitialized = false;
    this.isGPUAvailable = false;
  }
}

// Export EntityCategory for convenience
export { EntityCategory } from '../compute/GPUEntityBuffer';

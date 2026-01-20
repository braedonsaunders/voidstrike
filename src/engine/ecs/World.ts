import { Entity } from './Entity';
import {
  EntityId,
  EntityIdAllocator,
  INVALID_ENTITY_ID,
  getEntityIndex,
  isInvalidEntityId,
} from './EntityId';
import { Component, ComponentType } from './Component';
import { System } from './System';
import { SpatialGrid } from '../core/SpatialGrid';
import { debugPerformance, debugInitialization } from '@/utils/debugLogger';
import { PerformanceMonitor } from '../core/PerformanceMonitor';

/**
 * ARCHETYPE SYSTEM
 *
 * Groups entities by their exact component signature for O(archetype_count) queries
 * instead of O(smallest_component_set × num_query_components).
 *
 * Example archetypes:
 * - "Building,Health,Selectable,Transform" → 50 buildings
 * - "Health,Transform,Unit,Velocity" → 200 units
 *
 * Query "Transform,Unit" finds archetypes containing both, returns entities directly.
 */
interface Archetype {
  signature: string;           // Sorted component types joined (e.g., "Health,Transform,Unit")
  componentSet: Set<ComponentType>; // For fast subset checking
  entities: Set<EntityId>;     // Entities with this exact signature
}

/** Maximum CONCURRENT entities - with ID recycling, this is the actual limit, not lifetime total */
const MAX_ENTITIES = 4096;

export class World {
  /** Entities keyed by INDEX (not full EntityId) for O(1) lookup from SpatialGrid results */
  private entities: Map<number, Entity> = new Map();
  private systems: System[] = [];

  /** Generational entity ID allocator - handles ID recycling with stale reference detection */
  private entityIdAllocator: EntityIdAllocator = new EntityIdAllocator(MAX_ENTITIES);

  // Component storage for faster queries (kept for backwards compatibility)
  private componentIndex: Map<ComponentType, Set<EntityId>> = new Map();

  // ARCHETYPE SYSTEM: Group entities by component signature
  private archetypes: Map<string, Archetype> = new Map();      // signature → Archetype
  private entityArchetype: Map<EntityId, string> = new Map();  // entityId → signature

  // Query cache - invalidated when archetypes change (not every tick!)
  private queryCache: Map<string, Entity[]> = new Map();
  private archetypeCacheVersion: number = 0;  // Incremented when any archetype changes
  private queryCacheVersion: number = -1;     // Version when cache was last valid

  // PERF: Reusable arrays to avoid allocation
  private _querySortBuffer: ComponentType[] = [];
  private _componentBuffer: ComponentType[] = [];

  // PERF: Cached entity list to avoid allocation on every getEntities() call
  private _cachedEntities: Entity[] | null = null;
  private _entityListVersion: number = 0;
  private _cachedEntityListVersion: number = -1;

  // Spatial grids for different entity types
  public readonly unitGrid: SpatialGrid;
  public readonly buildingGrid: SpatialGrid;

  constructor(mapWidth: number = 200, mapHeight: number = 200) {
    // Cell size of 10 = ~20x20 cells for 200x200 map
    this.unitGrid = new SpatialGrid(mapWidth, mapHeight, 10);
    this.buildingGrid = new SpatialGrid(mapWidth, mapHeight, 10);
  }

  public createEntity(): Entity {
    const id = this.entityIdAllocator.allocate();
    if (isInvalidEntityId(id)) {
      throw new Error(`World: Failed to allocate entity - exceeded max capacity of ${MAX_ENTITIES}`);
    }
    const index = getEntityIndex(id);
    const entity = new Entity(id, this);
    this.entities.set(index, entity);
    // Invalidate entity list cache
    this._entityListVersion++;
    return entity;
  }

  public destroyEntity(id: EntityId): void {
    const index = getEntityIndex(id);
    const entity = this.entities.get(index);
    if (!entity) return;

    // Validate generation matches (catch stale references)
    if (entity.id !== id) {
      console.warn(`World.destroyEntity: Stale EntityId ${id}, current entity has id ${entity.id}`);
      return;
    }

    // Remove from spatial grids
    this.unitGrid.remove(index);
    this.buildingGrid.remove(index);

    // Remove from archetype (uses full EntityId for archetype tracking)
    this.removeEntityFromArchetype(entity.id);

    // Remove from component indices (kept for backwards compatibility)
    for (const [type, entityIds] of this.componentIndex) {
      entityIds.delete(entity.id);
    }

    // Mark entity as destroyed
    entity.destroy();
    this.entities.delete(index);

    // Return ID to allocator for recycling (increments generation)
    this.entityIdAllocator.free(id);

    // Invalidate entity list cache
    this._entityListVersion++;
  }

  /**
   * Remove entity from its current archetype
   */
  private removeEntityFromArchetype(entityId: EntityId): void {
    const oldSignature = this.entityArchetype.get(entityId);
    if (oldSignature) {
      const archetype = this.archetypes.get(oldSignature);
      if (archetype) {
        archetype.entities.delete(entityId);
        // Clean up empty archetypes
        if (archetype.entities.size === 0) {
          this.archetypes.delete(oldSignature);
        }
      }
      this.entityArchetype.delete(entityId);
      this.archetypeCacheVersion++;
    }
  }

  /**
   * Update entity's archetype based on its current components
   */
  private updateEntityArchetype(entityId: EntityId, entity: Entity): void {
    // Remove from old archetype
    this.removeEntityFromArchetype(entityId);

    // Get entity's current component types
    this._componentBuffer.length = 0;
    entity.getComponentTypes(this._componentBuffer);

    if (this._componentBuffer.length === 0) {
      // Entity has no components - don't add to any archetype
      return;
    }

    // Sort to create consistent signature
    this._componentBuffer.sort();
    const signature = this._componentBuffer.join(',');

    // Get or create archetype
    let archetype = this.archetypes.get(signature);
    if (!archetype) {
      archetype = {
        signature,
        componentSet: new Set(this._componentBuffer),
        entities: new Set(),
      };
      this.archetypes.set(signature, archetype);
    }

    // Add entity to archetype
    archetype.entities.add(entityId);
    this.entityArchetype.set(entityId, signature);
    this.archetypeCacheVersion++;
  }

  /**
   * Set the current tick - called by Game each frame
   * Note: Archetype system doesn't invalidate cache per-tick, only when composition changes
   */
  public setCurrentTick(_tick: number): void {
    // No-op for archetype system - cache is invalidated when archetypes change
  }

  /**
   * Get entity by full EntityId (validates generation)
   */
  public getEntity(id: EntityId): Entity | undefined {
    if (isInvalidEntityId(id)) return undefined;

    const index = getEntityIndex(id);
    const entity = this.entities.get(index);

    // Validate: entity exists, not destroyed, and generation matches
    if (!entity || entity.isDestroyed() || entity.id !== id) {
      return undefined;
    }
    return entity;
  }

  /**
   * Get entity by INDEX only (for SpatialGrid query results)
   * Use this when you have an index from SpatialGrid queries.
   * Does NOT validate generation - the entity at this index may have been recycled.
   */
  public getEntityByIndex(index: number): Entity | undefined {
    const entity = this.entities.get(index);
    if (!entity || entity.isDestroyed()) {
      return undefined;
    }
    return entity;
  }

  /**
   * Check if an entity exists and is not destroyed.
   * Use this for validation in performance-critical paths where you only need
   * to know if an entity is valid, not to retrieve it.
   */
  public isEntityValid(id: EntityId): boolean {
    if (isInvalidEntityId(id)) return false;

    const index = getEntityIndex(id);
    const entity = this.entities.get(index);
    return entity !== undefined && !entity.isDestroyed() && entity.id === id;
  }

  /**
   * Validate an entity reference is still valid (not null and not destroyed).
   * Use this when you have a cached entity reference that may have become stale.
   * Returns the entity if valid, undefined otherwise.
   *
   * USAGE: Instead of using a cached entity directly, re-validate:
   *   const entity = world.validateEntity(cachedEntity);
   *   if (!entity) return; // Entity was destroyed
   */
  public validateEntity(entity: Entity | undefined | null): Entity | undefined {
    if (!entity) return undefined;
    if (entity.isDestroyed()) return undefined;
    return entity;
  }

  public getEntities(): Entity[] {
    // PERF: Return cached list if still valid
    if (this._cachedEntities && this._cachedEntityListVersion === this._entityListVersion) {
      return this._cachedEntities;
    }

    // Rebuild cache
    this._cachedEntities = Array.from(this.entities.values()).filter((e) => !e.isDestroyed());
    this._cachedEntityListVersion = this._entityListVersion;
    return this._cachedEntities;
  }

  /**
   * ARCHETYPE-BASED QUERY
   *
   * Finds all entities with the specified components by matching archetypes.
   * O(number of archetypes) instead of O(smallest component set × query components).
   *
   * With 500 entities across 10 archetypes, this is ~50x faster than set intersection.
   */
  public getEntitiesWith(...componentTypes: ComponentType[]): Entity[] {
    if (componentTypes.length === 0) {
      return this.getEntities();
    }

    // Check if cache is still valid (only invalidated when archetypes change)
    if (this.queryCacheVersion !== this.archetypeCacheVersion) {
      this.queryCache.clear();
      this.queryCacheVersion = this.archetypeCacheVersion;
    }

    // PERF: Create cache key using reusable buffer to avoid allocation
    this._querySortBuffer.length = 0;
    for (let i = 0; i < componentTypes.length; i++) {
      this._querySortBuffer.push(componentTypes[i]);
    }
    this._querySortBuffer.sort();
    const cacheKey = this._querySortBuffer.join(',');

    // Check cache
    const cached = this.queryCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // ARCHETYPE QUERY: Find all archetypes that contain ALL required components
    const result: Entity[] = [];
    const requiredSet = new Set(componentTypes);

    for (const archetype of this.archetypes.values()) {
      // Check if archetype contains all required components
      let hasAll = true;
      for (const required of requiredSet) {
        if (!archetype.componentSet.has(required)) {
          hasAll = false;
          break;
        }
      }

      if (hasAll) {
        // Add all entities from this archetype
        for (const entityId of archetype.entities) {
          // Archetypes store full EntityIds, but entities Map is keyed by index
          const entity = this.entities.get(getEntityIndex(entityId));
          if (entity && !entity.isDestroyed()) {
            result.push(entity);
          }
        }
      }
    }

    // Cache the result
    this.queryCache.set(cacheKey, result);

    return result;
  }

  public addSystem(system: System): void {
    this.systems.push(system);
    this.systems.sort((a, b) => a.priority - b.priority);
    system.init(this);
  }

  public removeSystem(system: System): void {
    const index = this.systems.indexOf(system);
    if (index !== -1) {
      this.systems.splice(index, 1);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public getSystem<T extends System>(systemClass: new (...args: any[]) => T): T | undefined {
    return this.systems.find((s): s is T => s instanceof systemClass);
  }

  public update(deltaTime: number): void {
    const slowSystems: string[] = [];

    // Clear previous tick's timings
    PerformanceMonitor.clearSystemTimings();

    for (const system of this.systems) {
      if (system.enabled) {
        const start = performance.now();
        system.update(deltaTime);
        const elapsed = performance.now() - start;

        // Record timing for performance dashboard (use explicit name, not constructor.name which gets minified)
        PerformanceMonitor.recordSystemTiming(system.name, elapsed);

        if (elapsed > 5) {
          slowSystems.push(`${system.name}:${elapsed.toFixed(1)}ms`);
        }
      }
    }
    if (slowSystems.length > 0) {
      debugPerformance.warn(`[World] Slow systems: ${slowSystems.join(', ')}`);
    }
  }

  // Called by Entity when a component is added
  public onComponentAdded(entityId: EntityId, type: ComponentType): void {
    // Update component index (kept for backwards compatibility)
    if (!this.componentIndex.has(type)) {
      this.componentIndex.set(type, new Set());
    }
    this.componentIndex.get(type)!.add(entityId);

    // Update archetype - entity's component signature has changed
    const entity = this.entities.get(getEntityIndex(entityId));
    if (entity) {
      this.updateEntityArchetype(entityId, entity);
    }
  }

  // Called by Entity when a component is removed
  public onComponentRemoved(entityId: EntityId, type: ComponentType): void {
    // Update component index (kept for backwards compatibility)
    this.componentIndex.get(type)?.delete(entityId);

    // Update archetype - entity's component signature has changed
    const entity = this.entities.get(getEntityIndex(entityId));
    if (entity && !entity.isDestroyed()) {
      this.updateEntityArchetype(entityId, entity);
    }
  }

  public clear(): void {
    this.entities.clear();
    this.componentIndex.clear();
    this.archetypes.clear();
    this.entityArchetype.clear();
    this.queryCache.clear();
    this.archetypeCacheVersion = 0;
    this.queryCacheVersion = -1;
    this.entityIdAllocator.clear();
    this._cachedEntities = null;
    this._entityListVersion++;
  }

  /**
   * Check if an EntityId is valid using generational validation.
   * This catches stale references where the ID was recycled.
   */
  public isEntityIdValid(id: EntityId): boolean {
    return this.entityIdAllocator.isValid(id) && this.entities.has(getEntityIndex(id));
  }

  /**
   * Get the entity index from an EntityId.
   * Use this when you need the index for array-based storage (e.g., SpatialGrid).
   */
  public getEntityIndex(id: EntityId): number {
    return getEntityIndex(id);
  }

  /**
   * Get entity ID allocator stats for debugging
   */
  public getEntityIdStats(): {
    allocated: number;
    free: number;
    capacity: number;
    highWaterMark: number;
  } {
    return this.entityIdAllocator.getStats();
  }

  public getEntityCount(): number {
    return this.entities.size;
  }
}

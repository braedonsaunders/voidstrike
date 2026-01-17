import { Entity, EntityId } from './Entity';
import { Component, ComponentType } from './Component';
import { System } from './System';
import { SpatialGrid } from '../core/SpatialGrid';
import { debugPerformance } from '@/utils/debugLogger';
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

export class World {
  private entities: Map<EntityId, Entity> = new Map();
  private systems: System[] = [];
  private nextEntityId: EntityId = 1;

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

  // Spatial grids for different entity types
  public readonly unitGrid: SpatialGrid;
  public readonly buildingGrid: SpatialGrid;

  constructor(mapWidth: number = 200, mapHeight: number = 200) {
    // Cell size of 10 = ~20x20 cells for 200x200 map
    this.unitGrid = new SpatialGrid(mapWidth, mapHeight, 10);
    this.buildingGrid = new SpatialGrid(mapWidth, mapHeight, 10);
  }

  public createEntity(): Entity {
    const id = this.nextEntityId++;
    const entity = new Entity(id, this);
    this.entities.set(id, entity);
    return entity;
  }

  public destroyEntity(id: EntityId): void {
    const entity = this.entities.get(id);
    if (!entity) return;

    // Remove from spatial grids
    this.unitGrid.remove(id);
    this.buildingGrid.remove(id);

    // Remove from archetype
    this.removeEntityFromArchetype(id);

    // Remove from component indices (kept for backwards compatibility)
    for (const [type, entityIds] of this.componentIndex) {
      entityIds.delete(id);
    }

    // Mark entity as destroyed
    entity.destroy();
    this.entities.delete(id);
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

  public getEntity(id: EntityId): Entity | undefined {
    const entity = this.entities.get(id);
    // Filter out destroyed entities to prevent systems from modifying dead entities
    if (entity?.isDestroyed()) {
      return undefined;
    }
    return entity;
  }

  public getEntities(): Entity[] {
    return Array.from(this.entities.values()).filter((e) => !e.isDestroyed());
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
          const entity = this.entities.get(entityId);
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
    const entity = this.entities.get(entityId);
    if (entity) {
      this.updateEntityArchetype(entityId, entity);
    }
  }

  // Called by Entity when a component is removed
  public onComponentRemoved(entityId: EntityId, type: ComponentType): void {
    // Update component index (kept for backwards compatibility)
    this.componentIndex.get(type)?.delete(entityId);

    // Update archetype - entity's component signature has changed
    const entity = this.entities.get(entityId);
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
    this.nextEntityId = 1;
  }

  public getEntityCount(): number {
    return this.entities.size;
  }
}

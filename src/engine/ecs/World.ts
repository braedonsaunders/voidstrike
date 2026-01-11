import { Entity, EntityId } from './Entity';
import { Component, ComponentType } from './Component';
import { System } from './System';
import { SpatialGrid } from '../core/SpatialGrid';
import { debugPerformance } from '@/utils/debugLogger';

export class World {
  private entities: Map<EntityId, Entity> = new Map();
  private systems: System[] = [];
  private nextEntityId: EntityId = 1;

  // Component storage for faster queries
  private componentIndex: Map<ComponentType, Set<EntityId>> = new Map();

  // Query cache - invalidated each tick
  private queryCache: Map<string, Entity[]> = new Map();
  private currentTick: number = 0;
  private lastCacheTick: number = -1;

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

    // Remove from component indices
    for (const [type, entityIds] of this.componentIndex) {
      entityIds.delete(id);
    }

    // Mark entity as destroyed
    entity.destroy();
    this.entities.delete(id);
  }

  /**
   * Set the current tick - called by Game each frame
   * This invalidates the query cache
   */
  public setCurrentTick(tick: number): void {
    this.currentTick = tick;
  }

  public getEntity(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  public getEntities(): Entity[] {
    return Array.from(this.entities.values()).filter((e) => !e.isDestroyed());
  }

  public getEntitiesWith(...componentTypes: ComponentType[]): Entity[] {
    if (componentTypes.length === 0) {
      return this.getEntities();
    }

    // Check if cache is stale
    if (this.lastCacheTick !== this.currentTick) {
      this.queryCache.clear();
      this.lastCacheTick = this.currentTick;
    }

    // Create cache key
    const cacheKey = componentTypes.sort().join(',');

    // Check cache
    const cached = this.queryCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Start with the smallest set
    const sets = componentTypes
      .map((type) => this.componentIndex.get(type) || new Set<EntityId>())
      .sort((a, b) => a.size - b.size);

    const smallestSet = sets[0];
    const result: Entity[] = [];

    for (const entityId of smallestSet) {
      const entity = this.entities.get(entityId);
      if (!entity || entity.isDestroyed()) continue;

      // Check if entity has all required components
      let hasAll = true;
      for (const type of componentTypes) {
        if (!entity.has(type)) {
          hasAll = false;
          break;
        }
      }

      if (hasAll) {
        result.push(entity);
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
    for (const system of this.systems) {
      if (system.enabled) {
        const start = performance.now();
        system.update(deltaTime);
        const elapsed = performance.now() - start;
        if (elapsed > 5) {
          slowSystems.push(`${system.constructor.name}:${elapsed.toFixed(1)}ms`);
        }
      }
    }
    if (slowSystems.length > 0) {
      debugPerformance.warn(`[World] Slow systems: ${slowSystems.join(', ')}`);
    }
  }

  // Called by Entity when a component is added
  public onComponentAdded(entityId: EntityId, type: ComponentType): void {
    if (!this.componentIndex.has(type)) {
      this.componentIndex.set(type, new Set());
    }
    this.componentIndex.get(type)!.add(entityId);
  }

  // Called by Entity when a component is removed
  public onComponentRemoved(entityId: EntityId, type: ComponentType): void {
    this.componentIndex.get(type)?.delete(entityId);
  }

  public clear(): void {
    this.entities.clear();
    this.componentIndex.clear();
    this.nextEntityId = 1;
  }

  public getEntityCount(): number {
    return this.entities.size;
  }
}

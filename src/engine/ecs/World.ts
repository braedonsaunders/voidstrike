import { Entity, EntityId } from './Entity';
import { Component, ComponentType } from './Component';
import { System } from './System';

export class World {
  private entities: Map<EntityId, Entity> = new Map();
  private systems: System[] = [];
  private nextEntityId: EntityId = 1;

  // Component storage for faster queries
  private componentIndex: Map<ComponentType, Set<EntityId>> = new Map();

  public createEntity(): Entity {
    const id = this.nextEntityId++;
    const entity = new Entity(id, this);
    this.entities.set(id, entity);
    return entity;
  }

  public destroyEntity(id: EntityId): void {
    const entity = this.entities.get(id);
    if (!entity) return;

    // Remove from component indices
    for (const [type, entityIds] of this.componentIndex) {
      entityIds.delete(id);
    }

    // Mark entity as destroyed
    entity.destroy();
    this.entities.delete(id);
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

  public update(deltaTime: number): void {
    for (const system of this.systems) {
      if (system.enabled) {
        system.update(deltaTime);
      }
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

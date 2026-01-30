import { Component, ComponentType } from './Component';
import { World } from './World';
import { debugInitialization } from '@/utils/debugLogger';
import {
  EntityId,
  INVALID_ENTITY_ID,
  getEntityIndex,
  getEntityGeneration,
  isInvalidEntityId,
} from './EntityId';

// Re-export EntityId types and utilities for backwards compatibility
export {
  type EntityId,
  INVALID_ENTITY_ID,
  getEntityIndex,
  getEntityGeneration,
  isInvalidEntityId,
} from './EntityId';

export class Entity {
  public readonly id: EntityId;

  private components: Map<ComponentType, Component> = new Map();
  private world: World;
  private destroyed = false;

  constructor(id: EntityId, world: World) {
    this.id = id;
    this.world = world;
  }

  public add<T extends Component>(component: T): this {
    if (this.destroyed) {
      debugInitialization.warn(`Cannot add component to destroyed entity ${this.id}`);
      return this;
    }

    const type = component.type;

    // TEMP: Debug component addition for units
    if (type === 'Unit' && this.id > 200) {
      console.log(`[Entity] add: entityId=${this.id}, componentType='${type}', componentsSize=${this.components.size}`);
    }

    this.components.set(type, component);
    this.world.onComponentAdded(this.id, type);

    // TEMP: Verify component was added
    if (type === 'Unit' && this.id > 200) {
      console.log(`[Entity] add complete: entityId=${this.id}, has('Unit')=${this.components.has('Unit')}, componentsSize=${this.components.size}`);
    }

    return this;
  }

  public get<T extends Component>(type: ComponentType): T | undefined {
    return this.components.get(type) as T | undefined;
  }

  public has(type: ComponentType): boolean {
    return this.components.has(type);
  }

  public remove(type: ComponentType): boolean {
    if (this.destroyed) return false;

    const removed = this.components.delete(type);
    if (removed) {
      this.world.onComponentRemoved(this.id, type);
    }
    return removed;
  }

  /**
   * Get all component types into a provided array (avoids allocation)
   * Used by archetype system for efficient signature computation
   */
  public getComponentTypes(out: ComponentType[]): void {
    out.length = 0;
    for (const type of this.components.keys()) {
      out.push(type);
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.components.clear();
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }
}

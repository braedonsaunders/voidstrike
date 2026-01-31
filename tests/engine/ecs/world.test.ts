import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@/engine/ecs/World';
import { Component, ComponentType } from '@/engine/ecs/Component';
import { getEntityIndex, getEntityGeneration } from '@/engine/ecs/EntityId';

// Test components
class TransformComponent implements Component {
  type: ComponentType = 'Transform';
  x: number;
  y: number;

  constructor(x: number = 0, y: number = 0) {
    this.x = x;
    this.y = y;
  }
}

class HealthComponent implements Component {
  type: ComponentType = 'Health';
  current: number;
  max: number;

  constructor(current: number = 100, max: number = 100) {
    this.current = current;
    this.max = max;
  }
}

class UnitComponent implements Component {
  type: ComponentType = 'Unit';
  name: string;

  constructor(name: string = 'unit') {
    this.name = name;
  }
}

describe('World', () => {
  let world: World;

  beforeEach(() => {
    world = new World(100, 100);
  });

  describe('entity lifecycle', () => {
    it('creates entities with unique ids', () => {
      const e1 = world.createEntity();
      const e2 = world.createEntity();
      const e3 = world.createEntity();

      expect(e1.id).not.toBe(e2.id);
      expect(e2.id).not.toBe(e3.id);
      expect(e1.id).not.toBe(e3.id);
    });

    it('tracks entity count', () => {
      expect(world.getEntityCount()).toBe(0);

      world.createEntity();
      expect(world.getEntityCount()).toBe(1);

      world.createEntity();
      world.createEntity();
      expect(world.getEntityCount()).toBe(3);
    });

    it('retrieves entity by id', () => {
      const entity = world.createEntity();
      entity.add(new TransformComponent(10, 20));

      const retrieved = world.getEntity(entity.id);

      expect(retrieved).toBe(entity);
      expect(retrieved?.get<TransformComponent>('Transform')?.x).toBe(10);
    });

    it('returns undefined for invalid entity id', () => {
      const result = world.getEntity(99999);
      expect(result).toBeUndefined();
    });

    it('destroys entities', () => {
      const entity = world.createEntity();
      const entityId = entity.id;

      expect(world.getEntityCount()).toBe(1);

      world.destroyEntity(entityId);

      expect(world.getEntityCount()).toBe(0);
      expect(world.getEntity(entityId)).toBeUndefined();
      expect(entity.isDestroyed()).toBe(true);
    });
  });

  describe('entity id recycling', () => {
    it('recycles entity indices with incremented generation', () => {
      const e1 = world.createEntity();
      const index1 = getEntityIndex(e1.id);
      const gen1 = getEntityGeneration(e1.id);

      world.destroyEntity(e1.id);

      const e2 = world.createEntity();
      const index2 = getEntityIndex(e2.id);
      const gen2 = getEntityGeneration(e2.id);

      // Same index should be reused
      expect(index2).toBe(index1);
      // But generation should be incremented
      expect(gen2).toBeGreaterThan(gen1);
    });

    it('detects stale entity references', () => {
      const e1 = world.createEntity();
      const staleId = e1.id;

      world.destroyEntity(staleId);

      // Create new entity that reuses the index
      world.createEntity();

      // Stale ID should not retrieve the new entity
      expect(world.getEntity(staleId)).toBeUndefined();
      expect(world.isEntityIdValid(staleId)).toBe(false);
    });
  });

  describe('getEntities', () => {
    it('returns all entities', () => {
      world.createEntity();
      world.createEntity();
      world.createEntity();

      const entities = world.getEntities();

      expect(entities.length).toBe(3);
    });

    it('excludes destroyed entities', () => {
      const e1 = world.createEntity();
      world.createEntity();
      world.createEntity();

      world.destroyEntity(e1.id);

      const entities = world.getEntities();

      expect(entities.length).toBe(2);
    });
  });

  describe('archetype-based queries', () => {
    it('queries entities with single component', () => {
      const e1 = world.createEntity();
      e1.add(new TransformComponent());

      const e2 = world.createEntity();
      e2.add(new HealthComponent());

      const e3 = world.createEntity();
      e3.add(new TransformComponent());

      const results = world.getEntitiesWith('Transform');

      expect(results.length).toBe(2);
      expect(results).toContain(e1);
      expect(results).toContain(e3);
      expect(results).not.toContain(e2);
    });

    it('queries entities with multiple components', () => {
      const e1 = world.createEntity();
      e1.add(new TransformComponent()).add(new HealthComponent());

      const e2 = world.createEntity();
      e2.add(new TransformComponent());

      const e3 = world.createEntity();
      e3.add(new TransformComponent()).add(new HealthComponent()).add(new UnitComponent());

      const results = world.getEntitiesWith('Transform', 'Health');

      expect(results.length).toBe(2);
      expect(results).toContain(e1);
      expect(results).toContain(e3);
      expect(results).not.toContain(e2);
    });

    it('returns empty array when no entities match', () => {
      world.createEntity().add(new TransformComponent());

      const results = world.getEntitiesWith('Building');

      expect(results).toEqual([]);
    });

    it('updates archetype when components are added', () => {
      const entity = world.createEntity();
      entity.add(new TransformComponent());

      // Initially only has Transform
      expect(world.getEntitiesWith('Health')).toEqual([]);

      // Add Health
      entity.add(new HealthComponent());

      // Now should appear in Health queries
      const results = world.getEntitiesWith('Health');
      expect(results).toContain(entity);
    });

    it('updates archetype when components are removed', () => {
      const entity = world.createEntity();
      entity.add(new TransformComponent()).add(new HealthComponent());

      expect(world.getEntitiesWith('Health')).toContain(entity);

      entity.remove('Health');

      expect(world.getEntitiesWith('Health')).not.toContain(entity);
      expect(world.getEntitiesWith('Transform')).toContain(entity);
    });

    it('returns all entities when no components specified', () => {
      world.createEntity().add(new TransformComponent());
      world.createEntity().add(new HealthComponent());
      world.createEntity();

      const results = world.getEntitiesWith();

      expect(results.length).toBe(3);
    });
  });

  describe('entity validation', () => {
    it('validates entity references', () => {
      const entity = world.createEntity();

      expect(world.validateEntity(entity)).toBe(entity);
      expect(world.validateEntity(null)).toBeUndefined();
      expect(world.validateEntity(undefined)).toBeUndefined();
    });

    it('returns undefined for destroyed entity references', () => {
      const entity = world.createEntity();
      world.destroyEntity(entity.id);

      expect(world.validateEntity(entity)).toBeUndefined();
    });

    it('checks entity validity by id', () => {
      const entity = world.createEntity();

      expect(world.isEntityValid(entity.id)).toBe(true);

      world.destroyEntity(entity.id);

      expect(world.isEntityValid(entity.id)).toBe(false);
    });
  });

  describe('getEntityByIndex', () => {
    it('retrieves entity by index', () => {
      const entity = world.createEntity();
      const index = getEntityIndex(entity.id);

      const retrieved = world.getEntityByIndex(index);

      expect(retrieved).toBe(entity);
    });

    it('returns undefined for destroyed entity', () => {
      const entity = world.createEntity();
      const index = getEntityIndex(entity.id);

      world.destroyEntity(entity.id);

      expect(world.getEntityByIndex(index)).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('removes all entities', () => {
      world.createEntity().add(new TransformComponent());
      world.createEntity().add(new HealthComponent());
      world.createEntity();

      expect(world.getEntityCount()).toBe(3);

      world.clear();

      expect(world.getEntityCount()).toBe(0);
      expect(world.getEntities()).toEqual([]);
    });

    it('clears archetype indices', () => {
      world.createEntity().add(new TransformComponent());

      expect(world.getEntitiesWith('Transform').length).toBe(1);

      world.clear();

      expect(world.getEntitiesWith('Transform')).toEqual([]);
    });
  });

  describe('entity id stats', () => {
    it('reports allocation stats', () => {
      world.createEntity();
      world.createEntity();
      world.createEntity();

      const stats = world.getEntityIdStats();

      expect(stats.allocated).toBe(3);
      expect(stats.free).toBe(0);
      expect(stats.capacity).toBeGreaterThan(0);
      expect(stats.highWaterMark).toBe(3);
    });

    it('tracks free slots after destruction', () => {
      const e1 = world.createEntity();
      world.createEntity();
      world.createEntity();

      world.destroyEntity(e1.id);

      const stats = world.getEntityIdStats();

      expect(stats.allocated).toBe(2);
      expect(stats.free).toBe(1);
    });
  });

  describe('spatial grids', () => {
    it('has unit and building grids', () => {
      expect(world.unitGrid).toBeDefined();
      expect(world.buildingGrid).toBeDefined();
    });
  });
});

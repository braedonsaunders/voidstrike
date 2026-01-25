import { describe, it, expect, beforeEach } from 'vitest';
import { Entity } from '@/engine/ecs/Entity';
import { World } from '@/engine/ecs/World';
import { Component, ComponentType } from '@/engine/ecs/Component';

// Test components
class PositionComponent implements Component {
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

class VelocityComponent implements Component {
  type: ComponentType = 'Velocity';
  vx: number;
  vy: number;

  constructor(vx: number = 0, vy: number = 0) {
    this.vx = vx;
    this.vy = vy;
  }
}

describe('Entity', () => {
  let world: World;
  let entity: Entity;

  beforeEach(() => {
    world = new World(100, 100);
    entity = world.createEntity();
  });

  describe('component management', () => {
    it('adds components and retrieves them', () => {
      const position = new PositionComponent(10, 20);
      entity.add(position);

      const retrieved = entity.get<PositionComponent>('Transform');
      expect(retrieved).toBe(position);
      expect(retrieved?.x).toBe(10);
      expect(retrieved?.y).toBe(20);
    });

    it('supports method chaining when adding components', () => {
      const result = entity
        .add(new PositionComponent(5, 5))
        .add(new HealthComponent(50, 100));

      expect(result).toBe(entity);
      expect(entity.has('Transform')).toBe(true);
      expect(entity.has('Health')).toBe(true);
    });

    it('returns undefined for missing components', () => {
      const result = entity.get<PositionComponent>('Transform');
      expect(result).toBeUndefined();
    });

    it('checks component existence with has()', () => {
      expect(entity.has('Transform')).toBe(false);

      entity.add(new PositionComponent());

      expect(entity.has('Transform')).toBe(true);
      expect(entity.has('Health')).toBe(false);
    });

    it('removes components', () => {
      entity.add(new PositionComponent());
      expect(entity.has('Transform')).toBe(true);

      const removed = entity.remove('Transform');

      expect(removed).toBe(true);
      expect(entity.has('Transform')).toBe(false);
    });

    it('returns false when removing non-existent component', () => {
      const removed = entity.remove('Transform');
      expect(removed).toBe(false);
    });

    it('replaces component when adding same type', () => {
      entity.add(new PositionComponent(10, 10));
      entity.add(new PositionComponent(20, 30));

      const pos = entity.get<PositionComponent>('Transform');
      expect(pos?.x).toBe(20);
      expect(pos?.y).toBe(30);
    });
  });

  describe('getComponentTypes', () => {
    it('returns empty array for entity with no components', () => {
      const types: ComponentType[] = [];
      entity.getComponentTypes(types);

      expect(types).toEqual([]);
    });

    it('returns all component types', () => {
      entity.add(new PositionComponent());
      entity.add(new HealthComponent());
      entity.add(new VelocityComponent());

      const types: ComponentType[] = [];
      entity.getComponentTypes(types);

      expect(types.length).toBe(3);
      expect(types).toContain('Transform');
      expect(types).toContain('Health');
      expect(types).toContain('Velocity');
    });

    it('clears the output array before populating', () => {
      entity.add(new PositionComponent());

      const types: ComponentType[] = ['Selectable', 'Building'];
      entity.getComponentTypes(types);

      expect(types.length).toBe(1);
      expect(types).toEqual(['Transform']);
    });
  });

  describe('destruction', () => {
    it('marks entity as destroyed', () => {
      expect(entity.isDestroyed()).toBe(false);

      entity.destroy();

      expect(entity.isDestroyed()).toBe(true);
    });

    it('clears components on destroy', () => {
      entity.add(new PositionComponent());
      entity.add(new HealthComponent());

      entity.destroy();

      expect(entity.get('Transform')).toBeUndefined();
      expect(entity.get('Health')).toBeUndefined();
    });

    it('prevents adding components to destroyed entity', () => {
      entity.destroy();
      entity.add(new PositionComponent());

      // Should not throw, but component should not be added
      expect(entity.has('Transform')).toBe(false);
    });

    it('prevents removing components from destroyed entity', () => {
      entity.add(new PositionComponent());
      entity.destroy();

      const removed = entity.remove('Transform');
      expect(removed).toBe(false);
    });
  });

  describe('entity id', () => {
    it('has a valid entity id', () => {
      expect(entity.id).toBeGreaterThan(0);
    });

    it('each entity has unique id', () => {
      const entity2 = world.createEntity();
      const entity3 = world.createEntity();

      expect(entity.id).not.toBe(entity2.id);
      expect(entity2.id).not.toBe(entity3.id);
      expect(entity.id).not.toBe(entity3.id);
    });
  });
});

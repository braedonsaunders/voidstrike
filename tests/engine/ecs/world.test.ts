import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { World } from '@/engine/ecs/World';
import { Component } from '@/engine/ecs/Component';
import { getEntityIndex } from '@/engine/ecs/EntityId';

class Position extends Component {
  public readonly type = 'Position';
  constructor(public x = 0, public y = 0) {
    super();
  }
}

class Health extends Component {
  public readonly type = 'Health';
  constructor(public value = 100) {
    super();
  }
}

describe('World', () => {
  it('creates, validates, and destroys entities', () => {
    const world = new World(32, 32);
    const entity = world.createEntity();

    assert.ok(world.isEntityValid(entity.id));
    assert.strictEqual(world.getEntity(entity.id), entity);

    const firstIndex = getEntityIndex(entity.id);
    world.destroyEntity(entity.id);

    assert.ok(!world.isEntityValid(entity.id));
    assert.strictEqual(world.getEntity(entity.id), undefined);
    assert.strictEqual(world.getEntityCount(), 0);

    const replacement = world.createEntity();
    assert.ok(world.isEntityValid(replacement.id));
    assert.notStrictEqual(replacement.id, entity.id);
    assert.strictEqual(world.getEntityCount(), 1);
    assert.strictEqual(getEntityIndex(replacement.id), firstIndex);
  });

  it('tracks archetypes and invalidates query caches on component changes', () => {
    const world = new World(64, 64);
    const entity = world.createEntity();

    entity.add(new Position(5, 7));

    const firstQuery = world.getEntitiesWith('Position');
    const secondQuery = world.getEntitiesWith('Position');

    assert.deepStrictEqual(firstQuery, [entity]);
    assert.strictEqual(firstQuery, secondQuery);

    entity.add(new Health(75));

    const updatedQuery = world.getEntitiesWith('Position');
    assert.notStrictEqual(updatedQuery, firstQuery);
    assert.deepStrictEqual(updatedQuery, [entity]);

    assert.deepStrictEqual(world.getEntitiesWith('Position', 'Health'), [entity]);

    entity.remove('Health');

    assert.deepStrictEqual(world.getEntitiesWith('Health'), []);
    assert.deepStrictEqual(world.getEntitiesWith('Position'), [entity]);
  });

  it('keeps entity caches in sync after destruction', () => {
    const world = new World(20, 20);
    const first = world.createEntity();
    const second = world.createEntity();

    const initial = world.getEntities();
    assert.deepStrictEqual(initial, [first, second]);

    world.destroyEntity(first.id);

    const afterDestroy = world.getEntities();
    assert.deepStrictEqual(afterDestroy, [second]);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EntityIdAllocator,
  INVALID_ENTITY_ID,
  MAX_ENTITY_INDEX,
  MAX_GENERATION,
  getEntityGeneration,
  getEntityIndex,
  isInvalidEntityId,
  packEntityId,
} from '@/engine/ecs/EntityId';

describe('EntityId utilities', () => {
  it('packs and unpacks entity ids', () => {
    const id = packEntityId(42, 7);
    assert.strictEqual(getEntityIndex(id), 42);
    assert.strictEqual(getEntityGeneration(id), 7);
  });

  it('reserves invalid entity id sentinel', () => {
    assert.ok(isInvalidEntityId(INVALID_ENTITY_ID));
    assert.strictEqual(getEntityIndex(INVALID_ENTITY_ID), 0);
    assert.strictEqual(getEntityGeneration(INVALID_ENTITY_ID), 0);
  });

  it('masks indices and generations to allowed ranges', () => {
    const id = packEntityId(MAX_ENTITY_INDEX + 10, MAX_GENERATION + 5);
    assert.strictEqual(getEntityIndex(id), MAX_ENTITY_INDEX + 10 & MAX_ENTITY_INDEX);
    assert.strictEqual(getEntityGeneration(id), (MAX_GENERATION + 5) & MAX_GENERATION);
  });
});

describe('EntityIdAllocator', () => {
  it('allocates and validates ids, then recycles with generation increment', () => {
    const allocator = new EntityIdAllocator(4);

    const first = allocator.allocate();
    const second = allocator.allocate();

    assert.ok(allocator.isValid(first));
    assert.ok(allocator.isValid(second));
    assert.strictEqual(allocator.getAllocatedCount(), 2);

    allocator.free(first);

    assert.strictEqual(allocator.isValid(first), false);
    assert.strictEqual(allocator.getFreeCount(), 1);

    const recycled = allocator.allocate();
    assert.strictEqual(getEntityIndex(recycled), getEntityIndex(first));
    assert.ok(getEntityGeneration(recycled) > getEntityGeneration(first));
  });

  it('returns invalid id when capacity exceeded', () => {
    const allocator = new EntityIdAllocator(2);

    const first = allocator.allocate();
    const second = allocator.allocate();
    const third = allocator.allocate();

    assert.ok(!isInvalidEntityId(first));
    assert.ok(isInvalidEntityId(second));
    assert.ok(isInvalidEntityId(third));
  });

  it('resets allocator state on clear', () => {
    const allocator = new EntityIdAllocator(8);
    allocator.allocate();
    allocator.allocate();

    allocator.clear();

    assert.strictEqual(allocator.getAllocatedCount(), 0);
    assert.strictEqual(allocator.getFreeCount(), 0);
    assert.strictEqual(allocator.getStats().highWaterMark, 0);
  });
});

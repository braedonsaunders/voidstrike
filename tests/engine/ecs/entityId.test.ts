import { describe, it, expect } from 'vitest';
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
    expect(getEntityIndex(id)).toBe(42);
    expect(getEntityGeneration(id)).toBe(7);
  });

  it('reserves invalid entity id sentinel', () => {
    expect(isInvalidEntityId(INVALID_ENTITY_ID)).toBe(true);
    expect(getEntityIndex(INVALID_ENTITY_ID)).toBe(0);
    expect(getEntityGeneration(INVALID_ENTITY_ID)).toBe(0);
  });

  it('masks indices and generations to allowed ranges', () => {
    const id = packEntityId(MAX_ENTITY_INDEX + 10, MAX_GENERATION + 5);
    expect(getEntityIndex(id)).toBe(MAX_ENTITY_INDEX + 10 & MAX_ENTITY_INDEX);
    expect(getEntityGeneration(id)).toBe((MAX_GENERATION + 5) & MAX_GENERATION);
  });
});

describe('EntityIdAllocator', () => {
  it('allocates and validates ids, then recycles with generation increment', () => {
    const allocator = new EntityIdAllocator(4);

    const first = allocator.allocate();
    const second = allocator.allocate();

    expect(allocator.isValid(first)).toBe(true);
    expect(allocator.isValid(second)).toBe(true);
    expect(allocator.getAllocatedCount()).toBe(2);

    allocator.free(first);

    expect(allocator.isValid(first)).toBe(false);
    expect(allocator.getFreeCount()).toBe(1);

    const recycled = allocator.allocate();
    expect(getEntityIndex(recycled)).toBe(getEntityIndex(first));
    expect(getEntityGeneration(recycled)).toBeGreaterThan(getEntityGeneration(first));
  });

  it('returns invalid id when capacity exceeded', () => {
    const allocator = new EntityIdAllocator(2);

    const first = allocator.allocate();
    const second = allocator.allocate();
    const third = allocator.allocate();

    expect(isInvalidEntityId(first)).toBe(false);
    expect(isInvalidEntityId(second)).toBe(true);
    expect(isInvalidEntityId(third)).toBe(true);
  });

  it('resets allocator state on clear', () => {
    const allocator = new EntityIdAllocator(8);
    allocator.allocate();
    allocator.allocate();

    allocator.clear();

    expect(allocator.getAllocatedCount()).toBe(0);
    expect(allocator.getFreeCount()).toBe(0);
    expect(allocator.getStats().highWaterMark).toBe(0);
  });
});

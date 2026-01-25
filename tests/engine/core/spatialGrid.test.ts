import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SpatialGrid, SpatialUnitState } from '@/engine/core/SpatialGrid';

describe('SpatialGrid', () => {
  it('updates entities and queries by radius', () => {
    const grid = new SpatialGrid(20, 20, 5);

    grid.updateFull(1, 2, 2, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
    grid.updateFull(2, 12, 12, 1, false, SpatialUnitState.Moving, 2, 1, false, 4);

    const nearOrigin = grid.queryRadius(0, 0, 5);
    assert.deepStrictEqual(nearOrigin.sort(), [1]);

    const nearCenter = grid.queryRadius(10, 10, 5);
    assert.deepStrictEqual(nearCenter.sort(), [2]);
  });

  it('tracks entity data and updates positions', () => {
    const grid = new SpatialGrid(20, 20, 5);
    grid.updateFull(3, 4, 4, 1, true, SpatialUnitState.Attacking, 1, 1, true, 2.5);

    const data = grid.getEntityData(3);
    assert.ok(data);
    assert.strictEqual(data.id, 3);
    assert.strictEqual(data.isFlying, true);
    assert.strictEqual(data.isWorker, true);
    assert.strictEqual(data.state, SpatialUnitState.Attacking);

    const movedWithinCell = grid.updatePosition(3, 4.5, 4.5);
    assert.strictEqual(movedWithinCell, false);

    const movedCell = grid.updatePosition(3, 9, 9);
    assert.strictEqual(movedCell, true);

    const position = grid.getEntityPosition(3);
    assert.ok(position);
    assert.strictEqual(position.x, 9);
    assert.strictEqual(position.y, 9);
  });

  it('queries rectangles and detects enemies', () => {
    const grid = new SpatialGrid(30, 30, 5);
    grid.updateFull(4, 6, 6, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
    grid.updateFull(5, 8, 8, 1, false, SpatialUnitState.Idle, 2, 1, false, 3);

    const rectHits = grid.queryRect(4, 4, 10, 10);
    assert.deepStrictEqual(rectHits.sort(), [4, 5]);

    assert.strictEqual(grid.hasEnemyInRadius(6, 6, 5, 1), true);
    assert.strictEqual(grid.hasEnemyInRadius(6, 6, 5, 2), true);
    assert.strictEqual(grid.hasEnemyInRadius(6, 6, 2, 1), true);
    assert.strictEqual(grid.hasEnemyInRadius(20, 20, 5, 1), false);
  });

  it('tracks hot cells and resets state', () => {
    const grid = new SpatialGrid(20, 20, 5);
    grid.updateFull(6, 2, 2, 1, false, SpatialUnitState.Idle, 1, 1, false, 2);
    grid.updateFull(7, 3, 3, 1, false, SpatialUnitState.Idle, 2, 1, false, 2);

    const hotCells = grid.getHotCells();
    assert.ok(hotCells.size > 0);
    assert.strictEqual(grid.isInHotCell(2, 2, hotCells), true);

    const stats = grid.getStats();
    assert.strictEqual(stats.entityCount, 2);
    assert.ok(stats.cellCount > 0);

    grid.clear();
    assert.strictEqual(grid.getStats().entityCount, 0);
    assert.deepStrictEqual(grid.queryRadius(2, 2, 5), []);
  });
});

import { describe, it, expect } from 'vitest';
import { SpatialGrid, SpatialUnitState } from '@/engine/core/SpatialGrid';

describe('SpatialGrid', () => {
  it('updates entities and queries by radius', () => {
    const grid = new SpatialGrid(20, 20, 5);

    grid.updateFull(1, 2, 2, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
    grid.updateFull(2, 12, 12, 1, false, SpatialUnitState.Moving, 2, 1, false, 4);

    const nearOrigin = grid.queryRadius(0, 0, 5);
    expect(nearOrigin.sort()).toEqual([1]);

    const nearCenter = grid.queryRadius(10, 10, 5);
    expect(nearCenter.sort()).toEqual([2]);
  });

  it('tracks entity data and updates positions', () => {
    const grid = new SpatialGrid(20, 20, 5);
    grid.updateFull(3, 4, 4, 1, true, SpatialUnitState.Attacking, 1, 1, true, 2.5);

    const data = grid.getEntityData(3);
    expect(data).toBeTruthy();
    expect(data!.id).toBe(3);
    expect(data!.isFlying).toBe(true);
    expect(data!.isWorker).toBe(true);
    expect(data!.state).toBe(SpatialUnitState.Attacking);

    const movedWithinCell = grid.updatePosition(3, 4.5, 4.5);
    expect(movedWithinCell).toBe(false);

    const movedCell = grid.updatePosition(3, 9, 9);
    expect(movedCell).toBe(true);

    const position = grid.getEntityPosition(3);
    expect(position).toBeTruthy();
    expect(position!.x).toBe(9);
    expect(position!.y).toBe(9);
  });

  it('queries rectangles and detects enemies', () => {
    const grid = new SpatialGrid(30, 30, 5);
    grid.updateFull(4, 6, 6, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
    grid.updateFull(5, 8, 8, 1, false, SpatialUnitState.Idle, 2, 1, false, 3);

    const rectHits = grid.queryRect(4, 4, 10, 10);
    expect(rectHits.sort()).toEqual([4, 5]);

    expect(grid.hasEnemyInRadius(6, 6, 5, 1)).toBe(true);
    expect(grid.hasEnemyInRadius(6, 6, 5, 2)).toBe(true);
    expect(grid.hasEnemyInRadius(6, 6, 2, 1)).toBe(true);
    expect(grid.hasEnemyInRadius(20, 20, 5, 1)).toBe(false);
  });

  it('tracks hot cells and resets state', () => {
    const grid = new SpatialGrid(20, 20, 5);
    grid.updateFull(6, 2, 2, 1, false, SpatialUnitState.Idle, 1, 1, false, 2);
    grid.updateFull(7, 3, 3, 1, false, SpatialUnitState.Idle, 2, 1, false, 2);

    const hotCells = grid.getHotCells();
    expect(hotCells.size).toBeGreaterThan(0);
    expect(grid.isInHotCell(2, 2, hotCells)).toBe(true);

    const stats = grid.getStats();
    expect(stats.entityCount).toBe(2);
    expect(stats.cellCount).toBeGreaterThan(0);

    grid.clear();
    expect(grid.getStats().entityCount).toBe(0);
    expect(grid.queryRadius(2, 2, 5)).toEqual([]);
  });
});

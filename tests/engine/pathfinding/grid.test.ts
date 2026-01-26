import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialGrid } from '@/engine/pathfinding/Grid';

describe('SpatialGrid (Pathfinding)', () => {
  let grid: SpatialGrid;

  beforeEach(() => {
    grid = new SpatialGrid(100, 100, 10);
  });

  describe('constructor', () => {
    it('creates grid with specified dimensions', () => {
      expect(grid.getCellSize()).toBe(10);
    });

    it('uses default cell size of 2', () => {
      const defaultGrid = new SpatialGrid(50, 50);
      expect(defaultGrid.getCellSize()).toBe(2);
    });
  });

  describe('insert and remove', () => {
    it('inserts entity into grid', () => {
      grid.insert(1, 15, 25);

      const entities = grid.getEntitiesInCell(15, 25);
      expect(entities.has(1)).toBe(true);
    });

    it('removes entity from grid', () => {
      grid.insert(1, 15, 25);
      grid.remove(1, 15, 25);

      const entities = grid.getEntitiesInCell(15, 25);
      expect(entities.has(1)).toBe(false);
    });

    it('handles removing non-existent entity', () => {
      // Should not throw
      grid.remove(999, 15, 25);
    });

    it('groups entities in same cell', () => {
      grid.insert(1, 15, 15);
      grid.insert(2, 17, 17); // Same cell (cell size 10)
      grid.insert(3, 18, 19);

      const entities = grid.getEntitiesInCell(15, 15);
      expect(entities.size).toBe(3);
      expect(entities.has(1)).toBe(true);
      expect(entities.has(2)).toBe(true);
      expect(entities.has(3)).toBe(true);
    });
  });

  describe('move', () => {
    it('moves entity between cells', () => {
      grid.insert(1, 5, 5);
      grid.move(1, 5, 5, 25, 25);

      expect(grid.getEntitiesInCell(5, 5).has(1)).toBe(false);
      expect(grid.getEntitiesInCell(25, 25).has(1)).toBe(true);
    });

    it('does nothing if staying in same cell', () => {
      grid.insert(1, 5, 5);
      grid.move(1, 5, 5, 6, 6); // Same cell

      expect(grid.getEntitiesInCell(5, 5).has(1)).toBe(true);
    });
  });

  describe('query (radius)', () => {
    it('finds entities within radius', () => {
      grid.insert(1, 50, 50);
      grid.insert(2, 55, 55);
      grid.insert(3, 90, 90); // Far away

      const result = grid.query(50, 50, 15);

      expect(result.has(1)).toBe(true);
      expect(result.has(2)).toBe(true);
      expect(result.has(3)).toBe(false);
    });

    it('returns empty set for empty area', () => {
      const result = grid.query(50, 50, 10);
      expect(result.size).toBe(0);
    });

    it('handles large radius', () => {
      grid.insert(1, 10, 10);
      grid.insert(2, 90, 90);

      const result = grid.query(50, 50, 100);

      expect(result.has(1)).toBe(true);
      expect(result.has(2)).toBe(true);
    });
  });

  describe('queryRect', () => {
    it('finds entities within rectangle', () => {
      grid.insert(1, 20, 20);
      grid.insert(2, 30, 30);
      grid.insert(3, 80, 80);

      const result = grid.queryRect(10, 10, 40, 40);

      expect(result.has(1)).toBe(true);
      expect(result.has(2)).toBe(true);
      expect(result.has(3)).toBe(false);
    });

    it('returns empty set for empty area', () => {
      const result = grid.queryRect(0, 0, 10, 10);
      expect(result.size).toBe(0);
    });
  });

  describe('walkability', () => {
    it('cells are walkable by default', () => {
      expect(grid.isWalkable(50, 50)).toBe(true);
    });

    it('sets cell as unwalkable', () => {
      grid.setWalkable(50, 50, false);
      expect(grid.isWalkable(50, 50)).toBe(false);
    });

    it('sets cell as walkable', () => {
      grid.setWalkable(50, 50, false);
      grid.setWalkable(50, 50, true);
      expect(grid.isWalkable(50, 50)).toBe(true);
    });

    it('treats unvisited cells as walkable', () => {
      expect(grid.isWalkable(99, 99)).toBe(true);
    });
  });

  describe('getEntitiesInCell', () => {
    it('returns entities in specific cell', () => {
      grid.insert(1, 25, 25);
      grid.insert(2, 26, 26);

      const entities = grid.getEntitiesInCell(25, 25);

      expect(entities.has(1)).toBe(true);
      expect(entities.has(2)).toBe(true);
    });

    it('returns empty set for empty cell', () => {
      const entities = grid.getEntitiesInCell(50, 50);
      expect(entities.size).toBe(0);
    });
  });

  describe('clear', () => {
    it('removes all entities and cells', () => {
      grid.insert(1, 10, 10);
      grid.insert(2, 20, 20);
      grid.setWalkable(30, 30, false);

      grid.clear();

      expect(grid.getEntitiesInCell(10, 10).size).toBe(0);
      expect(grid.getEntitiesInCell(20, 20).size).toBe(0);
      // After clear, unvisited cells are walkable by default
      expect(grid.isWalkable(30, 30)).toBe(true);
    });
  });

  describe('cell boundary behavior', () => {
    it('entities at cell boundaries go to correct cell', () => {
      // Cell size 10: cells are 0-9, 10-19, 20-29, etc.
      grid.insert(1, 9, 9);   // Cell 0
      grid.insert(2, 10, 10); // Cell 1
      grid.insert(3, 19, 19); // Cell 1
      grid.insert(4, 20, 20); // Cell 2

      expect(grid.getEntitiesInCell(0, 0).has(1)).toBe(true);
      expect(grid.getEntitiesInCell(10, 10).has(2)).toBe(true);
      expect(grid.getEntitiesInCell(10, 10).has(3)).toBe(true);
      expect(grid.getEntitiesInCell(20, 20).has(4)).toBe(true);
    });
  });

  describe('reuses result set (performance)', () => {
    it('query reuses internal set', () => {
      grid.insert(1, 50, 50);

      const result1 = grid.query(50, 50, 10);
      const result2 = grid.query(50, 50, 10);

      // Same reference (reused set)
      expect(result1).toBe(result2);
    });

    it('queryRect reuses internal set', () => {
      grid.insert(1, 50, 50);

      const result1 = grid.queryRect(40, 40, 60, 60);
      const result2 = grid.queryRect(40, 40, 60, 60);

      expect(result1).toBe(result2);
    });
  });
});

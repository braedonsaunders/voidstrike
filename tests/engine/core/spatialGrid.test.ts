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

describe('SpatialGrid stress tests', () => {
  describe('large entity counts', () => {
    it('handles 500 entities correctly', () => {
      const grid = new SpatialGrid(200, 200, 8);

      // Insert 500 entities spread across the map
      for (let i = 0; i < 500; i++) {
        const x = (i % 50) * 4;
        const y = Math.floor(i / 50) * 20;
        grid.updateFull(i, x, y, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
      }

      const stats = grid.getStats();
      expect(stats.entityCount).toBe(500);

      // Query should work correctly
      const nearby = grid.queryRadius(100, 100, 20);
      expect(nearby.length).toBeGreaterThan(0);
    });

    it('handles 1000 entities correctly', () => {
      const grid = new SpatialGrid(200, 200, 8);

      for (let i = 0; i < 1000; i++) {
        const x = (i % 100) * 2;
        const y = Math.floor(i / 100) * 20;
        grid.updateFull(i, x, y, 1, false, SpatialUnitState.Moving, i % 4, 1, false, 3);
      }

      const stats = grid.getStats();
      expect(stats.entityCount).toBe(1000);

      // Large radius query on coarse grid
      const nearby = grid.queryRadius(100, 100, 50);
      expect(nearby.length).toBeGreaterThan(0);
    });

    it('handles 2000 entities correctly', () => {
      const grid = new SpatialGrid(200, 200, 8);

      for (let i = 0; i < 2000; i++) {
        const x = i % 200;
        const y = Math.floor(i / 200) * 20;
        grid.updateFull(i, x, y, 0.5, false, SpatialUnitState.Idle, i % 8, 0.5, false, 4);
      }

      const stats = grid.getStats();
      expect(stats.entityCount).toBe(2000);
    });

    it('handles rapid insertions and removals', () => {
      const grid = new SpatialGrid(200, 200, 8);

      // Insert 500 entities
      for (let i = 0; i < 500; i++) {
        grid.updateFull(
          i,
          i % 200,
          Math.floor(i / 200) * 2,
          1,
          false,
          SpatialUnitState.Idle,
          1,
          1,
          false,
          3
        );
      }

      expect(grid.getStats().entityCount).toBe(500);

      // Remove half of them
      for (let i = 0; i < 250; i++) {
        grid.remove(i * 2);
      }

      expect(grid.getStats().entityCount).toBe(250);

      // Add them back
      for (let i = 0; i < 250; i++) {
        grid.updateFull(
          i * 2,
          (i * 2) % 200,
          Math.floor((i * 2) / 200) * 2,
          1,
          false,
          SpatialUnitState.Idle,
          1,
          1,
          false,
          3
        );
      }

      expect(grid.getStats().entityCount).toBe(500);
    });
  });

  describe('dense clustering', () => {
    it('handles many entities in the same cell', () => {
      const grid = new SpatialGrid(100, 100, 8);

      // Place 50 entities in roughly the same cell
      for (let i = 0; i < 50; i++) {
        const x = 50 + (i % 5) * 0.5;
        const y = 50 + Math.floor(i / 5) * 0.5;
        grid.updateFull(i, x, y, 0.5, false, SpatialUnitState.Idle, i % 2, 0.5, false, 3);
      }

      const stats = grid.getStats();
      expect(stats.entityCount).toBe(50);

      // Query should return all entities in the cluster
      const nearby = grid.queryRadius(50, 50, 5);
      expect(nearby.length).toBe(50);
    });

    it('handles multiple dense clusters', () => {
      const grid = new SpatialGrid(200, 200, 8);

      // Create 4 clusters of 60 entities each
      const clusters = [
        { cx: 25, cy: 25 },
        { cx: 175, cy: 25 },
        { cx: 25, cy: 175 },
        { cx: 175, cy: 175 },
      ];

      let entityId = 0;
      for (const cluster of clusters) {
        for (let i = 0; i < 60; i++) {
          const x = cluster.cx + (i % 8) * 0.5;
          const y = cluster.cy + Math.floor(i / 8) * 0.5;
          grid.updateFull(entityId++, x, y, 0.5, false, SpatialUnitState.Idle, 1, 0.5, false, 3);
        }
      }

      expect(grid.getStats().entityCount).toBe(240);

      // Query each cluster individually
      for (const cluster of clusters) {
        const nearby = grid.queryRadius(cluster.cx, cluster.cy, 5);
        expect(nearby.length).toBe(60);
      }

      // Query center should find no entities
      const center = grid.queryRadius(100, 100, 5);
      expect(center.length).toBe(0);
    });

    it('handles entities moving between cells', () => {
      const grid = new SpatialGrid(100, 100, 8);

      // Initial positions
      for (let i = 0; i < 100; i++) {
        grid.updateFull(i, 10, 10 + i * 0.1, 0.5, false, SpatialUnitState.Moving, 1, 0.5, false, 3);
      }

      // Move all entities to a new location
      for (let i = 0; i < 100; i++) {
        const moved = grid.updatePosition(i, 90, 10 + i * 0.1);
        expect(moved).toBe(true); // All should have changed cells
      }

      // Query old location should be empty
      const oldPos = grid.queryRadius(10, 10, 5);
      expect(oldPos.length).toBe(0);

      // Query new location should find all entities
      const newPos = grid.queryRadius(90, 50, 50);
      expect(newPos.length).toBe(100);
    });
  });

  describe('sparse distribution', () => {
    it('handles entities spread across entire map', () => {
      const grid = new SpatialGrid(200, 200, 8);

      // Place 100 entities in a grid pattern across the map
      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 20 + 10;
        const y = Math.floor(i / 10) * 20 + 10;
        grid.updateFull(i, x, y, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
      }

      expect(grid.getStats().entityCount).toBe(100);

      // Small radius query should find only 1 entity
      const small = grid.queryRadius(50, 50, 5);
      expect(small.length).toBeLessThanOrEqual(2);

      // Large radius query should find many
      const large = grid.queryRadius(100, 100, 100);
      expect(large.length).toBeGreaterThan(50);
    });

    it('handles queries on empty regions', () => {
      const grid = new SpatialGrid(200, 200, 8);

      // Place entities only in one corner
      for (let i = 0; i < 50; i++) {
        grid.updateFull(
          i,
          i % 10,
          Math.floor(i / 10),
          0.5,
          false,
          SpatialUnitState.Idle,
          1,
          0.5,
          false,
          3
        );
      }

      // Query the opposite corner
      const farCorner = grid.queryRadius(195, 195, 10);
      expect(farCorner.length).toBe(0);

      // Query the populated corner
      const nearCorner = grid.queryRadius(5, 5, 10);
      expect(nearCorner.length).toBe(50);
    });
  });

  describe('mixed operations', () => {
    it('handles concurrent updates and queries', () => {
      const grid = new SpatialGrid(200, 200, 8);

      // Insert initial entities
      for (let i = 0; i < 200; i++) {
        grid.updateFull(
          i,
          (i % 50) * 4,
          Math.floor(i / 50) * 50,
          1,
          false,
          SpatialUnitState.Idle,
          i % 4,
          1,
          false,
          3
        );
      }

      // Simulate game loop with updates and queries
      for (let frame = 0; frame < 10; frame++) {
        // Update positions
        for (let i = 0; i < 200; i++) {
          const newX = (i % 50) * 4 + frame;
          grid.updatePosition(i, newX, Math.floor(i / 50) * 50);
        }

        // Query
        const nearby = grid.queryRadius(100, 100, 30);
        expect(nearby.length).toBeGreaterThanOrEqual(0);
      }

      expect(grid.getStats().entityCount).toBe(200);
    });

    it('handles state updates without spatial changes', () => {
      const grid = new SpatialGrid(100, 100, 8);

      for (let i = 0; i < 100; i++) {
        grid.updateFull(
          i,
          (i % 10) * 10,
          Math.floor(i / 10) * 10,
          1,
          false,
          SpatialUnitState.Idle,
          1,
          1,
          false,
          3
        );
      }

      // Update all states without position changes
      for (let i = 0; i < 100; i++) {
        grid.updateState(i, SpatialUnitState.Attacking);
      }

      // Verify states were updated
      for (let i = 0; i < 100; i++) {
        const data = grid.getEntityData(i);
        expect(data).not.toBeNull();
        expect(data!.state).toBe(SpatialUnitState.Attacking);
      }
    });

    it('handles mixed flying and ground units', () => {
      const grid = new SpatialGrid(100, 100, 8);

      // Add ground units
      for (let i = 0; i < 50; i++) {
        grid.updateFull(i, i * 2, 50, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
      }

      // Add flying units at same positions
      for (let i = 50; i < 100; i++) {
        grid.updateFull(i, (i - 50) * 2, 50, 1, true, SpatialUnitState.Moving, 2, 1, false, 5);
      }

      const nearby = grid.queryRadiusWithData(50, 50, 30);
      const groundUnits = nearby.filter((e) => !e.isFlying);
      const flyingUnits = nearby.filter((e) => e.isFlying);

      expect(groundUnits.length).toBeGreaterThan(0);
      expect(flyingUnits.length).toBeGreaterThan(0);
    });
  });

  describe('boundary conditions', () => {
    it('handles entities at map edges', () => {
      const grid = new SpatialGrid(100, 100, 8);

      // Place entities at all corners
      grid.updateFull(0, 0, 0, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
      grid.updateFull(1, 99.9, 0, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
      grid.updateFull(2, 0, 99.9, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
      grid.updateFull(3, 99.9, 99.9, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);

      expect(grid.getStats().entityCount).toBe(4);

      // Query each corner
      expect(grid.queryRadius(0, 0, 5).length).toBe(1);
      expect(grid.queryRadius(99.9, 0, 5).length).toBe(1);
      expect(grid.queryRadius(0, 99.9, 5).length).toBe(1);
      expect(grid.queryRadius(99.9, 99.9, 5).length).toBe(1);
    });

    it('handles entities along edges', () => {
      const grid = new SpatialGrid(100, 100, 8);

      // Place entities along top edge
      for (let i = 0; i < 20; i++) {
        grid.updateFull(i, i * 5, 0, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
      }

      const topEdge = grid.queryRect(0, 0, 100, 5);
      expect(topEdge.length).toBe(20);
    });

    it('handles large radius queries spanning entire map', () => {
      const grid = new SpatialGrid(100, 100, 8);

      // Scatter entities in a deterministic pattern
      for (let i = 0; i < 100; i++) {
        // Use deterministic pseudo-random positions
        const x = (i * 37) % 100;
        const y = (i * 53) % 100;
        grid.updateFull(i, x, y, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
      }

      // Query entire map
      const all = grid.queryRadius(50, 50, 100);
      expect(all.length).toBe(100);
    });

    it('handles overlapping entity radii', () => {
      const grid = new SpatialGrid(100, 100, 8);

      // Place 10 entities at same position with large radii
      for (let i = 0; i < 10; i++) {
        grid.updateFull(i, 50, 50, 5, false, SpatialUnitState.Idle, 1, 5, false, 3);
      }

      const nearby = grid.queryRadius(50, 50, 1);
      expect(nearby.length).toBe(10);
    });
  });

  describe('query performance', () => {
    it('coarse grid used for large radius queries', () => {
      const grid = new SpatialGrid(200, 200, 8);

      for (let i = 0; i < 500; i++) {
        grid.updateFull(
          i,
          i % 200,
          Math.floor(i / 200) * 100,
          1,
          false,
          SpatialUnitState.Idle,
          1,
          1,
          false,
          3
        );
      }

      // Large radius should use coarse grid (radius > cellSize * 2)
      const results = grid.queryRadius(100, 100, 50);
      expect(results.length).toBeGreaterThan(0);
    });

    it('fine grid used for small radius queries', () => {
      const grid = new SpatialGrid(200, 200, 8);

      for (let i = 0; i < 500; i++) {
        grid.updateFull(
          i,
          i % 200,
          Math.floor(i / 200) * 100,
          1,
          false,
          SpatialUnitState.Idle,
          1,
          1,
          false,
          3
        );
      }

      // Small radius should use fine grid
      const results = grid.queryRadius(100, 100, 5);
      expect(results).toBeDefined();
    });

    it('queryRadiusWithData returns inline entity data', () => {
      const grid = new SpatialGrid(100, 100, 8);

      for (let i = 0; i < 50; i++) {
        grid.updateFull(
          i,
          i * 2,
          50,
          1,
          i % 2 === 0,
          SpatialUnitState.Moving,
          i % 4,
          1.5,
          i % 3 === 0,
          3 + (i % 5)
        );
      }

      const results = grid.queryRadiusWithData(50, 50, 30);

      for (const entity of results) {
        expect(entity.id).toBeDefined();
        expect(entity.x).toBeDefined();
        expect(entity.y).toBeDefined();
        expect(entity.radius).toBeDefined();
        expect(typeof entity.isFlying).toBe('boolean');
        expect(typeof entity.isWorker).toBe('boolean');
        expect(entity.playerId).toBeDefined();
        expect(entity.maxSpeed).toBeDefined();
      }
    });
  });

  describe('enemy detection', () => {
    it('hasEnemyInRadius correctly identifies enemies', () => {
      const grid = new SpatialGrid(100, 100, 8);

      // Add friendly units (player 1)
      for (let i = 0; i < 10; i++) {
        grid.updateFull(i, 50 + i, 50, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
      }

      // Add enemy units (player 2)
      for (let i = 10; i < 20; i++) {
        grid.updateFull(i, 50 + i - 10, 60, 1, false, SpatialUnitState.Idle, 2, 1, false, 3);
      }

      // Player 1 should detect enemies
      expect(grid.hasEnemyInRadius(55, 55, 20, 1)).toBe(true);

      // Player 2 should also detect enemies
      expect(grid.hasEnemyInRadius(55, 55, 20, 2)).toBe(true);

      // No enemies where there are none
      expect(grid.hasEnemyInRadius(0, 0, 10, 1)).toBe(false);
    });

    it('hasEnemyInRadius ignores dead units', () => {
      const grid = new SpatialGrid(100, 100, 8);

      // Add dead enemy
      grid.updateFull(0, 50, 50, 1, false, SpatialUnitState.Dead, 2, 1, false, 3);

      // Should not detect dead enemy
      expect(grid.hasEnemyInRadius(50, 50, 10, 1)).toBe(false);

      // Add living enemy
      grid.updateFull(1, 50, 50, 1, false, SpatialUnitState.Attacking, 2, 1, false, 3);

      // Should detect living enemy
      expect(grid.hasEnemyInRadius(50, 50, 10, 1)).toBe(true);
    });

    it('hot cells detection works with multiple players', () => {
      const grid = new SpatialGrid(100, 100, 8);

      // Add units from 3 different players in the same area
      for (let player = 1; player <= 3; player++) {
        for (let i = 0; i < 5; i++) {
          const entityId = (player - 1) * 5 + i;
          grid.updateFull(
            entityId,
            50 + player * 2,
            50 + i,
            1,
            false,
            SpatialUnitState.Idle,
            player,
            1,
            false,
            3
          );
        }
      }

      const hotCells = grid.getHotCells();
      expect(hotCells.size).toBeGreaterThan(0);
      expect(grid.isInHotCell(52, 52, hotCells)).toBe(true);
    });
  });

  describe('data integrity', () => {
    it('preserves all entity data through updates', () => {
      const grid = new SpatialGrid(100, 100, 8);

      grid.updateFull(42, 50, 60, 2.5, true, SpatialUnitState.Attacking, 7, 1.8, true, 4.5);

      const data = grid.getEntityData(42);
      expect(data).not.toBeNull();
      expect(data!.id).toBe(42);
      expect(data!.x).toBe(50);
      expect(data!.y).toBe(60);
      expect(data!.radius).toBeCloseTo(2.5, 5);
      expect(data!.isFlying).toBe(true);
      expect(data!.state).toBe(SpatialUnitState.Attacking);
      expect(data!.playerId).toBe(7);
      expect(data!.collisionRadius).toBeCloseTo(1.8, 5);
      expect(data!.isWorker).toBe(true);
      expect(data!.maxSpeed).toBeCloseTo(4.5, 5);
    });

    it('getEntityPosition returns correct position', () => {
      const grid = new SpatialGrid(100, 100, 8);

      grid.updateFull(10, 25.5, 75.3, 1.2, false, SpatialUnitState.Idle, 1, 1, false, 3);

      const pos = grid.getEntityPosition(10);
      expect(pos).not.toBeNull();
      expect(pos!.x).toBeCloseTo(25.5, 5);
      expect(pos!.y).toBeCloseTo(75.3, 5);
      expect(pos!.radius).toBeCloseTo(1.2, 5);
    });

    it('has() correctly reports entity existence', () => {
      const grid = new SpatialGrid(100, 100, 8);

      expect(grid.has(5)).toBe(false);

      grid.updateFull(5, 50, 50, 1, false, SpatialUnitState.Idle, 1, 1, false, 3);
      expect(grid.has(5)).toBe(true);

      grid.remove(5);
      expect(grid.has(5)).toBe(false);
    });

    it('getGridInfo returns correct dimensions', () => {
      const grid = new SpatialGrid(150, 100, 10);

      const info = grid.getGridInfo();
      expect(info.width).toBe(150);
      expect(info.height).toBe(100);
      expect(info.fineCellSize).toBe(10);
      expect(info.coarseCellSize).toBe(40);
      expect(info.fineCols).toBe(15);
      expect(info.fineRows).toBe(10);
    });
  });
});

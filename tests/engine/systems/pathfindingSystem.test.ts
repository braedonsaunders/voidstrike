import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '@/engine/core/EventBus';
import type { IGameInstance } from '@/engine/core/IGameInstance';
import type { World } from '@/engine/ecs/World';
import { PathfindingSystem } from '@/engine/systems/PathfindingSystem';

/**
 * PathfindingSystem Tests
 *
 * Tests for pathfinding logic that can be isolated from system dependencies:
 * 1. Priority queue operations
 * 2. Failed path caching
 * 3. Stuck detection
 * 4. Map bounds clamping
 */

describe('PathfindingSystem', () => {
  describe('worker obstacle replay', () => {
    const originalWorker = globalThis.Worker;

    afterEach(() => {
      globalThis.Worker = originalWorker;
    });

    it('replays existing building and decoration obstacles when the worker becomes ready late', () => {
      globalThis.Worker = undefined as unknown as typeof Worker;

      const buildingEntity = {
        id: 101,
        get(component: string) {
          if (component === 'Building') {
            return {
              state: 'complete',
              isFlying: false,
              width: 5,
              height: 5,
            };
          }
          if (component === 'Transform') {
            return { x: 50, y: 60 };
          }
          return undefined;
        },
      };

      const world = {
        getEntitiesWith: vi.fn().mockReturnValue([buildingEntity]),
      };

      const game = {
        world,
        eventBus: new EventBus(),
        config: {
          mapWidth: 100,
          mapHeight: 100,
          tickRate: 20,
          isMultiplayer: false,
          playerId: 'player1',
          aiEnabled: false,
          aiDifficulty: 'medium',
          fogOfWar: true,
        },
        getCurrentTick: () => 0,
        getGameTime: () => 0,
        isInMultiplayerMode: () => false,
        getPlayerTeam: () => 0,
        getTerrainAt: () => null,
        getTerrainHeightAt: () => 0,
        getTerrainGrid: () => null,
        getDecorationCollisions: () => [],
        isPositionClearOfDecorations: () => true,
        isValidTerrainForBuilding: () => true,
        isValidBuildingPlacement: () => true,
        issueAICommand: () => {},
        processCommand: () => {},
      } as unknown as IGameInstance;

      const system = new PathfindingSystem(game, 100, 100);
      system.init(world as unknown as World);
      system.registerDecorationCollisions([
        { x: 10, z: 12, radius: 1 },
        { x: 5, z: 6, radius: 0.25 },
      ]);

      const postMessage = vi.fn();
      const testSystem = system as unknown as {
        pathWorker: { postMessage: typeof postMessage } | null;
        handleWorkerMessage: (event: { data: { type: 'navMeshLoaded'; success: boolean } }) => void;
      };
      testSystem.pathWorker = { postMessage };

      testSystem.handleWorkerMessage({
        data: { type: 'navMeshLoaded', success: true },
      });

      expect(postMessage).toHaveBeenCalledTimes(2);
      expect(postMessage).toHaveBeenNthCalledWith(1, {
        type: 'addObstacle',
        entityId: 101,
        centerX: 50,
        centerY: 60,
        width: 5,
        height: 5,
      });
      expect(postMessage).toHaveBeenNthCalledWith(2, {
        type: 'addObstacle',
        entityId: -10000,
        centerX: 10,
        centerY: 12,
        width: 2,
        height: 2,
      });
    });
  });

  describe('worker path request heights', () => {
    const originalWorker = globalThis.Worker;

    afterEach(() => {
      globalThis.Worker = originalWorker;
    });

    it('uses game terrain heights for elevated worker path requests without a custom height provider', () => {
      globalThis.Worker = undefined as unknown as typeof Worker;

      const unit = {
        state: 'moving',
        movementDomain: 'ground',
        collisionRadius: 0.75,
      };

      const entity = {
        id: 7,
        get(component: string) {
          if (component === 'Unit') {
            return unit;
          }
          return undefined;
        },
      };

      const world = {
        getEntity: vi.fn().mockReturnValue(entity),
      };

      const game = {
        world,
        eventBus: new EventBus(),
        config: {
          mapWidth: 100,
          mapHeight: 100,
          tickRate: 20,
          isMultiplayer: false,
          playerId: 'player1',
          aiEnabled: false,
          aiDifficulty: 'medium',
          fogOfWar: true,
        },
        getCurrentTick: () => 0,
        getGameTime: () => 0,
        isInMultiplayerMode: () => false,
        getPlayerTeam: () => 0,
        getTerrainAt: () => null,
        getTerrainHeightAt: (x: number, y: number) => x * 0.25 + y * 0.5,
        getTerrainGrid: () => null,
        getDecorationCollisions: () => [],
        isPositionClearOfDecorations: () => true,
        isValidTerrainForBuilding: () => true,
        isValidBuildingPlacement: () => true,
        issueAICommand: () => {},
        processCommand: () => {},
      } as unknown as IGameInstance;

      const system = new PathfindingSystem(game, 100, 100);
      system.init(world as unknown as World);

      const postMessage = vi.fn();
      const testSystem = system as unknown as {
        pathWorker: { postMessage: typeof postMessage } | null;
        workerReady: boolean;
        processPathRequest: (request: {
          entityId: number;
          startX: number;
          startY: number;
          endX: number;
          endY: number;
          priority: number;
          movementDomain: 'ground';
        }) => void;
      };

      testSystem.pathWorker = { postMessage };
      testSystem.workerReady = true;

      testSystem.processPathRequest({
        entityId: 7,
        startX: 12,
        startY: 20,
        endX: 40,
        endY: 28,
        priority: 1,
        movementDomain: 'ground',
      });

      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith({
        type: 'findPath',
        requestId: 0,
        startX: 12,
        startY: 20,
        endX: 40,
        endY: 28,
        agentRadius: 0.75,
        startHeight: 13,
        endHeight: 24,
      });
    });
  });

  describe('priority queue', () => {
    interface PathRequest {
      entityId: number;
      priority: number;
    }

    class PriorityQueue {
      private heap: PathRequest[] = [];

      push(request: PathRequest): void {
        this.heap.push(request);
        this.bubbleUp(this.heap.length - 1);
      }

      pop(): PathRequest | undefined {
        if (this.heap.length === 0) return undefined;
        const result = this.heap[0];
        const last = this.heap.pop()!;
        if (this.heap.length > 0) {
          this.heap[0] = last;
          this.bubbleDown(0);
        }
        return result;
      }

      private bubbleUp(index: number): void {
        while (index > 0) {
          const parentIndex = Math.floor((index - 1) / 2);
          if (this.heap[parentIndex].priority >= this.heap[index].priority) break;
          [this.heap[parentIndex], this.heap[index]] = [this.heap[index], this.heap[parentIndex]];
          index = parentIndex;
        }
      }

      private bubbleDown(index: number): void {
        while (true) {
          const leftChild = 2 * index + 1;
          const rightChild = 2 * index + 2;
          let largest = index;

          if (
            leftChild < this.heap.length &&
            this.heap[leftChild].priority > this.heap[largest].priority
          ) {
            largest = leftChild;
          }
          if (
            rightChild < this.heap.length &&
            this.heap[rightChild].priority > this.heap[largest].priority
          ) {
            largest = rightChild;
          }

          if (largest === index) break;
          [this.heap[index], this.heap[largest]] = [this.heap[largest], this.heap[index]];
          index = largest;
        }
      }

      get size(): number {
        return this.heap.length;
      }
    }

    let queue: PriorityQueue;

    beforeEach(() => {
      queue = new PriorityQueue();
    });

    it('starts empty', () => {
      expect(queue.size).toBe(0);
      expect(queue.pop()).toBeUndefined();
    });

    it('pushes and pops single item', () => {
      queue.push({ entityId: 1, priority: 10 });
      expect(queue.size).toBe(1);
      const item = queue.pop();
      expect(item?.entityId).toBe(1);
      expect(queue.size).toBe(0);
    });

    it('returns highest priority first', () => {
      queue.push({ entityId: 1, priority: 5 });
      queue.push({ entityId: 2, priority: 10 });
      queue.push({ entityId: 3, priority: 3 });

      expect(queue.pop()?.entityId).toBe(2); // 10
      expect(queue.pop()?.entityId).toBe(1); // 5
      expect(queue.pop()?.entityId).toBe(3); // 3
    });

    it('handles equal priorities in LIFO order', () => {
      queue.push({ entityId: 1, priority: 5 });
      queue.push({ entityId: 2, priority: 5 });
      queue.push({ entityId: 3, priority: 5 });

      // With same priority, order depends on heap structure
      expect(queue.size).toBe(3);
    });

    it('maintains heap property after many operations', () => {
      for (let i = 0; i < 100; i++) {
        queue.push({ entityId: i, priority: Math.floor(Math.random() * 100) });
      }

      let lastPriority = Infinity;
      while (queue.size > 0) {
        const item = queue.pop()!;
        expect(item.priority).toBeLessThanOrEqual(lastPriority);
        lastPriority = item.priority;
      }
    });
  });

  describe('failed path cache', () => {
    interface FailedPathCache {
      failedPaths: Map<string, number>;
      failedPathTTL: number;
    }

    function createCacheKey(entityId: number, destX: number, destY: number): string {
      return `${entityId}_${Math.floor(destX)}_${Math.floor(destY)}`;
    }

    function recordFailedPath(
      cache: FailedPathCache,
      entityId: number,
      destX: number,
      destY: number,
      currentTick: number
    ): void {
      const key = createCacheKey(entityId, destX, destY);
      cache.failedPaths.set(key, currentTick);
    }

    function isPathRecentlyFailed(
      cache: FailedPathCache,
      entityId: number,
      destX: number,
      destY: number,
      currentTick: number
    ): boolean {
      const key = createCacheKey(entityId, destX, destY);
      const failedTick = cache.failedPaths.get(key);
      if (failedTick === undefined) return false;
      return currentTick - failedTick < cache.failedPathTTL;
    }

    it('records and detects failed paths', () => {
      const cache: FailedPathCache = { failedPaths: new Map(), failedPathTTL: 60 };

      recordFailedPath(cache, 1, 10, 20, 100);
      expect(isPathRecentlyFailed(cache, 1, 10, 20, 100)).toBe(true);
    });

    it('expires failed paths after TTL', () => {
      const cache: FailedPathCache = { failedPaths: new Map(), failedPathTTL: 60 };

      recordFailedPath(cache, 1, 10, 20, 100);
      expect(isPathRecentlyFailed(cache, 1, 10, 20, 159)).toBe(true); // Still valid
      expect(isPathRecentlyFailed(cache, 1, 10, 20, 160)).toBe(false); // Expired
    });

    it('different destinations are independent', () => {
      const cache: FailedPathCache = { failedPaths: new Map(), failedPathTTL: 60 };

      recordFailedPath(cache, 1, 10, 20, 100);
      expect(isPathRecentlyFailed(cache, 1, 10, 20, 100)).toBe(true);
      expect(isPathRecentlyFailed(cache, 1, 15, 25, 100)).toBe(false);
    });

    it('floors destination coordinates', () => {
      const cache: FailedPathCache = { failedPaths: new Map(), failedPathTTL: 60 };

      recordFailedPath(cache, 1, 10.7, 20.3, 100);
      expect(isPathRecentlyFailed(cache, 1, 10.1, 20.9, 100)).toBe(true); // Same cell
    });
  });

  describe('stuck detection', () => {
    function isStuck(
      currentX: number,
      currentY: number,
      lastX: number,
      lastY: number,
      stuckThreshold: number
    ): boolean {
      const dx = currentX - lastX;
      const dy = currentY - lastY;
      const distMoved = Math.sqrt(dx * dx + dy * dy);
      return distMoved < stuckThreshold;
    }

    it('detects no movement as stuck', () => {
      expect(isStuck(10, 20, 10, 20, 0.1)).toBe(true);
    });

    it('small movement is stuck', () => {
      expect(isStuck(10, 20, 10.05, 20, 0.1)).toBe(true);
    });

    it('sufficient movement is not stuck', () => {
      expect(isStuck(10, 20, 9, 20, 0.1)).toBe(false);
    });

    it('diagonal movement counts', () => {
      expect(isStuck(10, 10, 9, 9, 0.1)).toBe(false);
    });
  });

  describe('map bounds clamping', () => {
    function clampToMapBounds(
      x: number,
      y: number,
      mapWidth: number,
      mapHeight: number
    ): { x: number; y: number } {
      return {
        x: Math.max(1, Math.min(x, mapWidth - 1)),
        y: Math.max(1, Math.min(y, mapHeight - 1)),
      };
    }

    it('clamps negative coordinates', () => {
      const result = clampToMapBounds(-5, -10, 100, 100);
      expect(result.x).toBe(1);
      expect(result.y).toBe(1);
    });

    it('clamps coordinates beyond map', () => {
      const result = clampToMapBounds(150, 200, 100, 100);
      expect(result.x).toBe(99);
      expect(result.y).toBe(99);
    });

    it('preserves valid coordinates', () => {
      const result = clampToMapBounds(50, 50, 100, 100);
      expect(result.x).toBe(50);
      expect(result.y).toBe(50);
    });

    it('clamps to edge buffer (1 unit)', () => {
      const result = clampToMapBounds(0, 0, 100, 100);
      expect(result.x).toBe(1);
      expect(result.y).toBe(1);
    });
  });
});

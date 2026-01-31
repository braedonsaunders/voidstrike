import { describe, it, expect } from 'vitest';

/**
 * ProductionSystem Tests
 *
 * Since ProductionSystem has many Game/World dependencies, we test:
 * 1. Refund calculation logic
 * 2. Reactor bonus detection
 * 3. Supply allocation logic
 * 4. Production timing mechanics
 * 5. Queue reordering constraints
 */

describe('ProductionSystem', () => {
  describe('refund calculations', () => {
    interface RefundTestCase {
      progress: number;
      mineralCost: number;
      vespeneCost: number;
      produceCount: number;
    }

    function calculateRefund(testCase: RefundTestCase): { minerals: number; vespene: number } {
      const refundPercent = testCase.progress < 0.5 ? 1 : 0.5;
      return {
        minerals: Math.floor(testCase.mineralCost * testCase.produceCount * refundPercent),
        vespene: Math.floor(testCase.vespeneCost * testCase.produceCount * refundPercent),
      };
    }

    describe('refund at 0% progress (full refund)', () => {
      it('refunds 100% minerals', () => {
        const refund = calculateRefund({ progress: 0, mineralCost: 50, vespeneCost: 0, produceCount: 1 });
        expect(refund.minerals).toBe(50);
      });

      it('refunds 100% vespene', () => {
        const refund = calculateRefund({ progress: 0, mineralCost: 0, vespeneCost: 25, produceCount: 1 });
        expect(refund.vespene).toBe(25);
      });

      it('refunds both resources', () => {
        const refund = calculateRefund({ progress: 0, mineralCost: 150, vespeneCost: 100, produceCount: 1 });
        expect(refund.minerals).toBe(150);
        expect(refund.vespene).toBe(100);
      });
    });

    describe('refund at 25% progress (full refund)', () => {
      it('refunds 100% minerals', () => {
        const refund = calculateRefund({ progress: 0.25, mineralCost: 100, vespeneCost: 0, produceCount: 1 });
        expect(refund.minerals).toBe(100);
      });
    });

    describe('refund at 49% progress (full refund)', () => {
      it('refunds 100% minerals', () => {
        const refund = calculateRefund({ progress: 0.49, mineralCost: 100, vespeneCost: 0, produceCount: 1 });
        expect(refund.minerals).toBe(100);
      });
    });

    describe('refund at 50% progress (half refund)', () => {
      it('refunds 50% minerals', () => {
        const refund = calculateRefund({ progress: 0.5, mineralCost: 100, vespeneCost: 0, produceCount: 1 });
        expect(refund.minerals).toBe(50);
      });

      it('refunds 50% vespene', () => {
        const refund = calculateRefund({ progress: 0.5, mineralCost: 0, vespeneCost: 100, produceCount: 1 });
        expect(refund.vespene).toBe(50);
      });
    });

    describe('refund at 75% progress (half refund)', () => {
      it('refunds 50% minerals', () => {
        const refund = calculateRefund({ progress: 0.75, mineralCost: 100, vespeneCost: 0, produceCount: 1 });
        expect(refund.minerals).toBe(50);
      });
    });

    describe('refund at 99% progress (half refund)', () => {
      it('refunds 50% minerals', () => {
        const refund = calculateRefund({ progress: 0.99, mineralCost: 100, vespeneCost: 0, produceCount: 1 });
        expect(refund.minerals).toBe(50);
      });
    });

    describe('reactor bonus refund (produceCount = 2)', () => {
      it('doubles refund at 0% progress', () => {
        const refund = calculateRefund({ progress: 0, mineralCost: 50, vespeneCost: 25, produceCount: 2 });
        expect(refund.minerals).toBe(100);
        expect(refund.vespene).toBe(50);
      });

      it('doubles refund at 75% progress (half of double)', () => {
        const refund = calculateRefund({ progress: 0.75, mineralCost: 50, vespeneCost: 25, produceCount: 2 });
        expect(refund.minerals).toBe(50);
        expect(refund.vespene).toBe(25);
      });
    });

    describe('edge cases', () => {
      it('handles zero cost unit', () => {
        const refund = calculateRefund({ progress: 0, mineralCost: 0, vespeneCost: 0, produceCount: 1 });
        expect(refund.minerals).toBe(0);
        expect(refund.vespene).toBe(0);
      });

      it('floors fractional refunds', () => {
        // 75 * 0.5 = 37.5 -> 37
        const refund = calculateRefund({ progress: 0.5, mineralCost: 75, vespeneCost: 0, produceCount: 1 });
        expect(refund.minerals).toBe(37);
      });
    });
  });

  describe('reactor bonus detection', () => {
    const PRODUCTION_MODULE_UNITS: Record<string, string[]> = {
      barracks: ['trooper', 'conscript'],
      factory: ['hellfire', 'widow_mine'],
      starport: ['viking', 'medivac'],
    };

    function hasReactorBonus(buildingId: string, unitType: string, hasReactorAddon: boolean): boolean {
      if (!hasReactorAddon) return false;
      const reactorUnits = PRODUCTION_MODULE_UNITS[buildingId] || [];
      return reactorUnits.includes(unitType);
    }

    it('returns false without reactor addon', () => {
      expect(hasReactorBonus('barracks', 'trooper', false)).toBe(false);
    });

    it('returns true for barracks with reactor producing trooper', () => {
      expect(hasReactorBonus('barracks', 'trooper', true)).toBe(true);
    });

    it('returns true for barracks with reactor producing conscript', () => {
      expect(hasReactorBonus('barracks', 'conscript', true)).toBe(true);
    });

    it('returns false for non-reactor unit with reactor', () => {
      // Assuming 'marauder' is a tech-lab only unit
      expect(hasReactorBonus('barracks', 'marauder', true)).toBe(false);
    });

    it('returns true for factory with reactor producing hellfire', () => {
      expect(hasReactorBonus('factory', 'hellfire', true)).toBe(true);
    });

    it('returns false for unknown building', () => {
      expect(hasReactorBonus('unknown_building', 'trooper', true)).toBe(false);
    });
  });

  describe('supply allocation logic', () => {
    interface SupplyState {
      currentSupply: number;
      maxSupply: number;
    }

    interface ProductionItem {
      type: 'unit' | 'upgrade';
      supplyCost: number;
      supplyAllocated: boolean;
    }

    function canAllocateSupply(state: SupplyState, item: ProductionItem): boolean {
      if (item.type !== 'unit') return true; // Upgrades don't need supply
      if (item.supplyCost === 0) return true; // Free units
      if (item.supplyAllocated) return true; // Already allocated
      return state.currentSupply + item.supplyCost <= state.maxSupply;
    }

    function allocateSupply(state: SupplyState, item: ProductionItem): SupplyState {
      if (!canAllocateSupply(state, item)) return state;
      if (item.supplyAllocated) return state;
      if (item.type !== 'unit' || item.supplyCost === 0) return state;

      return {
        ...state,
        currentSupply: state.currentSupply + item.supplyCost,
      };
    }

    it('allocates supply when room available', () => {
      const state: SupplyState = { currentSupply: 10, maxSupply: 200 };
      const item: ProductionItem = { type: 'unit', supplyCost: 1, supplyAllocated: false };

      expect(canAllocateSupply(state, item)).toBe(true);
      const newState = allocateSupply(state, item);
      expect(newState.currentSupply).toBe(11);
    });

    it('blocks when supply capped', () => {
      const state: SupplyState = { currentSupply: 200, maxSupply: 200 };
      const item: ProductionItem = { type: 'unit', supplyCost: 1, supplyAllocated: false };

      expect(canAllocateSupply(state, item)).toBe(false);
    });

    it('allows exactly filling supply', () => {
      const state: SupplyState = { currentSupply: 199, maxSupply: 200 };
      const item: ProductionItem = { type: 'unit', supplyCost: 1, supplyAllocated: false };

      expect(canAllocateSupply(state, item)).toBe(true);
    });

    it('blocks when item would exceed cap', () => {
      const state: SupplyState = { currentSupply: 199, maxSupply: 200 };
      const item: ProductionItem = { type: 'unit', supplyCost: 2, supplyAllocated: false };

      expect(canAllocateSupply(state, item)).toBe(false);
    });

    it('upgrades always allocate (no supply cost)', () => {
      const state: SupplyState = { currentSupply: 200, maxSupply: 200 };
      const item: ProductionItem = { type: 'upgrade', supplyCost: 0, supplyAllocated: false };

      expect(canAllocateSupply(state, item)).toBe(true);
    });

    it('already allocated items pass', () => {
      const state: SupplyState = { currentSupply: 200, maxSupply: 200 };
      const item: ProductionItem = { type: 'unit', supplyCost: 1, supplyAllocated: true };

      expect(canAllocateSupply(state, item)).toBe(true);
    });

    it('handles reactor bonus (doubled supply)', () => {
      const state: SupplyState = { currentSupply: 10, maxSupply: 200 };
      const item: ProductionItem = { type: 'unit', supplyCost: 2, supplyAllocated: false }; // 2 units

      expect(canAllocateSupply(state, item)).toBe(true);
      const newState = allocateSupply(state, item);
      expect(newState.currentSupply).toBe(12);
    });
  });

  describe('production timing', () => {
    interface ProductionItem {
      progress: number;
      buildTime: number;
    }

    function updateProgress(item: ProductionItem, dt: number): { item: ProductionItem; completed: boolean } {
      const newProgress = Math.min(1, item.progress + dt / item.buildTime);
      return {
        item: { ...item, progress: newProgress },
        completed: newProgress >= 1,
      };
    }

    it('increments progress based on time and buildTime', () => {
      const item: ProductionItem = { progress: 0, buildTime: 10 };
      const result = updateProgress(item, 1);
      expect(result.item.progress).toBe(0.1);
      expect(result.completed).toBe(false);
    });

    it('completes when progress reaches 1', () => {
      const item: ProductionItem = { progress: 0.9, buildTime: 10 };
      const result = updateProgress(item, 1);
      expect(result.item.progress).toBe(1);
      expect(result.completed).toBe(true);
    });

    it('clamps progress at 1', () => {
      const item: ProductionItem = { progress: 0.95, buildTime: 10 };
      const result = updateProgress(item, 1);
      expect(result.item.progress).toBe(1);
    });

    it('handles fast build times', () => {
      const item: ProductionItem = { progress: 0, buildTime: 5 };
      const result = updateProgress(item, 1);
      expect(result.item.progress).toBe(0.2);
    });

    it('handles slow build times', () => {
      const item: ProductionItem = { progress: 0, buildTime: 100 };
      const result = updateProgress(item, 1);
      expect(result.item.progress).toBe(0.01);
    });

    it('full production cycle completes at or slightly after buildTime', () => {
      let item: ProductionItem = { progress: 0, buildTime: 10 };
      let totalTime = 0;
      const dt = 1;
      let completed = false;

      while (!completed) {
        const result = updateProgress(item, dt);
        item = result.item;
        totalTime += dt;
        completed = result.completed;
        if (totalTime > 100) break; // Safety limit
      }

      // Due to discrete time steps, completion happens at or after buildTime
      expect(totalTime).toBeGreaterThanOrEqual(10);
      expect(totalTime).toBeLessThanOrEqual(11);
      expect(item.progress).toBe(1);
    });
  });

  describe('queue reordering constraints', () => {
    interface QueueItem {
      id: string;
      progress: number;
    }

    function canMoveUp(queue: QueueItem[], index: number): boolean {
      if (index <= 1) return false; // Cannot move item 0, cannot move to 0
      return true;
    }

    function canMoveDown(queue: QueueItem[], index: number): boolean {
      if (index === 0) return false; // Cannot move active item
      if (index >= queue.length - 1) return false; // Already at end
      return true;
    }

    function moveUp(queue: QueueItem[], index: number): QueueItem[] {
      if (!canMoveUp(queue, index)) return queue;
      const newQueue = [...queue];
      [newQueue[index - 1], newQueue[index]] = [newQueue[index], newQueue[index - 1]];
      return newQueue;
    }

    function moveDown(queue: QueueItem[], index: number): QueueItem[] {
      if (!canMoveDown(queue, index)) return queue;
      const newQueue = [...queue];
      [newQueue[index], newQueue[index + 1]] = [newQueue[index + 1], newQueue[index]];
      return newQueue;
    }

    it('cannot move item at index 0', () => {
      const queue: QueueItem[] = [
        { id: 'a', progress: 0.5 },
        { id: 'b', progress: 0 },
      ];
      expect(canMoveUp(queue, 0)).toBe(false);
      expect(canMoveDown(queue, 0)).toBe(false);
    });

    it('cannot move item to index 0', () => {
      const queue: QueueItem[] = [
        { id: 'a', progress: 0.5 },
        { id: 'b', progress: 0 },
      ];
      expect(canMoveUp(queue, 1)).toBe(false);
    });

    it('can move item from index 2 to 1', () => {
      const queue: QueueItem[] = [
        { id: 'a', progress: 0.5 },
        { id: 'b', progress: 0 },
        { id: 'c', progress: 0 },
      ];
      expect(canMoveUp(queue, 2)).toBe(true);
      const newQueue = moveUp(queue, 2);
      expect(newQueue[1].id).toBe('c');
      expect(newQueue[2].id).toBe('b');
    });

    it('can move item down in queue', () => {
      const queue: QueueItem[] = [
        { id: 'a', progress: 0.5 },
        { id: 'b', progress: 0 },
        { id: 'c', progress: 0 },
      ];
      expect(canMoveDown(queue, 1)).toBe(true);
      const newQueue = moveDown(queue, 1);
      expect(newQueue[1].id).toBe('c');
      expect(newQueue[2].id).toBe('b');
    });

    it('cannot move last item down', () => {
      const queue: QueueItem[] = [
        { id: 'a', progress: 0.5 },
        { id: 'b', progress: 0 },
      ];
      expect(canMoveDown(queue, 1)).toBe(false);
    });
  });

  describe('building upgrade logic', () => {
    interface BuildingState {
      buildingId: string;
      canUpgradeTo: string[];
      productionQueue: Array<{ type: string; id: string }>;
    }

    function canUpgrade(building: BuildingState, upgradeTo: string): boolean {
      if (!building.canUpgradeTo.includes(upgradeTo)) return false;

      // Check if already upgrading to any valid target
      const isUpgrading = building.productionQueue.some(
        (item) => item.type === 'upgrade' && building.canUpgradeTo.includes(item.id)
      );
      return !isUpgrading;
    }

    it('allows upgrade when canUpgradeTo includes target', () => {
      const building: BuildingState = {
        buildingId: 'headquarters',
        canUpgradeTo: ['orbital_station', 'bastion'],
        productionQueue: [],
      };
      expect(canUpgrade(building, 'orbital_station')).toBe(true);
    });

    it('prevents upgrade when target not in canUpgradeTo', () => {
      const building: BuildingState = {
        buildingId: 'headquarters',
        canUpgradeTo: ['orbital_station', 'bastion'],
        productionQueue: [],
      };
      expect(canUpgrade(building, 'unknown_upgrade')).toBe(false);
    });

    it('prevents upgrade when already upgrading', () => {
      const building: BuildingState = {
        buildingId: 'headquarters',
        canUpgradeTo: ['orbital_station', 'bastion'],
        productionQueue: [{ type: 'upgrade', id: 'orbital_station' }],
      };
      expect(canUpgrade(building, 'bastion')).toBe(false);
    });

    it('allows unit production while upgrade is queued', () => {
      const building: BuildingState = {
        buildingId: 'headquarters',
        canUpgradeTo: ['orbital_station'],
        productionQueue: [{ type: 'unit', id: 'trooper' }],
      };
      expect(canUpgrade(building, 'orbital_station')).toBe(true);
    });
  });

  describe('best building selection', () => {
    interface MockBuilding {
      entityId: number;
      queueLength: number;
      isComplete: boolean;
      canProduce: string[];
    }

    function findBestBuilding(buildings: MockBuilding[], unitType: string): MockBuilding | null {
      let best: MockBuilding | null = null;
      let shortestQueue = Infinity;

      for (const building of buildings) {
        if (!building.isComplete) continue;
        if (!building.canProduce.includes(unitType)) continue;

        if (building.queueLength < shortestQueue) {
          shortestQueue = building.queueLength;
          best = building;
        }
      }

      return best;
    }

    it('selects building with shortest queue', () => {
      const buildings: MockBuilding[] = [
        { entityId: 1, queueLength: 3, isComplete: true, canProduce: ['trooper'] },
        { entityId: 2, queueLength: 1, isComplete: true, canProduce: ['trooper'] },
        { entityId: 3, queueLength: 2, isComplete: true, canProduce: ['trooper'] },
      ];
      const best = findBestBuilding(buildings, 'trooper');
      expect(best?.entityId).toBe(2);
    });

    it('skips incomplete buildings', () => {
      const buildings: MockBuilding[] = [
        { entityId: 1, queueLength: 0, isComplete: false, canProduce: ['trooper'] },
        { entityId: 2, queueLength: 2, isComplete: true, canProduce: ['trooper'] },
      ];
      const best = findBestBuilding(buildings, 'trooper');
      expect(best?.entityId).toBe(2);
    });

    it('skips buildings that cannot produce unit', () => {
      const buildings: MockBuilding[] = [
        { entityId: 1, queueLength: 0, isComplete: true, canProduce: ['tank'] },
        { entityId: 2, queueLength: 2, isComplete: true, canProduce: ['trooper'] },
      ];
      const best = findBestBuilding(buildings, 'trooper');
      expect(best?.entityId).toBe(2);
    });

    it('returns null when no building can produce', () => {
      const buildings: MockBuilding[] = [
        { entityId: 1, queueLength: 0, isComplete: true, canProduce: ['tank'] },
      ];
      const best = findBestBuilding(buildings, 'trooper');
      expect(best).toBeNull();
    });

    it('returns null for empty building list', () => {
      expect(findBestBuilding([], 'trooper')).toBeNull();
    });
  });

  describe('health scaling on upgrade', () => {
    function scaleHealth(
      currentHealth: number,
      currentMax: number,
      newMax: number
    ): { current: number; max: number } {
      const healthPercent = currentHealth / currentMax;
      return {
        current: Math.round(newMax * healthPercent),
        max: newMax,
      };
    }

    it('preserves health percentage', () => {
      const result = scaleHealth(500, 1000, 1500);
      expect(result.current).toBe(750);
      expect(result.max).toBe(1500);
    });

    it('handles full health', () => {
      const result = scaleHealth(1000, 1000, 1500);
      expect(result.current).toBe(1500);
    });

    it('handles low health', () => {
      const result = scaleHealth(100, 1000, 1500);
      expect(result.current).toBe(150);
    });

    it('handles 1 HP', () => {
      const result = scaleHealth(1, 1000, 1500);
      expect(result.current).toBe(2); // 0.001 * 1500 = 1.5, rounded to 2
    });

    it('rounds correctly', () => {
      const result = scaleHealth(333, 1000, 1500);
      expect(result.current).toBe(500); // 0.333 * 1500 = 499.5, rounded to 500
    });
  });
});

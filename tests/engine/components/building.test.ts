import { describe, it, expect, beforeEach } from 'vitest';
import { Building, BuildingDefinition } from '@/engine/components/Building';

function createBasicDefinition(overrides: Partial<BuildingDefinition> = {}): BuildingDefinition {
  return {
    id: 'test_building',
    name: 'Test Building',
    faction: 'terran',
    mineralCost: 100,
    vespeneCost: 0,
    buildTime: 30,
    width: 3,
    height: 3,
    maxHealth: 400,
    armor: 1,
    sightRange: 8,
    ...overrides,
  };
}

describe('Building Component', () => {
  let building: Building;
  let basicDef: BuildingDefinition;

  beforeEach(() => {
    basicDef = createBasicDefinition();
    building = new Building(basicDef);
  });

  describe('constructor', () => {
    it('sets basic properties from definition', () => {
      expect(building.buildingId).toBe('test_building');
      expect(building.name).toBe('Test Building');
      expect(building.faction).toBe('terran');
    });

    it('initializes state as waiting_for_worker', () => {
      expect(building.state).toBe('waiting_for_worker');
    });

    it('sets size properties', () => {
      expect(building.width).toBe(3);
      expect(building.height).toBe(3);
    });

    it('initializes construction progress to zero', () => {
      expect(building.buildProgress).toBe(0);
      expect(building.buildTime).toBe(30);
    });

    it('initializes empty production capability', () => {
      expect(building.canProduce).toEqual([]);
      expect(building.canResearch).toEqual([]);
      expect(building.productionQueue).toEqual([]);
    });

    it('sets production capability from definition', () => {
      const def = createBasicDefinition({
        canProduce: ['marine', 'marauder'],
        canResearch: ['stim', 'shields'],
      });
      const b = new Building(def);

      expect(b.canProduce).toEqual(['marine', 'marauder']);
      expect(b.canResearch).toEqual(['stim', 'shields']);
    });

    it('sets supply provided', () => {
      const def = createBasicDefinition({ supplyProvided: 8 });
      const b = new Building(def);

      expect(b.supplyProvided).toBe(8);
    });

    it('initializes addon system', () => {
      expect(building.canLiftOff).toBe(false);
      expect(building.canHaveAddon).toBe(false);
      expect(building.currentAddon).toBe(null);
      expect(building.addonEntityId).toBe(null);
      expect(building.attachedToId).toBe(null);
    });

    it('initializes flying state', () => {
      expect(building.isFlying).toBe(false);
      expect(building.liftProgress).toBe(0);
      expect(building.landingTarget).toBe(null);
    });

    it('initializes supply depot properties', () => {
      expect(building.canLower).toBe(false);
      expect(building.isLowered).toBe(false);

      const depot = new Building(createBasicDefinition({ canLower: true }));
      expect(depot.canLower).toBe(true);
    });

    it('initializes detection properties', () => {
      expect(building.isDetector).toBe(false);
      expect(building.detectionRange).toBe(0);

      const detector = new Building(
        createBasicDefinition({ isDetector: true, detectionRange: 10 })
      );
      expect(detector.isDetector).toBe(true);
      expect(detector.detectionRange).toBe(10);
    });

    it('initializes bunker properties', () => {
      expect(building.isBunker).toBe(false);
      expect(building.bunkerCapacity).toBe(0);

      const bunker = new Building(
        createBasicDefinition({ isBunker: true, bunkerCapacity: 4 })
      );
      expect(bunker.isBunker).toBe(true);
      expect(bunker.bunkerCapacity).toBe(4);
    });

    it('initializes attack properties', () => {
      expect(building.attackRange).toBe(0);
      expect(building.attackDamage).toBe(0);
      expect(building.attackSpeed).toBe(0);

      const turret = new Building(
        createBasicDefinition({
          attackRange: 7,
          attackDamage: 12,
          attackSpeed: 1.5,
        })
      );
      expect(turret.attackRange).toBe(7);
      expect(turret.attackDamage).toBe(12);
      expect(turret.attackSpeed).toBe(1.5);
    });

    it('initializes naval placement properties', () => {
      expect(building.requiresWaterAdjacent).toBe(false);
      expect(building.requiresDeepWater).toBe(false);

      const shipyard = new Building(
        createBasicDefinition({ requiresWaterAdjacent: true })
      );
      expect(shipyard.requiresWaterAdjacent).toBe(true);
    });
  });

  describe('construction lifecycle', () => {
    describe('startConstruction', () => {
      it('transitions from waiting_for_worker to constructing', () => {
        building.startConstruction();

        expect(building.state).toBe('constructing');
      });

      it('does nothing when not waiting for worker', () => {
        building.state = 'complete';
        building.startConstruction();

        expect(building.state).toBe('complete');
      });
    });

    describe('hasConstructionStarted', () => {
      it('returns false when waiting for worker', () => {
        expect(building.hasConstructionStarted()).toBe(false);
      });

      it('returns true when constructing', () => {
        building.state = 'constructing';
        expect(building.hasConstructionStarted()).toBe(true);
      });

      it('returns true when paused', () => {
        building.state = 'paused';
        expect(building.hasConstructionStarted()).toBe(true);
      });

      it('returns true when complete', () => {
        building.state = 'complete';
        expect(building.hasConstructionStarted()).toBe(true);
      });
    });

    describe('pauseConstruction', () => {
      it('pauses active construction', () => {
        building.state = 'constructing';
        building.pauseConstruction();

        expect(building.state).toBe('paused');
      });

      it('does nothing when not constructing', () => {
        building.state = 'waiting_for_worker';
        building.pauseConstruction();

        expect(building.state).toBe('waiting_for_worker');
      });
    });

    describe('resumeConstruction', () => {
      it('resumes paused construction', () => {
        building.state = 'paused';
        building.resumeConstruction();

        expect(building.state).toBe('constructing');
      });

      it('does nothing when not paused', () => {
        building.state = 'complete';
        building.resumeConstruction();

        expect(building.state).toBe('complete');
      });
    });

    describe('isConstructionPaused', () => {
      it('returns true when paused', () => {
        building.state = 'paused';
        expect(building.isConstructionPaused()).toBe(true);
      });

      it('returns false otherwise', () => {
        expect(building.isConstructionPaused()).toBe(false);
      });
    });

    describe('updateConstruction', () => {
      it('does nothing when not constructing', () => {
        building.buildProgress = 0.5;
        const result = building.updateConstruction(5);

        expect(result).toBe(false);
        expect(building.buildProgress).toBe(0.5);
      });

      it('updates progress when constructing', () => {
        building.state = 'constructing';

        building.updateConstruction(15); // Half of 30 second build time

        expect(building.buildProgress).toBe(0.5);
      });

      it('completes construction when progress reaches 1', () => {
        building.state = 'constructing';

        const result = building.updateConstruction(30);

        expect(result).toBe(true);
        expect(building.buildProgress).toBe(1);
        expect(building.state).toBe('complete');
      });

      it('does not exceed 100% progress', () => {
        building.state = 'constructing';

        building.updateConstruction(60);

        expect(building.buildProgress).toBe(1);
      });
    });

    describe('isComplete', () => {
      it('returns true when complete', () => {
        building.state = 'complete';
        expect(building.isComplete()).toBe(true);
      });

      it('returns false otherwise', () => {
        expect(building.isComplete()).toBe(false);
      });
    });

    describe('isOperational', () => {
      it('returns true for complete buildings', () => {
        building.state = 'complete';
        expect(building.isOperational()).toBe(true);
      });

      it('returns true for flying buildings', () => {
        building.state = 'lifting';
        expect(building.isOperational()).toBe(true);

        building.state = 'flying';
        expect(building.isOperational()).toBe(true);

        building.state = 'landing';
        expect(building.isOperational()).toBe(true);
      });

      it('returns false for incomplete buildings', () => {
        building.state = 'constructing';
        expect(building.isOperational()).toBe(false);
      });
    });
  });

  describe('production queue', () => {
    beforeEach(() => {
      building.state = 'complete';
    });

    describe('addToProductionQueue', () => {
      it('adds unit to queue', () => {
        building.addToProductionQueue('unit', 'marine', 20, 1, 1);

        expect(building.productionQueue).toHaveLength(1);
        expect(building.productionQueue[0]).toEqual({
          type: 'unit',
          id: 'marine',
          progress: 0,
          buildTime: 20,
          supplyCost: 1,
          supplyAllocated: false,
          produceCount: 1,
        });
      });

      it('adds upgrade to queue', () => {
        building.addToProductionQueue('upgrade', 'stim', 100, 0, 1);

        expect(building.productionQueue[0].type).toBe('upgrade');
        expect(building.productionQueue[0].supplyCost).toBe(0);
      });

      it('queues multiple items', () => {
        building.addToProductionQueue('unit', 'marine', 20, 1);
        building.addToProductionQueue('unit', 'medic', 30, 1);

        expect(building.productionQueue).toHaveLength(2);
      });
    });

    describe('updateProduction', () => {
      it('returns null when not complete', () => {
        building.state = 'constructing';
        building.addToProductionQueue('unit', 'marine', 20, 1);

        expect(building.updateProduction(10)).toBe(null);
      });

      it('returns null when queue empty', () => {
        expect(building.updateProduction(10)).toBe(null);
      });

      it('updates progress of first item', () => {
        building.addToProductionQueue('unit', 'marine', 20, 1);

        building.updateProduction(10);

        expect(building.productionQueue[0].progress).toBe(0.5);
      });

      it('returns and removes completed item', () => {
        building.addToProductionQueue('unit', 'marine', 20, 1);

        const completed = building.updateProduction(20);

        expect(completed?.id).toBe('marine');
        expect(building.productionQueue).toHaveLength(0);
      });
    });

    describe('getProductionProgress', () => {
      it('returns 0 when queue empty', () => {
        expect(building.getProductionProgress()).toBe(0);
      });

      it('returns first item progress', () => {
        building.addToProductionQueue('unit', 'marine', 20, 1);
        building.productionQueue[0].progress = 0.75;

        expect(building.getProductionProgress()).toBe(0.75);
      });
    });

    describe('setRallyPoint', () => {
      it('sets rally point position', () => {
        building.setRallyPoint(100, 200);

        expect(building.rallyX).toBe(100);
        expect(building.rallyY).toBe(200);
        expect(building.rallyTargetId).toBe(null);
      });

      it('sets rally point with target entity', () => {
        building.setRallyPoint(100, 200, 42);

        expect(building.rallyTargetId).toBe(42);
      });
    });

    describe('cancelProduction', () => {
      it('cancels item at index', () => {
        building.addToProductionQueue('unit', 'marine', 20, 1);
        building.addToProductionQueue('unit', 'medic', 30, 1);

        const cancelled = building.cancelProduction(0);

        expect(cancelled?.id).toBe('marine');
        expect(building.productionQueue).toHaveLength(1);
        expect(building.productionQueue[0].id).toBe('medic');
      });

      it('returns null for invalid index', () => {
        expect(building.cancelProduction(-1)).toBe(null);
        expect(building.cancelProduction(5)).toBe(null);
      });
    });

    describe('reorderProduction', () => {
      beforeEach(() => {
        building.addToProductionQueue('unit', 'marine', 20, 1);
        building.addToProductionQueue('unit', 'medic', 30, 1);
        building.addToProductionQueue('unit', 'marauder', 30, 2);
      });

      it('reorders items in queue', () => {
        const result = building.reorderProduction(2, 1);

        expect(result).toBe(true);
        expect(building.productionQueue[1].id).toBe('marauder');
        expect(building.productionQueue[2].id).toBe('medic');
      });

      it('cannot move active item (index 0)', () => {
        expect(building.reorderProduction(0, 1)).toBe(false);
      });

      it('cannot move to position 0', () => {
        expect(building.reorderProduction(1, 0)).toBe(false);
      });

      it('rejects invalid indices', () => {
        expect(building.reorderProduction(-1, 1)).toBe(false);
        expect(building.reorderProduction(1, 10)).toBe(false);
      });

      it('rejects same position', () => {
        expect(building.reorderProduction(1, 1)).toBe(false);
      });
    });

    describe('moveQueueItemUp', () => {
      beforeEach(() => {
        building.addToProductionQueue('unit', 'marine', 20, 1);
        building.addToProductionQueue('unit', 'medic', 30, 1);
        building.addToProductionQueue('unit', 'marauder', 30, 2);
      });

      it('moves item up in queue', () => {
        const result = building.moveQueueItemUp(2);

        expect(result).toBe(true);
        expect(building.productionQueue[1].id).toBe('marauder');
      });

      it('cannot move item at index 1 up', () => {
        expect(building.moveQueueItemUp(1)).toBe(false);
      });
    });

    describe('moveQueueItemDown', () => {
      beforeEach(() => {
        building.addToProductionQueue('unit', 'marine', 20, 1);
        building.addToProductionQueue('unit', 'medic', 30, 1);
        building.addToProductionQueue('unit', 'marauder', 30, 2);
      });

      it('moves item down in queue', () => {
        const result = building.moveQueueItemDown(1);

        expect(result).toBe(true);
        expect(building.productionQueue[2].id).toBe('medic');
      });

      it('cannot move active item', () => {
        expect(building.moveQueueItemDown(0)).toBe(false);
      });

      it('cannot move last item down', () => {
        expect(building.moveQueueItemDown(2)).toBe(false);
      });
    });
  });

  describe('addon mechanics', () => {
    let barracks: Building;

    beforeEach(() => {
      barracks = new Building(
        createBasicDefinition({
          canHaveAddon: true,
          canLiftOff: true,
        })
      );
      barracks.state = 'complete';
    });

    describe('attachAddon', () => {
      it('attaches addon to building', () => {
        const result = barracks.attachAddon('research_module', 42);

        expect(result).toBe(true);
        expect(barracks.currentAddon).toBe('research_module');
        expect(barracks.addonEntityId).toBe(42);
      });

      it('fails if building cannot have addons', () => {
        building.state = 'complete';
        expect(building.attachAddon('research_module', 42)).toBe(false);
      });

      it('fails if addon already attached', () => {
        barracks.attachAddon('research_module', 42);

        expect(barracks.attachAddon('production_module', 43)).toBe(false);
      });
    });

    describe('detachAddon', () => {
      it('detaches addon and returns entity id', () => {
        barracks.attachAddon('research_module', 42);

        const detachedId = barracks.detachAddon();

        expect(detachedId).toBe(42);
        expect(barracks.currentAddon).toBe(null);
        expect(barracks.addonEntityId).toBe(null);
      });

      it('returns null when no addon', () => {
        expect(barracks.detachAddon()).toBe(null);
      });
    });

    describe('hasAddon', () => {
      it('returns true when addon attached', () => {
        barracks.attachAddon('research_module', 42);
        expect(barracks.hasAddon()).toBe(true);
      });

      it('returns false when no addon', () => {
        expect(barracks.hasAddon()).toBe(false);
      });
    });

    describe('hasTechLab', () => {
      it('returns true for research_module', () => {
        barracks.attachAddon('research_module', 42);
        expect(barracks.hasTechLab()).toBe(true);
      });

      it('returns false for other addons', () => {
        barracks.attachAddon('production_module', 42);
        expect(barracks.hasTechLab()).toBe(false);
      });
    });

    describe('hasReactor', () => {
      it('returns true for production_module', () => {
        barracks.attachAddon('production_module', 42);
        expect(barracks.hasReactor()).toBe(true);
      });

      it('returns false for other addons', () => {
        barracks.attachAddon('research_module', 42);
        expect(barracks.hasReactor()).toBe(false);
      });
    });
  });

  describe('lift-off mechanics', () => {
    let flyingBuilding: Building;

    beforeEach(() => {
      flyingBuilding = new Building(
        createBasicDefinition({ canLiftOff: true })
      );
      flyingBuilding.state = 'complete';
    });

    describe('startLiftOff', () => {
      it('initiates lift-off', () => {
        const result = flyingBuilding.startLiftOff();

        expect(result).toBe(true);
        expect(flyingBuilding.state).toBe('lifting');
        expect(flyingBuilding.liftProgress).toBe(0);
      });

      it('fails if cannot lift off', () => {
        building.state = 'complete';
        expect(building.startLiftOff()).toBe(false);
      });

      it('fails if not complete', () => {
        flyingBuilding.state = 'constructing';
        expect(flyingBuilding.startLiftOff()).toBe(false);
      });

      it('fails if already flying', () => {
        flyingBuilding.isFlying = true;
        expect(flyingBuilding.startLiftOff()).toBe(false);
      });

      it('fails if production queue not empty', () => {
        flyingBuilding.addToProductionQueue('unit', 'marine', 20, 1);
        expect(flyingBuilding.startLiftOff()).toBe(false);
      });
    });

    describe('updateLift', () => {
      it('progresses lift animation', () => {
        flyingBuilding.startLiftOff();

        flyingBuilding.updateLift(0.5);

        expect(flyingBuilding.liftProgress).toBeGreaterThan(0);
        expect(flyingBuilding.state).toBe('lifting');
      });

      it('completes lift and transitions to flying', () => {
        flyingBuilding.startLiftOff();

        // Simulate multiple frames to complete lift
        for (let i = 0; i < 50; i++) {
          if (flyingBuilding.updateLift(0.1)) break;
        }

        expect(flyingBuilding.state).toBe('flying');
        expect(flyingBuilding.isFlying).toBe(true);
        expect(flyingBuilding.liftProgress).toBe(1);
      });

      it('returns false when not lifting', () => {
        expect(flyingBuilding.updateLift(0.1)).toBe(false);
      });
    });

    describe('startLanding', () => {
      beforeEach(() => {
        flyingBuilding.startLiftOff();
        for (let i = 0; i < 50; i++) {
          if (flyingBuilding.updateLift(0.1)) break;
        }
      });

      it('initiates landing', () => {
        const result = flyingBuilding.startLanding(100, 200);

        expect(result).toBe(true);
        expect(flyingBuilding.state).toBe('landing');
        expect(flyingBuilding.landingTarget).toEqual({ x: 100, y: 200 });
      });

      it('fails if not flying', () => {
        building.state = 'complete';
        expect(building.startLanding(100, 200)).toBe(false);
      });
    });

    describe('updateLanding', () => {
      beforeEach(() => {
        flyingBuilding.startLiftOff();
        for (let i = 0; i < 50; i++) {
          if (flyingBuilding.updateLift(0.1)) break;
        }
        flyingBuilding.startLanding(100, 200);
      });

      it('progresses landing animation', () => {
        flyingBuilding.updateLanding(0.5);

        expect(flyingBuilding.liftProgress).toBeLessThan(1);
      });

      it('completes landing', () => {
        for (let i = 0; i < 50; i++) {
          if (flyingBuilding.updateLanding(0.1)) break;
        }

        expect(flyingBuilding.state).toBe('complete');
        expect(flyingBuilding.isFlying).toBe(false);
        expect(flyingBuilding.liftProgress).toBe(0);
        expect(flyingBuilding.landingTarget).toBe(null);
      });

      it('returns false when not landing', () => {
        building.state = 'complete';
        expect(building.updateLanding(0.1)).toBe(false);
      });
    });

    describe('pending landing', () => {
      it('sets pending landing position', () => {
        flyingBuilding.setPendingLanding(100, 200);

        expect(flyingBuilding.pendingLandingX).toBe(100);
        expect(flyingBuilding.pendingLandingY).toBe(200);
      });

      it('checks for pending landing', () => {
        expect(flyingBuilding.hasPendingLanding()).toBe(false);

        flyingBuilding.setPendingLanding(100, 200);
        expect(flyingBuilding.hasPendingLanding()).toBe(true);
      });

      it('clears pending landing', () => {
        flyingBuilding.setPendingLanding(100, 200);
        flyingBuilding.clearPendingLanding();

        expect(flyingBuilding.hasPendingLanding()).toBe(false);
      });
    });

    describe('flying movement', () => {
      beforeEach(() => {
        flyingBuilding.startLiftOff();
        for (let i = 0; i < 50; i++) {
          if (flyingBuilding.updateLift(0.1)) break;
        }
      });

      it('sets flying target', () => {
        const result = flyingBuilding.setFlyingTarget(100, 200);

        expect(result).toBe(true);
        expect(flyingBuilding.flyingTargetX).toBe(100);
        expect(flyingBuilding.flyingTargetY).toBe(200);
      });

      it('fails to set flying target when not flying', () => {
        building.state = 'complete';
        expect(building.setFlyingTarget(100, 200)).toBe(false);
      });

      it('clears flying target', () => {
        flyingBuilding.setFlyingTarget(100, 200);
        flyingBuilding.clearFlyingTarget();

        expect(flyingBuilding.flyingTargetX).toBe(null);
        expect(flyingBuilding.flyingTargetY).toBe(null);
      });

      it('checks for flying target', () => {
        expect(flyingBuilding.hasFlyingTarget()).toBe(false);

        flyingBuilding.setFlyingTarget(100, 200);
        expect(flyingBuilding.hasFlyingTarget()).toBe(true);
      });
    });
  });

  describe('supply depot mechanics', () => {
    let depot: Building;

    beforeEach(() => {
      depot = new Building(createBasicDefinition({ canLower: true }));
      depot.state = 'complete';
    });

    describe('toggleLowered', () => {
      it('toggles lowered state', () => {
        expect(depot.isLowered).toBe(false);

        depot.toggleLowered();
        expect(depot.isLowered).toBe(true);

        depot.toggleLowered();
        expect(depot.isLowered).toBe(false);
      });

      it('fails if cannot lower', () => {
        building.state = 'complete';
        expect(building.toggleLowered()).toBe(false);
      });

      it('fails if not complete', () => {
        depot.state = 'constructing';
        expect(depot.toggleLowered()).toBe(false);
      });
    });

    describe('setLowered', () => {
      it('sets lowered state directly', () => {
        depot.setLowered(true);
        expect(depot.isLowered).toBe(true);

        depot.setLowered(false);
        expect(depot.isLowered).toBe(false);
      });

      it('does nothing if cannot lower', () => {
        building.state = 'complete';
        building.setLowered(true);

        expect(building.isLowered).toBe(false);
      });

      it('does nothing if not complete', () => {
        depot.state = 'constructing';
        depot.setLowered(true);

        expect(depot.isLowered).toBe(false);
      });
    });
  });

  describe('attack mechanics', () => {
    let turret: Building;

    beforeEach(() => {
      turret = new Building(
        createBasicDefinition({
          attackDamage: 12,
          attackSpeed: 1,
        })
      );
      turret.state = 'complete';
    });

    describe('canAttack', () => {
      it('returns true when attack is ready', () => {
        turret.lastAttackTime = 0;

        expect(turret.canAttack(2)).toBe(true);
      });

      it('returns false when on cooldown', () => {
        turret.lastAttackTime = 0.5;

        expect(turret.canAttack(1)).toBe(false);
      });

      it('returns false when no attack capability', () => {
        building.state = 'complete';
        expect(building.canAttack(10)).toBe(false);
      });
    });
  });

  describe('type property', () => {
    it('has correct component type', () => {
      expect(building.type).toBe('Building');
    });
  });
});

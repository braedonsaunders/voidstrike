import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Unit, UnitDefinition, TransformMode } from '@/engine/components/Unit';

// Mock AssetManager
vi.mock('@/assets/AssetManager', () => ({
  AssetManager: {
    getCollisionRadius: vi.fn(() => null),
  },
}));

// Mock collisionConfig
vi.mock('@/data/collisionConfig', () => ({
  collisionConfig: {
    defaultGroundUnitRadius: 0.5,
    defaultFlyingUnitRadius: 0.4,
  },
}));

function createBasicDefinition(overrides: Partial<UnitDefinition> = {}): UnitDefinition {
  return {
    id: 'test_unit',
    name: 'Test Unit',
    faction: 'terran',
    mineralCost: 100,
    plasmaCost: 50,
    buildTime: 10,
    supplyCost: 1,
    speed: 5,
    sightRange: 8,
    attackRange: 6,
    attackDamage: 10,
    attackSpeed: 1,
    damageType: 'normal',
    maxHealth: 100,
    armor: 1,
    ...overrides,
  };
}

describe('Unit Component', () => {
  let unit: Unit;
  let basicDef: UnitDefinition;

  beforeEach(() => {
    basicDef = createBasicDefinition();
    unit = new Unit(basicDef);
  });

  describe('constructor', () => {
    it('sets basic properties from definition', () => {
      expect(unit.unitId).toBe('test_unit');
      expect(unit.name).toBe('Test Unit');
      expect(unit.faction).toBe('terran');
      expect(unit.state).toBe('idle');
    });

    it('sets movement properties', () => {
      expect(unit.speed).toBe(5);
      expect(unit.maxSpeed).toBe(5);
      expect(unit.currentSpeed).toBe(0);
    });

    it('uses default acceleration', () => {
      expect(unit.acceleration).toBe(15);
      expect(unit.deceleration).toBe(30);
    });

    it('uses custom acceleration when provided', () => {
      const def = createBasicDefinition({ acceleration: 10, deceleration: 25 });
      const u = new Unit(def);

      expect(u.acceleration).toBe(10);
      expect(u.deceleration).toBe(25);
    });

    it('sets combat properties', () => {
      expect(unit.attackRange).toBe(6);
      expect(unit.attackDamage).toBe(10);
      expect(unit.attackSpeed).toBe(1);
      expect(unit.damageType).toBe('normal');
      expect(unit.splashRadius).toBe(0);
    });

    it('sets targeting restrictions', () => {
      expect(unit.canAttackGround).toBe(true);
      expect(unit.canAttackAir).toBe(false);
    });

    it('initializes worker state', () => {
      expect(unit.isWorker).toBe(false);
      expect(unit.carryingMinerals).toBe(0);
      expect(unit.carryingPlasma).toBe(0);
    });

    it('initializes as worker when defined', () => {
      const def = createBasicDefinition({ isWorker: true });
      const u = new Unit(def);

      expect(u.isWorker).toBe(true);
    });

    it('initializes flying state', () => {
      expect(unit.isFlying).toBe(false);
      expect(unit.movementDomain).toBe('ground');
    });

    it('sets flying unit properties', () => {
      const def = createBasicDefinition({ isFlying: true });
      const u = new Unit(def);

      expect(u.isFlying).toBe(true);
      expect(u.movementDomain).toBe('air');
    });

    it('sets naval unit properties', () => {
      const def = createBasicDefinition({ isNaval: true });
      const u = new Unit(def);

      expect(u.isNaval).toBe(true);
      expect(u.movementDomain).toBe('water');
      expect(u.canAttackNaval).toBe(true);
    });

    it('sets submarine properties', () => {
      const def = createBasicDefinition({ isSubmarine: true });
      const u = new Unit(def);

      expect(u.isSubmarine).toBe(true);
      expect(u.canSubmerge).toBe(true);
      expect(u.isSubmerged).toBe(false);
    });

    it('initializes biological flag correctly', () => {
      expect(unit.isBiological).toBe(true);
      expect(unit.isMechanical).toBe(false);

      const mechDef = createBasicDefinition({ isMechanical: true });
      const mech = new Unit(mechDef);

      expect(mech.isBiological).toBe(false);
      expect(mech.isMechanical).toBe(true);
    });
  });

  describe('movement commands', () => {
    describe('setMoveTarget', () => {
      it('sets target position', () => {
        unit.setMoveTarget(100, 200);

        expect(unit.targetX).toBe(100);
        expect(unit.targetY).toBe(200);
        expect(unit.state).toBe('moving');
        expect(unit.targetEntityId).toBe(null);
      });

      it('preserves state when requested', () => {
        unit.state = 'gathering';
        unit.setMoveTarget(100, 200, true);

        expect(unit.state).toBe('gathering');
      });
    });

    describe('moveToPosition', () => {
      it('sets target without changing state', () => {
        unit.state = 'gathering';
        unit.path = [{ x: 1, y: 1 }];
        unit.pathIndex = 1;

        unit.moveToPosition(50, 60);

        expect(unit.targetX).toBe(50);
        expect(unit.targetY).toBe(60);
        expect(unit.state).toBe('gathering');
        expect(unit.path).toEqual([]);
        expect(unit.pathIndex).toBe(0);
      });
    });

    describe('setPath', () => {
      it('sets path and resets index', () => {
        const path = [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ];
        unit.pathIndex = 5;

        unit.setPath(path);

        expect(unit.path).toEqual(path);
        expect(unit.pathIndex).toBe(0);
      });
    });

    describe('clearTarget', () => {
      it('clears all movement state', () => {
        unit.targetX = 100;
        unit.targetY = 200;
        unit.targetEntityId = 5;
        unit.path = [{ x: 1, y: 1 }];
        unit.pathIndex = 1;
        unit.state = 'moving';
        unit.currentSpeed = 10;

        unit.clearTarget();

        expect(unit.targetX).toBe(null);
        expect(unit.targetY).toBe(null);
        expect(unit.targetEntityId).toBe(null);
        expect(unit.path).toEqual([]);
        expect(unit.pathIndex).toBe(0);
        expect(unit.state).toBe('idle');
        expect(unit.currentSpeed).toBe(0);
      });
    });

    describe('stop', () => {
      it('clears all movement and command queue', () => {
        unit.commandQueue = [{ type: 'move', targetX: 1, targetY: 2 }];
        unit.patrolPoints = [{ x: 1, y: 1 }];
        unit.isHoldingPosition = true;

        unit.stop();

        expect(unit.state).toBe('idle');
        expect(unit.commandQueue).toEqual([]);
        expect(unit.patrolPoints).toEqual([]);
        expect(unit.isHoldingPosition).toBe(false);
      });
    });

    describe('holdPosition', () => {
      it('sets hold position state', () => {
        unit.holdPosition();

        expect(unit.isHoldingPosition).toBe(true);
        expect(unit.state).toBe('idle');
        expect(unit.commandQueue).toEqual([]);
      });
    });
  });

  describe('combat commands', () => {
    describe('setAttackTarget', () => {
      it('sets attack target', () => {
        unit.setAttackTarget(42);

        expect(unit.targetEntityId).toBe(42);
        expect(unit.state).toBe('attacking');
        expect(unit.targetX).toBe(null);
        expect(unit.targetY).toBe(null);
      });
    });

    describe('setAttackTargetWhileMoving', () => {
      it('sets target without changing state', () => {
        unit.state = 'moving';
        unit.targetX = 100;
        unit.targetY = 200;

        unit.setAttackTargetWhileMoving(42);

        expect(unit.targetEntityId).toBe(42);
        expect(unit.state).toBe('moving');
        expect(unit.targetX).toBe(100);
        expect(unit.targetY).toBe(200);
      });
    });

    describe('setAttackMoveTarget', () => {
      it('sets attack move state', () => {
        unit.setAttackMoveTarget(100, 200);

        expect(unit.targetX).toBe(100);
        expect(unit.targetY).toBe(200);
        expect(unit.state).toBe('attackmoving');
        expect(unit.targetEntityId).toBe(null);
      });
    });

    describe('canAttack', () => {
      it('returns true when enough time has passed', () => {
        unit.lastAttackTime = 0;
        unit.attackSpeed = 1; // 1 attack per second

        expect(unit.canAttack(2)).toBe(true);
      });

      it('returns false when on cooldown', () => {
        unit.lastAttackTime = 0.5;
        unit.attackSpeed = 1;

        expect(unit.canAttack(1)).toBe(false);
      });
    });

    describe('canAttackTarget', () => {
      it('checks air attack capability', () => {
        unit.canAttackAir = false;
        expect(unit.canAttackTarget(true, false)).toBe(false);

        unit.canAttackAir = true;
        expect(unit.canAttackTarget(true, false)).toBe(true);
      });

      it('checks naval attack capability', () => {
        unit.canAttackNaval = false;
        expect(unit.canAttackTarget(false, true)).toBe(false);

        unit.canAttackNaval = true;
        expect(unit.canAttackTarget(false, true)).toBe(true);
      });

      it('checks ground attack capability', () => {
        unit.canAttackGround = true;
        expect(unit.canAttackTarget(false, false)).toBe(true);

        unit.canAttackGround = false;
        expect(unit.canAttackTarget(false, false)).toBe(false);
      });
    });
  });

  describe('command queue', () => {
    describe('queueCommand', () => {
      it('adds command to queue', () => {
        unit.queueCommand({ type: 'move', targetX: 100, targetY: 200 });

        expect(unit.commandQueue).toHaveLength(1);
        expect(unit.commandQueue[0]).toEqual({
          type: 'move',
          targetX: 100,
          targetY: 200,
        });
      });

      it('queues multiple commands', () => {
        unit.queueCommand({ type: 'move', targetX: 100, targetY: 200 });
        unit.queueCommand({ type: 'attack', targetEntityId: 5 });

        expect(unit.commandQueue).toHaveLength(2);
      });
    });

    describe('executeNextCommand', () => {
      it('returns false when queue is empty', () => {
        expect(unit.executeNextCommand()).toBe(false);
      });

      it('executes move command', () => {
        unit.queueCommand({ type: 'move', targetX: 100, targetY: 200 });

        expect(unit.executeNextCommand()).toBe(true);
        expect(unit.targetX).toBe(100);
        expect(unit.targetY).toBe(200);
        expect(unit.state).toBe('moving');
      });

      it('executes attack command', () => {
        unit.queueCommand({ type: 'attack', targetEntityId: 42 });

        unit.executeNextCommand();

        expect(unit.targetEntityId).toBe(42);
        expect(unit.state).toBe('attacking');
      });

      it('executes attackmove command', () => {
        unit.queueCommand({ type: 'attackmove', targetX: 50, targetY: 60 });

        unit.executeNextCommand();

        expect(unit.state).toBe('attackmoving');
      });

      it('removes executed command from queue', () => {
        unit.queueCommand({ type: 'move', targetX: 1, targetY: 2 });
        unit.queueCommand({ type: 'move', targetX: 3, targetY: 4 });

        unit.executeNextCommand();

        expect(unit.commandQueue).toHaveLength(1);
        expect(unit.commandQueue[0].targetX).toBe(3);
      });
    });

    describe('hasQueuedCommands', () => {
      it('returns false when queue is empty', () => {
        expect(unit.hasQueuedCommands()).toBe(false);
      });

      it('returns true when queue has commands', () => {
        unit.queueCommand({ type: 'move', targetX: 1, targetY: 2 });

        expect(unit.hasQueuedCommands()).toBe(true);
      });
    });
  });

  describe('patrol', () => {
    describe('setPatrol', () => {
      it('sets up patrol between two points', () => {
        unit.setPatrol(0, 0, 100, 100);

        expect(unit.patrolPoints).toHaveLength(2);
        expect(unit.patrolPoints[0]).toEqual({ x: 0, y: 0 });
        expect(unit.patrolPoints[1]).toEqual({ x: 100, y: 100 });
        expect(unit.patrolIndex).toBe(1);
        expect(unit.state).toBe('patrolling');
        expect(unit.targetX).toBe(100);
        expect(unit.targetY).toBe(100);
      });
    });

    describe('addPatrolPoint', () => {
      it('adds patrol point when not patrolling', () => {
        unit.addPatrolPoint(50, 60);

        expect(unit.patrolPoints).toHaveLength(1);
        expect(unit.state).toBe('patrolling');
        expect(unit.targetX).toBe(50);
        expect(unit.targetY).toBe(60);
      });

      it('adds patrol point when already patrolling', () => {
        unit.state = 'patrolling';
        unit.patrolPoints = [{ x: 10, y: 20 }];

        unit.addPatrolPoint(30, 40);

        expect(unit.patrolPoints).toHaveLength(2);
      });
    });

    describe('nextPatrolPoint', () => {
      it('cycles through patrol points', () => {
        unit.patrolPoints = [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ];
        unit.patrolIndex = 0;

        unit.nextPatrolPoint();

        expect(unit.patrolIndex).toBe(1);
        expect(unit.targetX).toBe(100);
        expect(unit.targetY).toBe(100);

        unit.nextPatrolPoint();

        expect(unit.patrolIndex).toBe(0);
        expect(unit.targetX).toBe(0);
        expect(unit.targetY).toBe(0);
      });

      it('sets idle when no patrol points', () => {
        unit.patrolPoints = [];

        unit.nextPatrolPoint();

        expect(unit.state).toBe('idle');
      });
    });
  });

  describe('worker functionality', () => {
    let worker: Unit;

    beforeEach(() => {
      worker = new Unit(createBasicDefinition({ isWorker: true }));
    });

    describe('setGatherTarget', () => {
      it('sets gather target for workers', () => {
        worker.setGatherTarget(42);

        expect(worker.gatherTargetId).toBe(42);
        expect(worker.state).toBe('gathering');
      });

      it('does nothing for non-workers', () => {
        unit.setGatherTarget(42);

        expect(unit.gatherTargetId).toBe(null);
      });
    });

    describe('startBuilding', () => {
      it('sets up building state for workers', () => {
        worker.gatherTargetId = 5;
        worker.carryingMinerals = 10;
        worker.path = [{ x: 1, y: 1 }];

        worker.startBuilding('barracks', 100, 200);

        expect(worker.buildingType).toBe('barracks');
        expect(worker.buildTargetX).toBe(100);
        expect(worker.buildTargetY).toBe(200);
        expect(worker.state).toBe('building');
        expect(worker.targetX).toBe(100);
        expect(worker.targetY).toBe(200);
        expect(worker.path).toEqual([]);
        expect(worker.gatherTargetId).toBe(null);
        expect(worker.carryingMinerals).toBe(0);
      });

      it('does nothing for non-workers', () => {
        unit.startBuilding('barracks', 100, 200);

        expect(unit.state).toBe('idle');
      });
    });

    describe('assignToConstruction', () => {
      it('assigns worker to construction', () => {
        worker.assignToConstruction(42);

        expect(worker.constructingBuildingId).toBe(42);
        expect(worker.state).toBe('building');
      });
    });

    describe('cancelBuilding', () => {
      it('clears all building state', () => {
        worker.constructingBuildingId = 42;
        worker.buildTargetX = 100;
        worker.buildTargetY = 200;
        worker.buildingType = 'barracks';
        worker.wallLineId = 5;
        worker.wallLineSegments = [1, 2, 3];
        worker.state = 'building';
        worker.isHelperWorker = true;

        worker.cancelBuilding();

        expect(worker.constructingBuildingId).toBe(null);
        expect(worker.buildTargetX).toBe(null);
        expect(worker.buildTargetY).toBe(null);
        expect(worker.buildingType).toBe(null);
        expect(worker.wallLineId).toBe(null);
        expect(worker.wallLineSegments).toEqual([]);
        expect(worker.state).toBe('idle');
        expect(worker.isHelperWorker).toBe(false);
      });
    });

    describe('isActivelyConstructing', () => {
      it('returns true when building with assigned building', () => {
        worker.state = 'building';
        worker.constructingBuildingId = 42;

        expect(worker.isActivelyConstructing()).toBe(true);
      });

      it('returns false when not building', () => {
        worker.state = 'idle';
        worker.constructingBuildingId = 42;

        expect(worker.isActivelyConstructing()).toBe(false);
      });

      it('returns false when no building assigned', () => {
        worker.state = 'building';
        worker.constructingBuildingId = null;

        expect(worker.isActivelyConstructing()).toBe(false);
      });
    });
  });

  describe('transform mechanics', () => {
    let transformUnit: Unit;
    const modes: TransformMode[] = [
      {
        id: 'assault',
        name: 'Assault Mode',
        speed: 3,
        attackRange: 4,
        attackDamage: 15,
        attackSpeed: 1.5,
        sightRange: 8,
        canMove: true,
        transformTime: 2,
      },
      {
        id: 'siege',
        name: 'Siege Mode',
        speed: 0,
        attackRange: 12,
        attackDamage: 50,
        attackSpeed: 0.5,
        splashRadius: 2,
        sightRange: 12,
        canMove: false,
        transformTime: 3,
      },
    ];

    beforeEach(() => {
      transformUnit = new Unit(
        createBasicDefinition({
          canTransform: true,
          transformModes: modes,
          defaultMode: 'assault',
        })
      );
    });

    describe('startTransform', () => {
      it('starts transformation to new mode', () => {
        const result = transformUnit.startTransform('siege');

        expect(result).toBe(true);
        expect(transformUnit.state).toBe('transforming');
        expect(transformUnit.transformTargetMode).toBe('siege');
        expect(transformUnit.transformProgress).toBe(0);
        expect(transformUnit.currentSpeed).toBe(0);
      });

      it('fails if cannot transform', () => {
        unit.canTransform = false;
        expect(unit.startTransform('siege')).toBe(false);
      });

      it('fails if already transforming', () => {
        transformUnit.state = 'transforming';
        expect(transformUnit.startTransform('siege')).toBe(false);
      });

      it('fails for unknown mode', () => {
        expect(transformUnit.startTransform('unknown')).toBe(false);
      });

      it('fails if already in target mode', () => {
        expect(transformUnit.startTransform('assault')).toBe(false);
      });
    });

    describe('updateTransform', () => {
      it('progresses transformation', () => {
        transformUnit.startTransform('siege');

        const complete = transformUnit.updateTransform(1.5);

        expect(complete).toBe(false);
        expect(transformUnit.transformProgress).toBe(0.5);
      });

      it('completes transformation', () => {
        transformUnit.startTransform('siege');

        const complete = transformUnit.updateTransform(3);

        expect(complete).toBe(true);
        expect(transformUnit.currentMode).toBe('siege');
        expect(transformUnit.state).toBe('idle');
      });

      it('returns false when not transforming', () => {
        expect(transformUnit.updateTransform(1)).toBe(false);
      });
    });

    describe('completeTransform', () => {
      it('applies new mode stats', () => {
        transformUnit.startTransform('siege');
        transformUnit.completeTransform();

        expect(transformUnit.speed).toBe(0);
        expect(transformUnit.attackRange).toBe(12);
        expect(transformUnit.attackDamage).toBe(50);
        expect(transformUnit.attackSpeed).toBe(0.5);
        expect(transformUnit.splashRadius).toBe(2);
        expect(transformUnit.sightRange).toBe(12);
      });
    });

    describe('getCurrentMode', () => {
      it('returns current mode info', () => {
        const mode = transformUnit.getCurrentMode();

        expect(mode?.id).toBe('assault');
        expect(mode?.name).toBe('Assault Mode');
      });
    });

    describe('canMoveInCurrentMode', () => {
      it('returns true for movable mode', () => {
        expect(transformUnit.canMoveInCurrentMode()).toBe(true);
      });

      it('returns false for stationary mode', () => {
        transformUnit.startTransform('siege');
        transformUnit.completeTransform();

        expect(transformUnit.canMoveInCurrentMode()).toBe(false);
      });

      it('returns true for non-transform units', () => {
        expect(unit.canMoveInCurrentMode()).toBe(true);
      });
    });
  });

  describe('cloak mechanics', () => {
    let cloakUnit: Unit;

    beforeEach(() => {
      cloakUnit = new Unit(
        createBasicDefinition({
          canCloak: true,
          cloakEnergyCost: 2,
        })
      );
    });

    describe('toggleCloak', () => {
      it('toggles cloak state', () => {
        expect(cloakUnit.isCloaked).toBe(false);

        cloakUnit.toggleCloak();
        expect(cloakUnit.isCloaked).toBe(true);

        cloakUnit.toggleCloak();
        expect(cloakUnit.isCloaked).toBe(false);
      });

      it('fails for non-cloak units', () => {
        expect(unit.toggleCloak()).toBe(false);
        expect(unit.isCloaked).toBe(false);
      });
    });

    describe('setCloak', () => {
      it('sets cloak state directly', () => {
        cloakUnit.setCloak(true);
        expect(cloakUnit.isCloaked).toBe(true);

        cloakUnit.setCloak(false);
        expect(cloakUnit.isCloaked).toBe(false);
      });

      it('does nothing for non-cloak units', () => {
        unit.setCloak(true);
        expect(unit.isCloaked).toBe(false);
      });
    });
  });

  describe('submarine mechanics', () => {
    let sub: Unit;

    beforeEach(() => {
      sub = new Unit(
        createBasicDefinition({
          isSubmarine: true,
          canCloak: true,
          speed: 6,
          submergedSpeed: 4,
        })
      );
    });

    describe('toggleSubmerge', () => {
      it('toggles submerge state', () => {
        sub.toggleSubmerge();
        expect(sub.isSubmerged).toBe(true);
        expect(sub.isCloaked).toBe(true);

        sub.toggleSubmerge();
        expect(sub.isSubmerged).toBe(false);
        expect(sub.isCloaked).toBe(false);
      });

      it('fails for non-submarines', () => {
        expect(unit.toggleSubmerge()).toBe(false);
      });
    });

    describe('setSubmerged', () => {
      it('sets submerged state directly', () => {
        sub.setSubmerged(true);

        expect(sub.isSubmerged).toBe(true);
        expect(sub.isCloaked).toBe(true);
      });
    });

    describe('getEffectiveSpeedForDomain', () => {
      it('returns submerged speed when submerged', () => {
        sub.setSubmerged(true);

        expect(sub.getEffectiveSpeedForDomain()).toBe(4);
      });

      it('returns normal effective speed when surfaced', () => {
        expect(sub.getEffectiveSpeedForDomain()).toBe(6);
      });
    });
  });

  describe('transport mechanics', () => {
    let transport: Unit;

    beforeEach(() => {
      transport = new Unit(
        createBasicDefinition({
          isTransport: true,
          transportCapacity: 8,
        })
      );
    });

    describe('loadUnit', () => {
      it('loads unit into transport', () => {
        expect(transport.loadUnit(1)).toBe(true);
        expect(transport.loadedUnits).toContain(1);
      });

      it('fails when at capacity', () => {
        for (let i = 0; i < 8; i++) {
          transport.loadUnit(i);
        }

        expect(transport.loadUnit(8)).toBe(false);
      });

      it('fails for duplicate unit', () => {
        transport.loadUnit(1);

        expect(transport.loadUnit(1)).toBe(false);
      });

      it('fails for non-transports', () => {
        expect(unit.loadUnit(1)).toBe(false);
      });
    });

    describe('unloadUnit', () => {
      it('unloads specific unit', () => {
        transport.loadUnit(1);
        transport.loadUnit(2);

        expect(transport.unloadUnit(1)).toBe(true);
        expect(transport.loadedUnits).not.toContain(1);
        expect(transport.loadedUnits).toContain(2);
      });

      it('fails for non-loaded unit', () => {
        expect(transport.unloadUnit(99)).toBe(false);
      });
    });

    describe('unloadAll', () => {
      it('returns and clears all loaded units', () => {
        transport.loadUnit(1);
        transport.loadUnit(2);
        transport.loadUnit(3);

        const units = transport.unloadAll();

        expect(units).toEqual([1, 2, 3]);
        expect(transport.loadedUnits).toEqual([]);
      });
    });

    describe('getRemainingCapacity', () => {
      it('calculates remaining capacity', () => {
        expect(transport.getRemainingCapacity()).toBe(8);

        transport.loadUnit(1);
        transport.loadUnit(2);

        expect(transport.getRemainingCapacity()).toBe(6);
      });
    });
  });

  describe('healing/repair mechanics', () => {
    let healer: Unit;

    beforeEach(() => {
      healer = new Unit(
        createBasicDefinition({
          canHeal: true,
          healRange: 5,
          healRate: 10,
          healEnergyCost: 1,
          canRepair: true,
          isWorker: true,
        })
      );
    });

    describe('setHealTarget', () => {
      it('sets heal target', () => {
        healer.setHealTarget(42);
        expect(healer.healTargetId).toBe(42);
      });

      it('does nothing for non-healers', () => {
        unit.setHealTarget(42);
        expect(unit.healTargetId).toBe(null);
      });
    });

    describe('setRepairTarget', () => {
      it('sets repair target and clears gathering state', () => {
        healer.state = 'gathering';
        healer.gatherTargetId = 5;
        healer.isMining = true;

        healer.setRepairTarget(42);

        expect(healer.repairTargetId).toBe(42);
        expect(healer.isRepairing).toBe(true);
        expect(healer.state).toBe('idle');
        expect(healer.gatherTargetId).toBe(null);
        expect(healer.isMining).toBe(false);
      });
    });

    describe('clearHealTarget', () => {
      it('clears heal target', () => {
        healer.healTargetId = 42;
        healer.clearHealTarget();

        expect(healer.healTargetId).toBe(null);
      });
    });

    describe('clearRepairTarget', () => {
      it('clears repair target', () => {
        healer.repairTargetId = 42;
        healer.isRepairing = true;

        healer.clearRepairTarget();

        expect(healer.repairTargetId).toBe(null);
        expect(healer.isRepairing).toBe(false);
      });
    });
  });

  describe('buff mechanics', () => {
    describe('applyBuff', () => {
      it('applies buff with effects', () => {
        unit.applyBuff('speedBoost', 10, { moveSpeedBonus: 0.5 });

        expect(unit.hasBuff('speedBoost')).toBe(true);
      });
    });

    describe('removeBuff', () => {
      it('removes buff', () => {
        unit.applyBuff('speedBoost', 10, { moveSpeedBonus: 0.5 });
        unit.removeBuff('speedBoost');

        expect(unit.hasBuff('speedBoost')).toBe(false);
      });
    });

    describe('getBuffEffect', () => {
      it('returns total effect from all buffs', () => {
        unit.applyBuff('buff1', 10, { damageBonus: 0.2 });
        unit.applyBuff('buff2', 10, { damageBonus: 0.3 });

        expect(unit.getBuffEffect('damageBonus')).toBe(0.5);
      });

      it('returns 0 for no matching effect', () => {
        expect(unit.getBuffEffect('nonexistent')).toBe(0);
      });
    });

    describe('updateBuffs', () => {
      it('reduces buff durations', () => {
        unit.applyBuff('buff1', 10, { damageBonus: 0.2 });

        unit.updateBuffs(3);

        expect(unit.hasBuff('buff1')).toBe(true);
      });

      it('removes expired buffs', () => {
        unit.applyBuff('buff1', 5, { damageBonus: 0.2 });

        const expired = unit.updateBuffs(6);

        expect(expired).toContain('buff1');
        expect(unit.hasBuff('buff1')).toBe(false);
      });
    });

    describe('getEffectiveSpeed', () => {
      it('includes speed buffs', () => {
        unit.applyBuff('speedBoost', 10, { moveSpeedBonus: 0.5 });

        expect(unit.getEffectiveSpeed()).toBe(7.5); // 5 * 1.5
      });
    });

    describe('getEffectiveAttackSpeed', () => {
      it('includes attack speed buffs', () => {
        unit.applyBuff('attackBuff', 10, { attackSpeedBonus: 0.25 });

        expect(unit.getEffectiveAttackSpeed()).toBe(1.25);
      });
    });

    describe('getEffectiveDamage', () => {
      it('includes damage buffs', () => {
        unit.applyBuff('damageBuff', 10, { damageBonus: 1 });

        expect(unit.getEffectiveDamage()).toBe(20); // 10 * 2
      });
    });
  });

  describe('type property', () => {
    it('has correct component type', () => {
      expect(unit.type).toBe('Unit');
    });
  });
});

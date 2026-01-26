import { describe, it, expect, beforeEach } from 'vitest';
import { Wall } from '@/engine/components/Wall';

describe('Wall Component', () => {
  let wall: Wall;

  beforeEach(() => {
    wall = new Wall();
  });

  describe('constructor', () => {
    it('creates regular wall with defaults', () => {
      expect(wall.isGate).toBe(false);
      expect(wall.canMountTurret).toBe(true);
      expect(wall.connectionType).toBe('none');
      expect(wall.gateState).toBe('auto');
    });

    it('creates gate with correct settings', () => {
      const gate = new Wall(true);

      expect(gate.isGate).toBe(true);
      expect(gate.canMountTurret).toBe(false);
      expect(gate.gateState).toBe('auto');
    });

    it('respects canMountTurret parameter', () => {
      const noMount = new Wall(false, false);

      expect(noMount.canMountTurret).toBe(false);
    });

    it('initializes upgrade state', () => {
      expect(wall.appliedUpgrade).toBe(null);
      expect(wall.upgradeInProgress).toBe(null);
      expect(wall.upgradeProgress).toBe(0);
    });

    it('initializes shield state', () => {
      expect(wall.shield).toBe(0);
      expect(wall.maxShield).toBe(0);
    });

    it('initializes repair drone state', () => {
      expect(wall.hasRepairDrone).toBe(false);
    });
  });

  describe('gate mechanics', () => {
    let gate: Wall;

    beforeEach(() => {
      gate = new Wall(true);
    });

    describe('setGateState', () => {
      it('sets state to open', () => {
        gate.setGateState('open');

        expect(gate.gateState).toBe('open');
        expect(gate.gateOpenProgress).toBe(1);
      });

      it('sets state to closed', () => {
        gate.gateOpenProgress = 1;
        gate.setGateState('closed');

        expect(gate.gateState).toBe('closed');
        expect(gate.gateOpenProgress).toBe(0);
      });

      it('sets state to locked', () => {
        gate.gateOpenProgress = 1;
        gate.setGateState('locked');

        expect(gate.gateState).toBe('locked');
        expect(gate.gateOpenProgress).toBe(0);
      });

      it('does nothing for non-gates', () => {
        wall.setGateState('open');

        expect(wall.gateState).toBe('auto');
      });
    });

    describe('toggleGate', () => {
      it('opens closed gate', () => {
        gate.gateOpenProgress = 0;
        gate.gateState = 'closed';

        gate.toggleGate();

        expect(gate.gateState).toBe('open');
      });

      it('closes open gate', () => {
        gate.gateOpenProgress = 1;
        gate.gateState = 'open';

        gate.toggleGate();

        expect(gate.gateState).toBe('closed');
      });

      it('closes when progress > 0.5', () => {
        gate.gateOpenProgress = 0.6;
        gate.gateState = 'auto';

        gate.toggleGate();

        expect(gate.gateState).toBe('closed');
      });

      it('opens when progress <= 0.5', () => {
        gate.gateOpenProgress = 0.4;
        gate.gateState = 'auto';

        gate.toggleGate();

        expect(gate.gateState).toBe('open');
      });

      it('does nothing when locked', () => {
        gate.gateState = 'locked';
        gate.toggleGate();

        expect(gate.gateState).toBe('locked');
      });

      it('does nothing for non-gates', () => {
        wall.toggleGate();
        expect(wall.gateState).toBe('auto');
      });
    });

    describe('toggleLock', () => {
      it('locks closed gate', () => {
        gate.gateState = 'closed';

        gate.toggleLock();

        expect(gate.gateState).toBe('locked');
        expect(gate.gateOpenProgress).toBe(0);
      });

      it('unlocks locked gate', () => {
        gate.gateState = 'locked';

        gate.toggleLock();

        expect(gate.gateState).toBe('closed');
      });

      it('does nothing for non-gates', () => {
        wall.toggleLock();
        expect(wall.gateState).toBe('auto');
      });
    });

    describe('setAutoMode', () => {
      it('sets gate to auto mode', () => {
        gate.gateState = 'closed';

        gate.setAutoMode();

        expect(gate.gateState).toBe('auto');
      });

      it('does nothing for non-gates', () => {
        wall.gateState = 'closed';
        wall.setAutoMode();

        expect(wall.gateState).toBe('closed');
      });
    });

    describe('triggerOpen', () => {
      it('starts auto-close timer in auto mode', () => {
        gate.triggerOpen();

        expect(gate.gateAutoCloseTimer).toBe(Wall.GATE_AUTO_CLOSE_DELAY);
      });

      it('does nothing when locked', () => {
        gate.gateState = 'locked';
        gate.triggerOpen();

        expect(gate.gateAutoCloseTimer).toBe(0);
      });

      it('does nothing for non-gates', () => {
        wall.triggerOpen();
        expect(wall.gateAutoCloseTimer).toBe(0);
      });
    });

    describe('updateGate', () => {
      it('opens gate when state is open', () => {
        gate.gateState = 'open';
        gate.gateOpenProgress = 0;

        gate.updateGate(Wall.GATE_OPEN_TIME);

        expect(gate.gateOpenProgress).toBe(1);
      });

      it('closes gate when state is closed', () => {
        gate.gateState = 'closed';
        gate.gateOpenProgress = 1;

        gate.updateGate(Wall.GATE_OPEN_TIME);

        expect(gate.gateOpenProgress).toBe(0);
      });

      it('opens gate in auto mode with active timer', () => {
        gate.gateAutoCloseTimer = 1;
        gate.gateOpenProgress = 0;

        gate.updateGate(Wall.GATE_OPEN_TIME);

        expect(gate.gateOpenProgress).toBe(1);
      });

      it('decrements auto-close timer', () => {
        gate.gateAutoCloseTimer = 2;
        gate.gateOpenProgress = 1;

        gate.updateGate(0.5);

        expect(gate.gateAutoCloseTimer).toBe(1.5);
      });

      it('closes gate when auto-close timer expires', () => {
        gate.gateAutoCloseTimer = 0.1;
        gate.gateOpenProgress = 1;

        // First update: timer expires, target becomes 0
        gate.updateGate(0.2);
        // Progress starts closing
        gate.updateGate(Wall.GATE_OPEN_TIME);

        expect(gate.gateOpenProgress).toBe(0);
      });

      it('does nothing for non-gates', () => {
        wall.gateOpenProgress = 0.5;
        wall.updateGate(1);

        expect(wall.gateOpenProgress).toBe(0.5);
      });
    });

    describe('isPassable', () => {
      it('returns true when gate is mostly open', () => {
        gate.gateOpenProgress = 0.6;

        expect(gate.isPassable()).toBe(true);
      });

      it('returns false when gate is mostly closed', () => {
        gate.gateOpenProgress = 0.4;

        expect(gate.isPassable()).toBe(false);
      });

      it('returns false for non-gates', () => {
        wall.gateOpenProgress = 1;

        expect(wall.isPassable()).toBe(false);
      });
    });
  });

  describe('turret mounting', () => {
    describe('mountTurret', () => {
      it('mounts turret on wall', () => {
        const result = wall.mountTurret(42);

        expect(result).toBe(true);
        expect(wall.mountedTurretId).toBe(42);
      });

      it('fails if cannot mount turret', () => {
        const noMount = new Wall(false, false);

        expect(noMount.mountTurret(42)).toBe(false);
      });

      it('fails if turret already mounted', () => {
        wall.mountTurret(42);

        expect(wall.mountTurret(43)).toBe(false);
      });

      it('fails if weapon upgrade applied', () => {
        wall.appliedUpgrade = 'weapon';

        expect(wall.mountTurret(42)).toBe(false);
      });
    });

    describe('dismountTurret', () => {
      it('returns turret ID and clears', () => {
        wall.mountTurret(42);

        const turretId = wall.dismountTurret();

        expect(turretId).toBe(42);
        expect(wall.mountedTurretId).toBe(null);
      });

      it('returns null if no turret', () => {
        expect(wall.dismountTurret()).toBe(null);
      });
    });

    describe('canMount', () => {
      it('returns true when can mount', () => {
        expect(wall.canMount()).toBe(true);
      });

      it('returns false when turret mounted', () => {
        wall.mountTurret(42);

        expect(wall.canMount()).toBe(false);
      });

      it('returns false when weapon upgrade', () => {
        wall.appliedUpgrade = 'weapon';

        expect(wall.canMount()).toBe(false);
      });

      it('returns false when cannot mount turret', () => {
        const noMount = new Wall(false, false);

        expect(noMount.canMount()).toBe(false);
      });
    });
  });

  describe('upgrades', () => {
    describe('startUpgrade', () => {
      it('starts upgrade', () => {
        const result = wall.startUpgrade('shielded');

        expect(result).toBe(true);
        expect(wall.upgradeInProgress).toBe('shielded');
        expect(wall.upgradeProgress).toBe(0);
      });

      it('fails if upgrade already applied', () => {
        wall.appliedUpgrade = 'shielded';

        expect(wall.startUpgrade('weapon')).toBe(false);
      });

      it('fails if upgrade in progress', () => {
        wall.upgradeInProgress = 'shielded';

        expect(wall.startUpgrade('weapon')).toBe(false);
      });

      it('fails weapon upgrade if turret mounted', () => {
        wall.mountTurret(42);

        expect(wall.startUpgrade('weapon')).toBe(false);
      });
    });

    describe('updateUpgrade', () => {
      it('updates progress', () => {
        wall.startUpgrade('shielded');

        const complete = wall.updateUpgrade(5, 10);

        expect(complete).toBe(false);
        expect(wall.upgradeProgress).toBe(0.5);
      });

      it('completes upgrade', () => {
        wall.startUpgrade('shielded');

        const complete = wall.updateUpgrade(10, 10);

        expect(complete).toBe(true);
        expect(wall.appliedUpgrade).toBe('shielded');
        expect(wall.upgradeInProgress).toBe(null);
      });

      it('returns false if no upgrade in progress', () => {
        expect(wall.updateUpgrade(5, 10)).toBe(false);
      });

      it('applies shielded upgrade effects', () => {
        wall.startUpgrade('shielded');
        wall.updateUpgrade(10, 10);

        expect(wall.maxShield).toBe(200);
        expect(wall.shield).toBe(200);
      });

      it('applies repair_drone upgrade effects', () => {
        wall.startUpgrade('repair_drone');
        wall.updateUpgrade(10, 10);

        expect(wall.hasRepairDrone).toBe(true);
      });

      it('applies weapon upgrade effects', () => {
        wall.startUpgrade('weapon');
        wall.updateUpgrade(10, 10);

        expect(wall.canMountTurret).toBe(false);
      });
    });

    describe('cancelUpgrade', () => {
      it('cancels upgrade and returns type', () => {
        wall.startUpgrade('shielded');
        wall.upgradeProgress = 0.5;

        const cancelled = wall.cancelUpgrade();

        expect(cancelled).toBe('shielded');
        expect(wall.upgradeInProgress).toBe(null);
        expect(wall.upgradeProgress).toBe(0);
      });

      it('returns null if no upgrade in progress', () => {
        expect(wall.cancelUpgrade()).toBe(null);
      });
    });
  });

  describe('shield mechanics', () => {
    beforeEach(() => {
      wall.maxShield = 200;
      wall.shield = 100;
    });

    describe('updateShield', () => {
      it('regenerates shield', () => {
        wall.updateShield(5);

        expect(wall.shield).toBe(110); // 100 + (2 * 5)
      });

      it('caps at max shield', () => {
        wall.shield = 199;
        wall.updateShield(5);

        expect(wall.shield).toBe(200);
      });

      it('does nothing when max is 0', () => {
        wall.maxShield = 0;
        wall.shield = 0;

        wall.updateShield(5);

        expect(wall.shield).toBe(0);
      });
    });

    describe('absorbDamage', () => {
      it('absorbs damage with shield', () => {
        const remaining = wall.absorbDamage(50);

        expect(remaining).toBe(0);
        expect(wall.shield).toBe(50);
      });

      it('returns remaining damage when shield depleted', () => {
        const remaining = wall.absorbDamage(150);

        expect(remaining).toBe(50);
        expect(wall.shield).toBe(0);
      });

      it('passes through when no shield', () => {
        wall.shield = 0;

        const remaining = wall.absorbDamage(50);

        expect(remaining).toBe(50);
      });
    });
  });

  describe('connection management', () => {
    describe('updateConnectionType', () => {
      it('sets none when no neighbors', () => {
        wall.updateConnectionType();

        expect(wall.connectionType).toBe('none');
      });

      it('sets cross when all neighbors', () => {
        wall.neighborNorth = 1;
        wall.neighborSouth = 2;
        wall.neighborEast = 3;
        wall.neighborWest = 4;

        wall.updateConnectionType();

        expect(wall.connectionType).toBe('cross');
      });

      it('sets t_south when missing north', () => {
        wall.neighborSouth = 2;
        wall.neighborEast = 3;
        wall.neighborWest = 4;

        wall.updateConnectionType();

        expect(wall.connectionType).toBe('t_south');
      });

      it('sets t_north when missing south', () => {
        wall.neighborNorth = 1;
        wall.neighborEast = 3;
        wall.neighborWest = 4;

        wall.updateConnectionType();

        expect(wall.connectionType).toBe('t_north');
      });

      it('sets vertical for north-south', () => {
        wall.neighborNorth = 1;
        wall.neighborSouth = 2;

        wall.updateConnectionType();

        expect(wall.connectionType).toBe('vertical');
      });

      it('sets horizontal for east-west', () => {
        wall.neighborEast = 1;
        wall.neighborWest = 2;

        wall.updateConnectionType();

        expect(wall.connectionType).toBe('horizontal');
      });

      it('sets corner_ne', () => {
        wall.neighborNorth = 1;
        wall.neighborEast = 2;

        wall.updateConnectionType();

        expect(wall.connectionType).toBe('corner_ne');
      });

      it('sets corner_nw', () => {
        wall.neighborNorth = 1;
        wall.neighborWest = 2;

        wall.updateConnectionType();

        expect(wall.connectionType).toBe('corner_nw');
      });

      it('sets corner_se', () => {
        wall.neighborSouth = 1;
        wall.neighborEast = 2;

        wall.updateConnectionType();

        expect(wall.connectionType).toBe('corner_se');
      });

      it('sets corner_sw', () => {
        wall.neighborSouth = 1;
        wall.neighborWest = 2;

        wall.updateConnectionType();

        expect(wall.connectionType).toBe('corner_sw');
      });

      it('sets vertical for single north neighbor', () => {
        wall.neighborNorth = 1;

        wall.updateConnectionType();

        expect(wall.connectionType).toBe('vertical');
      });

      it('sets horizontal for single east neighbor', () => {
        wall.neighborEast = 1;

        wall.updateConnectionType();

        expect(wall.connectionType).toBe('horizontal');
      });
    });

    describe('setNeighbor', () => {
      it('sets north neighbor', () => {
        wall.setNeighbor('north', 42);

        expect(wall.neighborNorth).toBe(42);
      });

      it('sets south neighbor', () => {
        wall.setNeighbor('south', 42);

        expect(wall.neighborSouth).toBe(42);
      });

      it('sets east neighbor', () => {
        wall.setNeighbor('east', 42);

        expect(wall.neighborEast).toBe(42);
      });

      it('sets west neighbor', () => {
        wall.setNeighbor('west', 42);

        expect(wall.neighborWest).toBe(42);
      });

      it('clears neighbor with null', () => {
        wall.neighborNorth = 42;
        wall.setNeighbor('north', null);

        expect(wall.neighborNorth).toBe(null);
      });

      it('updates connection type', () => {
        wall.setNeighbor('north', 1);
        wall.setNeighbor('south', 2);

        expect(wall.connectionType).toBe('vertical');
      });
    });

    describe('getNeighborIds', () => {
      it('returns all neighbor IDs', () => {
        wall.neighborNorth = 1;
        wall.neighborSouth = 2;
        wall.neighborEast = 3;

        const ids = wall.getNeighborIds();

        expect(ids).toContain(1);
        expect(ids).toContain(2);
        expect(ids).toContain(3);
        expect(ids).toHaveLength(3);
      });

      it('returns empty array when no neighbors', () => {
        expect(wall.getNeighborIds()).toEqual([]);
      });
    });
  });

  describe('type property', () => {
    it('has correct component type', () => {
      expect(wall.type).toBe('Wall');
    });
  });

  describe('static constants', () => {
    it('has gate timing constants', () => {
      expect(Wall.GATE_OPEN_TIME).toBe(0.5);
      expect(Wall.GATE_AUTO_CLOSE_DELAY).toBe(2.0);
    });
  });
});

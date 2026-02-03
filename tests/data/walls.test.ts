import { describe, it, expect } from 'vitest';
import {
  WALL_DEFINITIONS,
  WALL_UPGRADE_DEFINITIONS,
  calculateWallLine,
  calculateWallLineCost,
  getWallConnectionType,
} from '@/data/buildings/walls';

describe('Wall Definitions', () => {
  describe('WALL_DEFINITIONS', () => {
    it('defines wall_segment', () => {
      expect(WALL_DEFINITIONS.wall_segment).toBeDefined();
      expect(WALL_DEFINITIONS.wall_segment.name).toBe('Wall Segment');
      expect(WALL_DEFINITIONS.wall_segment.isWall).toBe(true);
      expect(WALL_DEFINITIONS.wall_segment.canMountTurret).toBe(true);
    });

    it('defines wall_gate', () => {
      expect(WALL_DEFINITIONS.wall_gate).toBeDefined();
      expect(WALL_DEFINITIONS.wall_gate.name).toBe('Wall Gate');
      expect(WALL_DEFINITIONS.wall_gate.isWall).toBe(true);
      expect(WALL_DEFINITIONS.wall_gate.isGate).toBe(true);
      expect(WALL_DEFINITIONS.wall_gate.canMountTurret).toBe(false);
    });

    it('defines upgraded wall variants', () => {
      expect(WALL_DEFINITIONS.wall_reinforced).toBeDefined();
      expect(WALL_DEFINITIONS.wall_shielded).toBeDefined();
      expect(WALL_DEFINITIONS.wall_weapon).toBeDefined();
    });

    it('all walls have required properties', () => {
      for (const [id, def] of Object.entries(WALL_DEFINITIONS)) {
        expect(def.id).toBe(id);
        expect(def.name).toBeTruthy();
        expect(typeof def.maxHealth).toBe('number');
        expect(typeof def.armor).toBe('number');
        expect(def.isWall).toBe(true);
      }
    });

    it('wall_segment has correct dimensions', () => {
      const wall = WALL_DEFINITIONS.wall_segment;
      expect(wall.width).toBe(1);
      expect(wall.height).toBe(1);
    });

    it('wall_gate is wider than segment', () => {
      const gate = WALL_DEFINITIONS.wall_gate;
      expect(gate.width).toBe(2);
      expect(gate.height).toBe(1);
    });

    it('wall_segment can be upgraded', () => {
      const wall = WALL_DEFINITIONS.wall_segment;
      expect(wall.wallUpgrades).toContain('reinforced');
      expect(wall.wallUpgrades).toContain('shielded');
      expect(wall.wallUpgrades).toContain('weapon');
      expect(wall.wallUpgrades).toContain('repair_drone');
    });

    it('wall_weapon has attack properties', () => {
      const weapon = WALL_DEFINITIONS.wall_weapon;
      expect(weapon.attackRange).toBeDefined();
      expect(weapon.attackDamage).toBeDefined();
      expect(weapon.attackSpeed).toBeDefined();
      expect(weapon.canMountTurret).toBe(false);
    });

    it('wall_reinforced has higher health', () => {
      const base = WALL_DEFINITIONS.wall_segment;
      const reinforced = WALL_DEFINITIONS.wall_reinforced;
      expect(reinforced.maxHealth).toBeGreaterThan(base.maxHealth);
    });
  });

  describe('WALL_UPGRADE_DEFINITIONS', () => {
    it('defines reinforced upgrade', () => {
      expect(WALL_UPGRADE_DEFINITIONS.reinforced).toBeDefined();
      expect(WALL_UPGRADE_DEFINITIONS.reinforced.name).toBe('Reinforced Plating');
      expect(WALL_UPGRADE_DEFINITIONS.reinforced.researchBuilding).toBe('tech_center');
    });

    it('defines shielded upgrade', () => {
      expect(WALL_UPGRADE_DEFINITIONS.shielded).toBeDefined();
      expect(WALL_UPGRADE_DEFINITIONS.shielded.name).toBe('Shield Generator');
      expect(WALL_UPGRADE_DEFINITIONS.shielded.researchBuilding).toBe('tech_center');
    });

    it('defines weapon upgrade', () => {
      expect(WALL_UPGRADE_DEFINITIONS.weapon).toBeDefined();
      expect(WALL_UPGRADE_DEFINITIONS.weapon.name).toBe('Mounted Turret');
      expect(WALL_UPGRADE_DEFINITIONS.weapon.researchBuilding).toBe('tech_center');
    });

    it('defines repair_drone upgrade', () => {
      expect(WALL_UPGRADE_DEFINITIONS.repair_drone).toBeDefined();
      expect(WALL_UPGRADE_DEFINITIONS.repair_drone.name).toBe('Repair Drone');
      expect(WALL_UPGRADE_DEFINITIONS.repair_drone.researchBuilding).toBe('tech_center');
    });

    it('all upgrades have required properties', () => {
      for (const [id, def] of Object.entries(WALL_UPGRADE_DEFINITIONS)) {
        expect(def.id).toBe(id);
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.researchCost).toBeDefined();
        expect(def.applyCost).toBeDefined();
        expect(typeof def.researchTime).toBe('number');
        expect(typeof def.applyTime).toBe('number');
      }
    });
  });

  describe('WALL_DEFINITIONS coverage', () => {
    it('contains expected wall definitions', () => {
      const wallIds = Object.keys(WALL_DEFINITIONS);
      expect(wallIds.length).toBeGreaterThan(0);
      expect(wallIds).toContain('wall_segment');
      expect(wallIds).toContain('wall_gate');
    });
  });
});

describe('calculateWallLine', () => {
  describe('horizontal lines', () => {
    it('calculates horizontal line left to right', () => {
      const positions = calculateWallLine(0, 0, 5, 0);
      expect(positions).toHaveLength(6); // 0, 1, 2, 3, 4, 5
      expect(positions[0]).toEqual({ x: 0, y: 0 });
      expect(positions[5]).toEqual({ x: 5, y: 0 });
    });

    it('calculates horizontal line right to left', () => {
      const positions = calculateWallLine(5, 0, 0, 0);
      expect(positions).toHaveLength(6);
      expect(positions[0]).toEqual({ x: 5, y: 0 });
      expect(positions[5]).toEqual({ x: 0, y: 0 });
    });

    it('handles single point', () => {
      const positions = calculateWallLine(3, 3, 3, 3);
      expect(positions).toHaveLength(1);
      expect(positions[0]).toEqual({ x: 3, y: 3 });
    });
  });

  describe('vertical lines', () => {
    it('calculates vertical line top to bottom', () => {
      const positions = calculateWallLine(0, 0, 0, 5);
      expect(positions).toHaveLength(6);
      expect(positions[0]).toEqual({ x: 0, y: 0 });
      expect(positions[5]).toEqual({ x: 0, y: 5 });
    });

    it('calculates vertical line bottom to top', () => {
      const positions = calculateWallLine(0, 5, 0, 0);
      expect(positions).toHaveLength(6);
      expect(positions[0]).toEqual({ x: 0, y: 5 });
      expect(positions[5]).toEqual({ x: 0, y: 0 });
    });
  });

  describe('diagonal lines', () => {
    it('calculates 45-degree diagonal', () => {
      const positions = calculateWallLine(0, 0, 4, 4);
      expect(positions.length).toBeGreaterThanOrEqual(5);
      // First and last should be endpoints
      expect(positions[0]).toEqual({ x: 0, y: 0 });
      expect(positions[positions.length - 1]).toEqual({ x: 4, y: 4 });
    });

    it('calculates negative diagonal', () => {
      const positions = calculateWallLine(4, 4, 0, 0);
      expect(positions.length).toBeGreaterThanOrEqual(5);
      expect(positions[0]).toEqual({ x: 4, y: 4 });
      expect(positions[positions.length - 1]).toEqual({ x: 0, y: 0 });
    });
  });

  describe('snapping', () => {
    it('snaps to grid', () => {
      const positions = calculateWallLine(0.3, 0.7, 2.8, 0.2);
      // Should snap to integer positions
      for (const pos of positions) {
        expect(Number.isInteger(pos.x)).toBe(true);
        expect(Number.isInteger(pos.y)).toBe(true);
      }
    });
  });

  describe('mixed lines', () => {
    it('prefers horizontal for mostly horizontal', () => {
      const positions = calculateWallLine(0, 0, 10, 2);
      // Should be mostly horizontal (constant y)
      expect(positions.length).toBeGreaterThan(8);
    });

    it('prefers vertical for mostly vertical', () => {
      const positions = calculateWallLine(0, 0, 2, 10);
      // Should be mostly vertical (constant x)
      expect(positions.length).toBeGreaterThan(8);
    });
  });
});

describe('calculateWallLineCost', () => {
  it('calculates cost for wall_segment', () => {
    const positions = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    const cost = calculateWallLineCost(positions, 'wall_segment');

    expect(cost.minerals).toBe(75); // 3 * 25
    expect(cost.plasma).toBe(0);
  });

  it('calculates cost for wall_gate', () => {
    const positions = [{ x: 0, y: 0 }];
    const cost = calculateWallLineCost(positions, 'wall_gate');

    expect(cost.minerals).toBe(75); // 1 * 75
    expect(cost.plasma).toBe(0);
  });

  it('returns zero for invalid building type', () => {
    const positions = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const cost = calculateWallLineCost(positions, 'invalid_type');

    expect(cost.minerals).toBe(0);
    expect(cost.plasma).toBe(0);
  });

  it('defaults to wall_segment', () => {
    const positions = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const cost = calculateWallLineCost(positions);

    expect(cost.minerals).toBe(50); // 2 * 25
    expect(cost.plasma).toBe(0);
  });

  it('handles empty positions array', () => {
    const cost = calculateWallLineCost([], 'wall_segment');

    expect(cost.minerals).toBe(0);
    expect(cost.plasma).toBe(0);
  });
});

describe('getWallConnectionType', () => {
  describe('no connections', () => {
    it('returns none for isolated wall', () => {
      expect(getWallConnectionType(false, false, false, false)).toBe('none');
    });
  });

  describe('cross connection', () => {
    it('returns cross for all four neighbors', () => {
      expect(getWallConnectionType(true, true, true, true)).toBe('cross');
    });
  });

  describe('T-junctions', () => {
    it('returns t_south when missing north', () => {
      expect(getWallConnectionType(false, true, true, true)).toBe('t_south');
    });

    it('returns t_north when missing south', () => {
      expect(getWallConnectionType(true, false, true, true)).toBe('t_north');
    });

    it('returns t_west when missing east', () => {
      expect(getWallConnectionType(true, true, false, true)).toBe('t_west');
    });

    it('returns t_east when missing west', () => {
      expect(getWallConnectionType(true, true, true, false)).toBe('t_east');
    });
  });

  describe('straight connections', () => {
    it('returns vertical for north-south', () => {
      expect(getWallConnectionType(true, true, false, false)).toBe('vertical');
    });

    it('returns horizontal for east-west', () => {
      expect(getWallConnectionType(false, false, true, true)).toBe('horizontal');
    });
  });

  describe('corners', () => {
    it('returns corner_ne for north-east', () => {
      expect(getWallConnectionType(true, false, true, false)).toBe('corner_ne');
    });

    it('returns corner_nw for north-west', () => {
      expect(getWallConnectionType(true, false, false, true)).toBe('corner_nw');
    });

    it('returns corner_se for south-east', () => {
      expect(getWallConnectionType(false, true, true, false)).toBe('corner_se');
    });

    it('returns corner_sw for south-west', () => {
      expect(getWallConnectionType(false, true, false, true)).toBe('corner_sw');
    });
  });

  describe('single connections', () => {
    it('returns vertical for north only', () => {
      expect(getWallConnectionType(true, false, false, false)).toBe('vertical');
    });

    it('returns vertical for south only', () => {
      expect(getWallConnectionType(false, true, false, false)).toBe('vertical');
    });

    it('returns horizontal for east only', () => {
      expect(getWallConnectionType(false, false, true, false)).toBe('horizontal');
    });

    it('returns horizontal for west only', () => {
      expect(getWallConnectionType(false, false, false, true)).toBe('horizontal');
    });
  });
});

describe('wall costs and timing balance', () => {
  it('wall_segment is cheapest', () => {
    const segment = WALL_DEFINITIONS.wall_segment;
    const gate = WALL_DEFINITIONS.wall_gate;
    expect(segment.mineralCost).toBeLessThan(gate.mineralCost);
  });

  it('gate builds slower than segment', () => {
    const segment = WALL_DEFINITIONS.wall_segment;
    const gate = WALL_DEFINITIONS.wall_gate;
    expect(gate.buildTime).toBeGreaterThan(segment.buildTime);
  });

  it('upgrade research costs more than application', () => {
    for (const upgrade of Object.values(WALL_UPGRADE_DEFINITIONS)) {
      const researchTotal = upgrade.researchCost.minerals + upgrade.researchCost.plasma;
      const applyTotal = upgrade.applyCost.minerals + upgrade.applyCost.plasma;
      expect(researchTotal).toBeGreaterThan(applyTotal);
    }
  });
});

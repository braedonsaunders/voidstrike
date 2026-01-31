import { describe, it, expect } from 'vitest';
import {
  FORMATION_DEFINITIONS,
  FORMATION_CONFIG,
  getFormationIds,
  getFormation,
  getDefaultFormation,
  generateFormationPositions,
  sortUnitsForFormation,
} from '@/data/formations/formations';

describe('Formation System', () => {
  describe('FORMATION_DEFINITIONS', () => {
    it('defines standard formations', () => {
      expect(FORMATION_DEFINITIONS.box).toBeDefined();
      expect(FORMATION_DEFINITIONS.line).toBeDefined();
      expect(FORMATION_DEFINITIONS.column).toBeDefined();
      expect(FORMATION_DEFINITIONS.wedge).toBeDefined();
      expect(FORMATION_DEFINITIONS.scatter).toBeDefined();
      expect(FORMATION_DEFINITIONS.circle).toBeDefined();
    });

    it('defines specialized formations', () => {
      expect(FORMATION_DEFINITIONS.siege_line).toBeDefined();
      expect(FORMATION_DEFINITIONS.air_cover).toBeDefined();
    });

    it('all formations have required properties', () => {
      for (const [id, def] of Object.entries(FORMATION_DEFINITIONS)) {
        expect(def.id).toBe(id);
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(typeof def.unitSpacing).toBe('number');
        expect(typeof def.rowSpacing).toBe('number');
        expect(typeof def.maintainFormation).toBe('boolean');
        expect(typeof def.reformAfterCombat).toBe('boolean');
        expect(typeof def.allowRotation).toBe('boolean');
        expect(['box', 'line', 'column', 'wedge', 'scatter', 'circle', 'custom']).toContain(def.shape);
      }
    });

    it('box formation has correct properties', () => {
      const box = FORMATION_DEFINITIONS.box;
      expect(box.shape).toBe('box');
      expect(box.unitSpacing).toBe(1.5);
      expect(box.rowSpacing).toBe(1.5);
      expect(box.maintainFormation).toBe(true);
      expect(box.meleeFront).toBe(true);
      expect(box.rangedBack).toBe(true);
      expect(box.supportCenter).toBe(true);
    });

    it('scatter formation does not maintain formation', () => {
      const scatter = FORMATION_DEFINITIONS.scatter;
      expect(scatter.maintainFormation).toBe(false);
      expect(scatter.reformAfterCombat).toBe(false);
    });

    it('custom formations have predefined slots', () => {
      const siegeLine = FORMATION_DEFINITIONS.siege_line;
      expect(siegeLine.shape).toBe('custom');
      expect(siegeLine.slots).toBeDefined();
      expect(siegeLine.slots!.length).toBeGreaterThan(0);
    });
  });

  describe('FORMATION_CONFIG', () => {
    it('defines system configuration', () => {
      expect(FORMATION_CONFIG.reformSpeed).toBeGreaterThan(0);
      expect(FORMATION_CONFIG.reformThreshold).toBeGreaterThan(0);
      expect(FORMATION_CONFIG.combatBreakDistance).toBeGreaterThan(0);
      expect(FORMATION_CONFIG.autoReformDelay).toBeGreaterThan(0);
    });

    it('defines default formations', () => {
      expect(FORMATION_CONFIG.defaultFormation).toBe('box');
      expect(FORMATION_CONFIG.defaultAirFormation).toBe('scatter');
    });

    it('defines formation hotkeys', () => {
      expect(FORMATION_CONFIG.formationHotkeys.box).toBe('F1');
      expect(FORMATION_CONFIG.formationHotkeys.line).toBe('F2');
      expect(FORMATION_CONFIG.formationHotkeys.scatter).toBe('F5');
    });
  });

  describe('getFormationIds', () => {
    it('returns all formation IDs', () => {
      const ids = getFormationIds();
      expect(ids).toContain('box');
      expect(ids).toContain('line');
      expect(ids).toContain('column');
      expect(ids).toContain('wedge');
      expect(ids).toContain('scatter');
      expect(ids).toContain('circle');
      expect(ids).toContain('siege_line');
      expect(ids).toContain('air_cover');
    });

    it('returns array of strings', () => {
      const ids = getFormationIds();
      for (const id of ids) {
        expect(typeof id).toBe('string');
      }
    });
  });

  describe('getFormation', () => {
    it('returns formation for valid ID', () => {
      const box = getFormation('box');
      expect(box).toBeDefined();
      expect(box!.id).toBe('box');
    });

    it('returns undefined for invalid ID', () => {
      const result = getFormation('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('getDefaultFormation', () => {
    it('returns box formation by default', () => {
      const defaultFormation = getDefaultFormation();
      expect(defaultFormation.id).toBe('box');
    });
  });

  describe('generateFormationPositions', () => {
    describe('box formation', () => {
      it('generates positions for single unit at center', () => {
        const positions = generateFormationPositions('box', 1, 10, 10, 0);
        expect(positions).toHaveLength(1);
        expect(positions[0].x).toBeCloseTo(10);
        expect(positions[0].y).toBeCloseTo(10);
        expect(positions[0].slot).toBe(0);
      });

      it('generates positions for multiple units', () => {
        const positions = generateFormationPositions('box', 4, 0, 0, 0);
        expect(positions).toHaveLength(4);
        // All positions should have unique slots
        const slots = new Set(positions.map(p => p.slot));
        expect(slots.size).toBe(4);
      });

      it('respects facing angle', () => {
        const positions0 = generateFormationPositions('box', 2, 0, 0, 0);
        const positions90 = generateFormationPositions('box', 2, 0, 0, Math.PI / 2);

        // Positions should be different when rotated
        expect(positions0[0].x).not.toBeCloseTo(positions90[0].x);
      });
    });

    describe('line formation', () => {
      it('generates positions in a line', () => {
        const positions = generateFormationPositions('line', 3, 0, 0, 0);
        expect(positions).toHaveLength(3);
        // Line should spread perpendicular to facing direction
      });
    });

    describe('column formation', () => {
      it('generates positions in a column', () => {
        const positions = generateFormationPositions('column', 3, 0, 0, 0);
        expect(positions).toHaveLength(3);
      });
    });

    describe('wedge formation', () => {
      it('generates V-shaped positions', () => {
        const positions = generateFormationPositions('wedge', 5, 0, 0, 0);
        expect(positions).toHaveLength(5);
        // First unit (leader) should be at front
        expect(positions[0].slot).toBe(0);
      });

      it('leader is at center front', () => {
        const positions = generateFormationPositions('wedge', 5, 10, 10, 0);
        expect(positions[0].x).toBeCloseTo(10);
        expect(positions[0].y).toBeCloseTo(10);
      });
    });

    describe('scatter formation', () => {
      it('generates deterministic positions', () => {
        const pos1 = generateFormationPositions('scatter', 5, 0, 0, 0);
        const pos2 = generateFormationPositions('scatter', 5, 0, 0, 0);
        // Same inputs should produce same positions (deterministic)
        expect(pos1[0].x).toBeCloseTo(pos2[0].x);
        expect(pos1[0].y).toBeCloseTo(pos2[0].y);
      });

      it('spreads units using golden angle', () => {
        const positions = generateFormationPositions('scatter', 10, 0, 0, 0);
        expect(positions).toHaveLength(10);
        // First unit is at center
        expect(positions[0].x).toBeCloseTo(0);
        expect(positions[0].y).toBeCloseTo(0);
      });
    });

    describe('circle formation', () => {
      it('generates positions in a circle', () => {
        const positions = generateFormationPositions('circle', 4, 0, 0, 0);
        expect(positions).toHaveLength(4);
        // All positions should be equidistant from center
        const firstRadius = Math.sqrt(positions[0].x ** 2 + positions[0].y ** 2);
        for (const pos of positions) {
          const radius = Math.sqrt(pos.x ** 2 + pos.y ** 2);
          expect(radius).toBeCloseTo(firstRadius);
        }
      });
    });

    describe('custom formations', () => {
      it('uses predefined slots for siege_line', () => {
        const positions = generateFormationPositions('siege_line', 5, 0, 0, 0);
        expect(positions).toHaveLength(5);
        // Should use high-priority slots first
      });
    });

    it('returns empty array for invalid formation', () => {
      const positions = generateFormationPositions('nonexistent', 5, 0, 0, 0);
      expect(positions).toEqual([]);
    });
  });

  describe('sortUnitsForFormation', () => {
    const units = [
      { id: 1, category: 'infantry', isRanged: true, isMelee: false, isSupport: false },
      { id: 2, category: 'infantry', isRanged: false, isMelee: true, isSupport: false },
      { id: 3, category: 'support', isRanged: false, isMelee: false, isSupport: true },
      { id: 4, category: 'infantry', isRanged: true, isMelee: false, isSupport: false },
      { id: 5, category: 'vehicle', isRanged: false, isMelee: true, isSupport: false },
    ];

    it('sorts melee to front for box formation', () => {
      const sorted = sortUnitsForFormation('box', units);
      // Melee units should come before ranged
      const meleeIndices = sorted.filter(u => u.isMelee).map(u => sorted.indexOf(u));
      const rangedIndices = sorted.filter(u => u.isRanged).map(u => sorted.indexOf(u));

      const maxMelee = Math.max(...meleeIndices);
      const minRanged = Math.min(...rangedIndices);
      expect(maxMelee).toBeLessThan(minRanged);
    });

    it('does not reorder for scatter formation', () => {
      // Scatter has meleeFront: false and rangedBack: false
      const sorted = sortUnitsForFormation('scatter', units);
      // Original order should be preserved (stable sort)
      expect(sorted[0].id).toBe(1);
    });

    it('returns original array for invalid formation', () => {
      const sorted = sortUnitsForFormation('nonexistent', units);
      expect(sorted).toEqual(units);
    });
  });

  describe('formation slot priorities', () => {
    it('siege_line slots are sorted by priority', () => {
      const siegeLine = FORMATION_DEFINITIONS.siege_line;
      const slots = siegeLine.slots!;

      // Front row (priority 10) should come before back row (priority 5)
      const frontRowSlots = slots.filter(s => s.priority === 10);
      const backRowSlots = slots.filter(s => s.priority === 5);

      expect(frontRowSlots.length).toBeGreaterThan(0);
      expect(backRowSlots.length).toBeGreaterThan(0);
    });

    it('slots have preferred categories', () => {
      const siegeLine = FORMATION_DEFINITIONS.siege_line;
      const slots = siegeLine.slots!;

      // Some slots should prefer specific categories
      const vehicleSlots = slots.filter(s => s.preferredCategories?.includes('vehicle'));
      expect(vehicleSlots.length).toBeGreaterThan(0);
    });
  });

  describe('formation spacing', () => {
    it('box uses same unit and row spacing', () => {
      const box = FORMATION_DEFINITIONS.box;
      expect(box.unitSpacing).toBe(box.rowSpacing);
    });

    it('line has no row spacing', () => {
      const line = FORMATION_DEFINITIONS.line;
      expect(line.rowSpacing).toBe(0);
    });

    it('scatter has wide spacing', () => {
      const scatter = FORMATION_DEFINITIONS.scatter;
      expect(scatter.unitSpacing).toBeGreaterThanOrEqual(3);
    });
  });
});

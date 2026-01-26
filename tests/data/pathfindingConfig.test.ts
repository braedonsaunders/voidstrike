import { describe, it, expect } from 'vitest';
import {
  WALKABLE_CLIMB,
  WALKABLE_SLOPE_ANGLE,
  WALKABLE_HEIGHT,
  WALKABLE_RADIUS,
  NAVMESH_CELL_SIZE,
  NAVMESH_CELL_HEIGHT,
  MAX_SIMPLIFICATION_ERROR,
  TILE_SIZE,
  EXPECTED_LAYERS_PER_TILE,
  MAX_OBSTACLES,
  ELEVATION_TO_HEIGHT_FACTOR,
  WALKABLE_CLIMB_ELEVATION,
  CLIFF_WALL_THRESHOLD_ELEVATION,
  RAMP_BOUNDARY_ELEVATION_THRESHOLD,
  RAMP_SMOOTHING_MAX_CARDINAL,
  RAMP_SMOOTHING_MAX_DIAGONAL,
  RAMP_SMOOTHING_PASSES,
  CROWD_MAX_AGENTS,
  CROWD_MAX_AGENT_RADIUS,
  DEFAULT_AGENT_RADIUS,
  MAX_RAMP_ELEVATION_PER_CELL,
  NAVMESH_CONFIG,
  SOLO_NAVMESH_CONFIG,
  CROWD_CONFIG,
  elevationToHeight,
  calculateMinRampLength,
  validateRampConstraints,
  calculateExtendedRampEndpoint,
} from '@/data/pathfinding.config';

describe('Pathfinding Config', () => {
  describe('core constants', () => {
    it('defines walkable climb', () => {
      expect(WALKABLE_CLIMB).toBeGreaterThan(0);
      expect(typeof WALKABLE_CLIMB).toBe('number');
    });

    it('defines walkable slope angle', () => {
      expect(WALKABLE_SLOPE_ANGLE).toBeGreaterThan(0);
      expect(WALKABLE_SLOPE_ANGLE).toBeLessThanOrEqual(90);
    });

    it('defines walkable height', () => {
      expect(WALKABLE_HEIGHT).toBeGreaterThan(0);
    });

    it('defines walkable radius', () => {
      expect(WALKABLE_RADIUS).toBeGreaterThan(0);
    });

    it('defines navmesh cell size', () => {
      expect(NAVMESH_CELL_SIZE).toBeGreaterThan(0);
    });

    it('defines navmesh cell height', () => {
      expect(NAVMESH_CELL_HEIGHT).toBeGreaterThan(0);
    });

    it('defines max simplification error', () => {
      expect(MAX_SIMPLIFICATION_ERROR).toBeGreaterThan(0);
    });

    it('defines tile size', () => {
      expect(TILE_SIZE).toBeGreaterThan(0);
      expect(Number.isInteger(TILE_SIZE)).toBe(true);
    });

    it('defines expected layers per tile', () => {
      expect(EXPECTED_LAYERS_PER_TILE).toBeGreaterThan(0);
      expect(Number.isInteger(EXPECTED_LAYERS_PER_TILE)).toBe(true);
    });

    it('defines max obstacles', () => {
      expect(MAX_OBSTACLES).toBeGreaterThan(0);
      expect(Number.isInteger(MAX_OBSTACLES)).toBe(true);
    });
  });

  describe('elevation conversion', () => {
    it('defines elevation to height factor', () => {
      expect(ELEVATION_TO_HEIGHT_FACTOR).toBeGreaterThan(0);
      expect(ELEVATION_TO_HEIGHT_FACTOR).toBeLessThan(1);
    });

    it('derives walkable climb elevation from climb and factor', () => {
      const expectedBase = WALKABLE_CLIMB / ELEVATION_TO_HEIGHT_FACTOR;
      expect(WALKABLE_CLIMB_ELEVATION).toBeLessThanOrEqual(expectedBase);
    });

    it('defines cliff wall threshold elevation', () => {
      expect(CLIFF_WALL_THRESHOLD_ELEVATION).toBeGreaterThan(0);
    });

    it('derives ramp boundary elevation threshold', () => {
      expect(RAMP_BOUNDARY_ELEVATION_THRESHOLD).toBeGreaterThan(0);
    });
  });

  describe('ramp smoothing constants', () => {
    it('defines cardinal max based on walkable climb', () => {
      expect(RAMP_SMOOTHING_MAX_CARDINAL).toBe(WALKABLE_CLIMB);
    });

    it('defines diagonal max accounting for sqrt2', () => {
      expect(RAMP_SMOOTHING_MAX_DIAGONAL).toBeCloseTo(WALKABLE_CLIMB * Math.SQRT2);
    });

    it('defines smoothing passes', () => {
      expect(RAMP_SMOOTHING_PASSES).toBeGreaterThan(0);
      expect(Number.isInteger(RAMP_SMOOTHING_PASSES)).toBe(true);
    });
  });

  describe('crowd simulation constants', () => {
    it('defines max agents for large-scale RTS', () => {
      expect(CROWD_MAX_AGENTS).toBeGreaterThanOrEqual(1000);
    });

    it('defines max agent radius', () => {
      expect(CROWD_MAX_AGENT_RADIUS).toBeGreaterThan(0);
    });

    it('defines default agent radius', () => {
      expect(DEFAULT_AGENT_RADIUS).toBeGreaterThan(0);
      expect(DEFAULT_AGENT_RADIUS).toBeLessThanOrEqual(CROWD_MAX_AGENT_RADIUS);
    });
  });

  describe('ramp constraints', () => {
    it('defines max ramp elevation per cell', () => {
      expect(MAX_RAMP_ELEVATION_PER_CELL).toBeGreaterThan(0);
    });
  });

  describe('config objects', () => {
    describe('NAVMESH_CONFIG', () => {
      it('contains all required properties', () => {
        expect(NAVMESH_CONFIG).toHaveProperty('cs', NAVMESH_CELL_SIZE);
        expect(NAVMESH_CONFIG).toHaveProperty('ch', NAVMESH_CELL_HEIGHT);
        expect(NAVMESH_CONFIG).toHaveProperty('walkableSlopeAngle', WALKABLE_SLOPE_ANGLE);
        expect(NAVMESH_CONFIG).toHaveProperty('walkableHeight', WALKABLE_HEIGHT);
        expect(NAVMESH_CONFIG).toHaveProperty('walkableClimb', WALKABLE_CLIMB);
        expect(NAVMESH_CONFIG).toHaveProperty('walkableRadius', WALKABLE_RADIUS);
        expect(NAVMESH_CONFIG).toHaveProperty('maxSimplificationError', MAX_SIMPLIFICATION_ERROR);
        expect(NAVMESH_CONFIG).toHaveProperty('tileSize', TILE_SIZE);
        expect(NAVMESH_CONFIG).toHaveProperty('expectedLayersPerTile', EXPECTED_LAYERS_PER_TILE);
        expect(NAVMESH_CONFIG).toHaveProperty('maxObstacles', MAX_OBSTACLES);
      });
    });

    describe('SOLO_NAVMESH_CONFIG', () => {
      it('contains core navmesh properties', () => {
        expect(SOLO_NAVMESH_CONFIG).toHaveProperty('cs', NAVMESH_CELL_SIZE);
        expect(SOLO_NAVMESH_CONFIG).toHaveProperty('ch', NAVMESH_CELL_HEIGHT);
        expect(SOLO_NAVMESH_CONFIG).toHaveProperty('walkableSlopeAngle');
        expect(SOLO_NAVMESH_CONFIG).toHaveProperty('walkableHeight');
        expect(SOLO_NAVMESH_CONFIG).toHaveProperty('walkableClimb');
        expect(SOLO_NAVMESH_CONFIG).toHaveProperty('walkableRadius');
        expect(SOLO_NAVMESH_CONFIG).toHaveProperty('maxSimplificationError');
      });

      it('does not include tile-specific properties', () => {
        expect(SOLO_NAVMESH_CONFIG).not.toHaveProperty('tileSize');
        expect(SOLO_NAVMESH_CONFIG).not.toHaveProperty('maxObstacles');
      });
    });

    describe('CROWD_CONFIG', () => {
      it('contains crowd simulation properties', () => {
        expect(CROWD_CONFIG).toHaveProperty('maxAgents', CROWD_MAX_AGENTS);
        expect(CROWD_CONFIG).toHaveProperty('maxAgentRadius', CROWD_MAX_AGENT_RADIUS);
      });
    });
  });

  describe('elevationToHeight', () => {
    it('converts zero elevation to zero height', () => {
      expect(elevationToHeight(0)).toBe(0);
    });

    it('converts elevation using factor', () => {
      expect(elevationToHeight(100)).toBe(100 * ELEVATION_TO_HEIGHT_FACTOR);
    });

    it('converts max elevation (255)', () => {
      const result = elevationToHeight(255);
      expect(result).toBeGreaterThan(0);
      expect(result).toBe(255 * ELEVATION_TO_HEIGHT_FACTOR);
    });

    it('handles negative elevation', () => {
      expect(elevationToHeight(-10)).toBe(-10 * ELEVATION_TO_HEIGHT_FACTOR);
    });
  });

  describe('calculateMinRampLength', () => {
    it('returns 1 for zero elevation delta', () => {
      expect(calculateMinRampLength(0)).toBe(1);
    });

    it('returns 1 for small elevation delta', () => {
      const result = calculateMinRampLength(MAX_RAMP_ELEVATION_PER_CELL);
      expect(result).toBe(1);
    });

    it('requires longer ramp for larger deltas', () => {
      const delta = MAX_RAMP_ELEVATION_PER_CELL * 2;
      expect(calculateMinRampLength(delta)).toBe(2);
    });

    it('rounds up to ensure valid slope', () => {
      const delta = MAX_RAMP_ELEVATION_PER_CELL + 1;
      expect(calculateMinRampLength(delta)).toBe(2);
    });

    it('handles absolute value of negative delta', () => {
      const delta = -MAX_RAMP_ELEVATION_PER_CELL * 3;
      expect(calculateMinRampLength(delta)).toBe(3);
    });
  });

  describe('validateRampConstraints', () => {
    it('validates flat ramp (zero delta)', () => {
      const result = validateRampConstraints(100, 100, 5);
      expect(result.isValid).toBe(true);
      expect(result.minRequiredLength).toBe(1);
      expect(result.actualLength).toBe(5);
      expect(result.maxElevationPerCell).toBe(0);
      expect(result.warning).toBeUndefined();
    });

    it('validates gentle slope ramp', () => {
      const delta = Math.floor(MAX_RAMP_ELEVATION_PER_CELL / 2);
      const result = validateRampConstraints(100, 100 + delta, 1);
      expect(result.isValid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('validates max slope ramp', () => {
      const result = validateRampConstraints(100, 100 + MAX_RAMP_ELEVATION_PER_CELL, 1);
      expect(result.isValid).toBe(true);
    });

    it('invalidates too steep ramp', () => {
      const delta = MAX_RAMP_ELEVATION_PER_CELL * 2;
      const result = validateRampConstraints(100, 100 + delta, 1);
      expect(result.isValid).toBe(false);
      expect(result.minRequiredLength).toBe(2);
      expect(result.warning).toBeTruthy();
      expect(result.warning).toContain('too steep');
    });

    it('validates extended ramp with same delta', () => {
      const delta = MAX_RAMP_ELEVATION_PER_CELL * 2;
      const result = validateRampConstraints(100, 100 + delta, 2);
      expect(result.isValid).toBe(true);
    });

    it('calculates max elevation per cell', () => {
      const result = validateRampConstraints(0, 100, 5);
      expect(result.maxElevationPerCell).toBe(20); // 100 / 5
    });

    it('handles zero length gracefully', () => {
      const result = validateRampConstraints(0, 100, 0);
      expect(result.isValid).toBe(false);
      expect(result.maxElevationPerCell).toBe(100);
    });
  });

  describe('calculateExtendedRampEndpoint', () => {
    it('does not extend valid ramp', () => {
      const result = calculateExtendedRampEndpoint(0, 0, 5, 0, 100, 100);
      expect(result.wasExtended).toBe(false);
      expect(result.x).toBe(5);
      expect(result.y).toBe(0);
      expect(result.validation.isValid).toBe(true);
    });

    it('extends too-steep ramp', () => {
      const delta = MAX_RAMP_ELEVATION_PER_CELL * 3;
      const result = calculateExtendedRampEndpoint(0, 0, 1, 0, 100, 100 + delta);

      expect(result.wasExtended).toBe(true);
      expect(result.x).toBeGreaterThan(1);
      expect(result.validation.isValid).toBe(true);
    });

    it('preserves direction when extending', () => {
      const delta = MAX_RAMP_ELEVATION_PER_CELL * 2;
      const result = calculateExtendedRampEndpoint(0, 0, 1, 1, 100, 100 + delta);

      expect(result.wasExtended).toBe(true);
      // Direction should be maintained (45 degrees)
      expect(result.x).toBeCloseTo(result.y, 5);
    });

    it('handles zero-length ramp', () => {
      const result = calculateExtendedRampEndpoint(5, 5, 5, 5, 100, 200);
      expect(result.wasExtended).toBe(false);
      expect(result.x).toBe(5);
      expect(result.y).toBe(5);
    });

    it('returns validation info for extended ramp', () => {
      const delta = MAX_RAMP_ELEVATION_PER_CELL * 3;
      const result = calculateExtendedRampEndpoint(0, 0, 1, 0, 0, delta);

      expect(result.validation).toBeDefined();
      expect(result.validation.isValid).toBe(true);
      expect(result.validation.minRequiredLength).toBe(3);
    });

    it('handles negative direction', () => {
      const delta = MAX_RAMP_ELEVATION_PER_CELL * 2;
      const result = calculateExtendedRampEndpoint(10, 10, 9, 10, 0, delta);

      expect(result.wasExtended).toBe(true);
      expect(result.x).toBeLessThan(9);
    });

    it('handles diagonal extension', () => {
      const delta = MAX_RAMP_ELEVATION_PER_CELL * 4;
      const result = calculateExtendedRampEndpoint(0, 0, 1, 1, 0, delta);

      expect(result.wasExtended).toBe(true);
      // Diagonal: original length is sqrt(2), so extended proportionally
      const originalLength = Math.sqrt(2);
      const extendedLength = Math.sqrt(result.x * result.x + result.y * result.y);
      expect(extendedLength).toBeGreaterThan(originalLength);
    });
  });

  describe('config relationships', () => {
    it('cell height is finer than cell size', () => {
      expect(NAVMESH_CELL_HEIGHT).toBeLessThanOrEqual(NAVMESH_CELL_SIZE);
    });

    it('walkable height exceeds default agent size', () => {
      expect(WALKABLE_HEIGHT).toBeGreaterThan(DEFAULT_AGENT_RADIUS * 2);
    });

    it('simplification error is reasonable relative to cell size', () => {
      expect(MAX_SIMPLIFICATION_ERROR).toBeGreaterThanOrEqual(NAVMESH_CELL_SIZE);
    });

    it('crowd max agent radius exceeds default radius', () => {
      expect(CROWD_MAX_AGENT_RADIUS).toBeGreaterThanOrEqual(DEFAULT_AGENT_RADIUS);
    });
  });
});

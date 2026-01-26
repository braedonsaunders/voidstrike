import { describe, it, expect } from 'vitest';
import {
  // Individual constants
  SEPARATION_RADIUS,
  SEPARATION_STRENGTH_MOVING,
  SEPARATION_STRENGTH_IDLE,
  SEPARATION_STRENGTH_ARRIVING,
  SEPARATION_STRENGTH_COMBAT,
  MAX_AVOIDANCE_FORCE,
  COHESION_RADIUS,
  COHESION_STRENGTH,
  ALIGNMENT_RADIUS,
  ALIGNMENT_STRENGTH,
  ARRIVAL_SPREAD_RADIUS,
  ARRIVAL_SPREAD_STRENGTH,
  PATH_REQUEST_COOLDOWN_TICKS,
  USE_RECAST_CROWD,
  VELOCITY_SMOOTHING_FACTOR,
  VELOCITY_HISTORY_FRAMES,
  DIRECTION_COMMIT_THRESHOLD,
  DIRECTION_COMMIT_STRENGTH,
  PHYSICS_PUSH_RADIUS,
  PHYSICS_PUSH_STRENGTH,
  PHYSICS_PUSH_FALLOFF,
  PHYSICS_OVERLAP_PUSH,
  SEPARATION_THROTTLE_TICKS,
  COHESION_THROTTLE_TICKS,
  ALIGNMENT_THROTTLE_TICKS,
  PHYSICS_PUSH_THROTTLE_TICKS,
  COMBAT_SPREAD_SPEED_MULTIPLIER,
  FLYING_SEPARATION_MULTIPLIER,
  COMBAT_SEPARATION_THRESHOLD,
  ATTACK_STANDOFF_MULTIPLIER,
  TRULY_IDLE_THRESHOLD_TICKS,
  TRULY_IDLE_PROCESS_INTERVAL,
  IDLE_SEPARATION_THRESHOLD,
  IDLE_REPEL_SPEED_MULTIPLIER,
  FORMATION_BUFFER_SIZE,
  UNIT_TURN_RATE,
  MAGIC_BOX_MARGIN,
  // Grouped configs
  SEPARATION_CONFIG,
  COHESION_CONFIG,
  ALIGNMENT_CONFIG,
  VELOCITY_SMOOTHING_CONFIG,
  PHYSICS_PUSH_CONFIG,
  THROTTLE_CONFIG,
} from '@/data/movement.config';

describe('Movement Configuration', () => {
  describe('separation constants', () => {
    it('has positive separation radius', () => {
      expect(SEPARATION_RADIUS).toBeGreaterThan(0);
    });

    it('idle separation is stronger than moving', () => {
      expect(SEPARATION_STRENGTH_IDLE).toBeGreaterThan(SEPARATION_STRENGTH_MOVING);
    });

    it('arriving separation is strongest', () => {
      expect(SEPARATION_STRENGTH_ARRIVING).toBeGreaterThanOrEqual(SEPARATION_STRENGTH_IDLE);
      expect(SEPARATION_STRENGTH_ARRIVING).toBeGreaterThan(SEPARATION_STRENGTH_MOVING);
    });

    it('combat separation matches arriving', () => {
      expect(SEPARATION_STRENGTH_COMBAT).toBe(SEPARATION_STRENGTH_ARRIVING);
    });

    it('has positive max avoidance force', () => {
      expect(MAX_AVOIDANCE_FORCE).toBeGreaterThan(0);
    });
  });

  describe('cohesion constants', () => {
    it('has positive cohesion radius', () => {
      expect(COHESION_RADIUS).toBeGreaterThan(0);
    });

    it('cohesion strength is weak', () => {
      expect(COHESION_STRENGTH).toBeLessThan(1);
      expect(COHESION_STRENGTH).toBeGreaterThan(0);
    });
  });

  describe('alignment constants', () => {
    it('has positive alignment radius', () => {
      expect(ALIGNMENT_RADIUS).toBeGreaterThan(0);
    });

    it('alignment radius is smaller than cohesion', () => {
      expect(ALIGNMENT_RADIUS).toBeLessThan(COHESION_RADIUS);
    });

    it('alignment strength is moderate', () => {
      expect(ALIGNMENT_STRENGTH).toBeLessThan(1);
      expect(ALIGNMENT_STRENGTH).toBeGreaterThan(0);
    });
  });

  describe('arrival spreading constants', () => {
    it('has positive arrival spread radius', () => {
      expect(ARRIVAL_SPREAD_RADIUS).toBeGreaterThan(0);
    });

    it('has positive arrival spread strength', () => {
      expect(ARRIVAL_SPREAD_STRENGTH).toBeGreaterThan(0);
    });
  });

  describe('path request constants', () => {
    it('has positive cooldown', () => {
      expect(PATH_REQUEST_COOLDOWN_TICKS).toBeGreaterThan(0);
    });

    it('USE_RECAST_CROWD is boolean', () => {
      expect(typeof USE_RECAST_CROWD).toBe('boolean');
    });
  });

  describe('velocity smoothing constants', () => {
    it('smoothing factor is between 0 and 1', () => {
      expect(VELOCITY_SMOOTHING_FACTOR).toBeGreaterThanOrEqual(0);
      expect(VELOCITY_SMOOTHING_FACTOR).toBeLessThanOrEqual(1);
    });

    it('history frames is positive integer', () => {
      expect(VELOCITY_HISTORY_FRAMES).toBeGreaterThan(0);
      expect(Number.isInteger(VELOCITY_HISTORY_FRAMES)).toBe(true);
    });

    it('direction commit threshold is between 0 and 1', () => {
      expect(DIRECTION_COMMIT_THRESHOLD).toBeGreaterThanOrEqual(0);
      expect(DIRECTION_COMMIT_THRESHOLD).toBeLessThanOrEqual(1);
    });

    it('direction commit strength is between 0 and 1', () => {
      expect(DIRECTION_COMMIT_STRENGTH).toBeGreaterThanOrEqual(0);
      expect(DIRECTION_COMMIT_STRENGTH).toBeLessThanOrEqual(1);
    });
  });

  describe('physics push constants', () => {
    it('has positive push radius', () => {
      expect(PHYSICS_PUSH_RADIUS).toBeGreaterThan(0);
    });

    it('has positive push strength', () => {
      expect(PHYSICS_PUSH_STRENGTH).toBeGreaterThan(0);
    });

    it('has positive push falloff', () => {
      expect(PHYSICS_PUSH_FALLOFF).toBeGreaterThan(0);
    });

    it('overlap push is stronger than regular', () => {
      expect(PHYSICS_OVERLAP_PUSH).toBeGreaterThan(PHYSICS_PUSH_STRENGTH);
    });
  });

  describe('throttle constants', () => {
    it('all throttle values are positive', () => {
      expect(SEPARATION_THROTTLE_TICKS).toBeGreaterThan(0);
      expect(COHESION_THROTTLE_TICKS).toBeGreaterThan(0);
      expect(ALIGNMENT_THROTTLE_TICKS).toBeGreaterThan(0);
      expect(PHYSICS_PUSH_THROTTLE_TICKS).toBeGreaterThan(0);
    });

    it('separation updates more frequently than cohesion', () => {
      expect(SEPARATION_THROTTLE_TICKS).toBeLessThanOrEqual(COHESION_THROTTLE_TICKS);
    });

    it('physics push updates most frequently', () => {
      expect(PHYSICS_PUSH_THROTTLE_TICKS).toBeLessThanOrEqual(SEPARATION_THROTTLE_TICKS);
    });
  });

  describe('combat movement constants', () => {
    it('combat spread speed is reduced', () => {
      expect(COMBAT_SPREAD_SPEED_MULTIPLIER).toBeLessThan(1);
      expect(COMBAT_SPREAD_SPEED_MULTIPLIER).toBeGreaterThan(0);
    });

    it('flying units have stronger separation', () => {
      expect(FLYING_SEPARATION_MULTIPLIER).toBeGreaterThan(1);
    });

    it('combat separation threshold is small', () => {
      expect(COMBAT_SEPARATION_THRESHOLD).toBeLessThan(1);
    });

    it('attack standoff multiplier is less than 1', () => {
      expect(ATTACK_STANDOFF_MULTIPLIER).toBeLessThan(1);
      expect(ATTACK_STANDOFF_MULTIPLIER).toBeGreaterThan(0);
    });
  });

  describe('idle behavior constants', () => {
    it('truly idle threshold is positive', () => {
      expect(TRULY_IDLE_THRESHOLD_TICKS).toBeGreaterThan(0);
    });

    it('idle process interval is positive', () => {
      expect(TRULY_IDLE_PROCESS_INTERVAL).toBeGreaterThan(0);
    });

    it('idle separation threshold is positive', () => {
      expect(IDLE_SEPARATION_THRESHOLD).toBeGreaterThan(0);
    });

    it('idle repel speed is reduced', () => {
      expect(IDLE_REPEL_SPEED_MULTIPLIER).toBeLessThan(1);
      expect(IDLE_REPEL_SPEED_MULTIPLIER).toBeGreaterThan(0);
    });
  });

  describe('miscellaneous constants', () => {
    it('formation buffer size is positive power of 2', () => {
      expect(FORMATION_BUFFER_SIZE).toBeGreaterThan(0);
      expect(Math.log2(FORMATION_BUFFER_SIZE) % 1).toBe(0);
    });

    it('unit turn rate is positive', () => {
      expect(UNIT_TURN_RATE).toBeGreaterThan(0);
    });

    it('magic box margin is positive', () => {
      expect(MAGIC_BOX_MARGIN).toBeGreaterThan(0);
    });
  });

  describe('SEPARATION_CONFIG', () => {
    it('matches individual constants', () => {
      expect(SEPARATION_CONFIG.radius).toBe(SEPARATION_RADIUS);
      expect(SEPARATION_CONFIG.strengthMoving).toBe(SEPARATION_STRENGTH_MOVING);
      expect(SEPARATION_CONFIG.strengthIdle).toBe(SEPARATION_STRENGTH_IDLE);
      expect(SEPARATION_CONFIG.strengthArriving).toBe(SEPARATION_STRENGTH_ARRIVING);
      expect(SEPARATION_CONFIG.strengthCombat).toBe(SEPARATION_STRENGTH_COMBAT);
      expect(SEPARATION_CONFIG.maxForce).toBe(MAX_AVOIDANCE_FORCE);
    });

    it('has expected structure', () => {
      // 'as const' provides TypeScript-level immutability
      // Verify all expected keys exist
      expect(SEPARATION_CONFIG).toHaveProperty('radius');
      expect(SEPARATION_CONFIG).toHaveProperty('strengthMoving');
      expect(SEPARATION_CONFIG).toHaveProperty('strengthIdle');
      expect(SEPARATION_CONFIG).toHaveProperty('strengthArriving');
      expect(SEPARATION_CONFIG).toHaveProperty('strengthCombat');
      expect(SEPARATION_CONFIG).toHaveProperty('maxForce');
    });
  });

  describe('COHESION_CONFIG', () => {
    it('matches individual constants', () => {
      expect(COHESION_CONFIG.radius).toBe(COHESION_RADIUS);
      expect(COHESION_CONFIG.strength).toBe(COHESION_STRENGTH);
    });
  });

  describe('ALIGNMENT_CONFIG', () => {
    it('matches individual constants', () => {
      expect(ALIGNMENT_CONFIG.radius).toBe(ALIGNMENT_RADIUS);
      expect(ALIGNMENT_CONFIG.strength).toBe(ALIGNMENT_STRENGTH);
    });
  });

  describe('VELOCITY_SMOOTHING_CONFIG', () => {
    it('matches individual constants', () => {
      expect(VELOCITY_SMOOTHING_CONFIG.factor).toBe(VELOCITY_SMOOTHING_FACTOR);
      expect(VELOCITY_SMOOTHING_CONFIG.historyFrames).toBe(VELOCITY_HISTORY_FRAMES);
      expect(VELOCITY_SMOOTHING_CONFIG.directionCommitThreshold).toBe(DIRECTION_COMMIT_THRESHOLD);
      expect(VELOCITY_SMOOTHING_CONFIG.directionCommitStrength).toBe(DIRECTION_COMMIT_STRENGTH);
    });
  });

  describe('PHYSICS_PUSH_CONFIG', () => {
    it('matches individual constants', () => {
      expect(PHYSICS_PUSH_CONFIG.radius).toBe(PHYSICS_PUSH_RADIUS);
      expect(PHYSICS_PUSH_CONFIG.strength).toBe(PHYSICS_PUSH_STRENGTH);
      expect(PHYSICS_PUSH_CONFIG.falloff).toBe(PHYSICS_PUSH_FALLOFF);
      expect(PHYSICS_PUSH_CONFIG.overlapPush).toBe(PHYSICS_OVERLAP_PUSH);
    });
  });

  describe('THROTTLE_CONFIG', () => {
    it('matches individual constants', () => {
      expect(THROTTLE_CONFIG.separation).toBe(SEPARATION_THROTTLE_TICKS);
      expect(THROTTLE_CONFIG.cohesion).toBe(COHESION_THROTTLE_TICKS);
      expect(THROTTLE_CONFIG.alignment).toBe(ALIGNMENT_THROTTLE_TICKS);
      expect(THROTTLE_CONFIG.physicsPush).toBe(PHYSICS_PUSH_THROTTLE_TICKS);
    });
  });

  describe('balance relationships', () => {
    it('alignment radius is smaller for tighter group movement', () => {
      expect(ALIGNMENT_RADIUS).toBeLessThan(COHESION_RADIUS);
    });

    it('separation strength hierarchy is correct', () => {
      // Moving < Idle <= Combat/Arriving
      expect(SEPARATION_STRENGTH_MOVING).toBeLessThan(SEPARATION_STRENGTH_IDLE);
      expect(SEPARATION_STRENGTH_IDLE).toBeLessThanOrEqual(SEPARATION_STRENGTH_COMBAT);
    });

    it('physics overlap push resolves overlaps quickly', () => {
      expect(PHYSICS_OVERLAP_PUSH).toBeGreaterThan(PHYSICS_PUSH_STRENGTH * 2);
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  collisionConfig,
  SeparationConfig,
  PhysicsConfig,
  IdleConfig,
  CombatConfig,
  ArrivalConfig,
  DefaultsConfig,
  BuildingAvoidanceConfig,
  StuckConfig,
  CollisionConfig,
} from '@/data/collisionConfig';

describe('Collision Configuration', () => {
  describe('collisionConfig singleton', () => {
    it('provides getConfig method', () => {
      const config = collisionConfig.getConfig();
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });

    it('provides isLoaded method', () => {
      expect(typeof collisionConfig.isLoaded()).toBe('boolean');
    });
  });

  describe('default config structure', () => {
    let config: CollisionConfig;

    beforeEach(() => {
      config = collisionConfig.getConfig();
    });

    it('has separation config', () => {
      expect(config.separation).toBeDefined();
    });

    it('has physics config', () => {
      expect(config.physics).toBeDefined();
    });

    it('has idle config', () => {
      expect(config.idle).toBeDefined();
    });

    it('has combat config', () => {
      expect(config.combat).toBeDefined();
    });

    it('has arrival config', () => {
      expect(config.arrival).toBeDefined();
    });

    it('has defaults config', () => {
      expect(config.defaults).toBeDefined();
    });

    it('has buildingAvoidance config', () => {
      expect(config.buildingAvoidance).toBeDefined();
    });

    it('has stuck config', () => {
      expect(config.stuck).toBeDefined();
    });
  });

  describe('separation config', () => {
    let separation: SeparationConfig;

    beforeEach(() => {
      separation = collisionConfig.getConfig().separation;
    });

    it('defines multiplier', () => {
      expect(separation.multiplier).toBeGreaterThan(0);
    });

    it('defines query radius multiplier', () => {
      expect(separation.queryRadiusMultiplier).toBeGreaterThan(0);
    });

    it('defines strength for different states', () => {
      expect(separation.strengthMoving).toBeGreaterThan(0);
      expect(separation.strengthIdle).toBeGreaterThan(0);
      expect(separation.strengthArriving).toBeGreaterThan(0);
      expect(separation.strengthCombat).toBeGreaterThan(0);
    });

    it('idle strength is stronger than moving', () => {
      expect(separation.strengthIdle).toBeGreaterThan(separation.strengthMoving);
    });

    it('defines max force', () => {
      expect(separation.maxForce).toBeGreaterThan(0);
    });

    it('defines flying multiplier', () => {
      expect(separation.flyingMultiplier).toBeGreaterThan(0);
    });
  });

  describe('physics config', () => {
    let physics: PhysicsConfig;

    beforeEach(() => {
      physics = collisionConfig.getConfig().physics;
    });

    it('defines push radius', () => {
      expect(physics.pushRadius).toBeGreaterThan(0);
    });

    it('defines push strength', () => {
      expect(physics.pushStrength).toBeGreaterThan(0);
    });

    it('defines push falloff', () => {
      expect(physics.pushFalloff).toBeGreaterThan(0);
    });

    it('defines overlap push', () => {
      expect(physics.overlapPush).toBeGreaterThan(0);
    });

    it('overlap push is stronger than regular push', () => {
      expect(physics.overlapPush).toBeGreaterThan(physics.pushStrength);
    });
  });

  describe('idle config', () => {
    let idle: IdleConfig;

    beforeEach(() => {
      idle = collisionConfig.getConfig().idle;
    });

    it('defines separation threshold', () => {
      expect(idle.separationThreshold).toBeGreaterThan(0);
      expect(idle.separationThreshold).toBeLessThanOrEqual(1);
    });

    it('defines repel speed multiplier', () => {
      expect(idle.repelSpeedMultiplier).toBeGreaterThan(0);
    });

    it('defines settle threshold', () => {
      expect(idle.settleThreshold).toBeGreaterThan(0);
      expect(idle.settleThreshold).toBeLessThanOrEqual(1);
    });
  });

  describe('combat config', () => {
    let combat: CombatConfig;

    beforeEach(() => {
      combat = collisionConfig.getConfig().combat;
    });

    it('defines spread speed multiplier', () => {
      expect(combat.spreadSpeedMultiplier).toBeGreaterThan(0);
    });

    it('defines separation threshold', () => {
      expect(combat.separationThreshold).toBeGreaterThan(0);
      expect(combat.separationThreshold).toBeLessThanOrEqual(1);
    });
  });

  describe('arrival config', () => {
    let arrival: ArrivalConfig;

    beforeEach(() => {
      arrival = collisionConfig.getConfig().arrival;
    });

    it('defines spread radius', () => {
      expect(arrival.spreadRadius).toBeGreaterThan(0);
    });

    it('defines spread strength', () => {
      expect(arrival.spreadStrength).toBeGreaterThan(0);
    });
  });

  describe('defaults config', () => {
    let defaults: DefaultsConfig;

    beforeEach(() => {
      defaults = collisionConfig.getConfig().defaults;
    });

    it('defines ground unit radius', () => {
      expect(defaults.groundUnitRadius).toBeGreaterThan(0);
    });

    it('defines flying unit radius', () => {
      expect(defaults.flyingUnitRadius).toBeGreaterThan(0);
    });

    it('flying units are smaller for tighter formations', () => {
      expect(defaults.flyingUnitRadius).toBeLessThanOrEqual(defaults.groundUnitRadius);
    });
  });

  describe('building avoidance config', () => {
    let buildingAvoidance: BuildingAvoidanceConfig;

    beforeEach(() => {
      buildingAvoidance = collisionConfig.getConfig().buildingAvoidance;
    });

    it('defines avoidance strength', () => {
      expect(buildingAvoidance.strength).toBeGreaterThan(0);
    });

    it('defines hard margin', () => {
      expect(buildingAvoidance.hardMargin).toBeGreaterThanOrEqual(0);
    });

    it('defines soft margin', () => {
      expect(buildingAvoidance.softMargin).toBeGreaterThan(buildingAvoidance.hardMargin);
    });

    it('defines prediction lookahead', () => {
      expect(buildingAvoidance.predictionLookahead).toBeGreaterThan(0);
    });

    it('defines predictive strength multiplier', () => {
      expect(buildingAvoidance.predictiveStrengthMultiplier).toBeGreaterThan(0);
      expect(buildingAvoidance.predictiveStrengthMultiplier).toBeLessThanOrEqual(1);
    });
  });

  describe('stuck config', () => {
    let stuck: StuckConfig;

    beforeEach(() => {
      stuck = collisionConfig.getConfig().stuck;
    });

    it('defines detection frames', () => {
      expect(stuck.detectionFrames).toBeGreaterThan(0);
      expect(Number.isInteger(stuck.detectionFrames)).toBe(true);
    });

    it('defines velocity threshold', () => {
      expect(stuck.velocityThreshold).toBeGreaterThan(0);
    });

    it('defines nudge strength', () => {
      expect(stuck.nudgeStrength).toBeGreaterThan(0);
    });

    it('defines min distance to target', () => {
      expect(stuck.minDistanceToTarget).toBeGreaterThan(0);
    });

    it('defines tangential bias', () => {
      expect(stuck.tangentialBias).toBeGreaterThan(0);
      expect(stuck.tangentialBias).toBeLessThanOrEqual(1);
    });
  });

  describe('convenience accessors', () => {
    it('provides separation accessors', () => {
      expect(collisionConfig.separationMultiplier).toBeGreaterThan(0);
      expect(collisionConfig.separationQueryRadiusMultiplier).toBeGreaterThan(0);
      expect(collisionConfig.separationStrengthMoving).toBeGreaterThan(0);
      expect(collisionConfig.separationStrengthIdle).toBeGreaterThan(0);
      expect(collisionConfig.separationStrengthArriving).toBeGreaterThan(0);
      expect(collisionConfig.separationStrengthCombat).toBeGreaterThan(0);
      expect(collisionConfig.separationMaxForce).toBeGreaterThan(0);
      expect(collisionConfig.flyingSeparationMultiplier).toBeGreaterThan(0);
    });

    it('provides physics accessors', () => {
      expect(collisionConfig.physicsPushRadius).toBeGreaterThan(0);
      expect(collisionConfig.physicsPushStrength).toBeGreaterThan(0);
      expect(collisionConfig.physicsPushFalloff).toBeGreaterThan(0);
      expect(collisionConfig.physicsOverlapPush).toBeGreaterThan(0);
    });

    it('provides idle accessors', () => {
      expect(collisionConfig.idleSeparationThreshold).toBeGreaterThan(0);
      expect(collisionConfig.idleRepelSpeedMultiplier).toBeGreaterThan(0);
      expect(collisionConfig.idleSettleThreshold).toBeGreaterThan(0);
    });

    it('provides combat accessors', () => {
      expect(collisionConfig.combatSpreadSpeedMultiplier).toBeGreaterThan(0);
      expect(collisionConfig.combatSeparationThreshold).toBeGreaterThan(0);
    });

    it('provides arrival accessors', () => {
      expect(collisionConfig.arrivalSpreadRadius).toBeGreaterThan(0);
      expect(collisionConfig.arrivalSpreadStrength).toBeGreaterThan(0);
    });

    it('provides defaults accessors', () => {
      expect(collisionConfig.defaultGroundUnitRadius).toBeGreaterThan(0);
      expect(collisionConfig.defaultFlyingUnitRadius).toBeGreaterThan(0);
    });

    it('provides building avoidance accessors', () => {
      expect(collisionConfig.buildingAvoidanceStrength).toBeGreaterThan(0);
      expect(collisionConfig.buildingAvoidanceHardMargin).toBeGreaterThanOrEqual(0);
      expect(collisionConfig.buildingAvoidanceSoftMargin).toBeGreaterThan(0);
      expect(collisionConfig.buildingAvoidancePredictionLookahead).toBeGreaterThan(0);
      expect(collisionConfig.buildingAvoidancePredictiveStrengthMultiplier).toBeGreaterThan(0);
    });

    it('provides stuck detection accessors', () => {
      expect(collisionConfig.stuckDetectionFrames).toBeGreaterThan(0);
      expect(collisionConfig.stuckVelocityThreshold).toBeGreaterThan(0);
      expect(collisionConfig.stuckNudgeStrength).toBeGreaterThan(0);
      expect(collisionConfig.stuckMinDistanceToTarget).toBeGreaterThan(0);
      expect(collisionConfig.stuckTangentialBias).toBeGreaterThan(0);
    });

    it('accessors match config values', () => {
      const config = collisionConfig.getConfig();
      expect(collisionConfig.separationMultiplier).toBe(config.separation.multiplier);
      expect(collisionConfig.physicsPushRadius).toBe(config.physics.pushRadius);
      expect(collisionConfig.idleSeparationThreshold).toBe(config.idle.separationThreshold);
      expect(collisionConfig.combatSpreadSpeedMultiplier).toBe(config.combat.spreadSpeedMultiplier);
      expect(collisionConfig.arrivalSpreadRadius).toBe(config.arrival.spreadRadius);
      expect(collisionConfig.defaultGroundUnitRadius).toBe(config.defaults.groundUnitRadius);
      expect(collisionConfig.buildingAvoidanceStrength).toBe(config.buildingAvoidance.strength);
      expect(collisionConfig.stuckDetectionFrames).toBe(config.stuck.detectionFrames);
    });
  });

  describe('config value relationships', () => {
    it('idle separation is stricter than combat', () => {
      const config = collisionConfig.getConfig();
      expect(config.idle.separationThreshold).toBeGreaterThan(config.combat.separationThreshold);
    });

    it('arriving strength is strongest', () => {
      const config = collisionConfig.getConfig();
      expect(config.separation.strengthArriving).toBeGreaterThanOrEqual(config.separation.strengthIdle);
      expect(config.separation.strengthArriving).toBeGreaterThan(config.separation.strengthMoving);
      expect(config.separation.strengthArriving).toBeGreaterThan(config.separation.strengthCombat);
    });

    it('soft margin is larger than hard margin for buildings', () => {
      const config = collisionConfig.getConfig();
      expect(config.buildingAvoidance.softMargin).toBeGreaterThan(config.buildingAvoidance.hardMargin);
    });

    it('building avoidance is strong compared to separation', () => {
      const config = collisionConfig.getConfig();
      expect(config.buildingAvoidance.strength).toBeGreaterThan(config.separation.maxForce);
    });
  });
});

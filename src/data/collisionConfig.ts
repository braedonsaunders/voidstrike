/**
 * Collision Configuration Loader
 *
 * Loads collision and separation configuration from public/config/collision.config.json.
 * This makes the unit separation system fully data-driven - modify JSON to tune
 * how units space themselves without touching code.
 */

import { debugInitialization } from '@/utils/debugLogger';

// ============================================================================
// COLLISION CONFIG TYPES
// ============================================================================

export interface SeparationConfig {
  multiplier: number;
  queryRadiusMultiplier: number;
  strengthMoving: number;
  strengthIdle: number;
  strengthArriving: number;
  strengthCombat: number;
  maxForce: number;
  flyingMultiplier: number;
}

export interface PhysicsConfig {
  pushRadius: number;
  pushStrength: number;
  pushFalloff: number;
  overlapPush: number;
}

export interface IdleConfig {
  separationThreshold: number;
  repelSpeedMultiplier: number;
  settleThreshold: number;
}

export interface CombatConfig {
  spreadSpeedMultiplier: number;
  separationThreshold: number;
}

export interface ArrivalConfig {
  spreadRadius: number;
  spreadStrength: number;
}

export interface DefaultsConfig {
  groundUnitRadius: number;
  flyingUnitRadius: number;
}

export interface BuildingAvoidanceConfig {
  strength: number;
  hardMargin: number;
  softMargin: number;
  predictionLookahead: number;
  predictiveStrengthMultiplier: number;
}

export interface StuckConfig {
  detectionFrames: number;
  velocityThreshold: number;
  nudgeStrength: number;
  minDistanceToTarget: number;
  tangentialBias: number;
}

export interface CollisionConfig {
  separation: SeparationConfig;
  physics: PhysicsConfig;
  idle: IdleConfig;
  combat: CombatConfig;
  arrival: ArrivalConfig;
  defaults: DefaultsConfig;
  buildingAvoidance: BuildingAvoidanceConfig;
  stuck: StuckConfig;
}

// ============================================================================
// DEFAULT VALUES (used if config fails to load)
// ============================================================================

const DEFAULT_CONFIG: CollisionConfig = {
  separation: {
    multiplier: 1.0,
    queryRadiusMultiplier: 2.0,
    strengthMoving: 0.15,
    strengthIdle: 1.2,
    strengthArriving: 1.2,
    strengthCombat: 0.3,
    maxForce: 2.0,
    flyingMultiplier: 1.2,
  },
  physics: {
    pushRadius: 0.8,
    pushStrength: 1.5,
    pushFalloff: 0.8,
    overlapPush: 3.0,
  },
  idle: {
    separationThreshold: 0.5,
    repelSpeedMultiplier: 0.12,
    settleThreshold: 0.85,
  },
  combat: {
    spreadSpeedMultiplier: 0.25,
    separationThreshold: 0.3,
  },
  arrival: {
    spreadRadius: 3.0,
    spreadStrength: 1.2,
  },
  defaults: {
    groundUnitRadius: 0.5,
    flyingUnitRadius: 0.4,
  },
  buildingAvoidance: {
    strength: 3.0,
    hardMargin: 0.3,
    softMargin: 1.0,
    predictionLookahead: 0.3,
    predictiveStrengthMultiplier: 0.2,
  },
  stuck: {
    detectionFrames: 30,
    velocityThreshold: 0.05,
    nudgeStrength: 1.5,
    minDistanceToTarget: 1.5,
    tangentialBias: 0.5,
  },
};

// ============================================================================
// SINGLETON CONFIG LOADER
// ============================================================================

class CollisionConfigLoader {
  private config: CollisionConfig | null = null;
  private loadPromise: Promise<void> | null = null;

  /**
   * Load collision configuration
   * Safe to call multiple times - will only load once
   */
  public async load(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    try {
      const response = await fetch('/config/collision.config.json');
      if (!response.ok) {
        debugInitialization.warn('[CollisionConfig] Failed to load collision.config.json, using defaults');
        this.config = DEFAULT_CONFIG;
        return;
      }

      const json = await response.json();
      this.config = {
        separation: { ...DEFAULT_CONFIG.separation, ...json.separation },
        physics: { ...DEFAULT_CONFIG.physics, ...json.physics },
        idle: { ...DEFAULT_CONFIG.idle, ...json.idle },
        combat: { ...DEFAULT_CONFIG.combat, ...json.combat },
        arrival: { ...DEFAULT_CONFIG.arrival, ...json.arrival },
        defaults: { ...DEFAULT_CONFIG.defaults, ...json.defaults },
        buildingAvoidance: { ...DEFAULT_CONFIG.buildingAvoidance, ...json.buildingAvoidance },
        stuck: { ...DEFAULT_CONFIG.stuck, ...json.stuck },
      };
      debugInitialization.log('[CollisionConfig] Loaded collision configuration');
    } catch (error) {
      debugInitialization.warn('[CollisionConfig] Error loading collision.config.json:', error);
      this.config = DEFAULT_CONFIG;
    }
  }

  /**
   * Get the loaded config. Returns defaults if not yet loaded.
   */
  public getConfig(): CollisionConfig {
    return this.config ?? DEFAULT_CONFIG;
  }

  /**
   * Check if config has been loaded
   */
  public isLoaded(): boolean {
    return this.config !== null;
  }

  // ============================================================================
  // CONVENIENCE ACCESSORS
  // ============================================================================

  // Separation
  public get separationMultiplier(): number {
    return this.getConfig().separation.multiplier;
  }

  public get separationQueryRadiusMultiplier(): number {
    return this.getConfig().separation.queryRadiusMultiplier;
  }

  public get separationStrengthMoving(): number {
    return this.getConfig().separation.strengthMoving;
  }

  public get separationStrengthIdle(): number {
    return this.getConfig().separation.strengthIdle;
  }

  public get separationStrengthArriving(): number {
    return this.getConfig().separation.strengthArriving;
  }

  public get separationStrengthCombat(): number {
    return this.getConfig().separation.strengthCombat;
  }

  public get separationMaxForce(): number {
    return this.getConfig().separation.maxForce;
  }

  public get flyingSeparationMultiplier(): number {
    return this.getConfig().separation.flyingMultiplier;
  }

  // Physics
  public get physicsPushRadius(): number {
    return this.getConfig().physics.pushRadius;
  }

  public get physicsPushStrength(): number {
    return this.getConfig().physics.pushStrength;
  }

  public get physicsPushFalloff(): number {
    return this.getConfig().physics.pushFalloff;
  }

  public get physicsOverlapPush(): number {
    return this.getConfig().physics.overlapPush;
  }

  // Idle
  public get idleSeparationThreshold(): number {
    return this.getConfig().idle.separationThreshold;
  }

  public get idleRepelSpeedMultiplier(): number {
    return this.getConfig().idle.repelSpeedMultiplier;
  }

  public get idleSettleThreshold(): number {
    return this.getConfig().idle.settleThreshold;
  }

  // Combat
  public get combatSpreadSpeedMultiplier(): number {
    return this.getConfig().combat.spreadSpeedMultiplier;
  }

  public get combatSeparationThreshold(): number {
    return this.getConfig().combat.separationThreshold;
  }

  // Arrival
  public get arrivalSpreadRadius(): number {
    return this.getConfig().arrival.spreadRadius;
  }

  public get arrivalSpreadStrength(): number {
    return this.getConfig().arrival.spreadStrength;
  }

  // Defaults
  public get defaultGroundUnitRadius(): number {
    return this.getConfig().defaults.groundUnitRadius;
  }

  public get defaultFlyingUnitRadius(): number {
    return this.getConfig().defaults.flyingUnitRadius;
  }

  // Building Avoidance
  public get buildingAvoidanceStrength(): number {
    return this.getConfig().buildingAvoidance.strength;
  }

  public get buildingAvoidanceHardMargin(): number {
    return this.getConfig().buildingAvoidance.hardMargin;
  }

  public get buildingAvoidanceSoftMargin(): number {
    return this.getConfig().buildingAvoidance.softMargin;
  }

  public get buildingAvoidancePredictionLookahead(): number {
    return this.getConfig().buildingAvoidance.predictionLookahead;
  }

  public get buildingAvoidancePredictiveStrengthMultiplier(): number {
    return this.getConfig().buildingAvoidance.predictiveStrengthMultiplier;
  }

  // Stuck Detection
  public get stuckDetectionFrames(): number {
    return this.getConfig().stuck.detectionFrames;
  }

  public get stuckVelocityThreshold(): number {
    return this.getConfig().stuck.velocityThreshold;
  }

  public get stuckNudgeStrength(): number {
    return this.getConfig().stuck.nudgeStrength;
  }

  public get stuckMinDistanceToTarget(): number {
    return this.getConfig().stuck.minDistanceToTarget;
  }

  public get stuckTangentialBias(): number {
    return this.getConfig().stuck.tangentialBias;
  }
}

// Export singleton instance
export const collisionConfig = new CollisionConfigLoader();

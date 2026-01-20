/**
 * Collision Configuration Loader
 *
 * Loads collision and separation configuration from public/config/collision.config.json.
 * This makes the unit separation system fully data-driven - modify JSON to tune
 * how units space themselves without touching code.
 */

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

export interface CollisionConfig {
  separation: SeparationConfig;
  physics: PhysicsConfig;
  idle: IdleConfig;
  combat: CombatConfig;
  arrival: ArrivalConfig;
  defaults: DefaultsConfig;
}

// ============================================================================
// DEFAULT VALUES (used if config fails to load)
// ============================================================================

const DEFAULT_CONFIG: CollisionConfig = {
  separation: {
    multiplier: 1.15,
    queryRadiusMultiplier: 2.5,
    strengthMoving: 0.5,
    strengthIdle: 6.0,
    strengthArriving: 8.0,
    strengthCombat: 8.0,
    maxForce: 10.0,
    flyingMultiplier: 1.5,
  },
  physics: {
    pushRadius: 1.2,
    pushStrength: 6.0,
    pushFalloff: 0.6,
    overlapPush: 15.0,
  },
  idle: {
    separationThreshold: 0.25,
    repelSpeedMultiplier: 0.3,
  },
  combat: {
    spreadSpeedMultiplier: 0.5,
    separationThreshold: 0.1,
  },
  arrival: {
    spreadRadius: 5.0,
    spreadStrength: 2.0,
  },
  defaults: {
    groundUnitRadius: 0.5,
    flyingUnitRadius: 0.4,
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
        console.warn('[CollisionConfig] Failed to load collision.config.json, using defaults');
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
      };
      console.log('[CollisionConfig] Loaded collision configuration');
    } catch (error) {
      console.warn('[CollisionConfig] Error loading collision.config.json:', error);
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
}

// Export singleton instance
export const collisionConfig = new CollisionConfigLoader();

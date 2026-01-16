/**
 * VehicleEffectsSystem - World-Class Continuous Vehicle Effects
 *
 * A performant system for adding continuous visual effects to vehicles:
 * - Engine exhaust/fire for capital ships
 * - Smoke trails for aerial units
 * - Dust clouds behind wheeled/tracked vehicles
 * - Thruster effects for flying units
 *
 * Features:
 * - Configuration-driven via assets.json
 * - State-aware (moving, idle, attacking)
 * - LOD-aware (reduce/skip effects for distant units)
 * - Pool-based emission (zero allocations via AdvancedParticleSystem)
 * - Attachment point support for precise effect positioning
 */

import * as THREE from 'three';
import { Game } from '@/engine/core/Game';
import { Unit } from '@/engine/components/Unit';
import { Transform } from '@/engine/components/Transform';
import { AdvancedParticleSystem, ParticleType, ParticleConfig } from './AdvancedParticleSystem';
import {
  AssetManager,
  VehicleEffectCondition,
  VehicleEffectType,
  VehicleEffectDefinition,
  UnitEffectsConfig,
} from '@/assets/AssetManager';

// ============================================
// EFFECT TYPE TO PARTICLE MAPPING
// ============================================

interface EffectPreset {
  particleType: ParticleType;
  direction: THREE.Vector3;  // Base emission direction (local space)
  spread: number;            // Random spread factor
  configOverrides?: Partial<ParticleConfig>;
}

const EFFECT_PRESETS: Record<VehicleEffectType, EffectPreset> = {
  engine_exhaust: {
    particleType: ParticleType.FIRE,
    direction: new THREE.Vector3(0, 0, -1), // Backward
    spread: 0.3,
    configOverrides: {
      lifetime: [0.2, 0.5],
      speed: [1, 3],
      size: [0.3, 0.8],
      emissive: 0.95,
    },
  },
  thruster: {
    particleType: ParticleType.ENERGY,
    direction: new THREE.Vector3(0, -1, 0), // Downward
    spread: 0.2,
    configOverrides: {
      lifetime: [0.1, 0.3],
      speed: [2, 5],
      size: [0.2, 0.5],
      colorStart: new THREE.Color(0.4, 0.7, 1.0),
      colorEnd: new THREE.Color(0.2, 0.4, 0.8),
      emissive: 1.0,
    },
  },
  smoke_trail: {
    particleType: ParticleType.SMOKE,
    direction: new THREE.Vector3(0, 0.2, -1), // Backward and slightly up
    spread: 0.4,
    configOverrides: {
      lifetime: [0.8, 2.0],
      speed: [0.3, 1.0],
      size: [0.5, 1.5],
      gravity: 0.5,
    },
  },
  dust_cloud: {
    particleType: ParticleType.DUST,
    direction: new THREE.Vector3(0, 0.3, -1), // Backward and up
    spread: 0.6,
    configOverrides: {
      lifetime: [0.6, 1.2],
      speed: [1, 3],
      size: [0.8, 2.0],
      colorStart: new THREE.Color(0.55, 0.5, 0.4),
      colorEnd: new THREE.Color(0.4, 0.38, 0.32),
    },
  },
  afterburner: {
    particleType: ParticleType.FIRE,
    direction: new THREE.Vector3(0, 0, -1), // Backward
    spread: 0.2,
    configOverrides: {
      lifetime: [0.1, 0.3],
      speed: [3, 8],
      size: [0.4, 1.0],
      colorStart: new THREE.Color(0.8, 0.9, 1.0), // Hot blue-white
      colorEnd: new THREE.Color(1.0, 0.6, 0.2),   // Orange
      emissive: 1.0,
    },
  },
  hover_dust: {
    particleType: ParticleType.DUST,
    direction: new THREE.Vector3(0, 0.1, 0), // Slightly up, outward handled by spread
    spread: 1.0,
    configOverrides: {
      lifetime: [0.4, 0.8],
      speed: [1, 2],
      size: [0.3, 0.8],
    },
  },
  sparks: {
    particleType: ParticleType.SPARK,
    direction: new THREE.Vector3(0, 0.5, -0.5),
    spread: 0.8,
    configOverrides: {
      lifetime: [0.1, 0.3],
      speed: [2, 5],
      size: [0.05, 0.15],
    },
  },
};

// ============================================
// LOD CONFIGURATION
// ============================================

interface LODConfig {
  maxEffectDistance: number;     // Beyond this, no effects
  reducedEffectDistance: number; // Beyond this, reduce emit rate
  reducedEmitScale: number;      // Emit rate multiplier at reduced distance
}

const LOD_CONFIG: LODConfig = {
  maxEffectDistance: 120,
  reducedEffectDistance: 60,
  reducedEmitScale: 0.3,
};

// ============================================
// VEHICLE EFFECTS SYSTEM
// ============================================

interface TrackedUnit {
  entityId: number;
  unitType: string;
  effects: VehicleEffectDefinition[];
  lastEmitTime: Map<string, number>; // Effect name -> last emit time
  wasMoving: boolean;
  wasAttacking: boolean;
}

export class VehicleEffectsSystem {
  private game: Game;
  private particleSystem: AdvancedParticleSystem;
  private assetManager: typeof AssetManager;
  private camera: THREE.Camera | null = null;

  // Tracked units with effects
  private trackedUnits: Map<number, TrackedUnit> = new Map();

  // Event unsubscribe functions
  private unsubscribeFns: Array<() => void> = [];

  // Terrain height function
  private getTerrainHeight: ((x: number, z: number) => number) | null = null;

  // Reusable vectors for performance
  private readonly _worldPos = new THREE.Vector3();
  private readonly _attachPos = new THREE.Vector3();
  private readonly _emitDir = new THREE.Vector3();
  private readonly _rotationMatrix = new THREE.Matrix4();
  private readonly _tempQuat = new THREE.Quaternion();

  // Performance tracking
  private lastUpdateTime = 0;
  private updateInterval = 1000 / 60; // 60 updates per second max

  constructor(
    game: Game,
    particleSystem: AdvancedParticleSystem,
    assetManager: typeof AssetManager
  ) {
    console.log('[VehicleEffects] Constructor called, checking unitEffectsConfigs...');
    // Check effect config state on construction
    const testConfig = assetManager.getUnitEffects('dreadnought');
    console.log('[VehicleEffects] Initial dreadnought config test:', testConfig);

    this.game = game;
    this.particleSystem = particleSystem;
    this.assetManager = assetManager;

    // Listen for unit spawn/death to track units with effects
    this.unsubscribeFns.push(
      this.game.eventBus.on<{ entityId: number; unitType: string }>('unit:spawned', this.onUnitSpawned.bind(this))
    );
    this.unsubscribeFns.push(
      this.game.eventBus.on<{ entityId: number }>('unit:died', this.onUnitDied.bind(this))
    );

    // Initialize existing units
    this.initializeExistingUnits();
  }

  /**
   * Set camera for LOD distance calculations
   */
  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /**
   * Set terrain height function for ground effects
   */
  public setTerrainHeightFunction(fn: (x: number, z: number) => number): void {
    this.getTerrainHeight = fn;
  }

  /**
   * Initialize tracking for units that already exist
   */
  private initializeExistingUnits(): void {
    const entities = this.game.world.getEntitiesWith('Unit', 'Transform');
    for (const entity of entities) {
      const unit = entity.get<Unit>('Unit');
      if (unit) {
        this.tryTrackUnit(entity.id, unit.unitId);
      }
    }
  }

  /**
   * Handle unit spawn event
   */
  private onUnitSpawned(data: { entityId: number; unitType: string }): void {
    console.log('[VehicleEffects] unit:spawned event received:', data);
    this.tryTrackUnit(data.entityId, data.unitType);
  }

  /**
   * Handle unit death event
   */
  private onUnitDied(data: { entityId: number }): void {
    this.trackedUnits.delete(data.entityId);
  }

  /**
   * Try to track a unit if it has effect definitions
   */
  private tryTrackUnit(entityId: number, unitType: string): void {
    const effectsConfig = this.assetManager.getUnitEffects(unitType);

    console.log(`[VehicleEffects] tryTrackUnit: ${unitType} (entity ${entityId})`, effectsConfig);

    if (!effectsConfig || !effectsConfig.effects) {
      return; // No effects defined for this unit type
    }

    const effects = Object.values(effectsConfig.effects);
    if (effects.length === 0) {
      return;
    }

    console.log(`[VehicleEffects] Tracking ${unitType} with ${effects.length} effects`);

    this.trackedUnits.set(entityId, {
      entityId,
      unitType,
      effects,
      lastEmitTime: new Map(),
      wasMoving: false,
      wasAttacking: false,
    });
  }

  /**
   * Main update loop - called from render loop
   */
  public update(deltaTime: number): void {
    const now = performance.now();

    // Throttle updates for performance
    if (now - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = now;

    if (!this.camera) {
      // Log once every 5 seconds
      if (Math.floor(now / 5000) !== Math.floor(this.lastUpdateTime / 5000)) {
        console.log('[VehicleEffects] No camera set');
      }
      return;
    }

    if (this.trackedUnits.size === 0) {
      return;
    }

    const cameraPos = this.camera.position;

    // Process each tracked unit
    for (const [entityId, tracked] of this.trackedUnits) {
      const entity = this.game.world.getEntity(entityId);
      if (!entity) {
        this.trackedUnits.delete(entityId);
        continue;
      }

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');

      if (!unit || !transform || unit.state === 'dead') {
        continue;
      }

      // Get world position
      this._worldPos.set(transform.x, 0, transform.y);

      // Add height for flying units - check if unit has explicit airborneHeight in config
      // Only apply airborne height if the unit is actually a flying unit
      const airborneHeight = unit.isFlying ? this.assetManager.getAirborneHeight(tracked.unitType) : 0;
      if (airborneHeight > 0) {
        const terrainY = this.getTerrainHeight?.(transform.x, transform.y) ?? 0;
        this._worldPos.y = terrainY + airborneHeight;
      } else if (this.getTerrainHeight) {
        this._worldPos.y = this.getTerrainHeight(transform.x, transform.y);
      }

      // LOD check - skip if too far
      const distToCamera = this._worldPos.distanceTo(cameraPos);
      if (distToCamera > LOD_CONFIG.maxEffectDistance) {
        continue;
      }

      // Calculate LOD emit scale
      let lodScale = 1.0;
      if (distToCamera > LOD_CONFIG.reducedEffectDistance) {
        const t = (distToCamera - LOD_CONFIG.reducedEffectDistance) /
                  (LOD_CONFIG.maxEffectDistance - LOD_CONFIG.reducedEffectDistance);
        lodScale = THREE.MathUtils.lerp(1.0, LOD_CONFIG.reducedEmitScale, t);
      }

      // Determine unit state
      const isMoving = unit.state === 'moving' || unit.state === 'patrolling';
      const isAttacking = unit.state === 'attacking';
      const isFlying = unit.isFlying ?? false;
      const isIdle = unit.state === 'idle';

      // Calculate rotation matrix for transforming local directions
      this._tempQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), transform.rotation);
      this._rotationMatrix.makeRotationFromQuaternion(this._tempQuat);

      // Process each effect
      for (const effect of tracked.effects) {
        // Check conditions
        if (!this.checkConditions(effect.conditions, isMoving, isIdle, isAttacking, isFlying)) {
          continue;
        }

        // Calculate effective emit rate
        let emitRate = effect.emitRate * lodScale;

        // Scale with speed if configured
        if (effect.speedScale && isMoving) {
          const speed = unit.speed ?? 1;
          const baseSpeed = 3.5; // Typical unit speed
          emitRate *= Math.min(speed / baseSpeed, 2.0);
        }

        // Get time since last emit for this effect
        const effectKey = `${effect.type}_${tracked.effects.indexOf(effect)}`;
        const lastEmit = tracked.lastEmitTime.get(effectKey) ?? 0;
        const timeSinceEmit = (now - lastEmit) / 1000;
        const emitInterval = 1 / emitRate;

        if (timeSinceEmit < emitInterval) {
          continue;
        }

        // Emit particles for each attachment point
        this.emitFromAttachments(
          effect,
          tracked.unitType,
          transform,
          this._worldPos,
          unit
        );

        tracked.lastEmitTime.set(effectKey, now);
      }

      // Update state tracking
      tracked.wasMoving = isMoving;
      tracked.wasAttacking = isAttacking;
    }
  }

  /**
   * Check if effect conditions are met
   */
  private checkConditions(
    conditions: VehicleEffectCondition[],
    isMoving: boolean,
    isIdle: boolean,
    isAttacking: boolean,
    isFlying: boolean
  ): boolean {
    for (const condition of conditions) {
      switch (condition) {
        case 'always':
          return true;
        case 'moving':
          if (isMoving) return true;
          break;
        case 'idle':
          if (isIdle) return true;
          break;
        case 'attacking':
          if (isAttacking) return true;
          break;
        case 'flying':
          if (isFlying) return true;
          break;
      }
    }
    return false;
  }

  /**
   * Emit particles from all attachment points
   */
  private emitFromAttachments(
    effect: VehicleEffectDefinition,
    unitType: string,
    transform: Transform,
    worldPos: THREE.Vector3,
    unit: Unit
  ): void {
    const preset = EFFECT_PRESETS[effect.type];
    if (!preset) return;

    // Get unit scale for attachment positioning
    const scale = this.assetManager.getUnitScale(unitType) ?? 1;

    for (const attachment of effect.attachments) {
      // Calculate attachment position in world space
      this._attachPos.set(
        attachment.x * scale,
        attachment.y * scale,
        attachment.z * scale
      );

      // Rotate by unit rotation
      this._attachPos.applyMatrix4(this._rotationMatrix);

      // Add world position
      this._attachPos.add(worldPos);

      // Calculate emission direction in world space
      this._emitDir.copy(preset.direction);
      this._emitDir.applyMatrix4(this._rotationMatrix);

      // Add random spread
      this._emitDir.x += (Math.random() - 0.5) * preset.spread;
      this._emitDir.y += (Math.random() - 0.5) * preset.spread;
      this._emitDir.z += (Math.random() - 0.5) * preset.spread;
      this._emitDir.normalize();

      // Merge config overrides
      const attachmentScale = attachment.scale ?? 1;
      const configOverrides = {
        ...preset.configOverrides,
      };

      // Apply attachment scale to size
      if (configOverrides.size) {
        configOverrides.size = [
          configOverrides.size[0] * attachmentScale,
          configOverrides.size[1] * attachmentScale,
        ];
      }

      // Emit particles
      // Emit particles
      this.particleSystem.emit(
        this._attachPos,
        this._emitDir,
        1, // Emit 1 particle per attachment per emit cycle
        preset.particleType,
        configOverrides
      );
    }

    // Log occasionally (not every frame to avoid spam)
    if (Math.random() < 0.01) {
      console.log(`[VehicleEffects] Emitting ${effect.type} for ${unitType} at`, worldPos.toArray());
    }
  }

  /**
   * Force refresh all tracked units (call after asset config reload)
   */
  public refreshTrackedUnits(): void {
    this.trackedUnits.clear();
    this.initializeExistingUnits();
  }

  /**
   * Get debug stats
   */
  public getDebugStats(): { trackedUnits: number; effectTypes: string[] } {
    const effectTypes = new Set<string>();
    for (const tracked of this.trackedUnits.values()) {
      for (const effect of tracked.effects) {
        effectTypes.add(effect.type);
      }
    }
    return {
      trackedUnits: this.trackedUnits.size,
      effectTypes: Array.from(effectTypes),
    };
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.trackedUnits.clear();
    // Unsubscribe from all events
    for (const unsubscribe of this.unsubscribeFns) {
      unsubscribe();
    }
    this.unsubscribeFns = [];
  }
}

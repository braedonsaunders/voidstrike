/* eslint-disable react/no-direct-mutation-state -- this.state is game state (UnitState), not React state */
/**
 * Unit Core
 *
 * Base class for Unit component with core movement and identity properties.
 * This class is extended by mixins to create the full Unit class.
 */

import { Component } from '../../ecs/Component';
import { AssetManager } from '@/assets/AssetManager';
import { collisionConfig } from '@/data/collisionConfig';
import type { UnitDefinition, UnitState, MovementDomain } from './types';

/**
 * Core unit class with fundamental properties
 */
export class UnitCore extends Component {
  public readonly type = 'Unit';

  // Identity
  public unitId: string;
  public name: string;
  public faction: string;
  public state: UnitState;

  // Movement
  public speed: number;
  public maxSpeed: number;
  public currentSpeed: number;
  public acceleration: number;
  public deceleration: number;
  public targetX: number | null;
  public targetY: number | null;
  public path: Array<{ x: number; y: number }>;
  public pathIndex: number;

  // Collision
  public collisionRadius: number;

  // Domain
  public movementDomain: MovementDomain;
  public isNaval: boolean;

  // Flags
  public isFlying: boolean;
  public isHoldingPosition: boolean;
  public isBiological: boolean;
  public isMechanical: boolean;

  // RTS-STYLE: Flag set by CombatSystem when friendly allies are fighting nearby
  // Used by FlockingBehavior to reduce separation and enable cohesion toward battle
  public isNearFriendlyCombat: boolean = false;

  // Vision
  public sightRange: number;

  constructor(definition: UnitDefinition) {
    super();

    // Identity
    this.unitId = definition.id;
    this.name = definition.name;
    this.faction = definition.faction;
    this.state = 'idle';

    // Movement
    this.speed = definition.speed;
    this.maxSpeed = definition.speed;
    this.currentSpeed = 0; // Start at 0, accelerate to max
    // RTS-style acceleration: ground units have instant (1000), air units have gradual (1-5)
    // Default to 15 for backwards compatibility, but new units should specify explicitly
    this.acceleration = definition.acceleration ?? 15;
    // Deceleration is typically 2x acceleration for snappy stops
    this.deceleration = definition.deceleration ?? this.acceleration * 2;
    this.targetX = null;
    this.targetY = null;
    this.path = [];
    this.pathIndex = 0;

    // Flags
    this.isFlying = definition.isFlying ?? false;
    this.isHoldingPosition = false;
    this.isBiological = definition.isBiological ?? !definition.isMechanical;
    this.isMechanical = definition.isMechanical ?? false;

    // Movement domain - air units use 'air', naval use 'water', otherwise 'ground'
    this.isNaval = definition.isNaval ?? false;
    if (definition.movementDomain) {
      this.movementDomain = definition.movementDomain;
    } else if (definition.isFlying) {
      this.movementDomain = 'air';
    } else if (this.isNaval) {
      this.movementDomain = 'water';
    } else {
      this.movementDomain = 'ground';
    }

    // Collision radius from assets.json, fallback to config defaults
    const assetCollisionRadius = AssetManager.getCollisionRadius(definition.id);
    if (assetCollisionRadius !== null) {
      this.collisionRadius = assetCollisionRadius;
    } else {
      // Fallback to defaults from collision.config.json
      this.collisionRadius = definition.isFlying
        ? collisionConfig.defaultFlyingUnitRadius
        : collisionConfig.defaultGroundUnitRadius;
    }

    // Vision
    this.sightRange = definition.sightRange;
  }

  /**
   * Set move target for this unit
   */
  public setMoveTarget(x: number, y: number, preserveState: boolean = false): void {
    this.targetX = x;
    this.targetY = y;
    if (!preserveState) {
      this.state = 'moving';
    }
    // Clear attack target - must be set by subclass
    // RTS-style: Regular move clears assault mode - must be handled by subclass
  }

  /**
   * Move to position while preserving current state (for gathering, etc.)
   */
  public moveToPosition(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    // Clear any existing path so the new target takes effect
    // MovementSystem will request a new path if needed
    this.path = [];
    this.pathIndex = 0;
    // Don't change state - used for gathering movement
  }

  /**
   * Set path for pathfinding
   */
  public setPath(path: Array<{ x: number; y: number }>): void {
    this.path = path;
    this.pathIndex = 0;
  }

  /**
   * Clear all movement targets
   */
  public clearTarget(): void {
    this.targetX = null;
    this.targetY = null;
    this.path = [];
    this.pathIndex = 0;
    this.state = 'idle';
    this.currentSpeed = 0; // Reset speed when stopping
  }

  /**
   * Stop the unit completely
   */
  public stop(): void {
    this.clearTarget();
    this.isHoldingPosition = false;
    this.currentSpeed = 0;
    // Additional cleanup handled by subclass
  }
}

import { Component } from '../ecs/Component';

export type UnitState = 'idle' | 'moving' | 'attacking' | 'gathering' | 'building' | 'dead' | 'patrolling';
export type DamageType = 'normal' | 'explosive' | 'concussive' | 'psionic';

export interface UnitDefinition {
  id: string;
  name: string;
  faction: string;
  mineralCost: number;
  vespeneCost: number;
  buildTime: number; // seconds
  supplyCost: number;
  speed: number;
  sightRange: number;
  attackRange: number;
  attackDamage: number;
  attackSpeed: number; // attacks per second
  damageType: DamageType;
  maxHealth: number;
  armor: number;
  abilities?: string[];
  isWorker?: boolean;
  isFlying?: boolean;
  acceleration?: number; // units per second squared
  splashRadius?: number; // AoE splash damage radius
}

// Command queue entry for shift-click queuing
export interface QueuedCommand {
  type: 'move' | 'attack' | 'attackmove' | 'patrol' | 'gather';
  targetX?: number;
  targetY?: number;
  targetEntityId?: number;
}

export class Unit extends Component {
  public readonly type = 'Unit';

  public unitId: string;
  public name: string;
  public faction: string;
  public state: UnitState;

  // Movement
  public speed: number;
  public maxSpeed: number; // Maximum speed (same as speed)
  public currentSpeed: number; // Current speed for acceleration
  public acceleration: number; // Acceleration rate
  public targetX: number | null;
  public targetY: number | null;
  public path: Array<{ x: number; y: number }>;
  public pathIndex: number;

  // Command queue for shift-click
  public commandQueue: QueuedCommand[];

  // Patrol
  public patrolPoints: Array<{ x: number; y: number }>;
  public patrolIndex: number;

  // Combat
  public attackRange: number;
  public attackDamage: number;
  public attackSpeed: number;
  public damageType: DamageType;
  public lastAttackTime: number;
  public targetEntityId: number | null;
  public splashRadius: number; // AoE damage radius (0 = no splash)

  // Vision
  public sightRange: number;

  // Worker
  public isWorker: boolean;
  public carryingMinerals: number;
  public carryingVespene: number;
  public gatherTargetId: number | null;

  // Flags
  public isFlying: boolean;
  public isHoldingPosition: boolean;

  // Collision radius for avoidance
  public collisionRadius: number;

  constructor(definition: UnitDefinition) {
    super();
    this.unitId = definition.id;
    this.name = definition.name;
    this.faction = definition.faction;
    this.state = 'idle';

    this.speed = definition.speed;
    this.maxSpeed = definition.speed;
    this.currentSpeed = 0; // Start at 0, accelerate to max
    this.acceleration = definition.acceleration ?? 15; // Default acceleration
    this.targetX = null;
    this.targetY = null;
    this.path = [];
    this.pathIndex = 0;

    // Command queue
    this.commandQueue = [];

    // Patrol
    this.patrolPoints = [];
    this.patrolIndex = 0;

    this.attackRange = definition.attackRange;
    this.attackDamage = definition.attackDamage;
    this.attackSpeed = definition.attackSpeed;
    this.damageType = definition.damageType;
    this.lastAttackTime = 0;
    this.targetEntityId = null;
    this.splashRadius = definition.splashRadius ?? 0;

    this.sightRange = definition.sightRange;

    this.isWorker = definition.isWorker ?? false;
    this.carryingMinerals = 0;
    this.carryingVespene = 0;
    this.gatherTargetId = null;

    this.isFlying = definition.isFlying ?? false;
    this.isHoldingPosition = false;

    // Collision radius based on unit type
    this.collisionRadius = definition.isFlying ? 0.3 : 0.5;
  }

  public setMoveTarget(x: number, y: number, preserveState: boolean = false): void {
    this.targetX = x;
    this.targetY = y;
    if (!preserveState) {
      this.state = 'moving';
    }
    this.targetEntityId = null;
  }

  // Move to position while preserving current state (for gathering, etc.)
  public moveToPosition(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    // Don't change state - used for gathering movement
  }

  public setAttackTarget(entityId: number): void {
    this.targetEntityId = entityId;
    this.state = 'attacking';
    this.targetX = null;
    this.targetY = null;
  }

  public setPath(path: Array<{ x: number; y: number }>): void {
    this.path = path;
    this.pathIndex = 0;
  }

  public clearTarget(): void {
    this.targetX = null;
    this.targetY = null;
    this.targetEntityId = null;
    this.path = [];
    this.pathIndex = 0;
    this.state = 'idle';
    this.currentSpeed = 0; // Reset speed when stopping
  }

  public stop(): void {
    this.clearTarget();
    this.commandQueue = []; // Clear command queue
    this.patrolPoints = [];
    this.isHoldingPosition = false;
    this.currentSpeed = 0;
  }

  public holdPosition(): void {
    this.clearTarget();
    this.commandQueue = [];
    this.patrolPoints = [];
    this.isHoldingPosition = true;
    this.currentSpeed = 0;
  }

  public canAttack(gameTime: number): boolean {
    const timeSinceLastAttack = gameTime - this.lastAttackTime;
    return timeSinceLastAttack >= 1 / this.attackSpeed;
  }

  // Queue a command (for shift-click)
  public queueCommand(command: QueuedCommand): void {
    this.commandQueue.push(command);
  }

  // Execute next queued command
  public executeNextCommand(): boolean {
    if (this.commandQueue.length === 0) {
      return false;
    }

    const command = this.commandQueue.shift()!;

    switch (command.type) {
      case 'move':
        if (command.targetX !== undefined && command.targetY !== undefined) {
          this.setMoveTarget(command.targetX, command.targetY);
        }
        break;
      case 'attack':
        if (command.targetEntityId !== undefined) {
          this.setAttackTarget(command.targetEntityId);
        }
        break;
      case 'attackmove':
        if (command.targetX !== undefined && command.targetY !== undefined) {
          this.setMoveTarget(command.targetX, command.targetY);
          // Attack-move state will be handled by combat system
        }
        break;
      case 'patrol':
        if (command.targetX !== undefined && command.targetY !== undefined) {
          this.addPatrolPoint(command.targetX, command.targetY);
        }
        break;
    }

    return true;
  }

  // Set patrol between current position and target
  public setPatrol(startX: number, startY: number, endX: number, endY: number): void {
    this.patrolPoints = [
      { x: startX, y: startY },
      { x: endX, y: endY },
    ];
    this.patrolIndex = 1; // Start moving to second point
    this.state = 'patrolling';
    this.targetX = endX;
    this.targetY = endY;
    this.commandQueue = [];
  }

  // Add a patrol point
  public addPatrolPoint(x: number, y: number): void {
    this.patrolPoints.push({ x, y });
    if (this.state !== 'patrolling') {
      this.state = 'patrolling';
      this.patrolIndex = 0;
      const point = this.patrolPoints[0];
      this.targetX = point.x;
      this.targetY = point.y;
    }
  }

  // Advance to next patrol point
  public nextPatrolPoint(): void {
    if (this.patrolPoints.length === 0) {
      this.state = 'idle';
      return;
    }

    this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length;
    const point = this.patrolPoints[this.patrolIndex];
    this.targetX = point.x;
    this.targetY = point.y;
  }

  // Check if unit has queued commands
  public hasQueuedCommands(): boolean {
    return this.commandQueue.length > 0;
  }
}

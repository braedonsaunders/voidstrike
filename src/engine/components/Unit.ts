import { Component } from '../ecs/Component';

export type UnitState = 'idle' | 'moving' | 'attacking' | 'gathering' | 'building' | 'dead';
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
}

export class Unit extends Component {
  public readonly type = 'Unit';

  public unitId: string;
  public name: string;
  public faction: string;
  public state: UnitState;

  // Movement
  public speed: number;
  public targetX: number | null;
  public targetY: number | null;
  public path: Array<{ x: number; y: number }>;
  public pathIndex: number;

  // Combat
  public attackRange: number;
  public attackDamage: number;
  public attackSpeed: number;
  public damageType: DamageType;
  public lastAttackTime: number;
  public targetEntityId: number | null;

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

  constructor(definition: UnitDefinition) {
    super();
    this.unitId = definition.id;
    this.name = definition.name;
    this.faction = definition.faction;
    this.state = 'idle';

    this.speed = definition.speed;
    this.targetX = null;
    this.targetY = null;
    this.path = [];
    this.pathIndex = 0;

    this.attackRange = definition.attackRange;
    this.attackDamage = definition.attackDamage;
    this.attackSpeed = definition.attackSpeed;
    this.damageType = definition.damageType;
    this.lastAttackTime = 0;
    this.targetEntityId = null;

    this.sightRange = definition.sightRange;

    this.isWorker = definition.isWorker ?? false;
    this.carryingMinerals = 0;
    this.carryingVespene = 0;
    this.gatherTargetId = null;

    this.isFlying = definition.isFlying ?? false;
    this.isHoldingPosition = false;
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
  }

  public stop(): void {
    this.clearTarget();
    this.isHoldingPosition = false;
  }

  public holdPosition(): void {
    this.clearTarget();
    this.isHoldingPosition = true;
  }

  public canAttack(gameTime: number): boolean {
    const timeSinceLastAttack = gameTime - this.lastAttackTime;
    return timeSinceLastAttack >= 1 / this.attackSpeed;
  }
}

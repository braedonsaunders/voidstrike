/**
 * Command Queue Mixin
 *
 * Provides command queuing, patrol, and assault mode functionality.
 */

import type { Constructor, QueuedCommand, UnitDefinition, UnitState } from './types';

/**
 * Interface for command queue-related properties
 */
export interface CommandQueueFields {
  commandQueue: QueuedCommand[];
  patrolPoints: Array<{ x: number; y: number }>;
  patrolIndex: number;
  assaultDestination: { x: number; y: number } | null;
  isInAssaultMode: boolean;
  assaultIdleTicks: number;
}

/**
 * Interface for base class requirements.
 * Properties from CombatMixin (targetEntityId) are optional since that mixin
 * is applied after this one in the composition chain.
 */
export interface CommandQueueBase {
  state: UnitState;
  targetX: number | null;
  targetY: number | null;
  targetEntityId?: number | null;
  path: Array<{ x: number; y: number }>;
  pathIndex: number;
  gatherTargetId?: number | null;
  carryingMinerals?: number;
  carryingVespene?: number;
  isHelperWorker?: boolean;
  constructingBuildingId?: number | null;
  buildTargetX?: number | null;
  buildTargetY?: number | null;
  buildingType?: string | null;
  setMoveTarget?(x: number, y: number): void;
  setAttackTarget?(entityId: number): void;
  setAttackMoveTarget?(x: number, y: number): void;
  setGatherTarget?(targetEntityId: number): void;
}

/**
 * Mixin that adds command queue functionality to a unit
 */
export function CommandQueueMixin<TBase extends Constructor<CommandQueueBase>>(Base: TBase) {
  return class WithCommandQueue extends Base implements CommandQueueFields {
    public commandQueue: QueuedCommand[] = [];
    public patrolPoints: Array<{ x: number; y: number }> = [];
    public patrolIndex: number = 0;
    public assaultDestination: { x: number; y: number } | null = null;
    public isInAssaultMode: boolean = false;
    public assaultIdleTicks: number = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Queue a command (for shift-click)
     */
    public queueCommand(command: QueuedCommand): void {
      this.commandQueue.push(command);
    }

    /**
     * Execute next queued command
     * @returns true if a command was executed
     */
    public executeNextCommand(): boolean {
      if (this.commandQueue.length === 0) {
        return false;
      }

      const command = this.commandQueue.shift()!;

      switch (command.type) {
        case 'move':
          if (command.targetX !== undefined && command.targetY !== undefined) {
            if (this.setMoveTarget) {
              this.setMoveTarget(command.targetX, command.targetY);
            } else {
              this.targetX = command.targetX;
              this.targetY = command.targetY;
              this.state = 'moving';
              if (this.targetEntityId !== undefined) {
                this.targetEntityId = null;
              }
            }
          }
          break;
        case 'attack':
          if (command.targetEntityId !== undefined) {
            if (this.setAttackTarget) {
              this.setAttackTarget(command.targetEntityId);
            } else {
              if (this.targetEntityId !== undefined) {
                this.targetEntityId = command.targetEntityId;
              }
              this.state = 'attacking';
              this.targetX = null;
              this.targetY = null;
            }
          }
          break;
        case 'attackmove':
          if (command.targetX !== undefined && command.targetY !== undefined) {
            if (this.setAttackMoveTarget) {
              this.setAttackMoveTarget(command.targetX, command.targetY);
            } else {
              this.targetX = command.targetX;
              this.targetY = command.targetY;
              this.state = 'attackmoving';
              if (this.targetEntityId !== undefined) {
                this.targetEntityId = null;
              }
              this.assaultDestination = { x: command.targetX, y: command.targetY };
              this.isInAssaultMode = true;
              this.assaultIdleTicks = 0;
            }
          }
          break;
        case 'patrol':
          if (command.targetX !== undefined && command.targetY !== undefined) {
            this.addPatrolPoint(command.targetX, command.targetY);
          }
          break;
        case 'gather':
          if (command.targetEntityId !== undefined) {
            if (this.setGatherTarget) {
              this.setGatherTarget(command.targetEntityId);
            } else if (this.gatherTargetId !== undefined) {
              this.gatherTargetId = command.targetEntityId;
              this.state = 'gathering';
            }
          }
          break;
        case 'build':
          if (
            command.buildingEntityId !== undefined &&
            command.targetX !== undefined &&
            command.targetY !== undefined
          ) {
            // Resume construction on an existing blueprint
            if (this.constructingBuildingId !== undefined) {
              this.constructingBuildingId = command.buildingEntityId;
            }
            if (this.buildTargetX !== undefined) {
              this.buildTargetX = command.targetX;
            }
            if (this.buildTargetY !== undefined) {
              this.buildTargetY = command.targetY;
            }
            if (this.buildingType !== undefined) {
              this.buildingType = command.buildingType ?? null;
            }
            this.state = 'building';
            this.targetX = command.targetX;
            this.targetY = command.targetY;
            this.path = [];
            this.pathIndex = 0;
            if (this.gatherTargetId !== undefined) {
              this.gatherTargetId = null;
            }
            if (this.carryingMinerals !== undefined) {
              this.carryingMinerals = 0;
            }
            if (this.carryingVespene !== undefined) {
              this.carryingVespene = 0;
            }
            if (this.isHelperWorker !== undefined) {
              this.isHelperWorker = false; // Queued builds are intentional, not auto-help
            }
          }
          break;
      }

      return true;
    }

    /**
     * Check if unit has queued commands
     */
    public hasQueuedCommands(): boolean {
      return this.commandQueue.length > 0;
    }

    /**
     * Set patrol between current position and target
     */
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

    /**
     * Add a patrol point
     */
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

    /**
     * Advance to next patrol point
     */
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

    /**
     * Initialize command queue fields from definition (called by composed class)
     */
    protected initializeCommandQueueFields(_definition: UnitDefinition): void {
      this.commandQueue = [];
      this.patrolPoints = [];
      this.patrolIndex = 0;
      this.assaultDestination = null;
      this.isInAssaultMode = false;
      this.assaultIdleTicks = 0;
    }
  };
}

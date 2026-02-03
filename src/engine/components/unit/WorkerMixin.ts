/**
 * Worker Mixin
 *
 * Provides resource gathering and construction capabilities for worker units.
 */

import type { Constructor, UnitDefinition, UnitState } from './types';

/**
 * Interface for worker-related properties
 */
export interface WorkerFields {
  isWorker: boolean;
  carryingMinerals: number;
  carryingPlasma: number;
  gatherTargetId: number | null;
  miningTimer: number;
  isMining: boolean;
  constructingBuildingId: number | null;
  buildTargetX: number | null;
  buildTargetY: number | null;
  buildingType: string | null;
  isHelperWorker: boolean;
  returnPositionX: number | null;
  returnPositionY: number | null;
  previousGatherTargetId: number | null;
  wallLineId: number | null;
  wallLineSegments: number[];
}

/**
 * Interface for base class requirements
 */
export interface WorkerBase {
  state: UnitState;
  targetX: number | null;
  targetY: number | null;
  path: Array<{ x: number; y: number }>;
  pathIndex: number;
}

/**
 * Mixin that adds worker functionality to a unit
 */
export function WorkerMixin<TBase extends Constructor<WorkerBase>>(Base: TBase) {
  return class WithWorker extends Base implements WorkerFields {
    public isWorker: boolean = false;
    public carryingMinerals: number = 0;
    public carryingPlasma: number = 0;
    public gatherTargetId: number | null = null;
    public miningTimer: number = 0;
    public isMining: boolean = false;
    public constructingBuildingId: number | null = null;
    public buildTargetX: number | null = null;
    public buildTargetY: number | null = null;
    public buildingType: string | null = null;
    public isHelperWorker: boolean = false;
    public returnPositionX: number | null = null;
    public returnPositionY: number | null = null;
    public previousGatherTargetId: number | null = null;
    public wallLineId: number | null = null;
    public wallLineSegments: number[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Set gather target for workers
     */
    public setGatherTarget(targetEntityId: number): void {
      if (!this.isWorker) return;
      this.gatherTargetId = targetEntityId;
      this.state = 'gathering';
      // Movement will be handled by ResourceSystem
    }

    /**
     * Start building - worker moves to location then constructs
     */
    public startBuilding(buildingType: string, targetX: number, targetY: number): void {
      if (!this.isWorker) return;
      this.buildingType = buildingType;
      this.buildTargetX = targetX;
      this.buildTargetY = targetY;
      this.constructingBuildingId = null; // Will be set when building is placed
      this.state = 'building';
      this.targetX = targetX;
      this.targetY = targetY;
      // Clear any existing path so worker will request new path to construction site
      this.path = [];
      this.pathIndex = 0;
      this.gatherTargetId = null;
      this.carryingMinerals = 0;
      this.carryingPlasma = 0;
    }

    /**
     * Assign this worker to an existing construction site
     */
    public assignToConstruction(buildingEntityId: number): void {
      if (!this.isWorker) return;
      this.constructingBuildingId = buildingEntityId;
      this.state = 'building';
    }

    /**
     * Cancel construction task
     */
    public cancelBuilding(): void {
      this.constructingBuildingId = null;
      this.buildTargetX = null;
      this.buildTargetY = null;
      this.buildingType = null;
      this.wallLineId = null;
      this.wallLineSegments = [];
      this.state = 'idle';
      this.targetX = null;
      this.targetY = null;
      this.isHelperWorker = false;
      this.returnPositionX = null;
      this.returnPositionY = null;
      this.previousGatherTargetId = null;
    }

    /**
     * Check if worker is actively constructing (near building site)
     */
    public isActivelyConstructing(): boolean {
      return this.state === 'building' && this.constructingBuildingId !== null;
    }

    /**
     * Initialize worker fields from definition (called by composed class)
     */
    protected initializeWorkerFields(definition: UnitDefinition): void {
      this.isWorker = definition.isWorker ?? false;
      this.carryingMinerals = 0;
      this.carryingPlasma = 0;
      this.gatherTargetId = null;
      this.miningTimer = 0;
      this.isMining = false;
      this.constructingBuildingId = null;
      this.buildTargetX = null;
      this.buildTargetY = null;
      this.buildingType = null;
      this.isHelperWorker = false;
      this.returnPositionX = null;
      this.returnPositionY = null;
      this.previousGatherTargetId = null;
      this.wallLineId = null;
      this.wallLineSegments = [];
    }
  };
}

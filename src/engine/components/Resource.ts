import { Component } from '../ecs/Component';

export type ResourceType = 'minerals' | 'vespene';

export class Resource extends Component {
  public readonly type = 'Resource';

  public resourceType: ResourceType;
  public amount: number;
  public maxAmount: number;
  public gatherRate: number; // Amount per gather action
  public gatherTime: number; // Seconds per gather action
  public currentGatherers: Set<number>; // Entity IDs of workers currently gathering
  public maxGatherers: number;

  // For vespene: the refinery entity ID (null if no refinery built)
  public refineryEntityId: number | null = null;
  // Callback to check if refinery is complete (set by game systems)
  private _refineryCompleteChecker: ((entityId: number) => boolean) | null = null;

  constructor(
    resourceType: ResourceType,
    amount: number,
    maxGatherers = 2,
    gatherRate = 5,
    gatherTime = 2
  ) {
    super();
    this.resourceType = resourceType;
    this.amount = amount;
    this.maxAmount = amount;
    this.gatherRate = gatherRate;
    this.gatherTime = gatherTime;
    this.currentGatherers = new Set();
    this.maxGatherers = maxGatherers;
  }

  /**
   * Set a function to check if the refinery building is complete.
   * This allows the Resource component to verify refinery status without
   * importing Game/World (avoiding circular dependencies).
   */
  public setRefineryCompleteChecker(checker: (entityId: number) => boolean): void {
    this._refineryCompleteChecker = checker;
  }

  public canGather(): boolean {
    // Vespene requires a completed refinery
    if (this.resourceType === 'vespene') {
      if (this.refineryEntityId === null) return false;
      // Check if refinery is complete
      if (this._refineryCompleteChecker && !this._refineryCompleteChecker(this.refineryEntityId)) {
        return false;
      }
    }
    return this.amount > 0 && this.currentGatherers.size < this.maxGatherers;
  }

  public hasRefinery(): boolean {
    if (this.refineryEntityId === null) return false;
    // Also check if complete
    if (this._refineryCompleteChecker) {
      return this._refineryCompleteChecker(this.refineryEntityId);
    }
    return true; // Fallback if no checker set
  }

  public addGatherer(entityId: number): boolean {
    if (!this.canGather()) return false;
    this.currentGatherers.add(entityId);
    return true;
  }

  public removeGatherer(entityId: number): void {
    this.currentGatherers.delete(entityId);
  }

  public gather(): number {
    const gathered = Math.min(this.gatherRate, this.amount);
    this.amount -= gathered;
    return gathered;
  }

  public isDepleted(): boolean {
    return this.amount <= 0;
  }

  public getPercentRemaining(): number {
    return this.amount / this.maxAmount;
  }
}

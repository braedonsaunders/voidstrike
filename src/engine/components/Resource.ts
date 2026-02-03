import { Component } from '../ecs/Component';

export type ResourceType = 'minerals' | 'plasma';

// Optimal worker counts per resource
// Minerals: 2 workers per patch is optimal, 3 is max (diminishing returns)
// Plasma: 3 workers per geyser is optimal and max
export const OPTIMAL_WORKERS_PER_MINERAL = 2;
export const MAX_WORKERS_PER_MINERAL = 3;
export const OPTIMAL_WORKERS_PER_PLASMA = 3;
export const MAX_WORKERS_PER_PLASMA = 3;

export class Resource extends Component {
  public readonly type = 'Resource';

  public resourceType: ResourceType;
  public amount: number;
  public maxAmount: number;
  public gatherRate: number; // Amount per gather action
  public gatherTime: number; // Seconds per gather action
  public currentGatherers: Set<number>; // Entity IDs of workers currently gathering
  public maxGatherers: number;

  // For plasma: the extractor entity ID (null if no extractor built)
  public extractorEntityId: number | null = null;
  // Callback to check if extractor is complete (set by game systems)
  private _extractorCompleteChecker: ((entityId: number) => boolean) | null = null;

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
   * Set a function to check if the extractor building is complete.
   * This allows the Resource component to verify extractor status without
   * importing Game/World (avoiding circular dependencies).
   */
  public setExtractorCompleteChecker(checker: (entityId: number) => boolean): void {
    this._extractorCompleteChecker = checker;
  }

  public canGather(): boolean {
    // Plasma requires a completed extractor
    if (this.resourceType === 'plasma') {
      if (this.extractorEntityId === null) return false;
      // Check if extractor is complete
      if (this._extractorCompleteChecker && !this._extractorCompleteChecker(this.extractorEntityId)) {
        return false;
      }
    }
    return this.amount > 0 && this.currentGatherers.size < this.maxGatherers;
  }

  public hasExtractor(): boolean {
    if (this.extractorEntityId === null) return false;
    // Also check if complete
    if (this._extractorCompleteChecker) {
      return this._extractorCompleteChecker(this.extractorEntityId);
    }
    return true; // Fallback if no checker set
  }

  // Backwards compatibility alias
  public hasRefinery(): boolean {
    return this.hasExtractor();
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

  public getCurrentGatherers(): number {
    return this.currentGatherers.size;
  }

  /**
   * Get the optimal number of workers for this resource type.
   * Optimal means maximum efficiency without diminishing returns.
   */
  public getOptimalWorkers(): number {
    return this.resourceType === 'minerals'
      ? OPTIMAL_WORKERS_PER_MINERAL
      : OPTIMAL_WORKERS_PER_PLASMA;
  }

  /**
   * Get the maximum useful workers for this resource type.
   * Beyond this, additional workers provide no benefit.
   */
  public getMaxUsefulWorkers(): number {
    return this.resourceType === 'minerals'
      ? MAX_WORKERS_PER_MINERAL
      : MAX_WORKERS_PER_PLASMA;
  }

  /**
   * Check if this resource is at optimal saturation.
   */
  public isOptimallySaturated(): boolean {
    return this.currentGatherers.size >= this.getOptimalWorkers();
  }

  /**
   * Check if this resource is oversaturated (more workers than useful).
   */
  public isOversaturated(): boolean {
    return this.currentGatherers.size > this.getMaxUsefulWorkers();
  }
}

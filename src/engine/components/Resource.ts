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

  // For vespene: the extractor entity ID (null if no extractor built)
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
    // Vespene requires a completed extractor
    if (this.resourceType === 'vespene') {
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
}

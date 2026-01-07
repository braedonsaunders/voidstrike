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

  public canGather(): boolean {
    // Vespene requires a refinery to be built
    if (this.resourceType === 'vespene' && this.refineryEntityId === null) {
      return false;
    }
    return this.amount > 0 && this.currentGatherers.size < this.maxGatherers;
  }

  public hasRefinery(): boolean {
    return this.refineryEntityId !== null;
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

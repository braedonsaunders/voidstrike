import { Component } from '../ecs/Component';

export type BuildingState = 'constructing' | 'complete' | 'destroyed';

export interface BuildingDefinition {
  id: string;
  name: string;
  faction: string;
  mineralCost: number;
  vespeneCost: number;
  buildTime: number; // seconds
  width: number; // grid cells
  height: number;
  maxHealth: number;
  armor: number;
  sightRange: number;
  supplyProvided?: number;
  canProduce?: string[]; // unit IDs
  canResearch?: string[]; // upgrade IDs
  requirements?: string[]; // building IDs required
}

export interface ProductionQueueItem {
  type: 'unit' | 'upgrade';
  id: string;
  progress: number;
  buildTime: number;
}

export class Building extends Component {
  public readonly type = 'Building';

  public buildingId: string;
  public name: string;
  public faction: string;
  public state: BuildingState;

  // Construction
  public buildProgress: number; // 0-1
  public buildTime: number;

  // Size
  public width: number;
  public height: number;

  // Production
  public canProduce: string[];
  public canResearch: string[];
  public productionQueue: ProductionQueueItem[];
  public rallyX: number | null;
  public rallyY: number | null;
  public rallyTargetId: number | null;

  // Resources
  public supplyProvided: number;

  // Vision
  public sightRange: number;

  constructor(definition: BuildingDefinition) {
    super();
    this.buildingId = definition.id;
    this.name = definition.name;
    this.faction = definition.faction;
    this.state = 'constructing';

    this.buildProgress = 0;
    this.buildTime = definition.buildTime;

    this.width = definition.width;
    this.height = definition.height;

    this.canProduce = definition.canProduce ?? [];
    this.canResearch = definition.canResearch ?? [];
    this.productionQueue = [];
    this.rallyX = null;
    this.rallyY = null;
    this.rallyTargetId = null;

    this.supplyProvided = definition.supplyProvided ?? 0;
    this.sightRange = definition.sightRange;
  }

  public updateConstruction(deltaTime: number): boolean {
    if (this.state !== 'constructing') return false;

    this.buildProgress += deltaTime / this.buildTime;

    if (this.buildProgress >= 1) {
      this.buildProgress = 1;
      this.state = 'complete';
      return true; // Construction complete
    }

    return false;
  }

  public isComplete(): boolean {
    return this.state === 'complete';
  }

  public addToProductionQueue(type: 'unit' | 'upgrade', id: string, buildTime: number): void {
    this.productionQueue.push({
      type,
      id,
      progress: 0,
      buildTime,
    });
  }

  public updateProduction(deltaTime: number): ProductionQueueItem | null {
    if (this.state !== 'complete' || this.productionQueue.length === 0) {
      return null;
    }

    const current = this.productionQueue[0];
    current.progress += deltaTime / current.buildTime;

    if (current.progress >= 1) {
      return this.productionQueue.shift()!;
    }

    return null;
  }

  public getProductionProgress(): number {
    if (this.productionQueue.length === 0) return 0;
    return this.productionQueue[0].progress;
  }

  public setRallyPoint(x: number, y: number, targetId: number | null = null): void {
    this.rallyX = x;
    this.rallyY = y;
    this.rallyTargetId = targetId;
  }

  public cancelProduction(index: number): ProductionQueueItem | null {
    if (index < 0 || index >= this.productionQueue.length) return null;
    return this.productionQueue.splice(index, 1)[0];
  }
}

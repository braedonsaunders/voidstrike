/**
 * Render State Adapter
 *
 * Provides a World-like interface for renderers to consume RenderState data
 * from the GameWorker. This allows renderers to work in both worker mode
 * (consuming RenderState) and non-worker mode (consuming ECS World directly).
 *
 * The adapter creates lightweight entity-like wrappers around RenderState data,
 * allowing existing renderer code to work with minimal changes.
 */

import type {
  RenderState,
  UnitRenderState,
  BuildingRenderState,
  ResourceRenderState,
} from './types';

// ============================================================================
// ENTITY ADAPTERS
// ============================================================================

/**
 * A lightweight wrapper that makes RenderState unit data look like an Entity
 */
class UnitEntityAdapter {
  public readonly id: number;
  private data: UnitRenderState;

  // Component cache for get() calls
  private transformComponent: TransformAdapter;
  private unitComponent: UnitAdapter;
  private healthComponent: HealthAdapter;
  private selectableComponent: SelectableAdapter;

  constructor(data: UnitRenderState) {
    this.id = data.id;
    this.data = data;

    this.transformComponent = new TransformAdapter(data);
    this.unitComponent = new UnitAdapter(data);
    this.healthComponent = new HealthAdapter(data);
    this.selectableComponent = new SelectableAdapter(data);
  }

  public get<T>(componentType: string): T | undefined {
    switch (componentType) {
      case 'Transform':
        return this.transformComponent as unknown as T;
      case 'Unit':
        return this.unitComponent as unknown as T;
      case 'Health':
        return this.healthComponent as unknown as T;
      case 'Selectable':
        return this.selectableComponent as unknown as T;
      default:
        return undefined;
    }
  }

  public has(componentType: string): boolean {
    return this.get(componentType) !== undefined;
  }

  public isDestroyed(): boolean {
    return this.data.isDead;
  }

  public update(data: UnitRenderState): void {
    this.data = data;
    this.transformComponent.update(data);
    this.unitComponent.update(data);
    this.healthComponent.update(data);
    this.selectableComponent.update(data);
  }
}

/**
 * Transform-like adapter
 */
class TransformAdapter {
  public x: number;
  public y: number;
  public z: number;
  public rotation: number;

  constructor(data: UnitRenderState | BuildingRenderState) {
    this.x = data.x;
    this.y = data.y;
    this.z = data.z;
    this.rotation = data.rotation;
  }

  public update(data: UnitRenderState | BuildingRenderState): void {
    this.x = data.x;
    this.y = data.y;
    this.z = data.z;
    this.rotation = data.rotation;
  }
}

/**
 * Unit-like adapter
 */
class UnitAdapter {
  public unitId: string;
  public playerId: string;
  public faction: string;
  public state: string;
  public isFlying: boolean;
  public isSubmerged: boolean;
  public isCloaked: boolean;

  constructor(data: UnitRenderState) {
    this.unitId = data.unitId;
    this.playerId = data.playerId;
    this.faction = data.faction;
    this.state = data.state;
    this.isFlying = data.isFlying;
    this.isSubmerged = data.isSubmerged;
    this.isCloaked = data.isCloaked;
  }

  public update(data: UnitRenderState): void {
    this.unitId = data.unitId;
    this.playerId = data.playerId;
    this.faction = data.faction;
    this.state = data.state;
    this.isFlying = data.isFlying;
    this.isSubmerged = data.isSubmerged;
    this.isCloaked = data.isCloaked;
  }

  public isSelected(): boolean {
    return false; // Selection handled separately
  }
}

/**
 * Health-like adapter
 */
class HealthAdapter {
  public current: number;
  public max: number;
  public shield: number;
  public maxShield: number;

  constructor(data: UnitRenderState) {
    this.current = data.health;
    this.max = data.maxHealth;
    this.shield = data.shield;
    this.maxShield = data.maxShield;
  }

  public update(data: UnitRenderState): void {
    this.current = data.health;
    this.max = data.maxHealth;
    this.shield = data.shield;
    this.maxShield = data.maxShield;
  }

  public getHealthPercent(): number {
    return this.max > 0 ? this.current / this.max : 0;
  }

  public isDead(): boolean {
    return this.current <= 0;
  }
}

/**
 * Selectable-like adapter
 */
class SelectableAdapter {
  public isSelected: boolean;
  public controlGroup: number;

  constructor(data: UnitRenderState) {
    this.isSelected = data.isSelected;
    this.controlGroup = 0; // Not available in render state
  }

  public update(data: UnitRenderState): void {
    this.isSelected = data.isSelected;
  }
}

// ============================================================================
// BUILDING ENTITY ADAPTER
// ============================================================================

class BuildingEntityAdapter {
  public readonly id: number;
  private data: BuildingRenderState;

  private transformComponent: BuildingTransformAdapter;
  private buildingComponent: BuildingComponentAdapter;
  private healthComponent: BuildingHealthAdapter;
  private selectableComponent: BuildingSelectableAdapter;

  constructor(data: BuildingRenderState) {
    this.id = data.id;
    this.data = data;

    this.transformComponent = new BuildingTransformAdapter(data);
    this.buildingComponent = new BuildingComponentAdapter(data);
    this.healthComponent = new BuildingHealthAdapter(data);
    this.selectableComponent = new BuildingSelectableAdapter(data);
  }

  public get<T>(componentType: string): T | undefined {
    switch (componentType) {
      case 'Transform':
        return this.transformComponent as unknown as T;
      case 'Building':
        return this.buildingComponent as unknown as T;
      case 'Health':
        return this.healthComponent as unknown as T;
      case 'Selectable':
        return this.selectableComponent as unknown as T;
      default:
        return undefined;
    }
  }

  public has(componentType: string): boolean {
    return this.get(componentType) !== undefined;
  }

  public isDestroyed(): boolean {
    return this.data.isDead;
  }

  public update(data: BuildingRenderState): void {
    this.data = data;
    this.transformComponent.update(data);
    this.buildingComponent.update(data);
    this.healthComponent.update(data);
    this.selectableComponent.update(data);
  }
}

class BuildingTransformAdapter {
  public x: number;
  public y: number;
  public z: number;
  public rotation: number;

  constructor(data: BuildingRenderState) {
    this.x = data.x;
    this.y = data.y;
    this.z = data.z;
    this.rotation = data.rotation;
  }

  public update(data: BuildingRenderState): void {
    this.x = data.x;
    this.y = data.y;
    this.z = data.z;
    this.rotation = data.rotation;
  }
}

class BuildingComponentAdapter {
  public buildingId: string;
  public playerId: string;
  public faction: string;
  public state: string;
  public buildProgress: number;
  public width: number;
  public height: number;
  public isFlying: boolean;
  public liftProgress: number;

  constructor(data: BuildingRenderState) {
    this.buildingId = data.buildingId;
    this.playerId = data.playerId;
    this.faction = data.faction;
    this.state = data.state;
    this.buildProgress = data.buildProgress;
    this.width = data.width;
    this.height = data.height;
    this.isFlying = data.isFlying;
    this.liftProgress = data.liftProgress;
  }

  public update(data: BuildingRenderState): void {
    this.buildingId = data.buildingId;
    this.playerId = data.playerId;
    this.faction = data.faction;
    this.state = data.state;
    this.buildProgress = data.buildProgress;
    this.width = data.width;
    this.height = data.height;
    this.isFlying = data.isFlying;
    this.liftProgress = data.liftProgress;
  }

  public isReady(): boolean {
    return this.buildProgress >= 1 && this.state !== 'constructing';
  }

  public getConstructionProgress(): number {
    return this.buildProgress;
  }
}

class BuildingHealthAdapter {
  public current: number;
  public max: number;

  constructor(data: BuildingRenderState) {
    this.current = data.health;
    this.max = data.maxHealth;
  }

  public update(data: BuildingRenderState): void {
    this.current = data.health;
    this.max = data.maxHealth;
  }

  public getHealthPercent(): number {
    return this.max > 0 ? this.current / this.max : 0;
  }
}

class BuildingSelectableAdapter {
  public isSelected: boolean;
  public controlGroup: number;

  constructor(data: BuildingRenderState) {
    this.isSelected = data.isSelected;
    this.controlGroup = 0;
  }

  public update(data: BuildingRenderState): void {
    this.isSelected = data.isSelected;
  }
}

// ============================================================================
// RESOURCE ENTITY ADAPTER
// ============================================================================

class ResourceEntityAdapter {
  public readonly id: number;
  private data: ResourceRenderState;

  private transformComponent: ResourceTransformAdapter;
  private resourceComponent: ResourceComponentAdapter;

  constructor(data: ResourceRenderState) {
    this.id = data.id;
    this.data = data;

    this.transformComponent = new ResourceTransformAdapter(data);
    this.resourceComponent = new ResourceComponentAdapter(data);
  }

  public get<T>(componentType: string): T | undefined {
    switch (componentType) {
      case 'Transform':
        return this.transformComponent as unknown as T;
      case 'Resource':
        return this.resourceComponent as unknown as T;
      default:
        return undefined;
    }
  }

  public has(componentType: string): boolean {
    return this.get(componentType) !== undefined;
  }

  public isDestroyed(): boolean {
    return this.data.amount <= 0;
  }

  public update(data: ResourceRenderState): void {
    this.data = data;
    this.transformComponent.update(data);
    this.resourceComponent.update(data);
  }
}

class ResourceTransformAdapter {
  public x: number;
  public y: number;
  public z: number;
  public rotation: number;

  constructor(data: ResourceRenderState) {
    this.x = data.x;
    this.y = data.y;
    this.z = 0;
    this.rotation = 0;
  }

  public update(data: ResourceRenderState): void {
    this.x = data.x;
    this.y = data.y;
  }
}

class ResourceComponentAdapter {
  public resourceType: string;
  public amount: number;
  public maxAmount: number;

  constructor(data: ResourceRenderState) {
    this.resourceType = data.resourceType;
    this.amount = data.amount;
    this.maxAmount = data.maxAmount;
  }

  public update(data: ResourceRenderState): void {
    this.resourceType = data.resourceType;
    this.amount = data.amount;
    this.maxAmount = data.maxAmount;
  }

  public hasRefinery(): boolean {
    return false; // Would need to track this separately
  }

  public getDepletionPercent(): number {
    return this.maxAmount > 0 ? 1 - (this.amount / this.maxAmount) : 0;
  }
}

// ============================================================================
// RENDER STATE WORLD ADAPTER
// ============================================================================

/**
 * Provides a World-like interface for consuming RenderState data.
 * This allows renderers to work with both worker mode (RenderState) and
 * non-worker mode (ECS World) with minimal changes.
 */
export class RenderStateWorldAdapter {
  private unitEntities: Map<number, UnitEntityAdapter> = new Map();
  private buildingEntities: Map<number, BuildingEntityAdapter> = new Map();
  private resourceEntities: Map<number, ResourceEntityAdapter> = new Map();

  private currentRenderState: RenderState | null = null;

  /**
   * Update the adapter with new render state from the worker
   */
  public updateFromRenderState(state: RenderState): void {
    this.currentRenderState = state;

    // Update unit entities
    const seenUnitIds = new Set<number>();
    for (const unitData of state.units) {
      seenUnitIds.add(unitData.id);
      let adapter = this.unitEntities.get(unitData.id);
      if (adapter) {
        adapter.update(unitData);
      } else {
        adapter = new UnitEntityAdapter(unitData);
        this.unitEntities.set(unitData.id, adapter);
      }
    }
    // Remove stale units
    for (const id of this.unitEntities.keys()) {
      if (!seenUnitIds.has(id)) {
        this.unitEntities.delete(id);
      }
    }

    // Update building entities
    const seenBuildingIds = new Set<number>();
    for (const buildingData of state.buildings) {
      seenBuildingIds.add(buildingData.id);
      let adapter = this.buildingEntities.get(buildingData.id);
      if (adapter) {
        adapter.update(buildingData);
      } else {
        adapter = new BuildingEntityAdapter(buildingData);
        this.buildingEntities.set(buildingData.id, adapter);
      }
    }
    for (const id of this.buildingEntities.keys()) {
      if (!seenBuildingIds.has(id)) {
        this.buildingEntities.delete(id);
      }
    }

    // Update resource entities
    const seenResourceIds = new Set<number>();
    for (const resourceData of state.resources) {
      seenResourceIds.add(resourceData.id);
      let adapter = this.resourceEntities.get(resourceData.id);
      if (adapter) {
        adapter.update(resourceData);
      } else {
        adapter = new ResourceEntityAdapter(resourceData);
        this.resourceEntities.set(resourceData.id, adapter);
      }
    }
    for (const id of this.resourceEntities.keys()) {
      if (!seenResourceIds.has(id)) {
        this.resourceEntities.delete(id);
      }
    }
  }

  /**
   * Get all entities with the specified components (simplified version)
   */
  public getEntitiesWith(...componentTypes: string[]): Array<UnitEntityAdapter | BuildingEntityAdapter | ResourceEntityAdapter> {
    const results: Array<UnitEntityAdapter | BuildingEntityAdapter | ResourceEntityAdapter> = [];

    // Check for Unit queries
    if (componentTypes.includes('Unit') || (componentTypes.includes('Transform') && componentTypes.length === 1)) {
      for (const adapter of this.unitEntities.values()) {
        results.push(adapter);
      }
    }

    // Check for Building queries
    if (componentTypes.includes('Building')) {
      for (const adapter of this.buildingEntities.values()) {
        results.push(adapter);
      }
    }

    // Check for Resource queries
    if (componentTypes.includes('Resource')) {
      for (const adapter of this.resourceEntities.values()) {
        results.push(adapter);
      }
    }

    return results;
  }

  /**
   * Get entity by ID
   */
  public getEntity(entityId: number): UnitEntityAdapter | BuildingEntityAdapter | ResourceEntityAdapter | null {
    return this.unitEntities.get(entityId)
      ?? this.buildingEntities.get(entityId)
      ?? this.resourceEntities.get(entityId)
      ?? null;
  }

  /**
   * Get entity count
   */
  public getEntityCount(): number {
    return this.unitEntities.size + this.buildingEntities.size + this.resourceEntities.size;
  }

  /**
   * Get current game time from render state
   */
  public getGameTime(): number {
    return this.currentRenderState?.gameTime ?? 0;
  }

  /**
   * Get current tick from render state
   */
  public getTick(): number {
    return this.currentRenderState?.tick ?? 0;
  }

  /**
   * Clear all cached entities
   */
  public clear(): void {
    this.unitEntities.clear();
    this.buildingEntities.clear();
    this.resourceEntities.clear();
    this.currentRenderState = null;
  }
}

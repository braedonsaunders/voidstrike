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
import type { IEntity, IWorldProvider } from '@/engine/ecs/IWorldProvider';
import { debugInitialization } from '@/utils/debugLogger';

// ============================================================================
// ENTITY ADAPTERS
// ============================================================================

/**
 * A lightweight wrapper that makes RenderState unit data look like an Entity
 */
class UnitEntityAdapter implements IEntity {
  public readonly id: number;
  private data: UnitRenderState;

  // Component cache for get() calls
  private transformComponent: TransformAdapter;
  private unitComponent: UnitAdapter;
  private healthComponent: HealthAdapter;
  private selectableComponent: SelectableAdapter;
  private velocityComponent: VelocityAdapter;

  constructor(data: UnitRenderState) {
    this.id = data.id;
    this.data = data;

    this.transformComponent = new TransformAdapter(data);
    this.unitComponent = new UnitAdapter(data);
    this.healthComponent = new HealthAdapter(data);
    this.selectableComponent = new SelectableAdapter(data);
    this.velocityComponent = new VelocityAdapter(data);
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
      case 'Velocity':
        return this.velocityComponent as unknown as T;
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
    this.velocityComponent.update(data);
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
  public isWorker: boolean;
  public isMining: boolean;
  public isRepairing: boolean;
  public carryingMinerals: number;
  public carryingPlasma: number;
  public gatherTargetId: number | null;
  // Movement/targeting for waypoint visualization
  public targetX: number | null;
  public targetY: number | null;
  public speed: number;
  // Command queue for shift-click visualization
  public commandQueue: Array<{
    type: string;
    targetX?: number;
    targetY?: number;
    targetEntityId?: number;
  }>;
  // Combat stats for range overlays
  public attackRange: number;
  public sightRange: number;
  // Targeting capabilities
  public isNaval: boolean;
  public canAttackGround: boolean;
  public canAttackAir: boolean;

  constructor(data: UnitRenderState) {
    this.unitId = data.unitId;
    this.playerId = data.playerId;
    this.faction = data.faction;
    this.state = data.state;
    this.isFlying = data.isFlying;
    this.isSubmerged = data.isSubmerged;
    this.isCloaked = data.isCloaked;
    this.isWorker = data.isWorker;
    this.isMining = data.isMining;
    this.isRepairing = data.isRepairing;
    this.carryingMinerals = data.carryingMinerals;
    this.carryingPlasma = data.carryingPlasma;
    this.gatherTargetId = data.gatherTargetId;
    this.targetX = data.targetX;
    this.targetY = data.targetY;
    this.speed = data.speed;
    this.commandQueue = data.commandQueue;
    this.attackRange = data.attackRange;
    this.sightRange = data.sightRange;
    this.isNaval = data.isNaval;
    this.canAttackGround = data.canAttackGround;
    this.canAttackAir = data.canAttackAir;
  }

  public update(data: UnitRenderState): void {
    this.unitId = data.unitId;
    this.playerId = data.playerId;
    this.faction = data.faction;
    this.state = data.state;
    this.isFlying = data.isFlying;
    this.isSubmerged = data.isSubmerged;
    this.isCloaked = data.isCloaked;
    this.isWorker = data.isWorker;
    this.isMining = data.isMining;
    this.isRepairing = data.isRepairing;
    this.carryingMinerals = data.carryingMinerals;
    this.carryingPlasma = data.carryingPlasma;
    this.gatherTargetId = data.gatherTargetId;
    this.targetX = data.targetX;
    this.targetY = data.targetY;
    this.speed = data.speed;
    this.commandQueue = data.commandQueue;
    this.attackRange = data.attackRange;
    this.sightRange = data.sightRange;
    this.isNaval = data.isNaval;
    this.canAttackGround = data.canAttackGround;
    this.canAttackAir = data.canAttackAir;
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
  public playerId: string;
  public controlGroup: number;
  // Selection properties for hit detection
  public selectionRadius: number;
  public selectionPriority: number;
  // Default visual properties (not in render state, so use sensible defaults)
  public visualScale: number = 1;
  public visualHeight: number = 0;

  constructor(data: UnitRenderState) {
    this.isSelected = data.isSelected;
    this.playerId = data.playerId;
    this.controlGroup = data.controlGroup ?? 0;
    this.selectionRadius = data.selectionRadius;
    this.selectionPriority = data.selectionPriority;
  }

  public update(data: UnitRenderState): void {
    this.isSelected = data.isSelected;
    this.playerId = data.playerId;
    this.controlGroup = data.controlGroup ?? 0;
    this.selectionRadius = data.selectionRadius;
    this.selectionPriority = data.selectionPriority;
  }
}

/**
 * Velocity-like adapter - derives velocity from position delta (current - previous)
 * This allows animation systems to detect movement for walk/idle transitions.
 */
class VelocityAdapter {
  public x: number;
  public y: number;
  public z: number;

  constructor(data: UnitRenderState) {
    // Velocity is approximated from position change between frames
    this.x = data.x - data.prevX;
    this.y = data.y - data.prevY;
    this.z = data.z - data.prevZ;
  }

  public update(data: UnitRenderState): void {
    this.x = data.x - data.prevX;
    this.y = data.y - data.prevY;
    this.z = data.z - data.prevZ;
  }
}

// ============================================================================
// BUILDING ENTITY ADAPTER
// ============================================================================

class BuildingEntityAdapter implements IEntity {
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
  // Production queue simulation for renderer compatibility
  public productionQueue: { progress: number }[];
  // Combat stats for range overlays
  public attackRange: number;
  public sightRange: number;

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
    // Simulate productionQueue for renderer compatibility
    this.productionQueue = data.hasProductionQueue ? [{ progress: data.productionProgress }] : [];
    this.attackRange = data.attackRange;
    this.sightRange = data.sightRange;
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
    // Simulate productionQueue for renderer compatibility
    this.productionQueue = data.hasProductionQueue ? [{ progress: data.productionProgress }] : [];
    this.attackRange = data.attackRange;
    this.sightRange = data.sightRange;
  }

  public isReady(): boolean {
    return this.buildProgress >= 1 && this.state !== 'constructing';
  }

  public getConstructionProgress(): number {
    return this.buildProgress;
  }

  public isComplete(): boolean {
    return this.state === 'complete' || (this.buildProgress >= 1 && this.state !== 'constructing');
  }

  public hasAddon(): boolean {
    // Check if productionQueue has tech-gated items that require addon
    return false; // Will be set properly when addon data is passed
  }

  public hasTechLab(): boolean {
    return false; // Will be set properly when addon data is passed
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

  public isDead(): boolean {
    return this.current <= 0;
  }
}

class BuildingSelectableAdapter {
  public isSelected: boolean;
  public playerId: string;
  public controlGroup: number;
  // Selection properties for hit detection
  public selectionRadius: number;
  public selectionPriority: number;
  // Default visual properties (not in render state, so use sensible defaults)
  public visualScale: number = 1;
  public visualHeight: number = 0;

  constructor(data: BuildingRenderState) {
    this.isSelected = data.isSelected;
    this.playerId = data.playerId;
    this.controlGroup = 0;
    this.selectionRadius = data.selectionRadius;
    this.selectionPriority = data.selectionPriority;
  }

  public update(data: BuildingRenderState): void {
    this.isSelected = data.isSelected;
    this.playerId = data.playerId;
    this.selectionRadius = data.selectionRadius;
    this.selectionPriority = data.selectionPriority;
  }
}

// ============================================================================
// RESOURCE ENTITY ADAPTER
// ============================================================================

class ResourceEntityAdapter implements IEntity {
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
    this.z = data.z ?? 0;
    this.rotation = 0;
  }

  public update(data: ResourceRenderState): void {
    this.x = data.x;
    this.y = data.y;
    this.z = data.z ?? 0;
  }
}

class ResourceComponentAdapter {
  public resourceType: string;
  public amount: number;
  public maxAmount: number;
  public maxGatherers: number;
  private _hasExtractor: boolean;
  private _currentGatherers: number;

  constructor(data: ResourceRenderState) {
    this.resourceType = data.resourceType;
    this.amount = data.amount;
    this.maxAmount = data.maxAmount;
    this._hasExtractor = data.hasExtractor;
    this._currentGatherers = data.gathererCount ?? 0;
    this.maxGatherers = data.resourceType === 'minerals' ? 2 : 3;
  }

  public update(data: ResourceRenderState): void {
    this.resourceType = data.resourceType;
    this.amount = data.amount;
    this.maxAmount = data.maxAmount;
    this._hasExtractor = data.hasExtractor;
    this._currentGatherers = data.gathererCount ?? 0;
    this.maxGatherers = data.resourceType === 'minerals' ? 2 : 3;
  }

  public isDepleted(): boolean {
    return this.amount <= 0;
  }

  public getPercentRemaining(): number {
    return this.maxAmount > 0 ? this.amount / this.maxAmount : 0;
  }

  public hasExtractor(): boolean {
    return this._hasExtractor;
  }

  public hasRefinery(): boolean {
    return this._hasExtractor;
  }

  public getDepletionPercent(): number {
    return this.maxAmount > 0 ? 1 - this.amount / this.maxAmount : 0;
  }

  public getCurrentGatherers(): number {
    return this._currentGatherers;
  }
}

// ============================================================================
// RENDER STATE WORLD ADAPTER
// ============================================================================

/**
 * Provides a World-like interface for consuming RenderState data.
 * This allows renderers to work with both worker mode (RenderState) and
 * non-worker mode (ECS World) with minimal changes.
 *
 * Singleton pattern for global access from UI components.
 */
// Use a string key on globalThis to ensure singleton is shared across code-split bundles
// Symbol.for() would work but string keys are simpler for type declarations
const RENDER_STATE_ADAPTER_KEY = '__voidstrike_RenderStateWorldAdapter__';

export class RenderStateWorldAdapter implements IWorldProvider {
  // Note: We use globalThis instead of static class variable to ensure
  // the singleton is shared across Next.js/Turbopack code-split bundles

  private unitEntities: Map<number, UnitEntityAdapter> = new Map();
  private buildingEntities: Map<number, BuildingEntityAdapter> = new Map();
  private resourceEntities: Map<number, ResourceEntityAdapter> = new Map();

  private currentRenderState: RenderState | null = null;
  private _isReady = false;
  private _updateCount = 0;

  /**
   * Get the singleton instance (creates one if needed)
   * Uses globalThis to ensure singleton is shared across code-split bundles
   */
  public static getInstance(): RenderStateWorldAdapter {
    // Access via globalThis to share across code-split bundles
    const global = globalThis as unknown as Record<string, RenderStateWorldAdapter | undefined>;
    let instance = global[RENDER_STATE_ADAPTER_KEY];
    if (!instance) {
      instance = new RenderStateWorldAdapter();
      global[RENDER_STATE_ADAPTER_KEY] = instance;
      debugInitialization.log(
        '[RenderStateWorldAdapter] Created new singleton instance on globalThis'
      );
    }
    return instance;
  }

  /**
   * Reset the singleton instance (for game restart)
   */
  public static resetInstance(): void {
    const global = globalThis as unknown as Record<string, RenderStateWorldAdapter | undefined>;
    const instance = global[RENDER_STATE_ADAPTER_KEY];
    if (instance) {
      instance.clear();
      global[RENDER_STATE_ADAPTER_KEY] = undefined;
      debugInitialization.log('[RenderStateWorldAdapter] Reset singleton instance');
    }
  }

  /**
   * Check if instance exists
   */
  public static hasInstance(): boolean {
    const global = globalThis as unknown as Record<string, RenderStateWorldAdapter | undefined>;
    return global[RENDER_STATE_ADAPTER_KEY] !== undefined;
  }

  // Debug: log first update only
  private hasLoggedFirstUpdate = false;

  /**
   * Check if the adapter has received at least one render state with entities
   */
  public isReady(): boolean {
    return this._isReady;
  }

  /**
   * Get the number of updates received (for debugging)
   */
  public getUpdateCount(): number {
    return this._updateCount;
  }

  /**
   * Get entity counts (for debugging)
   */
  public getEntityCounts(): { units: number; buildings: number; resources: number } {
    return {
      units: this.unitEntities.size,
      buildings: this.buildingEntities.size,
      resources: this.resourceEntities.size,
    };
  }

  /**
   * Update the adapter with new render state from the worker
   */
  public updateFromRenderState(state: RenderState): void {
    try {
      this._updateCount++;

      // Debug: log first significant update
      if (
        !this.hasLoggedFirstUpdate &&
        (state.units.length > 0 || state.buildings.length > 0 || state.resources.length > 0)
      ) {
        debugInitialization.log('[RenderStateWorldAdapter] First update with entities:', {
          tick: state.tick,
          units: state.units.length,
          buildings: state.buildings.length,
          resources: state.resources.length,
        });
        this.hasLoggedFirstUpdate = true;
      }

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

      // Mark as ready once we have entities
      if (
        !this._isReady &&
        (this.unitEntities.size > 0 ||
          this.buildingEntities.size > 0 ||
          this.resourceEntities.size > 0)
      ) {
        this._isReady = true;
        debugInitialization.log('[RenderStateWorldAdapter] Adapter is now ready with entities:', {
          units: this.unitEntities.size,
          buildings: this.buildingEntities.size,
          resources: this.resourceEntities.size,
        });
      }
    } catch (error) {
      debugInitialization.error(
        '[RenderStateWorldAdapter] Error updating from render state:',
        error
      );
    }
  }

  /**
   * Get all entities with the specified components (simplified version)
   * Handles common query patterns:
   * - ('Unit') or ('Unit', 'Transform', ...) → units
   * - ('Building') or ('Building', 'Transform', ...) → buildings
   * - ('Resource') or ('Resource', 'Transform') → resources
   * - ('Transform', 'Selectable') → units + buildings (selection queries)
   * - ('Transform') alone → units only (legacy)
   */
  public getEntitiesWith(...componentTypes: string[]): IEntity[] {
    const results: IEntity[] = [];

    const hasUnit = componentTypes.includes('Unit');
    const hasBuilding = componentTypes.includes('Building');
    const hasResource = componentTypes.includes('Resource');
    const hasSelectable = componentTypes.includes('Selectable');
    const hasTransform = componentTypes.includes('Transform');

    // Units: return when querying for Unit, Selectable (without Building/Resource filter),
    // or Transform alone (legacy)
    const includeUnits =
      hasUnit ||
      (hasSelectable && !hasBuilding && !hasResource) ||
      (hasTransform && componentTypes.length === 1);

    // Buildings: return when querying for Building, or Selectable (without Unit/Resource filter)
    const includeBuildings = hasBuilding || (hasSelectable && !hasUnit && !hasResource);

    // Resources: return when querying for Resource
    const includeResources = hasResource;

    if (includeUnits) {
      for (const adapter of this.unitEntities.values()) {
        results.push(adapter);
      }
    }

    if (includeBuildings) {
      for (const adapter of this.buildingEntities.values()) {
        results.push(adapter);
      }
    }

    if (includeResources) {
      for (const adapter of this.resourceEntities.values()) {
        results.push(adapter);
      }
    }

    return results;
  }

  /**
   * Get entity by ID
   */
  public getEntity(entityId: number): IEntity | null {
    return (
      this.unitEntities.get(entityId) ??
      this.buildingEntities.get(entityId) ??
      this.resourceEntities.get(entityId) ??
      null
    );
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
   * Get vision data for a player from the current render state
   * Used by fog of war rendering in worker mode
   */
  public getVisionDataForPlayer(playerId: string): Uint8Array | null {
    if (!this.currentRenderState) return null;
    return this.currentRenderState.visionGrids.get(playerId) ?? null;
  }

  /**
   * Clear all cached entities
   */
  public clear(): void {
    this.unitEntities.clear();
    this.buildingEntities.clear();
    this.resourceEntities.clear();
    this.currentRenderState = null;
    this._isReady = false;
    this._updateCount = 0;
    this.hasLoggedFirstUpdate = false;
  }
}

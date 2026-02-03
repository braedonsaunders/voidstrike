import { System } from '../ecs/System';
import type { IGameInstance } from '../core/IGameInstance';
import { distance, clamp } from '@/utils/math';
import type { IWorldProvider } from '../ecs/IWorldProvider';

/**
 * Selection system with screen-space box selection, selection radius buffer,
 * visual bounds support, and priority-based selection (units over buildings).
 *
 * In worker mode, this system queries entities from RenderStateWorldAdapter
 * and notifies the worker of selection changes via a callback.
 */
export class SelectionSystem extends System {
  public readonly name = 'SelectionSystem';
  // Priority is set by SystemRegistry based on dependencies (no deps, runs early)

  private controlGroups: Map<number, number[]> = new Map();

  // Screen-space selection callback (set by canvas)
  private worldToScreenFn:
    | ((x: number, z: number, y?: number) => { x: number; y: number } | null)
    | null = null;

  // Terrain height lookup function (set by canvas)
  private getTerrainHeightFn: ((x: number, z: number) => number) | null = null;

  // PERF: Viewport bounds for culling entities outside visible area (in world space)
  // Updated by camera system when viewport changes
  private viewportBounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

  // World provider for entity queries (RenderStateWorldAdapter in worker mode)
  private worldProvider: IWorldProvider | null = null;

  // Callback to notify worker of selection changes
  private onSelectionSync: ((entityIds: number[], playerId: string) => void) | null = null;

  // Current player ID for selection sync
  private currentPlayerId: string | null = null;

  constructor(game: IGameInstance) {
    super(game);
    this.setupEventListeners();
  }

  /**
   * Set the world provider for entity queries.
   * In worker mode, this should be RenderStateWorldAdapter.
   */
  public setWorldProvider(provider: IWorldProvider): void {
    this.worldProvider = provider;
  }

  /**
   * Set the callback for syncing selection to the worker.
   * This should be WorkerBridge.setSelection in worker mode.
   */
  public setSelectionSyncCallback(callback: (entityIds: number[], playerId: string) => void): void {
    this.onSelectionSync = callback;
  }

  /**
   * Set the current player ID for selection operations.
   */
  public setPlayerId(playerId: string): void {
    this.currentPlayerId = playerId;
  }

  /**
   * Set the world-to-screen projection function for accurate screen-space selection
   */
  public setWorldToScreen(
    fn: (x: number, z: number, y?: number) => { x: number; y: number } | null
  ): void {
    this.worldToScreenFn = fn;
  }

  /**
   * Set the terrain height lookup function for accurate vertical positioning
   */
  public setTerrainHeightFunction(fn: (x: number, z: number) => number): void {
    this.getTerrainHeightFn = fn;
  }

  /**
   * PERF: Set the visible viewport bounds for culling (in world space)
   * Should be called by camera system when viewport/camera changes
   */
  public setViewportBounds(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.viewportBounds = { minX, maxX, minZ, maxZ };
  }

  /**
   * Get the world provider - uses injected provider or falls back to this.world
   */
  private getWorldProvider(): IWorldProvider {
    return this.worldProvider ?? (this.world as unknown as IWorldProvider);
  }

  /**
   * PERF: Check if a world position is potentially within the viewport
   * Uses a buffer to account for entity radius and camera perspective
   */
  private isInViewport(x: number, z: number, buffer: number = 10): boolean {
    if (!this.viewportBounds) return true; // No culling if bounds not set
    return (
      x >= this.viewportBounds.minX - buffer &&
      x <= this.viewportBounds.maxX + buffer &&
      z >= this.viewportBounds.minZ - buffer &&
      z <= this.viewportBounds.maxZ + buffer
    );
  }

  private setupEventListeners(): void {
    // Screen-space selection (handles flying units and perspective correctly)
    this.game.eventBus.on('selection:boxScreen', this.handleScreenBoxSelection.bind(this));
    this.game.eventBus.on('selection:clickScreen', this.handleScreenClickSelection.bind(this));

    // Control groups and other commands
    this.game.eventBus.on('selection:controlGroup:set', this.handleSetControlGroup.bind(this));
    this.game.eventBus.on('selection:controlGroup:get', this.handleGetControlGroup.bind(this));
    this.game.eventBus.on('selection:clear', this.handleClearSelection.bind(this));
  }

  /**
   * Sync selection to worker and update local state
   */
  private syncSelection(selectedIds: number[], playerId: string): void {
    // Update local state port (Zustand store)
    this.game.statePort.selectUnits(selectedIds);

    // Notify worker to update isSelected on actual entities
    if (this.onSelectionSync) {
      this.onSelectionSync(selectedIds, playerId);
    }

    // Emit event for UI updates
    this.game.eventBus.emit('selection:changed', { selectedIds, playerId });
  }

  /**
   * Screen-space box selection - the most accurate method
   * Converts entity positions to screen space and checks against screen-space box
   */
  private handleScreenBoxSelection(data: {
    screenStartX: number;
    screenStartY: number;
    screenEndX: number;
    screenEndY: number;
    additive: boolean;
    playerId: string;
  }): void {
    const { screenStartX, screenStartY, screenEndX, screenEndY, additive, playerId } = data;
    const world = this.getWorldProvider();

    // Screen-space box bounds
    const screenMinX = Math.min(screenStartX, screenEndX);
    const screenMaxX = Math.max(screenStartX, screenEndX);
    const screenMinY = Math.min(screenStartY, screenEndY);
    const screenMaxY = Math.max(screenStartY, screenEndY);

    // Box dimensions for buffer calculation
    const boxWidth = screenMaxX - screenMinX;
    const boxHeight = screenMaxY - screenMinY;

    const entities = world.getEntitiesWith('Transform', 'Selectable');

    // Collect entities within box, separating units from buildings
    const unitIds: number[] = [];
    const buildingIds: number[] = [];

    for (const entity of entities) {
      const transform = entity.get<{ x: number; y: number }>('Transform');
      const selectable = entity.get<{
        playerId: string;
        selectionRadius: number;
        selectionPriority: number;
        visualHeight?: number;
        visualScale?: number;
      }>('Selectable');
      const health = entity.get<{ isDead: () => boolean }>('Health');
      const unit = entity.get<{ unitId: string }>('Unit');
      const building = entity.get<{ buildingId: string }>('Building');

      if (!transform || !selectable) continue;

      // Only select own units/buildings
      if (selectable.playerId !== playerId) continue;

      // Skip dead entities
      if (health?.isDead()) continue;

      // PERF: Early reject entities outside viewport bounds (world space culling)
      if (!this.isInViewport(transform.x, transform.y)) continue;

      // Convert entity world position to screen space
      if (!this.worldToScreenFn) continue;

      const terrainHeight = this.getTerrainHeightFn
        ? this.getTerrainHeightFn(transform.x, transform.y)
        : 0;
      const visualHeight = selectable.visualHeight ?? 0;
      const worldY = terrainHeight + visualHeight;
      const screenPos = this.worldToScreenFn(transform.x, transform.y, worldY);
      if (!screenPos) continue; // Behind camera

      // Calculate screen-space selection buffer based on visual size
      const visualScale = selectable.visualScale ?? 1;
      const baseScreenRadius = selectable.selectionRadius * 25;
      const screenRadius = baseScreenRadius * visualScale;

      // Check if entity's screen-space circle intersects the selection box
      const isInBox = this.circleIntersectsRect(
        screenPos.x,
        screenPos.y,
        screenRadius,
        screenMinX,
        screenMinY,
        screenMaxX,
        screenMaxY
      );

      // For very small boxes (essentially clicks), use a more generous check
      const isSmallBox = boxWidth < 20 && boxHeight < 20;
      const clickRadius = isSmallBox ? screenRadius * 1.5 : screenRadius;

      const finalInBox = isSmallBox
        ? this.circleIntersectsRect(
            screenPos.x,
            screenPos.y,
            clickRadius,
            screenMinX,
            screenMinY,
            screenMaxX,
            screenMaxY
          )
        : isInBox;

      if (finalInBox) {
        if (unit) {
          unitIds.push(entity.id);
        } else if (building) {
          buildingIds.push(entity.id);
        }
      }
    }

    // Prioritize units over buildings - if any units are selected, ignore buildings
    let selectedIds = unitIds.length > 0 ? unitIds : buildingIds;

    // Handle additive selection
    if (additive) {
      const current = this.game.statePort.getSelectedUnits();
      const combinedSet = new Set(current);
      for (const id of selectedIds) {
        combinedSet.add(id);
      }
      selectedIds = Array.from(combinedSet);
    }

    this.syncSelection(selectedIds, playerId);
  }

  /**
   * Check if a circle intersects a rectangle
   */
  private circleIntersectsRect(
    cx: number,
    cy: number,
    radius: number,
    rectMinX: number,
    rectMinY: number,
    rectMaxX: number,
    rectMaxY: number
  ): boolean {
    const closestX = clamp(cx, rectMinX, rectMaxX);
    const closestY = clamp(cy, rectMinY, rectMaxY);
    const dx = cx - closestX;
    const dy = cy - closestY;
    const distanceSquared = dx * dx + dy * dy;
    return distanceSquared <= radius * radius;
  }

  /**
   * Screen-space click selection - handles flying units at their visual position
   */
  private handleScreenClickSelection(data: {
    screenX: number;
    screenY: number;
    additive: boolean;
    selectAllOfType?: boolean;
    playerId: string;
  }): void {
    const { screenX, screenY, additive, selectAllOfType, playerId } = data;
    const world = this.getWorldProvider();

    if (!this.worldToScreenFn) {
      return;
    }

    const entities = world.getEntitiesWith('Transform', 'Selectable');
    let closestEntity: {
      id: number;
      distance: number;
      priority: number;
      unitId?: string;
      buildingId?: string;
    } | null = null;

    // Find closest entity to click point in screen space
    for (const entity of entities) {
      const transform = entity.get<{ x: number; y: number }>('Transform');
      const selectable = entity.get<{
        playerId: string;
        selectionRadius: number;
        selectionPriority: number;
        visualHeight?: number;
        visualScale?: number;
      }>('Selectable');
      const health = entity.get<{ isDead: () => boolean }>('Health');
      const unit = entity.get<{ unitId: string }>('Unit');
      const building = entity.get<{ buildingId: string }>('Building');

      if (!transform || !selectable) continue;

      // Allow selecting own units/buildings OR neutral entities (resources)
      if (selectable.playerId !== playerId && selectable.playerId !== 'neutral') continue;

      // Skip dead units
      if (health?.isDead()) continue;

      // PERF: Early reject entities outside viewport bounds
      if (!this.isInViewport(transform.x, transform.y)) continue;

      // Convert entity to screen space
      const terrainHeight = this.getTerrainHeightFn
        ? this.getTerrainHeightFn(transform.x, transform.y)
        : 0;
      const visualHeight = selectable.visualHeight ?? 0;
      const worldY = terrainHeight + visualHeight;
      const screenPos = this.worldToScreenFn(transform.x, transform.y, worldY);
      if (!screenPos) continue;

      // Calculate screen-space distance
      const screenDistance = distance(screenX, screenY, screenPos.x, screenPos.y);

      // Calculate screen-space selection radius
      const visualScale = selectable.visualScale ?? 1;
      const baseScreenRadius = selectable.selectionRadius * 30;
      const screenRadius = baseScreenRadius * visualScale;

      if (screenDistance <= screenRadius) {
        if (
          !closestEntity ||
          selectable.selectionPriority > closestEntity.priority ||
          (selectable.selectionPriority === closestEntity.priority &&
            screenDistance < closestEntity.distance)
        ) {
          closestEntity = {
            id: entity.id,
            distance: screenDistance,
            priority: selectable.selectionPriority,
            unitId: unit?.unitId,
            buildingId: building?.buildingId,
          };
        }
      }
    }

    // Handle Ctrl+click or double-click - select all of same type
    if (selectAllOfType && closestEntity) {
      if (closestEntity.unitId) {
        this.selectAllOfUnitType(closestEntity.unitId, playerId, additive);
        return;
      }
      if (closestEntity.buildingId) {
        this.selectAllOfBuildingType(closestEntity.buildingId, playerId, additive);
        return;
      }
    }

    // Build selected IDs
    let selectedIds: number[] = [];
    if (closestEntity) {
      if (additive) {
        const current = this.game.statePort.getSelectedUnits();
        const isAlreadySelected = current.includes(closestEntity.id);
        if (isAlreadySelected) {
          // Deselect if already selected
          selectedIds = current.filter((id) => id !== closestEntity!.id);
        } else {
          // Add to selection
          selectedIds = [...current, closestEntity.id];
        }
      } else {
        selectedIds = [closestEntity.id];
      }
    } else if (!additive) {
      // Clicked empty space - clear selection
      selectedIds = [];
    } else {
      // Additive click on empty space - keep current selection
      return;
    }

    this.syncSelection(selectedIds, playerId);
  }

  private selectAllOfUnitType(unitId: string, playerId: string, additive: boolean): void {
    const world = this.getWorldProvider();
    const entities = world.getEntitiesWith('Unit', 'Selectable');
    const newSelectedIds: number[] = [];

    for (const entity of entities) {
      const unit = entity.get<{ unitId: string }>('Unit');
      const selectable = entity.get<{ playerId: string }>('Selectable');
      const health = entity.get<{ isDead: () => boolean }>('Health');
      const transform = entity.get<{ x: number; y: number }>('Transform');

      if (!unit || !selectable) continue;
      if (health?.isDead()) continue;
      if (transform && !this.isInViewport(transform.x, transform.y)) continue;

      if (unit.unitId === unitId && selectable.playerId === playerId) {
        newSelectedIds.push(entity.id);
      }
    }

    let selectedIds = newSelectedIds;
    if (additive) {
      const current = this.game.statePort.getSelectedUnits();
      const combinedSet = new Set(current);
      for (const id of newSelectedIds) {
        combinedSet.add(id);
      }
      selectedIds = Array.from(combinedSet);
    }

    this.syncSelection(selectedIds, playerId);
  }

  private selectAllOfBuildingType(buildingId: string, playerId: string, additive: boolean): void {
    const world = this.getWorldProvider();
    const entities = world.getEntitiesWith('Building', 'Selectable');
    const newSelectedIds: number[] = [];

    for (const entity of entities) {
      const building = entity.get<{ buildingId: string }>('Building');
      const selectable = entity.get<{ playerId: string }>('Selectable');
      const health = entity.get<{ isDead: () => boolean }>('Health');
      const transform = entity.get<{ x: number; y: number }>('Transform');

      if (!building || !selectable) continue;
      if (health?.isDead()) continue;
      if (transform && !this.isInViewport(transform.x, transform.y)) continue;

      if (building.buildingId === buildingId && selectable.playerId === playerId) {
        newSelectedIds.push(entity.id);
      }
    }

    let selectedIds = newSelectedIds;
    if (additive) {
      const current = this.game.statePort.getSelectedUnits();
      const combinedSet = new Set(current);
      for (const id of newSelectedIds) {
        combinedSet.add(id);
      }
      selectedIds = Array.from(combinedSet);
    }

    this.syncSelection(selectedIds, playerId);
  }

  private handleSetControlGroup(data: { group: number; entityIds: number[] }): void {
    const { group, entityIds } = data;

    this.controlGroups.set(group, entityIds);
    this.game.statePort.setControlGroup(group, entityIds);

    // Notify worker of control group change
    this.game.eventBus.emit('controlGroup:set', { group, entityIds });
  }

  private handleGetControlGroup(data: { group: number }): void {
    const { group } = data;
    const world = this.getWorldProvider();
    const entityIds = this.controlGroups.get(group) || [];

    // Filter out dead/destroyed entities
    const validIds = entityIds.filter((id) => {
      const entity = world.getEntity(id);
      if (!entity) return false;
      const health = entity.get<{ isDead: () => boolean }>('Health');
      return !health?.isDead();
    });

    // Update the stored group if entities were removed
    if (validIds.length !== entityIds.length) {
      this.controlGroups.set(group, validIds);
    }

    const playerId = this.currentPlayerId ?? this.game.config.playerId ?? 'player1';
    this.syncSelection(validIds, playerId);
  }

  private handleClearSelection(): void {
    const playerId = this.currentPlayerId ?? this.game.config.playerId ?? 'player1';
    this.syncSelection([], playerId);
  }

  public update(_deltaTime: number): void {
    // Auto-deselect dead units
    const world = this.getWorldProvider();
    const selectedUnits = this.game.statePort.getSelectedUnits();
    let needsUpdate = false;
    const validSelectedIds: number[] = [];

    for (const entityId of selectedUnits) {
      const entity = world.getEntity(entityId);
      if (!entity) {
        needsUpdate = true;
        continue;
      }

      const health = entity.get<{ isDead: () => boolean }>('Health');
      if (health?.isDead()) {
        needsUpdate = true;
        continue;
      }

      validSelectedIds.push(entityId);
    }

    // Update if selection changed
    if (needsUpdate) {
      const playerId = this.currentPlayerId ?? this.game.config.playerId ?? 'player1';
      this.syncSelection(validSelectedIds, playerId);
    }
  }
}

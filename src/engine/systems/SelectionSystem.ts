import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Selectable } from '../components/Selectable';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Game } from '../core/Game';
import { useGameStore } from '@/store/gameStore';
import { distance } from '@/utils/math';

/**
 * Selection system with screen-space box selection, selection radius buffer,
 * visual bounds support, and priority-based selection (units over buildings).
 */
export class SelectionSystem extends System {
  public readonly name = 'SelectionSystem';
  public priority = 1;

  private controlGroups: Map<number, number[]> = new Map();

  // Screen-space selection callback (set by canvas)
  private worldToScreenFn: ((x: number, z: number, y?: number) => { x: number; y: number } | null) | null = null;

  // Terrain height lookup function (set by canvas)
  private getTerrainHeightFn: ((x: number, z: number) => number) | null = null;

  // PERF: Viewport bounds for culling entities outside visible area (in world space)
  // Updated by camera system when viewport changes
  private viewportBounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  /**
   * Set the world-to-screen projection function for accurate screen-space selection
   */
  public setWorldToScreen(fn: (x: number, z: number, y?: number) => { x: number; y: number } | null): void {
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
    // World-space selection (legacy/fallback)
    this.game.eventBus.on('selection:box', this.handleBoxSelection.bind(this));
    this.game.eventBus.on('selection:click', this.handleClickSelection.bind(this));

    // Screen-space selection (preferred - handles flying units and perspective correctly)
    this.game.eventBus.on('selection:boxScreen', this.handleScreenBoxSelection.bind(this));
    this.game.eventBus.on('selection:clickScreen', this.handleScreenClickSelection.bind(this));

    // Control groups and other commands
    this.game.eventBus.on('selection:controlGroup:set', this.handleSetControlGroup.bind(this));
    this.game.eventBus.on('selection:controlGroup:get', this.handleGetControlGroup.bind(this));
    this.game.eventBus.on('selection:clear', this.handleClearSelection.bind(this));
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

    // Screen-space box bounds
    const screenMinX = Math.min(screenStartX, screenEndX);
    const screenMaxX = Math.max(screenStartX, screenEndX);
    const screenMinY = Math.min(screenStartY, screenEndY);
    const screenMaxY = Math.max(screenStartY, screenEndY);

    // Box dimensions for buffer calculation
    const boxWidth = screenMaxX - screenMinX;
    const boxHeight = screenMaxY - screenMinY;

    const entities = this.world.getEntitiesWith('Transform', 'Selectable');

    // First, deselect all if not additive
    if (!additive) {
      for (const entity of entities) {
        const selectable = entity.get<Selectable>('Selectable')!;
        selectable.deselect();
      }
    }

    // Collect entities within box, separating units from buildings
    const unitIds: number[] = [];
    const buildingIds: number[] = [];

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health');
      const unit = entity.get<Unit>('Unit');
      const building = entity.get<Building>('Building');

      // Only select own units/buildings
      if (selectable.playerId !== playerId) continue;

      // Skip dead entities
      if (health && health.isDead()) continue;

      // PERF: Early reject entities outside viewport bounds (world space culling)
      if (!this.isInViewport(transform.x, transform.y)) continue;

      // Convert entity world position to screen space
      // Must include terrain height + visual height offset for accurate projection
      if (!this.worldToScreenFn) continue;

      const terrainHeight = this.getTerrainHeightFn ? this.getTerrainHeightFn(transform.x, transform.y) : 0;
      const visualHeight = selectable.visualHeight ?? 0;
      const worldY = terrainHeight + visualHeight;
      const screenPos = this.worldToScreenFn(transform.x, transform.y, worldY);
      if (!screenPos) continue; // Behind camera

      // Calculate screen-space selection buffer based on visual size
      // Larger units get bigger screen-space hitboxes
      const visualScale = selectable.visualScale ?? 1;
      const baseScreenRadius = selectable.selectionRadius * 25; // Pixels per world unit (increased for better feel)
      const screenRadius = baseScreenRadius * visualScale;

      // Check if entity's screen-space circle intersects the selection box
      // Using circle-rectangle intersection for smooth selection feel
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
        ? this.circleIntersectsRect(screenPos.x, screenPos.y, clickRadius, screenMinX, screenMinY, screenMaxX, screenMaxY)
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
    const selectedIds = unitIds.length > 0 ? unitIds : buildingIds;

    // Mark entities as selected
    for (const entityId of selectedIds) {
      const entity = this.world.getEntity(entityId);
      if (entity) {
        const selectable = entity.get<Selectable>('Selectable');
        if (selectable) {
          selectable.select();
        }
      }
    }

    // Update store
    if (additive) {
      const current = useGameStore.getState().selectedUnits;
      // PERF: Avoid multiple spread operations by using Set directly
      const combinedSet = new Set(current);
      for (let i = 0; i < selectedIds.length; i++) {
        combinedSet.add(selectedIds[i]);
      }
      useGameStore.getState().selectUnits(Array.from(combinedSet));
    } else {
      useGameStore.getState().selectUnits(selectedIds);
    }

    this.game.eventBus.emit('selection:changed', { selectedIds });
  }

  /**
   * Check if a circle intersects a rectangle
   * Used for smooth selection feel where entities near the box edge are selected
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
    // Find the closest point on the rectangle to the circle center
    const closestX = Math.max(rectMinX, Math.min(cx, rectMaxX));
    const closestY = Math.max(rectMinY, Math.min(cy, rectMaxY));

    // Calculate distance from circle center to closest point
    const dx = cx - closestX;
    const dy = cy - closestY;
    const distanceSquared = dx * dx + dy * dy;

    // Circle intersects if distance is less than radius
    return distanceSquared <= radius * radius;
  }

  /**
   * World-space box selection (legacy fallback)
   * Now includes selection radius buffer for partial overlap detection
   */
  private handleBoxSelection(data: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    additive: boolean;
    playerId: string;
  }): void {
    const { startX, startY, endX, endY, additive, playerId } = data;

    const minX = Math.min(startX, endX);
    const maxX = Math.max(startX, endX);
    const minY = Math.min(startY, endY);
    const maxY = Math.max(startY, endY);

    // Calculate box size for adaptive buffer
    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;
    const boxSize = Math.sqrt(boxWidth * boxWidth + boxHeight * boxHeight);

    const entities = this.world.getEntitiesWith('Transform', 'Selectable');

    // First, deselect all if not additive
    if (!additive) {
      for (const entity of entities) {
        const selectable = entity.get<Selectable>('Selectable')!;
        selectable.deselect();
      }
    }

    // Collect entities within box, separating units from buildings
    const unitIds: number[] = [];
    const buildingIds: number[] = [];

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health');
      const unit = entity.get<Unit>('Unit');
      const building = entity.get<Building>('Building');

      // Only select own units/buildings
      if (selectable.playerId !== playerId) continue;

      // Skip dead entities
      if (health && health.isDead()) continue;

      // Use selection radius as a buffer - entity is selected if ANY part overlaps box
      // This makes selection feel more generous and less frustrating
      const visualScale = selectable.visualScale ?? 1;
      const effectiveRadius = selectable.selectionRadius * visualScale;

      // For small boxes (near-clicks), use a more generous radius
      const isSmallBox = boxSize < 2;
      const buffer = isSmallBox ? effectiveRadius * 1.2 : effectiveRadius * 0.8;

      // Check if entity's bounding circle overlaps with selection box
      // This is circle-rectangle intersection
      const closestX = Math.max(minX, Math.min(transform.x, maxX));
      const closestY = Math.max(minY, Math.min(transform.y, maxY));
      const dx = transform.x - closestX;
      const dy = transform.y - closestY;
      const distanceSquared = dx * dx + dy * dy;

      if (distanceSquared <= buffer * buffer) {
        if (unit) {
          unitIds.push(entity.id);
        } else if (building) {
          buildingIds.push(entity.id);
        }
      }
    }

    // Prioritize units over buildings - if any units are selected, ignore buildings
    const selectedIds = unitIds.length > 0 ? unitIds : buildingIds;

    // Mark entities as selected
    for (const entityId of selectedIds) {
      const entity = this.world.getEntity(entityId);
      if (entity) {
        const selectable = entity.get<Selectable>('Selectable');
        if (selectable) {
          selectable.select();
        }
      }
    }

    // Update store
    if (additive) {
      const current = useGameStore.getState().selectedUnits;
      // PERF: Avoid multiple spread operations by using Set directly
      const combinedSet = new Set(current);
      for (let i = 0; i < selectedIds.length; i++) {
        combinedSet.add(selectedIds[i]);
      }
      useGameStore.getState().selectUnits(Array.from(combinedSet));
    } else {
      useGameStore.getState().selectUnits(selectedIds);
    }

    this.game.eventBus.emit('selection:changed', { selectedIds });
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

    if (!this.worldToScreenFn) {
      // Fallback to world-space click (shouldn't happen normally)
      return;
    }

    const entities = this.world.getEntitiesWith('Transform', 'Selectable');
    let closestEntity: { id: number; distance: number; priority: number } | null = null;

    // Find closest entity to click point in screen space
    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health');

      // Allow selecting own units/buildings OR neutral entities (resources)
      if (selectable.playerId !== playerId && selectable.playerId !== 'neutral') continue;

      // Skip dead units
      if (health && health.isDead()) continue;

      // PERF: Early reject entities outside viewport bounds (world space culling)
      if (!this.isInViewport(transform.x, transform.y)) continue;

      // Convert entity to screen space - must include terrain height + visual offset
      const terrainHeight = this.getTerrainHeightFn ? this.getTerrainHeightFn(transform.x, transform.y) : 0;
      const visualHeight = selectable.visualHeight ?? 0;
      const worldY = terrainHeight + visualHeight;
      const screenPos = this.worldToScreenFn(transform.x, transform.y, worldY);
      if (!screenPos) continue; // Behind camera

      // Calculate screen-space distance
      const screenDistance = distance(screenX, screenY, screenPos.x, screenPos.y);

      // Calculate screen-space selection radius (more generous for better feel)
      const visualScale = selectable.visualScale ?? 1;
      const baseScreenRadius = selectable.selectionRadius * 30; // Pixels per world unit
      const screenRadius = baseScreenRadius * visualScale;

      if (screenDistance <= screenRadius) {
        // Check if this is closer or higher priority
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
          };
        }
      }
    }

    // Handle Ctrl+click or double-click - select all of same type
    if (selectAllOfType && closestEntity) {
      const clickedEntity = this.world.getEntity(closestEntity.id);
      if (clickedEntity) {
        const clickedUnit = clickedEntity.get<Unit>('Unit');
        if (clickedUnit) {
          this.selectAllOfUnitType(clickedUnit.unitId, playerId, additive);
          return;
        }
        const clickedBuilding = clickedEntity.get<Building>('Building');
        if (clickedBuilding) {
          this.selectAllOfBuildingType(clickedBuilding.buildingId, playerId, additive);
          return;
        }
      }
    }

    // Clear selection if not additive
    if (!additive) {
      for (const entity of entities) {
        const selectable = entity.get<Selectable>('Selectable')!;
        selectable.deselect();
      }
    }

    // Select the clicked entity
    const selectedIds: number[] = [];
    if (closestEntity) {
      const entity = this.world.getEntity(closestEntity.id);
      if (entity) {
        const selectable = entity.get<Selectable>('Selectable')!;

        // If additive and already selected, deselect
        if (additive && selectable.isSelected) {
          selectable.deselect();
        } else {
          selectable.select();
          selectedIds.push(entity.id);
        }
      }
    }

    // Update store
    if (!additive) {
      useGameStore.getState().selectUnits(selectedIds);
    } else {
      const current = useGameStore.getState().selectedUnits;
      if (closestEntity && selectedIds.length > 0) {
        useGameStore.getState().selectUnits([...current, ...selectedIds]);
      } else if (closestEntity) {
        useGameStore.getState().selectUnits(current.filter((id) => id !== closestEntity!.id));
      }
    }

    this.game.eventBus.emit('selection:changed', { selectedIds });
  }

  /**
   * World-space click selection (legacy fallback)
   * Now with improved selection radius handling
   */
  private handleClickSelection(data: {
    x: number;
    y: number;
    additive: boolean;
    selectAllOfType?: boolean;
    playerId: string;
  }): void {
    const { x, y, additive, selectAllOfType, playerId } = data;

    const entities = this.world.getEntitiesWith('Transform', 'Selectable');
    let closestEntity: { id: number; distance: number; priority: number } | null = null;

    // Find closest entity to click point (only own units/buildings OR neutral resources)
    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health');

      // Allow selecting own units/buildings OR neutral entities (resources)
      // Neutral resources (minerals, vespene) should be selectable by anyone
      if (selectable.playerId !== playerId && selectable.playerId !== 'neutral') continue;

      // Skip dead units
      if (health && health.isDead()) continue;

      const distance = transform.distanceToPoint(x, y);

      // Use visual scale to increase selection radius for larger units
      const visualScale = selectable.visualScale ?? 1;
      const effectiveRadius = selectable.selectionRadius * visualScale * 1.2; // 20% more generous

      if (distance <= effectiveRadius) {
        // Check if this is closer or higher priority
        if (
          !closestEntity ||
          selectable.selectionPriority > closestEntity.priority ||
          (selectable.selectionPriority === closestEntity.priority &&
            distance < closestEntity.distance)
        ) {
          closestEntity = {
            id: entity.id,
            distance,
            priority: selectable.selectionPriority,
          };
        }
      }
    }

    // Handle Ctrl+click or double-click - select all of same type
    if (selectAllOfType && closestEntity) {
      const clickedEntity = this.world.getEntity(closestEntity.id);
      if (clickedEntity) {
        const clickedUnit = clickedEntity.get<Unit>('Unit');
        if (clickedUnit) {
          this.selectAllOfUnitType(clickedUnit.unitId, playerId, additive);
          return;
        }
        // Also support buildings for double-click selection
        const clickedBuilding = clickedEntity.get<Building>('Building');
        if (clickedBuilding) {
          this.selectAllOfBuildingType(clickedBuilding.buildingId, playerId, additive);
          return;
        }
      }
    }

    // Clear selection if not additive
    if (!additive) {
      for (const entity of entities) {
        const selectable = entity.get<Selectable>('Selectable')!;
        selectable.deselect();
      }
    }

    // Select the clicked entity
    const selectedIds: number[] = [];
    if (closestEntity) {
      const entity = this.world.getEntity(closestEntity.id);
      if (entity) {
        const selectable = entity.get<Selectable>('Selectable')!;

        // If additive and already selected, deselect
        if (additive && selectable.isSelected) {
          selectable.deselect();
        } else {
          selectable.select();
          selectedIds.push(entity.id);
        }
      }
    }

    // Update store
    if (!additive) {
      useGameStore.getState().selectUnits(selectedIds);
    } else {
      const current = useGameStore.getState().selectedUnits;
      if (closestEntity && selectedIds.length > 0) {
        useGameStore.getState().selectUnits([...current, ...selectedIds]);
      } else if (closestEntity) {
        useGameStore.getState().selectUnits(current.filter((id) => id !== closestEntity!.id));
      }
    }

    this.game.eventBus.emit('selection:changed', { selectedIds });
  }

  private selectAllOfUnitType(unitId: string, playerId: string, additive: boolean): void {
    const entities = this.world.getEntitiesWith('Unit', 'Selectable');
    const selectedIds: number[] = [];

    // Clear selection if not additive
    if (!additive) {
      for (const entity of entities) {
        const selectable = entity.get<Selectable>('Selectable')!;
        selectable.deselect();
      }
    }

    // Select all units of the same type belonging to the player within viewport
    for (const entity of entities) {
      const unit = entity.get<Unit>('Unit')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');

      // Skip dead units
      if (health && health.isDead()) continue;

      // Only select units within the current viewport
      if (transform && !this.isInViewport(transform.x, transform.y)) continue;

      if (unit.unitId === unitId && selectable.playerId === playerId) {
        selectable.select();
        selectedIds.push(entity.id);
      }
    }

    // Update store
    if (additive) {
      const current = useGameStore.getState().selectedUnits;
      // PERF: Avoid multiple spread operations by using Set directly
      const combinedSet = new Set(current);
      for (let i = 0; i < selectedIds.length; i++) {
        combinedSet.add(selectedIds[i]);
      }
      useGameStore.getState().selectUnits(Array.from(combinedSet));
    } else {
      useGameStore.getState().selectUnits(selectedIds);
    }

    this.game.eventBus.emit('selection:changed', { selectedIds });
  }

  private selectAllOfBuildingType(buildingId: string, playerId: string, additive: boolean): void {
    const entities = this.world.getEntitiesWith('Building', 'Selectable');
    const selectedIds: number[] = [];

    // Clear selection if not additive (clear all selectable entities, not just buildings)
    if (!additive) {
      const allSelectable = this.world.getEntitiesWith('Selectable');
      for (const entity of allSelectable) {
        const selectable = entity.get<Selectable>('Selectable')!;
        selectable.deselect();
      }
    }

    // Select all buildings of the same type belonging to the player within viewport
    for (const entity of entities) {
      const building = entity.get<Building>('Building')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');

      // Skip destroyed buildings
      if (health && health.isDead()) continue;

      // Only select buildings within the current viewport
      if (transform && !this.isInViewport(transform.x, transform.y)) continue;

      if (building.buildingId === buildingId && selectable.playerId === playerId) {
        selectable.select();
        selectedIds.push(entity.id);
      }
    }

    // Update store
    if (additive) {
      const current = useGameStore.getState().selectedUnits;
      // PERF: Avoid multiple spread operations by using Set directly
      const combinedSet = new Set(current);
      for (let i = 0; i < selectedIds.length; i++) {
        combinedSet.add(selectedIds[i]);
      }
      useGameStore.getState().selectUnits(Array.from(combinedSet));
    } else {
      useGameStore.getState().selectUnits(selectedIds);
    }

    this.game.eventBus.emit('selection:changed', { selectedIds });
  }

  private handleSetControlGroup(data: { group: number; entityIds: number[] }): void {
    const { group, entityIds } = data;

    // Clear previous control group assignments for this group
    const entities = this.world.getEntitiesWith('Selectable');
    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      if (selectable.controlGroup === group) {
        selectable.controlGroup = null;
      }
    }

    // Assign new control group
    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (entity) {
        const selectable = entity.get<Selectable>('Selectable');
        if (selectable) {
          selectable.controlGroup = group;
        }
      }
    }

    this.controlGroups.set(group, entityIds);
    useGameStore.getState().setControlGroup(group, entityIds);
  }

  private handleGetControlGroup(data: { group: number }): void {
    const { group } = data;
    const entityIds = this.controlGroups.get(group) || [];

    // Filter out dead entities
    const validIds = entityIds.filter((id) => {
      const entity = this.world.getEntity(id);
      return entity && !entity.isDestroyed();
    });

    // Update the stored group if entities were removed
    if (validIds.length !== entityIds.length) {
      this.controlGroups.set(group, validIds);
    }

    // Clear current selection and select control group
    const entities = this.world.getEntitiesWith('Selectable');
    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      selectable.deselect();
    }

    for (const entityId of validIds) {
      const entity = this.world.getEntity(entityId);
      if (entity) {
        const selectable = entity.get<Selectable>('Selectable');
        if (selectable) {
          selectable.select();
        }
      }
    }

    useGameStore.getState().selectUnits(validIds);
    this.game.eventBus.emit('selection:changed', { selectedIds: validIds });
  }

  private handleClearSelection(): void {
    const entities = this.world.getEntitiesWith('Selectable');
    for (const entity of entities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      selectable.deselect();
    }

    useGameStore.getState().selectUnits([]);
    this.game.eventBus.emit('selection:changed', { selectedIds: [] });
  }

  public update(_deltaTime: number): void {
    // Auto-deselect dead units
    const selectedUnits = useGameStore.getState().selectedUnits;
    let needsUpdate = false;
    const validSelectedIds: number[] = [];

    for (const entityId of selectedUnits) {
      const entity = this.world.getEntity(entityId);
      if (!entity || entity.isDestroyed()) {
        needsUpdate = true;
        continue;
      }

      const health = entity.get<Health>('Health');
      if (health && health.isDead()) {
        // Deselect dead unit
        const selectable = entity.get<Selectable>('Selectable');
        if (selectable) {
          selectable.deselect();
        }
        needsUpdate = true;
        continue;
      }

      validSelectedIds.push(entityId);
    }

    // Update store if selection changed
    if (needsUpdate) {
      useGameStore.getState().selectUnits(validSelectedIds);
      this.game.eventBus.emit('selection:changed', { selectedIds: validSelectedIds });
    }
  }
}

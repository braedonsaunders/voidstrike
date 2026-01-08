import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Selectable } from '../components/Selectable';
import { Unit } from '../components/Unit';
import { Game } from '../core/Game';
import { useGameStore } from '@/store/gameStore';

export class SelectionSystem extends System {
  public priority = 1;

  private controlGroups: Map<number, number[]> = new Map();

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('selection:box', this.handleBoxSelection.bind(this));
    this.game.eventBus.on('selection:click', this.handleClickSelection.bind(this));
    this.game.eventBus.on('selection:controlGroup:set', this.handleSetControlGroup.bind(this));
    this.game.eventBus.on('selection:controlGroup:get', this.handleGetControlGroup.bind(this));
    this.game.eventBus.on('selection:clear', this.handleClearSelection.bind(this));
  }

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

    const entities = this.world.getEntitiesWith('Transform', 'Selectable');
    const selectedIds: number[] = [];

    // First, deselect all if not additive
    if (!additive) {
      for (const entity of entities) {
        const selectable = entity.get<Selectable>('Selectable')!;
        selectable.deselect();
      }
    }

    // Select entities within box
    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      // Only select own units
      if (selectable.playerId !== playerId) continue;

      if (
        transform.x >= minX &&
        transform.x <= maxX &&
        transform.y >= minY &&
        transform.y <= maxY
      ) {
        selectable.select();
        selectedIds.push(entity.id);
      }
    }

    // Update store
    useGameStore.getState().selectUnits(selectedIds);

    this.game.eventBus.emit('selection:changed', { selectedIds });
  }

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

    // Find closest entity to click point (only own units/buildings)
    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      // Only allow selecting own units/buildings
      if (selectable.playerId !== playerId) continue;

      const distance = transform.distanceToPoint(x, y);

      if (distance <= selectable.selectionRadius) {
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

    // Handle Ctrl+click - select all of same type
    if (selectAllOfType && closestEntity) {
      const clickedEntity = this.world.getEntity(closestEntity.id);
      if (clickedEntity) {
        const clickedUnit = clickedEntity.get<Unit>('Unit');
        if (clickedUnit) {
          this.selectAllOfUnitType(clickedUnit.unitId, playerId, additive);
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

    // Select all units of the same type belonging to the player
    for (const entity of entities) {
      const unit = entity.get<Unit>('Unit')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      if (unit.unitId === unitId && selectable.playerId === playerId) {
        selectable.select();
        selectedIds.push(entity.id);
      }
    }

    // Update store
    if (additive) {
      const current = useGameStore.getState().selectedUnits;
      const combined = [...new Set([...current, ...selectedIds])];
      useGameStore.getState().selectUnits(combined);
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
    // Selection system is event-driven, no per-tick updates needed
  }
}

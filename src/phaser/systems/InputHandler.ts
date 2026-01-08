import * as Phaser from 'phaser';
import { Game } from '@/engine/core/Game';
import { RTSCamera } from './RTSCamera';
import { useGameStore } from '@/store/gameStore';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Resource } from '@/engine/components/Resource';
import { Selectable } from '@/engine/components/Selectable';
import { Health } from '@/engine/components/Health';

export class InputHandler extends Phaser.Events.EventEmitter {
  private scene: Phaser.Scene;
  private game: Game;
  private rtsCamera: RTSCamera;

  // Selection state
  private isSelecting = false;
  private selectionStart = { x: 0, y: 0 };

  // Double-click tracking
  private lastClickTime = 0;
  private lastClickPos = { x: 0, y: 0 };
  private readonly DOUBLE_CLICK_TIME = 400; // ms - slightly longer for better detection
  private readonly DOUBLE_CLICK_DIST = 30; // pixels - more forgiving for slight mouse movement

  // Command modes
  private isAttackMove = false;
  private isPatrolMode = false;

  constructor(scene: Phaser.Scene, game: Game, rtsCamera: RTSCamera) {
    super();
    this.scene = scene;
    this.game = game;
    this.rtsCamera = rtsCamera;

    this.setupInput();
  }

  private setupInput(): void {
    // Left click - selection or command
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.handleLeftClick(pointer);
      } else if (pointer.rightButtonDown()) {
        this.handleRightClick(pointer);
      }
    });

    // Mouse move for selection box
    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isSelecting && pointer.leftButtonDown()) {
        this.scene.events.emit('selection-move', { x: pointer.x, y: pointer.y });
      }
    });

    // Mouse up - finish selection
    this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonReleased() && this.isSelecting) {
        this.handleSelectionEnd(pointer);
      }
    });

    // Prevent context menu
    this.scene.input.mouse?.disableContextMenu();
  }

  private handleLeftClick(pointer: Phaser.Input.Pointer): void {
    const worldPos = this.rtsCamera.screenToWorld(pointer.x, pointer.y);
    const store = useGameStore.getState();

    // Check for attack-move mode
    if (this.isAttackMove) {
      const selectedUnits = store.selectedUnits;
      if (selectedUnits.length > 0) {
        this.game.eventBus.emit('command:attack', {
          entityIds: selectedUnits,
          targetPosition: worldPos,
          queue: pointer.event.shiftKey,
        });
      }
      if (!pointer.event.shiftKey) {
        this.setAttackMoveMode(false);
      }
      return;
    }

    // Check for patrol mode
    if (this.isPatrolMode) {
      const selectedUnits = store.selectedUnits;
      if (selectedUnits.length > 0) {
        this.game.eventBus.emit('command:patrol', {
          entityIds: selectedUnits,
          targetPosition: worldPos,
        });
      }
      this.setPatrolMode(false);
      return;
    }

    // Check for ability targeting mode
    const abilityTargetMode = store.abilityTargetMode;
    if (abilityTargetMode) {
      const selectedUnits = store.selectedUnits;
      const clickedEntity = this.findEntityAtPosition(worldPos.x, worldPos.y);

      this.game.eventBus.emit('command:ability', {
        entityIds: selectedUnits,
        abilityId: abilityTargetMode,
        targetPosition: worldPos,
        targetEntityId: clickedEntity?.id,
      });
      store.setAbilityTargetMode(null);
      return;
    }

    // Check for building placement mode
    const { isBuilding, buildingType } = store;
    if (isBuilding && buildingType) {
      const selectedUnits = store.selectedUnits;
      this.game.eventBus.emit('building:place', {
        buildingType,
        position: worldPos,
        workerId: selectedUnits.length > 0 ? selectedUnits[0] : undefined,
      });
      store.setBuildingMode(null);
      return;
    }

    // Start selection box
    this.isSelecting = true;
    this.selectionStart = { x: pointer.x, y: pointer.y };
    this.scene.events.emit('selection-start', { x: pointer.x, y: pointer.y });
  }

  private handleRightClick(pointer: Phaser.Input.Pointer): void {
    const worldPos = this.rtsCamera.screenToWorld(pointer.x, pointer.y);
    const store = useGameStore.getState();

    // Cancel attack-move or patrol mode
    if (this.isAttackMove) {
      this.setAttackMoveMode(false);
      return;
    }
    if (this.isPatrolMode) {
      this.setPatrolMode(false);
      return;
    }

    // Handle rally point mode
    if (store.isSettingRallyPoint) {
      const selectedUnits = store.selectedUnits;
      // Check if clicking on a resource for auto-gather rally
      const clickedEntity = this.findEntityAtPosition(worldPos.x, worldPos.y);
      let targetId: number | undefined = undefined;
      if (clickedEntity) {
        const entity = this.game.world.getEntity(clickedEntity.id);
        if (entity?.get<Resource>('Resource')) {
          targetId = clickedEntity.id;
        }
      }
      for (const buildingId of selectedUnits) {
        this.game.eventBus.emit('rally:set', {
          buildingId,
          x: worldPos.x,
          y: worldPos.y,
          targetId,
        });
      }
      store.setRallyPointMode(false);
      return;
    }

    const selectedUnits = store.selectedUnits;
    if (selectedUnits.length === 0) return;

    const queue = pointer.event.shiftKey;

    // Smart right-click: detect what we clicked on
    const clickedEntity = this.findEntityAtPosition(worldPos.x, worldPos.y);

    if (clickedEntity) {
      const entity = this.game.world.getEntity(clickedEntity.id);
      if (entity) {
        const resource = entity.get<Resource>('Resource');
        const selectable = entity.get<Selectable>('Selectable');
        const health = entity.get<Health>('Health');

        // Check if clicking on a resource (for gathering)
        if (resource) {
          const hasWorkers = selectedUnits.some(id => {
            const e = this.game.world.getEntity(id);
            const unit = e?.get<Unit>('Unit');
            return unit?.isWorker;
          });

          if (hasWorkers) {
            this.game.eventBus.emit('command:gather', {
              entityIds: selectedUnits,
              targetEntityId: clickedEntity.id,
              queue,
            });
            return;
          }
        }

        // Check if clicking on an enemy unit/building (for attacking)
        if (selectable && selectable.playerId !== 'player1' && health && !health.isDead()) {
          this.game.eventBus.emit('command:attack', {
            entityIds: selectedUnits,
            targetEntityId: clickedEntity.id,
            queue,
          });
          return;
        }
      }
    }

    // Default: move command
    this.game.eventBus.emit('command:move', {
      entityIds: selectedUnits,
      targetPosition: worldPos,
      queue,
    });
  }

  private handleSelectionEnd(pointer: Phaser.Input.Pointer): void {
    this.isSelecting = false;
    this.scene.events.emit('selection-end');

    const startWorld = this.rtsCamera.screenToWorld(this.selectionStart.x, this.selectionStart.y);
    const endWorld = this.rtsCamera.screenToWorld(pointer.x, pointer.y);

    const dx = Math.abs(endWorld.x - startWorld.x);
    const dy = Math.abs(endWorld.y - startWorld.y);

    // Check for double-click
    const now = Date.now();
    const clickDx = Math.abs(pointer.x - this.lastClickPos.x);
    const clickDy = Math.abs(pointer.y - this.lastClickPos.y);
    const isDoubleClick = (now - this.lastClickTime < this.DOUBLE_CLICK_TIME) &&
                          (clickDx < this.DOUBLE_CLICK_DIST) &&
                          (clickDy < this.DOUBLE_CLICK_DIST);

    // Update last click tracking
    this.lastClickTime = now;
    this.lastClickPos = { x: pointer.x, y: pointer.y };

    if (dx > 1 || dy > 1) {
      // Box selection
      this.game.eventBus.emit('selection:box', {
        startX: Math.min(startWorld.x, endWorld.x),
        startY: Math.min(startWorld.y, endWorld.y),
        endX: Math.max(startWorld.x, endWorld.x),
        endY: Math.max(startWorld.y, endWorld.y),
        additive: pointer.event.shiftKey,
        playerId: 'player1',
      });
    } else {
      // Click selection - double-click selects all of same type
      this.game.eventBus.emit('selection:click', {
        x: endWorld.x,
        y: endWorld.y,
        additive: pointer.event.shiftKey,
        selectAllOfType: pointer.event.ctrlKey || isDoubleClick,
        playerId: 'player1',
      });
    }
  }

  private findEntityAtPosition(x: number, y: number): { id: number } | null {
    const clickRadius = 1.5;

    // Check resources first
    const resources = this.game.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;
      const dx = transform.x - x;
      const dy = transform.y - y;
      if (dx * dx + dy * dy < clickRadius * clickRadius) {
        return { id: entity.id };
      }
    }

    // Check units
    const units = this.game.world.getEntitiesWith('Unit', 'Transform', 'Health');
    for (const entity of units) {
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      if (health.isDead()) continue;
      const dx = transform.x - x;
      const dy = transform.y - y;
      if (dx * dx + dy * dy < clickRadius * clickRadius) {
        return { id: entity.id };
      }
    }

    // Check buildings
    const buildings = this.game.world.getEntitiesWith('Building', 'Transform', 'Health');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      if (health.isDead()) continue;
      const dx = transform.x - x;
      const dy = transform.y - y;
      if (dx * dx + dy * dy < 4) {
        return { id: entity.id };
      }
    }

    return null;
  }

  setAttackMoveMode(enabled: boolean): void {
    this.isAttackMove = enabled;
    this.emit(enabled ? 'attack-move-start' : 'attack-move-end');
  }

  setPatrolMode(enabled: boolean): void {
    this.isPatrolMode = enabled;
    this.emit(enabled ? 'patrol-start' : 'patrol-end');
  }

  update(): void {
    // Additional per-frame input handling if needed
  }

  destroy(): void {
    this.scene.input.off('pointerdown');
    this.scene.input.off('pointermove');
    this.scene.input.off('pointerup');
    this.removeAllListeners();
  }
}

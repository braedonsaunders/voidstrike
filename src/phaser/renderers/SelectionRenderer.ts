import * as Phaser from 'phaser';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Selectable } from '@/engine/components/Selectable';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { CELL_SIZE, DEPTH } from '../constants';
import { getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';
import type { EventBus } from '@/engine/core/EventBus';

interface FlashSelection {
  entityId: number;
  color: number;
  remainingTime: number;
  totalTime: number;
}

export class SelectionRenderer {
  private scene: Phaser.Scene;
  private world: World;
  private eventBus: EventBus | null = null;

  private selectionGraphics: Phaser.GameObjects.Graphics;
  private flashSelections: FlashSelection[] = [];

  constructor(scene: Phaser.Scene, world: World) {
    this.scene = scene;
    this.world = world;

    this.selectionGraphics = scene.add.graphics();
    this.selectionGraphics.setDepth(DEPTH.SELECTION);
  }

  /**
   * Set up event bus listener for flash selection events
   */
  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
    this.eventBus.on('ui:flash_selection', (data: { entityId: number; color?: number; duration?: number }) => {
      this.flashSelection(data.entityId, data.color ?? 0x00ff00, data.duration ?? 300);
    });
  }

  /**
   * Show a temporary flashing selection ring on an entity
   */
  flashSelection(entityId: number, color: number, duration: number): void {
    // Remove any existing flash for this entity
    this.flashSelections = this.flashSelections.filter(f => f.entityId !== entityId);

    // Add new flash
    this.flashSelections.push({
      entityId,
      color,
      remainingTime: duration,
      totalTime: duration,
    });
  }

  update(deltaTime: number = 16): void {
    this.selectionGraphics.clear();

    // Draw selection circles for all selected entities
    const selectableEntities = this.world.getEntitiesWith('Transform', 'Selectable');

    for (const entity of selectableEntities) {
      const selectable = entity.get<Selectable>('Selectable')!;
      if (!selectable.isSelected) continue;

      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit');
      const building = entity.get<Building>('Building');

      const localPlayerId = getLocalPlayerId();
      const isSpectating = isSpectatorMode() || !localPlayerId;
      const isOwned = !isSpectating && selectable.playerId === localPlayerId;
      const color = isOwned ? 0x00ff00 : 0xff0000;

      // Convert grid coordinates to pixel coordinates
      const px = transform.x * CELL_SIZE;
      const py = transform.y * CELL_SIZE;

      if (building) {
        // Building selection - rectangle (scale size with CELL_SIZE)
        const size = (building.width || 3) * CELL_SIZE / 2;
        this.selectionGraphics.lineStyle(2, color, 0.8);
        this.selectionGraphics.strokeRect(px - size, py - size, size * 2, size * 2);
      } else {
        // Unit selection - circle
        const radius = unit?.isWorker ? 12 : 14;
        this.selectionGraphics.lineStyle(2, color, 0.8);
        this.selectionGraphics.strokeCircle(px, py, radius);
      }
    }

    // Draw flash selections (temporary visual feedback)
    this.updateFlashSelections(deltaTime);
  }

  private updateFlashSelections(deltaTime: number): void {
    // Filter out expired flashes and update remaining ones
    this.flashSelections = this.flashSelections.filter(flash => {
      flash.remainingTime -= deltaTime;
      if (flash.remainingTime <= 0) return false;

      // Get entity
      const entity = this.world.getEntity(flash.entityId);
      if (!entity) return false;

      const transform = entity.get<Transform>('Transform');
      if (!transform) return false;

      const building = entity.get<Building>('Building');
      const unit = entity.get<Unit>('Unit');

      // Calculate alpha based on remaining time (pulsing effect)
      const progress = flash.remainingTime / flash.totalTime;
      const pulse = Math.sin(progress * Math.PI * 3) * 0.3 + 0.7; // Pulsing between 0.4 and 1.0
      const alpha = progress * pulse;

      // Convert grid coordinates to pixel coordinates
      const px = transform.x * CELL_SIZE;
      const py = transform.y * CELL_SIZE;

      if (building) {
        // Building flash - rectangle
        const size = (building.width || 3) * CELL_SIZE / 2;
        this.selectionGraphics.lineStyle(3, flash.color, alpha);
        this.selectionGraphics.strokeRect(px - size, py - size, size * 2, size * 2);
      } else {
        // Unit flash - circle
        const radius = unit?.isWorker ? 14 : 16;
        this.selectionGraphics.lineStyle(3, flash.color, alpha);
        this.selectionGraphics.strokeCircle(px, py, radius);
      }

      return true;
    });
  }

  destroy(): void {
    this.selectionGraphics.destroy();
    this.flashSelections = [];
  }
}

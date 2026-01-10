import * as Phaser from 'phaser';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Selectable } from '@/engine/components/Selectable';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { CELL_SIZE, DEPTH } from '../constants';
import { getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';

export class SelectionRenderer {
  private scene: Phaser.Scene;
  private world: World;

  private selectionGraphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, world: World) {
    this.scene = scene;
    this.world = world;

    this.selectionGraphics = scene.add.graphics();
    this.selectionGraphics.setDepth(DEPTH.SELECTION);
  }

  update(): void {
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
  }

  destroy(): void {
    this.selectionGraphics.destroy();
  }
}

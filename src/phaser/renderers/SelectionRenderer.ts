import * as Phaser from 'phaser';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Selectable } from '@/engine/components/Selectable';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';

export class SelectionRenderer {
  private scene: Phaser.Scene;
  private world: World;

  private selectionGraphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, world: World) {
    this.scene = scene;
    this.world = world;

    this.selectionGraphics = scene.add.graphics();
    this.selectionGraphics.setDepth(150); // Above units
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

      const isOwned = selectable.playerId === 'player1';
      const color = isOwned ? 0x00ff00 : 0xff0000;

      if (building) {
        // Building selection - rectangle
        const size = (building.width || 3) * 4;
        this.selectionGraphics.lineStyle(2, color, 0.8);
        this.selectionGraphics.strokeRect(
          transform.x - size,
          transform.y - size,
          size * 2,
          size * 2
        );
      } else {
        // Unit selection - circle
        const radius = unit?.isWorker ? 8 : 10;
        this.selectionGraphics.lineStyle(2, color, 0.8);
        this.selectionGraphics.strokeCircle(transform.x, transform.y, radius);
      }
    }
  }

  destroy(): void {
    this.selectionGraphics.destroy();
  }
}

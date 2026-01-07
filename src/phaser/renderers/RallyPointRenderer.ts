import * as Phaser from 'phaser';
import { World } from '@/engine/ecs/World';
import { EventBus } from '@/engine/core/EventBus';
import { Transform } from '@/engine/components/Transform';
import { Building } from '@/engine/components/Building';
import { Selectable } from '@/engine/components/Selectable';

interface RallyPoint {
  buildingId: number;
  x: number;
  y: number;
}

export class RallyPointRenderer {
  private scene: Phaser.Scene;
  private world: World;
  private eventBus: EventBus;
  private playerId = 'player1';

  private graphics: Phaser.GameObjects.Graphics;
  private rallyPoints: Map<number, RallyPoint> = new Map();

  constructor(scene: Phaser.Scene, world: World, eventBus: EventBus) {
    this.scene = scene;
    this.world = world;
    this.eventBus = eventBus;

    this.graphics = scene.add.graphics();
    this.graphics.setDepth(120); // Above buildings, below units

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.eventBus.on('rally:set', (data: { buildingId: number; x: number; y: number }) => {
      this.rallyPoints.set(data.buildingId, {
        buildingId: data.buildingId,
        x: data.x,
        y: data.y,
      });
    });

    this.eventBus.on('rally:clear', (data: { buildingId: number }) => {
      this.rallyPoints.delete(data.buildingId);
    });
  }

  update(): void {
    this.graphics.clear();

    // Get selected buildings
    const selectedBuildings = this.world.getEntitiesWith('Transform', 'Building', 'Selectable')
      .filter(entity => {
        const selectable = entity.get<Selectable>('Selectable')!;
        const building = entity.get<Building>('Building')!;
        return selectable.isSelected &&
               selectable.playerId === this.playerId &&
               building.buildProgress >= 1;
      });

    // Draw rally points for selected buildings
    for (const entity of selectedBuildings) {
      const transform = entity.get<Transform>('Transform')!;
      const rallyPoint = this.rallyPoints.get(entity.id);

      if (rallyPoint) {
        this.drawRallyPoint(transform.x, transform.y, rallyPoint.x, rallyPoint.y);
      }
    }
  }

  private drawRallyPoint(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): void {
    // Draw line from building to rally point
    this.graphics.lineStyle(2, 0x00ff00, 0.6);
    this.graphics.lineBetween(fromX, fromY, toX, toY);

    // Draw rally point marker (flag shape)
    this.graphics.fillStyle(0x00ff00, 0.9);

    // Flag pole
    this.graphics.lineStyle(2, 0x00aa00, 1);
    this.graphics.lineBetween(toX, toY, toX, toY - 16);

    // Flag
    this.graphics.fillStyle(0x00ff00, 0.9);
    this.graphics.fillTriangle(
      toX, toY - 16,
      toX + 10, toY - 12,
      toX, toY - 8
    );

    // Ground marker
    this.graphics.lineStyle(2, 0x00ff00, 0.8);
    this.graphics.strokeCircle(toX, toY, 4);
  }

  setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  destroy(): void {
    this.graphics.destroy();
    this.rallyPoints.clear();
  }
}

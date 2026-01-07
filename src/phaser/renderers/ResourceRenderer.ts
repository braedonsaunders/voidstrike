import * as Phaser from 'phaser';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Resource } from '@/engine/components/Resource';
import { CELL_SIZE, DEPTH } from '../constants';

interface ResourceSprite {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  amountText?: Phaser.GameObjects.Text;
  resourceType: string;
  lastAmount: number;
}

export class ResourceRenderer {
  private scene: Phaser.Scene;
  private world: World;

  private resourceSprites: Map<number, ResourceSprite> = new Map();
  private container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, world: World) {
    this.scene = scene;
    this.world = world;

    // Create container for all resource sprites
    this.container = scene.add.container(0, 0);
    this.container.setDepth(DEPTH.RESOURCES);
  }

  update(): void {
    const entities = this.world.getEntitiesWith('Transform', 'Resource');
    const currentIds = new Set<number>();

    for (const entity of entities) {
      currentIds.add(entity.id);

      const transform = entity.get<Transform>('Transform')!;
      const resource = entity.get<Resource>('Resource')!;

      let sprite = this.resourceSprites.get(entity.id);

      if (!sprite) {
        sprite = this.createResourceSprite(resource);
        this.resourceSprites.set(entity.id, sprite);
        this.container.add(sprite.container);
      }

      // Update position (convert grid to pixel coordinates)
      sprite.container.setPosition(transform.x * CELL_SIZE, transform.y * CELL_SIZE);

      // Update amount display if changed
      if (sprite.lastAmount !== resource.amount) {
        sprite.lastAmount = resource.amount;
        this.updateResourceVisual(sprite, resource);
      }

      // Hide depleted resources
      sprite.container.setVisible(resource.amount > 0);
    }

    // Remove sprites for destroyed entities
    for (const [entityId, sprite] of this.resourceSprites) {
      if (!currentIds.has(entityId)) {
        sprite.container.destroy();
        this.resourceSprites.delete(entityId);
      }
    }
  }

  private createResourceSprite(resource: Resource): ResourceSprite {
    const container = this.scene.add.container(0, 0);

    // Create resource body graphic
    const body = this.scene.add.graphics();
    this.drawResourceBody(body, resource);
    container.add(body);

    return {
      container,
      body,
      resourceType: resource.resourceType,
      lastAmount: resource.amount,
    };
  }

  private drawResourceBody(graphics: Phaser.GameObjects.Graphics, resource: Resource): void {
    graphics.clear();

    if (resource.resourceType === 'minerals') {
      // Mineral crystal - blue crystalline shape
      const baseColor = 0x4488ff;
      const highlightColor = 0x88ccff;

      // Draw multiple crystal shapes
      for (let i = 0; i < 3; i++) {
        const offsetX = (i - 1) * 8;
        const height = 12 + Math.random() * 4;

        // Crystal body
        graphics.fillStyle(baseColor, 0.9);
        graphics.fillTriangle(
          offsetX, -height,
          offsetX - 5, 0,
          offsetX + 5, 0
        );

        // Highlight
        graphics.fillStyle(highlightColor, 0.6);
        graphics.fillTriangle(
          offsetX, -height,
          offsetX - 2, -height / 2,
          offsetX + 2, 0
        );
      }

      // Glow effect
      graphics.fillStyle(0x4488ff, 0.2);
      graphics.fillCircle(0, -4, 16);
    } else if (resource.resourceType === 'vespene') {
      // Vespene geyser - green/yellow gas effect
      const baseColor = 0x44ff44;

      // Geyser base
      graphics.fillStyle(0x444444, 0.9);
      graphics.fillEllipse(0, 4, 24, 12);

      // Gas vent
      graphics.fillStyle(0x333333, 1);
      graphics.fillEllipse(0, 0, 16, 8);

      // Gas particles (simplified)
      graphics.fillStyle(baseColor, 0.6);
      graphics.fillCircle(-4, -8, 4);
      graphics.fillCircle(2, -12, 3);
      graphics.fillCircle(0, -6, 5);

      // Glow
      graphics.fillStyle(0x88ff88, 0.2);
      graphics.fillCircle(0, -4, 18);
    }
  }

  private updateResourceVisual(sprite: ResourceSprite, resource: Resource): void {
    // Update visual based on remaining amount
    const depletionFactor = Math.min(resource.amount / 1500, 1); // Assume 1500 is full

    // Scale down as resource depletes
    sprite.body.setScale(0.5 + depletionFactor * 0.5);

    // Fade slightly as depleted
    sprite.body.setAlpha(0.6 + depletionFactor * 0.4);
  }

  destroy(): void {
    for (const sprite of this.resourceSprites.values()) {
      sprite.container.destroy();
    }
    this.resourceSprites.clear();
    this.container.destroy();
  }
}

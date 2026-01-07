import * as Phaser from 'phaser';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';

// Player colors (HSL values for tinting)
const PLAYER_COLORS: Record<string, number> = {
  player1: 0x4080ff, // Blue
  ai: 0xff4040,      // Red
  player2: 0x40ff40, // Green
  player3: 0xffff40, // Yellow
  player4: 0xff40ff, // Purple
};

// Unit sizes for rendering
const UNIT_SIZES: Record<string, { width: number; height: number }> = {
  scv: { width: 16, height: 16 },
  marine: { width: 14, height: 18 },
  marauder: { width: 20, height: 22 },
  reaper: { width: 14, height: 18 },
  ghost: { width: 14, height: 20 },
  hellion: { width: 24, height: 16 },
  siege_tank: { width: 28, height: 20 },
  thor: { width: 32, height: 32 },
  medivac: { width: 28, height: 20 },
  viking: { width: 24, height: 24 },
  banshee: { width: 24, height: 20 },
  battlecruiser: { width: 40, height: 32 },
  raven: { width: 20, height: 20 },
};

interface UnitSprite {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  healthBar?: Phaser.GameObjects.Graphics;
  selectionRing?: Phaser.GameObjects.Graphics;
  unitId: string;
  lastState: string;
}

export class UnitRenderer {
  private scene: Phaser.Scene;
  private world: World;
  private visionSystem: VisionSystem | null;
  private fogOfWarEnabled: boolean;
  private playerId = 'player1';

  private unitSprites: Map<number, UnitSprite> = new Map();
  private container: Phaser.GameObjects.Container;

  constructor(
    scene: Phaser.Scene,
    world: World,
    visionSystem?: VisionSystem,
    fogOfWarEnabled = true
  ) {
    this.scene = scene;
    this.world = world;
    this.visionSystem = visionSystem ?? null;
    this.fogOfWarEnabled = fogOfWarEnabled;

    // Create container for all unit sprites (for z-ordering)
    this.container = scene.add.container(0, 0);
    this.container.setDepth(100); // Units above terrain
  }

  update(): void {
    const entities = this.world.getEntitiesWith('Transform', 'Unit');
    const currentIds = new Set<number>();

    for (const entity of entities) {
      currentIds.add(entity.id);

      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');

      const ownerId = selectable?.playerId ?? 'unknown';
      const isOwned = ownerId === this.playerId;
      const isEnemy = selectable && ownerId !== this.playerId;

      // Check visibility for enemy units
      let shouldShow = true;
      if (isEnemy && this.fogOfWarEnabled && this.visionSystem) {
        shouldShow = this.visionSystem.isVisible(this.playerId, transform.x, transform.y);
      }

      // Skip dead units
      if (health && health.isDead()) {
        shouldShow = false;
      }

      let sprite = this.unitSprites.get(entity.id);

      if (!sprite) {
        // Create new sprite for this unit
        sprite = this.createUnitSprite(unit, ownerId);
        this.unitSprites.set(entity.id, sprite);
        this.container.add(sprite.container);
      }

      // Update visibility
      sprite.container.setVisible(shouldShow);

      if (!shouldShow) continue;

      // Update position
      sprite.container.setPosition(transform.x, transform.y);

      // Update rotation (convert from radians)
      sprite.body.setRotation(transform.rotation);

      // Update selection ring
      if (sprite.selectionRing) {
        sprite.selectionRing.setVisible(selectable?.isSelected ?? false);
        if (selectable?.isSelected) {
          sprite.selectionRing.clear();
          sprite.selectionRing.lineStyle(2, isOwned ? 0x00ff00 : 0xff0000, 0.8);
          sprite.selectionRing.strokeCircle(0, 0, 12);
        }
      }

      // Update health bar
      if (sprite.healthBar && health) {
        const percent = health.getHealthPercent();
        sprite.healthBar.setVisible(percent < 1);
        if (percent < 1) {
          this.updateHealthBar(sprite.healthBar, health);
        }
      }

      // Update animation state (simple state-based visual change)
      if (sprite.lastState !== unit.state) {
        sprite.lastState = unit.state;
        this.updateUnitVisual(sprite, unit);
      }
    }

    // Remove sprites for destroyed entities
    for (const [entityId, sprite] of this.unitSprites) {
      if (!currentIds.has(entityId)) {
        sprite.container.destroy();
        this.unitSprites.delete(entityId);
      }
    }

    // Sort units by Y position for proper depth
    this.container.sort('y');
  }

  private createUnitSprite(unit: Unit, playerId: string): UnitSprite {
    const container = this.scene.add.container(0, 0);
    const color = PLAYER_COLORS[playerId] ?? 0x808080;
    const size = UNIT_SIZES[unit.unitId] ?? { width: 16, height: 16 };

    // Create unit body graphic
    const body = this.scene.add.graphics();
    this.drawUnitBody(body, unit, color, size);
    container.add(body);

    // Create selection ring
    const selectionRing = this.scene.add.graphics();
    selectionRing.setVisible(false);
    container.add(selectionRing);

    // Create health bar
    const healthBar = this.scene.add.graphics();
    healthBar.setVisible(false);
    healthBar.setPosition(0, -size.height / 2 - 8);
    container.add(healthBar);

    return {
      container,
      body,
      healthBar,
      selectionRing,
      unitId: unit.unitId,
      lastState: unit.state,
    };
  }

  private drawUnitBody(
    graphics: Phaser.GameObjects.Graphics,
    unit: Unit,
    color: number,
    size: { width: number; height: number }
  ): void {
    graphics.clear();

    const def = UNIT_DEFINITIONS[unit.unitId];
    const isFlying = def?.isFlying ?? false;
    const isWorker = def?.isWorker ?? false;

    // Draw based on unit type
    if (isFlying) {
      // Flying units - diamond shape
      graphics.fillStyle(color, 0.9);
      graphics.fillTriangle(
        0, -size.height / 2,
        size.width / 2, 0,
        0, size.height / 2
      );
      graphics.fillTriangle(
        0, -size.height / 2,
        -size.width / 2, 0,
        0, size.height / 2
      );
      // Shadow
      graphics.fillStyle(0x000000, 0.3);
      graphics.fillEllipse(0, size.height / 2 + 4, size.width * 0.6, 6);
    } else if (isWorker) {
      // Workers - rounded square
      graphics.fillStyle(color, 0.9);
      graphics.fillRoundedRect(-size.width / 2, -size.height / 2, size.width, size.height, 4);
      // Mining tool
      graphics.fillStyle(0xffaa00, 0.9);
      graphics.fillRect(size.width / 2 - 2, -2, 6, 4);
    } else if (unit.unitId === 'siege_tank') {
      // Tank - rectangular with turret
      graphics.fillStyle(color, 0.9);
      graphics.fillRect(-size.width / 2, -size.height / 4, size.width, size.height / 2);
      // Turret
      graphics.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(20).color, 0.9);
      graphics.fillCircle(0, 0, size.height / 3);
      // Barrel
      graphics.fillStyle(0x444444, 1);
      graphics.fillRect(0, -2, size.width / 2, 4);
    } else if (unit.unitId === 'thor') {
      // Thor - large mech
      graphics.fillStyle(color, 0.9);
      graphics.fillRect(-size.width / 2, -size.height / 2, size.width, size.height);
      // Arms
      graphics.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(30).color, 0.9);
      graphics.fillRect(-size.width / 2 - 6, -size.height / 4, 6, size.height / 2);
      graphics.fillRect(size.width / 2, -size.height / 4, 6, size.height / 2);
    } else {
      // Default infantry - circle with direction indicator
      graphics.fillStyle(color, 0.9);
      graphics.fillCircle(0, 0, Math.min(size.width, size.height) / 2);
      // Direction indicator
      graphics.fillStyle(0xffffff, 0.8);
      graphics.fillTriangle(0, -size.height / 2, 4, -2, -4, -2);
    }

    // Add outline
    graphics.lineStyle(1, 0x000000, 0.5);
    graphics.strokeCircle(0, 0, Math.max(size.width, size.height) / 2 + 1);
  }

  private updateUnitVisual(sprite: UnitSprite, unit: Unit): void {
    // Visual feedback based on state
    switch (unit.state) {
      case 'attacking':
        // Slight red tint when attacking
        sprite.body.setAlpha(1);
        break;
      case 'moving':
        sprite.body.setAlpha(0.95);
        break;
      case 'idle':
      default:
        sprite.body.setAlpha(1);
        break;
    }
  }

  private updateHealthBar(graphics: Phaser.GameObjects.Graphics, health: Health): void {
    graphics.clear();

    const width = 20;
    const height = 3;
    const percent = health.getHealthPercent();

    // Background
    graphics.fillStyle(0x333333, 0.8);
    graphics.fillRect(-width / 2, 0, width, height);

    // Health fill
    let fillColor = 0x00ff00;
    if (percent <= 0.3) {
      fillColor = 0xff0000;
    } else if (percent <= 0.6) {
      fillColor = 0xffff00;
    }

    graphics.fillStyle(fillColor, 1);
    graphics.fillRect(-width / 2, 0, width * percent, height);

    // Shield bar (if applicable)
    if (health.maxShield > 0) {
      const shieldPercent = health.getShieldPercent();
      graphics.fillStyle(0x00aaff, 1);
      graphics.fillRect(-width / 2, height + 1, width * shieldPercent, 2);
    }
  }

  setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  destroy(): void {
    for (const sprite of this.unitSprites.values()) {
      sprite.container.destroy();
    }
    this.unitSprites.clear();
    this.container.destroy();
  }
}

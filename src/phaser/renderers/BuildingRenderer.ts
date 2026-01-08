import * as Phaser from 'phaser';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Building } from '@/engine/components/Building';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { CELL_SIZE, DEPTH } from '../constants';
import { getPlayerColor } from '@/store/gameSetupStore';

interface BuildingSprite {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  healthBar?: Phaser.GameObjects.Graphics;
  selectionRing?: Phaser.GameObjects.Graphics;
  progressBar?: Phaser.GameObjects.Graphics;
  buildingId: string;
}

export class BuildingRenderer {
  private scene: Phaser.Scene;
  private world: World;
  private visionSystem: VisionSystem | null;
  private fogOfWarEnabled: boolean;
  private playerId = 'player1';

  private buildingSprites: Map<number, BuildingSprite> = new Map();
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

    // Create container for all building sprites
    this.container = scene.add.container(0, 0);
    this.container.setDepth(DEPTH.BUILDINGS);
  }

  update(): void {
    const entities = this.world.getEntitiesWith('Transform', 'Building');
    const currentIds = new Set<number>();

    for (const entity of entities) {
      currentIds.add(entity.id);

      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');

      const ownerId = selectable?.playerId ?? 'unknown';
      const isOwned = ownerId === this.playerId;
      const isEnemy = selectable && ownerId !== this.playerId;

      // Check visibility
      let shouldShow = true;
      if (isEnemy && this.fogOfWarEnabled && this.visionSystem) {
        shouldShow = this.visionSystem.isVisible(this.playerId, transform.x, transform.y);
      }

      // Skip destroyed buildings
      if (health && health.isDead()) {
        shouldShow = false;
      }

      let sprite = this.buildingSprites.get(entity.id);

      if (!sprite) {
        sprite = this.createBuildingSprite(building, ownerId);
        this.buildingSprites.set(entity.id, sprite);
        this.container.add(sprite.container);
      }

      // Update visibility
      sprite.container.setVisible(shouldShow);

      if (!shouldShow) continue;

      // Update position (convert grid to pixel coordinates)
      sprite.container.setPosition(transform.x * CELL_SIZE, transform.y * CELL_SIZE);

      // Update selection ring
      if (sprite.selectionRing) {
        sprite.selectionRing.setVisible(selectable?.isSelected ?? false);
        if (selectable?.isSelected) {
          const def = BUILDING_DEFINITIONS[building.buildingId];
          const size = (def?.width ?? 3) * 4;
          sprite.selectionRing.clear();
          sprite.selectionRing.lineStyle(2, isOwned ? 0x00ff00 : 0xff0000, 0.8);
          sprite.selectionRing.strokeRect(-size, -size, size * 2, size * 2);
        }
      }

      // Update health bar
      if (sprite.healthBar && health) {
        const percent = health.getHealthPercent();
        sprite.healthBar.setVisible(percent < 1);
        if (percent < 1) {
          this.updateHealthBar(sprite.healthBar, health, building);
        }
      }

      // Update construction progress
      if (sprite.progressBar) {
        const isUnderConstruction = building.buildProgress < 1;
        sprite.progressBar.setVisible(isUnderConstruction);
        if (isUnderConstruction) {
          this.updateProgressBar(sprite.progressBar, building);
          // Also show partially transparent building
          sprite.body.setAlpha(0.5 + building.buildProgress * 0.5);
        } else {
          sprite.body.setAlpha(1);
        }
      }
    }

    // Remove sprites for destroyed entities
    for (const [entityId, sprite] of this.buildingSprites) {
      if (!currentIds.has(entityId)) {
        sprite.container.destroy();
        this.buildingSprites.delete(entityId);
      }
    }
  }

  private createBuildingSprite(building: Building, playerId: string): BuildingSprite {
    const container = this.scene.add.container(0, 0);
    const color = getPlayerColor(playerId);
    const def = BUILDING_DEFINITIONS[building.buildingId];
    const width = (def?.width ?? 3) * 8;
    const height = (def?.height ?? 3) * 8;

    // Create building body graphic
    const body = this.scene.add.graphics();
    this.drawBuildingBody(body, building, color, width, height);
    container.add(body);

    // Create selection ring
    const selectionRing = this.scene.add.graphics();
    selectionRing.setVisible(false);
    container.add(selectionRing);

    // Create health bar
    const healthBar = this.scene.add.graphics();
    healthBar.setVisible(false);
    healthBar.setPosition(0, -height / 2 - 12);
    container.add(healthBar);

    // Create progress bar for construction
    const progressBar = this.scene.add.graphics();
    progressBar.setVisible(false);
    progressBar.setPosition(0, height / 2 + 8);
    container.add(progressBar);

    return {
      container,
      body,
      healthBar,
      selectionRing,
      progressBar,
      buildingId: building.buildingId,
    };
  }

  private drawBuildingBody(
    graphics: Phaser.GameObjects.Graphics,
    building: Building,
    color: number,
    width: number,
    height: number
  ): void {
    graphics.clear();

    const def = BUILDING_DEFINITIONS[building.buildingId];
    const isResourceBuilding = building.buildingId === 'refinery';
    const isDefense = building.buildingId.includes('turret') || building.buildingId === 'bunker';
    const isMain = building.buildingId.includes('command') || building.buildingId === 'orbital_command';

    // Draw based on building type
    if (isMain) {
      // Main buildings - large hexagonal
      graphics.fillStyle(color, 0.9);
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI * 2) / 6 - Math.PI / 2;
        points.push({
          x: Math.cos(angle) * width / 2,
          y: Math.sin(angle) * height / 2,
        });
      }
      graphics.fillPoints(points as any, true);

      // Center detail
      graphics.fillStyle(0x333333, 0.8);
      graphics.fillCircle(0, 0, width / 4);
    } else if (isDefense) {
      // Defense buildings - octagonal
      graphics.fillStyle(color, 0.9);
      graphics.fillCircle(0, 0, Math.min(width, height) / 2);

      // Turret
      graphics.fillStyle(0x444444, 1);
      graphics.fillRect(-4, -height / 2, 8, height / 2);
    } else if (isResourceBuilding) {
      // Refineries - cylindrical
      graphics.fillStyle(0x444444, 0.9);
      graphics.fillEllipse(0, 0, width, height * 0.6);
      graphics.fillStyle(color, 0.7);
      graphics.fillEllipse(0, -height / 4, width * 0.8, height * 0.3);
    } else if (building.buildingId === 'supply_depot') {
      // Supply depot - small square
      graphics.fillStyle(color, 0.9);
      graphics.fillRect(-width / 2, -height / 2, width, height);
      // Crate detail
      graphics.lineStyle(2, 0x333333, 0.8);
      graphics.strokeRect(-width / 2 + 4, -height / 2 + 4, width - 8, height - 8);
    } else if (building.buildingId === 'barracks' || building.buildingId === 'factory' || building.buildingId === 'starport') {
      // Production buildings - rectangular with details
      graphics.fillStyle(color, 0.9);
      graphics.fillRect(-width / 2, -height / 2, width, height);

      // Door/entrance
      graphics.fillStyle(0x222222, 0.9);
      graphics.fillRect(-width / 6, height / 2 - 8, width / 3, 8);

      // Roof detail
      graphics.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(30).color, 0.9);
      graphics.fillRect(-width / 2 + 4, -height / 2 + 4, width - 8, 8);
    } else {
      // Default - simple rectangle
      graphics.fillStyle(color, 0.9);
      graphics.fillRect(-width / 2, -height / 2, width, height);
    }

    // Add outline
    graphics.lineStyle(2, 0x000000, 0.5);
    graphics.strokeRect(-width / 2, -height / 2, width, height);
  }

  private updateHealthBar(
    graphics: Phaser.GameObjects.Graphics,
    health: Health,
    building: Building
  ): void {
    graphics.clear();

    const def = BUILDING_DEFINITIONS[building.buildingId];
    const width = (def?.width ?? 3) * 6;
    const height = 4;
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
  }

  private updateProgressBar(
    graphics: Phaser.GameObjects.Graphics,
    building: Building
  ): void {
    graphics.clear();

    const def = BUILDING_DEFINITIONS[building.buildingId];
    const width = (def?.width ?? 3) * 6;
    const height = 4;

    // Background
    graphics.fillStyle(0x333333, 0.8);
    graphics.fillRect(-width / 2, 0, width, height);

    // Progress fill
    graphics.fillStyle(0x00aaff, 1);
    graphics.fillRect(-width / 2, 0, width * building.buildProgress, height);
  }

  setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  destroy(): void {
    for (const sprite of this.buildingSprites.values()) {
      sprite.container.destroy();
    }
    this.buildingSprites.clear();
    this.container.destroy();
  }
}

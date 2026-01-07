import * as Phaser from 'phaser';
import { World } from '@/engine/ecs/World';
import { MapData } from '@/data/maps/MapTypes';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Resource } from '@/engine/components/Resource';
import { Selectable } from '@/engine/components/Selectable';
import { Health } from '@/engine/components/Health';
import { useGameStore } from '@/store/gameStore';
import { CELL_SIZE, DEPTH } from '../constants';

// Player colors for minimap dots
const PLAYER_COLORS: Record<string, number> = {
  player1: 0x4080ff,
  ai: 0xff4040,
  player2: 0x40ff40,
  player3: 0xffff40,
  player4: 0xff40ff,
};

export class MinimapRenderer {
  private scene: Phaser.Scene;
  private mapData: MapData;
  private world: World;
  private visionSystem: VisionSystem | null;
  private fogOfWarEnabled: boolean;
  private playerId = 'player1';

  // Minimap size and position
  private readonly MINIMAP_SIZE = 180;
  private readonly PADDING = 10;

  // Graphics
  private container: Phaser.GameObjects.Container;
  private background: Phaser.GameObjects.Graphics;
  private terrainGraphics: Phaser.GameObjects.Graphics;
  private fogGraphics: Phaser.GameObjects.Graphics;
  private entityGraphics: Phaser.GameObjects.Graphics;
  private cameraGraphics: Phaser.GameObjects.Graphics;

  // Scale factors
  private scaleX: number;
  private scaleY: number;

  // Update throttling
  private lastUpdateTime = 0;
  private updateInterval = 66; // ~15 FPS

  constructor(
    scene: Phaser.Scene,
    mapData: MapData,
    world: World,
    visionSystem?: VisionSystem,
    fogOfWarEnabled = true
  ) {
    this.scene = scene;
    this.mapData = mapData;
    this.world = world;
    this.visionSystem = visionSystem ?? null;
    this.fogOfWarEnabled = fogOfWarEnabled;

    this.scaleX = this.MINIMAP_SIZE / mapData.width;
    this.scaleY = this.MINIMAP_SIZE / mapData.height;

    // Create container positioned at bottom-left
    const x = this.PADDING;
    const y = scene.scale.height - this.MINIMAP_SIZE - this.PADDING;

    this.container = scene.add.container(x, y);
    this.container.setDepth(DEPTH.MINIMAP);
    this.container.setScrollFactor(0); // Fixed to screen

    // Create graphics layers
    this.background = scene.add.graphics();
    this.terrainGraphics = scene.add.graphics();
    this.fogGraphics = scene.add.graphics();
    this.entityGraphics = scene.add.graphics();
    this.cameraGraphics = scene.add.graphics();

    this.container.add([
      this.background,
      this.terrainGraphics,
      this.fogGraphics,
      this.entityGraphics,
      this.cameraGraphics,
    ]);

    // Draw static elements
    this.drawBackground();
    this.drawTerrain();

    // Set up click handler for minimap
    this.setupInput();

    // Handle resize
    scene.scale.on('resize', this.handleResize, this);
  }

  private drawBackground(): void {
    // Dark background with border
    this.background.fillStyle(0x111111, 0.9);
    this.background.fillRect(0, 0, this.MINIMAP_SIZE, this.MINIMAP_SIZE);
    this.background.lineStyle(2, 0x444444, 1);
    this.background.strokeRect(0, 0, this.MINIMAP_SIZE, this.MINIMAP_SIZE);
  }

  private drawTerrain(): void {
    const { width, height, terrain } = this.mapData;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = terrain[y]?.[x];
        if (!cell) continue;

        let color = 0x333333; // Default ground

        if (cell.terrain === 'unwalkable') {
          color = 0x111111; // Cliffs/unwalkable
        } else if (cell.terrain === 'ramp') {
          color = 0x3a3a3a; // Ramps
        } else if (cell.elevation === 2) {
          color = 0x444444; // High ground
        } else if (cell.elevation === 1) {
          color = 0x3a3a3a; // Medium ground
        }

        const mx = x * this.scaleX;
        const my = y * this.scaleY;

        this.terrainGraphics.fillStyle(color, 1);
        this.terrainGraphics.fillRect(mx, my, this.scaleX + 0.5, this.scaleY + 0.5);
      }
    }
  }

  private setupInput(): void {
    // Create interactive zone over minimap
    const zone = this.scene.add.zone(
      this.MINIMAP_SIZE / 2,
      this.MINIMAP_SIZE / 2,
      this.MINIMAP_SIZE,
      this.MINIMAP_SIZE
    );
    zone.setInteractive();
    this.container.add(zone);

    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handleMinimapClick(pointer);
    });

    zone.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown) {
        this.handleMinimapClick(pointer);
      }
    });
  }

  private handleMinimapClick(pointer: Phaser.Input.Pointer): void {
    // Convert minimap coordinates to world coordinates
    const localX = pointer.x - this.container.x;
    const localY = pointer.y - this.container.y;

    const worldX = localX / this.scaleX;
    const worldY = localY / this.scaleY;

    // Set pending camera move in store
    useGameStore.getState().moveCameraTo(worldX, worldY);
  }

  update(): void {
    const now = performance.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = now;

    this.drawEntities();
    this.drawFog();
    this.drawCameraView();
  }

  private drawEntities(): void {
    this.entityGraphics.clear();

    // Draw resources
    const resources = this.world.getEntitiesWith('Transform', 'Resource');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;
      const resource = entity.get<Resource>('Resource')!;

      if (resource.amount <= 0) continue;

      const mx = transform.x * this.scaleX;
      const my = transform.y * this.scaleY;

      const color = resource.resourceType === 'minerals' ? 0x4488ff : 0x44ff44;
      this.entityGraphics.fillStyle(color, 0.9);
      this.entityGraphics.fillRect(mx - 1, my - 1, 3, 3);
    }

    // Draw buildings
    const buildings = this.world.getEntitiesWith('Transform', 'Building', 'Selectable', 'Health');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (health.isDead()) continue;

      // Check visibility for enemy buildings
      if (selectable.playerId !== this.playerId && this.fogOfWarEnabled && this.visionSystem) {
        if (!this.visionSystem.isExplored(this.playerId, transform.x, transform.y)) {
          continue;
        }
      }

      const mx = transform.x * this.scaleX;
      const my = transform.y * this.scaleY;

      const color = PLAYER_COLORS[selectable.playerId] ?? 0x808080;
      this.entityGraphics.fillStyle(color, 1);
      this.entityGraphics.fillRect(mx - 2, my - 2, 5, 5);
    }

    // Draw units
    const units = this.world.getEntitiesWith('Transform', 'Unit', 'Selectable', 'Health');
    for (const entity of units) {
      const transform = entity.get<Transform>('Transform')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (health.isDead()) continue;

      // Check visibility for enemy units
      if (selectable.playerId !== this.playerId && this.fogOfWarEnabled && this.visionSystem) {
        if (!this.visionSystem.isVisible(this.playerId, transform.x, transform.y)) {
          continue;
        }
      }

      const mx = transform.x * this.scaleX;
      const my = transform.y * this.scaleY;

      const color = PLAYER_COLORS[selectable.playerId] ?? 0x808080;
      this.entityGraphics.fillStyle(color, 1);
      this.entityGraphics.fillCircle(mx, my, 2);
    }
  }

  private drawFog(): void {
    if (!this.fogOfWarEnabled || !this.visionSystem) return;

    this.fogGraphics.clear();

    const gridWidth = Math.ceil(this.mapData.width / 2);
    const gridHeight = Math.ceil(this.mapData.height / 2);

    const visionGrid = this.visionSystem.getVisionGridForPlayer(this.playerId);
    if (!visionGrid) return;

    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const state = visionGrid[gy]?.[gx] ?? 'unexplored';

        if (state === 'unexplored') {
          const mx = gx * 2 * this.scaleX;
          const my = gy * 2 * this.scaleY;

          this.fogGraphics.fillStyle(0x000000, 0.8);
          this.fogGraphics.fillRect(mx, my, this.scaleX * 2, this.scaleY * 2);
        } else if (state === 'explored') {
          const mx = gx * 2 * this.scaleX;
          const my = gy * 2 * this.scaleY;

          this.fogGraphics.fillStyle(0x000000, 0.4);
          this.fogGraphics.fillRect(mx, my, this.scaleX * 2, this.scaleY * 2);
        }
      }
    }
  }

  private drawCameraView(): void {
    this.cameraGraphics.clear();

    const camera = this.scene.cameras.main;
    // Camera scrollX/Y are in pixels, convert to grid coordinates then to minimap
    const camX = (camera.scrollX / CELL_SIZE) * this.scaleX;
    const camY = (camera.scrollY / CELL_SIZE) * this.scaleY;
    const camWidth = (camera.width / camera.zoom / CELL_SIZE) * this.scaleX;
    const camHeight = (camera.height / camera.zoom / CELL_SIZE) * this.scaleY;

    this.cameraGraphics.lineStyle(1, 0xffffff, 0.8);
    this.cameraGraphics.strokeRect(camX, camY, camWidth, camHeight);
  }

  private handleResize(): void {
    // Reposition minimap on resize
    const x = this.PADDING;
    const y = this.scene.scale.height - this.MINIMAP_SIZE - this.PADDING;
    this.container.setPosition(x, y);
  }

  setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  destroy(): void {
    this.scene.scale.off('resize', this.handleResize, this);
    this.container.destroy();
  }
}

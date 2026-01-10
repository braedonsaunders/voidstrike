import * as Phaser from 'phaser';
import { VisionSystem, VisionState } from '@/engine/systems/VisionSystem';
import { CELL_SIZE, DEPTH } from '../constants';
import { getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';

export class FogOfWarRenderer {
  private scene: Phaser.Scene;
  private mapWidth: number;
  private mapHeight: number;
  private visionSystem: VisionSystem;
  private playerId: string | null = null;

  private fogGraphics: Phaser.GameObjects.Graphics;
  private fogCellSize = 2; // Each fog cell covers 2x2 grid units

  // Throttle updates
  private lastUpdateTime = 0;
  private updateInterval = 100; // Update every 100ms

  constructor(
    scene: Phaser.Scene,
    mapWidth: number,
    mapHeight: number,
    visionSystem: VisionSystem
  ) {
    this.scene = scene;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.visionSystem = visionSystem;

    // Create fog graphics layer
    this.fogGraphics = scene.add.graphics();
    this.fogGraphics.setDepth(DEPTH.FOG_OF_WAR);

    // Initial render
    this.render();
  }

  update(): void {
    const now = performance.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = now;

    this.render();
  }

  private render(): void {
    this.fogGraphics.clear();

    // In spectator mode, don't render fog - show full map
    if (isSpectatorMode() || !this.playerId) {
      return;
    }

    const gridWidth = Math.ceil(this.mapWidth / this.fogCellSize);
    const gridHeight = Math.ceil(this.mapHeight / this.fogCellSize);

    const visionGrid = this.visionSystem.getVisionGridForPlayer(this.playerId);
    if (!visionGrid) return;

    // Colors for different visibility states
    const unexploredColor = 0x1a2030;
    const exploredColor = 0x1a2535;

    // Pixel size for each fog cell
    const pixelCellSize = this.fogCellSize * CELL_SIZE;

    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const state = visionGrid[gy]?.[gx] ?? 'unexplored';

        // Convert grid to pixel coordinates
        const px = gx * pixelCellSize;
        const py = gy * pixelCellSize;

        if (state === 'unexplored') {
          // Unexplored - darker fog
          this.fogGraphics.fillStyle(unexploredColor, 0.85);
          this.fogGraphics.fillRect(px, py, pixelCellSize, pixelCellSize);
        } else if (state === 'explored') {
          // Explored but not visible - lighter fog
          this.fogGraphics.fillStyle(exploredColor, 0.5);
          this.fogGraphics.fillRect(px, py, pixelCellSize, pixelCellSize);
        }
        // Visible areas have no fog drawn
      }
    }
  }

  setPlayerId(playerId: string | null): void {
    this.playerId = playerId;
  }

  destroy(): void {
    this.fogGraphics.destroy();
  }
}

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

  // Dirty tracking - cache previous vision state to only redraw changed cells
  private previousVisionState: VisionState[][] | null = null;
  private needsFullRedraw = true;

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
    // In spectator mode, don't render fog - show full map
    if (isSpectatorMode() || !this.playerId) {
      this.fogGraphics.clear();
      this.previousVisionState = null;
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

    // Check if we need a full redraw (first render or player changed)
    if (this.needsFullRedraw || !this.previousVisionState) {
      this.fogGraphics.clear();
      this.needsFullRedraw = false;

      // Initialize previous state cache
      if (!this.previousVisionState) {
        this.previousVisionState = [];
        for (let y = 0; y < gridHeight; y++) {
          this.previousVisionState[y] = [];
          for (let x = 0; x < gridWidth; x++) {
            this.previousVisionState[y][x] = 'unexplored';
          }
        }
      }

      // Full redraw
      for (let gy = 0; gy < gridHeight; gy++) {
        for (let gx = 0; gx < gridWidth; gx++) {
          const state = visionGrid[gy]?.[gx] ?? 'unexplored';
          this.previousVisionState[gy][gx] = state;

          const px = gx * pixelCellSize;
          const py = gy * pixelCellSize;

          if (state === 'unexplored') {
            this.fogGraphics.fillStyle(unexploredColor, 0.85);
            this.fogGraphics.fillRect(px, py, pixelCellSize, pixelCellSize);
          } else if (state === 'explored') {
            this.fogGraphics.fillStyle(exploredColor, 0.5);
            this.fogGraphics.fillRect(px, py, pixelCellSize, pixelCellSize);
          }
        }
      }
    } else {
      // Incremental update - only redraw changed cells
      // Unfortunately Phaser Graphics doesn't support partial clearing,
      // so we need to do a full clear and redraw only if there are changes
      let hasChanges = false;

      // First pass: detect changes
      for (let gy = 0; gy < gridHeight; gy++) {
        for (let gx = 0; gx < gridWidth; gx++) {
          const state = visionGrid[gy]?.[gx] ?? 'unexplored';
          if (this.previousVisionState[gy][gx] !== state) {
            hasChanges = true;
            this.previousVisionState[gy][gx] = state;
          }
        }
      }

      // Only redraw if there are changes
      if (hasChanges) {
        this.fogGraphics.clear();

        for (let gy = 0; gy < gridHeight; gy++) {
          for (let gx = 0; gx < gridWidth; gx++) {
            const state = this.previousVisionState[gy][gx];
            const px = gx * pixelCellSize;
            const py = gy * pixelCellSize;

            if (state === 'unexplored') {
              this.fogGraphics.fillStyle(unexploredColor, 0.85);
              this.fogGraphics.fillRect(px, py, pixelCellSize, pixelCellSize);
            } else if (state === 'explored') {
              this.fogGraphics.fillStyle(exploredColor, 0.5);
              this.fogGraphics.fillRect(px, py, pixelCellSize, pixelCellSize);
            }
          }
        }
      }
      // If no changes, skip the redraw entirely (major performance win)
    }
  }

  setPlayerId(playerId: string | null): void {
    if (this.playerId !== playerId) {
      this.playerId = playerId;
      this.needsFullRedraw = true;
      this.previousVisionState = null;
    }
  }

  destroy(): void {
    this.fogGraphics.destroy();
  }
}

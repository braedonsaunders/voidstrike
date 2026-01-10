import * as Phaser from 'phaser';
import { CELL_SIZE } from '../constants';

interface CameraLocation {
  x: number;
  y: number;
  zoom: number;
}

export class RTSCamera {
  private scene: Phaser.Scene;
  private camera: Phaser.Cameras.Scene2D.Camera;

  private mapWidth: number;
  private mapHeight: number;

  // Camera settings
  private minZoom = 0.25;
  private maxZoom = 2;
  private panSpeed = 800;
  private edgeScrollSpeed = 600;
  private edgeScrollThreshold = 40;
  private zoomSpeed = 0.1;

  // Input state
  private keys: Set<string> = new Set();
  private isMiddleMouseDown = false;
  private lastMousePosition = { x: 0, y: 0 };

  // Saved locations (F5-F8)
  private savedLocations: Map<string, CameraLocation> = new Map();

  constructor(
    scene: Phaser.Scene,
    mapWidth: number,
    mapHeight: number,
    startX: number,
    startY: number
  ) {
    this.scene = scene;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;

    this.camera = scene.cameras.main;

    // Set up camera bounds (map dimensions are in grid cells, convert to pixels)
    // The 5th parameter (centerOn=true) allows camera to center on any point within bounds
    // Without this, the camera can't show the bottom/right edges of the map
    this.camera.setBounds(0, 0, mapWidth * CELL_SIZE, mapHeight * CELL_SIZE, true);

    // Center on starting position (convert grid to pixels)
    this.camera.centerOn(startX * CELL_SIZE, startY * CELL_SIZE);

    // Set initial zoom
    this.camera.setZoom(1);

    // Set up input handlers
    this.setupInput();
  }

  private setupInput(): void {
    // Keyboard input
    this.scene.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      this.keys.add(event.code);
    });

    this.scene.input.keyboard?.on('keyup', (event: KeyboardEvent) => {
      this.keys.delete(event.code);
    });

    // Middle mouse for pan
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.middleButtonDown()) {
        this.isMiddleMouseDown = true;
        this.lastMousePosition.x = pointer.x;
        this.lastMousePosition.y = pointer.y;
      }
    });

    this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.middleButtonDown()) {
        this.isMiddleMouseDown = false;
      }
    });

    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isMiddleMouseDown) {
        const dx = pointer.x - this.lastMousePosition.x;
        const dy = pointer.y - this.lastMousePosition.y;

        this.camera.scrollX -= dx / this.camera.zoom;
        this.camera.scrollY -= dy / this.camera.zoom;

        this.lastMousePosition.x = pointer.x;
        this.lastMousePosition.y = pointer.y;
      }
    });

    // Mouse wheel zoom
    this.scene.input.on('wheel', (
      pointer: Phaser.Input.Pointer,
      gameObjects: Phaser.GameObjects.GameObject[],
      deltaX: number,
      deltaY: number
    ) => {
      const newZoom = this.camera.zoom - deltaY * 0.001 * this.zoomSpeed;
      this.camera.setZoom(Phaser.Math.Clamp(newZoom, this.minZoom, this.maxZoom));
    });
  }

  update(delta: number): void {
    const dt = delta / 1000;
    let dx = 0;
    let dy = 0;

    // Keyboard panning (arrow keys only - WASD reserved for shortcuts)
    if (this.keys.has('ArrowUp')) {
      dy -= this.panSpeed * dt;
    }
    if (this.keys.has('ArrowDown')) {
      dy += this.panSpeed * dt;
    }
    if (this.keys.has('ArrowLeft')) {
      dx -= this.panSpeed * dt;
    }
    if (this.keys.has('ArrowRight')) {
      dx += this.panSpeed * dt;
    }

    // Edge scrolling
    if (!this.isMiddleMouseDown) {
      const pointer = this.scene.input.activePointer;
      const { width, height } = this.scene.scale;

      if (pointer.x < this.edgeScrollThreshold) {
        dx -= this.edgeScrollSpeed * dt;
      } else if (pointer.x > width - this.edgeScrollThreshold) {
        dx += this.edgeScrollSpeed * dt;
      }

      if (pointer.y < this.edgeScrollThreshold) {
        dy -= this.edgeScrollSpeed * dt;
      } else if (pointer.y > height - this.edgeScrollThreshold) {
        dy += this.edgeScrollSpeed * dt;
      }
    }

    // Apply movement (adjusted for zoom)
    if (dx !== 0 || dy !== 0) {
      this.camera.scrollX += dx / this.camera.zoom;
      this.camera.scrollY += dy / this.camera.zoom;
    }
  }

  setPosition(x: number, y: number): void {
    // x, y are in grid coordinates, convert to pixels
    this.camera.centerOn(x * CELL_SIZE, y * CELL_SIZE);
  }

  getPosition(): { x: number; y: number } {
    // Return position in grid coordinates
    const pixelX = this.camera.scrollX + this.camera.width / 2 / this.camera.zoom;
    const pixelY = this.camera.scrollY + this.camera.height / 2 / this.camera.zoom;
    return {
      x: pixelX / CELL_SIZE,
      y: pixelY / CELL_SIZE,
    };
  }

  setZoom(zoom: number): void {
    this.camera.setZoom(Phaser.Math.Clamp(zoom, this.minZoom, this.maxZoom));
  }

  getZoom(): number {
    return this.camera.zoom;
  }

  saveLocation(slot: string): void {
    const pos = this.getPosition();
    this.savedLocations.set(slot, {
      x: pos.x,
      y: pos.y,
      zoom: this.camera.zoom,
    });
  }

  recallLocation(slot: string): boolean {
    const location = this.savedLocations.get(slot);
    if (location) {
      this.setPosition(location.x, location.y);
      this.setZoom(location.zoom);
      return true;
    }
    return false;
  }

  // Convert screen coordinates to world coordinates (returns grid coordinates)
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const worldPoint = this.camera.getWorldPoint(screenX, screenY);
    return { x: worldPoint.x / CELL_SIZE, y: worldPoint.y / CELL_SIZE };
  }

  // Convert world coordinates to screen coordinates (worldX/Y are in grid coordinates)
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const pixelX = worldX * CELL_SIZE;
    const pixelY = worldY * CELL_SIZE;
    const screenX = (pixelX - this.camera.scrollX) * this.camera.zoom;
    const screenY = (pixelY - this.camera.scrollY) * this.camera.zoom;
    return { x: screenX, y: screenY };
  }

  getCamera(): Phaser.Cameras.Scene2D.Camera {
    return this.camera;
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    // Return bounds in grid coordinates
    return {
      x: this.camera.scrollX / CELL_SIZE,
      y: this.camera.scrollY / CELL_SIZE,
      width: this.camera.width / this.camera.zoom / CELL_SIZE,
      height: this.camera.height / this.camera.zoom / CELL_SIZE,
    };
  }
}

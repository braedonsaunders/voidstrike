import * as Phaser from 'phaser';

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

    // Set up camera bounds
    this.camera.setBounds(0, 0, mapWidth, mapHeight);

    // Center on starting position
    this.camera.centerOn(startX, startY);

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

    // Keyboard panning (WASD and arrows)
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
      dy -= this.panSpeed * dt;
    }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
      dy += this.panSpeed * dt;
    }
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) {
      dx -= this.panSpeed * dt;
    }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) {
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
    this.camera.centerOn(x, y);
  }

  getPosition(): { x: number; y: number } {
    return {
      x: this.camera.scrollX + this.camera.width / 2 / this.camera.zoom,
      y: this.camera.scrollY + this.camera.height / 2 / this.camera.zoom,
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

  // Convert screen coordinates to world coordinates
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const worldPoint = this.camera.getWorldPoint(screenX, screenY);
    return { x: worldPoint.x, y: worldPoint.y };
  }

  // Convert world coordinates to screen coordinates
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const screenX = (worldX - this.camera.scrollX) * this.camera.zoom;
    const screenY = (worldY - this.camera.scrollY) * this.camera.zoom;
    return { x: screenX, y: screenY };
  }

  getCamera(): Phaser.Cameras.Scene2D.Camera {
    return this.camera;
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return {
      x: this.camera.scrollX,
      y: this.camera.scrollY,
      width: this.camera.width / this.camera.zoom,
      height: this.camera.height / this.camera.zoom,
    };
  }
}

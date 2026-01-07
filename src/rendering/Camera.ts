import * as THREE from 'three';

export interface CameraConfig {
  minZoom: number;
  maxZoom: number;
  panSpeed: number;
  zoomSpeed: number;
  rotationSpeed: number;
  edgeScrollSpeed: number;
  edgeScrollThreshold: number;
  boundaryPadding: number;
}

const DEFAULT_CONFIG: CameraConfig = {
  minZoom: 10,
  maxZoom: 80,
  panSpeed: 80,
  zoomSpeed: 5,
  rotationSpeed: 2,
  edgeScrollSpeed: 60,
  edgeScrollThreshold: 40,
  boundaryPadding: 10,
};

// Camera location bookmark
interface CameraLocation {
  x: number;
  z: number;
  zoom: number;
}

export class RTSCamera {
  public camera: THREE.PerspectiveCamera;
  public target: THREE.Vector3;

  private config: CameraConfig;
  private currentZoom: number;
  private currentAngle: number;
  private currentPitch: number;

  private mapWidth: number;
  private mapHeight: number;

  // Input state
  private keys: Set<string> = new Set();
  private mousePosition = { x: 0, y: 0 };
  private isMiddleMouseDown = false;
  private lastMousePosition = { x: 0, y: 0 };

  // Screen dimensions
  private screenWidth = 0;
  private screenHeight = 0;

  // Camera location bookmarks (F5-F8)
  private savedLocations: Map<string, CameraLocation> = new Map();

  // Terrain height function for accurate screen-to-world conversion
  private getTerrainHeight: ((x: number, z: number) => number) | null = null;

  constructor(
    aspect: number,
    mapWidth: number,
    mapHeight: number,
    config: Partial<CameraConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;

    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this.target = new THREE.Vector3(mapWidth / 2, 0, mapHeight / 2);

    this.currentZoom = 30;
    this.currentAngle = 0;
    this.currentPitch = Math.PI / 4; // 45 degrees

    this.updateCameraPosition();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    window.addEventListener('keyup', this.handleKeyUp.bind(this));
    window.addEventListener('mousemove', this.handleMouseMove.bind(this));
    window.addEventListener('mousedown', this.handleMouseDown.bind(this));
    window.addEventListener('mouseup', this.handleMouseUp.bind(this));
    window.addEventListener('wheel', this.handleWheel.bind(this));
    window.addEventListener('resize', this.handleResize.bind(this));

    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    this.keys.add(e.code);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
  }

  private handleMouseMove(e: MouseEvent): void {
    this.mousePosition.x = e.clientX;
    this.mousePosition.y = e.clientY;

    if (this.isMiddleMouseDown) {
      const deltaX = e.clientX - this.lastMousePosition.x;
      const deltaY = e.clientY - this.lastMousePosition.y;

      // Rotate camera
      this.currentAngle -= deltaX * this.config.rotationSpeed * 0.01;
      this.currentPitch = Math.max(
        0.2,
        Math.min(Math.PI / 2 - 0.1, this.currentPitch + deltaY * 0.01)
      );

      this.updateCameraPosition();
    }

    this.lastMousePosition.x = e.clientX;
    this.lastMousePosition.y = e.clientY;
  }

  private handleMouseDown(e: MouseEvent): void {
    if (e.button === 1) {
      // Middle mouse
      this.isMiddleMouseDown = true;
      this.lastMousePosition.x = e.clientX;
      this.lastMousePosition.y = e.clientY;
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button === 1) {
      this.isMiddleMouseDown = false;
    }
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const zoomDelta = e.deltaY * 0.05;
    this.currentZoom = Math.max(
      this.config.minZoom,
      Math.min(this.config.maxZoom, this.currentZoom + zoomDelta)
    );

    this.updateCameraPosition();
  }

  private handleResize(): void {
    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;
    this.camera.aspect = this.screenWidth / this.screenHeight;
    this.camera.updateProjectionMatrix();
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000;
    let dx = 0;
    let dz = 0;

    // Keyboard input
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
      dz -= this.config.panSpeed * dt;
    }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
      dz += this.config.panSpeed * dt;
    }
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) {
      dx -= this.config.panSpeed * dt;
    }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) {
      dx += this.config.panSpeed * dt;
    }

    // Edge scrolling
    if (!this.isMiddleMouseDown) {
      const { edgeScrollThreshold, edgeScrollSpeed } = this.config;

      if (this.mousePosition.x < edgeScrollThreshold) {
        dx -= edgeScrollSpeed * dt;
      } else if (this.mousePosition.x > this.screenWidth - edgeScrollThreshold) {
        dx += edgeScrollSpeed * dt;
      }

      if (this.mousePosition.y < edgeScrollThreshold) {
        dz -= edgeScrollSpeed * dt;
      } else if (this.mousePosition.y > this.screenHeight - edgeScrollThreshold) {
        dz += edgeScrollSpeed * dt;
      }
    }

    if (dx !== 0 || dz !== 0) {
      // Rotate movement direction based on camera angle
      const cos = Math.cos(this.currentAngle);
      const sin = Math.sin(this.currentAngle);
      const rotatedX = dx * cos - dz * sin;
      const rotatedZ = dx * sin + dz * cos;

      this.target.x += rotatedX;
      this.target.z += rotatedZ;

      // Clamp to map boundaries
      const padding = this.config.boundaryPadding;
      this.target.x = Math.max(padding, Math.min(this.mapWidth - padding, this.target.x));
      this.target.z = Math.max(padding, Math.min(this.mapHeight - padding, this.target.z));

      this.updateCameraPosition();
    }
  }

  private updateCameraPosition(): void {
    const x = this.target.x + this.currentZoom * Math.sin(this.currentAngle) * Math.cos(this.currentPitch);
    const y = this.currentZoom * Math.sin(this.currentPitch);
    const z = this.target.z + this.currentZoom * Math.cos(this.currentAngle) * Math.cos(this.currentPitch);

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  public setPosition(x: number, z: number): void {
    this.target.x = x;
    this.target.z = z;
    this.updateCameraPosition();
  }

  public setZoom(zoom: number): void {
    this.currentZoom = Math.max(
      this.config.minZoom,
      Math.min(this.config.maxZoom, zoom)
    );
    this.updateCameraPosition();
  }

  public getZoom(): number {
    return this.currentZoom;
  }

  public getPosition(): { x: number; z: number } {
    return { x: this.target.x, z: this.target.z };
  }

  // Set the terrain height function for accurate screen-to-world conversion
  public setTerrainHeightFunction(fn: (x: number, z: number) => number): void {
    this.getTerrainHeight = fn;
  }

  // Save current camera location to a slot (F5-F8)
  public saveLocation(slot: string): void {
    this.savedLocations.set(slot, {
      x: this.target.x,
      z: this.target.z,
      zoom: this.currentZoom,
    });
  }

  // Recall a saved camera location
  public recallLocation(slot: string): boolean {
    const location = this.savedLocations.get(slot);
    if (location) {
      this.target.x = location.x;
      this.target.z = location.z;
      this.currentZoom = location.zoom;
      this.updateCameraPosition();
      return true;
    }
    return false;
  }

  // Check if a location slot has a saved position
  public hasLocation(slot: string): boolean {
    return this.savedLocations.has(slot);
  }

  // Convert screen coordinates to world coordinates
  public screenToWorld(screenX: number, screenY: number): THREE.Vector3 {
    const normalizedX = (screenX / this.screenWidth) * 2 - 1;
    const normalizedY = -(screenY / this.screenHeight) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(normalizedX, normalizedY), this.camera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();

    // Initial intersection with y=0 plane
    raycaster.ray.intersectPlane(plane, target);

    // If we have terrain height function, iterate to find accurate intersection
    if (this.getTerrainHeight && target) {
      // Iterate 3 times to converge on correct terrain intersection
      for (let i = 0; i < 3; i++) {
        const terrainHeight = this.getTerrainHeight(target.x, target.z);
        // Create plane at terrain height
        plane.constant = -terrainHeight;
        raycaster.ray.intersectPlane(plane, target);
      }
    }

    return target;
  }

  public dispose(): void {
    if (typeof window === 'undefined') return;

    window.removeEventListener('keydown', this.handleKeyDown.bind(this));
    window.removeEventListener('keyup', this.handleKeyUp.bind(this));
    window.removeEventListener('mousemove', this.handleMouseMove.bind(this));
    window.removeEventListener('mousedown', this.handleMouseDown.bind(this));
    window.removeEventListener('mouseup', this.handleMouseUp.bind(this));
    window.removeEventListener('wheel', this.handleWheel.bind(this));
    window.removeEventListener('resize', this.handleResize.bind(this));
  }
}

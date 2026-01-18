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
  minZoom: 14,
  maxZoom: 80,
  panSpeed: 80,
  zoomSpeed: 5,
  rotationSpeed: 2,
  edgeScrollSpeed: 60,
  edgeScrollThreshold: 50,
  boundaryPadding: 10,
};

export class RTSCamera {
  public camera: THREE.PerspectiveCamera;
  public target: THREE.Vector3;

  private config: CameraConfig;
  private currentZoom: number;
  private targetZoom: number; // For smooth zoom interpolation
  private currentAngle: number;
  private currentPitch: number;
  private manualPitchOffset: number; // User's manual pitch adjustment via middle mouse

  private mapWidth: number;
  private mapHeight: number;

  // Input state
  private keys: Set<string> = new Set();
  private mousePosition = { x: 0, y: 0 };
  private isMiddleMouseDown = false;
  private lastMousePosition = { x: 0, y: 0 };
  private edgeScrollEnabled = true;
  private mouseInViewport = false; // Start false to prevent edge scroll before first mouse event

  // Screen dimensions
  private screenWidth = 0;
  private screenHeight = 0;

  // Custom viewport bounds for edge scrolling (offsets from screen edges)
  // Used in editor where UI panels occupy screen space
  private edgeScrollRightOffset = 0;

  // PERF: Store bound event handlers to properly remove them later
  // Using bind() in addEventListener creates new functions that can't be removed
  private boundHandleKeyDown: (e: KeyboardEvent) => void;
  private boundHandleKeyUp: (e: KeyboardEvent) => void;
  private boundHandleMouseMove: (e: MouseEvent) => void;
  private boundHandleMouseDown: (e: MouseEvent) => void;
  private boundHandleMouseUp: (e: MouseEvent) => void;
  private boundHandleWheel: (e: WheelEvent) => void;
  private boundHandleResize: () => void;
  private boundHandleMouseLeave: () => void;
  private boundHandleMouseEnter: () => void;

  // Terrain height function for accurate screen-to-world conversion
  private getTerrainHeight: ((x: number, z: number) => number) | null = null;

  // Cached terrain-based minimum zoom (updated when camera pans)
  private terrainMinZoom: number = 0;

  // PERF: Cached raycaster and vectors for screenToWorld to avoid allocation per call
  private readonly _raycaster = new THREE.Raycaster();
  private readonly _raycastMouseVec = new THREE.Vector2();
  private readonly _raycastPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly _raycastTarget = new THREE.Vector3();

  constructor(
    aspect: number,
    mapWidth: number,
    mapHeight: number,
    config: Partial<CameraConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;

    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 300); // Near=0.1 for close zoom without clipping
    this.target = new THREE.Vector3(mapWidth / 2, 0, mapHeight / 2);

    this.currentZoom = 45; // SC2-like default: good overview of starting base
    this.targetZoom = 45; // Initialize target zoom same as current
    this.currentAngle = 0;
    this.manualPitchOffset = 0; // User can adjust pitch via middle mouse drag
    this.currentPitch = this.calculateZoomBasedPitch(this.currentZoom);

    // PERF: Bind event handlers once in constructor to enable proper cleanup
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleKeyUp = this.handleKeyUp.bind(this);
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseDown = this.handleMouseDown.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);
    this.boundHandleWheel = this.handleWheel.bind(this);
    this.boundHandleResize = this.handleResize.bind(this);
    this.boundHandleMouseLeave = this.handleMouseLeaveViewport.bind(this);
    this.boundHandleMouseEnter = this.handleMouseEnterViewport.bind(this);

    this.updateCameraPosition();
    this.setupEventListeners();
  }

  // Calculate pitch based on zoom level
  // Zoomed in (minZoom) = looking more horizontally at building sides
  // Zoomed out (maxZoom) = looking more top-down at the map
  private calculateZoomBasedPitch(zoom: number): number {
    const { minZoom, maxZoom } = this.config;
    // Normalize zoom to 0-1 range (0 = zoomed in, 1 = zoomed out)
    const t = (zoom - minZoom) / (maxZoom - minZoom);

    // Pitch range: 0.2 (nearly horizontal) to PI/2.5 (~72 degrees, more top-down)
    const minPitch = 0.2; // Zoomed in: looking at sides of buildings
    const maxPitch = Math.PI / 2.5; // Zoomed out: more overhead view

    // Interpolate and add manual offset
    const basePitch = minPitch + t * (maxPitch - minPitch);

    // Clamp final pitch to valid range
    return Math.max(0.15, Math.min(Math.PI / 2 - 0.1, basePitch + this.manualPitchOffset));
  }

  private setupEventListeners(): void {
    if (typeof window === 'undefined') return;

    // Use pre-bound handlers so they can be properly removed in dispose()
    window.addEventListener('keydown', this.boundHandleKeyDown);
    window.addEventListener('keyup', this.boundHandleKeyUp);
    window.addEventListener('mousemove', this.boundHandleMouseMove);
    window.addEventListener('mousedown', this.boundHandleMouseDown);
    window.addEventListener('mouseup', this.boundHandleMouseUp);
    window.addEventListener('wheel', this.boundHandleWheel, { passive: false });
    // Note: resize handling is done externally via setScreenDimensions() to support
    // container-based sizing (needed when DevTools is docked). Do not auto-subscribe to window resize.

    // Track when cursor leaves/enters the viewport
    document.addEventListener('mouseleave', this.boundHandleMouseLeave);
    document.addEventListener('mouseenter', this.boundHandleMouseEnter);

    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;
  }

  private handleMouseLeaveViewport(): void {
    this.mouseInViewport = false;
  }

  private handleMouseEnterViewport(): void {
    this.mouseInViewport = true;
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
    this.mouseInViewport = true; // Mouse is in viewport when moving

    if (this.isMiddleMouseDown) {
      const deltaX = e.clientX - this.lastMousePosition.x;
      const deltaY = e.clientY - this.lastMousePosition.y;

      // Rotate camera angle (horizontal rotation)
      this.currentAngle -= deltaX * this.config.rotationSpeed * 0.01;

      // Adjust manual pitch offset (vertical rotation)
      // Clamp offset so total pitch stays within valid range
      const newOffset = this.manualPitchOffset + deltaY * 0.01;
      this.manualPitchOffset = Math.max(-0.5, Math.min(0.5, newOffset));

      // Recalculate pitch with new offset
      this.currentPitch = this.calculateZoomBasedPitch(this.currentZoom);

      // Update terrain min zoom since rotation changes camera position
      this.updateTerrainMinZoom();

      // Ensure current zoom respects terrain limit after rotation
      const effectiveMinZoom = Math.max(this.config.minZoom, this.terrainMinZoom);
      if (this.currentZoom < effectiveMinZoom) {
        this.currentZoom = effectiveMinZoom;
        this.targetZoom = effectiveMinZoom;
      }

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

    // Use cached terrain minimum zoom (updated when camera position changes)
    const effectiveMinZoom = Math.max(this.config.minZoom, this.terrainMinZoom);

    // Set target zoom - actual zoom will smoothly interpolate in update()
    const zoomDelta = e.deltaY * 0.08;
    const newTargetZoom = Math.max(
      effectiveMinZoom,
      Math.min(this.config.maxZoom, this.targetZoom + zoomDelta)
    );

    // Only update if actually changing (prevents jitter at limits)
    if (Math.abs(newTargetZoom - this.targetZoom) > 0.01) {
      this.targetZoom = newTargetZoom;
    }
  }

  // Update the cached terrain minimum zoom based on current camera position
  private updateTerrainMinZoom(): void {
    if (!this.getTerrainHeight) {
      this.terrainMinZoom = this.config.minZoom;
      return;
    }

    const sinAngle = Math.sin(this.currentAngle);
    const cosAngle = Math.cos(this.currentAngle);

    // Binary search for minimum safe zoom
    // Important: recalculate pitch for each zoom level since pitch varies with zoom
    let low = this.config.minZoom;
    let high = this.config.maxZoom;

    while (high - low > 0.5) {
      const mid = (low + high) / 2;
      // Calculate the pitch that would be used at this zoom level
      const pitchAtZoom = this.calculateZoomBasedPitch(mid);
      const cosPitch = Math.cos(pitchAtZoom);
      const sinPitch = Math.sin(pitchAtZoom);

      const x = this.target.x + mid * sinAngle * cosPitch;
      const z = this.target.z + mid * cosAngle * cosPitch;
      const y = mid * sinPitch;
      const terrainHeight = this.getTerrainHeight(x, z);

      if (y < terrainHeight + 2) {
        low = mid; // Need more zoom (camera higher)
      } else {
        high = mid; // Can zoom in more
      }
    }

    this.terrainMinZoom = high;
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

    // Keyboard input (arrow keys only - WASD reserved for unit commands)
    if (this.keys.has('ArrowUp')) {
      dz -= this.config.panSpeed * dt;
    }
    if (this.keys.has('ArrowDown')) {
      dz += this.config.panSpeed * dt;
    }
    if (this.keys.has('ArrowLeft')) {
      dx -= this.config.panSpeed * dt;
    }
    if (this.keys.has('ArrowRight')) {
      dx += this.config.panSpeed * dt;
    }

    // Edge scrolling (disabled when mouse is over UI or outside viewport)
    if (!this.isMiddleMouseDown && this.edgeScrollEnabled && this.mouseInViewport) {
      const { edgeScrollThreshold, edgeScrollSpeed } = this.config;

      // Calculate effective right edge (accounting for UI panels)
      const effectiveRightEdge = this.screenWidth - this.edgeScrollRightOffset;

      if (this.mousePosition.x < edgeScrollThreshold) {
        dx -= edgeScrollSpeed * dt;
      } else if (this.mousePosition.x > effectiveRightEdge - edgeScrollThreshold) {
        dx += edgeScrollSpeed * dt;
      }

      if (this.mousePosition.y < edgeScrollThreshold) {
        dz -= edgeScrollSpeed * dt; // Top of screen = scroll up (same as W key)
      } else if (this.mousePosition.y > this.screenHeight - edgeScrollThreshold) {
        dz += edgeScrollSpeed * dt; // Bottom of screen = scroll down (same as S key)
      }
    }

    // Smooth zoom interpolation
    const zoomDiff = this.targetZoom - this.currentZoom;
    if (Math.abs(zoomDiff) > 0.01) {
      // Lerp towards target zoom (8 is the smoothing factor - higher = faster)
      this.currentZoom += zoomDiff * Math.min(1, dt * 8);
      // Update pitch based on new zoom level
      this.currentPitch = this.calculateZoomBasedPitch(this.currentZoom);
      this.updateCameraPosition();
    } else if (zoomDiff !== 0) {
      // Snap to exact target when close enough
      this.currentZoom = this.targetZoom;
      // Update pitch based on final zoom level
      this.currentPitch = this.calculateZoomBasedPitch(this.currentZoom);
      this.updateCameraPosition();
    }

    if (dx !== 0 || dz !== 0) {
      // Rotate movement direction based on camera angle
      // Use negative angle to compensate for camera rotation - movement should be screen-relative
      const cos = Math.cos(-this.currentAngle);
      const sin = Math.sin(-this.currentAngle);
      const rotatedX = dx * cos - dz * sin;
      const rotatedZ = dx * sin + dz * cos;

      this.target.x += rotatedX;
      this.target.z += rotatedZ;

      // Clamp to map boundaries - allow panning close to edges
      // Use smaller factors to allow panning closer to map edges
      const viewHalfWidth = this.currentZoom * 0.3;
      const viewHalfHeight = this.currentZoom * 0.3;
      this.target.x = Math.max(viewHalfWidth, Math.min(this.mapWidth - viewHalfWidth, this.target.x));
      this.target.z = Math.max(viewHalfHeight, Math.min(this.mapHeight - viewHalfHeight, this.target.z));

      // Update terrain min zoom when camera position changes
      this.updateTerrainMinZoom();

      // If we panned to higher terrain, ensure zoom respects new limit
      const effectiveMinZoom = Math.max(this.config.minZoom, this.terrainMinZoom);
      if (this.currentZoom < effectiveMinZoom) {
        this.currentZoom = effectiveMinZoom;
        this.targetZoom = effectiveMinZoom;
      }

      this.updateCameraPosition();
    }
  }

  private updateCameraPosition(): void {
    // Calculate camera position
    const x = this.target.x + this.currentZoom * Math.sin(this.currentAngle) * Math.cos(this.currentPitch);
    let y = this.currentZoom * Math.sin(this.currentPitch);
    const z = this.target.z + this.currentZoom * Math.cos(this.currentAngle) * Math.cos(this.currentPitch);

    // Ensure camera stays above terrain at its position
    if (this.getTerrainHeight) {
      const terrainHeight = this.getTerrainHeight(x, z);
      const minCameraHeight = terrainHeight + 2; // Minimum 2 units above terrain
      if (y < minCameraHeight) {
        y = minCameraHeight;
      }
    }

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  public setPosition(x: number, z: number): void {
    // Calculate viewport half-sizes - use smaller factors to allow panning close to map edges
    const viewHalfWidth = this.currentZoom * 0.3;
    const viewHalfHeight = this.currentZoom * 0.3;

    // Clamp position while allowing camera to get close to edges
    this.target.x = Math.max(viewHalfWidth, Math.min(this.mapWidth - viewHalfWidth, x));
    this.target.z = Math.max(viewHalfHeight, Math.min(this.mapHeight - viewHalfHeight, z));

    // Update terrain min zoom for new position
    this.updateTerrainMinZoom();

    // Ensure zoom respects terrain limit at new position
    const effectiveMinZoom = Math.max(this.config.minZoom, this.terrainMinZoom);
    if (this.currentZoom < effectiveMinZoom) {
      this.currentZoom = effectiveMinZoom;
      this.targetZoom = effectiveMinZoom;
    }

    this.updateCameraPosition();
  }

  public setZoom(zoom: number, instant = false): void {
    const clampedZoom = Math.max(
      this.config.minZoom,
      Math.min(this.config.maxZoom, zoom)
    );
    this.targetZoom = clampedZoom;
    if (instant) {
      this.currentZoom = clampedZoom;
      this.updateCameraPosition();
    }
    // Non-instant will smoothly interpolate in update()
  }

  public getZoom(): number {
    return this.currentZoom;
  }

  public setAngle(angle: number): void {
    this.currentAngle = angle;
    this.updateCameraPosition();
  }

  public getAngle(): number {
    return this.currentAngle;
  }

  // Enable/disable edge scrolling (used when mouse is over UI elements)
  public setEdgeScrollEnabled(enabled: boolean): void {
    this.edgeScrollEnabled = enabled;
  }

  public isEdgeScrollEnabled(): boolean {
    return this.edgeScrollEnabled;
  }

  // Set right edge offset for edge scrolling (used in editor with right panel)
  // Pass the width of UI panels on the right side of the screen
  public setEdgeScrollRightOffset(offset: number): void {
    this.edgeScrollRightOffset = offset;
  }

  public getPosition(): { x: number; z: number } {
    return { x: this.target.x, z: this.target.z };
  }

  // Set the terrain height function for accurate screen-to-world conversion
  public setTerrainHeightFunction(fn: (x: number, z: number) => number): void {
    this.getTerrainHeight = fn;
    // Calculate initial terrain min zoom now that we have the height function
    this.updateTerrainMinZoom();
  }

  // Convert screen coordinates to world coordinates
  // PERF: Reuses cached raycaster/vectors to avoid allocation on every call
  public screenToWorld(screenX: number, screenY: number): THREE.Vector3 {
    const normalizedX = (screenX / this.screenWidth) * 2 - 1;
    const normalizedY = -(screenY / this.screenHeight) * 2 + 1;

    // Reuse cached objects instead of allocating new ones
    this._raycastMouseVec.set(normalizedX, normalizedY);
    this._raycaster.setFromCamera(this._raycastMouseVec, this.camera);

    // Reset plane to y=0
    this._raycastPlane.normal.set(0, 1, 0);
    this._raycastPlane.constant = 0;

    // Initial intersection with y=0 plane
    this._raycaster.ray.intersectPlane(this._raycastPlane, this._raycastTarget);

    // If we have terrain height function, iterate to find accurate intersection
    // Use iterative refinement with early termination for efficiency
    if (this.getTerrainHeight && this._raycastTarget) {
      const CONVERGENCE_THRESHOLD = 0.01; // Stop when position change is < this
      const MAX_ITERATIONS = 6; // More iterations for better accuracy

      let prevX = this._raycastTarget.x;
      let prevZ = this._raycastTarget.z;

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const terrainHeight = this.getTerrainHeight(this._raycastTarget.x, this._raycastTarget.z);
        // Create plane at terrain height
        this._raycastPlane.constant = -terrainHeight;
        this._raycaster.ray.intersectPlane(this._raycastPlane, this._raycastTarget);

        // Check for convergence - stop early if position barely changed
        const dx = Math.abs(this._raycastTarget.x - prevX);
        const dz = Math.abs(this._raycastTarget.z - prevZ);
        if (dx < CONVERGENCE_THRESHOLD && dz < CONVERGENCE_THRESHOLD) {
          break;
        }

        prevX = this._raycastTarget.x;
        prevZ = this._raycastTarget.z;
      }
    }

    return this._raycastTarget.clone(); // Clone to avoid returning internal reference
  }

  // Convert world coordinates to screen coordinates
  // Takes world position (x, y for ground plane, optionally z for height)
  // Returns screen position { x, y } in pixels, or null if behind camera
  public worldToScreen(worldX: number, worldZ: number, worldY?: number): { x: number; y: number } | null {
    // Use provided height or get terrain height
    const height = worldY ?? (this.getTerrainHeight ? this.getTerrainHeight(worldX, worldZ) : 0);

    // Create 3D position (Three.js uses Y for up)
    const worldPos = new THREE.Vector3(worldX, height, worldZ);

    // Project to normalized device coordinates (-1 to 1)
    const projected = worldPos.clone().project(this.camera);

    // Check if behind camera
    if (projected.z > 1) {
      return null;
    }

    // Convert to screen coordinates
    const screenX = (projected.x * 0.5 + 0.5) * this.screenWidth;
    const screenY = (-projected.y * 0.5 + 0.5) * this.screenHeight;

    return { x: screenX, y: screenY };
  }

  // Get screen dimensions
  public getScreenDimensions(): { width: number; height: number } {
    return { width: this.screenWidth, height: this.screenHeight };
  }

  // Set screen dimensions externally (for when container resizes without window resize event)
  public setScreenDimensions(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  public dispose(): void {
    if (typeof window === 'undefined') return;

    // Use pre-bound handlers - these are the same references used in addEventListener
    window.removeEventListener('keydown', this.boundHandleKeyDown);
    window.removeEventListener('keyup', this.boundHandleKeyUp);
    window.removeEventListener('mousemove', this.boundHandleMouseMove);
    window.removeEventListener('mousedown', this.boundHandleMouseDown);
    window.removeEventListener('mouseup', this.boundHandleMouseUp);
    window.removeEventListener('wheel', this.boundHandleWheel);
    // Note: resize listener not added (handled externally via setScreenDimensions)
    document.removeEventListener('mouseleave', this.boundHandleMouseLeave);
    document.removeEventListener('mouseenter', this.boundHandleMouseEnter);
  }
}

/**
 * PlanarReflection - Shared planar reflection system for ultra quality water
 *
 * Creates a SINGLE reflection render target shared across all water surfaces.
 * This is critical for performance - we cannot afford per-region reflections.
 *
 * Rendering approach:
 * 1. Create a mirror camera that reflects across the water plane
 * 2. Render the scene from the mirrored viewpoint to a render target
 * 3. Use the render target as a reflection texture in water shaders
 *
 * Optimizations:
 * - Single shared render target for all water
 * - Layer-based selective rendering (exclude small objects)
 * - Update throttling (every 2-3 frames)
 * - Resolution control based on quality/performance
 * - Clip plane to avoid rendering below water
 */

import * as THREE from 'three';

/**
 * Configuration for planar reflection system
 */
export interface PlanarReflectionConfig {
  /** Render target resolution (512, 1024, or 2048) */
  resolution: 512 | 1024 | 2048;
  /** Y position of the water plane (world space) */
  waterHeight: number;
  /** Layer mask for objects to include in reflection (optional) */
  layers?: THREE.Layers;
  /** Number of frames between reflection updates (default: 2) */
  updateInterval?: number;
  /** Whether to enable clip plane to avoid underwater rendering */
  useClipPlane?: boolean;
  /** Near plane offset for reflection camera (prevents z-fighting) */
  clipBias?: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<Omit<PlanarReflectionConfig, 'layers'>> & { layers: THREE.Layers | null } = {
  resolution: 1024,
  waterHeight: 0,
  layers: null,
  updateInterval: 2,
  useClipPlane: true,
  clipBias: 0.001,
};

/**
 * Planar reflection system for water rendering.
 * Creates a single shared reflection texture for all water surfaces.
 */
export class PlanarReflection {
  /** The reflection texture to sample in water shaders */
  public reflectionTexture: THREE.Texture;

  /** The render target for reflection rendering */
  private renderTarget: THREE.WebGLRenderTarget;

  /** Mirror camera for reflection rendering */
  private reflectionCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera;

  /** Configuration */
  private config: Required<Omit<PlanarReflectionConfig, 'layers'>> & { layers: THREE.Layers | null };

  /** Renderer reference */
  private renderer: THREE.WebGLRenderer | THREE.WebGPURenderer;

  /** Frame counter for update throttling */
  private frameCounter: number = 0;

  /** Reflection plane for mirror transform calculation */
  private reflectionPlane: THREE.Plane;

  /** Clipping plane for underwater culling */
  private clipPlane: THREE.Plane;

  /** Temporary matrices for reflection calculation (pre-allocated) */
  private readonly _reflectionMatrix = new THREE.Matrix4();
  private readonly _tempMatrix = new THREE.Matrix4();
  private readonly _tempVector = new THREE.Vector3();
  private readonly _tempQuaternion = new THREE.Quaternion();
  private readonly _lookAtTarget = new THREE.Vector3();
  private readonly _cameraWorldPosition = new THREE.Vector3();

  /** Original camera layers (for restoration after render) */
  private originalCameraLayers: THREE.Layers | null = null;

  /** Whether the system is enabled */
  private enabled: boolean = true;

  /** Cached texture matrix for UV coordinate transformation */
  public textureMatrix: THREE.Matrix4;

  /**
   * Create a new planar reflection system
   *
   * @param renderer - Three.js WebGL or WebGPU renderer
   * @param config - Configuration options
   */
  constructor(
    renderer: THREE.WebGLRenderer | THREE.WebGPURenderer,
    config: PlanarReflectionConfig
  ) {
    this.renderer = renderer;
    this.config = { ...DEFAULT_CONFIG, ...config, layers: config.layers ?? null };

    // Create render target with HDR support
    // Use WebGLRenderTarget even with WebGPU for compatibility
    this.renderTarget = new THREE.WebGLRenderTarget(
      this.config.resolution,
      this.config.resolution,
      {
        type: THREE.HalfFloatType, // HDR support
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false, // Not needed for reflections
        depthBuffer: true,
        stencilBuffer: false,
      }
    );

    this.reflectionTexture = this.renderTarget.texture;
    this.reflectionTexture.name = 'WaterPlanarReflection';

    // Create reflection camera (will be updated each frame)
    // Use perspective camera - will copy properties from main camera
    this.reflectionCamera = new THREE.PerspectiveCamera();

    // Set up clip layers if provided
    if (this.config.layers) {
      this.reflectionCamera.layers = this.config.layers.clone();
    }

    // Create reflection plane (water surface)
    // Normal points up (positive Y), passing through waterHeight
    this.reflectionPlane = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      -this.config.waterHeight
    );

    // Create clip plane (slightly below water to avoid artifacts)
    this.clipPlane = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      -(this.config.waterHeight - this.config.clipBias)
    );

    // Initialize texture matrix (transforms world coords to reflection UV)
    this.textureMatrix = new THREE.Matrix4();
  }

  /**
   * Set the water height (Y position of water plane)
   */
  public setWaterHeight(height: number): void {
    this.config.waterHeight = height;
    this.reflectionPlane.constant = -height;
    this.clipPlane.constant = -(height - this.config.clipBias);
  }

  /**
   * Set the render target resolution
   */
  public setResolution(resolution: 512 | 1024 | 2048): void {
    if (this.config.resolution === resolution) return;

    this.config.resolution = resolution;

    // Recreate render target at new resolution
    this.renderTarget.dispose();
    this.renderTarget = new THREE.WebGLRenderTarget(resolution, resolution, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.reflectionTexture = this.renderTarget.texture;
    this.reflectionTexture.name = 'WaterPlanarReflection';
  }

  /**
   * Set the update interval (frames between reflection updates)
   */
  public setUpdateInterval(interval: number): void {
    this.config.updateInterval = Math.max(1, Math.floor(interval));
  }

  /**
   * Set layers mask for selective rendering
   */
  public setLayers(layers: THREE.Layers | null): void {
    this.config.layers = layers;
    if (layers) {
      this.reflectionCamera.layers = layers.clone();
    } else {
      this.reflectionCamera.layers.enableAll();
    }
  }

  /**
   * Enable or disable the reflection system
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if the reflection should update this frame
   *
   * @param frameCount - Current frame number
   * @returns True if reflection should be rendered
   */
  public shouldUpdate(frameCount?: number): boolean {
    if (!this.enabled) return false;

    const frame = frameCount ?? this.frameCounter;
    return (frame % this.config.updateInterval) === 0;
  }

  /**
   * Update the reflection texture by rendering the scene from mirrored viewpoint
   *
   * @param scene - The scene to render
   * @param camera - The main camera to mirror
   */
  public update(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.enabled) return;

    this.frameCounter++;

    // Check if we should update this frame
    if (!this.shouldUpdate(this.frameCounter)) return;

    // Update reflection camera to match main camera
    this.updateReflectionCamera(camera);

    // Update texture matrix for UV transformation
    this.updateTextureMatrix(camera);

    // Store original render state
    const originalRenderTarget = this.renderer.getRenderTarget();
    const originalXrEnabled = (this.renderer as THREE.WebGLRenderer).xr?.enabled ?? false;

    // Disable XR if present
    if ((this.renderer as THREE.WebGLRenderer).xr) {
      (this.renderer as THREE.WebGLRenderer).xr.enabled = false;
    }

    // Apply clip plane if enabled
    const originalClippingPlanes = this.renderer.clippingPlanes;
    if (this.config.useClipPlane) {
      this.renderer.clippingPlanes = [this.clipPlane];
    }

    // Render to reflection target
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.clear();
    this.renderer.render(scene, this.reflectionCamera);

    // Restore render state
    this.renderer.setRenderTarget(originalRenderTarget);
    this.renderer.clippingPlanes = originalClippingPlanes;

    if ((this.renderer as THREE.WebGLRenderer).xr) {
      (this.renderer as THREE.WebGLRenderer).xr.enabled = originalXrEnabled;
    }
  }

  /**
   * Update the reflection camera to mirror the main camera
   */
  private updateReflectionCamera(camera: THREE.Camera): void {
    // Get camera world position
    camera.getWorldPosition(this._cameraWorldPosition);

    // Mirror position across water plane
    // Formula: reflected = position - 2 * (dot(position, normal) + d) * normal
    const dot = this._cameraWorldPosition.y - this.config.waterHeight;
    const mirroredY = this._cameraWorldPosition.y - 2 * dot;

    this.reflectionCamera.position.set(
      this._cameraWorldPosition.x,
      mirroredY,
      this._cameraWorldPosition.z
    );

    // Get camera look-at direction
    camera.getWorldDirection(this._tempVector);

    // Mirror the look direction (flip Y component)
    this._tempVector.y = -this._tempVector.y;

    // Calculate look-at target for mirrored camera
    this._lookAtTarget.copy(this.reflectionCamera.position).add(this._tempVector);
    this.reflectionCamera.lookAt(this._lookAtTarget);

    // Mirror the up vector (flip to look at ceiling reflection correctly)
    this.reflectionCamera.up.set(0, -1, 0);

    // Copy projection properties
    if (camera instanceof THREE.PerspectiveCamera && this.reflectionCamera instanceof THREE.PerspectiveCamera) {
      this.reflectionCamera.fov = camera.fov;
      this.reflectionCamera.aspect = camera.aspect;
      this.reflectionCamera.near = camera.near;
      this.reflectionCamera.far = camera.far;
    } else if (camera instanceof THREE.OrthographicCamera && this.reflectionCamera instanceof THREE.OrthographicCamera) {
      this.reflectionCamera.left = camera.left;
      this.reflectionCamera.right = camera.right;
      this.reflectionCamera.top = camera.top;
      this.reflectionCamera.bottom = camera.bottom;
      this.reflectionCamera.near = camera.near;
      this.reflectionCamera.far = camera.far;
    }

    this.reflectionCamera.updateProjectionMatrix();
    this.reflectionCamera.updateMatrixWorld();
  }

  /**
   * Update the texture matrix for reflection UV mapping
   * This transforms world coordinates to reflection texture coordinates
   */
  private updateTextureMatrix(camera: THREE.Camera): void {
    // Texture matrix: transforms from world space to reflection texture space
    // Formula: textureMatrix = biasMatrix * projectionMatrix * viewMatrix
    //
    // The bias matrix maps from NDC [-1,1] to texture coords [0,1]

    this.textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );

    this.textureMatrix.multiply(this.reflectionCamera.projectionMatrix);
    this.textureMatrix.multiply(this.reflectionCamera.matrixWorldInverse);
  }

  /**
   * Get the reflection camera (for debugging)
   */
  public getReflectionCamera(): THREE.Camera {
    return this.reflectionCamera;
  }

  /**
   * Get the render target (for advanced usage)
   */
  public getRenderTarget(): THREE.WebGLRenderTarget {
    return this.renderTarget;
  }

  /**
   * Get current resolution
   */
  public getResolution(): number {
    return this.config.resolution;
  }

  /**
   * Get current water height
   */
  public getWaterHeight(): number {
    return this.config.waterHeight;
  }

  /**
   * Check if the system is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get memory usage estimate in bytes
   */
  public getMemoryUsage(): number {
    // RGBA16F = 8 bytes per pixel
    const textureBytes = this.config.resolution * this.config.resolution * 8;
    // Add depth buffer (24-bit depth = 3 bytes per pixel, but GPU aligns to 4)
    const depthBytes = this.config.resolution * this.config.resolution * 4;
    return textureBytes + depthBytes;
  }

  /**
   * Get memory usage in megabytes
   */
  public getMemoryUsageMB(): number {
    return this.getMemoryUsage() / (1024 * 1024);
  }

  /**
   * Force an immediate reflection update (ignores throttling)
   */
  public forceUpdate(scene: THREE.Scene, camera: THREE.Camera): void {
    const wasEnabled = this.enabled;
    const wasInterval = this.config.updateInterval;

    this.enabled = true;
    this.config.updateInterval = 1;
    this.frameCounter = 0;

    this.update(scene, camera);

    this.enabled = wasEnabled;
    this.config.updateInterval = wasInterval;
  }

  /**
   * Dispose of all GPU resources
   */
  public dispose(): void {
    this.renderTarget.dispose();
    this.enabled = false;
  }
}

/**
 * Factory function to create a planar reflection system with quality-based settings
 *
 * @param renderer - Three.js renderer
 * @param quality - Quality level ('low', 'medium', 'high', 'ultra')
 * @param waterHeight - Y position of water surface
 * @returns Configured PlanarReflection instance
 */
export function createPlanarReflectionForQuality(
  renderer: THREE.WebGLRenderer | THREE.WebGPURenderer,
  quality: 'low' | 'medium' | 'high' | 'ultra',
  waterHeight: number
): PlanarReflection | null {
  // Only ultra quality gets planar reflections
  // Lower qualities use environment maps or no reflections
  if (quality !== 'ultra') {
    return null;
  }

  const resolutionMap: Record<string, 512 | 1024 | 2048> = {
    ultra: 1024, // 1024 is good balance of quality/performance
  };

  const updateIntervalMap: Record<string, number> = {
    ultra: 2, // Update every 2 frames at ultra
  };

  return new PlanarReflection(renderer, {
    resolution: resolutionMap[quality] ?? 1024,
    waterHeight,
    updateInterval: updateIntervalMap[quality] ?? 2,
    useClipPlane: true,
    clipBias: 0.001,
  });
}

/**
 * Create a Layers object for selective reflection rendering
 * Excludes small objects like particles, grass, and debris for performance
 *
 * @returns Configured Layers mask for reflection rendering
 */
export function createReflectionLayers(): THREE.Layers {
  const layers = new THREE.Layers();

  // Enable default layer (0) for most objects
  layers.enable(0);

  // Standard layer assignments (should match game's layer system):
  // Layer 0: Default (terrain, buildings, large props)
  // Layer 1: Units
  // Layer 2: Large decorations (trees, rocks)
  // Layer 3: Small decorations (grass, pebbles) - EXCLUDE from reflections
  // Layer 4: Particles - EXCLUDE from reflections
  // Layer 5: UI/Overlays - EXCLUDE from reflections

  // Enable layers we want in reflections
  layers.enable(0); // Default
  layers.enable(1); // Units
  layers.enable(2); // Large decorations

  // Layers 3, 4, 5 are implicitly disabled (not enabled)

  return layers;
}

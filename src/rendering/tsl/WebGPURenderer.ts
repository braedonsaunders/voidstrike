/**
 * WebGPU Renderer Wrapper
 *
 * Provides a unified interface for the Three.js WebGPU renderer with:
 * - Async initialization (required for WebGPU)
 * - Automatic WebGL fallback
 * - Compute shader support
 * - Post-processing integration
 * - Custom WebGPU device limits (maxVertexBuffers: 16 for TAA velocity)
 */

import * as THREE from 'three';
import { WebGPURenderer, PostProcessing } from 'three/webgpu';
import { debugInitialization, debugShaders } from '@/utils/debugLogger';

// Desired WebGPU limits for optimal performance
// We'll request the minimum of these and what the adapter supports
const DESIRED_LIMITS = {
  // Vertex buffers: TAA velocity needs 8 (4 current + 4 prev matrix columns) + mesh attrs (3-5)
  maxVertexBuffers: 16,
  // Texture size: Allow up to 16K textures for high-res shadow maps and terrain
  maxTextureDimension2D: 16384,
  // Storage buffer size: 256MB is a safer limit that most GPUs support
  // (WebGPU spec default is 128MB, but many GPUs support more)
  maxStorageBufferBindingSize: 256 * 1024 * 1024,
  // Buffer size: 256MB matches spec default maximum
  maxBufferSize: 256 * 1024 * 1024,
};

export interface WebGPURendererConfig {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  powerPreference?: 'high-performance' | 'low-power' | 'default';
  forceWebGL?: boolean;
  logarithmicDepthBuffer?: boolean;
}

export interface RenderContext {
  renderer: WebGPURenderer;
  isWebGPU: boolean;
  supportsCompute: boolean;
  postProcessing: PostProcessing | null;
  deviceLimits: {
    maxVertexBuffers: number;
    maxTextureDimension2D: number;
    maxStorageBufferBindingSize: number;
    maxBufferSize: number;
  };
}

// Default limits when WebGPU is not available or fails
const DEFAULT_LIMITS = {
  maxVertexBuffers: 8,
  maxTextureDimension2D: 8192,
  maxStorageBufferBindingSize: 256 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
};

interface AdapterLimits {
  maxVertexBuffers: number;
  maxTextureDimension2D: number;
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
  supported: boolean;
}

/**
 * Query WebGPU adapter limits to determine what we can request
 */
async function getWebGPULimits(): Promise<AdapterLimits> {
  // Check if WebGPU is available
  if (!navigator.gpu) {
    debugInitialization.log('[WebGPU] WebGPU not available, falling back to WebGL');
    return { ...DEFAULT_LIMITS, supported: false };
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      debugInitialization.log('[WebGPU] No adapter available');
      return { ...DEFAULT_LIMITS, supported: false };
    }

    // Query all the adapter's limits we care about
    const limits = adapter.limits;

    debugInitialization.log(`[WebGPU] Adapter limits:`, {
      maxVertexBuffers: limits.maxVertexBuffers,
      maxVertexAttributes: limits.maxVertexAttributes,
      maxTextureDimension2D: limits.maxTextureDimension2D,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
      maxBindGroups: limits.maxBindGroups,
      maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX,
    });

    return {
      maxVertexBuffers: limits.maxVertexBuffers,
      maxTextureDimension2D: limits.maxTextureDimension2D,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
      supported: true,
    };
  } catch (error) {
    debugInitialization.warn('[WebGPU] Error querying adapter limits:', error);
    return { ...DEFAULT_LIMITS, supported: false };
  }
}

/**
 * Initialize the WebGPU renderer with async setup and custom device limits
 */
export async function createWebGPURenderer(config: WebGPURendererConfig): Promise<RenderContext> {
  const {
    canvas,
    antialias = true,
    powerPreference = 'high-performance',
    forceWebGL = false,
    logarithmicDepthBuffer = false,
  } = config;

  // Query adapter limits first to determine what we can request
  const adapterLimits = await getWebGPULimits();

  // Track actual limits (will be updated after device creation)
  let actualLimits = { ...DEFAULT_LIMITS };

  // Create renderer options with requiredLimits passed directly to WebGPURenderer
  // NOTE: requiredLimits must be passed to WebGPURenderer, NOT WebGPUBackend
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rendererOptions: any = {
    canvas,
    antialias,
    powerPreference,
    forceWebGL,
    logarithmicDepthBuffer,
  };

  // If WebGPU is supported, request optimized limits directly on the renderer
  // This is the correct way per Three.js GitHub issue #29865
  // IMPORTANT: Request minimum of desired limits and what adapter supports to avoid device creation failure
  if (!forceWebGL && adapterLimits.supported) {
    debugInitialization.log(`[WebGPU] Adapter reported limits:`, {
      maxVertexBuffers: adapterLimits.maxVertexBuffers,
      maxTextureDimension2D: adapterLimits.maxTextureDimension2D,
      maxStorageBufferBindingSize: adapterLimits.maxStorageBufferBindingSize,
      maxBufferSize: adapterLimits.maxBufferSize,
    });

    // Request minimum of desired and adapter-supported limits to avoid device creation failure
    const requestedLimits = {
      maxVertexBuffers: Math.min(DESIRED_LIMITS.maxVertexBuffers, adapterLimits.maxVertexBuffers),
      maxTextureDimension2D: Math.min(DESIRED_LIMITS.maxTextureDimension2D, adapterLimits.maxTextureDimension2D),
      maxStorageBufferBindingSize: Math.min(DESIRED_LIMITS.maxStorageBufferBindingSize, adapterLimits.maxStorageBufferBindingSize),
      maxBufferSize: Math.min(DESIRED_LIMITS.maxBufferSize, adapterLimits.maxBufferSize),
    };

    debugInitialization.log(`[WebGPU] Requesting limits (capped to adapter):`, requestedLimits);

    // Pass requiredLimits directly to WebGPURenderer constructor
    rendererOptions.requiredLimits = requestedLimits;
    actualLimits = { ...requestedLimits };
  }

  // Create the WebGPU renderer
  const renderer = new WebGPURenderer(rendererOptions);

  // Initialize async (required for WebGPU)
  await renderer.init();

  // Detect capabilities
  const isWebGPU = !forceWebGL && renderer.backend?.isWebGPUBackend === true;
  const supportsCompute = isWebGPU; // Compute shaders only work with WebGPU

  // CRITICAL: If we requested WebGPU limits but got WebGL2 fallback, reset to default limits
  // This can happen when:
  // 1. WebGPU adapter reported supported, but device creation failed
  // 2. The requested limits exceeded what the device could provide
  // Without this, code may assume 16 vertex buffers when WebGL2 only has 8, causing freezes
  if (!isWebGPU && adapterLimits.supported) {
    debugInitialization.warn('[WebGPU] Device creation failed, falling back to WebGL2 limits');
    actualLimits = { ...DEFAULT_LIMITS };
  }

  // Note: We trust our requested limits rather than querying device.limits
  // because device.limits may report spec minimums rather than what we requested
  // If device creation succeeded with our requiredLimits, we have at least those limits

  debugInitialization.log(`[WebGPU] Renderer initialized:`, {
    backend: isWebGPU ? 'WebGPU' : 'WebGL',
    supportsCompute,
    antialias,
    maxVertexBuffers: actualLimits.maxVertexBuffers,
    maxTextureDimension2D: actualLimits.maxTextureDimension2D,
    velocityTrackingSupported: actualLimits.maxVertexBuffers >= 11, // 3 mesh attrs + 8 velocity attrs
  });

  // Configure renderer
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  // Enable local clipping planes for building construction reveal effect
  (renderer as any).localClippingEnabled = true;

  // Configure shadow maps - always enabled to keep shadow map depth texture initialized
  // The directionalLight.castShadow is always true, but we toggle terrain.receiveShadow
  // and object castShadow/receiveShadow to control shadow visibility
  // Use BasicShadowMap instead of PCFSoftShadowMap for much better performance
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;

  return {
    renderer,
    isWebGPU,
    supportsCompute,
    postProcessing: null,
    deviceLimits: actualLimits,
  };
}

/**
 * Create post-processing pipeline using TSL nodes
 */
export function createPostProcessingPipeline(
  context: RenderContext,
  scene: THREE.Scene,
  camera: THREE.Camera
): PostProcessing {
  const postProcessing = new PostProcessing(context.renderer);

  // Import TSL post-processing nodes dynamically
  // This will be configured by the specific post-processing setup
  context.postProcessing = postProcessing;

  return postProcessing;
}

/**
 * Update renderer size on window resize
 */
export function updateRendererSize(
  context: RenderContext,
  width: number,
  height: number
): void {
  context.renderer.setSize(width, height);
  if (context.postProcessing) {
    // PostProcessing handles its own resize through the renderer
  }
}

/**
 * Execute compute shader (WebGPU only)
 */
export async function executeCompute(
  context: RenderContext,
  computeNode: any
): Promise<void> {
  if (!context.supportsCompute) {
    debugShaders.warn('[WebGPU] Compute shaders not supported - skipping');
    return;
  }

  await context.renderer.computeAsync(computeNode);
}

/**
 * Render the scene with post-processing
 */
export function render(
  context: RenderContext,
  scene: THREE.Scene,
  camera: THREE.Camera
): void {
  if (context.postProcessing) {
    context.postProcessing.render();
  } else {
    context.renderer.render(scene, camera);
  }
}

/**
 * Render async (for compute shader coordination)
 */
export async function renderAsync(
  context: RenderContext,
  scene: THREE.Scene,
  camera: THREE.Camera
): Promise<void> {
  if (context.postProcessing) {
    await context.postProcessing.renderAsync();
  } else {
    await context.renderer.renderAsync(scene, camera);
  }
}

/**
 * Dispose of renderer resources
 */
export function disposeRenderer(context: RenderContext): void {
  context.renderer.dispose();
  context.postProcessing = null;
}

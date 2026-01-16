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

interface AdapterInfo {
  /** All adapter limits as a plain JS object (required for requestDevice) */
  requiredLimits: Record<string, number>;
  /** Tracked limits we care about for our features */
  trackedLimits: {
    maxVertexBuffers: number;
    maxTextureDimension2D: number;
    maxStorageBufferBindingSize: number;
    maxBufferSize: number;
  };
  supported: boolean;
}

/**
 * Query WebGPU adapter and get ALL limits as a plain JS object.
 * Per Three.js issue #29865, we must copy all adapter limits to a plain object
 * and pass them to WebGPURenderer via requiredLimits.
 *
 * IMPORTANT: adapter.limits is a GPUSupportedLimits object, NOT a plain JS object.
 * Passing it directly to requiredLimits doesn't work - we must manually copy values.
 */
async function getWebGPUAdapterInfo(): Promise<AdapterInfo> {
  // Check if WebGPU is available
  if (!navigator.gpu) {
    debugInitialization.log('[WebGPU] WebGPU not available, falling back to WebGL');
    return {
      requiredLimits: {},
      trackedLimits: { ...DEFAULT_LIMITS },
      supported: false
    };
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      debugInitialization.log('[WebGPU] No adapter available');
      return {
        requiredLimits: {},
        trackedLimits: { ...DEFAULT_LIMITS },
        supported: false
      };
    }

    // Copy ALL adapter limits to a plain JS object
    // This is required per Three.js issue #29865 and WebGPU spec
    // GPUSupportedLimits is NOT a plain object, so we must manually copy
    const requiredLimits: Record<string, number> = {};
    const limits = adapter.limits;

    for (const key in limits) {
      // Skip subgroup sizes as they're handled differently
      if (key === 'minSubgroupSize' || key === 'maxSubgroupSize') continue;

      const value = (limits as any)[key];
      if (typeof value === 'number') {
        requiredLimits[key] = value;
      }
    }

    debugInitialization.log(`[WebGPU] Adapter limits (copied to plain object):`, {
      maxVertexBuffers: requiredLimits.maxVertexBuffers,
      maxTextureDimension2D: requiredLimits.maxTextureDimension2D,
      maxStorageBufferBindingSize: requiredLimits.maxStorageBufferBindingSize,
      maxBufferSize: requiredLimits.maxBufferSize,
      totalLimitsCopied: Object.keys(requiredLimits).length,
    });

    return {
      requiredLimits,
      trackedLimits: {
        maxVertexBuffers: requiredLimits.maxVertexBuffers ?? DEFAULT_LIMITS.maxVertexBuffers,
        maxTextureDimension2D: requiredLimits.maxTextureDimension2D ?? DEFAULT_LIMITS.maxTextureDimension2D,
        maxStorageBufferBindingSize: requiredLimits.maxStorageBufferBindingSize ?? DEFAULT_LIMITS.maxStorageBufferBindingSize,
        maxBufferSize: requiredLimits.maxBufferSize ?? DEFAULT_LIMITS.maxBufferSize,
      },
      supported: true,
    };
  } catch (error) {
    debugInitialization.warn('[WebGPU] Error querying adapter:', error);
    return {
      requiredLimits: {},
      trackedLimits: { ...DEFAULT_LIMITS },
      supported: false
    };
  }
}

/**
 * Initialize the WebGPU renderer with async setup and custom device limits.
 *
 * Per Three.js issue #29865 and WebGPU best practices:
 * - We query the adapter's limits FIRST
 * - Copy ALL limits to a plain JS object (GPUSupportedLimits can't be used directly)
 * - Pass the full limits object to WebGPURenderer via requiredLimits
 *
 * This ensures we get the maximum capabilities the hardware supports.
 */
export async function createWebGPURenderer(config: WebGPURendererConfig): Promise<RenderContext> {
  const {
    canvas,
    antialias = true,
    powerPreference = 'high-performance',
    forceWebGL = false,
    logarithmicDepthBuffer = false,
  } = config;

  // Query adapter and get ALL limits as a plain JS object
  const adapterInfo = await getWebGPUAdapterInfo();

  // Track the limits we care about for our features
  let actualLimits = { ...DEFAULT_LIMITS };

  // Create renderer options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rendererOptions: any = {
    canvas,
    antialias,
    powerPreference,
    forceWebGL,
    logarithmicDepthBuffer,
  };

  // If WebGPU is supported, pass ALL adapter limits to the renderer
  // This is the correct approach per Three.js issue #29865
  if (!forceWebGL && adapterInfo.supported) {
    debugInitialization.log(`[WebGPU] Requesting ALL adapter limits (${Object.keys(adapterInfo.requiredLimits).length} limits)`);

    // Pass ALL limits - this ensures we get maximum hardware capabilities
    rendererOptions.requiredLimits = adapterInfo.requiredLimits;
    actualLimits = { ...adapterInfo.trackedLimits };
  }

  // Create the WebGPU renderer
  const renderer = new WebGPURenderer(rendererOptions);

  // Initialize async (required for WebGPU)
  await renderer.init();

  // Detect capabilities
  const isWebGPU = !forceWebGL && renderer.backend?.isWebGPUBackend === true;
  const supportsCompute = isWebGPU; // Compute shaders only work with WebGPU

  // If we requested WebGPU limits but got WebGL2 fallback, reset to default limits
  // This prevents code from assuming 16 vertex buffers when WebGL2 only has 8
  if (!isWebGPU && adapterInfo.supported) {
    debugInitialization.warn('[WebGPU] Device creation failed unexpectedly, falling back to WebGL2 limits');
    actualLimits = { ...DEFAULT_LIMITS };
  }

  debugInitialization.log(`[WebGPU] Renderer initialized:`, {
    backend: isWebGPU ? 'WebGPU' : 'WebGL',
    supportsCompute,
    antialias,
    maxVertexBuffers: actualLimits.maxVertexBuffers,
    maxTextureDimension2D: actualLimits.maxTextureDimension2D,
    maxStorageBufferBindingSize: actualLimits.maxStorageBufferBindingSize,
    maxBufferSize: actualLimits.maxBufferSize,
    velocityTrackingSupported: actualLimits.maxVertexBuffers >= 11,
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

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL shader nodes use polymorphic types */
/**
 * WebGPU Renderer Wrapper
 *
 * Provides a unified interface for the Three.js WebGPU renderer with:
 * - Async initialization (required for WebGPU)
 * - Automatic WebGL fallback
 * - Compute shader support
 * - Post-processing integration
 * - Custom WebGPU device limits (maxVertexBuffers: 16 for TAA velocity)
 * - Device lost detection and recovery infrastructure
 */

import * as THREE from 'three';
import { WebGPURenderer, PostProcessing } from 'three/webgpu';
import { debugInitialization } from '@/utils/debugLogger';

// ============================================
// Device Lost Types and Interfaces
// ============================================

/**
 * Reason for WebGPU device loss.
 * - 'destroyed': Device was explicitly destroyed (e.g., tab backgrounded, system sleep)
 * - 'unknown': Device lost for unknown reason (e.g., GPU hang, driver crash, OOM)
 */
export type DeviceLostReason = 'destroyed' | 'unknown';

/**
 * Event emitted when WebGPU device is lost.
 */
export interface DeviceLostEvent {
  /** Reason for device loss */
  reason: DeviceLostReason;
  /** Browser-provided message with additional details */
  message: string;
  /** Timestamp when device loss was detected */
  timestamp: number;
  /** GPU info at time of loss (if available) */
  gpuInfo: GpuAdapterInfo | null;
}

/**
 * Callback invoked when WebGPU device is lost.
 */
export type DeviceLostCallback = (event: DeviceLostEvent) => void;

/**
 * Options for attempting renderer recovery after device loss.
 */
export interface RecoveryOptions {
  /** Reduce quality settings (e.g., lower resolution, fewer effects) */
  reduceQuality: boolean;
  /** Force WebGL fallback instead of retrying WebGPU */
  forceWebGL: boolean;
  /** Maximum number of retry attempts before giving up */
  maxRetries?: number;
  /** Delay in milliseconds between retry attempts */
  retryDelayMs?: number;
}

// ============================================
// Renderer Configuration Types
// ============================================

export interface WebGPURendererConfig {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  powerPreference?: 'high-performance' | 'low-power' | 'default';
  forceWebGL?: boolean;
  logarithmicDepthBuffer?: boolean;
}

export interface GpuAdapterInfo {
  name: string;           // Device description (e.g., "NVIDIA GeForce RTX 4090")
  vendor: string;         // Vendor name (e.g., "nvidia", "amd", "intel")
  architecture: string;   // Architecture (e.g., "ampere")
  isIntegrated: boolean;  // True if likely an integrated GPU
}

export interface RenderContext {
  renderer: WebGPURenderer;
  isWebGPU: boolean;
  supportsCompute: boolean;
  postProcessing: PostProcessing | null;
  gpuInfo: GpuAdapterInfo | null;
  deviceLimits: {
    maxVertexBuffers: number;
    maxTextureDimension2D: number;
    maxStorageBufferBindingSize: number;
    maxBufferSize: number;
  };
  /**
   * Whether the GPU supports timestamp queries for accurate GPU timing.
   * If true, GPUTimestampProfiler can be used to measure actual GPU execution time.
   */
  supportsTimestampQuery: boolean;
  /**
   * Direct access to the WebGPU device (null if WebGL fallback or not available).
   * Use for advanced features like timestamp queries that need device access.
   */
  gpuDevice: GPUDevice | null;
  /**
   * Register a callback to be notified when the WebGPU device is lost.
   * Multiple callbacks can be registered.
   */
  onDeviceLost: (callback: DeviceLostCallback) => void;
  /**
   * Unregister a previously registered device lost callback.
   */
  offDeviceLost: (callback: DeviceLostCallback) => void;
  /**
   * Check if the WebGPU device has been lost.
   * Returns true if device is lost and rendering will fail.
   */
  isDeviceLost: () => boolean;
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
  /** GPU adapter info for display */
  gpuInfo: GpuAdapterInfo | null;
  /** Whether WebGPU adapter is available */
  supported: boolean;
  /** Whether timestamp-query feature is available for GPU timing */
  supportsTimestampQuery: boolean;
}

/**
 * Query WebGPU adapter and get ALL limits as a plain JS object.
 * Per Three.js issue #29865, we must copy all adapter limits to a plain object
 * and pass them to WebGPURenderer via requiredLimits.
 *
 * IMPORTANT: adapter.limits is a GPUSupportedLimits object, NOT a plain JS object.
 * Passing it directly to requiredLimits doesn't work - we must manually copy values.
 */
/**
 * Detect if GPU is likely integrated based on name/vendor patterns.
 */
function detectIntegratedGpu(description: string, vendor: string): boolean {
  const desc = description.toLowerCase();
  const v = vendor.toLowerCase();

  // Intel integrated GPUs
  if (v === 'intel' || desc.includes('intel')) {
    // Intel Arc discrete GPUs
    if (desc.includes('arc')) return false;
    // Most Intel GPUs are integrated (UHD, Iris, etc.)
    return true;
  }

  // AMD integrated (APU) patterns
  if (desc.includes('radeon graphics') || desc.includes('vega') && desc.includes('ryzen')) {
    return true;
  }

  // Apple integrated (M1, M2, etc.)
  if (v === 'apple' || desc.includes('apple')) {
    return true; // Apple Silicon is technically integrated
  }

  return false;
}

/**
 * Format vendor name for display (capitalize properly).
 */
function formatVendor(vendor: string): string {
  const v = vendor.toLowerCase();
  if (v === 'nvidia') return 'NVIDIA';
  if (v === 'amd') return 'AMD';
  if (v === 'intel') return 'Intel';
  if (v === 'apple') return 'Apple';
  if (v === 'arm') return 'ARM';
  if (v === 'qualcomm') return 'Qualcomm';
  return vendor.charAt(0).toUpperCase() + vendor.slice(1);
}

/**
 * Format architecture name for display (capitalize properly).
 */
function formatArchitecture(arch: string): string {
  const a = arch.toLowerCase();
  // NVIDIA architectures
  if (a === 'ampere') return 'Ampere';
  if (a === 'ada') return 'Ada Lovelace';
  if (a === 'turing') return 'Turing';
  if (a === 'pascal') return 'Pascal';
  if (a === 'maxwell') return 'Maxwell';
  // AMD architectures
  if (a === 'rdna3') return 'RDNA 3';
  if (a === 'rdna2') return 'RDNA 2';
  if (a === 'rdna') return 'RDNA';
  if (a === 'gcn') return 'GCN';
  // Intel architectures
  if (a === 'xe') return 'Xe';
  if (a === 'gen12') return 'Gen12';
  // Generic capitalize
  return arch.charAt(0).toUpperCase() + arch.slice(1);
}

async function getWebGPUAdapterInfo(): Promise<AdapterInfo> {
  // Check if WebGPU is available
  if (!navigator.gpu) {
    debugInitialization.log('[WebGPU] WebGPU not available, falling back to WebGL');
    return {
      requiredLimits: {},
      trackedLimits: { ...DEFAULT_LIMITS },
      gpuInfo: null,
      supported: false,
      supportsTimestampQuery: false,
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
        gpuInfo: null,
        supported: false,
        supportsTimestampQuery: false,
      };
    }

    // Extract GPU info from adapter
    const info = adapter.info;

    // Log raw adapter info for debugging
    debugInitialization.log(`[WebGPU] Raw adapter info:`, {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
    });

    // Build GPU name from adapter info
    // Chrome restricts full device names for privacy - we use what's available
    let gpuName = 'Unknown GPU';
    if (info.description && info.description.length > 0) {
      gpuName = info.description;
    } else if (info.device && info.device.length > 0) {
      gpuName = info.device;
    } else if (info.vendor && info.architecture) {
      // Format nicely: "NVIDIA Ampere" instead of "nvidia (ampere)"
      gpuName = `${formatVendor(info.vendor)} ${formatArchitecture(info.architecture)}`;
    } else if (info.vendor && info.vendor.length > 0) {
      gpuName = `${formatVendor(info.vendor)} GPU`;
    }

    const gpuInfo: GpuAdapterInfo = {
      name: gpuName,
      vendor: info.vendor || 'unknown',
      architecture: info.architecture || '',
      isIntegrated: detectIntegratedGpu(gpuName, info.vendor || ''),
    };

    debugInitialization.log(`[WebGPU] GPU detected:`, gpuInfo);

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

    // Check for timestamp-query feature (for GPU timing profiling)
    const supportsTimestampQuery = adapter.features.has('timestamp-query');

    debugInitialization.log(`[WebGPU] Adapter limits (copied to plain object):`, {
      maxVertexBuffers: requiredLimits.maxVertexBuffers,
      maxTextureDimension2D: requiredLimits.maxTextureDimension2D,
      maxStorageBufferBindingSize: requiredLimits.maxStorageBufferBindingSize,
      maxBufferSize: requiredLimits.maxBufferSize,
      totalLimitsCopied: Object.keys(requiredLimits).length,
      supportsTimestampQuery,
    });

    return {
      requiredLimits,
      trackedLimits: {
        maxVertexBuffers: requiredLimits.maxVertexBuffers ?? DEFAULT_LIMITS.maxVertexBuffers,
        maxTextureDimension2D: requiredLimits.maxTextureDimension2D ?? DEFAULT_LIMITS.maxTextureDimension2D,
        maxStorageBufferBindingSize: requiredLimits.maxStorageBufferBindingSize ?? DEFAULT_LIMITS.maxStorageBufferBindingSize,
        maxBufferSize: requiredLimits.maxBufferSize ?? DEFAULT_LIMITS.maxBufferSize,
      },
      gpuInfo,
      supported: true,
      supportsTimestampQuery,
    };
  } catch (error) {
    debugInitialization.warn('[WebGPU] Error querying adapter:', error);
    return {
      requiredLimits: {},
      trackedLimits: { ...DEFAULT_LIMITS },
      gpuInfo: null,
      supported: false,
      supportsTimestampQuery: false,
    };
  }
}

/**
 * Attempt to access the underlying WebGPU device from the Three.js renderer.
 * Three.js manages the device internally, so we need to access it through
 * the backend. This is implementation-dependent and may break with Three.js updates.
 */
function getWebGPUDevice(renderer: WebGPURenderer): GPUDevice | null {
  try {
    const backend = (renderer as any).backend;
    if (!backend) {
      debugInitialization.warn('[WebGPU] No backend available on renderer');
      return null;
    }

    // Three.js WebGPUBackend stores device on the backend instance
    // Path: renderer.backend.device (WebGPUBackend)
    if (backend.device && typeof backend.device.lost !== 'undefined') {
      return backend.device as GPUDevice;
    }

    // Alternative path: through the context adapter
    // Path: renderer.backend.context.device
    if (backend.context?.device && typeof backend.context.device.lost !== 'undefined') {
      return backend.context.device as GPUDevice;
    }

    // Check if it's stored under a different property
    if (backend.gpu?.device && typeof backend.gpu.device.lost !== 'undefined') {
      return backend.gpu.device as GPUDevice;
    }

    debugInitialization.warn('[WebGPU] Could not locate GPUDevice on renderer backend');
    return null;
  } catch (error) {
    debugInitialization.warn('[WebGPU] Error accessing GPUDevice:', error);
    return null;
  }
}

/**
 * Set up device lost handler on the WebGPU device.
 * The handler notifies all registered callbacks when device is lost.
 */
function setupDeviceLostHandler(
  device: GPUDevice,
  gpuInfo: GpuAdapterInfo | null,
  callbacks: DeviceLostCallback[],
  setLostState: (lost: boolean) => void
): void {
  device.lost.then((info: GPUDeviceLostInfo) => {
    // Mark device as lost
    setLostState(true);

    // Map WebGPU reason to our type
    const reason: DeviceLostReason = info.reason === 'destroyed' ? 'destroyed' : 'unknown';

    // Create event with all available context
    const event: DeviceLostEvent = {
      reason,
      message: info.message || 'No additional information',
      timestamp: Date.now(),
      gpuInfo,
    };

    // Log detailed error information for debugging
    debugInitialization.error(`[WebGPU] Device Lost:`, {
      reason: event.reason,
      message: event.message,
      timestamp: new Date(event.timestamp).toISOString(),
      gpuName: gpuInfo?.name || 'Unknown',
      gpuVendor: gpuInfo?.vendor || 'Unknown',
      gpuArchitecture: gpuInfo?.architecture || 'Unknown',
      isIntegratedGpu: gpuInfo?.isIntegrated ?? 'Unknown',
    });

    // Additional context logging for debugging
    if (reason === 'unknown') {
      debugInitialization.error(
        '[WebGPU] Device lost with unknown reason. Common causes:\n' +
        '  - GPU out of memory (VRAM exhausted)\n' +
        '  - GPU driver crash or reset\n' +
        '  - System entering sleep/hibernate\n' +
        '  - GPU removed or switched (laptop external GPU)\n' +
        '  - Browser tab throttled aggressively'
      );
    }

    // Notify all registered callbacks
    for (const callback of callbacks) {
      try {
        callback(event);
      } catch (callbackError) {
        debugInitialization.error('[WebGPU] Error in device lost callback:', callbackError);
      }
    }
  });

  debugInitialization.log('[WebGPU] Device lost handler registered');
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
  // Pass false to NOT update canvas CSS - let CSS classes handle visual sizing
  // This allows the canvas to resize with its container when DevTools opens/closes
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  // Enable local clipping planes for building construction reveal effect
  renderer.localClippingEnabled = true;

  // Configure shadow maps - always enabled to keep shadow map depth texture initialized
  // The directionalLight.castShadow is always true, but we toggle terrain.receiveShadow
  // and object castShadow/receiveShadow to control shadow visibility
  // Use BasicShadowMap instead of PCFSoftShadowMap for much better performance
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;

  // ============================================
  // Device Lost Detection Setup
  // ============================================

  // State for device lost tracking
  const deviceLostCallbacks: DeviceLostCallback[] = [];
  let deviceIsLost = false;

  // Get the WebGPU device reference (needed for timestamp profiler and device lost handler)
  let gpuDevice: GPUDevice | null = null;
  const supportsTimestampQuery = isWebGPU && adapterInfo.supportsTimestampQuery;

  // Set up device lost handler if WebGPU is active
  if (isWebGPU) {
    gpuDevice = getWebGPUDevice(renderer);
    if (gpuDevice) {
      setupDeviceLostHandler(
        gpuDevice,
        adapterInfo.gpuInfo,
        deviceLostCallbacks,
        (lost: boolean) => { deviceIsLost = lost; }
      );
    } else {
      debugInitialization.warn(
        '[WebGPU] Could not access GPU device for lost detection. ' +
        'Device lost events will not be reported.'
      );
    }
  }

  debugInitialization.log(`[WebGPU] Timestamp query support:`, {
    adapterSupports: adapterInfo.supportsTimestampQuery,
    deviceAvailable: gpuDevice !== null,
    enabled: supportsTimestampQuery && gpuDevice !== null,
  });

  // Create the render context with device lost API
  const context: RenderContext = {
    renderer,
    isWebGPU,
    supportsCompute,
    postProcessing: null,
    gpuInfo: isWebGPU ? adapterInfo.gpuInfo : null,
    deviceLimits: actualLimits,
    supportsTimestampQuery,
    gpuDevice,

    onDeviceLost: (callback: DeviceLostCallback) => {
      if (!deviceLostCallbacks.includes(callback)) {
        deviceLostCallbacks.push(callback);
      }
    },

    offDeviceLost: (callback: DeviceLostCallback) => {
      const index = deviceLostCallbacks.indexOf(callback);
      if (index !== -1) {
        deviceLostCallbacks.splice(index, 1);
      }
    },

    isDeviceLost: () => deviceIsLost,
  };

  return context;
}

/**
 * Attempt to recover from a device lost error by creating a new renderer.
 *
 * Recovery strategies:
 * 1. Retry WebGPU with same settings (transient failures)
 * 2. Retry WebGPU with reduced quality (memory pressure)
 * 3. Fall back to WebGL (persistent WebGPU issues)
 *
 * Note: This function creates a NEW renderer. The caller is responsible for:
 * - Disposing the old renderer
 * - Recreating all render targets, materials, and scene objects
 * - Updating all references to the renderer
 *
 * @param canvas The canvas element to render to
 * @param options Recovery options controlling behavior
 * @returns New RenderContext if recovery succeeds, null if all attempts fail
 */
export async function attemptRecovery(
  canvas: HTMLCanvasElement,
  options: RecoveryOptions
): Promise<RenderContext | null> {
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1000;

  debugInitialization.log('[WebGPU] Attempting recovery from device lost', {
    reduceQuality: options.reduceQuality,
    forceWebGL: options.forceWebGL,
    maxRetries,
    retryDelayMs,
  });

  // If forcing WebGL, skip WebGPU attempts entirely
  if (options.forceWebGL) {
    debugInitialization.log('[WebGPU] Recovery: Forcing WebGL fallback');
    try {
      const context = await createWebGPURenderer({
        canvas,
        forceWebGL: true,
        antialias: !options.reduceQuality, // Disable AA in reduced quality mode
        powerPreference: options.reduceQuality ? 'low-power' : 'high-performance',
      });

      debugInitialization.log('[WebGPU] Recovery successful with WebGL fallback');
      return context;
    } catch (error) {
      debugInitialization.error('[WebGPU] Recovery failed: WebGL fallback creation failed', error);
      return null;
    }
  }

  // Try WebGPU with potential quality reduction
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    debugInitialization.log(`[WebGPU] Recovery attempt ${attempt}/${maxRetries}`);

    // Wait before retry (except first attempt)
    if (attempt > 1) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }

    try {
      const context = await createWebGPURenderer({
        canvas,
        antialias: !options.reduceQuality, // Disable AA to reduce memory pressure
        powerPreference: options.reduceQuality ? 'low-power' : 'high-performance',
        forceWebGL: false,
      });

      // If we got WebGPU back, great!
      if (context.isWebGPU) {
        debugInitialization.log(`[WebGPU] Recovery successful on attempt ${attempt}`);
        return context;
      }

      // If we got WebGL fallback when WebGPU was requested, that's still a valid recovery
      debugInitialization.log(
        `[WebGPU] Recovery on attempt ${attempt} resulted in WebGL fallback`
      );
      return context;
    } catch (error) {
      debugInitialization.warn(
        `[WebGPU] Recovery attempt ${attempt} failed:`,
        error
      );
    }
  }

  // All WebGPU attempts failed - try WebGL as last resort
  debugInitialization.log('[WebGPU] All WebGPU recovery attempts failed, trying WebGL fallback');
  try {
    const context = await createWebGPURenderer({
      canvas,
      forceWebGL: true,
      antialias: false,
      powerPreference: 'low-power',
    });

    debugInitialization.log('[WebGPU] Recovery successful with WebGL fallback (last resort)');
    return context;
  } catch (error) {
    debugInitialization.error('[WebGPU] Recovery failed completely', error);
    return null;
  }
}

/**
 * Check if WebGPU is likely to be available and working.
 * Useful for proactive quality tier selection before renderer creation.
 */
export async function checkWebGPUSupport(): Promise<{
  available: boolean;
  reason: string;
  gpuInfo: GpuAdapterInfo | null;
}> {
  if (!navigator.gpu) {
    return {
      available: false,
      reason: 'WebGPU API not available in this browser',
      gpuInfo: null,
    };
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      return {
        available: false,
        reason: 'No WebGPU adapter available',
        gpuInfo: null,
      };
    }

    // Build GPU info
    const info = adapter.info;
    let gpuName = 'Unknown GPU';
    if (info.description && info.description.length > 0) {
      gpuName = info.description;
    } else if (info.device && info.device.length > 0) {
      gpuName = info.device;
    } else if (info.vendor && info.architecture) {
      gpuName = `${formatVendor(info.vendor)} ${formatArchitecture(info.architecture)}`;
    } else if (info.vendor && info.vendor.length > 0) {
      gpuName = `${formatVendor(info.vendor)} GPU`;
    }

    const gpuInfo: GpuAdapterInfo = {
      name: gpuName,
      vendor: info.vendor || 'unknown',
      architecture: info.architecture || '',
      isIntegrated: detectIntegratedGpu(gpuName, info.vendor || ''),
    };

    return {
      available: true,
      reason: 'WebGPU available',
      gpuInfo,
    };
  } catch (error) {
    return {
      available: false,
      reason: `WebGPU adapter request failed: ${error}`,
      gpuInfo: null,
    };
  }
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
 * Dispose of renderer resources
 */
export function disposeRenderer(context: RenderContext): void {
  context.renderer.dispose();
  context.postProcessing = null;
}

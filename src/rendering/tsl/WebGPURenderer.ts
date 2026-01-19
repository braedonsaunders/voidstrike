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
        gpuInfo: null,
        supported: false
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
      gpuInfo,
      supported: true,
    };
  } catch (error) {
    debugInitialization.warn('[WebGPU] Error querying adapter:', error);
    return {
      requiredLimits: {},
      trackedLimits: { ...DEFAULT_LIMITS },
      gpuInfo: null,
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

  return {
    renderer,
    isWebGPU,
    supportsCompute,
    postProcessing: null,
    gpuInfo: isWebGPU ? adapterInfo.gpuInfo : null,
    deviceLimits: actualLimits,
  };
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

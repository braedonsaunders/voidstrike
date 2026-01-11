/**
 * WebGPU Renderer Wrapper
 *
 * Provides a unified interface for the Three.js WebGPU renderer with:
 * - Async initialization (required for WebGPU)
 * - Automatic WebGL fallback
 * - Compute shader support
 * - Post-processing integration
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
}

/**
 * Initialize the WebGPU renderer with async setup
 */
export async function createWebGPURenderer(config: WebGPURendererConfig): Promise<RenderContext> {
  const {
    canvas,
    antialias = true,
    powerPreference = 'high-performance',
    forceWebGL = false,
    logarithmicDepthBuffer = false,
  } = config;

  // Create the WebGPU renderer
  const renderer = new WebGPURenderer({
    canvas,
    antialias,
    powerPreference,
    forceWebGL,
    logarithmicDepthBuffer,
  });

  // Initialize async (required for WebGPU)
  await renderer.init();

  // Detect capabilities
  const isWebGPU = !forceWebGL && renderer.backend?.isWebGPUBackend === true;
  const supportsCompute = isWebGPU; // Compute shaders only work with WebGPU

  debugInitialization.log(`[WebGPU] Renderer initialized:`, {
    backend: isWebGPU ? 'WebGPU' : 'WebGL',
    supportsCompute,
    antialias,
  });

  // Configure renderer
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  // Enable local clipping planes for building construction reveal effect
  (renderer as any).localClippingEnabled = true;

  // Enable shadow maps - must be configured before first render
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  return {
    renderer,
    isWebGPU,
    supportsCompute,
    postProcessing: null,
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

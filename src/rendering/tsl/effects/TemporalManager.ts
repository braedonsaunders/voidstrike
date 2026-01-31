/* eslint-disable @typescript-eslint/no-explicit-any -- TSL shader nodes use polymorphic types */
/**
 * Temporal Effects Manager - Quarter-resolution temporal pipeline management
 *
 * This module manages quarter-resolution effect pipelines for AO and SSR,
 * providing 75% GPU cost reduction through temporal reprojection.
 *
 * Architecture:
 * 1. Render effects at 1/4 resolution (quarter width x quarter height)
 * 2. Temporal reprojection blends with full-res history
 * 3. Output maintains full resolution quality through temporal accumulation
 */

import * as THREE from 'three';
import { WebGPURenderer, PostProcessing } from 'three/webgpu';
import {
  pass,
  vec2,
  vec4,
  mrt,
  output,
  normalView,
} from 'three/tsl';
import { materialMetalness, materialRoughness } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { debugPostProcessing } from '@/utils/debugLogger';
import { TemporalAOManager } from '../TemporalAO';
import { TemporalSSRManager } from '../TemporalSSR';
import type { PostProcessingConfig } from '../PostProcessing';

// ============================================
// QUARTER-RES PIPELINE CREATION
// ============================================

export interface QuarterResPipelineContext {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  quarterWidth: number;
  quarterHeight: number;
}

/**
 * Create quarter-res AO pipeline
 *
 * Renders GTAO at 1/4 resolution for 75% GPU cost reduction.
 * Output is sampled by the main pipeline with temporal upscaling.
 */
export function createQuarterAOPipeline(
  context: QuarterResPipelineContext,
  temporalAOManager: TemporalAOManager,
  aoRadius: number
): PostProcessing | null {
  const { renderer, scene, camera, quarterWidth, quarterHeight } = context;

  // Save original renderer size
  const originalSize = new THREE.Vector2();
  renderer.getSize(originalSize);

  // Set renderer to quarter resolution
  renderer.setSize(quarterWidth, quarterHeight, false);

  try {
    // Create PostProcessing at quarter resolution
    const quarterAOPostProcessing = new PostProcessing(renderer);

    // Create scene pass at quarter res - this automatically uses quarter-res depth
    const scenePass = pass(scene, camera);

    // Get quarter-res depth
    const scenePassDepth = scenePass.getTextureNode('depth');

    // Create AO at quarter resolution
    // @ts-expect-error - @types/three declares normalNode as non-nullable but actual API accepts null
    const quarterAO = ao(scenePassDepth, null, camera);
    quarterAO.radius.value = aoRadius;

    // Output just the AO value (single channel)
    const aoValue = quarterAO.getTextureNode().r;
    quarterAOPostProcessing.outputNode = vec4(aoValue, aoValue, aoValue, 1.0);

    debugPostProcessing.log(
      `[TemporalManager] Quarter-res AO pipeline created: ${quarterWidth}x${quarterHeight} (75% cost reduction)`
    );

    // Restore original renderer size
    renderer.setSize(originalSize.x, originalSize.y, false);

    return quarterAOPostProcessing;
  } catch (e) {
    debugPostProcessing.warn('[TemporalManager] Failed to create quarter-res AO pipeline:', e);
    // Restore original renderer size
    renderer.setSize(originalSize.x, originalSize.y, false);
    return null;
  }
}

/**
 * Create quarter-res SSR pipeline
 *
 * Renders SSR at 1/4 resolution for 75% GPU cost reduction.
 * Output is sampled by the main pipeline with temporal upscaling.
 */
export function createQuarterSSRPipeline(
  context: QuarterResPipelineContext,
  temporalSSRManager: TemporalSSRManager,
  ssrConfig: { maxDistance: number; opacity: number; thickness: number }
): PostProcessing | null {
  const { renderer, scene, camera, quarterWidth, quarterHeight } = context;

  // Save original renderer size
  const originalSize = new THREE.Vector2();
  renderer.getSize(originalSize);

  // Set renderer to quarter resolution
  renderer.setSize(quarterWidth, quarterHeight, false);

  try {
    // Create PostProcessing at quarter resolution
    const quarterSSRPostProcessing = new PostProcessing(renderer);

    // Create scene pass at quarter res with required MRT outputs
    const scenePass = pass(scene, camera);

    // Enable MRT for SSR (normals and metalrough needed)
    scenePass.setMRT(mrt({
      output: output,
      normal: normalView.mul(0.5).add(0.5),
      metalrough: vec2(materialMetalness, materialRoughness),
    }));

    // Get quarter-res G-buffer
    const scenePassColor = scenePass.getTextureNode();
    const scenePassDepth = scenePass.getTextureNode('depth');
    const scenePassNormal = scenePass.getTextureNode('normal');
    const scenePassMetalRough = scenePass.getTextureNode('metalrough');

    // Create SSR at quarter resolution
    // Cast to bypass @types/three incomplete ssr() signature
    const quarterSSR = (ssr as any)(
      scenePassColor,
      scenePassDepth,
      scenePassNormal,
      scenePassMetalRough.r,
      scenePassMetalRough.g,
      camera
    );

    if (quarterSSR?.maxDistance) {
      quarterSSR.maxDistance.value = ssrConfig.maxDistance;
    }
    if (quarterSSR?.opacity) {
      quarterSSR.opacity.value = ssrConfig.opacity;
    }
    if (quarterSSR?.thickness) {
      quarterSSR.thickness.value = ssrConfig.thickness;
    }

    // Output SSR (RGBA for color + alpha)
    quarterSSRPostProcessing.outputNode = quarterSSR.getTextureNode();

    debugPostProcessing.log(
      `[TemporalManager] Quarter-res SSR pipeline created: ${quarterWidth}x${quarterHeight} (75% cost reduction)`
    );

    // Restore original renderer size
    renderer.setSize(originalSize.x, originalSize.y, false);

    return quarterSSRPostProcessing;
  } catch (e) {
    debugPostProcessing.warn('[TemporalManager] Failed to create quarter-res SSR pipeline:', e);
    // Restore original renderer size
    renderer.setSize(originalSize.x, originalSize.y, false);
    return null;
  }
}

// ============================================
// TEMPORAL EFFECTS MANAGER CLASS
// ============================================

/**
 * TemporalEffectsManager - Orchestrates quarter-res temporal pipelines
 *
 * Manages the lifecycle of quarter-resolution effect pipelines and their
 * associated temporal managers. Provides a unified interface for:
 * - Creating quarter-res AO and SSR pipelines
 * - Rendering quarter-res effects
 * - Swapping temporal history buffers
 */
export class TemporalEffectsManager {
  private renderer: WebGPURenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  // Quarter-res dimensions
  private quarterWidth: number;
  private quarterHeight: number;

  // Temporal managers
  private temporalAOManager: TemporalAOManager | null = null;
  private temporalSSRManager: TemporalSSRManager | null = null;

  // Quarter-res pipelines
  private quarterAOPostProcessing: PostProcessing | null = null;
  private quarterSSRPostProcessing: PostProcessing | null = null;

  constructor(
    renderer: WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderWidth: number,
    renderHeight: number
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quarterWidth = Math.max(1, Math.floor(renderWidth / 2));
    this.quarterHeight = Math.max(1, Math.floor(renderHeight / 2));
  }

  /**
   * Initialize temporal AO pipeline
   */
  initializeTemporalAO(
    renderWidth: number,
    renderHeight: number,
    config: { blendFactor: number; aoRadius: number }
  ): void {
    // Create temporal manager
    this.temporalAOManager = new TemporalAOManager(
      renderWidth,
      renderHeight,
      {
        historyBlendFactor: config.blendFactor,
        depthRejectionThreshold: 0.1,
        enabled: true,
      }
    );

    // Create quarter-res pipeline
    this.quarterAOPostProcessing = createQuarterAOPipeline(
      {
        renderer: this.renderer,
        scene: this.scene,
        camera: this.camera,
        quarterWidth: this.quarterWidth,
        quarterHeight: this.quarterHeight,
      },
      this.temporalAOManager,
      config.aoRadius
    );
  }

  /**
   * Initialize temporal SSR pipeline
   */
  initializeTemporalSSR(
    renderWidth: number,
    renderHeight: number,
    config: {
      blendFactor: number;
      maxDistance: number;
      opacity: number;
      thickness: number;
    }
  ): void {
    // Create temporal manager
    this.temporalSSRManager = new TemporalSSRManager(
      renderWidth,
      renderHeight,
      {
        historyBlendFactor: config.blendFactor,
        depthRejectionThreshold: 0.05,
        colorBoxClamp: true,
        enabled: true,
      }
    );

    // Create quarter-res pipeline
    this.quarterSSRPostProcessing = createQuarterSSRPipeline(
      {
        renderer: this.renderer,
        scene: this.scene,
        camera: this.camera,
        quarterWidth: this.quarterWidth,
        quarterHeight: this.quarterHeight,
      },
      this.temporalSSRManager,
      {
        maxDistance: config.maxDistance,
        opacity: config.opacity,
        thickness: config.thickness,
      }
    );
  }

  /**
   * Render quarter-res effects
   *
   * Call this before the main pipeline render.
   */
  renderQuarterResEffects(): void {
    const originalSize = new THREE.Vector2();
    this.renderer.getSize(originalSize);

    // Render quarter-res AO
    if (this.quarterAOPostProcessing && this.temporalAOManager) {
      this.renderer.setSize(this.quarterWidth, this.quarterHeight, false);
      const quarterAOTarget = this.temporalAOManager.getQuarterAOTarget();
      this.renderer.setRenderTarget(quarterAOTarget);
      this.quarterAOPostProcessing.render();
    }

    // Render quarter-res SSR
    if (this.quarterSSRPostProcessing && this.temporalSSRManager) {
      this.renderer.setSize(this.quarterWidth, this.quarterHeight, false);
      const quarterSSRTarget = this.temporalSSRManager.getQuarterSSRTarget();
      this.renderer.setRenderTarget(quarterSSRTarget);
      this.quarterSSRPostProcessing.render();
    }

    // Restore original size
    this.renderer.setRenderTarget(null);
    this.renderer.setSize(originalSize.x, originalSize.y, false);
  }

  /**
   * Render quarter-res effects (async version)
   */
  async renderQuarterResEffectsAsync(): Promise<void> {
    const originalSize = new THREE.Vector2();
    this.renderer.getSize(originalSize);

    if (this.quarterAOPostProcessing && this.temporalAOManager) {
      this.renderer.setSize(this.quarterWidth, this.quarterHeight, false);
      const quarterAOTarget = this.temporalAOManager.getQuarterAOTarget();
      this.renderer.setRenderTarget(quarterAOTarget);
      await this.quarterAOPostProcessing.renderAsync();
    }

    if (this.quarterSSRPostProcessing && this.temporalSSRManager) {
      this.renderer.setSize(this.quarterWidth, this.quarterHeight, false);
      const quarterSSRTarget = this.temporalSSRManager.getQuarterSSRTarget();
      this.renderer.setRenderTarget(quarterSSRTarget);
      await this.quarterSSRPostProcessing.renderAsync();
    }

    this.renderer.setRenderTarget(null);
    this.renderer.setSize(originalSize.x, originalSize.y, false);
  }

  /**
   * Swap temporal history buffers
   *
   * Call this after the main render is complete.
   */
  swapTemporalBuffers(): void {
    this.temporalAOManager?.swapBuffers();
    this.temporalSSRManager?.swapBuffers();
  }

  /**
   * Update quarter-res dimensions
   */
  setSize(renderWidth: number, renderHeight: number): void {
    this.quarterWidth = Math.max(1, Math.floor(renderWidth / 2));
    this.quarterHeight = Math.max(1, Math.floor(renderHeight / 2));

    this.temporalAOManager?.setSize(renderWidth, renderHeight);
    this.temporalSSRManager?.setSize(renderWidth, renderHeight);
  }

  // ========== Accessors ==========

  getTemporalAOManager(): TemporalAOManager | null {
    return this.temporalAOManager;
  }

  getTemporalSSRManager(): TemporalSSRManager | null {
    return this.temporalSSRManager;
  }

  getQuarterAOPostProcessing(): PostProcessing | null {
    return this.quarterAOPostProcessing;
  }

  getQuarterSSRPostProcessing(): PostProcessing | null {
    return this.quarterSSRPostProcessing;
  }

  hasTemporalAO(): boolean {
    return this.temporalAOManager !== null && this.quarterAOPostProcessing !== null;
  }

  hasTemporalSSR(): boolean {
    return this.temporalSSRManager !== null && this.quarterSSRPostProcessing !== null;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.quarterAOPostProcessing = null;
    this.quarterSSRPostProcessing = null;

    if (this.temporalAOManager) {
      this.temporalAOManager.dispose();
      this.temporalAOManager = null;
    }

    if (this.temporalSSRManager) {
      this.temporalSSRManager.dispose();
      this.temporalSSRManager = null;
    }
  }
}

// ============================================
// HELPER FUNCTIONS FOR PIPELINE INTEGRATION
// ============================================

/**
 * Determine if temporal effects should be initialized based on config
 */
export function shouldInitializeTemporalEffects(config: PostProcessingConfig): {
  temporalAO: boolean;
  temporalSSR: boolean;
} {
  return {
    temporalAO: config.temporalAOEnabled && config.aoEnabled && !config.ssgiEnabled,
    temporalSSR: config.temporalSSREnabled && config.ssrEnabled,
  };
}

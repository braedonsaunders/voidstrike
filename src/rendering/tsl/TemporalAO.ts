/**
 * Temporal Ambient Occlusion
 *
 * Runs GTAO at quarter resolution and uses temporal reprojection to
 * maintain quality while reducing GPU cost by 75%.
 *
 * Algorithm:
 * 1. Render GTAO at 1/4 resolution (quarter width × quarter height)
 * 2. Reproject previous frame's full-res AO using velocity buffer
 * 3. Blend: 90% reprojected + 10% new quarter-res
 * 4. Output full-res result
 *
 * Based on techniques from UE5 and Unity HDRP.
 */

import * as THREE from 'three';
import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  texture,
  uv,
  uniform,
  mix,
  abs,
  max,
  min,
  clamp,
  If,
} from 'three/tsl';
import { debugShaders } from '@/utils/debugLogger';

export interface TemporalAOConfig {
  historyBlendFactor: number; // 0.0-1.0, how much history to use (default 0.9)
  depthRejectionThreshold: number; // Depth difference for rejection (default 0.1)
  enabled: boolean;
}

const DEFAULT_CONFIG: TemporalAOConfig = {
  historyBlendFactor: 0.9,
  depthRejectionThreshold: 0.1,
  enabled: true,
};

/**
 * Create temporal AO reprojection node
 *
 * @param aoTexture Current frame quarter-res AO texture
 * @param velocityTexture Per-pixel velocity from MRT
 * @param depthTexture Current frame depth
 * @param historyTexture Previous frame full-res AO
 * @param prevDepthTexture Previous frame depth (for rejection)
 * @param resolution Current render resolution
 */
export function createTemporalAONode(
  aoTexture: THREE.Texture,
  velocityTexture: THREE.Texture,
  depthTexture: THREE.Texture,
  historyTexture: THREE.Texture,
  prevDepthTexture: THREE.Texture | null,
  resolution: THREE.Vector2
): {
  node: ReturnType<typeof Fn>;
  uniforms: {
    historyBlendFactor: ReturnType<typeof uniform>;
    depthRejectionThreshold: ReturnType<typeof uniform>;
  };
} {
  const uHistoryBlendFactor = uniform(DEFAULT_CONFIG.historyBlendFactor);
  const uDepthRejectionThreshold = uniform(DEFAULT_CONFIG.depthRejectionThreshold);
  const uResolution = uniform(resolution);

  const node = Fn(() => {
    const fragUV = uv();

    // Sample velocity at current pixel
    const velocity = texture(velocityTexture, fragUV).xy;

    // Calculate previous frame UV
    const prevUV = fragUV.sub(velocity);

    // Sample current quarter-res AO (upscaled via bilinear sampling)
    const currentAO = texture(aoTexture, fragUV).r;

    // Check if previous UV is in bounds
    const inBounds = prevUV.x.greaterThanEqual(0.0)
      .and(prevUV.x.lessThanEqual(1.0))
      .and(prevUV.y.greaterThanEqual(0.0))
      .and(prevUV.y.lessThanEqual(1.0));

    // Sample history at reprojected position
    const historyAO = texture(historyTexture, prevUV).r;

    // Depth rejection: reject history if depth changed significantly
    const currentDepth = texture(depthTexture, fragUV).r;
    let depthValid = float(1.0);

    if (prevDepthTexture) {
      const prevDepth = texture(prevDepthTexture, prevUV).r;
      const depthDiff = abs(currentDepth.sub(prevDepth));
      // Reject if depth difference exceeds threshold
      depthValid = float(1.0).sub(
        clamp(depthDiff.div(uDepthRejectionThreshold), 0.0, 1.0)
      );
    }

    // Combine validity checks
    const validHistory = inBounds.select(depthValid, float(0.0));

    // Blend based on validity
    // If valid history: use history blend factor
    // If invalid: use current AO only
    const blendFactor = uHistoryBlendFactor.mul(validHistory);
    const result = mix(currentAO, historyAO, blendFactor);

    return vec4(result, result, result, 1.0);
  })();

  return {
    node,
    uniforms: {
      historyBlendFactor: uHistoryBlendFactor,
      depthRejectionThreshold: uDepthRejectionThreshold,
    },
  };
}

/**
 * Temporal AO Manager
 *
 * Manages the render targets and ping-pong buffers for temporal accumulation.
 * Includes quarter-res AO target for actual 75% GPU cost reduction.
 */
export class TemporalAOManager {
  private config: TemporalAOConfig;

  // Quarter resolution for GTAO
  private quarterWidth: number;
  private quarterHeight: number;

  // Full resolution for output
  private fullWidth: number;
  private fullHeight: number;

  // Quarter-res AO render target - THIS is where the actual cost savings come from
  private quarterAOTarget: THREE.RenderTarget;

  // Quarter-res depth for AO computation (downsampled from full-res)
  private quarterDepthTarget: THREE.RenderTarget;

  // History buffers (ping-pong) at full resolution
  private historyBufferA: THREE.WebGLRenderTarget;
  private historyBufferB: THREE.WebGLRenderTarget;
  private currentHistory: 'A' | 'B' = 'A';

  // Previous frame depth for rejection
  private prevDepthBuffer: THREE.WebGLRenderTarget;

  constructor(width: number, height: number, config: Partial<TemporalAOConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.fullWidth = width;
    this.fullHeight = height;
    this.quarterWidth = Math.max(1, Math.floor(width / 2));
    this.quarterHeight = Math.max(1, Math.floor(height / 2));

    // Quarter-res AO target - AO is computed here at 25% resolution
    this.quarterAOTarget = new THREE.RenderTarget(
      this.quarterWidth,
      this.quarterHeight,
      {
        type: THREE.HalfFloatType,
        format: THREE.RedFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }
    );

    // Quarter-res depth for AO (will be downsampled from full-res depth)
    this.quarterDepthTarget = new THREE.RenderTarget(
      this.quarterWidth,
      this.quarterHeight,
      {
        type: THREE.HalfFloatType,
        format: THREE.RedFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
      }
    );

    // Create history buffers at full resolution
    const historyOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RedFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    };

    this.historyBufferA = new THREE.WebGLRenderTarget(
      this.fullWidth,
      this.fullHeight,
      historyOptions
    );

    this.historyBufferB = new THREE.WebGLRenderTarget(
      this.fullWidth,
      this.fullHeight,
      historyOptions
    );

    // Depth buffer for rejection
    this.prevDepthBuffer = new THREE.WebGLRenderTarget(
      this.fullWidth,
      this.fullHeight,
      {
        type: THREE.HalfFloatType,
        format: THREE.RedFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      }
    );

    debugShaders.log(`[TemporalAO] Initialized: full=${this.fullWidth}x${this.fullHeight}, quarter=${this.quarterWidth}x${this.quarterHeight} (75% cost reduction)`);
  }

  /**
   * Get the quarter-res AO render target
   */
  getQuarterAOTarget(): THREE.RenderTarget {
    return this.quarterAOTarget;
  }

  /**
   * Get the quarter-res AO texture for sampling
   */
  getQuarterAOTexture(): THREE.Texture {
    return this.quarterAOTarget.texture;
  }

  /**
   * Get the quarter-res depth render target
   */
  getQuarterDepthTarget(): THREE.RenderTarget {
    return this.quarterDepthTarget;
  }

  /**
   * Get the quarter-res depth texture for AO
   */
  getQuarterDepthTexture(): THREE.Texture {
    return this.quarterDepthTarget.texture;
  }

  /**
   * Get the current history texture to sample from
   */
  getHistoryTexture(): THREE.Texture {
    return this.currentHistory === 'A'
      ? this.historyBufferA.texture
      : this.historyBufferB.texture;
  }

  /**
   * Get the target to render the new AO result to
   */
  getOutputTarget(): THREE.WebGLRenderTarget {
    return this.currentHistory === 'A'
      ? this.historyBufferB
      : this.historyBufferA;
  }

  /**
   * Get previous depth texture for rejection
   */
  getPrevDepthTexture(): THREE.Texture {
    return this.prevDepthBuffer.texture;
  }

  /**
   * Get previous depth target to copy current depth to
   */
  getPrevDepthTarget(): THREE.WebGLRenderTarget {
    return this.prevDepthBuffer;
  }

  /**
   * Swap history buffers after rendering
   */
  swapBuffers(): void {
    this.currentHistory = this.currentHistory === 'A' ? 'B' : 'A';
  }

  /**
   * Get quarter resolution for GTAO rendering
   */
  getQuarterResolution(): { width: number; height: number } {
    return { width: this.quarterWidth, height: this.quarterHeight };
  }

  /**
   * Update resolution
   */
  setSize(width: number, height: number): void {
    this.fullWidth = width;
    this.fullHeight = height;
    this.quarterWidth = Math.max(1, Math.floor(width / 2));
    this.quarterHeight = Math.max(1, Math.floor(height / 2));

    this.quarterAOTarget.setSize(this.quarterWidth, this.quarterHeight);
    this.quarterDepthTarget.setSize(this.quarterWidth, this.quarterHeight);
    this.historyBufferA.setSize(this.fullWidth, this.fullHeight);
    this.historyBufferB.setSize(this.fullWidth, this.fullHeight);
    this.prevDepthBuffer.setSize(this.fullWidth, this.fullHeight);
  }

  /**
   * Get full resolution
   */
  getFullResolution(): { width: number; height: number } {
    return { width: this.fullWidth, height: this.fullHeight };
  }

  /**
   * Update config
   */
  applyConfig(config: Partial<TemporalAOConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current config
   */
  getConfig(): TemporalAOConfig {
    return { ...this.config };
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.quarterAOTarget.dispose();
    this.quarterDepthTarget.dispose();
    this.historyBufferA.dispose();
    this.historyBufferB.dispose();
    this.prevDepthBuffer.dispose();
  }
}

/**
 * Simple helper to create a temporal AO blend pass
 * This blends quarter-res AO with reprojected history using TSL.
 */
export function createTemporalAOBlendNode(
  quarterAONode: any, // Quarter-res AO texture node
  historyNode: any, // History AO texture node
  velocityNode: any, // Velocity texture node
  depthNode: any, // Depth texture node
  config: { historyBlend: number; depthThreshold: number }
): ReturnType<typeof Fn> {
  const uHistoryBlend = uniform(config.historyBlend);
  const uDepthThreshold = uniform(config.depthThreshold);

  return Fn(() => {
    const fragUV = uv();

    // Get velocity for reprojection
    const velocity = velocityNode.sample(fragUV).xy;
    const prevUV = fragUV.sub(velocity);

    // Sample current quarter-res AO
    const currentAO = quarterAONode.sample(fragUV).r;

    // Check bounds
    const inBounds = prevUV.x.greaterThanEqual(0.0)
      .and(prevUV.x.lessThanEqual(1.0))
      .and(prevUV.y.greaterThanEqual(0.0))
      .and(prevUV.y.lessThanEqual(1.0));

    // Sample history
    const historyAO = historyNode.sample(prevUV).r;

    // Blend (simplified - no depth rejection in this version)
    const blendFactor = inBounds.select(uHistoryBlend, float(0.0));
    const result = mix(currentAO, historyAO, blendFactor);

    return float(result);
  })();
}

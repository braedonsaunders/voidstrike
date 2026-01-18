/**
 * Temporal Screen Space Reflections
 *
 * Runs SSR at quarter resolution and uses temporal reprojection to
 * maintain quality while reducing ray marching cost by 75%.
 *
 * Algorithm:
 * 1. Render SSR at 1/4 resolution (quarter width × quarter height)
 * 2. Reproject previous frame's full-res SSR using velocity buffer
 * 3. Blend: 85% reprojected + 15% new quarter-res (lower blend for reflections)
 * 4. Output full-res result
 *
 * SSR needs lower history blend than AO because reflection content
 * changes more rapidly with camera/object motion.
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
  length,
} from 'three/tsl';

export interface TemporalSSRConfig {
  historyBlendFactor: number; // 0.0-1.0, how much history to use (default 0.85)
  depthRejectionThreshold: number; // Depth difference for rejection (default 0.05)
  colorBoxClamp: boolean; // Use neighborhood clamping to reduce ghosting
  enabled: boolean;
}

const DEFAULT_CONFIG: TemporalSSRConfig = {
  historyBlendFactor: 0.85, // Lower than AO due to reflection parallax
  depthRejectionThreshold: 0.05, // Tighter threshold for reflections
  colorBoxClamp: true,
  enabled: true,
};

/**
 * Create temporal SSR blend node with neighborhood clamping
 *
 * Neighborhood clamping: clamp history to min/max of current frame's
 * neighborhood to prevent ghosting from stale reflection data.
 */
export function createTemporalSSRBlendNode(
  quarterSSRNode: any, // Quarter-res SSR texture node (RGBA)
  historyNode: any, // History SSR texture node
  velocityNode: any, // Velocity texture node
  depthNode: any, // Depth texture node
  resolution: THREE.Vector2,
  config: Partial<TemporalSSRConfig> = {}
): {
  node: ReturnType<typeof Fn>;
  uniforms: {
    historyBlendFactor: ReturnType<typeof uniform>;
    depthRejectionThreshold: ReturnType<typeof uniform>;
  };
} {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const uHistoryBlend = uniform(cfg.historyBlendFactor);
  const uDepthThreshold = uniform(cfg.depthRejectionThreshold);
  const uResolution = uniform(resolution);

  const node = Fn(() => {
    const fragUV = uv();
    const texelSize = vec2(1.0).div(uResolution);

    // Get velocity for reprojection
    const velocity = velocityNode.sample(fragUV).xy;
    const prevUV = fragUV.sub(velocity);

    // Sample current quarter-res SSR
    const currentSSR = quarterSSRNode.sample(fragUV);

    // Check bounds
    const inBounds = prevUV.x.greaterThanEqual(0.0)
      .and(prevUV.x.lessThanEqual(1.0))
      .and(prevUV.y.greaterThanEqual(0.0))
      .and(prevUV.y.lessThanEqual(1.0));

    // Sample history
    const historySSR = historyNode.sample(prevUV);

    // Neighborhood clamping to reduce ghosting
    // Sample 3x3 neighborhood of current frame
    const n0 = quarterSSRNode.sample(fragUV.add(vec2(-1, -1).mul(texelSize)));
    const n1 = quarterSSRNode.sample(fragUV.add(vec2(0, -1).mul(texelSize)));
    const n2 = quarterSSRNode.sample(fragUV.add(vec2(1, -1).mul(texelSize)));
    const n3 = quarterSSRNode.sample(fragUV.add(vec2(-1, 0).mul(texelSize)));
    const n4 = currentSSR; // Center
    const n5 = quarterSSRNode.sample(fragUV.add(vec2(1, 0).mul(texelSize)));
    const n6 = quarterSSRNode.sample(fragUV.add(vec2(-1, 1).mul(texelSize)));
    const n7 = quarterSSRNode.sample(fragUV.add(vec2(0, 1).mul(texelSize)));
    const n8 = quarterSSRNode.sample(fragUV.add(vec2(1, 1).mul(texelSize)));

    // Compute min/max of neighborhood
    const minColor = min(min(min(min(n0, n1), min(n2, n3)), min(min(n4, n5), min(n6, n7))), n8);
    const maxColor = max(max(max(max(n0, n1), max(n2, n3)), max(max(n4, n5), max(n6, n7))), n8);

    // Clamp history to neighborhood bounds
    const clampedHistory = clamp(historySSR, minColor, maxColor);

    // Depth-based rejection
    const currentDepth = depthNode.sample(fragUV).r;
    const prevDepth = depthNode.sample(prevUV).r;
    const depthDiff = abs(currentDepth.sub(prevDepth));
    const depthValid = float(1.0).sub(
      clamp(depthDiff.div(uDepthThreshold), 0.0, 1.0)
    );

    // Final validity
    const validity = inBounds.select(depthValid, float(0.0));

    // Blend with clamped history
    const blendFactor = uHistoryBlend.mul(validity);
    const result = mix(currentSSR, clampedHistory, blendFactor);

    return result;
  })();

  return {
    node,
    uniforms: {
      historyBlendFactor: uHistoryBlend,
      depthRejectionThreshold: uDepthThreshold,
    },
  };
}

/**
 * Temporal SSR Manager
 *
 * Manages render targets for SSR temporal accumulation.
 */
export class TemporalSSRManager {
  private config: TemporalSSRConfig;

  // Quarter resolution for SSR ray marching
  private quarterWidth: number;
  private quarterHeight: number;

  // Full resolution for output
  private fullWidth: number;
  private fullHeight: number;

  // History buffers (ping-pong)
  private historyBufferA: THREE.WebGLRenderTarget;
  private historyBufferB: THREE.WebGLRenderTarget;
  private currentHistory: 'A' | 'B' = 'A';

  constructor(width: number, height: number, config: Partial<TemporalSSRConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.fullWidth = width;
    this.fullHeight = height;
    this.quarterWidth = Math.max(1, Math.floor(width / 2));
    this.quarterHeight = Math.max(1, Math.floor(height / 2));

    // Create history buffers at full resolution (RGBA for color + alpha)
    const historyOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
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
   * Get the target to render the new SSR result to
   */
  getOutputTarget(): THREE.WebGLRenderTarget {
    return this.currentHistory === 'A'
      ? this.historyBufferB
      : this.historyBufferA;
  }

  /**
   * Swap history buffers after rendering
   */
  swapBuffers(): void {
    this.currentHistory = this.currentHistory === 'A' ? 'B' : 'A';
  }

  /**
   * Get quarter resolution for SSR rendering
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

    this.historyBufferA.setSize(this.fullWidth, this.fullHeight);
    this.historyBufferB.setSize(this.fullWidth, this.fullHeight);
  }

  /**
   * Update config
   */
  applyConfig(config: Partial<TemporalSSRConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.historyBufferA.dispose();
    this.historyBufferB.dispose();
  }
}

/**
 * Simple SSR temporal blend without neighborhood clamping
 * Use this for lower quality settings where ghosting is acceptable
 */
export function createSimpleTemporalSSRNode(
  currentSSRNode: any,
  historyNode: any,
  velocityNode: any,
  blendFactor: number = 0.85
): ReturnType<typeof Fn> {
  const uBlend = uniform(blendFactor);

  return Fn(() => {
    const fragUV = uv();

    // Reproject
    const velocity = velocityNode.sample(fragUV).xy;
    const prevUV = fragUV.sub(velocity);

    // Bounds check
    const inBounds = prevUV.x.greaterThanEqual(0.0)
      .and(prevUV.x.lessThanEqual(1.0))
      .and(prevUV.y.greaterThanEqual(0.0))
      .and(prevUV.y.lessThanEqual(1.0));

    const currentSSR = currentSSRNode.sample(fragUV);
    const historySSR = historyNode.sample(prevUV);

    const blend = inBounds.select(uBlend, float(0.0));
    return mix(currentSSR, historySSR, blend);
  })();
}

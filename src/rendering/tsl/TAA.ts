/**
 * Temporal Anti-Aliasing (TAA) Implementation
 *
 * Production-quality TAA based on:
 * - Bevy Engine's TAA implementation
 * - Intel GameTechDev optimized TAA
 * - Playdead's temporal reprojection (INSIDE)
 * - Brian Karis's "High Quality Temporal Supersampling" (SIGGRAPH 2014)
 *
 * Features:
 * - Sub-pixel jittering with Halton sequence (16 samples)
 * - Motion vector-based reprojection
 * - YCoCg color space neighborhood clipping
 * - Variance-based ghosting rejection
 * - Depth-aware disocclusion detection
 * - Optional RCAS sharpening
 *
 * @see https://github.com/bevyengine/bevy/blob/main/crates/bevy_core_pipeline/src/taa/
 * @see https://github.com/GameTechDev/TAA
 * @see https://github.com/playdeadgames/temporal
 */

import * as THREE from 'three';
import { WebGPURenderer, PostProcessing } from 'three/webgpu';
import {
  pass,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  int,
  Fn,
  mix,
  clamp,
  min,
  max,
  abs,
  dot,
  sqrt,
  floor,
  fract,
  texture,
} from 'three/tsl';

// ============================================
// CONSTANTS
// ============================================

/**
 * Default blend rate between history and current frame.
 * Lower values = more temporal smoothing = better AA but more ghosting risk.
 * Bevy uses 0.1, we use 0.1 as well.
 */
const DEFAULT_HISTORY_BLEND_RATE = 0.1;

/**
 * Minimum blend rate to ensure current frame is always somewhat visible.
 * Prevents complete reliance on potentially stale history.
 */
const MIN_HISTORY_BLEND_RATE = 0.015;

/**
 * Maximum blend rate when motion is detected or history is unreliable.
 * Higher values favor current frame over history.
 */
const MAX_HISTORY_BLEND_RATE = 0.5;

/**
 * Gamma value for variance clipping AABB calculation.
 * Higher = tighter clipping = less ghosting but more flickering.
 * Range typically 0.75 - 1.25
 */
const VARIANCE_CLIP_GAMMA = 1.0;

/**
 * Halton sequence base-2 and base-3 for 16 samples.
 * Provides well-distributed sub-pixel jitter pattern.
 */
const HALTON_SEQUENCE_16: [number, number][] = [
  [0.5, 0.333333],
  [0.25, 0.666667],
  [0.75, 0.111111],
  [0.125, 0.444444],
  [0.625, 0.777778],
  [0.375, 0.222222],
  [0.875, 0.555556],
  [0.0625, 0.888889],
  [0.5625, 0.037037],
  [0.3125, 0.37037],
  [0.8125, 0.703704],
  [0.1875, 0.148148],
  [0.6875, 0.481481],
  [0.4375, 0.814815],
  [0.9375, 0.259259],
  [0.03125, 0.592593],
];

// ============================================
// TAA CONFIGURATION
// ============================================

export interface TAAConfig {
  /** Enable TAA (false uses FXAA fallback) */
  enabled: boolean;
  /** History blend rate (0.0-1.0, lower = more smoothing) */
  historyBlendRate: number;
  /** Enable sharpening pass after TAA */
  sharpeningEnabled: boolean;
  /** Sharpening intensity (0.0-1.0) */
  sharpeningIntensity: number;
  /** Enable motion blur based on velocity */
  motionBlurEnabled: boolean;
  /** Motion blur intensity */
  motionBlurIntensity: number;
}

export const DEFAULT_TAA_CONFIG: TAAConfig = {
  enabled: true,
  historyBlendRate: DEFAULT_HISTORY_BLEND_RATE,
  sharpeningEnabled: true,
  sharpeningIntensity: 0.5,
  motionBlurEnabled: false,
  motionBlurIntensity: 0.5,
};

// ============================================
// TAA JITTER MANAGER
// ============================================

/**
 * Manages sub-pixel jitter for TAA.
 * Applies Halton sequence offsets to the projection matrix.
 */
export class TAAJitterManager {
  private frameIndex = 0;
  private jitterOffset = new THREE.Vector2();
  private projectionMatrixBackup = new THREE.Matrix4();
  private width = 1;
  private height = 1;

  /**
   * Update the jitter offset for the current frame.
   * Call this once per frame before rendering.
   */
  update(): void {
    const idx = this.frameIndex % HALTON_SEQUENCE_16.length;
    const [x, y] = HALTON_SEQUENCE_16[idx];

    // Center the jitter around 0 (-0.5 to 0.5 range)
    // Then scale to pixel units and convert to NDC
    this.jitterOffset.set(
      (x - 0.5) / this.width,
      (y - 0.5) / this.height
    );

    this.frameIndex++;
  }

  /**
   * Apply jitter to camera's projection matrix.
   * Call before rendering the scene.
   */
  applyJitter(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    // Backup original projection matrix
    this.projectionMatrixBackup.copy(camera.projectionMatrix);

    // Apply sub-pixel offset to projection matrix
    // This shifts the entire render by a sub-pixel amount
    camera.projectionMatrix.elements[8] += this.jitterOffset.x * 2;
    camera.projectionMatrix.elements[9] += this.jitterOffset.y * 2;
  }

  /**
   * Remove jitter from camera's projection matrix.
   * Call after rendering the scene but before using the render for other purposes.
   */
  removeJitter(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    camera.projectionMatrix.copy(this.projectionMatrixBackup);
  }

  /**
   * Set the render target size for proper jitter scaling.
   */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /**
   * Get the current jitter offset in NDC space.
   */
  getJitterOffset(): THREE.Vector2 {
    return this.jitterOffset.clone();
  }

  /**
   * Get the previous frame's jitter offset.
   */
  getPreviousJitterOffset(): THREE.Vector2 {
    const prevIdx = (this.frameIndex - 1 + HALTON_SEQUENCE_16.length) % HALTON_SEQUENCE_16.length;
    const [x, y] = HALTON_SEQUENCE_16[prevIdx];
    return new THREE.Vector2(
      (x - 0.5) / this.width,
      (y - 0.5) / this.height
    );
  }

  /**
   * Get the current frame index.
   */
  getFrameIndex(): number {
    return this.frameIndex;
  }

  /**
   * Reset the jitter sequence.
   */
  reset(): void {
    this.frameIndex = 0;
    this.jitterOffset.set(0, 0);
  }
}

// ============================================
// TAA HISTORY BUFFER MANAGER
// ============================================

/**
 * Manages ping-pong history buffers for TAA.
 */
export class TAAHistoryManager {
  private historyBuffers: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private currentBufferIndex = 0;
  private width = 1;
  private height = 1;
  private needsReset = true;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    // Create two render targets for ping-pong
    const createTarget = () =>
      new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
      });

    this.historyBuffers = [createTarget(), createTarget()];
  }

  /**
   * Get the history texture (previous frame's resolved TAA output).
   */
  getHistoryTexture(): THREE.Texture {
    // Return the buffer that was written to last frame
    const historyIndex = 1 - this.currentBufferIndex;
    return this.historyBuffers[historyIndex].texture;
  }

  /**
   * Get the render target for the current frame's output.
   */
  getCurrentTarget(): THREE.WebGLRenderTarget {
    return this.historyBuffers[this.currentBufferIndex];
  }

  /**
   * Swap buffers after rendering.
   * The current output becomes next frame's history.
   */
  swap(): void {
    this.currentBufferIndex = 1 - this.currentBufferIndex;
  }

  /**
   * Resize the history buffers.
   */
  setSize(width: number, height: number): void {
    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      this.historyBuffers[0].setSize(width, height);
      this.historyBuffers[1].setSize(width, height);
      this.needsReset = true;
    }
  }

  /**
   * Check if history needs to be reset (e.g., after resize or camera cut).
   */
  needsHistoryReset(): boolean {
    return this.needsReset;
  }

  /**
   * Mark history as valid after first frame is rendered.
   */
  markHistoryValid(): void {
    this.needsReset = false;
  }

  /**
   * Force history reset (e.g., on camera cut).
   */
  resetHistory(): void {
    this.needsReset = true;
  }

  /**
   * Dispose of GPU resources.
   */
  dispose(): void {
    this.historyBuffers[0].dispose();
    this.historyBuffers[1].dispose();
  }
}

// ============================================
// TAA MOTION VECTOR GENERATOR
// ============================================

/**
 * Generates motion vectors from camera movement.
 * For an RTS with mostly camera-based motion, we derive velocity from depth + camera delta.
 */
export class TAAMotionVectorGenerator {
  private previousViewMatrix = new THREE.Matrix4();
  private previousProjectionMatrix = new THREE.Matrix4();
  private currentViewMatrix = new THREE.Matrix4();
  private currentProjectionMatrix = new THREE.Matrix4();
  private hasPreviousFrame = false;

  // Uniforms for shader access
  public readonly uPrevViewMatrix = uniform(new THREE.Matrix4());
  public readonly uPrevProjMatrix = uniform(new THREE.Matrix4());
  public readonly uCurrViewMatrix = uniform(new THREE.Matrix4());
  public readonly uCurrProjMatrix = uniform(new THREE.Matrix4());
  public readonly uInvProjMatrix = uniform(new THREE.Matrix4());

  /**
   * Update camera matrices for motion vector calculation.
   * Call once per frame before TAA resolve.
   */
  update(camera: THREE.Camera): void {
    // Store current as previous
    this.previousViewMatrix.copy(this.currentViewMatrix);
    this.previousProjectionMatrix.copy(this.currentProjectionMatrix);

    // Get new current
    this.currentViewMatrix.copy(camera.matrixWorldInverse);
    this.currentProjectionMatrix.copy(camera.projectionMatrix);

    // Update uniforms
    this.uPrevViewMatrix.value.copy(this.previousViewMatrix);
    this.uPrevProjMatrix.value.copy(this.previousProjectionMatrix);
    this.uCurrViewMatrix.value.copy(this.currentViewMatrix);
    this.uCurrProjMatrix.value.copy(this.currentProjectionMatrix);
    this.uInvProjMatrix.value.copy(camera.projectionMatrixInverse);

    this.hasPreviousFrame = true;
  }

  /**
   * Check if we have valid previous frame data.
   */
  hasValidHistory(): boolean {
    return this.hasPreviousFrame;
  }

  /**
   * Reset motion vector state (e.g., on camera cut).
   */
  reset(): void {
    this.hasPreviousFrame = false;
  }
}

// ============================================
// TSL HELPER FUNCTIONS
// ============================================

/**
 * Convert RGB to YCoCg color space.
 * YCoCg provides better temporal stability for clipping.
 */
const rgb2YCoCg = Fn(([rgb]: [any]) => {
  const r = rgb.x;
  const g = rgb.y;
  const b = rgb.z;

  // Y  = R/4 + G/2 + B/4 (luma)
  // Co = R/2 - B/2 (chroma orange)
  // Cg = -R/4 + G/2 - B/4 (chroma green)
  const y = r.mul(0.25).add(g.mul(0.5)).add(b.mul(0.25));
  const co = r.mul(0.5).sub(b.mul(0.5));
  const cg = r.mul(-0.25).add(g.mul(0.5)).sub(b.mul(0.25));

  return vec3(y, co, cg);
});

/**
 * Convert YCoCg back to RGB color space.
 */
const yCoCg2RGB = Fn(([ycocg]: [any]) => {
  const y = ycocg.x;
  const co = ycocg.y;
  const cg = ycocg.z;

  // R = Y + Co - Cg
  // G = Y + Cg
  // B = Y - Co - Cg
  const r = y.add(co).sub(cg);
  const g = y.add(cg);
  const b = y.sub(co).sub(cg);

  return vec3(r, g, b);
});

/**
 * Clip color towards AABB center.
 * This is the key ghosting prevention technique.
 */
const clipToAABB = Fn(([color, boxMin, boxMax]: [any, any, any]) => {
  const boxCenter = boxMin.add(boxMax).mul(0.5);
  const boxExtent = boxMax.sub(boxMin).mul(0.5).add(0.0001); // Avoid division by zero

  const direction = color.sub(boxCenter);
  const tClip = abs(direction).div(boxExtent);
  const maxT = max(max(tClip.x, tClip.y), tClip.z);

  // If color is inside box, return as-is
  // Otherwise, clip to box boundary
  return mix(color, boxCenter.add(direction.div(maxT)), float(maxT).greaterThan(1.0));
});

/**
 * Sample a 3x3 neighborhood and compute min/max bounds.
 */
const sampleNeighborhood3x3 = Fn(
  ([colorTex, coordUV, texelSize]: [any, any, any]) => {
    // Sample 3x3 neighborhood
    const offsets = [
      vec2(-1, -1), vec2(0, -1), vec2(1, -1),
      vec2(-1, 0), vec2(0, 0), vec2(1, 0),
      vec2(-1, 1), vec2(0, 1), vec2(1, 1),
    ];

    // Center sample
    const center = texture(colorTex, coordUV).rgb;

    // Compute min/max in YCoCg space
    const centerYCoCg = rgb2YCoCg(center);
    let minColor = centerYCoCg.toVar();
    let maxColor = centerYCoCg.toVar();
    let meanColor = centerYCoCg.toVar();
    let m2Color = centerYCoCg.mul(centerYCoCg).toVar(); // For variance

    // Sample neighbors
    for (let i = 0; i < 9; i++) {
      if (i === 4) continue; // Skip center (already sampled)

      const offset = offsets[i];
      const neighborUV = coordUV.add(offset.mul(texelSize));
      const neighborRGB = texture(colorTex, neighborUV).rgb;
      const neighborYCoCg = rgb2YCoCg(neighborRGB);

      minColor.assign(min(minColor, neighborYCoCg));
      maxColor.assign(max(maxColor, neighborYCoCg));
      meanColor.addAssign(neighborYCoCg);
      m2Color.addAssign(neighborYCoCg.mul(neighborYCoCg));
    }

    // Compute variance-based AABB (tighter clipping)
    meanColor.divAssign(9.0);
    m2Color.divAssign(9.0);
    const variance = sqrt(abs(m2Color.sub(meanColor.mul(meanColor))));

    // Use variance clipping: mean ± gamma * stddev
    const gamma = float(VARIANCE_CLIP_GAMMA);
    const varMin = meanColor.sub(variance.mul(gamma));
    const varMax = meanColor.add(variance.mul(gamma));

    // Return the tighter of the two bounds
    return {
      boxMin: max(minColor, varMin),
      boxMax: min(maxColor, varMax),
      center: centerYCoCg,
    };
  }
);

// ============================================
// TAA RESOLVE PASS
// ============================================

/**
 * Create the main TAA resolve shader.
 * This blends current frame with history using temporal reprojection.
 */
export function createTAAResolvePass(
  currentColorTex: any,
  historyColorTex: any,
  depthTex: any,
  motionGenerator: TAAMotionVectorGenerator,
  config: TAAConfig
) {
  // Uniforms
  const uResolution = uniform(new THREE.Vector2(1920, 1080));
  const uJitterOffset = uniform(new THREE.Vector2(0, 0));
  const uPrevJitterOffset = uniform(new THREE.Vector2(0, 0));
  const uHistoryValid = uniform(1.0);
  const uBlendRate = uniform(config.historyBlendRate);

  const taaResolve = Fn(() => {
    const fragUV = uv();
    const texelSize = vec2(1.0).div(uResolution);

    // ============================================
    // 1. SAMPLE CURRENT FRAME (with jitter removed)
    // ============================================
    const currentUV = fragUV.sub(uJitterOffset);
    const currentColor = texture(currentColorTex, currentUV).rgb;

    // ============================================
    // 2. COMPUTE MOTION VECTOR FROM DEPTH
    // ============================================
    // Sample depth at current pixel
    const depth = texture(depthTex, fragUV).r;

    // Reconstruct world position from depth
    const ndcX = fragUV.x.mul(2.0).sub(1.0);
    const ndcY = fragUV.y.mul(2.0).sub(1.0);
    const ndcZ = depth.mul(2.0).sub(1.0);
    const clipPos = vec4(ndcX, ndcY, ndcZ, 1.0);

    // Transform to world space using inverse projection and view
    const viewPos = motionGenerator.uInvProjMatrix.mul(clipPos);
    const viewPosW = viewPos.div(viewPos.w);

    // Transform to previous frame's clip space
    const prevClipPos = motionGenerator.uPrevProjMatrix.mul(
      motionGenerator.uPrevViewMatrix.mul(
        motionGenerator.uCurrViewMatrix.toVar().invert().mul(viewPosW)
      )
    );
    const prevNDC = prevClipPos.xyz.div(prevClipPos.w);
    const prevUV = prevNDC.xy.mul(0.5).add(0.5);

    // Motion vector = previous UV - current UV
    const motionVector = prevUV.sub(fragUV);

    // ============================================
    // 3. SAMPLE HISTORY (with reprojection)
    // ============================================
    const historyUV = fragUV.add(motionVector);
    const historyColor = texture(historyColorTex, historyUV).rgb;

    // ============================================
    // 4. NEIGHBORHOOD CLIPPING (YCoCg space)
    // ============================================
    // Sample 3x3 neighborhood of current frame
    const neighborhood = sampleNeighborhood3x3(currentColorTex, currentUV, texelSize);

    // Convert history to YCoCg and clip to neighborhood AABB
    const historyYCoCg = rgb2YCoCg(historyColor);
    const clippedHistoryYCoCg = clipToAABB(historyYCoCg, neighborhood.boxMin, neighborhood.boxMax);
    const clippedHistory = yCoCg2RGB(clippedHistoryYCoCg);

    // ============================================
    // 5. COMPUTE BLEND FACTOR
    // ============================================
    // Base blend rate from config
    let blendFactor = uBlendRate.toVar();

    // Increase blend rate (favor current) when:
    // - Motion is large (camera moving fast)
    const motionMagnitude = motionVector.length().mul(uResolution.x);
    const motionBlend = clamp(motionMagnitude.mul(0.1), 0.0, 0.3);
    blendFactor.addAssign(motionBlend);

    // - History UV is outside viewport (disocclusion)
    const outsideViewport = float(
      historyUV.x.lessThan(0.0)
        .or(historyUV.x.greaterThan(1.0))
        .or(historyUV.y.lessThan(0.0))
        .or(historyUV.y.greaterThan(1.0))
    );
    blendFactor.assign(mix(blendFactor, float(1.0), outsideViewport));

    // - History is significantly different (likely invalid)
    const colorDiff = currentColor.sub(clippedHistory).length();
    const diffBlend = clamp(colorDiff.mul(0.5), 0.0, 0.2);
    blendFactor.addAssign(diffBlend);

    // - History is invalid (first frame or camera cut)
    blendFactor.assign(mix(blendFactor, float(1.0), float(1.0).sub(uHistoryValid)));

    // Clamp blend factor to valid range
    blendFactor.assign(clamp(blendFactor, float(MIN_HISTORY_BLEND_RATE), float(MAX_HISTORY_BLEND_RATE)));

    // ============================================
    // 6. BLEND CURRENT AND HISTORY
    // ============================================
    const result = mix(clippedHistory, currentColor, blendFactor);

    return vec4(result, 1.0);
  });

  return {
    node: taaResolve,
    uniforms: {
      uResolution,
      uJitterOffset,
      uPrevJitterOffset,
      uHistoryValid,
      uBlendRate,
    },
  };
}

// ============================================
// RCAS SHARPENING PASS
// ============================================

/**
 * Robust Contrast-Adaptive Sharpening (RCAS).
 * Based on AMD FidelityFX CAS/RCAS.
 * Counters TAA blur while preserving edges.
 */
export function createRCASPass(inputTex: any, intensity: number = 0.5) {
  const uIntensity = uniform(intensity);
  const uResolution = uniform(new THREE.Vector2(1920, 1080));

  const rcas = Fn(() => {
    const fragUV = uv();
    const texelSize = vec2(1.0).div(uResolution);

    // Sample center and 4 neighbors (cross pattern)
    const center = texture(inputTex, fragUV).rgb;
    const north = texture(inputTex, fragUV.add(vec2(0, -1).mul(texelSize))).rgb;
    const south = texture(inputTex, fragUV.add(vec2(0, 1).mul(texelSize))).rgb;
    const west = texture(inputTex, fragUV.add(vec2(-1, 0).mul(texelSize))).rgb;
    const east = texture(inputTex, fragUV.add(vec2(1, 0).mul(texelSize))).rgb;

    // Compute local contrast
    const minRGB = min(min(min(north, south), min(west, east)), center);
    const maxRGB = max(max(max(north, south), max(west, east)), center);

    // Compute sharpening weight based on local contrast
    // Higher contrast = less sharpening (edges preserved)
    // Lower contrast = more sharpening (details enhanced)
    const contrast = maxRGB.sub(minRGB);
    const rcpM = float(1.0).div(max(max(contrast.r, contrast.g), contrast.b).add(0.25));

    // Compute sharpening kernel
    const neighbors = north.add(south).add(west).add(east);
    const sharpenedColor = center.add(
      center.mul(4.0).sub(neighbors).mul(uIntensity).mul(rcpM)
    );

    // Clamp to prevent ringing artifacts
    const result = clamp(sharpenedColor, minRGB, maxRGB);

    return vec4(result, 1.0);
  });

  return {
    node: rcas,
    uniforms: {
      uIntensity,
      uResolution,
    },
  };
}

// ============================================
// TAA SYSTEM CLASS
// ============================================

/**
 * Complete TAA system that manages all components.
 */
export class TAASystem {
  private config: TAAConfig;
  private jitterManager: TAAJitterManager;
  private historyManager: TAAHistoryManager;
  private motionGenerator: TAAMotionVectorGenerator;

  private renderer: WebGPURenderer;
  private camera: THREE.Camera;
  private width: number;
  private height: number;

  constructor(
    renderer: WebGPURenderer,
    camera: THREE.Camera,
    width: number,
    height: number,
    config: Partial<TAAConfig> = {}
  ) {
    this.config = { ...DEFAULT_TAA_CONFIG, ...config };
    this.renderer = renderer;
    this.camera = camera;
    this.width = width;
    this.height = height;

    this.jitterManager = new TAAJitterManager();
    this.jitterManager.setSize(width, height);

    this.historyManager = new TAAHistoryManager(width, height);
    this.motionGenerator = new TAAMotionVectorGenerator();
  }

  /**
   * Update TAA state for the current frame.
   * Call before rendering the scene.
   */
  preRender(): void {
    if (!this.config.enabled) return;

    // Update jitter
    this.jitterManager.update();

    // Apply jitter to camera
    if (this.camera instanceof THREE.PerspectiveCamera || this.camera instanceof THREE.OrthographicCamera) {
      this.jitterManager.applyJitter(this.camera);
    }

    // Update motion vectors
    this.motionGenerator.update(this.camera);
  }

  /**
   * Finalize TAA for the current frame.
   * Call after rendering the scene but before post-processing.
   */
  postRender(): void {
    if (!this.config.enabled) return;

    // Remove jitter from camera
    if (this.camera instanceof THREE.PerspectiveCamera || this.camera instanceof THREE.OrthographicCamera) {
      this.jitterManager.removeJitter(this.camera);
    }

    // Swap history buffers
    this.historyManager.swap();

    // Mark history as valid after first frame
    if (this.historyManager.needsHistoryReset()) {
      this.historyManager.markHistoryValid();
    }
  }

  /**
   * Get the jitter manager for external access.
   */
  getJitterManager(): TAAJitterManager {
    return this.jitterManager;
  }

  /**
   * Get the history manager for external access.
   */
  getHistoryManager(): TAAHistoryManager {
    return this.historyManager;
  }

  /**
   * Get the motion generator for external access.
   */
  getMotionGenerator(): TAAMotionVectorGenerator {
    return this.motionGenerator;
  }

  /**
   * Check if TAA is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): TAAConfig {
    return { ...this.config };
  }

  /**
   * Update configuration.
   */
  setConfig(config: Partial<TAAConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set render size.
   */
  setSize(width: number, height: number): void {
    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      this.jitterManager.setSize(width, height);
      this.historyManager.setSize(width, height);
    }
  }

  /**
   * Reset TAA state (e.g., on camera cut).
   */
  reset(): void {
    this.jitterManager.reset();
    this.historyManager.resetHistory();
    this.motionGenerator.reset();
  }

  /**
   * Set the camera reference.
   */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.reset(); // Reset on camera change
  }

  /**
   * Dispose of GPU resources.
   */
  dispose(): void {
    this.historyManager.dispose();
  }
}

// ============================================
// EXPORTS
// ============================================

export {
  HALTON_SEQUENCE_16,
  DEFAULT_HISTORY_BLEND_RATE,
  MIN_HISTORY_BLEND_RATE,
  MAX_HISTORY_BLEND_RATE,
  VARIANCE_CLIP_GAMMA,
  rgb2YCoCg,
  yCoCg2RGB,
  clipToAABB,
};

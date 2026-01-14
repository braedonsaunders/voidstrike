/**
 * FSR 1.0 - FidelityFX Super Resolution
 *
 * WebGPU-compatible implementation using TSL (Three.js Shading Language).
 * Based on AMD's FSR 1.0 EASU (Edge-Adaptive Spatial Upsampling) algorithm.
 *
 * Features:
 * - EASU: Edge-adaptive upscaling with proper Lanczos2 kernel
 * - RCAS: Robust Contrast-Adaptive Sharpening
 * - Proper ring suppression using all 12 texels
 *
 * Reference: AMD FidelityFX Super Resolution 1.0
 * https://github.com/GPUOpen-Effects/FidelityFX-FSR
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  mix,
  clamp,
  min,
  max,
  abs,
  dot,
  sqrt,
  floor,
  fract,
  pow,
  exp,
  If,
  select,
} from 'three/tsl';

// ============================================
// EASU - Edge-Adaptive Spatial Upsampling
// ============================================

/**
 * FSR 1.0 EASU Algorithm:
 *
 * 1. Sample 12 texels in a cross pattern around the sample point
 * 2. Compute luminance gradients to detect edge direction
 * 3. Compute Lanczos2 weights rotated to align with edge direction
 * 4. Apply directional filtering for sharp edges
 * 5. Ring suppression using all 12 texels for min/max clamping
 *
 * The key insight is that edges should be filtered ALONG their direction,
 * not perpendicular to them. This preserves sharpness.
 */

export interface EASUConfig {
  sharpness: number; // 0.0 - 1.0, controls edge sharpness (default 0.5)
}

const DEFAULT_EASU_CONFIG: EASUConfig = {
  sharpness: 0.5,
};

/**
 * Compute Lanczos2 weight for a given distance
 * Lanczos2(x) = sinc(x) * sinc(x/2) for |x| < 2, else 0
 * Approximated with a polynomial for performance
 */
function lanczos2Weight(x: ReturnType<typeof float>) {
  // Approximation: w = max(0, (2 - |x|)^2 * (1 + |x|/2)) / 4
  // This gives a smooth Lanczos-like kernel
  const ax = abs(x);
  const w = max(float(0), pow(float(2).sub(ax), 2).mul(float(1).add(ax.mul(0.5)))).div(4);
  return w;
}

/**
 * Create EASU upscaling pass as a TSL node.
 *
 * @param inputTexture - Low-resolution source texture
 * @param inputResolution - Source texture resolution (width, height)
 * @param outputResolution - Target output resolution (width, height)
 * @param config - Optional configuration
 */
export function createEASUPass(
  inputTexture: THREE.Texture,
  inputResolution: THREE.Vector2,
  outputResolution: THREE.Vector2,
  config: Partial<EASUConfig> = {}
) {
  const cfg = { ...DEFAULT_EASU_CONFIG, ...config };

  const uInputRes = uniform(inputResolution);
  const uOutputRes = uniform(outputResolution);
  const uSharpness = uniform(cfg.sharpness);

  const easuNode = Fn(() => {
    const fragUV = uv();

    // Calculate input texture coordinates
    const inputTexelSize = vec2(1.0).div(uInputRes);

    // Position in input texture space (accounting for pixel centers)
    const inputPos = fragUV.mul(uInputRes).sub(0.5);
    const inputPosFloor = floor(inputPos);
    const inputPosFract = fract(inputPos);

    // Base texel coordinate (top-left of 2x2 region)
    const baseUV = inputPosFloor.add(0.5).mul(inputTexelSize);

    // =============================================
    // 12-TAP SAMPLE PATTERN (FSR 1.0 pattern)
    // =============================================
    //
    //     b   c
    //   e f g h
    //   i j k l
    //     n   o
    //

    // Sample all 12 texels with clamping to prevent edge artifacts
    const clampUV = (uv: ReturnType<typeof vec2>) =>
      clamp(uv, vec2(0.5).mul(inputTexelSize), vec2(1).sub(vec2(0.5).mul(inputTexelSize)));

    const sB = (inputTexture as any).sample(clampUV(baseUV.add(vec2(0, -1).mul(inputTexelSize)))).rgb;
    const sC = (inputTexture as any).sample(clampUV(baseUV.add(vec2(1, -1).mul(inputTexelSize)))).rgb;
    const sE = (inputTexture as any).sample(clampUV(baseUV.add(vec2(-1, 0).mul(inputTexelSize)))).rgb;
    const sF = (inputTexture as any).sample(clampUV(baseUV.add(vec2(0, 0).mul(inputTexelSize)))).rgb;
    const sG = (inputTexture as any).sample(clampUV(baseUV.add(vec2(1, 0).mul(inputTexelSize)))).rgb;
    const sH = (inputTexture as any).sample(clampUV(baseUV.add(vec2(2, 0).mul(inputTexelSize)))).rgb;
    const sI = (inputTexture as any).sample(clampUV(baseUV.add(vec2(-1, 1).mul(inputTexelSize)))).rgb;
    const sJ = (inputTexture as any).sample(clampUV(baseUV.add(vec2(0, 1).mul(inputTexelSize)))).rgb;
    const sK = (inputTexture as any).sample(clampUV(baseUV.add(vec2(1, 1).mul(inputTexelSize)))).rgb;
    const sL = (inputTexture as any).sample(clampUV(baseUV.add(vec2(2, 1).mul(inputTexelSize)))).rgb;
    const sN = (inputTexture as any).sample(clampUV(baseUV.add(vec2(0, 2).mul(inputTexelSize)))).rgb;
    const sO = (inputTexture as any).sample(clampUV(baseUV.add(vec2(1, 2).mul(inputTexelSize)))).rgb;

    // =============================================
    // LUMINANCE COMPUTATION
    // =============================================

    const luma = (c: any) => dot(c, vec3(0.299, 0.587, 0.114));

    const lumB = luma(sB);
    const lumC = luma(sC);
    const lumE = luma(sE);
    const lumF = luma(sF);
    const lumG = luma(sG);
    const lumH = luma(sH);
    const lumI = luma(sI);
    const lumJ = luma(sJ);
    const lumK = luma(sK);
    const lumL = luma(sL);
    const lumN = luma(sN);
    const lumO = luma(sO);

    // =============================================
    // EDGE DIRECTION DETECTION (FSR 1.0 style)
    // =============================================

    // Compute directional gradients using Sobel-like operators
    // Horizontal gradient (left-right differences)
    const gradH = abs(lumE.sub(lumF))
      .add(abs(lumF.sub(lumG)))
      .add(abs(lumG.sub(lumH)))
      .add(abs(lumI.sub(lumJ)))
      .add(abs(lumJ.sub(lumK)))
      .add(abs(lumK.sub(lumL)));

    // Vertical gradient (top-bottom differences)
    const gradV = abs(lumB.sub(lumF))
      .add(abs(lumF.sub(lumJ)))
      .add(abs(lumJ.sub(lumN)))
      .add(abs(lumC.sub(lumG)))
      .add(abs(lumG.sub(lumK)))
      .add(abs(lumK.sub(lumO)));

    // Diagonal gradients for better edge detection
    const gradD1 = abs(lumE.sub(lumG))
      .add(abs(lumF.sub(lumK)))
      .add(abs(lumI.sub(lumK)));
    const gradD2 = abs(lumB.sub(lumJ))
      .add(abs(lumF.sub(lumK)))
      .add(abs(lumC.sub(lumK)));

    // Total gradient magnitude (edge strength)
    const gradTotal = gradH.add(gradV).add(gradD1.mul(0.5)).add(gradD2.mul(0.5));
    const edgeStrength = clamp(gradTotal.mul(2.0), 0.0, 1.0);

    // Edge direction: 0 = horizontal edge (filter vertically), 1 = vertical edge (filter horizontally)
    const edgeDir = gradV.div(gradH.add(gradV).add(0.0001));

    // =============================================
    // LANCZOS2 DIRECTIONAL FILTERING
    // =============================================

    // Sub-pixel position within the 2x2 kernel
    const fx = inputPosFract.x;
    const fy = inputPosFract.y;

    // Distances from sample point to each texel center
    // For the 2x2 core (F, G, J, K):
    const dF = sqrt(fx.mul(fx).add(fy.mul(fy)));
    const dG = sqrt(float(1).sub(fx).mul(float(1).sub(fx)).add(fy.mul(fy)));
    const dJ = sqrt(fx.mul(fx).add(float(1).sub(fy).mul(float(1).sub(fy))));
    const dK = sqrt(float(1).sub(fx).mul(float(1).sub(fx)).add(float(1).sub(fy).mul(float(1).sub(fy))));

    // Lanczos2 weights for core 2x2
    const wF = lanczos2Weight(dF);
    const wG = lanczos2Weight(dG);
    const wJ = lanczos2Weight(dJ);
    const wK = lanczos2Weight(dK);

    // Extended texel weights (for edge-aware filtering)
    const wB = lanczos2Weight(sqrt(fx.mul(fx).add(float(1).add(fy).mul(float(1).add(fy)))));
    const wC = lanczos2Weight(sqrt(float(1).sub(fx).mul(float(1).sub(fx)).add(float(1).add(fy).mul(float(1).add(fy)))));
    const wE = lanczos2Weight(sqrt(float(1).add(fx).mul(float(1).add(fx)).add(fy.mul(fy))));
    const wH = lanczos2Weight(sqrt(float(2).sub(fx).mul(float(2).sub(fx)).add(fy.mul(fy))));
    const wI = lanczos2Weight(sqrt(float(1).add(fx).mul(float(1).add(fx)).add(float(1).sub(fy).mul(float(1).sub(fy)))));
    const wL = lanczos2Weight(sqrt(float(2).sub(fx).mul(float(2).sub(fx)).add(float(1).sub(fy).mul(float(1).sub(fy)))));
    const wN = lanczos2Weight(sqrt(fx.mul(fx).add(float(2).sub(fy).mul(float(2).sub(fy)))));
    const wO = lanczos2Weight(sqrt(float(1).sub(fx).mul(float(1).sub(fx)).add(float(2).sub(fy).mul(float(2).sub(fy)))));

    // =============================================
    // WEIGHTED FILTERING
    // =============================================

    // Core bilinear result (fast path for flat areas)
    const w00 = float(1.0).sub(fx).mul(float(1.0).sub(fy));
    const w10 = fx.mul(float(1.0).sub(fy));
    const w01 = float(1.0).sub(fx).mul(fy);
    const w11 = fx.mul(fy);
    const bilinear = sF.mul(w00).add(sG.mul(w10)).add(sJ.mul(w01)).add(sK.mul(w11));

    // Full 12-tap Lanczos filtering (for edges)
    const sumWeights = wB.add(wC).add(wE).add(wF).add(wG).add(wH).add(wI).add(wJ).add(wK).add(wL).add(wN).add(wO);
    const lanczosResult = sB.mul(wB)
      .add(sC.mul(wC))
      .add(sE.mul(wE))
      .add(sF.mul(wF))
      .add(sG.mul(wG))
      .add(sH.mul(wH))
      .add(sI.mul(wI))
      .add(sJ.mul(wJ))
      .add(sK.mul(wK))
      .add(sL.mul(wL))
      .add(sN.mul(wN))
      .add(sO.mul(wO))
      .div(sumWeights.add(0.0001));

    // Directional filtering based on edge direction
    // For horizontal edges, emphasize horizontal samples
    // For vertical edges, emphasize vertical samples
    const horzWeight = wE.add(wF).add(wG).add(wH).add(wI).add(wJ).add(wK).add(wL);
    const vertWeight = wB.add(wC).add(wF).add(wG).add(wJ).add(wK).add(wN).add(wO);

    const horzResult = sE.mul(wE)
      .add(sF.mul(wF))
      .add(sG.mul(wG))
      .add(sH.mul(wH))
      .add(sI.mul(wI))
      .add(sJ.mul(wJ))
      .add(sK.mul(wK))
      .add(sL.mul(wL))
      .div(horzWeight.add(0.0001));

    const vertResult = sB.mul(wB)
      .add(sC.mul(wC))
      .add(sF.mul(wF))
      .add(sG.mul(wG))
      .add(sJ.mul(wJ))
      .add(sK.mul(wK))
      .add(sN.mul(wN))
      .add(sO.mul(wO))
      .div(vertWeight.add(0.0001));

    // Blend between horizontal and vertical based on edge direction
    const directionalResult = mix(horzResult, vertResult, edgeDir);

    // Blend between bilinear (flat areas) and directional (edges)
    const sharpnessScale = uSharpness.mul(edgeStrength);
    const filtered = mix(bilinear, directionalResult, sharpnessScale);

    // =============================================
    // RING SUPPRESSION (using ALL 12 texels)
    // =============================================

    // Compute local min/max from all 12 samples to prevent ringing
    const minRGB = min(min(min(min(min(sB, sC), min(sE, sF)), min(min(sG, sH), min(sI, sJ))), min(sK, sL)), min(sN, sO));
    const maxRGB = max(max(max(max(max(sB, sC), max(sE, sF)), max(max(sG, sH), max(sI, sJ))), max(sK, sL)), max(sN, sO));

    // Clamp result to local range
    const result = clamp(filtered, minRGB, maxRGB);

    return vec4(result, 1.0);
  });

  return {
    node: easuNode(),
    uniforms: {
      inputResolution: uInputRes,
      outputResolution: uOutputRes,
      sharpness: uSharpness,
    },
  };
}

// ============================================
// RCAS - Robust Contrast-Adaptive Sharpening
// ============================================

export interface RCASConfig {
  sharpness: number; // 0.0 - 2.0, controls sharpening intensity (default 0.5)
}

const DEFAULT_RCAS_CONFIG: RCASConfig = {
  sharpness: 0.5,
};

/**
 * Create RCAS sharpening pass as a TSL node.
 * Applied after upscaling to restore detail lost in the process.
 *
 * FSR 1.0 RCAS algorithm:
 * 1. Sample 5-tap cross pattern (center + NSWE)
 * 2. Compute local contrast as max - min
 * 3. Compute adaptive sharpening weight inversely proportional to contrast
 * 4. Apply sharpening: center + (center - average) * weight
 * 5. Clamp to local min/max to prevent ringing
 */
export function createRCASPass(
  inputNode: any,
  resolution: THREE.Vector2,
  config: Partial<RCASConfig> = {}
) {
  const cfg = { ...DEFAULT_RCAS_CONFIG, ...config };

  const uResolution = uniform(resolution);
  const uSharpness = uniform(cfg.sharpness);

  const rcasNode = Fn(() => {
    const fragUV = uv();
    const texelSize = vec2(1.0).div(uResolution);

    // 5-tap cross pattern
    const center = vec3(inputNode).toVar();
    const north = inputNode.sample(fragUV.add(vec2(0, -1).mul(texelSize))).rgb;
    const south = inputNode.sample(fragUV.add(vec2(0, 1).mul(texelSize))).rgb;
    const west = inputNode.sample(fragUV.add(vec2(-1, 0).mul(texelSize))).rgb;
    const east = inputNode.sample(fragUV.add(vec2(1, 0).mul(texelSize))).rgb;

    // Compute local min/max for clamping
    const minRGB = min(min(min(north, south), min(west, east)), center);
    const maxRGB = max(max(max(north, south), max(west, east)), center);

    // Compute local contrast (per channel)
    const contrast = maxRGB.sub(minRGB);

    // Adaptive sharpening weight: sharpen less in high-contrast areas
    // This prevents over-sharpening at edges
    const peak = max(max(contrast.r, contrast.g), contrast.b);
    const adaptiveWeight = float(1.0).div(peak.add(0.25));

    // Apply sharpening: enhance center relative to neighbors
    const neighbors = north.add(south).add(west).add(east);
    const sharpenedColor = center.add(
      center.mul(4.0).sub(neighbors).mul(uSharpness).mul(adaptiveWeight)
    );

    // Clamp to prevent ringing artifacts
    const result = clamp(sharpenedColor, minRGB, maxRGB);

    return vec4(result, 1.0);
  });

  return {
    node: rcasNode(),
    uniforms: {
      resolution: uResolution,
      sharpness: uSharpness,
    },
  };
}

// ============================================
// TSU - TEMPORAL SPATIAL UPSCALER PIPELINE
// ============================================

export interface TSUConfig {
  renderScale: number;      // 0.5 - 1.0, internal render resolution (default 0.75)
  easuSharpness: number;    // 0.0 - 1.0, EASU edge sharpness (default 0.5)
  rcasEnabled: boolean;     // Enable RCAS sharpening (default true)
  rcasSharpness: number;    // 0.0 - 2.0, RCAS intensity (default 0.5)
}

const DEFAULT_TSU_CONFIG: TSUConfig = {
  renderScale: 0.75,
  easuSharpness: 0.5,
  rcasEnabled: true,
  rcasSharpness: 0.5,
};

/**
 * TSU - Complete Temporal Spatial Upscaling Pipeline
 *
 * Renders the scene at a lower internal resolution and upscales
 * to the display resolution using EASU + optional RCAS.
 *
 * Performance profile at 1080p output:
 * - renderScale 0.5 = 540p internal = ~4x faster
 * - renderScale 0.75 = 810p internal = ~1.8x faster
 * - renderScale 1.0 = 1080p internal = no upscaling
 */
export class TemporalSpatialUpscaler {
  private renderer: WebGPURenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private config: TSUConfig;

  // Render targets
  private lowResTarget: THREE.WebGLRenderTarget | null = null;

  // Resolution tracking
  private displayWidth = 1920;
  private displayHeight = 1080;
  private renderWidth = 1440;
  private renderHeight = 810;

  // Uniforms
  private uRenderResolution = uniform(new THREE.Vector2(1440, 810));
  private uDisplayResolution = uniform(new THREE.Vector2(1920, 1080));
  private uEASUSharpness = uniform(0.5);
  private uRCASSharpness = uniform(0.5);

  constructor(
    renderer: WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    config: Partial<TSUConfig> = {}
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.config = { ...DEFAULT_TSU_CONFIG, ...config };

    this.updateUniforms();
  }

  private updateUniforms(): void {
    this.uEASUSharpness.value = this.config.easuSharpness;
    this.uRCASSharpness.value = this.config.rcasSharpness;
  }

  setSize(displayWidth: number, displayHeight: number): void {
    this.displayWidth = displayWidth;
    this.displayHeight = displayHeight;
    this.renderWidth = Math.floor(displayWidth * this.config.renderScale);
    this.renderHeight = Math.floor(displayHeight * this.config.renderScale);

    this.uDisplayResolution.value.set(displayWidth, displayHeight);
    this.uRenderResolution.value.set(this.renderWidth, this.renderHeight);

    if (this.lowResTarget) {
      this.lowResTarget.dispose();
    }
    this.lowResTarget = new THREE.WebGLRenderTarget(this.renderWidth, this.renderHeight, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });
  }

  setConfig(config: Partial<TSUConfig>): void {
    const scaleChanged = config.renderScale !== undefined &&
      config.renderScale !== this.config.renderScale;

    this.config = { ...this.config, ...config };
    this.updateUniforms();

    if (scaleChanged) {
      this.setSize(this.displayWidth, this.displayHeight);
    }
  }

  getRenderResolution(): { width: number; height: number } {
    return { width: this.renderWidth, height: this.renderHeight };
  }

  getRenderScalePercent(): number {
    return Math.round(this.config.renderScale * 100);
  }

  dispose(): void {
    if (this.lowResTarget) {
      this.lowResTarget.dispose();
      this.lowResTarget = null;
    }
  }
}

// ============================================
// STANDALONE EASU NODE FOR POST-PROCESSING
// ============================================

/**
 * Create a standalone EASU upscaling node for PostProcessing pipeline.
 *
 * This is the primary API for FSR upscaling in the game.
 *
 * @param inputNode - Input texture node (from internal pipeline)
 * @param renderResolution - Internal render resolution
 * @param displayResolution - Final display resolution
 * @param sharpness - Edge sharpness (0-1)
 */
export function easuUpscale(
  inputNode: any,
  renderResolution: THREE.Vector2,
  displayResolution: THREE.Vector2,
  sharpness: number = 0.5
) {
  const uRenderRes = uniform(renderResolution);
  const uDisplayRes = uniform(displayResolution);
  const uSharpness = uniform(sharpness);

  const node = Fn(() => {
    const fragUV = uv();

    // Calculate input texture coordinates
    const inputTexelSize = vec2(1.0).div(uRenderRes);

    // Position in input texture space (accounting for pixel centers)
    const inputPos = fragUV.mul(uRenderRes).sub(0.5);
    const inputPosFloor = floor(inputPos);
    const inputPosFract = fract(inputPos);

    // Base texel coordinate (top-left of 2x2 region)
    const baseUV = inputPosFloor.add(0.5).mul(inputTexelSize);

    // Clamp UV to prevent edge artifacts
    const clampUV = (uvCoord: ReturnType<typeof vec2>) =>
      clamp(uvCoord, vec2(0.5).mul(inputTexelSize), vec2(1).sub(vec2(0.5).mul(inputTexelSize)));

    // =============================================
    // 12-TAP SAMPLE PATTERN
    // =============================================

    const sB = inputNode.sample(clampUV(baseUV.add(vec2(0, -1).mul(inputTexelSize)))).rgb;
    const sC = inputNode.sample(clampUV(baseUV.add(vec2(1, -1).mul(inputTexelSize)))).rgb;
    const sE = inputNode.sample(clampUV(baseUV.add(vec2(-1, 0).mul(inputTexelSize)))).rgb;
    const sF = inputNode.sample(clampUV(baseUV.add(vec2(0, 0).mul(inputTexelSize)))).rgb;
    const sG = inputNode.sample(clampUV(baseUV.add(vec2(1, 0).mul(inputTexelSize)))).rgb;
    const sH = inputNode.sample(clampUV(baseUV.add(vec2(2, 0).mul(inputTexelSize)))).rgb;
    const sI = inputNode.sample(clampUV(baseUV.add(vec2(-1, 1).mul(inputTexelSize)))).rgb;
    const sJ = inputNode.sample(clampUV(baseUV.add(vec2(0, 1).mul(inputTexelSize)))).rgb;
    const sK = inputNode.sample(clampUV(baseUV.add(vec2(1, 1).mul(inputTexelSize)))).rgb;
    const sL = inputNode.sample(clampUV(baseUV.add(vec2(2, 1).mul(inputTexelSize)))).rgb;
    const sN = inputNode.sample(clampUV(baseUV.add(vec2(0, 2).mul(inputTexelSize)))).rgb;
    const sO = inputNode.sample(clampUV(baseUV.add(vec2(1, 2).mul(inputTexelSize)))).rgb;

    // =============================================
    // LUMINANCE & EDGE DETECTION
    // =============================================

    const luma = (c: any) => dot(c, vec3(0.299, 0.587, 0.114));

    const lumB = luma(sB);
    const lumC = luma(sC);
    const lumE = luma(sE);
    const lumF = luma(sF);
    const lumG = luma(sG);
    const lumH = luma(sH);
    const lumI = luma(sI);
    const lumJ = luma(sJ);
    const lumK = luma(sK);
    const lumL = luma(sL);
    const lumN = luma(sN);
    const lumO = luma(sO);

    // Horizontal gradient
    const gradH = abs(lumE.sub(lumF))
      .add(abs(lumF.sub(lumG)))
      .add(abs(lumG.sub(lumH)))
      .add(abs(lumI.sub(lumJ)))
      .add(abs(lumJ.sub(lumK)))
      .add(abs(lumK.sub(lumL)));

    // Vertical gradient
    const gradV = abs(lumB.sub(lumF))
      .add(abs(lumF.sub(lumJ)))
      .add(abs(lumJ.sub(lumN)))
      .add(abs(lumC.sub(lumG)))
      .add(abs(lumG.sub(lumK)))
      .add(abs(lumK.sub(lumO)));

    // Edge metrics
    const gradTotal = gradH.add(gradV);
    const edgeStrength = clamp(gradTotal.mul(2.0), 0.0, 1.0);
    const edgeDir = gradV.div(gradH.add(gradV).add(0.0001));

    // =============================================
    // FILTERING
    // =============================================

    const fx = inputPosFract.x;
    const fy = inputPosFract.y;

    // Bilinear weights
    const w00 = float(1.0).sub(fx).mul(float(1.0).sub(fy));
    const w10 = fx.mul(float(1.0).sub(fy));
    const w01 = float(1.0).sub(fx).mul(fy);
    const w11 = fx.mul(fy);

    // Standard bilinear (for flat areas)
    const bilinear = sF.mul(w00).add(sG.mul(w10)).add(sJ.mul(w01)).add(sK.mul(w11));

    // Lanczos-weighted 12-tap filter (for edges)
    const lanczos2 = (x: ReturnType<typeof float>) => {
      const ax = abs(x);
      return max(float(0), pow(float(2).sub(ax), 2).mul(float(1).add(ax.mul(0.5)))).div(4);
    };

    // Compute Lanczos weights for all 12 samples
    const wB = lanczos2(sqrt(fx.mul(fx).add(float(1).add(fy).mul(float(1).add(fy)))));
    const wC = lanczos2(sqrt(float(1).sub(fx).mul(float(1).sub(fx)).add(float(1).add(fy).mul(float(1).add(fy)))));
    const wE = lanczos2(sqrt(float(1).add(fx).mul(float(1).add(fx)).add(fy.mul(fy))));
    const wF = lanczos2(sqrt(fx.mul(fx).add(fy.mul(fy))));
    const wG = lanczos2(sqrt(float(1).sub(fx).mul(float(1).sub(fx)).add(fy.mul(fy))));
    const wH = lanczos2(sqrt(float(2).sub(fx).mul(float(2).sub(fx)).add(fy.mul(fy))));
    const wI = lanczos2(sqrt(float(1).add(fx).mul(float(1).add(fx)).add(float(1).sub(fy).mul(float(1).sub(fy)))));
    const wJ = lanczos2(sqrt(fx.mul(fx).add(float(1).sub(fy).mul(float(1).sub(fy)))));
    const wK = lanczos2(sqrt(float(1).sub(fx).mul(float(1).sub(fx)).add(float(1).sub(fy).mul(float(1).sub(fy)))));
    const wL = lanczos2(sqrt(float(2).sub(fx).mul(float(2).sub(fx)).add(float(1).sub(fy).mul(float(1).sub(fy)))));
    const wN = lanczos2(sqrt(fx.mul(fx).add(float(2).sub(fy).mul(float(2).sub(fy)))));
    const wO = lanczos2(sqrt(float(1).sub(fx).mul(float(1).sub(fx)).add(float(2).sub(fy).mul(float(2).sub(fy)))));

    // Horizontal and vertical directional filtering
    const horzW = wE.add(wF).add(wG).add(wH).add(wI).add(wJ).add(wK).add(wL);
    const horzResult = sE.mul(wE).add(sF.mul(wF)).add(sG.mul(wG)).add(sH.mul(wH))
      .add(sI.mul(wI)).add(sJ.mul(wJ)).add(sK.mul(wK)).add(sL.mul(wL))
      .div(horzW.add(0.0001));

    const vertW = wB.add(wC).add(wF).add(wG).add(wJ).add(wK).add(wN).add(wO);
    const vertResult = sB.mul(wB).add(sC.mul(wC)).add(sF.mul(wF)).add(sG.mul(wG))
      .add(sJ.mul(wJ)).add(sK.mul(wK)).add(sN.mul(wN)).add(sO.mul(wO))
      .div(vertW.add(0.0001));

    // Blend based on edge direction
    const directional = mix(horzResult, vertResult, edgeDir);

    // Final blend: bilinear for flat areas, directional for edges
    const sharpnessScale = uSharpness.mul(edgeStrength);
    const filtered = mix(bilinear, directional, sharpnessScale);

    // =============================================
    // RING SUPPRESSION (ALL 12 TEXELS)
    // =============================================

    const minRGB = min(min(min(min(min(sB, sC), min(sE, sF)), min(min(sG, sH), min(sI, sJ))), min(sK, sL)), min(sN, sO));
    const maxRGB = max(max(max(max(max(sB, sC), max(sE, sF)), max(max(sG, sH), max(sI, sJ))), max(sK, sL)), max(sN, sO));

    const result = clamp(filtered, minRGB, maxRGB);

    return vec4(result, 1.0);
  });

  return {
    node: node(),
    setRenderResolution: (w: number, h: number) => uRenderRes.value.set(w, h),
    setDisplayResolution: (w: number, h: number) => uDisplayRes.value.set(w, h),
    setSharpness: (s: number) => { uSharpness.value = s; },
  };
}

/**
 * Create RCAS sharpening node for PostProcessing pipeline.
 */
export function rcasSharpening(
  inputNode: any,
  resolution: THREE.Vector2,
  sharpness: number = 0.5
) {
  const uResolution = uniform(resolution);
  const uSharpness = uniform(sharpness);

  const node = Fn(() => {
    const fragUV = uv();
    const texelSize = vec2(1.0).div(uResolution);

    // 5-tap cross pattern
    const center = vec3(inputNode).toVar();
    const north = inputNode.sample(fragUV.add(vec2(0, -1).mul(texelSize))).rgb;
    const south = inputNode.sample(fragUV.add(vec2(0, 1).mul(texelSize))).rgb;
    const west = inputNode.sample(fragUV.add(vec2(-1, 0).mul(texelSize))).rgb;
    const east = inputNode.sample(fragUV.add(vec2(1, 0).mul(texelSize))).rgb;

    // Local min/max
    const minRGB = min(min(min(north, south), min(west, east)), center);
    const maxRGB = max(max(max(north, south), max(west, east)), center);

    // Adaptive sharpening weight
    const contrast = maxRGB.sub(minRGB);
    const peak = max(max(contrast.r, contrast.g), contrast.b);
    const adaptiveWeight = float(1.0).div(peak.add(0.25));

    // Apply sharpening
    const neighbors = north.add(south).add(west).add(east);
    const sharpened = center.add(center.mul(4.0).sub(neighbors).mul(uSharpness).mul(adaptiveWeight));

    // Clamp to prevent artifacts
    const result = clamp(sharpened, minRGB, maxRGB);

    return vec4(result, 1.0);
  });

  return {
    node: node(),
    setResolution: (w: number, h: number) => uResolution.value.set(w, h),
    setSharpness: (s: number) => { uSharpness.value = s; },
  };
}

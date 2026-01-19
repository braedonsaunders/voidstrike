/**
 * Effect Passes - Individual post-processing effect creation functions
 *
 * This module contains standalone functions for creating individual
 * post-processing effects (SSGI, GTAO, SSR, Bloom, etc.). Each function
 * accepts the required inputs and returns the effect node.
 *
 * These functions are used by RenderPipeline to compose the full
 * post-processing chain.
 */

import * as THREE from 'three';
import {
  pass,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  Fn,
  mix,
  smoothstep,
  clamp,
  length,
  dot,
  min,
  max,
  texture,
} from 'three/tsl';

// WebGPU post-processing nodes from addons
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
// @ts-expect-error - Three.js addon module lacks TypeScript declarations
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
// @ts-expect-error - Three.js addon module lacks TypeScript declarations
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';

import { createVolumetricFogNode, VolumetricFogNode } from '../VolumetricFog';
import { debugPostProcessing } from '@/utils/debugLogger';
import {
  calculateReprojectedUV,
  isUVInBounds,
  sampleNeighborhoodBounds,
  applyNeighborhoodClamp,
  temporalBlend,
} from './TemporalUtils';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface SSGIConfig {
  radius: number;
  intensity: number;
  thickness: number;
  aoIntensity: number;
  taaEnabled: boolean;
}

export interface GTAOConfig {
  radius: number;
  intensity: number;
}

export interface SSRConfig {
  maxDistance: number;
  opacity: number;
  thickness: number;
  maxRoughness: number;
}

export interface BloomConfig {
  threshold: number;
  strength: number;
  radius: number;
}

export interface VolumetricFogConfig {
  quality: 'low' | 'medium' | 'high' | 'ultra';
  density: number;
  scattering: number;
}

export interface ColorGradingConfig {
  vignetteEnabled: boolean;
  vignetteIntensity: number;
  exposure: number;
  saturation: number;
  contrast: number;
}

export interface SharpeningConfig {
  intensity: number;
  resolution: THREE.Vector2;
}

// ============================================
// SSGI (Screen Space Global Illumination)
// ============================================

export interface SSGIPassResult {
  pass: ReturnType<typeof ssgi>;
  node: any;
}

/**
 * Create SSGI (Screen Space Global Illumination) effect
 *
 * SSGI provides indirect lighting (light bouncing) with built-in AO.
 * When enabled, it typically replaces GTAO.
 */
export function createSSGIPass(
  scenePassColor: any,
  scenePassDepth: any,
  scenePassNormal: any,
  camera: THREE.Camera,
  config: SSGIConfig
): SSGIPassResult | null {
  try {
    // Pass the raw encoded normal texture - DO NOT use colorToDirection()
    // SSR/SSGI need texture nodes with .sample() method
    const ssgiPass = ssgi(
      scenePassColor,
      scenePassDepth,
      scenePassNormal,
      camera
    );

    if (ssgiPass) {
      // Medium quality preset (sliceCount 2, stepCount 8)
      // Higher slice count significantly reduces temporal instabilities
      ssgiPass.sliceCount.value = 2;
      ssgiPass.stepCount.value = 8;
      ssgiPass.radius.value = config.radius;
      ssgiPass.giIntensity.value = config.intensity;
      ssgiPass.thickness.value = config.thickness;
      ssgiPass.aoIntensity.value = config.aoIntensity;
      ssgiPass.useTemporalFiltering = config.taaEnabled;
    }

    const ssgiResult = ssgiPass.getTextureNode();
    const giColor = ssgiResult.rgb;
    const aoValue = ssgiResult.a;

    // Combine: multiply by AO, add GI color
    const node = (inputColor: any) => inputColor.mul(aoValue).add(giColor);

    return { pass: ssgiPass, node };
  } catch (e) {
    debugPostProcessing.warn('[EffectPasses] SSGI initialization failed:', e);
    return null;
  }
}

// ============================================
// GTAO (Ground Truth Ambient Occlusion)
// ============================================

export interface GTAOPassResult {
  pass: ReturnType<typeof ao>;
  aoValueNode: any;
}

/**
 * Create GTAO (Ground Truth Ambient Occlusion) effect
 *
 * Returns the AO pass and the AO value node for compositing.
 */
export function createGTAOPass(
  scenePassDepth: any,
  camera: THREE.Camera,
  config: GTAOConfig
): GTAOPassResult | null {
  try {
    // @ts-expect-error - @types/three declares normalNode as non-nullable but actual API accepts null
    const aoPass = ao(scenePassDepth, null, camera);
    aoPass.radius.value = config.radius;
    const aoValueNode = aoPass.getTextureNode().r;

    return { pass: aoPass, aoValueNode };
  } catch (e) {
    debugPostProcessing.warn('[EffectPasses] GTAO initialization failed:', e);
    return null;
  }
}

/**
 * Apply AO to a color node
 *
 * @param colorNode The input color node
 * @param aoValueNode The AO value (0-1, where 1 is no occlusion)
 * @param intensityUniform Uniform controlling AO intensity
 */
export function applyAOToColor(
  colorNode: any,
  aoValueNode: any,
  intensityUniform: ReturnType<typeof uniform>
): any {
  const aoFactor = mix(float(1.0), aoValueNode, intensityUniform);
  return colorNode.mul(vec3(aoFactor));
}

// ============================================
// SSR (Screen Space Reflections)
// ============================================

export interface SSRPassResult {
  pass: ReturnType<typeof ssr>;
  textureNode: any;
}

/**
 * Create SSR (Screen Space Reflections) effect
 *
 * Uses per-pixel metalness/roughness from G-buffer for accurate reflections.
 */
export function createSSRPass(
  scenePassColor: any,
  scenePassDepth: any,
  scenePassNormal: any,
  scenePassMetalRough: any,
  camera: THREE.Camera,
  config: SSRConfig
): SSRPassResult | null {
  try {
    // Cast to bypass @types/three incomplete ssr() signature
    const ssrPass = (ssr as any)(
      scenePassColor,
      scenePassDepth,
      scenePassNormal,
      scenePassMetalRough.r,
      scenePassMetalRough.g,
      camera
    );

    if (ssrPass?.maxDistance) {
      ssrPass.maxDistance.value = config.maxDistance;
    }
    if (ssrPass?.opacity) {
      ssrPass.opacity.value = config.opacity;
    }
    if (ssrPass?.thickness) {
      ssrPass.thickness.value = config.thickness;
    }

    const textureNode = ssrPass?.getTextureNode();

    return { pass: ssrPass, textureNode };
  } catch (e) {
    debugPostProcessing.warn('[EffectPasses] SSR initialization failed:', e);
    return null;
  }
}

/**
 * Apply SSR reflections to a color node
 *
 * @param colorNode The input color node
 * @param ssrTextureNode The SSR texture node (RGBA where A is reflection mask)
 */
export function applySSRToColor(colorNode: any, ssrTextureNode: any): any {
  const ssrColor = ssrTextureNode.rgb;
  const ssrAlpha = ssrTextureNode.a;
  return colorNode.add(ssrColor.mul(ssrAlpha));
}

// ============================================
// BLOOM
// ============================================

export interface BloomPassResult {
  pass: ReturnType<typeof bloom>;
  node: any;
}

/**
 * Create Bloom effect
 */
export function createBloomPass(
  inputNode: any,
  config: BloomConfig
): BloomPassResult | null {
  try {
    const bloomPass = bloom(inputNode);
    bloomPass.threshold.value = config.threshold;
    bloomPass.strength.value = config.strength;
    bloomPass.radius.value = config.radius;

    // Bloom adds to the input
    const node = inputNode.add(bloomPass);

    return { pass: bloomPass, node };
  } catch (e) {
    debugPostProcessing.warn('[EffectPasses] Bloom initialization failed:', e);
    return null;
  }
}

// ============================================
// VOLUMETRIC FOG
// ============================================

export interface VolumetricFogPassResult {
  pass: VolumetricFogNode;
  node: any;
}

/**
 * Create Volumetric Fog effect (raymarched atmospheric scattering)
 */
export function createVolumetricFogPass(
  inputNode: any,
  depthNode: any,
  camera: THREE.PerspectiveCamera,
  config: VolumetricFogConfig
): VolumetricFogPassResult | null {
  try {
    const fogPass = createVolumetricFogNode(inputNode, depthNode, camera);
    fogPass.applyConfig({
      quality: config.quality,
      density: config.density,
      scattering: config.scattering,
    });

    return { pass: fogPass, node: fogPass.node };
  } catch (e) {
    debugPostProcessing.warn('[EffectPasses] Volumetric fog initialization failed:', e);
    return null;
  }
}

// ============================================
// COLOR GRADING
// ============================================

export interface ColorGradingUniforms {
  vignetteIntensity: ReturnType<typeof uniform>;
  exposure: ReturnType<typeof uniform>;
  saturation: ReturnType<typeof uniform>;
  contrast: ReturnType<typeof uniform>;
}

/**
 * ACES Filmic Tone Mapping (Narkowicz 2015 approximation)
 *
 * Industry standard for cinematic color grading.
 * Provides smooth highlight rolloff and rich shadows.
 */
export function acesToneMap(color: any): any {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;

  return clamp(
    color.mul(color.mul(a).add(b)).div(color.mul(color.mul(c).add(d)).add(e)),
    0.0,
    1.0
  );
}

/**
 * Create Color Grading pass
 *
 * Includes exposure, saturation, contrast, ACES tone mapping, and vignette.
 */
export function createColorGradingPass(
  inputNode: any,
  uniforms: ColorGradingUniforms,
  vignetteEnabled: boolean
): any {
  return Fn(() => {
    let color = vec3(inputNode).toVar();

    // Apply exposure in linear HDR space (before tone mapping)
    color.mulAssign(uniforms.exposure);

    // Apply saturation in linear space
    const luminance = dot(color, vec3(0.299, 0.587, 0.114));
    color.assign(mix(vec3(luminance), color, uniforms.saturation));

    // Apply contrast in linear space (around mid-gray)
    const midGray = 0.18;
    color.assign(color.sub(midGray).mul(uniforms.contrast).add(midGray));

    // Ensure no negative values before tone mapping
    color.assign(max(color, vec3(0.0)));

    // Apply ACES Filmic tone mapping
    color.assign(acesToneMap(color));

    // Apply vignette after tone mapping (in display space)
    if (vignetteEnabled) {
      const uvCentered = uv().sub(0.5);
      const dist = length(uvCentered).mul(2.0);
      const vignetteFactor = smoothstep(float(1.4), float(0.5), dist);
      const vignetteAmount = mix(float(1.0).sub(uniforms.vignetteIntensity), float(1.0), vignetteFactor);
      color.mulAssign(vignetteAmount);
    }

    return vec4(color, 1.0);
  })();
}

// ============================================
// SHARPENING (RCAS-style)
// ============================================

/**
 * Create RCAS-style sharpening pass
 */
export function createSharpeningPass(
  inputNode: any,
  resolutionUniform: ReturnType<typeof uniform>,
  intensityUniform: ReturnType<typeof uniform>
): any {
  return Fn(() => {
    const fragUV = uv();
    const texelSize = vec2(1.0).div(resolutionUniform);

    const center = vec3(inputNode).toVar();
    const north = inputNode.sample(fragUV.add(vec2(0, -1).mul(texelSize))).rgb;
    const south = inputNode.sample(fragUV.add(vec2(0, 1).mul(texelSize))).rgb;
    const west = inputNode.sample(fragUV.add(vec2(-1, 0).mul(texelSize))).rgb;
    const east = inputNode.sample(fragUV.add(vec2(1, 0).mul(texelSize))).rgb;

    const minRGB = min(min(min(north, south), min(west, east)), center);
    const maxRGB = max(max(max(north, south), max(west, east)), center);

    const contrast = maxRGB.sub(minRGB);
    const rcpM = float(1.0).div(max(max(contrast.r, contrast.g), contrast.b).add(0.25));

    const neighbors = north.add(south).add(west).add(east);
    const sharpenedColor = center.add(
      center.mul(4.0).sub(neighbors).mul(intensityUniform).mul(rcpM)
    );

    const result = clamp(sharpenedColor, minRGB, maxRGB);
    return vec4(result, 1.0);
  })();
}

// ============================================
// ANTI-ALIASING (TAA/TRAA and FXAA)
// ============================================

export interface TRAAPassResult {
  pass: ReturnType<typeof traa>;
  textureNode: any;
}

/**
 * Create TRAA (Temporal Reprojection Anti-Aliasing) pass
 */
export function createTRAAPass(
  inputNode: any,
  depthNode: any,
  velocityNode: any,
  camera: THREE.Camera
): TRAAPassResult | null {
  try {
    const traaPass = traa(inputNode, depthNode, velocityNode, camera);
    const textureNode = traaPass.getTextureNode();

    return { pass: traaPass, textureNode };
  } catch (e) {
    debugPostProcessing.warn('[EffectPasses] TRAA initialization failed:', e);
    return null;
  }
}

export interface FXAAPassResult {
  pass: ReturnType<typeof fxaa>;
  node: any;
}

/**
 * Create FXAA (Fast Approximate Anti-Aliasing) pass
 */
export function createFXAAPass(inputNode: any): FXAAPassResult | null {
  try {
    const fxaaPass = fxaa(inputNode);
    return { pass: fxaaPass, node: fxaaPass };
  } catch (e) {
    debugPostProcessing.warn('[EffectPasses] FXAA initialization failed:', e);
    return null;
  }
}

// ============================================
// TEMPORAL UPSCALING HELPERS
// ============================================

/**
 * Create temporal AO upscaling node
 *
 * Blends quarter-res current AO with full-res history using velocity reprojection.
 * Uses shared utilities from TemporalUtils for consistent behavior.
 */
export function createTemporalAOUpscaleNode(
  quarterAOTexture: THREE.Texture,
  historyTexture: THREE.Texture,
  velocityNode: any,
  blendUniform: ReturnType<typeof uniform>
): any {
  const quarterAONode = texture(quarterAOTexture);
  const historyNode = texture(historyTexture);

  return Fn(() => {
    const fragUV = uv();
    const prevUV = calculateReprojectedUV(velocityNode, fragUV);

    // Sample quarter-res AO (bilinear filtering provides some upscaling)
    const currentAO = quarterAONode.sample(fragUV).r;
    // Sample full-res history
    const historyAO = historyNode.sample(prevUV).r;

    const inBounds = isUVInBounds(prevUV);

    // Use higher history weight since quarter-res needs more temporal accumulation
    return temporalBlend(currentAO, historyAO, blendUniform, inBounds);
  })();
}

/**
 * Create temporal SSR upscaling node with neighborhood clamping
 *
 * Blends quarter-res current SSR with full-res history using velocity reprojection.
 * Includes neighborhood clamping to reduce ghosting.
 * Uses shared utilities from TemporalUtils for consistent behavior.
 */
export function createTemporalSSRUpscaleNode(
  quarterSSRTexture: THREE.Texture,
  historyTexture: THREE.Texture,
  velocityNode: any,
  resolutionUniform: ReturnType<typeof uniform>,
  blendUniform: ReturnType<typeof uniform>
): any {
  const quarterSSRNode = texture(quarterSSRTexture);
  const historyNode = texture(historyTexture);

  return Fn(() => {
    const fragUV = uv();
    const prevUV = calculateReprojectedUV(velocityNode, fragUV);
    const texelSize = vec2(1.0).div(resolutionUniform);

    // Sample quarter-res SSR with neighborhood bounds for clamping
    const { minColor, maxColor, centerSample } = sampleNeighborhoodBounds(
      quarterSSRNode,
      fragUV,
      texelSize
    );

    // Sample and clamp history to reduce ghosting
    const historySSR = historyNode.sample(prevUV);
    const clampedHistory = applyNeighborhoodClamp(historySSR, minColor, maxColor);

    const inBounds = isUVInBounds(prevUV);

    return temporalBlend(centerSample, clampedHistory, blendUniform, inBounds);
  })();
}

/**
 * Create temporal blending node for full-res effect with history
 *
 * Generic temporal blending for effects without quarter-res pipeline.
 * Uses shared utilities from TemporalUtils for consistent behavior.
 */
export function createTemporalBlendNode(
  currentNode: any,
  historyTexture: THREE.Texture,
  velocityNode: any,
  blendUniform: ReturnType<typeof uniform>
): any {
  const historyNode = texture(historyTexture);

  return Fn(() => {
    const fragUV = uv();
    const prevUV = calculateReprojectedUV(velocityNode, fragUV);

    const current = currentNode;
    const history = historyNode.sample(prevUV);

    const inBounds = isUVInBounds(prevUV);

    return temporalBlend(current, history, blendUniform, inBounds);
  })();
}

/**
 * Create SSR temporal blending node for full-res SSR with neighborhood clamping
 * Uses shared utilities from TemporalUtils for consistent behavior.
 */
export function createFullResTemporalSSRNode(
  ssrTextureNode: any,
  historyTexture: THREE.Texture,
  velocityNode: any,
  resolutionUniform: ReturnType<typeof uniform>,
  blendUniform: ReturnType<typeof uniform>
): any {
  const historyNode = texture(historyTexture);

  return Fn(() => {
    const fragUV = uv();
    const prevUV = calculateReprojectedUV(velocityNode, fragUV);
    const texelSize = vec2(1.0).div(resolutionUniform);

    // Sample current SSR with neighborhood bounds for clamping
    const { minColor, maxColor, centerSample } = sampleNeighborhoodBounds(
      ssrTextureNode,
      fragUV,
      texelSize
    );

    // Sample and clamp history to reduce ghosting
    const historySSR = historyNode.sample(prevUV);
    const clampedHistory = applyNeighborhoodClamp(historySSR, minColor, maxColor);

    const inBounds = isUVInBounds(prevUV);

    return temporalBlend(centerSample, clampedHistory, blendUniform, inBounds);
  })();
}

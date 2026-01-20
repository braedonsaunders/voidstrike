/**
 * Effect Passes - Individual post-processing effect creation functions
 *
 * This module contains standalone functions for creating individual
 * post-processing effects (SSGI, GTAO, SSR, Bloom, etc.). Each function
 * accepts the required inputs and returns the effect node.
 *
 * These functions are used by RenderPipeline to compose the full
 * post-processing chain.
 *
 * ## Type Safety Note
 *
 * This module uses `any` for TSL shader node parameters. This is INTENTIONAL
 * because TSL operators work polymorphically:
 *
 * - A color parameter could be `vec3`, `vec4`, or another shader node
 * - Arithmetic operations accept mixed types (float * vec3 → vec3)
 * - The GPU handles type promotion automatically
 *
 * Attempting to strictly type these would require extensive conditional
 * types that hurt readability without practical benefit. The `any` usage
 * is contained within shader composition and doesn't leak to game logic.
 *
 * See `src/types/three-webgpu.d.ts` for detailed rationale.
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
import { snoise3D, fbm3 } from '../noise';
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

// ============================================
// FOG OF WAR (StarCraft 2-Inspired Post-Process)
// ============================================

export type FogOfWarQuality = 'low' | 'medium' | 'high' | 'ultra';

export const FOG_OF_WAR_QUALITY_PRESETS = {
  low: { edgeSamples: 1, cloudOctaves: 1, temporalEnabled: false },
  medium: { edgeSamples: 5, cloudOctaves: 2, temporalEnabled: true },
  high: { edgeSamples: 9, cloudOctaves: 3, temporalEnabled: true },
  ultra: { edgeSamples: 13, cloudOctaves: 3, temporalEnabled: true },
} as const;

export interface FogOfWarConfig {
  quality: FogOfWarQuality;
  edgeBlurRadius: number; // 0-4 cells
  desaturation: number; // 0-1 for explored areas
  exploredDarkness: number; // multiplier for explored areas (0.4-0.7)
  unexploredDarkness: number; // multiplier for unexplored areas (0.1-0.2)
  cloudSpeed: number; // animation speed
  cloudScale: number; // cloud texture scale
  rimIntensity: number; // edge glow intensity
  rimColor: THREE.Color;
  heightInfluence: number; // 0-1 how much height affects fog density
  coolShift: THREE.Color; // color tint for explored areas
}

export interface FogOfWarPassResult {
  node: any;
  uniforms: {
    enabled: ReturnType<typeof uniform>;
    time: ReturnType<typeof uniform>;
    quality: ReturnType<typeof uniform>;
    edgeBlurRadius: ReturnType<typeof uniform>;
    desaturation: ReturnType<typeof uniform>;
    exploredDarkness: ReturnType<typeof uniform>;
    unexploredDarkness: ReturnType<typeof uniform>;
    cloudSpeed: ReturnType<typeof uniform>;
    cloudScale: ReturnType<typeof uniform>;
    rimIntensity: ReturnType<typeof uniform>;
    rimColor: ReturnType<typeof uniform>;
    heightInfluence: ReturnType<typeof uniform>;
    coolShift: ReturnType<typeof uniform>;
    mapDimensions: ReturnType<typeof uniform>;
    gridDimensions: ReturnType<typeof uniform>;
    cellSize: ReturnType<typeof uniform>;
  };
  setVisionTexture: (tex: THREE.Texture | null) => void;
  setEnabled: (enabled: boolean) => void;
  updateTime: (t: number) => void;
  updateCamera: (cam: THREE.PerspectiveCamera) => void;
  applyConfig: (config: Partial<FogOfWarConfig>) => void;
}

/**
 * Create StarCraft 2-inspired Fog of War post-processing pass
 *
 * Features:
 * - Soft edge transitions via multi-sample blur kernel
 * - Desaturation + cool color shift for explored areas
 * - Animated procedural clouds for unexplored regions
 * - Edge glow / rim light at visibility boundaries
 * - Height-aware fog density
 * - Quality presets from low to ultra
 *
 * @param sceneColorNode - Scene color input (from previous pass)
 * @param depthNode - Scene depth texture for world position reconstruction
 * @param camera - Camera for depth reconstruction
 */
export function createFogOfWarPass(
  sceneColorNode: any,
  depthNode: any,
  camera: THREE.PerspectiveCamera
): FogOfWarPassResult {
  // ============================================
  // UNIFORMS
  // ============================================
  const uEnabled = uniform(1.0);
  const uTime = uniform(0.0);
  const uQuality = uniform(2); // 0=low, 1=medium, 2=high, 3=ultra

  // Visual parameters
  const uEdgeBlurRadius = uniform(2.5); // Cells
  const uDesaturation = uniform(0.7);
  const uExploredDarkness = uniform(0.5);
  const uUnexploredDarkness = uniform(0.12);
  const uCloudSpeed = uniform(0.015);
  const uCloudScale = uniform(0.08);
  const uRimIntensity = uniform(0.12);
  const uRimColor = uniform(new THREE.Color(0.6, 0.8, 1.0));
  const uHeightInfluence = uniform(0.25);
  const uCoolShift = uniform(new THREE.Color(0.85, 0.9, 1.0));

  // Map configuration
  const uMapDimensions = uniform(new THREE.Vector2(256, 256));
  const uGridDimensions = uniform(new THREE.Vector2(128, 128));
  const uCellSize = uniform(2.0);

  // Camera uniforms for world position reconstruction
  const uCameraNear = uniform(camera.near);
  const uCameraFar = uniform(camera.far);
  // Custom inverse projection matrix (NOT the built-in which is jittered by TRAA)
  const uInverseProjection = uniform(camera.projectionMatrixInverse.clone());
  // Camera world matrix (inverse view) for view->world transform
  const uCameraWorldMatrix = uniform(camera.matrixWorld.clone());

  // Vision texture (will be set dynamically)
  const uHasVisionTexture = uniform(0.0);

  // Create a placeholder texture for initial binding
  // This texture will be REPLACED (not data-updated) when vision texture is set
  const placeholderData = new Uint8Array(4);
  placeholderData[0] = 0; // R - explored
  placeholderData[1] = 0; // G - visible
  placeholderData[2] = 128; // B - velocity (0.5 = no change)
  placeholderData[3] = 0; // A - smooth visibility
  const placeholderTexture = new THREE.DataTexture(placeholderData, 1, 1, THREE.RGBAFormat);
  placeholderTexture.needsUpdate = true;

  // Create the texture node ONCE - we'll update its internal reference
  const visionTextureNode = texture(placeholderTexture);

  // ============================================
  // SHADER NODE
  // ============================================
  const fogOfWarNode = Fn(() => {
    const fragUV = uv();
    const sceneColor = vec3(sceneColorNode).toVar();

    // Early exit if disabled
    const result = vec3(sceneColor).toVar();

    // Sample depth buffer (0-1 range in WebGPU)
    const depthSample = texture(depthNode, fragUV).r;

    // Reconstruct view-space position using Three.js convention
    // For WebGPU: UV Y needs to be flipped, depth is 0-1 (not -1 to 1)
    // screenPosition = vec2(uv.x, 1-uv.y) * 2 - 1
    const screenX = fragUV.x.mul(2.0).sub(1.0);
    const screenY = float(1.0).sub(fragUV.y).mul(2.0).sub(1.0);

    // Build clip-space position (WebGPU uses depth 0-1)
    const clipPos = vec4(screenX, screenY, depthSample, float(1.0));

    // Transform clip -> view space via our custom inverse projection uniform
    const viewPos4 = uInverseProjection.mul(clipPos);
    const viewPos = viewPos4.xyz.div(viewPos4.w);

    // Transform view -> world space via camera world matrix
    const worldPos4 = uCameraWorldMatrix.mul(vec4(viewPos, float(1.0)));
    const worldX = worldPos4.x;
    const worldY = worldPos4.y;
    const worldZ = worldPos4.z;

    // Convert world position to vision grid UV
    const visionU = worldX.div(uMapDimensions.x);
    const visionV = worldZ.div(uMapDimensions.y);
    const visionUV = vec2(visionU, visionV).toVar();

    // Clamp to valid range
    const validUV = clamp(visionUV, 0.0, 1.0);

    // ============================================
    // MULTI-SAMPLE BLUR FOR SOFT EDGES
    // ============================================
    const texelSize = vec2(1.0).div(uGridDimensions);
    const blurRadius = uEdgeBlurRadius.mul(texelSize);

    // Sample vision texture with blur kernel
    // Quality determines number of samples
    const visibility = float(0.0).toVar();
    const explored = float(0.0).toVar();
    const totalWeight = float(0.0).toVar();

    // 9-sample 3x3 Gaussian blur (high quality)
    const gaussianWeights = [
      { offset: vec2(0, 0), weight: 0.25 },
      { offset: vec2(-1, 0), weight: 0.125 },
      { offset: vec2(1, 0), weight: 0.125 },
      { offset: vec2(0, -1), weight: 0.125 },
      { offset: vec2(0, 1), weight: 0.125 },
      { offset: vec2(-1, -1), weight: 0.0625 },
      { offset: vec2(1, -1), weight: 0.0625 },
      { offset: vec2(-1, 1), weight: 0.0625 },
      { offset: vec2(1, 1), weight: 0.0625 },
    ];

    // Use the shared vision texture node (updated externally via setVisionTexture)
    for (const sample of gaussianWeights) {
      const sampleUV = validUV.add(sample.offset.mul(blurRadius));
      const clampedSampleUV = clamp(sampleUV, 0.001, 0.999);
      const visionSample = visionTextureNode.sample(clampedSampleUV);

      // Vision texture format: R=explored, G=visible, B=velocity, A=smooth
      const sampleExplored = visionSample.r;
      const sampleVisible = visionSample.g;
      const sampleSmooth = visionSample.a.greaterThan(0.0).select(visionSample.a, sampleVisible);

      const w = float(sample.weight);
      explored.addAssign(sampleExplored.mul(w));
      visibility.addAssign(sampleSmooth.mul(w));
      totalWeight.addAssign(w);
    }

    // Normalize
    explored.divAssign(totalWeight);
    visibility.divAssign(totalWeight);

    // ============================================
    // VISIBILITY STATE CLASSIFICATION
    // ============================================
    // visibility > 0.5 = visible
    // explored > 0.5 && visibility <= 0.5 = explored (seen before)
    // else = unexplored

    const isVisible = smoothstep(float(0.4), float(0.6), visibility);
    const isExplored = smoothstep(float(0.4), float(0.6), explored);
    const isUnexplored = float(1.0).sub(max(isVisible, isExplored));

    // ============================================
    // EDGE DETECTION FOR RIM GLOW
    // ============================================
    // Use screen-space derivatives of visibility for edge detection
    const dVdx = visibility.dFdx();
    const dVdy = visibility.dFdy();
    const edgeStrength = length(vec2(dVdx, dVdy)).mul(10.0);
    const rimGlow = smoothstep(float(0.0), float(0.5), edgeStrength).mul(uRimIntensity);

    // ============================================
    // ANIMATED CLOUDS FOR UNEXPLORED
    // ============================================
    const cloudPos = vec3(
      worldX.mul(uCloudScale),
      worldZ.mul(uCloudScale),
      uTime.mul(uCloudSpeed)
    );

    // Multi-octave cloud noise
    const cloud1 = fbm3(cloudPos).mul(0.5).add(0.5); // Large swirls
    const cloud2 = fbm3(cloudPos.mul(2.0).add(100.0)).mul(0.5).add(0.5); // Medium
    const cloud3 = snoise3D(cloudPos.mul(4.0).add(200.0)).mul(0.5).add(0.5); // Fine detail

    // Combine octaves
    const cloudNoise = cloud1.mul(0.5).add(cloud2.mul(0.3)).add(cloud3.mul(0.2));

    // Cloud density variation for unexplored
    const unexploredBase = uUnexploredDarkness;
    const unexploredVariation = float(0.08);
    const unexploredBrightness = unexploredBase.add(cloudNoise.mul(unexploredVariation));

    // Subtle color variation in clouds (dark blues/purples)
    const cloudColor = vec3(
      unexploredBrightness.mul(0.9),
      unexploredBrightness.mul(0.95),
      unexploredBrightness
    );

    // ============================================
    // HEIGHT-AWARE FOG DENSITY
    // ============================================
    // Fog is denser in low areas, thinner on high ground
    const normalizedHeight = clamp(worldY.div(20.0), 0.0, 1.0); // Assume max height ~20
    const heightFactor = float(1.0).sub(normalizedHeight.mul(uHeightInfluence));

    // ============================================
    // EXPLORED AREA PROCESSING
    // ============================================
    // Desaturate + darken + cool color shift
    const luminance = dot(sceneColor, vec3(0.299, 0.587, 0.114));
    const desaturatedColor = mix(sceneColor, vec3(luminance), uDesaturation);
    const exploredColor = desaturatedColor.mul(uExploredDarkness).mul(uCoolShift);

    // ============================================
    // COMPOSITE FINAL COLOR
    // ============================================
    // Start with scene color for visible areas
    let finalColor = sceneColor.toVar();

    // Apply explored effect (desaturation + darkening)
    const exploredAmount = isExplored.mul(float(1.0).sub(isVisible));
    finalColor.assign(mix(finalColor, exploredColor, exploredAmount.mul(heightFactor)));

    // Apply unexplored effect (cloud overlay)
    finalColor.assign(mix(finalColor, cloudColor, isUnexplored.mul(heightFactor)));

    // Add rim glow at visibility edges
    const rimContribution = uRimColor.mul(rimGlow).mul(isVisible);
    finalColor.addAssign(rimContribution);

    // DEBUG: Show world position as color to verify reconstruction
    // Red = X position, Blue = Z position (normalized to map dimensions)
    const debugWorldColor = vec3(
      clamp(worldX.div(uMapDimensions.x), 0.0, 1.0),
      float(0.2),
      clamp(worldZ.div(uMapDimensions.y), 0.0, 1.0)
    );

    // Apply fog effect only if vision texture is bound
    // If no vision texture, show debug world position colors
    const hasTexture = uHasVisionTexture.greaterThan(0.5);
    const fogResult = mix(sceneColor, finalColor, uEnabled);
    const debugResult = mix(sceneColor, debugWorldColor, float(0.5));
    result.assign(hasTexture.select(fogResult, debugResult));

    return vec4(result, float(1.0));
  });

  // ============================================
  // PUBLIC API
  // ============================================
  const uniforms = {
    enabled: uEnabled,
    time: uTime,
    quality: uQuality,
    edgeBlurRadius: uEdgeBlurRadius,
    desaturation: uDesaturation,
    exploredDarkness: uExploredDarkness,
    unexploredDarkness: uUnexploredDarkness,
    cloudSpeed: uCloudSpeed,
    cloudScale: uCloudScale,
    rimIntensity: uRimIntensity,
    rimColor: uRimColor,
    heightInfluence: uHeightInfluence,
    coolShift: uCoolShift,
    mapDimensions: uMapDimensions,
    gridDimensions: uGridDimensions,
    cellSize: uCellSize,
  };

  const setVisionTexture = (tex: THREE.Texture | null) => {
    if (tex) {
      // Update the TextureNode's internal texture reference
      // In TSL, TextureNode.value holds the THREE.Texture
      (visionTextureNode as any).value = tex;
      uHasVisionTexture.value = 1.0;

      // Update grid dimensions from texture
      if (tex.image) {
        uGridDimensions.value.set(tex.image.width || 128, tex.image.height || 128);
      }
    } else {
      (visionTextureNode as any).value = placeholderTexture;
      uHasVisionTexture.value = 0.0;
    }
  };

  const setEnabled = (enabled: boolean) => {
    uEnabled.value = enabled ? 1.0 : 0.0;
  };

  const updateTime = (t: number) => {
    uTime.value = t;
  };

  const updateCamera = (cam: THREE.PerspectiveCamera) => {
    // Update camera parameters for world position reconstruction
    uCameraNear.value = cam.near;
    uCameraFar.value = cam.far;
    // Inverse projection for clip->view transform (using our own uniform, not built-in jittered one)
    uInverseProjection.value.copy(cam.projectionMatrixInverse);
    // Camera world matrix transforms view-space to world-space
    uCameraWorldMatrix.value.copy(cam.matrixWorld);
  };

  const applyConfig = (config: Partial<FogOfWarConfig>) => {
    if (config.quality !== undefined) {
      const qualityIndex = ['low', 'medium', 'high', 'ultra'].indexOf(config.quality);
      uQuality.value = qualityIndex >= 0 ? qualityIndex : 2;
    }
    if (config.edgeBlurRadius !== undefined) {
      uEdgeBlurRadius.value = config.edgeBlurRadius;
    }
    if (config.desaturation !== undefined) {
      uDesaturation.value = config.desaturation;
    }
    if (config.exploredDarkness !== undefined) {
      uExploredDarkness.value = config.exploredDarkness;
    }
    if (config.unexploredDarkness !== undefined) {
      uUnexploredDarkness.value = config.unexploredDarkness;
    }
    if (config.cloudSpeed !== undefined) {
      uCloudSpeed.value = config.cloudSpeed;
    }
    if (config.cloudScale !== undefined) {
      uCloudScale.value = config.cloudScale;
    }
    if (config.rimIntensity !== undefined) {
      uRimIntensity.value = config.rimIntensity;
    }
    if (config.rimColor !== undefined) {
      uRimColor.value.copy(config.rimColor);
    }
    if (config.heightInfluence !== undefined) {
      uHeightInfluence.value = config.heightInfluence;
    }
    if (config.coolShift !== undefined) {
      uCoolShift.value.copy(config.coolShift);
    }
  };

  return {
    node: fogOfWarNode(),
    uniforms,
    setVisionTexture,
    setEnabled,
    updateTime,
    updateCamera,
    applyConfig,
  };
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

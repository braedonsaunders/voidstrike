/**
 * TSL Post-Processing Pipeline - AAA Quality
 *
 * DUAL-PIPELINE ARCHITECTURE:
 * ===========================
 * This implements the AAA game approach to TAA + FSR/upscaling:
 *
 * 1. INTERNAL PIPELINE (render resolution):
 *    - Scene renders to explicit RenderTarget at render resolution
 *    - All effects (GTAO, SSR, SSGI, Bloom, TAA) operate at render resolution
 *    - TAA has matching depth buffers - no resolution mismatch errors
 *
 * 2. DISPLAY PIPELINE (display resolution):
 *    - Takes internal pipeline output texture
 *    - EASU upscales to display resolution
 *    - Outputs to canvas
 *
 * TONE MAPPING ARCHITECTURE (AAA Standard):
 * =========================================
 * - Renderer.toneMapping = NoToneMapping (disabled)
 * - All tone mapping handled in PostProcessing color grading pass
 * - Uses ACES Filmic tone mapping for cinematic look
 * - This prevents double-application of tone mapping/exposure
 *
 * This architecture ensures:
 * - No WebGPU depth texture copy errors (all depths match)
 * - Correct TAA jitter at render resolution
 * - Clean separation between internal rendering and display
 * - Proper HDR workflow with single tone mapping pass
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
  Fn,
  mix,
  smoothstep,
  clamp,
  length,
  dot,
  min,
  max,
  texture,
  mrt,
  output,
  normalView,
} from 'three/tsl';
// Access TSL exports that lack TypeScript declarations
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as TSL from 'three/tsl';
const materialMetalness = (TSL as any).materialMetalness;
const materialRoughness = (TSL as any).materialRoughness;

// Import WebGPU post-processing nodes from addons
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
// @ts-expect-error - Three.js addon lacks TypeScript declarations
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';

// Import EASU upscaling
import { easuUpscale } from './UpscalerNode';

// Import custom instanced velocity node
import { createInstancedVelocityNode } from './InstancedVelocity';

// ============================================
// WARNING SUPPRESSION
// ============================================

// Suppress Three.js AttributeNode warnings for missing velocity attributes
// Non-instanced meshes and static meshes don't have these attributes - they get zero velocity
const originalWarn = console.warn;
const suppressedWarnings = [
  'Vertex attribute "normal" not found',
  'Vertex attribute "currInstanceMatrix0" not found',
  'Vertex attribute "currInstanceMatrix1" not found',
  'Vertex attribute "currInstanceMatrix2" not found',
  'Vertex attribute "currInstanceMatrix3" not found',
  'Vertex attribute "prevInstanceMatrix0" not found',
  'Vertex attribute "prevInstanceMatrix1" not found',
  'Vertex attribute "prevInstanceMatrix2" not found',
  'Vertex attribute "prevInstanceMatrix3" not found',
];

function suppressAttributeWarnings(): void {
  console.warn = (...args: unknown[]) => {
    const message = args[0];
    if (typeof message === 'string') {
      for (const suppressed of suppressedWarnings) {
        if (message.includes(suppressed)) {
          return;
        }
      }
    }
    originalWarn.apply(console, args);
  };
}

suppressAttributeWarnings();

// ============================================
// POST-PROCESSING CONFIGURATION
// ============================================

// Anti-aliasing mode
export type AntiAliasingMode = 'off' | 'fxaa' | 'taa';

// Upscaling mode
export type UpscalingMode = 'off' | 'easu' | 'bilinear';

export interface PostProcessingConfig {
  // Bloom
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;

  // GTAO (Ground Truth Ambient Occlusion)
  aoEnabled: boolean;
  aoRadius: number;
  aoIntensity: number;

  // SSR (Screen Space Reflections)
  ssrEnabled: boolean;
  ssrMaxDistance: number;    // Max reflection distance
  ssrOpacity: number;        // Reflection intensity (0-1)
  ssrThickness: number;      // Ray thickness for hit detection
  ssrMaxRoughness: number;   // Max roughness for reflections (0-1)

  // SSGI (Screen Space Global Illumination)
  // Provides indirect lighting (light bouncing) + built-in AO
  // When enabled, replaces GTAO with SSGI's integrated AO
  ssgiEnabled: boolean;
  ssgiRadius: number;        // Sampling radius in world space (1-25)
  ssgiIntensity: number;     // GI intensity (0-100)
  ssgiThickness: number;     // Object thickness for light passing (0.01-10)

  // Anti-aliasing mode ('off', 'fxaa', 'taa')
  antiAliasingMode: AntiAliasingMode;

  // FXAA (legacy, derived from antiAliasingMode)
  fxaaEnabled: boolean;

  // TAA/TRAA settings
  taaEnabled: boolean;
  taaHistoryBlendRate: number; // Not used by TRAA but kept for UI compatibility
  taaSharpeningEnabled: boolean;
  taaSharpeningIntensity: number;

  // Resolution upscaling (EASU - Edge-Adaptive Spatial Upsampling)
  upscalingMode: UpscalingMode;
  renderScale: number; // 0.5 - 1.0, internal render resolution
  easuSharpness: number; // 0.0 - 1.0, edge enhancement strength

  // Vignette
  vignetteEnabled: boolean;
  vignetteIntensity: number;

  // Color grading
  exposure: number;
  saturation: number;
  contrast: number;
}

const DEFAULT_CONFIG: PostProcessingConfig = {
  bloomEnabled: true,
  bloomStrength: 0.3,
  bloomRadius: 0.5,
  bloomThreshold: 0.8,

  aoEnabled: true,
  aoRadius: 2,
  aoIntensity: 0.8,

  ssrEnabled: false,
  ssrMaxDistance: 100,
  ssrOpacity: 1.0,
  ssrThickness: 0.1,
  ssrMaxRoughness: 0.5,

  ssgiEnabled: false,
  ssgiRadius: 8,
  ssgiIntensity: 15,
  ssgiThickness: 1,

  antiAliasingMode: 'fxaa',
  fxaaEnabled: true,
  taaEnabled: false,
  taaHistoryBlendRate: 0.1,
  taaSharpeningEnabled: true,
  taaSharpeningIntensity: 0.5,

  upscalingMode: 'off',
  renderScale: 1.0,
  easuSharpness: 0.5,

  vignetteEnabled: true,
  vignetteIntensity: 0.25,

  exposure: 1.0,
  saturation: 0.8,
  contrast: 1.05,
};

// ============================================
// RENDER PIPELINE CLASS - DUAL PIPELINE
// ============================================

export class RenderPipeline {
  private renderer: WebGPURenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private config: PostProcessingConfig;

  // ========== INTERNAL PIPELINE (render resolution) ==========
  // This pipeline runs entirely at render resolution
  // Outputs to internalRenderTarget (NOT the canvas)
  private internalPostProcessing: PostProcessing | null = null;

  // Explicit RenderTarget to capture internal pipeline output
  // This is what the display pipeline samples from
  private internalRenderTarget: THREE.RenderTarget | null = null;

  // ========== DISPLAY PIPELINE (display resolution) ==========
  // This pipeline upscales from internalRenderTarget to canvas
  private displayPostProcessing: PostProcessing | null = null;

  // Effect passes (on internal pipeline)
  private bloomPass: ReturnType<typeof bloom> | null = null;
  private aoPass: ReturnType<typeof ao> | null = null;
  private ssrPass: ReturnType<typeof ssr> | null = null;
  private ssgiPass: any | null = null;
  private fxaaPass: ReturnType<typeof fxaa> | null = null;
  private traaPass: ReturnType<typeof traa> | null = null;

  // EASU upscaling pass (on display pipeline)
  private easuPass: ReturnType<typeof easuUpscale> | null = null;

  // Uniforms for dynamic updates
  private uVignetteIntensity = uniform(0.25);
  private uAOIntensity = uniform(1.0);
  private uExposure = uniform(1.0);
  private uSaturation = uniform(0.8);
  private uContrast = uniform(1.05);
  private uSharpeningIntensity = uniform(0.5);
  private uResolution = uniform(new THREE.Vector2(1920, 1080));

  // SSR uniforms
  private uSSROpacity = uniform(1.0);
  private uSSRMaxRoughness = uniform(0.5);

  // Resolution tracking
  private displayWidth = 1920;
  private displayHeight = 1080;
  private renderWidth = 1920;
  private renderHeight = 1080;

  constructor(
    renderer: WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    config: Partial<PostProcessingConfig> = {}
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Get initial display resolution from renderer
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    this.displayWidth = Math.max(1, size.x);
    this.displayHeight = Math.max(1, size.y);
    this.uResolution.value.set(this.displayWidth, this.displayHeight);

    // Calculate render resolution based on upscaling config
    const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;
    const effectiveScale = useUpscaling ? this.config.renderScale : 1.0;
    this.renderWidth = Math.floor(this.displayWidth * effectiveScale);
    this.renderHeight = Math.floor(this.displayHeight * effectiveScale);

    this.createDualPipeline();
    this.applyConfig(this.config);
  }

  /**
   * Create the dual-pipeline architecture
   *
   * INTERNAL PIPELINE: Runs at render resolution
   * - Renderer is set to render resolution during creation
   * - All buffers (scene, effects, TAA) are at render resolution
   * - No resolution mismatches
   *
   * DISPLAY PIPELINE: Runs at display resolution
   * - Takes internal output and upscales via EASU
   * - Outputs to canvas
   */
  private createDualPipeline(): void {
    const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;

    if (useUpscaling) {
      // ========== DUAL PIPELINE MODE ==========
      // Save original display size
      const originalSize = new THREE.Vector2();
      this.renderer.getSize(originalSize);

      // Step 1: Create RenderTarget at render resolution
      // This is where the internal pipeline will render to
      // IMPORTANT: Use LinearSRGBColorSpace because the internal pipeline outputs linear HDR data.
      // Using SRGBColorSpace would cause Three.js to apply an unwanted sRGB-to-linear conversion
      // when sampling, resulting in washed out colors (double linearization).
      this.internalRenderTarget = new THREE.RenderTarget(this.renderWidth, this.renderHeight, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.LinearSRGBColorSpace,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });

      // Step 2: Set renderer to RENDER resolution
      // This ensures all PostProcessing internal buffers are created at render resolution
      this.renderer.setSize(this.renderWidth, this.renderHeight, false);

      // Step 3: Create internal pipeline at render resolution
      this.internalPostProcessing = this.createInternalPipeline();

      // Step 4: Restore renderer to DISPLAY resolution
      this.renderer.setSize(originalSize.x, originalSize.y, false);

      // Step 5: Create display pipeline for upscaling
      // This samples from internalRenderTarget.texture
      this.displayPostProcessing = this.createDisplayPipeline();
    } else {
      // ========== SINGLE PIPELINE MODE (no upscaling) ==========
      // Everything runs at native display resolution
      this.internalPostProcessing = this.createInternalPipeline();
      this.displayPostProcessing = null;
      this.internalRenderTarget = null;
    }
  }

  /**
   * Create the internal pipeline (runs at render resolution)
   * Contains: Scene + Effects + TAA
   */
  private createInternalPipeline(): PostProcessing {
    const postProcessing = new PostProcessing(this.renderer);

    // Create scene pass - NO resolution scale, we're already at render resolution
    const scenePass = pass(this.scene, this.camera);

    // Enable MRT with velocity for TRAA and optionally normals/metalrough for SSR/SSGI
    const needsNormals = this.config.ssrEnabled || this.config.ssgiEnabled;
    const needsVelocity = this.config.taaEnabled || this.config.ssgiEnabled;

    if (needsNormals || needsVelocity) {
      const customVelocity = createInstancedVelocityNode();

      if (needsNormals) {
        // SSR/SSGI need normals and metalness/roughness per pixel
        // Pack metalness and roughness into a vec2 for bandwidth optimization
        // materialMetalness/materialRoughness include texture maps (metalness * metalnessMap, etc.)
        // IMPORTANT: Use inline math for normal encoding instead of directionToColor()
        // directionToColor() returns a Fn node which doesn't have .sample() method
        // SSR/SSGI need texture nodes that support .sample() for ray marching
        scenePass.setMRT(mrt({
          output: output,
          normal: normalView().mul(0.5).add(0.5),
          metalrough: vec2(materialMetalness, materialRoughness),
          velocity: customVelocity,
        }));

        // Optimize texture precision - metalrough doesn't need full float precision
        const metalRoughTexture = scenePass.getTexture('metalrough');
        if (metalRoughTexture) {
          metalRoughTexture.type = THREE.UnsignedByteType;
        }
      } else {
        // Just velocity for TRAA
        scenePass.setMRT(mrt({
          output: output,
          velocity: customVelocity,
        }));
      }
    }

    // Get texture nodes from scene pass
    const scenePassColor = scenePass.getTextureNode();
    const scenePassDepth = scenePass.getTextureNode('depth');

    // Build the effect chain - ALL at render resolution
    let outputNode: any = scenePassColor;

    // 1. SSGI (Screen Space Global Illumination)
    if (this.config.ssgiEnabled) {
      try {
        // IMPORTANT: Pass the raw encoded normal texture - DO NOT use colorToDirection()
        // SSR/SSGI need texture nodes with .sample() method
        // colorToDirection() returns a Fn node which doesn't have .sample()
        const scenePassNormal = scenePass.getTextureNode('normal');

        this.ssgiPass = (ssgi as any)(
          scenePassColor,
          scenePassDepth,
          scenePassNormal,  // Raw texture node, not decoded
          this.camera
        );

        if (this.ssgiPass) {
          this.ssgiPass.sliceCount.value = 1;
          this.ssgiPass.stepCount.value = 12;
          this.ssgiPass.radius.value = this.config.ssgiRadius;
          this.ssgiPass.giIntensity.value = this.config.ssgiIntensity;
          this.ssgiPass.thickness.value = this.config.ssgiThickness;
          this.ssgiPass.aoIntensity.value = this.config.aoIntensity;
          this.ssgiPass.useTemporalFiltering = this.config.taaEnabled;
        }

        const ssgiResult = this.ssgiPass.getTextureNode();
        const giColor = ssgiResult.rgb;
        const aoValue = ssgiResult.a;
        outputNode = outputNode.mul(aoValue).add(giColor);
      } catch (e) {
        console.warn('[PostProcessing] SSGI initialization failed:', e);
      }
    }

    // 2. GTAO Ambient Occlusion (skip if SSGI enabled)
    if (this.config.aoEnabled && !this.config.ssgiEnabled) {
      try {
        this.aoPass = ao(scenePassDepth, null, this.camera);
        this.aoPass.radius.value = this.config.aoRadius;

        const aoValue = this.aoPass.getTextureNode().r;
        const aoFactor = mix(float(1.0), aoValue, this.uAOIntensity);
        outputNode = scenePassColor.mul(vec3(aoFactor));
      } catch (e) {
        console.warn('[PostProcessing] GTAO initialization failed:', e);
      }
    }

    // 3. SSR (Screen Space Reflections)
    // Uses per-pixel metalness/roughness from G-buffer for accurate reflections
    if (this.config.ssrEnabled) {
      try {
        // Get MRT textures - normals and metalness/roughness per pixel
        const scenePassNormal = scenePass.getTextureNode('normal');
        const scenePassMetalRough = scenePass.getTextureNode('metalrough');

        // SSR uses per-pixel metalness (R) and roughness (G) from the G-buffer
        // This ensures reflections only appear on metallic surfaces with appropriate roughness
        this.ssrPass = (ssr as any)(
          scenePassColor,
          scenePassDepth,
          scenePassNormal,
          scenePassMetalRough.r,  // Per-pixel metalness from material
          scenePassMetalRough.g,  // Per-pixel roughness from material
          this.camera
        );

        if (this.ssrPass?.maxDistance) {
          this.ssrPass.maxDistance.value = this.config.ssrMaxDistance;
        }
        if (this.ssrPass?.opacity) {
          this.ssrPass.opacity.value = this.config.ssrOpacity;
        }
        if (this.ssrPass?.thickness) {
          this.ssrPass.thickness.value = this.config.ssrThickness;
        }

        if (this.ssrPass) {
          const ssrTexture = this.ssrPass.getTextureNode();
          const ssrColor = ssrTexture.rgb;
          const ssrAlpha = ssrTexture.a;
          outputNode = outputNode.add(ssrColor.mul(ssrAlpha));
        }
      } catch (e) {
        console.warn('[PostProcessing] SSR initialization failed:', e);
      }
    }

    // 4. Bloom
    if (this.config.bloomEnabled) {
      try {
        this.bloomPass = bloom(outputNode);
        this.bloomPass.threshold.value = this.config.bloomThreshold;
        this.bloomPass.strength.value = this.config.bloomStrength;
        this.bloomPass.radius.value = this.config.bloomRadius;
        outputNode = outputNode.add(this.bloomPass);
      } catch (e) {
        console.warn('[PostProcessing] Bloom initialization failed:', e);
      }
    }

    // 5. Color grading and vignette
    try {
      outputNode = this.createColorGradingPass(outputNode);
    } catch (e) {
      console.warn('[PostProcessing] Color grading failed:', e);
    }

    // 6. Anti-aliasing (TRAA or FXAA)
    if (this.config.antiAliasingMode === 'taa' && this.config.taaEnabled) {
      try {
        const scenePassVelocity = scenePass.getTextureNode('velocity');

        // TRAA is created with renderer at render resolution
        // All internal buffers (depth, history) match scene pass resolution
        // NO depth copy errors because resolutions match!
        this.traaPass = traa(outputNode, scenePassDepth, scenePassVelocity, this.camera);

        const traaTexture = this.traaPass.getTextureNode();

        // Apply sharpening if not upscaling (EASU has its own edge enhancement)
        const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;
        if (!useUpscaling && this.config.taaSharpeningEnabled) {
          outputNode = this.createSharpeningPass(traaTexture);
        } else {
          outputNode = traaTexture;
        }
      } catch (e) {
        console.warn('[PostProcessing] TRAA initialization failed, falling back to FXAA:', e);
        try {
          this.fxaaPass = fxaa(outputNode);
          outputNode = this.fxaaPass;
        } catch (fxaaError) {
          console.warn('[PostProcessing] FXAA fallback also failed:', fxaaError);
        }
      }
    } else if (this.config.antiAliasingMode === 'fxaa' || this.config.fxaaEnabled) {
      try {
        this.fxaaPass = fxaa(outputNode);
        outputNode = this.fxaaPass;
      } catch (e) {
        console.warn('[PostProcessing] FXAA initialization failed:', e);
      }
    }

    postProcessing.outputNode = outputNode;
    return postProcessing;
  }

  /**
   * Create the display pipeline (runs at display resolution)
   * Contains: EASU upscaling only
   * Samples from internalRenderTarget.texture
   */
  private createDisplayPipeline(): PostProcessing {
    const postProcessing = new PostProcessing(this.renderer);

    // Get the render target texture as a TSL node
    if (!this.internalRenderTarget) {
      console.error('[PostProcessing] No internal render target for display pipeline');
      postProcessing.outputNode = vec4(1, 0, 1, 1); // Magenta error color
      return postProcessing;
    }

    // Create TSL texture node from the render target
    const inputTexture = texture(this.internalRenderTarget.texture);

    let outputNode: any;

    // Apply EASU upscaling
    if (this.config.upscalingMode === 'easu') {
      try {
        const renderRes = new THREE.Vector2(this.renderWidth, this.renderHeight);
        const displayRes = new THREE.Vector2(this.displayWidth, this.displayHeight);

        this.easuPass = easuUpscale(inputTexture, renderRes, displayRes, this.config.easuSharpness);
        outputNode = this.easuPass.node;
      } catch (e) {
        console.warn('[PostProcessing] EASU upscaling failed, using bilinear:', e);
        // Fallback: just sample the texture (GPU does bilinear)
        outputNode = inputTexture;
      }
    } else {
      // Bilinear upscaling (GPU default when sampling smaller texture)
      outputNode = inputTexture;
    }

    postProcessing.outputNode = outputNode;
    return postProcessing;
  }

  /**
   * Create RCAS-style sharpening pass
   */
  private createSharpeningPass(inputNode: any): any {
    return Fn(() => {
      const fragUV = uv();
      const texelSize = vec2(1.0).div(this.uResolution);

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
        center.mul(4.0).sub(neighbors).mul(this.uSharpeningIntensity).mul(rcpM)
      );

      const result = clamp(sharpenedColor, minRGB, maxRGB);
      return vec4(result, 1.0);
    })();
  }

  /**
   * ACES Filmic Tone Mapping (Narkowicz 2015 approximation)
   *
   * This is the industry standard for cinematic color grading.
   * It provides smooth highlight rolloff and rich shadows.
   *
   * The curve: (x * (2.51x + 0.03)) / (x * (2.43x + 0.59) + 0.14)
   */
  private acesToneMap(color: any): any {
    const a = 2.51;
    const b = 0.03;
    const c = 2.43;
    const d = 0.59;
    const e = 0.14;

    // ACES curve applied per-channel
    return clamp(
      color.mul(color.mul(a).add(b)).div(color.mul(color.mul(c).add(d)).add(e)),
      0.0,
      1.0
    );
  }

  private createColorGradingPass(inputNode: any): any {
    return Fn(() => {
      let color = vec3(inputNode).toVar();

      // Apply exposure in linear HDR space (before tone mapping)
      color.mulAssign(this.uExposure);

      // Apply saturation in linear space
      const luminance = dot(color, vec3(0.299, 0.587, 0.114));
      color.assign(mix(vec3(luminance), color, this.uSaturation));

      // Apply contrast in linear space (around mid-gray)
      // Use 0.18 as mid-gray (18% gray is standard photographic mid-tone)
      const midGray = 0.18;
      color.assign(color.sub(midGray).mul(this.uContrast).add(midGray));

      // Ensure no negative values before tone mapping
      color.assign(max(color, vec3(0.0)));

      // Apply ACES Filmic tone mapping
      // This converts HDR linear to SDR with cinematic highlight rolloff
      color.assign(this.acesToneMap(color));

      // Apply vignette after tone mapping (in display space)
      if (this.config.vignetteEnabled) {
        const uvCentered = uv().sub(0.5);
        const dist = length(uvCentered).mul(2.0);
        const vignetteFactor = smoothstep(float(1.4), float(0.5), dist);
        const vignetteAmount = mix(float(1.0).sub(this.uVignetteIntensity), float(1.0), vignetteFactor);
        color.mulAssign(vignetteAmount);
      }

      return vec4(color, 1.0);
    })();
  }

  /**
   * Rebuild the pipeline when effects are toggled
   */
  rebuild(): void {
    // Dispose old passes
    if (this.traaPass) {
      this.traaPass.dispose();
      this.traaPass = null;
    }

    // Dispose old render target
    if (this.internalRenderTarget) {
      this.internalRenderTarget.dispose();
      this.internalRenderTarget = null;
    }

    // Clear all pass references
    this.bloomPass = null;
    this.aoPass = null;
    this.ssrPass = null;
    this.ssgiPass = null;
    this.fxaaPass = null;
    this.easuPass = null;

    // Recreate dual pipeline
    this.createDualPipeline();
  }

  /**
   * Apply configuration to uniforms and passes
   */
  applyConfig(config: Partial<PostProcessingConfig>): void {
    const needsRebuild =
      (config.bloomEnabled !== undefined && config.bloomEnabled !== this.config.bloomEnabled) ||
      (config.aoEnabled !== undefined && config.aoEnabled !== this.config.aoEnabled) ||
      (config.ssrEnabled !== undefined && config.ssrEnabled !== this.config.ssrEnabled) ||
      (config.ssgiEnabled !== undefined && config.ssgiEnabled !== this.config.ssgiEnabled) ||
      (config.fxaaEnabled !== undefined && config.fxaaEnabled !== this.config.fxaaEnabled) ||
      (config.taaEnabled !== undefined && config.taaEnabled !== this.config.taaEnabled) ||
      (config.antiAliasingMode !== undefined && config.antiAliasingMode !== this.config.antiAliasingMode) ||
      (config.taaSharpeningEnabled !== undefined && config.taaSharpeningEnabled !== this.config.taaSharpeningEnabled) ||
      (config.vignetteEnabled !== undefined && config.vignetteEnabled !== this.config.vignetteEnabled) ||
      (config.upscalingMode !== undefined && config.upscalingMode !== this.config.upscalingMode) ||
      (config.renderScale !== undefined && config.renderScale !== this.config.renderScale);

    this.config = { ...this.config, ...config };

    // Sync derived AA flags from mode
    if (config.antiAliasingMode !== undefined) {
      this.config.fxaaEnabled = config.antiAliasingMode === 'fxaa';
      this.config.taaEnabled = config.antiAliasingMode === 'taa';
    }

    // Update render resolution
    const effectiveScale = this.config.upscalingMode !== 'off' ? this.config.renderScale : 1.0;
    this.renderWidth = Math.floor(this.displayWidth * effectiveScale);
    this.renderHeight = Math.floor(this.displayHeight * effectiveScale);

    // Update bloom parameters
    if (this.bloomPass) {
      this.bloomPass.threshold.value = this.config.bloomThreshold;
      this.bloomPass.strength.value = this.config.bloomStrength;
      this.bloomPass.radius.value = this.config.bloomRadius;
    }

    // Update SSAO parameters
    if (this.aoPass) {
      this.aoPass.radius.value = this.config.aoRadius;
    }
    this.uAOIntensity.value = this.config.aoIntensity;

    // Update SSR parameters
    if (this.ssrPass) {
      if (this.ssrPass.maxDistance) {
        this.ssrPass.maxDistance.value = this.config.ssrMaxDistance;
      }
      if (this.ssrPass.opacity) {
        this.ssrPass.opacity.value = this.config.ssrOpacity;
      }
      if (this.ssrPass.thickness) {
        this.ssrPass.thickness.value = this.config.ssrThickness;
      }
    }
    this.uSSRMaxRoughness.value = this.config.ssrMaxRoughness;

    // Update SSGI parameters
    if (this.ssgiPass) {
      this.ssgiPass.radius.value = this.config.ssgiRadius;
      this.ssgiPass.giIntensity.value = this.config.ssgiIntensity;
      this.ssgiPass.thickness.value = this.config.ssgiThickness;
      this.ssgiPass.aoIntensity.value = this.config.aoIntensity;
    }

    // Update sharpening parameters
    this.uSharpeningIntensity.value = this.config.taaSharpeningIntensity;

    // Update EASU parameters
    if (this.easuPass) {
      this.easuPass.setSharpness(this.config.easuSharpness);
      this.easuPass.setRenderResolution(this.renderWidth, this.renderHeight);
    }

    // Update color grading uniforms
    this.uVignetteIntensity.value = this.config.vignetteIntensity;
    this.uExposure.value = this.config.exposure;
    this.uSaturation.value = this.config.saturation;
    this.uContrast.value = this.config.contrast;

    // Rebuild pipeline if effect toggles changed
    if (needsRebuild) {
      this.rebuild();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): PostProcessingConfig {
    return { ...this.config };
  }

  /**
   * Update camera reference
   */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.rebuild();
  }

  /**
   * Set display size
   */
  setSize(width: number, height: number): void {
    const currentSize = this.uResolution.value;
    if (currentSize.x !== width || currentSize.y !== height) {
      this.displayWidth = width;
      this.displayHeight = height;
      this.uResolution.value.set(width, height);

      // Recalculate render resolution
      const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;
      const effectiveScale = useUpscaling ? this.config.renderScale : 1.0;
      this.renderWidth = Math.floor(width * effectiveScale);
      this.renderHeight = Math.floor(height * effectiveScale);

      // Must rebuild to recreate pipelines at new sizes
      this.rebuild();
    }
  }

  // ========== Status methods ==========
  isSSREnabled(): boolean { return this.config.ssrEnabled; }
  isTAAEnabled(): boolean { return this.config.taaEnabled && this.config.antiAliasingMode === 'taa'; }
  isSSGIEnabled(): boolean { return this.config.ssgiEnabled; }
  getAntiAliasingMode(): AntiAliasingMode { return this.config.antiAliasingMode; }
  isUpscalingEnabled(): boolean { return this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0; }
  getUpscalingMode(): UpscalingMode { return this.config.upscalingMode; }
  getRenderScale(): number { return this.config.renderScale; }
  getRenderScalePercent(): number { return Math.round(this.config.renderScale * 100); }
  getRenderResolution(): { width: number; height: number } { return { width: this.renderWidth, height: this.renderHeight }; }
  getDisplayResolution(): { width: number; height: number } { return { width: this.displayWidth, height: this.displayHeight }; }

  /**
   * Render the scene with post-processing
   *
   * DUAL PIPELINE RENDER ORDER:
   * 1. If upscaling: render internal pipeline to RenderTarget, then display pipeline to canvas
   * 2. If no upscaling: render internal pipeline directly to canvas
   *
   * COLOR SPACE HANDLING:
   * - Internal pipeline outputs linear HDR data
   * - ACES tone mapping converts to display-referred (gamma-corrected) SDR
   * - We set outputColorSpace = LinearSRGBColorSpace during internal render to prevent
   *   the renderer from applying ANOTHER gamma conversion (which caused washed out colors)
   * - Display pipeline samples the linear-stored data and outputs to canvas
   */
  render(): void {
    const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;

    if (useUpscaling && this.displayPostProcessing && this.internalRenderTarget) {
      // Dual pipeline mode:
      const originalSize = new THREE.Vector2();
      this.renderer.getSize(originalSize);

      // Save original color space setting
      const originalColorSpace = this.renderer.outputColorSpace;

      // Step 1: Set renderer to render resolution and LINEAR color space
      // IMPORTANT: Use LinearSRGBColorSpace to prevent double gamma correction.
      // Our ACES tone mapping already outputs display-referred values.
      // If renderer.outputColorSpace = SRGBColorSpace, it would apply ANOTHER
      // gamma conversion, causing washed out colors.
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      this.renderer.setSize(this.renderWidth, this.renderHeight, false);
      (this.renderer as any).setRenderTarget(this.internalRenderTarget);
      this.internalPostProcessing?.render();

      // Step 2: Restore to display resolution and render to canvas
      // Restore sRGB color space for canvas output (browser expects sRGB)
      (this.renderer as any).setRenderTarget(null);
      this.renderer.outputColorSpace = originalColorSpace;
      this.renderer.setSize(originalSize.x, originalSize.y, false);
      this.displayPostProcessing.render();
    } else {
      // Single pipeline mode: just render internal to canvas
      this.internalPostProcessing?.render();
    }
  }

  /**
   * Async render
   */
  async renderAsync(): Promise<void> {
    const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;

    if (useUpscaling && this.displayPostProcessing && this.internalRenderTarget) {
      const originalSize = new THREE.Vector2();
      this.renderer.getSize(originalSize);

      // Save and set linear color space (same as sync render)
      const originalColorSpace = this.renderer.outputColorSpace;
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

      this.renderer.setSize(this.renderWidth, this.renderHeight, false);
      (this.renderer as any).setRenderTarget(this.internalRenderTarget);
      await this.internalPostProcessing?.renderAsync();

      (this.renderer as any).setRenderTarget(null);
      this.renderer.outputColorSpace = originalColorSpace;
      this.renderer.setSize(originalSize.x, originalSize.y, false);
      await this.displayPostProcessing.renderAsync();
    } else {
      await this.internalPostProcessing?.renderAsync();
    }
  }

  /**
   * Get the PostProcessing instance for direct access
   */
  getPostProcessing(): PostProcessing {
    // Return display pipeline if upscaling, otherwise internal
    return this.displayPostProcessing || this.internalPostProcessing!;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.traaPass) {
      this.traaPass.dispose();
      this.traaPass = null;
    }
    if (this.internalRenderTarget) {
      this.internalRenderTarget.dispose();
      this.internalRenderTarget = null;
    }
  }
}

// ============================================
// SIMPLE POST-PROCESSING (NO EFFECTS)
// ============================================

export function createSimplePostProcessing(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): PostProcessing {
  const postProcessing = new PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  postProcessing.outputNode = scenePass.getTextureNode();
  return postProcessing;
}

// ============================================
// SCREEN SHAKE EFFECT
// ============================================

export class ScreenShake {
  private camera: THREE.Camera;
  private originalPosition: THREE.Vector3;
  private shakeIntensity = 0;
  private shakeDuration = 0;
  private shakeTime = 0;

  constructor(camera: THREE.Camera) {
    this.camera = camera;
    this.originalPosition = camera.position.clone();
  }

  shake(intensity: number, duration: number): void {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeTime = 0;
    this.originalPosition.copy(this.camera.position);
  }

  update(deltaTime: number): void {
    if (this.shakeTime < this.shakeDuration) {
      this.shakeTime += deltaTime;

      const progress = this.shakeTime / this.shakeDuration;
      const decay = 1 - progress;
      const intensity = this.shakeIntensity * decay;

      const offsetX = (Math.random() - 0.5) * 2 * intensity;
      const offsetY = (Math.random() - 0.5) * 2 * intensity;

      this.camera.position.x = this.originalPosition.x + offsetX;
      this.camera.position.y = this.originalPosition.y + offsetY;
    } else if (this.shakeTime >= this.shakeDuration && this.shakeDuration > 0) {
      this.camera.position.copy(this.originalPosition);
      this.shakeDuration = 0;
    }
  }
}

// ============================================
// DAMAGE VIGNETTE EFFECT
// ============================================

export class DamageVignette {
  private intensity = uniform(0);
  private color = uniform(new THREE.Color(0.8, 0.0, 0.0));

  flash(intensity: number = 0.5): void {
    this.intensity.value = intensity;
  }

  update(deltaTime: number): void {
    if (this.intensity.value > 0) {
      this.intensity.value = Math.max(0, this.intensity.value - deltaTime * 2);
    }
  }

  getNode(): any {
    return Fn(([inputColor]: [any]) => {
      const uvCentered = uv().sub(0.5);
      const dist = length(uvCentered).mul(2.0);
      const vignette = smoothstep(0.3, 1.2, dist);
      const damageColor = mix(inputColor, this.color, vignette.mul(this.intensity));
      return damageColor;
    });
  }
}

/**
 * TSL Post-Processing Pipeline - AAA Quality
 *
 * WebGPU-compatible post-processing using Three.js TSL nodes.
 * Features:
 * - Bloom effect (BloomNode) - HDR glow
 * - GTAO ambient occlusion (GTAONode) - Contact shadows
 * - SSR (Screen Space Reflections) - Real-time reflections
 * - TRAA anti-aliasing (Temporal Reprojection Anti-Aliasing) - High quality temporal smoothing
 * - FXAA anti-aliasing (FXAANode) - Fast edge smoothing (fallback)
 * - Vignette - Cinematic edge darkening
 * - Color grading (exposure, saturation, contrast)
 *
 * IMPORTANT: GTAO requires hardware MSAA to be disabled on the renderer.
 * The WebGPUGameCanvas sets antialias: false when post-processing is enabled.
 * TRAA provides superior anti-aliasing with temporal stability.
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
// directionToColor/colorToDirection for normal encoding in MRT
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as TSL from 'three/tsl';
const directionToColor = (TSL as any).directionToColor;
const colorToDirection = (TSL as any).colorToDirection;

// Import WebGPU post-processing nodes from addons
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
// @ts-expect-error - Three.js addon lacks TypeScript declarations
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';

// Import EASU upscaling
import { easuUpscale, rcasSharpening } from './UpscalerNode';

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

  // PERF: Reduced AO radius from 4 to 2 for better performance
  // GTAO is expensive - disable for low-end devices via graphics settings
  aoEnabled: true,
  aoRadius: 2,
  aoIntensity: 0.8,

  // SSR - Screen Space Reflections for metallic surfaces
  // Disabled by default - enable for high-end devices
  ssrEnabled: false,
  ssrMaxDistance: 100,
  ssrOpacity: 1.0,
  ssrThickness: 0.1,
  ssrMaxRoughness: 0.5,

  // SSGI - Screen Space Global Illumination
  // Provides realistic light bouncing + integrated AO
  // Expensive - disabled by default, enable for high-end devices
  ssgiEnabled: false,
  ssgiRadius: 8,        // World-space sampling radius
  ssgiIntensity: 15,    // GI intensity (subtle by default)
  ssgiThickness: 1,     // Object thickness

  // FXAA is the safe default - works with all materials
  // TRAA requires velocity output from all materials, which standard materials don't support
  antiAliasingMode: 'fxaa',
  fxaaEnabled: true,
  taaEnabled: false,
  taaHistoryBlendRate: 0.1,
  taaSharpeningEnabled: true,
  taaSharpeningIntensity: 0.5,

  // EASU upscaling - disabled by default (native resolution)
  // Enable for performance boost: 0.75 = 75% res = ~1.8x faster
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
// RENDER PIPELINE CLASS
// ============================================

export class RenderPipeline {
  private renderer: WebGPURenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private postProcessing: PostProcessing;
  private config: PostProcessingConfig;

  // Effect passes
  private bloomPass: ReturnType<typeof bloom> | null = null;
  private aoPass: ReturnType<typeof ao> | null = null;
  private ssrPass: ReturnType<typeof ssr> | null = null;
  private ssgiPass: any | null = null;
  private fxaaPass: ReturnType<typeof fxaa> | null = null;
  private traaPass: ReturnType<typeof traa> | null = null;

  // EASU upscaling pass
  private easuPass: ReturnType<typeof easuUpscale> | null = null;

  // Zero-velocity texture for TRAA (used when materials don't output velocity)
  private zeroVelocityTexture: THREE.DataTexture | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private zeroVelocityNode: any = null; // TSL texture node - reused across rebuilds

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

  // Resolution tracking for upscaling
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

    // Get initial resolution
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    this.uResolution.value.set(Math.max(1, size.x), Math.max(1, size.y));

    // Create zero-velocity texture once for TRAA (reused across rebuilds)
    // This avoids MRT issues with materials that don't output velocity
    this.initZeroVelocityTexture();

    this.postProcessing = this.createPipeline();
    this.applyConfig(this.config);
  }

  /**
   * Initialize zero-velocity texture for TRAA
   * Created once and reused to avoid WebGPU texture re-initialization errors
   */
  private initZeroVelocityTexture(): void {
    // Create a 2x2 RGBA texture filled with zeros (velocity = 0)
    const velocityData = new Float32Array([
      0, 0, 0, 0,  // pixel (0,0)
      0, 0, 0, 0,  // pixel (1,0)
      0, 0, 0, 0,  // pixel (0,1)
      0, 0, 0, 0,  // pixel (1,1)
    ]);
    this.zeroVelocityTexture = new THREE.DataTexture(
      velocityData,
      2, 2,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    this.zeroVelocityTexture.minFilter = THREE.NearestFilter;
    this.zeroVelocityTexture.magFilter = THREE.NearestFilter;
    this.zeroVelocityTexture.needsUpdate = true;

    // Create the TSL texture node once - reused across rebuilds
    // This prevents WebGPU "Texture already initialized" errors
    this.zeroVelocityNode = texture(this.zeroVelocityTexture);
  }

  private createPipeline(): PostProcessing {
    const postProcessing = new PostProcessing(this.renderer);

    // Create scene pass
    const scenePass = pass(this.scene, this.camera);

    // Set resolution scale for upscaling - renders scene at lower resolution
    // The PassNode will render at (width * scale, height * scale)
    const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;
    if (useUpscaling) {
      scenePass.setResolutionScale(this.config.renderScale);
    } else {
      // Explicitly set to 1.0 for native resolution to ensure clean state
      scenePass.setResolutionScale(1.0);
    }

    // Enable MRT with velocity for TRAA and optionally normals for SSR/SSGI
    // Using custom velocity node that properly handles InstancedMesh via our prevInstanceMatrix attributes
    // This avoids the jiggling issue caused by Three.js's built-in velocity not tracking per-instance transforms
    const needsNormals = this.config.ssrEnabled || this.config.ssgiEnabled;
    const needsVelocity = this.config.taaEnabled || this.config.ssgiEnabled; // SSGI uses temporal filtering with TAA

    if (needsNormals || needsVelocity) {
      const customVelocity = createInstancedVelocityNode();

      if (needsNormals) {
        // SSR/SSGI need normals
        scenePass.setMRT(mrt({
          output: output,
          normal: directionToColor(normalView),
          velocity: customVelocity,
        }));
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

    // Build the effect chain
    // NOTE: All effects run at render resolution (which may be lower than display if upscaling)
    // Upscaling is applied LAST for maximum performance
    let outputNode: any = scenePassColor;

    // 1. SSGI (Screen Space Global Illumination) - includes AO
    // Provides realistic light bouncing between surfaces
    // SSGI outputs vec4(giColor, ao) - RGB is indirect light, A is occlusion
    if (this.config.ssgiEnabled) {
      try {
        // Get normal texture from MRT and DECODE it
        const scenePassNormalEncoded = scenePass.getTextureNode('normal');
        const scenePassNormal = colorToDirection(scenePassNormalEncoded);

        // Create SSGI pass
        this.ssgiPass = (ssgi as any)(
          scenePassColor,
          scenePassDepth,
          scenePassNormal,
          this.camera
        );

        // Configure SSGI parameters
        if (this.ssgiPass) {
          // Use low quality for performance (sliceCount=1, stepCount=12 with temporal)
          this.ssgiPass.sliceCount.value = 1;
          this.ssgiPass.stepCount.value = 12;
          this.ssgiPass.radius.value = this.config.ssgiRadius;
          this.ssgiPass.giIntensity.value = this.config.ssgiIntensity;
          this.ssgiPass.thickness.value = this.config.ssgiThickness;
          this.ssgiPass.aoIntensity.value = this.config.aoIntensity; // Use AO intensity setting
          this.ssgiPass.useTemporalFiltering = this.config.taaEnabled; // Works best with TAA
        }

        // Apply SSGI: scene * ao + giColor
        const ssgiResult = this.ssgiPass.getTextureNode();
        const giColor = ssgiResult.rgb;
        const aoValue = ssgiResult.a;
        outputNode = outputNode.mul(aoValue).add(giColor);
      } catch (e) {
        console.warn('[PostProcessing] SSGI initialization failed:', e);
      }
    }

    // 3. GTAO Ambient Occlusion (skip if SSGI is enabled - it has built-in AO)
    // IMPORTANT: Requires antialias: false on the renderer to avoid multisampled depth texture issues
    if (this.config.aoEnabled && !this.config.ssgiEnabled) {
      try {
        // Use null for normal node - GTAO will reconstruct normals from depth
        this.aoPass = ao(scenePassDepth, null, this.camera);
        this.aoPass.radius.value = this.config.aoRadius;

        // Apply AO as darkening factor
        // IMPORTANT: GTAONode stores AO only in the RED channel (.r) for optimization
        // See: https://threejs.org/docs/pages/GTAONode.html
        const aoValue = this.aoPass.getTextureNode().r; // Only use red channel!
        const aoFactor = mix(float(1.0), aoValue, this.uAOIntensity);
        outputNode = scenePassColor.mul(vec3(aoFactor));
      } catch (e) {
        console.warn('[PostProcessing] GTAO initialization failed, skipping AO:', e);
      }
    }

    // 3. SSR (Screen Space Reflections)
    // Applied after AO, before bloom - reflections are ADDED to scene
    // SSR outputs vec4(reflectionColor, opacity) - must blend with scene
    if (this.config.ssrEnabled) {
      try {
        // Get normal texture from MRT and DECODE it
        // We encoded with directionToColor (dir*0.5+0.5), so decode with colorToDirection
        const scenePassNormalEncoded = scenePass.getTextureNode('normal');
        const scenePassNormal = colorToDirection(scenePassNormalEncoded);

        // Create SSR pass
        // SSR(color, depth, normal, metalness, roughness, camera)
        const defaultMetalness = float(0.9); // High metalness for visible reflections
        const defaultRoughness = this.uSSRMaxRoughness;

        this.ssrPass = (ssr as any)(
          scenePassColor,  // Must be texture node with .sample()
          scenePassDepth,
          scenePassNormal,
          defaultMetalness,
          defaultRoughness,
          this.camera
        );

        // Configure SSR parameters
        if (this.ssrPass?.maxDistance) {
          this.ssrPass.maxDistance.value = this.config.ssrMaxDistance;
        }
        if (this.ssrPass?.opacity) {
          this.ssrPass.opacity.value = this.config.ssrOpacity;
        }
        if (this.ssrPass?.thickness) {
          this.ssrPass.thickness.value = this.config.ssrThickness;
        }

        // BLEND SSR with scene - SSR outputs vec4(color, alpha)
        // Add reflections weighted by their opacity
        if (this.ssrPass) {
          const ssrTexture = this.ssrPass.getTextureNode();
          const ssrColor = ssrTexture.rgb;
          const ssrAlpha = ssrTexture.a;
          // Additive blend: scene + reflection * opacity
          outputNode = outputNode.add(ssrColor.mul(ssrAlpha));
        }
      } catch (e) {
        console.warn('[PostProcessing] SSR initialization failed:', e);
      }
    }

    // 4. Bloom effect (additive) with soft knee to prevent sparkle
    // Sparkle occurs when pixels near threshold pop in/out of bloom contribution
    // Soft knee creates gradual transition for temporal stability
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

    // 4. Apply color grading and vignette
    try {
      outputNode = this.createColorGradingPass(outputNode);
    } catch (e) {
      console.warn('[PostProcessing] Color grading failed:', e);
    }

    // 5. Anti-aliasing (TRAA or FXAA)
    // TRAA provides high-quality temporal anti-aliasing with motion-aware reprojection.
    // Using Three.js built-in velocity from MRT for proper motion handling.
    if (this.config.antiAliasingMode === 'taa' && this.config.taaEnabled) {
      try {
        // Get velocity from MRT (set up above when taaEnabled or ssrEnabled)
        const scenePassVelocity = scenePass.getTextureNode('velocity');

        // Use Three.js's TRAA with real velocity vectors
        this.traaPass = traa(outputNode, scenePassDepth, scenePassVelocity, this.camera);

        // Apply optional sharpening after TRAA (counters blur)
        if (this.config.taaSharpeningEnabled) {
          outputNode = this.createSharpeningPass(this.traaPass.getTextureNode());
        } else {
          outputNode = this.traaPass.getTextureNode();
        }
      } catch (e) {
        console.warn('[PostProcessing] TRAA initialization failed, falling back to FXAA:', e);
        // Fallback to FXAA - guaranteed to work with all materials
        try {
          this.fxaaPass = fxaa(outputNode);
          outputNode = this.fxaaPass;
        } catch (fxaaError) {
          console.warn('[PostProcessing] FXAA fallback also failed:', fxaaError);
          // Keep outputNode as-is
        }
      }
    } else if (this.config.antiAliasingMode === 'fxaa' || this.config.fxaaEnabled) {
      // FXAA anti-aliasing
      try {
        this.fxaaPass = fxaa(outputNode);
        outputNode = this.fxaaPass;
      } catch (e) {
        console.warn('[PostProcessing] FXAA initialization failed:', e);
      }
    }
    // If no AA, outputNode remains as-is

    // FINAL STEP: Upscaling (applied LAST for maximum performance)
    // All effects above ran at render resolution, now upscale to display resolution
    if (useUpscaling) {
      if (this.config.upscalingMode === 'easu') {
        // EASU - Edge-Adaptive Spatial Upsampling (FSR 1.0 style)
        try {
          const renderRes = new THREE.Vector2(
            Math.floor(this.displayWidth * this.config.renderScale),
            Math.floor(this.displayHeight * this.config.renderScale)
          );
          const displayRes = new THREE.Vector2(this.displayWidth, this.displayHeight);

          this.easuPass = easuUpscale(outputNode, renderRes, displayRes, this.config.easuSharpness);
          outputNode = this.easuPass.node;
        } catch (e) {
          console.warn('[PostProcessing] EASU upscaling failed:', e);
        }
      }
      // Bilinear mode: GPU's linear texture filtering handles upscaling automatically
      // when sampling low-res texture at high-res coordinates - no extra pass needed
    }

    // Set final output
    postProcessing.outputNode = outputNode;

    return postProcessing;
  }

  /**
   * Create RCAS-style (Robust Contrast-Adaptive Sharpening) pass.
   * Counters TAA blur while preserving edges.
   */
  private createSharpeningPass(inputNode: any): any {
    return Fn(() => {
      const fragUV = uv();
      const texelSize = vec2(1.0).div(this.uResolution);

      // Sample center and 4 neighbors (cross pattern)
      const center = vec3(inputNode).toVar();
      const north = inputNode.sample(fragUV.add(vec2(0, -1).mul(texelSize))).rgb;
      const south = inputNode.sample(fragUV.add(vec2(0, 1).mul(texelSize))).rgb;
      const west = inputNode.sample(fragUV.add(vec2(-1, 0).mul(texelSize))).rgb;
      const east = inputNode.sample(fragUV.add(vec2(1, 0).mul(texelSize))).rgb;

      // Compute local contrast
      const minRGB = min(min(min(north, south), min(west, east)), center);
      const maxRGB = max(max(max(north, south), max(west, east)), center);

      // Compute sharpening weight based on local contrast
      const contrast = maxRGB.sub(minRGB);
      const rcpM = float(1.0).div(max(max(contrast.r, contrast.g), contrast.b).add(0.25));

      // Compute sharpening kernel
      const neighbors = north.add(south).add(west).add(east);
      const sharpenedColor = center.add(
        center.mul(4.0).sub(neighbors).mul(this.uSharpeningIntensity).mul(rcpM)
      );

      // Clamp to prevent ringing artifacts
      const result = clamp(sharpenedColor, minRGB, maxRGB);

      return vec4(result, 1.0);
    })();
  }

  private createColorGradingPass(inputNode: any): any {
    return Fn(() => {
      let color = vec3(inputNode).toVar();

      // Apply exposure (HDR to LDR)
      color.mulAssign(this.uExposure);

      // Apply saturation
      const luminance = dot(color, vec3(0.299, 0.587, 0.114));
      color.assign(mix(vec3(luminance), color, this.uSaturation));

      // Apply contrast (around midtones)
      color.assign(color.sub(0.5).mul(this.uContrast).add(0.5));

      // Apply vignette (cinematic edge darkening)
      if (this.config.vignetteEnabled) {
        const uvCentered = uv().sub(0.5);
        const dist = length(uvCentered).mul(2.0);
        // Smooth falloff from center to edges
        const vignetteFactor = smoothstep(float(1.4), float(0.5), dist);
        const vignetteAmount = mix(float(1.0).sub(this.uVignetteIntensity), float(1.0), vignetteFactor);
        color.mulAssign(vignetteAmount);
      }

      // Clamp to valid range
      color.assign(clamp(color, 0.0, 1.0));

      return vec4(color, 1.0);
    })();
  }

  /**
   * Rebuild the pipeline when effects are toggled
   */
  rebuild(): void {
    // Dispose old TRAA pass (but keep zero-velocity texture - it's reused)
    if (this.traaPass) {
      this.traaPass.dispose();
      this.traaPass = null;
    }

    // Reset all pass references to ensure clean state
    // TSL nodes don't have dispose(), but we must clear references
    // to prevent stale nodes from interfering with the new pipeline
    this.bloomPass = null;
    this.aoPass = null;
    this.ssrPass = null;
    this.ssgiPass = null;
    this.fxaaPass = null;
    this.easuPass = null;

    // Note: zeroVelocityTexture is NOT disposed here - it's reused across rebuilds
    // to avoid WebGPU "Texture already initialized" errors
    this.postProcessing = this.createPipeline();
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

    // Update internal render resolution based on upscaling mode
    // When upscaling is off, render at native resolution regardless of renderScale value
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
   * Update camera reference (needed if camera changes)
   */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.rebuild();
  }

  /**
   * Set display size (for sharpening and upscaling resolution uniforms)
   */
  setSize(width: number, height: number): void {
    const currentSize = this.uResolution.value;
    if (currentSize.x !== width || currentSize.y !== height) {
      // Update display resolution
      this.displayWidth = width;
      this.displayHeight = height;
      this.uResolution.value.set(width, height);

      // Update render resolution based on effective scale
      // When upscaling is off, use native resolution
      const effectiveScale = this.config.upscalingMode !== 'off' ? this.config.renderScale : 1.0;
      this.renderWidth = Math.floor(width * effectiveScale);
      this.renderHeight = Math.floor(height * effectiveScale);

      // TRAA handles its own resizing internally
      if (this.traaPass) {
        this.traaPass.setSize(width, height);
      }

      // Update EASU resolutions
      if (this.easuPass) {
        this.easuPass.setRenderResolution(this.renderWidth, this.renderHeight);
        this.easuPass.setDisplayResolution(width, height);
      }
    }
  }

  /**
   * Check if SSR is enabled
   */
  isSSREnabled(): boolean {
    return this.config.ssrEnabled;
  }

  /**
   * Check if TAA/TRAA is enabled
   */
  isTAAEnabled(): boolean {
    return this.config.taaEnabled && this.config.antiAliasingMode === 'taa';
  }

  /**
   * Check if SSGI is enabled
   */
  isSSGIEnabled(): boolean {
    return this.config.ssgiEnabled;
  }

  /**
   * Get current anti-aliasing mode
   */
  getAntiAliasingMode(): AntiAliasingMode {
    return this.config.antiAliasingMode;
  }

  /**
   * Check if upscaling is enabled
   */
  isUpscalingEnabled(): boolean {
    return this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;
  }

  /**
   * Get current upscaling mode
   */
  getUpscalingMode(): UpscalingMode {
    return this.config.upscalingMode;
  }

  /**
   * Get current render scale (0.5 - 1.0)
   */
  getRenderScale(): number {
    return this.config.renderScale;
  }

  /**
   * Get render scale as percentage (50 - 100)
   */
  getRenderScalePercent(): number {
    return Math.round(this.config.renderScale * 100);
  }

  /**
   * Get current render resolution (internal)
   */
  getRenderResolution(): { width: number; height: number } {
    return { width: this.renderWidth, height: this.renderHeight };
  }

  /**
   * Get current display resolution
   */
  getDisplayResolution(): { width: number; height: number } {
    return { width: this.displayWidth, height: this.displayHeight };
  }

  /**
   * Render the scene with post-processing
   */
  render(): void {
    this.postProcessing.render();
  }

  /**
   * Async render (for compute shader coordination)
   */
  async renderAsync(): Promise<void> {
    await this.postProcessing.renderAsync();
  }

  /**
   * Get the PostProcessing instance for direct access
   */
  getPostProcessing(): PostProcessing {
    return this.postProcessing;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.traaPass) {
      this.traaPass.dispose();
      this.traaPass = null;
    }
    if (this.zeroVelocityTexture) {
      this.zeroVelocityTexture.dispose();
      this.zeroVelocityTexture = null;
    }
    this.zeroVelocityNode = null;
    // PostProcessing handles its own disposal
  }
}

// ============================================
// SIMPLE POST-PROCESSING (NO EFFECTS)
// ============================================

/**
 * Create minimal post-processing pass (just scene render)
 */
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

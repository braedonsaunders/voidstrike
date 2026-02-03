/* eslint-disable @typescript-eslint/no-explicit-any -- TSL shader nodes use polymorphic types */
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
 */

import * as THREE from 'three';
import { WebGPURenderer, PostProcessing } from 'three/webgpu';
import { debugPostProcessing } from '@/utils/debugLogger';
import {
  pass,
  uniform,
  uv,
  vec2,
  vec4,
  float,
  Fn,
  mix,
  smoothstep,
  length,
  texture,
  mrt,
  output,
  normalView,
} from 'three/tsl';
import { materialMetalness, materialRoughness } from 'three/tsl';

// Import EASU upscaling
import { easuUpscale } from './UpscalerNode';

// Import custom instanced velocity node
import { createInstancedVelocityNode } from './InstancedVelocity';

// Import volumetric fog
import { VolumetricFogNode } from './VolumetricFog';

// Import temporal reprojection managers
import { TemporalAOManager } from './TemporalAO';
import { TemporalSSRManager } from './TemporalSSR';

// Import extracted effect modules
import {
  // Effect creation
  createSSGIPass,
  createGTAOPass,
  createSSRPass,
  createBloomPass,
  createVolumetricFogPass,
  createColorGradingPass,
  createSharpeningPass,
  createTRAAPass,
  createFXAAPass,
  createFogOfWarPass,
  // Temporal helpers
  createTemporalAOUpscaleNode,
  createTemporalSSRUpscaleNode,
  createFullResTemporalSSRNode,
  createTemporalBlendNode,
  // Types
  type ColorGradingUniforms,
  type FogOfWarPassResult,
  type FogOfWarQuality,
} from './effects';

// Import temporal pipeline management
import {
  createQuarterAOPipeline,
  createQuarterSSRPipeline,
  type QuarterResPipelineContext,
} from './effects';

// ============================================
// WARNING SUPPRESSION
// ============================================

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

let warningsSupressed = false;

function suppressAttributeWarnings(): void {
  if (warningsSupressed) return;
  warningsSupressed = true;
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

export function restoreConsoleWarn(): void {
  if (!warningsSupressed) return;
  console.warn = originalWarn;
  warningsSupressed = false;
}

suppressAttributeWarnings();

// ============================================
// POST-PROCESSING CONFIGURATION
// ============================================

export type AntiAliasingMode = 'off' | 'fxaa' | 'taa';
export type UpscalingMode = 'off' | 'easu' | 'bilinear';

export interface PostProcessingConfig {
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  aoEnabled: boolean;
  aoRadius: number;
  aoIntensity: number;
  temporalAOEnabled: boolean;
  temporalAOBlendFactor: number;
  ssrEnabled: boolean;
  ssrMaxDistance: number;
  ssrOpacity: number;
  ssrThickness: number;
  ssrMaxRoughness: number;
  temporalSSREnabled: boolean;
  temporalSSRBlendFactor: number;
  ssgiEnabled: boolean;
  ssgiRadius: number;
  ssgiIntensity: number;
  ssgiThickness: number;
  antiAliasingMode: AntiAliasingMode;
  fxaaEnabled: boolean;
  taaEnabled: boolean;
  taaHistoryBlendRate: number;
  taaSharpeningEnabled: boolean;
  taaSharpeningIntensity: number;
  upscalingMode: UpscalingMode;
  renderScale: number;
  easuSharpness: number;
  vignetteEnabled: boolean;
  vignetteIntensity: number;
  exposure: number;
  saturation: number;
  contrast: number;
  volumetricFogEnabled: boolean;
  volumetricFogQuality: 'low' | 'medium' | 'high' | 'ultra';
  volumetricFogDensity: number;
  volumetricFogScattering: number;
  // Fog of War (classic RTS-style)
  fogOfWarEnabled: boolean;
  fogOfWarQuality: FogOfWarQuality;
  fogOfWarEdgeBlur: number; // 0-4 cells
  fogOfWarDesaturation: number; // 0-1
  fogOfWarExploredDarkness: number; // 0.3-0.7
  fogOfWarUnexploredDarkness: number; // 0.05-0.2
  fogOfWarCloudSpeed: number; // animation speed
  fogOfWarRimIntensity: number; // 0-0.3
  fogOfWarHeightInfluence: number; // 0-1
}

const DEFAULT_CONFIG: PostProcessingConfig = {
  bloomEnabled: true,
  bloomStrength: 0.3,
  bloomRadius: 0.5,
  bloomThreshold: 0.8,
  aoEnabled: true,
  aoRadius: 2,
  aoIntensity: 0.8,
  temporalAOEnabled: false,
  temporalAOBlendFactor: 0.9,
  ssrEnabled: false,
  ssrMaxDistance: 100,
  ssrOpacity: 1.0,
  ssrThickness: 0.1,
  ssrMaxRoughness: 0.5,
  temporalSSREnabled: false,
  temporalSSRBlendFactor: 0.85,
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
  volumetricFogEnabled: false,
  volumetricFogQuality: 'medium',
  volumetricFogDensity: 1.0,
  volumetricFogScattering: 1.0,
  // Fog of War defaults (classic RTS-style)
  fogOfWarEnabled: false,
  fogOfWarQuality: 'high',
  fogOfWarEdgeBlur: 2.5,
  fogOfWarDesaturation: 0.7,
  fogOfWarExploredDarkness: 0.5,
  fogOfWarUnexploredDarkness: 0.12,
  fogOfWarCloudSpeed: 0.015,
  fogOfWarRimIntensity: 0.12,
  fogOfWarHeightInfluence: 0.25,
};

// ============================================
// RENDER PIPELINE CLASS
// ============================================

export class RenderPipeline {
  private renderer: WebGPURenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private config: PostProcessingConfig;

  // Pipelines
  private internalPostProcessing: PostProcessing | null = null;
  private internalRenderTarget: THREE.RenderTarget | null = null;
  private quarterAOPostProcessing: PostProcessing | null = null;
  private quarterSSRPostProcessing: PostProcessing | null = null;
  private displayPostProcessing: PostProcessing | null = null;

  // Effect passes (stored for runtime parameter updates)
  private bloomPass: any = null;
  private aoPass: any = null;
  private ssrPass: any = null;
  private ssgiPass: any = null;
  private fxaaPass: any = null;
  private traaPass: any = null;
  private volumetricFogPass: VolumetricFogNode | null = null;
  private fogOfWarPass: FogOfWarPassResult | null = null;
  private easuPass: ReturnType<typeof easuUpscale> | null = null;

  // Temporal managers
  private temporalAOManager: TemporalAOManager | null = null;
  private temporalSSRManager: TemporalSSRManager | null = null;

  // Dimensions
  private quarterWidth = 960;
  private quarterHeight = 540;
  private displayWidth = 1920;
  private displayHeight = 1080;
  private renderWidth = 1920;
  private renderHeight = 1080;

  // Uniforms for dynamic updates
  private uVignetteIntensity = uniform(0.25);
  private uAOIntensity = uniform(1.0);
  private uExposure = uniform(1.0);
  private uSaturation = uniform(0.8);
  private uContrast = uniform(1.05);
  private uSharpeningIntensity = uniform(0.5);
  private uResolution = uniform(new THREE.Vector2(1920, 1080));
  private uTemporalAOBlend = uniform(0.9);
  private uTemporalSSRBlend = uniform(0.85);

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

    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    this.displayWidth = Math.max(1, size.x);
    this.displayHeight = Math.max(1, size.y);
    this.uResolution.value.set(this.displayWidth, this.displayHeight);

    const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;
    const effectiveScale = useUpscaling ? this.config.renderScale : 1.0;
    this.renderWidth = Math.floor(this.displayWidth * effectiveScale);
    this.renderHeight = Math.floor(this.displayHeight * effectiveScale);
    this.quarterWidth = Math.max(1, Math.floor(this.renderWidth / 2));
    this.quarterHeight = Math.max(1, Math.floor(this.renderHeight / 2));

    this.createDualPipeline();
    this.applyConfig(this.config);
  }

  private createDualPipeline(): void {
    // Initialize temporal managers
    if (this.config.temporalAOEnabled && this.config.aoEnabled && !this.config.ssgiEnabled) {
      this.temporalAOManager = new TemporalAOManager(this.renderWidth, this.renderHeight, {
        historyBlendFactor: this.config.temporalAOBlendFactor,
        depthRejectionThreshold: 0.1,
        enabled: true,
      });
    }

    if (this.config.temporalSSREnabled && this.config.ssrEnabled) {
      this.temporalSSRManager = new TemporalSSRManager(this.renderWidth, this.renderHeight, {
        historyBlendFactor: this.config.temporalSSRBlendFactor,
        depthRejectionThreshold: 0.05,
        colorBoxClamp: true,
        enabled: true,
      });
    }

    // Create quarter-res pipelines
    const pipelineContext: QuarterResPipelineContext = {
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      quarterWidth: this.quarterWidth,
      quarterHeight: this.quarterHeight,
    };

    if (this.temporalAOManager) {
      this.quarterAOPostProcessing = createQuarterAOPipeline(
        pipelineContext,
        this.temporalAOManager,
        this.config.aoRadius
      );
    }

    if (this.temporalSSRManager) {
      this.quarterSSRPostProcessing = createQuarterSSRPipeline(
        pipelineContext,
        this.temporalSSRManager,
        {
          maxDistance: this.config.ssrMaxDistance,
          opacity: this.config.ssrOpacity,
          thickness: this.config.ssrThickness,
        }
      );
    }

    const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;

    if (useUpscaling) {
      const originalSize = new THREE.Vector2();
      this.renderer.getSize(originalSize);

      this.internalRenderTarget = new THREE.RenderTarget(this.renderWidth, this.renderHeight, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.LinearSRGBColorSpace,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });

      this.renderer.setSize(this.renderWidth, this.renderHeight, false);
      this.internalPostProcessing = this.createInternalPipeline();

      this.renderer.setSize(originalSize.x, originalSize.y, false);
      this.displayPostProcessing = this.createDisplayPipeline();
    } else {
      this.internalPostProcessing = this.createInternalPipeline();
      this.displayPostProcessing = null;
      this.internalRenderTarget = null;
    }
  }

  private createInternalPipeline(): PostProcessing {
    const postProcessing = new PostProcessing(this.renderer);
    const scenePass = pass(this.scene, this.camera);

    // Setup MRT
    // Include aoEnabled to provide actual normals to GTAO for more accurate AO
    // (without normals, GTAO reconstructs from depth which causes triangular artifacts)
    const needsNormals = this.config.ssrEnabled || this.config.ssgiEnabled || this.config.aoEnabled;
    const needsVelocity =
      this.config.taaEnabled ||
      this.config.ssgiEnabled ||
      this.config.temporalAOEnabled ||
      this.config.temporalSSREnabled;

    if (needsNormals || needsVelocity) {
      const customVelocity = createInstancedVelocityNode();
      if (needsNormals) {
        // Fix for TSL normalView variable initialization issue (Three.js #32009):
        // normalView may not be properly initialized in MRT shader contexts, causing
        // black/undefined normals for some pixels. Using .toVar() forces proper
        // variable initialization, preventing triangular artifacts where GTAO would
        // fall back to depth-based normal reconstruction.
        const normalViewVar = normalView.toVar();
        scenePass.setMRT(
          mrt({
            output: output,
            normal: normalViewVar.mul(0.5).add(0.5),
            metalrough: vec2(materialMetalness, materialRoughness),
            velocity: customVelocity,
          })
        );
        const metalRoughTexture = scenePass.getTexture('metalrough');
        if (metalRoughTexture) metalRoughTexture.type = THREE.UnsignedByteType;
      } else {
        scenePass.setMRT(mrt({ output: output, velocity: customVelocity }));
      }
    }

    const scenePassColor = scenePass.getTextureNode();
    const scenePassDepth = scenePass.getTextureNode('depth');
    // Only retrieve MRT texture nodes that were actually set up
    const scenePassNormal = needsNormals ? scenePass.getTextureNode('normal') : null;
    const scenePassMetalRough = needsNormals ? scenePass.getTextureNode('metalrough') : null;
    const scenePassVelocity = needsVelocity ? scenePass.getTextureNode('velocity') : null;

    let outputNode: any = scenePassColor;

    // 1. SSGI
    if (this.config.ssgiEnabled && scenePassNormal) {
      const result = createSSGIPass(scenePassColor, scenePassDepth, scenePassNormal, this.camera, {
        radius: this.config.ssgiRadius,
        intensity: this.config.ssgiIntensity,
        thickness: this.config.ssgiThickness,
        aoIntensity: this.config.aoIntensity,
        taaEnabled: this.config.taaEnabled,
      });
      if (result) {
        this.ssgiPass = result.pass;
        outputNode = result.node(outputNode);
      }
    }

    // 2. GTAO (skip if SSGI)
    if (this.config.aoEnabled && !this.config.ssgiEnabled) {
      if (this.temporalAOManager && this.quarterAOPostProcessing && scenePassVelocity) {
        // Quarter-res temporal AO
        const aoValue = createTemporalAOUpscaleNode(
          this.temporalAOManager.getQuarterAOTexture(),
          this.temporalAOManager.getHistoryTexture(),
          scenePassVelocity,
          this.uTemporalAOBlend
        );
        outputNode = scenePassColor.mul(mix(float(1.0), aoValue, this.uAOIntensity));
      } else {
        // Full-res AO - pass normals for accurate occlusion (avoids depth-based artifacts)
        const result = createGTAOPass(
          scenePassDepth,
          this.camera,
          {
            radius: this.config.aoRadius,
            intensity: this.config.aoIntensity,
          },
          scenePassNormal
        );
        if (result) {
          this.aoPass = result.pass;
          let aoValue = result.aoValueNode;

          // Apply temporal blending if enabled (without quarter-res)
          if (this.config.temporalAOEnabled && this.temporalAOManager && scenePassVelocity) {
            aoValue = createTemporalBlendNode(
              aoValue,
              this.temporalAOManager.getHistoryTexture(),
              scenePassVelocity,
              this.uTemporalAOBlend
            );
          }
          outputNode = scenePassColor.mul(mix(float(1.0), aoValue, this.uAOIntensity));
        }
      }
    }

    // 3. SSR
    if (this.config.ssrEnabled) {
      if (this.temporalSSRManager && this.quarterSSRPostProcessing && scenePassVelocity) {
        // Quarter-res temporal SSR
        const ssrTexture = createTemporalSSRUpscaleNode(
          this.temporalSSRManager.getQuarterSSRTexture(),
          this.temporalSSRManager.getHistoryTexture(),
          scenePassVelocity,
          this.uResolution,
          this.uTemporalSSRBlend
        );
        outputNode = outputNode.add(ssrTexture.rgb.mul(ssrTexture.a));
      } else if (scenePassNormal && scenePassMetalRough) {
        // Full-res SSR
        const result = createSSRPass(
          scenePassColor,
          scenePassDepth,
          scenePassNormal,
          scenePassMetalRough,
          this.camera,
          {
            maxDistance: this.config.ssrMaxDistance,
            opacity: this.config.ssrOpacity,
            thickness: this.config.ssrThickness,
            maxRoughness: this.config.ssrMaxRoughness,
          }
        );
        if (result) {
          this.ssrPass = result.pass;
          let ssrTexture = result.textureNode;

          // Apply temporal blending if enabled
          if (
            this.config.temporalSSREnabled &&
            this.temporalSSRManager &&
            scenePassVelocity &&
            ssrTexture
          ) {
            ssrTexture = createFullResTemporalSSRNode(
              ssrTexture,
              this.temporalSSRManager.getHistoryTexture(),
              scenePassVelocity,
              this.uResolution,
              this.uTemporalSSRBlend
            );
          }
          if (ssrTexture) {
            outputNode = outputNode.add(ssrTexture.rgb.mul(ssrTexture.a));
          }
        }
      }
    }

    // 4. Fog of War (classic RTS-style post-process)
    if (
      this.config.fogOfWarEnabled &&
      scenePassDepth &&
      this.camera instanceof THREE.PerspectiveCamera
    ) {
      this.fogOfWarPass = createFogOfWarPass(outputNode, scenePassDepth, this.camera);
      if (this.fogOfWarPass) {
        this.fogOfWarPass.applyConfig({
          quality: this.config.fogOfWarQuality,
          edgeBlurRadius: this.config.fogOfWarEdgeBlur,
          desaturation: this.config.fogOfWarDesaturation,
          exploredDarkness: this.config.fogOfWarExploredDarkness,
          unexploredDarkness: this.config.fogOfWarUnexploredDarkness,
          cloudSpeed: this.config.fogOfWarCloudSpeed,
          rimIntensity: this.config.fogOfWarRimIntensity,
          heightInfluence: this.config.fogOfWarHeightInfluence,
        });
        outputNode = this.fogOfWarPass.node;
      }
    }

    // 5. Bloom
    if (this.config.bloomEnabled) {
      const result = createBloomPass(outputNode, {
        threshold: this.config.bloomThreshold,
        strength: this.config.bloomStrength,
        radius: this.config.bloomRadius,
      });
      if (result) {
        this.bloomPass = result.pass;
        outputNode = result.node;
      }
    }

    // 6. Volumetric Fog
    if (this.config.volumetricFogEnabled && this.camera instanceof THREE.PerspectiveCamera) {
      const result = createVolumetricFogPass(outputNode, scenePassDepth, this.camera, {
        quality: this.config.volumetricFogQuality,
        density: this.config.volumetricFogDensity,
        scattering: this.config.volumetricFogScattering,
      });
      if (result) {
        this.volumetricFogPass = result.pass;
        outputNode = result.node;
      }
    }

    // 7. Color grading
    const colorUniforms: ColorGradingUniforms = {
      vignetteIntensity: this.uVignetteIntensity,
      exposure: this.uExposure,
      saturation: this.uSaturation,
      contrast: this.uContrast,
    };
    outputNode = createColorGradingPass(outputNode, colorUniforms, this.config.vignetteEnabled);

    // 8. Anti-aliasing
    if (this.config.antiAliasingMode === 'taa' && this.config.taaEnabled && scenePassVelocity) {
      const result = createTRAAPass(outputNode, scenePassDepth, scenePassVelocity, this.camera);
      if (result) {
        this.traaPass = result.pass;
        outputNode = result.textureNode;

        // Apply sharpening if not upscaling
        const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;
        if (!useUpscaling && this.config.taaSharpeningEnabled) {
          outputNode = createSharpeningPass(
            outputNode,
            this.uResolution,
            this.uSharpeningIntensity
          );
        }
      } else {
        // Fallback to FXAA
        const fxaaResult = createFXAAPass(outputNode);
        if (fxaaResult) {
          this.fxaaPass = fxaaResult.pass;
          outputNode = fxaaResult.node;
        }
      }
    } else if (this.config.antiAliasingMode === 'fxaa' || this.config.fxaaEnabled) {
      const result = createFXAAPass(outputNode);
      if (result) {
        this.fxaaPass = result.pass;
        outputNode = result.node;
      }
    }

    postProcessing.outputNode = outputNode;
    return postProcessing;
  }

  private createDisplayPipeline(): PostProcessing {
    const postProcessing = new PostProcessing(this.renderer);

    if (!this.internalRenderTarget) {
      postProcessing.outputNode = vec4(1, 0, 1, 1);
      return postProcessing;
    }

    const inputTexture = texture(this.internalRenderTarget.texture);
    let outputNode: any = inputTexture;

    if (this.config.upscalingMode === 'easu') {
      try {
        const renderRes = new THREE.Vector2(this.renderWidth, this.renderHeight);
        const displayRes = new THREE.Vector2(this.displayWidth, this.displayHeight);
        this.easuPass = easuUpscale(inputTexture, renderRes, displayRes, this.config.easuSharpness);
        outputNode = this.easuPass.node;
      } catch (e) {
        debugPostProcessing.warn('[PostProcessing] EASU failed, using bilinear:', e);
      }
    }

    postProcessing.outputNode = outputNode;
    return postProcessing;
  }

  rebuild(): void {
    this.traaPass?.dispose?.();
    this.traaPass = null;
    this.internalRenderTarget?.dispose();
    this.internalRenderTarget = null;
    this.bloomPass = null;
    this.aoPass = null;
    this.ssrPass = null;
    this.ssgiPass = null;
    this.fxaaPass = null;
    this.easuPass = null;
    this.volumetricFogPass = null;
    this.fogOfWarPass = null;
    this.quarterAOPostProcessing = null;
    this.quarterSSRPostProcessing = null;
    this.temporalAOManager?.dispose();
    this.temporalAOManager = null;
    this.temporalSSRManager?.dispose();
    this.temporalSSRManager = null;
    this.quarterWidth = Math.max(1, Math.floor(this.renderWidth / 2));
    this.quarterHeight = Math.max(1, Math.floor(this.renderHeight / 2));
    this.createDualPipeline();
  }

  applyConfig(config: Partial<PostProcessingConfig>): void {
    const needsRebuild =
      (config.bloomEnabled !== undefined && config.bloomEnabled !== this.config.bloomEnabled) ||
      (config.aoEnabled !== undefined && config.aoEnabled !== this.config.aoEnabled) ||
      (config.temporalAOEnabled !== undefined &&
        config.temporalAOEnabled !== this.config.temporalAOEnabled) ||
      (config.ssrEnabled !== undefined && config.ssrEnabled !== this.config.ssrEnabled) ||
      (config.temporalSSREnabled !== undefined &&
        config.temporalSSREnabled !== this.config.temporalSSREnabled) ||
      (config.ssgiEnabled !== undefined && config.ssgiEnabled !== this.config.ssgiEnabled) ||
      (config.fxaaEnabled !== undefined && config.fxaaEnabled !== this.config.fxaaEnabled) ||
      (config.taaEnabled !== undefined && config.taaEnabled !== this.config.taaEnabled) ||
      (config.antiAliasingMode !== undefined &&
        config.antiAliasingMode !== this.config.antiAliasingMode) ||
      (config.taaSharpeningEnabled !== undefined &&
        config.taaSharpeningEnabled !== this.config.taaSharpeningEnabled) ||
      (config.vignetteEnabled !== undefined &&
        config.vignetteEnabled !== this.config.vignetteEnabled) ||
      (config.upscalingMode !== undefined && config.upscalingMode !== this.config.upscalingMode) ||
      (config.renderScale !== undefined && config.renderScale !== this.config.renderScale) ||
      (config.volumetricFogEnabled !== undefined &&
        config.volumetricFogEnabled !== this.config.volumetricFogEnabled) ||
      (config.fogOfWarEnabled !== undefined &&
        config.fogOfWarEnabled !== this.config.fogOfWarEnabled);

    this.config = { ...this.config, ...config };

    if (config.antiAliasingMode !== undefined) {
      this.config.fxaaEnabled = config.antiAliasingMode === 'fxaa';
      this.config.taaEnabled = config.antiAliasingMode === 'taa';
    }

    const effectiveScale = this.config.upscalingMode !== 'off' ? this.config.renderScale : 1.0;
    this.renderWidth = Math.floor(this.displayWidth * effectiveScale);
    this.renderHeight = Math.floor(this.displayHeight * effectiveScale);

    // Update pass parameters
    if (this.bloomPass) {
      this.bloomPass.threshold.value = this.config.bloomThreshold;
      this.bloomPass.strength.value = this.config.bloomStrength;
      this.bloomPass.radius.value = this.config.bloomRadius;
    }
    if (this.aoPass) this.aoPass.radius.value = this.config.aoRadius;
    this.uAOIntensity.value = this.config.aoIntensity;
    if (this.ssrPass) {
      if (this.ssrPass.maxDistance) this.ssrPass.maxDistance.value = this.config.ssrMaxDistance;
      if (this.ssrPass.opacity) this.ssrPass.opacity.value = this.config.ssrOpacity;
      if (this.ssrPass.thickness) this.ssrPass.thickness.value = this.config.ssrThickness;
    }
    if (this.ssgiPass) {
      this.ssgiPass.radius.value = this.config.ssgiRadius;
      this.ssgiPass.giIntensity.value = this.config.ssgiIntensity;
      this.ssgiPass.thickness.value = this.config.ssgiThickness;
      this.ssgiPass.aoIntensity.value = this.config.aoIntensity;
    }
    this.uTemporalAOBlend.value = this.config.temporalAOBlendFactor;
    this.uTemporalSSRBlend.value = this.config.temporalSSRBlendFactor;
    this.volumetricFogPass?.applyConfig({
      quality: this.config.volumetricFogQuality,
      density: this.config.volumetricFogDensity,
      scattering: this.config.volumetricFogScattering,
    });
    // Fog of War config
    this.fogOfWarPass?.applyConfig({
      quality: this.config.fogOfWarQuality,
      edgeBlurRadius: this.config.fogOfWarEdgeBlur,
      desaturation: this.config.fogOfWarDesaturation,
      exploredDarkness: this.config.fogOfWarExploredDarkness,
      unexploredDarkness: this.config.fogOfWarUnexploredDarkness,
      cloudSpeed: this.config.fogOfWarCloudSpeed,
      rimIntensity: this.config.fogOfWarRimIntensity,
      heightInfluence: this.config.fogOfWarHeightInfluence,
    });
    this.uSharpeningIntensity.value = this.config.taaSharpeningIntensity;
    this.easuPass?.setSharpness(this.config.easuSharpness);
    this.easuPass?.setRenderResolution(this.renderWidth, this.renderHeight);
    this.uVignetteIntensity.value = this.config.vignetteIntensity;
    this.uExposure.value = this.config.exposure;
    this.uSaturation.value = this.config.saturation;
    this.uContrast.value = this.config.contrast;

    if (needsRebuild) this.rebuild();
  }

  // Accessors
  getConfig(): PostProcessingConfig {
    return { ...this.config };
  }
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.rebuild();
  }
  setSize(width: number, height: number): void {
    if (this.uResolution.value.x !== width || this.uResolution.value.y !== height) {
      this.displayWidth = width;
      this.displayHeight = height;
      this.uResolution.value.set(width, height);
      const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;
      const effectiveScale = useUpscaling ? this.config.renderScale : 1.0;
      this.renderWidth = Math.floor(width * effectiveScale);
      this.renderHeight = Math.floor(height * effectiveScale);
      this.rebuild();
    }
  }

  // Status methods
  isSSREnabled(): boolean {
    return this.config.ssrEnabled;
  }
  isTAAEnabled(): boolean {
    return this.config.taaEnabled && this.config.antiAliasingMode === 'taa';
  }
  isSSGIEnabled(): boolean {
    return this.config.ssgiEnabled;
  }
  isVolumetricFogEnabled(): boolean {
    return this.config.volumetricFogEnabled;
  }
  isFogOfWarEnabled(): boolean {
    return this.config.fogOfWarEnabled;
  }
  isTemporalAOEnabled(): boolean {
    return this.config.temporalAOEnabled && this.config.aoEnabled;
  }
  isTemporalSSREnabled(): boolean {
    return this.config.temporalSSREnabled && this.config.ssrEnabled;
  }
  getAntiAliasingMode(): AntiAliasingMode {
    return this.config.antiAliasingMode;
  }
  isUpscalingEnabled(): boolean {
    return this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;
  }
  getUpscalingMode(): UpscalingMode {
    return this.config.upscalingMode;
  }
  getRenderScale(): number {
    return this.config.renderScale;
  }
  getRenderScalePercent(): number {
    return Math.round(this.config.renderScale * 100);
  }
  getRenderResolution(): { width: number; height: number } {
    return { width: this.renderWidth, height: this.renderHeight };
  }
  getDisplayResolution(): { width: number; height: number } {
    return { width: this.displayWidth, height: this.displayHeight };
  }

  // Fog of War methods
  /**
   * Set the vision texture for fog of war rendering
   * This texture comes from VisionCompute and contains:
   * - R: explored (0-1)
   * - G: visible (0-1)
   * - B: velocity (0.5 = no change)
   * - A: smooth visibility (0-1, temporally filtered)
   */
  setFogOfWarVisionTexture(texture: THREE.Texture | null): void {
    this.fogOfWarPass?.setVisionTexture(texture);
  }

  /**
   * Update fog of war animation time (for cloud movement)
   */
  updateFogOfWarTime(time: number): void {
    this.fogOfWarPass?.updateTime(time);
  }

  /**
   * Set fog of war map dimensions for proper world-space calculations
   * @param width Map width in world units
   * @param height Map height in world units
   * @param cellSize Optional cell size for vision grid (default: 2)
   */
  setFogOfWarMapDimensions(width: number, height: number, cellSize: number = 2): void {
    if (this.fogOfWarPass) {
      this.fogOfWarPass.setMapDimensions(width, height, cellSize);
    }
  }

  /**
   * Get the fog of war pass for direct access (e.g., setting grid dimensions)
   */
  getFogOfWarPass(): FogOfWarPassResult | null {
    return this.fogOfWarPass;
  }

  updateVolumetricFogCamera(): void {
    if (this.volumetricFogPass && this.camera instanceof THREE.PerspectiveCamera) {
      this.volumetricFogPass.updateCamera(this.camera);
    }
  }

  /**
   * Update fog of war camera matrices for proper world position reconstruction
   */
  updateFogOfWarCamera(): void {
    if (this.fogOfWarPass && this.camera instanceof THREE.PerspectiveCamera) {
      this.fogOfWarPass.updateCamera(this.camera);
    }
  }

  render(): void {
    this.updateVolumetricFogCamera();
    this.updateFogOfWarCamera();
    const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;
    this.renderQuarterResEffects();

    if (useUpscaling && this.displayPostProcessing && this.internalRenderTarget) {
      const originalSize = new THREE.Vector2();
      this.renderer.getSize(originalSize);
      const originalColorSpace = this.renderer.outputColorSpace;

      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      this.renderer.setSize(this.renderWidth, this.renderHeight, false);
      this.renderer.setRenderTarget(this.internalRenderTarget);
      this.internalPostProcessing?.render();

      this.renderer.setRenderTarget(null);
      this.renderer.outputColorSpace = originalColorSpace;
      this.renderer.setSize(originalSize.x, originalSize.y, false);
      this.displayPostProcessing.render();
    } else {
      this.internalPostProcessing?.render();
    }
    this.swapTemporalBuffers();
  }

  private renderQuarterResEffects(): void {
    const originalSize = new THREE.Vector2();
    this.renderer.getSize(originalSize);

    if (this.quarterAOPostProcessing && this.temporalAOManager) {
      this.renderer.setSize(this.quarterWidth, this.quarterHeight, false);
      this.renderer.setRenderTarget(this.temporalAOManager.getQuarterAOTarget());
      this.quarterAOPostProcessing.render();
    }
    if (this.quarterSSRPostProcessing && this.temporalSSRManager) {
      this.renderer.setSize(this.quarterWidth, this.quarterHeight, false);
      this.renderer.setRenderTarget(this.temporalSSRManager.getQuarterSSRTarget());
      this.quarterSSRPostProcessing.render();
    }

    this.renderer.setRenderTarget(null);
    this.renderer.setSize(originalSize.x, originalSize.y, false);
  }

  private swapTemporalBuffers(): void {
    this.temporalAOManager?.swapBuffers();
    this.temporalSSRManager?.swapBuffers();
  }

  async renderAsync(): Promise<void> {
    this.updateVolumetricFogCamera();
    const useUpscaling = this.config.upscalingMode !== 'off' && this.config.renderScale < 1.0;
    await this.renderQuarterResEffectsAsync();

    if (useUpscaling && this.displayPostProcessing && this.internalRenderTarget) {
      const originalSize = new THREE.Vector2();
      this.renderer.getSize(originalSize);
      const originalColorSpace = this.renderer.outputColorSpace;

      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      this.renderer.setSize(this.renderWidth, this.renderHeight, false);
      this.renderer.setRenderTarget(this.internalRenderTarget);
      await this.internalPostProcessing?.renderAsync();

      this.renderer.setRenderTarget(null);
      this.renderer.outputColorSpace = originalColorSpace;
      this.renderer.setSize(originalSize.x, originalSize.y, false);
      await this.displayPostProcessing.renderAsync();
    } else {
      await this.internalPostProcessing?.renderAsync();
    }
    this.swapTemporalBuffers();
  }

  private async renderQuarterResEffectsAsync(): Promise<void> {
    const originalSize = new THREE.Vector2();
    this.renderer.getSize(originalSize);

    if (this.quarterAOPostProcessing && this.temporalAOManager) {
      this.renderer.setSize(this.quarterWidth, this.quarterHeight, false);
      this.renderer.setRenderTarget(this.temporalAOManager.getQuarterAOTarget());
      await this.quarterAOPostProcessing.renderAsync();
    }
    if (this.quarterSSRPostProcessing && this.temporalSSRManager) {
      this.renderer.setSize(this.quarterWidth, this.quarterHeight, false);
      this.renderer.setRenderTarget(this.temporalSSRManager.getQuarterSSRTarget());
      await this.quarterSSRPostProcessing.renderAsync();
    }

    this.renderer.setRenderTarget(null);
    this.renderer.setSize(originalSize.x, originalSize.y, false);
  }

  getPostProcessing(): PostProcessing {
    return this.displayPostProcessing || this.internalPostProcessing!;
  }

  dispose(): void {
    this.traaPass?.dispose?.();
    this.traaPass = null;
    this.internalRenderTarget?.dispose();
    this.internalRenderTarget = null;
    this.quarterAOPostProcessing = null;
    this.quarterSSRPostProcessing = null;
    this.temporalAOManager?.dispose();
    this.temporalAOManager = null;
    this.temporalSSRManager?.dispose();
    this.temporalSSRManager = null;
  }
}

// ============================================
// UTILITY EXPORTS
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
      return mix(inputColor, this.color, vignette.mul(this.intensity));
    });
  }
}

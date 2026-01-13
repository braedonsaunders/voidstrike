/**
 * TSL Post-Processing Pipeline - AAA Quality
 *
 * WebGPU-compatible post-processing using Three.js TSL nodes.
 * Features:
 * - Bloom effect (BloomNode) - HDR glow
 * - GTAO ambient occlusion (GTAONode) - Contact shadows
 * - TAA anti-aliasing (Temporal Anti-Aliasing) - High quality temporal smoothing
 * - FXAA anti-aliasing (FXAANode) - Fast edge smoothing (fallback)
 * - RCAS sharpening - Counter TAA blur
 * - Vignette - Cinematic edge darkening
 * - Color grading (exposure, saturation, contrast)
 *
 * IMPORTANT: GTAO requires hardware MSAA to be disabled on the renderer.
 * The WebGPUGameCanvas sets antialias: false when post-processing is enabled.
 * TAA provides superior anti-aliasing with temporal stability.
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
  abs,
  sqrt,
  texture,
} from 'three/tsl';

// Import WebGPU post-processing nodes from addons
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

// Import TAA system
import {
  TAASystem,
  TAAConfig,
  DEFAULT_TAA_CONFIG,
  TAAJitterManager,
  HALTON_SEQUENCE_16,
} from './TAA';

// ============================================
// POST-PROCESSING CONFIGURATION
// ============================================

// Anti-aliasing mode
export type AntiAliasingMode = 'off' | 'fxaa' | 'taa';

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

  // Anti-aliasing mode ('off', 'fxaa', 'taa')
  antiAliasingMode: AntiAliasingMode;

  // FXAA (legacy, derived from antiAliasingMode)
  fxaaEnabled: boolean;

  // TAA settings
  taaEnabled: boolean;
  taaHistoryBlendRate: number;
  taaSharpeningEnabled: boolean;
  taaSharpeningIntensity: number;

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

  // TAA is the new default for best quality
  antiAliasingMode: 'taa',
  fxaaEnabled: false,
  taaEnabled: true,
  taaHistoryBlendRate: 0.1,
  taaSharpeningEnabled: true,
  taaSharpeningIntensity: 0.5,

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
  private fxaaPass: ReturnType<typeof fxaa> | null = null;

  // TAA system
  private taaSystem: TAASystem | null = null;
  private taaHistoryTextures: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private taaCurrentBufferIndex = 0;
  private taaFrameIndex = 0;
  private taaPreviousViewMatrix = new THREE.Matrix4();
  private taaPreviousProjectionMatrix = new THREE.Matrix4();
  private taaHasValidHistory = false;

  // TAA uniforms
  private uTAAResolution = uniform(new THREE.Vector2(1920, 1080));
  private uTAAJitterOffset = uniform(new THREE.Vector2(0, 0));
  private uTAAPrevJitterOffset = uniform(new THREE.Vector2(0, 0));
  private uTAAHistoryValid = uniform(1.0);
  private uTAABlendRate = uniform(0.1);
  private uTAASharpeningIntensity = uniform(0.5);
  private uPrevViewMatrix = uniform(new THREE.Matrix4());
  private uPrevProjMatrix = uniform(new THREE.Matrix4());
  private uCurrViewMatrix = uniform(new THREE.Matrix4());
  private uCurrProjMatrix = uniform(new THREE.Matrix4());
  private uInvProjMatrix = uniform(new THREE.Matrix4());

  // Uniforms for dynamic updates
  private uVignetteIntensity = uniform(0.25);
  private uAOIntensity = uniform(1.0);
  private uExposure = uniform(1.0);
  private uSaturation = uniform(0.8);
  private uContrast = uniform(1.05);

  // Jitter projection matrix backup
  private projectionMatrixBackup = new THREE.Matrix4();

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

    // Initialize TAA history buffers
    this.initTAABuffers();

    this.postProcessing = this.createPipeline();
    this.applyConfig(this.config);
  }

  /**
   * Initialize TAA history buffers for ping-pong rendering.
   */
  private initTAABuffers(): void {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const width = Math.max(1, size.x);
    const height = Math.max(1, size.y);

    const createTarget = () =>
      new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
      });

    this.taaHistoryTextures = [createTarget(), createTarget()];
    this.uTAAResolution.value.set(width, height);
  }

  /**
   * Get the TAA history texture from the previous frame.
   */
  private getTAAHistoryTexture(): THREE.Texture {
    if (!this.taaHistoryTextures) return new THREE.Texture();
    const historyIndex = 1 - this.taaCurrentBufferIndex;
    return this.taaHistoryTextures[historyIndex].texture;
  }

  /**
   * Get the current TAA output target.
   */
  private getTAACurrentTarget(): THREE.WebGLRenderTarget | null {
    if (!this.taaHistoryTextures) return null;
    return this.taaHistoryTextures[this.taaCurrentBufferIndex];
  }

  /**
   * Apply TAA jitter to camera projection matrix.
   * Call before rendering scene.
   */
  public applyTAAJitter(): void {
    if (!this.config.taaEnabled) return;
    if (!(this.camera instanceof THREE.PerspectiveCamera || this.camera instanceof THREE.OrthographicCamera)) return;

    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const width = Math.max(1, size.x);
    const height = Math.max(1, size.y);

    // Store previous jitter
    this.uTAAPrevJitterOffset.value.copy(this.uTAAJitterOffset.value);

    // Get current jitter from Halton sequence
    const idx = this.taaFrameIndex % HALTON_SEQUENCE_16.length;
    const [jx, jy] = HALTON_SEQUENCE_16[idx];

    // Center around 0 and scale to NDC
    const jitterX = (jx - 0.5) / width;
    const jitterY = (jy - 0.5) / height;
    this.uTAAJitterOffset.value.set(jitterX, jitterY);

    // Backup and modify projection matrix
    this.projectionMatrixBackup.copy(this.camera.projectionMatrix);
    this.camera.projectionMatrix.elements[8] += jitterX * 2;
    this.camera.projectionMatrix.elements[9] += jitterY * 2;

    this.taaFrameIndex++;
  }

  /**
   * Remove TAA jitter from camera projection matrix.
   * Call after rendering scene.
   */
  public removeTAAJitter(): void {
    if (!this.config.taaEnabled) return;
    if (!(this.camera instanceof THREE.PerspectiveCamera || this.camera instanceof THREE.OrthographicCamera)) return;

    this.camera.projectionMatrix.copy(this.projectionMatrixBackup);
  }

  /**
   * Update TAA motion vector uniforms.
   * Call once per frame.
   */
  public updateTAAMotionVectors(): void {
    if (!this.config.taaEnabled) return;

    // Store previous matrices
    this.uPrevViewMatrix.value.copy(this.taaPreviousViewMatrix);
    this.uPrevProjMatrix.value.copy(this.taaPreviousProjectionMatrix);

    // Update current matrices
    this.uCurrViewMatrix.value.copy(this.camera.matrixWorldInverse);
    this.uCurrProjMatrix.value.copy(this.camera.projectionMatrix);
    this.uInvProjMatrix.value.copy((this.camera as THREE.PerspectiveCamera).projectionMatrixInverse);

    // Store for next frame
    this.taaPreviousViewMatrix.copy(this.camera.matrixWorldInverse);
    this.taaPreviousProjectionMatrix.copy(this.camera.projectionMatrix);

    // Update history validity
    this.uTAAHistoryValid.value = this.taaHasValidHistory ? 1.0 : 0.0;
  }

  /**
   * Swap TAA history buffers after rendering.
   */
  public swapTAABuffers(): void {
    if (!this.config.taaEnabled) return;

    this.taaCurrentBufferIndex = 1 - this.taaCurrentBufferIndex;
    this.taaHasValidHistory = true;
  }

  /**
   * Reset TAA history (e.g., on camera cut).
   */
  public resetTAAHistory(): void {
    this.taaHasValidHistory = false;
    this.taaFrameIndex = 0;
  }

  private createPipeline(): PostProcessing {
    const postProcessing = new PostProcessing(this.renderer);

    // Create scene pass
    const scenePass = pass(this.scene, this.camera);
    const scenePassColor = scenePass.getTextureNode();
    const scenePassDepth = scenePass.getTextureNode('depth');

    // Build the effect chain
    let outputNode: any = scenePassColor;

    // 1. GTAO Ambient Occlusion (applied first, multiplied with scene)
    // IMPORTANT: Requires antialias: false on the renderer to avoid multisampled depth texture issues
    if (this.config.aoEnabled) {
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

    // 2. Bloom effect (additive)
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

    // 3. Apply color grading and vignette
    try {
      outputNode = this.createColorGradingPass(outputNode);
    } catch (e) {
      console.warn('[PostProcessing] Color grading failed:', e);
    }

    // 4. Anti-aliasing (TAA or FXAA)
    if (this.config.antiAliasingMode === 'taa' && this.config.taaEnabled) {
      try {
        // TAA resolve pass with history blending
        outputNode = this.createTAAResolvePass(outputNode, scenePassDepth);

        // Apply sharpening if enabled (counters TAA blur)
        if (this.config.taaSharpeningEnabled) {
          outputNode = this.createSharpeningPass(outputNode);
        }

        postProcessing.outputNode = outputNode;
        console.log('[PostProcessing] TAA initialized successfully');
      } catch (e) {
        console.warn('[PostProcessing] TAA initialization failed, falling back to FXAA:', e);
        // Fallback to FXAA
        try {
          this.fxaaPass = fxaa(outputNode);
          postProcessing.outputNode = this.fxaaPass;
        } catch (fxaaError) {
          console.warn('[PostProcessing] FXAA fallback also failed:', fxaaError);
          postProcessing.outputNode = outputNode;
        }
      }
    } else if (this.config.antiAliasingMode === 'fxaa' || this.config.fxaaEnabled) {
      // FXAA anti-aliasing
      try {
        this.fxaaPass = fxaa(outputNode);
        postProcessing.outputNode = this.fxaaPass;
      } catch (e) {
        console.warn('[PostProcessing] FXAA initialization failed:', e);
        postProcessing.outputNode = outputNode;
      }
    } else {
      // No anti-aliasing
      postProcessing.outputNode = outputNode;
    }

    return postProcessing;
  }

  /**
   * Create the TAA resolve pass.
   * Blends current frame with reprojected history using neighborhood clipping.
   */
  private createTAAResolvePass(currentColorNode: any, depthNode: any): any {
    const historyTexture = this.getTAAHistoryTexture();

    // RGB to YCoCg conversion for better temporal stability
    const rgb2YCoCg = (rgb: any) => {
      const r = rgb.x;
      const g = rgb.y;
      const b = rgb.z;
      const y = r.mul(0.25).add(g.mul(0.5)).add(b.mul(0.25));
      const co = r.mul(0.5).sub(b.mul(0.5));
      const cg = r.mul(-0.25).add(g.mul(0.5)).sub(b.mul(0.25));
      return vec3(y, co, cg);
    };

    // YCoCg to RGB conversion
    const yCoCg2RGB = (ycocg: any) => {
      const y = ycocg.x;
      const co = ycocg.y;
      const cg = ycocg.z;
      const r = y.add(co).sub(cg);
      const g = y.add(cg);
      const b = y.sub(co).sub(cg);
      return vec3(r, g, b);
    };

    return Fn(() => {
      const fragUV = uv();
      const texelSize = vec2(1.0).div(this.uTAAResolution);

      // Sample current frame with jitter removed
      const currentUV = fragUV.sub(this.uTAAJitterOffset);
      const currentColor = vec3(currentColorNode).toVar();

      // Sample depth for motion vector computation
      const depth = float(depthNode).toVar();

      // Compute motion vector from camera movement
      // Reconstruct clip position
      const ndcX = fragUV.x.mul(2.0).sub(1.0);
      const ndcY = fragUV.y.mul(2.0).sub(1.0);
      const ndcZ = depth.mul(2.0).sub(1.0);
      const clipPos = vec4(ndcX, ndcY, ndcZ, 1.0);

      // Transform to view space
      const viewPos = this.uInvProjMatrix.mul(clipPos);
      const viewPosNorm = viewPos.xyz.div(viewPos.w);

      // For camera-only motion, compute reprojection
      // Previous frame position = prevProj * prevView * invCurrView * currViewPos
      const currViewInv = this.uCurrViewMatrix.toVar();
      const worldPos = currViewInv.mul(vec4(viewPosNorm, 1.0));
      const prevViewPos = this.uPrevViewMatrix.mul(worldPos);
      const prevClipPos = this.uPrevProjMatrix.mul(prevViewPos);
      const prevNDC = prevClipPos.xyz.div(prevClipPos.w);
      const prevUV = prevNDC.xy.mul(0.5).add(0.5);

      // Motion vector
      const motionVector = prevUV.sub(fragUV);

      // Sample history at reprojected location
      const historyUV = fragUV.add(motionVector);
      const historyColor = texture(historyTexture, historyUV).rgb.toVar();

      // Sample 3x3 neighborhood for variance clipping
      const offsets = [
        vec2(-1, -1), vec2(0, -1), vec2(1, -1),
        vec2(-1, 0), vec2(0, 0), vec2(1, 0),
        vec2(-1, 1), vec2(0, 1), vec2(1, 1),
      ];

      // Compute neighborhood statistics in YCoCg space
      const centerYCoCg = rgb2YCoCg(currentColor);
      let minYCoCg = centerYCoCg.toVar();
      let maxYCoCg = centerYCoCg.toVar();
      let meanYCoCg = centerYCoCg.toVar();
      let m2YCoCg = centerYCoCg.mul(centerYCoCg).toVar();

      // Sample neighbors
      for (let i = 0; i < 9; i++) {
        if (i === 4) continue; // Skip center
        const offset = offsets[i];
        const neighborUV = fragUV.add(offset.mul(texelSize));
        const neighborColor = texture(currentColorNode, neighborUV).rgb;
        const neighborYCoCg = rgb2YCoCg(neighborColor);

        minYCoCg.assign(min(minYCoCg, neighborYCoCg));
        maxYCoCg.assign(max(maxYCoCg, neighborYCoCg));
        meanYCoCg.addAssign(neighborYCoCg);
        m2YCoCg.addAssign(neighborYCoCg.mul(neighborYCoCg));
      }

      // Compute variance-based AABB
      meanYCoCg.divAssign(9.0);
      m2YCoCg.divAssign(9.0);
      const variance = sqrt(abs(m2YCoCg.sub(meanYCoCg.mul(meanYCoCg))));
      const gamma = float(1.0); // Variance clip gamma

      const varMin = meanYCoCg.sub(variance.mul(gamma));
      const varMax = meanYCoCg.add(variance.mul(gamma));

      // Use tighter bounds
      const boxMin = max(minYCoCg, varMin);
      const boxMax = min(maxYCoCg, varMax);

      // Clip history to AABB
      const historyYCoCg = rgb2YCoCg(historyColor);
      const boxCenter = boxMin.add(boxMax).mul(0.5);
      const boxExtent = boxMax.sub(boxMin).mul(0.5).add(0.0001);
      const direction = historyYCoCg.sub(boxCenter);
      const tClip = abs(direction).div(boxExtent);
      const maxT = max(max(tClip.x, tClip.y), tClip.z);
      const clippedYCoCg = mix(
        historyYCoCg,
        boxCenter.add(direction.div(max(maxT, float(1.0)))),
        float(maxT).greaterThan(1.0)
      );
      const clippedHistory = yCoCg2RGB(clippedYCoCg);

      // Compute blend factor
      let blendFactor = this.uTAABlendRate.toVar();

      // Increase blend (favor current) when motion is large
      const motionMagnitude = motionVector.length().mul(this.uTAAResolution.x);
      blendFactor.addAssign(clamp(motionMagnitude.mul(0.1), 0.0, 0.3));

      // Favor current when history UV is outside viewport
      const outsideX = historyUV.x.lessThan(0.0).or(historyUV.x.greaterThan(1.0));
      const outsideY = historyUV.y.lessThan(0.0).or(historyUV.y.greaterThan(1.0));
      blendFactor.assign(mix(blendFactor, float(1.0), float(outsideX.or(outsideY))));

      // Favor current when history is invalid
      blendFactor.assign(mix(blendFactor, float(1.0), float(1.0).sub(this.uTAAHistoryValid)));

      // Clamp blend factor
      blendFactor.assign(clamp(blendFactor, 0.015, 0.5));

      // Blend current and clipped history
      const result = mix(clippedHistory, currentColor, blendFactor);

      return vec4(result, 1.0);
    })();
  }

  /**
   * Create RCAS (Robust Contrast-Adaptive Sharpening) pass.
   * Counters TAA blur while preserving edges.
   */
  private createSharpeningPass(inputNode: any): any {
    return Fn(() => {
      const fragUV = uv();
      const texelSize = vec2(1.0).div(this.uTAAResolution);

      // Sample center and 4 neighbors (cross pattern)
      const center = vec3(inputNode).toVar();
      const north = texture(inputNode, fragUV.add(vec2(0, -1).mul(texelSize))).rgb;
      const south = texture(inputNode, fragUV.add(vec2(0, 1).mul(texelSize))).rgb;
      const west = texture(inputNode, fragUV.add(vec2(-1, 0).mul(texelSize))).rgb;
      const east = texture(inputNode, fragUV.add(vec2(1, 0).mul(texelSize))).rgb;

      // Compute local contrast
      const minRGB = min(min(min(north, south), min(west, east)), center);
      const maxRGB = max(max(max(north, south), max(west, east)), center);

      // Compute sharpening weight based on local contrast
      const contrast = maxRGB.sub(minRGB);
      const rcpM = float(1.0).div(max(max(contrast.r, contrast.g), contrast.b).add(0.25));

      // Compute sharpening kernel
      const neighbors = north.add(south).add(west).add(east);
      const sharpenedColor = center.add(
        center.mul(4.0).sub(neighbors).mul(this.uTAASharpeningIntensity).mul(rcpM)
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
    this.postProcessing = this.createPipeline();
  }

  /**
   * Apply configuration to uniforms and passes
   */
  applyConfig(config: Partial<PostProcessingConfig>): void {
    const needsRebuild =
      (config.bloomEnabled !== undefined && config.bloomEnabled !== this.config.bloomEnabled) ||
      (config.aoEnabled !== undefined && config.aoEnabled !== this.config.aoEnabled) ||
      (config.fxaaEnabled !== undefined && config.fxaaEnabled !== this.config.fxaaEnabled) ||
      (config.taaEnabled !== undefined && config.taaEnabled !== this.config.taaEnabled) ||
      (config.antiAliasingMode !== undefined && config.antiAliasingMode !== this.config.antiAliasingMode) ||
      (config.taaSharpeningEnabled !== undefined && config.taaSharpeningEnabled !== this.config.taaSharpeningEnabled) ||
      (config.vignetteEnabled !== undefined && config.vignetteEnabled !== this.config.vignetteEnabled);

    this.config = { ...this.config, ...config };

    // Sync derived AA flags from mode
    if (config.antiAliasingMode !== undefined) {
      this.config.fxaaEnabled = config.antiAliasingMode === 'fxaa';
      this.config.taaEnabled = config.antiAliasingMode === 'taa';
    }

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

    // Update TAA parameters
    this.uTAABlendRate.value = this.config.taaHistoryBlendRate;
    this.uTAASharpeningIntensity.value = this.config.taaSharpeningIntensity;

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
    this.resetTAAHistory(); // Reset TAA on camera change
    this.rebuild();
  }

  /**
   * Set render size (for TAA buffer resizing)
   */
  setSize(width: number, height: number): void {
    if (this.taaHistoryTextures) {
      const currentSize = this.uTAAResolution.value;
      if (currentSize.x !== width || currentSize.y !== height) {
        this.taaHistoryTextures[0].setSize(width, height);
        this.taaHistoryTextures[1].setSize(width, height);
        this.uTAAResolution.value.set(width, height);
        this.resetTAAHistory();
      }
    }
  }

  /**
   * Check if TAA is enabled
   */
  isTAAEnabled(): boolean {
    return this.config.taaEnabled && this.config.antiAliasingMode === 'taa';
  }

  /**
   * Get current anti-aliasing mode
   */
  getAntiAliasingMode(): AntiAliasingMode {
    return this.config.antiAliasingMode;
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
    // Dispose TAA history buffers
    if (this.taaHistoryTextures) {
      this.taaHistoryTextures[0].dispose();
      this.taaHistoryTextures[1].dispose();
      this.taaHistoryTextures = null;
    }
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

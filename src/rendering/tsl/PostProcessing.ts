/**
 * TSL Post-Processing Pipeline - AAA Quality
 *
 * WebGPU-compatible post-processing using Three.js TSL nodes.
 * Features:
 * - Bloom effect (BloomNode) - HDR glow
 * - GTAO ambient occlusion (GTAONode) - Contact shadows
 * - FXAA anti-aliasing (FXAANode) - Edge smoothing
 * - Vignette - Cinematic edge darkening
 * - Color grading (exposure, saturation, contrast)
 *
 * IMPORTANT: GTAO requires hardware MSAA to be disabled on the renderer.
 * The WebGPUGameCanvas sets antialias: false when post-processing is enabled.
 * We use FXAA for anti-aliasing instead.
 */

import * as THREE from 'three';
import { WebGPURenderer, PostProcessing } from 'three/webgpu';
import {
  pass,
  uniform,
  uv,
  vec3,
  vec4,
  float,
  Fn,
  mix,
  smoothstep,
  clamp,
  length,
  dot,
} from 'three/tsl';

// Import WebGPU post-processing nodes from addons
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

// ============================================
// POST-PROCESSING CONFIGURATION
// ============================================

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

  // Anti-aliasing
  fxaaEnabled: boolean;

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

  fxaaEnabled: true,

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

  // Uniforms for dynamic updates
  private uVignetteIntensity = uniform(0.25);
  private uAOIntensity = uniform(1.0);
  private uExposure = uniform(1.0);
  private uSaturation = uniform(0.8);
  private uContrast = uniform(1.05);

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

    this.postProcessing = this.createPipeline();
    this.applyConfig(this.config);
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

    // 4. FXAA anti-aliasing (final pass)
    if (this.config.fxaaEnabled) {
      try {
        this.fxaaPass = fxaa(outputNode);
        postProcessing.outputNode = this.fxaaPass;
      } catch (e) {
        console.warn('[PostProcessing] FXAA initialization failed:', e);
        postProcessing.outputNode = outputNode;
      }
    } else {
      postProcessing.outputNode = outputNode;
    }

    return postProcessing;
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
      (config.vignetteEnabled !== undefined && config.vignetteEnabled !== this.config.vignetteEnabled);

    this.config = { ...this.config, ...config };

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

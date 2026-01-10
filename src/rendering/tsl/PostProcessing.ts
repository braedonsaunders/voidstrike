/**
 * TSL Post-Processing Pipeline
 *
 * WebGPU-compatible post-processing using Three.js Shading Language.
 * Features:
 * - Bloom effect
 * - Screen-space ambient occlusion (SSAO)
 * - FXAA anti-aliasing
 * - Tone mapping
 * - Vignette
 * - Color grading
 */

import * as THREE from 'three';
import { PostProcessing } from 'three/addons/renderers/common/PostProcessing.js';
import {
  pass,
  bloom,
  ao,
  fxaa,
  output,
  mrt,
  normalView,
  depth,
  uniform,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  Fn,
  mix,
  pow,
  smoothstep,
  clamp,
  length,
  dot,
  abs,
  max,
  min,
  saturate,
} from 'three/tsl';

import type WebGPURenderer from 'three/addons/renderers/webgpu/WebGPURenderer.js';

// ============================================
// POST-PROCESSING CONFIGURATION
// ============================================

export interface PostProcessingConfig {
  // Bloom
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;

  // SSAO
  ssaoEnabled: boolean;
  ssaoRadius: number;
  ssaoIntensity: number;

  // Anti-aliasing
  fxaaEnabled: boolean;

  // Vignette
  vignetteEnabled: boolean;
  vignetteIntensity: number;
  vignetteRadius: number;

  // Color grading
  exposure: number;
  saturation: number;
  contrast: number;
}

const DEFAULT_CONFIG: PostProcessingConfig = {
  bloomEnabled: true,
  bloomStrength: 0.2,
  bloomRadius: 0.4,
  bloomThreshold: 0.9,

  ssaoEnabled: true,
  ssaoRadius: 16,
  ssaoIntensity: 1.0,

  fxaaEnabled: true,

  vignetteEnabled: true,
  vignetteIntensity: 0.3,
  vignetteRadius: 0.8,

  exposure: 1.0,
  saturation: 1.1,
  contrast: 1.05,
};

// ============================================
// POST-PROCESSING PIPELINE
// ============================================

export class RenderPipeline {
  private renderer: WebGPURenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private postProcessing: PostProcessing;
  private config: PostProcessingConfig;

  // Uniforms for dynamic updates
  private uBloomStrength = uniform(0.2);
  private uVignetteIntensity = uniform(0.3);
  private uVignetteRadius = uniform(0.8);
  private uExposure = uniform(1.0);
  private uSaturation = uniform(1.1);
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

    // Create scene pass with MRT for depth/normal access
    const scenePass = pass(this.scene, this.camera);

    // Enable MRT for SSAO
    if (this.config.ssaoEnabled) {
      scenePass.setMRT(
        mrt({
          output: output,
          normal: normalView,
        })
      );
    }

    // Get textures from scene pass
    let colorNode = scenePass.getTextureNode('output');

    // Apply SSAO
    if (this.config.ssaoEnabled) {
      const depthTexture = scenePass.getTextureNode('depth');
      const normalTexture = scenePass.getTextureNode('normal');

      const aoPass = ao(depthTexture, normalTexture, this.camera);
      colorNode = colorNode.mul(aoPass);
    }

    // Apply Bloom
    if (this.config.bloomEnabled) {
      const bloomPass = bloom(colorNode, this.uBloomStrength, this.config.bloomRadius);
      colorNode = colorNode.add(bloomPass);
    }

    // Custom post-processing effects
    const finalPass = this.createFinalPass(colorNode);

    // Apply FXAA
    if (this.config.fxaaEnabled) {
      postProcessing.outputNode = fxaa(finalPass);
    } else {
      postProcessing.outputNode = finalPass;
    }

    return postProcessing;
  }

  private createFinalPass(inputNode: any): any {
    // Vignette effect
    const vignetteEffect = Fn(([color]: [any]) => {
      const uvCentered = uv().sub(0.5);
      const dist = length(uvCentered).mul(2.0);
      const vignette = smoothstep(this.uVignetteRadius, this.uVignetteRadius.sub(0.5), dist);
      return mix(color.mul(0.2), color, vignette);
    });

    // Saturation adjustment
    const saturate_color = Fn(([color, amount]: [any, any]) => {
      const luminance = dot(color, vec3(0.299, 0.587, 0.114));
      return mix(vec3(luminance), color, amount);
    });

    // Contrast adjustment
    const adjustContrast = Fn(([color, amount]: [any, any]) => {
      return color.sub(0.5).mul(amount).add(0.5);
    });

    // Combined final pass
    return Fn(() => {
      let color = vec3(inputNode).toVar();

      // Apply vignette
      if (this.config.vignetteEnabled) {
        const uvCentered = uv().sub(0.5);
        const dist = length(uvCentered).mul(2.0);
        const vignette = smoothstep(this.uVignetteRadius, this.uVignetteRadius.sub(0.5), dist);
        color.assign(mix(color.mul(float(1.0).sub(this.uVignetteIntensity)), color, vignette));
      }

      // Apply exposure
      color.mulAssign(this.uExposure);

      // Apply saturation
      const luminance = dot(color, vec3(0.299, 0.587, 0.114));
      color.assign(mix(vec3(luminance), color, this.uSaturation));

      // Apply contrast
      color.assign(color.sub(0.5).mul(this.uContrast).add(0.5));

      // Clamp to valid range
      color.assign(clamp(color, 0.0, 1.0));

      return vec4(color, 1.0);
    })();
  }

  /**
   * Apply configuration to uniforms
   */
  applyConfig(config: Partial<PostProcessingConfig>): void {
    this.config = { ...this.config, ...config };

    this.uBloomStrength.value = this.config.bloomStrength;
    this.uVignetteIntensity.value = this.config.vignetteIntensity;
    this.uVignetteRadius.value = this.config.vignetteRadius;
    this.uExposure.value = this.config.exposure;
    this.uSaturation.value = this.config.saturation;
    this.uContrast.value = this.config.contrast;
  }

  /**
   * Update camera reference (needed if camera changes)
   */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    // Rebuild pipeline with new camera
    this.postProcessing = this.createPipeline();
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
// SIMPLE BLOOM IMPLEMENTATION (FALLBACK)
// ============================================

/**
 * Create a simple bloom pass for cases where the full pipeline isn't needed
 */
export function createSimpleBloom(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  strength: number = 0.5,
  radius: number = 0.5
): PostProcessing {
  const postProcessing = new PostProcessing(renderer);

  const scenePass = pass(scene, camera);
  const bloomPass = bloom(scenePass, strength, radius);

  postProcessing.outputNode = scenePass.add(bloomPass);

  return postProcessing;
}

// ============================================
// OUTLINE EFFECT
// ============================================

/**
 * Create outline effect for selected objects
 */
export function createOutlinePass(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  selectedObjects: THREE.Object3D[],
  outlineColor: THREE.Color = new THREE.Color(0x00ff00)
): any {
  // Create a scene for rendering selected objects silhouettes
  const outlineScene = new THREE.Scene();
  const outlineMaterial = new THREE.MeshBasicMaterial({ color: outlineColor });

  // This is a simplified approach - full outline would need depth edge detection
  const outlinePass = Fn(([sceneTexture]: [any]) => {
    // For now, just return the scene texture
    // Full implementation would do sobel edge detection on depth
    return sceneTexture;
  });

  return outlinePass;
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

  /**
   * Trigger screen shake
   */
  shake(intensity: number, duration: number): void {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeTime = 0;
    this.originalPosition.copy(this.camera.position);
  }

  /**
   * Update shake effect
   */
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
      // Reset position
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

  /**
   * Flash the damage vignette
   */
  flash(intensity: number = 0.5): void {
    this.intensity.value = intensity;
  }

  /**
   * Update - decay the intensity
   */
  update(deltaTime: number): void {
    if (this.intensity.value > 0) {
      this.intensity.value = Math.max(0, this.intensity.value - deltaTime * 2);
    }
  }

  /**
   * Get the vignette node for compositing
   */
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

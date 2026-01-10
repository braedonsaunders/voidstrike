import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

/**
 * SC2-LEVEL POST-PROCESSING
 *
 * Uses Three.js's official post-processing library for properly tested effects:
 * - UnrealBloomPass for high-quality bloom
 * - SMAA/FXAA for anti-aliasing
 * - OutputPass for correct color space handling
 */

export class SC2PostProcessing {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloomPass: UnrealBloomPass;
  private fxaaPass: ShaderPass;
  private outputPass: OutputPass;

  private renderer: THREE.WebGLRenderer;

  // Settings
  private bloomEnabled = true;
  private fxaaEnabled = true;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;

    const size = renderer.getSize(new THREE.Vector2());
    const pixelRatio = renderer.getPixelRatio();

    // Create the effect composer
    this.composer = new EffectComposer(renderer);

    // 1. Render the scene
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // 2. Bloom (Unreal Engine style - high quality)
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.3,   // strength (subtle)
      0.4,   // radius
      0.85   // threshold (only bright things bloom)
    );
    this.composer.addPass(this.bloomPass);

    // 3. Anti-aliasing (FXAA - fast and effective)
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.fxaaPass.uniforms['resolution'].value.set(
      1 / (size.x * pixelRatio),
      1 / (size.y * pixelRatio)
    );
    this.composer.addPass(this.fxaaPass);

    // 4. Output pass (handles sRGB conversion properly)
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    console.log('[SC2PostProcessing] Initialized with Three.js EffectComposer');
  }

  render(): void {
    this.composer.render();
  }

  setSize(width: number, height: number): void {
    const pixelRatio = this.renderer.getPixelRatio();
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
    this.fxaaPass.uniforms['resolution'].value.set(
      1 / (width * pixelRatio),
      1 / (height * pixelRatio)
    );
  }

  // Bloom controls
  setBloomStrength(strength: number): void {
    this.bloomPass.strength = strength;
  }

  setBloomThreshold(threshold: number): void {
    this.bloomPass.threshold = threshold;
  }

  setBloomRadius(radius: number): void {
    this.bloomPass.radius = radius;
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
    this.bloomPass.enabled = enabled;
  }

  // Anti-aliasing controls
  setFXAAEnabled(enabled: boolean): void {
    this.fxaaEnabled = enabled;
    this.fxaaPass.enabled = enabled;
  }

  // Legacy API compatibility - these are no-ops now since we removed broken effects
  setSSAOEnabled(_enabled: boolean): void {
    // SSAO removed - was broken
  }

  setSSAOStrength(_strength: number): void {
    // SSAO removed - was broken
  }

  setGodRaysEnabled(_enabled: boolean): void {
    // God rays removed - was broken
  }

  setGodRaysStrength(_strength: number): void {
    // God rays removed - was broken
  }

  setColorGradingEnabled(_enabled: boolean): void {
    // Color grading removed - was causing issues
  }

  setSunPosition(_position: THREE.Vector3): void {
    // No longer used
  }

  setVignetteStrength(_strength: number): void {
    // Vignette removed
  }

  dispose(): void {
    this.composer.dispose();
  }
}

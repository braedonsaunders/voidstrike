import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { debugPostProcessing } from '@/utils/debugLogger';

/**
 * SC2-LEVEL POST-PROCESSING
 *
 * Uses Three.js's official post-processing library:
 * - SSAOPass for ambient occlusion (depth/grounding)
 * - UnrealBloomPass for high-quality bloom
 * - OutlinePass for selected unit highlighting
 * - FXAA for anti-aliasing
 * - OutputPass for correct color space handling
 */

export class SC2PostProcessing {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private ssaoPass: SSAOPass;
  private bloomPass: UnrealBloomPass;
  private outlinePass: OutlinePass;
  private fxaaPass: ShaderPass;
  private outputPass: OutputPass;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());
    const pixelRatio = renderer.getPixelRatio();

    // Create the effect composer
    this.composer = new EffectComposer(renderer);

    // 1. Render the scene
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // 2. SSAO - Screen Space Ambient Occlusion
    this.ssaoPass = new SSAOPass(scene, camera, size.x, size.y);
    this.ssaoPass.kernelRadius = 16;  // Stronger AO for better depth
    this.ssaoPass.minDistance = 0.001;
    this.ssaoPass.maxDistance = 0.15;
    this.ssaoPass.enabled = true;
    this.composer.addPass(this.ssaoPass);

    // 3. Bloom (Unreal Engine style)
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.2,   // strength (subtle)
      0.4,   // radius
      0.9    // threshold (only very bright things bloom)
    );
    this.composer.addPass(this.bloomPass);

    // 4. Outline pass for selected objects
    this.outlinePass = new OutlinePass(
      new THREE.Vector2(size.x, size.y),
      scene,
      camera
    );
    // Configure outline appearance - cyan/teal color for selection
    this.outlinePass.visibleEdgeColor.set(0x00ffff);
    this.outlinePass.hiddenEdgeColor.set(0x006666);
    this.outlinePass.edgeStrength = 3;
    this.outlinePass.edgeGlow = 0.5;
    this.outlinePass.edgeThickness = 1;
    this.outlinePass.pulsePeriod = 0; // No pulse by default
    this.outlinePass.enabled = true;
    this.composer.addPass(this.outlinePass);

    // 5. Anti-aliasing (FXAA)
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.fxaaPass.uniforms['resolution'].value.set(
      1 / (size.x * pixelRatio),
      1 / (size.y * pixelRatio)
    );
    this.composer.addPass(this.fxaaPass);

    // 6. Output pass (handles sRGB conversion properly)
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    debugPostProcessing.log('[SC2PostProcessing] Initialized with SSAO, Bloom, Outline, FXAA');
  }

  render(): void {
    this.composer.render();
  }

  setSize(width: number, height: number): void {
    const pixelRatio = this.renderer.getPixelRatio();
    this.composer.setSize(width, height);
    this.ssaoPass.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
    this.outlinePass.resolution.set(width, height);
    this.fxaaPass.uniforms['resolution'].value.set(
      1 / (width * pixelRatio),
      1 / (height * pixelRatio)
    );
  }

  // === SSAO Controls ===
  setSSAOEnabled(enabled: boolean): void {
    this.ssaoPass.enabled = enabled;
  }

  setSSAOKernelRadius(radius: number): void {
    this.ssaoPass.kernelRadius = radius;
  }

  // === Bloom Controls ===
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
    this.bloomPass.enabled = enabled;
  }

  // === Outline Controls ===
  setOutlineEnabled(enabled: boolean): void {
    this.outlinePass.enabled = enabled;
  }

  /**
   * Set which objects should be outlined (e.g., selected units)
   */
  setOutlinedObjects(objects: THREE.Object3D[]): void {
    this.outlinePass.selectedObjects = objects;
  }

  /**
   * Add an object to the outline selection
   */
  addOutlinedObject(object: THREE.Object3D): void {
    if (!this.outlinePass.selectedObjects.includes(object)) {
      this.outlinePass.selectedObjects.push(object);
    }
  }

  /**
   * Remove an object from the outline selection
   */
  removeOutlinedObject(object: THREE.Object3D): void {
    const index = this.outlinePass.selectedObjects.indexOf(object);
    if (index > -1) {
      this.outlinePass.selectedObjects.splice(index, 1);
    }
  }

  /**
   * Clear all outlined objects
   */
  clearOutlinedObjects(): void {
    this.outlinePass.selectedObjects = [];
  }

  /**
   * Set outline color
   */
  setOutlineColor(color: number): void {
    this.outlinePass.visibleEdgeColor.set(color);
    // Darker version for hidden edges
    const c = new THREE.Color(color);
    c.multiplyScalar(0.4);
    this.outlinePass.hiddenEdgeColor.copy(c);
  }

  /**
   * Set outline strength/thickness
   */
  setOutlineStrength(strength: number): void {
    this.outlinePass.edgeStrength = strength;
  }

  // === Anti-aliasing Controls ===
  setFXAAEnabled(enabled: boolean): void {
    this.fxaaPass.enabled = enabled;
  }

  // === Tone Mapping Controls ===
  setToneMappingExposure(exposure: number): void {
    this.renderer.toneMappingExposure = exposure;
  }

  // === Utility ===
  getOutlinePass(): OutlinePass {
    return this.outlinePass;
  }

  dispose(): void {
    this.composer.dispose();
  }
}

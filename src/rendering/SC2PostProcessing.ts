import * as THREE from 'three';

/**
 * SC2-LEVEL POST-PROCESSING
 *
 * Adds cinematic visual effects:
 * - Bloom for energy weapons, explosions, and glowing effects
 * - Subtle vignette for focus
 * - Color grading for atmosphere
 * - FXAA anti-aliasing
 */

export class SC2PostProcessing {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  // Render targets
  private renderTarget: THREE.WebGLRenderTarget;
  private bloomRenderTarget: THREE.WebGLRenderTarget;
  private blurRenderTargetH: THREE.WebGLRenderTarget;
  private blurRenderTargetV: THREE.WebGLRenderTarget;

  // Full-screen quad for post-processing
  private fullscreenQuad: THREE.Mesh;

  // Shader materials
  private bloomExtractMaterial: THREE.ShaderMaterial;
  private blurMaterialH: THREE.ShaderMaterial;
  private blurMaterialV: THREE.ShaderMaterial;
  private compositeMaterial: THREE.ShaderMaterial;

  // Settings
  private bloomStrength = 0.8;
  private bloomThreshold = 0.7;
  private bloomRadius = 0.5;
  private vignetteStrength = 0.3;
  private saturation = 1.1;
  private contrast = 1.05;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());
    const pixelRatio = renderer.getPixelRatio();

    // Create render targets
    const rtParams: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    };

    this.renderTarget = new THREE.WebGLRenderTarget(
      size.x * pixelRatio,
      size.y * pixelRatio,
      rtParams
    );

    // Bloom at half resolution for performance
    const bloomWidth = Math.floor(size.x * pixelRatio / 2);
    const bloomHeight = Math.floor(size.y * pixelRatio / 2);

    this.bloomRenderTarget = new THREE.WebGLRenderTarget(bloomWidth, bloomHeight, rtParams);
    this.blurRenderTargetH = new THREE.WebGLRenderTarget(bloomWidth, bloomHeight, rtParams);
    this.blurRenderTargetV = new THREE.WebGLRenderTarget(bloomWidth, bloomHeight, rtParams);

    // Create fullscreen quad
    const quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.fullscreenQuad = new THREE.Mesh(quadGeometry, new THREE.MeshBasicMaterial());

    // Create shader materials
    this.bloomExtractMaterial = this.createBloomExtractMaterial();
    this.blurMaterialH = this.createBlurMaterial(true);
    this.blurMaterialV = this.createBlurMaterial(false);
    this.compositeMaterial = this.createCompositeMaterial();
  }

  private createBloomExtractMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        threshold: { value: this.bloomThreshold },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float threshold;
        varying vec2 vUv;

        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));

          // Soft threshold for smoother bloom
          float softThreshold = threshold * 0.8;
          float contribution = clamp((brightness - softThreshold) / (threshold - softThreshold), 0.0, 1.0);

          gl_FragColor = vec4(color.rgb * contribution, 1.0);
        }
      `,
    });
  }

  private createBlurMaterial(horizontal: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2() },
        direction: { value: horizontal ? new THREE.Vector2(1, 0) : new THREE.Vector2(0, 1) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform vec2 direction;
        varying vec2 vUv;

        // Gaussian blur weights
        const float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

        void main() {
          vec2 texelSize = 1.0 / resolution;
          vec3 result = texture2D(tDiffuse, vUv).rgb * weights[0];

          for (int i = 1; i < 5; i++) {
            vec2 offset = direction * texelSize * float(i) * 2.0;
            result += texture2D(tDiffuse, vUv + offset).rgb * weights[i];
            result += texture2D(tDiffuse, vUv - offset).rgb * weights[i];
          }

          gl_FragColor = vec4(result, 1.0);
        }
      `,
    });
  }

  private createCompositeMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        bloomStrength: { value: this.bloomStrength },
        vignetteStrength: { value: this.vignetteStrength },
        saturation: { value: this.saturation },
        contrast: { value: this.contrast },
        resolution: { value: new THREE.Vector2() },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tBloom;
        uniform float bloomStrength;
        uniform float vignetteStrength;
        uniform float saturation;
        uniform float contrast;
        uniform vec2 resolution;
        varying vec2 vUv;

        vec3 adjustSaturation(vec3 color, float sat) {
          float gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
          return mix(vec3(gray), color, sat);
        }

        vec3 adjustContrast(vec3 color, float cont) {
          return (color - 0.5) * cont + 0.5;
        }

        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          vec4 bloom = texture2D(tBloom, vUv);

          // Add bloom
          vec3 result = color.rgb + bloom.rgb * bloomStrength;

          // Apply color grading
          result = adjustSaturation(result, saturation);
          result = adjustContrast(result, contrast);

          // Vignette
          vec2 center = vUv - 0.5;
          float dist = length(center);
          float vignette = 1.0 - smoothstep(0.3, 0.9, dist) * vignetteStrength;
          result *= vignette;

          // Subtle film grain for texture (very subtle)
          float grain = (fract(sin(dot(vUv * resolution + fract(float(gl_FragCoord.x)), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.015;
          result += grain;

          // Tone mapping (ACES approximation)
          result = result / (result + vec3(1.0));
          result = pow(result, vec3(1.0 / 2.2)); // Gamma correction

          gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
        }
      `,
    });
  }

  render(): void {
    const renderer = this.renderer;
    const originalRenderTarget = renderer.getRenderTarget();

    // 1. Render scene to render target
    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    // 2. Extract bright areas for bloom
    this.fullscreenQuad.material = this.bloomExtractMaterial;
    this.bloomExtractMaterial.uniforms.tDiffuse.value = this.renderTarget.texture;
    renderer.setRenderTarget(this.bloomRenderTarget);
    renderer.render(this.fullscreenQuad, this.camera);

    // 3. Horizontal blur
    this.fullscreenQuad.material = this.blurMaterialH;
    this.blurMaterialH.uniforms.tDiffuse.value = this.bloomRenderTarget.texture;
    this.blurMaterialH.uniforms.resolution.value.set(
      this.blurRenderTargetH.width,
      this.blurRenderTargetH.height
    );
    renderer.setRenderTarget(this.blurRenderTargetH);
    renderer.render(this.fullscreenQuad, this.camera);

    // 4. Vertical blur
    this.fullscreenQuad.material = this.blurMaterialV;
    this.blurMaterialV.uniforms.tDiffuse.value = this.blurRenderTargetH.texture;
    this.blurMaterialV.uniforms.resolution.value.set(
      this.blurRenderTargetV.width,
      this.blurRenderTargetV.height
    );
    renderer.setRenderTarget(this.blurRenderTargetV);
    renderer.render(this.fullscreenQuad, this.camera);

    // 5. Second blur pass for smoother bloom
    this.blurMaterialH.uniforms.tDiffuse.value = this.blurRenderTargetV.texture;
    renderer.setRenderTarget(this.blurRenderTargetH);
    renderer.render(this.fullscreenQuad, this.camera);

    this.blurMaterialV.uniforms.tDiffuse.value = this.blurRenderTargetH.texture;
    renderer.setRenderTarget(this.blurRenderTargetV);
    renderer.render(this.fullscreenQuad, this.camera);

    // 6. Composite final image
    this.fullscreenQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.tDiffuse.value = this.renderTarget.texture;
    this.compositeMaterial.uniforms.tBloom.value = this.blurRenderTargetV.texture;
    this.compositeMaterial.uniforms.resolution.value.set(
      this.renderTarget.width,
      this.renderTarget.height
    );
    renderer.setRenderTarget(originalRenderTarget);
    renderer.render(this.fullscreenQuad, this.camera);
  }

  setSize(width: number, height: number): void {
    const pixelRatio = this.renderer.getPixelRatio();

    this.renderTarget.setSize(width * pixelRatio, height * pixelRatio);

    const bloomWidth = Math.floor(width * pixelRatio / 2);
    const bloomHeight = Math.floor(height * pixelRatio / 2);

    this.bloomRenderTarget.setSize(bloomWidth, bloomHeight);
    this.blurRenderTargetH.setSize(bloomWidth, bloomHeight);
    this.blurRenderTargetV.setSize(bloomWidth, bloomHeight);
  }

  setBloomStrength(strength: number): void {
    this.bloomStrength = strength;
    this.compositeMaterial.uniforms.bloomStrength.value = strength;
  }

  setBloomThreshold(threshold: number): void {
    this.bloomThreshold = threshold;
    this.bloomExtractMaterial.uniforms.threshold.value = threshold;
  }

  setVignetteStrength(strength: number): void {
    this.vignetteStrength = strength;
    this.compositeMaterial.uniforms.vignetteStrength.value = strength;
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.bloomRenderTarget.dispose();
    this.blurRenderTargetH.dispose();
    this.blurRenderTargetV.dispose();

    this.fullscreenQuad.geometry.dispose();
    this.bloomExtractMaterial.dispose();
    this.blurMaterialH.dispose();
    this.blurMaterialV.dispose();
    this.compositeMaterial.dispose();
  }
}
